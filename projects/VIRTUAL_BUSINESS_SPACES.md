# Virtual Business Spaces — agent development project

**Founder-originated idea. Approved October 13, 2026 for specification and SYNTHETIC simulation. Runtime implementation has not started. Paid launch, real contract execution, token burns and liquidity deposits are outside this approval.**

[Development issue #19](https://github.com/BuildWithAAI/buildwithAAI/issues/19) · [Proposal AAI-P-0012](../proposals/approved/AAI-P-0012-virtual-business-spaces.md) · [Strict contract rules](virtual-business-spaces/CONTRACT_RULES.md) · [Current software status](../docs/CURRENT_STATUS.md)

## Purpose and first useful output

Businesses could license digital storefronts, offices or workspaces inside the Zoora community. Spaces should have defined business functions: service listings, inquiry links, project collaboration, content display and bounded hosting or agent-workspace capacity.

Agents prepare drafts from controlled templates, explain supplied terms and manage permitted lifecycle records. The contract policy and application validator control permissions. An agent's generated text is never authority to change that policy.

The first deliverable is a deterministic offline laboratory for space listings, approved-template drafts, simulated acceptance, availability, separate rent/fee records, expiry, cancellation, disputes and public accounting exports. Every actor, amount, acceptance and payment in that laboratory is SYNTHETIC with no monetary value. There is no actual legal lease or transaction in this first stage.

## Founder decision and project scope

The founder requested that this become a known agent development project with a strict contract rule set and a platform fee intended to help fund development and strengthen the economy. This accepts the project direction and its specification/simulation phase.

The production platform fee rate, allocation percentages, payment assets, verified AAI mint, recipients, pool, LP controller/lock policy, refund conditions, templates, jurisdiction and operating budget remain subject to explicit review. No funding, contributor compensation, launch date or public stability/return promise is created.

This project stays inside BuildWithAAI/buildwithAAI. Its first implementation should extend the existing offline economy research through an isolated leasing adapter; a later community API/UI adapter is a separate milestone. Preserve existing replay identities and golden outputs. Zoora blockchain consensus, validators, native-token genesis/economics and wallet cryptography remain outside this module.

The project's implementation maintainer and coding-agent assignment are currently unassigned. Creating the issue records a work queue; it does not start an unattended development agent. AE-009's current local runner has bounded read/measurement tools and cannot edit repositories or run generated code.

## Proposed fee model for experiments

Rent is paid to the space provider. A separately disclosed platform fee is paid to BuildWithAAI. The platform should receive its earned service revenue; the architecture does not route the provider's rent through a platform wallet.

Quote the service fee in USD and, if AAI settlement is selected later, show its exact token quantity, authenticated mint, price source, observation time and expiry before approval. Failed or stale quotes cannot silently change the agreement.

Simulation baseline only:

| Field | Proposed experiment value |
|---|---:|
| Platform fee | 10% of provider rent, added to checkout |
| Treasury allocation | 50% of distributable net earned platform fees |
| AAI burn allocation | 30% of distributable net earned platform fees |
| Liquidity reserve allocation | 20% of distributable net earned platform fees |

Distributable net fees exclude processing costs and amounts needed for required refund/tax obligations or other approved reserves. Do not count provider rent, refundable deposits, unpaid invoices or unsettled payments as platform revenue. The simulation must distinguish gross collected fees, earned fees, deductions/reserves and the distributable remainder.

Illustration: rent 100 plus fee 10 gives total checkout 110. If the full fee 10 is distributable, the split is treasury 5, burn budget 3 and liquidity budget 2. Amounts in the laboratory are simulated units, not collected dollars or AAI.

A burn budget is not a confirmed burn. A liquidity reserve is not an LP deposit. Future confirmation requires independently reconciled chain evidence; the liquidity budget includes the paired asset and deposit costs. Specify who controls the resulting LP position and whether withdrawals are possible before offering that policy publicly.

Keep an operating allocation for development and service costs. Accumulated AAI is an asset balance, not proof of realized profit. No mechanism guarantees token price stability, appreciation, trading returns or a functioning economy. These lease fees are separate from any agent-access bond/activation policy.

## Agent task queue

All implementation tasks below are queued and unassigned. Legal/protected review gates must be recorded by the relevant authorized reviewer.

| ID | Deliverable | Completion evidence |
|---|---|---|
| VL-001 | Space/party/authority/lease schema and versioned policy specification | Typed bounds, exact units, clock semantics, state transitions and unresolved choices documented |
| VL-002 | Deterministic template/parameter validator | Unknown clauses/fields, unauthorized terms, bad amounts/dates, stale quotes and version mismatches rejected |
| VL-003 | Offline listing and lease lifecycle | Overlap prevention, idempotent simulated acceptance, expiry/cancellation and content-access outcomes replay exactly |
| VL-004 | Separate rent and platform-fee ledger | Fees/reserves/treasury/burn budget/LP budget reconcile without double-counting or use of provider rent |
| VL-005 | Matched adversarial and economic scenarios | Baseline, unpaid reservations, outage, abusive subletting, forged authority, duplicate receipts and refund exposure tested with negative findings retained |
| VL-006 | Verified reports, CSV and viewer | SYNTHETIC labeling, exact integers, source versions, actor relationships and failed/unknown states preserved; hostile text safely rendered |
| VL-007 | Production-readiness specification | Attorney-reviewed templates/workflow, parties/authority, price/provider/mint policy, controlled signing and operational prerequisites independently reviewed before a separately approved live stage |

The coding agent must inspect the existing implementation, reuse compatible validation/replay conventions, isolate changes, run relevant checks and preserve failed evidence. It must stop at missing authority, illegal policy transitions or unavailable required evidence; it must not weaken tests to obtain a green result.

## Proposed acceptance scenarios

Run overlapping and boundary-adjacent bookings; renewals against conflicting reservations; impersonation and expired/replayed acceptance; altered price/fee/currency/template hashes; prompt injection requesting unauthorized clauses or recipients; stale quotes; rent-only or fee-only payment records; duplicated and misattributed receipts; refunds after attempted allocation; zero/negative distributable fees; insufficient paired liquidity assets; reversible-access changes with retained data; host outage and restart.

Replay must reproduce complete decisions and balances/budgets. Accounting must conserve modeled units, disclose related operators and distinguish deposits, payments, refunds, operating expenses, asset holdings, burns and LP exposure. Compare fee/allocation variants and report effects on modeled participation, affordability, operating coverage, concentration and disputes. A simulation is not evidence of actual user demand, price support or real-world legal enforceability.

## Sources and review limits

Checked October 13, 2026: [Second Life rentals](https://secondlife.aditi.lindenlab.com/en-US/land/rentals), [Second Life virtual-land license terms](https://lindenlab.com/legal/second-life-terms-and-conditions), [Decentraland rentals](https://docs.decentraland.org/marketplace/rentals), [ESIGN Act 15 USC 7001](https://www.law.cornell.edu/uscode/text/15/7001), [Texas Government Code 81.101](https://statutes.capitol.texas.gov/?artSec=81.101&chapter=GV.81&code=GV&tab=1), [Solana burn mechanics](https://solana.com/docs/tokens/basics/burn-tokens), [Raydium liquidity mechanics](https://docs.raydium.io/user-flows/add-remove-liquidity).

These references support feasibility and identify review questions; they do not establish permission to offer any particular real contract or token arrangement. This brief is a development policy, not an attorney-reviewed agreement or legal opinion.

