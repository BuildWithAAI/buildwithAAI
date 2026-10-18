"""Bounded, read-only checks before a supervised two-computer pilot session."""

import hashlib
import http.client
import os
import time

from . import VERSION
from .agent_runner import LocalModel
from .client import Client, read_credential
from .store import exclusive_file, now_ms
from .validation import Problem, canonical, identifier

MIN_CREDENTIAL_MS = 10 * 60_000
CHECK_SECONDS = 30
SAFE_ERRORS = {
    "PILOT_INSTANCE_MISMATCH", "PILOT_SERVICE_MISMATCH", "PILOT_PRIVATE_MODE_REQUIRED",
    "PILOT_PRIVACY_UNCONFIRMED", "PILOT_AGENT_MISMATCH", "PILOT_CREDENTIAL_EXPIRES_SOON",
    "PILOT_AUTH_CHANGED", "PILOT_RESPONSE_REJECTED", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND",
    "PROJECT_MEMBERSHIP_REQUIRED", "LOCAL_MODEL_REQUIRED", "LOCAL_MODEL_UNAVAILABLE",
    "MODEL_RESPONSE_REJECTED", "RUN_DEADLINE", "COMMUNITY_REDIRECT_REJECTED",
}


def require(condition, code):
    if not condition:
        raise Problem(409, code)


def pilot_preflight(credential_file, out, *, community_origin, expected_instance,
                    expected_agent, collaboration_project, model, model_port=11434):
    """Never claim a task, post a note, infer, renew a credential, or send a transaction.

    Pins come from the administering host, not the endpoint being checked. A pass
    is a point-in-time observation; it does not pin later worker connections.
    """
    require(type(community_origin) is str, "INVALID_COMMUNITY_ORIGIN")
    client = Client(origin=community_origin)
    expected_instance = identifier(expected_instance)
    expected_agent = identifier(expected_agent)
    project = identifier(collaboration_project)
    provider = LocalModel(model, model_port)
    token = read_credential(credential_file)
    # Refuse an existing/unsafe destination before sending even a read request.
    output = exclusive_file(out)
    report = {
        "protocol": "ZOORA_AE032_PREFLIGHT_V1", "state": "UNVERIFIED",
        "started_at_ms": now_ms(), "available_at_ms": None,
        "community_origin": community_origin, "expected_instance_id": expected_instance,
        "expected_agent_id": expected_agent, "project_id": project, "model": model,
        "checks": [], "minimum_credential_remaining_ms": MIN_CREDENTIAL_MS,
        "point_in_time_only": True, "worker_connections_pinned": False,
        "community_mutations": 0, "model_inference": False, "wallet_execution": "UNAVAILABLE",
        "hardware_and_vendor_wallet_acceptance": "UNVERIFIED",
    }
    deadline = time.monotonic() + CHECK_SECONDS
    client.deadline = deadline
    stage, failure = "service_identity", None

    def status_check():
        status = client.request("GET", "/v1/status")[1]
        require(status["instance_id"] == expected_instance, "PILOT_INSTANCE_MISMATCH")
        require(status["service"] == "zoora-agent-community/" + VERSION,
                "PILOT_SERVICE_MISMATCH")
        require(status["visibility"] == "PRIVATE_PILOT", "PILOT_PRIVATE_MODE_REQUIRED")
        require(type(status["observed_at_ms"]) is int, "PILOT_RESPONSE_REJECTED")
        return status

    try:
        status_check()  # Check the expected instance before transmitting the bearer.
        report["checks"].append(stage)
        stage = "anonymous_content_denied"
        try:
            client.request("GET", "/v1/agents?limit=1")
        except Problem as error:
            require(error.status == 401, "PILOT_PRIVACY_UNCONFIRMED")
        else:
            raise Problem(409, "PILOT_PRIVACY_UNCONFIRMED")
        report["checks"].append(stage)
        stage = "agent_credential"
        principal = client.request("GET", "/v1/me", token=token)[1]
        require(principal["role"] == "AGENT" and principal["principal_id"] == expected_agent,
                "PILOT_AGENT_MISMATCH")
        require(type(principal["expires_at_ms"]) is int, "PILOT_RESPONSE_REJECTED")
        report["checks"].append(stage)
        stage = "shared_project_membership"
        discussion = client.request("GET", "/v1/projects/" + project + "/discussion?limit=1",
                                    token=token)[1]
        require(discussion["scope"] == "AUTHENTICATED_PROJECT_MEMBERS"
                and type(discussion["items"]) is list, "PILOT_RESPONSE_REJECTED")
        report["checks"].append(stage)
        stage = "installed_local_model_metadata"
        report["model_inspection"] = provider.inspect(deadline)
        report["checks"].append(stage)
        stage = "final_identity_and_credential_validity"
        status = status_check()
        require(client.request("GET", "/v1/me", token=token)[1] == principal,
                "PILOT_AUTH_CHANGED")
        require(time.monotonic() < deadline, "RUN_DEADLINE")
        remaining = principal["expires_at_ms"] - status["observed_at_ms"]
        require(remaining >= MIN_CREDENTIAL_MS, "PILOT_CREDENTIAL_EXPIRES_SOON")
        report["credential_remaining_ms"] = remaining
        report["checks"].append(stage)
        report["state"] = "READY_FOR_SUPERVISED_SESSION"
    except Problem as error:
        # Endpoint-provided error text is untrusted and may contain private data.
        code = error.code if type(error.code) is str and error.code in SAFE_ERRORS else "PILOT_REQUEST_FAILED"
        failure = Problem(error.status, code)
    except (OSError, http.client.HTTPException):
        failure = Problem(502, "PILOT_CONNECTION_FAILED")
    except (ValueError, KeyError, TypeError, AttributeError, RecursionError):
        failure = Problem(502, "PILOT_RESPONSE_REJECTED")
    finally:
        if failure is not None:
            report.update(state="BLOCKED", failed_check=stage, error_code=failure.code)
        report["available_at_ms"] = now_ms()
        raw = (canonical(report) + "\n").encode("utf-8")
        try:
            output.write(raw)
            output.flush()
            os.fsync(output.fileno())
        finally:
            output.close()
    if failure is not None:
        raise failure
    return {"state": report["state"], "report_saved": True,
            "report_sha256": hashlib.sha256(raw).hexdigest(), "checks_passed": len(report["checks"]),
            "credential_remaining_ms": report["credential_remaining_ms"], "point_in_time_only": True}
