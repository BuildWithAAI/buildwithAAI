# Changelog

## 0.2.0 — AE-001 foundation review candidate

### Implemented

- Separate transfer intents and completed/rejected outcomes; expected refusals no longer halt simulation.
- Atomic account updates, wide checked totals/metrics, bounded configuration, lifetime-unique IDs/sequences, and execution-order validation.
- Read-only engine access and separate normal/manual scenario identities.
- Pinned seeded ChaCha8Rng with unbiased sender/recipient sampling.
- Strict outcome-aware journal replay and full JSON report verification, including seeded normal regeneration.
- Domain-separated canonical SHA-256 config/initial-state/journal/final-state/run fingerprints.
- Deterministic conservation/concentration summaries, zero-supply missingness, and exact decimal-string wide totals.
- Offline run/replay/benchmark CLI, protected output creation and bounded input parsing.
- Original test assertions retained with updated getters/outcome records; expanded invariants, corruption, resource, CLI, and independent hash-vector tests.
- Linux/Windows validation, debug/release reproducibility checks, measured scaling artifacts, and dependency auditing.

### Compatibility

Version 0.2.0 changes public mutation access, journal entries, fingerprints, and serialization. Rebuild callers against getters and recorded outcomes. Version 0.1.0 did not provide this report format; schema 1 reports are version-specific and are not silently migrated.

### Verification

See [VALIDATION.md](VALIDATION.md) for exact final candidate, test/CI evidence, and limitations. Implemented code is not a deployment claim.

### Deferred

Marketplace/tasks, escrow, incentives, reputation/disputes, AI agents, adversarial economic models, blockchain/wallet adapters, UI, and public operation. These require a separately bounded milestone.

## 0.1.0

Initial Rust crate, deterministic scheduler/RNG, simulated accounts, normal scenario, basic metrics, replay/fingerprints, tests, CI, and the locked four-layer architecture. The prior audit found missing economic outcomes, replay validation, stable hashes, and a runnable report workflow; 0.2.0 addresses those gaps.
