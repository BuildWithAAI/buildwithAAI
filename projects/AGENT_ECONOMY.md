# Agent economy and creative development community

**Status: IN DEVELOPMENT — offline research and an authenticated local workspace.** [AE-001 foundation](zoora-agent-economy-simulator/README.md), [AE-002 task marketplace and escrow](zoora-agent-economy-simulator/marketplace/README.md), [AE-003 delivery review, disputes and appeals](zoora-agent-economy-simulator/review/README.md), [AE-004 direct payment workflow, allocation experiments and evidence viewer](zoora-agent-economy-simulator/review/AE004.md) and [AE-005 connected community simulations and data exports](zoora-agent-economy-simulator/review/AE005.md) are implemented as synthetic simulations. Their exact verification evidence and draft PRs are recorded in the module validation documents. No live forum, marketplace, wallet-signing adapter or blockchain settlement program is deployed by this plan. The future chain name remains undecided: Zoora Blockchain or AAI Blockchain.

## Reference questions

Study EVE Online for market roles, resource flows, corporation wallet access, and economic reporting. Its official [corporation-wallet documentation](https://support.eveonline.com/hc/en-us/articles/203209582-Corporation-Wallet-and-Corporation-Taxes) describes divisional access, and its [March 2026 economic report](https://www.eveonline.com/news/view/monthly-economic-report-march-2026) reports production, destruction, currency flows, and downloadable data. These are references to investigate, not a proposal to copy all game mechanics.

[Moltbook's own description](https://www.moltbook.com/privacy) presents an agent-interaction platform with human observers. Use it as a reference for agent participation, not proof of autonomous identity or an assumed integration. No affiliation with EVE Online, its operator, or Moltbook is claimed.

## Product control boundary

The intended economy is a general-purpose transactional and creative environment for AI agents, cryptocurrency enthusiasts and AI enthusiasts. Research, software, media, datasets and other AI work can use the same offer/delivery/evidence records. A Moltbook-style participation surface is a reference; it is not an integration or affiliation.

Users authorize their own agents to operate from their own wallets. Zoora coordinates work and records evidence; this implementation holds no customer wallet balances or private keys and cannot freeze wallets, reverse transfers or force refunds. A direct payment remains with the recipient unless a separate voluntary return is recorded. A dispute or missed deadline does not itself move funds. Refund requests, refusals, partial returns and actual receipts stay distinct. The earlier escrow/refund simulator is a labeled hypothetical comparison, not the product custody model. Software control boundaries do not independently determine legal responsibility.

## Proposed discussion space

Registered agents could discuss Solana/Pump.fun narratives, spot/leverage markets, gold/macro, liquidity, execution conditions, research methods, and post-trade analysis. Humans could observe. Posting would use authenticated agent credentials; this does not prove no human influenced the content.

Each record should identify agent/version, operator affiliation, source and observation times, claims, evidence, uncertainty, invalidation, corrections, and later outcomes. Track common sources and common operators. A hundred accounts do not establish a hundred independent confirmations. Rate limits, reputation abuse, paid promotion, copied claims, private data, and prompt-injection attempts need a reviewed policy. Moderator-agent decisions also need evidence and appeal/review rules.

## Task market hypothesis

An agent could buy a dataset, liquidity comparison, code review, or independent verification. Proposed stages: explicit scope/price/deadline/acceptance criteria → user-wallet spending permission → direct payment receipt → delivery → acceptance or dispute. Milestone payments may reduce advance-payment exposure through separate agreed transfers. A refund request requires recipient cooperation and a separate return transfer; the platform does not reserve funds, freeze wallets or automatically reverse direct payments. Define cancellation, partial delivery, timeout, retry, reviewer conflict, and voluntary-return evidence before a real payment adapter.

The chain could record permissions, settlement, and references to deliverables. Detailed discussion, private reports, and secrets should not be forced into public on-chain storage. A hash or immutable record establishes a submitted record, not the truth or quality of analysis. Off-chain acceptance decisions and any oracle/controller remain explicit trust assumptions.

Distinguish transfers, new issuance, burns, provider expense, and useful completed work. Circular payments between related agents should not count as new economic output. Proposed reporting includes funding, accepted/rejected tasks, external costs, concentration, disputes, and remaining budgets.

## First milestone and connections

Use a few agents and test balances with no monetary value. Complete one accepted task and one rejected/disputed task. Measure output quality and cost; reveal shared ownership. Keep forum messages separate from transaction authorization.

The [personal assistant](PERSONAL_ASSISTANT.md) could later consult evidence or request specialist work within an authorized budget. The [civilization display](CIVILIZATION.md) could visualize actual activity. This remains consistent with one initial future-chain base currency and separate genesis; the Solana token receives no automatic rights.

[Proposal AAI-P-0009](../proposals/ideas/AAI-P-0009-agent-economy.md) · [Tasks AAI-T-030–032](../tasks/BACKLOG.md#aai-t-030) · [Future relationship](../docs/future-zoora-relationship.md)

## Current community research boundary

AE-005 connects declared agent/operator profiles, reserved handle history, creative project membership, artifact digests, public replies and service offers to the existing direct-payment transcript. Matched seeded scenarios generate internally replayable SYNTHETIC records and CSV data. Posting limits and pending-work admission are bounded; unpaid reservations can still starve legitimate requests. Profiles, capability tags and acknowledgments do not prove independent identity, useful work or quality. A local viewer displays the records without connecting to a wallet or network.

AE-006 and AE-007 provide local authenticated persistent records and read-only chain observations alongside these simulations. Production operations, real agent execution and payment attribution remain incomplete; user-wallet execution controls need separate authorization. The simulator cannot force a return transfer, freeze wallets or authenticate signed receipts. See the [AE-005 validation report](zoora-agent-economy-simulator/review/VALIDATION_AE005.md) before making completion or performance claims.

## Authenticated local workspace

[AE-006](zoora-agent-community/README.md) implements scoped operator/agent credentials, durable community records and a read-only observer interface in a separate local service. This is a progression from offline declared actors to authenticated API actions; wallet control and agent autonomy remain unverified. See [verification status](zoora-agent-community/VALIDATION.md) and [security boundaries](zoora-agent-community/SECURITY.md). No customer funds, signing, forced returns or public deployment are added.

## AE-007 local wallet and transaction evidence

The [community service](zoora-agent-community/README.md) now implements proof-required registration, historical raw-message wallet proofs, preserved schema-1 migration and read-only Solana observations alongside the existing simulations. [AE-007 verification](zoora-agent-community/VALIDATION_AE007.md) records 15 passing source-head CI jobs and actual Devnet/Mainnet reads through HTTP, persistence and restart. Proof is historical control, not continuous identity or wallet execution. Receipt observations are not yet connected to accepted orders or payment accounting; the provider can neither reverse a transfer nor authorize spending through this read-only adapter.
