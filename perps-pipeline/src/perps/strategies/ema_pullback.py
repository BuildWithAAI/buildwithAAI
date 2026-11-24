"""Swing trend-pullback: trade in the direction of an EMA stack after a pullback to the fast EMA.

Long setup: fast EMA > slow EMA, close > trend EMA, slow EMA rising; bar's low trades within
`pullback_atr` ATR of the fast EMA and the bar closes back above the fast EMA as a bullish bar.
Exit signal when close crosses back through the slow EMA. Short symmetric.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .base import Strategy
from .indicators import atr, ema


class EmaPullback(Strategy):
    name = "ema_pullback"
    style = "swing"
    defaults = {
        "fast_ema": 20, "slow_ema": 50, "trend_ema": 200, "pullback_atr": 0.5, "atr_period": 14,
        "atr_stop_mult": 2.0, "take_profit_r": 2.5, "trail_atr_mult": 3.0, "max_hold_bars": 120,
        "allow_short": True,
    }

    @property
    def warmup_bars(self) -> int:
        p = self.params
        return max(int(p["fast_ema"]), int(p["slow_ema"]), int(p["trend_ema"] or 0), int(p["atr_period"])) + 6

    def _signals(self, df: pd.DataFrame) -> pd.DataFrame:
        p = self.params
        o, h, l, c = df["open"], df["high"], df["low"], df["close"]
        f, s = ema(c, int(p["fast_ema"])), ema(c, int(p["slow_ema"]))
        t = ema(c, int(p["trend_ema"])) if p["trend_ema"] else s
        a = atr(df, int(p["atr_period"]))
        band = float(p["pullback_atr"]) * a
        up_trend = (f > s) & (c > t) & (s > s.shift(5))
        dn_trend = (f < s) & (c < t) & (s < s.shift(5))
        long_ = up_trend & (l <= f + band) & (c > f) & (c > o)
        short_ = dn_trend & (h >= f - band) & (c < f) & (c < o)
        out = pd.DataFrame(index=df.index)
        out["signal"] = np.where(long_, 1, np.where(short_, -1, 0))
        out["stop_dist"] = float(p["atr_stop_mult"]) * a
        out["atr"] = a
        out["exit_long"] = c < s
        out["exit_short"] = c > s
        return out
