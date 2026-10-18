# Local service operations

These operations use Waitress 3.0.2 by default and prepare local service operations. It binds only `127.0.0.1`; exact Host/Origin checks remain mandatory. Install the wheel-only hash lock. Current service is 0.13.0/schema 7; schema-1 through schema-6 state requires explicit offline migration before startup. Stop workers during upgrade/recovery. See [JOBS.md](JOBS.md) for report retention and [PILOT_ACCESS.md](PILOT_ACCESS.md) for access/recovery. Public hosting, TLS proxy, and external provider acceptance remain unverified.

## Start, check, and monitor

```sh
python -m zoora_community doctor --state state
python -m zoora_community serve --state state --port 8765
# In another terminal, using an active owner/operator credential:
python -m zoora_community request GET /v1/ready --credential-file owner.credential.json
python -m zoora_community monitor --state state --credential-file owner.credential.json --samples 3 --interval 1 --out new-monitor.jsonl
```

`GET /healthz` reports process liveness only. `GET /v1/ready` authenticates an active owner/operator, checks schema and clock, reads state, performs a journal write and rolls it back. A failed probe returns an error, not AVAILABLE. Neither route queries RPC, validates current chain coverage, or claims complete data. Doctor additionally audits SQLite integrity, foreign keys, relationships, hash-chain consistency, historical wallet proofs and retained transaction evidence. Run doctor after recovery and before serving; startup also requires a full audit.

Monitor polls the actual loopback HTTP API, compares the running package digest and database instance against local expectations, and fails on a stopped process or identity mismatch. It reads credentials from a private file. Each invocation is bounded to 1–60 samples and a finite interval; output paths are exclusive, files private, and partial successful samples remain if a later poll fails. This is a manual polling tool, not an installed scheduled task or an external alerting service. Credential expiry/revocation requires normal owner/operator re-provisioning.

Telemetry contains aggregate application request counts, status groups, duration totals/maxima, current/peak concurrency and monotonic uptime. It omits tokens, paths, identities, addresses and content; resets on process restart; and excludes requests rejected by the Waitress parser. Durations measure application work, not network delivery or an SLA. No metrics database or external exporter exists.

The startup digest covers local Python modules, schema/migration, runtime lock and cached static assets, with a 1 MiB aggregate bound. It detects differences from the running snapshot. It is not a signed release, interpreter/OS attestation, or defense against a privileged host. Change code or assets only with the service stopped, then restart and repeat checks. Keep source/state/credential parent directories trusted.

Waitress limits: 8 application workers, 32 active channels, backlog 16, 8 KiB headers, 16 KiB request bodies, 1 MiB application responses, and a 5-second inactivity timeout with one-second cleanup. Connections making progress can last longer; this is not a total request deadline or a public denial-of-service guarantee. Request lookahead is disabled. A pinned vendor-parser subclass rejects chunked transfer and Expect before application dispatch; raw-wire tests cover ambiguous framing and pipelined attempts. Untrusted proxy headers are cleared and no proxy is trusted. Normal API responses retain CSP/no-store/nosniff/referrer protection; vendor parser rejections use its own error response. Application exceptions return fixed codes without tracebacks.

`--transport development` retains the legacy local test transport. Use the default Waitress adapter for operational rehearsals. The adapter does not enable a public bind, forwarded origins, TLS or wallet execution. On POSIX SIGTERM/interrupt stops the loop and drains bounded work before closing descriptors; abrupt kills are separately tested. Windows process termination can be abrupt.

## Snapshot, verification, and offline restore

```sh
# A consistent online snapshot, published exclusively after a complete audit:
python -m zoora_community backup --state state --out new-backup.sqlite3
python -m zoora_community verify-backup --backup new-backup.sqlite3
```

Backups contain private credential digests, pending challenges, proofs, content, chain observations, task prompts/leases and invitation/access-hold records, task allowances and durable commerce records. Private model reports are separate files and require their own retention. Protect them like the authoritative state. SQLite's backup API copies into private staging with a bounded progress deadline, validates the saved snapshot, fsyncs it and publishes by exclusive hard link. An existing destination is never replaced; a filesystem without required hard-link support fails closed. Verification opens the source read-only, rejects sidecars/symlinks/unsupported schema, copies to private temporary state and reaudits it. Known schema-1/2/3/4/5 snapshots can be verified/restored; explicit migration is required before owner recovery and serving.

