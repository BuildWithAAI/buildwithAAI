# Billy (@cryptoWZRD_) signal backtest report

Generated 2026-11-01T23:37:14+00:00 · data 2026-05-01 00:00:00+00:00 → 2026-11-01 22:00:00+00:00 · start equity $10,000 · fees 10.0 bps + slippage 5.0 bps per fill.

![equity](equity_curve.png)

## Headline

| | trades | win_rate_pct | avg_r | avg_r_ex_fees | expectancy_usd | profit_factor | return_pct | max_dd_pct | sharpe | sortino | fees_usd |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Full period | 195 | 44.10 | -0.37 | -0.11 | -20.03 | 0.54 | -39.05 | -39.62 | -4.93 | -5.82 | 2,804.15 |
| In-sample | 134 | 44.00 | -0.38 | -0.12 | -20.65 | 0.55 | -27.68 | -27.68 | -4.68 | -5.73 | 2,029.76 |
| Out-of-sample | 61 | 44.30 | -0.36 | -0.09 | -25.78 | 0.51 | -15.73 | -19.00 | -5.42 | -6.05 | 1,070.73 |
| Walk-forward OOS (re-optimised) | 101 | 58.40 | -0.26 | -0.07 | -19.81 | 0.56 | -20.00 | -21.77 | -3.64 | -4.26 | 1,476.81 |

In-sample/out-of-sample split at 2026-09-07T10:36:00+00:00 (70/30 by time).

### Buy-and-hold baseline (same window)

| | return_pct | max_dd_pct | sharpe |
|---|---|---|---|
| BTC | 1.79 | -29.36 | 0.15 |
| ETH | 0.00 | -36.90 | 0.19 |
| XRP | -9.02 | -35.51 | -0.08 |
| LTC | -0.09 | -34.73 | 0.24 |
| LINK | 24.06 | -35.08 | 0.99 |
| EW_basket | 3.35 | -32.97 | 0.33 |

## Overfitting checks

- 0/48 grid configs have positive in-sample avg R
- Spearman rank correlation of avg R across the 48-config grid, IS vs OOS: 0.44
- Best in-sample config: `n_hold=3,stop_mode=close_back,stop_atr_mult=1.0,scenario_strength=directional,require_bias_alignment=False` → OOS avg R -0.20

### Walk-forward folds

| Train | Test | Chosen params | Train avg R | Test trades | Test avg R | Test return % |
|---|---|---|---|---|---|---|
| 2026-05-01..2026-06-30 | 2026-06-30..2026-07-30 | `n_hold=3,stop_mode=close_back,stop_atr_mult=0.5,scenario_strength=explicit,require_bias_alignment=True` | 0.17 | 17 | -0.69 | -8.58 |
| 2026-05-31..2026-07-30 | 2026-07-30..2026-08-29 | `n_hold=3,stop_mode=close_back,stop_atr_mult=1.0,scenario_strength=directional,require_bias_alignment=False` | -0.05 | 24 | 0.05 | 0.39 |
| 2026-06-30..2026-08-29 | 2026-08-29..2026-09-28 | `n_hold=1,stop_mode=structural,stop_atr_mult=1.0,scenario_strength=explicit,require_bias_alignment=True` | -0.08 | 18 | -0.01 | 1.65 |
| 2026-07-30..2026-09-28 | 2026-09-28..2026-10-28 | `n_hold=3,stop_mode=structural,stop_atr_mult=1.0,scenario_strength=directional,require_bias_alignment=False` | 0.15 | 37 | -0.43 | -14.53 |
| 2026-08-29..2026-10-28 | 2026-10-28..2026-11-01 | `n_hold=1,stop_mode=close_back,stop_atr_mult=1.0,scenario_strength=directional,require_bias_alignment=True` | -0.03 | 5 | 0.02 | 0.34 |

### Parameter grid (sorted by in-sample avg R)

