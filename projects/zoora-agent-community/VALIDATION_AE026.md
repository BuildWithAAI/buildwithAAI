# AE-026 validation — private snapshots and recovery-only restore

October 15, 2026. Based on published AE-025 source `e1c32062d870b662c26e5098c22e308d2795ebc7`, tree `9cd857eba161f7ec5b811a79c9ee933f15edc84b`. This report records checks of modified local source, not a claim that its parent contains AE-026. Exact published head/tree, final CI and downloaded artifact verification are recorded in the development PR.

## Local software verification

CPython 3.12.14 / SQLite 3.53.1: **405 tests pass normally and 405 with optimized Python**, including **29 new regressions**. Tests cover complete-history audit, private/size/sidecar/hash guards, stale snapshots taken before an actual fixture acceptance, known/unknown/in-flight restore, preserved leases, same-credential GET recovery, repeated restore quarantine, new/existing destinations, publication rollback, time regression, orphan histories, unreviewed triggers, reused provider IDs, invalid modes, unsupported schemas, overlapping claims, expired historical CREATE retries and schema-2 upgrade/rollback.

The new separate-process CLI/local verified-HTTPS rehearsal passes **26 checks**. It exercises original process death after provider-fixture acceptance, complete pinned backup verification, a pre-submission snapshot that cannot recreate the payment, GET-only restored discovery/reconciliation, empty lookup, pending leases, another death after recovery GET, actual restore death after publication, existing-path protection, corrupted pins, schema-2 migration and two competing backup CLI processes.

Measured rehearsal data:
- Three unique local fixture transfer objects.
- Ten actual local HTTPS requests: three original CREATE POSTs and seven GETs.
- Main restored history: three intents and eight attempts (three CREATE, two POLL, three RECONCILE), with three known IDs.
- Two historical unfinished attempts remain recorded after lease recovery; that does not mean two current unsettled payments.
- No extra POST is created by backup, restore, discovery or recovery.
- Provider journal schema 3; source/migration backup version 2 in the new rehearsal. Existing schema-1 migration rehearsal now upgrades directly to 3.
- Injected clocks exercise lease boundaries; process exits 79/80/81 are actual separate-process deaths after fixture create, recovery GET and restore publication.
- Keys remain absent from tested CLI output, snapshots and restored database.

The prior 18-check sandbox and 21-check discovery/reconciliation rehearsals pass with the current schema. Eight earlier actual service/replay acceptance scripts also pass: integration, migration, operations, pilot access, task capacity, spending, commerce and durable commerce. Earlier deterministic spending/commerce references remain unchanged. Ruff and Git diff checks pass; no runtime dependency, frontend, Rust simulator or native Zoora protocol code is changed.

[Machine-readable local checkpoint](evidence/ae-026-local.json) records the tested worktree parent and actual counts; it does not label uncommitted local output as a published-source execution.

## CI requirements

All five supported Python/OS matrix targets now run the new rehearsal after previous acceptance scripts. Normal/optimized suites, browser controls, runtime dependency audit, actual local CPU model, read-only RPC and native identity bridge gates remain enabled. Local results do not establish remote success. Final published-source job logs, source IDs and downloaded archive digests/CRCs must be inspected before reporting CI success.

CI archives contain reports and snapshot hashes, not SQLite snapshot files. Independent archive checking can confirm report scope, source, counts, immutable request relationships and GET-only recovery paths. It cannot independently reconstruct the rehearsal's backup database from those archives. Snapshot creation/hash/SQLite checks execute inside the actual rehearsal.

## Operational scope and limits

The supported restore writes durable `RECOVERY_ONLY` metadata before publication; it has no activation command. Prepared stale snapshots refuse POST and new intents. Attempted snapshots can discover/reconcile through matching GET; known IDs remain GET-only. Original credential, time, lease, capacity and binding restrictions remain. Exact local repeat-prepare reads are allowed without creating a new intent.

Operational restore accepts current schema-3 snapshots only. Intact original schema-1/2 journals require an explicit audited old-schema backup before upgrade. A surviving legacy backup alone is not an activatable replacement for a lost original journal. A trusted independently retained digest and honest private directories/host remain assumptions.

Actual process death is tested; Windows ACL and sudden-power-loss behavior are not certified. Restore does not fence an original active copy, recover later external facts, prove current funds, authenticate account continuity after key rotation, establish global deduplication or resolve duplicate charges. The provider journal remains separate from community backup/restore. A privileged host can rewrite mode/history or run modified software.

**External Bridge requests: zero. Actual vendor account/route/response acceptance: UNVERIFIED.** No signing, card operation, blockchain submission, real payment, currency conversion, real-asset mandate, synthetic-budget conversion, verified settlement, public deployment or native-chain change is added. A locally bound provider-style observation remains evidence supplied by a test server.

[Method and commands](BRIDGE_RECOVERY.md) · [Community draft](../../docs/community/AE026_COMMUNITY_UPDATE.md).
