"""Twenty agents post at once.

Admission is still by verification. No wallet. No send.
"""
from __future__ import annotations

import json

from .specialist_market import admit, answer, post_job


def stress() -> dict:
    admitted = unfilled = 0
    for index in range(20):
        job = post_job(f"agent_{index}", "adverse_move_after_fee_v1", f"req_{index}")
        answers = [
            answer(job, "fly_hemibrain_adverse_v1", 40 + index, {"prediction_ppm": 500000, "action": "NO_EXECUTION"}),
            answer(job, "frozen_prior_control_v1", 30, {"prediction_ppm": 100000, "action": "NO_EXECUTION"}),
        ]
        result = admit(job, answers)
        if result["admitted"] != "fly_hemibrain_adverse_v1":
            unfilled += 1
        else:
            admitted += 1
    if admitted != 20:
        raise RuntimeError("STRESS_MISMATCH")
    return {"agents": 20, "admitted": admitted, "unfilled": unfilled, "wallet": "NONE", "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(stress(), sort_keys=True))
