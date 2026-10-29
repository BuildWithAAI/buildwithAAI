"""Fresh tape hires. Old tape does not.
"""
from __future__ import annotations

import json

from .old_tape import read


def self_check() -> dict:
    fresh = read(100, 100)
    old = read(1, 20_000)
    if fresh["prediction_ppm"] is None or old["prediction_ppm"] is not None:
        raise RuntimeError("TAPE_AGE_MISMATCH")
    return {"fresh": "HIRE", "old": old["reason"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
