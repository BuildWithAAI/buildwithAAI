"""Orchestration used by the CLI: fetch, backtest, scan, report."""

from __future__ import annotations

import json
import logging
import platform
import socket
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pandas as pd

from . import __version__
from .backtest.engine import BacktestEngine, BacktestResult
from .backtest.walkforward import is_oos_split, walk_forward
from .config import AppConfig
from .data.base import Timeframe
from .data.registry import make_provider
from .data.store import ParquetStore
from .data.validation import validate_ohlcv
from .execution.paper import PaperBroker
from .reporting.audit import AuditLog, verify_audit_log
from .reporting.markdown import render_markdown
from .reporting.schema import (DISCLAIMERS, AAIReport, AuditInfo, DataProvenance, Metrics, ScanResult, ScanSignal,
                               SplitResult, StrategyResult, WalkForwardSummary)
from .risk.kill_switch import KillSwitch
from .risk.manager import OpenRisk, RiskManager
from .strategies import strategy_from_config
from .strategies.base import BarContext, PositionView, SignalAction

log = logging.getLogger("aai_fx")

YF_LIMITATIONS = [
    "Yahoo Finance FX = indicative mid quotes (no bid/ask, volume=0); spread is modeled, not observed.",
    "Intraday history capped by Yahoo: 1m ~30d, 5m/15m ~60d, 1h ~730d. H4 resampled from 1h (UTC-aligned).",
    "Yahoo session boundaries differ from broker server time (usually GMT+2/+3 NY-close candles).",
]


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _stamp() -> str:
    return utcnow().strftime("%Y%m%dT%H%M%SZ")


# ----------------------------------------------------------------------- fetch
def fetch(cfg: AppConfig, timeframes: list[str] | None = None, pairs: list[str] | None = None,
          root: Path = Path(".")) -> dict[str, Any]:
    provider = make_provider(cfg.data.provider)
    store = ParquetStore(root / cfg.data.store_dir)
    tfs = [Timeframe.parse(t) for t in (timeframes or list(cfg.data.history))]
    summary: dict[str, Any] = {"provider": provider.name, "fetched_at": utcnow().isoformat(), "results": []}
    for tf in tfs:
        spec = cfg.data.history.get(tf.value)
        start = None
        if spec and spec.start:
            start = datetime.fromisoformat(spec.start).replace(tzinfo=timezone.utc)
        elif spec and spec.lookback_days:
            start = utcnow() - timedelta(days=spec.lookback_days)
        for pair in pairs or cfg.pairs:
            rec: dict[str, Any] = {"pair": pair, "timeframe": tf.value}
            try:
                raw = provider.fetch(pair, tf, start, None)
                clean, rep = validate_ohlcv(raw, pair, tf)
                merged = store.write(clean, provider.name, tf, pair,
                                     meta={"provider": provider.name, "fetched_at": utcnow().isoformat(),
                                           "validation": rep.to_dict()})
                rec.update({"ok": True, "rows_fetched": rep.rows_in, "rows_clean": rep.rows_out,
                            "rows_stored": len(merged), "first_bar": rep.first_bar, "last_bar": rep.last_bar,
                            "duplicates": rep.duplicates_removed, "weekend_removed": rep.weekend_removed,
                            "incomplete_removed": rep.incomplete_removed, "ohlc_repaired": rep.ohlc_repaired,
                            "missing_bars": rep.missing_bars, "spikes_flagged": len(rep.spikes_flagged),
                            "warnings": rep.warnings})
            except Exception as exc:  # noqa: BLE001 - report every failure, keep going
                rec.update({"ok": False, "error": f"{type(exc).__name__}: {exc}"})
            log.info("fetch %s", rec)
            summary["results"].append(rec)
    out = root / cfg.data.store_dir / "fetch_summary.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(summary, indent=2, default=str))
    return summary


def load_data(cfg: AppConfig, timeframe: str, root: Path = Path("."), pairs: list[str] | None = None
              ) -> tuple[dict[str, pd.DataFrame], DataProvenance]:
    tf = Timeframe.parse(timeframe)
    store = ParquetStore(root / cfg.data.store_dir)
    data, bars, vals = {}, {}, {}
    for p in pairs or cfg.pairs:
        try:
            df = store.read(cfg.data.provider, tf, p)
        except FileNotFoundError as exc:
            log.warning("%s", exc)
            continue
        data[p] = df
        bars[p] = len(df)
        v = store.meta(cfg.data.provider, tf, p).get("validation", {})
        vals[p] = {k: v.get(k) for k in ("missing_bars", "duplicates_removed", "weekend_removed",
                                         "incomplete_removed", "ohlc_repaired") if k in v}
        vals[p]["spikes_flagged"] = len(v.get("spikes_flagged", []))
    firsts = [d.index[0] for d in data.values() if len(d)]
    lasts = [d.index[-1] for d in data.values() if len(d)]
    prov = DataProvenance(provider=cfg.data.provider, timeframe=tf.value, pairs=sorted(data),
                          first_bar=min(firsts).isoformat() if firsts else None,
                          last_bar=max(lasts).isoformat() if lasts else None, bars_per_pair=bars,
                          validation=vals, limitations=YF_LIMITATIONS if cfg.data.provider == "yfinance" else [])
    return data, prov


