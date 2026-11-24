"""Reference intraday strategy: Asian-range breakout into the London session.

* Range: high/low of bars opening in [range_start_hour, range_end_hour) UTC.
* Entry window: bars opening in [range_end_hour, entry_end_hour) UTC; a close
  beyond range +/- ``buffer_datr`` x daily ATR triggers a market entry at the
  next bar open. At most ``max_trades_per_day`` per pair.
* Filter: range width must be within [min_range_datr, max_range_datr] x the
  daily ATR of COMPLETED days.
* Stop: range midpoint (``stop_mode='mid'``) or opposite side ('opposite').
  Target: ``target_r`` R. Flat at ``flat_hour`` UTC (no overnight holds).

Hours are UTC and do not adjust for DST. Research reference only; no claim
of profitability. Spread/commission dominate at M1/M5; see README.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd

from .base import BarContext, Signal, SignalAction, Strategy
from .indicators import align_htf, atr, daily_bars


class SessionBreakout(Strategy):
    name = "session_breakout"

    DEFAULTS: dict[str, Any] = {"range_start_hour": 0, "range_end_hour": 7, "entry_end_hour": 11,
                                "flat_hour": 16, "buffer_datr": 0.05, "min_range_datr": 0.15,
                                "max_range_datr": 0.8, "daily_atr_period": 14, "stop_mode": "mid",
                                "target_r": 1.5, "max_trades_per_day": 1}

    def __init__(self, timeframe: str = "M15", **params: Any) -> None:
        super().__init__(timeframe, **{**self.DEFAULTS, **params})

    def reset(self) -> None:
        self._trades_today: dict[str, tuple[pd.Timestamp, int]] = {}

    @property
    def warmup_bars(self) -> int:
        return 1

    def prepare(self, df: pd.DataFrame, pair: str) -> pd.DataFrame:
        p = self.params
        out = df.copy()
        hours = df.index.hour + df.index.minute / 60.0
        day = df.index.normalize()
        in_range = (hours >= p["range_start_hour"]) & (hours < p["range_end_hour"])
        hi = df["high"].where(in_range)
        lo = df["low"].where(in_range)
        # cumulative within the day => causal; after range end the value is frozen
        out["rng_hi"] = hi.groupby(day).cummax().groupby(day).ffill()
        out["rng_lo"] = lo.groupby(day).cummin().groupby(day).ffill()
        # range is complete only once a bar has closed at/after range_end
        close_hours = hours + self.timeframe.minutes / 60.0
        complete = close_hours > p["range_end_hour"]
        out.loc[~complete, ["rng_hi", "rng_lo"]] = np.nan
        d = daily_bars(df, self.timeframe).copy()
        d["datr"] = atr(d, int(p["daily_atr_period"]))
        out["datr"] = align_htf(d[["datr"]], pd.Timedelta(days=1), df.index, self.timeframe.delta)["datr"]
        out["hour"] = hours
        out["day"] = (day.asi8 // 86_400_000_000_000).astype(float)
        return out

    def on_bar(self, ctx: BarContext) -> list[Signal]:
        p = self.params
        c = ctx.get("close")
        close_hour = ctx.get("hour") + self.timeframe.minutes / 60.0
        pos = ctx.position
        if pos is not None:
            if close_hour >= p["flat_hour"] or ctx.ts.normalize() != pos.entry_ts.normalize():
                return [Signal(ctx.close_ts, ctx.pair, self.name, SignalAction.EXIT, c, reason="session flat time")]
            return []
        h = ctx.get("hour")
        if not (p["range_end_hour"] <= h < p["entry_end_hour"]):
            return []
        rh, rl, datr = ctx.get("rng_hi"), ctx.get("rng_lo"), ctx.get("datr")
        if any(math.isnan(x) for x in (rh, rl, datr, c)) or datr <= 0:
            return []
        width = rh - rl
        if not (p["min_range_datr"] * datr <= width <= p["max_range_datr"] * datr):
            return []
        day = ctx.ts.normalize()
        last_day, n = self._trades_today.get(ctx.pair, (None, 0))
        n = n if last_day == day else 0
        if n >= int(p["max_trades_per_day"]):
            return []
        buf = float(p["buffer_datr"]) * datr
        mid = (rh + rl) / 2.0
        sig: Signal | None = None
        if c > rh + buf:
            stop = mid if p["stop_mode"] == "mid" else rl
            sig = Signal(ctx.close_ts, ctx.pair, self.name, SignalAction.ENTER_LONG, c, stop=stop,
                         target=c + float(p["target_r"]) * (c - stop),
                         reason=f"close {c:.5f} > asia high {rh:.5f}+buf", meta={"range_w": width, "datr": datr})
        elif c < rl - buf:
            stop = mid if p["stop_mode"] == "mid" else rh
            sig = Signal(ctx.close_ts, ctx.pair, self.name, SignalAction.ENTER_SHORT, c, stop=stop,
                         target=c - float(p["target_r"]) * (stop - c),
                         reason=f"close {c:.5f} < asia low {rl:.5f}-buf", meta={"range_w": width, "datr": datr})
        if sig is None:
            return []
        self._trades_today[ctx.pair] = (day, n + 1)
        return [sig]
