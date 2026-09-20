# First 25 GitHub tasks

Planning snapshot: September 20, 2026. These are **issue-ready drafts, not 25 opened GitHub issues**. IDs are internal planning references. All tasks are unassigned, unpaid and without delivery dates. The statuses describe review readiness or existing pilot state; they do not mean someone is actively doing each research task.

Use [STATUS.md](../docs/community/STATUS.md) for work stages and [DECISIONS.md](../docs/DECISIONS.md) for commitments. APPROVED on an existing boundary or pilot is scoped to that earlier direction. A task still needs its stated decisions and dependencies before execution. The future blockchain name is undecided: Zoora Blockchain or AAI Blockchain.

| ID | Task | Status | Priority |
| --- | --- | --- | --- |
| [AAI-T-001](#aai-t-001) | Review the community foundation and separation rules | PROPOSED | P0 |
| [AAI-T-002](#aai-t-002) | Decide or explicitly defer future blockchain branding | DISCUSSION | P0 |
| [AAI-T-003](#aai-t-003) | Verify the official-links register | PROPOSED | P0 |
| [AAI-T-004](#aai-t-004) | Prepare the token-information verification record | PROPOSED | P0 |
| [AAI-T-005](#aai-t-005) | Design wallet and founder-fee disclosures | PROPOSED | P0 |
| [AAI-T-006](#aai-t-006) | Choose licenses for documentation, code and media | DISCUSSION | P0 |
| [AAI-T-007](#aai-t-007) | Review community conduct and moderation | PROPOSED | P0 |
| [AAI-T-008](#aai-t-008) | Configure and verify private security reporting | PROPOSED | P0 |
| [AAI-T-009](#aai-t-009) | Activate the selected proposal, label and board workflow | PROPOSED | P0 |
| [AAI-T-010](#aai-t-010) | Verify protected-change review controls | PROPOSED | P0 |
| [AAI-T-011](#aai-t-011) | Specify a small mobile community website | IDEA | P1 |
| [AAI-T-012](#aai-t-012) | Specify Telegram community commands | IDEA | P1 |
| [AAI-T-013](#aai-t-013) | Complete the private scanner acceptance record | TESTING | P1 |
| [AAI-T-014](#aai-t-014) | Research durable scanner alert delivery | RESEARCH | P1 |
| [AAI-T-015](#aai-t-015) | Define token, pool and holder metrics | RESEARCH | P1 |
| [AAI-T-016](#aai-t-016) | Draft the read-only dashboard MVP | IDEA | P1 |
| [AAI-T-017](#aai-t-017) | Draft a public GitHub development feed | IDEA | P1 |
| [AAI-T-018](#aai-t-018) | Specify a minimal Discord integration | IDEA | P2 |
| [AAI-T-019](#aai-t-019) | Prepare community branding and meme-tool concepts | IDEA | P1 |
| [AAI-T-020](#aai-t-020) | Research wallet profiles and service-payment utility | RESEARCH | P2 |
| [AAI-T-021](#aai-t-021) | Review a future bounty policy | DEFERRED | P2 |
| [AAI-T-022](#aai-t-022) | Design the launch-history research cohort | RESEARCH | P1 |
| [AAI-T-023](#aai-t-023) | Evaluate jellyfish-inspired model sources | RESEARCH | P2 |
| [AAI-T-024](#aai-t-024) | Specify one offline XAUUSD strategy experiment | IDEA | P2 |
| [AAI-T-025](#aai-t-025) | Define future-blockchain relationship research boundaries | DEFERRED | P2 |

## AAI-T-001

**Title:** Review the community foundation and separation rules

**Work status:** PROPOSED · **Commitment:** APPROVED · **Priority:** P0 · **Phase:** 0 · **Type:** `type: documentation`

**Owner:** Unassigned · **GitHub issue:** Not created

**Scope:** Review this documentation package against the founder's directions. APPROVED refers to the boundaries already requested, not acceptance of every detailed procedure.

**Dependencies:** None; initial review task.

**Acceptance criteria:**

- Confirm the README makes the undecided future blockchain name visible near the top.
- Record that this Solana experiment is separate from a future genesis-native currency with no migration or entitlement promises.
- Record owner decisions on the proposed workflow and leave unresolved choices explicitly open.

**Risks and gates:** Do not merge policy changes or activate settings before review; no token launch or budget decision is implied.

**Token impact:** Community tooling/documentation only; no token behavior change authorized.

## AAI-T-002

**Title:** Decide or explicitly defer future blockchain branding

**Work status:** DISCUSSION · **Commitment:** RESEARCH · **Priority:** P0 · **Phase:** 0 · **Type:** `type: branding`

**Owner:** Unassigned · **GitHub issue:** Not created

**Scope:** Record whether naming remains undecided between Zoora Blockchain and AAI Blockchain. Deferral is a valid outcome; the community working brand does not decide the chain name.

**Dependencies:** [AAI-T-001](#aai-t-001)

**Acceptance criteria:**

- Record the owner's decision or explicit deferral and date.
- Keep the distinction between community token, future chain and future native currency in every affected introduction.
- Do not select a token ticker, genesis economics or conversion rights as part of a naming decision.

**Risks and gates:** Brand research is not approval to rename an external project, register accounts or buy domains.

**Token impact:** Community tooling/documentation only; no token behavior change authorized.

## AAI-T-003

**Title:** Verify the official-links register

**Work status:** PROPOSED · **Commitment:** IDEA · **Priority:** P0 · **Phase:** 0 · **Type:** `type: security`

**Owner:** Unassigned · **GitHub issue:** Not created

**Scope:** Check control and intended purpose of each proposed official account, then prepare evidence-backed link updates.

**Dependencies:** [AAI-T-001](#aai-t-001)

**Acceptance criteria:**

- Verify the repository and organization addresses; document how account control was confirmed.
- Leave website, X, Telegram and Discord unverified entries as TBD until checked.
- Require owner approval for canonical token/link changes and record review date and evidence.

**Risks and gates:** Do not request passwords or publish private account information. Verification is scoped evidence, not a guarantee against later compromise.

**Token impact:** Community tooling/documentation only; no token behavior change authorized.

## AAI-T-004

**Title:** Prepare the token-information verification record

**Work status:** PROPOSED · **Commitment:** IDEA · **Priority:** P0 · **Phase:** 1 · **Type:** `type: solana`

**Owner:** Unassigned · **GitHub issue:** Not created

**Scope:** Review the canonical token-information template and evidence requirements. Populate launch facts only after an actual separately approved launch and verified mint exist.

**Dependencies:** [AAI-T-001](#aai-t-001), [AAI-T-003](#aai-t-003)

**Acceptance criteria:**

- Cover exact name, ticker, mint, launch time, decimals, supply, token program, authorities, metadata controls and liquidity evidence.
- Record source, observation time/slot, verifier and unknowns separately from revoked controls.
- Keep all absent launch data as TBD — DO NOT GUESS; official links reference this one token record.

**Risks and gates:** No mint is created, chosen or funded by this task; a launch gate remains separate.

**Token impact:** Sensitive identity/authority disclosure only; no tokenomics or authority change authorized.

## AAI-T-005

**Title:** Design wallet and founder-fee disclosures

**Work status:** PROPOSED · **Commitment:** IDEA · **Priority:** P0 · **Phase:** 0 · **Type:** `type: documentation`

**Owner:** Unassigned · **GitHub issue:** Not created

**Scope:** Retain the founder's stated intent to receive creator fees allocated to the project for development, marketing and DEX costs. Design a record for real project-controlled wallets and receipts/expenses.

**Dependencies:** [AAI-T-001](#aai-t-001)

**Acceptance criteria:**

- List purpose, controller, restrictions, lock evidence, sale permissions and transaction-history source for any real wallet later disclosed.
- State that no community-controlled treasury, allocation percentages or reporting schedule have been decided.
- Present accounting cadence and privacy choices for owner review before making commitments.

**Risks and gates:** Do not create wallets, expose secrets, move funds, promise holder revenue or treat personal callout rewards as project funds.

**Token impact:** Protected funding/wallet disclosure; owner review required, no routing or expenditure change authorized.

## AAI-T-006

**Title:** Choose licenses for documentation, code and media

**Work status:** DISCUSSION · **Commitment:** RESEARCH · **Priority:** P0 · **Phase:** 0 · **Type:** `type: documentation`

**Owner:** Unassigned · **GitHub issue:** Not created

**Scope:** Prepare license options with official texts and compatibility notes for existing material and future contributions.

**Dependencies:** [AAI-T-001](#aai-t-001)

**Acceptance criteria:**

- Separate documentation, source code, research data and artwork requirements.
- Identify dependency/source restrictions and ask the owner for an explicit selection.
- Keep LICENSE-STATUS.md truthful until a choice is approved; do not claim the project is licensed open source prematurely.

**Risks and gates:** No license grant or contributor agreement is added without owner approval.

**Token impact:** Community tooling/documentation only; no token behavior change authorized.

## AAI-T-007

**Title:** Review community conduct and moderation

**Work status:** PROPOSED · **Commitment:** IDEA · **Priority:** P0 · **Phase:** 0 · **Type:** `type: community`

**Owner:** Unassigned · **GitHub issue:** Not created

**Scope:** Review respectful participation rules and how maintainers handle spam, impersonation, harassment and disagreements.

**Dependencies:** [AAI-T-001](#aai-t-001)

**Acceptance criteria:**

- Define proportionate moderation steps and a way to reconsider a decision.
- Verify a usable reporting route without publishing an invented email address.
- Explain that criticism and negative research results are welcome and token purchases confer no authority.

**Risks and gates:** Do not appoint people, invite members or promise staffed response times without agreement.

**Token impact:** Community tooling/documentation only; no token behavior change authorized.

## AAI-T-008

**Title:** Configure and verify private security reporting

**Work status:** PROPOSED · **Commitment:** IDEA · **Priority:** P0 · **Phase:** 0 · **Type:** `type: security`

**Owner:** Unassigned · **GitHub issue:** Not created

**Scope:** After policy approval, verify an owner-controlled private route and update SECURITY.md accurately. Prepare a redacted incident-response exercise.

**Dependencies:** [AAI-T-001](#aai-t-001)

**Acceptance criteria:**

- Check whether GitHub private vulnerability reporting can be enabled and record the actual configuration.
- Verify receipt using a harmless test report with no exploit or credentials.
- Document triage ownership, remediation communications and reporting fallback without inventing an SLA.

**Risks and gates:** Configuration needs appropriate admin access. The policy file and public security-question template do not themselves enable private reporting.

**Token impact:** Community tooling/documentation only; no token behavior change authorized.

## AAI-T-009

**Title:** Activate the selected proposal, label and board workflow

**Work status:** PROPOSED · **Commitment:** IDEA · **Priority:** P0 · **Phase:** 0 · **Type:** `type: community`

**Owner:** Unassigned · **GitHub issue:** Not created

**Scope:** After plan review, configure the selected labels and optionally a native GitHub Project. Open only the tasks the owner chooses, retaining planning IDs.

**Dependencies:** [AAI-T-001](#aai-t-001)

**Acceptance criteria:**

- Apply the 10 defined status labels and chosen type labels without duplicating existing equivalents.
- Create agreed board fields/views and map actual issue URLs to planning IDs.
- Keep a single status record; verify label/board consistency and mark optional Discussions as inactive unless actually enabled.

**Risks and gates:** This draft contains a board specification and 25 bodies only. Bulk issue creation and platform changes are later actions.

**Token impact:** Community tooling/documentation only; no token behavior change authorized.

## AAI-T-010

**Title:** Verify protected-change review controls

**Work status:** PROPOSED · **Commitment:** IDEA · **Priority:** P0 · **Phase:** 0 · **Type:** `type: security`

**Owner:** Unassigned · **GitHub issue:** Not created

**Scope:** Review CODEOWNERS and available main-branch protections, then select enforceable review settings with the owner.

**Dependencies:** [AAI-T-001](#aai-t-001), [AAI-T-008](#aai-t-008)

**Acceptance criteria:**

- Document owner approval and additional review requirements for all protected economic/control changes.
- Check available ruleset or branch-protection features and bypass permissions rather than assuming enforcement.
- Use a harmless PR to verify the configured process; identify a qualified additional reviewer before sensitive work.

**Risks and gates:** Do not invent required CI checks or review evidence. A sole author cannot provide their own approving GitHub review.

**Token impact:** Protects supply, authorities, fees, migration, governance, treasury and wallets; no such changes are implemented.

## AAI-T-011

**Title:** Specify a small mobile community website

**Work status:** IDEA · **Commitment:** IDEA · **Priority:** P1 · **Phase:** 1 · **Type:** `type: website`

**Owner:** Unassigned · **GitHub issue:** Not created

**Scope:** Propose one mobile-friendly page explaining the experiment, its current status, contribution paths and canonical links.

**Dependencies:** [AAI-T-001](#aai-t-001), [AAI-T-003](#aai-t-003), [AAI-T-006](#aai-t-006)

**Acceptance criteria:**

- Produce a wireframe and content draft with visible future-chain name uncertainty.
- Use clearly marked unknown data and links to the canonical token record.
- Estimate operating cost and define accessibility checks before selecting hosting.

**Risks and gates:** No paid service, website publication, wallet connection or token sale is authorized.

**Token impact:** Community tooling/documentation only; no token behavior change authorized.

## AAI-T-012

**Title:** Specify Telegram community commands

**Work status:** IDEA · **Commitment:** IDEA · **Priority:** P1 · **Phase:** 2 · **Type:** `type: bot`

**Owner:** Unassigned · **GitHub issue:** Not created

**Scope:** Use AAI-P-0001 to design one useful read-only conversation first, then evaluate additional commands.

**Dependencies:** [AAI-T-003](#aai-t-003), [AAI-T-008](#aai-t-008), [AAI-T-015](#aai-t-015)

**Acceptance criteria:**

- Show /help, official-info and missing/stale-data examples; command names are proposals.
- Document permissions, retention, provider limits and notification consent.
- Clarify how the new idea relates to the private scanner without duplicating or publishing private code.

**Risks and gates:** No wallet secrets or trade execution. Do not post messages, install group bots or expose BotFather tokens.

**Token impact:** Community tooling/documentation only; no token behavior change authorized.

## AAI-T-013

**Title:** Complete the private scanner acceptance record

**Work status:** TESTING · **Commitment:** APPROVED · **Priority:** P1 · **Phase:** 2 · **Type:** `type: bot`

**Owner:** Unassigned · **GitHub issue:** Not created

**Scope:** Prepare and, only when deployment is separately authorized, complete checks for the existing AAI Scan private pilot. Current evidence: merged code, 29 offline tests and one public-data request; live operation remains pending.

**Dependencies:** [AAI-T-008](#aai-t-008)

**Acceptance criteria:**

- Record version, date, procedure and evidence for permitted-user access, scan/watch/compare and report clarity.
- Cover Telegram delivery, restart persistence, restore and provider failures; leave unperformed checks pending.
- Use three synthetic report examples for ordinary, missing-data and pool-change cases; do not label token accounts as distinct holders.

**Risks and gates:** APPROVED covers the existing pilot development scope only. Hosting remains paused; no automatic deployment, paid resources or release claim.

**Token impact:** Community tooling/documentation only; no token behavior change authorized.

## AAI-T-014

**Title:** Research durable scanner alert delivery

**Work status:** RESEARCH · **Commitment:** RESEARCH · **Priority:** P1 · **Phase:** 2 · **Type:** `type: bot`

**Owner:** Unassigned · **GitHub issue:** Not created

**Scope:** Describe queue/outbox options for the scanner, including retry, expiry, deduplication and restart behavior.

**Dependencies:** [AAI-T-013](#aai-t-013)

**Acceptance criteria:**

- Specify successful, failed, timed-out and ambiguous-delivery cases.
- Show how alerts survive restarts and avoid uncontrolled duplicate notification loops.
- Document costs and limits; do not claim exactly-once delivery without evidence.

**Risks and gates:** Design only; implementation requires private-repository access and a separately accepted scope.

**Token impact:** Community tooling/documentation only; no token behavior change authorized.

## AAI-T-015

**Title:** Define token, pool and holder metrics

**Work status:** RESEARCH · **Commitment:** RESEARCH · **Priority:** P1 · **Phase:** 2 · **Type:** `type: analytics`

**Owner:** Unassigned · **GitHub issue:** Not created

**Scope:** Create a data dictionary for sources and definitions before charts, rankings or holder claims are implemented.

**Dependencies:** [AAI-T-001](#aai-t-001)

**Acceptance criteria:**

- Distinguish supply, market cap, liquidity, volume, token accounts and unique owners.
- Specify timestamps, refresh expectations, pool-selection rules, missing values and deduplication.
- Record provider terms, cost, coverage and confidence limitations without fabricating data.

**Risks and gates:** Token account counts, price rises and historical peaks must not be presented as safety, user profit or causal proof.

**Token impact:** Community tooling/documentation only; no token behavior change authorized.

## AAI-T-016

**Title:** Draft the read-only dashboard MVP

**Work status:** IDEA · **Commitment:** IDEA · **Priority:** P1 · **Phase:** 2 · **Type:** `type: analytics`

**Owner:** Unassigned · **GitHub issue:** Not created

**Scope:** Use AAI-P-0002 to design a synthetic dashboard showing project activity alongside sourced token and disclosed-wallet observations.

**Dependencies:** [AAI-T-005](#aai-t-005), [AAI-T-015](#aai-t-015)

**Acceptance criteria:**

- Provide mobile wireframes for normal, unknown, stale and unavailable states.
- Show proposal/work status and distinguish documentation, code and deployed services.
- Make any optional contributor recognition criteria reviewable and resistant to spam.

**Risks and gates:** No wallet connection, trading, hidden ranking incentives or invented treasury balances.

**Token impact:** Community tooling/documentation only; no token behavior change authorized.

## AAI-T-017

**Title:** Draft a public GitHub development feed

**Work status:** IDEA · **Commitment:** IDEA · **Priority:** P1 · **Phase:** 2 · **Type:** `type: community`

**Owner:** Unassigned · **GitHub issue:** Not created

**Scope:** Use AAI-P-0003 to specify a feed of public tasks, PRs, releases, milestones and contributions.

**Dependencies:** [AAI-T-009](#aai-t-009)

**Acceptance criteria:**

- Display actual public issue/PR URLs and task statuses without implying private code access.
- Differentiate merged source from a published release and a deployed service.
- Define caching, API-failure behavior and opt-in notification preferences.

**Risks and gates:** Do not leak private scanner metadata or send unsolicited messages; begin with a read-only design.

**Token impact:** Community tooling/documentation only; no token behavior change authorized.

## AAI-T-018

**Title:** Specify a minimal Discord integration

**Work status:** IDEA · **Commitment:** IDEA · **Priority:** P2 · **Phase:** 2 · **Type:** `type: bot`

**Owner:** Unassigned · **GitHub issue:** Not created

**Scope:** Describe an optional community command or development-update integration with minimal permissions.

**Dependencies:** [AAI-T-003](#aai-t-003), [AAI-T-008](#aai-t-008), [AAI-T-017](#aai-t-017)

**Acceptance criteria:**

- Identify one user need, one channel flow and the required permissions.
- Define opt-in behavior, retention, moderation controls and removal steps.
- Estimate operating cost and leave real installation and Discord account verification pending.

**Risks and gates:** No server creation, invitations, token collection or unsolicited notifications.

**Token impact:** Community tooling/documentation only; no token behavior change authorized.

## AAI-T-019

**Title:** Prepare community branding and meme-tool concepts

**Work status:** IDEA · **Commitment:** IDEA · **Priority:** P1 · **Phase:** 0 · **Type:** `type: branding`

**Owner:** Unassigned · **GitHub issue:** Not created

**Scope:** Use AAI-P-0004 to propose an editable asset pack and, optionally, a later meme-generator concept.

**Dependencies:** [AAI-T-002](#aai-t-002), [AAI-T-006](#aai-t-006)

**Acceptance criteria:**

- Provide asset provenance, font/media usage terms and editable sources.
- Test avatar-scale readability and mobile contrast with clearly labeled mockups.
- Avoid mint-like placeholders, profit promises or branding that settles the undecided future-chain name.

**Risks and gates:** Review concepts before publication; no domain purchase, advertising spend or token naming decision.

**Token impact:** Community tooling/documentation only; no token behavior change authorized.

## AAI-T-020

**Title:** Research wallet profiles and service-payment utility

**Work status:** RESEARCH · **Commitment:** RESEARCH · **Priority:** P2 · **Phase:** 4 · **Type:** `type: solana`

**Owner:** Unassigned · **GitHub issue:** Not created

**Scope:** Compare wallet identity, badges/token gates and one AAI service-credit idea; select at most one narrow design for a later proposal.

**Dependencies:** [AAI-T-005](#aai-t-005), [AAI-T-008](#aai-t-008), [AAI-T-015](#aai-t-015)

**Acceptance criteria:**

- Explain user benefit and compare a wallet-free approach.
- For a payment concept, specify quote, consent, confirmation, duplicate/incorrect/late payment, service failure and refund states using test assets only.
- Document privacy, replay and permission risks; state no future-chain or native-currency rights.

**Risks and gates:** No custody, wallet secrets, mainnet transfers, automated trades or token utility promise. Separate security/program review precedes any implementation.

**Token impact:** Potential future token utility only; asset identity, pricing, wallets and governance remain undecided.

## AAI-T-021

**Title:** Review a future bounty policy

**Work status:** DEFERRED · **Commitment:** FUTURE · **Priority:** P2 · **Phase:** 3 · **Type:** `type: community`

**Owner:** Unassigned · **GitHub issue:** Not created

**Scope:** Use AAI-P-0006 and the bounty policy draft to define reviewed work and payment terms before any paid offer.

**Dependencies:** [AAI-T-005](#aai-t-005), [AAI-T-006](#aai-t-006), [AAI-T-010](#aai-t-010)

**Acceptance criteria:**

- Specify scope, acceptance criteria, reviewer, dispute/cancellation rules and source of approved funding.
- Use the proposed bounty stages with evidence requirements and actual payment confirmation.
- Record owner acceptance of the arrangement before publishing any bounty.

**Risks and gates:** Deferred until funding and review structure exist. No amounts, recipients, custody design or real-money payouts are authorized.

**Token impact:** Potential project expenditure only; no token-holder revenue or rewards promised.

## AAI-T-022

**Title:** Design the launch-history research cohort

**Work status:** RESEARCH · **Commitment:** RESEARCH · **Priority:** P1 · **Phase:** 1 · **Type:** `type: research`

**Owner:** Unassigned · **GitHub issue:** Not created

**Scope:** Extend the launch-study protocol to compare complete eligible cohorts, including failures, with reproducible definitions of liquidity, volatility and large runs.

**Dependencies:** [AAI-T-015](#aai-t-015)

**Acceptance criteria:**

- Define inclusion windows, success/failure outcomes, censoring, missing data and observation dates before analysis.
- Prevent future-data leakage and report survivorship, coverage and selection limitations.
- Compare hypotheses with baselines; distinguish correlation from causation and publish negative findings.

**Risks and gates:** No claim of a perfect launch, guaranteed runner or volatility control; no purchase of datasets or manipulation strategy.

**Token impact:** Community tooling/documentation only; no token behavior change authorized.

## AAI-T-023

**Title:** Evaluate jellyfish-inspired model sources

**Work status:** RESEARCH · **Commitment:** RESEARCH · **Priority:** P2 · **Phase:** 4 · **Type:** `type: research`

**Owner:** Unassigned · **GitHub issue:** Not created

**Scope:** Inventory primary biological research and accessible datasets for a possible bio-inspired offline model; crow alternatives can be compared explicitly.

**Dependencies:** [AAI-T-015](#aai-t-015)

**Acceptance criteria:**

- Record species, source, model resolution, available data, licenses and unknowns.
- Separate actual mapped biological data from an analogy or animal-themed crypto branding.
- Define a small replay/paper benchmark against simple baselines and a no-trade case, including costs and failure assumptions.

**Risks and gates:** No claim that a biological model is profitable or reproduces a nervous system without evidence. No wallet connection or automatic trading.

**Token impact:** Community tooling/documentation only; no token behavior change authorized.

## AAI-T-024

**Title:** Specify one offline XAUUSD strategy experiment

**Work status:** IDEA · **Commitment:** RESEARCH · **Priority:** P2 · **Phase:** 4 · **Type:** `type: research`

**Owner:** Unassigned · **GitHub issue:** Not created

**Scope:** Write an unambiguous strategy and evaluation specification for the gold EA research idea, without executing orders.

**Dependencies:** [AAI-T-001](#aai-t-001)

**Acceptance criteria:**

- Define entry, exit, invalidation, session, sizing and exposure rules.
- Record data/broker assumptions and spread, commissions, swaps, slippage and data limitations.
- Reserve a later evaluation period; report drawdowns, losing periods and negative results.

**Risks and gates:** Offline simulation only under current rules. No broker connection, demo/live automatic orders, credentials or performance promise.

**Token impact:** Community tooling/documentation only; no token behavior change authorized.

## AAI-T-025

**Title:** Define future-blockchain relationship research boundaries

**Work status:** DEFERRED · **Commitment:** FUTURE · **Priority:** P2 · **Phase:** 5 · **Type:** `type: research`

**Owner:** Unassigned · **GitHub issue:** Not created

**Scope:** Record questions for a separate future protocol research process under an undecided Zoora or AAI name. Preserve native-genesis intent and separation from the Solana experiment.

**Dependencies:** [AAI-T-001](#aai-t-001), [AAI-T-002](#aai-t-002), [AAI-T-010](#aai-t-010)

**Acceptance criteria:**

- List research questions and unresolved governance, technical, security and applicable legal-review needs.
- Preserve the seven-step research/design/review/proposal/approval/testing path before any relationship is considered.
- Explain that conceptual migration mechanisms and backing constraints confer no conversion, native currency, bridge, validator, revenue or governance rights.

**Risks and gates:** Deferred until a separate research scope is accepted. No bridge design, migration announcement, token allocation or chain implementation is approved.

**Token impact:** Potential future relationship only; NOT PROMISED and no current monetary-architecture change.
