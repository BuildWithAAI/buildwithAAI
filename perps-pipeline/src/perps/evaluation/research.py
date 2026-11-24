"""Research orchestration: default-param IS/OOS, IS sweep -> OOS, walk-forward, report."""

from __future__ import annotations

import logging
import os
from concurrent.futures import ProcessPoolExecutor
from datetime import UTC, datetime
from pathlib import Path

import pandas as pd

from ..backtest.engine import SymbolData
from ..config import Settings
from ..data.store import ParquetStore
from ..timeframes import normalize
from .metrics import compute_metrics
from .report import md_to_html, metrics_table, plot_equity, plot_sweep_hist, write_json
from .walkforward import objective, run_split, split_time, sweep, walk_forward

log = logging.getLogger(__name__)


def load_symbol_data(settings: Settings, exchange: str, symbol: str, timeframe: str,
                     start: str | None = None, end: str | None = None) -> SymbolData:
    store = ParquetStore(settings.data_dir)
    bars = store.load_ohlcv(exchange, symbol, timeframe, start, end)
    if bars.empty:
        raise FileNotFoundError(f"no {exchange} {symbol} {timeframe} data; run `perps backfill`")
    fund = store.load_funding(exchange, symbol)
    return SymbolData(symbol, bars, store.load_instrument(exchange, symbol), fund)


def _job(args: tuple) -> dict:
    settings, exchange, name, tf, symbols, do_sweep, do_wf, out_dir = args
    logging.basicConfig(level=logging.WARNING)
    if settings.backtest.research_ignore_drawdown_kill:
        # Measure the strategy over the full sample; the would-be kill is reported via max_drawdown.
        settings = settings.model_copy(deep=True)
        settings.risk.max_drawdown_kill = 1.0
    cfg = settings.strategies.get(name, {})
    params, space = dict(cfg.get("params", {})), dict(cfg.get("sweep", {}))
    data = [load_symbol_data(settings, exchange, s, tf) for s in symbols]
    split = split_time(data, settings.backtest.is_fraction)
    label = "+".join(s.split("-")[0] for s in symbols)
    tag = f"{name}_{tf}_{label}"
    r = run_split(settings, name, tf, params, data, split, exchange)
    charts = {"default": str(plot_equity(r.is_result.equity, r.oos_result.equity,
                                         f"{name} {tf} {label} — default params", out_dir / "charts" / f"{tag}.png")
                             .relative_to(out_dir))}
    if len(r.oos_result.trades):
        (out_dir / "trades").mkdir(parents=True, exist_ok=True)
        r.oos_result.trades.to_csv(out_dir / "trades" / f"{tag}_oos_default.csv", index=False)
    out: dict = {"strategy": name, "timeframe": tf, "symbols": label, "split": str(split),
                 "data_start": str(max(d.bars.index[0] for d in data)),
                 "data_end": str(min(d.bars.index[-1] for d in data)),
                 "params": params, "is": r.is_metrics, "oos": r.oos_metrics, "charts": charts}
    if do_sweep and space:
        sw = sweep(settings, name, tf, params, space, data, split, exchange)
        (out_dir / "sweeps").mkdir(parents=True, exist_ok=True)
        sw.to_csv(out_dir / "sweeps" / f"{tag}.csv", index=False)
        best = sw.sort_values("is_objective", ascending=False).iloc[0]
        sel = {k[2:]: (v.item() if hasattr(v, "item") else v) for k, v in best.items() if k.startswith("p_")}
        rs = run_split(settings, name, tf, {**params, **sel}, data, split, exchange)
        charts["selected"] = str(plot_equity(rs.is_result.equity, rs.oos_result.equity,
                                             f"{name} {tf} {label} — IS-selected {sel}",
                                             out_dir / "charts" / f"{tag}_selected.png").relative_to(out_dir))
        charts["sweep"] = str(plot_sweep_hist(sw, f"{name} {tf} {label}: grid of {len(sw)} param sets",
                                              out_dir / "charts" / f"{tag}_sweep.png").relative_to(out_dir))
        out["selected"] = {"params": sel, "is": rs.is_metrics, "oos": rs.oos_metrics,
                           "is_objective": objective(rs.is_metrics)}
        out["robustness"] = {
            "grid_size": int(len(sw)),
            "is_frac_positive_expectancy": float((sw["is_expectancy_r"].fillna(-1) > 0).mean()),
            "oos_frac_positive_expectancy": float((sw["oos_expectancy_r"].fillna(-1) > 0).mean()),
            "oos_frac_positive_return": float((sw["oos_net_return"].fillna(-1) > 0).mean()),
            "oos_median_sharpe": float(sw["oos_sharpe"].median()),
            "oos_median_expectancy_r": float(sw["oos_expectancy_r"].median()),
            # Spearman rank correlation (rank then Pearson; avoids a scipy dependency)
            "is_oos_rank_corr": float(sw["is_sharpe"].rank().corr(sw["oos_sharpe"].rank()))
            if len(sw) > 2 else None,
        }
    if do_wf and space:
        out["walk_forward"] = walk_forward(settings, name, tf, params, space, data,
                                           settings.backtest.walk_forward_folds, exchange)
    return out


