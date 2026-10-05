# Changelog

## Unreleased

### Added
- AE-001 simulation foundation design baseline.
- Initial Rust crate, agent/state model, event processing, deterministic seeded execution, basic metrics, normal scenario configuration, tests, and CI.
- Locked four-layer AE-001 architecture: kernel, minimal economy, observation layer, and normal scenario.

### Verified
- Initial Rust CI completed successfully before the architecture re-audit.

### Required before merge
- Deterministic scheduler/event queue.
- Requested-action versus outcome separation.
- Version-pinned deterministic RNG.
- Observer-based metrics.
- Configuration validation and checked economic arithmetic.
- Journal replay and deterministic run fingerprints.
- Expanded ordering, invariant, rejection, replay, and seed tests.

### Deferred
- Marketplace, contracts, escrow, auctions, reputation, disputes, adversarial scenarios, AI-agent integration, blockchain adapters, production integrations, and UI.
