"""The other AAI mint is refused.
"""
from __future__ import annotations

import json

TOKEN = "27RP3fkHt6T2QpCzsrJjk9oMZXAP5cya77VaR3UMpump"
OTHER = "4YfDqzLR2NRLcx4V4VEuhjN2Z1BS3T1aokwNQygDpump"


def hire(mint: str) -> dict:
    if mint != TOKEN:
        return {"fee_status": "UNPAID", "reason": "OTHER_MINT", "action": "NO_EXECUTION"}
    return {"fee_status": "PAID", "action": "NO_EXECUTION"}


def self_check() -> dict:
    body = hire(OTHER)
    if body["fee_status"] != "UNPAID" or hire(TOKEN)["fee_status"] != "PAID":
        raise RuntimeError("MINT_MISMATCH")
    return body


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
