"""Apply a curve fee only when a trade row has one.

An account row has no fee. It stays unpriced for trading.
"""
from __future__ import annotations

import json


class FeePriceError(ValueError):
    pass


def apply_fee(row: dict) -> dict:
    if row.get("classification") == "ACCOUNT_DECODE_NOT_A_TRADE" or "fee_bps" in row.get("missing", []):
        return {**row, "trade_price": None, "reason": "NO_FEE_ON_ACCOUNT", "action": "NO_EXECUTION"}
    fee = row.get("fee_bps")
    price = row.get("price_quote_per_base")
    if type(fee) is not int or not 0 <= fee <= 10_000 or type(price) not in (int, float) or price <= 0:
        raise FeePriceError("BAD_FEE_ROW")
    return {**row, "trade_price": price * (1 + fee / 10_000), "reason": "FEE_APPLIED", "action": "NO_EXECUTION"}


def self_check() -> dict:
    account = apply_fee({"classification": "ACCOUNT_DECODE_NOT_A_TRADE", "missing": ["fee_bps"], "price_quote_per_base": 0.00002})
    trade = apply_fee({"classification": "CURVE_FIXTURE_NOT_CHAIN_ATTESTED", "missing": [], "fee_bps": 100, "price_quote_per_base": 0.00002})
    if account["trade_price"] is not None or trade["trade_price"] <= 0.00002:
        raise FeePriceError("FEE_MISMATCH")
    return {"account": account["reason"], "trade": trade["trade_price"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
