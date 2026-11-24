"""Arena (live paper-trading loop) tests: lock, kill switches, 1m management, signals, journal, learning,
archive. Everything here is simulated; no network."""

from __future__ import annotations

import json
import os

import numpy as np
import pandas as pd
import pytest

from perps.arena import signals as sigmod
from perps.arena.archive import archive_legacy, settle_archive, stop_touch
from perps.arena.config import ArenaCfg, ArenaLimits, ArmCfg
from perps.arena.journal import postmortem, render_md
from perps.arena.learning import ParamStore, learn
from perps.arena.ledger import ArenaLedger
from perps.arena.manager import MIN, apply_funding, check_bar_1m, finalize_exit, manage_trade, try_fill_order
from perps.arena.signals import Signal
from perps.arena.tick import Arena, kill_reasons, tick_lock
from perps.core.costs import CostModel
from perps.data.adapters.base import ExchangeAdapter
from perps.data.models import InstrumentSpec

H = 3_600_000
T0 = pd.Timestamp("2026-01-05 12:01:30", tz="UTC").value // 1_000_000   # clock for tick 1
COSTS = CostModel(0.0002, 0.0006, 2.0, 3.0, 0.0, take_profit_is_maker=True)


def bars(start_ms, n, step, o=100.0, h=100.2, l=99.8, c=100.0):
    ts = np.arange(start_ms, start_ms + n * step, step, dtype="int64")
    return pd.DataFrame({"ts": ts, "open": o, "high": h, "low": l, "close": c, "volume": 1.0, "quote_volume": 100.0})


def trade(side=1, entry=100.0, stop=99.0, tp=102.0, qty=1.0, entry_ms=None, tf="1H"):
    entry_ms = entry_ms if entry_ms is not None else T0
    return {"id": 1, "arm": "a", "kind": "funding_fade", "symbol": "UNIT-USDT", "timeframe": tf, "side": side,
            "status": "open", "entry_ms": entry_ms, "entry_time": pd.Timestamp(entry_ms, unit="ms", tz="UTC").isoformat(),
            "entry_price": entry, "qty": qty, "contracts": qty, "notional": qty * entry, "implied_leverage": 1.0,
            "margin": 10.0, "initial_stop": stop, "stop_price": stop, "take_profit": tp, "take_profit_r": 2.0,
            "liquidation_price": entry * (1 - side * 0.095), "risk_amount": abs(entry - stop) * qty,
            "entry_fee": COSTS.fee(qty * entry), "funding": 0.0, "funding_events": [], "bars_held": 0,
            "best_price": entry, "mae_price": entry, "mfe_price": entry, "params": {"max_hold_bars": 0},
            "funding_interval_hours": 8, "thesis": "t", "indicators": {"x": 1}, "params_version": 1}


