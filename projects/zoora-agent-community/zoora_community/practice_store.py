"""Authenticated simulator boundary and replay-verifiable durable paper ledger."""

import json
import secrets
import uuid

from . import practice_engine as engine
from .validation import DIGEST, Problem, canonical, fields, identifier, matching

PRACTICE_TABLES = {"practice_episodes", "practice_actions", "practice_frames"}


class PracticeMethods:
    def _practice_visibility(self, connection, principal, agent_id):
        agent = self._row(connection, "agents", identifier(agent_id))
        if principal["role"] != "OWNER":
            self._manage_agent(principal, agent)

    @staticmethod
    def _practice_item(row):
        state = json.loads(row["state_json"])
        return {
            "id": row["id"],
            "tick": state["tick"],
            "status": state["status"],
            "classification": "SYNTHETIC_TRAINING",
            "commitment": row["commitment"],
            "ledger_head": row["head"],
            "created_ms": row["created_ms"],
            "live_execution_allowed": False,
        }

    def _practice_read(self, connection, route, token, at, limit, after):
        principal = self._authenticate(connection, token, at)
        if route == "/v1/practice/episodes":
            rows = connection.execute(
                "SELECT * FROM practice_episodes WHERE id>? ORDER BY id LIMIT ?", (after, limit + 1)
            ).fetchall()
            return 200, {
                "items": [self._practice_item(r) for r in rows[:limit]],
                "next_after": rows[limit - 1]["id"] if len(rows) > limit else None,
            }
        parts = route.strip("/").split("/")
        if len(parts) < 4 or parts[:3] != ["v1", "practice", "episodes"]:
            raise Problem(404, "NOT_FOUND")
        episode = self._row(connection, "practice_episodes", identifier(parts[3]))
        world = json.loads(episode["state_json"])
        if len(parts) == 4:
            return 200, {**self._practice_item(episode), "market": engine.public_market(world)}
        if len(parts) == 5 and parts[4] == "history":
            # Tick is not a client-supplied cursor: only existing, already revealed frames are read.
            rows = connection.execute(
                "SELECT * FROM practice_frames WHERE episode_id=? ORDER BY tick", (episode["id"],)
            ).fetchall()
            return 200, {"items": [json.loads(r["snapshot"]) for r in rows]}
        if len(parts) in (6, 7) and parts[4] == "accounts":
            key = identifier(parts[5])
            self._practice_visibility(connection, principal, key)
            if len(parts) == 6:
                return 200, engine.account_view(world, key)
            if parts[6] == "orders":
                engine.account_view(world, key)
                receipts = world["accounts"][key]["receipts"]
                start = 0
                if after:
                    matches = [i for i, r in enumerate(receipts) if r["request_id"] == after]
                    if not matches:
                        raise Problem(400, "INVALID_PAGINATION")
                    start = matches[0] + 1
                page = receipts[start : start + limit]
                return 200, {
                    "items": page,
                    "next_after": page[-1]["request_id"] if start + limit < len(receipts) else None,
                }
        raise Problem(404, "NOT_FOUND")

    def _practice_write(self, connection, principal, method, route, body, at):
        if method != "POST":
            raise Problem(405, "METHOD_NOT_ALLOWED")
        if route == "/v1/practice/episodes":
            self._role(principal, "OWNER")
            fields(body, ("request_id",))
            request_id = identifier(body["request_id"])
            existing = connection.execute(
                "SELECT * FROM practice_episodes WHERE request_id=?", (request_id,)
            ).fetchone()
            if existing:
                # Creation retry returns stable identity/commitment, never creates another world.
                return 200, {
                    "id": existing["id"],
                    "commitment": existing["commitment"],
                    "replayed": True,
                }
            self._capacity(connection, "practice_episodes")
            self._capacity(connection, "practice_frames")
            world = engine.new_world(secrets.token_hex(32))
            content = canonical(world)
            commitment = engine.digest(world)
            key = uuid.uuid4().hex
            connection.execute(
                "INSERT INTO practice_episodes VALUES (?,?,?,?,?,?,?)",
                (key, request_id, content, content, commitment, commitment, at),
            )
            connection.execute(
                "INSERT INTO practice_frames VALUES (?,?,0,?)",
                (uuid.uuid4().hex, key, canonical(engine.public_market(world))),
            )
            self._event(
                connection,
                principal,
                "PRACTICE_CREATE",
                key,
                {"commitment": commitment, "request_id": request_id},
                at,
            )
            return 201, {"id": key, "commitment": commitment, "replayed": False}
        parts = route.strip("/").split("/")
        if len(parts) != 5 or parts[:3] != ["v1", "practice", "episodes"]:
            raise Problem(404, "NOT_FOUND")
        key = identifier(parts[3])
        episode = self._row(connection, "practice_episodes", key)
        if parts[4] == "step":
            self._role(principal, "OWNER")
            fields(body, ("request_id", "expected_tick"))
            engine.integer(body["expected_tick"], 0, engine.MAX_TICKS)
            command = {"action": "step", **body}
        elif parts[4] == "accounts":
            self._role(principal, "OPERATOR")
            fields(body, ("request_id", "agent_id", "model_pipeline_sha256"))
            agent_id = identifier(body["agent_id"])
            self._practice_visibility(connection, principal, agent_id)
            self._active_agent(connection, agent_id)
            pipeline = matching(body["model_pipeline_sha256"], DIGEST, "INVALID_PIPELINE_SHA256")
            command = {
                "action": "enroll",
                "agent_id": agent_id,
                "pipeline": pipeline,
                "request_id": body["request_id"],
            }
        elif parts[4] == "orders":
            self._role(principal, "AGENT")
            fields(
                body, ("request_id", "coin_id", "side", "amount", "min_output", "observation_tick")
            )
            identifier(body["coin_id"])
            engine.integer(body["observation_tick"], 0, engine.MAX_TICKS)
            command = {"action": "order", "agent_id": principal["principal_id"], **body}
        else:
            raise Problem(404, "NOT_FOUND")
        request_id = identifier(body["request_id"])
        old = connection.execute(
            "SELECT * FROM practice_actions WHERE episode_id=? AND actor_id=? AND request_id=?",
            (key, principal["principal_id"], request_id),
        ).fetchone()
        if old:
            stored = json.loads(old["command"])
            stored.pop("sequence", None)
            stored.pop("credential_id", None)
            stored.pop("ineligible_agents", None)
            if canonical(stored) != canonical(command):
                raise Problem(409, "PRACTICE_IDEMPOTENCY_CONFLICT")
            return 200, json.loads(old["result"])
        self._capacity(connection, "practice_actions")
        ordinal = (
            connection.execute(
                "SELECT COUNT(*) FROM practice_actions WHERE episode_id=?", (key,)
            ).fetchone()[0]
            + 1
        )
        if command["action"] == "order":
            command["sequence"] = ordinal
            command["credential_id"] = principal["id"]
        world = json.loads(episode["state_json"])
        if command["action"] == "step":
            command["ineligible_agents"] = []
            for agent_id, account in sorted(world["accounts"].items()):
                if not account["pending"]:
                    continue
                credential = connection.execute(
                    "SELECT * FROM credentials WHERE id=?", (account["pending_credential"],)
                ).fetchone()
                valid = (
                    credential is not None
                    and credential["role"] == "AGENT"
                    and credential["principal_id"] == agent_id
                    and not credential["revoked"]
                    and at < credential["expires_ms"]
                )
                try:
                    self._active_agent(connection, agent_id)
                except Problem as error:
                    if error.code not in {"ACCESS_SUSPENDED", "AGENT_INACTIVE"}:
                        raise
                    valid = False
                if not valid:
                    command["ineligible_agents"].append(agent_id)
        result = engine.apply(world, command)
        if len(canonical(world).encode()) > 800_000:
            raise Problem(409, "PRACTICE_STATE_LIMIT")
        if command["action"] == "step":
            self._capacity(connection, "practice_frames")
            connection.execute(
                "INSERT INTO practice_frames VALUES (?,?,?,?)",
                (uuid.uuid4().hex, key, world["tick"], canonical(result)),
            )
        head = engine.digest([episode["head"], command, result, engine.digest(world)])
        connection.execute(
            "INSERT INTO practice_actions VALUES (?,?,?,?,?,?,?,?,?)",
            (
                uuid.uuid4().hex,
                key,
                ordinal,
                principal["principal_id"],
                request_id,
                canonical(command),
                canonical(result),
                episode["head"],
                head,
            ),
        )
        connection.execute(
            "UPDATE practice_episodes SET state_json=?,head=? WHERE id=?",
            (canonical(world), head, key),
        )
        self._event(
            connection,
            principal,
            "PRACTICE_" + command["action"].upper(),
            key,
            {"ledger_head": head},
            at,
        )
        return 201, result

    def _audit_practice(self, connection):
        """Recompute every transition, fill, frame, cash balance and hash from genesis."""
        events = {}
        for event in connection.execute(
            "SELECT * FROM audit WHERE action GLOB 'PRACTICE_*' ORDER BY seq"
        ):
            events.setdefault(event["resource_id"], []).append(event)
        episode_ids = {row[0] for row in connection.execute("SELECT id FROM practice_episodes")}
        if set(events) != episode_ids:
            raise ValueError("practice episode/audit mismatch")
        for episode in connection.execute("SELECT * FROM practice_episodes"):
            identifier(episode["id"])
            identifier(episode["request_id"])
            observed_events = events[episode["id"]]
            creation = observed_events[0]
            if (
                creation["action"] != "PRACTICE_CREATE"
                or creation["actor_role"] != "OWNER"
                or creation["actor_id"] != "owner"
                or creation["at_ms"] != episode["created_ms"]
                or creation["details"]
                != canonical(
                    {"commitment": episode["commitment"], "request_id": episode["request_id"]}
                )
            ):
                raise ValueError("practice creation/audit mismatch")
            world = json.loads(episode["initial_json"])
            head = engine.digest(world)
            if head != episode["commitment"] or canonical(
                engine.new_world(world["secret"])
            ) != canonical(world):
                raise ValueError("practice genesis mismatch")
            frames = {
                r["tick"]: r["snapshot"]
                for r in connection.execute(
                    "SELECT * FROM practice_frames WHERE episode_id=?", (episode["id"],)
                )
            }
            if frames.pop(0, None) != canonical(engine.public_market(world)):
                raise ValueError("practice genesis frame mismatch")
            ordinal = 0
            for row in connection.execute(
                "SELECT * FROM practice_actions WHERE episode_id=? ORDER BY ordinal",
                (episode["id"],),
            ):
                ordinal += 1
                command = json.loads(row["command"])
                if len(observed_events) <= ordinal:
                    raise ValueError("practice transition missing from audit")
                event = observed_events[ordinal]
                role = {"enroll": "OPERATOR", "order": "AGENT", "step": "OWNER"}.get(
                    command["action"]
                )
                if (
                    event["action"] != "PRACTICE_" + command["action"].upper()
                    or event["actor_role"] != role
                    or event["actor_id"] != row["actor_id"]
                    or event["details"] != canonical({"ledger_head": row["hash"]})
                ):
                    raise ValueError("practice transition/audit mismatch")
                if (
                    command["request_id"] != row["request_id"]
                    or row["ordinal"] != ordinal
                    or command["action"] == "order"
                    and (command["sequence"] != ordinal or command["agent_id"] != row["actor_id"])
                ):
                    raise ValueError("practice command mismatch")
                if command["action"] == "enroll":
                    agent = self._row(connection, "agents", command["agent_id"])
                    if agent["operator_id"] != row["actor_id"]:
                        raise ValueError("practice creator mismatch")
                if command["action"] == "order":
                    credential = self._row(connection, "credentials", command["credential_id"])
                    if (
                        credential["role"] != "AGENT"
                        or credential["principal_id"] != row["actor_id"]
                        or not credential["created_ms"] <= event["at_ms"] < credential["expires_ms"]
                    ):
                        raise ValueError("practice order credential mismatch")
                if command["action"] == "step" and row["actor_id"] != "owner":
                    raise ValueError("practice clock actor mismatch")
                result = engine.apply(world, command)
                actual = engine.digest([head, command, result, engine.digest(world)])
                if (
                    row["previous_hash"] != head
                    or row["hash"] != actual
                    or canonical(result) != row["result"]
                ):
                    raise ValueError("practice ledger mismatch")
                head = actual
                if command["action"] == "step" and frames.pop(world["tick"], None) != canonical(
                    result
                ):
                    raise ValueError("practice observed frame mismatch")
            if (
                len(observed_events) != ordinal + 1
                or frames
                or canonical(world) != episode["state_json"]
                or head != episode["head"]
            ):
                raise ValueError("practice state mismatch")
