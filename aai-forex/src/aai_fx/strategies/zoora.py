"""Zoora Strategy family: rules built around a fast/slow EMA pair (default
200/800, 3-6-9 variant 198/792; slow = 4 x fast in both).

All variants share:
* ``ema_f = EMA(close, fast)``, ``ema_s = EMA(close, slow)`` on the OPERATING
  timeframe (no higher-timeframe mixing), ATR(14) Wilder.
* regime = +1 if close > ema_s and ema_f > ema_s; -1 if close < ema_s and
  ema_f < ema_s; else 0.
* EMA warm-up: an EMA with span N started from the first bar keeps
  (1 - 2/(N+1))^n weight on its seed after n bars. ``warmup_bars`` is the n at
  which that weight falls below ``seed_weight`` (default 1%): 1,842 bars for
  N=800, 1,824 for N=792. No signal is generated before it.

Variants (deliberately few, fixed-a-priori parameters):
* ``zoora_trend``    : enter when the regime turns on (0/-1 -> +1, or mirror);
                       initial stop ``stop_atr`` x ATR; exit when the regime
                       turns off. One trade per regime episode.
* ``zoora_pullback`` : inside a regime, enter when the bar's low (high) tags
                       the fast-EMA band (ema_f +/- ``band_atr`` x ATR) and
                       the bar closes back on the trend side of ema_f; stop
                       ``stop_atr`` x ATR, target ``target_r`` R; also exit if
                       the regime turns off.
* ``zoora_cross``    : ema_f crossing ema_s opens a trade in the cross
                       direction (stop ``stop_atr`` x ATR); the opposite cross
                       exits and reverses. After a stop-out, wait for the next
                       cross.

Research scaffolding. No claim of profitability.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd

from .base import BarContext, Signal, SignalAction, Strategy
from .indicators import atr, ema


def ema_warmup_bars(n: int, seed_weight: float = 0.01) -> int:
    """Bars until an EMA(span=n) seeded at bar 0 keeps < ``seed_weight`` on its seed."""
    alpha = 2.0 / (n + 1.0)
    return int(math.ceil(math.log(seed_weight) / math.log(1.0 - alpha)))


class _ZooraBase(Strategy):
    DEFAULTS: dict[str, Any] = {"ema_fast": 200, "ema_slow": 800, "atr_period": 14, "seed_weight": 0.01}

    def __init__(self, timeframe: str = "D1", **params: Any) -> None:
        super().__init__(timeframe, **{**self.DEFAULTS, **params})

    @property
    def warmup_bars(self) -> int:
        p = self.params
        return max(ema_warmup_bars(int(p["ema_slow"]), float(p["seed_weight"])), int(p["atr_period"]) + 1)

    def prepare(self, df: pd.DataFrame, pair: str) -> pd.DataFrame:
        p = self.params
        out = df.copy()
        c = df["close"]
        # adjust=False is a pure recursion -> causal; masked until warm-up below
        out["ema_f"] = c.ewm(span=int(p["ema_fast"]), adjust=False).mean()
        out["ema_s"] = c.ewm(span=int(p["ema_slow"]), adjust=False).mean()
        out["atr"] = atr(df, int(p["atr_period"]))
        warm = np.arange(len(df)) < self.warmup_bars
        out.loc[warm, ["ema_f", "ema_s"]] = np.nan
        up = (c > out["ema_s"]) & (out["ema_f"] > out["ema_s"])
        dn = (c < out["ema_s"]) & (out["ema_f"] < out["ema_s"])
        reg = np.where(up, 1.0, np.where(dn, -1.0, 0.0))
        out["regime"] = np.where(out["ema_s"].isna(), np.nan, reg)
        out["fs_sign"] = np.sign(out["ema_f"] - out["ema_s"])
        return out

    def _ok(self, *xs: float) -> bool:
        return not any(math.isnan(x) for x in xs)

    def _enter(self, ctx: BarContext, side: int, c: float, a: float, reason: str,
               target_r: float | None = None) -> list[Signal]:
        dist = self._stop_atr(ctx.ts) * a
        stop = c - side * dist
        tgt = c + side * float(target_r) * dist if target_r else None
        act = SignalAction.ENTER_LONG if side > 0 else SignalAction.ENTER_SHORT
        return [Signal(ctx.close_ts, ctx.pair, self.name, act, c, stop=stop, target=tgt, reason=reason,
                       meta={"atr": a, "ema_f": ctx.get("ema_f"), "ema_s": ctx.get("ema_s")})]

    def _stop_atr(self, ts: pd.Timestamp) -> float:
        """``stop_atr``, or the walk-forward schedule [(iso_ts, value), ...] in force at ``ts``
        (each value was chosen on data strictly before its timestamp)."""
        sched = self.params.get("stop_atr_schedule")
        val = float(self.params["stop_atr"])
        if sched:
            for t, v in sched:
                if pd.Timestamp(t) <= ts:
                    val = float(v)
        return val

    def _exit(self, ctx: BarContext, c: float, reason: str) -> list[Signal]:
        return [Signal(ctx.close_ts, ctx.pair, self.name, SignalAction.EXIT, c, reason=reason)]


class ZooraTrend(_ZooraBase):
    name = "zoora_trend"
    DEFAULTS = {**_ZooraBase.DEFAULTS, "stop_atr": 3.0}

    def on_bar(self, ctx: BarContext) -> list[Signal]:
        c, a, reg, prev = ctx.get("close"), ctx.get("atr"), ctx.get("regime"), ctx.get("regime", 1)
        if not self._ok(c, a, reg) or a <= 0:
            return []
        pos = ctx.position
        if pos is not None:
            if reg != pos.side:
                return self._exit(ctx, c, f"regime {reg:+.0f} no longer {pos.side:+d}")
            return []
        if math.isnan(prev):
            return []
        if reg != 0 and prev != reg:
            return self._enter(ctx, int(reg), c, a, f"regime turned {reg:+.0f} (close vs EMA{self.params['ema_slow']}, "
                                                    f"EMA{self.params['ema_fast']} vs EMA{self.params['ema_slow']})")
        return []


class ZooraPullback(_ZooraBase):
    name = "zoora_pullback"
    DEFAULTS = {**_ZooraBase.DEFAULTS, "stop_atr": 2.0, "band_atr": 0.25, "target_r": 2.0}

    def on_bar(self, ctx: BarContext) -> list[Signal]:
        c, a, reg, ef = ctx.get("close"), ctx.get("atr"), ctx.get("regime"), ctx.get("ema_f")
        if not self._ok(c, a, reg, ef) or a <= 0:
            return []
        pos = ctx.position
        if pos is not None:
            if reg != pos.side:
                return self._exit(ctx, c, f"regime {reg:+.0f} no longer {pos.side:+d}")
            return []
        band = float(self.params["band_atr"]) * a
        tr = self.params.get("target_r")
        if reg > 0 and ctx.get("low") <= ef + band and c > ef:
            return self._enter(ctx, 1, c, a, f"long pullback to EMA{self.params['ema_fast']} band", tr)
        if reg < 0 and ctx.get("high") >= ef - band and c < ef:
            return self._enter(ctx, -1, c, a, f"short pullback to EMA{self.params['ema_fast']} band", tr)
        return []


class ZooraCross(_ZooraBase):
    name = "zoora_cross"
    DEFAULTS = {**_ZooraBase.DEFAULTS, "stop_atr": 3.0}

    def reset(self) -> None:
        self._pending: dict[str, int] = {}

    def on_bar(self, ctx: BarContext) -> list[Signal]:
        c, a, sg, prev = ctx.get("close"), ctx.get("atr"), ctx.get("fs_sign"), ctx.get("fs_sign", 1)
        if not self._ok(c, a, sg) or a <= 0:
            return []
        crossed = (not math.isnan(prev)) and sg != 0 and prev != sg
        if crossed:
            self._pending[ctx.pair] = int(sg)
        pos = ctx.position
        if pos is not None:
            if sg != 0 and sg != pos.side:
                return self._exit(ctx, c, f"EMA{self.params['ema_fast']}/{self.params['ema_slow']} cross {sg:+.0f}")
            return []
        want = self._pending.get(ctx.pair)
        if want is not None and want == sg:
            del self._pending[ctx.pair]
            return self._enter(ctx, want, c, a, f"EMA{self.params['ema_fast']} crossed EMA{self.params['ema_slow']} {want:+d}")
        return []
