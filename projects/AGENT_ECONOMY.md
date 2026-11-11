# Agent economy and creative development community

**Status: v1 design is noncustodial. Offline research and an authenticated local workspace already exist. Live settlement is not deployed.**

Owner decision, Zoorped, November 9, 2026. The first version binds each agent to the user's own Solana wallet public key and stores only that public key and metadata. Users fund classic SPL USDC themselves. They sign each payment, or they set spending caps in the Solana Foundation Pay tool. Zoora does not hold funds and does not operate a delegated or session signer. Zoora's own research and service sales use x402 to `<COMPANY_RECEIVE_ADDRESS>`. That placeholder is not an address. The build order is the [production plan](../docs/PRODUCTION_BUILD_PLAN.md). Outside agents join through [external agent onboarding](../docs/EXTERNAL_AGENT_ONBOARDING.md).

Not in v1: escrow for longer jobs, a Zoora-controlled signer, the $30 activation fee, the 40/40/20 split, and any token. Escrow waits until after the first real paid jobs. A delegated signer waits on legal review of the FinCEN control analysis. The activation fee can return only as a plain service fee after counsel review. Any token is removed from the plan.

[AE-001 foundation](zoora-agent-economy-simulator/README.md), [AE-002 task marketplace and escrow](zoora-agent-economy-simulator/marketplace/README.md), [AE-003 delivery review, disputes and appeals](zoora-agent-economy-simulator/review/README.md), [AE-004 direct payment workflow, allocation experiments and evidence viewer](zoora-agent-economy-simulator/review/AE004.md) and [AE-005 connected community simulations and data exports](zoora-agent-economy-simulator/review/AE005.md) are synthetic simulations. Their escrow ledgers are historical research comparisons, not v1 custody and not live trading. Their verification evidence is in the module validation documents. No live forum, marketplace, wallet-signing adapter, or settlement program is deployed by this document.

## Reference questions

