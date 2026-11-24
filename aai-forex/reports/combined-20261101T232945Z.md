# AAI-FX report `combined-20261101T232945Z`

- Generated: 2026-11-01T23:29:45.095939+00:00 (UTC)  |  kind: **combined**  |  mode: **PAPER**  |  live trading: **False**
- Account: USD 10,000 (simulated)  |  risk/trade 1.0%  |  max open 6.0%  |  daily loss limit 4.0%  |  config `9e80832379d13f17`

## Backtest: trend_swing (D1)

Period 2012-01-03T00:00:00+00:00 -> 2026-10-31T00:00:00+00:00; params `{'ema_fast': 50, 'ema_slow': 200, 'entry_lookback': 20, 'exit_lookback': 10, 'atr_period': 14, 'stop_atr': 2.0, 'target_r': None}`

| Metric | Full | In-sample | Out-of-sample | Walk-fwd OOS |
|---|---|---|---|---|
| Trades | 108 | 108 | 53 | 189 |
| CAGR | 0.65% | 0.93% | -2.95% | -3.17% |
| Sharpe | 0.14 | 0.17 | -0.48 | -0.46 |
| Sortino | 0.20 | 0.23 | -0.66 | -0.63 |
| Max DD | 20.55% | 20.55% | 20.16% | 39.52% |
| Win rate | 32.4% | 32.4% | 32.1% | 29.6% |
| Profit factor | 1.18 | 1.18 | 0.57 | 0.66 |
| Expectancy | 0.109 R | 0.109 R | -0.221 R | -0.184 R |
| Total return | 10.12% | 10.12% | -12.50% | -29.83% |

IS/OOS split at 2022-05-17T00:00:00+00:00.

Walk-forward: 11 windows, train 780 / test 260 bars, grid 4, objective sharpe.

| Pair | Trades | Win % | Exp. R | Net PnL | PF |
|---|---|---|---|---|---|
| AUDUSD | 12 | 33.3 | -0.109 | -129.99 | 0.79 |
| EURUSD | 15 | 33.3 | 1.366 | 1,983.28 | 4.00 |
| GBPUSD | 18 | 27.8 | -0.189 | -378.18 | 0.69 |
| NZDUSD | 14 | 14.3 | -0.552 | -834.21 | 0.19 |
| USDCAD | 15 | 53.3 | 0.257 | 385.41 | 1.71 |
| USDCHF | 15 | 20.0 | -0.603 | -774.46 | 0.11 |
| USDJPY | 19 | 42.1 | 0.470 | 760.24 | 1.91 |

Signals 698, approved entries 108, risk rejections {'positions short USD': 18, 'positions long USD': 44, 'KILL SWITCH': 472}, drawdown kill enforced: True, kill switch: drawdown 20.31% >= 20.0% at 2018-07-10T00:00:00+00:00, first drawdown-limit breach: 2018-07-10T00:00:00+00:00 drawdown 20.31%, modeled spread+slippage cost 85.23.

Data: yfinance D1, 2012-01-02T00:00:00+00:00 -> 2026-10-30T00:00:00+00:00, bars/pair {'EURUSD': 3860, 'GBPUSD': 3861, 'USDJPY': 3861, 'USDCHF': 3858, 'AUDUSD': 3860, 'USDCAD': 3860, 'NZDUSD': 3861}.

## Backtest: trend_swing (D1) [research mode: drawdown kill disabled]

Period 2012-01-03T00:00:00+00:00 -> 2026-10-31T00:00:00+00:00; params `{'ema_fast': 50, 'ema_slow': 200, 'entry_lookback': 20, 'exit_lookback': 10, 'atr_period': 14, 'stop_atr': 2.0, 'target_r': None}`

| Metric | Full | In-sample | Out-of-sample | Walk-fwd OOS |
|---|---|---|---|---|
| Trades | 259 | 176 | 86 | 187 |
| CAGR | -1.69% | 0.04% | -5.27% | -3.19% |
| Sharpe | -0.15 | 0.05 | -0.67 | -0.44 |
| Sortino | -0.21 | 0.07 | -0.89 | -0.60 |
| Max DD | 45.83% | 35.17% | 30.73% | 39.65% |
| Win rate | 29.3% | 30.7% | 27.9% | 29.4% |
| Profit factor | 0.84 | 1.00 | 0.49 | 0.66 |
| Expectancy | -0.059 R | 0.056 R | -0.260 R | -0.171 R |
| Total return | -22.28% | 0.37% | -21.44% | -29.98% |

