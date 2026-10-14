# BT-005 verification record

Date: October 14, 2026. Stage: offline engine acceptance; strategy performance is unverified.

Local Python 3.12.14 passed 59 tests in normal and optimized modes with -bb, development mode and warnings treated as errors. Ruff checks pass. The six-check acceptance script ran the actual CSV/CLI/export/replay flow, verified two byte-identical runs, exercised higher costs and decision delay, rejected altered evidence and reported zero financial activity.

The synthetic fixture has 380 hourly bars and 26 price-based SFP events: four bullish and 22 bearish. Long variants process the bullish events; bearish events are logged rather than becoming shorts. A/B include a target-bound winner, a stop-bound loser, an ambiguous stop-bound loser and an unresolved open position. C includes later confirmation and invalidation. These deliberately engineered paths validate the software; they do not measure a market edge.

Coverage includes strict/late pivots, equality/plateaus, two-sided rejection, causal prefixes and changed future data, incomplete context, missing future labels/gaps, input precision, invalid/nonfinite/duplicate data, costs, affordability, gap losses, daily entry stops, accounting availability, cash/NAV reconciliation, no forced terminal realization, loss recovery and budget withholding, private exclusive output, tamper detection, rejection of rehashed false financial/accounting claims, actual CLI and validation under optimized Python.

Cross-platform current-head CI results, exact commit and evidence archive hashes are recorded in the pull-request description. Any checked-in source acceptance snapshot names its source commit; it must not be mistaken for a later head's regenerated report.

No historical market dataset/quote study, walk-forward, independent strategy certification, numerical go/no-go decision or untouched forward experiment is claimed. No actual orders, purchases, token burns, wallet/account integration or funding occurred. Reports separate observed-source assertions, reconstructed availability, synthetic fill/cost assumptions and future labels.


## Verified source acceptance snapshot

Source commit e175443ca9d3691b0e6ad0b37da13928e81744bf passed all three jobs in [run 38605707606](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/38605707606): 59 normal and 59 optimized tests, lint and six actual acceptance checks per job. Downloaded ZIP bytes/digests, declared source, zero financial activity and report hashes were checked. Cross-platform signals, future labels and paper accounting agree; Windows CRLF Python hashes are separately verified. The [saved snapshot](evidence/2026-10-14-source-e175443/README.md) records provenance and preserves a complete export matching the original CI manifest. The [community update](../../docs/community/SFP_UPDATE_2026-10-14.md) labels the sample explicitly.

## Subsequent BT-006 implementation

The above 59-test record and source snapshot describe BT-005 0.1.0. Version 0.2.0 adds the chronological study, controls, stress ledger and portable report; see [VALIDATION_BT006.md](VALIDATION_BT006.md). The historical source snapshot is not regenerated or relabelled as the new code.
