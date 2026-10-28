"""Twenty agents with only abstentions.

Every job stays unfilled. No fee is paid.
"""
from __future__ import annotations

import json

from .specialist_market import admit, answer, post_job
from .unfilled_job import close_unfilled


def stress() -> dict:
    unfilled = paid = 0
    for index in range(20):
        job = post_job(f"agent_{index}", "adverse_move_after_fee_v1", f"req_abs_{index}")
        answers = [
            answer(job, "no_trade_control_v1", 90, {"prediction_ppm": None, "action": "NO_EXECUTION"}),
        ]
        admission = admit(job, answers)
        closed = close_unfilled(admission, 1_000_000)
        if admission["status"] != "UNFILLED" or closed["fee_status"] != "UNPAID":
            paid += 1
        else:
            unfilled += 1
    if unfilled != 20 or paid:
        raise RuntimeError("UNFILLED_STRESS_MISMATCH")
    return {"agents": 20, "unfilled": unfilled, "paid": paid, "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(stress(), sort_keys=True))
