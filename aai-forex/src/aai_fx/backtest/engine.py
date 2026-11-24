"""Event-driven multi-pair backtest engine.

Per timestamp t (bar OPEN time, all pairs share the FX clock):
  1. for each pair with a bar at t: broker.process_bar -> pending orders from
     t-1 fill at open(t) with spread/slippage/commission; stops/targets are
     checked against bar t's range (stop-first if both hit)
  2. equity marked at close(t); risk manager updates daily-loss/drawdown state
  3. strategy.on_bar(ctx) at close(t) sees rows <= t only; signals pass the
     risk manager; approved orders are queued for open(t+1)

Lookahead is impossible by construction: features are causal (tested by
truncation-invariance), BarContext refuses negative lags, and orders are
only filled on a later bar than the one that generated them.
"""

from __future__ import annotations

import uuid
from collections import Counter
from dataclasses import dataclass, field
from typing import Any, Callable

import numpy as np
import pandas as pd

from ..config import AppConfig
from ..execution.models import ClosedTrade
from ..execution.paper import PaperBroker
from ..reporting.audit import AuditLog
from ..risk.kill_switch import KillSwitch
from ..risk.manager import OpenRisk, RiskManager
from ..strategies.base import BarContext, PositionView, Signal, SignalAction, Strategy
from .metrics import compute_metrics, per_pair_metrics


@dataclass
class BacktestResult:
    run_id: str
    strategy: dict[str, Any]
    pairs: list[str]
    start: pd.Timestamp | None
    end: pd.Timestamp | None
    equity: pd.Series
    trades: list[ClosedTrade]
    metrics: dict[str, Any]
    per_pair: dict[str, dict[str, Any]]
    signals: int = 0
    approved: int = 0
    rejections: dict[str, int] = field(default_factory=dict)
    kill_switch: str | None = None
    drawdown_kill_enforced: bool = True
    first_drawdown_breach: str | None = None
    total_spread_slippage_cost: float = 0.0
    bars_processed: int = 0
    open_positions_at_end: int = 0

    def summary(self) -> dict[str, Any]:
        return {"run_id": self.run_id, "strategy": self.strategy, "pairs": self.pairs,
                "start": self.start.isoformat() if self.start is not None else None,
                "end": self.end.isoformat() if self.end is not None else None,
                "metrics": self.metrics, "per_pair": self.per_pair, "signals": self.signals,
                "approved_entries": self.approved, "rejections": self.rejections,
                "kill_switch": self.kill_switch, "drawdown_kill_enforced": self.drawdown_kill_enforced,
                "first_drawdown_breach": self.first_drawdown_breach, "spread_slippage_cost": self.total_spread_slippage_cost,
                "bars_processed": self.bars_processed}


def _reason_key(reason: str) -> str:
    for k in ("KILL SWITCH", "daily loss", "open risk", "correlated USD", "positions long USD",
              "positions short USD", "min lot", "already have"):
        if k in reason:
            return k
    return reason[:40]


