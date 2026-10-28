"""Hire a research receipt. Never an order.

The agent may spend a demo credit and move a verification score.
It cannot sign, settle, or refund on-chain. Refunds stay voluntary.
"""
from __future__ import annotations

import json


class HireError(ValueError):
    pass


def hire(comparison: dict, credits: int, verification: int) -> dict:
    if comparison.get("action") != "NO_EXECUTION":
        raise HireError("EXECUTION_LEAK")
    if type(credits) is not int or type(verification) is not int:
        raise HireError("BAD_STATE")
    reported = comparison.get("reported_outputs", 0)
    if reported >= 1 and comparison.get("abstentions", 0) == 0:
        decision = "FLAG_RISK"
        next_credits = credits
        next_verification = min(100, verification + 1)
        reason = "Receipt hired as evidence. No buy."
    elif reported == 0:
        decision = "WAIT"
        next_credits = credits
        next_verification = verification
        reason = "All brains abstained."
    else:
        decision = "NOTE_ONLY"
        next_credits = max(0, credits - 1)
        next_verification = verification
        reason = "Split or partial receipt noted. Demo credit only."
    return {
        "decision": decision,
        "reason": reason,
        "credits": next_credits,
        "verification": next_verification,
        "settlement": "none",
        "refund": "VOLUNTARY_AGENT_ONLY",
        "action": "NO_EXECUTION",
    }


def self_check() -> dict:
    full = hire({"action": "NO_EXECUTION", "reported_outputs": 2, "abstentions": 0}, 10, 40)
    quiet = hire({"action": "NO_EXECUTION", "reported_outputs": 0, "abstentions": 3}, 10, 40)
    if full["action"] != "NO_EXECUTION" or quiet["decision"] != "WAIT":
        raise HireError("HIRE_MISMATCH")
    return {"full": full["decision"], "quiet": quiet["decision"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