def _safe_job(args: tuple) -> dict:
    try:
        return _job(args)
    except Exception as e:  # noqa: BLE001 - one failed job must not lose the whole run
        import traceback

        _, _, name, tf, symbols, *_ = args
        return {"error": f"{type(e).__name__}: {e}", "traceback": traceback.format_exc(), "strategy": name,
                "timeframe": tf, "symbols": symbols}


def run_research(settings: Settings, exchange: str, strategies: list[str] | None = None,
                 symbols: list[str] | None = None, timeframes: list[str] | None = None, do_sweep: bool = True,
                 do_wf: bool = True, portfolio: bool = True, workers: int | None = None,
                 out_dir: Path | None = None) -> Path:
    run_id = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    out_dir = out_dir or settings.reports_dir / f"research_{run_id}"
    out_dir.mkdir(parents=True, exist_ok=True)
    symbols = symbols or settings.universe.base
    names = strategies or list(settings.strategies)
    jobs = []
    for name in names:
        tfs = [normalize(t) for t in (timeframes or settings.strategies[name].get("timeframes", ["1H"]))]
        for tf in tfs:
            for sym in symbols:
                jobs.append((settings, exchange, name, tf, [sym], do_sweep, do_wf, out_dir))
            if portfolio and len(symbols) > 1:
                jobs.append((settings, exchange, name, tf, list(symbols), False, False, out_dir))
    workers = workers or max(1, min(len(jobs), (os.cpu_count() or 2) - 1))
    log.info("research: %d jobs on %d workers -> %s", len(jobs), workers, out_dir)
    if workers > 1:
        with ProcessPoolExecutor(max_workers=workers) as ex:
            results = list(ex.map(_safe_job, jobs))
    else:
        results = [_safe_job(j) for j in jobs]
    write_json(results, out_dir / "results.json")
    md = build_markdown(results, settings, exchange, run_id)
    (out_dir / "report.md").write_text(md)
    (out_dir / "report.html").write_text(md_to_html(md, f"perps research {run_id}"))
    latest = settings.reports_dir / "latest"
    if latest.is_symlink() or latest.exists():
        latest.unlink()
    latest.symlink_to(out_dir.name)
    return out_dir


def _verdict(r: dict) -> str:
    oos, is_ = r["oos"], r["is"]
    n = oos.get("trades", 0)
    if n < 20:
        return "insufficient OOS trades"
    e_oos, e_is = oos.get("expectancy_r", 0) or 0, is_.get("expectancy_r", 0) or 0
    if e_oos > 0.1 and e_is > 0 and (oos.get("net_return") or 0) > 0:
        return "candidate (positive IS+OOS)"
    if e_oos > 0 and (oos.get("net_return") or 0) > 0:
        return "weak positive"
    return "no edge (negative OOS)"


