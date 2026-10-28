"""An abstain cannot create a credit.
"""
from __future__ import annotations

import json


def credit(prediction_ppm: int | None) -> dict:
    if prediction_ppm is None:
        return {"credited": False, "reason": "ABSTAIN", "action": "NO_EXECUTION"}
    return {"credited": True, "action": "NO_EXECUTION"}


def self_check() -> dict:
    body = credit(None)
    if body["credited"]:
        raise RuntimeError("ABSTAIN_CREDITED")
    return body


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
