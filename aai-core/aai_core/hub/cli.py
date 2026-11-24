"""AAI Terminal hub CLI (`python -m aai ...`). All output is JSON on stdout; logs are JSON lines on stderr.

Exit codes: 0 ok (health: overall=pass) | 1 health fail | 2 usage/input error | 3 data source error.
"""
from __future__ import annotations
import argparse, json, sys
from ..infra import logging as L
from ..schema import INTERVALS


def build_parser():
    p = argparse.ArgumentParser(prog="python -m aai", description="AAI shared data + risk hub (read-only)")
    p.add_argument("--log-level", default=None)
    sub = p.add_subparsers(dest="cmd", required=True)

    h = sub.add_parser("health", help="aggregate health (aai-core sources + smr)")
    h.add_argument("--quick", action="store_true", help="skip the end-to-end assess")
    h.add_argument("--no-smr", action="store_true", help="do not include smr health")
    h.add_argument("--no-tests", action="store_true", help="do not run the quick test suite")

    a = sub.add_parser("assess", help="risk_decision for one proposed position")
    a.add_argument("--asset-class", required=True, choices=["crypto_perp", "forex", "equity", "solana_meme"])
    a.add_argument("--symbol", required=True, help="BTCUSDT | EURUSD | SPY | <solana mint>")
    a.add_argument("--side", default="long", choices=["long", "short"])
    a.add_argument("--entry", type=float)
    a.add_argument("--stop", type=float)
    a.add_argument("--bankroll", type=float)
    a.add_argument("--risk-pct", type=float, help="percent of bankroll at risk (policy 1-3, clamped at 3)")
    a.add_argument("--book", help="JSON book of all agents' open/proposed positions + account state + limits")
    a.add_argument("--interval", choices=list(INTERVALS), help="candle interval for ATR/vol (default 1h; equity 1d)")
    a.add_argument("--venue", default="auto", help="crypto_perp: auto|bybit|blofin|okx")
    a.add_argument("--account-type", choices=["margin", "cash", "retirement"])
    a.add_argument("--summary", action="store_true", help="print only the orchestrator_summary-compatible keys")
    a.add_argument("-o", "--out")

    e = sub.add_parser("exposure", help="aggregate exposure of a book")
    e.add_argument("--book", required=True)
    e.add_argument("--bankroll", type=float)

    m = sub.add_parser("market", help="normalized OHLCV + quote")
    m.add_argument("--asset-class", required=True, choices=["crypto_perp", "forex", "equity"])
    m.add_argument("--symbol", required=True)
    m.add_argument("--interval", default="1h", choices=list(INTERVALS))
    m.add_argument("--limit", type=int, default=50)
    m.add_argument("--venue", default="auto")
    return p


def _out(obj, path=None):
    s = json.dumps(obj, indent=2, default=str)
    if path:
        open(path, "w").write(s + "\n")
    print(s)


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    L.setup(args.log_level)
    from ..infra.http import SourceError
    from .smr_bridge import SmrError
    try:
        if args.cmd == "health":
            from .health import run
            r = run(quick=args.quick, tests=not args.no_tests, smr=not args.no_smr)
            _out(r); return 0 if r["overall"] == "pass" else 1
        if args.cmd == "assess":
            from .assess import assess, AssessError
            from ..risk.decision import orchestrator_view
            try:
                d = assess(args.asset_class, args.symbol, args.side, args.entry, args.stop, args.bankroll, args.risk_pct,
                           args.book, args.interval, args.venue, args.account_type)
            except AssessError as e:
                _out({"error": "assess_error", "detail": str(e)}); return 2
            _out(orchestrator_view(d) if args.summary else d, args.out); return 0
        if args.cmd == "exposure":
            from ..risk.portfolio import load_book, aggregate
            from ..risk.guardrails import limits, account_checks
            b = load_book(args.book)
            agg = aggregate(b, args.bankroll)
            g, gm = account_checks(b["account"], limits(b))
            _out({**agg, "limits": limits(b), "guardrails": gm, "guardrail_flags": g}); return 0
        if args.cmd == "market":
            from ..data.registry import Market
            f = Market().feed(args.asset_class)
            kw = {"venue": args.venue} if args.asset_class == "crypto_perp" else {}
            s = f.candles(args.symbol, args.interval, args.limit, **kw)
            q = f.quote(args.symbol, **kw)
            _out({"series": s.to_dict(), "quote": q.to_dict(), "attempts": f.attempts}); return 0
    except (SourceError, SmrError) as e:
        _out({"error": type(e).__name__, "detail": str(e)[:500]}); return 3
    except ValueError as e:
        _out({"error": "bad_input", "detail": str(e)[:500]}); return 2
    return 2
