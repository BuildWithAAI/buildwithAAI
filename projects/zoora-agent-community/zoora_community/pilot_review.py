"""Read-only, pinned reconciliation of selected tasks with retained private reports."""

import hashlib
import http.client
import os
from pathlib import Path
import stat
import time

from . import VERSION
from .agent_runner import MAX_REPORT
from .client import agent_client, read_credential
from .pilot_preflight import SAFE_ERRORS, require
from .store import exclusive_file, now_ms, private_regular
from .validation import DIGEST, Problem, canonical, identifier, matching, parse_json

REVIEW_SECONDS = 30
JOB_STATES = {"QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED", "INTERRUPTED"}
REVIEW_ERRORS = SAFE_ERRORS | {
    "COMMUNITY_INSTANCE_MISMATCH", "COMMUNITY_AGENT_MISMATCH", "COMMUNITY_BINDING_UNSUPPORTED",
    "COMMUNITY_IDENTITY_UNCONFIRMED", "PILOT_REVIEW_SCOPE_MISMATCH", "PILOT_REVIEW_AUTH_CHANGED",
}


def reports_directory(path):
    """Inspect an existing trusted directory; never create or repair input files."""
    folder = Path(path).absolute()
    try:
        info = folder.lstat()
    except OSError:
        raise Problem(400, "PILOT_REVIEW_REPORT_DIRECTORY_UNAVAILABLE") from None
    if not stat.S_ISDIR(info.st_mode) or (os.name == "posix" and
            (stat.S_IMODE(info.st_mode) & 0o077 or info.st_uid != os.getuid())):
        raise Problem(400, "UNSAFE_REPORT_DIRECTORY")
    return folder


def check_report(folder, job, binding):
    """Only the fixed job/attempt filename is read; private contents never escape."""
    path = folder / (job["id"] + "-" + job["attempt_id"] + ".json")
    try:
        private_regular(path, MAX_REPORT)
        with path.open("rb") as source:
            raw = source.read(MAX_REPORT + 1)
        if len(raw) > MAX_REPORT:
            return "LOCAL_REPORT_UNAVAILABLE"
        report = parse_json(raw, MAX_REPORT)
        if (hashlib.sha256(raw).hexdigest() != job["report_sha256"]
                or len(raw) != job["report_bytes"]):
            return "LOCAL_REPORT_DIGEST_MISMATCH"
        if (report["protocol"] != "ZOORA_AE009_RUN_V1" or report["state"] != "AVAILABLE"
                or report["job"] != {"job_id": job["id"], "attempt_id": job["attempt_id"]}
                or report["agent_id"] != job["agent_id"]
                or report["credential_id"] != job["worker_credential_id"]
                or report["task"] != {"prompt": job["prompt"]}
                or report["max_steps"] != job["run_max_steps"]
                or report["timeout_seconds"] != job["run_timeout_seconds"]
                or type(report["steps"]) is not list
                or len(report["steps"]) != job["steps"]
                or report["connection_binding"] != binding):
            return "LOCAL_REPORT_BINDING_MISMATCH"
    except (Problem, OSError, ValueError, KeyError, TypeError, AttributeError, RecursionError):
        return "LOCAL_REPORT_UNAVAILABLE"
    return "SERVER_SUCCESS_AND_LOCAL_REPORT_MATCH"


