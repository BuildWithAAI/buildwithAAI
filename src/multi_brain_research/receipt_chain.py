"""Hash chain for one hire.

Admission, fee split, and burn receipt share one request id.
Each step pins the hash of the step before it.
"""
from __future__ import annotations

import hashlib
import json

from .burn_receipt import receipt


def _pin(body: dict) -> str:
    return hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()


def chain(admission: dict, routed: dict) -> dict:
    if admission["request_id"] != routed["request_id"]:
        raise ValueError("REQUEST_MISMATCH")
    if routed.get("fee_status") == "UNPAID" or routed.get("status") in {"UNFILLED", "HELD_REFUSED"}:
        body = {
            "request_id": admission["request_id"],
            "admission_sha256": _pin(admission),
            "route_sha256": _pin(routed),
            "burn_sha256": None,
            "linked": True,
            "paid": False,
            "action": "NO_EXECUTION",
        }
        body["chain_sha256"] = _pin(body)
        return body
    burn = receipt(routed, routed["buyback_reserve_lamports"])
    body = {
        "request_id": admission["request_id"],
        "admission_sha256": _pin(admission),
        "route_sha256": _pin(routed),
        "burn_sha256": burn["receipt_sha256"],
        "linked": True,
        "paid": True,
        "action": "NO_EXECUTION",
    }
    body["chain_sha256"] = _pin(body)
    return body


def self_check() -> dict:
    admission = {"request_id": "req_chain", "status": "ADMITTED", "action": "NO_EXECUTION"}
    routed = {
        "request_id": "req_chain",
        "token": "27RP3fkHt6T2QpCzsrJjk9oMZXAP5cya77VaR3UMpump",
        "buyback_reserve_lamports": 500_000,
        "action": "NO_EXECUTION",
    }
    linked = chain(admission, routed)
    if not linked["paid"] or linked["burn_sha256"] is None:
        raise RuntimeError("CHAIN_MISMATCH")
    return {"paid": linked["paid"], "linked": linked["linked"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