# -------------------------------------------------------------------- backtest
def _metrics(m: dict[str, Any]) -> Metrics:
    return Metrics.model_validate(m)


def run_backtest(cfg: AppConfig, name: str, root: Path = Path("."), oos: bool = True,
                 wf: bool = False, risk_pct: float | None = None, research_mode: bool = False) -> StrategyResult:
    """research_mode=True disables the drawdown kill switch inside the simulation (the breach is
    still recorded) so the strategy's full-history behaviour can be studied. Live/paper scans
    always enforce it."""
    kill = not research_mode
    sc = cfg.strategies[name]
    data, prov = load_data(cfg, sc.timeframe, root)
    if not data:
        raise RuntimeError(f"no data for {sc.timeframe}; run `aai-fx fetch` first")
    run_id = f"{name}{'-research' if research_mode else ''}-{_stamp()}-{uuid.uuid4().hex[:6]}"
    run_dir = root / cfg.reporting.runs_dir / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    with AuditLog(run_dir / "audit.jsonl", run_id=run_id) as audit:
        res: BacktestResult = BacktestEngine(cfg, strategy_from_config(name, cfg), audit=audit,
                                             risk_pct=risk_pct, enforce_drawdown_kill=kill).run(data, run_id=run_id)
    pd.DataFrame([t.to_dict() for t in res.trades]).to_csv(run_dir / "trades.csv", index=False)
    res.equity.to_frame().to_csv(run_dir / "equity.csv")
    ok, n, msg = verify_audit_log(run_dir / "audit.jsonl")
    sr = StrategyResult(
        run_id=run_id, strategy=name, timeframe=sc.timeframe, params=res.strategy["params"],
        period_start=res.start.isoformat() if res.start is not None else None,
        period_end=res.end.isoformat() if res.end is not None else None, metrics=_metrics(res.metrics),
        per_pair=res.per_pair, signals=res.signals, approved_entries=res.approved, rejections=res.rejections,
        kill_switch=res.kill_switch, drawdown_kill_enforced=kill, first_drawdown_breach=res.first_drawdown_breach,
        spread_slippage_cost=res.total_spread_slippage_cost, data=prov,
        artifacts={"run_dir": str(run_dir), "trades_csv": str(run_dir / "trades.csv"),
                   "equity_csv": str(run_dir / "equity.csv"), "audit": str(run_dir / "audit.jsonl"),
                   "audit_records": str(n), "audit_chain_ok": str(ok)})
    if oos:
        split, r_is, r_oos = is_oos_split(cfg, name, data, kill=kill)
        sr.is_oos = SplitResult(split_ts=split.isoformat(), in_sample=_metrics(r_is.metrics),
                                out_of_sample=_metrics(r_oos.metrics))
    if wf and name in cfg.backtest.walkforward:
        w = cfg.backtest.walkforward[name]
        wr = walk_forward(cfg, name, data, w, kill=kill)
        sr.walk_forward = WalkForwardSummary(
            train_bars=w.train_bars, test_bars=w.test_bars, grid_size=wr.grid_size, objective=w.objective,
            windows=[{"train": f"{x.train_start.date()}..{x.train_end.date()}",
                      "test": f"{x.test_start.date()}..{x.test_end.date()}", "best_params": x.best_params,
                      "train_objective": x.train_objective, "test_trades": x.test_metrics.get("trade_count"),
                      "test_return_pct": x.test_metrics.get("total_return_pct"),
                      "test_sharpe": x.test_metrics.get("sharpe")} for x in wr.windows],
            oos_metrics=_metrics(wr.oos_metrics), notes=wr.notes)
    (run_dir / "result.json").write_text(sr.model_dump_json(indent=2))
    return sr


def backtest_report(cfg: AppConfig, results: list[StrategyResult], root: Path = Path(".")) -> tuple[Path, Path]:
    rep = _base_report(cfg, "backtest")
    rep.backtests = results
    rep.audit = [AuditInfo(path=r.artifacts["audit"], records=int(r.artifacts["audit_records"]),
                           chain_ok=r.artifacts["audit_chain_ok"] == "True") for r in results]
    return _write_report(cfg, rep, root, "backtest")