def pilot_review(credential_file, reports_dir, out, *, community_origin, expected_instance,
                 expected_agent, collaboration_project, job_ids):
    """Review explicit IDs, never claim, complete, renew, infer, resume or requeue.

    A matched report is still a client declaration. This neither reviews its
    answer quality nor attests independent hardware or all historical work.
    """
    require(type(community_origin) is str, "INVALID_COMMUNITY_ORIGIN")
    client = agent_client(origin=community_origin, expected_instance=expected_instance, expected_agent=expected_agent)
    project = identifier(collaboration_project)
    if type(job_ids) is not list or not 1 <= len(job_ids) <= 16:
        raise Problem(400, "INVALID_PILOT_REVIEW_JOBS")
    for value in job_ids:
        identifier(value)
    if len(set(job_ids)) != len(job_ids):
        raise Problem(400, "INVALID_PILOT_REVIEW_JOBS")
    folder = reports_directory(reports_dir)
    token = read_credential(credential_file)
    output = exclusive_file(out)  # Existing output is refused before any network.
    report = {
        "protocol": "ZOORA_AE032_REVIEW_V1", "service_version": VERSION,
        "state": "UNVERIFIED", "started_at_ms": now_ms(), "available_at_ms": None,
        "community_origin": community_origin, "expected_instance_id": expected_instance,
        "expected_agent_id": expected_agent, "project_id": project,
        "requested_job_ids": list(job_ids), "jobs": [], "connection_binding": client.binding(),
        "point_in_time_only": True, "all_historical_tasks_checked": False,
        "community_mutations": 0, "model_inference": False, "automatic_retry": False,
        "task_quality": "UNVERIFIED", "hardware_acceptance": "UNVERIFIED",
        "report_classification": "CLIENT_DECLARED", "wallet_execution": "UNAVAILABLE",
    }
    client.deadline = time.monotonic() + REVIEW_SECONDS
    stage, finished = "service_identity", False

    def status_check():
        status = client.request("GET", "/v1/status")[1]
        require(status["visibility"] == "PRIVATE_PILOT", "PILOT_PRIVATE_MODE_REQUIRED")
        require(type(status["observed_at_ms"]) is int, "PILOT_RESPONSE_REJECTED")
        return status

    try:
        status_check()  # Bound public probes precede every request, including this one.
        stage = "anonymous_content_denied"
        try:
            client.request("GET", "/v1/agents?limit=1")
        except Problem as error:
            require(error.status == 401, "PILOT_PRIVACY_UNCONFIRMED")
        else:
            raise Problem(409, "PILOT_PRIVACY_UNCONFIRMED")
        stage = "agent_credential"
        principal = client.request("GET", "/v1/me", token=token)[1]
        require(principal["role"] == "AGENT" and principal["principal_id"] == expected_agent,
                "PILOT_AGENT_MISMATCH")
        stage = "shared_project_membership"
        discussion = client.request("GET", "/v1/projects/" + project + "/discussion?limit=1", token=token)[1]
        require(discussion["scope"] == "AUTHENTICATED_PROJECT_MEMBERS" and type(discussion["items"]) is list,
                "PILOT_RESPONSE_REJECTED")
        stage = "selected_jobs"
        for job_id in job_ids:
            job = client.request("GET", "/v1/jobs/" + job_id, token=token)[1]
            require(job["id"] == job_id and job["agent_id"] == expected_agent and job["project_id"] == project,
                    "PILOT_REVIEW_SCOPE_MISMATCH")
            require(type(job["state"]) is str and job["state"] in JOB_STATES
                    and type(job["stop_requested"]) is bool, "PILOT_RESPONSE_REJECTED")
            attempt = identifier(job["attempt_id"]) if job["attempt_id"] is not None else None
            row = {"job_id": job_id, "attempt_id": attempt, "server_state": job["state"],
                   "completion_check": "NOT_SUCCEEDED"}
            if job["state"] == "SUCCEEDED":
                require(attempt is not None and not job["stop_requested"], "PILOT_RESPONSE_REJECTED")
                identifier(job["worker_credential_id"])
                identifier(job["artifact_id"])
                matching(job["report_sha256"], DIGEST, "PILOT_RESPONSE_REJECTED")
                require(type(job["report_bytes"]) is int and 1 <= job["report_bytes"] <= MAX_REPORT
                        and type(job["steps"]) is int and 1 <= job["steps"] <= 6,
                        "PILOT_RESPONSE_REJECTED")
                row.update(completion_check=check_report(folder, job, client.binding()),
                           report_sha256=job["report_sha256"], server_declared_artifact_id=job["artifact_id"])
            report["jobs"].append(row)
        stage = "final_identity_and_credential"
        status = status_check()
        require(client.request("GET", "/v1/me", token=token)[1] == principal, "PILOT_REVIEW_AUTH_CHANGED")
        require(time.monotonic() < client.deadline, "RUN_DEADLINE")
        report["service_observed_at_ms"] = status["observed_at_ms"]
        report["state"] = ("SELECTED_TASKS_CONFIRMED" if all(
            row["completion_check"] == "SERVER_SUCCESS_AND_LOCAL_REPORT_MATCH" for row in report["jobs"])
            else "ATTENTION_REQUIRED")
        finished = True
    except KeyboardInterrupt:
        report.update(state="INTERRUPTED", failed_check=stage, error_code="PILOT_REVIEW_INTERRUPTED")
    except Problem as error:
        code = error.code if type(error.code) is str and error.code in REVIEW_ERRORS else "PILOT_REVIEW_REQUEST_FAILED"
        report.update(state="BLOCKED", failed_check=stage, error_code=code)
    except (OSError, http.client.HTTPException):
        report.update(state="BLOCKED", failed_check=stage, error_code="PILOT_REVIEW_CONNECTION_FAILED")
    except (ValueError, KeyError, TypeError, AttributeError, RecursionError):
        report.update(state="BLOCKED", failed_check=stage, error_code="PILOT_REVIEW_RESPONSE_REJECTED")
    finally:
        if not finished and report["state"] in {"UNVERIFIED", "SELECTED_TASKS_CONFIRMED"}:
            report.update(state="INTERRUPTED", failed_check=stage, error_code="PILOT_REVIEW_INTERRUPTED")
        report["available_at_ms"] = now_ms()
        raw = (canonical(report) + "\n").encode("utf-8")
        try:
            if output.write(raw) != len(raw):
                raise OSError("short review write")
            output.flush()
            os.fsync(output.fileno())
        finally:
            output.close()
    return {"state": report["state"], "jobs_checked": len(report["jobs"]),
            "jobs_confirmed": sum(row["completion_check"] == "SERVER_SUCCESS_AND_LOCAL_REPORT_MATCH" for row in report["jobs"]),
            "report_saved": True, "report_sha256": hashlib.sha256(raw).hexdigest(),
            "point_in_time_only": True, "all_historical_tasks_checked": False,
            "community_mutations": 0, "model_inference": False, "wallet_execution": "UNAVAILABLE"}
