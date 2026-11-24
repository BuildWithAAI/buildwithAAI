"""Execution-cost model (simulated fills). All numbers are fractions of trade value.

Per side (buy or sell):
  fee       FEE_PER_SIDE = 1.0%   pump.fun curve fee (~1%) / PumpSwap+Raydium LP+protocol fee (~0.25-0.3%)
                                  plus priority fee / Jito tip; we use a flat 1% for every venue.
  base slip BASE_SLIP    = 0.5%   latency / MEV / quote staleness allowance on every fill.
  impact    v / (R + v)           constant-product price impact of trading value v against the quote-side
                                  reserve R = liquidity_usd / 2. Bounded below 100%.
            unknown liquidity -> UNKNOWN_LIQ_IMPACT = 5% per side (conservative).
Round trip is floored at MIN_ROUND_TRIP = 2% (with the defaults the floor is 3%: 2 x (1% + 0.5%) + impact).
Fill:  tokens = size_usd * (1 - entry_cost) / entry_price;  proceeds = tokens * exit_price * (1 - exit_cost)."""
from __future__ import annotations

FEE_PER_SIDE = 0.01
BASE_SLIP = 0.005
UNKNOWN_LIQ_IMPACT = 0.05
MIN_ROUND_TRIP = 0.02


def impact(size_usd: float, liquidity_usd) -> float:
    if not liquidity_usd or liquidity_usd <= 0:
        return UNKNOWN_LIQ_IMPACT
    r = liquidity_usd / 2.0
    return size_usd / (r + size_usd)


def side_cost(size_usd: float, liquidity_usd) -> float:
    """Total cost fraction for one side, capped at 100% (a sale into an empty pool returns nothing)."""
    return min(1.0, FEE_PER_SIDE + BASE_SLIP + impact(size_usd, liquidity_usd))


def exit_cost(value_usd: float, liquidity_usd, entry_cost: float) -> float:
    """Exit cost, raised if needed so that entry + exit >= MIN_ROUND_TRIP."""
    c = side_cost(value_usd, liquidity_usd)
    return min(1.0, max(c, MIN_ROUND_TRIP - entry_cost))


def assumptions() -> dict:
    return {"fee_per_side_pct": FEE_PER_SIDE * 100, "base_slippage_per_side_pct": BASE_SLIP * 100,
            "impact": "v/(R+v), R = liquidity_usd/2 (constant product)", "unknown_liquidity_impact_pct": UNKNOWN_LIQ_IMPACT * 100,
            "min_round_trip_pct": MIN_ROUND_TRIP * 100}
