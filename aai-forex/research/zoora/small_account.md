# Zoora on a $100 account (EMA 200/800, retail 0.01-lot minimum)

Generated 2026-11-03 07:26 CST by `scripts/zoora_small_account.py`; raw output in `small_account.json`. Every number below is read from that file.

## Setup and assumptions

* Variants trend / pullback / cross, EMA 200/800 only, AUDUSD and XAUUSD, Dukascopy H1/H4/D1 (2008-01 → 2026-10-30) plus the yfinance long D1 cross-check. Same costs and warm-up as `results.md` (`configs/zoora.yaml`), trading starts after the 1843-bar EMA-800 warm-up.
* Start equity **$100**, compounding (sizing uses current equity). Min lot 0.01, step 0.01: AUDUSD 0.01 = 1,000 units (~$0.10/pip); XAUUSD 0.01 = 1 oz ($1 per $1 move).
* Risk per trade is measured as 0.01-lot (or sized) loss at the stop **plus round-trip spread/slippage**; commission ($0.07 round trip per 0.01 lot) is charged in P&L but not in the sizing distance.
* **Assumed (not broker-confirmed): leverage 1:100.0, stop-out at margin level 50.0%.** Margin = lots × contract × price / 100.0, valued at the bar open. An entry needs free margin ≥ required margin. Stop-out is checked intrabar at the adverse extreme (also on the entry bar); whichever of stop-out level or strategy stop is nearer fires. Gaps fill at the bar open, so equity can still go below zero (most retail brokers apply negative-balance protection; that is not modelled).
* The 4% daily loss limit stays on; the drawdown kill switch is off (research mode), as in `results.md`.
* **Mode A (strict)**: production RiskManager with the risk cap at 1%, 2% or 3%; a signal whose 0.01-lot risk exceeds the cap is skipped.
* **Mode B (min-lot)**: size at 1%, but if that rounds below 0.01 lot, trade 0.01 anyway. This deliberately bypasses the 3% hard cap and the open/correlated-risk caps — **the production RiskManager and the agent-guard live check would refuse these orders.** It exists only to show what a 'just trade the minimum' account would have done.
* 'Skipped' counts sized entry signals. Trend and cross emit one signal per regime change; pullback re-signals on each qualifying bar, so its skip counts are bar-attempts, not distinct setups.
* 'Dead' = first date equity fell below the margin for one 0.01 lot (no further trade possible).

## Mode A — strict (skip if 0.01 lot > cap)

| Src | TF | Symbol | Variant | 1%: trades / skipped | 2%: trades / skipped · final | 3%: trades / skipped · final · maxDD |
|---|---|---|---|---|---|---|
| Duka | H1 | AUDUSD | cross | 0 / 173 | 4 / 169 · $92.77 | 19 / 154 · $73.04 · 46.8% |
| Duka | H1 | AUDUSD | pullback | 0 / 7184 | 135 / 6569 · $79.60 | 229 / 6176 · $52.42 · 56.3% |
| Duka | H1 | AUDUSD | trend | 0 / 1135 | 4 / 1131 · $92.77 | 42 / 1091 · $70.71 · 34.1% |
| Duka | H1 | XAUUSD | cross | 0 / 164 | 0 / 164 | 0 / 164 |
| Duka | H1 | XAUUSD | pullback | 0 / 6443 | 0 / 6443 | 1 / 6442 · $97.20 · 2.8% |
| Duka | H1 | XAUUSD | trend | 0 / 1059 | 0 / 1059 | 0 / 1059 |
| Duka | H4 | AUDUSD | cross | 0 / 40 | 0 / 40 | 0 / 40 |
| Duka | H4 | AUDUSD | pullback | 0 / 1702 | 0 / 1702 | 3 / 1690 · $99.46 · 9.1% |
| Duka | H4 | AUDUSD | trend | 0 / 306 | 0 / 306 | 0 / 306 |
| Duka | H4 | XAUUSD | cross | 0 / 39 | 0 / 39 | 0 / 39 |
| Duka | H4 | XAUUSD | pullback | 0 / 1657 | 0 / 1657 | 0 / 1657 |
| Duka | H4 | XAUUSD | trend | 0 / 247 | 0 / 247 | 0 / 247 |
| Duka | D1 | AUDUSD | cross | 0 / 3 | 0 / 3 | 0 / 3 |
| Duka | D1 | AUDUSD | pullback | 0 / 207 | 0 / 207 | 0 / 207 |
| Duka | D1 | AUDUSD | trend | 0 / 33 | 0 / 33 | 0 / 33 |
| Duka | D1 | XAUUSD | cross | 0 / 5 | 0 / 5 | 0 / 5 |
| Duka | D1 | XAUUSD | pullback | 0 / 169 | 0 / 169 | 0 / 169 |
| Duka | D1 | XAUUSD | trend | 0 / 26 | 0 / 26 | 0 / 26 |
| yf | D1 | AUDUSD | cross | 0 / 4 | 0 / 4 | 0 / 4 |
| yf | D1 | AUDUSD | pullback | 0 / 203 | 0 / 203 | 0 / 203 |
| yf | D1 | AUDUSD | trend | 0 / 35 | 0 / 35 | 0 / 35 |
| yf | D1 | XAUUSD | cross | 0 / 6 | 0 / 6 | 0 / 6 |
| yf | D1 | XAUUSD | pullback | 0 / 207 | 0 / 207 | 0 / 207 |
| yf | D1 | XAUUSD | trend | 0 / 30 | 0 / 30 | 0 / 30 |

