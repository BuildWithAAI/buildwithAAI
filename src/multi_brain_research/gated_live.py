"""Live pass with every gate.

One failed gate leaves the hire unpaid.
"""
from __future__ import annotations

import json

from .gated_agents import passes
from .live_pass import run_live


def run(agent: dict, endpoint: str) -> dict:
    if not passes(agent):
        return {"fee_status": "UNPAID", "reason": "GATE", "action": "NO_EXECUTION"}
    body = run_live(endpoint, "holder_b", 30, 50_000_000)
    body["reason"] = "ALL_GATES"
    return body


def self_check() -> dict:
    blocked = run({"curve": False, "sandbox": False, "dead": False, "vault": False, "answers": 2, "agree": True, "reserve": 500_000, "complete": False, "mint_ok": True}, "https://api.mainnet-beta.solana.com")
    if blocked["fee_status"] != "UNPAID":
        raise RuntimeError("GATE_PAID")
    return blocked


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
