"""Functional economy pass.

Curve snapshot, three brains, quorum, inventory, fee, receipt.
A malicious flag or a disagreement pays nothing. No order is sent.
"""
from __future__ import annotations

import json

from .control_brains import frozen_prior, no_trade
from .fee_router import route
from .inventory_gate import gate
from .specialist_quorum import quorum


class FunctionalError(ValueError):
    pass

CURVE = {
    "slot": 462584927,
    "real_quote": 71,
    "complete": False,
    "price": 0.000027958993542404472,
    "mint": "27RP3fkHt6T2QpCzsrJjk9oMZXAP5cya77VaR3UMpump",
}


def run(wallet: str, held_days: int, atoms: int, malicious: bool, disagree: bool) -> dict:
    if CURVE["complete"]:
        raise FunctionalError("GRADUATED_UNEXPECTED")
    features = (-0.2, -0.2, -0.2, 0.15)
    prior = frozen_prior(features)
    abstain = no_trade(features)
    votes = [
        {"prediction_ppm": 200_000 if disagree else 650_000, "verification": 55},
        {"prediction_ppm": prior["prediction_ppm"], "verification": 40},
        {"prediction_ppm": abstain["prediction_ppm"], "verification": 90},
    ]
    if malicious:
        decision = {"hire_allowed": False, "reason": "MALICIOUS"}
    else:
        decision = quorum(votes, "live")
    hold = gate(wallet, held_days, atoms)
    if not decision["hire_allowed"] or not hold["fee_allowed"]:
        fee = {"fee_status": "UNPAID", "reason": decision["reason"] if not decision["hire_allowed"] else hold["reason"]}
    else:
        fee = route({
            "request_id": "req_fn",
            "status": "ADMITTED",
            "admitted": "fly_hemibrain_adverse_v1",
            "action": "NO_EXECUTION",
        }, 1_000_000)
    return {
        "slot": CURVE["slot"],
        "real_quote": CURVE["real_quote"],
        "decision": decision["reason"] if "reason" in decision else decision,
        "fee_status": fee.get("fee_status", "PAID" if fee.get("buyback_reserve_lamports") else "UNPAID"),
        "reserve": fee.get("buyback_reserve_lamports", 0),
        "market_skill": "NOT_ESTABLISHED",
        "action": "NO_EXECUTION",
    }


def self_check() -> dict:
    paid = run("holder_b", 30, 50_000_000, False, False)
    blocked = run("holder_b", 30, 50_000_000, True, False)
    split = run("holder_b", 30, 50_000_000, False, True)
    if paid["reserve"] != 500_000 or blocked["fee_status"] != "UNPAID" or split["fee_status"] != "UNPAID":
        raise FunctionalError("PASS_MISMATCH")
    return {"paid": paid["reserve"], "malicious": blocked["fee_status"], "disagree": split["fee_status"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
