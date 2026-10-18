"""One supervised preflight/worker session with private durable progress evidence."""

import hashlib
import http.client
import os
from pathlib import Path

from . import VERSION
from .agent_runner import MAX_REPORT, LocalModel
from .client import agent_client, read_credential
from .job_worker import report_directory, work_jobs
from .jobs import bounded
from .pilot_preflight import MIN_CREDENTIAL_MS, SAFE_ERRORS, pilot_preflight
from .store import exclusive_file, now_ms
from .validation import DIGEST, Problem, canonical, fields, identifier, matching

MAX_JOURNAL = 65_536
SESSION_ERRORS = SAFE_ERRORS | {
    "PILOT_REQUEST_FAILED", "PILOT_CONNECTION_FAILED", "PILOT_SESSION_RECORD_UNAVAILABLE",
    "PILOT_SESSION_CREDENTIAL_BUDGET", "PILOT_SESSION_RESPONSE_REJECTED", "PILOT_SESSION_PROJECT_MISMATCH",
    "PILOT_SESSION_ATTENTION_REQUIRED", "COMMUNITY_INSTANCE_MISMATCH", "COMMUNITY_AGENT_MISMATCH",
    "COMMUNITY_BINDING_UNSUPPORTED", "COMMUNITY_IDENTITY_UNCONFIRMED", "INVALID_RESPONSE",
}


class SessionJournal:
    """A local append-only observation, not a signed audit or recovery authority."""
    def __init__(self, path, project):
        self.output = exclusive_file(path)
        self.project = project
        self.sequence = self.size = 0
        self.failed = False
        self.digest = hashlib.sha256()
        self.results = []

    def record(self, phase, **data):
        if self.failed:
            raise Problem(503, "PILOT_SESSION_RECORD_UNAVAILABLE")
        raw = (canonical({"sequence": self.sequence + 1, "at_ms": now_ms(), "phase": phase, **data}) + "\n").encode("utf-8")
        if self.sequence >= 128 or self.size + len(raw) > MAX_JOURNAL:
            self.failed = True
            raise Problem(503, "PILOT_SESSION_RECORD_UNAVAILABLE")
        try:
            if self.output.write(raw) != len(raw):
                raise OSError("short session write")
            self.output.flush()
            os.fsync(self.output.fileno())
        except OSError:
            self.failed = True
            raise Problem(503, "PILOT_SESSION_RECORD_UNAVAILABLE") from None
        self.digest.update(raw)
        self.sequence += 1
        self.size += len(raw)

    def progress(self, phase, data):
        if phase == "CLAIM_STARTED":
            fields(data)
        else:
            required = ("job_id", "attempt_id")
            extras = {
                "CLAIMED": ("worker_credential_id", "project_id"),
                "REPORT_SAVED": ("report_sha256", "report_bytes", "steps"),
                "COMPLETION_STARTED": (),
                "JOB_RESULT": ("state", "report_sha256", "artifact_id", "completion_recorded"),
            }
            if phase not in extras:
                raise Problem(502, "PILOT_SESSION_RESPONSE_REJECTED")
            fields(data, (*required, *extras[phase]))
            for name in (*required, *(("worker_credential_id", "project_id") if phase == "CLAIMED" else ())):
                identifier(data[name])
            if phase == "CLAIMED" and data["project_id"] != self.project:
                raise Problem(409, "PILOT_SESSION_PROJECT_MISMATCH")
            if "report_sha256" in data and data["report_sha256"] is not None:
                matching(data["report_sha256"], DIGEST, "PILOT_SESSION_RESPONSE_REJECTED")
            if phase == "REPORT_SAVED":
                if data["report_sha256"] is None:
                    raise Problem(502, "PILOT_SESSION_RESPONSE_REJECTED")
                bounded(data["report_bytes"], 1, MAX_REPORT, "PILOT_SESSION_RESPONSE_REJECTED")
                bounded(data["steps"], 0, 6, "PILOT_SESSION_RESPONSE_REJECTED")
            if phase == "JOB_RESULT":
                if (type(data["state"]) is not str or data["state"] not in {"SUCCEEDED", "FAILED", "CANCELLED", "INTERRUPTED", "EXPIRED", "UNCONFIRMED"}
                        or type(data["completion_recorded"]) is not bool
                        or (data["state"] == "UNCONFIRMED") == data["completion_recorded"]):
                    raise Problem(502, "PILOT_SESSION_RESPONSE_REJECTED")
                if data["artifact_id"] is not None:
                    identifier(data["artifact_id"])
        self.record(phase, **data)
        if phase == "JOB_RESULT":
            self.results.append(dict(data))
            if data["state"] != "SUCCEEDED":
                raise Problem(409, "PILOT_SESSION_ATTENTION_REQUIRED")


