"""Feed a supplied curve fixture into the closed demo-credit pass.

The row must be this pair. It cannot establish chain provenance, a holding
period, paid eligibility or a real settlement. No order is sent.
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
    result["classification"] = tape["classification"]
    result["event_sha256"] = tape["event_sha256"]
    result["settlement_classification"] = "DEMO_CREDITS_ONLY"
    result["quote_unit"] = "MICRO_DEMO_USD"
    result["financial_execution"] = False
    return result


def self_check() -> dict:
    from pathlib import Path
    from tempfile import TemporaryDirectory
    with TemporaryDirectory(prefix="aai-tape-pass-") as folder:
        result = run_with_tape({
            "mint": TOKEN,
            "curve_account": "Eq93BkkDVBLkjgHxZU6qVk7hrnzTnAyVfCNrXCVix1PL",
            "virtual_reserves": {"base": 1_000_000, "quote": 1_000},
            "real_reserves": {"base": 1, "quote": 1},
            "fee_bps": 100,
            "slot": 9,
            "signature": "sig",
        }, Path(folder) / "demo.jsonl")
    if result.get("tape_slot") != 9 or not result.get("paid"):
        raise RuntimeError("TAPE_PASS_MISMATCH")
    return {"slot": result["tape_slot"], "paid": result["paid"], "action": "NO_EXECUTION",
            "classification": result["classification"], "quote_unit": result["quote_unit"],
            "financial_execution": False}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
