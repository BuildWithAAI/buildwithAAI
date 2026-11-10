# Decision and commitment register

**Updated November 9, 2026.** The September 22, 2026 register recorded publication of the eight Telegram roadmap topics. That publication did not authorize every implementation, transaction, budget, or operating policy those topics describe.

The future blockchain name remains **UNDECIDED: Zoora Blockchain or AAI Blockchain**. The November 9 agent-economy plan removes any token. No mint, supply, founder allocation, native ticker, launch date, or conversion mechanism is selected here.

## Commitment categories

| Category | Meaning |
| --- | --- |
| APPROVED | Explicit founder direction, limited to its recorded scope |
| IDEA | Product or design idea; not an implementation commitment |
| RESEARCH | A question or investigation direction; not proof of completed research or a useful result |
| FUTURE | A later possibility with unresolved prerequisites |
| NOT PROMISED | Outcomes or entitlements the project does not offer |

Work status is separate from commitment. See [STATUS.md](community/STATUS.md). Publication of a proposal does not make its software RELEASED.

## Founder directions

| ID | Direction | Scope and authority |
| --- | --- | --- |
| B-001 | Keep the Solana/Pump.fun experiment separate from the future chain | APPROVED boundary; initial founder handoff |
| B-002 | Leave Zoora-versus-AAI future-chain naming open | APPROVED constraint; no choice made |
| B-003 | Future native currency originates through that network's own documented genesis | APPROVED design intent: one initial native base currency; any later civilization currencies require governance/community decisions and remain anchored to the base currency. Mechanism, monetary parameters, and launch unselected |
| B-004 | Invite community proposals and contributions with owner/maintainer acceptance | APPROVED direction; detailed workflow and platform enforcement remain reviewable |
| B-005 | No automatic migration, bridge, conversion, native-coin, equity, governance, validator, revenue, or return rights | APPROVED boundary |
| B-006 | No wallet-secret collection, hidden controls, or unapproved execution | APPROVED current boundary; initial work is research/read-only/offline/paper. Later discussion of trading modes/account funding permits documenting future execution questions, not connecting accounts or running trades |
| B-007 | Protected economic/control changes require explicit owner acceptance and additional review | APPROVED requirement; platform enforcement unverified |
| B-008 | Hosting remains paused while the foundation is prepared | Prior founder direction; no later deployment instruction received |
| B-009 | Publish the updated GitHub information and roadmap | APPROVED documentation publication, September 22, 2026; owner request after the eight-topic discussion. Operational proposals remain scoped below |
| B-010 | Explain the project motivation and launch focus | September 22, 2026 historical direction. The founder wanted an alternative to rugs and disappearing projects and, at that date, described one community coin. B-021 removes any token from the agent-economy plan. B-010 is not a v1 launch approval. |
| B-011 | Explore a user-named personal trading assistant | IDEA / PROPOSED product direction: Pump.fun/trenching and spot/leverage modes, possible text/voice, evidence and attention management; execution permissions undecided |
| B-012 | Creator fees would fund the proposed trading account | PROPOSED funding direction; supersedes the earlier personal-savings assumption. Possible profit uses include development, developer gifts, community rewards, and disclosed token purchases; no allocations, account operation, payments, or price guarantees approved |
| B-013 | Study EVE-style economics and an agent market forum | PROPOSED RESEARCH: budgets, permissions, service tasks, reporting, structured discussions, and test balances; no real-money marketplace implementation selected |
| B-014 | Explore open music collaboration and AI artists | IDEA: open verses, approved features, permitted unlimited remix branches, credits/splits, clearly identified AI artists, and a possible later label. A Zoora Productions integration is an additional assistant suggestion for community review, not a founder-selected requirement |
| B-015 | Bring the multi-brain experiment forward early | APPROVED research-priority direction; source audit and proposed offline/paper prototype. “Frankenbrain” remains a working nickname; architecture, datasets, budget, implementation, and live execution are not approved |
| B-016 | Preserve a civilization visualization tied to actual work/resources | FUTURE vision; no running system verified in this hub |
| B-017 | Use the AAI/Anything AI logo concept in community material | Generated concept prepared and corrected for Telegram; reused with this documentation update, with no new trademark/asset license decision |
| B-018 | Publish Virtual Business Spaces as an agent development project with strict contract rules and disclosed platform fee purpose | APPROVED October 13, 2026 for specification and SYNTHETIC simulation; [AAI-P-0012](../proposals/approved/AAI-P-0012-virtual-business-spaces.md). The recorded treasury, burn, and liquidity direction is a simulation. B-021 removes that split and any token from the v1 plan. No paid launch and no promised returns |
| B-019 | Clarify Zoora as agent hosting and a work economy, with owner funding, community support and possible community-governed agents | APPROVED founder product direction, October 13, 2026; [agent-hosting brief](../projects/AGENT_HOSTING_AND_COMMUNITY_SUPPORT.md), related [AAI-P-0009](../proposals/ideas/AAI-P-0009-agent-economy.md). Agent creation is not token launchpad activity. Community votes need an explicit agent charter/owner delegation and cannot override platform permissions. Documentation/specification/SYNTHETIC research only; no live funding, binding governance, wallet spending, new token, ownership/return entitlement or protocol/economic change approved |

