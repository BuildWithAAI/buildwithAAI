"""Diagnostic: OOS default-param results with real costs vs zero fees/slippage.

Separates "no gross edge" from "edge eaten by costs". Appends a section to reports/latest/report.{md,html}.
Usage: .venv/bin/python scripts/cost_diagnostic.py
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from perps.config import load_settings
from perps.evaluation.report import md_to_html
from perps.evaluation.research import load_symbol_data
from perps.evaluation.walkforward import run_split, split_time

GRID = [("range_breakout", ["5m", "15m"]), ("ema_pullback", ["1H", "4H"]), ("vol_squeeze", ["15m", "1H", "4H"])]


def main() -> None:
    base = load_settings()
    rows = []
    for strat, tfs in GRID:
        for tf in tfs:
            for sym in base.universe.base:
                rec: dict = {"strategy": strat, "tf": tf, "pair": sym.split("-")[0]}
                for label in ("with_costs", "zero_cost"):
                    s = load_settings()
                    s.risk.max_drawdown_kill = 1.0
                    if label == "zero_cost":
                        s.fees["blofin"].maker = s.fees["blofin"].taker = 0.0
                        s.slippage.market_bps = s.slippage.stop_bps = 0.0
                    d = [load_symbol_data(s, "blofin", sym, tf)]
                    r = run_split(s, strat, tf, s.strategies[strat]["params"], d, split_time(d, s.backtest.is_fraction),
                                  "blofin")
                    t = r.oos_result.trades
                    rec[f"oos_E[R]_{label}"] = round(r.oos_metrics.get("expectancy_r", np.nan), 3)
                    rec[f"oos_ret_{label}"] = f"{r.oos_metrics['net_return']:.1%}"
                    if label == "with_costs" and len(t):
                        rec["fees_per_trade_R"] = round(float((t.fees / t.risk_amount).mean()), 3)
                        rec["median_stop_%"] = round(float((abs(t.entry_price - t.initial_stop) / t.entry_price).median() * 100), 3)
                rows.append(rec)
    df = pd.DataFrame(rows)
    out = base.reports_dir / "latest"
    df.to_csv(out / "cost_diagnostic_oos.csv", index=False)
    cols = list(df.columns)
    md = ["", "## 9. Cost diagnostic (OOS, default params): real costs vs zero fees/slippage", "",
          "If the zero-cost E[R] is ~0 the signal has no gross edge; if it is clearly positive but turns negative "
          "with costs, the edge is being eaten by fees and slippage (typical for short timeframes with tight stops).", "",
          "| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
    md += ["| " + " | ".join(str(v) for v in r) + " |" for r in df.itertuples(index=False)]
    rep = out / "report.md"
    text = rep.read_text().split("\n## 9. Cost diagnostic")[0].rstrip() + "\n" + "\n".join(md) + "\n"
    rep.write_text(text)
    (out / "report.html").write_text(md_to_html(text, "perps research report"))
    print(df.to_string(index=False))


if __name__ == "__main__":
    main()