## Mode B — always at least 0.01 lot

| Src | TF | Symbol | Variant | Trades (forced 0.01) | Margin skips | Final $ | Peak $ (date) | Max DD % | Risk/trade % med / p90 / max | Stop-outs (first) | Dead (date) | Equity ≤ 0 | Swap $ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Duka | H1 | AUDUSD | cross | 173 (127) | 0 | 309.56 | 594.93 (2010-05-25) | 52.5 | 1.2 / 1.9 / 7.0 | 0 (–) | – | – | -88.58 |
| Duka | H1 | AUDUSD | pullback | 236 (236) | 5874 | 5.11 | 195.19 (2009-11-18) | 97.4 | 4.7 / 13.9 / 66.7 | 1 (2011-11-04) | 2011-11-04 | – | -9.13 |
| Duka | H1 | AUDUSD | trend | 789 (789) | 238 | 4.74 | 325.65 (2010-11-05) | 98.5 | 3.2 / 9.5 / 48.6 | 0 (–) | 2023-06-23 | – | -95.70 |
| Duka | H1 | XAUUSD | cross | 8 (8) | 153 | 4.28 | 236.05 (2008-09-11) | 98.2 | 26.6 / 87.5 / 155.4 | 1 (2009-03-18) | 2009-03-18 | – | -7.00 |
| Duka | H1 | XAUUSD | pullback | 61 (61) | 6112 | 4.44 | 158.94 (2008-07-22) | 97.2 | 12.6 / 27.2 / 80.2 | 1 (2009-04-01) | 2009-04-01 | – | -4.74 |
| Duka | H1 | XAUUSD | trend | 224 (224) | 757 | 8.53 | 446.74 (2011-09-06) | 98.1 | 9.7 / 24.6 / 88.3 | 0 (–) | 2013-09-18 | – | -137.00 |
| Duka | H4 | AUDUSD | cross | 15 (15) | 24 | 3.61 | 301.47 (2009-11-16) | 98.8 | 16.9 / 43.9 / 105.2 | 1 (2016-06-16) | 2016-06-16 | – | -21.62 |
| Duka | H4 | AUDUSD | pullback | 347 (347) | 0 | 105.14 | 264.53 (2015-11-18) | 72.2 | 4.3 / 7.2 / 13.5 | 0 (–) | – | – | -44.74 |
| Duka | H4 | AUDUSD | trend | 199 (199) | 80 | 4.10 | 347.48 (2011-07-27) | 98.8 | 12.2 / 27.3 / 241.5 | 0 (–) | 2023-02-17 | – | -95.20 |
| Duka | H4 | XAUUSD | cross | 3 (3) | 36 | 8.01 | 118.63 (2011-12-29) | 93.3 | 46.2 / 86.5 / 96.6 | 1 (2012-04-10) | 2012-04-06 | – | -7.60 |
| Duka | H4 | XAUUSD | pullback | 8 (8) | 1615 | 7.29 | 112.87 (2009-03-06) | 93.5 | 38.7 / 64.5 / 71.5 | 0 (–) | 2009-07-02 | – | -5.31 |
| Duka | H4 | XAUUSD | trend | 172 (172) | 56 | 13.42 | 766.80 (2020-08-07) | 98.2 | 7.2 / 23.0 / 100.7 | 0 (–) | 2022-02-02 | – | -461.51 |
| Duka | D1 | AUDUSD | cross | 3 (3) | 0 | 23.62 | 119.56 (2021-02-25) | 80.2 | 40.5 / 43.7 / 44.5 | 0 (–) | – | – | -4.00 |
| Duka | D1 | AUDUSD | pullback | 6 (6) | 183 | 3.66 | 116.88 (2016-05-25) | 96.9 | 35.9 / 97.3 / 134.6 | 1 (2017-04-13) | 2017-04-11 | – | -2.89 |
| Duka | D1 | AUDUSD | trend | 23 (23) | 10 | 3.38 | 246.27 (2020-03-20) | 98.6 | 30.2 / 54.2 / 197.5 | 1 (2022-05-23) | 2022-05-24 | – | -25.33 |
| Duka | D1 | XAUUSD | cross | 2 (2) | 3 | 5.83 | 100.69 (2016-12-16) | 94.2 | 82.8 / 110.9 / 117.9 | 1 (2017-02-02) | 2017-01-18 | – | -6.61 |
| Duka | D1 | XAUUSD | pullback | 30 (30) | 10 | 20.50 | 767.74 (2026-04-15) | 97.3 | 17.1 / 41.0 / 106.6 | 1 (2026-06-10) | 2026-06-11 | – | -229.41 |
| Duka | D1 | XAUUSD | trend | 5 (5) | 21 | 6.03 | 102.89 (2016-03-16) | 94.1 | 104.0 / 229.7 / 255.2 | 1 (2016-04-21) | 2016-04-22 | – | -0.95 |
| yf | D1 | AUDUSD | cross | 3 (3) | 1 | 3.48 | 100.00 (2013-08-07) | 96.5 | 56.2 / 115.2 / 130.0 | 1 (2022-06-02) | 2022-06-03 | – | -6.32 |
| yf | D1 | AUDUSD | pullback | 12 (12) | 155 | 4.49 | 123.94 (2014-03-28) | 96.4 | 19.7 / 39.1 / 78.1 | 0 (–) | 2017-06-15 | – | -6.11 |
| yf | D1 | AUDUSD | trend | 15 (15) | 20 | 4.52 | 212.61 (2020-03-21) | 97.9 | 42.9 / 71.7 / 86.9 | 0 (–) | 2021-06-19 | – | -25.51 |
| yf | D1 | XAUUSD | cross | 4 (4) | 0 | -3.23 | 397.14 (2015-12-18) | 100.8 | 66.3 / 104.3 / 120.1 | 1 (2017-09-18) | 2017-09-14 | 2017-09-19 | -45.40 |
| yf | D1 | XAUUSD | pullback | 3 (3) | 200 | 3.93 | 105.77 (2008-09-23) | 96.3 | 82.8 / 133.1 / 145.7 | 1 (2008-10-16) | 2008-10-17 | – | -3.24 |
| yf | D1 | XAUUSD | trend | 24 (24) | 6 | 6.24 | 1,083.65 (2011-08-23) | 99.4 | 19.3 / 71.8 / 186.7 | 1 (2019-02-28) | 2019-02-28 | – | -383.25 |

