"""Specialist market.

An agent posts a research job. Registered brains answer with a receipt.
Admission is by verification score. Loudness is ignored. No order is sent.
"""
from __future__ import annotations

import hashlib
import json

from .reputation_gate import gate
from .specialist_registry import get, register


class MarketError(ValueError):
    pass


def post_job(agent_id: str, task: str, request_id: str) -> dict:
    if not agent_id or not task or not request_id:
        raise MarketError("MISSING_JOB")
    return {
        "request_id": request_id,
        "agent_id": agent_id,
        "task": task,
        "status": "OPEN",
        "wallet_execution": "UNAVAILABLE",
        "action": "NO_EXECUTION",
    }


def answer(job: dict, specialist_id: str, verification: int, receipt: dict) -> dict:
    if job.get("status") != "OPEN" or job.get("action") != "NO_EXECUTION":
        raise MarketError("JOB_CLOSED")
    if receipt.get("action") != "NO_EXECUTION":
        raise MarketError("EXECUTION_LEAK")
    if type(verification) is not int or not 0 <= verification <= 100:
        raise MarketError("BAD_SCORE")
    return {
        "request_id": job["request_id"],
        "specialist_id": specialist_id,
        "verification": verification,
        "receipt_sha256": hashlib.sha256(json.dumps(receipt, sort_keys=True).encode()).hexdigest(),
        "abstained": receipt.get("prediction_ppm") is None,
        "action": "NO_EXECUTION",
    }


def admit(job: dict, answers: list[dict], floor: int = 40) -> dict:
    registry = register()
    eligible = []
    for item in answers:
        specialist = get(registry, item["specialist_id"])
        if specialist["task"] != job["task"]:
            continue
        decision = gate(item["verification"], max(floor, specialist["verification_floor"]))
        if decision["hire_allowed"] and not item["abstained"]:
            eligible.append(item)
    if not eligible:
        return {
            "request_id": job["request_id"],
            "status": "UNFILLED",
            "admitted": None,
            "reason": "NO_ELIGIBLE_RECEIPT",
            "action": "NO_EXECUTION",
        }
    winner = sorted(eligible, key=lambda item: (-item["verification"], item["specialist_id"]))[0]
    return {
        "request_id": job["request_id"],
        "status": "ADMITTED",
        "admitted": winner["specialist_id"],
        "verification": winner["verification"],
        "reason": "HIGHEST_VERIFICATION",
        "settlement": "none",
        "action": "NO_EXECUTION",
    }


def self_check() -> dict:
    job = post_job("agent_a", "adverse_move_after_fee_v1", "req_market_1")
    answers = [
        answer(job, "no_trade_control_v1", 90, {"prediction_ppm": None, "action": "NO_EXECUTION"}),
        answer(job, "frozen_prior_control_v1", 55, {"prediction_ppm": 300000, "action": "NO_EXECUTION"}),
        answer(job, "fly_hemibrain_adverse_v1", 70, {"prediction_ppm": 620000, "action": "NO_EXECUTION"}),
    ]
    result = admit(job, answers)
    if result["admitted"] != "fly_hemibrain_adverse_v1" or result["action"] != "NO_EXECUTION":
        raise MarketError("ADMISSION_MISMATCH")
    return result


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
