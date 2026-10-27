# BT-008 — Public source capture and research intake

Version 0.4.0 adds a bounded, read-only Kraken SOL/USD hourly-data adapter. It checks the declared market identity, retains exact raw responses and request receipts, reconstructs the closed-bar dataset and produces a data-quality report. A source-preserving notebook can retain those raw responses through opening and later appends, rather than retaining only a converted CSV.

The only network command is capture-kraken. All earlier paper/study/notebook commands and import-kraken remain offline. No account, API key, order endpoint, wallet, token operation or paid service is used. This is Kraken spot SOL against USD; it does not identify AAI, Pump.fun pools, DEX liquidity or executable quotes.

## Read public observations

From this directory, with Python 3.12+:

```sh
python -m zoora_sfp capture-kraken --out new-source
python -m zoora_sfp verify --report-dir new-source
```

Open new-source/source.html. Each command needs a new output directory whose parent already exists. Existing output is rejected before making requests. The adapter requests only these fixed HTTPS GET URLs:

- https://api.kraken.com/0/public/AssetPairs?pair=SOLUSD&assetVersion=1
- https://api.kraken.com/0/public/OHLC?pair=SOLUSD&interval=60&assetVersion=1

Default TLS certificate/hostname validation is enabled; normal host proxy settings are respected. Redirects, non-JSON content, compressed bodies, oversized/truncated responses and unexpected market identities fail. Each body is bounded to 256 KiB for pair identity or 512 KiB for OHLC; request timeouts and a body-read deadline bound waiting. There is no retry loop or user-supplied host/symbol/interval. HTTP/provider errors are bounded CLI codes, not substituted prices.

The adapter requires the assetVersion=1 display key SOL/USD, base SOL, quote USD, SOLUSD alias and currency asset classes. It checks eight-field hourly rows with ordered timestamps, exact decimal price strings, volume/count syntax and OHLC/VWAP bounds. The returned final row is always excluded as uncommitted. Other rows must have closed and reached the declared close-plus-delay availability before the OHLC request began. That request start is the conservative dataset cutoff; response receipt times are stored separately.

The initial real endpoint probe returned 721 rows. The [official OHLC documentation](https://docs.kraken.com/api-reference/market-data/get-ohlc-data) states a 720-entry recent limit and says the last row is current/uncommitted. This implementation admits at most 721 rows as the explicit observed compatibility case, excludes its final row and records OBSERVED_721_ROWS_VS_DOCUMENTED_720_LIMIT. It does not silently treat the source contract as identical to the documentation or accept an unbounded result. [Asset identity documentation](https://docs.kraken.com/api-reference/market-data/get-tradable-asset-pairs) describes assetVersion=1 display names. No full history is fetched through cursor pagination.

## What the quality screen means

The report preserves gaps, stale latest completed bars, non-online market status and insufficient default first-training history. A local data-screen pass means those import checks pass. It does not independently verify provider accuracy, transport/host integrity, an unseen experiment, venue fees, fills or an economic strategy. Saved receipts and checksums establish local mapping/consistency; they can be rewritten by someone controlling the files.

Prices are SOURCE_ASSERTED_OBSERVATIONS after a public capture. Availability remains SYNTHETIC_RECONSTRUCTION at hourly close plus optional --delay-ms. The raw receipt mode is PUBLIC_HTTPS_GET_LOCAL_RECEIPT_NOT_EXTERNAL_ATTESTATION. This is not SOURCE_ASSERTED_RECEIPT historical availability: receiving a month of prices today does not prove each candle was received at its original close.

The recent sample cannot cover the default three-fold chronological study. The engine never shrinks a frozen plan automatically. The standalone pilot below declares a separate one-fold, 96-hour retrospective profile before evaluating returns; default costs, risk, embargo, training selection, control seeds and minimum-trade/drawdown screens remain unchanged.

## Run the explicit recent-window pilot

```sh
python scripts/public_source_pilot.py --out local-reports/solusd-pilot --profile RECENT_SOLUSD_RETROSPECTIVE_1F_96H_V1
```

Create local-reports first, or choose an existing parent directory. This script makes the two public GET requests, retains the source bundle, declares the fixed profile, opens a source-preserving notebook, records the study and exports/replays its full report. No profile settings are chosen using the resulting returns. Data-quality failures or incomplete scheduled evaluation coverage block completion, and PILOT_STATUS.json records the outcome. A successful software pilot remains a retrospective provider-reported study with funded readiness blocked. A numeric research screen can pass without granting any authority to trade.

The profile uses warmup 204 hours, initial training 240 hours, the existing 173-hour default holding/latency embargo, one 96-hour evaluation fold and seeds 11/23/47/89/131. It therefore requires 713 consecutive hourly bars from its starting point. It is a small operational pilot, not the original three-fold protocol, an independently untouched test or statistical acceptance.

## Use source inputs with an existing notebook

```sh
python -m zoora_sfp prepare-study --dataset new-source/dataset.json --test-hours 96 --folds 1 --out plan.json
python -m zoora_sfp notebook-open-source --notebook research.sqlite3 --source-dir new-source --plan plan.json
python -m zoora_sfp notebook-evaluate --notebook research.sqlite3
python -m zoora_sfp capture-kraken --out later-source
python -m zoora_sfp notebook-capture-source --notebook research.sqlite3 --source-dir later-source
python -m zoora_sfp notebook-evaluate --notebook research.sqlite3
python -m zoora_sfp notebook-export --notebook research.sqlite3 --out new-research-report
python -m zoora_sfp verify --report-dir new-research-report --replay
```

A later capture must contain new completed history and a matching previous last bar. Too-soon captures, changed old prices, backfills, mismatched classification/delay and stale checkpoints fail under the notebook's existing rules. Raw pair/OHLC responses, receipts and capture checksum are retained inside OPEN_SOURCE/CAPTURE_SOURCE events. The dataset source chain binds both converted CSV history and the provider capture. Receipt completion must precede its notebook event. The portable notebook remains independently readable without its original source directories or SQLite file; full replay needs matching engine bytes.

## Import saved response files without network access

```sh
python -m zoora_sfp import-kraken --pair-response supplied-pair.json --ohlc-response supplied-ohlc.json --captured-ms SUPPLIED_CUTOFF_MS --classification SOURCE_ASSERTED_OBSERVATIONS --out imported-source
```

Use SYNTHETIC for engineered fixtures. Supplied files have mode LOCAL_FILE_IMPORT_NOT_WITNESSED and their supplied time is an assertion. A filename or manually supplied source head does not attest an upstream download. The importer never silently changes the classification.

## Evidence and portable outputs

The source bundle has nine files: capture.json contains both original bodies encoded as base64 and bound request/producer metadata; pair-response.json and ohlc-response.json retain the exact provider bytes; history.csv and dataset.json contain the deterministic mapping; quality.json records data coverage and limitations; source.html and SOURCE_NOTES.md explain the result; manifest.json binds the other eight files. Verification rederives all source mappings rather than checking hashes alone. The producer head is a declaration, and its package fingerprint describes local bytes.

[Synthetic source example](examples/source-report/source.html) · [Validation](VALIDATION_BT008.md). CI uses synthetic saved responses and makes zero public requests. It retains both source bundles and the complete source-preserving notebook. The separate public pilot is an explicit local operation; its raw real-provider data does not enter source fixtures or CI artifacts. All actual transfers, purchases and burns remain zero, and no price floor or trading-profit allocation is established.
