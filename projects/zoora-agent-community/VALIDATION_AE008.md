# BUILDWITHAAI DEVELOPMENT REPORT — AE-008

Date: 2026-10-11. Branch: `feature/ae-008-community-operations`, stacked on AE-007 PR #16. This report describes a development candidate; public deployment, host activation, wallet execution and payments have not occurred.

## Completed implementation

IMPLEMENTED: default bounded Waitress 3.0.2 WSGI transport; shared request/auth/origin validation; cached static assets and startup package digest; minimal process liveness; authenticated local readiness with rolled-back journal write; aggregate process telemetry; credential-file monitoring; full evidence audit before exclusive snapshot publication; independent read-only backup verification; safe restore into a new directory; offline recovery and operational runbook. Schema 2, raw Ed25519 proof protocol, existing records and credentials remain compatible. Optional legacy transport is preserved.

TESTED locally: existing authenticated HTTP/CLI, wallet proof, migration and transaction evidence contracts; production-adapter wire/auth/framing/security tests; readiness rollback; telemetry/identity mismatch; corrupt snapshots, existing paths, sidecars and backup deadline; actual CLI process crash, restart, online backup, verification, safe restore and old-credential revocation. Automated fixture wallets are publicly reproducible, unfunded test keys. No test submits a chain transaction.

CI status: PENDING for this new candidate. Exact source commit, PR, CI runs, downloaded artifact hashes, current public RPC observations and final-head verification will be recorded after publication. Previous AE-007 evidence is historical and is not presented as AE-008 CI success.

## Changed files

Community application/version/CLI/store/legacy transport; new shared HTTP application, Waitress transport, operations and recovery modules; runtime hash lock; HTTP/operations tests and process acceptance script; community workflow; setup/security/operations documentation and optional uninstalled systemd template. Root and simulator README links are updated; Rust implementations, dependency locks and their CI definitions are preserved.

## Remaining boundaries and next milestone

DEPLOYED: none. Public launch is UNVERIFIED. The local host template is uninstalled; chosen-host TLS/origin/proxy handling, patch/ACL verification, scheduled alerts, off-host backup retention/recovery, public enrollment/moderation and legacy wallet claim resolution remain outstanding. The monitor is bounded manual polling, not an installed notification service. A local package digest is not signed release or host attestation. Windows ACLs and power-loss durability remain unverified.

Wallet connector/enrollment and a bounded real-agent/tool runtime are NOT STARTED. No seed/private-key collection, fund custody, wallet freezing, refunds, live trading, payment execution, token economics or blockchain consensus changes are added. Existing read-only RPC records do not constitute invoice attribution, revenue or P/L. The scanner's prior holder-coverage/provider and authorized Telegram-test gates remain separate; AE-008 does not claim to fix them.

Next milestone: reviewed wallet enrollment and a bounded real-agent development environment, while maintainer integration of the stacked draft PRs and selected-host operational setup remain pending. Ordinary authorized development can continue without public deployment.
