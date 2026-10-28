"""Curve price from virtual reserves.

Quote over base. A zero base is refused. This is not a trade price.
"""
from __future__ import annotations

import json


class PriceError(ValueError):
    pass


def price(virtual_reserves: dict) -> dict:
    base = virtual_reserves.get("base")
    quote = virtual_reserves.get("quote")
    if type(base) is not int or type(quote) is not int or base < 0 or quote < 0:
        raise PriceError("BAD_RESERVES")
    if base == 0:
        raise PriceError("ZERO_BASE")
    return {
        "price_quote_per_base": quote / base,
        "base": base,
        "quote": quote,
        "source": "VIRTUAL_RESERVES",
        "action": "NO_EXECUTION",
    }


def self_check() -> dict:
    good = price({"base": 1_073_000_000_000_000, "quote": 30_000_000_071})
    try:
        price({"base": 0, "quote": 1})
    except PriceError as err:
        if str(err) != "ZERO_BASE":
            raise
        refused = True
    else:
        refused = False
    if not refused or good["price_quote_per_base"] <= 0:
        raise PriceError("PRICE_MISMATCH")
    return {"price": good["price_quote_per_base"], "zero_refused": refused, "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
