# Solana Trading Lab

**Status:** research with a reviewable [BT-005 offline SFP paper tester](sfp-paper-lab/README.md). Synthetic engine tests exist; market performance and any execution system remain unverified/unimplemented.

## The idea

Explore a Solana trading bot with a distinctive experimental decision model. The founder is interested in a jellyfish-inspired approach and has also explored crow-inspired ideas. The specific biological dataset, architecture, and licensing have not been selected or verified.

The first question is whether a reproducible model offers any useful behavior beyond simple baselines. An animal's reputation for intelligence is not an evaluation metric.

## Proposed first version

A replay or paper-trading experiment with:

- A fixed, timestamped input dataset and documented missing-data handling.
- Simple baseline strategies and a no-trade comparison.
- A clearly specified experimental model.
- Simulated execution with fees, spread, slippage, latency, liquidity limits, and failed fills.
- A report separating model output from the portfolio and risk rules.

The data available at each simulated decision must reflect that time. Future prices and later-known token outcomes must not leak into decisions.

## Biological claims need evidence

Before using terms such as mapped brain or biological simulation, identify the primary research, species, dataset, resolution, license, and exact parts represented in software. A conceptual analogy should be called bio-inspired. This project currently makes no claim to reproduce a jellyfish nervous system or demonstrate a trading advantage.

## Current security boundary

This work is restricted to offline replay and paper simulation. The community policy prohibits automatic trade execution and wallet-secret collection. A wallet connection, Phantom integration or execution system is not approved. Reconsidering execution would require an explicit owner-visible policy proposal, additional review and a separate design; this brief does not authorize it.

## First community output

Produce a source-and-dataset inventory and a small evaluation specification. Include a conclusion that the proposed model is unsuitable if the evidence supports it.

See [task AAI-T-023](../tasks/BACKLOG.md#aai-t-023) and the [earlier starter task AAI-003](../tasks/STARTER_TASKS.md).

## New early priority: Multi-Brain Trading Experiment

The founder wants the [multi-brain source audit and proposed module experiment](MULTI_BRAIN_LAB.md) brought forward early. It expands this lab and preserves jellyfish-inspired exploration. See the [initial, non-exhaustive source inventory](../research/BRAIN_DATASETS.md). Cat, monkey, crow, and jellyfish candidates remain verification targets where no suitable resource has been established.

The first step is source/permission/scope research, then a separately accepted small offline/paper prototype. Compare each module, the combination, simple/no-trade approaches, and comparable randomized networks. No model, biological advantage, or creator-fee account access is delivered here.

## Swing failure pattern research — October 14, 2026

The founder requested SFPs as an addition to the swing-strategy research. [BT-004: research dossier and evaluation protocol](../research/SWING_FAILURE_PATTERNS.md) separates observable sweep/reclaim geometry from inferred stop activity, defines causal pivots and three proposed entry variants, and specifies costs, baselines, unseen testing and rejection criteria. [AAI-T-041](../tasks/BACKLOG.md#aai-t-041) tracks the remaining evidence and study work.

SFP source research and a protocol are available. The subsequent [BT-005 tester](sfp-paper-lab/README.md) implements causal pivots, A/B/C long paper variants, cash/trend baselines, costs/latency, loss and open-position accounting, offline CSV import and verifiable report exports. Its synthetic acceptance fixture demonstrates software behavior; it establishes no historical performance study or profitable strategy. Bearish events do not create spot-short permission. Offline replay and paper simulation boundaries remain in force; Forex/XAUUSD replication has its own data, broker and evaluation requirements.

## BT-006: chronological testing and community data

Version 0.2.0 adds the [frozen-plan study workflow](sfp-paper-lab/STUDY.md). It runs A/B/C plus cash, trend, full-capital buy-and-hold and training-density time controls, retains doubled-cost/delayed trials and exports a portable HTML ledger. The generated example has three folds and 72 trials. Inputs and fills are synthetic; numeric screens do not authorize a strategy. Independent fold accounts are not a treasury and their results cannot be summed into buy/burn funding. Exact exposure matching, historical executable quotes, untouched forward evaluation and selection-risk analysis remain pending.

## BT-007: persistent notebook and original data receipts

[The local research notebook](sfp-paper-lab/NOTEBOOK.md) retains a frozen baseline, original incremental CSVs and all recorded study reports. History revisions/backfills, duplicate captures and stale exports are rejected; explicit checkpoint verification and full matching-engine replay are available. A ten-file portable report carries the raw history and latest study. This establishes local software consistency, not source truth, independent unseen evaluation or an accepted funded strategy.
