"""`perps tick`: one cron-friendly step of the live paper-trading arena. SIMULATION ONLY.

Order of work in every tick:
  1. take a non-blocking exclusive lock (state/arena/tick.lock) - a second concurrent tick exits;
  2. read the kill switches (config flag, state/KILL, state/arena/KILL and the box-wide agent-guard
     file). If any is active: no new entries, resting simulated orders are cancelled, but existing
     simulated positions keep being managed so their stops/targets/funding stay honest;
  3. refresh public market data (1m/5m/15m/1H/4H candles, funding history, current funding and an
     open-interest snapshot, each appended to history);
  4. fill/expire resting maker orders and manage open positions on 1m bars;
  5. per-arm risk gates (drawdown kill, daily loss), learning rules;
  6. evaluate each arm on newly closed bars and open simulated positions;
  7. write the journal, stats.json, lessons.md, status.json/status.md and a tick.log line.
"""

from __future__ import annotations

import contextlib
import fcntl
import json
import logging
import math
import os
import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import pandas as pd

from ..config import Settings
from ..core.costs import CostModel
from ..data.adapters.base import ExchangeAdapter
from ..data.http import ExchangeAPIError, ExchangeUnavailable
from ..data.store import ParquetStore
from ..risk.limits import _global_kill
from ..risk.sizing import size_position
from ..strategies.indicators import ema
from ..timeframes import ms as tf_ms
from .config import ArenaCfg
from .journal import cst, postmortem, write_trade_md
from .learning import ParamStore, learn, write_outputs
from .ledger import ArenaLedger, utcnow
from .manager import MIN, finalize_exit, iso, manage_trade, try_fill_order, unrealized
from .signals import closed_upto, evaluate

log = logging.getLogger(__name__)

FRESH_BARS = {"1m": 720, "5m": 400, "15m": 400, "1H": 400, "4H": 400}


