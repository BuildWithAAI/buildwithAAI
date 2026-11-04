"""Turn observed market fields into the four tape features.

A single account price is not a trade. Return, flow, and liquidity change
stay missing until the row actually contains the earlier price, both sides
of flow, or both liquidity readings. Missing is not stored as zero.
"""
from __future__ import annotations

import json
import math

FEATURE_NAMES = ("signed_return", "flow_imbalance", "liquidity_change", "distance_to_adverse_band")
ADVERSE_BAND = 0.15


def _finite(value):
    if type(value) is bool or type(value) not in (int, float):
        return None
    number = float(value)
    if not math.isfinite(number):
        return None
    return number


def _clamp(value: float, low: float = -1.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def features(row: dict) -> dict:
    if type(row) is not dict:
        raise ValueError("NO_PRICE")
    price = _finite(row.get("price_quote_per_base", row.get("observed_price", row.get("last_trade_price"))))
    if price is None or price <= 0:
        raise ValueError("NO_PRICE")
    previous = _finite(row.get("previous_price"))
    signed = None
    raw_signed = None
    if previous is not None and previous > 0:
        raw_signed = (price - previous) / previous
        signed = round(_clamp(raw_signed), 6)
    buy = _finite(row.get("buy_quote_atoms", row.get("buys_24h")))
    sell = _finite(row.get("sell_quote_atoms", row.get("sells_24h")))
    flow = None
    if buy is not None and sell is not None and buy >= 0 and sell >= 0 and buy + sell > 0:
        flow = round(_clamp((buy - sell) / (buy + sell)), 6)
    liquidity = _finite(row.get("liquidity_quote", row.get("liquidity_usd")))
    previous_liquidity = _finite(row.get("previous_liquidity_quote", row.get("previous_liquidity_usd")))
    liquidity_change = None
    if liquidity is not None and previous_liquidity is not None and previous_liquidity > 0 and liquidity >= 0:
        liquidity_change = round(_clamp((liquidity - previous_liquidity) / previous_liquidity), 6)
    distance = None
    if raw_signed is not None:
        distance = round(max(0.0, min(1.0, (raw_signed + ADVERSE_BAND) / (2 * ADVERSE_BAND))), 6)
    values = {
        "signed_return": signed,
        "flow_imbalance": flow,
        "liquidity_change": liquidity_change,
        "distance_to_adverse_band": distance,
    }
    missing = [name for name in FEATURE_NAMES if values[name] is None]
    return {
        "features": values,
        "missing": missing,
        "raw_signed_return": raw_signed,
        "classification": row.get("classification"),
        "trade": signed is not None,
        "action": "NO_EXECUTION",
    }


def paper_long_support(mapped: dict) -> dict:
    """Map observed directional features to paper-long support in parts per million.

    This is a bounded heuristic. It is not a trained model and not a
    probability that has been calibrated on trades.
    """
    parts = []
    for name in ("signed_return", "flow_imbalance", "liquidity_change"):
        value = mapped["features"].get(name)
        number = _finite(value)
        if number is not None:
            parts.append(_clamp(number))
    if not parts:
        return {
            "prediction_ppm": None,
            "uncertainty_ppm": None,
            "abstain_reason": "MISSING_DATA",
            "parts": 0,
            "action": "NO_EXECUTION",
        }
    mean = sum(parts) / len(parts)
    ppm = max(0, min(1_000_000, int(round((mean + 1) / 2 * 1_000_000))))
    uncertainty = max(0, min(1_000_000, int(round((1 - len(parts) / 3) * 700_000)) + 50_000))
    return {
        "prediction_ppm": ppm,
        "uncertainty_ppm": uncertainty,
        "abstain_reason": None,
        "parts": len(parts),
        "action": "NO_EXECUTION",
    }


def self_check() -> dict:
    account = features({"price_quote_per_base": 0.00002796, "classification": "ACCOUNT_DECODE_NOT_A_TRADE"})
    moved = features({
        "price_quote_per_base": 1.2,
        "previous_price": 1.0,
        "buy_quote_atoms": 3,
        "sell_quote_atoms": 1,
        "liquidity_quote": 110,
        "previous_liquidity_quote": 100,
        "classification": "OBSERVED",
    })
    if account["features"]["signed_return"] is not None or "signed_return" not in account["missing"]:
        raise RuntimeError("ACCOUNT_ROW_INVENTED_RETURN")
    if moved["features"]["signed_return"] <= 0 or paper_long_support(account)["prediction_ppm"] is not None:
        raise RuntimeError("FEATURE_MISMATCH")
    down = features({
        "price_quote_per_base": 0.8,
        "previous_price": 1.0,
        "buy_quote_atoms": 1,
        "sell_quote_atoms": 4,
        "liquidity_quote": 80,
        "previous_liquidity_quote": 100,
    })
    if paper_long_support(moved)["prediction_ppm"] <= paper_long_support(down)["prediction_ppm"]:
        raise RuntimeError("DIRECTION_IGNORED")
    return {"missing": account["missing"], "up_ppm": paper_long_support(moved)["prediction_ppm"], "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
