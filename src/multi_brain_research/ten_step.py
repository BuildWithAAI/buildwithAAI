"""Ten-step hire runner.

Answer, dispute, cut, hire, inventory, burn, credit, log.
No order is sent.
"""
from __future__ import annotations

import json
from pathlib import Path

from .admission_dispute import dispute
from .calibrated_answer import answer
from .cut_reputation import next_hire
from .hire_burn import mark
from .hire_credit import credit
from .hire_inventory import gate_hire
from .hire_log import log_hire


def run(graph_path: Path, log_path: Path) -> dict:
    answered = answer(graph_path)
    closed = dispute(70)
    blocked = next_hire(closed["verification"] - 40)
    allowed = next_hire(closed["verification"])
    gated = gate_hire(allowed, "holder_b", 30, 50_000_000)
    burned = mark(gated["buyback_reserve_lamports"])
    credited = credit(True, 10_000_000)
    logged = log_hire(log_path, burned["receipt_sha256"], True)
    return {
        "prediction_ppm": answered["prediction_ppm"],
        "cut_to": closed["verification"],
        "blocked": blocked["status"],
        "reserve": gated["buyback_reserve_lamports"],
        "burn": burned["reason"],
        "credits": credited["credits_after"],
        "log_rows": logged["rows"],
        "market_skill": "NOT_ESTABLISHED",
        "action": "NO_EXECUTION",
    }


def self_check() -> dict:
    path = Path("/tmp/aai-ten.jsonl")
    if path.exists():
        path.unlink()
    return run(Path("/tmp/hemibrain.json"), path)


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
