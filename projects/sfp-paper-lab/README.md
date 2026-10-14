# BT-005 — SFP Offline Paper Lab

Version 0.3.0. An executable testing module inside BuildWithAAI's [Solana Trading Lab](../SOLANA_TRADING_LAB.md), following [BT-004](../../research/SWING_FAILURE_PATTERNS.md).

The module detects closed-bar SFP events, simulates three long entry variants and two benchmarks, and exports a community report with an exact accounting record. Python 3.12+ is required; runtime dependencies are standard library only. No server or paid provider is started.

## Run the supplied test now

From this directory:

```sh
python -m zoora_sfp run --dataset fixtures/demo.json --out new-paper-report
python -m zoora_sfp verify --report-dir new-paper-report
```

Open new-paper-report/COMMUNITY_UPDATE.md. Machine-readable report.json, signals.csv, trades.csv, equity.csv and a SHA-256 manifest are exported alongside it. The output directory must be new; existing evidence is never overwritten. The report verifier checks file hashes, configuration/run identity, trade totals, NAV and budget reconciliation. It checks internal consistency, not external source/host attestation.

The supplied 380-bar SOL/USDC-labeled dataset is **synthetic engine acceptance data**. It deliberately contains a winner, a loser, an ambiguous stop/target path and an open position. It is not historical SOL pricing, a trained model, proof of profitability or an untouched strategy test. Exact results and source-head checks belong in [VALIDATION.md](VALIDATION.md). A [saved source export](evidence/2026-10-14-source-e175443/README.md) and [community update](../../docs/community/SFP_UPDATE_2026-10-14.md) are included.

## What runs

| Variant | Implemented scenario |
| --- | --- |
| A | Reclaim after a completed SFP candle |
| B | Reclaim with upward closed 4-hour SMA50 context |
| C | A later close past the frozen intervening structure level, within three bars |
| NO_TRADE | Simulated cash held unchanged |
| TREND_ONLY | One daily UTC close decision in the same upward 4-hour context, without requiring an SFP; prior-ATR stop |

Only long spot positions are simulated. Bearish patterns are logged and have separate forward-price labels; they are not executable shorts. One position at a time, no borrowing/leverage. The trend-only trigger is frozen as specified above. [BT-006](STUDY.md) adds frozen plans, expanding chronological evaluation, training-derived seeded time controls and cost/delay trials. Exact exposure matching, an independently untouched forward study and statistical selection review remain future work.

The detector chooses the latest eligible strict pivot using two completed bars on each side, already available before the candidate opens. It uses prior available contiguous data for a 20-true-range arithmetic volatility estimate. Minimum sweep is 0.05 times that estimate and the stop buffer is 0.10 times it. Exact level equality, two-sided rejections, gaps, stale candidates and unavailable context abstain. Qualifying levels are consumed once; an ambiguous two-sided event consumes both references.

Future returns/MAE/MFE are output as LABEL records; they do not enter the detector or entry rules. Appending/changing later prices cannot alter earlier event IDs or geometry. Availability must be nondecreasing; unsupported out-of-order observations fail visibly rather than being silently reordered.

## Paper execution and accounting limits

The default scenario starts with 10,000 simulated quote units, 10 bps nominal risk, a 50 bps daily entry breaker, 10 bps fee and 5 bps adverse slippage per side, 0.01 fixed cost per side and at most 168 holding bars. These are synthetic study settings, not verified venue costs or an approved funded risk mandate. Quote units are not asserted USD.

Entries use a later opening price after signal availability plus the configured delay. This is an OHLC scenario bound, not a historical executable quote. Missing prior accounting blocks entry. Unknown intrabar stop/target order uses the stop bound; a gap stop can lose more than nominal R. A missing interval while invested leaves that position GAP_UNRESOLVED and blocks further entries. No final forced sale creates realized profit.

Fees and adverse slippage are counted explicitly; position size reserves fixed exit cost and cannot borrow cash. The daily circuit observes closed bars and prevents new entries after its threshold; it does not guarantee maximum loss or provide an externally enforced live governor.

Closed net outcomes and open entry costs reconcile to cash/inventory NAV. Open price changes remain unrealized. Ending inventory is marked at the last reported trade price, not promised liquidation value. The numerical scope rejects NAV outside 0–10^15 quote units visibly. The quantity step of 0.00000001 is a synthetic resolution, not a verified asset or exchange lot rule.

## Supply-buying/burning scenarios

Default allocation is **UNSELECTED** and the budget is zero. To test an explicitly hypothetical 30% rate:

```sh
python -m zoora_sfp run --dataset fixtures/demo.json --out new-allocation-scenario --buy-burn-scenario-bps 3000
```

