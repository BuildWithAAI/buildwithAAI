"""Map an AAI observed-trade episode onto the first-brain feature contract.

This is the missing joint between src/solana_research trade rows and
src/multi_brain_research/first_brain.py. It does not train, score, or trade.
"""
from __future__ import annotations

from typing import Iterable

FEATURE_NAMES = ("signed_return", "flow_imbalance", "liquidity_change", "distance_to_adverse_band")
ADVERSE_BAND = 0.15


class LoaderError(ValueError):
    pass


def _num(row: dict, key: str) -> float:
    value = row.get(key)
    if type(value) not in (int, float) or value != value or value in (float("inf"), float("-inf")):
        raise LoaderError("MISSING_FEATURE_SOURCE")
    return float(value)


def features_from_observations(observations: Iterable[dict], index: int) -> tuple[float, float, float, float]:
    """Causal features at decision index. Future rows are not read."""
    rows = list(observations)
    if not 0 <= index < len(rows):
        raise LoaderError("INDEX_OUT_OF_RANGE")
    current = rows[index]
    price = _num(current, "last_trade_price")
    if price <= 0:
        raise LoaderError("NON_POSITIVE_PRICE")
    if index == 0:
        # No earlier trade exists in this episode, so the measured change is zero.
        signed_return = 0.0
        flow = 0.0
        liquidity = 0.0
    else:
        previous = rows[index - 1]
        prior = _num(previous, "last_trade_price")
        if prior <= 0:
            raise LoaderError("NON_POSITIVE_PRICE")
        signed_return = max(-1.0, min(1.0, (price - prior) / prior))
        quote = _num(current, "quote_atoms")
        prior_quote = abs(_num(previous, "quote_atoms"))
        if prior_quote == 0:
            raise LoaderError("MISSING_FEATURE_SOURCE")
        flow = max(-1.0, min(1.0, _num(current, "signed_quote_flow") / prior_quote))
        liquidity = max(-1.0, min(1.0, (quote - prior_quote) / prior_quote))
    # 0 at or beyond the adverse drop, 1 at or beyond the same rise. Not a constant.
    distance = max(0.0, min(1.0, (signed_return + ADVERSE_BAND) / (2 * ADVERSE_BAND)))
    return (
        round(signed_return, 6),
        round(flow, 6),
        round(liquidity, 6),
        round(distance, 6),
    )


def label_adverse(observations: Iterable[dict], index: int, horizon: int) -> int | None:
    """1 if a later observed price in the same episode falls by the band. None if the future is not yet available."""
    rows = list(observations)
    target = index + horizon
    if target >= len(rows):
        return None
    now = _num(rows[index], "last_trade_price")
    later = _num(rows[target], "last_trade_price")
    if now <= 0:
        raise LoaderError("NON_POSITIVE_PRICE")
    return 1 if later <= now * (1 - ADVERSE_BAND) else 0
