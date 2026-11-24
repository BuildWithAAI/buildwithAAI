"""Concise JSON + markdown status for an orchestrator agent: regime, signals, paper positions, PnL."""

from __future__ import annotations

from datetime import UTC, datetime

import numpy as np
import pandas as pd

from ..config import Settings
from ..data.adapters.base import ExchangeAdapter, now_ms
from ..data.http import ExchangeUnavailable
from ..data.store import ParquetStore
from ..paper.ledger import Ledger
from ..strategies import build_strategy
from ..strategies.indicators import atr, ema
from ..timeframes import ms as tf_ms


def classify_regime(df4h: pd.DataFrame) -> dict:
    c = df4h["close"]
    e50, e200 = ema(c, 50), ema(c, 200)
    a = atr(df4h, 14) / c
    last = c.iloc[-1]
    slope = (e50.iloc[-1] / e50.iloc[-7] - 1) if len(e50.dropna()) > 7 else np.nan
    if last > e200.iloc[-1] and e50.iloc[-1] > e200.iloc[-1] and slope > 0:
        trend = "uptrend"
    elif last < e200.iloc[-1] and e50.iloc[-1] < e200.iloc[-1] and slope < 0:
        trend = "downtrend"
    else:
        trend = "range/transition"
    win = a.dropna().iloc[-540:]  # ~90 days of 4H bars
    pct = float((win <= win.iloc[-1]).mean()) if len(win) else np.nan
    vol = "high" if pct >= 0.8 else "low" if pct <= 0.2 else "normal"
    return {"trend": trend, "volatility": vol, "atr_pct": round(float(a.iloc[-1]) * 100, 3),
            "atr_pct_percentile_90d": round(pct, 3), "close": float(last),
            "ema50": round(float(e50.iloc[-1]), 6), "ema200": round(float(e200.iloc[-1]), 6),
            "ema50_slope_24h": round(float(slope), 5) if slope == slope else None}


def build_status(settings: Settings, adapter: ExchangeAdapter | None, offline: bool = False) -> dict:
    store = ParquetStore(settings.data_dir)
    ex = adapter.name if adapter else settings.exchange.default
    status: dict = {"generated_at": datetime.now(UTC).isoformat(timespec="seconds"), "exchange": ex,
                    "mode": "paper", "execution_enabled": False, "data_source": "stored" if offline else "live-public",
                    "regime": {}, "signals": [], "errors": []}
    kill_file = settings.path(settings.risk.kill_switch_file) if settings.risk.kill_switch_file else None
    from ..risk.limits import _global_kill

    status["kill_switch"] = {"config": settings.risk.kill_switch, "file": bool(kill_file and kill_file.exists()),
                             "global_agent_guard": _global_kill()}

    def bars(sym: str, tf: str, n: int) -> pd.DataFrame:
        if offline or adapter is None:
            df = store.load_ohlcv(ex, sym, tf)
            return df.iloc[-n:] if not df.empty else df
        df = adapter.fetch_candles(sym, tf, now_ms() - n * tf_ms(tf), None)
        if not df.empty:
            store.upsert_ohlcv(ex, sym, tf, df)
            df.index = pd.to_datetime(df["ts"], unit="ms", utc=True)
        return df

    for sym in settings.universe.base:
        try:
            d4 = bars(sym, "4H", 800)
            if len(d4) >= 210:
                status["regime"][sym] = classify_regime(d4)
            f = store.load_funding(ex, sym)
            if adapter and not offline:
                f = adapter.fetch_funding_page(sym, None, 3)
            if len(f):
                status["regime"].setdefault(sym, {})["last_funding_rate"] = float(f["funding_rate"].iloc[-1])
        except (ExchangeUnavailable, Exception) as e:  # noqa: BLE001 - status must always render
            status["errors"].append(f"regime {sym}: {e}")
        for ref in settings.paper.strategies:
            try:
                cfg = settings.strategies.get(ref.name, {})
                strat = build_strategy(ref.name, ref.timeframe, cfg.get("params", {}))
                df = bars(sym, ref.timeframe, strat.warmup_bars + 50)
                sig = strat.compute(df)
                status["signals"].append({"strategy": ref.name, "timeframe": ref.timeframe, "symbol": sym,
                                          "bar": str(df.index[-1]), "signal": int(sig["signal"].iloc[-1]),
                                          "close": float(df["close"].iloc[-1])})
            except Exception as e:  # noqa: BLE001
                status["errors"].append(f"signal {ref.name}/{ref.timeframe}/{sym}: {e}")

    ledger_path = settings.state_dir / "paper.sqlite"
    if ledger_path.exists():
        led = Ledger(ledger_path, settings.capital.initial_equity)
        prices: dict[str, float] = {}
        if adapter and not offline:
            try:
                t = adapter.fetch_tickers().set_index("symbol")["last"]
                prices = t.to_dict()
            except Exception as e:  # noqa: BLE001
                status["errors"].append(f"tickers: {e}")
        opens, unreal = [], 0.0
        for pid, p in led.open_positions():
            px = prices.get(p.symbol) or (status["regime"].get(p.symbol, {}).get("close")) or p.entry_price
            u = p.unrealized(px)
            unreal += u
            opens.append({"id": pid, "symbol": p.symbol, "strategy": p.strategy, "timeframe": p.timeframe,
                          "side": "long" if p.side > 0 else "short", "entry": p.entry_price, "mark": px,
                          "stop": p.stop_price, "take_profit": p.take_profit, "contracts": p.contracts,
                          "notional": round(p.notional, 4), "implied_leverage": round(p.implied_leverage, 3),
                          "unrealized_pnl": round(u, 4), "unrealized_r": round(u / p.risk_amount, 3) if p.risk_amount else None,
                          "funding": round(p.funding, 6), "opened_at": p.entry_time})
        closed = led.closed_positions()
        cash = float(led.get("cash"))
        init = float(led.get("initial_equity"))
        realized = sum(c["net_pnl"] or 0 for c in closed)
        status["paper"] = {
            "initial_equity": init, "cash": round(cash, 4), "equity": round(cash + unreal, 4),
            "unrealized_pnl": round(unreal, 4), "realized_pnl": round(realized, 4),
            "return": round((cash + unreal) / init - 1, 5), "open_positions": opens,
            "closed_trades": len(closed), "win_rate": round(np.mean([(c["net_pnl"] or 0) > 0 for c in closed]), 3)
            if closed else None, "last_closed": closed[:5], "killed": led.get("killed", False),
            "kill_reason": led.get("kill_reason", ""), "recent_events": led.recent_events(10),
        }
        led.close()
    else:
        status["paper"] = {"note": "no paper ledger yet; run `perps paper`"}
    return status


