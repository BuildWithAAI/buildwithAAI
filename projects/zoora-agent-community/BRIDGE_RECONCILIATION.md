# AE-025 — read-only transfer discovery and reconciliation

Current schema/restore workflow: [AE-026](BRIDGE_RECOVERY.md) uses provider journal schema 3 and requires backed migration from original schemas 1/2. Supported restored copies remain GET-only. The schema-2 development description below is historical; use AE-026's upgrade commands and snapshot rules with the current CLI.

October 15, 2026. AE-024 retained an unknown transfer after a lost reply, but stopped POST retries after a conservative 23-hour boundary. AE-025 supplies the operator recovery path: search for candidates without altering that intent, then explicitly retrieve and bind a matching transfer ID through GET. The original body, key and first-attempt time remain fixed.

This is **sandbox-only operator tooling**. External Bridge account, route and response compatibility remain **UNVERIFIED**. Retained evidence uses real CLI processes and locally verified HTTPS against a contract fixture, with injected clocks for expiry/lease boundaries. No external Bridge request, wallet signing, card operation, blockchain submission, verified settlement or real commerce-budget integration is delivered. Community service remains 0.9.0/schema 6; the separate provider journal advances to **schema 2**.

## Commands

```sh
python -m zoora_community.bridge_sandbox --state ./bridge-test-state discover --request-id 00000000000000000000000000000001 --key-file ./bridge-test-key
python -m zoora_community.bridge_sandbox --state ./bridge-test-state reconcile --request-id 00000000000000000000000000000001 --transfer-id 00000000-0000-0000-0000-000000000003 --key-file ./bridge-test-key
```

Replace the illustrative IDs with an existing local request and an actual matching sandbox transfer. Both commands require a previously attempted intent and the same credential fingerprint. They do not import arbitrary payments into unattempted instructions or authenticate account continuity after key rotation.

`discover` returns candidate UUIDs, scan counts, coverage flags and response hashes. Matching records must have the complete saved customer/reference/amount/rail/address terms. Other customers' names/accounts, raw responses and bearer keys are excluded. Discovery does not append attempts, attach IDs, refresh the retry clock, change allowances or authorize POST.

Bridge documents `limit` and `starting_after` pagination, from newest to oldest. No client-reference filter is assumed. This implementation requests 20 records per page, at most five pages/100 records, under one shared deadline with bounded responses. Repeated IDs and malformed pages are refused. [Official listing contract](https://apidocs.bridge.xyz/api-reference/transfers/get-all-transfers), checked October 15, 2026.

| Status | Meaning |
| --- | --- |
| `NO_MATCH_IN_SCAN` | No match appeared in these responses; absence and failed payment are not established |
| `ONE_CANDIDATE_IN_SCAN` | One candidate appeared; explicit ID retrieval is still required |
| `MULTIPLE_CANDIDATES_IN_SCAN` | Several IDs appeared; none is automatically selected |

`scan_reached_short_page: false` exposes coverage limited by the page cap. A short page is an observed stopping point, not a consistent global snapshot. Retention, eventual consistency, concurrent changes and records outside the scan can matter. Neither discovery nor a selected positive match proves that only one economic effect exists globally. This is not automated duplicate-charge resolution.

`reconcile` commits a RECONCILE attempt and the selected UUID before one GET. The response must match that ID and every saved term. A matching observation binds the ID; later `advance` calls use GET beyond the POST cutoff. An accepted ID cannot be replaced. A 404, timeout, missing term or mismatch retains uncertainty and the original retry anchor; no replacement transfer or accounting release occurs. [Official GET contract](https://apidocs.bridge.xyz/api-reference/transfers/get-a-transfer).

Recovery shares the serialized 60-second claim lease. Live claims exclude another process, and stale completion cannot replace a newer result. A crash after GET retains the selected target in an unfinished attempt; after the lease, repeat `reconcile` with that target. An unsuccessful or unfinished lookup has not yet established a known ID. The existing total 32-attempt cap includes recovery.

Exit 0 means a completed read or matching observation, not settlement. Discovery can exit 0 for an inconclusive scan. Reconciliation exits 2 with an UNKNOWN record for failed provider evidence; local refusals exit 1. Provider state strings remain observations. Actual balances, fees, ledger settlement and business delivery remain separate work.

## Explicit journal upgrade

Stop old CLI workers first. Schema-1 journals refuse ordinary operations with `BRIDGE_JOURNAL_MIGRATION_REQUIRED`; fresh journals use schema 2. Keep private state, backups and keys outside source control.

```sh
python -m zoora_community.bridge_sandbox --state ./bridge-test-state migrate --backup ./bridge-before-schema-2.sqlite3
```

Migration requires a new backup path and makes no provider call or key read. It holds a write reservation, checks old records/foreign keys, creates an exclusive schema-1 snapshot through a separate read connection, verifies its complete logical state against the source and syncs the snapshot before upgrade. Requests, bodies, keys, credential fingerprints, timestamps, observations and pending attempts are preserved. Historical POLL targets are backfilled from prior observations. The result records snapshot/preserved-state hashes; a journal checkpoint retains the backup hash.

Schema change/backfill commit together. A failure rolls the source back to schema 1 and retains the old snapshot if already created. Existing backups are never replaced; already-current journals refuse another migration. These are internal consistency checks, not external authenticity or host certification. Windows ACL/power-loss behavior is not certified.

The journal remains separate from community backup/restore. Automatic key rotation, lost-journal reconstruction, cross-journal deduplication, continuous workers, webhooks and production deployment remain unfinished. Discovery is an ephemeral read, not a durable accounting event; explicit reconciliation attempts enter the journal. A trusted durable host, intact original terms and sane time remain assumptions.

## Verification

`python -bb -X dev -W error scripts/bridge_reconciliation_evidence.py` runs actual CLI processes, schema-1 migration/backup, local verified TLS and expiry/crash recovery. Output `evidence-output/bridge-reconciliation.json` is labeled `LOCAL_HTTPS_RECONCILIATION_FIXTURE`. The four fixture objects are not Bridge transactions. The shipped CLI has no test-host or test-clock switch.

Independent SQLite inspection checks four CREATE/two POLL/four RECONCILE attempts. The rehearsal records 19 local HTTPS requests, four POST and 15 GET; discovery/recovery adds no POST. UUIDs and snapshot hashes differ per run. Final source/CI/archive verification is recorded in the development PR. [Validation](VALIDATION_AE025.md) · [Original connector](BRIDGE_SANDBOX.md).
