"""Bounded host worker: existing local model, private reports, no automatic retries.

The task lease coordinates honest clients in one database. It is not a process
sandbox or a hardware resource governor. Stop is checked between network calls.
"""

import hashlib
import http.client
import os
from pathlib import Path
import stat
import time

from .agent_runner import MAX_REPORT, LocalModel, run_agent
from .agent_payments import configuration
from .client import agent_client, read_credential
from .collaboration import CollaborationScope
from .jobs import SIGNAL_INTERVAL_MS, bounded
from .store import exclusive_file, private_regular
from .validation import Problem, fields, identifier, parse_json


def report_directory(folder):
    folder = Path(folder).absolute()
    folder.mkdir(mode=0o700, exist_ok=True)
    info = folder.lstat()
    if not stat.S_ISDIR(info.st_mode) or (os.name == "posix" and
            (stat.S_IMODE(info.st_mode) & 0o077 or info.st_uid != os.getuid())):
        raise Problem(400, "UNSAFE_REPORT_DIRECTORY")
    return folder


def report_metadata(path, job):
    """Read only the exclusive report for this exact job/attempt, never a task path."""
    private_regular(path, MAX_REPORT)
    raw = path.read_bytes()
    report = parse_json(raw, MAX_REPORT)
    fields(report["job"], ("job_id", "attempt_id"))
    if (report["job"] != {"job_id": job["id"], "attempt_id": job["attempt_id"]}
            or report["agent_id"] != job["agent_id"] or report["credential_id"] != job["worker_credential_id"]
            or report["task"] != {"prompt": job["prompt"]}
            or report["max_steps"] != job["run_max_steps"] or report["timeout_seconds"] != job["run_timeout_seconds"]
            or report["state"] not in {"AVAILABLE", "FAILED"}
            or type(report["steps"]) is not list or len(report["steps"]) > job["run_max_steps"]):
        raise Problem(503, "JOB_REPORT_MISMATCH")
    return {"report_sha256": hashlib.sha256(raw).hexdigest(), "report_bytes": len(raw), "steps": len(report["steps"])}


def complete(client, token, job, payload):
    # A lost response may follow a committed transaction. Retry only this exact
    # completion once; never run inference again or alter a failed declaration.
    path = "/v1/jobs/" + job["id"] + "/complete"
    for attempt in range(2):
        try:
            return client.request("POST", path, payload, token)[1]["job"]
        except (OSError, http.client.HTTPException):
            if attempt:
                raise
    raise RuntimeError("unreachable")


