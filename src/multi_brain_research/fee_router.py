"""Fee router for an admitted specialist hire.

Half of a collected fee is operating SOL. Half is reserved to buy and burn
Anything AI on its own curve. Zero fee means zero burn. No order is sent.
"""
from __future__ import annotations

import json

TOKEN = "27RP3fkHt6T2QpCzsrJjk9oMZXAP5cya77VaR3UMpump"
CURVE = "Eq93BkkDVBLkjgHxZU6qVk7hrnzTnAyVfCNrXCVix1PL"
OTHER_AAI = "4YfDqzLR2NRLcx4V4VEuhjN2Z1BS3T1aokwNQygDpump"


class FeeError(ValueError):
    pass


def route(admission: dict, fee_lamports: int) -> dict:
    if admission.get("action") != "NO_EXECUTION" or admission.get("status") != "ADMITTED":
        raise FeeError("NOT_ADMITTED")
    if type(fee_lamports) is not int or fee_lamports < 0:
        raise FeeError("BAD_FEE")
    if fee_lamports == 0:
        operating = reserved = 0
    else:
        reserved = fee_lamports // 2
        operating = fee_lamports - reserved
    return {
        "request_id": admission["request_id"],
        "admitted": admission["admitted"],
        "token": TOKEN,
        "curve": CURVE,
        "not_this_token": OTHER_AAI,
        "fee_lamports": fee_lamports,
        "operating_lamports": operating,
        "buyback_reserve_lamports": reserved,
        "burn_source": "HIRE_FEE_ONLY",
        "burn_executed": False,
        "settlement": "none",
        "action": "NO_EXECUTION",
    }


def self_check() -> dict:
    admission = {
        "request_id": "req_market_1",
        "status": "ADMITTED",
        "admitted": "fly_hemibrain_adverse_v1",
        "action": "NO_EXECUTION",
    }
    paid = route(admission, 1_000_000)
    empty = route(admission, 0)
    if paid["buyback_reserve_lamports"] != 500_000 or empty["burn_executed"] or paid["token"] == OTHER_AAI:
        raise FeeError("ROUTE_MISMATCH")
    return {"paid_reserve": paid["buyback_reserve_lamports"], "empty_reserve": empty["buyback_reserve_lamports"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