| Params | IS trades | IS avg R | IS ret % | OOS trades | OOS avg R | OOS ret % |
|---|---|---|---|---|---|---|
| `n_hold=3,stop_mode=close_back,stop_atr_mult=1.0,scenario_strength=directional,require_bias_alignment=False` | 115 | 0.00 | -2.86 | 53 | -0.20 | -10.04 |
| `n_hold=3,stop_mode=close_back,stop_atr_mult=1.0,scenario_strength=directional,require_bias_alignment=True` | 109 | -0.03 | -4.97 | 48 | -0.17 | -8.38 |
| `n_hold=3,stop_mode=structural,stop_atr_mult=1.0,scenario_strength=directional,require_bias_alignment=False` | 122 | -0.03 | -3.04 | 56 | -0.30 | -15.19 |
| `n_hold=1,stop_mode=close_back,stop_atr_mult=1.0,scenario_strength=explicit,require_bias_alignment=True` | 74 | -0.05 | -4.74 | 36 | -0.06 | -2.11 |
| `n_hold=3,stop_mode=structural,stop_atr_mult=1.0,scenario_strength=directional,require_bias_alignment=True` | 114 | -0.06 | -5.19 | 51 | -0.29 | -14.30 |
| `n_hold=1,stop_mode=structural,stop_atr_mult=1.0,scenario_strength=explicit,require_bias_alignment=True` | 76 | -0.08 | -6.31 | 38 | -0.16 | -8.26 |
| `n_hold=3,stop_mode=close_back,stop_atr_mult=1.0,scenario_strength=explicit,require_bias_alignment=False` | 50 | -0.10 | -5.18 | 29 | -0.17 | -3.73 |
| `n_hold=1,stop_mode=close_back,stop_atr_mult=1.0,scenario_strength=explicit,require_bias_alignment=False` | 78 | -0.11 | -8.50 | 39 | -0.10 | -2.75 |
| `n_hold=3,stop_mode=close_back,stop_atr_mult=0.5,scenario_strength=directional,require_bias_alignment=False` | 128 | -0.12 | -7.80 | 61 | -0.32 | -10.38 |
| `n_hold=3,stop_mode=close_back,stop_atr_mult=0.5,scenario_strength=directional,require_bias_alignment=True` | 119 | -0.12 | -8.14 | 54 | -0.28 | -8.92 |
| `n_hold=3,stop_mode=close_back,stop_atr_mult=1.0,scenario_strength=explicit,require_bias_alignment=True` | 48 | -0.14 | -6.44 | 27 | -0.18 | -3.88 |
| `n_hold=3,stop_mode=structural,stop_atr_mult=0.5,scenario_strength=directional,require_bias_alignment=False` | 131 | -0.16 | -8.40 | 63 | -0.23 | -7.77 |
| `n_hold=3,stop_mode=structural,stop_atr_mult=0.5,scenario_strength=directional,require_bias_alignment=True` | 122 | -0.17 | -8.99 | 56 | -0.21 | -7.32 |
| `n_hold=3,stop_mode=structural,stop_atr_mult=1.0,scenario_strength=explicit,require_bias_alignment=False` | 51 | -0.17 | -7.63 | 30 | -0.24 | -8.20 |
| `n_hold=1,stop_mode=structural,stop_atr_mult=1.0,scenario_strength=explicit,require_bias_alignment=False` | 80 | -0.17 | -11.71 | 41 | -0.18 | -8.74 |
| `n_hold=2,stop_mode=close_back,stop_atr_mult=1.0,scenario_strength=directional,require_bias_alignment=False` | 125 | -0.17 | -14.44 | 59 | -0.08 | -1.63 |
| `n_hold=3,stop_mode=structural,stop_atr_mult=1.0,scenario_strength=explicit,require_bias_alignment=True` | 49 | -0.18 | -7.91 | 28 | -0.26 | -8.37 |
| `n_hold=2,stop_mode=close_back,stop_atr_mult=1.0,scenario_strength=directional,require_bias_alignment=True` | 119 | -0.18 | -13.37 | 53 | 0.03 | 3.90 |
| `n_hold=2,stop_mode=structural,stop_atr_mult=1.0,scenario_strength=explicit,require_bias_alignment=True` | 60 | -0.18 | -6.26 | 30 | -0.21 | -10.16 |
| `n_hold=1,stop_mode=close_back,stop_atr_mult=1.0,scenario_strength=directional,require_bias_alignment=True` | 137 | -0.19 | -21.39 | 65 | 0.04 | 1.89 |
| `n_hold=2,stop_mode=structural,stop_atr_mult=1.0,scenario_strength=directional,require_bias_alignment=True` | 126 | -0.19 | -14.56 | 57 | -0.13 | -7.86 |
| `n_hold=1,stop_mode=structural,stop_atr_mult=1.0,scenario_strength=directional,require_bias_alignment=True` | 147 | -0.19 | -23.65 | 68 | -0.17 | -12.32 |
| `n_hold=3,stop_mode=close_back,stop_atr_mult=0.5,scenario_strength=explicit,require_bias_alignment=True` | 50 | -0.20 | -6.33 | 30 | -0.15 | -2.87 |
| `n_hold=1,stop_mode=close_back,stop_atr_mult=0.5,scenario_strength=explicit,require_bias_alignment=True` | 75 | -0.20 | -13.03 | 38 | -0.37 | -13.21 |
| `n_hold=2,stop_mode=close_back,stop_atr_mult=1.0,scenario_strength=explicit,require_bias_alignment=True` | 60 | -0.20 | -6.74 | 28 | -0.05 | -1.61 |
| `n_hold=1,stop_mode=close_back,stop_atr_mult=1.0,scenario_strength=directional,require_bias_alignment=False` | 145 | -0.20 | -23.37 | 70 | 0.03 | 2.93 |
| `n_hold=2,stop_mode=structural,stop_atr_mult=1.0,scenario_strength=directional,require_bias_alignment=False` | 132 | -0.20 | -16.53 | 63 | -0.21 | -12.58 |
| `n_hold=3,stop_mode=close_back,stop_atr_mult=0.5,scenario_strength=explicit,require_bias_alignment=False` | 53 | -0.22 | -7.23 | 32 | -0.15 | -3.24 |
| `n_hold=1,stop_mode=structural,stop_atr_mult=1.0,scenario_strength=directional,require_bias_alignment=False` | 156 | -0.23 | -27.64 | 74 | -0.17 | -11.71 |
| `n_hold=2,stop_mode=close_back,stop_atr_mult=1.0,scenario_strength=explicit,require_bias_alignment=False` | 63 | -0.24 | -9.81 | 30 | -0.04 | -1.55 |
| `n_hold=2,stop_mode=structural,stop_atr_mult=1.0,scenario_strength=explicit,require_bias_alignment=False` | 63 | -0.27 | -11.40 | 32 | -0.20 | -10.08 |
| `n_hold=1,stop_mode=close_back,stop_atr_mult=0.5,scenario_strength=directional,require_bias_alignment=True` | 150 | -0.30 | -28.81 | 70 | -0.44 | -22.30 |
| `n_hold=3,stop_mode=structural,stop_atr_mult=0.5,scenario_strength=explicit,require_bias_alignment=True` | 50 | -0.30 | -6.43 | 31 | -0.15 | -3.35 |
| `n_hold=1,stop_mode=structural,stop_atr_mult=0.5,scenario_strength=explicit,require_bias_alignment=True` | 76 | -0.30 | -13.43 | 40 | -0.28 | -10.08 |
| `n_hold=3,stop_mode=structural,stop_atr_mult=0.5,scenario_strength=explicit,require_bias_alignment=False` | 53 | -0.31 | -7.16 | 33 | -0.14 | -3.29 |
| `n_hold=2,stop_mode=close_back,stop_atr_mult=0.5,scenario_strength=explicit,require_bias_alignment=True` | 61 | -0.31 | -9.85 | 32 | -0.37 | -10.29 |
| `n_hold=1,stop_mode=close_back,stop_atr_mult=0.5,scenario_strength=explicit,require_bias_alignment=False` | 80 | -0.32 | -17.85 | 41 | -0.42 | -14.43 |
| `n_hold=1,stop_mode=structural,stop_atr_mult=0.5,scenario_strength=directional,require_bias_alignment=True` | 157 | -0.33 | -28.77 | 73 | -0.43 | -22.34 |
| `n_hold=2,stop_mode=close_back,stop_atr_mult=0.5,scenario_strength=directional,require_bias_alignment=True` | 131 | -0.34 | -23.72 | 60 | -0.35 | -14.81 |
| `n_hold=1,stop_mode=close_back,stop_atr_mult=0.5,scenario_strength=directional,require_bias_alignment=False` | 161 | -0.35 | -33.28 | 78 | -0.48 | -25.11 |
| `n_hold=2,stop_mode=close_back,stop_atr_mult=0.5,scenario_strength=directional,require_bias_alignment=False` | 138 | -0.36 | -24.53 | 67 | -0.40 | -17.96 |
| `n_hold=1,stop_mode=structural,stop_atr_mult=0.5,scenario_strength=directional,require_bias_alignment=False` | 168 | -0.36 | -32.43 | 81 | -0.45 | -24.43 |
| `n_hold=1,stop_mode=structural,stop_atr_mult=0.5,scenario_strength=explicit,require_bias_alignment=False` | 81 | -0.37 | -17.25 | 43 | -0.31 | -10.87 |
| `n_hold=2,stop_mode=structural,stop_atr_mult=0.5,scenario_strength=explicit,require_bias_alignment=True` | 62 | -0.38 | -12.29 | 32 | -0.24 | -6.93 |
| `n_hold=2,stop_mode=structural,stop_atr_mult=0.5,scenario_strength=directional,require_bias_alignment=True` | 134 | -0.38 | -27.68 | 61 | -0.36 | -15.73 |
| `n_hold=2,stop_mode=structural,stop_atr_mult=0.5,scenario_strength=directional,require_bias_alignment=False` | 142 | -0.39 | -28.13 | 69 | -0.38 | -17.72 |
| `n_hold=2,stop_mode=close_back,stop_atr_mult=0.5,scenario_strength=explicit,require_bias_alignment=False` | 65 | -0.39 | -13.22 | 34 | -0.37 | -10.94 |
| `n_hold=2,stop_mode=structural,stop_atr_mult=0.5,scenario_strength=explicit,require_bias_alignment=False` | 66 | -0.44 | -15.24 | 34 | -0.23 | -7.19 |

