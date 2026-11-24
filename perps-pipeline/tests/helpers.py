from __future__ import annotations

import numpy as np
import pandas as pd

from perps.strategies.base import Strategy


class Scripted(Strategy):
    """Test strategy: emits pre-set signals at given bar indices with a fixed stop distance."""

    name = "scripted"
    defaults = {"take_profit_r": 2.0, "trail_atr_mult": 0.0, "max_hold_bars": 0, "allow_short": True,
                "stop_dist": 1.0, "signals": {}, "exits": []}

    @property
    def warmup_bars(self) -> int:
        return 0

    def _signals(self, df: pd.DataFrame) -> pd.DataFrame:
        out = pd.DataFrame(index=df.index)
        sig = np.zeros(len(df), dtype=int)
        for i, v in self.params["signals"].items():
            sig[int(i)] = v
        out["signal"] = sig
        out["stop_dist"] = float(self.params["stop_dist"])
        out["atr"] = 1.0
        ex = np.zeros(len(df), dtype=bool)
        ex[list(self.params["exits"])] = True
        out["exit_long"] = ex
        out["exit_short"] = ex
        return out


def ohlc_frame(rows, start="2025-01-01", freq="1h") -> pd.DataFrame:
    """rows: list of (open, high, low, close)."""
    idx = pd.date_range(start, periods=len(rows), freq=freq, tz="UTC")
    a = np.asarray(rows, dtype=float)
    return pd.DataFrame({"ts": idx.asi8 // 1_000_000, "open": a[:, 0], "high": a[:, 1], "low": a[:, 2],
                         "close": a[:, 3], "volume": 1.0}, index=idx)
