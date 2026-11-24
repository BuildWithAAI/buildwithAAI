"""Small-account study ($100 start) for the Zoora variants -- RESEARCH / PAPER ONLY.

Two sizing modes on top of the normal engine, costs and data:

* ``strict`` -- the standard RiskManager at a risk cap of 1, 2 or 3 % of current equity;
  a trade is SKIPPED when even the minimum lot (0.01) would exceed the cap.
* ``minlot`` -- size at 1 %; when that rounds below 0.01 lot, trade 0.01 lot anyway and
  record the real risk %. This deliberately ignores the 3 % hard cap and the open/correlated
  risk caps (the production RiskManager and agent-guard would refuse such orders).

Both modes add a retail margin model (assumptions, flagged in the report): leverage 1:100,
margin = lots * contract * price / leverage (USD-quoted symbols), an entry needs free margin
>= required margin, and a margin stop-out closes the position when equity/margin <= 50 %.
Stop-out is checked intrabar against the bar's adverse extreme (bid low for longs, ask high
for shorts) before the strategy stop; if both are inside the bar the one nearer the entry is
assumed to trigger first. An entry filling at a bar's open is checked for stop-out within that same
bar. Gaps fill at the bar open, so equity can still end below zero (the report flags it;
retail brokers usually apply negative-balance protection).
"""

from __future__ import annotations

import math
import time
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

import numpy as np
import pandas as pd

from ..config import AppConfig, load_config
from ..data.base import Timeframe
from ..data.store import ParquetStore
from ..execution.models import ClosedTrade
from ..execution.paper import PaperBroker
from ..instruments import get_instrument
from ..risk.kill_switch import KillSwitch
from ..risk.manager import OpenRisk, RiskDecision, RiskManager
from ..risk.sizing import position_size
from ..backtest.engine import BacktestEngine
from ..strategies import make_strategy
from .zoora import COMMON_WARMUP, EMA_PAIRS, VARIANTS

LEVERAGE = 100.0
STOP_OUT_PCT = 50.0


def margin_required(pair: str, lots: float, price: float, leverage: float = LEVERAGE) -> float:
    inst = get_instrument(pair)
    if inst.quote != "USD":
        raise ValueError("margin model only implemented for USD-quoted symbols")
    return lots * inst.contract_size * price / leverage


