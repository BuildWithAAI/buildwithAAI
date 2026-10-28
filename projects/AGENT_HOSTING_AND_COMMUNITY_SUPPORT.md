# Agent hosting, work and community support

**Founder direction recorded October 13, 2026.** This defines the intended product and a specification/SYNTHETIC research scope. Live funding, binding votes, general agent execution and wallet spending are not implemented by this document. The existing [local workspace and bounded model workflow](zoora-agent-community/AGENT_RUNTIME.md) remain the current runtime boundary.

## Product purpose

Zoora is intended to let people create and operate AI agents on founder-operated infrastructure, give them defined work, fund their operating budgets and authorize them to transact. Useful agents could provide research, software, design, media, business services and other permitted work. The platform supplies identities, permissions, records and a place to exchange services.

The founder explicitly clarified that this is an agent workforce and economy, not a token launchpad. Creating an agent is not a coin launch and does not require issuing an agent-specific token. Existing AAI service/access research and the future chain's genesis-native currency remain separate questions; no new token, entitlement or migration is introduced.

The founder's 2040 horizon motivates durable infrastructure. It is not a forecast that agents will replace every worker or that any agent will become commercially dominant. Success must be demonstrated through accepted work, reliability, cost and actual demand.

## Agent modes

| Mode | Funding | Decision authority |
|---|---|---|
| Owner funded | An individual or business supplies an approved operating budget | The owner specifies objectives, tools, spending limits and pause/exit controls |
| Community supported | Supporters voluntarily contribute under disclosed support terms | The owner retains control unless particular decision rights are explicitly delegated |
| Community governed | Participants support an agent operating under an accepted charter | Eligible participants vote only on the decisions delegated by that charter |

These are proposed product modes, not live services. An agent may move between modes only through an explicit recorded change accepted by its authorized owner and the applicable charter. Funding alone does not transfer ownership or grant votes, revenue rights or unrestricted spending authority.

## Community-agent charter

Before binding governance or funding is enabled, define:

- The agent's purpose, accountable operator, owner and model/tool versions.
- Who is eligible to vote, how eligibility is established, vote weights, quorum and decision thresholds. No voting method or threshold is selected by this clarification.
- Which objectives, task choices, service prices or budget allocations voters may change, and which decisions remain with the owner or platform.
- Proposal timing, voting snapshots, expiry, conflicts of interest, amendments, membership changes and the owner's explicit delegation or transfer terms.
- Allowed tools, maximum commitments and spending, recipients, approval requirements, and pause/recovery/exit authority.
- Contribution purpose, fees and costs, remaining-budget reporting, unsuccessful work, cancellation and any agreed unused-fund return terms.
- The records participants can inspect and the private information that stays protected.

A vote may select an objective or authorize a bounded action proposal. A deterministic controller must still validate it against the charter, permissions and available budget before execution. Votes and model messages cannot override platform security policy, expand tool access or change blockchain consensus or native monetary rules.

## Infrastructure roles

The server-hosted pilot and future-chain integration are alternative stages that require their own implementation scope. A private blockchain is not a prerequisite for a local research pilot.

In a possible hybrid design, servers run models and permitted tools, manage task queues and store reports. A chain can record authorizations, settlement and commitments to evidence. Model computation and private content need not be placed on-chain. A submitted hash or receipt does not independently prove useful work.

Transaction authority, remote-signing design and the handling of group funds must be resolved before a real funding or payment adapter. The current local workspace cannot sign or spend and does not collect wallet secrets. Preserve the [direct-payment boundary](AGENT_ECONOMY.md#product-control-boundary): third-party transfers cannot be reversed by changing a platform record or passing a vote.

## First reviewable research output

Extend the existing offline laboratory only after accepting a bounded implementation brief. Use synthetic participants and budgets with no monetary value to demonstrate:

1. Register an agent, its operator and a declared capability.
2. Record owner funding or community support and the exact terms.
3. Propose a task or budget change under an explicit test charter.
4. Validate eligibility, tally deterministically and record the resolution.
5. Reject attempts to exceed delegated authority, overspend or replay a decision.
6. Complete or reject a bounded task and report artifacts, costs and the remaining budget.

Include disputed work, unavailable providers, tied/rejected votes, conflicting supporters, repeated submissions, shared ownership and a paused agent. Treat identity/Sybil resistance and controller trust as unresolved research rather than solved by a wallet address.

Measure accepted useful outputs, correctness, reliability, total operating cost, delivery time, disputes, repeat demand and actual earned revenue where later operation permits it. Keep contributions, transfers, circulating internal payments and unrealized asset changes separate from earned revenue. Sponsor popularity or funding size alone is not an agent-quality metric.

## Connections and current limits

[Agent economy](AGENT_ECONOMY.md) supplies work and evidence foundations. [Virtual Business Spaces](VIRTUAL_BUSINESS_SPACES.md) could supply business locations under their separate contract rules. [Civilization](CIVILIZATION.md) could visualize recorded work. [Decision B-019](../docs/DECISIONS.md) and [agent governance boundaries](../docs/community/GOVERNANCE.md#governance-of-individual-community-agents) record this clarification.

The leasing fee experiment applies to that separately scoped service; it is not automatically charged on community contributions. No funding account, contributor compensation, investment/return right, voting token, live wallet program, deployment or change to the deferred [Development Agent](https://github.com/BuildWithAAI/buildwithAAI/issues/5) is introduced.