IS/OOS split at 2022-05-17T00:00:00+00:00.

Walk-forward: 11 windows, train 780 / test 260 bars, grid 4, objective sharpe.

| Pair | Trades | Win % | Exp. R | Net PnL | PF |
|---|---|---|---|---|---|
| AUDUSD | 36 | 27.8 | -0.316 | -873.27 | 0.54 |
| EURUSD | 42 | 33.3 | 0.523 | 1,580.23 | 1.72 |
| GBPUSD | 41 | 29.3 | -0.244 | -1,227.44 | 0.54 |
| NZDUSD | 35 | 17.1 | -0.432 | -1,474.89 | 0.31 |
| USDCAD | 29 | 44.8 | 0.327 | 690.71 | 1.57 |
| USDCHF | 38 | 18.4 | -0.469 | -1,842.99 | 0.22 |
| USDJPY | 38 | 36.8 | 0.202 | 919.94 | 1.50 |

Signals 553, approved entries 259, risk rejections {'positions short USD': 60, 'positions long USD': 100, 'correlated USD': 7}, drawdown kill enforced: False, kill switch: not triggered, first drawdown-limit breach: 2018-07-10T00:00:00+00:00 drawdown 20.31%, modeled spread+slippage cost 207.27.

Data: yfinance D1, 2012-01-02T00:00:00+00:00 -> 2026-10-30T00:00:00+00:00, bars/pair {'EURUSD': 3860, 'GBPUSD': 3861, 'USDJPY': 3861, 'USDCHF': 3858, 'AUDUSD': 3860, 'USDCAD': 3860, 'NZDUSD': 3861}.

## Backtest: trend_swing_h4 (H4)

Period 2024-11-04T04:00:00+00:00 -> 2026-10-31T00:00:00+00:00; params `{'ema_fast': 50, 'ema_slow': 200, 'entry_lookback': 30, 'exit_lookback': 15, 'atr_period': 14, 'stop_atr': 2.5, 'target_r': None}`

| Metric | Full | In-sample | Out-of-sample |
|---|---|---|---|
| Trades | 94 | 64 | 50 |
| CAGR | -8.96% | -8.27% | -5.45% |
| Sharpe | -0.77 | -0.69 | -0.32 |
| Sortino | -1.04 | -0.95 | -0.43 |
| Max DD | 20.31% | 14.83% | 15.12% |
| Win rate | 29.8% | 28.1% | 34.0% |
| Profit factor | 0.63 | 0.63 | 0.87 |
| Expectancy | -0.199 R | -0.187 R | -0.053 R |
| Total return | -17.02% | -11.31% | -3.29% |

IS/OOS split at 2026-03-27T04:00:00+00:00.

| Pair | Trades | Win % | Exp. R | Net PnL | PF |
|---|---|---|---|---|---|
| AUDUSD | 19 | 26.3 | 0.178 | 275.16 | 1.33 |
| EURUSD | 13 | 30.8 | -0.370 | -433.73 | 0.38 |
| GBPUSD | 10 | 20.0 | -0.540 | -453.97 | 0.20 |
| NZDUSD | 11 | 27.3 | -0.275 | -270.52 | 0.46 |
| USDCAD | 11 | 27.3 | -0.052 | -75.80 | 0.85 |
| USDCHF | 12 | 41.7 | -0.373 | -380.44 | 0.27 |
| USDJPY | 18 | 33.3 | -0.212 | -362.54 | 0.61 |

Signals 349, approved entries 94, risk rejections {'positions short USD': 64, 'positions long USD': 18, 'KILL SWITCH': 116}, drawdown kill enforced: True, kill switch: drawdown 20.30% >= 20.0% at 2026-07-30T12:00:00+00:00, first drawdown-limit breach: 2026-07-30T12:00:00+00:00 drawdown 20.30%, modeled spread+slippage cost 190.50.

