"""One-shot paper-trading step (cron-friendly). Simulated fills only — NEVER sends orders.

Each invocation, per (strategy, timeframe, symbol):
  1. Fetch recent CLOSED candles + funding from the public API (and upsert them into the store).
  2. Replay every closed bar since the ledger cursor through the same Position state machine used by
     the backtester: funding, stop / TP / liquidation, trailing, time and signal exits.
  3. If the most recent closed bar produced an entry signal (and it is not stale), simulate a market
     fill at the live best bid/ask plus slippage, sized by the risk module against ledger equity.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

import pandas as pd

from ..config import Settings
from ..core.costs import CostModel, funding_payment, gross_pnl
from ..core.position import ExitFill, Position, check_intrabar, update_after_close
from ..data.adapters.base import ExchangeAdapter, now_ms
from ..data.store import ParquetStore
from ..risk.limits import RiskManager
from ..risk.sizing import size_position
from ..strategies import build_strategy
from ..timeframes import ms as tf_ms
from .ledger import Ledger, utcnow

log = logging.getLogger(__name__)


@dataclass
class PaperRunSummary:
    opened: list[dict] = field(default_factory=list)
    closed: list[dict] = field(default_factory=list)
    signals: list[dict] = field(default_factory=list)
    skipped: list[dict] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    equity: float = 0.0


class PaperEngine:
    def __init__(self, settings: Settings, adapter: ExchangeAdapter, ledger: Ledger | None = None) -> None:
        self.s = settings
        self.ad = adapter
        self.store = ParquetStore(settings.data_dir)
        self.ledger = ledger or Ledger(settings.state_dir / "paper.sqlite", settings.capital.initial_equity)
        fees = settings.fee_rates(adapter.name)
        self.costs = CostModel(fees.maker, fees.taker, settings.slippage.market_bps, settings.slippage.stop_bps,
                               settings.slippage.atr_frac, settings.backtest.take_profit_fee == "maker")
        # Always pass a kill-file path so the box-wide agent-guard kill file (risk.limits._global_kill)
        # is honoured on every paper tick, even if risk.kill_switch_file is unset in config.
        kill = (settings.path(settings.risk.kill_switch_file) if settings.risk.kill_switch_file
                else settings.state_dir / "KILL")
        self.risk = RiskManager(settings.risk, float(self.ledger.get("cash")), kill_file=kill)
        st = self.risk.state
        st.peak_equity = float(self.ledger.get("peak_equity", st.peak_equity))
        st.day = self.ledger.get("day", "")
        st.day_start_equity = float(self.ledger.get("day_start_equity", st.peak_equity))
        st.killed = bool(self.ledger.get("killed", False))
        st.kill_reason = self.ledger.get("kill_reason", "")
        self._prices: dict[str, float] = {}
        self._tickers: pd.DataFrame | None = None

    # ------------------------------------------------------------------ helpers
    @property
    def cash(self) -> float:
        return float(self.ledger.get("cash"))

    def _add_cash(self, amt: float) -> None:
        self.ledger.set("cash", self.cash + amt)

    def tickers(self) -> pd.DataFrame:
        if self._tickers is None:
            self._tickers = self.ad.fetch_tickers().set_index("symbol")
        return self._tickers

    def equity(self) -> tuple[float, float]:
        unreal = 0.0
        for _, p in self.ledger.open_positions():
            px = self._prices.get(p.symbol)
            if px is None:
                try:
                    px = float(self.tickers().loc[p.symbol, "last"])
                except KeyError:
                    px = p.entry_price
            unreal += p.unrealized(px)
        return self.cash + unreal, unreal

    def _spec(self, symbol: str):
        try:
            return self.store.load_instrument(self.ad.name, symbol)
        except KeyError:
            spec = self.ad.fetch_instrument(symbol)
            self.store.save_instruments(self.ad.name, [spec])
            return spec

    def _close(self, pid: int, p: Position, fill: ExitFill, when: str, out: PaperRunSummary) -> None:
        fee = self.costs.fee(p.qty * fill.price, maker=fill.maker)
        g = gross_pnl(p.side, p.qty, p.entry_price, fill.price)
        if fill.reason == "liquidation":
            g = max(g, -p.margin)
        net = g - p.entry_fee - fee + p.funding
        self._add_cash(g - fee)
        self.ledger.close_position(pid, p, when, fill.price, fill.reason, g, p.entry_fee + fee, net)
        rec = {"id": pid, "symbol": p.symbol, "strategy": p.strategy, "side": p.side, "exit_price": fill.price,
               "reason": fill.reason, "net_pnl": round(net, 6), "r": round(net / p.risk_amount, 3) if p.risk_amount else None}
        self.ledger.event("close", rec)
        out.closed.append(rec)

    # ------------------------------------------------------------------ main step
    def step(self, strategy_name: str, timeframe: str, symbols: list[str]) -> PaperRunSummary:
        out = PaperRunSummary()
        cfg = self.s.strategies.get(strategy_name, {})
        strat = build_strategy(strategy_name, timeframe, cfg.get("params", {}))
        exits = strat.exit_params
        step_ms = tf_ms(timeframe)
        for sym in symbols:
            try:
                self._step_symbol(strat, exits, timeframe, step_ms, sym, out)
            except Exception as e:  # keep cron runs robust per symbol
                log.exception("paper step failed for %s", sym)
                out.errors.append(f"{strategy_name}/{timeframe}/{sym}: {e}")
        eq, unreal = self.equity()
        ts = pd.Timestamp.now(tz="UTC")
        self.risk.on_equity(ts, eq)
        with self.ledger.tx():
            st = self.risk.state
            self.ledger.set("peak_equity", st.peak_equity)
            self.ledger.set("day", st.day)
            self.ledger.set("day_start_equity", st.day_start_equity)
            self.ledger.set("killed", st.killed)
            self.ledger.set("kill_reason", st.kill_reason)
            self.ledger.snapshot_equity(eq, self.cash, unreal)
        out.equity = eq
        return out

    def _step_symbol(self, strat, exits, tf: str, step_ms: int, sym: str, out: PaperRunSummary) -> None:
        spec = self._spec(sym)
        need = strat.warmup_bars + 300
        now = now_ms()
        bars = self.ad.fetch_candles(sym, tf, now - need * step_ms, None)
        if bars.empty:
            out.errors.append(f"{sym}: no candles")
            return
        self.store.upsert_ohlcv(self.ad.name, sym, tf, bars)
        funding = self.ad.fetch_funding_page(sym, None, 20)
        df = bars.copy()
        df.index = pd.to_datetime(df["ts"], unit="ms", utc=True)
        sig = strat.compute(df)
        cursor = self.ledger.cursor(strat.name, tf, sym)
        last_ts = int(df["ts"].iloc[-1])
        new_idx = [i for i, t in enumerate(df["ts"]) if cursor is None or t > cursor]
        if cursor is None:
            new_idx = new_idx[-1:]  # first run: only the latest closed bar is "new"
        tick = self.tickers().loc[sym] if sym in self.tickers().index else None
        live_px = float(tick["last"]) if tick is not None else float(df["close"].iloc[-1])
        self._prices[sym] = live_px

        with self.ledger.tx():
            mine = [(pid, p) for pid, p in self.ledger.open_positions() if p.symbol == sym and p.strategy == strat.name]
            for pid, p in mine:
                pending: str | None = p.meta.get("pending_exit")
                entry_ms = int(pd.Timestamp(p.entry_time).value // 1_000_000)
                for i in new_idx:
                    row = df.iloc[i]
                    t = int(row["ts"])
                    if t + step_ms <= entry_ms:
                        continue
                    if pending:
                        self._close(pid, p, ExitFill(self.costs.market_fill(row["open"], -p.side), pending),
                                    str(df.index[i]), out)
                        pending = None
                        break
                    for _, f in funding.iterrows():
                        if t <= f["ts"] < t + step_ms and f["ts"] > entry_ms and f["ts"] > p.meta.get("last_funding", 0):
                            fp = funding_payment(p.side, p.qty, row["close"], f["funding_rate"])
                            p.funding += fp
                            p.meta["last_funding"] = int(f["ts"])
                            self._add_cash(fp)
                    o, h, l = row["open"], row["high"], row["low"]
                    if t < entry_ms:  # entry happened mid-bar: only use the part of the bar after entry (approx.)
                        o = p.entry_price
                    ex = check_intrabar(p, o, h, l, self.costs, sig["atr"].iloc[i])
                    if ex is not None:
                        self._close(pid, p, ex, str(df.index[i]), out)
                        break
                    update_after_close(p, h, l, row["close"], sig["atr"].iloc[i], exits.trail_atr_mult)
                    if exits.max_hold_bars and p.bars_held >= exits.max_hold_bars:
                        pending = "time"
                    elif (p.side > 0 and sig["exit_long"].iloc[i]) or (p.side < 0 and sig["exit_short"].iloc[i]):
                        pending = "signal"
                else:
                    if pending:  # exit decided on the latest closed bar -> fill now at live price
                        self._close(pid, p, ExitFill(self.costs.market_fill(live_px, -p.side), pending), utcnow(), out)
                    else:
                        p.meta["pending_exit"] = None
                        self.ledger.update_position(pid, p)

            # ---- entries on the latest closed bar ----------------------------------------------
            s_last = int(sig["signal"].iloc[-1])
            age_bars = (now - (last_ts + step_ms)) / step_ms
            rec = {"strategy": strat.name, "timeframe": tf, "symbol": sym, "bar": str(df.index[-1]),
                   "signal": s_last, "age_bars": round(age_bars, 2)}
            out.signals.append(rec)
            is_new_bar = cursor is None or last_ts > cursor
            if s_last != 0 and is_new_bar:
                self._try_open(strat, sym, spec, s_last, sig.iloc[-1], tick, live_px, age_bars, rec, out)
            self.ledger.set_cursor(strat.name, tf, sym, last_ts)

    def _try_open(self, strat, sym, spec, side, srow, tick, live_px, age_bars, rec, out) -> None:
        if age_bars > self.s.paper.max_signal_age_bars:
            out.skipped.append({**rec, "reason": "stale signal"})
            return
        open_pos = self.ledger.open_positions()
        if any(p.symbol == sym for _, p in open_pos):
            out.skipped.append({**rec, "reason": "position already open on symbol"})
            return
        eq, _ = self.equity()
        ok, why = self.risk.can_open(eq, len(open_pos))
        if not ok:
            out.skipped.append({**rec, "reason": why})
            self.ledger.event("skip", {**rec, "reason": why})
            return
        ref = (float(tick["ask"]) if side > 0 else float(tick["bid"])) if tick is not None else live_px
        ref = ref or live_px
        fill = self.costs.market_fill(ref, side, float(srow["atr"]))
        stop = srow["stop_price"] if srow["stop_price"] == srow["stop_price"] else fill - side * float(srow["stop_dist"])
        stop = spec.round_price(stop)
        used = sum(p.margin for _, p in open_pos)
        sz = size_position(equity=eq, risk_fraction=self.risk.risk_fraction, entry_price=fill, stop_price=stop,
                           side=side, spec=spec, taker_fee=self.costs.taker_fee,
                           stop_slippage_bps=self.costs.market_slippage_bps + self.costs.stop_slippage_bps,
                           max_leverage=self.s.risk.max_leverage, margin_leverage=self.s.risk.margin_leverage,
                           mmr=self.s.risk.maintenance_margin_rate, liquidation_buffer=self.s.risk.liquidation_buffer,
                           available_margin=eq - used)
        if not sz.ok:
            out.skipped.append({**rec, "reason": sz.reason})
            self.ledger.event("skip", {**rec, "reason": sz.reason})
            return
        fee = self.costs.fee(sz.notional)
        self._add_cash(-fee)
        tpr = strat.exit_params.take_profit_r
        tp = spec.round_price(fill + side * tpr * abs(fill - stop)) if tpr > 0 else None
        p = Position(symbol=sym, side=side, qty=sz.qty, contracts=sz.contracts, entry_time=utcnow(), entry_price=fill,
                     stop_price=stop, initial_stop=stop, take_profit=tp, liquidation_price=sz.liquidation_price,
                     margin=sz.margin, risk_amount=sz.expected_loss_at_stop, entry_fee=fee, notional=sz.notional,
                     implied_leverage=sz.implied_leverage, best_price=fill, strategy=strat.name,
                     timeframe=strat.timeframe, meta={"signal_bar": rec["bar"]})
        pid = self.ledger.insert_position(p)
        info = {"id": pid, **rec, "side": side, "entry": fill, "stop": stop, "take_profit": tp,
                "contracts": sz.contracts, "notional": round(sz.notional, 4),
                "implied_leverage": round(sz.implied_leverage, 3), "risk_usd": round(sz.expected_loss_at_stop, 4)}
        self.ledger.event("open", info)
        out.opened.append(info)
