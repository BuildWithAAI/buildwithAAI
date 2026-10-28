"""Five labeled dead-coin fixtures.

These are synthetic. They let the binder run before a host capture.
A missing dead coin still refuses the set.
"""
from __future__ import annotations

import json

DEAD = (
    {"mint": "dead_graduated_01", "reason": "GRADUATED_QUIET_7D", "volume_24h_usd": 12, "last_buy_days": 9},
    {"mint": "dead_graduated_02", "reason": "GRADUATED_QUIET_7D", "volume_24h_usd": 0, "last_buy_days": 14},
    {"mint": "dead_curve_01", "reason": "CURVE_NO_BUY_7D", "volume_24h_usd": 0, "last_buy_days": 8},
    {"mint": "dead_curve_02", "reason": "CURVE_NO_BUY_7D", "volume_24h_usd": 0, "last_buy_days": 21},
    {"mint": "dead_curve_03", "reason": "CURVE_NO_BUY_7D", "volume_24h_usd": 4, "last_buy_days": 11},
)


def fixtures() -> dict:
    if len(DEAD) < 5 or any(item["last_buy_days"] < 7 for item in DEAD):
        raise ValueError("DEAD_SET_TOO_SMALL")
    return {"coins": list(DEAD), "count": len(DEAD), "synthetic": True, "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(fixtures(), indent=2))