Data: yfinance H4, 2024-11-04T00:00:00+00:00 -> 2026-10-30T20:00:00+00:00, bars/pair {'EURUSD': 3099, 'GBPUSD': 3099, 'USDJPY': 3053, 'USDCHF': 3057, 'AUDUSD': 3111, 'USDCAD': 3108, 'NZDUSD': 3112}.

## Backtest: trend_swing_h4 (H4) [research mode: drawdown kill disabled]

Period 2024-11-04T04:00:00+00:00 -> 2026-10-31T00:00:00+00:00; params `{'ema_fast': 50, 'ema_slow': 200, 'entry_lookback': 30, 'exit_lookback': 15, 'atr_period': 14, 'stop_atr': 2.5, 'target_r': None}`

| Metric | Full | In-sample | Out-of-sample |
|---|---|---|---|
| Trades | 113 | 64 | 50 |
| CAGR | -7.19% | -8.27% | -5.45% |
| Sharpe | -0.52 | -0.69 | -0.32 |
| Sortino | -0.72 | -0.95 | -0.43 |
| Max DD | 22.89% | 14.83% | 15.12% |
| Win rate | 31.0% | 28.1% | 34.0% |
| Profit factor | 0.74 | 0.63 | 0.87 |
| Expectancy | -0.125 R | -0.187 R | -0.053 R |
| Total return | -13.77% | -11.31% | -3.29% |

IS/OOS split at 2026-03-27T04:00:00+00:00.

| Pair | Trades | Win % | Exp. R | Net PnL | PF |
|---|---|---|---|---|---|
| AUDUSD | 24 | 29.2 | 0.107 | 207.55 | 1.21 |
| EURUSD | 15 | 33.3 | -0.004 | -56.73 | 0.92 |
| GBPUSD | 14 | 21.4 | -0.546 | -651.93 | 0.21 |
| NZDUSD | 12 | 33.3 | -0.114 | -140.00 | 0.72 |
| USDCAD | 12 | 33.3 | 0.287 | 231.51 | 1.45 |
| USDCHF | 16 | 37.5 | -0.328 | -440.95 | 0.31 |
| USDJPY | 20 | 30.0 | -0.293 | -526.84 | 0.52 |

Signals 279, approved entries 113, risk rejections {'positions short USD': 64, 'positions long USD': 33}, drawdown kill enforced: False, kill switch: not triggered, first drawdown-limit breach: 2026-07-30T12:00:00+00:00 drawdown 20.30%, modeled spread+slippage cost 232.43.

Data: yfinance H4, 2024-11-04T00:00:00+00:00 -> 2026-10-30T20:00:00+00:00, bars/pair {'EURUSD': 3099, 'GBPUSD': 3099, 'USDJPY': 3053, 'USDCHF': 3057, 'AUDUSD': 3111, 'USDCAD': 3108, 'NZDUSD': 3112}.

## Backtest: session_breakout (M15)

Period 2026-09-03T23:30:00+00:00 -> 2026-10-30T21:45:00+00:00; params `{'range_start_hour': 0, 'range_end_hour': 7, 'entry_end_hour': 11, 'flat_hour': 16, 'buffer_datr': 0.05, 'min_range_datr': 0.15, 'max_range_datr': 0.8, 'daily_atr_period': 14, 'stop_mode': 'mid', 'target_r': 1.5, 'max_trades_per_day': 1}`

| Metric | Full | In-sample | Out-of-sample |
|---|---|---|---|
| Trades | 88 | 53 | 35 |
| CAGR | 17.15% | 178.95% | -86.53% |
| Sharpe | 0.76 | 4.22 | -9.88 |
| Sortino | 1.19 | 8.24 | -9.17 |
| Max DD | 9.73% | 4.59% | 9.74% |
| Win rate | 48.9% | 60.4% | 31.4% |
| Profit factor | 1.06 | 1.62 | 0.51 |
| Expectancy | 0.033 R | 0.240 R | -0.280 R |
| Total return | 2.50% | 12.08% | -8.56% |

