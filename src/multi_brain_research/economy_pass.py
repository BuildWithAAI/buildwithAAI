"""One economy pass.

Post a job, admit or leave it unfilled, gate the hold, route the fee,
and chain the receipt. No order is sent.
"""
from __future__ import annotations

import json

from .gated_router import route_if_held
from .receipt_chain import chain
from .specialist_market import admit, answer, post_job


def run(agent_id: str, wallet: str, held_days: int, atoms: int, fee_lamports: int, answers: list[dict]) -> dict:
    job = post_job(agent_id, "adverse_move_after_fee_v1", "req_pass_1")
    posted = [answer(job, item["specialist_id"], item["verification"], item["receipt"]) for item in answers]
    admission = admit(job, posted)
    if admission["status"] != "ADMITTED":
        admission = {**admission, "action": "NO_EXECUTION"}
    routed = route_if_held(admission, fee_lamports, wallet, held_days, atoms)
    linked = chain(admission, routed)
    return {
        "admission": admission,
        "routed_status": routed.get("status") or routed.get("fee_status"),
        "chain": linked,
        "market_skill": "NOT_ESTABLISHED",
        "action": "NO_EXECUTION",
    }


def self_check() -> dict:
    filled = run(
        "agent_a",
        "holder_b",
        30,
        50_000_000,
        1_000_000,
        [{"specialist_id": "fly_hemibrain_adverse_v1", "verification": 70, "receipt": {"prediction_ppm": 620000, "action": "NO_EXECUTION"}}],
    )
    empty = run("agent_a", "holder_b", 30, 50_000_000, 1_000_000, [])
    if not filled["chain"]["paid"] or empty["chain"]["paid"]:
        raise RuntimeError("PASS_MISMATCH")
    return {"filled": filled["chain"]["paid"], "empty": empty["chain"]["paid"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