def status_markdown(st: dict) -> str:
    L = [f"## Perps status — {st['generated_at']} ({st['exchange']}, {st['mode']}, execution "
         f"{'ENABLED' if st['execution_enabled'] else 'disabled'})", ""]
    ks = st["kill_switch"]
    if ks["config"] or ks["file"] or ks.get("global_agent_guard"):
        L.append("**KILL SWITCH ACTIVE** — no new paper entries.")
    L.append("**Regime (4H)**")
    for sym, r in st["regime"].items():
        if "trend" in r:
            L.append(f"- {sym}: {r['trend']}, vol {r['volatility']} (ATR {r['atr_pct']}%, pctl {r['atr_pct_percentile_90d']}),"
                     f" funding {r.get('last_funding_rate', float('nan')):.5%}, close {r['close']}")
    L.append("")
    active = [s for s in st["signals"] if s["signal"] != 0]
    L.append(f"**Signals (latest closed bar)**: {len(active)} active of {len(st['signals'])}")
    for s in active:
        L.append(f"- {s['strategy']} {s['timeframe']} {s['symbol']}: {'LONG' if s['signal'] > 0 else 'SHORT'} @ {s['bar']}")
    p = st.get("paper", {})
    if "equity" in p:
        L += ["", f"**Paper account**: equity ${p['equity']:.2f} (return {p['return']:.2%}), realized ${p['realized_pnl']:.2f},"
              f" unrealized ${p['unrealized_pnl']:.2f}, closed trades {p['closed_trades']}"
              + (f", win rate {p['win_rate']:.0%}" if p["win_rate"] is not None else "")]
        for o in p["open_positions"]:
            L.append(f"- OPEN {o['symbol']} {o['side']} {o['strategy']}/{o['timeframe']}: entry {o['entry']}, mark {o['mark']},"
                     f" stop {o['stop']}, tp {o['take_profit']}, notional ${o['notional']}, {o['implied_leverage']}x,"
                     f" uPnL ${o['unrealized_pnl']} ({o['unrealized_r']}R)")
    if st["errors"]:
        L += ["", "**Errors**: " + "; ".join(st["errors"][:5])]
    return "\n".join(L)
