"""CLI:  python -m risk <command>
  score <MINT> [--as-of UNIX|launch] [--buyers N] [--hops 1|2] [--trace-limit N] [--full] [-o FILE] [-v]
  watch [--minutes M] [--max-tokens N] [--min-age S] ...
  backtest sample|label|run|calibrate|report ...
  health [--quick] [--no-tests] [--mint MINT]
  paper cycle|report|events   (paper-trading simulator, simulated money only)
  scanner status|start|stop|run|once   (5-min market scanner -> silent `scanner` paper book)
  experiment100 scanner|watcher|report|events|holders   (isolated $100 paper book; own DB)
All commands are read-only / simulation-only: no trading, no signing, no keys."""
from __future__ import annotations
import argparse, json, sys


def _score(a):
    from .pipeline import score_mint
    from .context import default_context
    ctx = default_context()
    as_of = None
    if a.as_of == "launch":
        c = ctx.pumpfun.coin(a.mint) or {}
        if not c.get("created_timestamp"):
            sys.exit("--as-of launch needs the pump.fun creation time")
        as_of = int(c["created_timestamp"] / 1000) + ctx.settings.score_delay_s
    elif a.as_of:
        as_of = int(a.as_of)
    prog = (lambda m: print(f"[risk] {m}", file=sys.stderr)) if a.verbose else None
    kw = dict(ctx=ctx, as_of=as_of, n_buyers=a.buyers, hops=a.hops, trace_limit=a.trace_limit, full=a.full, progress=prog)
    if a.format == "v1":
        doc = score_mint(a.mint, **kw)
    else:
        from .pipeline import score_mint_legacy
        doc = score_mint_legacy(a.mint, **kw)
    s = json.dumps(doc["orchestrator_summary"] if a.summary else doc, indent=2, default=str)
    if a.output:
        open(a.output, "w").write(json.dumps(doc, indent=2, default=str))
    print(s)


def build_parser():
    ap = argparse.ArgumentParser(prog="python -m risk", description="pump.fun launch risk pipeline (read-only)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("score", help="score one mint, print risk_report v1 JSON")
    p.add_argument("mint")
    p.add_argument("--as-of", default=None, help="unix seconds, or 'launch' (= creation + score_delay_s); default now")
    p.add_argument("--buyers", type=int, default=None)
    p.add_argument("--hops", type=int, choices=[1, 2], default=None)
    p.add_argument("--trace-limit", type=int, default=None)
    p.add_argument("--full", action="store_true")
    p.add_argument("--summary", action="store_true", help="print only orchestrator_summary")
    p.add_argument("--format", choices=["compat", "v1"], default="compat",
                   help="compat (default): v0 top-level keys + additions incl. risk_report_v1; v1: the risk_report.v1 document only")
    p.add_argument("-o", "--out", "--output", dest="output")
    p.add_argument("-v", "--verbose", action="store_true")
    p.set_defaults(fn=_score)
    from . import watch, healthcheck
    from .backtest import cli as bt
    watch.add_parser(sub); healthcheck.add_parser(sub); bt.add_parser(sub)
    from .paper import cli as paper
    paper.add_parser(sub); paper.add_scanner_parser(sub)
    from .paper import experiment100_cli as exp100
    exp100.add_parser(sub)
    return ap


def main(argv=None):
    a = build_parser().parse_args(argv)
    a.fn(a)


if __name__ == "__main__":
    main()