B-009 changes the earlier blanket “awaiting owner permission to publish the plan” state. It does not resolve unrelated product, financial, security, licensing, or settings decisions. Earlier proposal records retain their dates and scope.

## Agent-economy v1 — November 9, 2026

**B-021 — APPROVED for the first agent-economy version. Decision maker: Zoorped.** The first version is noncustodial.

- Each agent is bound to the user's own Solana wallet public key. v1 wallets are Phantom and Solflare. Zoora stores the public key and metadata only: no seeds, private keys, or hosted balances.
- The user funds that wallet with classic SPL USDC, through Solana Pay or a transfer the user starts. USDC is the only payment asset at launch.
- The agent proposes a payment and the user signs it, or the user sets spending caps in the Solana Foundation Pay tool. Zoora does not operate a delegated or session signer.
- Zoora earns by selling research and services over x402, using the Coinbase CDP facilitator, to `<COMPANY_RECEIVE_ADDRESS>`. The placeholder is not an address and must not be invented.
- Escrow for longer jobs, using Escro or an audited custom contract, is not in v1. It waits until after the first real paid jobs.
- A delegated signer and automated spending wait on legal review of the FinCEN control analysis.
- The $30 activation fee and the 40/40/20 burn, lock, and liquidity split are on hold. The split stays out. The fee may return only as a plain service fee after counsel review.
- Any token is removed from the plan.

This decision supersedes the October 29 plan gates for activation allocation, escrow, and a delegated signer as v1 work. It does not rewrite historical research records. Free owner-issued private-pilot invitations remain supported. The build order is [the production plan](PRODUCTION_BUILD_PLAN.md).

**B-022 — APPROVED as a v1 design. Decision maker: Zoorped.** Outside agents join through [external agent onboarding](EXTERNAL_AGENT_ONBOARDING.md): wallet sign-in, an A2A agent card or MCP endpoint, optional `llms.txt` or OpenAPI, directory search, and x402 USDC paid to the seller owner's wallet. Zoora holds no funds. Any Zoora fee on those sales is a separate disclosed service charge and is not charged until the same counsel review that gates the $30 fee. Completed-job history and ratings attach to the wallet. New agents start with low job and value limits that rise with history. Stake or verification waits on legal review. Longer jobs that need escrow stay deferred. The starting limit numbers, rating rules, and company receive public key remain open.

## Agent trust development direction — October 15, 2026

**B-020 — APPROVED for specification and SYNTHETIC implementation.** The founder requested one active paid-work contract, one development collective and one community-funded group per starting agent, with expanded access based on verified completed work and collective credit divided by each agent's contribution. [AE-016](../projects/zoora-agent-economy-simulator/review/AE016.md) implements an offline candidate. Exact higher-tier capacities, review criteria, work-unit budgets, waiting periods and thresholds are research settings. Real verification, payouts, community funding, deployment and production enforcement remain unselected. This does not modify B-001/B-003/B-005/B-006 or adopt a token fee/burn/lock/liquidity policy.

## Open decisions

Still open after B-021 and B-022: the real company receive public key, the starting job and value limits for a new external agent, rating and dispute rules, directory abuse handling, software and media licenses, contributor assignments and compensation, reporting cadence, and operating budgets. A token launch is not an open v1 choice. Research readiness is not a live payment system.

The separate future-chain research is not in the v1 plan. No software coin or brain or music token is in the plan.

## Record future changes

Add date, exact scope, decision maker, evidence, alternatives, risks, token impact, conditions, reviewer evidence where needed, and superseded IDs. Retain rejected/deferred reasons. Changes beyond a published proposal need their own decision before implementation.

[Funding](FUNDING.md) · [Current facts](CURRENT_STATUS.md) · [Proposal index](../proposals/README.md)
