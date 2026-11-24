"""Momentum scalp: breakout of the trailing N-hour range (default 24h high/low) with ATR stop.

Long when the bar closes above the prior 24h high (excluding the current bar), price is above the
trend EMA and breakout volume is elevated; short symmetric. Stop = atr_stop_mult * ATR from fill.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..timeframes import bars_for_hours
from .base import Strategy
from .indicators import atr, ema


class RangeBreakout(Strategy):
    name = "range_breakout"
    style = "scalp"
    defaults = {
        "lookback_hours": 24, "atr_period": 14, "atr_stop_mult": 1.5, "take_profit_r": 2.0,
        "trail_atr_mult": 0.0, "trend_ema": 200, "volume_mult": 1.2, "max_hold_bars": 96, "allow_short": True,
    }

    @property
    def n(self) -> int:
        return bars_for_hours(self.timeframe, float(self.params["lookback_hours"]))

    @property
    def warmup_bars(self) -> int:
        return max(self.n, int(self.params["trend_ema"] or 0), int(self.params["atr_period"])) + 2

    def _signals(self, df: pd.DataFrame) -> pd.DataFrame:
        p, n = self.params, self.n
        c = df["close"]
        hh = df["high"].rolling(n, min_periods=n).max().shift(1)
        ll = df["low"].rolling(n, min_periods=n).min().shift(1)
        a = atr(df, int(p["atr_period"]))
        up = (c > hh) & (c.shift(1) <= hh.shift(1))
        dn = (c < ll) & (c.shift(1) >= ll.shift(1))
        if p["trend_ema"]:
            t = ema(c, int(p["trend_ema"]))
            up &= c > t
            dn &= c < t
        if p["volume_mult"]:
            vmed = df["volume"].rolling(n, min_periods=n).median().shift(1)
            vol_ok = df["volume"] > float(p["volume_mult"]) * vmed
            up &= vol_ok
            dn &= vol_ok
        out = pd.DataFrame(index=df.index)
        out["signal"] = np.where(up, 1, np.where(dn, -1, 0))
        out["stop_dist"] = float(p["atr_stop_mult"]) * a
        out["atr"] = a
        return out
