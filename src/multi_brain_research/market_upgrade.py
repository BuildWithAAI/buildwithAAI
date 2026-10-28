"""Economic upgrade for the launched AAI pool.

Observed on 2026-10-28 from the public PumpSwap pool. This is a design
model, not a trade and not a promise of price.
"""
from __future__ import annotations

import json
import math

# Public observations. Not a live feed.
TOKEN = "4YfDqzLR2NRLcx4V4VEuhjN2Z1BS3T1aokwNQygDpump"
POOL = "FtFoDZNCJpPFFuDTiGvrKfqXkTnkxFQYGMzhttn4Bm2d"
OBSERVED = {
    "market_cap_usd": 2865.75,
    "fdv_usd": 2865.75,
    "liquidity_usd": 4593.72,
    "sol_in_pool": 22.76,
    "volume_24h_usd": 0.0,
    "holders": 271,
    "age_months": 7,
    "lp_locked": True,
    "mint_authority": "DISABLED",
    "freeze_authority": "DISABLED",
    "bundled_buys_pct": 27.23,
    "security_score": 50,
}


def slippage(sol_in_pool: float, trade_sol: float) -> float:
    """Constant-product impact for a buy that adds trade_sol."""
    if sol_in_pool <= 0 or trade_sol <= 0:
        raise ValueError("BAD_DEPTH")
    return trade_sol / (sol_in_pool + trade_sol)


def depth_plan(current_sol: float, targets: tuple[float, ...]) -> list[dict]:
    rows = []
    for target in targets:
        if target < current_sol:
            continue
        rows.append({
            "sol_in_pool": target,
            "one_sol_slippage": round(slippage(target, 1.0), 4),
            "five_sol_slippage": round(slippage(target, 5.0), 4),
            "added_sol": round(target - current_sol, 2),
        })
    return rows


def revenue_burn(fee_sol: float, burn_share: float = 0.5) -> dict:
    """Burn only from collected agent-economy fees. No cosmetic mint burn."""
    if fee_sol < 0 or not 0 < burn_share <= 1:
        raise ValueError("BAD_FEE")
    return {
        "fee_sol": fee_sol,
        "buyback_sol": round(fee_sol * burn_share, 6),
        "treasury_sol": round(fee_sol * (1 - burn_share), 6),
        "source": "AGENT_FEES_ONLY",
        "cosmetic_supply_burn": False,
        "action": "NO_EXECUTION",
    }


def inventory_score(held_days: int, size_ppm: int) -> int:
    """Time-weighted inventory. Access, not a chart signal."""
    if held_days < 0 or not 0 <= size_ppm <= 1_000_000:
        raise ValueError("BAD_HOLD")
    time_weight = min(held_days, 90) / 90
    return int(100 * time_weight * math.sqrt(size_ppm / 1_000_000))


def upgrade() -> dict:
    plan = depth_plan(OBSERVED["sol_in_pool"], (22.76, 50, 100, 250))
    return {
        "token": TOKEN,
        "pool": POOL,
        "observed": OBSERVED,
        "diagnosis": "THIN_BOOK_NO_INVENTORY",
        "chart_cause": "A one-SOL trade moves a 23-SOL pool about four percent. Zero volume leaves the old chops on the chart.",
        "refused": ["WASH_VOLUME", "COORDINATED_PUMP", "CHART_PAINT", "HIDDEN_SUPPLY"],
        "depth": plan,
        "burn": revenue_burn(0.0),
        "inventory_example": inventory_score(30, 10_000),
        "lp_locked": True,
        "action": "NO_EXECUTION",
    }


if __name__ == "__main__":
    print(json.dumps(upgrade(), indent=2))
