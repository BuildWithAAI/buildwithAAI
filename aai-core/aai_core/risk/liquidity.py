"""Liquidity / execution-cost checks. Thresholds are conservative defaults, not optimized."""
from __future__ import annotations

# spread (bps of mid): (warn, bad)
SPREAD_BPS = {"crypto_perp": (5.0, 20.0), "forex": (3.0, 10.0), "equity": (10.0, 50.0)}
DEPTH_FRACTION = (0.10, 0.50)        # order notional / same-side top-of-book depth (20 levels)
ADV_FRACTION = (0.001, 0.01)         # order notional / 20-day average dollar volume (equities)


def spread_check(asset_class: str, spread_bps: float | None) -> tuple[int, str, str]:
    """-> (points, severity, detail)."""
    if spread_bps is None:
        return 0, "info", "spread unknown (source has no bid/ask)"
    warn, bad = SPREAD_BPS[asset_class]
    if spread_bps >= bad:
        return 30, "warn", f"spread {spread_bps:.2f} bps >= {bad}"
    if spread_bps >= warn:
        return 10, "warn", f"spread {spread_bps:.2f} bps >= {warn}"
    return 0, "info", f"spread {spread_bps:.2f} bps"


def depth_check(notional: float, side: str, depth: dict | None) -> tuple[int, str, str, float | None]:
    if not depth:
        return 0, "info", "order-book depth unknown", None
    book = depth["ask_notional"] if side == "long" else depth["bid_notional"]
    if not book:
        return 25, "warn", "same-side book empty", None
    f = notional / book
    warn, bad = DEPTH_FRACTION
    if f >= bad:
        return 30, "warn", f"order is {f:.0%} of same-side top-{depth['levels']} depth", f
    if f >= warn:
        return 10, "warn", f"order is {f:.0%} of same-side top-{depth['levels']} depth", f
    return 0, "info", f"order is {f:.2%} of same-side top-{depth['levels']} depth", f


def avg_dollar_volume(candles: list, n: int = 20) -> float | None:
    c = [x for x in candles if x[5]][-n:]
    if not c:
        return None
    return sum(x[4] * x[5] for x in c) / len(c)


def adv_check(notional: float, adv: float | None) -> tuple[int, str, str, float | None]:
    if not adv:
        return 0, "info", "average dollar volume unknown", None
    f = notional / adv
    warn, bad = ADV_FRACTION
    if f >= bad:
        return 30, "warn", f"order is {f:.2%} of 20d avg dollar volume", f
    if f >= warn:
        return 10, "warn", f"order is {f:.3%} of 20d avg dollar volume", f
    return 0, "info", f"order is {f:.4%} of 20d avg dollar volume", f
