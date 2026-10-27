# AE-029 — coordinated payment recovery

The purchase queue and its nested provider journal can now be checked together, backed up into one pinned package and restored into durable **RECOVERY_ONLY** mode. A restored copy can recover previously attempted transfers through GET requests. It cannot authorize purchases, prepare new provider instructions or create transfers. There is no reactivation command.

Introduced in service **0.11.0**; current service **0.13.0** uses community schema **7**, provider journal **3**, and payment queue **2**. [Agent tools](AGENT_PAYMENTS.md) cannot activate restored state. Existing queue schema 1 requires an explicit verified migration; community schema 6 also requires explicit offline migration for wallet sign-in. Community and provider schemas remain separate. No runtime dependency is added.

## State locations and boundaries

| Location | Contents |
| --- | --- |
| Community state directory | Authenticated identities, credentials, synthetic commerce books and source history; backed up separately |
| `PIPELINE/payment-pipeline.sqlite3` | Sandbox mandate, immutable admitted orders, complete claim/fence/result history and recovery/migration provenance |
| `PIPELINE/provider/bridge-sandbox.sqlite3` | Original provider bodies, idempotency keys, attempts, observations and provider recovery mode |
| Recovery ZIP | Exact queue snapshot, provider snapshot when present, and a derived manifest with both file hashes and cross-journal audit |

The ZIP contains no source-community database, bearer credential, provider API key or wallet secret. It contains private customer/address/order identifiers and provider credential fingerprints; store it privately. A never-attempted queue may legitimately have no provider journal yet. Restoring such a package creates an empty provider journal already in recovery-only mode.

`joint-audit` checks full queue/provider histories, immutable purchase/intent/body relationships, one create per linked order, corresponding queue dispatch fences, stored result bindings and admitted principal. It rejects orphan provider intents, missing fenced history and individually valid databases whose terms disagree. It reports each order's available recovery action; it does not attest to the source service, customer eligibility, wallet funds or settlement. If provider history is missing after a recorded fence, normal execution also refuses to recreate the journal automatically.

## Commands

Run from this project directory. Commands below need access to private host state. Audit, backup, verification, restore and migration need no agent credential or provider API key and perform no network requests.

```sh
python -m zoora_community.payment_worker --state PIPELINE joint-audit
python -m zoora_community.payment_worker --state PIPELINE backup --output payment-recovery.zip
python -m zoora_community.payment_worker --state PIPELINE verify-backup --backup payment-recovery.zip --sha256 RECORDED_PACKAGE_SHA256
python -m zoora_community.payment_worker --state RECOVERED restore --backup payment-recovery.zip --sha256 RECORDED_PACKAGE_SHA256
python -m zoora_community.payment_worker --state RECOVERED joint-audit
```

Record the returned `backup_sha256` separately, then replace `RECORDED_PACKAGE_SHA256` with that exact pin. A hash supplied only by the same untrusted package does not authenticate its origin. Verification reads only fixed, bounded ZIP members, checks their hashes and independently rederives the manifest audit. It never extracts arbitrary archive paths. Existing backup files and restore directories are never overwritten.

For an existing schema-1 queue, **stop its workers**, create and verify a package using the new binary, then migrate the original live directory:

```sh
python -m zoora_community.payment_worker --state PIPELINE migrate --backup payment-recovery.zip --sha256 RECORDED_PACKAGE_SHA256
```

Migration requires that the complete current queue/provider audit still exactly matches the pinned backup. It preserves identities, keys, budgets, claims and original operating mode, records the package pin and commits the schema change atomically. A stale backup is refused. Restoring a schema-1 package instead upgrades it only into recovery mode. Migration cannot reactivate a restored schema-2 queue. Older binaries reject the new queue schema; downgrading is unsupported.

## Recovery after restore

The [existing recovery CLI](PAYMENT_PIPELINE.md) reads prior provider attempts without contacting the community service:

```sh
python -m zoora_community.payment_worker --state RECOVERED recover --order-id ORDER_ID --key-file PRIVATE_SANDBOX_KEY_FILE
python -m zoora_community.payment_worker --state RECOVERED recover --order-id ORDER_ID --key-file PRIVATE_SANDBOX_KEY_FILE --transfer-id EXPLICIT_MATCHING_TRANSFER_ID
```

Known transfers use their original exact-ID GET. Unknown attempted transfers require bounded discovery and an explicitly selected matching-ID GET; discovery never automatically binds a candidate. An instruction with no recorded provider attempt remains blocked even if the old live copy later created a transfer. Do not restart spending from a backup. Original API credential fingerprint, lease, time, capacity and immutable-body rules remain in force.

Backup locks provider admission before queue admission, matching the provider-to-queue dispatch fence order. Separate read connections copy committed snapshots while both admissions are held; the copied pair must reproduce the original audit before publication. There is no network operation under those locks. Source-community commits remain independent and are not included in this package or described as a distributed transaction.

Both restored database files are durably marked recovery-only **before** publication. A process death during publication may leave an incomplete new directory containing only the quarantined provider DB. That directory is not a complete restore and is never automatically overwritten or activated. Keep it for inspection and restore the verified package into another new directory. A complete published pair also remains read-only after restart. POSIX file/directory synchronization is exercised; physical power-loss behavior and Windows ACL/directory-durability guarantees remain unverified.

## Evidence and remaining work

```sh
python -bb -X dev -W error scripts/payment_recovery_evidence.py
```

The actual authenticated service/CLI/local-TLS rehearsal passes 37 checks and retains six packages: a complete pair, before dispatch and four original handoff deaths. It restores all four interruption snapshots, stops the source service, exercises discovery/explicit reconciliation and exact-ID polling, interrupts partial/complete restore publication (exits 86/87) and interrupts a recovery worker (exit 85). Reports and all six **public synthetic fixture packages** are retained for independent database-level checks. Packages contain fixture identities and hashes, never real credentials or assets.

The independent standard-library auditor checks the retained actual SQLite files without importing the application. It validates forty package rows across checkpoints of the same ten orders and rejects fourteen altered reports. To reproduce against a downloaded artifact, replace `SOURCE_COMMIT_SHA` with the independently verified workflow source:

```sh
python scripts/payment_recovery_audit.py --report evidence-output/payment-recovery.json --fixture evidence-output/payment-recovery-fixture.zip --source-sha SOURCE_COMMIT_SHA --self-test
```

This remains a local sandbox milestone. Administrative/raw copies, altered trusted-host files, independent journals or external wallet activity are not globally fenced. Provider account/route interoperability, Phantom signing, constrained signing authority, balance/fee checks, merchant/card rails, delivery and verified settlement remain unfinished. External Bridge requests remain zero. [Validation](VALIDATION_AE029.md) · [Community draft](../../docs/community/AE029_COMMUNITY_UPDATE.md).