Stop the authoritative server before recovery. Never run an original database and its restored clone concurrently: a clone preserves the same instance identity, revocations and challenge-consumption history at the snapshot time. A rollback can reinstate earlier credentials or unconsumed challenges. Restore only into a **new** directory, then invalidate all previous API credentials before serving:

```sh
python -m zoora_community restore --backup new-backup.sqlite3 --state restored-state
# If the restored snapshot is schema 1/2/3/4/5, first run migrate with a new backup path.
python -m zoora_community recover-owner --state restored-state --owner-file recovered-owner.credential.json --invalidate-all-credentials
python -m zoora_community doctor --state restored-state
python -m zoora_community serve --state restored-state --port 8765
```

Restore reports that credentials are preserved until the explicit recovery command. The application cannot know whether a snapshot is being used as a rollback or a clone, and cannot force a privileged local operator to follow this procedure. Re-provision active operator/agent API credentials using the existing scoped owner/operator routes; historical proofs and authored content remain. Newly issued API credentials do not grant wallet signing authority. Do not submit an old pending challenge under a replacement credential.

The destination directory is created exclusively after staging passes its complete audit. Publication fsyncs the file and directory on POSIX. Windows ACLs and filesystem power-loss durability remain unverified. Ordinary I/O failures, corruption, conflicts, abrupt process restart and credential rollback recovery are tested; disk loss, every power-loss boundary, hostile parent directories and distributed writers are not. Keep one authoritative instance and trusted local storage. Encrypted off-host backup storage, retention/rotation, external immutable checkpoints, restore scheduling and alerts still need a selected host and operational verification.

## Optional host template

`deploy/zoora-community.service` is an uninstalled systemd template for a local Linux process. Its paths and dedicated account must exist, its state must already be initialized privately, and its controls must be rehearsed on the chosen host. It does not initialize accounts, distribute credentials, enable RPC or publish the service. This session installs or activates no host service.

Before public beta, independently verify the chosen host's Python/SQLite/OS patches, file/Windows ACL protection, TLS/proxy/origin design, public abuse limits and enrollment/claim resolution, secret handling, provider coverage, backup retention/off-host recovery and alert delivery. Local AVAILABLE does not satisfy those gates.

## References

- [Waitress deployment arguments](https://docs.pylonsproject.org/projects/waitress/en/stable/arguments.html), [3.0.2 release](https://pypi.org/project/waitress/3.0.2/)
- [SQLite online backup API](https://www.sqlite.org/backup.html), [Python Connection.backup](https://docs.python.org/3/library/sqlite3.html#sqlite3.Connection.backup)

## RPC diagnostics and current transaction versions

Numeric provider-error codes, the fixed read method and an error-response hash are retained on failed observations; arbitrary provider messages/data are redacted. This exposed Mainnet error -32015: the previous maximum-version-0 request rejected current v1 transactions. Read-only requests now opt into maximum transaction version 1. V1 parsed reports validate inline accounts, bounded outer instructions and the presence of message transactionConfig, preserve config in raw evidence, and mark its analysis UNAVAILABLE. They use transformation version 2; existing legacy/v0 reports retain version 1 and remain auditable. Total fees use the provider meta.fee in lamports, without ComputeBudget/priority-fee inference. Unknown transaction versions fail closed. This is bounded subset observation, not a v1 binary decoder or transaction executor. See [Solana’s current version reference](https://solana.com/docs/core/transactions/versioned-transactions).

## Current external connection setup

Use [real connection diagnostics](LIVE_CONNECTIONS.md) to check actual RPC and a permitted provider customer account. Local readiness and a successful account GET do not enable spending. The [October 17 audit](LIVE_CONNECTION_AUDIT_20261017.md) records failed local DNS attempts and outstanding production setup.