def pilot_session(credential_file, session_dir, *, community_origin, expected_instance,
                  expected_agent, collaboration_project, model, model_port=11434,
                  max_steps=4, timeout=60, max_jobs=1, wait_seconds=0):
    """Use a new directory; never resume, renew credentials, or generate tasks."""
    if type(community_origin) is not str:
        raise Problem(400, "INVALID_COMMUNITY_ORIGIN")
    agent_client(origin=community_origin, expected_instance=expected_instance, expected_agent=expected_agent)
    project = identifier(collaboration_project)
    LocalModel(model, model_port)
    bounded(max_steps, 1, 6, "INVALID_RUN_LIMIT")
    bounded(timeout, 1, 120, "INVALID_RUN_LIMIT")
    bounded(max_jobs, 1, 16, "INVALID_WORKER_LIMIT")
    bounded(wait_seconds, 0, 300, "INVALID_WORKER_LIMIT")
    read_credential(credential_file)
    folder = Path(session_dir).absolute()
    try:
        folder.mkdir(mode=0o700)
    except FileExistsError:
        raise Problem(409, "PILOT_SESSION_DIRECTORY_EXISTS") from None
    report_directory(folder)
    journal = SessionJournal(folder / "session.jsonl", project)
    failure, stage, preflight_sha, completed = None, "preflight", None, False
    try:
        journal.record("SESSION_STARTED", protocol="ZOORA_AE032_SESSION_V1", service_version=VERSION,
            community_origin=community_origin, expected_instance_id=expected_instance, expected_agent_id=expected_agent,
            project_id=project, model=model, max_steps=max_steps, timeout_seconds=timeout, max_jobs=max_jobs,
            wait_seconds=wait_seconds, timestamp_source="WORKER_HOST_CLOCK", automatic_retry=False,
            wallet_execution="UNAVAILABLE", hardware_acceptance="UNVERIFIED")
        ready = pilot_preflight(credential_file, folder / "preflight.json", community_origin=community_origin,
            expected_instance=expected_instance, expected_agent=expected_agent, collaboration_project=project,
            model=model, model_port=model_port)
        preflight_sha = ready["report_sha256"]
        # Admission margin only: DNS, host I/O and later revocation/clock changes
        # can still interrupt a session. Never silently extend a credential.
        required_ms = max(MIN_CREDENTIAL_MS, (max_jobs * (timeout + 36) + wait_seconds + 30) * 1000)
        if ready["credential_remaining_ms"] < required_ms:
            raise Problem(409, "PILOT_SESSION_CREDENTIAL_BUDGET")
        journal.record("PREFLIGHT_PASSED", report_sha256=preflight_sha,
                       required_credential_remaining_ms=required_ms)
        stage = "worker"
        result = work_jobs(credential_file, folder / "reports", model=model, model_port=model_port,
            max_steps=max_steps, timeout=timeout, max_jobs=max_jobs, wait_seconds=wait_seconds,
            community_origin=community_origin, expected_instance=expected_instance, expected_agent=expected_agent,
            collaboration_project=project, _claim_project=project, _progress=journal.progress)
        if result["processed"] != len(journal.results):
            raise Problem(502, "PILOT_SESSION_RESPONSE_REJECTED")
        completed = True
    except KeyboardInterrupt:
        failure = Problem(409, "PILOT_SESSION_INTERRUPTED")
    except Problem as error:
        code = error.code if type(error.code) is str and error.code in SESSION_ERRORS else "PILOT_SESSION_REQUEST_FAILED"
        failure = Problem(error.status, code)
    except (OSError, http.client.HTTPException):
        failure = Problem(502, "PILOT_SESSION_CONNECTION_FAILED")
    except (ValueError, KeyError, TypeError, AttributeError, RecursionError):
        failure = Problem(502, "PILOT_SESSION_RESPONSE_REJECTED")
    finally:
        # Unexpected process exceptions must never leave a successful footer.
        if failure is None and not completed:
            failure = Problem(409, "PILOT_SESSION_INTERRUPTED")
        state = "COMPLETED" if failure is None else ("BLOCKED" if stage == "preflight" else "ATTENTION_REQUIRED")
        if failure is not None and failure.code == "PILOT_SESSION_INTERRUPTED":
            state = "INTERRUPTED"
        try:
            journal.record("SESSION_FINISHED", state=state, stage=stage, jobs_recorded=len(journal.results),
                           error_code=failure.code if failure else None,
                           outcome=("TASK_RESULTS_OBSERVED" if journal.results else
                                    "NO_TASKS_AVAILABLE" if failure is None else "NO_CONFIRMED_TASK_RESULT"))
        except (Problem, OSError):
            failure = Problem(503, "PILOT_SESSION_RECORD_UNAVAILABLE")
        finally:
            try:
                journal.output.close()
            except OSError:
                failure = Problem(503, "PILOT_SESSION_RECORD_UNAVAILABLE")
    if failure is not None:
        raise failure
    return {"state": "COMPLETED", "jobs_processed": len(journal.results), "journal_saved": True,
            "journal_sha256": journal.digest.hexdigest(), "preflight_sha256": preflight_sha,
            "automatic_retry": False, "wallet_execution": "UNAVAILABLE"}
