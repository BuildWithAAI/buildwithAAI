# BT-002 — Solana Ground-Truth Acquisition & Replay Specification

**Status:** research acquisition specification. No production provider, paid plan, trading executor, or wallet integration is selected by this document.

BT-002 operationalizes the point-in-time contract in [BT-001](DATA_MEASUREMENT_PROTOCOL.md) for Solana ground-truth data and remains governed by [BT-000](BIOLOGICAL_COMPUTE_PROTOCOL.md).

## Objective

Build a reproducible observation layer capable of answering:

> What did the selected Solana source report, at what slot and commitment, when did BuildWithAAI receive it, and can the exact normalized observation be replayed later?

The first deliverable is not a giant historical database. It is a small immutable fixture that proves acquisition, normalization, provenance, version handling, and replay semantics.

## Verified protocol facts

The following design constraints are based on Solana's official documentation checked on 2026-10-05:

1. Solana exposes JSON-RPC HTTP request/response methods and WebSocket subscriptions.
2. Public Solana RPC endpoints are shared, rate-limited infrastructure and are not intended for production applications.
3. Commitment levels are semantically different:
   - `processed`: newest processed view and may be rolled back;
   - `confirmed`: supermajority-voted view;
   - `finalized`: strongest finalized view.
4. `getBlock` and `getTransaction` expose confirmed ledger/transaction data and transaction metadata.
5. `getFirstAvailableBlock` / `minimumLedgerSlot` exist because a node's locally available ledger has a lower bound; historical availability must therefore be measured rather than assumed.
6. `blockSubscribe` is documented as unstable and requires validator configuration enabling block subscriptions and transaction history.
7. Solana documentation describes Geyser/Yellowstone gRPC as a real-time indexing/streaming path for account, transaction, entry, block, and slot updates.
8. Transaction-version support is a compatibility boundary. Current Solana documentation warns that readers must explicitly support v1 where applicable; incompatible `getBlock`, `getTransaction`, or block-subscription consumers can fail or stop advancing.

These facts justify an adapter architecture and explicit compatibility telemetry rather than binding research semantics to one provider or one transport.

## Acquisition architecture

```text
Solana source(s)
   |
   +-- HTTP RPC backfill / verification
   +-- streaming adapter (provider-supported Geyser/Yellowstone preferred for serious low-latency research)
   +-- WebSocket adapter where appropriate
   |
Raw Envelope Store (append-only)
   |
Normalizer
   |
Canonical Solana Event Store
   |
Point-in-Time Snapshot Builder
   |
Immutable Replay Fixture / Historical Replay
```

Transport and provider are replaceable. Canonical event semantics are not provider-specific.

## Source roles

### Development reference source

The public Solana RPC may be used for small development fixtures, protocol learning, and cross-checks subject to its limits.

It must not be labeled production-grade and must not become a hidden dependency for a future live system.

### Research/production candidate source

Before large-scale or latency-sensitive collection, evaluate private/dedicated infrastructure. Candidate providers are not approved merely because Solana documentation lists them.

A provider evaluation must record:

- supported transports;
- commitment options;
- transaction-version support;
- historical depth;
- archive/backfill behavior;
- Geyser/Yellowstone availability where relevant;
- filtering capabilities;
- documented latency/SLA;
- rate and concurrency limits;
- retry semantics;
- data retention;
- regional endpoints;
- pricing;
- authentication model;
- terms/reuse constraints;
- exportability/vendor-lock-in risk;
- observed failure behavior.

### Redundancy

The architecture should permit at least two independent sources for critical future use. Cross-source disagreement must be recorded, not silently overwritten.

Redundancy is a later operational requirement; BT-002 does not require purchasing multiple providers for the first fixture.

## Commitment and finality model

Do not overwrite an earlier observation when commitment advances.

Represent commitment transitions as observations:

```text
slot X observed PROCESSSED at t1
slot X observed CONFIRMED at t2
slot X observed FINALIZED at t3
```

A replay at t1 must not know t2 or t3.

For each commitment-sensitive record preserve:

- requested/subscribed commitment;
- returned context slot where supplied;
- target slot;
- reception time;
- provider/source;
- source response hash;
- finality/commitment state;
- rollback/orphan information if later observed.

Spelling note: canonical implementation value is `PROCESSED`; the conceptual example above must map to that enum.

## Raw envelope

Before parsing, persist enough information to reproduce what the adapter received:

```text
raw_event_id
source_id
transport
endpoint_class
request_method_or_subscription
request_parameters_hash
requested_commitment
received_at
http_or_stream_sequence
payload_bytes_or_canonical_payload
payload_hash
parser_target_version
ingestion_build
error
```

Secrets, API tokens, authorization headers, and private credentials must never enter the envelope.

For public/research fixtures, redact endpoint credentials and preserve only a non-secret source identifier.

## Canonical block record

Minimum normalized block fields:

```text
cluster
slot
block_height
block_time
blockhash
previous_blockhash
parent_slot
commitment
source_id
observed_time
available_time
transaction_count
rewards_present
transaction_version_summary
raw_event_id
normalizer_version
quality_flags
```

`block_time` is source/ledger metadata and may be null. It must not substitute for local `available_time`.

## Canonical transaction record

Minimum normalized transaction fields:

```text
cluster
signature
slot
block_time
commitment
transaction_version
success
error
fee_lamports
compute_units_consumed
account_keys
loaded_addresses
pre_balances
post_balances
pre_token_balances
post_token_balances
instructions
inner_instructions
log_messages
source_id
observed_time
available_time
raw_event_id
normalizer_version
quality_flags
```

