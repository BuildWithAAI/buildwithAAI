# AE-001 Simulation Foundation Design

**Status:** DESIGN BASELINE  
**Milestone:** AE-001

## Purpose

Provide a deterministic, replayable environment for testing agent-economy mechanisms.

The simulator is a laboratory, not a production economy implementation.

## Architecture

SimulationConfig -> SimulationEngine -> Agents / Economy State / Environment -> Deterministic Event Queue -> Event Processor -> Simulation State -> Event Log / Metrics

Events are the state-transition boundary. Agents may propose actions/events, but they must not directly mutate global simulation state.

## Determinism

A run is reproducible when simulator version/code, configuration, initial state, random seed, and event-ordering rules are identical.

The simulator must not depend on wall-clock time, operating-system scheduling, unordered iteration order, external network state, or real blockchain state.

Event ordering is:
1. simulation tick
2. event priority
3. sequence number

The sequence number is assigned deterministically by the engine.

## Core state

AE-001 models simulation configuration, agents, simulated balances, simulation tick, event queue, and event history.

Balances are simulation values only and have no monetary value.

## Event model

Each event contains, at minimum: event ID, simulation tick, sequence, event type, actor, event payload, and metadata.

State-changing logic occurs through event processing. The event log records the resulting event history.

## Configuration

TOML is the planned configuration format. It should eventually control random seed, agent count, starting balance, tick count, event rates, economic parameters, and scenario selection.

## Metrics

Metrics use an observer/collector architecture rather than hard-coded reporting inside economic rules.

Initial metrics should support event count, transaction count, successful transactions, failed transactions, total simulated volume, per-agent balance, and basic wealth concentration.

Later milestones can add reputation, disputes, attack success/cost, liquidity, inequality, throughput, and other research metrics.

## Security boundary

The simulator must never request seed phrases or private keys, submit real blockchain transactions, connect to production wallets by default, represent simulated transactions as real transactions, or silently cross an integration boundary.

## AE-001 scenario

The first scenario is a normal economy using configurable parameters.

Illustrative baseline values:
- 100 agents
- 1,000 simulated starting units per agent
- 1,000 simulation ticks
- fixed seed

These values are test defaults, not final economic policy.

## Acceptance criteria

AE-001 is complete only when:
- the simulator builds cleanly
- tests pass
- identical configuration and seed produce identical results
- event ordering is deterministic
- the normal scenario completes without invariant violations
- the event log describes the run
- basic metrics are collected
- CI executes the test suite
- documentation matches implementation
