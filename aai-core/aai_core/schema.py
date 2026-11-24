"""Common normalized market-data schema (JSON Schema: aai_core/schemas/market_data.v1.json).

Candle  : [ts, open, high, low, close, volume]  ts = bar OPEN time, unix seconds UTC, ascending order.
          volume is in base units (contracts converted to base where the venue says so; 0 if unknown, e.g. FX).
Series  : {v, asset_class, symbol, venue, source, interval, as_of, candles:[Candle], complete_last}
Quote   : {v, asset_class, symbol, venue, source, ts, last, bid, ask, mid, spread_bps, depth, perp}
          depth = {levels, bid_notional, ask_notional} in quote currency or null
          perp  = {funding_rate, funding_interval_h, next_funding_ts, open_interest_base, open_interest_usd} or null
"""
from __future__ import annotations
import time
from dataclasses import dataclass, field, asdict

INTERVALS = {"1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400}
ASSET_CLASSES = ("crypto_perp", "forex", "equity", "solana_meme")


@dataclass
class Series:
    asset_class: str
    symbol: str
    venue: str
    source: str
    interval: str
    candles: list            # [[ts, o, h, l, c, v], ...] ascending
    as_of: int = field(default_factory=lambda: int(time.time()))
    complete_last: bool = False   # is the last candle closed?
    v: int = 1

    def closed(self) -> list:
        return self.candles if self.complete_last else self.candles[:-1]

    def closes(self) -> list[float]:
        return [c[4] for c in self.candles]

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Quote:
    asset_class: str
    symbol: str
    venue: str
    source: str
    ts: int
    last: float | None
    bid: float | None = None
    ask: float | None = None
    depth: dict | None = None
    perp: dict | None = None
    v: int = 1

    @property
    def mid(self) -> float | None:
        if self.bid and self.ask:
            return (self.bid + self.ask) / 2
        return self.last

    @property
    def spread_bps(self) -> float | None:
        if self.bid and self.ask and self.ask >= self.bid:
            return round((self.ask - self.bid) / ((self.ask + self.bid) / 2) * 1e4, 3)
        return None

    def to_dict(self) -> dict:
        d = asdict(self)
        d["mid"], d["spread_bps"] = self.mid, self.spread_bps
        return d


def norm_candles(rows, interval: str, now: float | None = None) -> tuple[list, bool]:
    """Sort ascending, drop duplicates/None rows, coerce floats; report whether last bar has closed."""
    out, seen = [], set()
    for r in rows:
        if r is None or any(x is None for x in r[:5]):
            continue
        ts = int(r[0])
        if ts in seen:
            continue
        seen.add(ts)
        out.append([ts, float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[5] or 0)])
    out.sort(key=lambda c: c[0])
    now = time.time() if now is None else now
    complete = bool(out) and out[-1][0] + INTERVALS[interval] <= now
    return out, complete