## Minimum starting balance for 0.01 lot to fit the risk cap

Balance = (0.01-lot loss at stop incl. round-trip spread/slippage) ÷ cap, using the stop distribution of all entry signals in the min-lot run. 'p90' = balance needed so that 90% of signals fit. Margin column = median margin for 0.01 lot at 1:100.

| Src | TF | Symbol | Variant | 0.01-lot risk $ med / p90 | ≤1% med / p90 | ≤2% med / p90 | ≤3% med / p90 | Margin $ |
|---|---|---|---|---|---|---|---|---|
| Duka | H1 | AUDUSD | cross | 4.34 / 7.89 | $434 / $789 | $217 / $394 | $145 / $263 | 7.49 |
| Duka | H1 | AUDUSD | pullback | 2.77 / 4.57 | $277 / $457 | $139 / $229 | $92 / $152 | 7.35 |
| Duka | H1 | AUDUSD | trend | 4.37 / 8.07 | $437 / $807 | $219 / $404 | $146 / $269 | 7.46 |
| Duka | H1 | XAUUSD | cross | 10.88 / 20.39 | $1,088 / $2,039 | $544 / $1,020 | $363 / $680 | 13.37 |
| Duka | H1 | XAUUSD | pullback | 8.04 / 16.71 | $804 / $1,671 | $402 / $835 | $268 / $557 | 15.12 |
| Duka | H1 | XAUUSD | trend | 11.85 / 25.33 | $1,185 / $2,533 | $593 / $1,267 | $395 / $844 | 14.88 |
| Duka | H4 | AUDUSD | cross | 8.77 / 12.61 | $877 / $1,261 | $438 / $630 | $292 / $420 | 7.44 |
| Duka | H4 | AUDUSD | pullback | 6.19 / 10.27 | $619 / $1,027 | $310 / $514 | $206 / $342 | 7.45 |
| Duka | H4 | AUDUSD | trend | 8.84 / 17.46 | $884 / $1,746 | $442 / $873 | $295 / $582 | 7.33 |
| Duka | H4 | XAUUSD | cross | 21.21 / 38.38 | $2,121 / $3,838 | $1,060 / $1,919 | $707 / $1,279 | 16.52 |
| Duka | H4 | XAUUSD | pullback | 16.00 / 35.93 | $1,600 / $3,593 | $800 / $1,797 | $533 / $1,198 | 15.19 |
| Duka | H4 | XAUUSD | trend | 22.57 / 99.62 | $2,257 / $9,962 | $1,129 / $4,981 | $752 / $3,321 | 16.29 |
| Duka | D1 | AUDUSD | cross | 22.45 / 29.02 | $2,245 / $2,902 | $1,122 / $1,451 | $748 / $967 | 7.04 |
| Duka | D1 | AUDUSD | pullback | 12.33 / 17.62 | $1,233 / $1,762 | $616 / $881 | $411 / $587 | 6.78 |
| Duka | D1 | AUDUSD | trend | 20.15 / 24.59 | $2,015 / $2,459 | $1,008 / $1,229 | $672 / $820 | 7.30 |
| Duka | D1 | XAUUSD | cross | 42.10 / 52.99 | $4,210 / $5,299 | $2,105 / $2,650 | $1,403 / $1,766 | 13.28 |
| Duka | D1 | XAUUSD | pullback | 46.78 / 210.65 | $4,678 / $21,065 | $2,339 / $10,533 | $1,559 / $7,022 | 18.06 |
| Duka | D1 | XAUUSD | trend | 44.93 / 75.63 | $4,493 / $7,563 | $2,247 / $3,781 | $1,498 / $2,521 | 12.46 |
| yf | D1 | AUDUSD | cross | 32.03 / 39.62 | $3,203 / $3,962 | $1,601 / $1,981 | $1,068 / $1,321 | 7.44 |
| yf | D1 | AUDUSD | pullback | 14.07 / 20.65 | $1,407 / $2,065 | $704 / $1,033 | $469 / $688 | 6.76 |
| yf | D1 | AUDUSD | trend | 22.39 / 30.35 | $2,239 / $3,035 | $1,120 / $1,517 | $746 / $1,012 | 7.32 |
| yf | D1 | XAUUSD | cross | 37.26 / 57.00 | $3,726 / $5,700 | $1,863 / $2,850 | $1,242 / $1,900 | 13.22 |
| yf | D1 | XAUUSD | pullback | 43.85 / 66.53 | $4,385 / $6,653 | $2,193 / $3,326 | $1,462 / $2,218 | 16.67 |
| yf | D1 | XAUUSD | trend | 48.36 / 80.58 | $4,836 / $8,058 | $2,418 / $4,029 | $1,612 / $2,686 | 12.48 |

## Takeaways

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

