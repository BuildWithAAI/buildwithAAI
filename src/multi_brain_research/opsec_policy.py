"""OPSEC rules for the research joint.

This is a policy, not a guarantee. A privileged host can still bypass it.
No module here may sign, settle, hold funds, or claim the system is impenetrable.
"""
from __future__ import annotations

RULES = {
    "execution": "NO_EXECUTION",
    "wallet_signing": "FORBIDDEN",
    "fund_hold": "FORBIDDEN",
    "secret_in_receipt": "FORBIDDEN",
    "raw_executable_download": "FORBIDDEN",
    "network_from_research_module": "FORBIDDEN",
    "refund": "VOLUNTARY_AGENT_ONLY",
    "claim": "DEFENSE_IN_DEPTH_NOT_IMPENETRABLE",
}

FORBIDDEN_ACTIONS = {"SIGN", "SETTLE", "SEND", "HOLD_FUNDS", "EXECUTE"}


class PolicyError(ValueError):
    pass


def assert_research(record: dict) -> dict:
    if record.get("action") != "NO_EXECUTION":
        raise PolicyError("EXECUTION_LEAK")
    if record.get("execution_allowed") is True or record.get("wallet_execution") not in (None, "UNAVAILABLE"):
        raise PolicyError("WALLET_LEAK")
    if record.get("funds_held") is True:
        raise PolicyError("FUND_HOLD")
    return {"accepted": True, "rules": RULES, "action": "NO_EXECUTION"}


def self_check() -> dict:
    assert_research({"action": "NO_EXECUTION", "wallet_execution": "UNAVAILABLE", "funds_held": False})
    try:
        assert_research({"action": "SEND"})
    except PolicyError as err:
        if str(err) != "EXECUTION_LEAK":
            raise
    else:
        raise PolicyError("SEND_ACCEPTED")
    return {"claim": RULES["claim"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    import json
    print(json.dumps(self_check(), sort_keys=True))
