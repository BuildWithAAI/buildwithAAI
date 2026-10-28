"""Correct AAI market state.

Mint 27RP3fkHt6T2QpCzsrJjk9oMZXAP5cya77VaR3UMpump.
Observed 2026-10-28 from public RugCheck and Dexscreener.
This is not the older Alliance Ai pool.
"""
from __future__ import annotations

import json

TOKEN = "27RP3fkHt6T2QpCzsrJjk9oMZXAP5cya77VaR3UMpump"
CURVE = "Eq93BkkDVBLkjgHxZU6qVk7hrnzTnAyVfCNrXCVix1PL"
CREATOR = "7UwprY6AVua7Q2fx8evE6bZxSARgpixWvWFaReJLYo6F"
WRONG_PRIOR = "4YfDqzLR2NRLcx4V4VEuhjN2Z1BS3T1aokwNQygDpump"

OBSERVED = {
    "name": "Anything AI",
    "symbol": "AAI",
    "venue": "PUMP_FUN_BONDING_CURVE",
    "graduated": False,
    "dex_pair": None,
    "supply": 1_000_000_000,
    "curve_holds_pct": 100.0,
    "creator_balance": 0,
    "real_sol_in_curve": 0.000000071,
    "reported_base_usd": 2946.06,
    "reported_quote_usd": 0.000007,
    "mint_authority": None,
    "freeze_authority": None,
    "metadata_mutable": False,
}


def diagnosis() -> dict:
    return {
        "token": TOKEN,
        "curve": CURVE,
        "creator": CREATOR,
        "not_this_token": WRONG_PRIOR,
        "observed": OBSERVED,
        "diagnosis": "LAUNCHED_ON_CURVE_NO_REAL_BOOK",
        "chart_cause": "The curve still holds the supply. Real SOL in the curve is dust. There is no DEX pair, so there is no book to be clean.",
        "refused": ["WASH_VOLUME", "COORDINATED_PUMP", "CHART_PAINT", "HIDDEN_SUPPLY"],
        "next": [
            "Do not treat the older Alliance Ai pool as this token.",
            "Do not add DEX liquidity until the curve graduates.",
            "A burn with no buyers is cosmetic.",
            "First real flow is an honest buy on the curve, disclosed, not washed.",
        ],
        "action": "NO_EXECUTION",
    }


if __name__ == "__main__":
    print(json.dumps(diagnosis(), indent=2))