def build_markdown(results: list[dict], settings: Settings, exchange: str, run_id: str) -> str:
    errors = [r for r in results if "error" in r]
    results = [r for r in results if "error" not in r]
    singles = [r for r in results if "+" not in r["symbols"]]
    ports = [r for r in results if "+" in r["symbols"]]
    L: list[str] = [f"# Perps research report — {run_id}", ""]
    L += [f"Exchange data: **{exchange}** (public candles + funding history). Initial equity "
          f"**${settings.capital.initial_equity:.0f}**, risk/trade **{settings.risk.risk_per_trade:.1%}**, "
          f"fees maker/taker **{settings.fee_rates(exchange).maker:.4%} / {settings.fee_rates(exchange).taker:.4%}**, "
          f"slippage **{settings.slippage.market_bps} bps** market + **{settings.slippage.stop_bps} bps** extra on stops, "
          f"take-profit fee: **{settings.backtest.take_profit_fee}**. IS/OOS split at "
          f"**{settings.backtest.is_fraction:.0%}** of each series. Entries at next-bar open; stop-first intrabar.",
          "", "> Numbers below are produced by the engine as-is: no filtering, no cherry-picking. The OOS columns "
          "are the ones that matter; IS is shown for context and overfitting diagnosis.", ""]
    if errors:
        L += ["## Failed jobs", ""] + [f"- {e['strategy']} {e['timeframe']} {e['symbols']}: `{e['error']}`"
                                       for e in errors] + [""]
    L += ["## 1. Out-of-sample results — default parameters (primary table)", ""]
    rows = [{"strategy": r["strategy"], "tf": r["timeframe"], "pair": r["symbols"], "verdict": _verdict(r),
             "metrics": r["oos"]} for r in singles]
    L += [metrics_table(rows, ["strategy", "tf", "pair", "verdict"]), ""]
    L += ["## 2. In-sample results — default parameters", ""]
    L += [metrics_table([{**x, "metrics": r["is"]} for x, r in zip(rows, singles, strict=True)],
                        ["strategy", "tf", "pair"]), ""]
    sel_rows = [r for r in singles if "selected" in r]
    if sel_rows:
        L += ["## 3. IS-optimised parameters evaluated out-of-sample", "",
              "Parameters chosen by best IS daily Sharpe (min 20 IS trades) over the sweep grid, then run once on OOS.",
              ""]
        L += [metrics_table([{"strategy": r["strategy"], "tf": r["timeframe"], "pair": r["symbols"],
                              "selected": ", ".join(f"{k}={v}" for k, v in r["selected"]["params"].items()),
                              "metrics": r["selected"]["oos"]} for r in sel_rows],
                            ["strategy", "tf", "pair", "selected"]), ""]
        L += ["### Parameter robustness (full grid; OOS shown for diagnosis only, not used for selection)", "",
              "| strategy | tf | pair | grid | IS % sets E[R]>0 | OOS % sets E[R]>0 | OOS % sets ret>0 | "
              "OOS median Sharpe | OOS median E[R] | IS↔OOS Sharpe rank corr |", "|" + "---|" * 10]
        for r in sel_rows:
            rb = r["robustness"]
            L.append(f"| {r['strategy']} | {r['timeframe']} | {r['symbols']} | {rb['grid_size']} | "
                     f"{rb['is_frac_positive_expectancy']:.0%} | {rb['oos_frac_positive_expectancy']:.0%} | "
                     f"{rb['oos_frac_positive_return']:.0%} | {rb['oos_median_sharpe']:.2f} | "
                     f"{rb['oos_median_expectancy_r']:.3f} | {_fmt_corr(rb['is_oos_rank_corr'])} |")
        L.append("")
    wf_rows = [r for r in singles if "walk_forward" in r]
    if wf_rows:
        L += ["## 4. Anchored walk-forward (re-optimised each fold on all prior data)", "",
              "| strategy | tf | pair | folds | OOS trades | OOS E[R] | OOS win rate | OOS compounded return | "
              "fold returns |", "|" + "---|" * 9]
        for r in wf_rows:
            w = r["walk_forward"]
            fr = ", ".join(f"{(f['oos_net_return'] or 0) * 100:.1f}%" for f in w["folds"])
            L.append(f"| {r['strategy']} | {r['timeframe']} | {r['symbols']} | {len(w['folds'])} | {w['oos_trades']} | "
                     f"{w.get('oos_expectancy_r', float('nan')):.3f} | {w.get('oos_win_rate', float('nan')):.0%} | "
                     f"{w.get('oos_compounded_return', 0) * 100:.2f}% | {fr} |")
        L.append("")
    if ports:
        L += ["## 5. Multi-symbol portfolio (shared equity, max concurrent positions applied), default params", ""]
        L += [metrics_table([{"strategy": r["strategy"], "tf": r["timeframe"], "pairs": r["symbols"], "seg": seg,
                              "metrics": r[seg]} for r in ports for seg in ("is", "oos")],
                            ["strategy", "tf", "pairs", "seg"]), ""]
    L += ["## 6. Charts", ""]
    for r in results:
        for kind, rel in r["charts"].items():
            L += [f"**{r['strategy']} {r['timeframe']} {r['symbols']} — {kind}**", "", f"![{kind}]({rel})", ""]
    L += ["## 7. Data windows", "", "| strategy | tf | pair | data start | split (IS→OOS) | data end |",
          "|---|---|---|---|---|---|"]
    for r in results:
        L.append(f"| {r['strategy']} | {r['timeframe']} | {r['symbols']} | {r['data_start'][:16]} | "
                 f"{r['split'][:16]} | {r['data_end'][:16]} |")
    L += ["", "## 8. Caveats", "",
          "- Single venue (Blofin) price history; Bybit not yet validated (geo-blocked from the research box).",
          "- OHLC bar simulation: intrabar path unknown; stop-first is conservative for TP, but not for every case.",
          "- Funding settlements strictly inside a bar are charged before intrabar exits (approximation).",
          "- Slippage is a fixed-bps model; no order-book depth / queue modelling. $100 notional sizes are tiny, "
          "so market impact is negligible, but minimum lot sizes constrain sizing on BTC.",
          "- One year of 5m/15m and two years of 1H/4H is a limited sample containing a small number of regimes.",
          "- Sharpe/Sortino are computed on daily mark-to-market equity, annualised with sqrt(365).",
          f"- Research runs {'IGNORE' if settings.backtest.research_ignore_drawdown_kill else 'APPLY'} the "
          f"{settings.risk.max_drawdown_kill:.0%} drawdown kill switch so the full sample is measured; any row with "
          f"max drawdown beyond that would have been halted live/paper.", ""]
    return "\n".join(L)


def _fmt_corr(v) -> str:
    return "–" if v is None or pd.isna(v) else f"{v:.2f}"


__all__ = ["run_research", "load_symbol_data", "compute_metrics"]
