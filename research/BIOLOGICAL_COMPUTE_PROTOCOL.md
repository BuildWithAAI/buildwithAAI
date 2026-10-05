# BT-000 — Biological Compute Research Protocol

**Status:** governing research protocol; does not authorize live trading, wallet access, or claims of biological or financial advantage.

## Purpose

BT-000 defines the minimum scientific standard for experiments that use biological connectivity, nervous-system data, or bio-inspired topology in BuildWithAAI trading research.

The purpose is not to prove that an animal-derived architecture works. The experimental design must be capable of showing that it does not.

This protocol governs biological-compute work referenced by the [Multi-Brain Trading Experiment](../projects/MULTI_BRAIN_LAB.md) and [Solana Trading Lab](../projects/SOLANA_TRADING_LAB.md). Candidate source material is tracked in [BRAIN_DATASETS.md](BRAIN_DATASETS.md).

## Core distinction

A connectome or connectivity atlas is not a complete executable brain. Connectivity does not by itself specify all neuronal dynamics, learning rules, state, sensory encoding, time constants, or decision readouts.

Every experiment must distinguish:

- **OBSERVED:** directly supported by the selected source/dataset.
- **DERIVED:** deterministically calculated from observed data.
- **INFERRED:** estimated from evidence but not directly observed.
- **LEARNED:** fitted from training data.
- **SYNTHETIC:** an engineering choice, simulation assumption, randomized value, or invented interface.
- **LABEL:** a future outcome used only for evaluation/training under documented chronology.

Species names are dataset identifiers, not model personalities. Claims such as "crow intelligence" or "fly conviction" are not scientific variables.

## Required experiment registration

Before training or evaluation, create an immutable experiment record containing:

1. experiment ID and hypothesis;
2. exact prediction or representation task;
3. biological source, version, specimen/scope, license/reuse status, and source citation;
4. market dataset/version or content hash;
5. feature-set version;
6. target/label definition and horizon;
7. train, validation, and untouched test windows;
8. preprocessing and missing-data rules;
9. model architecture and parameter budget;
10. random seeds;
11. planned baselines, controls, and ablations;
12. primary and secondary metrics;
13. cost/slippage/latency assumptions where financial outcomes are evaluated;
14. predefined PASS, INCONCLUSIVE, and REJECT criteria;
15. known limitations and possible leakage paths.

Changing a registered hypothesis, test window, primary metric, or pass criterion creates a new experiment version. Do not silently rewrite a failed experiment.

## Point-in-time data rule

At simulated decision time t, a model may consume only information that was actually available at or before t under the documented ingestion delay.

Later-known prices, labels, token outcomes, wallet classifications, corrected metadata, social observations, or post-event knowledge must not enter historical features unless their original point-in-time availability is demonstrated.

Raw facts, derived measurements, model estimates, and labels must remain distinguishable in storage and interfaces.

## Mandatory baseline ladder

A biological model is not evaluated in isolation. Where applicable, compare against:

1. no-action / no-trade;
2. simple deterministic heuristic;
3. linear or logistic baseline;
4. conventional tree or comparable tabular model;
5. standard neural baseline of justified capacity;
6. standard graph model when graph structure is central;
7. biological topology under test.

The simplest appropriate baseline that performs competitively should be preferred unless added complexity demonstrates reproducible value.

## Mandatory topology controls

For topology-based biological experiments, include controls sufficient to test whether topology itself contributes information. As applicable:

- fully randomized graph;
- degree-matched randomized graph;
- edge-shuffled biological graph;
- randomized weights on fixed biological topology;
- comparable parameter-count conventional network;
- topology ablation or lesion tests;
- input-feature ablations;
- module-removal ablations for multi-module experiments.

If a claimed advantage disappears against an appropriate structural control, do not attribute the result to biological topology.

## Chronological validation

Financial evaluation must respect time.

Use chronological train/validation/test separation. For overlapping labels or event windows, use purging/embargo or another documented leakage-control procedure where appropriate. Prefer walk-forward evaluation across multiple market periods and regimes.

The final test period is an evaluation asset, not a tuning surface. Repeated test-set inspection requires a new untouched test period or explicit classification of subsequent results as exploratory.

## Multiple testing and research debt

Record every material model/feature/topology trial, including failures.

Do not report only the best seed, species, architecture, window, token subset, or hyperparameter configuration. Track the number of attempted hypotheses and configurations so selection effects can be assessed.

Where strategy-performance statistics are used, evaluate the impact of multiple testing and backtest overfitting with an appropriate documented method. A high headline return or Sharpe ratio alone is not promotion evidence.

