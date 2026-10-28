# AE-002: offline task marketplace

A deterministic, synthetic task market built on the AE-001 RNG and error types. This is a separate Rust crate; the foundation's version, binary fingerprint, report format and fixtures are preserved. No network client, wallet, signing, blockchain settlement, native-token rule or production service is added.

## Run locally

Install the repository-pinned Rust 1.99.0 toolchain, then from this directory:

```sh
cargo test --locked --all-targets
cargo test --locked --release --all-targets
cargo clippy --locked --all-targets -- -D warnings
cargo fmt --all -- --check
cargo run --locked --release -- run configs/default.toml my-report.json
cargo run --locked --release -- replay my-report.json
cargo run --locked --release -- benchmark my-scaling.json
```

Output files must be new. Reports are explicitly `SYNTHETIC`, with `SIMULATED_UNITS`; these units have no monetary value. Fees are configurable experimental policy, not AAI or blockchain economics. Fees, worker payments and client refunds are recorded separately. Initial balances and refunds are never described as profit.

## Task lifecycle

A client posts terms, an acceptance-criteria digest, reward and exclusive deadline. The reward moves from its available balance to escrow. Another account accepts and submits an artifact digest; the client approves to release the worker payment and floor-rounded basis-point fee to the simulator treasury. The assigned worker may report failure; the client may cancel an open task. Both refund the whole reward. Every successful post creates a mandatory deadline timer that refunds any unsettled task. Completed/cancelled/failed tasks retain their timers as journaled no-ops.

Acceptance and artifact digests are simulated declarations. The engine does not fetch artifacts, verify work quality, authenticate actual operators, or prove independent identities. Completed/failed service counters describe state transitions, not reputation or trust. Disputes, reviewer policy, partial delivery, real agent execution and operator relationships remain separate future work.

## Determinism and replay

The normal scenario uses the foundation's pinned ChaCha8 RNG and all tasks overlap: post at tick 0, accept/cancel at 1, submit/fail at 2, approve at 3 and expire at 4. Random choices use unbiased bounded draws. Manual scheduling allows inspection and further commands between advances. Expiry priority is 0; requests have priority 1. At a deadline, expiration occurs before a request, regardless of submission order.

The engine owns IDs, priorities and timers. Replay checks contiguous unique IDs, strict event order, all request outcomes, mandatory timers, balances, task state, fee rounding, refunds and metrics. Normal reports additionally regenerate the complete seeded scenario. A fingerprint detects content differences; it does not authenticate an author or prove real-world activity.

Fingerprint schema 1 hashes the bytes `ZOORA_AE002_JSON_FINGERPRINT_V1` followed by one NUL byte and compact UTF-8 JSON for the ordered tuple: schema_version, model, classification, units, rng, scenario, config, final_state, metrics, journal. Struct fields use declared order; task arrays are sorted by task ID and enum metric maps by enum order. There are no floats. u128 values are canonical decimal strings. SHA-256 excludes the fingerprint field itself. JSON encoding is pinned by Cargo.lock, and CI independently reproduces it in Python. Serialization changes require a model/schema change. AE-001's binary fingerprint is unrelated and unchanged.

## Bounds and conservation

Limits: 100,000 agents, 10,000 tasks, 100,000 lifetime events (including timers), 100,000 ticks, 128 UTF-8 bytes per title and 64 lowercase hexadecimal digest bytes. A post reserves a timer admission slot before it enters the queue; failed posting frees the reserved slot. Lifetime limits cover completed events as well as queued ones. Funds cannot be held without space for the eventual refund timer.

Each account reserves capacity for all of its refundable escrow: available balance plus refundable escrow must fit i64. Incoming payment is refused if it would consume this refund capacity. This prevents an incoming payment from making a later mandatory refund overflow. At every advance and at completion: available balances + live escrow + treasury = initial supply. Fees and financial counters are cross-checked against task outcomes. A fault closes the engine; incomplete or faulted runs cannot produce a verified final report.

The CLI reads at most 1 MiB of TOML or 64 MiB of report JSON, rejects nonregular/symlink inputs, rejects unknown fields, bounds deserialized arrays and creates new outputs with Unix mode 0600. These are application safeguards, not an OS sandbox or protection against concurrent replacement in attacker-controlled directories. Use trusted local directories. Reports contain supplied titles/digests; do not put secrets or private data in terms.

See [VALIDATION.md](VALIDATION.md) for verified evidence and remaining scope.
