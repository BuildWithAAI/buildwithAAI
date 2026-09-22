# Solana Trading Lab

**Status:** research idea; no trading model or execution system is delivered by this brief.

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
