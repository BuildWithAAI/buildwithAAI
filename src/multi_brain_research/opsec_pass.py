"""One OPSEC pass over a research record and a proposed download.

Fails closed. Does not open a network. Does not claim the host is safe.
"""
from __future__ import annotations

import json

from .artifact_gate import classify
from .opsec_policy import assert_research
from .secret_redact import redact


def pass_record(record: dict, download: dict | None = None) -> dict:
    clean = redact(record)
    assert_research(clean)
    artifact = None
    if download is not None:
        artifact = classify(download["name"], download["size"], download["mime"])
    return {
        "record": clean,
        "artifact": artifact,
        "claim": "DEFENSE_IN_DEPTH_NOT_IMPENETRABLE",
        "host_still_trusted": True,
        "action": "NO_EXECUTION",
    }


def self_check() -> dict:
    result = pass_record(
        {"action": "NO_EXECUTION", "wallet_execution": "UNAVAILABLE", "token": "ghp_abcdefghijklmnopqrstuvwxyz"},
        {"name": "tape.json", "size": 64, "mime": "application/json"},
    )
    if result["record"]["token"] != "[REDACTED]" or result["artifact"]["executable"]:
        raise RuntimeError("OPSEC_PASS_FAILED")
    return {"claim": result["claim"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
