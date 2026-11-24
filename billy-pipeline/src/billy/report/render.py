"""Markdown report + PNG charts from backtest artifacts (reports/artifacts/*). Numbers are read
from the artifacts produced by `billy backtest`; nothing is typed in by hand."""
from __future__ import annotations

import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402


def _fmt(v) -> str:
    if v is None:
        return "—"
    if isinstance(v, float):
        return f"{v:,.2f}"
    return str(v)


def _table(rows: dict[str, dict], cols: list[str]) -> list[str]:
    out = ["| | " + " | ".join(cols) + " |", "|---" * (len(cols) + 1) + "|"]
    for k, m in rows.items():
        out.append(f"| {k} | " + " | ".join(_fmt(m.get(c)) for c in cols) + " |")
    return out


def render_report(reports_dir: Path) -> Path:
    art = Path(reports_dir) / "artifacts"
    m = json.loads((art / "metrics.json").read_text())
    eq = pd.read_csv(art / "equity.csv", index_col=0, parse_dates=True)
    reports_dir = Path(reports_dir)

    fig, (a1, a2) = plt.subplots(2, 1, figsize=(11, 7), sharex=True, gridspec_kw={"height_ratios": [3, 1]})
    a1.plot(eq.index, eq["strategy"], label="Strategy (default params)", lw=1.4)
    if "bh_basket" in eq:
        a1.plot(eq.index, eq["bh_basket"], label="Buy & hold EW basket", lw=1, alpha=0.8)
    if "bh_BTC" in eq:
        a1.plot(eq.index, eq["bh_BTC"], label="Buy & hold BTC", lw=1, alpha=0.6)
    split = pd.Timestamp(m["validation"]["split_ts"])
    a1.axvline(split, color="k", ls="--", lw=0.8)
    a1.text(split, a1.get_ylim()[1], " OOS →", va="top", fontsize=8)
    a1.set_ylabel("Equity ($)")
    a1.legend(loc="best", fontsize=8)
    a1.set_title("Billy signal backtest — 1h event-driven, fees+slippage, real Binance data")
    dd = (eq["strategy"] / eq["strategy"].cummax() - 1) * 100
    a2.fill_between(dd.index, dd, 0, color="tab:red", alpha=0.4)
    a2.set_ylabel("Drawdown %")
    fig.tight_layout()
    png = reports_dir / "equity_curve.png"
    fig.savefig(png, dpi=120)
    plt.close(fig)

    v = m["validation"]
    full = m["full"]
    cols = ["trades", "win_rate_pct", "avg_r", "avg_r_ex_fees", "expectancy_usd", "profit_factor", "return_pct", "max_dd_pct",
            "sharpe", "sortino", "fees_usd"]
    L = ["# Billy (@cryptoWZRD_) signal backtest report", "",
         f"Generated {m['generated_at']} · data {full['start']} → {full['end']} · start equity "
         f"${full['start_equity']:,.0f} · fees {m['costs']['fee_bps']} bps + slippage {m['costs']['slippage_bps']} bps per fill.",
         "", "![equity](equity_curve.png)", "", "## Headline", ""]
    L += _table({"Full period": full, "In-sample": v["is_metrics"], "Out-of-sample": v["oos_metrics"],
                 "Walk-forward OOS (re-optimised)": v.get("wf_oos_metrics") or {}}, cols)
    L += ["", f"In-sample/out-of-sample split at {v['split_ts']} ({int((1 - m['oos_fraction']) * 100)}/"
          f"{int(m['oos_fraction'] * 100)} by time).", "", "### Buy-and-hold baseline (same window)", ""]
    L += _table(m["buy_and_hold"], ["return_pct", "max_dd_pct", "sharpe"])
    L += ["", "## Overfitting checks", ""]
    L += [f"- {f}" for f in v["flags"]]
    L += [f"- Spearman rank correlation of avg R across the {len(v['grid'])}-config grid, IS vs OOS: "
          f"{_fmt(v['grid_rank_corr'])}",
          f"- Best in-sample config: `{v['best_is_key']}` → OOS avg R {_fmt((v.get('best_is_oos') or {}).get('oos_avg_r'))}",
          "", "### Walk-forward folds", "",
          "| Train | Test | Chosen params | Train avg R | Test trades | Test avg R | Test return % |",
          "|---|---|---|---|---|---|---|"]
    for f in v["walk_forward"]:
        L.append(f"| {f['train']} | {f['test']} | `{f['chosen']}` | {_fmt(f['train_avg_r'])} | "
                 f"{f['test_trades']} | {_fmt(f['test_avg_r'])} | {_fmt(f['test_return_pct'])} |")
    L += ["", "### Parameter grid (sorted by in-sample avg R)", "",
          "| Params | IS trades | IS avg R | IS ret % | OOS trades | OOS avg R | OOS ret % |", "|---|---|---|---|---|---|---|"]
    for g in sorted(v["grid"], key=lambda r: -(r["is_avg_r"] if r["is_avg_r"] is not None else -99)):
        L.append(f"| `{g['key']}` | {g['is_trades']} | {_fmt(g['is_avg_r'])} | {_fmt(g['is_return_pct'])} | "
                 f"{g['oos_trades']} | {_fmt(g['oos_avg_r'])} | {_fmt(g['oos_return_pct'])} |")
    bcols = ["trades", "win_rate_pct", "avg_r", "avg_r_ex_fees", "profit_factor", "total_pnl_usd"]
    for title, key in [("Per rule", "by_rule"), ("Per asset", "by_asset"), ("Per risk tier", "by_tier"),
                       ("Per side", "by_side"), ("Per close label", "by_close_label"), ("Exit reasons", "by_exit")]:
        L += ["", f"## {title}", ""] + _table(m[key], bcols)
    L += ["", "## Pipeline funnel", "",
          f"- Posts in store: {m['funnel']['posts']} · crypto outlooks parsed: {m['funnel']['outlooks']} · "
          f"actionable: {m['funnel']['actionable']} · setups after filters: {m['funnel']['setups']} · trades: {full['trades']}",
          f"- Setup filter rejections: {json.dumps(m['funnel']['setup_rejections'])}",
          f"- Engine rejections: {json.dumps(m['funnel']['engine_rejections'])}",
          f"- Kill-switch days: {m['funnel']['killed_days'] or 'none'}",
          "", "## Data quality", ""]
    for k, g in m["data_quality"].items():
        L.append(f"- {k}: {g['rows']} bars {g['first']} → {g['last']}, gaps {g['gaps']} ({g['missing_bars']} missing bars)")
    L += ["", "## Caveats", ""] + [f"- {c}" for c in m["caveats"]]
    md = reports_dir / "backtest_report.md"
    md.write_text("\n".join(L) + "\n")
    return md
