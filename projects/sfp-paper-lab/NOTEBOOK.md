# BT-007 — Persistent research notebook

Version 0.3.0 adds a local SQLite notebook around the BT-006 study engine. It retains the frozen plan, original baseline JSON, original appended CSV bytes, derived receipts and every recorded evaluation in one transactionally updated history. A portable export carries that history without requiring the SQLite file.

This is offline research software. No historical market dataset has been collected or verified by this implementation. The included example is synthetic, and its research screens fail. Recording a study does not authorize funding, buying or burning tokens.

## Try the complete workflow

From projects/sfp-paper-lab on a machine with Python 3.12+:

```sh
python -bb -X dev -W error scripts/notebook_acceptance.py
python -m zoora_sfp verify --report-dir evidence-output/notebook-report --replay
```

Open evidence-output/notebook-report/audit.html. It links to the latest study and shows all three evaluations, both CSV receipts and six recorded events. The synthetic baseline has 444 bars; later captures extend it to 809 and 1,216 bars. Recorded trial counts are 9, 30 and 72, with 0, 1 and 3 complete evaluation folds respectively. These overlap on one engineered history and must not be counted as independent markets or added together as income.

[Committed example](examples/notebook-report/audit.html) · [Community text](examples/notebook-report/COMMUNITY_UPDATE.md) · [Validation](VALIDATION_BT007.md).

The HTML files can be viewed on a phone. Executing the engine needs Python on the machine running these commands. Chromium desktop/mobile viewport checks do not establish actual iPhone/Safari acceptance.

## Start a notebook for supplied history

First import supplied one-hour, seven-column CSV with [the existing importer](README.md#import-a-supplied-historical-csv). Replace the example values with the actual declared market/source and capture time. SYNTHETIC must be used for generated data. Neither a venue label nor a supplied timestamp verifies a source.

```sh
python -m zoora_sfp import-csv --csv initial-history.csv --base SOL --quote USDC --venue KRAKEN --source-id MY_SOURCE --classification SOURCE_ASSERTED_OBSERVATIONS --captured-ms ACTUAL_CAPTURE_TIME_MS --out initial.json
python -m zoora_sfp prepare-study --dataset initial.json --out frozen-plan.json
python -m zoora_sfp notebook-open --notebook research.sqlite3 --dataset initial.json --plan frozen-plan.json
python -m zoora_sfp notebook-evaluate --notebook research.sqlite3
python -m zoora_sfp notebook-status --notebook research.sqlite3
```

The baseline must be exactly the dataset from which the plan was prepared. Its first training prefix, market, classification, costs, seeds, windows, embargo and screens remain fixed. Initial data must include the warmup and first training window; evaluation data can still be pending. Any evaluation bars already present at opening are counted explicitly.

Only SYNTHETIC_RECONSTRUCTION availability is supported by this CSV notebook. Pass the same --delay-ms to import-csv and notebook-open when using a nonzero delay; it is locked thereafter. Historical close-plus-delay timing remains a simulation assumption. An asserted capture time must not exceed the local recording time and must advance on each capture; the local host clock is not an independent witness.

## Append data and retain every recorded evaluation

```sh
python -m zoora_sfp notebook-capture --notebook research.sqlite3 --csv next-history.csv --captured-ms NEXT_CAPTURE_TIME_MS
python -m zoora_sfp notebook-evaluate --notebook research.sqlite3
python -m zoora_sfp notebook-export --notebook research.sqlite3 --out new-community-report
python -m zoora_sfp verify --report-dir new-community-report --replay
```

The CSV must include the existing last completed bar with matching prices, plus at least one later completed bar. It can include more matching older rows. Numerically equivalent decimal formatting is normalized; original CSV bytes are retained unchanged. A matching last bar binds continuity, but does not prove the provider's identity or accuracy.

Changed historical OHLC/availability, new rows inside the recorded past, missing last-bar overlap, a repeated raw capture and a capture with no new completed bars fail without appending an event. Missing future intervals remain gaps and incomplete folds abstain. Unfinished/not-yet-available CSV rows are excluded and counted. An accepted gap cannot subsequently be backfilled in the same notebook; corrected-history research requires a separately identified notebook and disclosure of that changed history.

Each accepted capture makes the previous report stale. Export is blocked until an evaluation covers the latest dataset. Identical run identities return EVALUATION_ALREADY_RECORDED without duplicating a result. A new engine fingerprint or declared source head creates a separate recorded evaluation. All recorded reports, including pending and failed screens, remain in the portable history. Failed commands and work outside this notebook are not an exhaustive experiment registry.

## Verify a saved checkpoint

Save the printed head_sha256 separately from the notebook/export. Then supply that exact value:

```sh
python -m zoora_sfp notebook-status --notebook research.sqlite3 --expected-head SAVED_HEAD_SHA256 --replay
python -m zoora_sfp verify --report-dir new-community-report --expected-head SAVED_HEAD_SHA256 --replay
```

Normal verification checks the event hash chain, exact original inputs, append semantics, frozen plan, source chain, report identity, complete trial matrices and paper accounting. Optional --replay additionally reruns every recorded evaluation and compares the complete report. It requires matching engine package bytes; a later engine version cannot attest an older engine rerun. An older report can still pass its semantic/history verification without --replay.

An internally consistent notebook can be rolled back or completely rewritten by someone with file access. A separately retained expected head detects a changed/truncated copy relative to that checkpoint. Hashes and local timestamps do not establish independent preregistration, live receipt, unseen data, profitability, or the absence of experiments elsewhere. None of these checks verifies a price source or executable quote.

## Storage, concurrency and exports

SQLite writes use an immediate transaction, FULL synchronization and a checked previous head. Concurrent appends from an old snapshot fail with EXPECTED_HEAD_MISMATCH. A locked/unavailable database returns a bounded error; retry after the other operation finishes. Validation failures and interrupted transactions leave the prior committed history in place. A filesystem failure can still require recovery from a separately retained export/backup; no power-loss or hostile-host certification is claimed.

The CLI creates new notebooks exclusively with private file permissions where the host enforces them. It rejects final-component symlinks and symlinked SQLite sidecars. Inputs remain bounded to 8 MiB/20,000 combined bars; a notebook permits 64 events, at most 32 MiB per artifact and 128 MiB of stored content, with a 256 MiB database size ceiling. Exports remain capped at 64 MiB and can hit that lower bound before notebook storage fills. Do not split an evaluation to hide losses or evade a limit. Keep local notebooks outside tracked source; conventional local-notebooks/ and SQLite filenames are ignored.

The ten-file export contains:

| File | Content |
| --- | --- |
| audit.html | Phone-readable receipt, evaluation and event history |
| study.html | Latest chronological study with expandable trials |
| notebook.json | Every event and exact source/report bytes encoded as base64 |
| dataset.json | Latest derived dataset, including source-chain hash |
| plan.json, study.json | Frozen plan and complete latest study |
| folds.csv, trials.csv | Latest fold/trial records |
| COMMUNITY_UPDATE.md | All recorded evaluations followed by the latest research update |
| manifest.json | Hashes/lengths for the other nine files and the notebook head |

Export directories must be new. No external assets, runtime JavaScript, service or credentials are needed to read the HTML. Reports are prepared for review; nothing is posted or deployed by these commands. Simulated fold accounts remain separate from treasury funds. Actual transferred funds, purchased tokens and burned tokens remain zero; no price floor or trading-profit allocation is established.
