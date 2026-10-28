"""Owner-issued operator invitations and durable scoped suspension controls.

An invitation is a secret capability, not proof of the recipient's identity.
The recipient nonce permits an exact short retry without storing recoverable
credentials. No invitation confers an owner role, wallet authority or payment.
"""

import base64
import hashlib
import hmac
import json
import re
import secrets
import uuid

from .validation import DIGEST, Problem, canonical, fields, handle, identifier, matching, text

INVITE_TOKEN = re.compile(r"zi1_[A-Za-z0-9_-]{43}\Z")
CLAIM_NONCE = re.compile(r"icn1_[A-Za-z0-9_-]{43}\Z")
CLAIM_RETRY_MS = 5 * 60_000
MAX_PENDING = 32


def invite_digest(token):
    return hashlib.sha256(b"ZOORA_AE011_INVITATION_V1\0" + token.encode("ascii")).hexdigest()


def claim_value(body):
    fields(body, ("invitation_token", "handle", "claim_nonce"))
    return {"invitation_token": matching(body["invitation_token"], INVITE_TOKEN, "INVALID_INVITATION"),
            "handle": handle(body["handle"]),
            "claim_nonce": matching(body["claim_nonce"], CLAIM_NONCE, "INVALID_CLAIM_NONCE")}


def claim_fingerprint(value):
    return hashlib.sha256(b"ZOORA_AE011_CLAIM_V1\0" + canonical(value).encode("utf-8")).hexdigest()


def claimed_token(value):
    # The server-created 256-bit invitation is the HMAC key. The confidential
    # recipient nonce is domain-bound with the requested operator handle.
    payload = canonical({"handle": value["handle"], "claim_nonce": value["claim_nonce"]}).encode()
    raw = hmac.digest(value["invitation_token"].encode("ascii"), b"ZOORA_AE011_OPERATOR_TOKEN_V1\0" + payload, "sha256")
    return "za1_" + base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def invitation_value(body):
    fields(body, ("request_id", "label"), ("ttl_seconds",))
    ttl = body.get("ttl_seconds", 3600)
    if type(ttl) is not int or not 300 <= ttl <= 86400:
        raise Problem(400, "INVALID_INVITATION_TTL")
    return {"request_id": identifier(body["request_id"]), "label": text(body["label"], 128), "ttl_seconds": ttl}


def invitation_fingerprint(value):
    return hashlib.sha256(b"ZOORA_AE011_INVITE_REQUEST_V1\0" + canonical(value).encode()).hexdigest()


