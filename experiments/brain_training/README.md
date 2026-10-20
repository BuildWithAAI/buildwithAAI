# Causal episode replay and trainable biological-model readout

This adds an actual supervised learning path: causal observations -> a numerical feature export -> a fitted logistic readout -> frozen held-out forecasts -> a delayed public trace. It also adds a separately checked CPU integration that generates features from the existing frozen, published FlyVis model instead of the raw-feature control.

Status is determined by the PR's hosted checks. No real-market dataset, biological-core fine-tuning, profitable strategy, multiple connected brains, live order or funded token launch is claimed. The default fixture is explicitly SYNTHETIC_FIXTURE. Updating the readout is real parameter fitting; it is not a fly learning finance or the existing school curriculum changing network weights.

## Connection to the existing work

The source base is research PR #60, retaining the school and coordinator. The community/economy, instruction-following paper worker (#58) and cohort accountant (#59) remain separate development stacks. This PR provides the missing first trainable readout path; it does not silently merge those stacks.

The integration order is:

1. Preserve exact source history and its provenance privately.
2. Assign whole asset groups to chronological training/validation/test partitions.
3. Rename episodes for presentation and shuffle whole episodes within their assigned partition.
4. Reveal observations in their original internal order.
5. Produce causal model features, fit the readout only on training examples and freeze it.
6. Evaluate validation and test predictions with retained weights and baselines.
7. Publish an inspectable prediction/outcome trace without original asset identifiers.
8. Later connect a selected, validated policy to the venue-specific paper market, independent risk controls, two-agent economy and public observer.

The numerical trainer has no HTTP, RPC, wallet, signer, funding, order or model-teacher connection. $1 paper orders and eventual live sizing belong to the separate decision/risk/execution policy; they are not training labels or a guarantee that fees and losses are small.

## Dataset and real-data ingestion boundary

The train command accepts a bounded JSON dataset containing:

- protocol: AAI_EPISODE_DATASET_V1;
- classification: SYNTHETIC_FIXTURE or RECORDED_UNVERIFIED;
- source: uri, content_sha256 and rights=DECLARED_PERMITTED;
- units: quote_unit, base_scale, price_unit=QUOTE_UNITS_PER_WHOLE_BASE and depth_unit=BASE_ATOMS;
- episodes: episode_id, asset_group_sha256 and quotes;
- each quote: event_ms, available_ms, bid, ask, bid_size and ask_size.

Integers preserve exact scaled source units. Prices must be positive, ask >= bid, quantities nonnegative, and both event and availability order strictly increasing. The declared units/scale and quote denomination must be kept consistent by the importing data provider. This first schema assumes a homogeneous dataset; it has no automatic currency conversion. The source hash identifies the provider's source material and is retained as an assertion, not a verified data-provider signature.

Data is limited to 64 episodes, 512 quotes per episode, 8,192 quotes total and 16 MB JSON inputs. Unknown fields, duplicated trajectories, unknown rights and missing source pins are rejected. No URL in a dataset is fetched or executed.

RECORDED_UNVERIFIED means operator-supplied records, not independently authenticated market data. No historical coin data has been acquired in this PR. A later importer must preserve exact provider responses, terms, sampling/missingness, pool/mint identity and token lifecycle. OHLC charts alone cannot recover executable bid/ask, depth, intrabar order, bundles or failed-chain costs. Do not manufacture these measurements from a chart or relabel a generated tape as historical.

Use one stable asset_group_sha256 for every window/alias of the same economic asset. All windows for that group must stay in one partition. This checks supplied identities; a dishonest provider could disguise a repeated asset under another group hash. Aliases, timestamps and market shapes can still be recognized, so renaming and episode shuffling do not create an independently blinded holdout.

## Plan, task and leakage controls

AAI_READOUT_PLAN_V1 fixes dataset_sha256 (canonical JSON SHA-256), horizon_ms, shuffle_seed, alias_salt, splits, epochs, learning_rate and l2. splits has nonempty train, validation and test episode-ID lists, with every episode assigned exactly once. The source dataset, plan and feature export are pinned in the model artifact.

The full earlier partition must end more than one horizon before the later partition starts. Asset groups cannot cross partitions. Whole episodes can be presented in seeded random order, but candles/quotes inside an episode are never shuffled or reversed.

Current task: FUTURE_MID_DIRECTION_NOT_EXECUTABLE_RETURN_V1. For an observation available at t, the label uses the FIRST later quote whose event time reaches t+horizon. This can skip an earlier event that occurred before the prediction horizon even if it arrived later. No suitable future quote means no label. A rising midpoint is a classification target; it is not an executable profit after spread, fees or impact.

The raw-feature control uses only trailing returns, current spread, current depth imbalance and depth magnitude. It has no future maximum, outcome label, source token name or original episode ID in its model observation.

The fitted normalizer uses training examples only. Batch-gradient logistic fitting uses training labels only; validation/test examples do not update weights or choose hyperparameters. The training-derived constant prior is reported as a baseline. Scores include log loss, Brier score and threshold-0.5 classification accuracy; the threshold is not a buy rule. Reported probabilities remain UNCALIBRATED/NOT_ESTABLISHED.