# ------------------------------------------------------------------------ scan
def run_scan(cfg: AppConfig, root: Path = Path("."), paper: bool = True, strategies: list[str] | None = None
             ) -> tuple[ScanResult, Path, Path]:
    kill = KillSwitch(root / cfg.risk.kill_switch_file)
    audit = AuditLog(root / cfg.reporting.audit_path, run_id=f"scan-{_stamp()}")
    audit.append("scan_start", {"paper": paper, "kill_switch": kill.engaged})
    state_dir = root / cfg.execution.paper_state_dir
    state_dir.mkdir(parents=True, exist_ok=True)
    signals: list[ScanSignal] = []
    market: list[dict[str, Any]] = []
    positions_out: list[dict[str, Any]] = []
    strat_info: list[dict[str, Any]] = []
    notes: list[str] = []
    now = pd.Timestamp.now(tz="UTC")
    names = strategies or [n for n, s in cfg.strategies.items() if s.enabled and s.scan]
    for name in names:
        sc = cfg.strategies[name]
        strat = strategy_from_config(name, cfg)
        tf_delta = strat.timeframe.delta
        data, prov = load_data(cfg, sc.timeframe, root)
        strat_info.append({"name": name, "timeframe": sc.timeframe, "last_bar": prov.last_bar})
        snap_p = state_dir / f"{name}.json"
        bkw: dict[str, Any] = dict(account_ccy=cfg.account.currency, costs=cfg.costs, audit=audit, ledger_dir=state_dir / name)
        if snap_p.exists():
            snap = json.loads(snap_p.read_text())
            broker = PaperBroker.restore(snap["broker"], **bkw)
            last_seen = {k: pd.Timestamp(v) for k, v in snap.get("last_seen", {}).items()}
            risk_state = snap.get("risk", {})
        else:
            broker = PaperBroker(cfg.account.starting_equity, **bkw)
            last_seen, risk_state = {}, {}
        rates = {p: float(df["close"].iloc[-1]) for p, df in data.items() if len(df)}
        # advance paper positions through bars not yet seen
        for p, df in data.items():
            ls = last_seen.get(p)
            new = df[df.index > ls] if ls is not None else df.iloc[0:0]
            for ts, row in new.iterrows():
                for t in broker.process_bar(p, ts, row.open, row.high, row.low, row.close, rates):
                    notes.append(f"[{name}] paper {t.pair} closed {t.exit_kind} {t.r_multiple:+.2f}R")
            if len(df):
                last_seen[p] = df.index[-1]
        equity = broker.equity(rates)
        risk = RiskManager(cfg.risk, cfg.account.currency, kill)
        risk.peak_equity = max(float(risk_state.get("peak_equity", equity)), equity)
        risk.on_equity(now, equity)
        if risk_state.get("day") == str(now.normalize().date()):
            risk.day_start_equity = float(risk_state.get("day_start_equity", equity))
        if kill.engaged and kill.flag_file is not None and not kill.flag_file.exists():
            kill.engage(kill.reason or "drawdown kill", persist=True)  # make it sticky across scans
            audit.append("kill_switch", {"reason": kill.reason, "strategy": name})
        if kill.engaged and cfg.risk.kill_switch_flatten and paper:
            for p in list(broker.positions):
                broker.submit_close(p, now, reason="kill switch flatten", strategy=name)
        for p, df in data.items():
            if len(df) < strat.warmup_bars + 2:
                continue
            f = strat.prepare(df, p)
            cols = {c: f[c].to_numpy(dtype=float) for c in f.columns}
            strat.reset()
            n = len(f)
            start_i = max(strat.warmup_bars, n - 400)  # replay so stateful strategies know today's history
            last_bar_signals = []
            for i in range(start_i, n):
                pos = broker.positions.get(p) if i == n - 1 else None
                pv = PositionView(pos.side, pos.entry_price, pos.stop, pos.target, pos.entry_ts,
                                  pos.bars_held) if pos else None
                sigs = strat.on_bar(BarContext(p, i, f.index, cols, tf_delta, pv))
                if i == n - 1:
                    last_bar_signals = sigs
            row = f.iloc[-1]
            bar_close = f.index[-1] + tf_delta
            ms: dict[str, Any] = {"strategy": name, "pair": p, "tf": sc.timeframe,
                                  "last_bar_close": bar_close.isoformat(), "age_min": round((now - bar_close).total_seconds() / 60, 1),
                                  "close": float(row.close)}
            for k in ("bias", "atr", "dc_hi", "dc_lo", "rng_hi", "rng_lo", "datr"):
                if k in f.columns and pd.notna(row[k]):
                    ms[k] = float(row[k])
            ms["position"] = {1: "LONG", -1: "SHORT"}.get(broker.positions[p].side) if p in broker.positions else "-"
            market.append(ms)
            for sig in last_bar_signals:
                audit.append("signal", sig.to_dict())
                ss = ScanSignal(pair=p, strategy=name, timeframe=sc.timeframe, action=sig.action.value,
                                bar_close_ts=sig.ts.isoformat(), ref_price=sig.ref_price, stop=sig.stop,
                                target=sig.target, reason=sig.reason)
                if sig.action is SignalAction.EXIT:
                    o = broker.submit_close(p, sig.ts, reason=sig.reason, strategy=name) if paper else None
                    ss.paper_order_id = o.id if o else None
                elif sig.stop is not None:
                    open_risk = [OpenRisk(x.pair, x.side, x.initial_risk) for x in broker.positions.values()]
                    open_risk += [OpenRisk(o.pair, o.side, o.risk_amount) for o in broker.pending if o.kind == "ENTRY"]
                    dec = risk.evaluate(p, sig.side, sig.ref_price, sig.stop, equity, open_risk, rates,
                                        cost_pips=broker.cost_pips_round_trip(p))
                    audit.append("risk_decision", {"signal_ts": sig.ts.isoformat(), **dec.to_dict()})
                    ss.risk = dec.to_dict()
                    if dec.approved and paper and not broker.has_pending(p):
                        o = broker.submit_market(p, sig.side, dec.lots, sig.ts, stop=sig.stop, target=sig.target,
                                                 risk_amount=dec.risk_amount, strategy=name, reason=sig.reason)
                        ss.paper_order_id = o.id
                signals.append(ss)
        positions_out += [{"strategy": name, **pp.to_dict()} for pp in broker.positions.values()]
        positions_out += [{"strategy": name, "pending_order": o.to_dict()} for o in broker.pending]
        snap_p.write_text(json.dumps({"broker": broker.snapshot(), "last_seen": {k: v.isoformat() for k, v in last_seen.items()},
                                      "risk": {"peak_equity": risk.peak_equity, "day": str(now.normalize().date()),
                                               "day_start_equity": risk.day_start_equity},
                                      "equity": equity}, indent=2, default=str))
        notes.append(f"[{name}] paper equity {equity:,.2f} {cfg.account.currency}")
    if kill.engaged:
        notes.append(f"KILL SWITCH ENGAGED: {kill.reason} -- all entries rejected")
    audit.append("scan_end", {"signals": len(signals)})
    audit.close()
    scan = ScanResult(generated_at=now.isoformat(), strategies=strat_info, signals=signals, market_state=market,
                      paper_positions=positions_out, kill_switch_engaged=kill.engaged, notes=notes)
    rep = _base_report(cfg, "scan")
    rep.scan = scan
    ok, n, msg = verify_audit_log(root / cfg.reporting.audit_path)
    rep.audit = [AuditInfo(path=str(root / cfg.reporting.audit_path), records=n, chain_ok=ok, message=msg)]
    j, m = _write_report(cfg, rep, root, "scan")
    return scan, j, m


