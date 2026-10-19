# VL-002 — controlled synthetic template validation

**October 19, 2026 · validation format 1 · SYNTHETIC_VL002_NO_MONETARY_VALUE.** This extends [VL-001](SCHEMA_VL001.md) within [approved issue #19](https://github.com/BuildWithAAI/buildwithAAI/issues/19). It validates drafts against **one compiled laboratory registry snapshot and one controlled synthetic template**. It is not a general legal-contract generator, authority oracle, production registry, signing service, agreement acceptance or payment system. The [crate and commands](../zoora-agent-economy-simulator/leasing/README.md) remain isolated from the live pilot and other engines.

## Input and trust boundary

The committed [fixture](../zoora-agent-economy-simulator/leasing/fixtures/valid_request.json) is compiled into the registry; a request cannot replace that registry. Changing its template, synthetic parties, authority records, quote or rules requires a reviewed source change. Fixture approvals are simulated controller records, not owner/counsel approval of real terms. There is no external-registry import or wallet authentication.

Requests are UTF-8 JSON, at most 16,384 bytes including whitespace. Every object has a closed set of fields. Duplicate keys, unknown fields/enum variants, trailing JSON, invalid encoding/types and excessive nesting are refused before normalization. Required records have no generated/approval defaults. `renewal_of` may be omitted or null; a non-null parent is refused until VL-003 can check it. Lists are limited to five functions/scopes and eight clauses, with duplicates refused. Identifiers and schema bounds pass through VL-001 constructors; amounts never pass through floating-point arithmetic.

The envelope specifies validation `schema_version`, classification, `synthetic_units`, registry SHA-256, clause IDs and a nested draft. The draft includes every VL-001 field, with `declared_terms_sha256` for the terms digest. Pins use `{id, revision, sha256}`; intervals use `{start_ms, end_ms}`; quote timing uses `{observed_ms, available_ms}`. Digests are exactly 64 lowercase hexadecimal characters and cannot be all zero. Replacement clauses, extra recipients, economic instructions or claims of approval have no accepted field.

The template records jurisdiction `synthetic_lab_no_legal_jurisdiction` and review status `synthetic_fixture_not_legal_review`. Eight fixed clause IDs/content cover support/downtime, prohibited uses/subletting, content ownership, export/retention, termination/remedies, refund review, dispute process and unsupported promises. Their content is laboratory policy vocabulary, not an agreement to offer customers. An agent cannot change that content by resubmitting its hash.

## Enforced checks

| Check | Current behavior |
| --- | --- |
| Registry, template and policy | Exact compiled snapshot, ID/revision/content digests, clause set and complete policy bounds must match. |
| Parties and rights | Exact instance, space, functions, mode, capacity and provider/licensee/platform identities/operators must match; subletting remains false. |
| Authority | Exact party/delegate/space/scope/evidence records must match the synthetic registry; unknown/revoked controller status refuses. Claims must be current at decision time and cover the entire lease interval. This conservative laboratory rule is not proof of legal authority. |
| Causal source time | Authority observations must be available by decision time and at most 2,000 ms old; quote observations at most 500 ms old. Observation age and availability are separate conditions. |
| Quote and attribution | Exact registered rent, fee, source, recipients, observation/availability and validity must match. Changed prices or free quotes need separately controlled fixtures; resubmission cannot change economics. |
| Clock boundaries | Registry validity is `[0,5000)` ms; quote `[900,1500)` ms; authority `[0,10000)` ms. These are laboratory Unix instants, not live quotes. Age equal to its limit is allowed; validity end is excluded. |
| Lease interval | Nonempty bounded interval, registered maximum duration, minimum notice and complete authority coverage. The fixture's 10,000 ms maximum duration, 100 ms notice and 50 ms grace are laboratory parameters only. |
| Renewal | A parent reference requires the future lifecycle/booking registry and always refuses here. No parent existence or conflict result is invented. |
| Complete terms | Recompute domain-separated SHA-256 over complete canonical terms and require equality with the declared digest. Rehashing unauthorized clauses, amounts, operators or authority cannot bypass registry checks. |

Changing the agreement ID or a permitted future interval requires a new digest. Successful validation remains **DRAFT / NOT_GRANTED / UNOBSERVED / NONE**. `VALID_DRAFT` applies only to its recorded decision time and registry snapshot. It cannot be reused as consent, current eligibility, access or payment evidence; VL-003 must revalidate before transitions.

## Canonical encoding, format 1

Hashes use SHA-256 from RustCrypto `sha2` 0.10.9, already used in this repository. Each domain below is ASCII followed by one zero byte, then compact UTF-8 JSON **arrays** without insignificant whitespace. This is a schema-owned tuple encoding, not a general JSON canonicalization standard. Strings are controlled ASCII; numbers are exact nonnegative integers, booleans are JSON booleans and absent parent is null. Input object order, whitespace and semantic set order do not change the terms digest. The raw-input digest preserves original bytes.

| Domain | Ordered payload |
| --- | --- |
| `ZOORA_VL002_TEMPLATE_JSON_TUPLE_V1` | Template ID, revision, jurisdiction marker, review marker, ordered clause `[ID, content]` pairs |
| `ZOORA_VL002_POLICY_JSON_TUPLE_V1` | Policy ID, revision, max duration, notice, grace, max quote age, max authority age |
| `ZOORA_VL002_REGISTRY_JSON_TUPLE_V1` | Format version, classification, units, template manifest, policy manifest, instance, space, three parties, two claims, two authority `[observed, available, status]` records, quote, registry validity |
| `ZOORA_VL002_TERMS_JSON_TUPLE_V1` | Format version, classification, units, registry hex digest, agreement ID, instance, space, three parties, two claims, complete policy, template pin, interval, quote, optional parent, sorted clause IDs |
| `ZOORA_VL002_INPUT_BYTES_V1` | Original input bytes without a JSON encoding step; omitted for oversized input |

Nested tuples:

- Pin: ID, revision, lowercase digest. Interval: start, end. Party: ID, operator.
- Space: ID, provider, use-mode name, capacity, function names, subletting boolean.
- Claim: ID, party, delegate, space, scope names, interval, evidence pin.
- Quote: rent, fee, source, validity, `[observed, available]`, provider recipient, platform recipient.
- Complete policy: pin, max duration, notice, grace. Party order is provider/licensee/platform; claim order is provider/licensee.
- Clause IDs sort by ASCII. Functions normalize in enum order: service listing, inquiry link, project collaboration, content display, agent workspace. Scopes normalize in enum order: offer space, accept lease, request renewal, end lease, manage dispute. Wire names use snake case.

The declared digest is excluded from its own hash. Registry identity excludes the sample agreement ID/interval/declared digest; those belong to each draft. Evidence pins remain matched synthetic references, not authenticated external documents. Template/policy pins are checked against actual fixture manifests; no signature verification is claimed.

## Decisions, verification and remaining work

The library returns a bounded decision with classification, decision time, registry digest, bounded raw-input digest, `VALID_DRAFT`/`REFUSED`, a fixed refusal code and a terms digest only on success. Submitted values and parser exceptions are not echoed. Oversized input is neither parsed nor hashed. The CLI reads at most the cap plus one byte and uses fixed argument/I/O diagnostics. Validation reads no file, network or wall clock. The process reads stdin, writes its decision and loads its compiled fixture; it collects no secrets and has no signer.

Decisions are returned to the caller; **durable refusal history, one-use consent, idempotency, booking admission/conflicts, persistence and replay are not implemented**. Repeated evaluation is deterministic and allowed; validation does not prevent replay. These controls remain VL-003. Ledger/earning/refund/allocation remains VL-004; scenarios/reporting and production review remain VL-005–007.

The local suite has 38 tests normally and optimized, including the original 17 schema tests. Twenty independent Python checks run the actual Rust CLI, rebuild template/policy/registry/terms/raw-input digests, check time boundaries and rehash unauthorized terms before confirming refusal. Linux/Windows CI require formatting, warnings-denied Clippy, both test modes and the independent verifier. The leasing dependency graph has its own audit job/artifact. Hosted results belong to the exact source in the focused draft PR; this document does not assert a future CI result.

Direct dependency versions are pinned to those already used in this repository: Serde 1.0.229, serde_json 1.0.151 and sha2 0.10.9. Transitive versions/checksums are locked. This replaces VL-001's dependency-free status for the current crate. No license grant, production economic/recipient decision, native-chain change or deployment is introduced. Material implementation assistance: Codex. Synthetic tests do not certify production security or legal enforceability.

Implementation references checked October 19, 2026: [Serde closed-object attributes](https://serde.rs/container-attrs.html) and [RustCrypto SHA-2 API](https://docs.rs/sha2/0.10.9/sha2/). Unknown-field rejection is also covered by nested/duplicate-field tests.
