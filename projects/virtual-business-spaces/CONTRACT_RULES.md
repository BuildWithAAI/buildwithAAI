# Virtual Business Spaces — mandatory contract controls

**Policy draft v0.1, October 13, 2026. Required for the proposed implementation. October 19: [VL-002](VALIDATOR_VL002.md) implements one controlled synthetic template/draft validator; the complete policy, agreement acceptance and enforcement engine remain unfinished. Legal templates and production parameters are unreviewed.**

The founder approved a strict-rule approach. Before an actual customer agreement, counsel must review the templates and drafting workflow, and the owner must accept the exact operational/economic policy. Simulation can use explicitly synthetic template fixtures and simulated approvals.

The validator operates outside the model. A model can fill permitted fields and explain a draft; it cannot change the rule set, approved clauses, fee rates, recipients or its own authority. Validation is technical compliance with policy, not a legal-enforceability certificate.

## Rules

| Rule | Mandatory condition | Failure behavior |
|---|---|---|
| VCR-001 — approved template | Use one identified template/version and approved clause set; record jurisdiction/review status and canonical agreement hash. No generated clause replacements. | Remain DRAFT/REVIEW_REQUIRED; no activation. |
| VCR-002 — real parties and authority | Record the licensor/licensee and evidence of their authority. The provider must have rights to license/sublet the particular space. Wallet control does not establish legal identity or business authority. | Missing/unknown authority blocks real acceptance; simulated authority stays labeled SYNTHETIC. |
| VCR-003 — exact space and rights | Specify unique space ID, exclusive/shared use, permitted business functions, capacity, content rights and permitted subletting. | Reject ambiguous or unsupported rights. |
| VCR-004 — bounded availability | Use explicit time zone/UTC instants, half-open intervals, notice/grace/renewal rules and controlled conflict checks. | Reject overlapping exclusive leases and renewals that conflict with accepted reservations. |
| VCR-005 — disclosed economics | Preserve provider rent, platform fee, currency/units, authenticated mint if relevant, price source/time/expiry, deductions and refund rules. | No hidden fee, mutable accepted quote or undisclosed recipient. |
| VCR-006 — agreement-specific consent | Both authorized parties approve the same final template/terms hash. Bind acceptance to instance, agreement, version, parties and scope; prevent expiry/replay. | A historical wallet-enrollment proof or forum message cannot substitute for agreement acceptance. |
| VCR-007 — separate money and access | Future user-authorized payments go directly to the provider and separately to the platform. Access changes do not freeze wallets or reverse payments. | Never fabricate a transfer/refund from a dispute, deadline or deactivation. |
| VCR-008 — actual earning and reserves | Only distributable net earned platform fees can enter treasury/burn/LP allocation. Protect required refunds/taxes and approved reserves; never allocate provider rent/deposits. | Block allocation when eligibility or available funds are unknown or insufficient. |
| VCR-009 — explicit allocation policy | Exact fee/split/rounding rules and recipients are versioned and owner-reviewed before live use. Current percentages are experiment proposals. | Agents cannot alter allocations, redirect funds or treat simulation approval as mainnet authority. |
| VCR-010 — separate action evidence | Keep proposed budget, submitted action, confirmed outcome and failure distinct for transfers/burns/LP deposits. Retain source and reconciliation evidence. | No confirmed burn from a planned budget; no liquidity-added claim from an AAI transfer or reserve entry. |
| VCR-011 — operational and content terms | State support/downtime duties, prohibited uses, ownership, data export/retention, suspension/termination, remedies and dispute process. | Unresolved mandatory terms require review; cancellation does not erase audit or create an automatic refund. |
| VCR-012 — private sensitive records | Keep legal identity documents, private agreements, credentials and secrets out of public feeds/on-chain payloads. Publish appropriately redacted allocation/evidence summaries. | Reject inappropriate publication; log authorized access without exposing secrets. |
| VCR-013 — no unsupported promises | No guaranteed AAI stability/appreciation, profit, holder distributions, future native-coin allocation or automatic migration rights. | Reject prohibited terms/marketing claims and route exceptions to review. |
| VCR-014 — deterministic and durable audit | Preserve actor/authority, template/policy version, observed/available time, facts, missingness, state, reason and immutable decision history. Numeric values remain exact. | Invalid metadata/corruption is a hard failure; preserve refusals and never silently rewrite accepted terms. |

## Lease lifecycle and independent facts

Draft, review, acceptance, activation, renewal, expiry, cancellation and dispute are separate transitions. The first implementation executes only their simulated equivalents. A payment observation is not acceptance or a complete legal/operational entitlement by itself.

For any future real integration, accepted terms define activation conditions and obligations. Late, partial, duplicate or out-of-terms transfers must remain observed facts while their policy interpretation is recorded separately. Unknown confirmations stay unknown. Provider rent and platform fees have separate attribution and refund records.

Changing access must follow accepted terms and applicable obligations, preserve agreed export/retention options and remain auditable. Unpaid reservations need admission limits, expiry and measured starvation tests. Their policy must not grant an unbounded denial-of-service lever.

## Protected review and agent permissions

First-stage agents have no real signing, spending, wallet-secret, arbitrary code execution or public-deployment capability. Later scoped transaction preparation/execution requires a separate policy with transaction previews, verified destinations/mints/pools, spending/deadline limits, revocation and retained failures. The model cannot authorize itself.

A future LP policy must identify the paired asset, deposit budget, verified pool, LP position/controller, withdrawal/locking terms, fee ownership and loss exposure. The current liquidity allocation is a reserve proposal; no provider/pool/controller has been selected.

Changes to mandatory clauses, identity/authority standards, payment/refund behavior, fee/split parameters, recipients or live execution permissions require documented review before taking effect. Existing accepted agreements keep their original versions unless a separately recorded amendment is validly accepted.

## Required proof before completion claims

Tests must reject unauthorized clauses/fields, forged parties, bad intervals, overlap, stale prices, altered accepted hashes, repeated/expired consent, token/mint mismatch, duplicate or misattributed receipts, unsafe public content and premature fee allocations. Simulated accounting must reconcile every budget and action state and reproduce under replay.

An agent must report IMPLEMENTED, TESTED, VERIFIED and DEPLOYED separately. Passing schema/replay tests does not certify legal validity, market stability, customer demand or safe mainnet use. No paid customer agreement is authorized by this draft.
