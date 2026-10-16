# AE-028 validation — coordinated purchase pipeline batch

October 16, 2026 (UTC). Built on canonical AE-027 commit `76962407c9cbb63f7a9e7bc045ce2cd271825ee5`, tree `72f2ebdb2540a089be11a07c685d54269164a63b`. This report records modified local source. The development PR records exact published source/tree, final CI job results and downloaded archive checks.

## Completed local verification

CPython 3.12.14 / SQLite 3.53.1: **477 tests pass normally and optimized**, including **41 new regressions**. Tests exercise actual local API credentials, shared admission races, exact purchase/actor/instance/terms binding, authoritative source SUBMIT context, preflight contradictions, revoked/expired authority, manual SUBMIT takeover refusal, provider create-once, lost replies, four handoff stages, stale claims, independent agent batches, selection fairness, isolated dependency failure, restored-provider refusal, changed credentials, audit corruption and key redaction.

The new actual separate-process/API/local-TLS rehearsal passes **36 checks**. Three worker GETs arrive concurrently before the fixture releases any of them. Four process deaths use actual exits 82–85. Source SUBMIT replay, prepared provider keys, original claims and uncertain outcomes survive. A completed provider observation never becomes a source settlement or fulfillment event.

Retained measurements: ten admitted orders totaling **13.000000** under an explicit **14.000000** sandbox principal admission cap. Eight fixture transfer instructions total **9.000000**; two instructions totaling **4.000000** remain unsubmitted. These are declared fixture amounts, not confirmed funds movement. **24 local HTTPS requests: eight POST and sixteen GET**. Queue audit: seventeen claims, four historical unfinished claims and nine dispatch fences; one fence was interrupted before provider claim. Provider journal: twelve attempts (eight CREATE, three POLL, one RECONCILE). All source settled/refunded amounts and spent fees remain zero.

All **12 preceding acceptance workflows pass** alongside the new one: integration, migration, operations, pilot access, task capacity, spending, commerce, durable commerce, sandbox transport, reconciliation, recovery and preflight. Earlier deterministic spending/commerce reference bytes remain unchanged. Ruff, relative documentation links and Git diff checks pass. No runtime dependency or native simulator/protocol change is introduced.

Service advances to **0.10.0**, keeping community schema **6**. Optional source dispatch metadata is retained in authenticated commerce JSON/history; older binaries cannot read those new records. Provider journal stays **3**. The separate new queue is schema **1**. No automatic wallet grant or structural migration is performed. [Machine-readable local checkpoint](evidence/ae-028-local.json).

## CI and independent evidence requirements

All five supported OS/Python targets retain normal/optimized suites and run all **13** acceptance scripts. Matrix timeout becomes fifteen minutes for the expanded integrated process work; no gate is removed. Runtime audit, both actual browser workflows, actual CPU model, public read-only RPC and Linux/Windows native identity bridge remain enabled. Local success does not establish remote success; final source and all evidence archives must be verified in the PR.

The new report includes complete synthetic source state/policy/bindings, authenticated SUBMIT contexts, queue/provider terms, crash boundaries and wire summaries. Independent checking can recompute source/queue/provider hashes, source purchase IDs, exact USDC amounts/caps and one POST per provider key. Archives retain supplied reports, not SQLite databases or raw customer responses. Those reports cannot independently reconstruct unarchived databases or attest to an external provider.

## Scope

**External Bridge calls: zero. Provider account/route interoperability: UNVERIFIED.** Local API identity and synthetic authorization are real service operations; financial amounts/outcomes and provider eligibility remain fixtures. The explicit sandbox USDC admission cap does not convert synthetic units, verify wallet funds, price fees, authorize a real asset or prove merchant acceptance. No signer, real payment, card issuing, blockchain submission, accounting settlement or paid delivery is enabled.

The local dispatch fence linearizes pipeline revocation against a new dispatch. Already fenced attempts may complete after revocation. Separate service/queue/provider commits are not a distributed transaction. Reservations remain conservative; no automatic cancellation/refund/release or queue reactivation exists. Supported queue backup/restore is not added, and community backups exclude queue/provider state. Administrative copies, other journals, external wallet activity, Windows ACL and physical power-loss certification remain outside these tests. [Method and commands](PAYMENT_PIPELINE.md) · [Community draft](../../docs/community/AE028_COMMUNITY_UPDATE.md).