This is a software learning fixture, not a preregistered performance study. The plan is saved and pinned for replay, but does not independently prove that its author selected settings before inspecting held-out results. A later scientific registration must freeze data, targets, tuning budget, seeds, baselines, independent holdouts and statistical criteria before training.

## Actual frozen FlyVis integration

The separate CPU job reuses the already pinned upstream code, dependency lock, public model-000 weights and adjacent asset license from FV-REF-001. It verifies archive/checkpoint/config/connectome bytes, loads only expected finite tensors with weights_only=True and strict state keys, and freezes the upstream network.

An explicitly synthetic encoder renders the five causal numeric features as repeated grayscale stripes across the 721 input hexals. One quote is one 0.005-second numerical integration step; that is an engineering time compression, not physical market/neural time equivalence. Each episode starts from the upstream initial state, without gray warm-up. This is a new adapter experiment, not replication of the paper's native stimulus protocol.

The readout consumes the 57 retained non-input central cell-type activities. R1-R8 photoreceptor inputs are excluded. No direct raw-feature values are appended to the biological feature export.

Required checks before success:

- the full 45,669-node / 1,513,231-connection model actually runs on CPU;
- repeating an episode after other episodes gives the same activity, establishing the tested reset behavior;
- changing the final three quotes does not change earlier exported activity;
- upstream parameter hashes match before and after inference/training;
- the readout parameter artifact changes and its fixture training loss decreases;
- a separate standard-library replay reproduces fitted weights, metrics and public trace.

Only the LOGISTIC_READOUT is trained. The biological core is fixed, and no multi-species fusion, financial skill or advantage over the raw-feature control follows from this check. A source/feature hash is not signed execution attestation.

The supervisor uses an environment without inherited production credentials and finite CPU/RSS/wall/workspace budgets. Network/checkpoint guards in the worker catch accidental calls; this is not an OS security sandbox. No paid cloud resource is provisioned.

## Commands

From repository root, Python >=3.11, standard library only for the data/control path:

```sh
python scripts/train_market_readout.py demo --output /private/readout-control
python scripts/train_market_readout.py verify --directory /private/readout-control

python scripts/train_market_readout.py train \
  --dataset /private/episodes.json --plan /private/plan.json \
  --output /private/recorded-readout
```

The train command optionally accepts --features for an AAI_FEATURE_EXPORT_V1 file. Export fields are dataset_sha256, pipeline and features. pipeline fixes kind, source_sha256, encoder_sha256 and core_state_sha256. features maps each original episode ID to one finite fixed-width feature vector per quote. Manually supplied exports are untrusted assertions; their shape/hash checks cannot establish that an upstream model ran or that a third-party exporter was causal.

Output directories are created exclusively; existing results are never replaced. They contain private dataset.json, plan.json, features.json, model.json and report.json plus public-trace.json. Files use exclusive creation and mode 0600 where supported. Reproduction verifies exact fitted weights and metrics, not merely a checksum label.

The FlyVis job needs the separate existing Linux CPU environment. CI provisions it using the existing hashed dependency locks and pinned source. See .github/workflows/brain-training.yml and scripts/run_flyvis_training.py. It never installs the model into the standard-library test process.

## Public observer trace

public-trace.json contains aliases, already observed quotes/features, fixed-model predictions and outcomes emitted only when their later quote becomes available. Events form a SHA-256 chain. It is an offline, replayable source for a future observer/stream overlay, not a running broadcast or a trusted wall-clock service. No broadcast account is connected.

Do not stream the private dataset/plan/feature files: they contain future outcomes and source lineage. Redacting names does not prevent recognition of familiar historical charts. Host-controlled files and clocks do not prove an independent holdout.

## Risk checks and later live scope

Token verification is a collection of observations, not a proof of safety. A small successful buy and sell or simulateTransaction result describes a particular amount/state/path at that time. Future program changes, permissions, transfer restrictions, liquidity removal or a different size/path can change outcomes.

Relevant primary references: [Solana transaction simulation](https://solana.com/docs/rpc/http/simulatetransaction), [transfer hooks](https://solana.com/docs/tokens/extensions/transfer-hook), [permanent delegates](https://solana.com/docs/tokens/extensions/permanent-delegate). These checks are not implemented by this numerical trainer.

Bundle/rug labels require separate point-in-time transaction, holder and authority evidence. Common funding/ownership may remain inferred; charts alone cannot establish it. Missing evidence should support abstention, and a probe must not override independent exposure limits.

The first future execution scope remains supervised paper long-spot with full cost/rejection accounting. Perpetuals, forex, stocks and options require separate instrument, market-data, execution, leverage/margin and rights work. A successful spot adapter cannot authorize them automatically.

Funding from collected AAI creator fees or personal funds is a later owner decision. BRAIN/AAI pairing and AAI-denominated holder rewards remain subject to exact-mint/platform checks and the chosen fee allocation; a holder-rewards fee cannot simultaneously be counted as creator development revenue.

No live-money permission, token launch, fee withdrawal, wallet access, deployment or revenue promise is created here.