class PilotAccessMethods:
    def _access_held(self, connection, kind, subject_id):
        if self.schema_version < 4:
            return False
        return connection.execute("SELECT 1 FROM access_holds WHERE kind=? AND subject_id=? AND active=1",
                                  (kind, subject_id)).fetchone() is not None

    def _invitation_state(self, connection, row, at):
        if row["revoked"]:
            return "REVOKED"
        creator = self._row(connection, "credentials", row["creator_credential_id"])
        if creator["revoked"] or at >= creator["expires_ms"]:
            return "CREATOR_CREDENTIAL_INVALID"
        if row["claimed_ms"] is not None:
            return "CLAIMED"
        return "EXPIRED" if at >= row["expires_ms"] else "AVAILABLE"

    def _invitation_view(self, connection, row, at):
        keys = ("id", "label", "created_ms", "expires_ms", "claimed_ms", "operator_id")
        return {**{key: row[key] for key in keys}, "state": self._invitation_state(connection, row, at),
                "granted_role": "OPERATOR", "identity_verification": "UNAVAILABLE"}

    def _pilot_read(self, connection, principal, route, at, limit, after):
        if route == "/v1/invitations":
            self._role(principal, "OWNER")
            rows = connection.execute("SELECT * FROM invitations WHERE id>? ORDER BY id LIMIT ?", (after, limit + 1)).fetchall()
            items = [self._invitation_view(connection, row, at) for row in rows[:limit]]
        elif route == "/v1/operators":
            self._role(principal, "OWNER")
            rows = connection.execute("SELECT * FROM operators WHERE id>? ORDER BY id LIMIT ?", (after, limit + 1)).fetchall()
            items = [dict(row, active=bool(row["active"]), suspended=self._access_held(connection, "OPERATOR", row["id"])) for row in rows[:limit]]
        elif route == "/v1/managed-agents":
            if principal["role"] not in {"OWNER", "OPERATOR"}:
                raise Problem(403, "FORBIDDEN")
            clause, args = ("", []) if principal["role"] == "OWNER" else ("AND operator_id=?", [principal["principal_id"]])
            rows = connection.execute("SELECT * FROM agents WHERE id>? " + clause + " ORDER BY id LIMIT ?", [after, *args, limit + 1]).fetchall()
            items = []
            for row in rows[:limit]:
                hold = connection.execute("SELECT * FROM access_holds WHERE kind='AGENT' AND subject_id=?", (row["id"],)).fetchone()
                items.append({"id": row["id"], "handle": row["handle"], "operator_id": row["operator_id"],
                              "active": bool(row["active"]), "suspended": bool(hold and hold["active"]),
                              "suspension_controller": hold["controller_role"] if hold and hold["active"] else None,
                              "reason": hold["reason"] if hold and hold["active"] else None})
        else:
            raise Problem(404, "NOT_FOUND")
        return 200, {"items": items, "next_after": items[-1]["id"] if len(rows) > limit else None,
                     "scope": "PRIVATE_PILOT_ACCESS"}

    def _invitation_write(self, connection, principal, method, route, body, at):
        self._role(principal, "OWNER")
        if method != "POST":
            raise Problem(405, "METHOD_NOT_ALLOWED")
        if route == "/v1/invitations":
            value = invitation_value(body)
            fingerprint = invitation_fingerprint(value)
            old = connection.execute("SELECT * FROM invitations WHERE creator_credential_id=? AND request_id=?",
                                     (principal["id"], value["request_id"])).fetchone()
            if old is not None:
                if not secrets.compare_digest(fingerprint, old["request_digest"]):
                    raise Problem(409, "INVITATION_REQUEST_CONFLICT")
                return 200, {"invitation": self._invitation_view(connection, old, at), "secret": None, "replayed": True}
            pending = connection.execute("SELECT * FROM invitations WHERE revoked=0 AND claimed_ms IS NULL").fetchall()
            if sum(self._invitation_state(connection, row, at) == "AVAILABLE" for row in pending) >= MAX_PENDING:
                raise Problem(409, "INVITATION_PENDING_LIMIT")
            self._capacity(connection, "invitations")
            secret, record_id = "zi1_" + secrets.token_urlsafe(32), uuid.uuid4().hex
            connection.execute("INSERT INTO invitations(id,creator_credential_id,request_id,request_digest,token_digest,label,created_ms,expires_ms) VALUES (?,?,?,?,?,?,?,?)",
                               (record_id, principal["id"], value["request_id"], fingerprint, invite_digest(secret), value["label"], at, at + value["ttl_seconds"] * 1000))
            self._event(connection, principal, "INVITATION_CREATE", record_id,
                        {"creator_credential_id": principal["id"], "ttl_seconds": value["ttl_seconds"],
                         "request_digest": fingerprint, "token_digest": invite_digest(secret)}, at)
            return 201, {"invitation": self._invitation_view(connection, self._row(connection, "invitations", record_id), at),
                         "secret": {"token": secret, "invitation_id": record_id, "expires_at_ms": at + value["ttl_seconds"] * 1000}, "replayed": False}
        parts = route.strip("/").split("/")
        if len(parts) == 4 and parts[3] == "revoke":
            fields(body)
            row = self._row(connection, "invitations", identifier(parts[2]))
            if not row["revoked"]:
                connection.execute("UPDATE invitations SET revoked=1 WHERE id=?", (row["id"],))
                self._event(connection, principal, "INVITATION_REVOKE", row["id"], {}, at)
            return 200, self._invitation_view(connection, self._row(connection, "invitations", row["id"]), at)
        raise Problem(404, "NOT_FOUND")

    def _claim_invitation(self, connection, body, at):
        value = claim_value(body)
        hashed = invite_digest(value["invitation_token"])
        row = connection.execute("SELECT * FROM invitations WHERE token_digest=?", (hashed,)).fetchone()
        if row is None or not secrets.compare_digest(row["token_digest"], hashed):
            raise Problem(403, "INVITATION_UNAVAILABLE")
        state = self._invitation_state(connection, row, at)
        if state not in {"AVAILABLE", "CLAIMED"}:
            raise Problem(403, "INVITATION_UNAVAILABLE")
        fingerprint = claim_fingerprint(value)
        token = claimed_token(value)
        if row["claimed_ms"] is not None:
            if (at >= row["claimed_ms"] + CLAIM_RETRY_MS or not secrets.compare_digest(fingerprint, row["claim_digest"])):
                raise Problem(403, "INVITATION_UNAVAILABLE")
            principal = self._authenticate(connection, token, at)
            if principal["id"] != row["credential_id"] or principal["principal_id"] != row["operator_id"] or principal["role"] != "OPERATOR":
                raise Problem(403, "INVITATION_UNAVAILABLE")
            issued = {"token": token, "credential_id": principal["id"], "role": "OPERATOR",
                      "principal_id": principal["principal_id"], "expires_at_ms": principal["expires_ms"]}
            return 200, {"credential": issued, "replayed": True}
        self._capacity(connection, "operators")
        operator_id = uuid.uuid4().hex
        connection.execute("INSERT INTO operators VALUES (?,?,1,?,?)", (operator_id, value["handle"], at, at))
        issued = self._issue(connection, "OPERATOR", operator_id, at, _token=token)
        connection.execute("UPDATE invitations SET claimed_ms=?,claim_digest=?,operator_id=?,credential_id=? WHERE id=?",
                           (at, fingerprint, operator_id, issued["credential_id"], row["id"]))
        self._event(connection, {"role": "INVITEE", "principal_id": row["id"]}, "INVITATION_CLAIM", row["id"],
                    {"operator_id": operator_id, "credential_id": issued["credential_id"], "claim_digest": fingerprint,
                     "credential_digest": self._row(connection, "credentials", issued["credential_id"])["digest"]}, at)
        return 201, {"credential": issued, "replayed": False}

    def _suspend_access(self, connection, principal, kind, subject_id, action, body, at):
        fields(body, ("reason",))
        reason = text(body["reason"], 512)
        table = "operators" if kind == "OPERATOR" else "agents"
        subject = self._row(connection, table, identifier(subject_id))
        if kind == "OPERATOR":
            self._role(principal, "OWNER")
        elif principal["role"] != "OWNER":
            self._role(principal, "OPERATOR")
            self._manage_agent(principal, subject)
        hold = connection.execute("SELECT * FROM access_holds WHERE kind=? AND subject_id=?", (kind, subject_id)).fetchone()
        if hold and hold["active"] and hold["controller_role"] == "OWNER" and principal["role"] != "OWNER":
            raise Problem(403, "OWNER_SUSPENSION_REQUIRED")
        suspended = action == "suspend"
        if hold is None:
            self._capacity(connection, "access_holds")
            hold_id = uuid.uuid4().hex
            connection.execute("INSERT INTO access_holds VALUES (?,?,?,?,?,?,?,?,?)",
                               (hold_id, kind, subject_id, int(suspended), principal["role"], principal["principal_id"], reason, at, at))
        else:
            hold_id = hold["id"]
            connection.execute("UPDATE access_holds SET active=?,controller_role=?,controller_id=?,reason=?,updated_ms=? WHERE id=?",
                               (int(suspended), principal["role"], principal["principal_id"], reason, at, hold_id))
        connection.execute(f"UPDATE {table} SET active=?,updated_ms=? WHERE id=?", (int(not suspended), at, subject_id))
        if suspended:
            if kind == "AGENT":
                connection.execute("UPDATE forum_credentials SET revoked=1 WHERE agent_id=?", (subject_id,))
            else:
                connection.execute("UPDATE forum_credentials SET revoked=1 WHERE agent_id IN (SELECT id FROM agents WHERE operator_id=?)", (subject_id,))
            connection.execute("UPDATE credentials SET revoked=1 WHERE role=? AND principal_id=?", (kind, subject_id))
            if kind == "OPERATOR":
                connection.execute("UPDATE credentials SET revoked=1 WHERE role='AGENT' AND principal_id IN (SELECT id FROM agents WHERE operator_id=?)", (subject_id,))
            self._jobs_sweep(connection, at)
        self._event(connection, principal, "ACCESS_SUSPEND" if suspended else "ACCESS_RESUME", hold_id,
                    {"kind": kind, "subject_id": subject_id, "reason": reason}, at)
        valid = connection.execute("SELECT 1 FROM credentials WHERE role=? AND principal_id=? AND revoked=0 AND expires_ms>? LIMIT 1",
                                   (kind, subject_id, at)).fetchone() is not None
        return 200, {"id": subject_id, "kind": kind, "suspended": suspended,
                     "credentials_restored": False, "new_credentials_required": not valid}

    def _audit_pilot_access(self, connection):
        for row in connection.execute("SELECT * FROM invitations"):
            identifier(row["id"])
            identifier(row["request_id"])
            creator = self._row(connection, "credentials", row["creator_credential_id"])
            if creator["role"] != "OWNER" or creator["principal_id"] != "owner":
                raise ValueError("invitation creator role")
            matching(row["token_digest"], DIGEST, "INVALID_DIGEST")
            ttl, remaining = divmod(row["expires_ms"] - row["created_ms"], 1000)
            value = invitation_value({"request_id": row["request_id"], "label": row["label"], "ttl_seconds": ttl})
            if remaining or invitation_fingerprint(value) != row["request_digest"]:
                raise ValueError("invitation request mismatch")
            events = connection.execute("SELECT * FROM audit WHERE resource_id=? AND action='INVITATION_CREATE'", (row["id"],)).fetchall()
            if len(events) != 1:
                raise ValueError("invitation creation evidence")
            details = json.loads(events[0]["details"])
            if (events[0]["actor_role"], events[0]["actor_id"], events[0]["at_ms"], details["creator_credential_id"], details["ttl_seconds"], details["request_digest"], details["token_digest"]) != ("OWNER", "owner", row["created_ms"], creator["id"], ttl, row["request_digest"], row["token_digest"]):
                raise ValueError("invitation creation mismatch")
            revocations = connection.execute("SELECT * FROM audit WHERE resource_id=? AND action='INVITATION_REVOKE'", (row["id"],)).fetchall()
            if len(revocations) != row["revoked"] or any(event["actor_role"] != "OWNER" or event["actor_id"] != "owner" for event in revocations):
                raise ValueError("invitation revocation evidence")
            claims = connection.execute("SELECT * FROM audit WHERE resource_id=? AND action='INVITATION_CLAIM'", (row["id"],)).fetchall()
            if len(claims) != int(row["claimed_ms"] is not None):
                raise ValueError("invitation claim count")
            if row["claimed_ms"] is not None:
                matching(row["claim_digest"], DIGEST, "INVALID_DIGEST")
                credential = self._row(connection, "credentials", row["credential_id"])
                if credential["role"] != "OPERATOR" or credential["principal_id"] != row["operator_id"] or credential["created_ms"] != row["claimed_ms"]:
                    raise ValueError("invitation credential scope")
                details = json.loads(claims[0]["details"])
                if (claims[0]["actor_role"], claims[0]["actor_id"], claims[0]["at_ms"], details["operator_id"], details["credential_id"]) != ("INVITEE", row["id"], row["claimed_ms"], row["operator_id"], row["credential_id"]):
                    raise ValueError("invitation claim evidence")
                if details["claim_digest"] != row["claim_digest"] or details["credential_digest"] != credential["digest"]:
                    raise ValueError("invitation credential evidence")
        for row in connection.execute("SELECT * FROM access_holds"):
            identifier(row["id"])
            identifier(row["subject_id"])
            text(row["reason"], 512)
            table = "operators" if row["kind"] == "OPERATOR" else "agents"
            subject = self._row(connection, table, row["subject_id"])
            if row["controller_role"] == "OWNER":
                if row["controller_id"] != "owner":
                    raise ValueError("suspension owner")
            elif row["kind"] != "AGENT" or subject["operator_id"] != row["controller_id"]:
                raise ValueError("suspension operator")
            event = connection.execute("SELECT * FROM audit WHERE resource_id=? AND action IN ('ACCESS_SUSPEND','ACCESS_RESUME') ORDER BY seq DESC LIMIT 1", (row["id"],)).fetchone()
            first = connection.execute("SELECT at_ms FROM audit WHERE resource_id=? AND action IN ('ACCESS_SUSPEND','ACCESS_RESUME') ORDER BY seq LIMIT 1", (row["id"],)).fetchone()
            if first is None or row["created_ms"] != first[0]:
                raise ValueError("suspension creation evidence")
            if event is None or event["action"] != ("ACCESS_SUSPEND" if row["active"] else "ACCESS_RESUME"):
                raise ValueError("suspension action evidence")
            details = json.loads(event["details"])
            if (event["actor_role"], event["actor_id"], event["at_ms"], details["kind"], details["subject_id"], details["reason"]) != (row["controller_role"], row["controller_id"], row["updated_ms"], row["kind"], row["subject_id"], row["reason"]):
                raise ValueError("suspension evidence mismatch")