IS/OOS split at 2026-10-14T14:15:00+00:00.

| Pair | Trades | Win % | Exp. R | Net PnL | PF |
|---|---|---|---|---|---|
| AUDUSD | 13 | 30.8 | -0.364 | -514.64 | 0.37 |
| EURUSD | 21 | 57.1 | 0.225 | 511.20 | 1.65 |
| GBPUSD | 18 | 44.4 | 0.092 | 130.86 | 1.18 |
| NZDUSD | 10 | 60.0 | 0.119 | 102.32 | 1.35 |
| USDCAD | 7 | 28.6 | -0.496 | -348.87 | 0.35 |
| USDCHF | 11 | 45.5 | -0.123 | -119.39 | 0.81 |
| USDJPY | 8 | 75.0 | 0.608 | 488.28 | 5.30 |

Signals 139, approved entries 88, risk rejections {'positions short USD': 6, 'positions long USD': 11}, drawdown kill enforced: True, kill switch: not triggered, first drawdown-limit breach: none, modeled spread+slippage cost 708.19.

Data: yfinance M15, 2026-09-03T23:15:00+00:00 -> 2026-10-30T21:30:00+00:00, bars/pair {'EURUSD': 3876, 'GBPUSD': 3876, 'USDJPY': 3862, 'USDCHF': 3862, 'AUDUSD': 3882, 'USDCAD': 3871, 'NZDUSD': 3881}.

## Backtest: session_breakout (M15) [research mode: drawdown kill disabled]

Period 2026-09-03T23:30:00+00:00 -> 2026-10-30T21:45:00+00:00; params `{'range_start_hour': 0, 'range_end_hour': 7, 'entry_end_hour': 11, 'flat_hour': 16, 'buffer_datr': 0.05, 'min_range_datr': 0.15, 'max_range_datr': 0.8, 'daily_atr_period': 14, 'stop_mode': 'mid', 'target_r': 1.5, 'max_trades_per_day': 1}`

| Metric | Full | In-sample | Out-of-sample |
|---|---|---|---|
| Trades | 88 | 53 | 35 |
| CAGR | 17.15% | 178.95% | -86.53% |
| Sharpe | 0.76 | 4.22 | -9.88 |
| Sortino | 1.19 | 8.24 | -9.17 |
| Max DD | 9.73% | 4.59% | 9.74% |
| Win rate | 48.9% | 60.4% | 31.4% |
| Profit factor | 1.06 | 1.62 | 0.51 |
| Expectancy | 0.033 R | 0.240 R | -0.280 R |
| Total return | 2.50% | 12.08% | -8.56% |

IS/OOS split at 2026-10-14T14:15:00+00:00.

| Pair | Trades | Win % | Exp. R | Net PnL | PF |
|---|---|---|---|---|---|
| AUDUSD | 13 | 30.8 | -0.364 | -514.64 | 0.37 |
| EURUSD | 21 | 57.1 | 0.225 | 511.20 | 1.65 |
| GBPUSD | 18 | 44.4 | 0.092 | 130.86 | 1.18 |
| NZDUSD | 10 | 60.0 | 0.119 | 102.32 | 1.35 |
| USDCAD | 7 | 28.6 | -0.496 | -348.87 | 0.35 |
| USDCHF | 11 | 45.5 | -0.123 | -119.39 | 0.81 |
| USDJPY | 8 | 75.0 | 0.608 | 488.28 | 5.30 |

Signals 139, approved entries 88, risk rejections {'positions short USD': 6, 'positions long USD': 11}, drawdown kill enforced: False, kill switch: not triggered, first drawdown-limit breach: none, modeled spread+slippage cost 708.19.

Data: yfinance M15, 2026-09-03T23:15:00+00:00 -> 2026-10-30T21:30:00+00:00, bars/pair {'EURUSD': 3876, 'GBPUSD': 3876, 'USDJPY': 3862, 'USDCHF': 3862, 'AUDUSD': 3882, 'USDCAD': 3871, 'NZDUSD': 3881}.

## Backtest: session_breakout_h1 (H1)

