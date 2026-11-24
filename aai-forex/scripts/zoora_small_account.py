"""Run the $100 small-account Zoora grid and render research/zoora/small_account.md.

Usage:  python scripts/zoora_small_account.py            # run grid + render
        python scripts/zoora_small_account.py --render   # re-render from existing JSON
All numbers in the markdown are read from research/zoora/small_account.json.
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Any

from aai_fx.research.small_account import (LEVERAGE, STOP_OUT_PCT, min_balance_table,
                                           run_small_account)

ROOT = Path(__file__).resolve().parents[1]
OUT_JSON = ROOT / "research/zoora/small_account.json"
OUT_MD = ROOT / "research/zoora/small_account.md"
SRC = {"dukascopy": "Duka", "yfinance_long": "yf"}


def f(x: Any, n: int = 1, pre: str = "") -> str:
    return "–" if x is None else f"{pre}{x:,.{n}f}"


def d(x: Any) -> str:
    return "–" if not x else str(x)[:10]


def render(data: dict[str, Any]) -> str:
    res = data["results"]
    key = lambda r: (list(SRC).index(r["source"]), ["H1", "H4", "D1"].index(r["tf"]),  # noqa: E731
                     r["symbol"], r["variant"])
    L: list[str] = []
    a = L.append
    a("# Zoora on a $100 account (EMA 200/800, retail 0.01-lot minimum)\n")
    a(f"Generated {data.get('generated_at', '?')} by `scripts/zoora_small_account.py`; raw output in "
      "`small_account.json`. Every number below is read from that file.\n")
    a("## Setup and assumptions\n")
    a("* Variants trend / pullback / cross, EMA 200/800 only, AUDUSD and XAUUSD, Dukascopy H1/H4/D1 "
      "(2008-01 → 2026-10-30) plus the yfinance long D1 cross-check. Same costs and warm-up as "
      "`results.md` (`configs/zoora.yaml`), trading starts after the 1843-bar EMA-800 warm-up.")
    a("* Start equity **$100**, compounding (sizing uses current equity). Min lot 0.01, step 0.01: "
      "AUDUSD 0.01 = 1,000 units (~$0.10/pip); XAUUSD 0.01 = 1 oz ($1 per $1 move).")
    a("* Risk per trade is measured as 0.01-lot (or sized) loss at the stop **plus round-trip spread/"
      "slippage**; commission ($0.07 round trip per 0.01 lot) is charged in P&L but not in the sizing distance.")
    a(f"* **Assumed (not broker-confirmed): leverage 1:{LEVERAGE}, stop-out at margin level "
      f"{STOP_OUT_PCT}%.** Margin = lots × contract × price / {LEVERAGE}, valued at the bar open. "
      "An entry needs free margin ≥ required margin. Stop-out is checked intrabar at the adverse "
      "extreme (also on the entry bar); whichever of stop-out level or strategy stop is nearer fires. "
      "Gaps fill at the bar open, so equity can still go below zero (most retail brokers apply "
      "negative-balance protection; that is not modelled).")
    a("* The 4% daily loss limit stays on; the drawdown kill switch is off (research mode), as in `results.md`.")
    a("* **Mode A (strict)**: production RiskManager with the risk cap at 1%, 2% or 3%; a signal "
      "whose 0.01-lot risk exceeds the cap is skipped.")
    a("* **Mode B (min-lot)**: size at 1%, but if that rounds below 0.01 lot, trade 0.01 anyway. "
      "This deliberately bypasses the 3% hard cap and the open/correlated-risk caps — **the "
      "production RiskManager and the agent-guard live check would refuse these orders.** It "
      "exists only to show what a 'just trade the minimum' account would have done.")
    a("* 'Skipped' counts sized entry signals. Trend and cross emit one signal per regime change; "
      "pullback re-signals on each qualifying bar, so its skip counts are bar-attempts, not distinct setups.")
    a("* 'Dead' = first date equity fell below the margin for one 0.01 lot (no further trade possible).\n")

    a("## Mode A — strict (skip if 0.01 lot > cap)\n")
    a("| Src | TF | Symbol | Variant | 1%: trades / skipped | 2%: trades / skipped · final | "
      "3%: trades / skipped · final · maxDD |")
    a("|---|---|---|---|---|---|---|")
    strict = {(r["source"], r["tf"], r["symbol"], r["variant"], r["cap_pct"]): r
              for r in res if r["mode"] == "strict"}
    for r in sorted([r for r in res if r["mode"] == "minlot"], key=key):
        k = (r["source"], r["tf"], r["symbol"], r["variant"])
        s1, s2, s3 = (strict[k + (c,)] for c in (1.0, 2.0, 3.0))
        c2 = f"{s2['trades']} / {s2['skipped_minlot']}" + (
            f" · ${s2['final_equity']:.2f}" if s2["trades"] else "")
        c3 = f"{s3['trades']} / {s3['skipped_minlot']}" + (
            f" · ${s3['final_equity']:.2f} · {f(s3['max_drawdown_pct'])}%" if s3["trades"] else "")
        a(f"| {SRC[r['source']]} | {r['tf']} | {r['symbol']} | {r['variant'][6:]} | "
          f"{s1['trades']} / {s1['skipped_minlot']} | {c2} | {c3} |")
    a("")
    a("## Mode B — always at least 0.01 lot\n")
    a("| Src | TF | Symbol | Variant | Trades (forced 0.01) | Margin skips | Final $ | Peak $ (date) | "
      "Max DD % | Risk/trade % med / p90 / max | Stop-outs (first) | Dead (date) | Equity ≤ 0 | Swap $ |")
    a("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for r in sorted([r for r in res if r["mode"] == "minlot"], key=key):
        a(f"| {SRC[r['source']]} | {r['tf']} | {r['symbol']} | {r['variant'][6:]} | "
          f"{r['trades']} ({r['forced_min_lot_trades']}) | {r['skipped_margin']} | "
          f"{f(r['final_equity'], 2)} | {f(r['peak_equity'], 2)} ({d(r['peak_ts'])}) | "
          f"{f(r['max_drawdown_pct'])} | {f(r['risk_pct_median'])} / {f(r['risk_pct_p90'])} / "
          f"{f(r['risk_pct_max'])} | {r['stop_outs']} ({d(r['stop_out_dates'][0] if r['stop_out_dates'] else None)}) | "
          f"{d(r['first_below_minlot_margin_ts'])} | {d(r['first_equity_le_0_ts'])} | "
          f"{f(r['total_swap'], 2)} |")
    a("")
    a("## Minimum starting balance for 0.01 lot to fit the risk cap\n")
    a("Balance = (0.01-lot loss at stop incl. round-trip spread/slippage) ÷ cap, using the stop "
      "distribution of all entry signals in the min-lot run. 'p90' = balance needed so that 90% of "
      "signals fit. Margin column = median margin for 0.01 lot at 1:100.\n")
    a("| Src | TF | Symbol | Variant | 0.01-lot risk $ med / p90 | ≤1% med / p90 | ≤2% med / p90 | "
      "≤3% med / p90 | Margin $ |")
    a("|---|---|---|---|---|---|---|---|---|")
    for m in sorted(data["min_balance"], key=key):
        a(f"| {SRC[m['source']]} | {m['tf']} | {m['symbol']} | {m['variant'][6:]} | "
          f"{f(m['minlot_risk_median_usd'], 2)} / {f(m['minlot_risk_p90_usd'], 2)} | "
          + " | ".join(f"{f(m[f'bal_{c}pct_median'], 0, '$')} / {f(m[f'bal_{c}pct_p90'], 0, '$')}"
                       for c in (1, 2, 3))
          + f" | {f(m['minlot_margin_median_usd'], 2)} |")
    a("")
    a(TAKEAWAYS)
    return "\n".join(L) + "\n"


TAKEAWAYS = """## Takeaways

