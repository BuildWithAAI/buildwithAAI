"""SNIPER: D1 regime, EMA/prior-day confluence and large R targets."""
from __future__ import annotations
import numpy as np
import pandas as pd
from .common import Signals
from .sessions import session_features, regime_htf


class Sniper:
    family = "SNIPER"
    def __init__(self, level: str = "ema_or_day", stop: int = 12, target: float = 3,
                 trail: float | None = None, htf: str = "D1") -> None:
        if level not in ("ema", "ema_or_day"): raise ValueError(level)
        self.params = dict(level=level, stop_pips=stop, target_r=target, trail_pips=trail, regime_tf=htf)

    def signals(self, df):
        p, n = self.params, len(df)
        ss, out = session_features(df), Signals.blank(n)
        f = regime_htf(df, p["regime_tf"])
        reg = f.regime.to_numpy()
        level = np.where(reg > 0, f.ema_fast.to_numpy(), f.ema_slow.to_numpy())
        touch_ema = ((df.bid_low.to_numpy() <= level + 0.0005) & (df.bid_high.to_numpy() >= level - 0.0005))
        d=df.assign(_session=ss.session).groupby('_session').agg(max=('bid_high','max'),min=('bid_low','min'))
        # Previous completed session is known at its close, safe across M1/M15.
        pdh = d["max"].shift(1).reindex(ss.session).to_numpy()
        pdl = d["min"].shift(1).reindex(ss.session).to_numpy()
        touch_day_level = ((df.bid_low.to_numpy() <= pdh + 0.0005) & (df.bid_high.to_numpy() >= pdh - 0.0005)) | ((df.bid_low.to_numpy() <= pdl + 0.0005) & (df.bid_high.to_numpy() >= pdl - 0.0005))
        touched = touch_day_level if p["level"] == "day" else touch_ema if p["level"] == "ema" else touch_ema | touch_day_level
        # Touch may occur on this bar; the breakout is based only on earlier bars.
        hi = df.bid_high.shift(1).rolling(2).max()
        lo = df.bid_low.shift(1).rolling(2).min()
        hours = ((ss.london_hour >= 8) & (ss.london_hour < 11)) | ((ss.ny_hour >= 8) & (ss.ny_hour < 11))
        desired = np.where((reg > 0) & touched & hours & (df.bid_close > hi), 1,
                    np.where((reg < 0) & touched & hours & (df.bid_close < lo), -1, 0))
        used = set()
        for i, sess in enumerate(ss.session):
            if desired[i] and sess not in used:
                out.side[i] = desired[i]
                out.stop_pips[i] = p["stop_pips"]
                out.target_r[i] = p["target_r"] * p["stop_pips"]
                if p["trail_pips"] is not None:
                    out.trail_pips[i] = p["trail_pips"]
                used.add(sess)
        out.regime_exit[(reg != np.roll(reg, 1))] = 1
        out.metadata = self.params
        return out
