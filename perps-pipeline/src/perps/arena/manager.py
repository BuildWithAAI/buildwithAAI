"""1-minute position management for arena trades (simulation only).

Per open trade, every closed 1m bar since the trade's cursor is replayed in order:
  * at each arm-timeframe bar close: trailing-stop update, time stop and discretionary signal exit
    (decided at the close, filled at the next 1m open as a taker with slippage);
  * gap-through at the 1m open (liquidation, stop, take-profit), then intrabar liquidation/stop
    (stop-first when both stop and TP are inside the bar), then the take-profit, which is a resting
    MAKER limit and therefore requires the price to trade THROUGH it (high > TP for longs);
  * MAE/MFE tracking.
Funding is charged at every settlement the trade was open across, using the venue's settled rate.
The partially-elapsed entry minute is never used (we do not know where price went after the fill).
"""

from __future__ import annotations

import math
from typing import Any

import pandas as pd

from ..core.costs import CostModel, funding_payment, gross_pnl
from ..strategies.indicators import atr as atr_ind
from ..timeframes import ms as tf_ms
from .signals import closed_upto, exit_signal

MIN = 60_000


def iso(ms_: int) -> str:
    return pd.Timestamp(ms_, unit="ms", tz="UTC").isoformat()


def _excursion(t: dict[str, Any], lo: float, hi: float) -> None:
    s = t["side"]
    adverse, favourable = (lo, hi) if s > 0 else (hi, lo)
    if t.get("mae_price") is None or (adverse - t["mae_price"]) * s < 0:
        t["mae_price"] = adverse
    if t.get("mfe_price") is None or (favourable - t["mfe_price"]) * s > 0:
        t["mfe_price"] = favourable


def check_bar_1m(t: dict[str, Any], o: float, h: float, l: float, costs: CostModel) -> tuple[float, str, bool] | None:
    """Exit within one 1m bar -> (fill price, reason, maker?) or None. Conservative ordering."""
    s, stop, liq, tp = t["side"], t["stop_price"], t["liquidation_price"], t.get("take_profit")
    reason = "trail_stop" if abs(stop - t["initial_stop"]) > 1e-12 else "stop"
    if (s > 0 and o <= liq) or (s < 0 and o >= liq):
        return liq, "liquidation", False
    if (s > 0 and o <= stop) or (s < 0 and o >= stop):
        return costs.stop_fill(o, -s), reason, False
    if tp is not None and ((s > 0 and o > tp) or (s < 0 and o < tp)):
        return tp, "take_profit", True          # resting limit was already through: fills at its price
    if (s > 0 and l <= stop) or (s < 0 and h >= stop):
        fill = costs.stop_fill(stop, -s)
        liq_hit = (s > 0 and l <= liq) or (s < 0 and h >= liq)
        if liq_hit and ((s > 0 and fill <= liq) or (s < 0 and fill >= liq)):
            return liq, "liquidation", False
        return fill, reason, False
    if tp is not None and ((s > 0 and h > tp) or (s < 0 and l < tp)):
        return tp, "take_profit", True
    return None


def finalize_exit(t: dict[str, Any], exit_ms: int, price: float, reason: str, maker: bool, costs: CostModel,
                  detail: str = "") -> float:
    """Close the trade in-place; returns the cash delta to book now (gross PnL - exit fee)."""
    s = t["side"]
    t["exit_ms"] = int(exit_ms)
    t["exit_time"] = iso(exit_ms)
    t["exit_price"] = float(price)
    t["exit_reason"] = reason
    t["exit_detail"] = detail
    t["exit_maker"] = bool(maker)
    t["exit_fee"] = costs.fee(t["qty"] * price, maker=maker)
    t["gross_pnl"] = gross_pnl(s, t["qty"], t["entry_price"], price)
    t["net_pnl"] = t["gross_pnl"] - t["entry_fee"] - t["exit_fee"] + t.get("funding", 0.0)
    t["r_multiple"] = t["net_pnl"] / t["risk_amount"] if t["risk_amount"] else float("nan")
    t["duration_min"] = round((exit_ms - t["entry_ms"]) / MIN, 2)
    _excursion(t, price, price)
    risk_per_unit = t["risk_amount"] / t["qty"] if t["qty"] else float("nan")
    t["mae_r"] = (t["mae_price"] - t["entry_price"]) * s / risk_per_unit
    t["mfe_r"] = (t["mfe_price"] - t["entry_price"]) * s / risk_per_unit
    t["mae_usd"] = (t["mae_price"] - t["entry_price"]) * s * t["qty"]
    t["mfe_usd"] = (t["mfe_price"] - t["entry_price"]) * s * t["qty"]
    t["status"] = "closed"
    return t["gross_pnl"] - t["exit_fee"]