def work_jobs(credential_file, out_dir, *, model, port=8765, model_port=11434,
              max_steps=4, timeout=60, max_jobs=1, wait_seconds=0,
              payment_state=None, sandbox_key_file=None, payment_scope_file=None,
              community_origin=None, collaboration_project=None, expected_instance=None, expected_agent=None,
              _progress=None, _claim_project=None):
    bounded(max_steps, 1, 6, "INVALID_RUN_LIMIT")
    bounded(timeout, 1, 120, "INVALID_RUN_LIMIT")
    bounded(max_jobs, 1, 16, "INVALID_WORKER_LIMIT")
    bounded(wait_seconds, 0, 300, "INVALID_WORKER_LIMIT")
    if _progress is not None and not callable(_progress):
        raise Problem(400, "INVALID_WORKER_PROGRESS")
    if _claim_project is not None:
        identifier(_claim_project)
    LocalModel(model, model_port)  # Validate local model naming/port before claiming.
    configuration(payment_state, sandbox_key_file, payment_scope_file)  # Validate host files before claiming a task.
    if collaboration_project is not None:
        CollaborationScope(collaboration_project)
    client = agent_client(port, origin=community_origin, expected_instance=expected_instance, expected_agent=expected_agent)
    token = read_credential(credential_file)
    principal = client.request("GET", "/v1/me", token=token)[1]
    if principal["role"] != "AGENT":
        raise Problem(403, "AGENT_REQUIRED")
    folder = report_directory(out_dir)
    expires = time.monotonic() + wait_seconds
    outcomes = []
    claim_started = False

    def progress(phase, **data):
        # Host-owned observer only; never pass prompts, bearer or claim secrets.
        # A recording failure propagates before further inference/mutations.
        if _progress is not None:
            _progress(phase, data)

    while len(outcomes) < max_jobs:
        if not claim_started:
            progress("CLAIM_STARTED")
            claim_started = True
        claim_body = {"max_steps": max_steps, "timeout_seconds": timeout}
        if _claim_project is not None:
            claim_body["project_id"] = _claim_project
        response = client.request("POST", "/v1/jobs/claim", claim_body, token)[1]
        job = response["job"]
        if job is None:
            remaining = expires - time.monotonic()
            if remaining <= 0:
                break
            time.sleep(min(0.5, remaining))
            continue
        identifier(job["id"])
        identifier(job["attempt_id"])
        progress("CLAIMED", job_id=job["id"], attempt_id=job["attempt_id"],
                 worker_credential_id=job["worker_credential_id"], project_id=job["project_id"])
        report = folder / (job["id"] + "-" + job["attempt_id"] + ".json")
        signal_sequence = 0
        last_signal = None

        def guard(deadline, current_job=job, current_claim=response["claim_token"]):
            nonlocal signal_sequence, last_signal
            client.deadline = deadline
            current = client.request("GET", "/v1/jobs/" + current_job["id"], token=token)[1]
            if current["stop_requested"]:
                raise Problem(409, "JOB_STOPPED")
            if current["state"] != "RUNNING" or current["attempt_id"] != current_job["attempt_id"]:
                raise Problem(409, "JOB_NOT_RUNNING")
            if last_signal is None or time.monotonic() - last_signal >= SIGNAL_INTERVAL_MS / 1000:
                payload = {"attempt_id": current_job["attempt_id"], "claim_token": current_claim,
                           "sequence": signal_sequence + 1}
                # Repeating the same sequence can recover a lost response but
                # cannot refresh its server timestamp or extend the task lease.
                for attempt in range(2):
                    try:
                        client.request("POST", "/v1/jobs/" + current_job["id"] + "/heartbeat", payload, token)
                        break
                    except (OSError, http.client.HTTPException):
                        if attempt:
                            raise
                signal_sequence += 1
                last_signal = time.monotonic()

        error = None
        created = False
        output = None
        try:
            # There is no task-file input controlled by the model or the browser.
            # Reserve collisions fail; preexisting files are never used as evidence.
            output = exclusive_file(report)
            created = True
            run_agent(credential_file, None, report, model=model, port=port, model_port=model_port,
                      max_steps=job["run_max_steps"], timeout=job["run_timeout_seconds"],
                      _task={"prompt": job["prompt"]}, _guard=guard,
                      _context={"job_id": job["id"], "attempt_id": job["attempt_id"]}, _output=output,
                      payment_state=payment_state, sandbox_key_file=sandbox_key_file, payment_scope_file=payment_scope_file,
                      community_origin=community_origin, collaboration_project=collaboration_project,
                      expected_instance=expected_instance, expected_agent=expected_agent)
        except Problem as problem:
            error = problem.code
        except (OSError, ValueError, http.client.HTTPException):
            error = "JOB_RUN_FAILED"
        finally:
            if output is not None:
                output.close()
            client.deadline = None
        metadata = {"report_sha256": None, "report_bytes": None, "steps": 0}
        if created and report.exists():
            try:
                metadata = report_metadata(report, job)
            except (Problem, KeyError, TypeError, ValueError, OSError):
                error = "JOB_REPORT_UNAVAILABLE"
        payload = {"attempt_id": job["attempt_id"], "claim_token": response["claim_token"],
                   "state": "SUCCEEDED" if error is None else "FAILED", "error_code": error, **metadata}
        if metadata["report_sha256"] is not None:
            progress("REPORT_SAVED", job_id=job["id"], attempt_id=job["attempt_id"], **metadata)
        progress("COMPLETION_STARTED", job_id=job["id"], attempt_id=job["attempt_id"])
        try:
            settled = complete(client, token, job, payload)
            outcomes.append({"job_id": job["id"], "attempt_id": job["attempt_id"], "state": settled["state"],
                             "error_code": settled["error_code"], "report_sha256": settled["report_sha256"],
                             "artifact_id": settled["artifact_id"], "completion_recorded": True})
        except (Problem, OSError, http.client.HTTPException):
            # Credential expiry, stop/lease races or lost transport must never
            # silently requeue a task. A report may exist while settlement is unknown.
            outcomes.append({"job_id": job["id"], "attempt_id": job["attempt_id"], "state": "UNCONFIRMED",
                             "error_code": "JOB_COMPLETION_UNCONFIRMED", "report_sha256": metadata["report_sha256"],
                             "artifact_id": None, "completion_recorded": False})
        progress("JOB_RESULT", **{key: value for key, value in outcomes[-1].items() if key != "error_code"})
        if not outcomes[-1]["completion_recorded"]:
            break
        claim_started = False
    return {"mode": "REMOTE_HTTPS_COMMUNITY" if community_origin else "LOCAL_ONLY", "jobs": outcomes, "processed": len(outcomes),
            "connection_binding": client.binding(),
            "automatic_retry": False, "wallet_execution": "UNAVAILABLE"}