## Reproducibility requirements

A result intended for promotion must preserve, where licensing permits:

- source and dataset versions/hashes;
- code commit;
- environment/dependency lock;
- configuration;
- preprocessing version;
- feature and label versions;
- seeds;
- train/validation/test boundaries;
- evaluation outputs;
- hardware/compute notes when material;
- assumptions and known deviations.

A second run from the preserved specification should reproduce the result within predefined tolerance.

## Uncertainty and abstention

Models should produce calibrated probabilities or uncertainty measures when the task supports them. Evaluate calibration separately from discrimination or return.

Model disagreement is data. An ensemble or decision system must be permitted to return **ABSTAIN**. Consensus count alone is not sufficient evidence for a decision.

## Financial evaluation

When translating model output into simulated trading outcomes, separate:

**model prediction -> decision policy -> risk policy -> execution model -> realized simulated outcome**

Include realistic assumptions for relevant fees, spread, slippage, latency, liquidity, transaction failure, and position limits. Report assumptions prominently.

The biological/model layer must not control or override the independent risk policy.

## Regime and stability testing

A promoted result must not depend entirely on one favorable period. Evaluate performance and calibration across relevant regimes such as volatility, liquidity, token lifecycle, market direction, and data-quality conditions.

Report where the model fails. Regime-specific usefulness may be valid; universal superiority must not be inferred from local success.

## Promotion gates

### PASS

A result may advance to the next research stage only when it:

- beats the predefined relevant baselines/controls on the registered primary metric;
- survives required ablations;
- remains acceptable on untouched chronological data;
- reproduces across the required seeds/runs;
- meets predefined uncertainty/calibration requirements where applicable;
- remains viable after documented realistic costs where trading outcomes are claimed;
- has no unresolved critical leakage or provenance defect;
- satisfies dataset/license constraints for the proposed next use.

PASS means permission to continue research. It does not mean profitable, safe, production-ready, or biologically faithful.

### INCONCLUSIVE

Use when evidence is insufficient, unstable, underpowered, license-limited, materially affected by missing data, or sensitive to reasonable experimental choices.

An inconclusive result must not be marketed as positive evidence.

### REJECT

Reject the tested hypothesis when the registered experiment fails its predefined criterion, an appropriate control explains the apparent advantage, results fail to reproduce, or a critical methodological defect invalidates the claim.

Preserve rejected experiments in the research ledger.

## Multi-brain / fusion rule

Do not promote a system merely because several biological modules agree.

Each module must first be characterized independently. A fusion model must be compared with its components, simple averaging/voting, and appropriate conventional ensembles. Fusion should consume explicit model outputs and uncertainty, not anthropomorphic "opinions."

Cross-species connections are synthetic engineering unless directly supported by a source. They must be labeled as such.

## Security and execution boundary

BT-000 authorizes research specification only.

It does **not** authorize:

- collection of seed phrases or private keys;
- custody of user funds;
- live wallet signing;
- autonomous trade execution;
- bypassing the repository's existing trading/security boundaries;
- claims of profitability or safety.

Replay and paper experiments remain the approved environment unless a later owner-visible proposal changes that boundary.

## Research ledger minimum record

Every registered experiment should ultimately have a machine-readable record containing:

```text
experiment_id
parent_experiment_id
hypothesis
status
code_commit
data_version
feature_version
label_version
biological_source_version
architecture_version
controls
ablations
seeds
train_window
validation_window
test_window
primary_metric
secondary_metrics
cost_model_version
results
uncertainty
known_limitations
decision
decision_reason
created_at
```

The schema may evolve, but historical records should remain interpretable.

## BT-001 dependency

Before model implementation, define **BT-001 — Data Dictionary & Measurement Protocol**.

BT-001 should enumerate candidate Solana, market, wallet, token, graph, social/context, and outcome variables and record for each:

- definition and unit;
- source and provenance;
- timestamp/slot semantics;
- update frequency;
- point-in-time availability;
- missing-data behavior;
- transformation lineage;
- reliability/data-quality flags;
- leakage risk;
- classification as OBSERVED, DERIVED, INFERRED, LEARNED, SYNTHETIC, or LABEL.

No large biological-model implementation should begin until the data and measurement contract is accepted.

## Scientific principle

> The architecture does not get to prove the hypothesis. The experiment must be capable of disproving it.

If a simple model wins, use the simple model. If biological topology survives appropriate controls and contributes reproducible value, investigate it further. Negative results are useful results.
