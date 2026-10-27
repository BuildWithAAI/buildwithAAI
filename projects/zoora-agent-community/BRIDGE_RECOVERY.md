# AE-026 — verified payment snapshots and GET-only recovery

October 15, 2026. The separate provider journal now has supported backup, verification and restore commands. A restored journal always enters durable `RECOVERY_ONLY` mode. It may discover/reconcile previously attempted transfers and poll known IDs through GET; it cannot issue a payment-create POST, including an original-key retry inside the normal retry window. There is no command to reactivate it.

This closes a specific local recovery gap. A snapshot can predate a payment that the provider has already accepted. Treating that snapshot as current spending authority would forget later effects. The restore workflow preserves old records while removing create authority; it cannot recover missing external facts or prove global uniqueness.

The provider journal advances to **schema 3**. Community service remains **0.9.0/schema 6**. Actual retained evidence uses separate CLI processes and verified local HTTPS, not Bridge's external sandbox. External Bridge requests remain **zero** and account/route interoperability remains **UNVERIFIED**. No signer, card, real payment, currency conversion, commerce-budget mapping or verified settlement is added.

## Commands

```sh
python -m zoora_community.bridge_sandbox --state ./bridge-state audit
python -m zoora_community.bridge_sandbox --state ./bridge-state backup --output ./bridge-snapshot.sqlite3
python -m zoora_community.bridge_sandbox verify-backup --backup ./bridge-snapshot.sqlite3 --sha256 SAVED_SHA256
python -m zoora_community.bridge_sandbox --state ./bridge-recovered restore --backup ./bridge-snapshot.sqlite3 --sha256 SAVED_SHA256
```

Replace `SAVED_SHA256` with the exact backup digest retained through a trusted channel. Verification needs neither state nor an API key. Keep snapshots and their independent pins private and outside source control. A hash supplied by an untrusted file's author is not authentication. Snapshots contain payment terms, wallet addresses, request identities and credential fingerprints; they do not contain bearer API keys.

`audit` inspects an existing complete journal without creating a missing one. It validates every intent/history, foreign keys, expected tables/columns/indexes, migration records, mode metadata, capacities and known transfer-ID uniqueness. It rejects unreviewed triggers/views, orphan histories, overlapping unfinished claims and historically expired CREATE retries. Its logical-state hash covers all retained tables. Counts and hashes establish internal consistency, not useful work, provider facts or balances. `incomplete_attempts` includes historical unfinished attempts superseded after their leases; it is not a count of currently payable liabilities.

`backup` holds a SQLite write reservation while a separate read connection creates a snapshot of committed state. It independently audits that snapshot and compares its complete logical state with the source before publishing a new file by exclusive hard link. Existing paths are never overwritten. The source is not held across a provider request: a snapshot can include a committed unfinished claim while its original network operation is still running. POSIX file/directory sync is used; unsupported hard-link publication fails closed.

`verify-backup` checks a bounded private regular file, rejects symlinks and SQLite sidecars, reads pinned bytes into private staging and audits that staged image. Changed hashes, malformed records, unsupported schemas and extra schema objects are refused. No source journal is opened or provider request made.

`restore` requires a new state directory, including refusal of an already-existing empty directory. Before publication it writes and audits `RECOVERY_ONLY` plus the source backup digest and restoration time inside the staged database, then syncs the file. Only that quarantined file is published. A process killed after publication therefore leaves a GET-only journal. A normal publication failure removes the newly created destination. This tests process interruption, not sudden-power-loss certification or Windows ACL guarantees.

## Restored behavior

