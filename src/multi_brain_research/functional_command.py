"""One functional command.

Live curve, council, sandbox, inventory, fee, and claim log.
"""
from __future__ import annotations

import json
from pathlib import Path

from .claim_log import append
from .live_pass import run_live
from .sandbox_council import vote_with_sandbox


def run(endpoint: str, handle: str, log_path: Path, rejected: bool = False) -> dict:
    council = vote_with_sandbox((-0.2, -0.2, -0.2, 0.15), rejected)
    passed = run_live(endpoint, "holder_b", 30, 50_000_000)
    if not council["hire_allowed"]:
        passed["fee_status"] = "UNPAID"
        passed["reserve"] = 0
        passed["reason"] = council["reason"]
    claimed = append(log_path, handle)
    return {
        "slot": passed.get("slot"),
        "council": council["reason"],
        "fee_status": passed.get("fee_status"),
        "reserve": passed.get("reserve", 0),
        "handle": claimed.get("handle"),
        "claimed": claimed.get("claimed"),
        "action": "NO_EXECUTION",
    }


def self_check() -> dict:
    path = Path("/tmp/aai-fn.jsonl")
    if path.exists():
        path.unlink()
    body = run("https://api.mainnet-beta.solana.com", "@ada", path)
    if body["reserve"] != 500_000 or not body["claimed"]:
        raise RuntimeError("COMMAND_MISMATCH")
    return body


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
