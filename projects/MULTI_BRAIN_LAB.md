# Multi-Brain Trading Experiment

**Status: RESEARCH DIRECTION — early founder priority.** Working community nickname: **Frankenbrain**, not a finalized product name or token. This expands the [Solana Trading Lab](SOLANA_TRADING_LAB.md); it retains jellyfish-inspired exploration.

## Research question

Can computational modules informed by different biological wiring datasets, connected through an engineered interface, improve any measured behavior on a fixed market-data task compared with simpler or randomized alternatives?

This is a deliberately playful community experiment with a reproducible research goal. No trading advantage, complete animal simulation, consciousness, or real-money readiness is claimed.

## Source audit first

Use [BRAIN_DATASETS.md](../research/BRAIN_DATASETS.md) as the initial, non-exhaustive inventory. Candidates include fly, worm, tadpole, mouse, jellyfish, and other available studies. Cat, monkey, and crow are founder-suggested audit targets, not verified complete available connectomes.

Distinguish neuron/synapse-level reconstructions, regional connectivity atlases, functional recordings, and model-generated circuits. Record specimen/version, covered anatomy, missing data, license, access, compute requirements, and exact attribution. Publicly readable does not automatically mean permitted commercial use. Token marketing and an animal name are not biological evidence.

## Candidate implementation approaches — not selected yet

1. **Separate modules with a combiner:** modules consume documented market features; a separate model combines their outputs.
2. **Coupled modules:** designed interfaces allow modules to exchange internal signals. This is closer to one network but harder to interpret and test.

Cross-species links are engineering decisions, not observed biological connections. Connectivity alone does not supply all neuron dynamics, learning rules, time scales, market-feature encoding, or decision readouts. Clearly label every synthetic assumption. Start with compact connectivity tables or a justified subgraph rather than requiring raw imaging downloads.

## Proposed milestones

1. Inventory and classify sources, reuse terms, access, and missing information.
2. Propose one manageable dataset and a fixed offline task, with a cost estimate.
3. After scope and licensing review, implement one reproducible module and document preprocessing.
4. Add a second module and an explicit interface.
5. Compare each module, the combination, simple strategies, no-trade behavior, and similarly sized randomized networks under the same data/cost budget.
6. Publish code where licensed, configuration, seeds, data/version hashes, assumptions, and negative findings.

Use chronological training/validation/test separation, no future-data leakage, realistic fees/slippage/liquidity/latency and failed-fill assumptions. Report drawdown, losses, sample sizes, uncertainty, and compute cost. Reserve an untouched evaluation period rather than repeatedly tuning on the test set. More neurons and more animal names are not evidence of advantage.

## Community and visualization

Contributors can audit papers, classify data, test assumptions, implement modules, or create a display of actual recorded activity, disagreements, outputs, and results. Synthetic activity must be labeled. Screenshots do not substitute for experiment records.

**First target:** a verified inventory, followed if accepted by two documented modules and a public offline/paper benchmark. No model is implemented by this documentation update and no complete dataset collection has been performed. No wallet, live trading, or creator-fee account access is approved.

[Proposal AAI-P-0011](../proposals/ideas/AAI-P-0011-multi-brain.md) · [Early task AAI-T-023](../tasks/BACKLOG.md#aai-t-023) · [Tasks AAI-T-036–038](../tasks/BACKLOG.md#aai-t-036)
