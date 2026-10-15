"""Private durable tasks, one leased attempt, explicit stop and atomic digest publication.

Reports are declarations from an authenticated local client. A database record
does not prove that a model ran or that its answer was correct.
"""

import hashlib
import json
import re
import secrets
import uuid

from .validation import DIGEST, Problem, canonical, fields, identifier, matching, text

QUEUE_TTL_MS = 15 * 60_000
LEASE_GRACE_MS = 30_000
PER_AGENT_PENDING = 4
GLOBAL_PENDING = 32
CLAIM = re.compile(r"jr1_[A-Za-z0-9_-]{43}\Z")
ERROR = re.compile(r"[A-Z][A-Z0-9_]{0,63}\Z")
ACTIVE = {"QUEUED", "RUNNING"}
SYSTEM = {"role": "SYSTEM", "principal_id": "job_scheduler"}


def bounded(value, low, high, code):
    if type(value) is not int or not low <= value <= high:
        raise Problem(400, code)
    return value


def digest(value, domain):
    return hashlib.sha256(domain + canonical(value).encode("utf-8")).hexdigest()


def claim_digest(token):
    return hashlib.sha256(b"ZOORA_AE010_CLAIM_V1\0" + token.encode("ascii")).hexdigest()


def request_value(body):
    fields(body, ("request_id", "title", "prompt"), ("project_id", "max_steps", "timeout_seconds"))
    return {"request_id": identifier(body["request_id"]), "title": text(body["title"], 128),
            "prompt": text(body["prompt"], 4096),
            "project_id": identifier(body["project_id"]) if body.get("project_id") is not None else None,
            "max_steps": bounded(body.get("max_steps", 4), 1, 6, "INVALID_RUN_LIMIT"),
            "timeout_seconds": bounded(body.get("timeout_seconds", 60), 1, 120, "INVALID_RUN_LIMIT")}


