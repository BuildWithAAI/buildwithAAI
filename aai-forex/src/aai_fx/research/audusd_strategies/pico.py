"""PICO: M1/M5 momentum breakout, minutes only, targets 5/10 pips."""
from __future__ import annotations
import numpy as np
from .common import Signals
from .sessions import session_features


class Pico:
    family = "PICO"
    def __init__(self, stop: int = 4, target: int = 5, lookback: int = 10,
                 session: str = "both", minutes: int = 15) -> None:
        self.params = dict(stop_pips=stop, target_pips=target, lookback=lookback,
                           session=session, max_hold_minutes=minutes)

    def signals(self, df):
        p, n = self.params, len(df)
        ss, out = session_features(df), Signals.blank(n)
        hi = df.bid_high.shift(1).rolling(p["lookback"]).max()
        lo = df.bid_low.shift(1).rolling(p["lookback"]).min()
        london = (ss.london_hour >= 8) & (ss.london_hour < 9)
        ny = (ss.ny_hour >= 8) & (ss.ny_hour < 10)
        window = london | ny if p["session"] == "both" else london if p["session"] == "london" else ny
        desired = np.where(window & (df.bid_close > hi), 1, np.where(window & (df.bid_close < lo), -1, 0))
        used = set()
        for i, key in enumerate(zip(ss.session, ss.ny_hour < 4)):
            if not desired[i]: continue

            if key not in used:
                out.side[i] = desired[i]
                out.stop_pips[i] = p["stop_pips"]
                out.target_r[i] = p["target_pips"]
                used.add(key)
        out.max_bars = p["max_hold_minutes"]
        out.metadata = self.params
        return out
