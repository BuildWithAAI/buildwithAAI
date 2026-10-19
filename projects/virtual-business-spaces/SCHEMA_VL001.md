# VL-001 — bounded synthetic leasing definitions

**2026-10-19 · schema 1 · SYNTHETIC_VL001_NO_MONETARY_VALUE.** This milestone implements inert typed records and structural checks in the [isolated Rust crate](../zoora-agent-economy-simulator/leasing/README.md). It does not implement an agreement generator, legal/business-authority verification, acceptance engine, lease registry, persistence/replay, accounting, public service or payment execution. Scope comes from [approved proposal AAI-P-0012](../../proposals/approved/AAI-P-0012-virtual-business-spaces.md) and [issue #19](https://github.com/BuildWithAAI/buildwithAAI/issues/19).

## Record and bound definitions

| Record | Enforced structural bounds | What remains unverified |
| --- | --- | --- |
| Identifier | 3–64 ASCII bytes; starts lowercase; lowercase letters/digits/underscore only | Registry uniqueness, real identity, ownership and authority |
| Digest / version pin | Exactly 32 nonzero bytes; explicit identifier and nonzero u32 revision | Digest/content binding, trusted registry and reviewer approval |
| UTC milliseconds | Integer Unix milliseconds, 0–253402300799999 inclusive | External clock accuracy and signed observation time |
| Interval | Nonempty `[start,end)`; exact subtraction; overlap iff both starts precede the other end | Multi-lease exclusivity/booking conflicts and reservation admission |
| Fact time | Observed and available instants separately retained; observed ≤ available | Source credibility and freshness policy |
| Synthetic units | Exact u64 integers; checked addition; overflow refused in debug and release | Any monetary value, exchange rate, earning or settlement |
| Quote | Separate provider rent/platform fee; explicit source, observation/availability and half-open validity; separate recipient party IDs | Source/price authenticity, current quote acceptance and payment evidence |
| Party | Named party and related operator identifiers | Human/legal identity, independent control or business rights |
| Authority claim | One named party/delegate/space, evidence version pin, validity and 1–5 unique enumerated scopes | Authenticity, current validity, delegation chain and authority to license/sublet |
| Space | Unique-shaped ID and provider ID; exclusive/shared mode; capacity 1–1024; 1–5 unique enumerated functions; no subletting permission | Actual ownership, availability, hosting capacity and content/license rights |
| Policy | Explicit version pin, max duration 1 ms–365 days; notice/grace each 0–max duration | Production tariff, approved jurisdiction/template/operating policy |
| Draft lease | Instance/agreement IDs, provider/licensee/platform records, scoped claims, policy/template pins, declared terms digest, interval, quote, optional parent lease | Canonical complete agreement hash, consent, legal validity and entitlement |

The one-year horizon and capacity/identifier/list limits are laboratory resource bounds, not a proposed production lease or fee policy. There are no default platform fee rates or allocations. Test quotes are explicitly synthetic examples. Provider rent and platform fee remain distinct fields; the displayed sum is not revenue, a receipt, a burn budget or an LP deposit.

Draft construction checks provider/space binding, distinct provider/licensee IDs, matching declared claim party/space/required scope, exact rent/fee recipient attribution, maximum duration and no self-parent renewal. No claim becomes trusted by passing these checks. The same operator may control multiple named parties; the draft exposes that relationship, including a related platform operator, rather than treating the parties as independent.

An expired quote or authority claim can be retained as draft material. Only a future validator may decide whether it is usable at an explicit decision time. This crate has no accepting/activating method, so structural success never creates an accepted lease, a payment fact or access. Records are private after validated construction and exposed by immutable references; cloning a draft's input and changing it requires validation through a new constructor.

## Clock, consent and renewal specification

All decisions in later milestones must receive an explicit bounded UTC millisecond instant. No wall clock, local timezone or daylight-saving conversion is read by this crate. Validity uses start ≤ decision time < end; touching exclusive intervals do not overlap. Observation/availability times must remain separate from quote validity, lease duration and future consent expiry. Future source-age and authority checks must not substitute one of these clocks for another.

An eventual consent must bind the exact instance, agreement, template/policy revision, complete canonical terms digest, party/actor/scope and a bounded one-use validity/nonce. Those consent records, verification and replay consumption are **not implemented** in VL-001. Historical wallet enrollment is not agreement consent or business authority.

A renewal is a new draft referencing a prior agreement ID. It keeps its own ID, pins, interval and quote; it cannot overwrite the prior record. Whether the parent exists, permits renewal or conflicts with another reservation is a future registry/lifecycle check. Accepted revisions may change only through separately accepted amendments; there is no amendment engine here.

## Independent lifecycle axes

These are definitions for the later engine, not implemented transitions:

| Axis | States | Required later transition gate |
| --- | --- | --- |
| Agreement | DRAFT → REVIEW_REQUIRED → AWAITING_ACCEPTANCE → ACCEPTED → ENDED | Approved synthetic registry/terms; matching scoped consents; explicit expiry/cancellation reason and retained history |
| Access | NOT_GRANTED / GRANTED / SUSPENDED / ENDED | Accepted terms and separately evaluated operational/payment policy; no inference from a balance or dispute alone |
| Payment facts | UNOBSERVED / PARTIAL / REPORTED_COMPLETE / UNKNOWN | Separately attributed evidence; reported complete is not independently verified settlement |
| Dispute | NONE / OPEN / RESOLVED | Scoped recorded filing/outcome; no automatic refund, transfer reversal, deletion or wallet freeze |
| Renewal | New draft plus parent reference | New bounded quote/consents, parent rights and conflict checks; original remains intact |

Every constructed `DraftLease` exposes only DRAFT, NOT_GRANTED, UNOBSERVED and NONE. Other enum variants describe the intended vocabulary and confer no capability. The schema cannot grant access or initiate a state transition.

## Mandatory terms and next implementation gates

VL-002 must add a strict bounded input format with unknown-field rejection, an approved **synthetic** template/clause registry, canonical hashing and policy/version/authority/time checks with retained refusal reasons. Required template coverage includes support/downtime, prohibited uses, content ownership, export/retention, termination/remedies/refunds and dispute handling. No generated legal clauses or unreviewed production template is selected here.

VL-003 must add admission/overlap controls, acceptance/activation/expiry/cancellation/dispute processing and deterministic replay with refused events retained. VL-004 must reconcile separate rent/fee ledgers, earning and reserves before proposed allocations. VL-005/006 must add matched adversarial/economic scenarios and independently verified redacted exports. VL-007 remains the separate production-readiness review. None of VCR-001–014 is claimed fully enforced by this structural milestone.

Unresolved production choices remain templates/jurisdiction/review, party/authority evidence, operating/export/retention/refund rules, duration/renewal/reservation limits, currency/mint/source/destinations, fee/split/rounding, reserves, pool/controller/withdrawal terms, signing and host operations. No simulated choice approves those matters.

## Verification and status

Seventeen tests cover malformed/oversized identifiers, absent pins/revisions, extreme timestamps, half-open adjacency and symmetric overlap, exact separate amounts/overflow, policy/selection/capacity bounds, wrong party/space/scope/recipients, correlated operators, stale draft material, inert states and unchanged parents on renewal. Rust 1.99.0 is pinned in CI; normal and optimized execution, rustfmt and warnings-denied Clippy are required on Linux and Windows.

Local and exact-source hosted evidence belongs to the focused draft PR. IMPLEMENTED means data definitions exist; TESTED/VERIFIED require the corresponding executable results. DEPLOYED is false: this crate is not connected to Railway, vendor wallets, real PCs, the live pilot or the existing simulator/review engines. Existing source/golden reports remain unchanged. Implementation used Codex; automated structural tests do not certify legal enforceability or production security. No new license grant is made.
