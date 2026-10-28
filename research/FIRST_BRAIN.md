# First brain — locked spec

Locked with the founder on 2026-10-27. This is research. It does not send orders, hold funds, or claim a trading edge.

## Wiring

- Source: Janelia FlyEM hemibrain v1.2, Scheffer et al. 2020, eLife 57443.
- License: CC-BY-4.0. Attribution stays in `research/brain-assets/ATTRIBUTION.md`. No Janelia or HHMI endorsement.
- Fixture: `research/brain-assets/hemibrain_v1_2_first128.json`.
- Graph SHA-256: `014a6eebb4ff0586e6a94acb88b188ba0ddaf8421a924dad16cd104ad16cd43b`.
- 128 traced body IDs, 1,055 directed observed synapse-count edges. External edges are omitted, not zeroed.
- FlyWire is not this brain. FlyVis pretrained optic-flow weights are not this brain.

## Dynamics, encoder, readout (ours)

The connectome file still says `neuronal_dynamics: NOT_IMPLEMENTED`. The trainer adds a labeled synthetic rule:

- Four discrete steps.
- `h <- tanh(0.5 h + incoming + encoder(x))`.
- Incoming is the synapse-count weighted state, divided by the postsynaptic synapse total.
- One learned gain per presynaptic cell, start 0.05, clipped to [-1, 1].
- Encoder writes the four causal features onto the first eight selected IDs, alternating sign. Features are decision-time only.
- Readout is a learned linear map from the last eight selected IDs, plus a bias.

The control is a degree-preserving rewire: same out-stubs and weights, shuffled targets, same training budget and seed protocol.

## Market question

Will the pool's executable price fall by at least 15 percent over the next 5 minutes (`horizon_ms = 300000`) after a 1 percent fee?

Features, all known at the decision time:

1. signed return so far
2. flow imbalance
3. liquidity change
4. distance to the adverse band already observed

Label is 1 only when that future drop happens. The middle time window sets how close to 0.5 the brain must be before it abstains (`UNCALIBRATED`). The last window is scored once. Earliest window trains.

Rows must come from the existing causal Solana replay. Until those rows are bound, the module's self-check is `SYNTHETIC_SELF_CHECK` and `market_skill` is `NOT_ESTABLISHED`.

## Receipt

Module id `fly_hemibrain_adverse_v1`. Every receipt sets `action` to `NO_EXECUTION` and `execution_allowed` to false. A score is parts-per-million, or an abstain. It is not an order.

## What this is for in the economy

One hireable specialist. Later brains use the same receipt shape. Agreement across brains is a research candidate, still not a wallet.
