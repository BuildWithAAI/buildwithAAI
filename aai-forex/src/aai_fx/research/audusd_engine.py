"""AUDUSD-only bid/ask bar simulator for four independent research strategies.

Bar open times, market fills at next bar open, actual BID for sells and ASK for
buys. Stops fill first when target and stop occur in the same bar. BE/trailing
updates at close t can only affect t+1. $100 lot stepping is downstairs by
0.01; a 0.01 lot trade is skipped above 3% initial risk (costs included).

This is deliberately separate from MT5 and the live adapter. No orders leave
this process. See report.md for assumptions and sample limitations.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd
from numba import njit

from ..backtest.metrics import compute_metrics
from ..execution.models import ClosedTrade


@dataclass(frozen=True)
class Simulation:
    spread_mode: str = "raw"          # raw | fixed
    spread_pips: float = 1.15
    slippage_pips: float = 0.15       # entry each side
    stop_slippage_pips: float = 0.25
    commission_lot_side: float = 0.0
    swap_long_pa: float = -1.5
    swap_short_pa: float = -1.0
    leverage: float = 10.0
    breakeven: bool = False
    trail_after_r: float = 1.0


@dataclass
class SimOutput:
    metrics: dict[str, Any]
    trades: list[dict[str, Any]]
    equity: list[float]
    long_losing_streak: int
    skipped_risk: int
    entry_signals: int
    max_lots: float
    lots_steps: int

    def summary(self) -> dict[str, Any]:
        return {**self.metrics, "longest_losing_streak": self.long_losing_streak,
                "skipped_risk": self.skipped_risk, "entry_signals": self.entry_signals,
                "max_lots": self.max_lots, "lot_steps": self.lots_steps}


@njit(cache=True)
def _core(bid_o: np.ndarray, bid_h: np.ndarray, bid_l: np.ndarray, bid_c: np.ndarray,
          ask_o: np.ndarray, ask_h: np.ndarray, ask_l: np.ndarray, ask_c: np.ndarray,
          epoch_days: np.ndarray, time_ns: np.ndarray, side_sig: np.ndarray,
          stop_pips: np.ndarray, target_r: np.ndarray, trail_pips: np.ndarray,
          exit_sig: np.ndarray, eod_sig: np.ndarray, max_bars: int,
          entry_bid: np.ndarray, entry_ask: np.ndarray, slippage: float,
          stop_slip: float, comm: float, swap_long: float, swap_short: float,
          start_eq: float, risk_pct: float, max_risk_pct: float, force_minlot: bool,
          leverage: float, breakeven: bool, trail_after_r: float) -> tuple:
    n = len(bid_o)
    target_r = np.where(np.isfinite(target_r), target_r, -1.0)
    trail_pips = np.where(np.isfinite(trail_pips), trail_pips, 1e10)
    eqs = np.empty(n)
    trades = np.empty((n, 22))
    cash = start_eq
    nt = 0
    skipped = 0
    signals = 0
    longest_loss = 0
    loss_streak = 0
    max_lots = 0.0
    steps = 0
    side = 0
    entry = stop = init_stop = target = trail = orig_r = lots = 0.0
    swap = 0.0
    entry_t = 0
    bars = 0
    prev_side = 0
    prev_stop = prev_target = prev_trail = 0.0
    prev_exit = False
    prev_eod = False
    for i in range(n):
        # financing on a calendar-day boundary; USD notional, assumed rates.
        if side != 0 and i > 0 and epoch_days[i] > epoch_days[i-1]:
            nights = epoch_days[i] - epoch_days[i-1]
            rate = swap_long if side > 0 else swap_short
            amount = lots * 100000.0 * bid_o[i] * rate / 100.0 / 365.0 * nights
            cash += amount
            swap += amount
        # Risk check uses fresh equity before entry; only one position.
        if side == 0 and prev_side != 0:
            signals += 1
            px = (entry_ask[i] if prev_side > 0 else entry_bid[i]) + prev_side * slippage * 0.0001
            sp = prev_stop
            st = px - sp * 0.0001 if prev_side > 0 else px + sp * 0.0001
            risk_per_lot = (sp + stop_slip) * 10.0 + 2.0 * comm
            eq_before = cash
            lots0 = np.floor((eq_before * risk_pct / 100.0) / (risk_per_lot * 0.01) + 1e-9) * 0.01
            lots0=min(lots0,np.floor(cash*leverage/(100000*px)/.01)*.01)
            risk_min = risk_per_lot * 0.01
            if force_minlot and lots0 < 0.009999 and risk_min <= eq_before * max_risk_pct / 100.0:
                lots0 = 0.01
            if lots0 < 0.009999 or risk_min > eq_before * max_risk_pct / 100.0 or cash <= 0 or lots0*100000*px/leverage>cash or lots0>100:
                skipped += 1
            else:
                side = prev_side
                lots = lots0
                entry = px
                init_stop = st
                stop = st
                orig_r = sp
                trail = prev_trail * 0.0001
                target = entry + side * prev_target * 0.0001 if prev_target > 0 else 0.0
                swap = 0.0
                entry_t = time_ns[i]
                bars = 0
                cash -= comm * lots
                if lots > max_lots + 1e-9:
                    max_lots = lots
                    steps += 1
        # Stops, targets and end-of-day. Stops are checked before targets.
        exit_kind = 0
        xp = 0.0
        if side != 0:
            bars += 1
            if prev_exit or prev_eod or (max_bars > 0 and bars > max_bars):
                xp = (bid_o[i] if side > 0 else ask_o[i]) - side*slippage*.0001
                exit_kind = 3 if prev_eod or max_bars>0 else 4
            elif side > 0:
                if bid_l[i] <= stop:
                    xp = min(stop, bid_o[i]) - stop_slip * 0.0001
                    exit_kind = 1
                elif target > 0 and bid_h[i] >= target:
                    xp = max(target, bid_o[i])
                    exit_kind = 2
            elif exit_kind == 0:
                if ask_h[i] >= stop:
                    xp = max(stop, ask_o[i]) + stop_slip * 0.0001
                    exit_kind = 1
                elif target > 0 and ask_l[i] <= target:
                    xp = min(target, ask_o[i])
                    exit_kind = 2
        if exit_kind == 0 and i == n - 1 and side!=0:
            xp = bid_c[i] if side > 0 else ask_c[i]
            exit_kind = 3
        if exit_kind != 0:
            gross = (xp - entry) * side * lots * 100000.0
            comm_exit = comm * lots
            cash += gross - comm_exit
            net = gross - comm * lots - comm_exit + swap
            initial = (orig_r + stop_slip) * 10.0 * lots + 2.0 * comm * lots
            trades[nt, 0] = entry_t
            trades[nt, 1] = time_ns[i]
            trades[nt, 2] = side
            trades[nt, 3] = lots
            trades[nt, 4] = entry
            trades[nt, 5] = xp
            trades[nt, 6] = gross
            trades[nt, 7] = comm * lots + comm_exit
            trades[nt, 8] = swap
            trades[nt, 9] = net
            trades[nt, 10] = initial
            trades[nt, 11] = net / initial if initial > 0 else 0.0
            trades[nt, 12] = bars
            trades[nt, 13] = orig_r
            trades[nt, 14] = exit_kind
            trades[nt, 15] = bid_o[i]
            trades[nt, 16] = entry - side * init_stop * side  # audit: signed entry-stop distance
            trades[nt, 17] = target
            trades[nt, 18] = trail / 0.0001
            trades[nt, 19] = 0.0
            trades[nt, 20] = 0.0
            trades[nt, 21] = 0.0
            nt += 1
            if net > 0:
                loss_streak = 0
            else:
                loss_streak += 1
                longest_loss = max(longest_loss, loss_streak)
            side = 0
            prev_side = 0
            prev_exit = False
            prev_eod = False
        # Mark-to-market at the close including liquidation spread.
        if side > 0:
            eqs[i] = cash + (bid_c[i] - entry) * lots * 100000.0
        elif side < 0:
            eqs[i] = cash + (entry - ask_c[i]) * lots * 100000.0
        else:
            eqs[i] = cash
        # Manage only at the known close; protects next bar, not this one.
        if side != 0:
            unreal_pips = ((bid_c[i] - entry) if side > 0 else (entry - ask_c[i])) / 0.0001
            if breakeven and unreal_pips >= orig_r:
                stop = max(stop, entry) if side > 0 else min(stop, entry)
            if unreal_pips >= orig_r*trail_after_r:
                if side > 0:
                    stop = max(stop, bid_c[i] - trail)
                else:
                    stop = min(stop, ask_c[i] + trail)
        prev_side = side_sig[i] if side == 0 else 0
        prev_stop = stop_pips[i]
        prev_target = target_r[i]
        prev_trail = trail_pips[i]
        prev_exit = exit_sig[i] != 0 and side != 0
        prev_eod = eod_sig[i] != 0 and side != 0
    return eqs, trades[:nt], longest_loss, skipped, signals, max_lots, steps


def simulate(df: pd.DataFrame, side: np.ndarray, stop_pips: np.ndarray, target_pips: np.ndarray,
             trail_pips: np.ndarray, exit_sig: np.ndarray, eod_sig: np.ndarray,
             start: pd.Timestamp | None = None, end: pd.Timestamp | None = None,
             max_bars: int = 0, same_day_exit: bool = False, start_equity: float = 100.0, risk_pct: float = 1.0,
             max_risk_pct: float = 3.0, force_minlot: bool = True, costs: Simulation = Simulation()) -> SimOutput:
    """Run on actual BID/ASK columns. Input arrays must be precomputed causally."""
    keep = np.ones(len(df), dtype=bool)
    if start is not None:
        keep &= df.index >= start
    if end is not None:
        keep &= df.index < end
    selected = np.where(keep)[0]
    d = df.iloc[selected].copy()
    arrays = {"side": side[selected], "stop_pips": stop_pips[selected], "target_r": target_pips[selected],
              "trail_pips": trail_pips[selected], "exit_sig": exit_sig[selected], "eod_sig": eod_sig[selected]}
    # Truncate everything before the run start, not just order entry: positions
    # cannot silently cross IS/OOS boundaries, and no signal sees future bars.
    if same_day_exit:
        days = d.index.tz_convert("America/New_York").date
        arrays["eod_sig"] = (days != np.roll(days, -1)).astype(np.int64)
    sp = ((d.ask_open - d.bid_open) / 0.0001).to_numpy() if costs.spread_mode == "raw" else np.full(len(d), costs.spread_pips)
    offset = sp * 0.00005
    bid = np.column_stack([d.bid_open, d.bid_high, d.bid_low, d.bid_close]).astype(float)
    ask = np.column_stack([d.ask_open, d.ask_high, d.ask_low, d.ask_close]).astype(float)
    if costs.spread_mode == "fixed":
        mid=(bid+ask)/2
        bid=mid-offset[:,None]
        ask=mid+offset[:,None]
    eqs, trades, streak, skipped, nsig, max_lot, steps = _core(
        bid[:, 0], bid[:, 1], bid[:, 2], bid[:, 3], ask[:, 0], ask[:, 1], ask[:, 2], ask[:, 3],
        np.floor(d.index.to_numpy("datetime64[ns]").astype(np.int64) / 86400000000000).astype(np.int64), d.index.to_numpy("datetime64[ns]").astype(np.int64),
        arrays["side"].astype(np.int64), arrays["stop_pips"].astype(float), arrays["target_r"].astype(float),
        arrays["trail_pips"].astype(float), arrays["exit_sig"].astype(np.int64), arrays["eod_sig"].astype(np.int64),
        max_bars, bid[:, 0], ask[:, 0], costs.slippage_pips, costs.stop_slippage_pips, costs.commission_lot_side,
        costs.swap_long_pa, costs.swap_short_pa, start_equity, risk_pct, max_risk_pct, force_minlot, costs.leverage, costs.breakeven, costs.trail_after_r)
    kind = {1: "STOP", 2: "TARGET", 3: "TIME", 4: "REGIME"}
    records: list[dict[str, Any]] = []
    closed: list[ClosedTrade] = []
    for t in trades:
        ets, xts = pd.Timestamp(int(t[0]), unit="ns", tz="UTC"), pd.Timestamp(int(t[1]), unit="ns", tz="UTC")
        ct = ClosedTrade("AUDUSD", int(t[2]), float(t[3]), ets, xts, float(t[4]), float(t[5]), kind[int(t[14])],
                         float(t[6]), float(t[7]), float(t[9]), float(t[10]), float(t[11]), int(t[12]), swap=float(t[8]))
        closed.append(ct)
        records.append({**ct.to_dict(), "stop_pips": float(t[13])})
    idx = d.index
    series = pd.Series(eqs, index=idx)
    # All cash, including unrealised P/L before the last data close, is shown.
    metrics = compute_metrics(series, closed, start_equity)
    metrics["ending_equity"] = float(series.iloc[-1])
    peak=np.maximum.accumulate(np.r_[start_equity,eqs])
    metrics["max_drawdown_pct"]=float(100*np.max(1-np.r_[start_equity,eqs]/peak))
    metrics["functional_ruin_50pct"]=bool(np.min(eqs)<=start_equity*.5)
    metrics["risk_or_margin_skip_present"]=bool(skipped>0)
    metrics["accounting_error_usd"]=float(series.iloc[-1]-start_equity-sum(t.net_pnl for t in closed))
    # CAGR/total return must agree with marked ending equity.
    days = max((series.index[-1] - series.index[0]).total_seconds() / 86400, 1e-9)
    metrics["total_return_pct"] = 100 * (series.iloc[-1] / start_equity - 1)
    metrics["cagr_pct"] = 100 * ((series.iloc[-1] / start_equity) ** (365.25 / days) - 1) if series.iloc[-1] > 0 else None
    return SimOutput(metrics, records, eqs.tolist(), streak, skipped, nsig, max_lot, steps)
