"""Arm signal rules. Every rule is evaluated at the CLOSE of a completed bar of the arm's timeframe,
using only data available at that moment, and returns a `Signal` carrying a written thesis plus the
exact indicator values that triggered it (these go verbatim into the trade journal)."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Protocol

import numpy as np
import pandas as pd

from ..strategies import build_strategy
from ..strategies.indicators import atr, ema, sma
from ..timeframes import bars_for_hours
from ..timeframes import ms as tf_ms


class MarketView(Protocol):
    def frame(self, symbol: str, timeframe: str) -> pd.DataFrame: ...
    def funding_history(self, symbol: str) -> pd.DataFrame: ...
    def current_funding(self, symbol: str) -> dict[str, Any] | None: ...
    def oi_history(self, symbol: str) -> pd.DataFrame: ...


@dataclass
class Signal:
    side: int
    stop_dist: float
    atr: float
    take_profit_r: float
    thesis: str
    indicators: dict[str, Any]
    bar_time: pd.Timestamp                    # open time of the signal bar (decision at its close)
    entry_type: str = "market"                # market | limit
    limit_price: float | None = None
    meta: dict[str, Any] = field(default_factory=dict)


def _r(x: Any, nd: int = 6) -> Any:
    if isinstance(x, (float, np.floating)):
        return None if math.isnan(float(x)) else round(float(x), nd)
    if isinstance(x, (np.integer,)):
        return int(x)
    if isinstance(x, (np.bool_,)):
        return bool(x)
    return x


def _clean(d: dict[str, Any]) -> dict[str, Any]:
    return {k: _r(v) for k, v in d.items()}


def side_word(side: int) -> str:
    return "LONG" if side > 0 else "SHORT"


def closed_upto(df: pd.DataFrame, tf: str, cutoff: pd.Timestamp) -> pd.DataFrame:
    """Bars of timeframe `tf` that had fully CLOSED at time `cutoff` (index = bar open time)."""
    if df.empty:
        return df
    cutoff_ms = int(cutoff.value // 1_000_000)
    return df[(df["ts"].astype("int64") + tf_ms(tf)).to_numpy() <= cutoff_ms]


# ---------------------------------------------------------------------------------------------- rules
def _strategy_eval(kind: str, tf: str, params: dict[str, Any], df: pd.DataFrame) -> tuple[pd.DataFrame, Any]:
    strat_keys = set(build_strategy(kind, tf).defaults)
    strat = build_strategy(kind, tf, {k: v for k, v in params.items() if k in strat_keys})
    return strat.compute(df), strat


def eval_range_breakout(tf: str, p: dict[str, Any], symbol: str, view: MarketView) -> tuple[Signal | None, dict]:
    df = view.frame(symbol, tf)
    if len(df) < 50:
        return None, {"reason": "insufficient bars", "bars": len(df)}
    sig, strat = _strategy_eval("range_breakout", tf, p, df)
    n = strat.n
    c = df["close"]
    hh = df["high"].rolling(n, min_periods=n).max().shift(1)
    ll = df["low"].rolling(n, min_periods=n).min().shift(1)
    t = ema(c, int(p["trend_ema"])) if p.get("trend_ema") else pd.Series(np.nan, index=df.index)
    vmed = df["volume"].rolling(n, min_periods=n).median().shift(1)
    a = sig["atr"]
    i = -1
    ind = _clean({"close": c.iloc[i], "prior_high": hh.iloc[i], "prior_low": ll.iloc[i], "lookback_bars": n,
                  "lookback_hours": p["lookback_hours"], f"ema{p.get('trend_ema')}": t.iloc[i],
                  "volume": df["volume"].iloc[i], "volume_median": vmed.iloc[i],
                  "volume_ratio": df["volume"].iloc[i] / vmed.iloc[i] if vmed.iloc[i] else np.nan,
                  "volume_mult_required": p["volume_mult"], "atr": a.iloc[i], "atr_period": p["atr_period"]})
    s = int(sig["signal"].iloc[i])
    if s == 0:
        return None, ind
    lvl = ind["prior_high"] if s > 0 else ind["prior_low"]
    ema_key = f"ema{p.get('trend_ema')}"
    thesis = (f"{side_word(s)} {symbol} momentum breakout on {tf}: the bar closed at {ind['close']} "
              f"{'above' if s > 0 else 'below'} the prior {p['lookback_hours']}h {'high' if s > 0 else 'low'} "
              f"{lvl}, with price {'above' if s > 0 else 'below'} EMA{p.get('trend_ema')} ({ind[ema_key]}) "
              f"and volume {ind['volume_ratio']:.2f}x the {n}-bar median (needs >{p['volume_mult']}x). Expect range "
              f"expansion to continue; stop {p['atr_stop_mult']} ATR ({ind['atr']}), target {p['take_profit_r']}R.")
    return Signal(s, float(sig["stop_dist"].iloc[i]), float(a.iloc[i]), float(p["take_profit_r"]), thesis, ind,
                  df.index[i]), ind


def eval_ema_pullback(tf: str, p: dict[str, Any], symbol: str, view: MarketView) -> tuple[Signal | None, dict]:
    df = view.frame(symbol, tf)
    if len(df) < 60:
        return None, {"reason": "insufficient bars", "bars": len(df)}
    sig, _ = _strategy_eval("ema_pullback", tf, p, df)
    c = df["close"]
    f, s_, t = ema(c, int(p["fast_ema"])), ema(c, int(p["slow_ema"])), ema(c, int(p["trend_ema"]))
    a = sig["atr"]
    i = -1
    bar_close = df.index[i] + pd.Timedelta(milliseconds=tf_ms(tf))
    rtf = p.get("regime_tf", "4H")
    rdf = closed_upto(view.frame(symbol, rtf), rtf, bar_close)
    rf, rs = ema(rdf["close"], int(p["regime_fast"])), ema(rdf["close"], int(p["regime_slow"]))
    k = int(p["regime_slope_bars"])
    regime = 0
    if len(rdf) > max(int(p["regime_slow"]), k) + 1:
        if rf.iloc[-1] > rs.iloc[-1] and rf.iloc[-1] > rf.iloc[-1 - k]:
            regime = 1
        elif rf.iloc[-1] < rs.iloc[-1] and rf.iloc[-1] < rf.iloc[-1 - k]:
            regime = -1
    ind = _clean({"open": df["open"].iloc[i], "high": df["high"].iloc[i], "low": df["low"].iloc[i], "close": c.iloc[i],
                  f"ema{p['fast_ema']}": f.iloc[i], f"ema{p['slow_ema']}": s_.iloc[i],
                  f"ema{p['slow_ema']}_5bars_ago": s_.iloc[i - 5], f"ema{p['trend_ema']}": t.iloc[i],
                  "atr": a.iloc[i], "pullback_band": float(p["pullback_atr"]) * a.iloc[i],
                  f"regime_{rtf}_ema{p['regime_fast']}": rf.iloc[-1] if len(rf) else np.nan,
                  f"regime_{rtf}_ema{p['regime_slow']}": rs.iloc[-1] if len(rs) else np.nan,
                  f"regime_{rtf}_ema{p['regime_fast']}_{k}bars_ago": rf.iloc[-1 - k] if len(rf) > k else np.nan,
                  "regime": {1: "bull", -1: "bear", 0: "neutral"}[regime], "raw_signal": int(sig["signal"].iloc[i])})
    s = int(sig["signal"].iloc[i])
    if s == 0:
        return None, ind
    if s != regime:
        ind["filtered"] = f"raw {side_word(s)} rejected by {rtf} regime filter ({ind['regime']})"
        return None, ind
    fe = f"ema{p['fast_ema']}"
    thesis = (f"{side_word(s)} {symbol} trend pullback on {tf}: EMA{p['fast_ema']} {ind[fe]} "
              f"{'>' if s > 0 else '<'} EMA{p['slow_ema']} {ind['ema' + str(p['slow_ema'])]}, close {ind['close']} "
              f"{'above' if s > 0 else 'below'} EMA{p['trend_ema']} {ind['ema' + str(p['trend_ema'])]}; the bar "
              f"{'dipped' if s > 0 else 'rallied'} to within {p['pullback_atr']} ATR of the fast EMA and closed back "
              f"{'above' if s > 0 else 'below'} it as a {'bull' if s > 0 else 'bear'} candle. {rtf} regime is "
              f"{ind['regime']} (EMA{p['regime_fast']} vs EMA{p['regime_slow']} and slope agree). Expect trend "
              f"resumption; stop {p['atr_stop_mult']} ATR ({ind['atr']}), target {p['take_profit_r']}R, trail "
              f"{p['trail_atr_mult']} ATR, exit if close crosses EMA{p['slow_ema']}.")
    return Signal(s, float(sig["stop_dist"].iloc[i]), float(a.iloc[i]), float(p["take_profit_r"]), thesis, ind,
                  df.index[i]), ind


def eval_vol_squeeze(tf: str, p: dict[str, Any], symbol: str, view: MarketView) -> tuple[Signal | None, dict]:
    df = view.frame(symbol, tf)
    if len(df) < 160:
        return None, {"reason": "insufficient bars", "bars": len(df)}
    sig, _ = _strategy_eval("vol_squeeze", tf, p, df)
    c = df["close"]
    n = int(p["bb_period"])
    mid = sma(c, n)
    sd = c.rolling(n, min_periods=n).std(ddof=0)
    up, lo = mid + float(p["bb_std"]) * sd, mid - float(p["bb_std"]) * sd
    width = (up - lo) / mid
    rank = width.rolling(int(p["squeeze_lookback"]), min_periods=int(p["squeeze_lookback"])).rank(pct=True)
    recent_min = rank.shift(1).rolling(int(p["squeeze_recent"]), min_periods=1).min()
    a = sig["atr"]
    i = -1
    ind = _clean({"close": c.iloc[i], "bb_mid": mid.iloc[i], "bb_upper": up.iloc[i], "bb_lower": lo.iloc[i],
                  "bandwidth": width.iloc[i], "bandwidth_pct_rank": rank.iloc[i],
                  "min_rank_last_bars": recent_min.iloc[i], "squeeze_pct_required": p["squeeze_pct"],
                  "atr": a.iloc[i]})
    s = int(sig["signal"].iloc[i])
    if s == 0:
        return None, ind
    thesis = (f"{side_word(s)} {symbol} volatility-squeeze breakout on {tf}: Bollinger bandwidth sat in the bottom "
              f"{p['squeeze_pct']:.0%} of its {p['squeeze_lookback']}-bar range (lowest recent rank "
              f"{ind['min_rank_last_bars']}) and the bar closed at {ind['close']} "
              f"{'above the upper' if s > 0 else 'below the lower'} band "
              f"({ind['bb_upper'] if s > 0 else ind['bb_lower']}). Compression tends to resolve with expansion in "
              f"the breakout direction; stop {p['atr_stop_mult']} ATR ({ind['atr']}), target {p['take_profit_r']}R, "
              f"exit if price closes back through the mid band.")
    return Signal(s, float(sig["stop_dist"].iloc[i]), float(a.iloc[i]), float(p["take_profit_r"]), thesis, ind,
                  df.index[i]), ind


def eval_funding_fade(tf: str, p: dict[str, Any], symbol: str, view: MarketView) -> tuple[Signal | None, dict]:
    df = view.frame(symbol, tf)
    fh = view.funding_history(symbol)
    cur = view.current_funding(symbol)
    if len(df) < 50 or fh.empty or not cur:
        return None, {"reason": "missing bars/funding", "bars": len(df), "funding_rows": len(fh)}
    bar_close = df.index[-1] + pd.Timedelta(milliseconds=tf_ms(tf))
    hist = fh[(fh.index <= bar_close) & (fh.index > bar_close - pd.Timedelta(days=int(p["lookback_days"])))]
    rate = float(cur["funding_rate"])
    hi = max(float(hist["funding_rate"].quantile(float(p["high_pct"]))), float(p["min_short_rate"]))
    lo = min(float(hist["funding_rate"].quantile(float(p["low_pct"]))), float(p["max_long_rate"]))
    c = df["close"]
    e = ema(c, int(p["confirm_ema"]))
    a = atr(df, int(p["atr_period"]))
    ind = _clean({"current_funding_rate": rate, "next_funding_time": cur.get("funding_time_iso"),
                  "hist_settlements": len(hist), f"p{int(float(p['high_pct']) * 100)}_threshold": hi,
                  f"p{int(float(p['low_pct']) * 100)}_threshold": lo,
                  "hist_median": hist["funding_rate"].median(), "close": c.iloc[-1],
                  f"ema{p['confirm_ema']}": e.iloc[-1], "atr": a.iloc[-1]})
    s = 0
    if rate >= hi and c.iloc[-1] < e.iloc[-1]:
        s = -1
    elif rate <= lo and c.iloc[-1] > e.iloc[-1]:
        s = 1
    if s == 0 or not a.iloc[-1] > 0:
        return None, ind
    thesis = (f"{side_word(s)} {symbol} funding-extreme fade/carry: current funding {rate:.6f} per "
              f"{cur.get('interval_hours', 8)}h is {'at/above the p' + str(int(float(p['high_pct']) * 100)) if s < 0 else 'at/below the p' + str(int(float(p['low_pct']) * 100))} "
              f"threshold {hi if s < 0 else lo:.6f} of the last {p['lookback_days']}d ({len(hist)} settlements, "
              f"median {ind['hist_median']}). {'Longs' if s < 0 else 'Shorts'} are crowded and paying; price "
              f"confirms ({tf} close {ind['close']} {'below' if s < 0 else 'above'} EMA{p['confirm_ema']} "
              f"{ind['ema' + str(p['confirm_ema'])]}). Collect funding while fading the crowd; stop "
              f"{p['atr_stop_mult']} ATR ({ind['atr']}), target {p['take_profit_r']}R, max hold {p['max_hold_bars']} bars.")
    return Signal(s, float(p["atr_stop_mult"]) * float(a.iloc[-1]), float(a.iloc[-1]), float(p["take_profit_r"]),
                  thesis, ind, df.index[-1]), ind


def eval_oi_divergence(tf: str, p: dict[str, Any], symbol: str, view: MarketView) -> tuple[Signal | None, dict]:
    df = view.frame(symbol, tf)
    oi = view.oi_history(symbol)
    if len(df) < 30:
        return None, {"reason": "insufficient bars", "bars": len(df)}
    bar_close = df.index[-1] + pd.Timedelta(milliseconds=tf_ms(tf))
    window = pd.Timedelta(hours=float(p["window_hours"]))
    tol = pd.Timedelta(minutes=float(p["snapshot_tolerance_min"]))
    oi = oi[oi.index <= bar_close] if not oi.empty else oi
    if len(oi) < int(p["min_snapshots"]):
        return None, {"reason": "OI history warming up", "oi_snapshots": len(oi),
                      "needed": int(p["min_snapshots"])}
    now_oi, now_t = float(oi["open_interest"].iloc[-1]), oi.index[-1]
    past = oi[oi.index <= now_t - window]
    if past.empty or (now_t - window) - past.index[-1] > tol or bar_close - now_t > tol:
        return None, {"reason": "no OI snapshot near window start/end", "oi_snapshots": len(oi)}
    past_oi, past_t = float(past["open_interest"].iloc[-1]), past.index[-1]
    nb = bars_for_hours(tf, float(p["window_hours"]))
    c = df["close"]
    if len(c) <= nb:
        return None, {"reason": "insufficient bars"}
    ret = c.iloc[-1] / c.iloc[-1 - nb] - 1
    doi = now_oi / past_oi - 1
    atf = p.get("atr_tf", "1H")
    adf = closed_upto(view.frame(symbol, atf), atf, bar_close)
    a = atr(adf, int(p["atr_period"])).iloc[-1] if len(adf) > int(p["atr_period"]) else np.nan
    ind = _clean({"close": c.iloc[-1], f"close_{p['window_hours']}h_ago": c.iloc[-1 - nb], "price_return": ret,
                  "oi_now": now_oi, "oi_now_time": now_t.isoformat(), "oi_then": past_oi, "oi_then_time": past_t.isoformat(),
                  "oi_change": doi, "price_move_required": p["price_move"], "oi_move_required": p["oi_move"],
                  f"atr_{atf}": a})
    s = 0
    if ret > float(p["price_move"]) and doi < -float(p["oi_move"]):
        s = -1
    elif ret < -float(p["price_move"]) and doi < -float(p["oi_move"]):
        s = 1
    if s == 0 or not (a == a and a > 0):
        return None, ind
    thesis = (f"{side_word(s)} {symbol} OI divergence: over {p['window_hours']}h price moved {ret:+.2%} while open "
              f"interest fell {doi:+.2%} ({past_oi:.0f} -> {now_oi:.0f}). "
              + ("A rally on falling OI is short covering, not fresh demand; fade it." if s < 0 else
                 "A selloff on falling OI is long liquidation/capitulation; expect a relief bounce.")
              + f" Stop {p['atr_stop_mult']} ATR({atf}) ({_r(a)}), target {p['take_profit_r']}R.")
    return Signal(s, float(p["atr_stop_mult"]) * float(a), float(a), float(p["take_profit_r"]), thesis, ind,
                  df.index[-1]), ind


def eval_maker_scalp(tf: str, p: dict[str, Any], symbol: str, view: MarketView) -> tuple[Signal | None, dict]:
    df = view.frame(symbol, tf)
    if len(df) < 60:
        return None, {"reason": "insufficient bars", "bars": len(df)}
    bar_close = df.index[-1] + pd.Timedelta(milliseconds=tf_ms(tf))
    ttf = p.get("trend_tf", "1H")
    tdf = closed_upto(view.frame(symbol, ttf), ttf, bar_close)
    if len(tdf) < int(p["trend_slow"]) + 2:
        return None, {"reason": "insufficient trend bars"}
    tf_ = ema(tdf["close"], int(p["trend_fast"])).iloc[-1]
    ts_ = ema(tdf["close"], int(p["trend_slow"])).iloc[-1]
    tc = tdf["close"].iloc[-1]
    trend = 1 if (tf_ > ts_ and tc > ts_) else (-1 if (tf_ < ts_ and tc < ts_) else 0)
    e = ema(df["close"], int(p["entry_ema"])).iloc[-1]
    a = atr(df, int(p["atr_period"])).iloc[-1]
    c = df["close"].iloc[-1]
    limit = e - trend * float(p["entry_offset_atr"]) * a if trend else np.nan
    ind = _clean({"trend_tf": ttf, f"trend_ema{p['trend_fast']}": tf_, f"trend_ema{p['trend_slow']}": ts_,
                  "trend_close": tc, "trend": {1: "up", -1: "down", 0: "none"}[trend], "close": c,
                  f"ema{p['entry_ema']}": e, "atr": a, "limit_price": limit})
    if trend == 0 or not a > 0:
        return None, ind
    # the resting order must be passive (below price for a buy, above for a sell)
    if (trend > 0 and limit >= c) or (trend < 0 and limit <= c):
        ind["filtered"] = "limit would be marketable (not a maker order)"
        return None, ind
    thesis = (f"{side_word(trend)} {symbol} maker-limit scalp: {ttf} trend is {ind['trend']} (EMA{p['trend_fast']} "
              f"{ind['trend_ema' + str(p['trend_fast'])]} vs EMA{p['trend_slow']} {ind['trend_ema' + str(p['trend_slow'])]}, "
              f"close {ind['trend_close']}). Rest a post-only {'bid' if trend > 0 else 'offer'} at {ind['limit_price']} "
              f"(5m EMA{p['entry_ema']} {ind['ema' + str(p['entry_ema'])]} {'-' if trend > 0 else '+'} "
              f"{p['entry_offset_atr']} ATR {ind['atr']}) to {'buy the dip' if trend > 0 else 'sell the bounce'} with the trend and earn the maker fee; fills "
              f"only if price trades through. Stop {p['atr_stop_mult']} ATR, target {p['take_profit_r']}R, order "
              f"expires after {p['order_ttl_min']} min.")
    return Signal(trend, float(p["atr_stop_mult"]) * float(a), float(a), float(p["take_profit_r"]), thesis, ind,
                  df.index[-1], entry_type="limit", limit_price=float(limit),
                  meta={"ttl_min": float(p["order_ttl_min"])}), ind


EVALUATORS = {"range_breakout": eval_range_breakout, "ema_pullback": eval_ema_pullback,
              "vol_squeeze": eval_vol_squeeze, "funding_fade": eval_funding_fade,
              "oi_divergence": eval_oi_divergence, "maker_scalp": eval_maker_scalp}


def evaluate(kind: str, tf: str, params: dict[str, Any], symbol: str, view: MarketView) -> tuple[Signal | None, dict]:
    return EVALUATORS[kind](tf, params, symbol, view)


# ---------------------------------------------------------------------------------------------- exits
def exit_signal(kind: str, tf: str, p: dict[str, Any], df: pd.DataFrame, side: int) -> str | None:
    """Discretionary exit decided at the close of the LAST row of df (a closed bar)."""
    if len(df) < 30:
        return None
    c = df["close"]
    if kind == "ema_pullback":
        s = ema(c, int(p["slow_ema"])).iloc[-1]
        if (side > 0 and c.iloc[-1] < s) or (side < 0 and c.iloc[-1] > s):
            return f"close {c.iloc[-1]:.6g} crossed EMA{p['slow_ema']} {s:.6g}"
    elif kind == "vol_squeeze":
        mid = sma(c, int(p["bb_period"])).iloc[-1]
        if (side > 0 and c.iloc[-1] < mid) or (side < 0 and c.iloc[-1] > mid):
            return f"close {c.iloc[-1]:.6g} back through BB mid {mid:.6g}"
    elif kind == "funding_fade":
        e = ema(c, int(p["confirm_ema"])).iloc[-1]
        if (side < 0 and c.iloc[-1] > e) or (side > 0 and c.iloc[-1] < e):
            return f"price confirmation lost: close {c.iloc[-1]:.6g} vs EMA{p['confirm_ema']} {e:.6g}"
    return None
