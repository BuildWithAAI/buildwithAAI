"""aai-fx command line. PAPER/SIMULATED ONLY: there is no live-trading command."""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

from .config import AppConfig, load_config


def _cfg(args: argparse.Namespace) -> "AppConfig":
    return load_config(args.config)


def cmd_fetch(args: argparse.Namespace) -> int:
    from .pipeline import fetch
    s = fetch(_cfg(args), args.timeframes, args.pairs, Path(args.root))
    bad = [r for r in s["results"] if not r["ok"]]
    for r in s["results"]:
        if r["ok"]:
            print(f"{r['timeframe']:>4} {r['pair']}: {r['rows_clean']:>6} clean / {r['rows_stored']:>6} stored  "
                  f"{r['first_bar']} -> {r['last_bar']}  dup={r['duplicates']} wknd={r['weekend_removed']} "
                  f"incomplete={r['incomplete_removed']} repaired={r['ohlc_repaired']} missing={r['missing_bars']} "
                  f"spikes={r['spikes_flagged']}")
        else:
            print(f"{r['timeframe']:>4} {r['pair']}: FAILED {r['error']}")
    return 1 if bad and len(bad) == len(s["results"]) else 0


def cmd_backtest(args: argparse.Namespace) -> int:
    from .pipeline import backtest_report, run_backtest
    cfg = _cfg(args)
    names = args.strategy or [n for n, s in cfg.strategies.items() if s.enabled]
    results = []
    modes = [args.research_mode] + ([True] if args.with_research and not args.research_mode else [])
    for n, research in [(n, m) for n in names for m in modes]:
        r = run_backtest(cfg, n, Path(args.root), oos=not args.no_oos, wf=args.walkforward, risk_pct=args.risk_pct,
                         research_mode=research)
        m = r.metrics
        print(f"[{n} {r.timeframe}{' research' if research else ''}] {r.period_start} -> {r.period_end}: trades={m.trade_count} "
              f"CAGR={m.cagr_pct} Sharpe={m.sharpe} MaxDD={m.max_drawdown_pct} PF={m.profit_factor} "
              f"ExpR={m.expectancy_r} kill={r.kill_switch}")
        results.append(r)
    j, md = backtest_report(cfg, results, Path(args.root))
    print(f"report: {j}\n        {md}")
    return 0


def cmd_scan(args: argparse.Namespace) -> int:
    from .pipeline import fetch, run_scan
    cfg = _cfg(args)
    if not args.no_fetch:
        tfs = sorted({cfg.strategies[n].timeframe for n, s in cfg.strategies.items() if s.enabled and s.scan})
        fetch(cfg, tfs, None, Path(args.root))
    scan, j, md = run_scan(cfg, Path(args.root), paper=not args.no_paper, strategies=args.strategy)
    print(Path(md).read_text())
    print(f"report: {j}")
    return 0


def cmd_report(args: argparse.Namespace) -> int:
    from .pipeline import combined_report
    j, md = combined_report(_cfg(args), Path(args.root))
    print(f"report: {j}\n        {md}")
    return 0


def cmd_schema(args: argparse.Namespace) -> int:
    from .reporting.schema import AAIReport
    p = Path(args.out)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(AAIReport.model_json_schema(), indent=2))
    print(p)
    return 0


def cmd_audit_verify(args: argparse.Namespace) -> int:
    from .reporting.audit import verify_audit_log
    ok, n, msg = verify_audit_log(args.path)
    print(f"{args.path}: {n} records, {'OK' if ok else 'BROKEN'} ({msg})")
    return 0 if ok else 2


def cmd_kill(args: argparse.Namespace) -> int:
    from .reporting.audit import AuditLog
    from .risk.kill_switch import KillSwitch
    cfg = _cfg(args)
    ks = KillSwitch(Path(args.root) / cfg.risk.kill_switch_file)
    with AuditLog(Path(args.root) / cfg.reporting.audit_path, run_id="cli-kill") as audit:
        if args.action == "on":
            ks.engage(args.reason or "manual", persist=True)
            audit.append("kill_switch", {"action": "engage", "reason": ks.reason})
        elif args.action == "off":
            ks.reset()
            audit.append("kill_switch", {"action": "reset"})
    print(f"kill switch engaged={ks.engaged} reason={ks.reason}")
    return 0


def cmd_zoora(args: argparse.Namespace) -> int:
    from .research.zoora import main_research
    out = main_research(args.config, Path(args.root), prepare=not args.no_prepare, workers=args.workers)
    print(f"results: {out / 'results.md'}\n         {out / 'results.json'}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="aai-fx", description=__doc__)
    ap.add_argument("-c", "--config", default="configs/default.yaml")
    ap.add_argument("--root", default=".", help="project root for data/, reports/, state/")
    ap.add_argument("-v", "--verbose", action="store_true")
    sub = ap.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fetch", help="download + validate + store OHLCV")
    f.add_argument("-t", "--timeframes", nargs="*")
    f.add_argument("-p", "--pairs", nargs="*")
    f.set_defaults(fn=cmd_fetch)
    b = sub.add_parser("backtest", help="run backtests (+ IS/OOS split, optional walk-forward)")
    b.add_argument("-s", "--strategy", nargs="*")
    b.add_argument("--walkforward", action="store_true")
    b.add_argument("--no-oos", action="store_true")
    b.add_argument("--risk-pct", type=float, default=None)
    b.add_argument("--research-mode", action="store_true",
                   help="disable the drawdown kill INSIDE the simulation (breach still reported)")
    b.add_argument("--with-research", action="store_true",
                   help="run each strategy twice: as configured AND in research mode, in one report")
    b.set_defaults(fn=cmd_backtest)
    s = sub.add_parser("scan", help="evaluate latest completed bars; paper orders only")
    s.add_argument("-s", "--strategy", nargs="*")
    s.add_argument("--no-fetch", action="store_true")
    s.add_argument("--no-paper", action="store_true", help="signals + risk decisions only, no paper orders")
    s.set_defaults(fn=cmd_scan)
    r = sub.add_parser("report", help="combine latest backtest + scan into an AAI Terminal report")
    r.set_defaults(fn=cmd_report)
    sc = sub.add_parser("schema", help="write JSON schema of the report")
    sc.add_argument("--out", default="schemas/report.schema.json")
    sc.set_defaults(fn=cmd_schema)
    a = sub.add_parser("audit-verify", help="verify an audit log hash chain")
    a.add_argument("path", nargs="?", default="audit/audit.jsonl")
    a.set_defaults(fn=cmd_audit_verify)
    k = sub.add_parser("kill", help="kill switch: on | off | status")
    k.add_argument("action", choices=["on", "off", "status"])
    k.add_argument("--reason", default=None)
    k.set_defaults(fn=cmd_kill)
    z = sub.add_parser("zoora", help="Zoora EMA research grid (use -c configs/zoora.yaml)")
    z.add_argument("--no-prepare", action="store_true", help="reuse stored Dukascopy/yfinance data")
    z.add_argument("--workers", type=int, default=7)
    z.set_defaults(fn=cmd_zoora)
    return ap


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(level=logging.INFO if args.verbose else logging.WARNING,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    return int(args.fn(args))


if __name__ == "__main__":
    sys.exit(main())
