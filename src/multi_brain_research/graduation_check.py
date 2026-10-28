"""Graduation check.

A curve that is not complete cannot take a DEX liquidity step.
"""
from __future__ import annotations

import json


def check(decoded: dict) -> dict:
    complete = decoded.get("complete") is True
    return {
        "complete": complete,
        "dex_liquidity_allowed": complete,
        "reason": "GRADUATED" if complete else "STILL_ON_CURVE",
        "action": "NO_EXECUTION",
    }


def self_check() -> dict:
    open_curve = check({"complete": False})
    done = check({"complete": True})
    if open_curve["dex_liquidity_allowed"] or not done["dex_liquidity_allowed"]:
        raise RuntimeError("GRADUATION_MISMATCH")
    return {"open": open_curve["reason"], "done": done["reason"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
