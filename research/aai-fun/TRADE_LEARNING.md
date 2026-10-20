# AAI.fun — trade-specific readout learning

AAI.fun replaces the provisional Agent.fun working name. It remains the research simulator inside BuildWithAAI. No domain availability, ownership, public website or full Pump.fun-mechanics fidelity is claimed.

This milestone connects the recorded-chain evidence contract to a trainable numerical readout. It introduces a trade-specific observation/target schema and shares the existing logistic optimizer with the earlier quote/FlyVis experiment. Trade prices are never relabeled as executable bid/ask or depth.

## Source to observation

The prepare command accepts one to eight retained AAI_SOLANA_RAW_BLOCK_ARCHIVE_V1 files. Each archive is fully checked and reconstructed by the existing source decoder. Sources are sorted by their requested ledger windows. Overlapping windows, repeated transaction signatures, mixed synthetic/recorded classifications and conflicting identities are rejected.

The source package retains every raw archive, a filename/hash manifest, the derived dataset and an assessment. Source verification reconstructs the entire dataset from saved raw responses, rather than trusting the saved derived rows or their labels. Capture files still originate from a single RPC assertion: hashes and reconstruction do not independently authenticate a fabricated archive.

AAI_OBSERVED_TRADE_DATASET_V1 stores source coverage/decoder pins and market episodes. Each episode is one source window and one pool/base/quote identity. Disconnected windows start new episodes; no missing interval is interpolated. The same base mint has the same asset group across every pool, quote currency and source window.

All supported swaps in the same market and transaction are grouped into one observation. A transaction is atomic; a learner must not pretend it predicted a second swap inside that transaction before observing it. The row retains canonical slot/transaction order, signature, source block time, summed base/quote atoms, signed quote flow, supported event count and the last observed execution-price rational.

This is the last observed trade price, not the pool's executable price after the transaction. The decoder's fixed-prefix, opaque-extension and other/unmapped-event limits remain. Missing/unsupported observations are not reconstructed as zero activity. No private bundles, mempool visibility, historical network arrival times or original execution quotes are established.

Limits: eight archives, up to 512 market episodes and 8,192 transaction observations. Each archive retains its existing four-slot/eight-MiB raw budget. Inputs/outputs remain bounded JSON files with exclusive creation. Original response bytes stay intact inside the archived envelopes.

## Features and target

Five dimensionless features use only the current transaction observation and earlier observations in that episode:

1. Trailing one-observation price return.
2. Trailing three-observation price return.
3. Current quote volume relative to the preceding three observations.
4. Signed quote flow divided by observed quote volume.
5. Slots since the preceding observation, bounded by the feature policy.

No names, mint addresses, source IDs, signatures, future labels, episode-ending time or fabricated spread/depth enter the feature vector. Atomic aggregation uses all supported swaps already observed in the current transaction. Different quote currencies are never added together as a USD total.

Target: FUTURE_OBSERVED_TRADE_PRICE_DIRECTION_NOT_EXECUTABLE_RETURN_V1. The plan fixes horizon_transactions and max_horizon_slots. A label compares the current last-trade price with the Nth later supported market-transaction observation in the same episode. A missing later row or excessive slot gap creates no label. This is a sampled observed-price classification target, not an expected profit or a buy/sell instruction.

A slot is a ledger-order unit, not a fixed amount of physical time. Capture timestamps are not substituted for historical availability. This experiment evaluates transaction-atomic canonical replay; network-latency realism remains open.

## Plan and learning

AAI_TRADE_READOUT_PLAN_V1 pins the dataset, horizon, maximum target gap, shuffle seed, alias salt, train/validation/test episode IDs, epochs, learning rate and L2 penalty.

Every episode belongs to one partition. All windows/pools for an economic asset must remain in that partition. The entire earlier partition must end more than max_horizon_slots before the next partition begins. Whole episodes are shuffled within their partition; transaction order inside an episode never changes.

The shared standard-library optimizer validates all matrices, fits normalization and weights using train rows only, then scores frozen validation/test rows. Every partition needs at least four eligible examples and training needs both target classes. It reports log loss, Brier score, accuracy and a training-prior constant baseline. Insufficient cohorts or invalid plans are rejected; no synthetic observations or labels are added to make them pass.

The current trade path trains only a five-feature numerical-control LOGISTIC_READOUT. It does not run a biological core. The earlier frozen FlyVis path remains a separate verified experiment; feeding these transaction observations through a versioned biological activity encoder is later integration work. Biological-core fine-tuning, rug detection, financial edge and profitable execution remain unestablished.

The synthetic control intentionally includes predictable trends, signed flow and late drops to test parameter fitting. It is not a market benchmark. Learned weights and reduced training loss only establish that fitting ran on this fixture. Replay is exact within the tested numerical runtime; bitwise equality across operating systems/math libraries is not promised.

## Source assessment is not training

A source assessment reports asset/episode/observation counts and possible next-observation pairs. INSUFFICIENT_COHORT means those basic counts are too small. PLAN_REQUIRED means only that basic counts permit trying an explicit plan. Both statuses keep training_ready=false and training_performed=false: chronology, asset grouping, target availability and label classes still need validation.

The real-source CI job captures one finalized block, prepares its trade dataset and independently reconstructs the saved source package. It does not fit on that sample or claim a historical training cohort. The synthetic fitting CI is separate and labeled SYNTHETIC_FIXTURE.

Choosing cohorts only after seeing profitable outcomes would bias evaluation. A serious historical study still needs reproducible sampling across winners, dead coins, migrations and failures; verified coverage; data-use/provenance review; frozen tuning budgets; independent holdouts; and cost-aware paper execution.

## Prediction/outcome trace

The test trace emits an anonymous observation, any outcomes that have now matured, and a fixed-model prediction. Every observation gets a prediction, including the final observations for which no label exists. Prediction presence therefore cannot disclose whether a future outcome was available in the dataset.

Events form a SHA-256 chain. Labels appear only at their later target transaction, never inside a prediction. Aliases are presentation aids; familiar price/volume shapes and timestamps may still be recognizable. A host-controlled trace is not independent execution attestation or a running stream.

Private files include source IDs and future history. Only public-trace.json is intended as input for a future observer overlay. The prediction action is always NO_EXECUTION and probabilities are not established as calibrated.

## Commands

From repository root, Python >=3.11, standard library only:

~~~sh
python scripts/train_trade_readout.py demo --output /private/aai-fun-control
python scripts/train_trade_readout.py verify --directory /private/aai-fun-control

python scripts/train_trade_readout.py prepare \
  --archive /private/capture-one/archive.json \
  --archive /private/capture-two/archive.json \
  --output /private/aai-fun-sources

python scripts/train_trade_readout.py verify-sources --directory /private/aai-fun-sources

python scripts/train_trade_readout.py train \
  --source /private/aai-fun-sources --plan /private/trade-plan.json \
  --output /private/aai-fun-training
~~~

The demo creates explicitly synthetic RPC-schema fixtures and a complete sample plan. The real-source command creates no plan automatically. Prepared/trained packages retain source-manifest.json, archive_000.json and subsequent archives, dataset.json and assessment.json. A training package additionally retains plan.json, model.json, report.json and public-trace.json. Verification reconstructs sources, derives targets/features, re-fits weights, recomputes scores and checks the trace.

No wallet, signer, live funds, order execution, funding, token launch, paid provider, website publication or deployment is introduced.
