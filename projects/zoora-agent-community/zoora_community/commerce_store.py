"""Authenticated, durable local commerce research. No provider or wallet execution."""

import hashlib
import json
import uuid

from .commerce import CommerceBook, action_value, fingerprint, label, policy as commerce_policy
from .validation import DIGEST, Problem, canonical, fields, identifier, matching

CREATE = "COMMERCE_BOOK_CREATE"
ACTION = "COMMERCE_ACTION"
DOMAIN = b"ZOORA_AE023_DURABLE_COMMERCE_V1\0"


def digest(value):
    return hashlib.sha256(DOMAIN + canonical(value).encode()).hexdigest()


def bindings_value(value, agents):
    if type(value) is not list or not 1 <= len(value) <= 32:
        raise Problem(400, "INVALID_COMMERCE_BINDINGS")
    result = []
    for item in value:
        fields(item, ("alias", "agent_id"))
        result.append({"alias": label(item["alias"]), "agent_id": identifier(item["agent_id"])})
    if (len({x["alias"] for x in result}) != len(result)
            or len({x["agent_id"] for x in result}) != len(result)
            or {x["alias"] for x in result} != set(agents)):
        raise Problem(400, "INVALID_COMMERCE_BINDINGS")
    return sorted(result, key=lambda x: x["alias"])