class MarginPaperBroker(PaperBroker):
    def __init__(self, *a: Any, leverage: float = LEVERAGE, stop_out_pct: float = STOP_OUT_PCT, **k: Any) -> None:
        super().__init__(*a, **k)
        self.leverage = leverage
        self.stop_out_pct = stop_out_pct
        self.stop_outs: list[dict[str, Any]] = []

    def used_margin(self, rates: Mapping[str, float]) -> float:
        return sum(margin_required(p.pair, p.lots, rates[p.pair], self.leverage) for p in self.positions.values())

    def _so_exit_px(self, side: int, entry: float, lots: float, pair: str, o: float, cash: float,
                    others: float) -> float:
        """Exit price at which equity/margin hits the stop-out level (margin valued at the bar open)."""
        units = lots * get_instrument(pair).contract_size
        target_eq = self.stop_out_pct / 100.0 * margin_required(pair, lots, o, self.leverage)
        return entry + side * (target_eq - cash - others) / units

    @staticmethod
    def _nearer(side: int, so_px: float, stop: float | None) -> bool:
        return stop is None or (so_px > stop if side > 0 else so_px < stop)

    def process_bar(self, pair: str, ts: pd.Timestamp, o: float, h: float, l: float, c: float,
                    rates: dict[str, float]) -> list[ClosedTrade]:
        hs = self._half_spread(pair)
        adverse_long, adverse_short = l - hs, h + hs
        swapped: dict[str, Any] = {}
        pos = self.positions.get(pair)
        if pos is not None:
            others = self.unrealized(rates) - self._upnl(pos, rates)  # other open positions
            so_px = self._so_exit_px(pos.side, pos.entry_price, pos.lots, pair, o, self.cash, others)
            hit = adverse_long <= so_px if pos.side > 0 else adverse_short >= so_px
            if hit and self._nearer(pos.side, so_px, pos.stop):
                swapped = {"kind": "pos", "orig": pos.stop}
                pos.stop = so_px
        else:
            # an entry filling at this bar's open is also exposed to a stop-out within this bar
            for od in [x for x in self.pending if x.pair == pair and x.kind == "ENTRY"]:
                cst = self.costs.for_pair(pair)
                slip = cst.slippage_pips * get_instrument(pair).pip_size
                px = o + hs + slip if od.side > 0 else o - hs - slip
                cash_after = self.cash - self._commission(pair, od.lots)
                so_px = self._so_exit_px(od.side, px, od.lots, pair, o, cash_after, self.unrealized(rates))
                hit = adverse_long <= so_px if od.side > 0 else adverse_short >= so_px
                if hit and self._nearer(od.side, so_px, od.stop):
                    swapped = {"kind": "order", "orig": od.stop, "order": od}
                    od.stop = so_px
        n0 = len(self.trades)
        out = super().process_bar(pair, ts, o, h, l, c, rates)
        if swapped:
            orig = swapped["orig"]
            for t in self.trades[n0:]:
                if t.pair == pair and t.exit_kind == "STOP":
                    t.exit_kind = "STOP_OUT"
                    if swapped["kind"] == "order" and orig is not None:   # R vs the strategy's stop
                        t.initial_risk = abs(t.entry_price - orig) * t.lots * get_instrument(pair).contract_size
                        t.r_multiple = t.net_pnl / t.initial_risk if t.initial_risk > 0 else 0.0
                    self.stop_outs.append({"ts": ts.isoformat(), "pair": pair, "equity_after": self.cash,
                                           "net": t.net_pnl})
            p2 = self.positions.get(pair)
            if p2 is not None:  # level not reached after all (e.g. target filled first)
                p2.stop = orig
                if swapped["kind"] == "order" and orig is not None:
                    p2.initial_risk = abs(p2.entry_price - orig) * p2.lots * get_instrument(pair).contract_size
        return out

    def _upnl(self, p: Any, rates: Mapping[str, float]) -> float:
        hs = self._half_spread(p.pair)
        mid = rates[p.pair]
        exit_px = mid - hs if p.side > 0 else mid + hs
        return (exit_px - p.entry_price) * p.side * p.lots * get_instrument(p.pair).contract_size


class SmallAccountRisk(RiskManager):
    def __init__(self, cfg: AppConfig, mode: str, cap_pct: float, broker_ref: list[MarginPaperBroker],
                 drawdown_kill_enabled: bool = False, leverage: float = LEVERAGE) -> None:
        super().__init__(cfg.risk, cfg.account.currency, KillSwitch(None), drawdown_kill_enabled)
        self.mode, self.cap_pct, self.leverage = mode, cap_pct, leverage
        self.broker_ref = broker_ref
        self.evals: list[dict[str, Any]] = []  # every entry signal that reached sizing

    def evaluate(self, pair: str, side: int, entry: float, stop: float, equity: float,
                 open_positions: list[OpenRisk], rates: Mapping[str, float], cost_pips: float = 0.0,
                 risk_pct: float | None = None) -> RiskDecision:
        inst = get_instrument(pair)
        stop_pips = abs(entry - stop) / inst.pip_size
        pv = inst.pip_size * inst.contract_size  # USD-quoted
        minlot_risk = inst.min_lot * (stop_pips + cost_pips) * pv
        need_margin = margin_required(pair, inst.min_lot, entry, self.leverage)
        rec: dict[str, Any] = { "equity": equity, "stop_pips": stop_pips, "cost_pips": cost_pips,
               "minlot_risk_usd": minlot_risk, "minlot_margin_usd": need_margin}
        broker = self.broker_ref[0]
        free = equity - broker.used_margin(rates)
        if self.mode == "strict":
            dec = super().evaluate(pair, side, entry, stop, equity, open_positions, rates, cost_pips,
                                   risk_pct=self.cap_pct)
        else:
            dec = RiskDecision(approved=False, pair=pair, side=side)
            dl = self.daily_loss_pct(equity)
            if equity <= 0:
                dec.reasons.append("equity <= 0 (wiped out)")
            elif dl >= self.cfg.daily_loss_limit_pct:
                dec.reasons.append(f"daily loss {dl:.2f}% >= limit {self.cfg.daily_loss_limit_pct}%")
            elif any(p.pair == pair for p in open_positions):
                dec.reasons.append(f"already have an open position in {pair}")
            else:
                sz = position_size(pair, equity, 1.0, entry, stop, self.account_ccy, rates,
                                   max_lot=self.cfg.max_lot, cost_pips=cost_pips)
                lots = sz.lots if not sz.rejected_reason else inst.min_lot
                act = lots * (stop_pips + cost_pips) * pv
                dec.approved, dec.lots, dec.risk_amount = True, lots, act
                dec.risk_pct = 100.0 * act / equity
                dec.stop_pips, dec.pip_value_per_lot = stop_pips, pv
                dec.reasons.append(f"{'forced min lot' if sz.rejected_reason else 'sized'} {lots} lots, "
                                   f"risk {dec.risk_pct:.2f}%")
                rec["forced_min_lot"] = bool(sz.rejected_reason)
        if dec.approved:
            need = margin_required(pair, dec.lots, entry, self.leverage)
            if need > free:
                dec.approved = False
                dec.reasons.append(f"not enough margin: need {need:.2f} > free {free:.2f}")
        rec.update({"approved": dec.approved, "lots": dec.lots, "risk_pct": dec.risk_pct if dec.approved else None,
                    "reason": dec.reasons[-1] if dec.reasons else ""})
        self.evals.append(rec)
        return dec


