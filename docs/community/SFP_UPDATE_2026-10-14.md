# AAI community development update — October 14, 2026

We now have a runnable SFP testing module. BT-005 adds causal pattern detection, three long entry approaches, cash/trend comparisons, costs and decision delay, loss/open-position accounting, offline CSV import and reproducible reports. The goal is to give the community inspectable data as we develop the trading research.

**This milestone uses engineered synthetic prices to test the software. It does not establish a profitable strategy, real earnings or a funded trading service.** The source implementation in [draft PR #24](https://github.com/BuildWithAAI/buildwithAAI/pull/24) passed 59 tests in both normal and optimized modes, lint and six acceptance checks on three Linux/Windows configurations. Its source commit is e175443ca9d3691b0e6ad0b37da13928e81744bf; the [source evidence](../../projects/sfp-paper-lab/evidence/2026-10-14-source-e175443/README.md) preserves the run and archive hashes.

The founder wants later attributable results/resources to support AAI purchases and burns. No allocation rate is selected by this tester. Hypothetical budgets are separated from completed purchases and confirmed burns, and an unresolved position or data gap withholds a budget. The burn objective is not a promise of a price floor or return. [Objective and accounting record](../../research/TRADING_BUY_BURN_OBJECTIVE.md).

The source-generated report follows. Net already includes fees and adverse slippage; the costs column is diagnostic and must not be subtracted again. Values are simulated quote units, not asserted dollars. Realized net includes entry expenses for open positions; open price changes are separate.

# SFP testing update

**OFFLINE PAPER SIMULATION — NOT REAL TRADING OR A VERIFIED STRATEGY EDGE.**

Data: SYNTHETIC. Availability: SYNTHETIC_RECONSTRUCTION. Source verification is unavailable.
Fixture purpose: ENGINE_ACCEPTANCE_NOT_STRATEGY_EVIDENCE.
Market label: SOL/USDC at SYNTHETIC; quote units are not asserted USD values.

Run: 808c246a25e12e415ba0310d2037a9b3a7a5edb55eda7e2918bb3ec089d87c18. Dataset: 925156680d9afe48d9d4f6f1bc62c2432c22ccd79a6eebabdb178338f50fff98.
Bars: 380; SFP events: 26; recorded coverage gaps: 0.

| Variant | Closed trades | Realized net scenario | Open price change | Costs incl. slippage | Close-mark drawdown | Unspent buy/burn scenario budget |
| --- | --- | --- | --- | --- | --- | --- |
| A | 3 | -1.9995 | -2.2331 | 2.2119 | 0.23% | 0.0000 |
| B | 3 | -1.9995 | -2.2331 | 2.2119 | 0.23% | 0.0000 |
| C | 2 | 8.2526 | 0.0662 | 1.4761 | 0.11% | 0.0000 |
| NO_TRADE | 0 | 0.0000 | 0.0000 | 0.0000 | 0.00% | 0.0000 |
| TREND_ONLY | 3 | -30.2451 | 0.5840 | 3.7241 | 0.31% | 0.0000 |

A: reclaim. B: upward 4-hour context. C: later structure confirmation. NO_TRADE: cash. TREND_ONLY: the frozen daily upward-context benchmark.

An unresolved position is not forced closed to create profit. Fees and slippage are assumptions; ambiguous paths use a stop bound. Daily limits observe closed bars and cannot guarantee maximum losses. Inspect report.json and the CSV records for skips, unresolved positions and coverage.

Funding is initial simulated capital, not creator-fee income. Buy/burn allocation is UNSELECTED unless an explicitly labelled scenario rate was supplied. Its budget uses recovered cumulative realized net and free cash above initial capital. Deposits and open gains are not distributable profit.

**Funds moved: 0. Tokens purchased: 0. Tokens burned: 0. No price floor established.**

Testing is available. Real historical source/quote verification, numerical strategy acceptance gates, matched-random comparison, full walk-forward and an unseen offline forward evaluation remain unfinished. These results do not authorize a funded strategy, token purchase, burn or a selected allocation.

## What comes next

Verify historical market/venue data and executable-quote coverage, set numerical study gates, add matched controls and chronological unseen evaluation, and publish failures as well as favorable results. No allocation or funded operation follows from this sample. The other project applications have not been retested by this trading update.

Inspect the [signals](../../projects/sfp-paper-lab/evidence/2026-10-14-source-e175443/base-report/signals.csv), [paper trades](../../projects/sfp-paper-lab/evidence/2026-10-14-source-e175443/base-report/trades.csv), [equity](../../projects/sfp-paper-lab/evidence/2026-10-14-source-e175443/base-report/equity.csv) and [machine-readable report](../../projects/sfp-paper-lab/evidence/2026-10-14-source-e175443/base-report/report.json), or run the [testing commands](../../projects/sfp-paper-lab/README.md). AAI-T-041 is TESTING for the offline engine; overall strategy performance remains unverified. This update is prepared for review/sharing and has not been posted to a community channel.