class JobMethods:
    def _job_allowed(self, connection, principal, job):
        if principal["role"] != "OWNER":
            self._manage_agent(principal, self._row(connection, "agents", job["agent_id"]))

    @staticmethod
    def _job_effective(connection, job, at):
        if job["state"] not in ACTIVE:
            return job["state"], job["error_code"]
        credential = connection.execute("SELECT * FROM credentials WHERE id=?", (job["credential_id"],)).fetchone()
        enabled = connection.execute("SELECT a.active,o.active FROM agents a JOIN operators o ON o.id=a.operator_id WHERE a.id=?",
                                     (job["agent_id"],)).fetchone()
        if (credential is None or credential["revoked"] or at >= credential["expires_ms"]
                or enabled is None or not all(enabled)):
            return ("CANCELLED" if job["state"] == "QUEUED" else "INTERRUPTED"), "JOB_CREDENTIAL_INVALID"
        if job["state"] == "QUEUED" and at >= job["expires_ms"]:
            return "EXPIRED", "JOB_QUEUE_EXPIRED"
        if job["state"] == "RUNNING" and at >= job["lease_expires_ms"]:
            return "INTERRUPTED", "JOB_LEASE_EXPIRED"
        return job["state"], job["error_code"]

    def _job_view(self, connection, job, at, *, task=False):
        state, error = self._job_effective(connection, job, at)
        keys = ("id", "agent_id", "credential_id", "title", "project_id", "max_steps", "timeout_seconds",
                "created_ms", "updated_ms", "expires_ms", "attempt_id", "lease_expires_ms", "run_max_steps",
                "run_timeout_seconds", "report_sha256", "report_bytes", "steps", "artifact_id")
        result = {key: job[key] for key in keys}
        result.update(state=state, recorded_state=job["state"], error_code=error,
                      stop_requested=bool(job["stop_requested"]),
                      report_classification="CLIENT_DECLARED", automatic_retry=False,
                      wallet_execution="UNAVAILABLE")
        if task:
            result["prompt"] = job["prompt"]
            result["request_id"] = job["request_id"]
        return result

    def _jobs_read(self, connection, route, token, at, limit, after):
        principal = self._authenticate(connection, token, at)
        parts = route.strip("/").split("/")
        if len(parts) == 3:
            job = self._row(connection, "jobs", identifier(parts[2]))
            self._job_allowed(connection, principal, job)
            return 200, self._job_view(connection, job, at, task=True)
        if len(parts) != 2:
            raise Problem(404, "NOT_FOUND")
        clause, values = "", []
        if principal["role"] == "AGENT":
            clause, values = "AND j.agent_id=?", [principal["principal_id"]]
        elif principal["role"] == "OPERATOR":
            clause, values = "AND a.operator_id=?", [principal["principal_id"]]
        rows = connection.execute("SELECT j.* FROM jobs j JOIN agents a ON a.id=j.agent_id WHERE j.id>? "
                                  + clause + " ORDER BY j.id LIMIT ?", [after, *values, limit + 1]).fetchall()
        items = [self._job_view(connection, dict(row), at) for row in rows[:limit]]
        return 200, {"items": items, "next_after": items[-1]["id"] if len(rows) > limit else None,
                     "scope": "PRIVATE_AUTHENTICATED_TASKS"}

    def _jobs_sweep(self, connection, at):
        for row in connection.execute("SELECT * FROM jobs WHERE state IN ('QUEUED','RUNNING')").fetchall():
            state, error = self._job_effective(connection, row, at)
            if state != row["state"]:
                connection.execute("UPDATE jobs SET state=?,error_code=?,updated_ms=? WHERE id=?",
                                   (state, error, at, row["id"]))
                self._event(connection, SYSTEM, "JOB_RETIRE", row["id"], {"state": state, "error_code": error}, at)

    def _jobs_write(self, connection, principal, method, route, body, at):
        if method != "POST":
            raise Problem(405, "METHOD_NOT_ALLOWED")
        parts = route.strip("/").split("/")
        self._jobs_sweep(connection, at)
        if route == "/v1/jobs":
            self._role(principal, "AGENT")
            value = request_value(body)
            fingerprint = digest(value, b"ZOORA_AE010_REQUEST_V1\0")
            previous = connection.execute("SELECT * FROM jobs WHERE agent_id=? AND request_id=?",
                                          (principal["principal_id"], value["request_id"])).fetchone()
            if previous is not None:
                if not secrets.compare_digest(previous["request_digest"], fingerprint):
                    raise Problem(409, "JOB_REQUEST_CONFLICT")
                return 200, {"job": self._job_view(connection, previous, at), "replayed": True}
            if value["project_id"] is not None:
                self._membership(connection, value["project_id"], principal["principal_id"])
            admission = self._task_admission(connection, principal["principal_id"], at) if self.schema_version >= 5 else None
            pending = connection.execute("SELECT agent_id FROM jobs WHERE state IN ('QUEUED','RUNNING')").fetchall()
            if len(pending) >= GLOBAL_PENDING or sum(row[0] == principal["principal_id"] for row in pending) >= PER_AGENT_PENDING:
                raise Problem(409, "JOB_QUEUE_LIMIT")
            self._capacity(connection, "jobs")
            record_id = uuid.uuid4().hex
            connection.execute("INSERT INTO jobs(id,agent_id,credential_id,request_id,request_digest,title,prompt,project_id,"
                               "max_steps,timeout_seconds,created_ms,updated_ms,expires_ms,state) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'QUEUED')",
                               (record_id, principal["principal_id"], principal["id"], value["request_id"], fingerprint,
                                value["title"], value["prompt"], value["project_id"], value["max_steps"], value["timeout_seconds"],
                                at, at, at + QUEUE_TTL_MS))
            self._event(connection, principal, "JOB_SUBMIT", record_id,
                        {"credential_id": principal["id"], "project_id": value["project_id"],
                         "max_steps": value["max_steps"], "timeout_seconds": value["timeout_seconds"],
                         **({"operator_task_capacity": admission} if admission is not None else {})}, at)
            return 201, {"job": self._job_view(connection, self._row(connection, "jobs", record_id), at), "replayed": False}
        if route == "/v1/jobs/claim":
            self._role(principal, "AGENT")
            fields(body, ("max_steps", "timeout_seconds"))
            steps = bounded(body["max_steps"], 1, 6, "INVALID_RUN_LIMIT")
            timeout = bounded(body["timeout_seconds"], 1, 120, "INVALID_RUN_LIMIT")
            # BEGIN IMMEDIATE in Store.call serializes claims across processes.
            if connection.execute("SELECT 1 FROM jobs WHERE state='RUNNING'").fetchone() is not None:
                return 200, {"job": None, "reason": "WORKER_BUSY"}
            row = connection.execute("SELECT * FROM jobs WHERE state='QUEUED' AND agent_id=? AND credential_id=? ORDER BY created_ms,rowid LIMIT 1",
                                     (principal["principal_id"], principal["id"])).fetchone()
            if row is None:
                return 200, {"job": None, "reason": "QUEUE_EMPTY"}
            record_id, attempt = row["id"], uuid.uuid4().hex
            secret = "jr1_" + secrets.token_urlsafe(32)
            steps, timeout = min(steps, row["max_steps"]), min(timeout, row["timeout_seconds"])
            connection.execute("UPDATE jobs SET state='RUNNING',attempt_id=?,claim_digest=?,lease_expires_ms=?,"
                               "run_max_steps=?,run_timeout_seconds=?,updated_ms=? WHERE id=?",
                               (attempt, claim_digest(secret), at + timeout * 1000 + LEASE_GRACE_MS, steps, timeout, at, record_id))
            self._event(connection, principal, "JOB_CLAIM", record_id,
                        {"attempt_id": attempt, "max_steps": steps, "timeout_seconds": timeout}, at)
            return 200, {"job": self._job_view(connection, self._row(connection, "jobs", record_id), at, task=True),
                         "claim_token": secret}
        if len(parts) != 4 or parts[3] not in {"stop", "complete"}:
            raise Problem(404, "NOT_FOUND")
        job = self._row(connection, "jobs", identifier(parts[2]))
        self._job_allowed(connection, principal, job)
        if parts[3] == "stop":
            fields(body)
            if job["state"] in ACTIVE and not job["stop_requested"]:
                state = "CANCELLED" if job["state"] == "QUEUED" else "RUNNING"
                connection.execute("UPDATE jobs SET stop_requested=1,state=?,updated_ms=?,error_code=? WHERE id=?",
                                   (state, at, "JOB_STOPPED" if state == "CANCELLED" else None, job["id"]))
                self._event(connection, principal, "JOB_STOP", job["id"], {"state": state}, at)
            return 200, self._job_view(connection, self._row(connection, "jobs", job["id"]), at)
        return self._job_complete(connection, principal, job, body, at)

    def _job_complete(self, connection, principal, job, body, at):
        self._role(principal, "AGENT")
        fields(body, ("attempt_id", "claim_token", "state", "report_sha256", "report_bytes", "steps", "error_code"))
        attempt = identifier(body["attempt_id"])
        secret = matching(body["claim_token"], CLAIM, "INVALID_JOB_CLAIM")
        if (principal["id"] != job["credential_id"] or attempt != job["attempt_id"]
                or not secrets.compare_digest(claim_digest(secret), job["claim_digest"] or "")):
            raise Problem(409, "JOB_CLAIM_MISMATCH")
        if type(body["state"]) is not str or body["state"] not in {"SUCCEEDED", "FAILED"}:
            raise Problem(400, "INVALID_JOB_COMPLETION")
        steps = bounded(body["steps"], 0, job["run_max_steps"], "INVALID_JOB_COMPLETION")
        report = body["report_sha256"]
        if report is None:
            if body["report_bytes"] is not None or body["state"] == "SUCCEEDED":
                raise Problem(400, "INVALID_JOB_COMPLETION")
            if steps != 0:
                raise Problem(400, "INVALID_JOB_COMPLETION")
        else:
            matching(report, DIGEST, "INVALID_DIGEST")
            bounded(body["report_bytes"], 1, 131072, "INVALID_JOB_COMPLETION")
        error = body["error_code"]
        if body["state"] == "FAILED":
            matching(error, ERROR, "INVALID_JOB_COMPLETION")
        elif error is not None or steps == 0:
            raise Problem(400, "INVALID_JOB_COMPLETION")
        fingerprint = digest(body, b"ZOORA_AE010_COMPLETION_V1\0")
        if job["completion_digest"] is not None:
            if not secrets.compare_digest(job["completion_digest"], fingerprint):
                raise Problem(409, "JOB_COMPLETION_CONFLICT")
            return 200, {"job": self._job_view(connection, job, at), "replayed": True}
        if job["state"] != "RUNNING":
            raise Problem(409, "JOB_NOT_RUNNING")
        state = "CANCELLED" if job["stop_requested"] else body["state"]
        error = "JOB_STOPPED" if job["stop_requested"] else error
        artifact = None
        if state == "SUCCEEDED" and job["project_id"] is not None:
            self._membership(connection, job["project_id"], job["agent_id"])
            self._capacity(connection, "artifacts")
            artifact = uuid.uuid4().hex
            connection.execute("INSERT INTO artifacts VALUES (?,?,?,?,?,?)",
                               (artifact, job["project_id"], job["agent_id"], report, job["title"], at))
            self._event(connection, principal, "ARTIFACT_DECLARE", artifact, {"project_id": job["project_id"], "job_id": job["id"]}, at)
        connection.execute("UPDATE jobs SET state=?,updated_ms=?,report_sha256=?,report_bytes=?,steps=?,error_code=?,artifact_id=?,completion_digest=? WHERE id=?",
                           (state, at, report, body["report_bytes"], steps if report else None, error, artifact, fingerprint, job["id"]))
        self._event(connection, principal, "JOB_COMPLETE", job["id"],
                    {"state": state, "attempt_id": attempt, "report_sha256": report,
                     "report_bytes": body["report_bytes"], "steps": steps if report else None,
                     "artifact_id": artifact, "error_code": error}, at)
        return 200, {"job": self._job_view(connection, self._row(connection, "jobs", job["id"]), at), "replayed": False}

    def _audit_jobs(self, connection):
        for row in connection.execute("SELECT * FROM jobs"):
            identifier(row["id"])
            identifier(row["agent_id"])
            credential = self._row(connection, "credentials", row["credential_id"])
            if credential["role"] != "AGENT" or credential["principal_id"] != row["agent_id"]:
                raise ValueError("job credential relationship")
            value = request_value({key: row[key] for key in ("request_id", "title", "prompt", "project_id", "max_steps", "timeout_seconds")})
            if (digest(value, b"ZOORA_AE010_REQUEST_V1\0") != row["request_digest"]
                    or row["expires_ms"] != row["created_ms"] + QUEUE_TTL_MS):
                raise ValueError("job request fingerprint")
            if row["attempt_id"] is not None:
                identifier(row["attempt_id"])
                matching(row["claim_digest"], DIGEST, "INVALID_DIGEST")
                if row["run_max_steps"] > row["max_steps"] or row["run_timeout_seconds"] > row["timeout_seconds"]:
                    raise ValueError("job budget exceeded")
            for key in ("report_sha256", "completion_digest"):
                if row[key] is not None:
                    matching(row[key], DIGEST, "INVALID_DIGEST")
            if row["error_code"] is not None:
                matching(row["error_code"], ERROR, "INVALID_JOB_COMPLETION")
            if row["steps"] is not None and (row["attempt_id"] is None or row["steps"] > row["run_max_steps"]):
                raise ValueError("job steps exceeded")
            if row["state"] == "SUCCEEDED" and bool(row["artifact_id"]) != bool(row["project_id"]):
                raise ValueError("job publication missing")
            if row["artifact_id"] is not None:
                artifact = self._row(connection, "artifacts", row["artifact_id"])
                if (artifact["project_id"], artifact["author_id"], artifact["digest"]) != (row["project_id"], row["agent_id"], row["report_sha256"]):
                    raise ValueError("job publication mismatch")
            # Prompt content and raw claim tokens are deliberately absent from events.
            events = connection.execute("SELECT * FROM audit WHERE resource_id=? AND action IN ('JOB_SUBMIT','JOB_CLAIM','JOB_COMPLETE') ORDER BY seq", (row["id"],)).fetchall()
            actions = [event["action"] for event in events]
            if actions.count("JOB_SUBMIT") != 1 or actions.count("JOB_CLAIM") != int(row["attempt_id"] is not None) or actions.count("JOB_COMPLETE") != int(row["completion_digest"] is not None):
                raise ValueError("job audit event missing")
            for event in events:
                details = json.loads(event["details"])
                if event["actor_role"] != "AGENT" or event["actor_id"] != row["agent_id"]:
                    raise ValueError("job event actor mismatch")
                if event["action"] == "JOB_SUBMIT" and (event["at_ms"], details["credential_id"], details["project_id"], details["max_steps"], details["timeout_seconds"]) != (row["created_ms"], row["credential_id"], row["project_id"], row["max_steps"], row["timeout_seconds"]):
                    raise ValueError("job submission mismatch")
                if event["action"] == "JOB_CLAIM":
                    if (details["attempt_id"], details["max_steps"], details["timeout_seconds"]) != (row["attempt_id"], row["run_max_steps"], row["run_timeout_seconds"]):
                        raise ValueError("job attempt mismatch")
                    if row["lease_expires_ms"] != event["at_ms"] + row["run_timeout_seconds"] * 1000 + LEASE_GRACE_MS:
                        raise ValueError("job lease mismatch")
                if event["action"] == "JOB_COMPLETE":
                    keys = ("state", "attempt_id", "report_sha256", "report_bytes", "steps", "artifact_id", "error_code")
                    if tuple(details[key] for key in keys) != tuple(row[key] for key in keys) or event["at_ms"] != row["updated_ms"]:
                        raise ValueError("job completion mismatch")
