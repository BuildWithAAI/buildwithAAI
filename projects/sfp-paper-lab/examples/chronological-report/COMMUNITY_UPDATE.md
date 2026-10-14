# AAI chronological SFP testing update

**OFFLINE RESEARCH. SYNTHETIC EXECUTION. NO VERIFIED TRADING EDGE OR EARNINGS.**

Input: SYNTHETIC. Source verification: UNAVAILABLE.
Run: c3b6ddcc67b63a4138c98ac04ecfff9ac0a11ad4006cc47388c3ef00583e33ba. Frozen plan: 37fcbfcd5aaa469a3864b70a6bd4cf0b49ef7ef46527a103d40ec288f5f52a88.
Planned folds: 3; recorded trials: 72.

A: reclaim. B: upward 4-hour context. C: later structure confirmation.

Training selects among A/B/C using only eligible positive closed results; otherwise it chooses cash. Test outcomes never select the variant for that same fold. The holding/decision embargo separates training and evaluation. Chronological windows are not independently attested as unseen.

| Variant | Evaluated folds | Closed trades | Mean marked return | Max close-mark drawdown | Numeric screen |
| --- | --- | --- | --- | --- | --- |
| A | 3 | 6 | -0.03% | 0.23% | FAIL |
| B | 3 | 6 | -0.03% | 0.23% | FAIL |
| C | 3 | 4 | 0.06% | 0.10% | FAIL |
| NO_TRADE | 3 | 0 | 0.00% | 0.00% | FAIL |
| TREND_ONLY | 3 | 8 | -0.21% | 0.41% | FAIL |
| BUY_HOLD | 3 | 0 | 1.64% | 14.41% | FAIL |
| RANDOM_TIME | 3 | 20 | -0.10% | 0.32% | FAIL |
| TRAIN_SELECTED | 3 | 0 | 0.00% | 0.00% | FAIL |

Marked returns include unrealized inventory; they are not realized profit or promised exit value. Costs are already included in net results. End-of-window inventory is not forced sold.

Cash, trend, full-affordable-capital buy-and-hold and fixed-seed time controls are recorded. Random entry density comes from training and is frozen before test prices; this is not exact exposure matching. Doubled-cost and one-hour-delay trials appear in study.json/trials.csv and the portable HTML report.

Folds are independent experiments with fresh simulated starting capital, not a compounded treasury. Summing fold profits does not create funds for a buy/burn program. Numeric gates are research proposals; a screen pass cannot authorize trading.

**Readiness: BLOCKED. Funds moved: 0. Tokens bought: 0. Tokens burned: 0. No price floor established.**

Verified historical sources and executable quotes, genuinely untouched evaluation and statistical selection review remain required. The portable report makes no network request and sends no message.
