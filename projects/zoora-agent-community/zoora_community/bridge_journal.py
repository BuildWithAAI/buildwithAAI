"""Host-operator-owned sandbox journal; deliberately separate from synthetic budgets."""

from contextlib import closing, contextmanager
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import time
import uuid

from .bridge_sandbox import body_value, intent_value, provider_id, sha, transfer_body
from .validation import DIGEST, Problem, canonical, fields, identifier, matching

RETRY_MS = 23 * 60 * 60 * 1000  # conservative margin inside documented 24-hour guarantee
LEASE_MS = 60_000
MAX_INTENTS = 64
MAX_ATTEMPTS = 32
ERROR = re.compile(r"BRIDGE_[A-Z0-9_]{1,80}\Z")
DDL = """CREATE TABLE intents (
 id TEXT PRIMARY KEY, intent_json TEXT NOT NULL, body_json TEXT NOT NULL,
 body_sha256 TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
 created_ms INTEGER NOT NULL, credential_sha256 TEXT);
 CREATE TABLE attempts (
 id TEXT PRIMARY KEY, intent_id TEXT NOT NULL REFERENCES intents(id),
 sequence INTEGER NOT NULL, kind TEXT NOT NULL, started_ms INTEGER NOT NULL,
 finished_ms INTEGER, observation_json TEXT, error_code TEXT,
 UNIQUE(intent_id,sequence));
 PRAGMA user_version=1;"""