@dataclass
class SAJob:
    source: str
    symbol: str
    tf: str
    variant: str
    mode: str          # strict | minlot
    cap_pct: float     # strict cap (minlot targets 1 %)
    cfg_path: str
    root: str
    equity: float = 100.0


def _group(reasons: list[str]) -> dict[str, int]:
    out: dict[str, int] = {}
    for r in reasons:
        k = r.split(" ")[0] + (" " + r.split(" ")[1] if " " in r else "")
        k = "daily loss limit" if r.startswith("daily loss") else k
        out[k] = out.get(k, 0) + 1
    return out


def _pct(x: list[float], q: float) -> float | None:
    return float(np.percentile(x, q)) if x else None


def run_sa_job(job: SAJob) -> dict[str, Any]:
    t_start = time.time()
    cfg = load_config(job.cfg_path)
    cfg = cfg.model_copy(update={"account": cfg.account.model_copy(update={"starting_equity": job.equity})})
    df = ParquetStore(Path(job.root) / cfg.data.store_dir).read(job.source, Timeframe.parse(job.tf), job.symbol)
    df = df[["open", "high", "low", "close", "volume"]]
    fast, slow = EMA_PAIRS["200/800"]
    params = {**VARIANTS[job.variant], "ema_fast": fast, "ema_slow": slow}
    t0 = df.index[COMMON_WARMUP]
    ref: list[MarginPaperBroker] = []
    risk_holder: list[SmallAccountRisk] = []

    def bf(c: AppConfig, audit: Any) -> PaperBroker:
        b = MarginPaperBroker(c.account.starting_equity, c.account.currency, c.costs, audit=audit)
        ref.clear(); ref.append(b)
        return b

    def rf(c: AppConfig, dd: bool) -> RiskManager:
        r = SmallAccountRisk(c, job.mode, job.cap_pct, ref, drawdown_kill_enabled=False)
        risk_holder.clear(); risk_holder.append(r)
        return r

    eng = BacktestEngine(cfg, make_strategy(job.variant, job.tf, params), enforce_drawdown_kill=False,
                         broker_factory=bf, risk_factory=rf)
    res = eng.run({job.symbol: df}, start=t0)
    broker, risk = ref[0], risk_holder[0]
    ev = risk.evals
    eq = res.equity
    m = res.metrics
    approved = [e for e in ev if e["approved"]]
    skipped_minlot = sum(1 for e in ev if "< min lot" in e["reason"])
    skipped_margin = sum(1 for e in ev if "not enough margin" in e["reason"])
    risk_pcts = [e["risk_pct"] for e in approved if e["risk_pct"] is not None]
    inst = get_instrument(job.symbol)
    # first time the account can no longer open a 0.01 lot at all (free margin < min-lot margin)
    stop_rk = [e["minlot_risk_usd"] for e in ev]
    out = {"source": job.source, "symbol": job.symbol, "tf": job.tf, "variant": job.variant, "mode": job.mode,
           "cap_pct": job.cap_pct, "start_equity": job.equity, "trade_start": t0.isoformat(),
           "data_last": df.index[-1].isoformat(),
           "signals_sized": len(ev), "trades": m.get("trade_count"), "skipped_minlot": skipped_minlot,
           "skipped_margin": skipped_margin,
           "other_rejections": _group([e["reason"] for e in ev if not e["approved"]
                                       and "< min lot" not in e["reason"] and "not enough margin" not in e["reason"]]),
           "final_equity": float(eq.iloc[-1]) if len(eq) else job.equity,
           "min_equity": float(eq.min()) if len(eq) else job.equity,
           "peak_equity": float(eq.max()) if len(eq) else job.equity,
           "peak_ts": eq.idxmax().isoformat() if len(eq) else None,
           "year_end_equity": {str(k.year): round(float(v), 2) for k, v in eq.resample("YE").last().items()},
           "cagr_pct": m.get("cagr_pct"), "max_drawdown_pct": m.get("max_drawdown_pct"),
           "profit_factor": m.get("profit_factor"), "expectancy_r": m.get("expectancy_r"),
           "sharpe": m.get("sharpe"), "total_swap": m.get("total_swap"),
           "risk_pct_median": _pct(risk_pcts, 50), "risk_pct_p90": _pct(risk_pcts, 90),
           "risk_pct_max": float(max(risk_pcts)) if risk_pcts else None,
           "forced_min_lot_trades": sum(1 for e in approved if e.get("forced_min_lot")),
           "stop_outs": len(broker.stop_outs), "first_stop_out": broker.stop_outs[0] if broker.stop_outs else None,
           "minlot_risk_usd_median": _pct(stop_rk, 50), "minlot_risk_usd_p90": _pct(stop_rk, 90),
           "minlot_margin_usd_median": _pct([e["minlot_margin_usd"] for e in ev], 50),
           "min_lot": inst.min_lot, "elapsed_s": round(time.time() - t_start, 1)}
    # when did equity first go below the min-lot margin / to <= 0 (from the equity curve)
    if len(eq):
        margin_series = inst.min_lot * inst.contract_size * df["close"].reindex(eq.index - Timeframe.parse(job.tf).delta).to_numpy() / LEVERAGE
        below = np.where(eq.to_numpy() < margin_series)[0]
        out["first_below_minlot_margin_ts"] = eq.index[below[0]].isoformat() if len(below) else None
        z = np.where(eq.to_numpy() <= 0)[0]
        out["first_equity_le_0_ts"] = eq.index[z[0]].isoformat() if len(z) else None
        so = broker.stop_outs
        out["stop_out_dates"] = [s["ts"][:10] for s in so[:5]]
    return out