| Saved situation | Supported recovery behavior |
| --- | --- |
| Prepared, never attempted in this snapshot | Inspect or repeat the exact local prepare read; no new intent or POST. Discovery/import is refused because the snapshot has no credential-bound prior attempt. |
| Attempted, unknown ID | Same-credential bounded discovery and explicit matching-ID GET reconciliation; no POST even inside the original retry window. |
| Known ID | GET only; exact original terms/ID still required. |
| Unfinished claim | Preserve its original lease. After the lease, explicit target-bound GET recovery may run. |
| Failed/mismatched read | Keep uncertainty and any older observation. Do not release exposure or infer failure/settlement. |
| Backup of a restored journal | Another restore remains `RECOVERY_ONLY`; backup/restore does not reactivate create authority. |
| Wrong key, regressed clock, exhausted attempt capacity or conflicting target | Existing guards remain in force before network. |

Current views expose `journal_mode`, `may_create_transfers`, `restored_from_sha256` and `restored_at_ms`. The boolean describes only the journal-level sandbox gate; it is not a wallet mandate, merchant permission or confirmation that a specific operation will be admitted. The restore timestamp participates in network clock-regression checks. A GET observation is still not verified settlement.

Discovery retains AE-025's five-page/100-record cap, inconclusive misses, explicit matching-ID binding and redaction. It cannot authorize another POST or establish duplicate-charge resolution. An empty restored-state scan never restores spending authority. Existing credential continuity, leases, 32-attempt/64-intent limits and immutable request keys/bodies/times remain.

## Legacy upgrades

An intact original schema-1 or schema-2 journal refuses normal operations until an explicit backed-up migration:

```sh
python -m zoora_community.bridge_sandbox --state ./bridge-state migrate --backup ./bridge-before-schema-3.sqlite3
```

The migration audits the complete old state, saves and verifies a new old-schema snapshot, then atomically applies the current schema. Schema 1 also receives historical POLL target backfills; schema 2 preserves existing reconciliation targets. The original journal becomes `ACTIVE`; saved keys, bodies, credential fingerprints, attempts and timestamps remain. Failure rolls back the upgrade and retains an already-created old backup. Existing backup files and already-current journals are refused. A clock before saved history is refused.

Operational restore accepts only schema-3 snapshots. A migration backup in schema 1/2 is historical evidence, not an activatable recovery copy. If only a legacy backup survives, this milestone refuses operational restore; it does not reconstruct a missing original journal or authorize copying legacy files into active state. Keep the original, upgrade it when available, then create a current operational snapshot.

## Verification and limits

```sh
python -bb -X dev -W error scripts/bridge_recovery_evidence.py
```

The actual separate-process/local-HTTPS rehearsal passes 26 checks: stale pre-submission snapshots, original process death after provider-fixture acceptance, complete snapshot verification, GET-only recovery, preserved leases, another death after recovery GET, actual restore death after publication, protected existing destinations, corrupt pins, schema-2 upgrade and competing backup processes. It records ten local HTTPS requests: three original POSTs and seven GETs, with three unique fixture transfer objects. Recovery creates no additional POST. The main restored journal retains eight attempts: three CREATE, two POLL and three RECONCILE. Clocks are injected for lease boundaries. The shipped CLI has no test-clock or test-host switch.

Evidence is `evidence-output/bridge-recovery.json`. CI archives retain reports and backup hashes, not snapshot database files. Final source, full unit suites and downloaded CI verification are recorded in [validation](VALIDATION_AE026.md) and the development PR.

The report includes original fixture terms, snapshot/restored key/body/time bindings, known IDs, recovery targets, hashed POST bodies and the first-restore wire boundary. Archive verification can independently compare those supplied records and check that every wire entry after that boundary is GET. This does not authenticate an external provider or independently reconstruct the unarchived SQLite snapshots.

The mode is enforced by this version's supported APIs on an honest durable host. An administrator can rewrite records or run modified software; a hash and mode flag cannot prevent that. Restoring does not fence the original active journal, establish current balances, recover facts after the snapshot, authenticate a new provider account, deduplicate across independent journals or prove that one transfer is the only effect. The provider journal remains separate from community backup/restore. Public operations and a credentialed provider sandbox remain subsequent work.
