"""One hire pass.

Tape, score, abstain rule, hire, and fee route. No order.
"""
from __future__ import annotations

import json
from pathlib import Path

from .abstain_rule import decide
from .brain_score import score
from .fee_router import route
from .receipt_hire import hire


def run(graph_path: Path) -> dict:
    row = {"price_quote_per_base": 0.00002796, "classification": "ACCOUNT_DECODE_NOT_A_TRADE"}
    body = score(row, graph_path)
    ruled = decide(row["classification"], body["prediction_ppm"])
    admission = hire(ruled["prediction_ppm"], 70)
    if admission["status"] != "ADMITTED":
        return {"admission": admission, "fee": None, "action": "NO_EXECUTION"}
    fee = route(admission, 1_000_000)
    return {"admission": admission["admitted"], "fee_reserve": fee["buyback_reserve_lamports"], "action": "NO_EXECUTION"}


def self_check() -> dict:
    result = run(Path("/tmp/hemibrain.json"))
    if result["fee_reserve"] != 500_000:
        raise RuntimeError("HIRE_PASS_MISMATCH")
    return result


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
