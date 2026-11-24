"""Volatility metrics over normalized candles [[ts, o, h, l, c, v], ...] (ascending)."""
from __future__ import annotations
import math

# Bars per year used to annualize realized volatility.
PERIODS_PER_YEAR = {
    "crypto_perp": {"1m": 525600, "5m": 105120, "15m": 35040, "1h": 8760, "4h": 2190, "1d": 365},
    "forex":       {"1m": 374400, "5m": 74880, "15m": 24960, "1h": 6240, "4h": 1560, "1d": 260},   # 24h x 5d x 52w
    "equity":      {"1m": 98280, "5m": 19656, "15m": 6552, "1h": 1638, "4h": 410, "1d": 252},      # 6.5h RTH
}


def true_ranges(c: list) -> list[float]:
    out = []
    for i, x in enumerate(c):
        h, l = x[2], x[3]
        if i == 0:
            out.append(h - l)
        else:
            pc = c[i - 1][4]
            out.append(max(h - l, abs(h - pc), abs(l - pc)))
    return out


def atr(c: list, n: int = 14) -> float | None:
    """Wilder's ATR: seed = simple mean of the first n TRs (from bar 2), then RMA. None if < n+1 bars."""
    if len(c) < n + 1:
        return None
    tr = true_ranges(c)[1:]
    a = sum(tr[:n]) / n
    for t in tr[n:]:
        a = (a * (n - 1) + t) / n
    return a


def log_returns(closes: list[float]) -> list[float]:
    return [math.log(b / a) for a, b in zip(closes, closes[1:]) if a > 0 and b > 0]


def stdev(xs: list[float]) -> float | None:
    if len(xs) < 2:
        return None
    m = sum(xs) / len(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1))


def realized_vol(closes: list[float], n: int | None = None, periods_per_year: float = 1.0) -> float | None:
    """Sample stdev of the last n log returns, annualized by sqrt(periods_per_year). Fraction (0.5 = 50%)."""
    r = log_returns(closes)
    if n:
        r = r[-n:]
    s = stdev(r)
    return None if s is None else s * math.sqrt(periods_per_year)


def vol_ratio(closes: list[float], short: int = 20, long: int = 100) -> float | None:
    """Short-window over long-window realized vol (same units). >1.5 = volatility expansion."""
    r = log_returns(closes)
    if len(r) < long:
        return None
    s, l = stdev(r[-short:]), stdev(r[-long:])
    return None if not l else s / l
