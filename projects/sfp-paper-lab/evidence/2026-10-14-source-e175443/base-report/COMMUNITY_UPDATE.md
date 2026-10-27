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
