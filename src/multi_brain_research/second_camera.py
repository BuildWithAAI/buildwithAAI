"""Second camera data: price, real SOL reserve, complete flag.
"""
from __future__ import annotations

import json

SECOND = {
    "price_quote_per_base": 0.000027958993542404472,
    "real_sol_lamports": 71,
    "complete": False,
    "classification": "ACCOUNT_DECODE_NOT_A_TRADE",
}


def camera() -> dict:
    if SECOND["complete"]:
        raise RuntimeError("COMPLETE_WRONG")
    return {**SECOND, "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(camera(), sort_keys=True))
