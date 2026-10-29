"""A tape older than 10,000 slots abstains.
"""
from __future__ import annotations

import json

WINDOW = 10_000


def read(tape_slot: int, live_slot: int) -> dict:
    if live_slot - tape_slot > WINDOW:
        return {"prediction_ppm": None, "reason": "OLD_TAPE", "action": "NO_EXECUTION"}
    return {"prediction_ppm": 650_000, "action": "NO_EXECUTION"}


def self_check() -> dict:
    body = read(1, 20_000)
    if body["prediction_ppm"] is not None:
        raise RuntimeError("OLD_TAPE_ANSWERED")
    return body


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
