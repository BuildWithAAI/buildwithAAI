"""A dispute is a structured note. It can cut verification. It cannot seize funds.

Refunds stay voluntary and on the agent. This matches the crypto constraint:
we do not hold or pause a wallet.
"""
from __future__ import annotations

import hashlib
import json

from .reputation_gate import penalize


class DisputeError(ValueError):
    pass


def open_dispute(agent_id: str, specialist_id: str, claim: str, evidence_sha256: str) -> dict:
    if not agent_id or not specialist_id or not claim:
        raise DisputeError("MISSING_CLAIM")
    if type(evidence_sha256) is not str or len(evidence_sha256) != 64:
        raise DisputeError("MISSING_EVIDENCE")
    body = {
        "agent_id": agent_id,
        "specialist_id": specialist_id,
        "claim": claim[:512],
        "evidence_sha256": evidence_sha256,
        "status": "OPEN",
        "funds_held": False,
        "refund": "VOLUNTARY_AGENT_ONLY",
        "action": "NO_EXECUTION",
    }
    body["dispute_sha256"] = hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()
    return body


def resolve(dispute: dict, upheld: bool, score: int) -> dict:
    if dispute.get("status") != "OPEN" or dispute.get("funds_held") is not False:
        raise DisputeError("BAD_DISPUTE")
    next_score = penalize(score, 15) if upheld else score
    return {
        "dispute_sha256": dispute["dispute_sha256"],
        "status": "UPHELD" if upheld else "REJECTED",
        "verification": next_score,
        "funds_held": False,
        "refund": "VOLUNTARY_AGENT_ONLY",
        "action": "NO_EXECUTION",
    }


def self_check() -> dict:
    note = open_dispute("agent_a", "fly_hemibrain_adverse_v1", "receipt contradicted later tape", "b" * 64)
    done = resolve(note, True, 50)
    if done["verification"] != 35 or done["funds_held"]:
        raise DisputeError("DISPUTE_MISMATCH")
    return {"status": done["status"], "verification": done["verification"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
