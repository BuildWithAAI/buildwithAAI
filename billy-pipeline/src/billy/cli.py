"""billy CLI: ingest | parse | data | backtest | signals | report | all"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from .config import Settings, load_settings
from .logging_utils import get_logger, setup_logging

log = get_logger("billy.cli")
DEFAULT_CFG = Path(__file__).resolve().parents[2] / "config" / "default.yaml"


def _signals(s: Settings):
    from .ingest import PostStore
    from .parse import parse_posts
    return parse_posts(PostStore(s.paths.posts_store).sorted(), s.assets)


def cmd_ingest(s: Settings, a) -> int:
    from .ingest import run_ingest
    r = run_ingest(s, move_processed=not a.keep_inbox)
    print(json.dumps(r.__dict__, indent=2))
    return 0


def cmd_parse(s: Settings, a) -> int:
    from .parse import coverage_report
    sigs = _signals(s)
    s.paths.signals_store.parent.mkdir(parents=True, exist_ok=True)
    with open(s.paths.signals_store, "w") as f:
        for x in sigs:
            f.write(x.model_dump_json() + "\n")
    cov = coverage_report(sigs)
    s.paths.reports_dir.mkdir(parents=True, exist_ok=True)
    (s.paths.reports_dir / "parse_coverage.json").write_text(json.dumps(cov, indent=2, default=str))
    print(json.dumps(cov, indent=2, default=str))
    return 0


def cmd_data(s: Settings, a) -> int:
    from .market import MarketData, update_cache
    if not a.offline:
        update_cache(s)
    md = MarketData.from_cache(s)
    print(json.dumps({k: {x: v[x] for x in ("rows", "first", "last", "gaps", "missing_bars")}
                      for k, v in md.gap_reports().items()}, indent=2))
    return 0


def cmd_backtest(s: Settings, a) -> int:
    from .backtest import breakdown, buy_and_hold, run_backtest, summarize, validate
    from .market import MarketData
    from .parse import coverage_report
    from .strategy import EventCalendar, FilterContext, build_setups

    sigs = _signals(s)
    md = MarketData.from_cache(s)
    if md.h1["BTC"].empty:
        print("No market data cached; run `billy data` first", file=sys.stderr)
        return 2
    cal = EventCalendar.from_yaml(s.paths.events_file)
    start = pd.Timestamp(s.backtest.start, tz="UTC") if s.backtest.start else md.h1["BTC"].index[0]
    end = pd.Timestamp(s.backtest.end, tz="UTC") if s.backtest.end else md.h1["BTC"].index[-1]
    ctx = FilterContext()
    setups = build_setups(sigs, s.strategy, md.h1, md.d1["BTC"], ctx)
    r = run_backtest(setups, md, s, calendar=cal, start=start, end=end)
    df = r.trades_df()
    full = summarize(df, r.equity, s.backtest.start_equity)
    bh = buy_and_hold({x: md.h1[x]["close"] for x in s.assets}, start, end, s.backtest.start_equity)
    basket = bh.pop("_basket_curve", None)
    v = None if a.quick else validate(sigs, md, s, cal, start, end)
    cov = coverage_report(sigs)
    art = s.paths.reports_dir / "artifacts"
    art.mkdir(parents=True, exist_ok=True)
    df.to_csv(art / "trades.csv", index=False)
    eq = pd.DataFrame({"strategy": r.equity})
    if basket is not None:
        eq["bh_basket"] = basket.reindex(eq.index)
    btc = md.h1["BTC"]["close"]
    btc = btc[(btc.index >= start) & (btc.index <= end)]
    eq["bh_BTC"] = s.backtest.start_equity * btc / btc.iloc[0]
    eq.to_csv(art / "equity.csv")
    if v is not None:
        pd.DataFrame(v.grid).to_csv(art / "grid.csv", index=False)
        if v.wf_result is not None:
            v.wf_result.trades_df().to_csv(art / "walk_forward_trades.csv", index=False)
    vd = {"split_ts": None, "is_metrics": {}, "oos_metrics": {}, "grid": [], "grid_rank_corr": None,
          "best_is_key": None, "best_is_oos": None, "walk_forward": [], "wf_oos_metrics": None,
          "flags": ["validation skipped (--quick)"]}
    if v is not None:
        vd = {k: getattr(v, k) for k in vd}
    metrics = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "costs": s.costs.model_dump(), "strategy": s.strategy.model_dump(), "risk": s.risk.model_dump(),
        "oos_fraction": s.backtest.oos_fraction,
        "full": full, "validation": vd, "buy_and_hold": bh,
        "by_rule": breakdown(df, "rule"), "by_asset": breakdown(df, "asset"), "by_tier": breakdown(df, "tier"),
        "by_side": breakdown(df, "side"), "by_close_label": breakdown(df, "close_label"),
        "by_exit": breakdown(df, "exit_reason"),
        "funnel": {"posts": None, "outlooks": cov["outlooks"],
                   "actionable": sum(1 for x in sigs if x.parse_status == "actionable"),
                   "setups": len(setups), "setup_rejections": ctx.rejections,
                   "engine_rejections": r.rejections, "killed_days": r.killed_days},
        "parse_coverage": cov,
        "data_quality": md.gap_reports(),
        "caveats": [
            "Sample is short (~6 months of dense posts, May-Nov 2026) and covers one market regime.",
            "Parser is deterministic regex; ~20% of actionable posts carry an explicit target, the rest use a 2R fallback target.",
            "Fills are simulated on 1h OHLC; intrabar order of stop vs target is unknown, stop assumed first.",
            "Costs: taker fee + fixed slippage per fill; funding (perps) and borrow (spot shorts) not modelled.",
            "Macro blackout uses FOMC dates only before Nov 2026 (past CPI/NFP dates not available, see config/events.yaml).",
            "Billy's own discretionary exits and later updates are not modelled; this tests his posted levels with fixed rules.",
        ],
    }
    from .ingest import PostStore
    metrics["funnel"]["posts"] = len(PostStore(s.paths.posts_store).posts)
    (art / "metrics.json").write_text(json.dumps(metrics, indent=2, default=str))
    print(json.dumps({"full": full, "is": vd["is_metrics"], "oos": vd["oos_metrics"],
                      "wf_oos": vd["wf_oos_metrics"], "flags": vd["flags"]}, indent=2, default=str))
    return 0


def cmd_signals(s: Settings, a) -> int:
    from .execution import get_adapter
    from .market import MarketData
    from .signals import build_candidates, notify_discord, render_markdown
    from .signals.today import to_orders
    from .strategy import EventCalendar

    if a.equity:
        s.signals.notional_equity = a.equity
    md = MarketData.from_cache(s)
    cal = EventCalendar.from_yaml(s.paths.events_file)
    now = datetime.fromisoformat(a.now) if a.now else datetime.now(timezone.utc)
    payload = build_candidates(_signals(s), md, s, cal, now=now)
    s.paths.reports_dir.mkdir(parents=True, exist_ok=True)
    (s.paths.reports_dir / "signals_today.json").write_text(json.dumps(payload, indent=2, default=str))
    md_txt = render_markdown(payload)
    (s.paths.reports_dir / "signals_today.md").write_text(md_txt)
    if a.paper:
        broker = get_adapter(s)
        for o in to_orders(payload):
            broker.submit(o)
    if a.notify:
        notify_discord(md_txt)
    print(md_txt)
    return 0


def cmd_report(s: Settings, a) -> int:
    from .report import render_report
    p = render_report(s.paths.reports_dir)
    print(p)
    return 0


def cmd_all(s: Settings, a) -> int:
    for fn in (cmd_ingest, cmd_parse, cmd_data, cmd_backtest, cmd_report, cmd_signals):
        rc = fn(s, a)
        if rc:
            return rc
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="billy", description="Billy (@cryptoWZRD_) signal pipeline — PAPER ONLY")
    p.add_argument("--config", default=str(DEFAULT_CFG))
    p.add_argument("--log-level", default="INFO")
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("ingest", "parse", "data", "backtest", "signals", "report", "all"):
        sp = sub.add_parser(name)
        sp.set_defaults(keep_inbox=False, offline=False, quick=False, equity=None, now=None, paper=False, notify=False)
        if name in ("ingest", "all"):
            sp.add_argument("--keep-inbox", action="store_true", help="do not move processed inbox files")
        if name in ("data", "all"):
            sp.add_argument("--offline", action="store_true", help="use cache only, no network")
        if name in ("backtest", "all"):
            sp.add_argument("--quick", action="store_true", help="skip walk-forward/grid")
        if name in ("signals", "all"):
            sp.add_argument("--equity", type=float, help="EXAMPLE equity for sizing (default from config)")
            sp.add_argument("--now", help="ISO timestamp to evaluate at (default: now, UTC)")
            sp.add_argument("--paper", action="store_true", help="record actionable candidates in the paper ledger")
            sp.add_argument("--notify", action="store_true", help="post to DISCORD_WEBHOOK_URL if set")
    return p


def main(argv: list[str] | None = None) -> int:
    a = build_parser().parse_args(argv)
    setup_logging(a.log_level)
    s = load_settings(a.config)
    return {"ingest": cmd_ingest, "parse": cmd_parse, "data": cmd_data, "backtest": cmd_backtest,
            "signals": cmd_signals, "report": cmd_report, "all": cmd_all}[a.cmd](s, a)


if __name__ == "__main__":
    sys.exit(main())
