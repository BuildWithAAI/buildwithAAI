"""Durable, principal-scoped work with idempotency and fenced completion.

Work reservations are resource limits. They are never token balances or earnings.
An interrupted external request is not automatically retried or rebilled.
"""
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import secrets
import sqlite3
import time

from zoora_community.validation import Problem, canonical


def stamp():
    return int(time.time() * 1000)


class Ledger:
    def __init__(self, path, clock=stamp):
        self.path, self.clock = Path(path), clock
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        if self.path.is_symlink() or (self.path.exists() and not self.path.is_file()):
            raise ValueError("unsafe platform ledger")
        if not self.path.exists():
            descriptor = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            os.close(descriptor)
        if os.name == "posix" and self.path.stat().st_mode & 0o077:
            raise ValueError("platform ledger must be private")
        with self.db() as db:
            version = db.execute("PRAGMA user_version").fetchone()[0]
            if version not in (0, 1, 2, 3):
                raise ValueError("unsupported platform schema")
            if version == 0:
                db.executescript("""
                CREATE TABLE jobs(
                  id TEXT PRIMARY KEY, principal TEXT NOT NULL, request_id TEXT NOT NULL,
                  fingerprint TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL,
                  state TEXT NOT NULL CHECK(state IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED')),
                  created_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL,
                  lease_token TEXT, lease_until_ms INTEGER, result TEXT, error TEXT,
                  UNIQUE(principal,request_id));
                CREATE TABLE events(seq INTEGER PRIMARY KEY, job_id TEXT NOT NULL,
                  at_ms INTEGER NOT NULL, action TEXT NOT NULL, digest TEXT NOT NULL);
                CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
                CREATE INDEX jobs_queue ON jobs(state,created_ms);
                PRAGMA user_version=1;
                """)
            if version in (0, 1):
                db.executescript("""
                CREATE TABLE payments(id TEXT PRIMARY KEY,request_id TEXT UNIQUE NOT NULL,
                  payer TEXT NOT NULL,quote TEXT NOT NULL,message TEXT NOT NULL,
                  state TEXT NOT NULL,signature TEXT UNIQUE,receipt TEXT,error TEXT,
                  created_ms INTEGER NOT NULL,updated_ms INTEGER NOT NULL);
                PRAGMA user_version=2;
                """)
            if version in (0, 1, 2):
                db.executescript("""
                CREATE TABLE schedules(id TEXT PRIMARY KEY,principal TEXT NOT NULL,
                  request_id TEXT NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,
                  interval_seconds INTEGER NOT NULL,remaining INTEGER NOT NULL,initial_runs INTEGER NOT NULL,
                  next_ms INTEGER NOT NULL,state TEXT NOT NULL,UNIQUE(principal,request_id));
                CREATE TABLE model_requests(id TEXT PRIMARY KEY,at_ms INTEGER NOT NULL);
                PRAGMA user_version=3;
                """)

    @contextmanager
    def db(self, write=False):
        db = sqlite3.connect(self.path, timeout=5, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA busy_timeout=5000")
        try:
            if write:
                db.execute("BEGIN IMMEDIATE")
            yield db
            if write:
                db.execute("COMMIT")
        except BaseException:
            if db.in_transaction:
                db.execute("ROLLBACK")
            raise
        finally:
            db.close()

    def event(self, db, job, action, at):
        digest = hashlib.sha256(canonical(dict(job_id=job, action=action, at_ms=at)).encode()).hexdigest()
        db.execute("INSERT INTO events(job_id,at_ms,action,digest) VALUES(?,?,?,?)", (job, at, action, digest))

    @staticmethod
    def view(row):
        value = {k: row[k] for k in ("id", "principal", "request_id", "kind", "state", "created_ms", "updated_ms", "error")}
        value["result"] = json.loads(row["result"]) if row["result"] else None
        value["accounting"] = "NONMONETARY_WORK"
        return value

    def submit(self, principal, request_id, kind, payload):
        if (type(request_id) is not str or not 8 <= len(request_id) <= 80
                or any(c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-" for c in request_id)):
            raise Problem(400, "INVALID_REQUEST_ID")
        raw = canonical(payload)
        if len(raw.encode()) > 12000:
            raise Problem(413, "JOB_INPUT_TOO_LARGE")
        logical = {k: v for k, v in payload.items() if k != "_authority"}
        fingerprint = hashlib.sha256(canonical({"kind": kind, "payload": logical}).encode()).hexdigest()
        at = self.clock()
        with self.db(True) as db:
            old = db.execute("SELECT * FROM jobs WHERE principal=? AND request_id=?", (principal, request_id)).fetchone()
            if old:
                if old["fingerprint"] != fingerprint:
                    raise Problem(409, "IDEMPOTENCY_CONFLICT")
                return self.view(old), True
            count = db.execute("SELECT count(*) FROM jobs WHERE principal=? AND created_ms>?", (principal, at - 3600000)).fetchone()[0]
            if count >= 20:
                raise Problem(429, "HOURLY_WORK_LIMIT")
            if kind.startswith("agent.") and db.execute("SELECT count(*) FROM jobs WHERE kind IN ('agent.generate','agent.work') AND created_ms>?", (at - 3600000,)).fetchone()[0] >= 20:
                raise Problem(429, "HOST_MODEL_HOURLY_LIMIT")
            if db.execute("SELECT count(*) FROM jobs").fetchone()[0] >= 10000:
                raise Problem(503, "LEDGER_CAPACITY_REACHED")
            if db.execute("SELECT count(*) FROM jobs WHERE state IN ('QUEUED','RUNNING')").fetchone()[0] >= 128:
                raise Problem(503, "WORK_QUEUE_FULL")
            job = secrets.token_hex(16)
            db.execute("INSERT INTO jobs(id,principal,request_id,fingerprint,kind,payload,state,created_ms,updated_ms) VALUES(?,?,?,?,?,?,'QUEUED',?,?)", (job, principal, request_id, fingerprint, kind, raw, at, at))
            self.event(db, job, "QUEUED", at)
            return self.view(db.execute("SELECT * FROM jobs WHERE id=?", (job,)).fetchone()), False

    def list(self, principal, owner=False):
        with self.db() as db:
            rows = db.execute("SELECT * FROM jobs " + ("" if owner else "WHERE principal=? ") + "ORDER BY created_ms DESC,id DESC LIMIT 100", () if owner else (principal,)).fetchall()
            values = []
            for row in rows:
                value = self.view(row)
                value["has_result"] = value["result"] is not None
                value["result"] = None
                values.append(value)
            return values

    def get(self, job_id, principal, owner=False):
        with self.db() as db:
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            if row is None or (not owner and row["principal"] != principal):
                raise Problem(404, "JOB_NOT_FOUND")
            return self.view(row)

    def cancel(self, job_id, principal, owner=False):
        with self.db(True) as db:
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            if row is None or (not owner and row["principal"] != principal):
                raise Problem(404, "JOB_NOT_FOUND")
            if row["state"] != "QUEUED":
                raise Problem(409, "ONLY_QUEUED_WORK_CAN_BE_CANCELLED")
            at = self.clock()
            db.execute("UPDATE jobs SET state='CANCELLED',updated_ms=? WHERE id=?", (at, job_id))
            self.event(db, job_id, "CANCELLED", at)
            return self.view(db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone())

    def claim(self):
        at = self.clock()
        with self.db(True) as db:
            for row in db.execute("SELECT id FROM jobs WHERE state='RUNNING' AND lease_until_ms<=?", (at,)).fetchall():
                db.execute("UPDATE jobs SET state='FAILED',error='WORKER_INTERRUPTED_NO_AUTOMATIC_RETRY',updated_ms=? WHERE id=?", (at, row["id"]))
                self.event(db, row["id"], "INTERRUPTED", at)
            row = db.execute("SELECT * FROM jobs WHERE state='QUEUED' ORDER BY created_ms,id LIMIT 1").fetchone()
            if row is None:
                return None
            token = secrets.token_hex(32)
            db.execute("UPDATE jobs SET state='RUNNING',updated_ms=?,lease_token=?,lease_until_ms=? WHERE id=?", (at, token, at + 180000, row["id"]))
            self.event(db, row["id"], "CLAIMED", at)
            return dict(db.execute("SELECT * FROM jobs WHERE id=?", (row["id"],)).fetchone())

    def complete(self, job, result=None, error=None):
        at = self.clock()
        raw = None if result is None else canonical(result)
        if raw is not None and len(raw.encode()) > 500000:
            error, raw = "JOB_OUTPUT_TOO_LARGE", None
        with self.db(True) as db:
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job["id"],)).fetchone()
            if (row is None or row["state"] != "RUNNING" or row["lease_token"] != job["lease_token"]
                    or row["lease_until_ms"] <= at):
                raise Problem(409, "STALE_WORKER_COMPLETION")
            state = "FAILED" if error else "SUCCEEDED"
            db.execute("UPDATE jobs SET state=?,result=?,error=?,updated_ms=? WHERE id=?", (state, raw, error, at, job["id"]))
            self.event(db, job["id"], state, at)

    def heartbeat(self):
        with self.db(True) as db:
            db.execute("INSERT INTO metadata VALUES('worker_heartbeat',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (str(self.clock()),))

    def reserve_model_request(self):
        with self.db(True) as db:
            at = self.clock()
            if db.execute("SELECT count(*) FROM model_requests WHERE at_ms>?", (at - 3600000,)).fetchone()[0] >= 20:
                raise Problem(429, "HOST_MODEL_REQUEST_BUDGET_EXHAUSTED")
            if db.execute("SELECT count(*) FROM model_requests").fetchone()[0] >= 10000:
                raise Problem(503, "MODEL_METERING_CAPACITY")
            db.execute("INSERT INTO model_requests VALUES(?,?)", (secrets.token_hex(16), at))

    def schedule(self, principal, request_id, kind, payload, interval_seconds, max_runs):
        if type(interval_seconds) is not int or not 60 <= interval_seconds <= 86400:
            raise Problem(400, "SCHEDULE_INTERVAL_REJECTED")
        if type(max_runs) is not int or not 1 <= max_runs <= 100:
            raise Problem(400, "SCHEDULE_RUN_BUDGET_REJECTED")
        if type(request_id) is not str or not 8 <= len(request_id) <= 80:
            raise Problem(400, "INVALID_REQUEST_ID")
        raw = canonical(payload)
        if len(raw.encode()) > 12000:
            raise Problem(413, "JOB_INPUT_TOO_LARGE")
        with self.db(True) as db:
            old = db.execute("SELECT * FROM schedules WHERE principal=? AND request_id=?", (principal, request_id)).fetchone()
            if old:
                if (old["kind"], old["payload"], old["interval_seconds"], old["initial_runs"]) != (kind, raw, interval_seconds, max_runs):
                    raise Problem(409, "SCHEDULE_REQUEST_CONFLICT")
                return self.schedule_view(old)
            if db.execute("SELECT count(*) FROM schedules").fetchone()[0] >= 128:
                raise Problem(503, "SCHEDULE_CAPACITY")
            key = secrets.token_hex(16)
            db.execute("INSERT INTO schedules VALUES(?,?,?,?,?,?,?,?,?, 'ACTIVE')", (key, principal, request_id, kind, raw, interval_seconds, max_runs, max_runs, self.clock()))
            return self.schedule_view(db.execute("SELECT * FROM schedules WHERE id=?", (key,)).fetchone())

    @staticmethod
    def schedule_view(row):
        return {k: row[k] for k in ("id", "principal", "kind", "interval_seconds", "remaining", "initial_runs", "next_ms", "state")}

    def schedules(self, principal, owner=False):
        with self.db() as db:
            rows = db.execute("SELECT * FROM schedules" + ("" if owner else " WHERE principal=?") + " ORDER BY next_ms LIMIT 128", () if owner else (principal,)).fetchall()
            return [self.schedule_view(row) for row in rows]

    def cancel_schedule(self, key, principal, owner=False):
        with self.db(True) as db:
            row = db.execute("SELECT * FROM schedules WHERE id=?", (key,)).fetchone()
            if row is None or (not owner and row["principal"] != principal):
                raise Problem(404, "SCHEDULE_NOT_FOUND")
            db.execute("UPDATE schedules SET state='CANCELLED' WHERE id=?", (key,))
            return self.schedule_view(db.execute("SELECT * FROM schedules WHERE id=?", (key,)).fetchone())

    def tick(self, authorize):
        at = self.clock()
        with self.db(True) as db:
            row = db.execute("SELECT * FROM schedules WHERE state='ACTIVE' AND next_ms<=? ORDER BY next_ms,id LIMIT 1", (at,)).fetchone()
            if row is None:
                return
            payload = json.loads(row["payload"])
            try:
                principal = authorize(payload["_authority"]["credential_id"])
                if principal["role"] + ":" + principal["principal_id"] != row["principal"]:
                    raise Problem(403, "WORK_AUTHORITY_CHANGED")
            except Problem:
                db.execute("UPDATE schedules SET state='CANCELLED' WHERE id=?", (row["id"],))
                return
            recent = db.execute("SELECT count(*) FROM jobs WHERE principal=? AND created_ms>?", (row["principal"], at - 3600000)).fetchone()[0]
            queued = db.execute("SELECT count(*) FROM jobs WHERE state IN ('QUEUED','RUNNING')").fetchone()[0]
            total = db.execute("SELECT count(*) FROM jobs").fetchone()[0]
            if recent >= 20 or queued >= 128 or total >= 10000:
                db.execute("UPDATE schedules SET next_ms=? WHERE id=?", (at + 60000, row["id"]))
                return
            request_id = "schedule-" + row["id"] + "-" + str(row["next_ms"])
            logical = {k: v for k, v in payload.items() if k != "_authority"}
            fingerprint = hashlib.sha256(canonical({"kind": row["kind"], "payload": logical}).encode()).hexdigest()
            job = secrets.token_hex(16)
            db.execute("INSERT INTO jobs(id,principal,request_id,fingerprint,kind,payload,state,created_ms,updated_ms) VALUES(?,?,?,?,?,?,'QUEUED',?,?)", (job, row["principal"], request_id, fingerprint, row["kind"], row["payload"], at, at))
            self.event(db, job, "SCHEDULED", at)
            remaining = row["remaining"] - 1
            db.execute("UPDATE schedules SET remaining=?,next_ms=?,state=? WHERE id=?", (remaining, at + row["interval_seconds"] * 1000, "ACTIVE" if remaining else "COMPLETED", row["id"]))

    def status(self):
        with self.db() as db:
            counts = {r["state"]: r["n"] for r in db.execute("SELECT state,count(*) n FROM jobs GROUP BY state")}
            heartbeat = db.execute("SELECT value FROM metadata WHERE key='worker_heartbeat'").fetchone()
        at = int(heartbeat[0]) if heartbeat else None
        return {"counts": counts, "worker": "ONLINE" if at is not None and 0 <= self.clock() - at < 15000 else "OFFLINE", "worker_heartbeat_ms": at}
