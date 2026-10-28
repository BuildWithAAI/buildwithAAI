"""Use a brain receipt as the specialist answer.

Admission is by verification. The prediction does not decide the hire.
"""
from __future__ import annotations

import json

from .specialist_market import admit, answer, post_job


def hire(prediction_ppm: int | None, verification: int) -> dict:
    job = post_job("agent_a", "adverse_move_after_fee_v1", "req_receipt")
    receipt = {"prediction_ppm": prediction_ppm, "action": "NO_EXECUTION"}
    posted = answer(job, "fly_hemibrain_adverse_v1", verification, receipt)
    result = admit(job, [posted])
    result["used_prediction"] = False
    result["market_skill"] = "NOT_ESTABLISHED"
    return result


def self_check() -> dict:
    high_pred_low_score = hire(900_000, 10)
    low_pred_high_score = hire(100_000, 70)
    if high_pred_low_score["status"] != "UNFILLED" or low_pred_high_score["admitted"] != "fly_hemibrain_adverse_v1":
        raise RuntimeError("RECEIPT_HIRE_MISMATCH")
    return {
        "low_score": high_pred_low_score["status"],
        "high_score": low_pred_high_score["admitted"],
        "action": "NO_EXECUTION",
    }


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