class BridgeJournal:
    def __init__(self, state, *, clock=None):
        self.state = Path(state).absolute()
        self.path = self.state / "bridge-sandbox.sqlite3"
        self.clock = clock or (lambda: time.time_ns() // 1_000_000)

    def _clock(self):
        value = self.clock()
        if type(value) is not int or not 0 <= value < 2**63:
            raise Problem(503, "BRIDGE_CLOCK_REJECTED")
        return value

    @contextmanager
    def _connection(self):
        self.state.mkdir(mode=0o700, exist_ok=True)
        info = self.state.lstat()
        if not stat.S_ISDIR(info.st_mode) or os.name == "posix" and stat.S_IMODE(info.st_mode) & 0o077:
            raise Problem(400, "BRIDGE_PRIVATE_DIRECTORY_REQUIRED")
        try:
            descriptor = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_NOFOLLOW", 0), 0o600)
        except FileExistsError:
            pass
        else:
            os.close(descriptor)
        info = self.path.lstat()
        if (not stat.S_ISREG(info.st_mode) or info.st_size > 8 * 1024 * 1024
                or os.name == "posix" and stat.S_IMODE(info.st_mode) & 0o077):
            raise Problem(400, "BRIDGE_UNSAFE_JOURNAL")
        try:
            with closing(sqlite3.connect(self.path, timeout=5, autocommit=True)) as connection:
                connection.row_factory = sqlite3.Row
                connection.setconfig(sqlite3.SQLITE_DBCONFIG_DEFENSIVE, True)
                connection.setconfig(sqlite3.SQLITE_DBCONFIG_ENABLE_LOAD_EXTENSION, False)
                connection.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, 65_536)
                connection.setlimit(sqlite3.SQLITE_LIMIT_SQL_LENGTH, 8192)
                connection.setlimit(sqlite3.SQLITE_LIMIT_ATTACHED, 0)
                connection.execute("PRAGMA trusted_schema=OFF")
                connection.execute("PRAGMA foreign_keys=ON")
                connection.execute("PRAGMA synchronous=FULL")
                connection.execute("BEGIN IMMEDIATE")
                try:
                    version = connection.execute("PRAGMA user_version").fetchone()[0]
                    if version == 0:
                        if connection.execute("SELECT COUNT(*) FROM sqlite_master").fetchone()[0]:
                            raise Problem(503, "BRIDGE_JOURNAL_SCHEMA_REJECTED")
                        for statement in DDL.split(";"):
                            if statement.strip():
                                connection.execute(statement)
                    elif version != 1:
                        raise Problem(503, "BRIDGE_JOURNAL_SCHEMA_REJECTED")
                    yield connection
                    connection.execute("COMMIT")
                except BaseException:
                    connection.execute("ROLLBACK")
                    raise
        except sqlite3.Error:
            raise Problem(503, "BRIDGE_JOURNAL_UNAVAILABLE") from None

    def _load(self, connection, request_id):
        row = connection.execute("SELECT * FROM intents WHERE id=?", (identifier(request_id),)).fetchone()
        if row is None:
            raise Problem(404, "BRIDGE_INTENT_NOT_FOUND")
        try:
            intent = intent_value(json.loads(row["intent_json"]))
            body = body_value(json.loads(row["body_json"]))
            if (type(row["created_ms"]) is not int or not 0 <= row["created_ms"] < 2**63
                    or intent["request_id"] != row["id"] or transfer_body(intent, row["idempotency_key"]) != body
                    or row["body_sha256"] != sha(body)):
                raise ValueError("intent binding")
            attempts = connection.execute("SELECT * FROM attempts WHERE intent_id=? ORDER BY sequence", (row["id"],)).fetchall()
            if len(attempts) > MAX_ATTEMPTS:
                raise ValueError("attempt count")
            known, last_time = None, row["created_ms"]
            if attempts:
                matching(row["credential_sha256"], DIGEST, "INVALID_DIGEST")
            elif row["credential_sha256"] is not None:
                raise ValueError("unexpected credential")
            for sequence, attempt in enumerate(attempts, 1):
                identifier(attempt["id"])
                if (attempt["sequence"] != sequence or attempt["kind"] != ("POLL" if known else "CREATE")
                        or type(attempt["started_ms"]) is not int or attempt["started_ms"] < last_time):
                    raise ValueError("attempt ordering")
                last_time = attempt["started_ms"]
                if attempt["finished_ms"] is None:
                    if attempt["observation_json"] is not None or attempt["error_code"] is not None:
                        raise ValueError("unfinished observation")
                    continue
                if type(attempt["finished_ms"]) is not int or attempt["finished_ms"] < last_time:
                    raise ValueError("completion ordering")
                last_time = attempt["finished_ms"]
                if attempt["error_code"]:
                    matching(attempt["error_code"], ERROR, "INVALID_BRIDGE_ERROR")
                    if attempt["observation_json"] is not None:
                        raise ValueError("mixed completion")
                else:
                    value = json.loads(attempt["observation_json"])
                    fields(value, ("id", "state", "body_sha256", "response_sha256"))
                    provider_id(value["id"])
                    matching(value["state"], re.compile(r"[a-z][a-z0-9_]{0,47}\Z"), "INVALID_BRIDGE_STATE")
                    matching(value["response_sha256"], DIGEST, "INVALID_DIGEST")
                    if value["body_sha256"] != row["body_sha256"] or known and known["id"] != value["id"]:
                        raise ValueError("observation binding")
                    known = value
            return row, body, attempts, known, last_time
        except (Problem, ValueError, KeyError, TypeError, UnicodeError, RecursionError):
            raise Problem(503, "BRIDGE_JOURNAL_CONSISTENCY_FAILURE") from None

    @staticmethod
    def _view(row, body, attempts, known, last_time):
        return {"request_id": row["id"], "body": body, "body_sha256": row["body_sha256"],
                "idempotency_key": row["idempotency_key"], "attempts": len(attempts),
                "state": "PREPARED" if not attempts else "OBSERVED" if attempts[-1]["observation_json"] else "UNKNOWN",
                "observation": known, "last_attempt_error": attempts[-1]["error_code"] if attempts else None,
                "observation_at_ms": next((a["finished_ms"] for a in reversed(attempts) if a["observation_json"]), None),
                "incomplete_attempt": bool(attempts and attempts[-1]["finished_ms"] is None),
                "last_recorded_ms": last_time, "first_attempt_ms": attempts[0]["started_ms"] if attempts else None,
                "retry_before_ms": attempts[0]["started_ms"] + RETRY_MS if attempts and not known else None,
                "classification": "BRIDGE_SANDBOX_ONLY", "provider_account_verified": False,
                "production_execution": False, "wallet_execution": False,
                "commerce_budget_integration": False, "settlement_accounting": "UNAVAILABLE"}

    def prepare(self, value):
        intent = intent_value(value)
        at = self._clock()
        with self._connection() as connection:
            row = connection.execute("SELECT * FROM intents WHERE id=?", (intent["request_id"],)).fetchone()
            if row:
                self._load(connection, intent["request_id"])
                if json.loads(row["intent_json"]) != intent:
                    raise Problem(409, "BRIDGE_INTENT_CONFLICT")
            else:
                if connection.execute("SELECT COUNT(*) FROM intents").fetchone()[0] >= MAX_INTENTS:
                    raise Problem(409, "BRIDGE_INTENT_LIMIT")
                key = str(uuid.uuid4())
                body = transfer_body(intent, key)
                connection.execute("INSERT INTO intents VALUES (?,?,?,?,?,?,NULL)",
                    (intent["request_id"], canonical(intent), canonical(body), sha(body), key, at))
            return self._view(*self._load(connection, intent["request_id"]))

    def show(self, request_id):
        with self._connection() as connection:
            return self._view(*self._load(connection, request_id))

    def advance(self, request_id, client):
        # Claim and commit before any HTTP. Never hold a SQLite transaction across the network.
        at = self._clock()
        with self._connection() as connection:
            row, body, attempts, known, last_time = self._load(connection, request_id)
            if at < last_time:
                raise Problem(409, "BRIDGE_CLOCK_REGRESSION")
            if row["credential_sha256"] not in (None, client.credential_fingerprint):
                raise Problem(409, "BRIDGE_CREDENTIAL_CHANGED_RECONCILE_REQUIRED")
            if attempts and attempts[-1]["finished_ms"] is None and at < attempts[-1]["started_ms"] + LEASE_MS:
                raise Problem(409, "BRIDGE_ATTEMPT_BUSY")
            if not known and attempts and at >= attempts[0]["started_ms"] + RETRY_MS:
                raise Problem(409, "BRIDGE_RETRY_WINDOW_CLOSED_RECONCILE_REQUIRED")
            if len(attempts) >= MAX_ATTEMPTS:
                raise Problem(409, "BRIDGE_ATTEMPT_LIMIT")
            attempt_id, kind = uuid.uuid4().hex, "POLL" if known else "CREATE"
            connection.execute("UPDATE intents SET credential_sha256=? WHERE id=?", (client.credential_fingerprint, request_id))
            connection.execute("INSERT INTO attempts VALUES (?,?,?,?,?,NULL,NULL,NULL)",
                               (attempt_id, request_id, len(attempts) + 1, kind, at))
            key, transfer_id = row["idempotency_key"], known["id"] if known else None
        result, error = None, None
        try:
            result = client.poll(transfer_id, body) if transfer_id else client.create(body, key)
            # Revalidate the complete observation before durable acceptance, even with a substituted client.
            fields(result, ("id", "state", "body_sha256", "response_sha256"))
            provider_id(result["id"])
            matching(result["state"], re.compile(r"[a-z][a-z0-9_]{0,47}\Z"), "INVALID_BRIDGE_STATE")
            matching(result["response_sha256"], DIGEST, "INVALID_DIGEST")
            if result["body_sha256"] != sha(body) or transfer_id and transfer_id != result["id"]:
                raise Problem(502, "BRIDGE_RESPONSE_REJECTED")
        except Problem as problem:
            error = problem.code if ERROR.fullmatch(problem.code) else "BRIDGE_RESPONSE_REJECTED"
            result = None
        finished = self._clock()
        if finished < at:
            raise Problem(409, "BRIDGE_CLOCK_REGRESSION")
        with self._connection() as connection:
            loaded = self._load(connection, request_id)
            if loaded[2][-1]["id"] != attempt_id:
                raise Problem(409, "BRIDGE_STALE_ATTEMPT")
            connection.execute("UPDATE attempts SET finished_ms=?,observation_json=?,error_code=? WHERE id=?",
                               (finished, canonical(result) if result else None, error, attempt_id))
            return self._view(*self._load(connection, request_id))
