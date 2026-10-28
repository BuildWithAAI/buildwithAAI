"""One answering brain cannot hire.

Two abstentions block it.
"""
from __future__ import annotations

import json

from .answer_quorum import need_two


def run() -> dict:
    body = need_two([{"prediction_ppm": 700_000}, {"prediction_ppm": None}, {"prediction_ppm": None}])
    if body["hire_allowed"]:
        raise RuntimeError("THIN_PAID")
    return {"fee_status": "UNPAID", "reason": body["reason"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(run(), sort_keys=True))
