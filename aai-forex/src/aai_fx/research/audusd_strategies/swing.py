"""SWING: multi-day Zoora regime with tight stop and asymmetric runner."""
from __future__ import annotations
import numpy as np
from .common import Signals
from .sessions import session_features, regime_htf


class Swing:
    family = "SWING"
    def __init__(self, htf: str = "D1", entry: str = "pullback", stop: int = 20,
                 trail: int = 45, target: float | None = None, fast: int = 200, slow: int = 800) -> None:
        if entry not in ("pullback", "breakout"): raise ValueError(entry)
        self.params = dict(regime_tf=htf, entry=entry, stop_pips=stop, trail_pips=trail,
                           target_r=target, ema_fast=fast, ema_slow=slow)

    def signals(self, df):
        p, n = self.params, len(df)
        ss, out = session_features(df), Signals.blank(n)
        f = regime_htf(df, p["regime_tf"], p["ema_fast"], p["ema_slow"])
        reg = f.regime.to_numpy()
        fast = df.bid_close.ewm(span=20, adjust=False).mean()
        touched = (df.bid_low <= fast + 0.0002) & (df.bid_high >= fast - 0.0002)
        long = (reg > 0) & touched & (df.bid_close > fast)
        short = (reg < 0) & touched & (df.bid_close < fast)
        if p["entry"] == "breakout":
            hi = df.bid_high.shift(1).rolling(32).max()
            lo = df.bid_low.shift(1).rolling(32).min()
            long = (reg > 0) & (df.bid_close > hi)
            short = (reg < 0) & (df.bid_close < lo)
        desired = np.where(long, 1, np.where(short, -1, 0))
        used = set()
        for i, sess in enumerate(ss.session):
            if desired[i] and sess not in used:
                out.side[i] = desired[i]
                out.stop_pips[i] = p["stop_pips"]
                if p["target_r"] is not None:
                    out.target_r[i] = p["target_r"] * p["stop_pips"]
                out.trail_pips[i] = p["trail_pips"]
                used.add(sess)
        out.regime_exit[(reg != np.roll(reg,1)) | (reg == 0)] = 1
        out.metadata = self.params
        return out
