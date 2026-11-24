"""Volatility-compression breakout: Bollinger bandwidth in the bottom percentile of its trailing
window within the last few bars, then a close outside the bands -> enter in breakout direction."""

from __future__ import annotations

import numpy as np
import pandas as pd

from .base import Strategy
from .indicators import atr, ema, rolling_pct_rank, sma


class VolSqueeze(Strategy):
    name = "vol_squeeze"
    style = "swing"
    defaults = {
        "bb_period": 20, "bb_std": 2.0, "squeeze_lookback": 120, "squeeze_pct": 0.2, "squeeze_recent": 6,
        "atr_period": 14, "atr_stop_mult": 1.5, "take_profit_r": 2.5, "trail_atr_mult": 2.5, "trend_ema": 0,
        "max_hold_bars": 72, "allow_short": True,
    }

    @property
    def warmup_bars(self) -> int:
        p = self.params
        return int(p["bb_period"]) + int(p["squeeze_lookback"]) + int(p["squeeze_recent"]) + 2

    def _signals(self, df: pd.DataFrame) -> pd.DataFrame:
        p = self.params
        c = df["close"]
        n = int(p["bb_period"])
        mid = sma(c, n)
        sd = c.rolling(n, min_periods=n).std(ddof=0)
        upper, lower = mid + float(p["bb_std"]) * sd, mid - float(p["bb_std"]) * sd
        width = (upper - lower) / mid
        rank = rolling_pct_rank(width, int(p["squeeze_lookback"]))
        squeezed = (rank <= float(p["squeeze_pct"])).astype(float)
        recent = squeezed.shift(1).rolling(int(p["squeeze_recent"]), min_periods=1).max() > 0
        up = recent & (c > upper) & (c.shift(1) <= upper.shift(1))
        dn = recent & (c < lower) & (c.shift(1) >= lower.shift(1))
        if p["trend_ema"]:
            t = ema(c, int(p["trend_ema"]))
            up &= c > t
            dn &= c < t
        a = atr(df, int(p["atr_period"]))
        out = pd.DataFrame(index=df.index)
        out["signal"] = np.where(up, 1, np.where(dn, -1, 0))
        out["stop_dist"] = float(p["atr_stop_mult"]) * a
        out["atr"] = a
        out["exit_long"] = c < mid
        out["exit_short"] = c > mid
        return out
