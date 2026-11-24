"""Turn parsed Signals into tradeable Setups (R1 bias-then-trigger breakout, R2 retest-reversal).

A Setup is only *armed* by price action AFTER post_ts; the engine enforces this."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

import pandas as pd

from ..config import StrategyCfg
from ..models import Scenario, Signal
from .filters import FilterContext, btc_bias_at, position_mismatch

RULE_NAMES = {"breakout": "R1_bias_then_trigger", "retest": "R2_retest_reversal"}


@dataclass
class Setup:
    signal: Signal
    scenario: Scenario
    asset: str
    side: str
    kind: str
    level: float
    target: float | None
    valid_from: datetime
    valid_until: datetime
    bias_aligned: bool
    btc_aligned: bool
    explicit: bool

    @property
    def rule(self) -> str:
        return RULE_NAMES[self.kind]

    @property
    def confirmed(self) -> bool:
        """Qualifies for the 2% tier: bias agrees, BTC agrees, and he literally called the trade."""
        return self.bias_aligned and self.btc_aligned and self.explicit


def _sign(side: str) -> int:
    return 1 if side == "long" else -1


def last_close_before(h1: pd.DataFrame, ts: datetime) -> float | None:
    closed = h1[h1.index + pd.Timedelta(hours=1) <= ts]
    return float(closed["close"].iloc[-1]) if not closed.empty else None


def build_setups(signals: list[Signal], cfg: StrategyCfg, h1: dict[str, pd.DataFrame],
                 btc_d1: pd.DataFrame | None, ctx: FilterContext | None = None) -> list[Setup]:
    ctx = ctx or FilterContext()
    signals = sorted(signals, key=lambda s: s.post_ts)
    btc_sigs = [s for s in signals if s.asset == "BTC"]
    next_post: dict[str, datetime | None] = {}
    by_asset: dict[str, list[Signal]] = {}
    for s in signals:
        by_asset.setdefault(s.asset, []).append(s)
    out: list[Setup] = []
    for asset, sigs in by_asset.items():
        for i, s in enumerate(sigs):
            later = [x.post_ts for x in sigs[i + 1:] if x.post_ts > s.post_ts]
            next_post[s.post_id] = later[0] if later else None
    for s in signals:
        if s.parse_status != "actionable":
            ctx.reject(f"parse_{s.parse_status}")
            continue
        if s.asset not in h1 or h1[s.asset].empty:
            ctx.reject("no_market_data")
            continue
        if cfg.skip_indecisive and s.bias == 0:
            ctx.reject("indecisive_close")
            continue
        price = last_close_before(h1[s.asset], s.post_ts)
        if price is None:
            ctx.reject("no_price_before_post")
            continue
        if cfg.skip_on_position_mismatch and position_mismatch(s, price, cfg.position_mismatch_tol_pct):
            ctx.reject("position_mismatch")
            continue
        btc = btc_bias_at(s.post_ts, btc_sigs, btc_d1) if s.asset != "BTC" else (
            (1 if s.bias > 0 else -1 if s.bias < 0 else 0))
        ttl_end = s.post_ts + timedelta(hours=cfg.signal_ttl_hours)
        nxt = next_post[s.post_id]
        until = min(ttl_end, nxt) if nxt else ttl_end
        for sc in s.scenarios:
            if sc.side == "flat" or sc.kind not in cfg.rules:
                continue
            if cfg.scenario_strength == "explicit" and not sc.explicit:
                ctx.reject("not_explicit")
                continue
            d = _sign(sc.side)
            if abs(sc.level - price) / price * 100 > cfg.max_level_distance_pct:
                ctx.reject("level_too_far")
                continue
            bias_aligned = s.bias * d >= 0
            if cfg.require_bias_alignment and s.bias * d < 0:
                ctx.reject("bias_opposes")
                continue
            btc_aligned = btc * d >= 0
            if cfg.btc_filter and s.asset != "BTC" and btc * d < 0:
                ctx.reject("btc_opposes")
                continue
            out.append(Setup(
                signal=s, scenario=sc, asset=s.asset, side=sc.side, kind=sc.kind, level=sc.level,
                target=sc.target, valid_from=s.post_ts, valid_until=until,
                bias_aligned=bias_aligned and s.bias != 0, btc_aligned=btc_aligned, explicit=sc.explicit,
            ))
    return out
