"""Event-driven backtest on 1h bars.

Timing contract (no lookahead):
  * a setup becomes observable on the first 1h bar whose OPEN is >= post_ts;
  * triggers are evaluated on bar CLOSE; fills happen at the NEXT bar's open (+slippage);
  * stops/targets are checked against later bars' high/low; when stop and target/partial are both
    inside one bar the stop is assumed to hit first (conservative);
  * ATR / BTC context / correlations use only data closed before the decision time.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime

import numpy as np
import pandas as pd

from ..config import Settings, StrategyCfg
from ..market.data import MarketData
from ..risk import OpenRisk, RiskEngine, rolling_corr
from ..strategy import EventCalendar, Setup


@dataclass
class Trade:
    asset: str
    side: str
    rule: str
    tier: str
    explicit: bool
    bias: int
    close_label: str
    post_id: str
    url: str
    post_ts: str
    entry_ts: str
    entry: float
    stop: float
    target: float
    target_source: str
    qty: float
    risk_usd: float
    risk_pct: float
    exit_ts: str = ""
    exit_price: float = 0.0
    exit_reason: str = ""
    partial_taken: bool = False
    pnl_usd: float = 0.0
    fees_usd: float = 0.0
    r_multiple: float = 0.0
    notes: str = ""


@dataclass
class _Pos:
    trade: Trade
    d: int
    qty_left: float
    stop: float
    stop_close_based: bool
    partial_px: float | None
    entry_ts: pd.Timestamp
    realised: float = 0.0
    exit_notional: float = 0.0


@dataclass
class _Live:
    setup: Setup
    count: int = 0
    touched: bool = False
    done: bool = False


@dataclass
class BacktestResult:
    trades: list[Trade]
    equity: pd.Series  # hourly mark-to-market
    rejections: dict[str, int] = field(default_factory=dict)
    killed_days: list[str] = field(default_factory=list)
    start: str = ""
    end: str = ""

    def trades_df(self) -> pd.DataFrame:
        return pd.DataFrame([asdict(t) for t in self.trades])


def _rej(d: dict, k: str) -> None:
    d[k] = d.get(k, 0) + 1


def run_backtest(setups: list[Setup], md: MarketData, settings: Settings, *,
                 strategy: StrategyCfg | None = None, calendar: EventCalendar | None = None,
                 start: datetime | None = None, end: datetime | None = None,
                 start_equity: float | None = None, corr_cache: dict | None = None) -> BacktestResult:
    cfg = strategy or settings.strategy
    costs = settings.costs
    fee, slip = costs.fee_bps / 1e4, costs.slippage_bps / 1e4
    risk = RiskEngine(settings.risk)
    rej: dict[str, int] = {}

    base = md.h1["BTC"]
    idx = base.index
    if start is not None:
        idx = idx[idx >= pd.Timestamp(start)]
    if end is not None:
        idx = idx[idx <= pd.Timestamp(end)]
    if len(idx) == 0:
        return BacktestResult([], pd.Series(dtype=float), rej)

    assets = [a for a in settings.assets if a in md.h1 and not md.h1[a].empty]
    A = {}
    for a in assets:
        f = md.h1[a].reindex(idx)
        A[a] = {k: f[k].to_numpy(dtype=float) for k in ("open", "high", "low", "close", "atr")}
    d1_close = {a: md.d1[a]["close"] for a in assets if a in md.d1}

    pending = sorted([s for s in setups if s.asset in A and idx[0] <= pd.Timestamp(s.valid_from) <= idx[-1]],
                     key=lambda s: s.valid_from)
    p_i = 0
    live: list[_Live] = []
    armed: list[_Live] = []
    positions: dict[str, _Pos] = {}
    trades: list[Trade] = []
    equity = float(start_equity if start_equity is not None else settings.backtest.start_equity)
    cash = equity
    eq_curve = np.empty(len(idx))
    corr_cache = corr_cache if corr_cache is not None else {}

    def close_part(pos: _Pos, qty: float, px: float, ts: pd.Timestamp, reason: str | None) -> None:
        nonlocal cash
        pnl = pos.d * (px - pos.trade.entry) * qty
        f = abs(px * qty) * fee
        cash += pnl - f
        pos.realised += pnl - f
        pos.trade.fees_usd += f
        pos.qty_left -= qty
        pos.exit_notional += px * qty
        if reason is not None:
            t = pos.trade
            t.exit_ts, t.exit_reason = ts.isoformat(), reason
            t.exit_price = pos.exit_notional / t.qty if t.qty else px
            t.pnl_usd = pos.realised
            t.r_multiple = t.pnl_usd / t.risk_usd if t.risk_usd else 0.0
            del positions[t.asset]
            trades.append(t)

    for i, ts in enumerate(idx):
        # 1) fills at this bar's open for setups armed on the previous close
        for lv in armed:
            s = lv.setup
            a, d = s.asset, (1 if s.side == "long" else -1)
            o, atr = A[a]["open"][i], A[a]["atr"][i - 1] if i > 0 else np.nan
            if np.isnan(o) or np.isnan(atr):
                _rej(rej, "no_bar_or_atr")
                continue
            ev = calendar.blackout(ts.to_pydatetime(), cfg.event_blackout_before_h,
                                   cfg.event_blackout_after_h) if calendar else None
            if ev:
                _rej(rej, f"blackout_{ev}")
                continue
            entry = o * (1 + d * slip)
            if d * (entry - s.level) / s.level * 100 > cfg.max_chase_pct:
                _rej(rej, "chase_too_far")
                continue
            stop = s.level - d * cfg.stop_atr_mult * atr
            per_unit = d * (entry - stop)
            if per_unit <= 0:
                _rej(rej, "entry_beyond_stop")
                continue
            tgt, src = None, "fallback_R"
            if s.target is not None and d * (s.target - entry) > 0:
                tgt, src = s.target, "stated"
                if d * (tgt - entry) / per_unit < cfg.min_rr:
                    _rej(rej, "rr_below_min")
                    continue
            if tgt is None:
                tgt = entry + d * cfg.fallback_target_r * per_unit
            if a in positions:
                _rej(rej, "asset_position_limit")
                continue
            dkey = ts.normalize()
            if dkey not in corr_cache:
                corr_cache[dkey] = rolling_corr(d1_close, ts.to_pydatetime(), settings.risk.corr_lookback_days)
            opens = [OpenRisk(p.trade.asset, p.trade.side, max(0.0, p.d * (p.trade.entry - p.stop)) * p.qty_left,
                              abs(p.qty_left * p.trade.entry)) for p in positions.values()]
            dec = risk.size(ts=ts.to_pydatetime(), equity=equity, asset=a, side=s.side, entry=entry, stop=stop,
                            confirmed=s.confirmed, open_positions=opens, corr=corr_cache[dkey])
            if not dec.approved:
                _rej(rej, dec.reason)
                continue
            f = dec.notional_usd * fee
            cash -= f
            partial_px = entry + d * cfg.partial_at_r * per_unit if cfg.partial_fraction > 0 else None
            if partial_px is not None and d * (tgt - partial_px) <= 0:
                partial_px = None
            t = Trade(asset=a, side=s.side, rule=s.rule, tier=dec.tier, explicit=s.explicit, bias=s.signal.bias,
                      close_label=s.signal.close_label, post_id=s.signal.post_id, url=s.signal.url,
                      post_ts=s.signal.post_ts.isoformat(), entry_ts=ts.isoformat(), entry=entry, stop=stop,
                      target=tgt, target_source=src, qty=dec.qty, risk_usd=dec.risk_usd, risk_pct=dec.risk_pct,
                      fees_usd=f, notes=";".join(dec.notes))
            positions[a] = _Pos(t, d, dec.qty, stop, cfg.stop_mode == "close_back", partial_px, ts, realised=-f)
        armed = []

        # 2) manage open positions on this bar
        for a in list(positions):
            pos = positions[a]
            o, h, l, c = (A[a][k][i] for k in ("open", "high", "low", "close"))
            if np.isnan(o):
                continue
            d = pos.d
            adverse, fav = (l, h) if d == 1 else (h, l)
            t = pos.trade
            if not pos.stop_close_based and d * (o - pos.stop) <= 0:
                close_part(pos, pos.qty_left, o * (1 - d * slip), ts, "stop_gap")
                continue
            if not pos.stop_close_based and d * (adverse - pos.stop) <= 0:
                close_part(pos, pos.qty_left, pos.stop * (1 - d * slip),
                           ts, "breakeven" if t.partial_taken else "stop")
                continue
            if pos.stop_close_based and d * (c - pos.stop) <= 0:
                close_part(pos, pos.qty_left, c * (1 - d * slip), ts, "stop_close")
                continue
            if pos.partial_px is not None and not t.partial_taken and d * (fav - pos.partial_px) >= 0:
                q = t.qty * cfg.partial_fraction
                close_part(pos, q, pos.partial_px, ts, None)
                t.partial_taken = True
                if cfg.breakeven_after_partial:
                    pos.stop = t.entry
                    pos.stop_close_based = False
            if d * (fav - t.target) >= 0:
                close_part(pos, pos.qty_left, t.target, ts, "target")
                continue
            if (ts - pos.entry_ts).total_seconds() / 3600 >= cfg.time_stop_hours:
                close_part(pos, pos.qty_left, c * (1 - d * slip), ts, "time_stop")
                continue

        # 3) mark to market
        unreal = 0.0
        for a, pos in positions.items():
            c = A[a]["close"][i]
            if not np.isnan(c):
                unreal += pos.d * (c - pos.trade.entry) * pos.qty_left
        equity = cash + unreal
        eq_curve[i] = equity
        risk.on_equity(ts.to_pydatetime(), equity)

        # 4) new setups become observable; evaluate triggers on this bar's close
        while p_i < len(pending) and pd.Timestamp(pending[p_i].valid_from) <= ts:
            live.append(_Live(pending[p_i]))
            p_i += 1
        still = []
        for lv in live:
            s = lv.setup
            if ts >= pd.Timestamp(s.valid_until):
                _rej(rej, "expired_untriggered")
                continue
            a, d = s.asset, (1 if s.side == "long" else -1)
            o, h, l, c, atr = (A[a][k][i] for k in ("open", "high", "low", "close", "atr"))
            if np.isnan(c):
                still.append(lv)
                continue
            if s.kind == "breakout":
                lv.count = lv.count + 1 if d * (c - s.level) > 0 else 0
                if lv.count >= cfg.n_hold:
                    armed.append(lv)
                    continue
            else:  # retest-reversal
                adverse = l if d == 1 else h
                if d * (adverse - s.level * (1 + d * cfg.retest_tol_pct / 100)) <= 0:
                    lv.touched = True
                if lv.touched and not np.isnan(atr) and d * (c - (s.level - d * cfg.stop_atr_mult * atr)) < 0:
                    _rej(rej, "retest_failed")
                    continue
                prev_fav = (A[a]["high"] if d == 1 else A[a]["low"])[i - 1] if i > 0 else np.nan
                if lv.touched and d * (c - s.level) > 0 and not np.isnan(prev_fav) and d * (c - prev_fav) > 0:
                    armed.append(lv)
                    continue
            still.append(lv)
        live = still
        if risk.kill_switch_active(ts.to_pydatetime()) and armed:
            for _ in armed:
                _rej(rej, "daily_loss_kill_switch")
            armed = []

    # close anything still open at the last bar
    last = idx[-1]
    for a in list(positions):
        c = A[a]["close"][-1]
        pos = positions[a]
        close_part(pos, pos.qty_left, c * (1 - pos.d * slip), last, "end_of_data")
    if len(eq_curve):
        eq_curve[-1] = cash
    trades.sort(key=lambda t: t.entry_ts)
    return BacktestResult(trades, pd.Series(eq_curve, index=idx), rej,
                          sorted(str(d) for d in risk.killed_days), idx[0].isoformat(), idx[-1].isoformat())
