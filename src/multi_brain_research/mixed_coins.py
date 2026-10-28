"""Twenty mixed coins.

Dead refused. Live only on quorum.
"""
from __future__ import annotations

import json

from .answer_quorum import need_two
from .dead_veto import veto


def run() -> dict:
    refused = hired = 0
    for index in range(20):
        fate = "dead" if index < 10 else "live"
        votes = [{"prediction_ppm": 700_000}, {"prediction_ppm": 650_000}, {"prediction_ppm": None}]
        if fate == "dead" or not need_two(votes)["hire_allowed"]:
            refused += 1
            continue
        if veto(fate, True)["hire_allowed"]:
            hired += 1
    if refused != 10 or hired != 10:
        raise RuntimeError("MIX_MISMATCH")
    return {"refused": refused, "hired": hired, "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(run(), sort_keys=True))