# ---------------------------------------------------------------------- report
def _base_report(cfg: AppConfig, kind: str) -> AAIReport:
    return AAIReport(report_id=f"{kind}-{_stamp()}", generated_at=utcnow().isoformat(), kind=kind,
                     producer={"name": "aai-fx", "version": __version__, "host": socket.gethostname(),
                               "platform": platform.platform(), "consumer": "AAI Terminal"},
                     config_fingerprint=cfg.fingerprint(), account=cfg.account.model_dump(),
                     risk_limits=cfg.risk.model_dump(), disclaimers=DISCLAIMERS)


def _write_report(cfg: AppConfig, rep: AAIReport, root: Path, kind: str) -> tuple[Path, Path]:
    out = root / cfg.reporting.out_dir
    out.mkdir(parents=True, exist_ok=True)
    j = out / f"{rep.report_id}.json"
    m = out / f"{rep.report_id}.md"
    j.write_text(rep.model_dump_json(indent=2))
    m.write_text(render_markdown(rep))
    (out / f"latest_{kind}.json").write_text(j.read_text())
    (out / f"latest_{kind}.md").write_text(m.read_text())
    return j, m


def combined_report(cfg: AppConfig, root: Path = Path(".")) -> tuple[Path, Path]:
    out = root / cfg.reporting.out_dir
    rep = _base_report(cfg, "combined")
    for kind in ("backtest", "scan"):
        p = out / f"latest_{kind}.json"
        if p.exists():
            r = AAIReport.model_validate_json(p.read_text())
            if kind == "backtest":
                rep.backtests = r.backtests
            else:
                rep.scan = r.scan
            rep.audit += r.audit
    j, m = _write_report(cfg, rep, root, "combined")
    (out / "latest.json").write_text(j.read_text())
    (out / "latest.md").write_text(m.read_text())
    return j, m
