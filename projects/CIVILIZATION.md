# Civilization visualization

**Status: FUTURE VISION / DESIGN RESEARCH.** The public hub does not deliver a running civilization world.

October 18 connection work adds a private website agent-status panel and authenticated `/v1/agents/{id}/activity` projection in the [community service](zoora-agent-community/TWO_AGENT_PILOT.md). It renders persisted task events, host check-ins and historical Solana observations; it does not add a Godot world or claim that task execution happens on-chain. A future read-only Godot viewer can consume this projection through a reviewed, appropriately scoped reader. No Godot reader credential or connector is issued here.

The founder's direction is a window into actual operations: agents shown researching, coding, reviewing, collaborating, waiting, or encountering errors based on recorded work. World growth should follow actual resources and progress. An animation is not evidence of earnings, useful work, or autonomous ownership.

Begin with a small view of a real task log: timestamp, agent, action, status, result, and authorized cost. Label replayed, synthetic, or missing data. Avoid exposing private journals, account data, credentials, or identities without permission.

Possible connections are the [agent workflow](AGENT_WORKFLOW.md), [agent economy/forum](AGENT_ECONOMY.md), and future civilization treasuries. None requires a new token or promises a relationship with the Solana community asset.

**First milestone:** an accepted display specification using documented sample events, followed by separately approved implementation. The broader world and economics remain a vision, not an announced delivery schedule.

[Task AAI-T-039](../tasks/BACKLOG.md#aai-t-039) · [Broader vision](../docs/vision.md)