Period 2024-11-04T01:00:00+00:00 -> 2026-10-30T22:00:00+00:00; params `{'range_start_hour': 0, 'range_end_hour': 7, 'entry_end_hour': 11, 'flat_hour': 16, 'buffer_datr': 0.05, 'min_range_datr': 0.15, 'max_range_datr': 0.8, 'daily_atr_period': 14, 'stop_mode': 'mid', 'target_r': 1.5, 'max_trades_per_day': 1}`

| Metric | Full | In-sample | Out-of-sample | Walk-fwd OOS |
|---|---|---|---|---|
| Trades | 143 | 143 | 407 | 969 |
| CAGR | -5.05% | -7.13% | 51.84% | -13.05% |
| Sharpe | -0.40 | -0.48 | 1.57 | -0.46 |
| Sortino | -0.56 | -0.67 | 2.47 | -0.65 |
| Max DD | 20.18% | 20.18% | 19.30% | 48.47% |
| Win rate | 43.4% | 43.4% | 52.1% | 50.1% |
| Profit factor | 0.87 | 0.87 | 1.15 | 0.95 |
| Expectancy | -0.061 R | -0.061 R | 0.075 R | -0.018 R |
| Total return | -9.79% | -9.79% | 28.22% | -18.44% |

IS/OOS split at 2026-03-27T11:00:00+00:00.

Walk-forward: 6 windows, train 3000 / test 1500 bars, grid 6, objective expectancy_r.

| Pair | Trades | Win % | Exp. R | Net PnL | PF |
|---|---|---|---|---|---|
| AUDUSD | 18 | 27.8 | -0.456 | -798.12 | 0.37 |
| EURUSD | 33 | 39.4 | -0.005 | -76.97 | 0.95 |
| GBPUSD | 28 | 39.3 | -0.072 | -240.20 | 0.85 |
| NZDUSD | 15 | 46.7 | -0.138 | -236.76 | 0.72 |
| USDCAD | 13 | 69.2 | 0.349 | 441.21 | 2.11 |
| USDCHF | 26 | 50.0 | 0.022 | 107.47 | 1.09 |
| USDJPY | 10 | 40.0 | -0.133 | -175.50 | 0.72 |

Signals 1700, approved entries 143, risk rejections {'positions long USD': 22, 'positions short USD': 20, 'KILL SWITCH': 1479}, drawdown kill enforced: True, kill switch: drawdown 20.17% >= 20.0% at 2025-02-03T09:00:00+00:00, first drawdown-limit breach: 2025-02-03T09:00:00+00:00 drawdown 20.17%, modeled spread+slippage cost 891.71.

Data: yfinance H1, 2024-11-04T00:00:00+00:00 -> 2026-10-30T21:00:00+00:00, bars/pair {'EURUSD': 12233, 'GBPUSD': 12235, 'USDJPY': 12186, 'USDCHF': 12193, 'AUDUSD': 12290, 'USDCAD': 12286, 'NZDUSD': 12289}.

## Backtest: session_breakout_h1 (H1) [research mode: drawdown kill disabled]

Period 2024-11-04T01:00:00+00:00 -> 2026-10-30T22:00:00+00:00; params `{'range_start_hour': 0, 'range_end_hour': 7, 'entry_end_hour': 11, 'flat_hour': 16, 'buffer_datr': 0.05, 'min_range_datr': 0.15, 'max_range_datr': 0.8, 'daily_atr_period': 14, 'stop_mode': 'mid', 'target_r': 1.5, 'max_trades_per_day': 1}`

| Metric | Full | In-sample | Out-of-sample | Walk-fwd OOS |
|---|---|---|---|---|
| Trades | 1329 | 922 | 407 | 971 |
| CAGR | -34.94% | -54.06% | 51.84% | -11.86% |
| Sharpe | -1.30 | -2.46 | 1.57 | -0.40 |
| Sortino | -1.78 | -3.20 | 2.47 | -0.58 |
| Max DD | 72.66% | 70.55% | 19.30% | 48.66% |
| Win rate | 45.2% | 42.4% | 52.1% | 50.2% |
| Profit factor | 0.85 | 0.80 | 1.15 | 0.96 |
| Expectancy | -0.063 R | -0.122 R | 0.075 R | -0.016 R |
| Total return | -57.44% | -66.14% | 28.22% | -16.81% |