## Per rule

| | trades | win_rate_pct | avg_r | avg_r_ex_fees | profit_factor | total_pnl_usd |
|---|---|---|---|---|---|---|
| R1_bias_then_trigger | 186 | 44.10 | -0.37 | -0.11 | 0.53 | -3,766.83 |
| R2_retest_reversal | 9 | 44.40 | -0.38 | -0.15 | 0.68 | -138.40 |

## Per asset

| | trades | win_rate_pct | avg_r | avg_r_ex_fees | profit_factor | total_pnl_usd |
|---|---|---|---|---|---|---|
| BTC | 39 | 38.50 | -0.60 | -0.31 | 0.30 | -1,249.84 |
| ETH | 33 | 39.40 | -0.52 | -0.23 | 0.32 | -1,065.71 |
| LINK | 50 | 48.00 | -0.15 | 0.06 | 0.88 | -249.42 |
| LTC | 36 | 50.00 | -0.22 | 0.05 | 0.65 | -497.53 |
| XRP | 37 | 43.20 | -0.45 | -0.17 | 0.46 | -842.73 |

## Per risk tier

| | trades | win_rate_pct | avg_r | avg_r_ex_fees | profit_factor | total_pnl_usd |
|---|---|---|---|---|---|---|
| base | 156 | 45.50 | -0.37 | -0.10 | 0.54 | -3,003.71 |
| confirmed | 39 | 38.50 | -0.39 | -0.14 | 0.52 | -901.53 |

