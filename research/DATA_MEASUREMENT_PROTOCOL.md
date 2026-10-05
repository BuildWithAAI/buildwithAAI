# BT-001 — Data Dictionary & Measurement Protocol

**Status:** research data contract; initial variable registry. This document defines measurement semantics and does not claim that every listed field is currently collected.

BT-001 implements the data-contract dependency required by [BT-000](BIOLOGICAL_COMPUTE_PROTOCOL.md). It governs research data used by the [Solana Trading Lab](../projects/SOLANA_TRADING_LAB.md) and biological-compute experiments.

## Purpose

Before choosing a model, define what the system is allowed to know, when it could have known it, how each value was produced, and what future outcome is being evaluated.

The goal is a point-in-time research dataset in which raw facts, transformations, estimates, synthetic assumptions, and labels cannot be silently confused.

## Canonical measurement record

Every persisted research measurement should be representable by the following contract:

```text
measurement_id
entity_type
entity_id
feature_id
value
unit
classification
event_time
observed_time
available_time
solana_slot
source_id
source_version
ingestion_version
transform_version
quality_flags
missing_reason
lineage
created_at
```

### Time semantics

- **event_time:** when the underlying event occurred, if known.
- **observed_time:** when the upstream source observed/recorded it.
- **available_time:** earliest time BuildWithAAI could actually have consumed it under the recorded ingestion path.
- **solana_slot:** canonical slot when the measurement is tied to Solana state; null only when not applicable.

Historical replay must gate features by **available_time**, not by a later database insertion timestamp.

## Classification vocabulary

Every feature or measurement must use one of:

- **OBSERVED** — directly reported by an authoritative selected source.
- **DERIVED** — deterministic transformation of recorded inputs.
- **INFERRED** — estimated state not directly observed.
- **LEARNED** — output or representation fitted from training data.
- **SYNTHETIC** — simulation assumption, randomized value, scenario, or engineered substitute.
- **LABEL** — future outcome reserved for training/evaluation according to chronology.

A field cannot change classification silently. A semantic change requires a new feature version.

## Feature-definition requirements

Each registered feature must specify:

```text
feature_id
name
description
classification
entity_type
data_type
unit
source
source_version
formula_or_transform
required_inputs
event_time_rule
available_time_rule
update_frequency
missing_data_rule
quality_checks
known_biases
leakage_risks
valid_range
version
status
```

**status** should be one of `PROPOSED`, `VERIFIED_SOURCE`, `COLLECTING`, `VALIDATED`, or `DEPRECATED`.

A proposed field is not evidence that its provider, API, completeness, latency, or historical availability has been verified.

## Source registry

Each external source must have a source record before production research use:

```text
source_id
provider
dataset_or_api
documentation
access_method
network
coverage
timestamp_semantics
historical_depth
rate_limits
expected_latency
reliability_notes
terms_or_license
cost
credentials_required
verification_date
status
```

Do not fabricate an integration when an API, permission, historical endpoint, or commercial/research-use right has not been verified.

## Initial variable families

The registry begins with seven families. These are candidate measurements, not a claim that they are already available.

### S — Solana ground truth

| Feature ID | Candidate measurement | Class | Unit | Key timing/leakage concern |
| --- | --- | --- | --- | --- |
| S-001 | slot | OBSERVED | slot | preserve commitment/finality context |
| S-002 | block time | OBSERVED | UTC timestamp | block time may differ from local ingestion time |
| S-003 | transaction signature | OBSERVED | identifier | identity, not a numeric feature |
| S-004 | transaction success | OBSERVED | boolean | failed transactions must not disappear from samples |
| S-005 | fee paid | OBSERVED | lamports/SOL | define base vs priority components where available |
| S-006 | compute units consumed | OBSERVED | CU | source/transaction-version coverage must be known |
| S-007 | program IDs invoked | OBSERVED | identifiers | parser/version changes require lineage |
| S-008 | token balance delta | DERIVED | raw units/token units | decimals and account ownership must be point-in-time |
| S-009 | native SOL balance delta | DERIVED | lamports/SOL | distinguish fees from transfers |
| S-010 | transaction ingestion delay | DERIVED | milliseconds | calculated from available_time and event/observed time |

### M — Market and microstructure