This is not selection of a policy. It only earmarks a simulated quote-unit amount after cumulative realized losses/costs are recovered and free cash exceeds initial capital. Open positions or coverage gaps withhold the budget. Deposits, initial capital and unrealized gains are not eligible profit.

Every report records actual funds moved, tokens bought and tokens burned as zero. AAI mint, burn transaction and real buyback price are unset. A budget is not a completed burn, and no price floor is established. Earlier access-fee/platform-fee splits are different proposals and are not applied to trading profits. See [the founder's objective and execution boundary](../../research/TRADING_BUY_BURN_OBJECTIVE.md).

## Import supplied hourly history

The offline importer accepts Kraken-format, seven-column, one-hour CSV: timestamp in Unix seconds, open, high, low, close, volume, trades. An exact lowercase header is optional. Declare the data classification yourself:

```sh
python -m zoora_sfp import-csv --csv supplied-history.csv --base SOL --quote USDC --venue KRAKEN --source-id YOUR_PUBLIC_SOURCE_ID --classification SOURCE_ASSERTED_OBSERVATIONS --captured-ms ACTUAL_CAPTURE_TIME_MS --out new-dataset.json
python -m zoora_sfp run --dataset new-dataset.json --out new-history-scenario
```

Replace the source ID and actual capture timestamp; no source is automatically verified by its label. Use SYNTHETIC for generated/fixture CSV. Hashes preserve the supplied bytes. Availability is explicitly SYNTHETIC_RECONSTRUCTION at bar close plus optional --delay-ms, never fabricated historical receipt evidence. Unfinished/not-yet-available rows are excluded; missing intervals are recorded, not zero-filled. Volume/trade counts are syntax-checked but not used as a stop-run or intrabar-volume feature.

The Kraken [OHLC endpoint documentation](https://docs.kraken.com/api-reference/market-data/get-ohlc-data) says the current final row is unfinished and the endpoint only returns up to 720 recent entries. Its [historical archive description](https://support.kraken.com/articles/360047124832-downloadable-historical-ohlcvt-open-high-low-close-volume-trades-data) describes seven-column CSV and absent no-trade intervals. These are format references, not a selected provider, reuse approval or collected historical dataset. The package makes no network requests.

Dataset JSON uses ZOORA_SFP_DATASET_V1 with market identity, source hash, data/availability classification, capture time and explicit hourly OHLC/availability records. Prices are plain decimal strings. Invalid/duplicate fields, nonfinite prices, unfinished/overlapping observations or incompatible times fail. File input is limited to 8 MiB/20,000 bars; exported evidence to 64 MiB. Do not split a position-holding evaluation arbitrarily to evade a limit or turn an open loss into a new fresh start.

## Verify and extend

```sh
python -bb -X dev -W error -m unittest discover -s tests -v
python -O -bb -X dev -W error -m unittest discover -s tests
python -bb -X dev -W error scripts/acceptance.py
```

The acceptance script exercises actual CLI/import/export processes, deterministic replay, wins/losses/ambiguous/unresolved paths, doubled costs, a one-hour decision delay, tamper rejection and zero financial activity. It retains the complete six-file export under evidence-output/base-report so the archive can be checked with the same verify command. CI runs the exact PR head on Linux Python 3.12.15/3.14.8 and Windows Python 3.14.8.

Reports are prepared files; the module sends no community messages. The user can review/share the Markdown and CSV results. A real source/quote coverage audit, strategy acceptance thresholds, exact exposure-matched controls, independently untouched evaluation, statistical selection review and independent production controls remain. No live trading, wallet secrets, signing, burn instructions, paid resources or customer-fund custody is implemented. Material AI assistance: implementation, synthetic fixture, tests and reporting.


## BT-006: chronological study and portable report

The [study guide](STUDY.md) documents frozen plans, training-only selection, holding/decision embargoes, independent fold accounts, buy-and-hold/time controls and doubled-cost/one-hour-delay scenarios. A seven-file export includes a phone-readable HTML report with expandable fold ledgers. The [sample report](examples/chronological-report/study.html) uses engineered synthetic prices; its source-head field is deliberately undeclared and its code/data hashes are recorded. [Current validation](VALIDATION_BT006.md).

## BT-007: persistent data receipts and evaluation history

The [research notebook](NOTEBOOK.md) retains the frozen baseline, original appended CSVs and every recorded evaluation in a transactional SQLite history. It rejects revised/backfilled history, duplicate captures and stale exports. Its [ten-file portable example](examples/notebook-report/audit.html) keeps all three synthetic evaluations and data receipts; optional matching-engine replay reruns the full history. [Validation](VALIDATION_BT007.md). Source/unseen verification and funded strategy acceptance remain unresolved.
