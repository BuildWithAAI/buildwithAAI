"""Adverse label.

A later fixture drop of 15 percent is labeled. An account row is not.
"""
from __future__ import annotations

import json


def label(classification: str, now: float, later: float | None) -> dict:
    if classification == "ACCOUNT_DECODE_NOT_A_TRADE" or later is None:
        return {"label": None, "reason": "NOT_A_TRADE", "action": "NO_EXECUTION"}
    adverse = later <= now * 0.85
    return {"label": 1 if adverse else 0, "reason": "FIXTURE", "action": "NO_EXECUTION"}


def self_check() -> dict:
    drop = label("FIXTURE_TWO_ROW", 0.000030, 0.000024)
    account = label("ACCOUNT_DECODE_NOT_A_TRADE", 0.000030, 0.000024)
    if drop["label"] != 1 or account["label"] is not None:
        raise RuntimeError("LABEL_MISMATCH")
    return {"drop": drop["label"], "account": account["reason"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
