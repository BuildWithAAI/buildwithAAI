"""Canonical timeframe handling. Canonical names follow Blofin: 1m 3m 5m 15m 30m 1H 2H 4H 6H 12H 1D."""

from __future__ import annotations

_MINUTES: dict[str, int] = {
    "1m": 1, "3m": 3, "5m": 5, "15m": 15, "30m": 30,
    "1H": 60, "2H": 120, "4H": 240, "6H": 360, "8H": 480, "12H": 720, "1D": 1440,
}


def normalize(tf: str) -> str:
    """Normalise user input such as '1h', '4h', '1d', '15M' to canonical names."""
    t = tf.strip()
    if t in _MINUTES:
        return t
    low = t.lower()
    if low.endswith("m") and low[:-1].isdigit() and f"{low[:-1]}m" in _MINUTES:
        return f"{low[:-1]}m"
    if low.endswith("h") and f"{low[:-1]}H" in _MINUTES:
        return f"{low[:-1]}H"
    if low.endswith("d") and f"{low[:-1]}D" in _MINUTES:
        return f"{low[:-1]}D"
    raise ValueError(f"unsupported timeframe: {tf!r}")


def minutes(tf: str) -> int:
    return _MINUTES[normalize(tf)]


def ms(tf: str) -> int:
    return minutes(tf) * 60_000


def bars_per_day(tf: str) -> float:
    return 1440 / minutes(tf)


def bars_for_hours(tf: str, hours: float) -> int:
    return max(1, round(hours * 60 / minutes(tf)))
