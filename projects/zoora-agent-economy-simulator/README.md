# Zoora Agent Economy Simulator

AE-001 provides an offline Rust research runner for deterministic simulated accounts and transfers. Version 0.2.0 adds recorded outcomes, validated replay, portable SHA-256 fingerprints, JSON run reports, measured scaling, and executable CLI checks. See [VALIDATION.md](VALIDATION.md) for release-candidate evidence and current verification status.

Every report is classified **SYNTHETIC**, with balances in **SIMULATED_UNITS**. A seeded transfer model does not establish useful incentives, realistic agents, profitability, or production readiness.

## Run on your computer

Install Rust through the [official rustup instructions](https://rustup.rs/), then check out this existing repository and the simulator branch. The project pins Rust 1.99.0 with rustfmt and clippy; Cargo.lock pins application dependencies.

From `projects/zoora-agent-economy-simulator`:

```sh
cargo test --locked --all-targets
cargo clippy --locked --all-targets -- -D warnings
cargo fmt --all -- --check
cargo run --locked --release -- run --config configs/normal.toml --output normal-run.json
cargo run --locked --release -- replay --input normal-run.json
cargo run --locked --release -- run --config configs/zero-budget.toml --output zero-budget-run.json
cargo run --locked --release -- benchmark --output scaling.json
```

Outputs must be new files in existing directories. Use a new filename for each run; the CLI refuses to overwrite existing files. Reports have a 64 MiB input/output limit; TOML inputs have a 1 MiB limit. Errors exit nonzero. Unix output files are created with mode 0600, subject to the process umask. Files may contain partial data if a write fails; remove a failed output before retrying.

No credentials, wallet, network endpoint, hosting account, or production setup is required. Rust installation and dependency downloads require development-time internet access; the compiled simulator itself performs no network operations.

## Configuration and scenario

TOML requires exactly `agent_count`, `starting_balance`, `ticks`, and `seed`. Unknown fields are rejected.

- `agent_count`: 2 through 100,000.
- `starting_balance`: a nonnegative signed 64-bit integer for each account.
- `ticks`: 1 through 100,000; valid event ticks are zero through `ticks - 1`.
- `seed`: unsigned 64-bit seed for pinned ChaCha8Rng.

TOML numeric literals are signed 64-bit values, so the CLI configuration accepts nonnegative seeds through `i64::MAX`. The Rust library and JSON reports preserve the full `u64` seed range.

The normal scenario requests one one-unit transfer per tick. Sender selection uses unbiased bounded sampling; recipient selection samples the other accounts uniformly. Zero-balance senders produce an `INSUFFICIENT_FUNDS` record and the simulation continues. A normal scenario can run once on a fresh engine.

## Saved reports

A report contains schema/version/RNG identity, classification and unit, scenario, complete configuration, ordered request/outcome journal, final account snapshot, observer metrics, a concentration summary, and run fingerprints. No wall-clock measurements enter deterministic run reports.

Replay verifies journal integrity, recomputes every outcome from initial accounts, and compares the complete final snapshot, metrics, summary, and fingerprints. For a normal report, it also regenerates the seeded scenario and checks the journal. Unsupported report versions fail instead of silently migrating.

Balances and amounts are exact `i64` values. Totals and cumulative transfer volume use `u128`, encoded as canonical decimal strings in JSON. Consumers of JSON must preserve 64-bit integers such as seeds and balances; JavaScript's ordinary `Number` cannot represent every supported value exactly. Shares use integer basis points, rounded down. Top-ten means up to ten accounts. Shares are `null` when total supply is zero.

`benchmark` runs 100, 1,000, and 10,000 accounts with 10,000 requests each. Its measured durations cover the engine run and its invariant audit; initialization, report creation, and replay are excluded. These hardware/build-dependent observations do not constitute throughput guarantees. Each case verifies conservation and report replay.

## Library use

```rust
use zoora_agent_economy_simulator::{
    Event, RunReport, SimulationConfig, SimulationEngine, SimulationError,
};

fn main() -> Result<(), SimulationError> {
    let mut engine = SimulationEngine::try_new(SimulationConfig::default())?;
    engine.schedule(Event::transfer(0, 0, 0, 0, 1, 5))?;
    engine.run_pending()?;
    let report = RunReport::from_engine(&engine)?;
    report.verify()?;
    Ok(())
}
```

The engine exposes read-only getters. Account state changes only through its processor. Standalone state, journal, and metric values can be inspected or copied without granting mutation of an engine. Use `try_new` for external configuration; `new` is a convenience constructor that panics on invalid trusted configuration.

Manual event runs use a separate scenario identity. Event IDs and scheduling sequences must be unique for the entire engine lifetime, including after a queue drain. Events execute by `(simulation_tick, priority, sequence)`; later scheduling cannot precede processed history. Economic refusals are ordinary outcomes; invalid metadata, capacity violations, arithmetic/integrity errors are hard errors. A report requires an empty queue.

## Milestone boundary

AE-001 covers the kernel, minimal transfer economy, observation layer, and normal scenario. Marketplace/task lifecycle, escrow, incentives, reputation, failures of service, and adversarial agents belong to a separate AE-002 design. UI and production integrations are deferred. The scanner and biological research remain separate modules.

[DESIGN.md](DESIGN.md) specifies ordering, rejection precedence, and fingerprints. [SECURITY.md](SECURITY.md) describes resource/file boundaries and limitations. An unmerged draft PR is a review candidate, not a public deployment.

AE-004 adds a [direct-payment workflow and connected review laboratory](review/AE004.md). The product direction is user-controlled agent wallets; research escrow is an explicit comparison model. Payment records, delivery, requests and voluntary returns remain separate, and the platform has no freezing, signing or reversal authority in this implementation.
