# AE-001 Simulation Foundation Design

**Status:** LOCKED ARCHITECTURE - IMPLEMENTATION IN PROGRESS
**Milestone:** AE-001

## Purpose
Provide a deterministic, replayable laboratory for testing agent-economy mechanisms before production implementation.

## Locked development sequence
1. AE-001A - Simulation Kernel: clock, scheduler, deterministic event queue, deterministic RNG, processor, journal, replay.
2. AE-001B - Minimal Economy: agents, simulated accounts, integer balances, transfer requests/outcomes, invariants.
3. AE-001C - Observation Layer: observer metrics, run summaries, concentration measures, fingerprints.
4. AE-001D - Normal Scenario: configurable baseline scenario and reproducibility tests.

## Architecture
Scenario or policy -> command/intent -> scheduler -> deterministic event queue -> processor -> simulation state -> journal and metric observers.

The processor is the only component that mutates global simulation state.

Events are ordered by simulation tick, event priority, then deterministic sequence number.

## Outcomes
Requested actions and outcomes are distinct. Expected economic rejection is recorded as simulation data rather than terminating the world. Engine or invariant corruption remains a hard error.

## Determinism
Reproducibility requires identical simulator version, configuration, initial state, RNG algorithm/version, seed, and ordering rules.

The simulator must not depend on wall-clock time, operating-system scheduling, unordered iteration, or external network state.

## Economic values
Balances use integer smallest units. Balance arithmetic is checked. Negative balances are prohibited unless a later explicitly approved model introduces debt.

## Configuration
TOML -> parse -> validate -> validated SimulationConfig -> engine.

Invalid configuration is rejected before execution.

## Journal and replay
The journal records processed simulation outcomes. Replay must reconstruct the same final economic state from the same initial state and journal.

Run fingerprints identify simulator version, configuration, seed, RNG algorithm/version, initial state, journal, and final state.

## Metrics
Metrics observe outcomes and do not control economic state transitions.

Initial metrics cover processed events, requested/completed/rejected transfers, simulated volume, balances, and basic concentration.

## AE-001 exclusions
Marketplace, contracts, escrow, auctions, reputation, disputes, adversarial scenarios, AI-agent integration, blockchain adapters, production integrations, and UI are deferred.

## Required verification
AE-001 is complete only when builds and CI pass; deterministic runs, ordering, unique IDs, monotonic sequences, conservation, rejection behavior, configuration validation, non-negative balances, replay, fingerprints, and documentation consistency are tested.

Only after these criteria pass should AE-001 be merged and AE-002 begin.
