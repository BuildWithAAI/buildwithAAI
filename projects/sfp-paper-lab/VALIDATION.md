# BT-005 verification record

Date: October 14, 2026. Stage: offline engine acceptance; strategy performance is unverified.

Local Python 3.12.14 passed 59 tests in normal and optimized modes with -bb, development mode and warnings treated as errors. Ruff checks pass. The six-check acceptance script ran the actual CSV/CLI/export/replay flow, verified two byte-identical runs, exercised higher costs and decision delay, rejected altered evidence and reported zero financial activity.

The synthetic fixture has 380 hourly bars and 26 price-based SFP events: four bullish and 22 bearish. Long variants process the bullish events; bearish events are logged rather than becoming shorts. A/B include a target-bound winner, a stop-bound loser, an ambiguous stop-bound loser and an unresolved open position. C includes later confirmation and invalidation. These deliberately engineered paths validate the software; they do not measure a market edge.

Coverage includes strict/late pivots, equality/plateaus, two-sided rejection, causal prefixes and changed future data, incomplete context, missing future labels/gaps, input precision, invalid/nonfinite/duplicate data, costs, affordability, gap losses, daily entry stops, accounting availability, cash/NAV reconciliation, no forced terminal realization, loss recovery and budget withholding, private exclusive output, tamper detection, rejection of rehashed false financial/accounting claims, actual CLI and validation under optimized Python.

Cross-platform current-head CI results, exact commit and evidence archive hashes are recorded in the pull-request description. Any checked-in source acceptance snapshot names its source commit; it must not be mistaken for a later head's regenerated report.

No historical market dataset/quote study, walk-forward, independent strategy certification, numerical go/no-go decision or untouched forward experiment is claimed. No actual orders, purchases, token burns, wallet/account integration or funding occurred. Reports separate observed-source assertions, reconstructed availability, synthetic fill/cost assumptions and future labels.