IS/OOS split at 2026-03-27T11:00:00+00:00.

Walk-forward: 6 windows, train 3000 / test 1500 bars, grid 6, objective expectancy_r.

| Pair | Trades | Win % | Exp. R | Net PnL | PF |
|---|---|---|---|---|---|
| AUDUSD | 179 | 45.3 | -0.064 | -1,012.34 | 0.80 |
| EURUSD | 253 | 48.2 | 0.002 | 83.34 | 1.01 |
| GBPUSD | 280 | 45.4 | -0.032 | -959.94 | 0.89 |
| NZDUSD | 169 | 46.7 | -0.078 | -832.52 | 0.81 |
| USDCAD | 122 | 42.6 | -0.159 | -1,172.25 | 0.70 |
| USDCHF | 195 | 42.6 | -0.154 | -1,580.72 | 0.77 |
| USDJPY | 131 | 43.5 | -0.007 | -270.01 | 0.92 |

Signals 2155, approved entries 1329, risk rejections {'positions long USD': 153, 'positions short USD': 182}, drawdown kill enforced: False, kill switch: not triggered, first drawdown-limit breach: 2025-02-03T09:00:00+00:00 drawdown 20.17%, modeled spread+slippage cost 5,278.39.

Data: yfinance H1, 2024-11-04T00:00:00+00:00 -> 2026-10-30T21:00:00+00:00, bars/pair {'EURUSD': 12233, 'GBPUSD': 12235, 'USDJPY': 12186, 'USDCHF': 12193, 'AUDUSD': 12290, 'USDCAD': 12286, 'NZDUSD': 12289}.

## Scan (2026-11-01T23:28:24.713678+00:00 UTC)

Kill switch engaged: **False**

No actionable signals on the latest completed bars.

