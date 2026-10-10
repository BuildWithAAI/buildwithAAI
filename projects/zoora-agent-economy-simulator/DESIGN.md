# AE-001 simulation foundation design

The existing four-layer architecture is preserved: kernel, minimal economy, observation layer, and normal scenario. The processor alone mutates engine accounts. The implementation is deliberately single-threaded and offline.

## Ordering and identifiers

The scheduler is a min-queue ordered by `(simulation_tick, priority, sequence)`, with lower values first. It refuses duplicate event IDs and duplicate scheduling sequences before admission; both sets survive popped events. This makes comparison ties impossible for admitted events and keeps heap equality/ordering consistent.

A scheduling sequence is a unique tie-breaker, not a globally increasing execution counter: priority can legitimately reorder different sequences. Journals use a separate contiguous `processed_index` beginning at zero. Replay requires strict lexicographic execution order, unique IDs/sequences, contiguous processed indices, and ticks inside the configuration horizon. Admission is bounded at 100,000 lifetime requests, independent of queue drains.

Manual events cannot be appended before processed history. Normal runs require an empty fresh engine and generate exactly one request per tick, using tick as ID and scheduling sequence. Completed normal engines cannot accept manual events or restart the scenario.

## Atomic economics and outcomes

Each transfer stores both its intent and computed outcome. Validation precedence is:

1. Nonpositive amount: `INVALID_AMOUNT`.
2. Identical parties: `SAME_AGENT`.
3. Missing sender: `UNKNOWN_SENDER`.
4. Missing recipient: `UNKNOWN_RECIPIENT`.
5. Sender balance below amount: `INSUFFICIENT_FUNDS`.
6. Recipient checked addition exceeds `i64::MAX`: `RECIPIENT_OVERFLOW`.
7. Otherwise: `COMPLETED`.

A rejection changes no balances and is journaled/counted like a successful request. Expected economic refusal does not terminate the run. Positive amounts bounded by sender balance make sender subtraction safe. Recipient addition is checked. Metrics are computed on a copy before balances, tick, journal, or event log are committed. Metadata/integrity/capacity errors precede account mutations and fail the operation.

Balances are nonnegative signed 64-bit integers. The total initial supply is account count times starting balance; total supply and cumulative transferred units use `u128`. Every queue drain audits account IDs, nonnegativity, conservation, journal integrity, event-log equality, and recomputed observer metrics. Processing does not sum every account on each request, avoiding a requests-times-accounts scan.

## Reproducibility

ChaCha8Rng uses `rand_chacha = 0.3.1`, `rand_core = 0.6.4`, and `seed_from_u64`. The identity records those versions and seeding method. Bounded selection uses rejection sampling with threshold `2^64 mod bound`, avoiding modulo bias. Recipient selection draws from N-1 possibilities and skips the sender.

Run reports contain no elapsed or wall-clock time. Measured scaling durations live in a separate artifact. CI compares complete report bytes from debug and release executables; invariant/RNG/replay tests run on Linux and Windows.

## Journal and report verification

Journals record `{processed_index, event, outcome}`. Replay validates the entire journal before executing it in a new disposable engine, then compares each recorded outcome with the recomputed outcome. Failed replay does not modify an existing engine.

Report schema 1 includes immutable identity/classification/unit, scenario, config, journal, final snapshot, metrics, summary, and fingerprints. Verification compares every field against replay-derived data, including final balances, counters, concentration, and hashes. Normal reports must additionally match regeneration from the recorded config and seed; a shortened or substituted journal cannot claim a complete normal scenario merely because it replays. Empty manual journals are explicit no-op runs.

JSON rejects unknown fields and unsupported schema/RNG/simulator identities. Journal and snapshot array deserializers stop at 100,000 entries; the CLI also bounds total file bytes. Bare library deserialization is not a security sandbox: callers handling hostile data must apply their own input-size and execution budgets.

## Canonical fingerprint schema 1

All hashes use SHA-256. Each stream begins with a UTF-8 string `ZOORA_AE_FINGERPRINT_V1` and a domain string. Strings are prefixed by their byte length as big-endian u64; u64, u32, and i64 values use fixed-width big-endian encoding.

- `CONFIG`: agent_count/u64, starting_balance/i64, ticks/u64, seed/u64.
- `INITIAL_STATE` and `FINAL_STATE`: tick/u64, account_count/u64, followed by account ID/u64 and balance/i64 in account order. Event history is hashed separately.
- `JOURNAL`: record_count/u64; each record is processed_index/u64, event_id/u64, simulation_tick/u64, priority/u32, sequence/u64, transfer_tag/u32 (0), from/u64, to/u64, amount/i64, outcome_tag/u32. Completed tag is 0. Rejected tag is 1 followed by reason/u32: invalid amount 0, same agent 1, unknown sender 2, unknown recipient 3, insufficient funds 4, recipient overflow 5.
- `RUN`: fingerprint_schema/u32 (1), simulator version string, RNG identity string, then config, initial-state, journal, and final-state hash strings as lowercase hexadecimal.

The run fingerprint binds content and algorithm identity. It does not authenticate an author or prove real-world behavior. Report scenario identity is verified by replay/regeneration; fingerprints identify the underlying configured transition history. An independent Python SHA-256 vector checks all five hashes in the Rust suite.

## Observation

Metrics count processed events, requested/completed/rejected transfers, simulated volume, and refusals by reason. Summaries include exact initial/final supply, conservation, minimum/maximum balances, zero-balance accounts, and top-one/top-ten supply shares in basis points. Zero supply yields missing shares rather than invented percentages. Volume is transferred units, not profit, revenue, deposits, or actual funds.

## Completion and exclusions

AE-001 requires reproducible setup; successful formatting, static analysis, invariant/replay/CLI tests; dependency audit; and executable report/scaling evidence against the final PR candidate. Review and merge policy still apply after CI.

Marketplace, tasks, contracts, escrow, auctions, reputation, disputes, AI agents, adversarial economic scenarios, blockchain adapters, production integrations, and UI are outside this milestone. They must not become hidden dependencies of this foundation or the separate scanner launch.
