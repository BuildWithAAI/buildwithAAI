"""`perps` command-line interface. Every command uses public market data only."""

from __future__ import annotations

import json
import logging
import sys
from pathlib import Path
from typing import Annotated

import typer

from .config import load_settings
from .data.http import ExchangeUnavailable

app = typer.Typer(add_completion=False, no_args_is_help=True,
                  help="Crypto perps research + paper trading (Phase 1: NO live execution).")

ConfigOpt = Annotated[Path | None, typer.Option("--config", "-c", help="Path to default.yaml override")]
ExchangeOpt = Annotated[str | None, typer.Option("--exchange", "-e", help="blofin | bybit")]


def _setup(verbose: bool) -> None:
    logging.basicConfig(level=logging.INFO if verbose else logging.WARNING,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def _csv(v: str | None) -> list[str] | None:
    return [x.strip() for x in v.split(",") if x.strip()] if v else None


@app.command()
def backfill(
    config: ConfigOpt = None, exchange: ExchangeOpt = None,
    symbols: Annotated[str | None, typer.Option(help="Comma list, default universe.base (+top volume)")] = None,
    timeframes: Annotated[str | None, typer.Option(help="Comma list; default from config backfill.days")] = None,
    days: Annotated[int | None, typer.Option(help="Override history depth for all timeframes")] = None,
    rate: Annotated[float, typer.Option(help="Max requests/second")] = 2.0,
    top_extra: Annotated[int | None, typer.Option(help="Add N extra USDT perps by 24h quote volume")] = None,
    verbose: bool = True,
) -> None:
    """Backfill instruments, OHLCV, funding history and OI snapshots into Parquet (idempotent)."""
    _setup(verbose)
    from .data.adapters import get_adapter
    from .data.backfill import backfill_symbol, resolve_universe, write_quality_report
    from .data.store import ParquetStore

    s = load_settings(config)
    ex = exchange or s.exchange.default
    ad = get_adapter(ex, rate_per_sec=rate)
    store = ParquetStore(s.data_dir)
    days_by_tf = dict(s.backfill.days)
    if s.backfill.include_1m_days:
        days_by_tf["1m"] = s.backfill.include_1m_days
    if timeframes:
        days_by_tf = {tf: days_by_tf.get(tf, days or 365) for tf in _csv(timeframes) or []}
    if days:
        days_by_tf = {tf: days for tf in days_by_tf}
    try:
        n_extra = s.universe.top_volume_extra if top_extra is None else top_extra
        syms = _csv(symbols) or resolve_universe(ad, s.universe.base, n_extra,
                                                 s.universe.min_24h_quote_volume)
        results = []
        for sym in syms:
            r = backfill_symbol(ad, store, sym, days_by_tf)
            results.append(r)
            typer.echo(json.dumps({"symbol": sym, **{tf: {"rows": v["rows"], "first": v["first"], "last": v["last"],
                                                          "coverage": v["coverage"], "passed": v["passed"]}
                                                     for tf, v in r["ohlcv"].items()},
                                   "funding_rows": r["funding"]["rows"]}))
        write_quality_report(results, s.data_dir / ex / "quality_report.json")
        typer.echo(f"requests made: {ad.client.request_count}; quality report: {s.data_dir / ex / 'quality_report.json'}")
    except ExchangeUnavailable as e:
        typer.echo(f"[{ex}] exchange unavailable from this network: {e}", err=True)
        raise typer.Exit(2) from e


@app.command()
def quality(config: ConfigOpt = None, exchange: ExchangeOpt = None) -> None:
    """Re-run data-quality checks on everything stored locally."""
    from .data.quality import check_ohlcv
    from .data.store import ParquetStore

    s = load_settings(config)
    ex = exchange or s.exchange.default
    store = ParquetStore(s.data_dir)
    root = s.data_dir / ex / "ohlcv"
    for sym_dir in sorted(root.glob("*")):
        for f in sorted(sym_dir.glob("*.parquet")):
            df = store.load_ohlcv(ex, sym_dir.name, f.stem)
            r = check_ohlcv(df, sym_dir.name, f.stem).to_dict()
            typer.echo(f"{sym_dir.name:10s} {f.stem:4s} rows={r['rows']:>7} {r['first'][:16]} -> {r['last'][:16]} "
                       f"coverage={r['coverage']:.4f} gaps={r['gap_count']} dups={r['duplicates']} "
                       f"ohlc_viol={r['ohlc_violations']} outliers={r['return_outliers']} "
                       f"{'PASS' if r['passed'] else 'FAIL'} {'; '.join(r['notes'])}")


@app.command()
def backtest(
    strategy: Annotated[str, typer.Argument(help="range_breakout | ema_pullback | vol_squeeze")],
    timeframe: Annotated[str, typer.Option("--tf")] = "1H",
    symbols: Annotated[str | None, typer.Option(help="Comma list; >1 symbol = shared-equity portfolio")] = None,
    config: ConfigOpt = None, exchange: ExchangeOpt = None,
    params: Annotated[str | None, typer.Option(help='JSON overrides, e.g. \'{"atr_stop_mult": 2}\'')] = None,
    start: str | None = None, end: str | None = None,
    trades_out: Annotated[Path | None, typer.Option(help="Write OOS trades CSV here")] = None,
) -> None:
    """Run one strategy with the configured IS/OOS split and print metrics as JSON."""
    _setup(False)
    from .evaluation.metrics import SUMMARY_KEYS
    from .evaluation.research import load_symbol_data
    from .evaluation.walkforward import run_split, split_time
    from .timeframes import normalize

    s = load_settings(config)
    ex = exchange or s.exchange.default
    tf = normalize(timeframe)
    p = {**s.strategies.get(strategy, {}).get("params", {}), **(json.loads(params) if params else {})}
    data = [load_symbol_data(s, ex, sym, tf, start, end) for sym in (_csv(symbols) or s.universe.base[:1])]
    split = split_time(data, s.backtest.is_fraction)
    r = run_split(s, strategy, tf, p, data, split, ex)
    if trades_out and len(r.oos_result.trades):
        r.oos_result.trades.to_csv(trades_out, index=False)
    typer.echo(json.dumps({"strategy": strategy, "timeframe": tf, "symbols": [d.symbol for d in data],
                           "split": str(split), "params": p,
                           "in_sample": {k: r.is_metrics.get(k) for k in SUMMARY_KEYS},
                           "out_of_sample": {k: r.oos_metrics.get(k) for k in SUMMARY_KEYS},
                           "oos_rejections": r.oos_metrics.get("rejections")}, indent=2, default=str))


@app.command()
def research(
    config: ConfigOpt = None, exchange: ExchangeOpt = None,
    strategies: Annotated[str | None, typer.Option(help="Comma list (default: all in strategies.yaml)")] = None,
    symbols: str | None = None, timeframes: str | None = None,
    no_sweep: bool = False, no_walk_forward: bool = False, no_portfolio: bool = False,
    workers: int | None = None,
) -> None:
    """Full research run: IS/OOS, IS sweep -> OOS, walk-forward, markdown/HTML report + PNG charts."""
    _setup(True)
    from .evaluation.research import run_research

    s = load_settings(config)
    out = run_research(s, exchange or s.exchange.default, _csv(strategies), _csv(symbols), _csv(timeframes),
                       not no_sweep, not no_walk_forward, not no_portfolio, workers)
    typer.echo(f"report: {out / 'report.md'}\nhtml:   {out / 'report.html'}")


@app.command()
def paper(
    config: ConfigOpt = None, exchange: ExchangeOpt = None,
    strategy: Annotated[str | None, typer.Option(help="Run only this strategy (default: config paper.strategies)")] = None,
    timeframe: Annotated[str | None, typer.Option("--tf")] = None,
    symbols: str | None = None,
) -> None:
    """One-shot paper-trading step (cron-friendly). Simulated fills only; prints a JSON summary."""
    _setup(False)
    from .data.adapters import get_adapter
    from .paper.engine import PaperEngine

    s = load_settings(config)
    ad = get_adapter(exchange or s.exchange.default)
    eng = PaperEngine(s, ad)
    refs = [(strategy, timeframe or "1H")] if strategy else [(r.name, r.timeframe) for r in s.paper.strategies]
    summary: dict = {"runs": []}
    try:
        for name, tf in refs:
            out = eng.step(name, tf, _csv(symbols) or s.universe.base)
            summary["runs"].append({"strategy": name, "timeframe": tf, "opened": out.opened, "closed": out.closed,
                                    "skipped": out.skipped, "errors": out.errors,
                                    "signals": [x for x in out.signals if x["signal"] != 0]})
            summary["equity"] = round(out.equity, 4)
    except ExchangeUnavailable as e:
        typer.echo(json.dumps({"error": f"exchange unavailable: {e}"}))
        raise typer.Exit(2) from e
    typer.echo(json.dumps(summary, indent=2, default=str))


@app.command()
def report(
    config: ConfigOpt = None, exchange: ExchangeOpt = None,
    fmt: Annotated[str, typer.Option("--format", help="json | md | both")] = "both",
    offline: Annotated[bool, typer.Option(help="Use stored data only (no network)")] = False,
    out: Annotated[Path | None, typer.Option(help="Also write status.json / status.md into this directory")] = None,
) -> None:
    """Orchestrator-friendly status: regime, latest signals, open paper positions, PnL."""
    _setup(False)
    from .data.adapters import get_adapter
    from .reporting.status import build_status, status_markdown

    s = load_settings(config)
    ad = None if offline else get_adapter(exchange or s.exchange.default)
    st = build_status(s, ad, offline=offline)
    md = status_markdown(st)
    if out:
        out.mkdir(parents=True, exist_ok=True)
        (out / "status.json").write_text(json.dumps(st, indent=2, default=str))
        (out / "status.md").write_text(md)
    if fmt in ("json", "both"):
        typer.echo(json.dumps(st, indent=2, default=str))
    if fmt in ("md", "both"):
        typer.echo(md)


@app.command()
def universe(config: ConfigOpt = None, exchange: ExchangeOpt = None, top: int = 15) -> None:
    """Show top USDT perps by 24h quote volume (public tickers)."""
    from .data.adapters import get_adapter

    s = load_settings(config)
    ad = get_adapter(exchange or s.exchange.default)
    t = ad.fetch_tickers().sort_values("quote_volume_24h", ascending=False).head(top)
    typer.echo(t[["symbol", "last", "quote_volume_24h"]].to_string(index=False))

ArenaOpt = Annotated[Path | None, typer.Option("--arena-config", help="Path to arena.yaml override")]


@app.command()
def tick(
    config: ConfigOpt = None, arena_config: ArenaOpt = None, exchange: ExchangeOpt = None,
    quiet: Annotated[bool, typer.Option(help="Print only the one-line summary")] = False,
) -> None:
    """One arena step (run every 5 min from cron): refresh data, manage simulated positions on 1m bars,
    evaluate every arm, journal + learn. SIMULATION ONLY - no orders are ever sent. Exits 0 if another
    tick holds the lock or a kill switch is active (positions are still managed under a kill)."""
    _setup(False)
    from .arena.config import load_arena_config
    from .arena.tick import Arena
    from .data.adapters import get_adapter

    s = load_settings(config)
    cfg = load_arena_config(arena_config)
    ad = get_adapter(exchange or cfg.exchange, rate_per_sec=3.0)
    summary = Arena(s, cfg, ad).tick()
    typer.echo(summary.line())
    if not quiet:
        typer.echo(json.dumps({k: v for k, v in summary.__dict__.items()}, indent=2, default=str))
    if summary.status == "error":
        raise typer.Exit(1)


@app.command()
def journal(
    config: ConfigOpt = None,
    arm: Annotated[str | None, typer.Option(help="Only this arm")] = None,
    trade_id: Annotated[int | None, typer.Option("--id", help="Show one trade in full")] = None,
    open_only: Annotated[bool, typer.Option("--open", help="Only open positions")] = False,
    fmt: Annotated[str, typer.Option("--format", help="table | md | json")] = "table",
    last: Annotated[int, typer.Option(help="Show the last N trades")] = 50,
) -> None:
    """Read the arena trade journal: thesis, indicators, PnL ($ and R), duration, MAE/MFE, post-mortem."""
    from .arena.journal import cst, render_md
    from .arena.ledger import ArenaLedger

    s = load_settings(config)
    db = s.state_dir / "arena" / "arena.sqlite"
    if not db.exists():
        typer.echo("no arena ledger yet - run `perps tick` first")
        raise typer.Exit(0)
    led = ArenaLedger(db)
    if trade_id is not None:
        t = led.trade(trade_id)
        if t is None:
            typer.echo(f"trade {trade_id} not found")
            raise typer.Exit(1)
        trades = [t]
        fmt = "md" if fmt == "table" else fmt
    else:
        trades = led.trades(arm, "open" if open_only else None)[-last:]
    led.close()
    if fmt == "json":
        typer.echo(json.dumps(trades, indent=2, default=str))
    elif fmt == "md":
        typer.echo("\n\n---\n\n".join(render_md(t) for t in trades) or "no trades")
    else:
        if not trades:
            typer.echo("no trades yet")
            return
        typer.echo(f"{'id':>4} {'arm':<20} {'sym':<9} {'side':<5} {'entry (CST)':<24} {'entry':>11} {'exit':>11} "
                   f"{'reason':<12} {'net $':>9} {'R':>6} {'min':>7} {'MAE R':>6} {'MFE R':>6}")
        for t in trades:
            closed = t["status"] == "closed"
            exit_s = f"{t['exit_price']:.6g}" if closed else "open"
            r_s = f"{t['r_multiple']:+.2f}" if closed else "-"
            pnl = t["net_pnl"] if closed else t.get("unrealized", 0.0)
            side = "long" if t["side"] > 0 else "short"
            typer.echo(
                f"{t['id']:>4} {t['arm']:<20} {t['symbol']:<9} {side:<5} {cst(t['entry_time']):<24} "
                f"{t['entry_price']:>11.6g} {exit_s:>11} {(t.get('exit_reason') or '-'):<12} {pnl:>+9.4f} {r_s:>6} "
                f"{(t.get('duration_min') or 0):>7.1f} {(t.get('mae_r') or 0):>+6.2f} {(t.get('mfe_r') or 0):>+6.2f}")


@app.command("arena-status")
def arena_status(config: ConfigOpt = None, fmt: Annotated[str, typer.Option("--format", help="md | json")] = "md") -> None:
    """Print the arena status written by the last tick (state/arena/status.md|json)."""
    s = load_settings(config)
    p = s.state_dir / "arena" / ("status.json" if fmt == "json" else "status.md")
    typer.echo(p.read_text() if p.exists() else "no arena status yet - run `perps tick` first")


@app.command("archive-legacy")
def archive_legacy_cmd(config: ConfigOpt = None, exchange: ExchangeOpt = None) -> None:
    """Close positions left open in the legacy state/paper.sqlite at their stop (checked against the 1m tape),
    then move that ledger to state/archive/ so the arena arms start clean."""
    _setup(False)
    from .arena.archive import archive_legacy
    from .data.adapters import get_adapter
    from .data.store import ParquetStore

    s = load_settings(config)
    db = s.state_dir / "paper.sqlite"
    if not db.exists():
        typer.echo("no legacy ledger at state/paper.sqlite")
        return
    import sqlite3

    import pandas as pd
    con = sqlite3.connect(db)
    rows = [json.loads(r[0]) for r in con.execute("SELECT data FROM positions WHERE status='open'")]
    con.close()
    ex = exchange or s.exchange.default
    ad = get_adapter(ex, rate_per_sec=2.0)
    store = ParquetStore(s.data_dir)
    bars, funding = {}, {}
    for p in rows:
        start = int(pd.Timestamp(p["entry_time"]).value // 1_000_000) - 60_000
        bars[p["symbol"]] = ad.fetch_candles(p["symbol"], "1m", start)
        store.upsert_funding(ex, p["symbol"], ad.fetch_funding_page(p["symbol"], None, 30))
        funding[p["symbol"]] = store.load_funding(ex, p["symbol"])
    out = archive_legacy(db, s.state_dir / "archive", bars, funding, s.fee_rates(ex).taker)
    typer.echo(json.dumps(out, indent=2, default=str))


def main() -> None:  # pragma: no cover
    sys.exit(app())


if __name__ == "__main__":  # pragma: no cover
    main()