1. **At a true 1% risk, $100 cannot trade Zoora at all.** Strict 1% skipped every signal on both
   symbols, every timeframe and both data sources. At 2% only AUDUSD H1 traded (4–135 trades); at 3%
   gold took one trade in total (H1 pullback) and AUDUSD H4 pullback three. Every strict run that
   traded ended below $100 ($52.42–$99.46).
2. **Forcing 0.01 lot turns a 1%-risk system into a gamble.** Median actual risk stayed at 1–5% only
   for AUDUSD H1 (all variants) and AUDUSD H4 pullback; gold medians ran 7.2–104%, and many single
   trades risked more than the whole account. 22 of 24 min-lot runs ended under $25, 21 became unable
   to open even 0.01 lot before the data ends, and one (yfinance gold D1 cross) went below zero
   (−$3.23) on a gap through the stop-out level.
3. **Swap alone sinks small gold accounts.** Holding 1 oz through the long trends cost −$137 to
   −$462 of swap in the gold trend runs (about −$95 in the AUDUSD H1/H4 trend runs) — more than
   the $100 starting balance; the gold H4 trend run peaked at $766.80 (2020-08-07) and still
   ended at $13.42.
4. **The two survivors are not evidence of an edge.** AUDUSD H1 cross ($309.56, 127 of 173 trades
   at forced 0.01 lot, median risk 1.2%) and AUDUSD H4 pullback ($105.14) came with 52.5% and 72.2%
   max drawdowns, and both peaked years ago (2010-05 and 2015-11). The $100k study (`results.md`)
   found no robust out-of-sample edge for either.
5. **Realistic minimum balances** (0.01 lot within the cap for 90% of signals): at ≤1%, about
   $460–1,750 for AUDUSD H1/H4, $1,760–3,960 for AUDUSD D1, $1,670–9,960 for gold H1/H4 and
   $5,300–21,100 for gold D1. At ≤3%, about $150–580 for AUDUSD H1/H4 and $560–3,320 for gold H1/H4.
   $100 covers only the *median* AUDUSD H1 pullback stop at 3% ($92).
6. Nothing here changes the execution layer: it is paper/simulated only, `mt5_adapter.py` and the
   agent-guard config are untouched, and both guards would refuse the min-lot mode live.
"""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--render", action="store_true", help="only re-render markdown from JSON")
    ap.add_argument("--workers", type=int, default=7)
    a = ap.parse_args()
    if not a.render:
        res = run_small_account(str(ROOT / "configs/zoora.yaml"), ROOT,
                                {"dukascopy": ["H1", "H4", "D1"], "yfinance_long": ["D1"]},
                                ["AUDUSD", "XAUUSD"], 100.0, a.workers)
        OUT_JSON.write_text(json.dumps({"generated_at": time.strftime("%Y-%m-%d %H:%M %Z"),
                                        "results": res, "min_balance": min_balance_table(res)},
                                       indent=1, default=float))
    OUT_MD.write_text(render(json.loads(OUT_JSON.read_text())))
    print(f"wrote {OUT_MD}")


if __name__ == "__main__":
    main()
