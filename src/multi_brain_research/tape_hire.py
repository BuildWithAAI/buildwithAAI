"""Brain votes plus a tape row can hire. No tape cannot.
"""
from __future__ import annotations

import json
from pathlib import Path

from .council_brains import accept
from .tape_brain import read


def hire(path: Path) -> dict:
    tape = read(path)
    if tape["prediction_ppm"] is None:
        return {"hire_allowed": False, "reason": tape["reason"], "action": "NO_EXECUTION"}
    votes = [{"source": "brain", "prediction_ppm": tape["prediction_ppm"]}]
    return accept(votes)


def self_check() -> dict:
    missing = hire(Path("/tmp/aai-no-tape.jsonl"))
    slot_only = Path("/tmp/aai-slot-only-tape.jsonl")
    slot_only.write_text(json.dumps({"slot": 1}) + "\n")
    bare = hire(slot_only)
    path = Path("/tmp/aai-yes-tape.jsonl")
    path.write_text(json.dumps({
        "slot": 2,
        "price_quote_per_base": 1.1,
        "previous_price": 1.0,
        "buy_quote_atoms": 4,
        "sell_quote_atoms": 1,
        "liquidity_quote": 120,
        "previous_liquidity_quote": 100,
    }) + "\n")
    present = hire(path)
    if missing["hire_allowed"] or bare["hire_allowed"] or not present["hire_allowed"]:
        raise RuntimeError("TAPE_HIRE_MISMATCH")
    return {"missing": missing["reason"], "bare": bare["reason"], "present": present["votes"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
