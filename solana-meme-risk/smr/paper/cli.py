"""`python -m risk paper cycle|report|events|void|watcher` (simulation only: no wallets, keys, signing or orders)."""
from __future__ import annotations
import fcntl, json, os, sys, time


def _ledger(a):
    from .ledger import Ledger
    from .engine import default_ledger_path
    return Ledger(a.db or default_ledger_path(_ctx_settings_only()))


def _ctx_settings_only():
    from .. import config as C
    class _S:
        settings = C.load_settings()
    return _S()


def _cycle(a):
    from .engine import Cycle, default_ledger_path
    from ..context import Context
    from .engine import _NoPumpFun
    ctx = Context()
    ctx.pumpfun = _NoPumpFun()
    path = a.db or default_ledger_path(ctx)
    lockf = open(path + "-cycle.lock", "w")
    try:
        fcntl.flock(lockf, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        print(json.dumps({"skipped": "another paper cycle is running"})); return
    from .ledger import Ledger
    led = Ledger(path)
    say = (lambda m: print(f"[paper] {m}", file=sys.stderr, flush=True)) if not a.quiet else None
    st = Cycle(ctx, led, cap=a.max_score, parallel=a.parallel, budget_s=a.budget_s, min_age_s=a.min_age_s, max_age_s=a.max_age_s,
               progress=say, min_mcap_usd=a.min_mcap_usd, momentum_cfg=_mcfg(a)).run()
    led.close()
    print(json.dumps(st, indent=2, default=str), flush=True)
    sys.stderr.flush()
    # a score that overran the budget may still hold worker threads; the ledger is committed, so exit now
    os._exit(0)


def _mcfg(a):
    from ..momentum import MomentumConfig
    c = MomentumConfig.load()
    if getattr(a, "no_momentum", False):
        c.enabled = False
    return c


def _report(a):
    from .report import build, summary_text
    led = _ledger(a)
    r = build(led)
    if a.json:
        print(json.dumps(r, indent=2, default=str))
    elif a.summary:
        print(summary_text(r))
    else:
        print(summary_text(r)); print(); print(json.dumps(r, indent=2, default=str))


def _events(a):
    from .report import unreported, mark_reported
    led = _ledger(a)
    ev = unreported(led, a.book)
    if a.text:
        print("\n".join(e["text"] for e in ev) if ev else "No new paper trades.")
    else:
        print(json.dumps({"count": len(ev), "events": ev, "text": "\n".join(e["text"] for e in ev) or "No new paper trades."}, indent=2, default=str))
    if a.mark_reported and ev:
        n = mark_reported(led, [e["event_id"] for e in ev])
        print(f"[paper] marked {n} event(s) reported", file=sys.stderr)


def _void(a):
    from .engine import void_cycle, void_position
    if sum(x is not None for x in (a.cycle, a.position, a.mint)) != 1:
        raise SystemExit("paper void: give exactly one of --cycle, --position or --mint")
    led = _ledger(a)
    if a.cycle is not None:
        print(json.dumps(void_cycle(led, a.cycle, a.reason), indent=2))
    else:
        r = void_position(led, a.reason, position_id=a.position, mint=a.mint, book=a.book)
        print(json.dumps(r, indent=2))
        if not r["found"]:
            raise SystemExit(1)


def _smartmoney(a):
    """Smart-money data for the edge features: `plan` says which StalkChain MCP calls to make (budgeted);
    `ingest` reads the saved MCP result files. Untrusted text is reduced to wallets, sanitized handles and numbers."""
    from . import edge as EG
    cfg = EG.EdgeConfig.load().smart
    now = time.time()
    if a.action == "plan":
        led = _ledger(a)
        print(json.dumps(EG.smart_plan(led, now, cfg), indent=2, default=str)); return
    out = {}
    if a.leaderboard:
        objs = [EG.parse_mcp_file(f) for f in a.leaderboard]
        out["leaderboard"] = EG.ingest_leaderboard([o for o in objs if o is not None], now, cfg)
        if not a.no_log:
            EG.log_usage(cfg.usage_file, "stalkchain_fomo_leaderboard", now, len(a.leaderboard))
    if a.feed:
        obj = EG.parse_mcp_file(a.feed)
        if obj is None:
            raise SystemExit("smartmoney ingest: could not parse --feed file")
        out["feed"] = EG.ingest_feed(obj, now, cfg)
        if not a.no_log:
            EG.log_usage(cfg.usage_file, "stalkchain_fomo_multi_trader_entries", now)
    if a.log_veto_calls:
        EG.log_usage(cfg.usage_file, "veto_lookup_unlogged", now, a.log_veto_calls)
    if not out and not a.log_veto_calls:
        raise SystemExit("smartmoney ingest: give --leaderboard FILE... and/or --feed FILE")
    out["calls_used_today_ct"] = EG.calls_today(cfg, now)
    print(json.dumps(out, indent=2, default=str))


def _holders(a):
    """Live holder counts for $30k+ coins with unknown holders (edge feature `holders_live`): `plan` lists the
    stalkchain_token_quality calls to make (capped per cycle, shared daily budget, veto reserve kept); `ingest` reads
    the saved MCP result files into data/holder_cache.json. Untrusted text is checked and dropped: numbers/flags only."""
    from . import edge as EG
    ec = EG.EdgeConfig.load()
    now = time.time()
    if a.action == "plan":
        led = _ledger(a)
        print(json.dumps(EG.holders_plan(led, now, ec.holders, ec.smart, ec.bundle), indent=2, default=str)); return
    if not a.file:
        raise SystemExit("holders ingest: give --file FILE...")
    objs = [EG.parse_mcp_file(f) for f in a.file]
    out = EG.ingest_holders([o for o in objs if o is not None], now, ec.holders)
    out["unparsed_files"] = sum(o is None for o in objs)
    if not a.no_log:
        EG.log_usage(ec.smart.usage_file, EG.QUALITY_TOOL, now, len(a.file))
    out["calls_used_today_ct"] = EG.calls_today(ec.smart, now)
    print(json.dumps(out, indent=2, default=str))


def _xheat(a):
    """X narrative heat: `plan` lists the terms to refresh and the exact X MCP calls (budgeted); `ingest` reads the
    saved result files. Post text is fenced, checked and dropped: only counts and sanitized handles are stored."""
    from . import edge as EG
    cfg = EG.EdgeConfig.load().x
    now = time.time()
    if a.action == "plan":
        led = _ledger(a)
        print(json.dumps(EG.x_plan(led, now, cfg), indent=2, default=str)); return
    if not (a.term and a.counts):
        raise SystemExit("xheat ingest: give --term, --kind and --counts FILE (and --search FILE)")
    counts = EG.parse_mcp_file(a.counts)
    search = EG.parse_mcp_file(a.search) if a.search else None
    if counts is None:
        raise SystemExit("xheat ingest: could not parse --counts file")
    r = EG.ingest_x(a.term, a.kind, counts, search, now, cfg)
    if not a.no_log:
        EG.log_usage(cfg.usage_file, "x", now, 1 + int(bool(a.search)), note=f"{a.kind}:{r['term']}")
    print(json.dumps(r, indent=2, default=str))


def _watcher(a):
    """1-minute exit watcher for the momentum family (smr/paper/watcher.py). `start` is idempotent (the 15-min paper
    routine calls it every cycle): running + fresh heartbeat -> no-op; hung (stale heartbeat) -> restart; dead -> start."""
    from . import watcher as W
    from .engine import default_ledger_path
    db = a.db or default_ledger_path(_ctx_settings_only())
    if a.action == "run":
        raise SystemExit(W.run_forever(db, a.interval, a.gt_per_min))
    if a.action == "once":
        from .ledger import Ledger
        led = Ledger(db)
        dex_fn, gt_fn, src = W.live_sources()
        w = W.Watcher(led, dex_fn, gt_fn if a.gt_per_min > 0 else None, interval_s=a.interval, gt_per_min=a.gt_per_min,
                      pid=-os.getpid(), sources=src)
        r = w.tick()
        from . import sigbooks as SB
        with led.tx():
            SB.release_lease(led, w.pid)        # a one-off tick must not keep the cycle away from the signal books
        print(json.dumps(r, indent=2, default=str)); return
    r = {"status": W.status, "stop": W.stop}.get(a.action)
    out = r(db) if r else W.start(db, a.interval, a.gt_per_min)
    if a.quiet and a.action == "start":
        out = {k: out.get(k) for k in ("action", "running", "healthy", "pid", "heartbeat_age_s", "ticks", "errors", "last_error")}
    print(json.dumps(out, indent=2, default=str))
    if a.action == "status" and a.check and not out.get("healthy"):
        raise SystemExit(1)


def _scanner(a):
    """5-min whole-market scanner for the silent `scanner` paper book (smr/paper/scanner.py). `start` is idempotent like
    the watcher's: running + fresh heartbeat -> no-op; hung -> restart; dead -> start."""
    from . import scanner as S
    from .engine import default_ledger_path
    db = a.db or default_ledger_path(_ctx_settings_only())
    if a.action == "run":
        raise SystemExit(S.run_forever(db, a.interval))
    if a.action == "once":
        out = S.once(db)
        if a.quiet:
            out = {k: out.get(k) for k in ("cycle_id", "candidates", "quoted", "prefilter_pass", "runner_scored", "risk", "blocked", "entries",
                                           "top_runners", "elapsed_s", "calls_this_cycle", "errors")}
        print(json.dumps(out, indent=2, default=str)); return
    r = {"status": S.status, "stop": S.stop}.get(a.action)
    out = r(db) if r else S.start(db, a.interval)
    if a.quiet and a.action == "start":
        out = {k: out.get(k) for k in ("action", "running", "healthy", "pid", "heartbeat_age_s", "cycles", "errors", "last_error")}
    print(json.dumps(out, indent=2, default=str))
    if a.action == "status" and a.check and not out.get("healthy"):
        raise SystemExit(1)


def add_scanner_parser(sub):
    sc = sub.add_parser("scanner", help="5-min whole-market scanner -> silent `scanner` paper book (status|start|stop|run|once; simulated money only)")
    sc.add_argument("action", choices=["status", "start", "stop", "run", "once"])
    sc.add_argument("--interval", type=int, default=300, help="seconds between scans (default 300)")
    sc.add_argument("--check", action="store_true", help="status: exit code 1 unless running with a fresh heartbeat")
    sc.add_argument("--quiet", action="store_true", help="start/once: short JSON")
    sc.add_argument("--db", default=None)
    sc.set_defaults(fn=_scanner)


def add_parser(sub):
    p = sub.add_parser("paper", help="paper-trading simulator (simulated money only)")
    ps = p.add_subparsers(dest="paper_cmd", required=True)
    c = ps.add_parser("cycle", help="one idempotent cycle: mark/exit positions, score new launches, open simulated positions")
    c.add_argument("--max-score", type=int, default=15, help="max launches scored per cycle")
    c.add_argument("--parallel", type=int, default=3)
    c.add_argument("--budget-s", type=float, default=540, help="wall-clock budget; unfinished scores are recorded as timeout")
    c.add_argument("--min-age-s", type=int, default=360)
    c.add_argument("--max-age-s", type=int, default=900)
    c.add_argument("--min-mcap-usd", type=float, default=None,
                   help="strategy book buys only at FDV >= this (default $30,000 or env SMR_PAPER_MIN_MCAP_USD)")
    c.add_argument("--no-momentum", action="store_true", help="skip the momentum book this cycle (also env SMR_PAPER_MOMENTUM=0)")
    c.add_argument("--quiet", action="store_true")
    c.add_argument("--db", default=None)
    c.set_defaults(fn=_cycle)
    r = ps.add_parser("report", help="bankroll, PnL, strategy vs buy-everything, SKIP hit rate, open positions")
    r.add_argument("--summary", action="store_true", help="short plain-English text")
    r.add_argument("--json", action="store_true")
    r.add_argument("--db", default=None)
    r.set_defaults(fn=_report)
    e = ps.add_parser("events", help="trade events (BUY/SELL) not yet reported")
    e.add_argument("--since-unreported", action="store_true", default=True, help="(default) only events not yet marked reported")
    e.add_argument("--mark-reported", action="store_true", help="mark the printed events reported")
    e.add_argument("--text", action="store_true", help="plain text only (default: JSON with a text field per event)")
    e.add_argument("--book", default="strategy,momentum,scanner",
                   help="book(s), comma-separated (default strategy,momentum,scanner; momentum / scanner events are tagged [PAPER momentum] / [PAPER scanner])")
    e.add_argument("--db", default=None)
    e.set_defaults(fn=_events)
    sm = ps.add_parser("smartmoney", help="smart-money wallet list + multi-trader feed (StalkChain MCP results, budgeted)")
    sm.add_argument("action", choices=["plan", "ingest"])
    sm.add_argument("--leaderboard", nargs="+", default=None, help="saved stalkchain_fomo_leaderboard result file(s)")
    sm.add_argument("--feed", default=None, help="saved stalkchain_fomo_multi_trader_entries result file")
    sm.add_argument("--no-log", action="store_true", help="do not count these files against the daily StalkChain budget")
    sm.add_argument("--log-veto-calls", type=int, default=0, help="count N StalkChain calls not in data/paper_stalkchain.jsonl")
    sm.add_argument("--db", default=None)
    sm.set_defaults(fn=_smartmoney)
    hd = ps.add_parser("holders", help="live holder counts for $30k+ coins with unknown holders (StalkChain token quality, budgeted)")
    hd.add_argument("action", choices=["plan", "ingest"])
    hd.add_argument("--file", nargs="+", default=None, help="saved stalkchain_token_quality result file(s)")
    hd.add_argument("--no-log", action="store_true", help="do not count these files against the daily StalkChain budget")
    hd.add_argument("--db", default=None)
    hd.set_defaults(fn=_holders)
    xh = ps.add_parser("xheat", help="X mention heat per theme/ticker (X MCP results, budgeted; numbers only)")
    xh.add_argument("action", choices=["plan", "ingest"])
    xh.add_argument("--term", default=None, help="theme word (lowercase) or ticker without $")
    xh.add_argument("--kind", choices=["theme", "ticker"], default="theme")
    xh.add_argument("--counts", default=None, help="saved get_posts_counts_recent result (granularity=hour)")
    xh.add_argument("--search", default=None, help="saved search_posts_all result for the last hour")
    xh.add_argument("--no-log", action="store_true", help="do not count these files against the daily X budget")
    xh.add_argument("--db", default=None)
    xh.set_defaults(fn=_xheat)
    wt = ps.add_parser("watcher", help="1-min exit watcher for the momentum family's signal books (status|start|stop|run|once)")
    wt.add_argument("action", choices=["status", "start", "stop", "run", "once"])
    wt.add_argument("--interval", type=int, default=60, help="seconds between marks (default 60)")
    wt.add_argument("--gt-per-min", type=int, default=4, help="GeckoTerminal 1-min OHLCV calls per minute for SIG-HV (0 = off, max 25; paused 5 min after a 429)")
    wt.add_argument("--check", action="store_true", help="status: exit code 1 unless running with a fresh heartbeat")
    wt.add_argument("--quiet", action="store_true", help="start: short JSON")
    wt.add_argument("--db", default=None)
    wt.set_defaults(fn=_watcher)
    v = ps.add_parser("void", help="void one cycle's launches/positions, or one position (kept for audit, excluded from PnL/stats; events never sent)")
    v.add_argument("--cycle", type=int, default=None, help="void every launch/position of this cycle (all books)")
    v.add_argument("--position", type=int, default=None, help="void only this position id (one book)")
    v.add_argument("--mint", default=None, help="void only this mint's position in --book")
    v.add_argument("--book", default="strategy", help="book for --mint (default strategy)")
    v.add_argument("--reason", required=True)
    v.add_argument("--db", default=None)
    v.set_defaults(fn=_void)