class CommerceMethods:
    def _commerce_members(self, connection, operator_id, bindings, *, live=False):
        for binding in bindings:
            agent = self._row(connection, "agents", binding["agent_id"])
            if agent["operator_id"] != operator_id:
                raise Problem(403, "COMMERCE_FOREIGN_AGENT")
            if live and (not agent["active"] or self._access_held(connection, "AGENT", agent["id"])):
                raise Problem(409, "COMMERCE_AGENT_INACTIVE")

    def _commerce_access(self, principal, row, bindings):
        if principal["role"] == "OWNER":
            return
        if principal["role"] == "OPERATOR" and principal["principal_id"] == row["operator_id"]:
            return
        if principal["role"] == "AGENT" and principal["principal_id"] in {b["agent_id"] for b in bindings}:
            return
        raise Problem(403, "FORBIDDEN")

    def _commerce_actor(self, principal, row, bindings, command, book):
        kind = command.get("kind")
        if kind == "REVOKE":
            if principal["role"] not in {"OWNER", "OPERATOR"}:
                raise Problem(403, "FORBIDDEN")
            return "operator"
        if kind in {"RESOLVE", "REFUND", "FULFILL"}:
            self._role(principal, "OPERATOR")
            return "fixture_adapter"
        if kind == "CANCEL" and principal["role"] == "OPERATOR":
            record = book.records.get(identifier(command.get("purchase_id")))
            if record is None:
                raise Problem(404, "NOT_FOUND")
            return record["request"]["quote"]["payer"]
        self._role(principal, "AGENT")
        alias = next((x["alias"] for x in bindings if x["agent_id"] == principal["principal_id"]), None)
        if alias is None:
            raise Problem(403, "FORBIDDEN")
        return alias

    def _commerce_command(self, principal, row, bindings, body, at, book):
        self._commerce_access(principal, row, bindings)
        fields(body, ("request_id", "command"), ("sandbox_dispatch",))
        identifier(body["request_id"])
        command = body["command"]
        if type(command) is not dict or type(command.get("kind")) is not str:
            raise Problem(400, "INVALID_COMMERCE_COMMAND")
        if "sandbox_dispatch" in body:
            context = body["sandbox_dispatch"]
            fields(context, ("instance_id", "pipeline_terms_sha256"))
            identifier(context["instance_id"])
            matching(context["pipeline_terms_sha256"], DIGEST, "INVALID_DIGEST")
            if command["kind"] != "SUBMIT":
                raise Problem(400, "COMMERCE_SANDBOX_CONTEXT_REQUIRES_SUBMIT")
        if "actor" in command or "at_tick" in command:
            raise Problem(400, "SERVER_COMMERCE_IDENTITY_REQUIRED")
        actor = self._commerce_actor(principal, row, bindings, command, book)
        value = {**command, "actor": actor, "at_tick": at - row["created_ms"]}
        if command["kind"] == "PURCHASE":
            request = command.get("request")
            if type(request) is not dict or type(request.get("quote")) is not dict:
                raise Problem(400, "INVALID_COMMERCE_COMMAND")
            if "payer" in request["quote"]:
                raise Problem(400, "SERVER_COMMERCE_IDENTITY_REQUIRED")
            value["request"] = {**request, "quote": {**request["quote"], "payer": actor}}
        # Even operator-only terminal observations must explicitly be marked synthetic.
        fixture = value.pop("fixture", None)
        if command["kind"] in {"RESOLVE", "REFUND", "FULFILL"}:
            if fixture is not True:
                raise Problem(400, "SYNTHETIC_FIXTURE_REQUIRED")
        elif "fixture" in command:
            raise Problem(400, "INVALID_FIELDS")
        return action_value(value)

    @staticmethod
    def _commerce_bindings(row):
        try:
            return bindings_value(json.loads(row["bindings_json"]), json.loads(row["policy_json"])["authority"]["agents"])
        except (Problem, ValueError, KeyError, TypeError, UnicodeError, RecursionError):
            raise Problem(503, "COMMERCE_CONSISTENCY_FAILURE") from None

    def _commerce_load(self, connection, row):
        value = json.loads(row["policy_json"])
        book = CommerceBook(value)
        bindings = bindings_value(json.loads(row["bindings_json"]), book.policy["authority"]["agents"])
        if book.policy["authority"]["operator"] != "operator":
            raise ValueError("invalid book controller")
        self._commerce_members(connection, row["operator_id"], bindings)
        actions = connection.execute("SELECT * FROM commerce_actions WHERE book_id=? ORDER BY sequence", (row["id"],)).fetchall()
        for sequence, saved in enumerate(actions, 1):
            principal = {"role": saved["actor_role"], "principal_id": saved["actor_id"]}
            body = json.loads(saved["request_json"])
            expected = self._commerce_command(principal, row, bindings, body, saved["at_ms"], book)
            if (saved["sequence"] != sequence or expected != json.loads(saved["action_json"])
                    or saved["request_id"] != body["request_id"]
                    or saved["request_sha256"] != digest({"role": principal["role"], "principal_id": principal["principal_id"], "body": body})):
                raise ValueError("durable command binding mismatch")
            event = book.apply(expected)
            if event["outcome"] != saved["outcome"] or fingerprint(event["state"]) != saved["state_sha256"]:
                raise ValueError("durable replay mismatch")
        if (row["revision"] != len(actions) or row["state_sha256"] != fingerprint(book.snapshot())
                or row["updated_ms"] != (actions[-1]["at_ms"] if actions else row["created_ms"])):
            raise ValueError("durable book state mismatch")
        return book, bindings

    def _commerce_checked(self, connection, row):
        try:
            return self._commerce_load(connection, row)
        except (Problem, ValueError, KeyError, TypeError, UnicodeError, RecursionError):
            raise Problem(503, "COMMERCE_CONSISTENCY_FAILURE") from None

    @staticmethod
    def _commerce_view(row, book, bindings, at):
        return {"id": row["id"], "operator_id": row["operator_id"], "revision": row["revision"],
                "created_ms": row["created_ms"], "updated_ms": row["updated_ms"],
                "current_elapsed_ms": at - row["created_ms"], "state_at_elapsed_ms": book.authority.tick,
                "state_sha256": row["state_sha256"], "state": book.snapshot(), "bindings": bindings,
                "policy": book.policy,
                "classification": "SYNTHETIC_ECONOMIC_MODEL", "controller_authentication": "LOCAL_API_CREDENTIAL",
                "scope": "PRIVATE_OPERATOR_COMMERCE", "provider_eligibility": "DECLARED_FIXTURE_ONLY",
                "provider_integration": False, "wallet_execution": False, "durable_local_records": True,
                "live_execution_worker": False, "new_actions_revalidate_server_time": True}

    def _commerce_read(self, connection, principal, parts, at, limit, after):
        if len(parts) not in {3, 4}:
            raise Problem(404, "NOT_FOUND")
        if len(parts) == 4:
            row = self._row(connection, "commerce_books", identifier(parts[3]))
            raw_bindings = self._commerce_bindings(row)
            self._commerce_access(principal, row, raw_bindings)
            book, bindings = self._commerce_checked(connection, row)
            return 200, self._commerce_view(row, book, bindings, at)
        # Only summaries are listed; full per-book ledgers stay in authorized detail reads.
        rows = connection.execute("SELECT * FROM commerce_books WHERE id>? ORDER BY id", (after,)).fetchall()
        visible = []
        for row in rows:
            bindings = self._commerce_bindings(row)
            try:
                self._commerce_access(principal, row, bindings)
            except Problem as error:
                if error.code == "FORBIDDEN":
                    continue
                raise
            visible.append({k: row[k] for k in ("id", "operator_id", "revision", "created_ms", "updated_ms")})
            if len(visible) > limit:
                break
        return 200, {"items": visible[:limit], "next_after": visible[limit - 1]["id"] if len(visible) > limit else None,
                     "scope": "PRIVATE_OPERATOR_COMMERCE", "wallet_execution": False}

    def _commerce_write(self, connection, principal, method, parts, body, at):
        if method != "POST":
            raise Problem(405, "METHOD_NOT_ALLOWED")
        if len(parts) == 3:
            return self._commerce_create(connection, principal, body, at)
        if len(parts) != 5 or parts[4] != "actions":
            raise Problem(404, "NOT_FOUND")
        row = self._row(connection, "commerce_books", identifier(parts[3]))
        self._commerce_access(principal, row, self._commerce_bindings(row))
        book, bindings = self._commerce_checked(connection, row)
        action = self._commerce_command(principal, row, bindings, body, at, book)
        if "sandbox_dispatch" in body:
            instance = connection.execute("SELECT value FROM metadata WHERE key='instance_id'").fetchone()[0]
            if body["sandbox_dispatch"]["instance_id"] != instance:
                raise Problem(409, "COMMERCE_SANDBOX_INSTANCE_MISMATCH")
        request_hash = digest({"role": principal["role"], "principal_id": principal["principal_id"], "body": body})
        old = connection.execute("SELECT * FROM commerce_actions WHERE book_id=? AND request_id=?", (row["id"], body["request_id"])).fetchone()
        if old:
            if old["request_sha256"] != request_hash:
                raise Problem(409, "COMMERCE_REQUEST_CONFLICT")
            return 200, {"book": self._commerce_view(row, book, bindings, at), "outcome": old["outcome"], "replayed": True}
        self._capacity(connection, "commerce_actions")
        event = book.apply(action)
        action_id, sequence = uuid.uuid4().hex, row["revision"] + 1
        state_hash = fingerprint(event["state"])
        connection.execute("INSERT INTO commerce_actions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                           (action_id, row["id"], sequence, body["request_id"], request_hash, principal["role"],
                            principal["principal_id"], principal["id"], canonical(body), canonical(action),
                            event["outcome"], state_hash, at))
        connection.execute("UPDATE commerce_books SET revision=?,state_sha256=?,updated_ms=? WHERE id=?", (sequence, state_hash, at, row["id"]))
        self._event(connection, principal, ACTION, action_id,
                    {"book_id": row["id"], "sequence": sequence, "request_sha256": request_hash,
                     "action_sha256": digest(action), "outcome": event["outcome"], "state_sha256": state_hash,
                     "credential_id": principal["id"]}, at)
        updated = {**dict(row), "revision": sequence, "state_sha256": state_hash, "updated_ms": at}
        return 201, {"book": self._commerce_view(updated, book, bindings, at), "outcome": event["outcome"], "replayed": False}

    def _commerce_create(self, connection, principal, body, at):
        self._role(principal, "OPERATOR")
        fields(body, ("request_id", "policy", "bindings"))
        request_id = identifier(body["request_id"])
        value = commerce_policy(body["policy"])
        if value["authority"]["operator"] != "operator":
            raise Problem(400, "INVALID_COMMERCE_CONTROLLER")
        bindings = bindings_value(body["bindings"], value["authority"]["agents"])
        request_hash = digest({"policy": value, "bindings": bindings})
        old = connection.execute("SELECT * FROM commerce_books WHERE operator_id=? AND request_id=?", (principal["principal_id"], request_id)).fetchone()
        if old:
            if old["request_sha256"] != request_hash:
                raise Problem(409, "COMMERCE_REQUEST_CONFLICT")
            book, bindings = self._commerce_checked(connection, old)
            return 200, {"book": self._commerce_view(old, book, bindings, at), "replayed": True}
        self._commerce_members(connection, principal["principal_id"], bindings, live=True)
        self._capacity(connection, "commerce_books")
        if connection.execute("SELECT COUNT(*) FROM commerce_books WHERE operator_id=?", (principal["principal_id"],)).fetchone()[0] >= 4:
            raise Problem(409, "COMMERCE_OPERATOR_BOOK_LIMIT")
        book = CommerceBook(value)
        book_id, state_hash = uuid.uuid4().hex, fingerprint(book.snapshot())
        row = {"id": book_id, "operator_id": principal["principal_id"], "credential_id": principal["id"],
               "request_id": request_id, "request_sha256": request_hash, "policy_json": canonical(value),
               "bindings_json": canonical(bindings), "created_ms": at, "updated_ms": at, "revision": 0,
               "state_sha256": state_hash}
        connection.execute("INSERT INTO commerce_books VALUES (?,?,?,?,?,?,?,?,?,?,?)", tuple(row.values()))
        self._event(connection, principal, CREATE, book_id,
                    {"request_id": request_id, "request_sha256": request_hash, "policy_sha256": digest(value),
                     "bindings_sha256": digest(bindings), "state_sha256": state_hash, "credential_id": principal["id"]}, at)
        return 201, {"book": self._commerce_view(row, book, bindings, at), "replayed": False}

    def _audit_commerce(self, connection):
        creations = {}
        actions = {}
        enabled = False
        sequences = {}
        for event in connection.execute("SELECT * FROM audit WHERE action IN ('INITIALIZE','SCHEMA_MIGRATE',?,?) ORDER BY seq", (CREATE, ACTION)):
            detail = json.loads(event["details"])
            if event["action"] in {"INITIALIZE", "SCHEMA_MIGRATE"}:
                enabled |= detail.get("schema_version", detail.get("to", 0)) >= 6
                continue
            if not enabled:
                raise ValueError("commerce before schema checkpoint")
            if event["action"] == ACTION:
                book_id = detail["book_id"]
                expected_sequence = sequences.get(book_id, 0) + 1
                if book_id not in creations or detail["sequence"] != expected_sequence:
                    raise ValueError("commerce audit ordering")
                sequences[book_id] = expected_sequence
            target = creations if event["action"] == CREATE else actions
            if event["resource_id"] in target:
                raise ValueError("duplicate commerce audit identity")
            target[event["resource_id"]] = event
        books = connection.execute("SELECT * FROM commerce_books").fetchall()
        saved_actions = connection.execute("SELECT * FROM commerce_actions").fetchall()
        if not enabled or set(creations) != {b["id"] for b in books} or set(actions) != {a["id"] for a in saved_actions}:
            raise ValueError("commerce rows differ from audit history")
        for row in books:
            book, bindings = self._commerce_load(connection, row)
            event = creations[row["id"]]
            initial = CommerceBook(book.policy)
            expected = {"request_id": row["request_id"], "request_sha256": row["request_sha256"],
                        "policy_sha256": digest(book.policy), "bindings_sha256": digest(bindings),
                        "state_sha256": fingerprint(initial.snapshot()), "credential_id": row["credential_id"]}
            credential = self._row(connection, "credentials", row["credential_id"])
            if (event["actor_role"] != "OPERATOR" or event["actor_id"] != row["operator_id"]
                    or event["at_ms"] != row["created_ms"] or json.loads(event["details"]) != expected
                    or credential["role"] != "OPERATOR" or credential["principal_id"] != row["operator_id"]
                    or not credential["created_ms"] <= row["created_ms"] < credential["expires_ms"]
                    or row["request_sha256"] != digest({"policy": book.policy, "bindings": bindings})):
                raise ValueError("commerce creation audit mismatch")
        for row in saved_actions:
            event = actions[row["id"]]
            credential = self._row(connection, "credentials", row["credential_id"])
            expected = {"book_id": row["book_id"], "sequence": row["sequence"], "request_sha256": row["request_sha256"],
                        "action_sha256": digest(json.loads(row["action_json"])), "outcome": row["outcome"],
                        "state_sha256": row["state_sha256"], "credential_id": row["credential_id"]}
            if (event["actor_role"] != row["actor_role"] or event["actor_id"] != row["actor_id"]
                    or event["at_ms"] != row["at_ms"] or json.loads(event["details"]) != expected
                    or not credential["created_ms"] <= row["at_ms"] < credential["expires_ms"]
                    or credential["role"] != row["actor_role"] or credential["principal_id"] != row["actor_id"]):
                raise ValueError("commerce action audit mismatch")