def run_small_account(cfg_path: str, root: Path, sources: dict[str, list[str]], symbols: list[str],
                      equity: float = 100.0, workers: int = 7) -> list[dict[str, Any]]:
    jobs = []
    for src, tfs in sources.items():
        for tf in tfs:
            for sym in symbols:
                for v in VARIANTS:
                    for cap in (1.0, 2.0, 3.0):
                        jobs.append(SAJob(src, sym, tf, v, "strict", cap, cfg_path, str(root), equity))
                    jobs.append(SAJob(src, sym, tf, v, "minlot", 1.0, cfg_path, str(root), equity))
    with ProcessPoolExecutor(workers) as ex:
        return list(ex.map(run_sa_job, jobs))


def min_balance_table(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Smallest balance at which 0.01 lot stays within 1/2/3 % risk for the median and p90 stop,
    from the min-lot run's sized entry signals (stop + round-trip spread/slippage, ex commission)."""
    rows = []
    for r in results:
        if r["mode"] != "minlot":
            continue
        med, p90 = r["minlot_risk_usd_median"], r["minlot_risk_usd_p90"]
        row = {k: r[k] for k in ("source", "symbol", "tf", "variant")}
        row.update({"minlot_risk_median_usd": med, "minlot_risk_p90_usd": p90,
                    "minlot_margin_median_usd": r["minlot_margin_usd_median"]})
        for c in (1, 2, 3):
            row[f"bal_{c}pct_median"] = None if med is None else med / (c / 100)
            row[f"bal_{c}pct_p90"] = None if p90 is None else p90 / (c / 100)
        rows.append(row)
    return rows
