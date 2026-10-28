"""Feed a curve tape row into the closed pass.

The row must be this mint. It is evidence for the hire, not an order.
"""
from __future__ import annotations

import json

from .closed_pass import close
from .curve_tape import to_tape
from .inventory_gate import TOKEN


def run_with_tape(event: dict, log_path, credits: int = 10_000_000) -> dict:
    tape = to_tape(event)
    if tape is None:
        return {"tape": None, "paid": False, "reason": "TAPE_REFUSED", "action": "NO_EXECUTION"}
    result = close(
        "agent_a",
        "holder_b",
        [{"mint": TOKEN, "amount": 50_000_000}],
        30,
        1_000_000,
        [{"specialist_id": "fly_hemibrain_adverse_v1", "verification": 70,
          "receipt": {"prediction_ppm": 620000, "action": "NO_EXECUTION", "tape_slot": tape["slot"]}}],
        credits,
        log_path,
    )
    result["tape_slot"] = tape["slot"]
    return result


def self_check() -> dict:
    from pathlib import Path
    path = Path("/tmp/aai-tape-pass.jsonl")
    if path.exists():
        path.unlink()
    result = run_with_tape({
        "mint": TOKEN,
        "curve_account": "Eq93BkkDVBLkjgHxZU6qVk7hrnzTnAyVfCNrXCVix1PL",
        "virtual_reserves": {"base": 1_000_000, "quote": 1_000},
        "real_reserves": {"base": 1, "quote": 1},
        "fee_bps": 100,
        "slot": 9,
        "signature": "sig",
    }, path)
    if result.get("tape_slot") != 9 or not result.get("paid"):
        raise RuntimeError("TAPE_PASS_MISMATCH")
    return {"slot": result["tape_slot"], "paid": result["paid"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
