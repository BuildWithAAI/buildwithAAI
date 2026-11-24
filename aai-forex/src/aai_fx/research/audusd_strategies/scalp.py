"""SCALP: once per NY session, DST-aware open breakout, 20-30 pip targets."""
from __future__ import annotations
import numpy as np
from .common import Signals
from .sessions import session_features, regime_htf


class Scalp:
    family = "SCALP"
    def __init__(self, session: str = "london", stop: int = 10, target: int = 20,
                 lookback: int = 6, regime: str | None = None) -> None:
        if session not in ("london", "ny"): raise ValueError(session)
        self.params = dict(session=session, stop_pips=stop, target_pips=target, lookback=lookback,
                           regime_filter=regime or "none")

    def signals(self, df):
        p, n = self.params, len(df)
        ss, out = session_features(df), Signals.blank(n)
        high = df.bid_high.shift(1).rolling(p["lookback"]).max()
        low = df.bid_low.shift(1).rolling(p["lookback"]).min()
        hour = ss.ny_hour if p["session"] == "ny" else ss.london_hour
        if p["session"] == "ny":
            window = (hour >= 8) & (hour < 11)
            start = 8
        else:
            # Eight-o'clock London local open: 08 UTC winter / 07 UTC summer.
            window = (hour >= 8) & (hour < 11)
        # Do not combine London and NY into one tunable session.
        long = window & (df.bid_close > high)
        short = window & (df.bid_close < low)
        if p["regime_filter"] != "none":
            tf = p["regime_filter"]
            f = regime_htf(df, tf)
            long &= f.regime.to_numpy() > 0
            short &= f.regime.to_numpy() < 0
        desired = np.where(long, 1, np.where(short, -1, 0))
        used = set()
        for i, sess in enumerate(ss.session):
            if desired[i] and sess not in used:
                out.side[i] = desired[i]
                out.stop_pips[i] = p["stop_pips"]
                out.target_r[i] = p["target_pips"]
                used.add(sess)
        # At the close of the final entry window, any open position is exited
        # next M15 open (same NY session, no overnight holding).
        out.eod[(ss.session != ss.session.shift(-1)).to_numpy()] = 1
        out.metadata = self.params
        return out