## Per side

| | trades | win_rate_pct | avg_r | avg_r_ex_fees | profit_factor | total_pnl_usd |
|---|---|---|---|---|---|---|
| long | 113 | 46.00 | -0.37 | -0.09 | 0.50 | -2,253.92 |
| short | 82 | 41.50 | -0.38 | -0.13 | 0.58 | -1,651.31 |

## Per close label

| | trades | win_rate_pct | avg_r | avg_r_ex_fees | profit_factor | total_pnl_usd |
|---|---|---|---|---|---|---|
| bearish | 25 | 40.00 | -0.29 | -0.05 | 0.78 | -264.13 |
| bullish | 32 | 43.80 | -0.45 | -0.17 | 0.36 | -868.23 |
| doji | 1 | 100.00 | 1.33 | 1.50 | — | 123.21 |
| dragonfly_doji | 1 | 100.00 | 0.26 | 0.47 | — | 17.58 |
| indecisive | 115 | 46.10 | -0.38 | -0.12 | 0.51 | -2,339.90 |
| slightly_bearish | 9 | 33.30 | -0.60 | -0.32 | 0.20 | -465.67 |
| slightly_bullish | 8 | 37.50 | -0.13 | 0.20 | 1.34 | 81.18 |
| strongly_bearish | 1 | 0.00 | -1.31 | -1.06 | 0.00 | -40.14 |
| strongly_bullish | 3 | 33.30 | -0.38 | -0.20 | 0.22 | -149.14 |

