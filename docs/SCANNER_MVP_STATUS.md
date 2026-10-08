# Scanner development status — 2026-10-08

Candidate version: **0.1.2**. Existing branch: `feat/aai-scanner-mvp`; draft PR #10. Public deployment: **NOT STARTED**. Code/docs remain in the existing repository.

## Implemented

The local read-only API and responsive web UI support exact SPL/Token-2022 mint state, attributed USD/SOL market snapshots, wallet balance/address activity, saved watches, observations, provenance and process status. Telegram commands are implemented and disabled by default. Signing, trades and token payments are absent. The 0.1.1 bounded RPC recovery and explicit partial coverage behavior is preserved; measurement transformation remains `aai-scanner/0.1.1` because this milestone does not change financial transformations.

This operational milestone adds:

- Authenticated `/api/ready` with separate local application checks and last-report data coverage/freshness. A passing process/app check does not certify providers or public launch.
- Offline `doctor`, plus `doctor --deployment` for the supplied loopback/HTTPS/access/persistent-path host layout.
- Schema/read/write probes without persistent state changes; full integrity verification in the operator doctor.
- Verified private SQLite snapshots, exclusive atomic publication, symlink/overwrite refusal, progress budget and cleanup after failure.
- Read-only `verify-backup` and `restore` into a new file, independent of live configuration. Existing databases and sidecars are preserved; invalid/future schema backups are refused.
- Linux systemd and Caddy templates, secure environment example, monitoring contract, release/recovery runbook and an actual production CLI/proxy rehearsal in CI.
- Separate application/data state in the desktop/mobile status UI.

## Tested and verified locally

All **104 offline tests** pass on Python 3.12: the previous 86 plus 18 operational boundary/recovery regressions. Compilation, Ruff E9/F and JavaScript syntax pass. The pinned Waitress 3.0.2 advisory check reports no known vulnerabilities; this is not a full security certification.

`verification/scanner-operations-local-2026-10-08.json` records an actual local rehearsal: production Waitress CLI behind the Caddy 2.11.7 template, authentication, readiness, persistent watch write, forced disposable-process crash/restart, online snapshot, read-only verification, safe rejection, new-file restore, polling-state preservation and restarted HTTP persistence. Caddy's release archive digest was checked. systemd unit syntax passed with install paths expanded to the checkout; systemd supervision, boot/sandbox behavior and public TLS remain **NOT TESTED**. No live provider calls or messages occurred during this rehearsal.

CI now repeats the real loopback proxy/recovery rehearsal, Python 3.11/3.12 tests, compilation, lint/advisory checks and authenticated desktop/mobile flows including application/data status. Historical CI #6 (37850442349) passed all four jobs on `c5fb4d74f1d024e581bec62ba24f675db7863815`. A clean-checkout artifact-writing check then caught a missing parent directory in the rehearsal CLI; the script now creates it and CI writes to a fresh nested `data/` path. Verify every job on the final new commit; exact-head CI evidence is recorded in PR #10.

## Real source evidence

`verification/scanner-reliability-live-2026-10-08.json` preserves the actual strict USDC check at **2026-10-08T21:25:51.497+00:00**, mint slot **454664244**. Mint, USD/SOL market snapshots and address activity returned; both configured providers verified mainnet genesis.

The strict command correctly exited **1 / FAILED** because required holders encountered primary HTTP 429 and backup HTTP 403. Both attempts and source timestamps are retained. Successful live holder recovery is **not verified**. Mocked success is explicitly SYNTHETIC and only in tests. Historical receipts never feed production prices. Earlier real Waitress/USDC and wrapped-SOL checks remain historical evidence.

`verification/scanner-operations-live-2026-10-08.json` records an actual HTTP/readiness check on `c5fb4d74f1d024e581bec62ba24f675db7863815` at **2026-10-08T21:59:55.851+00:00**, mint slot **454671900**. Real mint, USD/SOL snapshots and activity returned; holders remained FAILED. Local application readiness was AVAILABLE while data readiness correctly changed from UNVERIFIED to UNAVAILABLE with the holder gap. This is historical evidence on the recorded commit, not proof of complete coverage or deployment.

## Remaining launch gates

- Holder-capable mainnet provider access: **BLOCKED** on successful permitted access; no infrastructure purchased or secrets changed.
- Actual Telegram commands: **BLOCKED** pending secure credentials and an authorized private chat; no messages sent.
- New exact-head CI/browser/operational checks: required before claiming release verification.
- Approved host/domain, public TLS, real systemd supervision/sandbox, monitoring delivery and sustained operation: **NOT STARTED**. Templates and local rehearsals do not satisfy these external gates.
- Full accounting/P&L, creation time, relationship inference, interpreted extensions, per-user tenancy and alerts: **NOT STARTED**, not simulated in the UI.

Research PR #9 remains independent and unmerged. Audited head `1ffffe30122f855b69e639ddd58ff6344949e905` passed 27 tests and CI #9 (37834405514). See [setup](SCANNER_SETUP.md) and [operations](SCANNER_OPERATIONS.md). Next milestone: resolve permitted provider and authorized Telegram access, then rehearse deployment on an approved host after separate public deployment authorization.
