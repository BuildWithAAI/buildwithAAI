# AE-010 verification — durable tasks and local worker

Date: October 14, 2026. **IMPLEMENTED, TESTED and VERIFIED for the bounded local task workflow. NOT DEPLOYED.**

Verified source: **f27eb7ba88d90a5a30a139fdd785ca39b5a74c5e**. [Draft PR #21](https://github.com/BuildWithAAI/buildwithAAI/pull/21) is stacked on PR #20 at 6fc6495e9fceff29c5f3a188058ca7edb5d35ef4 in the existing BuildWithAAI/buildwithAAI repository. A later head may add this report/evidence only; its checks are recorded in the PR description. No merge or deployment occurred.

The change adds schema-3 private queued tasks, one leased attempt, authenticated inspection/stop, a finite local worker session, report binding and atomic artifact/job completion. The browser now submits a task directly and inspects/stops it; a separately started host worker invokes the installed model. See [JOBS.md](JOBS.md) for setup and failure behavior.

[All seven source CI jobs passed](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/38497466192). The checked job logs confirm the exact source and contain no traceback, resource-warning or GitHub error markers. Seven archive SHA256 digests, source associations and file hashes were independently verified. [Durable evidence](evidence/ae-010-2026-10-14.json) preserves the actual model report, task/attempt binding, artifacts, browser checks and archive hashes.

| Check | Observed result |
| --- | --- |
| Linux Python 3.12/3.13/3.14 | 161 tests pass in normal and optimized Python in each environment. |
| Windows Python 3.13/3.14 | 161 tests run per profile; 160 pass and one existing Unix-only permission/symlink check is skipped. |
| CLI/HTTP/recovery | Five environments pass signed enrollment, authored records, revocation, restart, explicit migration, monitoring, crash and credential-invalidating backup restore acceptance. |
| Actual Chrome | 22 observer and 32 authenticated workspace checks, including private task submission/stop and lost-response retry, with zero uncaught exceptions or external page requests. Desktop/mobile screenshots were reviewed. |
| Actual local model | CPU-only Ollama v0.40.3 with cloud disabled; Qwen3 1.7B completes direct and queued tool/report/artifact/restart acceptance. |
| Actual Solana reads | Strict read-only Devnet/Mainnet acceptance passes; no transactions are submitted. |
| Locked Python dependencies | Four packages, zero known audit findings. Ollama/host patch and ACL review remain outside that audit. |

The queued real model called `text_metrics` on `Zoora builds`, received the independently checked 12 UTF-8 bytes and 2 words, and wrote those values with their correct units. The canonical saved report hashes to b900d2d5b5525813f1def2aaa3331232c738a402219e8b87e5578a8f4e4ea55f. That exact digest and author match the completed task's project artifact, and both survive a fresh server process. Idempotent submission replay plus an idle worker do not rerun inference. This proves the measured fixture workflow, not arbitrary output quality or independent agent autonomy. Wallet fixtures are synthetic and never funded.

New SQLite tests verify ownership/privacy, concurrent exact submissions, changed-request conflicts, one global lease, host-clamped budgets, queue/lease expiry, stopped/revoked attempts, no automatic replay, exact completion reconciliation, atomic artifact/audit rollback and backup/restore. Schema-2 migration and old-backup verification/restore are tested as well as the preserved actual schema-1 migration CLI acceptance. Private report collisions are not overwritten or accepted as prior evidence.

Local CPython 3.12.14 / SQLite 3.53.1 passed the expanded 161 tests in normal/optimized profiles before the final test-fixture correction; all seven corrected worker tests then passed optimized local Python. Actual CLI/Waitress HTTP, migration/restart, monitoring/crash and credential-invalidating backup restore checks passed locally. Ruff, JavaScript syntax and local Markdown links passed. Actual current-source CI is the cross-platform final verification above. Other modules' source/workflows were not changed or retested by this milestone.

The intermediate [run 38496945743](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/38496945743) exposed a Windows 3.14 test comparing whole-worker time against the inference-only deadline. Claiming, private report fsync and HTTP settlement have separate costs; the corrected test times the actual slow model call. The synthetic protocol fixture now handles the expected Windows connection-abort error when the deadline closes its socket. The inference deadline was not increased. The corrected source passes all seven jobs in run 38497466192.

Remaining gates: public TLS/origin/proxy design and chosen host, host resource/ACL verification, real iPhone/Safari and vendor-wallet interoperability, invitations/moderation, backup/report retention and alert rehearsal. Stop remains cooperative around calls; a lease is not a hardware governor. API report metadata is CLIENT_DECLARED. Task output correctness and legal validity require review. Community funding/governance, live virtual leases, AAI fee routing/burn/liquidity, native production chain and trading execution are not completed by this milestone. The scanner's production holder provider and authorized live Telegram checks remain separate work.