| Feature ID | Candidate measurement | Class | Unit | Definition requirement |
| --- | --- | --- | --- | --- |
| M-001 | trade price | OBSERVED/DERIVED | quote/base | source-specific execution definition |
| M-002 | trade size | OBSERVED/DERIVED | base/quote | preserve side and decimals |
| M-003 | rolling return | DERIVED | decimal/% | exact horizon and sampling rule |
| M-004 | realized volatility | DERIVED | defined statistic | estimator and window required |
| M-005 | buy/sell pressure | DERIVED | ratio | aggressor/side inference rule required |
| M-006 | volume | DERIVED | quote/base | venue coverage and window required |
| M-007 | liquidity | OBSERVED/DERIVED | USD/token | pool/venue definition and valuation source required |
| M-008 | effective price impact | DERIVED | bps/% | reference price and size required |
| M-009 | estimated slippage | INFERRED | bps/% | model and executable size required |
| M-010 | transaction/trade velocity | DERIVED | count/time | deduplication and window required |

### T — Token and pool lifecycle

| Feature ID | Candidate measurement | Class | Unit | Definition requirement |
| --- | --- | --- | --- | --- |
| T-001 | token age | DERIVED | seconds | genesis/creation event definition |
| T-002 | circulating/on-chain supply proxy | OBSERVED/DERIVED | tokens | exact supply semantics required |
| T-003 | mint authority state | OBSERVED | state | point-in-time authority required |
| T-004 | freeze authority state | OBSERVED | state | point-in-time authority required |
| T-005 | pool age | DERIVED | seconds | pool creation source required |
| T-006 | liquidity change | DERIVED | amount/% | horizon and valuation required |
| T-007 | holder concentration | DERIVED | ratio | holder definition/exclusions required |
| T-008 | top-N concentration | DERIVED | ratio | N and excluded system/pool accounts required |
| T-009 | unique holder count | DERIVED | count | token-account vs owner-wallet rule required |
| T-010 | lifecycle state | INFERRED | category | model/rules must be versioned |

### W — Wallet behavior and graph state

| Feature ID | Candidate measurement | Class | Unit | Definition requirement |
| --- | --- | --- | --- | --- |
| W-001 | wallet token position delta | DERIVED | tokens | wallet/entity resolution required |
| W-002 | wallet entry time | DERIVED | timestamp | entry definition required |
| W-003 | holding duration | DERIVED | seconds | realized/open-position semantics |
| W-004 | realized outcome | DERIVED/LABEL | return/PnL | classification depends on use and valuation |
| W-005 | wallet concentration | DERIVED | ratio | portfolio coverage required |
| W-006 | repeated counterparty count | DERIVED | count | graph horizon required |
| W-007 | wallet-token interaction edge | DERIVED | edge | event provenance required |
| W-008 | wallet-wallet transfer edge | OBSERVED/DERIVED | edge | ownership/entity inference kept separate |
| W-009 | wallet cluster membership | INFERRED | cluster ID | clustering algorithm/version required |
| W-010 | historical behavior score | LEARNED/DERIVED | score | never call "smart" without explicit metric definition |

### C — Context and attention

| Feature ID | Candidate measurement | Class | Unit | Definition requirement |
| --- | --- | --- | --- | --- |
| C-001 | SOL return context | DERIVED | decimal/% | horizon/source required |
| C-002 | SOL volatility context | DERIVED | statistic | estimator/window required |
| C-003 | network activity context | DERIVED | statistic | constituent measurements required |
| C-004 | token attention volume | OBSERVED/DERIVED | count/time | platform/source and historical availability required |
| C-005 | attention acceleration | DERIVED | rate | exact windows required |
| C-006 | social sentiment | INFERRED/LEARNED | score | source, model, language, timestamp, and calibration required |
| C-007 | market regime | INFERRED/LEARNED | category | regime method/version required |

Social data must not be used in replay unless the historical content and its point-in-time availability can be reconstructed without hindsight.

### Q — Data quality and provenance

| Feature ID | Measurement | Class | Unit |
| --- | --- | --- | --- |
| Q-001 | source latency | DERIVED | milliseconds |
| Q-002 | missing-field count | DERIVED | count |
| Q-003 | parser/version mismatch | DERIVED | boolean |
| Q-004 | duplicate-event flag | DERIVED | boolean |
| Q-005 | stale-observation age | DERIVED | milliseconds |
| Q-006 | source disagreement | DERIVED | statistic/flag |
| Q-007 | completeness score | DERIVED | bounded score |
| Q-008 | finality/commitment state | OBSERVED | category |

Quality features are inputs to research diagnostics and may be model inputs only when their point-in-time availability is valid.

### Y — Outcomes / labels

Labels must answer a precise question. Avoid a universal `BUY` label.