def apply_funding(t: dict[str, Any], funding: pd.DataFrame, bars1m: pd.DataFrame, upto_ms: int,
                  inclusive: bool, fallback_rate: float | None = None) -> float:
    """Settle every funding event st with entry < st (<=|<) upto_ms not yet applied. Returns cash delta."""
    cursor = int(t.get("funding_cursor_ms") or t["entry_ms"])
    interval_ms = int(float(t.get("funding_interval_hours", 8)) * 3_600_000)
    first = (cursor // interval_ms + 1) * interval_ms
    rates = dict(zip(funding["ts"].astype("int64"), funding["funding_rate"], strict=False)) if not funding.empty else {}
    delta = 0.0
    st = first
    while st < upto_ms or (inclusive and st == upto_ms):
        if st <= t["entry_ms"]:
            st += interval_ms
            continue
        rate, est = rates.get(st), False
        if rate is None:
            if inclusive:          # trade still open: wait for the settled rate to be published
                break
            if fallback_rate is None:
                break
            rate, est = fallback_rate, True
        row = bars1m[bars1m["ts"] == st] if not bars1m.empty else bars1m
        mark = float(row["open"].iloc[0]) if len(row) else float(t.get("last_price") or t["entry_price"])
        pay = funding_payment(t["side"], t["qty"], mark, float(rate))
        t.setdefault("funding_events", []).append({"time": iso(st), "rate": float(rate), "mark": mark,
                                                   "payment": pay, "estimated": est})
        t["funding"] = t.get("funding", 0.0) + pay
        delta += pay
        t["funding_cursor_ms"] = st
        st += interval_ms
    return delta


def _arm_bar_close(t: dict[str, Any], boundary_ms: int, arm_frame: pd.DataFrame, params: dict[str, Any],
                   kind: str) -> str | None:
    """Bookkeeping at an arm-timeframe bar close. Returns an exit reason ('time'/'signal: ...') or None."""
    tf = t["timeframe"]
    fr = closed_upto(arm_frame, tf, pd.Timestamp(boundary_ms, unit="ms", tz="UTC"))
    t["last_arm_close_ms"] = boundary_ms
    t["bars_held"] = int(t.get("bars_held", 0)) + 1
    if not fr.empty and int(fr["ts"].iloc[-1]) == boundary_ms - tf_ms(tf):
        h, l, c = float(fr["high"].iloc[-1]), float(fr["low"].iloc[-1]), float(fr["close"].iloc[-1])
        s = t["side"]
        t["best_price"] = max(t.get("best_price") or t["entry_price"], h) if s > 0 else \
            min(t.get("best_price") or t["entry_price"], l)
        mult = float(params.get("trail_atr_mult", 0) or 0)
        if mult > 0:
            a = float(atr_ind(fr, int(params.get("atr_period", 14))).iloc[-1])
            if a == a and a > 0:
                new = t["best_price"] - s * mult * a
                if s > 0 and new > t["stop_price"]:
                    t["stop_price"] = min(new, c)
                elif s < 0 and new < t["stop_price"]:
                    t["stop_price"] = max(new, c)
        sig = exit_signal(kind, tf, params, fr, s)
        if sig:
            return f"signal: {sig}"
    mh = int(params.get("max_hold_bars", 0) or 0)
    if mh and t["bars_held"] >= mh:
        return f"time: held {t['bars_held']} {tf} bars (max {mh})"
    return None


def manage_trade(t: dict[str, Any], bars1m: pd.DataFrame, arm_frame: pd.DataFrame, funding: pd.DataFrame,
                 costs: CostModel, params: dict[str, Any], kind: str, now_ms: int,
                 live_quote: dict[str, float] | None = None, fallback_rate: float | None = None) -> float:
    """Advance one open trade. Mutates `t`; returns the cash delta to book (funding + exit PnL)."""
    tfms = tf_ms(t["timeframe"])
    start = int(t["last_1m_ts"]) + MIN if t.get("last_1m_ts") is not None else (t["entry_ms"] // MIN + 1) * MIN
    bars = bars1m[bars1m["ts"] >= start] if not bars1m.empty else bars1m
    cash = 0.0
    s = t["side"]
    for ts, o, h, l, c in zip(bars["ts"].astype("int64"), bars["open"], bars["high"], bars["low"], bars["close"],
                              strict=False):
        ts = int(ts)
        if ts % tfms == 0 and ts > t["entry_ms"] and ts > int(t.get("last_arm_close_ms") or 0):
            why = _arm_bar_close(t, ts, arm_frame, params, kind)
            if why:
                cash += apply_funding(t, funding, bars1m, ts, inclusive=False, fallback_rate=fallback_rate)
                price = costs.market_fill(float(o), -s)
                return cash + finalize_exit(t, ts, price, why.split(":")[0], False, costs, why)
        hit = check_bar_1m(t, float(o), float(h), float(l), costs)
        if hit:
            price, reason, maker = hit
            exit_ms = ts + MIN - 1          # somewhere inside this minute; end of bar is conservative for funding
            cash += apply_funding(t, funding, bars1m, ts + MIN, inclusive=False, fallback_rate=fallback_rate)
            return cash + finalize_exit(t, exit_ms, price, reason, maker, costs)
        _excursion(t, float(l), float(h))
        t["last_1m_ts"] = ts
        t["last_price"] = float(c)
    # an arm bar that has closed but whose next 1m bar is not final yet -> decide now, fill at live quote
    boundary = (now_ms // tfms) * tfms
    if boundary > t["entry_ms"] and boundary > int(t.get("last_arm_close_ms") or 0) and live_quote:
        why = _arm_bar_close(t, boundary, arm_frame, params, kind)
        if why:
            cash += apply_funding(t, funding, bars1m, now_ms, inclusive=False, fallback_rate=fallback_rate)
            ref = live_quote["bid"] if s > 0 else live_quote["ask"]
            return cash + finalize_exit(t, now_ms, costs.market_fill(ref, -s), why.split(":")[0], False, costs, why)
    upto = int(t["last_1m_ts"]) + MIN if t.get("last_1m_ts") is not None else t["entry_ms"]
    cash += apply_funding(t, funding, bars1m, upto, inclusive=True)
    return cash


def try_fill_order(o: dict[str, Any], bars1m: pd.DataFrame, now_ms: int) -> tuple[str, int | None]:
    """Resting maker limit: fills only if a later 1m bar trades THROUGH the price. -> (state, fill_bar_ts)."""
    start = max(int(o.get("last_1m_ts") or 0) + MIN, (int(o["created_ms"]) // MIN + 1) * MIN)
    bars = bars1m[(bars1m["ts"] >= start) & (bars1m["ts"] < int(o["expires_ms"]))] if not bars1m.empty else bars1m
    for ts, h, l in zip(bars["ts"].astype("int64"), bars["high"], bars["low"], strict=False):
        if (o["side"] > 0 and l < o["limit_price"]) or (o["side"] < 0 and h > o["limit_price"]):
            return "filled", int(ts)
        o["last_1m_ts"] = int(ts)
    if now_ms >= int(o["expires_ms"]):
        return "expired", None
    return "open", None


def unrealized(t: dict[str, Any], price: float) -> float:
    if price is None or (isinstance(price, float) and math.isnan(price)):
        return 0.0
    return gross_pnl(t["side"], t["qty"], t["entry_price"], price)