@contextlib.contextmanager
def tick_lock(path: Path) -> Iterator[bool]:
    """Yields True if we own the lock, False if another tick holds it. Never blocks."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o644)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            yield False
            return
        os.ftruncate(fd, 0)
        os.write(fd, f"{os.getpid()} {utcnow()}\n".encode())
        try:
            yield True
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN)
    finally:
        os.close(fd)


def kill_reasons(settings: Settings, arena_dir: Path) -> list[str]:
    out = []
    if settings.risk.kill_switch:
        out.append("config risk.kill_switch=true")
    local = settings.path(settings.risk.kill_switch_file) if settings.risk.kill_switch_file else settings.state_dir / "KILL"
    if local.exists():
        out.append(f"kill file {local}")
    if (arena_dir / "KILL").exists():
        out.append(f"kill file {arena_dir / 'KILL'}")
    if _global_kill():
        out.append("global agent-guard kill file " + (os.environ.get("AGENT_GUARD_KILL_FILE")
                                                       or "/workspace/agent-guard/state/KILL_SWITCH"))
    return out


class LiveView:
    """Closed-bar market data for the current tick (implements signals.MarketView)."""

    def __init__(self) -> None:
        self.frames: dict[tuple[str, str], pd.DataFrame] = {}
        self.funding: dict[str, pd.DataFrame] = {}
        self.cur_funding: dict[str, dict[str, Any]] = {}
        self.oi: dict[str, pd.DataFrame] = {}
        self.quotes: dict[str, dict[str, float]] = {}

    def frame(self, symbol: str, timeframe: str) -> pd.DataFrame:
        return self.frames.get((symbol, timeframe), pd.DataFrame(columns=["ts", "open", "high", "low", "close", "volume"]))

    def funding_history(self, symbol: str) -> pd.DataFrame:
        return self.funding.get(symbol, pd.DataFrame(columns=["ts", "funding_rate"]))

    def current_funding(self, symbol: str) -> dict[str, Any] | None:
        return self.cur_funding.get(symbol)

    def oi_history(self, symbol: str) -> pd.DataFrame:
        return self.oi.get(symbol, pd.DataFrame(columns=["ts", "open_interest"]))


@dataclass
class TickSummary:
    started: str = ""
    finished: str = ""
    status: str = "ok"
    kill: list[str] = field(default_factory=list)
    opened: list[dict] = field(default_factory=list)
    closed: list[dict] = field(default_factory=list)
    orders: list[dict] = field(default_factory=list)
    skipped: list[dict] = field(default_factory=list)
    learning: list[dict] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    equity: dict[str, float] = field(default_factory=dict)
    data: dict[str, Any] = field(default_factory=dict)

    def line(self) -> str:
        try:
            local = datetime.fromisoformat(self.started).astimezone(ZoneInfo("America/Chicago")).strftime("%H:%M:%S %Z")
        except ValueError:
            local = "?"
        err = f" first_error={self.errors[0][:160]!r}" if self.errors else ""
        return (f"{self.started} ({local}) status={self.status} kill={'|'.join(self.kill) or 'off'} opened={len(self.opened)} "
                f"closed={len(self.closed)} orders={len(self.orders)} errors={len(self.errors)} "
                f"equity_total={sum(self.equity.values()):.4f}{err}")


class Arena:
    def __init__(self, settings: Settings, cfg: ArenaCfg, adapter: ExchangeAdapter, root: Path | None = None,
                 clock: Callable[[], float] = time.time) -> None:
        self.s, self.cfg, self.ad, self.clock = settings, cfg, adapter, clock
        self.root = Path(root) if root else settings.state_dir / "arena"
        self.root.mkdir(parents=True, exist_ok=True)
        self.store = ParquetStore(settings.data_dir)
        fees = settings.fee_rates(adapter.name)
        self.costs = CostModel(fees.maker, fees.taker, settings.slippage.market_bps, settings.slippage.stop_bps,
                               settings.slippage.atr_frac, take_profit_is_maker=True)
        self.params = ParamStore(self.root / "params")
        self.journal_dir = self.root / "journal"
        self.view = LiveView()
        self.diag: dict[str, dict[str, Any]] = {}

    # ================================================================== public
    def tick(self) -> TickSummary:
        summary = TickSummary(started=utcnow())
        with tick_lock(self.root / "tick.lock") as owned:
            if not owned:
                summary.status = "skipped: another tick holds state/arena/tick.lock"
                self._log(summary)
                return summary
            led = ArenaLedger(self.root / "arena.sqlite")
            try:
                self._run(led, summary)
            except Exception as exc:  # never leave cron with a half-written state silently
                summary.status = "error"
                summary.errors.append(f"{type(exc).__name__}: {exc}")
                log.exception("tick failed")
                led.event("error", f"tick failed: {exc}")
            finally:
                led.commit()
                led.close()
        summary.finished = utcnow()
        self._log(summary)
        return summary

    # ================================================================== internals
    def _now_ms(self) -> int:
        return int(self.clock() * 1000)

    def _log(self, summary: TickSummary) -> None:
        with (self.root / "tick.log").open("a") as f:
            f.write(summary.line() + "\n")
            for e in summary.errors:
                f.write(f"    error: {e}\n")
            for o in summary.opened:
                f.write(f"    opened: {o}\n")
            for c in summary.closed:
                f.write(f"    closed: {c}\n")

    def _timeframes(self) -> set[str]:
        tfs = {"1m"}
        for a in self.cfg.arms.values():
            tfs.add(a.timeframe)
            for k in ("regime_tf", "trend_tf", "atr_tf"):
                if a.params.get(k):
                    tfs.add(a.params[k])
        return tfs

    def refresh_data(self, summary: TickSummary) -> None:
        ex, now = self.ad.name, self._now_ms()
        try:
            tick = self.ad.fetch_tickers()
            for r in tick.itertuples():
                if r.symbol in self.cfg.symbols and r.bid > 0 and r.ask > 0:
                    self.view.quotes[r.symbol] = {"bid": float(r.bid), "ask": float(r.ask), "last": float(r.last),
                                                  "ts": int(r.ts)}
        except (ExchangeUnavailable, ExchangeAPIError) as exc:
            summary.errors.append(f"tickers: {exc}")
        for sym in self.cfg.symbols:
            for tf in sorted(self._timeframes()):
                try:
                    old = self.store.load_ohlcv(ex, sym, tf)
                    start = int(old["ts"].iloc[-1]) if len(old) else now - FRESH_BARS.get(tf, 400) * tf_ms(tf)
                    start = max(start, now - 3 * 1440 * tf_ms(tf))
                    new = self.ad.fetch_candles(sym, tf, start)
                    df = self.store.upsert_ohlcv(ex, sym, tf, new) if len(new) else old.reset_index(drop=True)
                    df = df.tail(3000).copy()
                    df.index = pd.to_datetime(df["ts"], unit="ms", utc=True)
                    # only bars that have closed by now (the adapter already drops unconfirmed candles)
                    df = df[df["ts"] + tf_ms(tf) <= now]
                    self.view.frames[(sym, tf)] = df
                except (ExchangeUnavailable, ExchangeAPIError) as exc:
                    summary.errors.append(f"{sym} {tf} candles: {exc}")
            try:
                fh = self.ad.fetch_funding_page(sym, None, 20)
                if len(fh):
                    self.store.upsert_funding(ex, sym, fh)
                self.view.funding[sym] = self.store.load_funding(ex, sym)
            except (ExchangeUnavailable, ExchangeAPIError) as exc:
                summary.errors.append(f"{sym} funding history: {exc}")
                self.view.funding[sym] = self.store.load_funding(ex, sym)
            try:
                cf = self.ad.fetch_current_funding(sym)
                if cf:
                    cf["funding_time_iso"] = iso(cf["funding_time_ms"])
                    self.view.cur_funding[sym] = cf
                    self._append_funding_snapshot(ex, sym, now, cf)
            except (ExchangeUnavailable, ExchangeAPIError) as exc:
                summary.errors.append(f"{sym} current funding: {exc}")
            try:
                oi = self.ad.fetch_open_interest(sym)
                if len(oi):
                    self.store.upsert_oi(ex, sym, oi)
            except (ExchangeUnavailable, ExchangeAPIError) as exc:
                summary.errors.append(f"{sym} open interest: {exc}")
            o = self.store.load_oi(ex, sym)
            if len(o):
                o = o.copy()
                o.index = pd.to_datetime(o["ts"], unit="ms", utc=True)
            self.view.oi[sym] = o
        summary.data = {sym: {"1m_last": iso(int(self.view.frame(sym, "1m")["ts"].iloc[-1]))
                              if len(self.view.frame(sym, "1m")) else None,
                              "oi_snapshots": len(self.view.oi_history(sym)),
                              "funding_now": (self.view.cur_funding.get(sym) or {}).get("funding_rate"),
                              "quote": self.view.quotes.get(sym)} for sym in self.cfg.symbols}

    def _append_funding_snapshot(self, ex: str, sym: str, now: int, cf: dict[str, Any]) -> None:
        p = self.store.root / ex / "funding_snapshots" / f"{sym}.parquet"
        new = pd.DataFrame([{"ts": now, "funding_rate": cf["funding_rate"], "funding_time": cf["funding_time_ms"],
                             "interval_hours": cf.get("interval_hours", 8.0)}])
        old = pd.read_parquet(p) if p.exists() else pd.DataFrame(columns=new.columns)
        df = pd.concat([x for x in (old, new) if len(x)], ignore_index=True).drop_duplicates("ts", keep="last")
        self.store._atomic_write(df.sort_values("ts").reset_index(drop=True), p)

    # ------------------------------------------------------------------ main
    def _run(self, led: ArenaLedger, summary: TickSummary) -> None:
        for name, arm in self.cfg.arms.items():
            led.ensure_arm(name, self.cfg.initial_equity)
            lim = self.cfg.arm_limits(name)
            self.params.ensure(name, dict(arm.params), lim.risk_per_trade)
        summary.kill = kill_reasons(self.s, self.root)
        if summary.kill:
            led.event("kill", "kill switch active: no new entries; open simulated positions still managed",
                      data={"reasons": summary.kill})
        self.refresh_data(summary)
        now = self._now_ms()
        self._process_orders(led, summary, now)
        self._manage(led, summary, now)
        equity = self._risk_gates(led, now)
        for name in self.cfg.arms:
            for ch in learn(name, self.cfg, self.params, led.trades(name)):
                summary.learning.append(ch)
                led.event("learning", ch["reason"], arm=name, data=ch)
        if not summary.kill:
            self._signals(led, summary, now, equity)
        equity = self._risk_gates(led, now, update=False)
        summary.equity = equity
        ts = utcnow()
        for a in led.arms():
            led.mark_equity(ts, a["name"], equity[a["name"]], a["cash"],
                            len(led.trades(a["name"], "open")))
        led.commit()
        self._outputs(led, summary, equity)

    # ------------------------------------------------------------------ orders
    def _process_orders(self, led: ArenaLedger, summary: TickSummary, now: int) -> None:
        for o in led.orders(status="open"):
            if summary.kill:
                o["status"], o["closed"] = "cancelled", utcnow()
                o["close_reason"] = "kill switch active"
                led.save_order(o)
                led.event("order", f"cancelled resting order #{o['id']} (kill switch)", arm=o["arm"])
                continue
            bars = self.view.frame(o["symbol"], "1m")
            state, fill_ts = try_fill_order(o, bars, now)
            if state == "open":
                led.save_order(o)
                continue
            o["status"], o["closed"] = state, utcnow()
            if state == "expired":
                o["close_reason"] = f"not traded through within {o['ttl_min']} min"
                led.save_order(o)
                led.event("order", f"order #{o['id']} expired unfilled", arm=o["arm"])
                summary.orders.append({"id": o["id"], "arm": o["arm"], "symbol": o["symbol"], "state": "expired"})
                continue
            assert fill_ts is not None
            t = dict(o["trade"])
            t.update({"status": "open", "entry_ms": fill_ts, "entry_time": iso(fill_ts), "order_id": o["id"]})
            led.insert_trade(t)
            led.add_cash(t["arm"], -t["entry_fee"])
            o["trade_id"] = t["id"]
            led.save_order(o)
            summary.opened.append(self._brief(t))
            led.event("open", f"maker order #{o['id']} filled -> trade #{t['id']}", arm=t["arm"])
            # conservative: on the fill bar, a touch of the stop counts as stopped (TP not allowed same bar)
            row = bars[bars["ts"] == fill_ts]
            if len(row):
                lo, hi = float(row["low"].iloc[0]), float(row["high"].iloc[0])
                if (t["side"] > 0 and lo <= t["stop_price"]) or (t["side"] < 0 and hi >= t["stop_price"]):
                    t["mae_price"] = t["mfe_price"] = t["entry_price"]
                    cash = finalize_exit(t, fill_ts + MIN - 1, self.costs.stop_fill(t["stop_price"], -t["side"]),
                                         "stop", False, self.costs, "stop touched on the fill bar")
                    self._close(led, summary, t, cash)
                    continue
                t["last_1m_ts"] = fill_ts
                t["mae_price"] = t["mfe_price"] = t["entry_price"]
            led.save_trade(t)

    # ------------------------------------------------------------------ positions
    def _manage(self, led: ArenaLedger, summary: TickSummary, now: int) -> None:
        for t in led.trades(status="open"):
            arm = self.cfg.arms.get(t["arm"])
            kind = t.get("kind") or (arm.kind if arm else "")
            bars = self.view.frame(t["symbol"], "1m")
            if bars.empty:
                summary.errors.append(f"trade #{t['id']}: no 1m data this tick; position not advanced")
                continue
            cf = self.view.current_funding(t["symbol"]) or {}
            cash = manage_trade(t, bars, self.view.frame(t["symbol"], t["timeframe"]),
                                self.view.funding_history(t["symbol"]), self.costs, t["params"], kind, now,
                                self.view.quotes.get(t["symbol"]), cf.get("funding_rate"))
            if t["status"] == "closed":
                t["exit_context"] = self._exit_context(t)
                self._close(led, summary, t, cash)
            else:
                led.add_cash(t["arm"], cash)
                q = self.view.quotes.get(t["symbol"])
                if q:
                    t["last_price"] = (q["bid"] + q["ask"]) / 2
                t["unrealized"] = unrealized(t, t.get("last_price", t["entry_price"]))
                led.save_trade(t)
                write_trade_md(t, self.journal_dir)

    def _exit_context(self, t: dict[str, Any]) -> dict[str, Any]:
        p = t.get("params", {})
        rtf = p.get("regime_tf")
        if not rtf:
            return {}
        df = closed_upto(self.view.frame(t["symbol"], rtf), rtf, pd.Timestamp(t["exit_ms"], unit="ms", tz="UTC"))
        if len(df) < int(p.get("regime_slow", 200)) + 6:
            return {}
        f, s = ema(df["close"], int(p["regime_fast"])), ema(df["close"], int(p["regime_slow"]))
        k = int(p.get("regime_slope_bars", 5))
        reg = "neutral"
        if f.iloc[-1] > s.iloc[-1] and f.iloc[-1] > f.iloc[-1 - k]:
            reg = "bull"
        elif f.iloc[-1] < s.iloc[-1] and f.iloc[-1] < f.iloc[-1 - k]:
            reg = "bear"
        return {"regime": reg}

    def _close(self, led: ArenaLedger, summary: TickSummary, t: dict[str, Any], cash: float) -> None:
        led.add_cash(t["arm"], cash)
        t["postmortem"], t["tags"] = postmortem(t)
        led.save_trade(t)
        write_trade_md(t, self.journal_dir)
        with (self.root / "lessons_log.jsonl").open("a") as f:
            f.write(json.dumps({"ts": utcnow(), "trade_id": t["id"], "arm": t["arm"], "symbol": t["symbol"],
                                "r": t["r_multiple"], "net_pnl": t["net_pnl"], "exit_reason": t["exit_reason"],
                                "tags": t["tags"], "lesson": t["postmortem"],
                                "params_version": t.get("params_version")}, default=float) + "\n")
        summary.closed.append({**self._brief(t), "exit": t["exit_price"], "reason": t["exit_reason"],
                               "net_pnl": round(t["net_pnl"], 4), "r": round(t["r_multiple"], 3)})
        led.event("close", f"trade #{t['id']} closed {t['exit_reason']} {t['r_multiple']:+.2f}R "
                           f"${t['net_pnl']:+.4f}", arm=t["arm"])

    @staticmethod
    def _brief(t: dict[str, Any]) -> dict[str, Any]:
        return {"id": t.get("id"), "arm": t["arm"], "symbol": t["symbol"], "side": "long" if t["side"] > 0 else "short",
                "entry": round(t["entry_price"], 8), "stop": round(t["stop_price"], 8),
                "tp": round(t["take_profit"], 8), "qty": t["qty"]}

    # ------------------------------------------------------------------ risk gates
    def _risk_gates(self, led: ArenaLedger, now: int, update: bool = True) -> dict[str, float]:
        equity: dict[str, float] = {}
        day = pd.Timestamp(now, unit="ms", tz="UTC").strftime("%Y-%m-%d")
        open_by_arm: dict[str, list[dict]] = {}
        for t in led.trades(status="open"):
            open_by_arm.setdefault(t["arm"], []).append(t)
        for a in led.arms():
            u = 0.0
            for t in open_by_arm.get(a["name"], []):
                q = self.view.quotes.get(t["symbol"])
                px = (q["bid"] + q["ask"]) / 2 if q else t.get("last_price", t["entry_price"])
                u += unrealized(t, px)
            eq = a["cash"] + u
            equity[a["name"]] = eq
            if not update:
                continue
            fields: dict[str, Any] = {"peak": max(a["peak"], eq)}
            if a["day"] != day:
                fields.update(day=day, day_start=eq)
            lim = self.cfg.arm_limits(a["name"]) if a["name"] in self.cfg.arms else self.cfg.limits
            dd = 1 - eq / fields["peak"] if fields["peak"] > 0 else 1.0
            if not a["killed"] and dd >= lim.max_drawdown_kill:
                fields.update(killed=1, kill_reason=f"drawdown {dd:.1%} >= {lim.max_drawdown_kill:.0%} at {utcnow()}")
                led.event("arm_killed", fields["kill_reason"], arm=a["name"])
            led.update_arm(a["name"], **fields)
        return equity

    # ------------------------------------------------------------------ entries
    def _signals(self, led: ArenaLedger, summary: TickSummary, now: int, equity: dict[str, float]) -> None:
        for name, arm in self.cfg.arms.items():
            if not arm.enabled:
                continue
            a = led.arm(name)
            doc = self.params.load(name) or {}
            cur = doc.get("current", {})
            params, risk, version = dict(cur.get("params", arm.params)), float(cur.get("risk_per_trade", 0.015)), \
                int(cur.get("version", 1))
            lim = self.cfg.arm_limits(name)
            risk = min(max(risk, lim.min_risk), lim.max_risk)
            tfms = tf_ms(arm.timeframe)
            for sym in self.cfg.arm_symbols(name):
                df = self.view.frame(sym, arm.timeframe)
                if df.empty:
                    continue
                last = int(df["ts"].iloc[-1])
                key = f"sig:{name}:{sym}"
                if int(led.get_cursor(key, "0") or 0) >= last:
                    continue
                led.set_cursor(key, last)
                age_min = (now - (last + tfms)) / MIN
                if age_min > max(lim.max_signal_age_min, tfms / MIN):
                    self.diag.setdefault(name, {})[sym] = {"reason": f"stale bar ({age_min:.1f} min old)"}
                    continue
                try:
                    sig, diag = evaluate(arm.kind, arm.timeframe, params, sym, self.view)
                except Exception as exc:  # one arm's bug must not stop the others
                    summary.errors.append(f"{name} {sym} evaluate: {type(exc).__name__}: {exc}")
                    continue
                diag = {**diag, "bar": cst(iso(last)), "evaluated": cst(utcnow())}
                self.diag.setdefault(name, {})[sym] = diag
                if sig is None:
                    continue
                ok, why = self._gate(led, name, sym, a, equity.get(name, a["cash"]), lim, bool(cur.get("benched")))
                if not ok:
                    summary.skipped.append({"arm": name, "symbol": sym, "reason": why})
                    led.event("skip", f"{sym} {'long' if sig.side > 0 else 'short'} signal skipped: {why}", arm=name)
                    continue
                self._enter(led, summary, name, arm.kind, arm.timeframe, sym, sig, params, version, risk,
                            equity.get(name, a["cash"]), lim, now)

    def _gate(self, led: ArenaLedger, name: str, sym: str, a: dict[str, Any], eq: float, lim: Any,
              benched: bool) -> tuple[bool, str]:
        open_t = led.trades(name, "open")
        open_o = led.orders(name, "open")
        if a["killed"]:
            return False, f"arm retired: {a['kill_reason']}"
        if benched:
            return False, "arm benched by learning layer"
        if eq <= 0:
            return False, "no equity"
        if a["day_start"] > 0 and eq / a["day_start"] - 1 <= -lim.daily_loss_limit:
            return False, f"daily loss limit {lim.daily_loss_limit:.0%} hit"
        if len(open_t) + len(open_o) >= lim.max_concurrent:
            return False, f"max concurrent {lim.max_concurrent}"
        if lim.one_per_symbol and any(x["symbol"] == sym for x in open_t + open_o):
            return False, "already positioned/working on symbol"
        return True, "ok"

    def _enter(self, led: ArenaLedger, summary: TickSummary, name: str, kind: str, tf: str, sym: str, sig: Any,
               params: dict[str, Any], version: int, risk: float, eq: float, lim: Any, now: int) -> None:
        q = self.view.quotes.get(sym)
        if not q:
            summary.skipped.append({"arm": name, "symbol": sym, "reason": "no live quote"})
            return
        try:
            spec = self.store.load_instrument(self.ad.name, sym)
        except KeyError:
            spec = self.ad.fetch_instrument(sym)
            self.store.save_instruments(self.ad.name, [spec])
        s = sig.side
        if sig.entry_type == "limit":
            entry = float(sig.limit_price)
            if spec.tick_size and spec.tick_size > 0:   # round passively: bids down, offers up
                n = entry / spec.tick_size
                entry = round((math.floor(n + 1e-9) if s > 0 else math.ceil(n - 1e-9)) * spec.tick_size, 12)
            ref = q["bid"] if s > 0 else q["ask"]
            if (s > 0 and entry >= ref) or (s < 0 and entry <= ref):
                summary.skipped.append({"arm": name, "symbol": sym, "reason": "limit no longer passive vs live quote"})
                return
        else:
            entry = self.costs.market_fill(q["ask"] if s > 0 else q["bid"], s)
        stop = entry - s * sig.stop_dist
        used_margin = sum(t["margin"] for t in led.trades(name, "open")) + \
            sum(o["trade"]["margin"] for o in led.orders(name, "open"))
        sz = size_position(equity=eq, risk_fraction=risk, entry_price=entry, stop_price=stop, side=s, spec=spec,
                           taker_fee=self.costs.taker_fee,
                           stop_slippage_bps=self.costs.market_slippage_bps + self.costs.stop_slippage_bps,
                           max_leverage=lim.max_leverage, margin_leverage=lim.margin_leverage,
                           mmr=lim.maintenance_margin_rate, liquidation_buffer=lim.liquidation_buffer,
                           available_margin=eq - used_margin)
        if not sz.ok:
            summary.skipped.append({"arm": name, "symbol": sym, "reason": sz.reason})
            led.event("skip", f"{sym} signal not sized: {sz.reason}", arm=name)
            return
        maker = sig.entry_type == "limit"
        t: dict[str, Any] = {
            "arm": name, "kind": kind, "timeframe": tf, "symbol": sym, "side": s, "status": "open",
            "params_version": version, "params": params, "signal_bar": sig.bar_time.isoformat(),
            "entry_ms": now, "entry_time": iso(now), "entry_price": entry, "entry_type": sig.entry_type,
            "maker_entry": maker, "quote_at_signal": q, "qty": sz.qty, "contracts": sz.contracts,
            "notional": sz.notional, "implied_leverage": sz.implied_leverage, "margin": sz.margin,
            "initial_stop": stop, "stop_price": stop, "take_profit": entry + s * sig.take_profit_r * sig.stop_dist,
            "take_profit_r": sig.take_profit_r, "liquidation_price": sz.liquidation_price,
            "risk_amount": sz.expected_loss_at_stop, "risk_budget": sz.risk_amount, "risk_fraction": risk,
            "entry_fee": self.costs.fee(sz.notional, maker=maker), "funding": 0.0, "funding_events": [],
            "funding_interval_hours": (self.view.current_funding(sym) or {}).get("interval_hours",
                                                                                 spec.funding_interval_hours),
            "bars_held": 0, "best_price": entry, "mae_price": entry, "mfe_price": entry, "atr_at_entry": sig.atr,
            "thesis": sig.thesis, "indicators": sig.indicators, "sizing_note": sz.reason,
        }
        if maker:
            o = {"arm": name, "symbol": sym, "side": s, "status": "open", "created": utcnow(), "created_ms": now,
                 "expires_ms": now + int(sig.meta.get("ttl_min", 30) * MIN), "ttl_min": sig.meta.get("ttl_min", 30),
                 "limit_price": entry, "trade": t}
            led.insert_order(o)
            summary.orders.append({"id": o["id"], "arm": name, "symbol": sym, "side": "buy" if s > 0 else "sell",
                                   "limit": entry, "state": "placed (simulated)"})
            led.event("order", f"simulated maker {'bid' if s > 0 else 'offer'} {sym} @ {entry:.6g}", arm=name,
                      data={"thesis": sig.thesis})
            return
        led.insert_trade(t)
        led.add_cash(name, -t["entry_fee"])
        write_trade_md(t, self.journal_dir)
        summary.opened.append(self._brief(t))
        led.event("open", f"trade #{t['id']} {sym} {'long' if s > 0 else 'short'} @ {entry:.6g}", arm=name,
                  data={"thesis": sig.thesis})

    # ------------------------------------------------------------------ outputs
    def _outputs(self, led: ArenaLedger, summary: TickSummary, equity: dict[str, float]) -> None:
        trades = led.trades()
        ev_path = self.root / "last_eval.json"
        merged: dict[str, Any] = json.loads(ev_path.read_text()) if ev_path.exists() else {}
        for arm_name, per_sym in self.diag.items():
            merged.setdefault(arm_name, {}).update(per_sym)
        ev_path.write_text(json.dumps(merged, indent=2, default=str))
        stats = write_outputs(self.root, self.cfg, led.arms(), trades, self.params, equity)
        status = {
            "generated": utcnow(), "generated_cst": cst(utcnow()), "mode": "SIMULATION - paper only, no orders sent",
            "tick": {k: v for k, v in summary.__dict__.items() if k not in ("data",)},
            "kill_switch": {"active": bool(summary.kill), "reasons": summary.kill,
                            "global_agent_guard": _global_kill()},
            "arms": stats["arms"],
            "open_positions": [{k: t.get(k) for k in ("id", "arm", "symbol", "side", "entry_time", "entry_price",
                                                      "stop_price", "take_profit", "qty", "notional",
                                                      "implied_leverage", "unrealized", "funding", "thesis")}
                               for t in trades if t["status"] == "open"],
            "resting_orders": [{k: o.get(k) for k in ("id", "arm", "symbol", "side", "limit_price", "created",
                                                      "expires_ms")} for o in led.orders(status="open")],
            "last_evaluation": merged, "data": summary.data,
        }
        (self.root / "status.json").write_text(json.dumps(status, indent=2, default=str))
        lines = [f"# Arena status - {status['generated_cst']}", "", "SIMULATION ONLY. No orders are sent anywhere.", "",
                 f"Kill switch: {'ACTIVE - ' + '; '.join(summary.kill) if summary.kill else 'off'}", "",
                 "| arm | equity | closed | win% | E[R] | open | params | state |", "|---|---|---|---|---|---|---|---|"]
        for n, st in stats["arms"].items():
            state = "retired" if st["killed"] else ("benched" if st["benched"] else "active")
            wr = f"{st['win_rate']:.0%}" if st["win_rate"] is not None else "-"
            er = f"{st['expectancy_r']:+.2f}" if st["expectancy_r"] is not None else "-"
            lines.append(f"| {n} | ${st['equity']:.2f} | {st['closed_trades']} | {wr} | {er} | {st['open_trades']} | "
                         f"v{st['params_version']} | {state} |")
        lines += ["", "## Open positions", ""]
        for t in status["open_positions"]:
            lines.append(f"- #{t['id']} {t['arm']} {'LONG' if t['side'] > 0 else 'SHORT'} {t['symbol']} @ "
                         f"{t['entry_price']:.6g} stop {t['stop_price']:.6g} TP {t['take_profit']:.6g} "
                         f"uPnL ${t.get('unrealized') or 0:+.4f}")
        if not status["open_positions"]:
            lines.append("- none")
        lines += ["", "## Resting simulated orders", ""]
        for o in led.orders(status="open"):
            lines.append(f"- order #{o['id']} {o['arm']} {'BID' if o['side'] > 0 else 'OFFER'} {o['symbol']} @ "
                         f"{o['limit_price']:.6g}, expires {cst(iso(o['expires_ms']))}: {o['trade'].get('thesis', '')}")
        if not led.orders(status="open"):
            lines.append("- none")
        (self.root / "status.md").write_text("\n".join(lines) + "\n")