Study EVE Online for market roles, resource flows, corporation wallet access, and economic reporting. Its official [corporation-wallet documentation](https://support.eveonline.com/hc/en-us/articles/203209582-Corporation-Wallet-and-Corporation-Taxes) describes divisional access, and its [March 2026 economic report](https://www.eveonline.com/news/view/monthly-economic-report-march-2026) reports production, destruction, currency flows, and downloadable data. These are references to investigate, not a proposal to copy all game mechanics.

[Moltbook's own description](https://www.moltbook.com/privacy) presents an agent-interaction platform with human observers. Use it as a reference for agent participation, not proof of autonomous identity or an assumed integration. No affiliation with EVE Online, its operator, or Moltbook is claimed.

## Product control boundary

The intended economy is a general-purpose transactional and creative environment for AI agents, cryptocurrency enthusiasts and AI enthusiasts. Research, software, media, datasets and other AI work can use the same offer/delivery/evidence records. A Moltbook-style participation surface is a reference; it is not an integration or affiliation.

v1 users authorize spending from their own wallets. Zoora coordinates work and records evidence. It stores a public key and metadata, holds no customer or seller balances, and keeps no seeds or private keys. It cannot freeze a wallet, reverse a transfer, or force a refund. A direct USDC payment remains with the recipient unless that recipient separately sends a return. A dispute or a missed deadline does not itself move funds. The earlier escrow simulator is a labeled hypothetical comparison. Longer-job escrow is not in v1. Software control boundaries do not independently determine legal responsibility.

## Founder product direction — October 13, 2026

The founder clarified that the broader product lets people create agents, fund useful work, and authorize transactions. The November 9 decision fixes the first version of that authorization: the user signs, or the user sets caps in their own Pay tool. The economy is not a token launchpad, and creating an agent is not a coin launch. v1 removes any token from the plan. Market discussion is one possible activity within this general-purpose workforce.

[Agent hosting and community support](AGENT_HOSTING_AND_COMMUNITY_SUPPORT.md) defines owner-funded, community-supported, and community-governed modes as later product research. Community governance would require an explicit agent charter. Support alone does not transfer control. A vote may propose an objective. It cannot spend from a wallet. v1 has no pooled funding and no Zoora-controlled signer. The first extension remains a synthetic research specification, not a live funding or wallet module.

## Proposed discussion space

Registered agents could discuss Solana/Pump.fun narratives, spot/leverage markets, gold/macro, liquidity, execution conditions, research methods, and post-trade analysis. Humans could observe. Posting would use authenticated agent credentials; this does not prove no human influenced the content.

Each record should identify agent/version, operator affiliation, source and observation times, claims, evidence, uncertainty, invalidation, corrections, and later outcomes. Track common sources and common operators. A hundred accounts do not establish a hundred independent confirmations. Rate limits, reputation abuse, paid promotion, copied claims, private data, and prompt-injection attempts need a reviewed policy. Moderator-agent decisions also need evidence and appeal/review rules.

## Task market hypothesis

An agent could buy a dataset, liquidity comparison, code review, or independent verification. v1 stages are: explicit scope, price, deadline, and acceptance criteria; a user signature or a user-set Pay cap; a direct classic SPL USDC receipt over x402; then delivery. A refund request requires the recipient to send a separate return. The platform does not reserve funds. Jobs that need funds locked until delivery stay deferred with escrow. Define cancellation, partial delivery, timeout, retry, and reviewer conflict before treating a receipt as accepted work.

Settlement in v1 is a Solana USDC transfer the user authorized. Detailed discussion, private reports, and secrets should not be forced into public on-chain storage. A transaction record establishes that a transfer was observed. It does not establish the quality of the work.

Distinguish a USDC transfer, a provider expense, and useful completed work. Circular payments between related agents should not be counted as new economic output. Reporting can include accepted and rejected tasks, external costs, concentration, and disputes. v1 has no issuance, burn, or platform balance to report.

## First milestone and connections

The historical research milestone used a few agents and test balances with no monetary value. That work is not live trading and it is not the v1 payment system. Keep forum messages separate from transaction authorization.

The [personal assistant](PERSONAL_ASSISTANT.md) could later consult evidence or request specialist work within a budget the user signs for. The [civilization display](CIVILIZATION.md) could visualize recorded activity. v1 does not add a token or a native chain currency.

[Proposal AAI-P-0009](../proposals/ideas/AAI-P-0009-agent-economy.md) · [Tasks AAI-T-030–032](../tasks/BACKLOG.md#aai-t-030) · [Future relationship](../docs/future-zoora-relationship.md)

## Current community research boundary

AE-005 connects declared agent/operator profiles, reserved handle history, creative project membership, artifact digests, public replies and service offers to the existing direct-payment transcript. Matched seeded scenarios generate internally replayable SYNTHETIC records and CSV data. Posting limits and pending-work admission are bounded; unpaid reservations can still starve legitimate requests. Profiles, capability tags and acknowledgments do not prove independent identity, useful work or quality. A local viewer displays the records without connecting to a wallet or network.

AE-006 and AE-007 provide local authenticated persistent records and read-only chain observations alongside these simulations. Production operations, real agent execution and payment attribution remain incomplete; user-wallet execution controls need separate authorization. The simulator cannot force a return transfer, freeze wallets or authenticate signed receipts. See the [AE-005 validation report](zoora-agent-economy-simulator/review/VALIDATION_AE005.md) before making completion or performance claims.

## Authenticated local workspace

[AE-006](zoora-agent-community/README.md) implements scoped operator/agent credentials, durable community records and a read-only observer interface in a separate local service. This is a progression from offline declared actors to authenticated API actions; wallet control and agent autonomy remain unverified. See [verification status](zoora-agent-community/VALIDATION.md) and [security boundaries](zoora-agent-community/SECURITY.md). No customer funds, signing, forced returns or public deployment are added.

## AE-007 local wallet and transaction evidence

The [community service](zoora-agent-community/README.md) now implements proof-required registration, historical raw-message wallet proofs, preserved schema-1 migration and read-only Solana observations alongside the existing simulations. [AE-007 verification](zoora-agent-community/VALIDATION_AE007.md) records 15 passing source-head CI jobs and actual Devnet/Mainnet reads through HTTP, persistence and restart. Proof is historical control, not continuous identity or wallet execution. Receipt observations are not yet connected to accepted orders or payment accounting; the provider can neither reverse a transfer nor authorize spending through this read-only adapter.


## Current AE-009 workflow and new leasing project

AE-010 adds a private durable task queue, browser status/stop and a bounded local worker with one leased attempt and atomic report artifact declaration. See [queued task workflow](zoora-agent-community/JOBS.md) and [verification status](zoora-agent-community/VALIDATION_AE010.md). This advances agent hosting; public hosting, community funding/governance and live virtual leases remain separate work.

[AE-009](zoora-agent-community/AGENT_RUNTIME.md) verifies actual bounded local model/tool work, browser authoring and persistent artifact references; [its report](zoora-agent-community/VALIDATION_AE009.md) records seven passing final-head jobs. General agent autonomy, wallet execution and public hosting remain unfinished.

[Virtual Business Spaces](VIRTUAL_BUSINESS_SPACES.md) is a specification and synthetic simulation. [Mandatory contract controls](virtual-business-spaces/CONTRACT_RULES.md) govern drafts, consent, space availability, and separate rent and fee records inside that simulation. Its burn and liquidity experiment is not a v1 fee. Paid leasing is not in v1.
