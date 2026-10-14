# BT-006 — Chronological SFP study

Version 0.2.0 extends the existing tester with a runnable research workflow. It provides a local frozen plan, expanding train/test windows, a holding/latency embargo, A/B/C selection based only on training, cash fallback, controls and cost/delay trials. It does not establish profitable market performance or execute transactions.

## Run the complete sample

From projects/sfp-paper-lab:

```sh
python -m zoora_sfp prepare-study --dataset fixtures/study-demo.json --out new-study-plan.json
python -m zoora_sfp study --dataset fixtures/study-demo.json --plan new-study-plan.json --out new-study-report
python -m zoora_sfp verify --report-dir new-study-report
```

Open new-study-report/study.html to inspect the responsive summary and expandable fold ledgers. The report is static, requires no server, contains no JavaScript and makes no external request. Python runs on the machine executing the CLI; opening the report on a phone does not run Python or activate trading. Actual iPhone/Safari acceptance is still unverified; CI checks desktop and phone-sized Chromium viewports.

The supplied 1,216 hourly bars are deliberately **SYNTHETIC ENGINE ACCEPTANCE DATA**. Three folds record 72 trials: nine training trials, 45 base/cost/delay strategy trials, three buy-and-hold controls and 15 seeded time controls. These are multiple simulated trials on one engineered price history, not 72 independent market experiments or executed trades.

## The frozen plan

prepare-study creates a new file only. The plan checksum binds the market/classification, first training prefix, strategy/risk/cost settings, window lengths, embargo, seeds, scenario list, selection method and numeric research screens. Changing history inside the first training prefix fails. New later history can be appended under the same contract; incomplete evaluation windows remain incomplete without invented prices or compressed time. A changed plan is a new trial rather than a replacement for a losing result.

A local checksum is not independent preregistration or proof that the user never examined later data. Both the demo plan and all price outcomes are available beforehand. The report therefore uses CHRONOLOGICAL_WINDOWS_NOT_ATTESTED_UNSEEN. Provider truth, capture time and actual quote availability are not certified by a source label/hash.

The default plan uses 204 warmup hours, an initial 240-hour training period, three 192-hour evaluation periods and a 173-hour embargo for the default 168-bar maximum hold/zero latency. The minimum embargo is hold_bars plus rounded-up decision latency plus five hours for confirmation/entry/delay separation. Later folds expand training; previous evaluation observations can enter later training. No prices after that fold's training cutoff influence its choice.

All required rows must be available by the declared cutoff. Missing or late end observations produce INCOMPLETE coverage; the engine does not borrow later receipts to call the window complete. These strict boundaries may reject a real receipt stream until its study timing/coverage is deliberately specified. Availability is never fabricated as historical receipt evidence.

## Selection, controls and stress

Training compares A/B/C using exact Decimal closed net results. A candidate needs the frozen minimum closed-trade count, complete training coverage, positive closed net and no open terminal position. Fixed A/B/C order resolves equal scores. Otherwise the choice is NO_TRADE. Selection does not use the same fold's test outcomes. The default three-trade training minimum is a research proposal, not a power analysis.

Every complete evaluation window retains A/B/C, cash and the frozen trend-only trigger under base assumptions, doubled per-side fees/slippage/fixed costs and one additional hour of decision delay. A buy-and-hold control uses full affordable capital, no stop and an unrealized terminal mark. Its exposure differs from the risk-limited strategies and is displayed as such.

Five fixed-seed time controls use a reproducible SHA-256 clock. Their sampling density comes from A's eligible training plans divided by known training hours and is frozen before test outcomes. They use the same nominal risk/cost/hold policy and one-position constraint. They are not exact exposure-matched controls; realized frequency, exposure and outcomes are reported. Seeds share the same price path and are not independent samples.

The default 30 closed evaluation trades, positive mean marked return and 300 bps close-mark drawdown screen are explicitly RESEARCH_SCREEN_PROPOSALS. Incomplete training/evaluation, open terminal positions and insufficient counts fail the screen. Controls cannot become approved strategies. A passing numeric screen still leaves readiness BLOCKED because source/quote verification, independently unseen evidence and statistical selection review are absent.

## Accounting and data exports

Each phase/fold is an independent simulated account. Warmup observations can inform features but cannot open positions before the phase starts. No positions or cash transfer between folds, no artificial terminal sale occurs, and deposits/reset capital are not gains. Marked return includes unrealized inventory; net results already include fees and adverse slippage. A positive mark is not realized profit or promised exit cash.

Study plans refuse buy/burn allocation rates. Fold results cannot become a compounded treasury or a purchase budget. The original run command still supports separately labelled hypothetical budget scenarios. Actual funds moved, tokens bought and tokens burned remain zero.

The complete bundle contains plan.json, study.json, folds.csv, trials.csv, study.html, COMMUNITY_UPDATE.md and manifest.json. The JSON preserves every trial ID/config, phase/window/prefix, trade record, skip reason, costs, realized/unrealized net, drawdown, exposure, expectancy, profit-factor status and loss streak. Profit factor is undefined when there are no losses rather than invented infinity. Random seeds are averaged within folds before mean fold returns are reported.

verify checks every member hash, plan/code/run identity, scheduled windows, the full control/stress matrix, training selection, trade totals, NAV/return reconciliation and recomputed summaries. It checks internal consistency, not external data truth or independent rerun attestation. Existing output directories are refused. Limits remain 8 MiB/20,000 input bars and 64 MiB of exported evidence.

[Portable synthetic example](examples/chronological-report/study.html) · [Validation](VALIDATION_BT006.md) · [Earlier paper tester](README.md) · [Founder purchase/burn objective](../../research/TRADING_BUY_BURN_OBJECTIVE.md).
