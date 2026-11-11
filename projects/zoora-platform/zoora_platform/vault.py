"""Per-agent provider credential vault.

Sealed values are provider API keys. Wallet seeds, browser cookies and session
material are refused. Plaintext keys are not returned, logged or written to jobs.
Usage holds are compute metering, not token balances or earnings. An unknown
provider outcome keeps its single hold and is not reserved again.
"""
import os
from pathlib import Path
import secrets

from nacl.exceptions import CryptoError
from nacl.secret import SecretBox

from zoora_community.validation import Problem, identifier, text

from .providers import PROVIDERS, TOKEN_HOLD


def _request_id(value):
    if (type(value) is not str or not 8 <= len(value) <= 80
            or any(c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-" for c in value)):
        raise Problem(400, "INVALID_REQUEST_ID")
    return value


def _model_name(value):
    value = text(value, 128)
    if any(c.isspace() or c in "/\\?#%" for c in value):
        raise Problem(400, "INVALID_MODEL_NAME")
    return value


def _api_key(value):
    value = text(value, 512, 16)
    if any(c.isspace() or ord(c) < 33 or ord(c) > 126 for c in value):
        raise Problem(400, "VAULT_SECRET_REJECTED")
    lowered = value.lower()
    for marker in ("mnemonic", "seed", "cookie", "session", "browser", "set-cookie"):
        if marker in lowered:
            raise Problem(400, "VAULT_SECRET_REJECTED")
    if len(value) in (64, 128) and all(c in "0123456789abcdefABCDEF" for c in value):
        raise Problem(400, "VAULT_SECRET_REJECTED")
    return value


def metered_tokens(usage):
    if type(usage) is not dict:
        return None
    total = usage.get("total_tokens")
    if type(total) is int and 0 <= total <= 10**9:
        return total
    parts = []
    for key in ("input_tokens", "output_tokens", "prompt_tokens", "completion_tokens"):
        value = usage.get(key)
        if type(value) is int and 0 <= value <= 10**9:
            parts.append(value)
    if not parts:
        return None
    return min(sum(parts), 10**9)


class CallMeter:
    """One job's provider attempts. Replays do not start a second provider call."""

    def __init__(self, vault, grant_id, job_id, principal):
        self.vault, self.grant_id, self.job_id, self.principal = vault, grant_id, job_id, principal
        self.n = 0
        self.last = None
        self.settled = True

    def reserve(self):
        attempt = self.job_id + ":" + str(self.n)
        self.n += 1
        outcome = self.vault.reserve_call(self.grant_id, self.principal, self.job_id, attempt)
        self.last = attempt
        self.settled = bool(outcome["replayed"])
        if outcome["replayed"]:
            raise Problem(409, "PROVIDER_ATTEMPT_ALREADY_BILLED")

    def succeed(self, usage):
        if self.last and not self.settled:
            self.vault.reconcile(self.last, usage)
            self.settled = True

    def fail(self, contacted):
        if self.last is None or self.settled:
            return
        if contacted:
            self.vault.unknown(self.last)
        else:
            self.vault.release(self.last)
        self.settled = True


class Vault:
    def __init__(self, ledger, key_path=None):
        self.ledger = ledger
        self.key_path = Path(key_path) if key_path is not None else Path(ledger.path).parent / "vault.key"
        self.box = SecretBox(self._load_key())

    def _load_key(self):
        path = self.key_path
        if path.is_symlink():
            raise ValueError("unsafe provider vault key")
        if not path.exists():
            descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            try:
                os.write(descriptor, secrets.token_bytes(32))
            finally:
                os.close(descriptor)
        if not path.is_file() or path.is_symlink():
            raise ValueError("unsafe provider vault key")
        if os.name == "posix" and path.stat().st_mode & 0o077:
            raise ValueError("provider vault key must be private")
        key = path.read_bytes()
        if len(key) != 32:
            raise ValueError("provider vault key must be 32 bytes")
        return key

    def _seal(self, api_key):
        return self.box.encrypt(api_key.encode("utf-8")).hex()

    def _open(self, sealed):
        try:
            return self.box.decrypt(bytes.fromhex(sealed)).decode("utf-8")
        except (CryptoError, ValueError, UnicodeError):
            raise Problem(500, "VAULT_SECRET_UNAVAILABLE") from None

    def _same_secret(self, sealed, api_key):
        try:
            current = self._open(sealed).encode("utf-8")
        except Problem:
            return False
        offered = api_key.encode("utf-8")
        if len(current) != len(offered):
            return False
        return secrets.compare_digest(current, offered)

    @staticmethod
    def _owner(actor):
        return type(actor) is str and actor.startswith("OWNER:")

    @staticmethod
    def _credential_view(row):
        return {key: row[key] for key in ("id", "principal", "provider", "model", "label", "state", "created_ms")}

    @staticmethod
    def _grant_view(row):
        return {key: row[key] for key in (
            "id", "credential_id", "grantor", "grantee", "request_budget", "token_budget",
            "initial_request_budget", "initial_token_budget", "ttl_seconds", "expires_ms", "state", "created_ms")}

    @staticmethod
    def _usage_view(row):
        return {key: row[key] for key in ("id", "grant_id", "job_id", "attempt", "state", "token_hold", "observed_tokens", "at_ms")} | {
            "accounting": "NONMONETARY_PROVIDER_METERING", "duplicate_of_attempt": False}

    def summary(self):
        with self.ledger.db() as db:
            credentials = db.execute("SELECT count(*) FROM provider_credentials WHERE state='ACTIVE'").fetchone()[0]
            grants = db.execute("SELECT count(*) FROM provider_grants WHERE state='ACTIVE'").fetchone()[0]
            policy = db.execute("SELECT hourly_request_limit, owner_token_remaining FROM compute_policy WHERE id='host'").fetchone()
        return {"active_credentials": credentials, "active_grants": grants,
                "host_hourly_request_limit": policy["hourly_request_limit"],
                "owner_token_remaining": policy["owner_token_remaining"],
                "secrets_disclosed": False, "accepted_secret_class": "PROVIDER_API_KEY",
                "wallet_seeds_accepted": False}

    def deposit(self, actor, request_id, provider, model, api_key, label):
        request_id = _request_id(request_id)
        if provider not in PROVIDERS:
            raise Problem(400, "UNSUPPORTED_MODEL_PROVIDER")
        model = _model_name(model)
        api_key = _api_key(api_key)
        label = text(label, 64)
        with self.ledger.db(True) as db:
            old = db.execute("SELECT * FROM provider_credentials WHERE principal=? AND request_id=?", (actor, request_id)).fetchone()
            if old:
                if (old["provider"], old["model"], old["label"]) != (provider, model, label) or not self._same_secret(old["sealed"], api_key):
                    raise Problem(409, "PROVIDER_CREDENTIAL_CONFLICT")
                return self._credential_view(old), True
            if db.execute("SELECT count(*) FROM provider_credentials").fetchone()[0] >= 200:
                raise Problem(503, "VAULT_CAPACITY")
            key = secrets.token_hex(16)
            at = self.ledger.clock()
            db.execute("INSERT INTO provider_credentials VALUES(?,?,?,?,?,?,?,'ACTIVE',?)",
                       (key, actor, request_id, provider, model, label, self._seal(api_key), at))
            return self._credential_view(db.execute("SELECT * FROM provider_credentials WHERE id=?", (key,)).fetchone()), False

    def credentials(self, actor):
        with self.ledger.db() as db:
            if self._owner(actor):
                rows = db.execute("SELECT * FROM provider_credentials ORDER BY created_ms DESC LIMIT 100").fetchall()
            else:
                rows = db.execute("SELECT * FROM provider_credentials WHERE principal=? ORDER BY created_ms DESC LIMIT 100", (actor,)).fetchall()
            return [self._credential_view(row) for row in rows]

    def revoke_credential(self, actor, credential_id):
        identifier(credential_id)
        at = self.ledger.clock()
        with self.ledger.db(True) as db:
            row = db.execute("SELECT * FROM provider_credentials WHERE id=?", (credential_id,)).fetchone()
            if row is None or (row["principal"] != actor and not self._owner(actor)):
                raise Problem(404, "PROVIDER_CREDENTIAL_NOT_FOUND")
            db.execute("UPDATE provider_credentials SET state='REVOKED' WHERE id=?", (credential_id,))
            db.execute("UPDATE provider_grants SET state='REVOKED', updated_ms=? WHERE credential_id=? AND state='ACTIVE'", (at, credential_id))
            return self._credential_view(db.execute("SELECT * FROM provider_credentials WHERE id=?", (credential_id,)).fetchone())

    def _visible_credential(self, db, actor, credential_id):
        row = db.execute("SELECT * FROM provider_credentials WHERE id=?", (credential_id,)).fetchone()
        if row is None or (row["principal"] != actor and not self._owner(actor)):
            raise Problem(404, "PROVIDER_CREDENTIAL_NOT_FOUND")
        return row

    def grant(self, actor, request_id, credential_id, grantee, ttl_seconds, request_budget, token_budget):
        request_id = _request_id(request_id)
        identifier(credential_id)
        if type(grantee) is not str or not grantee.startswith("AGENT:"):
            raise Problem(400, "INVALID_GRANT_GRANTEE")
        identifier(grantee.removeprefix("AGENT:"))
        if type(ttl_seconds) is not int or not 60 <= ttl_seconds <= 30 * 86400:
            raise Problem(400, "GRANT_EXPIRY_REJECTED")
        if type(request_budget) is not int or not 1 <= request_budget <= 100:
            raise Problem(400, "GRANT_REQUEST_BUDGET_REJECTED")
        if type(token_budget) is not int or not TOKEN_HOLD <= token_budget <= 1_000_000:
            raise Problem(400, "GRANT_TOKEN_BUDGET_REJECTED")
        with self.ledger.db(True) as db:
            old = db.execute("SELECT * FROM provider_grants WHERE grantor=? AND request_id=?", (actor, request_id)).fetchone()
            if old:
                if (old["credential_id"], old["grantee"], old["ttl_seconds"], old["initial_request_budget"], old["initial_token_budget"]) != (
                        credential_id, grantee, ttl_seconds, request_budget, token_budget):
                    raise Problem(409, "PROVIDER_GRANT_CONFLICT")
                return self._grant_view(old), True
            credential = self._visible_credential(db, actor, credential_id)
            if credential["state"] != "ACTIVE":
                raise Problem(409, "PROVIDER_CREDENTIAL_REVOKED")
            if actor.startswith("AGENT:") and grantee != actor:
                raise Problem(403, "PROVIDER_SELF_GRANT_ONLY")
            if credential["principal"] != actor and grantee != credential["principal"]:
                raise Problem(403, "PROVIDER_GRANT_REASSIGNMENT_FORBIDDEN")
            if not actor.startswith("AGENT:") and not self._owner(actor):
                raise Problem(403, "PROVIDER_GRANT_FORBIDDEN")
            if db.execute("SELECT count(*) FROM provider_grants").fetchone()[0] >= 500:
                raise Problem(503, "VAULT_CAPACITY")
            at = self.ledger.clock()
            key = secrets.token_hex(16)
            db.execute("""INSERT INTO provider_grants VALUES(?,?,?,?,?,?,?,?,?,?,?,'ACTIVE',?,?)""", (
                key, credential_id, actor, grantee, request_id, request_budget, token_budget,
                request_budget, token_budget, ttl_seconds, at + ttl_seconds * 1000, at, at))
            return self._grant_view(db.execute("SELECT * FROM provider_grants WHERE id=?", (key,)).fetchone()), False

    def grants(self, actor):
        with self.ledger.db() as db:
            if self._owner(actor):
                rows = db.execute("SELECT * FROM provider_grants ORDER BY created_ms DESC LIMIT 100").fetchall()
            else:
                rows = db.execute("SELECT * FROM provider_grants WHERE grantee=? OR grantor=? ORDER BY created_ms DESC LIMIT 100", (actor, actor)).fetchall()
            return [self._grant_view(row) for row in rows]

    def revoke_grant(self, actor, grant_id):
        identifier(grant_id)
        at = self.ledger.clock()
        with self.ledger.db(True) as db:
            row = db.execute("SELECT * FROM provider_grants WHERE id=?", (grant_id,)).fetchone()
            if row is None or (row["grantor"] != actor and row["grantee"] != actor and not self._owner(actor)):
                raise Problem(404, "PROVIDER_GRANT_NOT_FOUND")
            db.execute("UPDATE provider_grants SET state='REVOKED', updated_ms=? WHERE id=?", (at, grant_id))
            return self._grant_view(db.execute("SELECT * FROM provider_grants WHERE id=?", (grant_id,)).fetchone())

    def only_grant(self, actor):
        active = [row for row in self.grants(actor) if row["grantee"] == actor and row["state"] == "ACTIVE" and row["expires_ms"] > self.ledger.clock()]
        if not active:
            raise Problem(403, "PROVIDER_GRANT_REQUIRED")
        if len(active) > 1:
            raise Problem(400, "GRANT_ID_REQUIRED")
        return active[0]["id"]

    def _load_grant(self, db, grant_id, actor):
        identifier(grant_id)
        row = db.execute("SELECT * FROM provider_grants WHERE id=?", (grant_id,)).fetchone()
        if row is None or row["grantee"] != actor:
            raise Problem(403, "PROVIDER_GRANT_FORBIDDEN")
        return row

    def assert_usable(self, grant_id, actor):
        expired = False
        with self.ledger.db(True) as db:
            row = self._load_grant(db, grant_id, actor)
            credential = db.execute("SELECT state FROM provider_credentials WHERE id=?", (row["credential_id"],)).fetchone()
            if row["state"] == "REVOKED" or credential is None or credential["state"] != "ACTIVE":
                raise Problem(403, "PROVIDER_GRANT_REVOKED")
            if row["state"] == "EXPIRED" or row["expires_ms"] <= self.ledger.clock():
                if row["state"] == "ACTIVE":
                    db.execute("UPDATE provider_grants SET state='EXPIRED', updated_ms=? WHERE id=?", (self.ledger.clock(), grant_id))
                expired = True
            elif row["state"] != "ACTIVE" or row["request_budget"] < 1 or row["token_budget"] < TOKEN_HOLD:
                raise Problem(429, "PROVIDER_BUDGET_EXHAUSTED")
        if expired:
            raise Problem(403, "PROVIDER_GRANT_EXPIRED")

    def credential_for(self, grant_id, actor):
        self.assert_usable(grant_id, actor)
        with self.ledger.db() as db:
            row = self._load_grant(db, grant_id, actor)
            credential = db.execute("SELECT * FROM provider_credentials WHERE id=?", (row["credential_id"],)).fetchone()
            if credential is None or credential["state"] != "ACTIVE":
                raise Problem(403, "PROVIDER_GRANT_REVOKED")
            return {"provider": credential["provider"], "model": credential["model"], "api_key": self._open(credential["sealed"])}

    def reserve_call(self, grant_id, actor, job_id, attempt):
        if type(attempt) is not str or not 1 <= len(attempt) <= 80:
            raise Problem(400, "INVALID_PROVIDER_ATTEMPT")
        identifier(job_id)
        expired = False
        reserved = None
        with self.ledger.db(True) as db:
            existing = db.execute("SELECT * FROM provider_usage WHERE attempt=?", (attempt,)).fetchone()
            if existing:
                reserved = {"state": existing["state"], "replayed": True}
            elif db.execute("SELECT count(*) FROM provider_usage").fetchone()[0] >= 10000:
                raise Problem(503, "MODEL_METERING_CAPACITY")
            else:
                grant = None
                if grant_id is not None:
                    grant = self._load_grant(db, grant_id, actor)
                    credential = db.execute("SELECT state FROM provider_credentials WHERE id=?", (grant["credential_id"],)).fetchone()
                    if grant["state"] != "ACTIVE" or credential is None or credential["state"] != "ACTIVE":
                        raise Problem(403, "PROVIDER_GRANT_REVOKED")
                    if grant["expires_ms"] <= self.ledger.clock():
                        db.execute("UPDATE provider_grants SET state='EXPIRED', updated_ms=? WHERE id=? AND state='ACTIVE'", (self.ledger.clock(), grant_id))
                        expired = True
                    elif grant["request_budget"] < 1 or grant["token_budget"] < TOKEN_HOLD:
                        raise Problem(429, "PROVIDER_BUDGET_EXHAUSTED")
                else:
                    remaining = db.execute("SELECT owner_token_remaining FROM compute_policy WHERE id='host'").fetchone()[0]
                    if remaining < TOKEN_HOLD:
                        raise Problem(429, "OWNER_TOKEN_BUDGET_EXHAUSTED")
                if not expired:
                    host_id = self.ledger._insert_host_request(db)
                    at = self.ledger.clock()
                    if grant is not None:
                        remaining_requests = grant["request_budget"] - 1
                        state = "ACTIVE" if remaining_requests else "EXHAUSTED"
                        db.execute("UPDATE provider_grants SET request_budget=?, token_budget=token_budget-?, state=?, updated_ms=? WHERE id=?",
                                   (remaining_requests, TOKEN_HOLD, state, at, grant_id))
                    else:
                        db.execute("UPDATE compute_policy SET owner_token_remaining=owner_token_remaining-? WHERE id='host'", (TOKEN_HOLD,))
                    usage_id = secrets.token_hex(16)
                    db.execute("INSERT INTO provider_usage VALUES(?,?,?,?, 'RESERVED', ?, NULL, ?, ?)",
                               (usage_id, grant_id, job_id, attempt, TOKEN_HOLD, host_id, at))
                    reserved = {"state": "RESERVED", "replayed": False}
        if expired:
            raise Problem(403, "PROVIDER_GRANT_EXPIRED")
        return reserved

    def _usage_row(self, db, attempt):
        row = db.execute("SELECT * FROM provider_usage WHERE attempt=?", (attempt,)).fetchone()
        if row is None:
            raise Problem(404, "PROVIDER_USAGE_NOT_FOUND")
        return row

    def _refund_tokens(self, db, row, refund):
        if refund <= 0:
            return
        if row["grant_id"] is None:
            db.execute("UPDATE compute_policy SET owner_token_remaining=MIN(1000000, owner_token_remaining+?) WHERE id='host'", (refund,))
            return
        db.execute("UPDATE provider_grants SET token_budget=MIN(initial_token_budget, token_budget+?), updated_ms=? WHERE id=?",
                   (refund, self.ledger.clock(), row["grant_id"]))

    def reconcile(self, attempt, usage):
        observed = metered_tokens(usage)
        with self.ledger.db(True) as db:
            row = self._usage_row(db, attempt)
            if row["state"] == "RECONCILED":
                return self._usage_view(row)
            if row["state"] not in ("RESERVED", "UNKNOWN"):
                raise Problem(409, "PROVIDER_USAGE_CLOSED")
            charged = row["token_hold"] if observed is None else min(observed, row["token_hold"])
            self._refund_tokens(db, row, row["token_hold"] - charged)
            db.execute("UPDATE provider_usage SET state='RECONCILED', observed_tokens=? WHERE attempt=?", (charged, attempt))
            return self._usage_view(db.execute("SELECT * FROM provider_usage WHERE attempt=?", (attempt,)).fetchone())

    def unknown(self, attempt):
        with self.ledger.db(True) as db:
            row = self._usage_row(db, attempt)
            if row["state"] in ("UNKNOWN", "RECONCILED"):
                return self._usage_view(row)
            if row["state"] != "RESERVED":
                raise Problem(409, "PROVIDER_USAGE_CLOSED")
            db.execute("UPDATE provider_usage SET state='UNKNOWN' WHERE attempt=?", (attempt,))
            return self._usage_view(db.execute("SELECT * FROM provider_usage WHERE attempt=?", (attempt,)).fetchone())

    def release(self, attempt):
        with self.ledger.db(True) as db:
            row = self._usage_row(db, attempt)
            if row["state"] != "RESERVED":
                return self._usage_view(row)
            self._refund_tokens(db, row, row["token_hold"])
            if row["grant_id"] is not None:
                grant = db.execute("SELECT * FROM provider_grants WHERE id=?", (row["grant_id"],)).fetchone()
                if grant is not None and grant["state"] in ("ACTIVE", "EXHAUSTED"):
                    requests = min(grant["initial_request_budget"], grant["request_budget"] + 1)
                    state = "ACTIVE" if requests and grant["expires_ms"] > self.ledger.clock() else grant["state"]
                    db.execute("UPDATE provider_grants SET request_budget=?, state=?, updated_ms=? WHERE id=?",
                               (requests, state, self.ledger.clock(), grant["id"]))
            if row["host_request_id"]:
                db.execute("DELETE FROM model_requests WHERE id=?", (row["host_request_id"],))
            db.execute("UPDATE provider_usage SET state='RELEASED' WHERE attempt=?", (attempt,))
            return self._usage_view(db.execute("SELECT * FROM provider_usage WHERE attempt=?", (attempt,)).fetchone())

    def usage(self, actor):
        with self.ledger.db() as db:
            if self._owner(actor):
                rows = db.execute("SELECT * FROM provider_usage ORDER BY at_ms DESC LIMIT 100").fetchall()
            else:
                rows = db.execute("""SELECT provider_usage.* FROM provider_usage
                    JOIN provider_grants ON provider_grants.id=provider_usage.grant_id
                    WHERE provider_grants.grantee=? OR provider_grants.grantor=?
                    ORDER BY provider_usage.at_ms DESC LIMIT 100""", (actor, actor)).fetchall()
            return [self._usage_view(row) for row in rows]

    def set_budget(self, actor, hourly_request_limit, owner_token_budget):
        if not self._owner(actor):
            raise Problem(403, "OWNER_BUDGET_REQUIRED")
        if type(hourly_request_limit) is not int or not 1 <= hourly_request_limit <= 20:
            raise Problem(400, "HOST_REQUEST_BUDGET_REJECTED")
        if type(owner_token_budget) is not int or not 0 <= owner_token_budget <= 1_000_000:
            raise Problem(400, "OWNER_TOKEN_BUDGET_REJECTED")
        with self.ledger.db(True) as db:
            db.execute("UPDATE compute_policy SET hourly_request_limit=?, owner_token_remaining=? WHERE id='host'",
                       (hourly_request_limit, owner_token_budget))
            row = db.execute("SELECT hourly_request_limit, owner_token_remaining FROM compute_policy WHERE id='host'").fetchone()
        return {"host_hourly_request_limit": row["hourly_request_limit"], "owner_token_remaining": row["owner_token_remaining"],
                "secrets_disclosed": False}

    def meter(self, grant_id, job_id, principal):
        return CallMeter(self, grant_id, job_id, principal)
