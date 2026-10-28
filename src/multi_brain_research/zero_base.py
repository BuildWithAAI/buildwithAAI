"""A zero base reserve is refused.
"""
from __future__ import annotations

import json

from .curve_price import PriceError, price


def run() -> dict:
    try:
        price({"base": 0, "quote": 1})
    except PriceError as err:
        return {"reason": str(err), "action": "NO_EXECUTION"}
    raise RuntimeError("ZERO_PRICED")


if __name__ == "__main__":
    print(json.dumps(run(), sort_keys=True))