| Feature ID | Candidate outcome | Class | Unit |
| --- | --- | --- | --- |
| Y-001 | forward return at horizon H | LABEL | decimal/% |
| Y-002 | maximum favorable excursion within H | LABEL | decimal/% |
| Y-003 | maximum adverse excursion within H | LABEL | decimal/% |
| Y-004 | target-before-stop event | LABEL | boolean/category |
| Y-005 | liquidity drawdown within H | LABEL | decimal/% |
| Y-006 | executable net return after cost model | LABEL | decimal/% |
| Y-007 | time to threshold | LABEL | seconds |
| Y-008 | survival/no-collapse through H | LABEL | boolean |

Every label must define horizon, reference price/state, sampling convention, missing/censoring behavior, and whether costs are included.

## Multi-horizon policy

Maintain explicit horizons rather than silently mixing them. Initial research may consider, subject to data quality:

```text
10 seconds
1 minute
5 minutes
30 minutes
1 hour
6 hours
24 hours
7 days
```

These are candidate horizons, not mandatory trading targets. Each experiment registers the horizons it actually uses.

## Entity model

Initial entity types:

- transaction
- instruction
- program
- token mint
- token account
- wallet/account
- inferred wallet entity/cluster
- liquidity pool
- venue
- market pair
- social/content object
- network/market context

Never collapse an on-chain account, token account, wallet owner, and inferred human/entity identity into one identifier without explicit resolution lineage.

## Missing data

Missingness is data.

Do not silently replace missing values with zero. Record a reason where possible, for example:

- NOT_APPLICABLE
- SOURCE_UNAVAILABLE
- SOURCE_NOT_YET_AVAILABLE
- PARSE_FAILED
- UNSUPPORTED_VERSION
- RATE_LIMITED
- LATE_ARRIVAL
- UNKNOWN

Imputation is a versioned transformation and must be learned only from permissible training information.

## Leakage firewall

Examples of prohibited leakage include:

- using a wallet's later profitability to label it "smart" at an earlier decision time;
- using current token metadata or holder state in historical replay without historical snapshots;
- using later social engagement totals at the original post timestamp;
- normalizing with statistics computed from future test periods;
- selecting tokens because their eventual outcomes are already known;
- tuning feature definitions repeatedly against the untouched test period;
- deriving a feature from a label or post-outcome field.

Feature-generation code should be testable against a cutoff time and reject inputs whose `available_time` exceeds that cutoff.

## Lineage

Every DERIVED, INFERRED, LEARNED, SYNTHETIC, or LABEL value must identify the source measurements and transform/model version needed to reconstruct it.

Preferred conceptual chain:

```text
source event
  -> normalized observation
  -> validated measurement
  -> derived feature
  -> model input snapshot
  -> prediction
  -> decision
  -> simulated execution
  -> outcome label
```

Predictions and decisions must never be written back into the raw-observation namespace.

## Snapshot contract

A model-input snapshot should include:

```text
snapshot_id
decision_time
decision_slot
entity_id
feature_set_version
feature_values
source_cutoff
quality_summary
missingness_summary
lineage_hash
created_at
```

The snapshot is immutable. Reprocessing creates a new snapshot/version.

## Initial validation tests

Before a feature family is marked VALIDATED, tests should cover as applicable:

1. schema/type/unit validation;
2. timestamp ordering: event_time <= observed_time <= available_time, with documented exceptions;
3. deterministic transform reproducibility;
4. duplicate handling;
5. decimal/unit normalization;
6. slot/time consistency;
7. missingness behavior;
8. cutoff-time leakage rejection;
9. source-version/parser compatibility;
10. known fixture reconstruction;
11. label isolation from feature generation;
12. lineage completeness.

## Data-quality promotion gate

A feature is eligible for model research only when:

- its definition is versioned;
- its source is identified;
- timing semantics are understood;
- missing-data behavior is explicit;
- leakage risks are documented;
- unit/range checks exist;
- lineage is reconstructable;
- historical availability is sufficient for the experiment.

If these conditions are not met, keep the feature PROPOSED or mark the experiment INCONCLUSIVE rather than inventing certainty.

## What BT-001 does not decide

BT-001 does not yet select:

- a commercial Solana RPC/data provider;
- a social-data vendor;
- a database technology;
- a feature-store product;
- a machine-learning framework;
- a biological dataset for the first experiment;
- a live execution venue;
- a wallet-signing architecture.

Those decisions require separate evidence, cost, permission, reliability, and security evaluation.

## Next milestone

After review, the next research-engineering milestone should be **BT-002 — Solana Ground-Truth Acquisition & Replay Specification**.

BT-002 should select and verify source(s), define canonical normalized events, quantify historical coverage and latency, establish storage/replay requirements, and produce a small immutable fixture dataset for testing the BT-001 contract before large-scale collection.

## Measurement principle

> If we cannot state exactly what a number means, where it came from, and what was knowable at that moment, it is not ready to train a model.