class BacktestEngine:
    def __init__(self, cfg: AppConfig, strategy: Strategy, audit: AuditLog | None = None,
                 risk_pct: float | None = None, enforce_drawdown_kill: bool = True,
                 broker_factory: Callable[[AppConfig, AuditLog | None], PaperBroker] | None = None,
                 risk_factory: Callable[[AppConfig, bool], RiskManager] | None = None) -> None:
        """``broker_factory`` / ``risk_factory`` are research hooks (e.g. the small-account
        margin study); the defaults are the standard PaperBroker and RiskManager."""
        self.cfg = cfg
        self.broker_factory = broker_factory
        self.risk_factory = risk_factory
        self.enforce_drawdown_kill = enforce_drawdown_kill
        self.strategy = strategy
        self.audit = audit
        self.risk_pct = risk_pct

    def _log(self, event: str, payload: dict[str, Any]) -> None:
        if self.audit is not None:
            self.audit.append(event, payload)

    def run(self, data: dict[str, pd.DataFrame], start: pd.Timestamp | None = None,
            end: pd.Timestamp | None = None, run_id: str | None = None) -> BacktestResult:
        cfg, strat = self.cfg, self.strategy
        run_id = run_id or uuid.uuid4().hex[:12]
        strat.reset()
        tf_delta = strat.timeframe.delta
        broker = (self.broker_factory(cfg, self.audit) if self.broker_factory else
                  PaperBroker(cfg.account.starting_equity, cfg.account.currency, cfg.costs, audit=self.audit))
        risk = (self.risk_factory(cfg, self.enforce_drawdown_kill) if self.risk_factory else
                RiskManager(cfg.risk, cfg.account.currency, KillSwitch(None),  # in-memory kill switch for sims
                            drawdown_kill_enabled=self.enforce_drawdown_kill))

        feats: dict[str, dict[str, np.ndarray]] = {}
        idx: dict[str, pd.DatetimeIndex] = {}
        pos_of: dict[str, dict[pd.Timestamp, int]] = {}
        for pair, df in data.items():
            d = df if end is None else df[df.index < end]
            if len(d) == 0:
                continue
            f = strat.prepare(d, pair)
            feats[pair] = {c: f[c].to_numpy(dtype=float) for c in f.columns}
            idx[pair] = f.index
            pos_of[pair] = {t: i for i, t in enumerate(f.index)}
        pairs = sorted(feats)
        timeline = sorted(set().union(*[set(i) for i in idx.values()])) if idx else []
        rates: dict[str, float] = {p: float(feats[p]["open"][0]) for p in pairs}
        eq_ts: list[pd.Timestamp] = []
        eq_val: list[float] = []
        n_signals = n_approved = 0
        rejections: Counter[str] = Counter()
        kill_logged = False
        warm = strat.warmup_bars
        bars = 0
        self._log("run_start", {"run_id": run_id, "strategy": strat.describe(), "pairs": pairs,
                                "start": str(start), "end": str(end)})

        for ts in timeline:
            active = [(p, pos_of[p][ts]) for p in pairs if ts in pos_of[p]]
            for p, i in active:
                F = feats[p]
                broker.process_bar(p, ts, F["open"][i], F["high"][i], F["low"][i], F["close"][i], rates)
                bars += 1
            in_window = start is None or ts >= start
            close_ts = ts + tf_delta
            if not in_window:
                continue
            equity = broker.equity(rates)
            risk.on_equity(close_ts, equity)
            eq_ts.append(close_ts)
            eq_val.append(equity)
            if risk.kill.engaged and not kill_logged:
                self._log("kill_switch", {"ts": close_ts.isoformat(), "reason": risk.kill.reason,
                                          "flatten": cfg.risk.kill_switch_flatten})
                kill_logged = True
                if cfg.risk.kill_switch_flatten:
                    for o in [o for o in broker.pending if o.kind == "ENTRY"]:
                        broker.pending.remove(o)
                    for p in list(broker.positions):
                        broker.submit_close(p, close_ts, reason="kill switch flatten")
            for p, i in active:
                if i < warm:
                    continue
                pos = broker.positions.get(p)
                pv = (PositionView(pos.side, pos.entry_price, pos.stop, pos.target, pos.entry_ts, pos.bars_held)
                      if pos else None)
                ctx = BarContext(p, i, idx[p], feats[p], tf_delta, pv)
                for sig in strat.on_bar(ctx):
                    n_signals += 1
                    self._log("signal", sig.to_dict())
                    self._handle_signal(sig, broker, risk, rates, equity, rejections)
                    if sig.action is not SignalAction.EXIT and broker.has_pending(p):
                        n_approved += 1

        # mark-out: close anything still open at the final close (counts as a trade)
        open_at_end = len(broker.positions)
        if timeline and eq_ts:
            last_ts = timeline[-1]
            for p in list(broker.positions):
                i = pos_of[p].get(last_ts, len(idx[p]) - 1)
                c = feats[p]["close"][i]
                broker.submit_close(p, last_ts, reason="end of data")
                # fill at the final close (no next bar exists)
                broker.process_bar(p, last_ts + tf_delta, c, c, c, c, rates)
            broker.pending.clear()
            eq_val[-1] = broker.equity(rates)

        equity_s = pd.Series(eq_val, index=pd.DatetimeIndex(eq_ts), name="equity", dtype=float)
        metrics = compute_metrics(equity_s, broker.trades, cfg.account.starting_equity)
        res = BacktestResult(
            run_id=run_id, strategy=strat.describe(), pairs=pairs,
            start=eq_ts[0] if eq_ts else None, end=eq_ts[-1] if eq_ts else None,
            equity=equity_s, trades=list(broker.trades), metrics=metrics, per_pair=per_pair_metrics(broker.trades),
            signals=n_signals, approved=n_approved, rejections=dict(rejections),
            kill_switch=risk.kill.reason if risk.kill.engaged else None,
            drawdown_kill_enforced=self.enforce_drawdown_kill, first_drawdown_breach=risk.first_drawdown_breach,
            total_spread_slippage_cost=broker.total_spread_cost, bars_processed=bars,
            open_positions_at_end=open_at_end)
        self._log("run_end", {"run_id": run_id, "metrics": metrics})
        return res

    def _handle_signal(self, sig: Signal, broker: PaperBroker, risk: RiskManager, rates: dict[str, float],
                       equity: float, rejections: Counter[str]) -> None:
        p = sig.pair
        if sig.action is SignalAction.EXIT:
            o = broker.submit_close(p, sig.ts, reason=sig.reason, strategy=sig.strategy)
            if o is None:
                self._log("risk_decision", {"pair": p, "approved": False, "reasons": ["no position to exit"]})
            return
        if broker.has_pending(p) or p in broker.positions:
            return
        if sig.stop is None:
            self._log("risk_decision", {"pair": p, "approved": False, "reasons": ["entry without stop refused"]})
            rejections["no stop"] += 1
            return
        open_risk = [OpenRisk(x.pair, x.side, x.initial_risk) for x in broker.positions.values()]
        open_risk += [OpenRisk(o.pair, o.side, o.risk_amount) for o in broker.pending if o.kind == "ENTRY"]
        dec = risk.evaluate(p, sig.side, sig.ref_price, sig.stop, equity, open_risk, rates,
                            cost_pips=broker.cost_pips_round_trip(p), risk_pct=self.risk_pct)
        self._log("risk_decision", {"signal_ts": sig.ts.isoformat(), **dec.to_dict()})
        if not dec.approved:
            rejections[_reason_key(dec.reasons[-1])] += 1
            return
        broker.submit_market(p, sig.side, dec.lots, sig.ts, stop=sig.stop, target=sig.target,
                             risk_amount=dec.risk_amount, strategy=sig.strategy, reason=sig.reason)
