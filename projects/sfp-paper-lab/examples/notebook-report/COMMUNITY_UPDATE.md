# BuildWithAAI research notebook update

Recorded 6 events, 2 appended CSV captures and 3 evaluations in this notebook. All recorded evaluations appear below.

Price classification: **SYNTHETIC**. Source verification: **UNAVAILABLE**. This is local research history; neither its timestamps nor unseen data are independently attested.

Evaluation bars already present at notebook opening: **0**. Reconstructed close-plus-delay availability is not proof that prices were received in real time.

| Recorded evaluation | Trials | Complete folds | Failed screens | Passing research screens |
| --- | --- | --- | --- | --- |
| Event 2 | 9 | 0 | 8 | 0 |
| Event 4 | 30 | 1 | 8 | 0 |
| Event 6 | 72 | 3 | 8 | 0 |

Different evaluations and folds reuse data and reset simulated accounts. Their profits must not be added together as project income. The history covers this notebook only; other experiments can exist. A separately retained head checkpoint is needed to detect a rolled-back copy.

Head checkpoint: `ecec71786e94340c5daca54de8a7149b4c84085669323bb4a29d56302e339269`.

[Audit history](audit.html) · [Latest complete study](study.html)

---
# AAI chronological SFP testing update

**OFFLINE RESEARCH. SYNTHETIC EXECUTION. NO VERIFIED TRADING EDGE OR EARNINGS.**

Input: SYNTHETIC. Source verification: UNAVAILABLE.
Run: 7ca7bf524f8c49d542e41f5fa16aa21e52d6ea1936c20589e8d86728d4ac3a95. Frozen plan: 0f2e9b8a57c7c26a4fefa3386a13d484a0b109e51246e21f6539657ab729de62.
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
