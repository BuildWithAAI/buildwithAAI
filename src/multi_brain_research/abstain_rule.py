"""Abstain rule.

An account row always abstains. A fixture row may answer.
"""
from __future__ import annotations

import json


def decide(classification: str, prediction_ppm: int | None) -> dict:
    if classification == "ACCOUNT_DECODE_NOT_A_TRADE":
        return {"abstain": True, "prediction_ppm": None, "reason": "ACCOUNT_MUST_ABSTAIN", "action": "NO_EXECUTION"}
    if classification != "FIXTURE_TWO_ROW":
        raise ValueError("UNKNOWN_CLASS")
    return {
        "abstain": prediction_ppm is None,
        "prediction_ppm": prediction_ppm,
        "reason": "FIXTURE_MAY_ANSWER",
        "action": "NO_EXECUTION",
    }


def self_check() -> dict:
    account = decide("ACCOUNT_DECODE_NOT_A_TRADE", 800_000)
    fixture = decide("FIXTURE_TWO_ROW", 620_000)
    if not account["abstain"] or account["prediction_ppm"] is not None or fixture["abstain"]:
        raise RuntimeError("ABSTAIN_MISMATCH")
    return {"account": account["reason"], "fixture": fixture["prediction_ppm"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
