"""Adaptations from scanner, curve, and pump.fun rows already in this repo.

Nothing here invents a price. A live DEX Screener read is optional and uses
the scanner's fixed public URL. It needs no API key. Failure returns an
unavailable observation.
"""
from __future__ import annotations

import math


def _number(value, *, allow_zero=False):
    if type(value) is bool or type(value) not in (int, float, str):
        return None
    if type(value) is str:
        try:
            value = float(value)
        except ValueError:
            return None
    if not math.isfinite(float(value)):
        return None
    number = float(value)
    if number < 0 or (number == 0 and not allow_zero):
        return None
    return number


def _metric(node, *, allow_zero=False):
    if type(node) is not dict or node.get("status") not in (None, "AVAILABLE"):
        return None
    return _number(node.get("value"), allow_zero=allow_zero)


def from_scanner_market(market: dict, previous: dict | None = None) -> dict:
    if type(market) is not dict:
        raise ValueError("NO_PRICE")
    price = _metric(market.get("price_usd")) or _metric(market.get("price_sol"))
    liquidity = _metric(market.get("liquidity_usd"), allow_zero=True)
    previous_price = previous_liquidity = None
    if type(previous) is dict:
        previous_price = _metric(previous.get("price_usd")) or _metric(previous.get("price_sol"))
        previous_liquidity = _metric(previous.get("liquidity_usd"), allow_zero=True)
    return {
        "mint": market.get("mint"),
        "pool": market.get("selected_pool"),
        "price_quote_per_base": price,
        "previous_price": previous_price,
        "buy_quote_atoms": _metric(market.get("buys_24h"), allow_zero=True),
        "sell_quote_atoms": _metric(market.get("sells_24h"), allow_zero=True),
        "liquidity_usd": liquidity,
        "previous_liquidity_usd": previous_liquidity,
        "classification": "OBSERVED",
        "source": "scanner_market",
        "action": "NO_EXECUTION",
    }


def from_curve_snapshots(current: dict, previous: dict | None = None) -> dict:
    if type(current) is not dict:
        raise ValueError("NO_PRICE")
    return {
        "price_quote_per_base": current.get("price"),
        "previous_price": None if type(previous) is not dict else previous.get("price"),
        "liquidity_quote": current.get("real_quote"),
        "previous_liquidity_quote": None if type(previous) is not dict else previous.get("real_quote"),
        "slot": current.get("slot"),
        "classification": "OBSERVED",
        "source": "solana_curve",
        "action": "NO_EXECUTION",
    }


def from_pump_events(events: list) -> dict:
    if type(events) is not list or not events or type(events[-1]) is not dict:
        raise ValueError("NO_PRICE")
    last = events[-1]
    previous = events[-2] if len(events) > 1 and type(events[-2]) is dict else None
    last_reserves = last.get("real_reserves") if type(last.get("real_reserves")) is dict else {}
    previous_reserves = previous.get("real_reserves") if previous and type(previous.get("real_reserves")) is dict else {}
    return {
        "mint": last.get("mint"),
        "pool": last.get("curve_account"),
        "price_quote_per_base": last.get("observed_price"),
        "previous_price": None if previous is None else previous.get("observed_price"),
        "liquidity_quote": last_reserves.get("quote"),
        "previous_liquidity_quote": None if previous is None else previous_reserves.get("quote"),
        "slot": last.get("slot"),
        "classification": last.get("classification") or "OBSERVED",
        "source": "pump_trade_tape",
        "action": "NO_EXECUTION",
    }


def live_dex_observation(mint: str) -> dict:
    """Optional public DEX Screener read. No key. Network errors abstain."""
    try:
        try:
            from aai_scanner.market import WRAPPED_SOL, MarketClient, summarize_market
            from aai_scanner.transport import ProviderError
        except ImportError:
            from src.aai_scanner.market import WRAPPED_SOL, MarketClient, summarize_market
            from src.aai_scanner.transport import ProviderError
        client = MarketClient(timeout=6)
        pools, proof = client.pools(mint)
        sol_pools, sol_proof = client.pools(WRAPPED_SOL)
        market = summarize_market(pools, proof, sol_pools, sol_proof)
    except (OSError, ValueError, ProviderError):
        return {
            "available": False,
            "reason": "DEX_UNAVAILABLE",
            "source": "dexscreener",
            "mint": mint,
            "action": "NO_EXECUTION",
            "execution_allowed": False,
        }
    observation = from_scanner_market(market)
    observation["mint"] = mint
    observation["available"] = observation.get("price_quote_per_base") is not None
    observation["execution_allowed"] = False
    return observation