| strategy | pair | tf | last_bar_close | age_min | close | bias | atr | dc_hi | dc_lo | rng_hi | rng_lo | datr | position |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| trend_swing | EURUSD | D1 | 2026-10-31T00:00:00+00:00 | 2,848 | 1.11828 | -1 | 0.00630 | 1.12853 | 1.11095 | - | - | - | - |
| trend_swing | GBPUSD | D1 | 2026-10-31T00:00:00+00:00 | 2,848 | 1.33786 | -1 | 0.00773 | 1.34174 | 1.31385 | - | - | - | - |
| trend_swing | USDJPY | D1 | 2026-10-31T00:00:00+00:00 | 2,848 | 157.80400 | +1 | 1.01464 | 158.94200 | 156.09599 | - | - | - | - |
| trend_swing | USDCHF | D1 | 2026-10-31T00:00:00+00:00 | 2,848 | 0.82361 | +1 | 0.00559 | 0.83948 | 0.81917 | - | - | - | - |
| trend_swing | AUDUSD | D1 | 2026-10-31T00:00:00+00:00 | 2,848 | 0.70270 | +1 | 0.00465 | 0.70678 | 0.68954 | - | - | - | - |
| trend_swing | USDCAD | D1 | 2026-10-31T00:00:00+00:00 | 2,848 | 1.39864 | +1 | 0.00659 | 1.42989 | 1.39697 | - | - | - | - |
| trend_swing | NZDUSD | D1 | 2026-10-31T00:00:00+00:00 | 2,848 | 0.56320 | -1 | 0.00453 | 0.57109 | 0.55670 | - | - | - | - |
| trend_swing_h4 | EURUSD | H4 | 2026-10-31T00:00:00+00:00 | 2,848 | 1.11657 | -1 | 0.00235 | 1.12296 | 1.11136 | - | - | - | - |
| trend_swing_h4 | GBPUSD | H4 | 2026-10-31T00:00:00+00:00 | 2,848 | 1.33894 | -1 | 0.00267 | 1.34335 | 1.32740 | - | - | - | - |
| trend_swing_h4 | USDJPY | H4 | 2026-10-30T20:00:00+00:00 | 3,088 | 157.51700 | +1 | 0.40847 | 158.34700 | 156.30400 | - | - | - | - |
| trend_swing_h4 | USDCHF | H4 | 2026-10-31T00:00:00+00:00 | 2,848 | 0.82490 | +1 | 0.00232 | 0.83130 | 0.81933 | - | - | - | - |
| trend_swing_h4 | AUDUSD | H4 | 2026-10-31T00:00:00+00:00 | 2,848 | 0.70353 | +1 | 0.00153 | 0.70696 | 0.70126 | - | - | - | - |
| trend_swing_h4 | USDCAD | H4 | 2026-10-31T00:00:00+00:00 | 2,848 | 1.39730 | +1 | 0.00277 | 1.40684 | 1.39380 | - | - | - | - |
| trend_swing_h4 | NZDUSD | H4 | 2026-10-31T00:00:00+00:00 | 2,848 | 0.56325 | -1 | 0.00156 | 0.57087 | 0.55891 | - | - | - | - |
| session_breakout | EURUSD | M15 | 2026-10-30T21:30:00+00:00 | 2,998 | 1.11657 | - | - | - | - | 1.12171 | 1.11807 | 0.00560 | - |
| session_breakout | GBPUSD | M15 | 2026-10-30T21:30:00+00:00 | 2,998 | 1.33894 | - | - | - | - | 1.34077 | 1.33765 | 0.00633 | - |
| session_breakout | USDJPY | M15 | 2026-10-30T21:00:00+00:00 | 3,028 | 157.51900 | - | - | - | - | 157.89799 | 157.11000 | 0.89757 | - |
| session_breakout | USDCHF | M15 | 2026-10-30T21:15:00+00:00 | 3,013 | 0.82490 | - | - | - | - | 0.82390 | 0.81933 | 0.00469 | - |
| session_breakout | AUDUSD | M15 | 2026-10-30T21:45:00+00:00 | 2,983 | 0.70353 | - | - | - | - | 0.70452 | 0.70249 | 0.00396 | - |
| session_breakout | USDCAD | M15 | 2026-10-30T21:15:00+00:00 | 3,013 | 1.39730 | - | - | - | - | 1.39873 | 1.39540 | 0.00607 | - |
| session_breakout | NZDUSD | M15 | 2026-10-30T21:45:00+00:00 | 2,983 | 0.56325 | - | - | - | - | 0.56453 | 0.56259 | 0.00385 | - |

- [trend_swing] paper equity 10,000.00 USD
- [trend_swing_h4] paper equity 10,000.00 USD
- [session_breakout] paper equity 10,000.00 USD

## Audit
- `runs/trend_swing-20261101T232601Z-b7c5f1/audit.jsonl`: 1834 records, hash chain OK
- `runs/trend_swing-research-20261101T232612Z-a73d3f/audit.jsonl`: 2147 records, hash chain OK
- `runs/trend_swing_h4-20261101T232623Z-4e6a02/audit.jsonl`: 1078 records, hash chain OK
- `runs/trend_swing_h4-research-20261101T232624Z-95c89b/audit.jsonl`: 1013 records, hash chain OK
- `runs/session_breakout-20261101T232625Z-746340/audit.jsonl`: 632 records, hash chain OK
- `runs/session_breakout-research-20261101T232626Z-d0239d/audit.jsonl`: 632 records, hash chain OK
- `runs/session_breakout_h1-20261101T232627Z-114fd3/audit.jsonl`: 3976 records, hash chain OK
- `runs/session_breakout_h1-research-20261101T232654Z-45c318/audit.jsonl`: 9628 records, hash chain OK
- `audit/audit.jsonl`: 6 records, hash chain OK

## Disclaimers
- PAPER/SIMULATED ONLY. No live orders were placed.
- Backtest results are historical simulations on free indicative mid-price data, not broker bid/ask; they are not evidence of future profitability.
- Reference strategies are research scaffolding; no claim of edge or profitability is made.
- Spreads, commissions and slippage are modeled with fixed per-pair assumptions; real costs vary by broker, session and news.
