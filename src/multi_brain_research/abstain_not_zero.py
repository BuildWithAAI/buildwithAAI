"""Board keeps abstain as abstained, never zero.
"""
from __future__ import annotations

import json


def show(prediction_ppm: int | None) -> dict:
    if prediction_ppm is None:
        return {"state": "ABSTAINED", "verification": None, "action": "NO_EXECUTION"}
    return {"state": "ANSWERED", "action": "NO_EXECUTION"}


def self_check() -> dict:
    body = show(None)
    if body["state"] != "ABSTAINED" or body["verification"] == 0:
        raise RuntimeError("ABSTAIN_ZERO")
    return body


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