## Exit reasons

| | trades | win_rate_pct | avg_r | avg_r_ex_fees | profit_factor | total_pnl_usd |
|---|---|---|---|---|---|---|
| breakeven | 43 | 95.30 | 0.20 | 0.47 | 88.44 | 618.39 |
| stop | 105 | 0.00 | -1.32 | -1.06 | 0.00 | -8,390.57 |
| stop_gap | 4 | 50.00 | -0.08 | 0.39 | 2.08 | 12.74 |
| target | 42 | 100.00 | 1.34 | 1.61 | — | 3,775.18 |
| time_stop | 1 | 100.00 | 1.03 | 1.19 | — | 79.03 |

## Pipeline funnel

- Posts in store: 1293 · crypto outlooks parsed: 953 · actionable: 826 · setups after filters: 927 · trades: 195
- Setup filter rejections: {"parse_no_trade": 127, "btc_opposes": 80, "bias_opposes": 185, "level_too_far": 4}
- Engine rejections: {"chase_too_far": 180, "expired_untriggered": 503, "asset_position_limit": 16, "retest_failed": 23, "blackout_FOMC": 1, "gross_notional_cap": 2}
- Kill-switch days: none

## Data quality

- BTC:1h: 29999 bars 2023-06-01T00:00:00+00:00 → 2026-11-01T22:00:00+00:00, gaps 0 (0 missing bars)
- ETH:1h: 29999 bars 2023-06-01T00:00:00+00:00 → 2026-11-01T22:00:00+00:00, gaps 0 (0 missing bars)
- XRP:1h: 29999 bars 2023-06-01T00:00:00+00:00 → 2026-11-01T22:00:00+00:00, gaps 0 (0 missing bars)
- LTC:1h: 29999 bars 2023-06-01T00:00:00+00:00 → 2026-11-01T22:00:00+00:00, gaps 0 (0 missing bars)
- LINK:1h: 29999 bars 2023-06-01T00:00:00+00:00 → 2026-11-01T22:00:00+00:00, gaps 0 (0 missing bars)
- BTC:1d: 1249 bars 2023-06-01T00:00:00+00:00 → 2026-10-31T00:00:00+00:00, gaps 0 (0 missing bars)
- ETH:1d: 1249 bars 2023-06-01T00:00:00+00:00 → 2026-10-31T00:00:00+00:00, gaps 0 (0 missing bars)
- XRP:1d: 1249 bars 2023-06-01T00:00:00+00:00 → 2026-10-31T00:00:00+00:00, gaps 0 (0 missing bars)
- LTC:1d: 1249 bars 2023-06-01T00:00:00+00:00 → 2026-10-31T00:00:00+00:00, gaps 0 (0 missing bars)
- LINK:1d: 1249 bars 2023-06-01T00:00:00+00:00 → 2026-10-31T00:00:00+00:00, gaps 0 (0 missing bars)

## Caveats

- Sample is short (~6 months of dense posts, May-Nov 2026) and covers one market regime.
- Parser is deterministic regex; ~20% of actionable posts carry an explicit target, the rest use a 2R fallback target.
- Fills are simulated on 1h OHLC; intrabar order of stop vs target is unknown, stop assumed first.
- Costs: taker fee + fixed slippage per fill; funding (perps) and borrow (spot shorts) not modelled.
- Macro blackout uses FOMC dates only before Nov 2026 (past CPI/NFP dates not available, see config/events.yaml).
- Billy's own discretionary exits and later updates are not modelled; this tests his posted levels with fixed rules.
