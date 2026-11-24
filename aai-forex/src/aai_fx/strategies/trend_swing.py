"""Reference swing strategy: daily-bias trend following with ATR stops.

* Bias (from COMPLETED daily bars): +1 if daily close > EMA(slow) and
  EMA(fast) > EMA(slow); -1 if the mirror; else 0.
* Entry: close breaks the prior ``entry_lookback``-bar Donchian channel in the
  bias direction (operating timeframe, e.g. D1 or H4).
* Initial stop: ``stop_atr`` x ATR from the signal close. Optional fixed target
  at ``target_r`` R (None = let it run).
* Exit: close through the prior ``exit_lookback``-bar channel against the
  position, or bias flips against it.

Reference implementation for research only. No claim of profitability.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd

from .base import BarContext, Signal, SignalAction, Strategy
from .indicators import align_htf, atr, daily_bars, donchian_prior, ema


class TrendSwing(Strategy):
    name = "trend_swing"

    DEFAULTS: dict[str, Any] = {"ema_fast": 50, "ema_slow": 200, "entry_lookback": 20, "exit_lookback": 10,
                                "atr_period": 14, "stop_atr": 2.0, "target_r": None}

    def __init__(self, timeframe: str = "D1", **params: Any) -> None:
        merged = {**self.DEFAULTS, **params}
        super().__init__(timeframe, **merged)

    @property
    def warmup_bars(self) -> int:
        return int(self.params["entry_lookback"]) + int(self.params["atr_period"]) + 2

    def prepare(self, df: pd.DataFrame, pair: str) -> pd.DataFrame:
        p = self.params
        out = df.copy()
        d = daily_bars(df, self.timeframe).copy()
        d["d_ema_fast"] = ema(d["close"], int(p["ema_fast"]))
        d["d_ema_slow"] = ema(d["close"], int(p["ema_slow"]))
        d["d_close"] = d["close"]
        bias = np.where((d["d_close"] > d["d_ema_slow"]) & (d["d_ema_fast"] > d["d_ema_slow"]), 1,
                        np.where((d["d_close"] < d["d_ema_slow"]) & (d["d_ema_fast"] < d["d_ema_slow"]), -1, 0))
        d["bias"] = np.where(d["d_ema_slow"].isna(), 0, bias)
        aligned = align_htf(d[["bias", "d_ema_fast", "d_ema_slow"]], pd.Timedelta(days=1), df.index,
                            self.timeframe.delta)
        out["bias"] = aligned["bias"].fillna(0).astype(float)
        out["atr"] = atr(df, int(p["atr_period"]))
        out["dc_hi"], out["dc_lo"] = donchian_prior(df, int(p["entry_lookback"]))
        out["ex_hi"], out["ex_lo"] = donchian_prior(df, int(p["exit_lookback"]))
        return out

    def on_bar(self, ctx: BarContext) -> list[Signal]:
        p = self.params
        c, a, bias = ctx.get("close"), ctx.get("atr"), ctx.get("bias")
        if any(math.isnan(x) for x in (c, a)) or a <= 0:
            return []
        pos = ctx.position
        if pos is not None:
            if pos.side > 0 and (c < ctx.get("ex_lo") or bias < 0):
                return [Signal(ctx.close_ts, ctx.pair, self.name, SignalAction.EXIT, c,
                               reason="long exit: channel break" if c < ctx.get("ex_lo") else "long exit: bias flip")]
            if pos.side < 0 and (c > ctx.get("ex_hi") or bias > 0):
                return [Signal(ctx.close_ts, ctx.pair, self.name, SignalAction.EXIT, c,
                               reason="short exit: channel break" if c > ctx.get("ex_hi") else "short exit: bias flip")]
            return []
        hi, lo = ctx.get("dc_hi"), ctx.get("dc_lo")
        if math.isnan(hi) or math.isnan(lo):
            return []
        stop_dist = float(p["stop_atr"]) * a
        tr = p.get("target_r")
        if bias > 0 and c > hi:
            return [Signal(ctx.close_ts, ctx.pair, self.name, SignalAction.ENTER_LONG, c, stop=c - stop_dist,
                           target=(c + float(tr) * stop_dist) if tr else None,
                           reason=f"bias+1, close {c:.5f} > {p['entry_lookback']}-bar high {hi:.5f}",
                           meta={"atr": a})]
        if bias < 0 and c < lo:
            return [Signal(ctx.close_ts, ctx.pair, self.name, SignalAction.ENTER_SHORT, c, stop=c + stop_dist,
                           target=(c - float(tr) * stop_dist) if tr else None,
                           reason=f"bias-1, close {c:.5f} < {p['entry_lookback']}-bar low {lo:.5f}",
                           meta={"atr": a})]
        return []
