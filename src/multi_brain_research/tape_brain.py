"""TEST_FIXTURE. Not a paper-trading council member.

The tape brain reads the last captured row. Market rows are inputs to the
council. This module does not cast a council vote.

A missing file abstains. A row without a price history, flow, or liquidity
change abstains. The score is the paper-long heuristic in brain_input.
It is not a fixed prediction.
"""
from __future__ import annotations

import json
from pathlib import Path

from .brain_input import features, paper_long_support

ROLE = "TEST_FIXTURE"


def read(path: Path) -> dict:
    if not path.exists() or not path.read_text().strip():
        return {"prediction_ppm": None, "reason": "NO_TAPE", "action": "NO_EXECUTION"}
    row = json.loads(path.read_text().splitlines()[-1])
    slot = row.get("slot") if type(row) is dict else None
    try:
        mapped = features(row)
    except ValueError as error:
        return {"prediction_ppm": None, "reason": str(error), "slot": slot, "action": "NO_EXECUTION"}
    scored = paper_long_support(mapped)
    if scored["prediction_ppm"] is None:
        return {
            "prediction_ppm": None,
            "reason": "INSUFFICIENT_TAPE",
            "slot": slot,
            "missing": mapped["missing"],
            "action": "NO_EXECUTION",
        }
    return {
        "prediction_ppm": scored["prediction_ppm"],
        "uncertainty_ppm": scored["uncertainty_ppm"],
        "slot": slot,
        "features": mapped["features"],
        "reason": "TAPE_HEURISTIC",
        "action": "NO_EXECUTION",
    }


def self_check() -> dict:
    missing = read(Path("/tmp/aai-missing-tape.jsonl"))
    if missing["prediction_ppm"] is not None or missing["reason"] != "NO_TAPE":
        raise RuntimeError("MISSING_TAPE_ANSWERED")
    return missing


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