Optional/missing RPC fields remain explicitly missing. Do not manufacture zero values.

## Transaction-version invariant

Every adapter must expose:

```text
max_supported_transaction_version
observed_transaction_version
unsupported_version_count
last_compatible_slot
parser_version
```

An unsupported transaction version is a **hard data-quality failure**, not an empty block or no-activity event.

The collector must fail visibly or quarantine affected observations rather than silently advancing an incomplete dataset.

## Ordering model

Do not assume local arrival order equals canonical transaction execution order.

Preserve at minimum:

- slot;
- block transaction index when derived from a full block;
- instruction index;
- inner-instruction index where available;
- source stream sequence where available;
- observed/available time.

If a source cannot establish an ordering field, mark it unknown.

## Failure taxonomy

Acquisition failures should use explicit categories such as:

- RATE_LIMITED
- AUTH_FAILED
- PROVIDER_UNAVAILABLE
- TIMEOUT
- STREAM_DISCONNECTED
- GAP_DETECTED
- UNSUPPORTED_TRANSACTION_VERSION
- PARSE_FAILED
- BLOCK_UNAVAILABLE
- HISTORY_PRUNED
- COMMITMENT_NOT_REACHED
- SOURCE_DISAGREEMENT
- CHECKSUM_MISMATCH
- UNKNOWN

Failures are research data and belong in the acquisition ledger.

## Gap detection

The collector/replay layer must be able to identify missing expected coverage.

For block-oriented fixtures:

1. record requested slot range;
2. obtain the list of available block slots;
3. distinguish skipped/non-produced slots from provider/history failures;
4. fetch normalized blocks;
5. record failures without silently dropping them;
6. verify continuity against the recorded availability response.

A missing slot is not automatically a missing block.

## Replay contract

Replay consumes immutable raw/normalized fixture records and emits events according to recorded canonical order and/or recorded availability time.

Required replay modes:

- **CANONICAL_ORDER** — deterministic ledger-oriented reconstruction;
- **AVAILABLE_TIME** — reproduces what the research system could have known through the recorded ingestion path;
- **COMMITMENT_FILTERED** — exposes only observations meeting the requested commitment as of replay time.

Replay must never call a live provider to fill fixture gaps silently.

## First fixture

The first fixture should be intentionally small.

Proposed acceptance target:

- one explicitly recorded cluster;
- one contiguous requested slot window small enough for repository/test handling;
- available block-slot manifest;
- raw response hashes;
- normalized blocks;
- successful and failed transactions if naturally present;
- legacy/v0/v1 version coverage where naturally available, or explicit documented absence;
- at least one token-balance example if naturally present;
- commitment metadata;
- acquisition timestamps;
- parser/normalizer version;
- fixture manifest and content hashes.

Do not cherry-pick a slot window because it produces an interesting trading outcome. The fixture is for correctness testing, not strategy performance.

If repository size makes raw fixture payloads inappropriate, store a minimal redacted/canonical test subset and document how the external immutable source artifact is hashed and retrieved. Do not commit secrets or large uncontrolled dumps.

## Fixture manifest

```text
fixture_id
created_at
cluster
source_id
source_verification_date
requested_start_slot
requested_end_slot
commitment
transaction_version_support
acquisition_build
normalizer_version
raw_record_count
normalized_block_count
normalized_transaction_count
failure_count
manifest_hash
records_hash
notes
```

## Verification tests

BT-002 implementation is not accepted until automated tests cover:

1. deterministic normalization of the same raw envelope;
2. stable hashes for immutable fixtures;
3. no secret/auth material in stored fixture records;
4. block/transaction linkage;
5. failed-transaction preservation;
6. null/missing field preservation;
7. lamport/token decimal handling;
8. transaction-version compatibility failure behavior;
9. gap detection;
10. commitment filtering;
11. available-time cutoff enforcement;
12. replay determinism;
13. parser/normalizer version recording;
14. source-response lineage back to raw envelope.

## Provider benchmark protocol

Before selecting production research infrastructure, run the same bounded read workload against candidate sources where terms and access permit.

Measure:

- successful response rate;
- p50/p95/p99 response latency;
- stream delivery lag where available;
- disconnect/recovery behavior;
- historical availability;
- version compatibility;
- missing/null differences;
- rate-limit behavior;
- cross-source disagreement;
- cost for the measured workload.

Do not use vendor marketing latency as experimental latency.

## Security boundary

BT-002 is read-only acquisition and replay.

It does not authorize:

- `sendTransaction`;
- wallet connection;
- signing;
- seed/private-key collection;
- trading;
- custody;
- production credentials in source control.

Provider credentials must use environment/secret management outside committed fixtures.

## Provider-selection decision rule

Do not choose a provider solely because it is popular or fastest.

The selected research path must satisfy the required historical coverage, correctness, version compatibility, exportability, reliability, latency, terms, and cost. A hybrid approach may be preferable: streaming for point-in-time capture plus RPC/archive access for verification and backfill.

## Next implementation milestone

After BT-002 is reviewed, implement **BT-003 — Solana Fixture Collector & Deterministic Replay Harness**.

BT-003 should be the first runtime research code in this sequence. It should:

1. use a small read-only development source;
2. acquire the approved bounded fixture;
3. store raw envelopes without credentials;
4. normalize to BT-002 records;
5. generate the fixture manifest/hashes;
6. replay deterministically;
7. enforce cutoff/commitment/version rules;
8. run automated correctness tests.

Only after BT-003 passes should we discuss broad historical ingestion.

## Ground-truth principle

> Preserve what the source actually said, preserve when we could know it, and make every transformation replayable.