# ------------------------------------------------------------------ 1m manager
def test_partial_entry_minute_is_skipped_and_stop_fill_has_slippage_and_fees():
    t = trade()
    m = (T0 // MIN) * MIN
    df = bars(m, 3, MIN)
    df.loc[0, "low"] = 90.0            # the entry minute itself: must be ignored
    df.loc[2, "low"] = 98.9            # stop at 99 hit in the 2nd full minute
    cash = manage_trade(t, df, pd.DataFrame(columns=df.columns), pd.DataFrame(columns=["ts", "funding_rate"]),
                        COSTS, t["params"], "funding_fade", T0 + 5 * MIN)
    assert t["status"] == "closed" and t["exit_reason"] == "stop"
    assert t["exit_price"] == pytest.approx(99.0 * (1 - 5 / 1e4))      # 2 bps market + 3 bps stop slippage
    assert t["exit_fee"] == pytest.approx(t["exit_price"] * 0.0006)
    assert t["net_pnl"] == pytest.approx(t["gross_pnl"] - t["entry_fee"] - t["exit_fee"])
    assert cash == pytest.approx(t["gross_pnl"] - t["exit_fee"])
    assert t["mae_price"] == pytest.approx(t["exit_price"])           # the 90 print in the entry minute is ignored
    assert t["r_multiple"] < -1.0                                      # fees + slippage make a stop slightly > 1R


def test_take_profit_needs_trade_through_and_is_maker():
    t = trade()
    assert check_bar_1m(t, 101.0, 102.0, 100.5, COSTS) is None         # touch only: resting limit not filled
    fill = check_bar_1m(t, 101.0, 102.01, 100.5, COSTS)
    assert fill == (102.0, "take_profit", True)
    cash = finalize_exit(t, T0 + 10 * MIN, 102.0, "take_profit", True, COSTS)
    assert t["exit_fee"] == pytest.approx(102.0 * 0.0002) and cash > 0


def test_stop_first_when_both_inside_bar_and_liquidation_on_gap():
    t = trade()
    assert check_bar_1m(t, 100.0, 103.0, 98.0, COSTS)[1] == "stop"
    t2 = trade(stop=99.0)
    t2["liquidation_price"] = 95.0
    assert check_bar_1m(t2, 94.0, 94.5, 93.0, COSTS)[:2] == (95.0, "liquidation")


def test_short_mfe_mae_and_funding_received_when_rate_positive():
    t = trade(side=-1, entry=100.0, stop=101.0, tp=98.0)
    settle = ((T0 // (8 * H)) + 1) * 8 * H                               # next 8h settlement after entry
    m = (T0 // MIN + 1) * MIN
    n = int((settle - m) / MIN) + 3
    df = bars(m, n, MIN, h=100.4, l=99.5)
    fund = pd.DataFrame({"ts": [settle], "funding_rate": [0.0003]})
    cash = manage_trade(t, df, pd.DataFrame(columns=df.columns), fund, COSTS, t["params"], "x", settle + 3 * MIN)
    assert t["status"] == "open"
    assert t["funding"] == pytest.approx(1.0 * 100.0 * 0.0003)          # short receives
    assert cash == pytest.approx(t["funding"])
    assert t["mfe_price"] == 99.5 and t["mae_price"] == 100.4
    # idempotent: a second pass applies nothing new
    assert manage_trade(t, df, pd.DataFrame(columns=df.columns), fund, COSTS, t["params"], "x",
                        settle + 3 * MIN) == pytest.approx(0.0)


def test_funding_waits_for_published_rate_while_open():
    t = trade()
    settle = ((T0 // (8 * H)) + 1) * 8 * H
    assert apply_funding(t, pd.DataFrame(columns=["ts", "funding_rate"]), pd.DataFrame(columns=["ts", "open"]),
                         settle + MIN, inclusive=True) == 0.0
    assert t.get("funding_cursor_ms") is None


def test_time_exit_on_arm_bar_close():
    t = trade(entry_ms=T0)
    t["params"] = {"max_hold_bars": 1}
    m = (T0 // MIN + 1) * MIN
    df = bars(m, 70, MIN)
    arm = bars((T0 // H) * H, 2, H)
    manage_trade(t, df, arm, pd.DataFrame(columns=["ts", "funding_rate"]), COSTS, t["params"], "x", m + 70 * MIN)
    assert t["status"] == "closed" and t["exit_reason"] == "time"
    assert t["exit_ms"] % H == 0                                        # filled at the next 1m open after the close


def test_maker_order_fills_only_on_trade_through_and_expires():
    o = {"side": 1, "limit_price": 99.5, "created_ms": T0, "expires_ms": T0 + 30 * MIN}
    m = (T0 // MIN + 1) * MIN
    df = bars(m, 5, MIN, l=99.5)                                         # touches but never trades through
    assert try_fill_order(dict(o), df, T0 + 6 * MIN) == ("open", None)
    df.loc[3, "low"] = 99.4
    assert try_fill_order(dict(o), df, T0 + 6 * MIN) == ("filled", int(df.loc[3, "ts"]))
    assert try_fill_order(dict(o), bars(m, 2, MIN), T0 + 31 * MIN)[0] == "expired"


# ------------------------------------------------------------------ signals
class View:
    def __init__(self, frames=None, funding=None, cur=None, oi=None):
        self.frames, self.f, self.c, self.o = frames or {}, funding, cur, oi

    def frame(self, s, tf):
        return self.frames[tf]

    def funding_history(self, s):
        return self.f

    def current_funding(self, s):
        return self.c

    def oi_history(self, s):
        return self.o


def _frame(closes, freq="1h"):
    idx = pd.date_range("2026-01-01", periods=len(closes), freq=freq, tz="UTC")
    c = np.asarray(closes, float)
    return pd.DataFrame({"ts": idx.asi8 // 1_000_000, "open": c, "high": c * 1.002, "low": c * 0.998, "close": c,
                         "volume": 1.0}, index=idx)


FF = {"lookback_days": 90, "high_pct": 0.95, "low_pct": 0.05, "min_short_rate": 0.0001, "max_long_rate": -0.00005,
      "confirm_ema": 20, "atr_period": 14, "atr_stop_mult": 2.0, "take_profit_r": 2.0, "max_hold_bars": 24}


def test_funding_fade_short_on_extreme_positive_funding_with_price_confirmation():
    df = _frame(np.r_[np.full(80, 100.0), np.linspace(100, 97, 20)])
    fidx = pd.date_range(end=df.index[-1], periods=200, freq="8h", tz="UTC")
    fh = pd.DataFrame({"ts": fidx.asi8 // 1_000_000, "funding_rate": np.linspace(-0.0001, 0.0002, 200)}, index=fidx)
    sig, ind = sigmod.eval_funding_fade("1H", FF, "X", View({"1H": df}, fh, {"funding_rate": 0.0005}))
    assert sig is not None and sig.side == -1
    assert ind["current_funding_rate"] == 0.0005 and "p95_threshold" in ind
    assert "funding" in sig.thesis and str(ind["close"]) in sig.thesis
    # normal funding -> nothing
    assert sigmod.eval_funding_fade("1H", FF, "X", View({"1H": df}, fh, {"funding_rate": 0.0001}))[0] is None


OI = {"window_hours": 4, "price_move": 0.01, "oi_move": 0.01, "min_snapshots": 48, "snapshot_tolerance_min": 20,
      "atr_tf": "1H", "atr_period": 14, "atr_stop_mult": 1.5, "take_profit_r": 2.0}


def _oi(df15, values):
    end = df15.index[-1] + pd.Timedelta(minutes=15)
    idx = pd.date_range(end=end, periods=len(values), freq="5min", tz="UTC")
    return pd.DataFrame({"ts": idx.asi8 // 1_000_000, "open_interest": values}, index=idx)


def test_oi_divergence_rally_on_falling_oi_is_short_and_warmup_blocks():
    df15 = _frame(np.r_[np.full(40, 100.0), np.linspace(100, 102.5, 20)], freq="15min")
    df1h = _frame(np.full(60, 100.0))
    oi = _oi(df15, np.linspace(1000, 950, 60))
    sig, ind = sigmod.eval_oi_divergence("15m", OI, "X", View({"15m": df15, "1H": df1h}, oi=oi))
    assert sig is not None and sig.side == -1 and ind["oi_change"] < -0.01 and ind["price_return"] > 0.01
    sig2, ind2 = sigmod.eval_oi_divergence("15m", OI, "X", View({"15m": df15, "1H": df1h}, oi=oi.tail(10)))
    assert sig2 is None and ind2["reason"] == "OI history warming up"


def test_ema_pullback_regime_filter_rejects_counter_trend():
    p = {"fast_ema": 20, "slow_ema": 50, "trend_ema": 200, "pullback_atr": 0.5, "atr_period": 14,
         "atr_stop_mult": 2.0, "take_profit_r": 2.5, "trail_atr_mult": 3.0, "max_hold_bars": 120,
         "regime_tf": "4H", "regime_fast": 50, "regime_slow": 200, "regime_slope_bars": 5}
    up = _frame(np.linspace(80, 120, 400))
    # last bar: pullback to the fast EMA then a bullish close back above it
    f = up["close"].ewm(span=20, adjust=False).mean().iloc[-1]
    up.iloc[-1, up.columns.get_loc("open")] = f - 0.05
    up.iloc[-1, up.columns.get_loc("low")] = f - 0.1
    up.iloc[-1, up.columns.get_loc("close")] = f + 0.3
    up.iloc[-1, up.columns.get_loc("high")] = f + 0.4
    bear4h = _frame(np.linspace(200, 100, 300), freq="4h")
    bear4h.index = bear4h.index - (bear4h.index[-1] - up.index[-1]) - pd.Timedelta(hours=4)
    sig, ind = sigmod.eval_ema_pullback("1H", p, "X", View({"1H": up, "4H": bear4h}))
    assert ind["raw_signal"] == 1 and sig is None and "regime filter" in ind["filtered"]


def test_maker_scalp_places_passive_limit_with_trend():
    p = {"trend_tf": "1H", "trend_fast": 20, "trend_slow": 50, "entry_ema": 20, "entry_offset_atr": 0.2,
         "atr_period": 14, "atr_stop_mult": 1.2, "take_profit_r": 1.5, "order_ttl_min": 30}
    h1 = _frame(np.linspace(90, 110, 120))
    m5 = _frame(np.linspace(108, 111, 120), freq="5min")
    m5.index = m5.index + (h1.index[-1] + pd.Timedelta(hours=1) - m5.index[-1] - pd.Timedelta(minutes=5))
    sig, ind = sigmod.eval_maker_scalp("5m", p, "X", View({"5m": m5, "1H": h1}))
    assert sig is not None and sig.side == 1 and sig.entry_type == "limit"
    assert sig.limit_price < ind["close"]


# ------------------------------------------------------------------ journal / learning / config
def test_postmortem_tags():
    t = trade()
    finalize_exit(t, T0 + 3 * MIN, 99.0, "stop", False, COSTS)
    text, tags = postmortem(t)
    assert "immediate_adverse" in tags and "hit the stop" in text
    t2 = trade()
    t2["mfe_price"] = 101.5
    finalize_exit(t2, T0 + 300 * MIN, 99.0, "stop", False, COSTS)
    assert "gave_back_profit" in postmortem(t2)[1]
    t3 = trade(qty=1.0)
    finalize_exit(t3, T0 + 300 * MIN, 100.05, "time", False, COSTS)
    assert "fees_ate_edge" in postmortem(t3)[1]
    t3["postmortem"], t3["tags"] = postmortem(t3)
    md = render_md(t3)
    for needle in ("Thesis", "Indicator values", "PnL", "Duration", "MAE", "MFE", "Post-mortem"):
        assert needle in md


def _closed(n, mfe_r=1.5, reason="time", r=-0.2):
    out = []
    for i in range(n):
        out.append({"status": "closed", "exit_reason": reason, "r_multiple": r, "net_pnl": r * 1.5,
                    "gross_pnl": 0.0, "entry_fee": 0.1, "exit_fee": 0.1, "funding": 0.0, "duration_min": 60,
                    "mae_r": -0.5, "mfe_r": mfe_r, "tags": ["time_exit"], "params_version": 1, "id": i,
                    "symbol": "X", "side": 1})
    return out


def test_learning_is_sample_gated_versioned_and_capped(tmp_path):
    cfg = ArenaCfg(arms={"a": ArmCfg(kind="funding_fade", timeframe="1H", params={"take_profit_r": 2.0,
                                                                                     "atr_stop_mult": 2.0})})
    store = ParamStore(tmp_path)
    store.ensure("a", {"take_profit_r": 2.0, "atr_stop_mult": 2.0}, 0.015)
    assert learn("a", cfg, store, _closed(19)) == []                       # below min_trades: no change
    ch = learn("a", cfg, store, _closed(20))
    assert ch and ch[0]["version"] == 2 and ch[0]["changes"]["take_profit_r"] == [2.0, 1.35]
    doc = store.load("a")
    assert doc["current"]["version"] == 2 and len(doc["history"]) == 2 and doc["history"][1]["reason"]
    assert learn("a", cfg, store, _closed(20)) == []                       # needs 20 trades on the NEW version
    bad = [dict(t, params_version=2, r_multiple=-0.8, mfe_r=0.1) for t in _closed(45)]
    ch = learn("a", cfg, store, bad)
    cur = store.load("a")["current"]
    assert cur["risk_per_trade"] == 0.01 and cur["benched"] is True and 0.01 <= cur["risk_per_trade"] <= 0.03


def test_limits_refuse_risk_above_3pct_and_leverage_above_10x():
    with pytest.raises(ValueError):
        ArenaLimits(max_risk=0.05)
    with pytest.raises(ValueError):
        ArenaLimits(risk_per_trade=0.04)
    with pytest.raises(ValueError):
        ArenaLimits(max_leverage=20)


def test_shipped_arena_config_has_all_six_arms():
    from perps.arena.config import load_arena_config
    cfg = load_arena_config()
    assert set(cfg.arms) == {"momentum_breakout", "ema_trend_pullback", "vol_squeeze", "funding_fade",
                             "oi_divergence", "maker_scalp"}
    assert cfg.initial_equity == 100.0 and cfg.limits.risk_per_trade == 0.015 and cfg.limits.max_risk <= 0.03
    assert cfg.limits.max_leverage <= 10


# ------------------------------------------------------------------ archive
def test_archive_records_close_at_stop_and_verifies_touch(tmp_path):
    import sqlite3
    db = tmp_path / "paper.sqlite"
    con = sqlite3.connect(db)
    con.executescript("CREATE TABLE account (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE positions (id INTEGER "
                      "PRIMARY KEY, status TEXT, closed_at TEXT, exit_price REAL, exit_reason TEXT, gross_pnl REAL, "
                      "fees REAL, funding REAL, net_pnl REAL, r_multiple REAL, data TEXT); CREATE TABLE events (id "
                      "INTEGER PRIMARY KEY, ts TEXT, kind TEXT, payload TEXT);")
    entry = pd.Timestamp("2026-11-01T23:23:56Z")
    pos = {"symbol": "BTC-USDT", "side": -1, "qty": 0.0027, "entry_time": entry.isoformat(),
           "entry_price": 78041.28862, "stop_price": 78453.6, "take_profit": 77010.5, "risk_amount": 1.4727,
           "entry_fee": 0.1264, "strategy": "ema_pullback", "timeframe": "1H"}
    con.execute("INSERT INTO account VALUES ('cash', '99.87')")
    con.execute("INSERT INTO positions(id, status, data) VALUES (1, 'open', ?)", (json.dumps(pos),))
    con.commit()
    con.close()
    m = (entry.value // 1_000_000 // MIN) * MIN
    b = bars(m, 60, MIN, o=78300.0, h=78400.0, l=78200.0, c=78300.0)
    b.loc[41, "high"] = 78488.8
    fund = pd.DataFrame({"ts": [pd.Timestamp("2026-11-02T00:00Z").value // 1_000_000], "funding_rate": [0.00022]})
    assert stop_touch(-1, 78453.6, entry.value // 1_000_000, b)["ts"] == int(b.loc[41, "ts"])
    out = archive_legacy(db, tmp_path / "archive", {"BTC-USDT": b}, {"BTC-USDT": fund}, 0.0006)
    r = out[0]
    assert r["exit_price"] == 78453.6 and "VERIFIED" in r["verification"]
    assert r["gross_pnl"] == pytest.approx(-(78453.6 - 78041.28862) * 0.0027)
    assert r["exit_fee"] == pytest.approx(0.0027 * 78453.6 * 0.0006)
    assert r["funding"] > 0                                                  # short received positive funding
    assert not db.exists() and list((tmp_path / "archive").glob("paper_*.sqlite"))
    res = settle_archive(pos, 78453.6, int(b.loc[41, "ts"]) + MIN - 1, fund, b, 0.0006)
    assert res["net_pnl"] == pytest.approx(res["gross_pnl"] - res["fees"] + res["funding"])


# ------------------------------------------------------------------ full tick (fake exchange, fixed clock)
class FakeEx(ExchangeAdapter):
    name = "blofin"
    verified_live = True

    def __init__(self):
        self.price = 100.0
        self.data = {
            "1m": bars(T0 - 600 * MIN - (T0 % MIN), 600, MIN),       # last bar opens 12:00 -> closed at 12:01
            "1H": bars((T0 // H) * H - 300 * H, 300, H),             # last bar opens 11:00 -> closed at 12:00
        }

    def fetch_instruments(self):
        return [self.fetch_instrument("UNIT-USDT")]

    def fetch_instrument(self, symbol):
        return InstrumentSpec(exchange="blofin", symbol=symbol, exchange_symbol=symbol, base="UNIT", quote="USDT",
                              contract_value=1.0, min_size=0.001, lot_size=0.001, tick_size=0.01, max_leverage=50)

    def fetch_tickers(self):
        return pd.DataFrame([{"symbol": "UNIT-USDT", "last": self.price, "bid": self.price - 0.01,
                              "ask": self.price + 0.01, "quote_volume_24h": 1e6, "ts": T0}])

    def fetch_candles_page(self, symbol, timeframe, end_ms, limit):
        return self.data[timeframe].tail(limit).copy()

    def fetch_candles(self, symbol, timeframe, start_ms, end_ms=None):
        d = self.data[timeframe]
        return d[d.ts >= start_ms].reset_index(drop=True)

    def fetch_funding_page(self, symbol, end_ms, limit):
        return pd.DataFrame(columns=["ts", "funding_rate"])

    def fetch_current_funding(self, symbol):
        return {"funding_rate": 0.0001, "funding_time_ms": T0 + 4 * H, "interval_hours": 8}

    def fetch_open_interest(self, symbol):
        return pd.DataFrame([{"ts": T0, "open_interest": 1000.0, "open_interest_ccy": 1000.0}])


def _arena(settings, tmp_path, clock, monkeypatch, fire=True):
    calls = {"n": 0}

    def fake_eval(tf, p, symbol, view):
        calls["n"] += 1
        df = view.frame(symbol, tf)
        if not fire or calls["n"] > 1:
            return None, {"why": "test"}
        return Signal(1, 1.0, 1.0, 2.0, "TEST THESIS long because test", {"close": 100.0}, df.index[-1]), {}

    monkeypatch.setitem(sigmod.EVALUATORS, "funding_fade", fake_eval)
    cfg = ArenaCfg(symbols=["UNIT-USDT"], arms={"test_arm": ArmCfg(kind="funding_fade", timeframe="1H",
                                                                   params={"take_profit_r": 2.0, "max_hold_bars": 0,
                                                                           "confirm_ema": 20})})
    ex = FakeEx()
    return Arena(settings, cfg, ex, root=tmp_path / "arena", clock=clock), ex


def test_tick_opens_with_thesis_then_stops_out_on_1m_and_writes_journal(settings, tmp_path, monkeypatch):
    now = {"t": T0 / 1000}
    arena, ex = _arena(settings, tmp_path, lambda: now["t"], monkeypatch)
    s1 = arena.tick()
    assert s1.status == "ok" and len(s1.opened) == 1, s1
    led = ArenaLedger(tmp_path / "arena" / "arena.sqlite")
    t = led.trades("test_arm", "open")[0]
    assert t["thesis"].startswith("TEST THESIS") and t["indicators"] == {"close": 100.0}
    assert t["risk_budget"] == pytest.approx(1.5) and t["implied_leverage"] <= 10
    led.close()
    # five more minutes; the 12:03 bar trades through the stop
    m = ex.data["1m"]
    extra = bars(int(m.ts.iloc[-1]) + MIN, 5, MIN)
    extra.loc[2, "low"] = t["stop_price"] - 0.5
    ex.data["1m"] = pd.concat([m, extra], ignore_index=True)
    now["t"] = (T0 + 5 * MIN) / 1000
    s2 = arena.tick()
    assert len(s2.closed) == 1 and s2.closed[0]["reason"] == "stop"
    led = ArenaLedger(tmp_path / "arena" / "arena.sqlite")
    c = led.trades("test_arm", "closed")[0]
    assert c["postmortem"] and c["tags"] and c["duration_min"] > 0 and c["mae_r"] <= 0
    assert led.arm("test_arm")["cash"] == pytest.approx(100.0 + c["net_pnl"])
    led.close()
    root = tmp_path / "arena"
    assert (root / "stats.json").exists() and (root / "lessons.md").exists() and (root / "status.md").exists()
    assert list((root / "journal").glob("00001_*.md"))
    assert json.loads((root / "params" / "test_arm.json").read_text())["current"]["version"] == 1
    assert (root / "lessons_log.jsonl").read_text().count("\n") == 1
    assert "status=ok" in (root / "tick.log").read_text()


def test_global_agent_guard_kill_blocks_entries_but_positions_are_still_managed(settings, tmp_path, monkeypatch):
    now = {"t": T0 / 1000}
    arena, ex = _arena(settings, tmp_path, lambda: now["t"], monkeypatch)
    arena.tick()                                         # opens one position
    kill = tmp_path / "agent_guard_KILL_SWITCH"          # conftest points AGENT_GUARD_KILL_FILE here
    assert os.environ["AGENT_GUARD_KILL_FILE"] == str(kill)
    kill.touch()
    m = ex.data["1m"]
    extra = bars(int(m.ts.iloc[-1]) + MIN, 5, MIN)
    extra.loc[1, "low"] = 90.0
    ex.data["1m"] = pd.concat([m, extra], ignore_index=True)
    now["t"] = (T0 + 5 * MIN) / 1000
    s = arena.tick()
    assert any("agent-guard" in k for k in s.kill)
    assert len(s.closed) == 1 and not s.opened          # managed to its stop, no new entries


def test_kill_before_any_entry_opens_nothing(settings, tmp_path, monkeypatch):
    (tmp_path / "agent_guard_KILL_SWITCH").touch()
    arena, _ = _arena(settings, tmp_path, lambda: T0 / 1000, monkeypatch)
    s = arena.tick()
    assert s.kill and not s.opened and not s.orders
    assert kill_reasons(settings, tmp_path / "arena")


def test_tick_lock_prevents_overlap(settings, tmp_path, monkeypatch):
    arena, _ = _arena(settings, tmp_path, lambda: T0 / 1000, monkeypatch)
    with tick_lock(tmp_path / "arena" / "tick.lock") as owned:
        assert owned
        s = arena.tick()
    assert s.status.startswith("skipped") and not s.opened
    assert arena.tick().status == "ok"                  # lock released afterwards
