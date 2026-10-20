# AAI.fun — frozen neural activity for trade readouts

This connects the transaction-atomic trade dataset to the existing pinned FlyVis visual-circuit model. The numerical control and neural-feature path use the same source dataset, split plan, target and optimizer. Only the output readout is trained; the biological model stays frozen.

Actual execution status comes from the hosted native CPU job. The standard-library regression tests deliberately use fake vectors to test schemas/fitting; those tests cannot establish that a biological model ran.

## Connection

Recorded archive -> source verification -> transaction observations -> five causal features -> explicitly synthetic grayscale encoding -> frozen FlyVis activity -> 57 non-input central cell-type values -> fitted logistic readout -> delayed prediction/outcome trace.

The visual encoder repeats the five features across 721 input hexals at one numerical step per observation. Its 0.005-second step is engineering time compression. It is not an assertion about physical neural/market time or a biological understanding of money. Episodes reset to the upstream initial state without gray warm-up.

No raw feature columns are appended to the neural readout. R1-R8 photoreceptor inputs are excluded. Different connected components of this one model are not independent committee voters. Multi-brain fusion and biological-core fine-tuning remain open.

The shared frozen_runtime.py now serves both the earlier quote experiment and this trade experiment. It retains pinned source/assets, weights_only loading, strict finite tensor shapes, CPU determinism, model size checks, parameter freezing and exact cell order. The old quote encoder metadata remains the same.

## Feature contract

AAI_TRADE_NEURAL_FEATURES_V1 binds the dataset digest, source classification, model checkpoint, upstream commit, connectome, frozen core state, encoder recipe/input-schema digest and exact 57-cell order. It requires one finite 57-value vector per observation, the exact episode-ID set and no unknown fields.

Neural execution is bounded to 64 episodes, 512 rows per episode and 2,048 rows total. Oversized input is rejected rather than truncated. Encoder input must contain exactly five finite values in [-1,1]. These bounds supplement the existing raw-archive and trade-data limits.

Manual exports are assertions. Matching metadata and hashes cannot prove that an upstream model executed or that an exporter avoided future data. execution_attestation remains NOT_ESTABLISHED, including when an artifact is used for fitting. The native run evidence must be inspected separately.

The readout model pins the whole feature export. The source/readout verifier refuses missing, changed, mismatched or unexpected exports; it never silently falls back to five raw features. Source reconstruction, targets, fitted weights, held-out metrics and the public trace are reproduced using the retained export.

That standard-library verifier does not rerun the biological model. Its neural_reexecution_performed flag stays false. It must not be presented as independent neural execution attestation.

## Actual CPU acceptance checks

The native integration loads the registered published checkpoint and runs the full 45,669-node / 1,513,231-edge network. It must verify:

- The loaded core matches the registered inference-state hash and stays unchanged.
- Repeating an episode after other episodes reproduces its activity.
- Changing the final three observations cannot change earlier activity.
- Perturbing signed flow changes retained non-input activity in the synthetic sensitivity check.
- The neural readout has changed weights and lower fixture training loss.
- Raw and neural controls share exactly the same dataset and plan.
- A second process reloads the checkpoint with a separate cache directory and exactly regenerates the complete synthetic feature export.
- When a real source package is provided, both processes also extract and exactly reproduce its neural features, with no real-data readout fitting.
- A further standard-library process re-fits the saved readout and verifies its trace.

These are measured software/inference checks, not evidence of financial skill, profitable execution, a neural advantage or full paper replication. The comparison reports log loss, Brier score and accuracy for both controls; it does not require the neural path to outperform the raw path.

## Real source observations

The CI job captures a finalized mainnet block and reconstructs its supported transactions before model execution. Real source features are saved separately from synthetic training results. Their assessment retains training_performed=false and training_ready=false until an adequate explicit historical plan is validated elsewhere.

A tiny real sample can establish source-to-model inference wiring. It cannot establish a historical training cohort, historical observer latency, complete program-state reconstruction, executable bid/ask/depth or live-money transfer. The original decoder coverage and unmapped-event limits still apply.

## Supervision and evidence

The host verifies the pinned upstream checkout before and after each worker. Model assets are downloaded only by the host and hash-checked. Workers receive no inherited production credentials. Accidental network/additional-checkpoint guards, 850-second CPU limits, 900-second wall limits, 6-GiB RSS checks and a combined 512-MiB temporary-workspace bound apply. Each phase uses a separate cache directory. These are process controls, not an OS security sandbox.

Evidence includes code/model/encoder hashes, core state before/after, source classification, feature-export hashes, readout hashes, per-phase resources, a raw/neural comparison and native reexecution results. Individual JSON files retain the existing 16-MiB bound. No signed attestation or independent provider corroboration is added by a hosted CI log.

## Commands

Use the existing separately installed, pinned Linux CPU environment:

~~~sh
python scripts/run_flyvis_trade.py \
  --source .flyvis-upstream --python .flyvis-venv/bin/python \
  --output /private/aai-neural-trade \
  --real-source /private/aai-prepared-real-source
~~~

Omit --real-source for the synthetic learning/inference integration only. An optional real source package must have RPC_CAPTURE classification and at least one supported observation; no synthetic fallback is substituted.

Standard-library use of a retained neural export:

~~~sh
python scripts/train_trade_readout.py train \
  --source /private/aai-prepared-source --plan /private/trade-plan.json \
  --features /private/neural-features.json --output /private/aai-neural-readout

python scripts/train_trade_readout.py verify --directory /private/aai-neural-readout
~~~

The native integration writes raw-control, neural-training and optional real-input packages, real-features.json, comparison.json, fit-evidence.json, reexecute-evidence.json and summary.json. Raw inputs and feature packages contain future/private lineage and are not stream overlays. Only the anonymous public trace is intended for a future observer.

No wallet, signer, live order, funding, paid provider, token launch, website publication, merge or deployment is introduced.
