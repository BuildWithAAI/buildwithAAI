# BUILDWITHAAI DEVELOPMENT REPORT — AE-008

2026-10-11. Branch: `feature/ae-008-community-operations`. Draft [PR #17](https://github.com/BuildWithAAI/buildwithAAI/pull/17), stacked on AE-007 PR #16. Verified source commit: `c7086a8476e3cb2861209fe3afd2ccd670bd49e2`. Its 15 CI jobs passed, every job's actual checkout SHA was checked in logs, and all nine selected archives were downloaded and SHA-256 verified. The following evidence-only commit is rechecked on its exact final head, with final run IDs and archive digests recorded in PR #17. No merge or deployment occurred.

| Work | Status | Evidence and limits |
| --- | --- | --- |
| Default bounded Waitress 3.0.2 transport and shared request/security validation | IMPLEMENTED, TESTED, VERIFIED | Actual wire/HTTP/CLI and Chrome acceptance; IPv4 loopback only, no trusted proxy. |
| Liveness, authenticated readiness, package identity and aggregate telemetry | IMPLEMENTED, TESTED, VERIFIED | Owner/operator probes roll back a real journal write; no durable records or quota changes. Provider/public readiness remains UNVERIFIED. |
| Credential-file monitoring and offline doctor | IMPLEMENTED, TESTED, VERIFIED | Three real HTTP polling samples per operational rehearsal, identity mismatch/refusal tests, nonzero exit for an actually stopped process. No installed schedule or alert destination. |
| Evidence-audited snapshots, independent verification and safe restore | IMPLEMENTED, TESTED, VERIFIED | Actual process crash/restart, online snapshot, exclusive new-directory restore, corrupted-snapshot refusal and all-old-credential revocation on Linux/Windows. Historical proof/content survives. |
| Current Solana v1 read-only observations | IMPLEMENTED, TESTED, VERIFIED | Fresh Devnet/Mainnet reads plus the exact previously failing public Mainnet v1 signature; raw facts independently compared after download. Config analysis remains unavailable. |
| Host template and operations runbook | IMPLEMENTED; template syntax TESTED | Local systemd verification substitutes an existing Python executable. Template uninstalled; selected-host controls/patches/ACLs remain UNVERIFIED. |
| Public application | NOT DEPLOYED | TLS/origin/proxy/enrollment/abuse controls, off-host retention/recovery and alert delivery remain operational gates. |

## Tests and exact source-head CI

Local CPython 3.12.14 / SQLite 3.53.1: **121 tests passed in normal and optimized strict modes**, Ruff and JavaScript syntax passed. Actual CLI/HTTP, migration and crash/recovery rehearsals passed. Local four-distribution runtime audit reported no known advisories. Source-head CI repeats all required checks on Linux 3.12.15/3.13.16/3.14.8 and Windows 3.13.16/3.14.8. Linux passes 121 tests in each mode; Windows discovers 121, passes 120 and skips one explicitly Unix-only permission test. Operations and production-wire tests run on Windows.

| Source run | Checks |
| --- | --- |
| [Community 38131253959](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/38131253959) | Five OS/Python jobs plus strict live RPC; 7 CLI/HTTP checks, 4 migration checks and 7 operational crash/restore checks per platform; 22 actual Chrome checks on Linux 3.12; package audit. |
| [Review 38131253935](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/38131253935) | Existing 108 tests per Linux/Windows Debug/Release profile; lint, CLI, replay, scaling/export/browser and dependency checks. |
| [Marketplace 38131253981](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/38131253981) | Existing 31 tests per platform/profile; CLI, replay/scaling/canonical and dependency checks. |
| [Foundation 38131253906](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/38131253906) | Existing 44 Linux / 43 Windows tests per profile; conservation/replay/CLI/scaling and dependency checks. |

CI logs contain no unclosed-database warnings or closed-trigger errors on this source head. Four runtime distributions have no known package advisories; three Rust audits cover 37/38/39 locked dependencies with zero findings, warnings or ignored advisories. RustSec database commit `7eebec69c352c7191b1f13eb95dd510eeca5d1de` is recorded. This does not attest all OS/Python/SQLite patches or constitute an independent security assessment. Downloaded Chrome desktop/mobile screenshots were visually inspected; UI data is marked automated fixture activity.

## Real integrations and defects fixed

The initial candidate correctly failed on a corruption-test connection leak and Mainnet provider errors. Closing that test handle fixed both Windows cleanup failures. Safe numeric diagnostics then identified `getTransaction` error **-32015**. Current [Solana v1 documentation](https://solana.com/docs/core/transactions/versioned-transactions) confirms that the old maximum-version-0 request rejects v1 transactions. The request now opts into version 1; v1 reports validate bounded parsed inline accounts/config presence and retain resource settings opaquely. Total fees come directly from provider `meta.fee` in lamports. V1 uses transformation 2; legacy/v0 output retains transformation 1 so stored AE-007 facts still audit. Unknown versions fail closed. Parser body-limit inclusivity and shutdown ordering were also corrected before final source verification.

| Source-backed case | Transaction version | Slot | Fee, lamports |
| --- | --- | --- | --- |
| Recent Devnet | legacy | 509868661 | 10700 |
| Recent Mainnet | 1 | 455614514 | 5491 |
| Exact Mainnet v1 regression | 1 | 455612316 | 5315 |

Each real observation went through authenticated Waitress HTTP, persisted raw RPC evidence and normalized facts, passed internal audit, and returned unchanged after a fresh server process with RPC disabled. Download verification independently matched raw response hashes, signature, slot, fee and execution state. The pinned regression is the exact public signature previously rejected; it is distinguished from discovery of a recent transaction. These are provider-reported finalized subset observations, not independent validator proofs, complete account history, order attribution, revenue or P/L. No customer wallet or chain transaction was created or submitted.

[Machine-readable source evidence](evidence/ae-008-2026-10-11.json) records all source jobs, checkout checks, downloaded archive/file hashes, raw public responses, operational/browser records and preserved initial failures.

## Changed files

- `.github/workflows/zoora-agent-community.yml`
- `README.md`
- `projects/zoora-agent-community/OPERATIONS.md`
- `projects/zoora-agent-community/README.md`
- `projects/zoora-agent-community/SECURITY.md`
- `projects/zoora-agent-community/VALIDATION_AE008.md`
- `projects/zoora-agent-community/deploy/zoora-community.service`
- `projects/zoora-agent-community/requirements.lock`
- `projects/zoora-agent-community/scripts/integration_evidence.py`
- `projects/zoora-agent-community/scripts/live_rpc_evidence.py`
- `projects/zoora-agent-community/scripts/operations_evidence.py`
- `projects/zoora-agent-community/tests/test_http.py`
- `projects/zoora-agent-community/tests/test_operations.py`
- `projects/zoora-agent-community/tests/test_solana_rpc.py`
- `projects/zoora-agent-community/tests/test_wsgi.py`
- `projects/zoora-agent-community/zoora_community/__init__.py`
- `projects/zoora-agent-community/zoora_community/__main__.py`
- `projects/zoora-agent-community/zoora_community/http_app.py`
- `projects/zoora-agent-community/zoora_community/operations.py`
- `projects/zoora-agent-community/zoora_community/recovery.py`
- `projects/zoora-agent-community/zoora_community/server.py`
- `projects/zoora-agent-community/zoora_community/solana_rpc.py`
- `projects/zoora-agent-community/zoora_community/store.py`
- `projects/zoora-agent-community/zoora_community/wsgi_server.py`
- `projects/zoora-agent-economy-simulator/README.md`
- `projects/zoora-agent-community/evidence/ae-008-2026-10-11.json` (source evidence).

Rust source, dependency locks and CI definitions are preserved; only the simulator's README adds the separate community-stage reference. Database schema 2 and `ZOORA_AE007_RAW_ED25519_V1` remain compatible. No account/content/credential data migration or replacement is required for an existing AE-007 database.

## Remaining defects, blockers and next milestone

No blocking defect was found in the verified local stage. Public launch remains UNVERIFIED: select/rehearse the host, verify TLS/proxy/origin behavior and runtime patches/ACLs, implement reviewed public enrollment/legacy-claim resolution and abuse handling, and verify scheduled monitoring, alerts and off-host backup retention/recovery. Windows ACLs and every power-loss condition remain unverified. Snapshot clones retain instance/credential/nonce state: stop the original, restore to a new directory, and invalidate/re-provision API credentials before serving a rollback, as [OPERATIONS.md](OPERATIONS.md) documents.

The stacked draft PRs still need maintainer review/integration. Wallet connector/enrollment and a bounded real-agent/tool runtime are NOT STARTED. The scanner's prior holder coverage/provider and authorized Telegram-test requirements remain separate unresolved launch gates. Local readiness explicitly cannot declare those integrations ready. This stage adds no wallet signing, customer-fund custody, freezing, refund authority, payment/trading execution, token economics or consensus changes.

Next milestone: reviewed wallet enrollment and a bounded real-agent development environment; selected-host operational setup follows when an authorized host is available. Existing synthetic research simulations remain usable and separate from real agent/customer activity.
