# BUILDWITHAAI DEVELOPMENT REPORT — AE-007

**IMPLEMENTED, TESTED and VERIFIED for documented local use. NOT DEPLOYED. The entire BuildWithAAI roadmap and public launch are not complete.**

Verified source: `d26d9f0f6d45255a72653f82c0f44707cdab28f4`. Branch: `feature/ae-007-wallet-evidence`. [Draft PR #16](https://github.com/BuildWithAAI/buildwithAAI/pull/16) is stacked on AE-006 #15, base `ce6f2d354232b326ea53b03880535bef550fa9ee`. This report and the [evidence JSON](evidence/ae-007-2026-10-11.json) pin the independently verified source. The PR description records the later report/evidence commit and its final exact-head CI. Neither is merged or deployed.

## Completed work

- New agent registration requires a five-minute, single-use raw Ed25519 challenge bound to the instance, profile, operator and issuing credential. Challenge consumption, registration, proof and audit are atomic. Legacy profiles stay unverified until re-proven; public proof records preserve signed messages and historical control time.
- Explicit schema-1 migration preserves existing content, credentials and audit prefix, creates a consistent exclusive backup, rejects intervening audited writes and rolls back failed DDL/audit changes. Offline sensitive-restore recovery can revoke all earlier API credentials.
- Opt-in, fixed-host read-only Solana observations support Devnet and Mainnet. Attempt/rate controls persist across restart; network calls run outside SQL locks; completion rechecks authorization. Interrupted or revoked attempts remain UNVERIFIED. No signing or transaction-submission method exists.
- Reports preserve source, observation/availability time, exact decimal-string slot/units, requested commitment, transformation, classification, missingness, quality flags, response hashes and retained raw JSON. Failed instructions stay NOT_SETTLED. Unrelated observations are retained; payment attribution and P/L remain unavailable.
- The responsive observer reads actual records and exposes wallet proofs, transaction evidence, refresh, loading/error/empty states and freshness. Untrusted content stays text. Its browser fixtures are explicitly synthetic/test activity.

Changed areas: `wallet_proof.py`, `solana_rpc.py`, `observations.py`, `migration_002.sql`, store/server/CLI/client/validation modules, UI assets, the hashed runtime lock, wallet/migration/RPC/HTTP/CLI tests, integration/browser/migration/live-read harnesses, `.github/workflows/zoora-agent-community.yml` and connected README/status/security documents. The evidence JSON lists every changed source file. Existing Rust source, lockfiles and workflows are byte-preserved.

## Tests and CI

All **15 jobs passed on the exact verified source**:

| Workflow | Actual verification |
|---|---|
| [Community 38126819276](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/38126819276) | Five Python environments plus strict real-RPC acceptance. Linux 3.12.15/3.13.16/3.14.8: 86 tests each in normal and optimized modes. Windows 3.13.16/3.14.8: 85 pass and one explicitly Unix-only permission/symlink test skipped in each mode. |
| [Review 38126819378](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/38126819378) | Existing 108 tests per Linux/Windows Debug/Release profile; CLI, replay, scenarios, exports and browser checks; dependency audit. |
| [Marketplace 38126819273](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/38126819273) | Existing 31 tests per platform/profile; CLI, replay and canonical/scaling checks; dependency audit. |
| [Foundation 38126819334](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/38126819334) | Existing 44 Linux/43 Windows tests per profile; conservation, replay, CLI and scaling; dependency audit. |

Ruff 0.17.0, JavaScript syntax, strict formatting/Clippy/locked Rust checks pass. All five service environments pass seven actual CLI/HTTP/restart/backup-restore checks and four migration/re-proof checks. All 15 job logs were inspected without resource warnings, tracebacks or error/warning markers. Local Python 3.12.14 also passes 86 tests in both normal/optimized modes, CLI/restart/restore and migration; Rust/Chrome were executed in CI. Local real RPC is blocked by DNS policy and is not counted as live verification.

Actual Chrome 154.0.8037.97 passes **22 observer checks**, with zero uncaught exceptions or external page requests. Desktop/mobile screenshots were visually inspected. The u64/failed-transaction renderer test uses a labeled SYNTHETIC response that is never stored as chain data.

Nine CI archive SHA256 digests and source associations were independently checked: five service archives, one live-read archive and three Rust audit archives. The three hash-locked runtime packages—PyNaCl 1.6.2, CFFI 2.1.1 and pycparser 3.0—have zero reported known advisories in pip-audit. RustSec checked 37/38/39-package lockfiles against database commit `7eebec69c352c7191b1f13eb95dd510eeca5d1de`: zero vulnerabilities, informational warnings or ignored advisories. These are dated package checks, not complete security certification or verified Python/SQLite/OS patch state.

Current heads of all eight earlier open draft PRs (#4, #9–#15) and their applicable workflow runs were also rechecked successfully. PR #9 remains at `1ffffe30122f855b69e639ddd58ff6344949e905`; its historical `ae18…` head is not current.

## Real integrations verified

Both **https://api.devnet.solana.com** and **https://api.mainnet.solana.com** returned real public chain data through the actual production CLI → authenticated HTTP → SQLite → fresh server process path. The restarted process retained identical evidence with RPC disabled. Genesis pins matched both networks. Each network used three read requests; the harness used temporary test agents, zero customer wallets and zero submitted transactions.

Source observations: Devnet slot `509849943`, fee `10000` lamports; Mainnet slot `455594083`, fee `5000` lamports. Raw response SHA256, signature, slot, fee, block time and execution fields were independently reconciled against reports. Both transactions were unrelated to the test wallet. Source reports are OBSERVED/AVAILABLE; they establish no income, payment for work, current wallet ownership or trading profit. Finality is provider-reported, not independently validated consensus.

## Audit fixes and retained failures

An earlier local verifier accepted crafted low-order public keys/signatures. Published verification uses patched libsodium via PyNaCl, canonical main-subgroup point validation and strict signatures; low-order/off-curve/mixed-order regressions and an independent RFC 8032 vector pass. No handwritten curve/signing verifier is used. Historical proof is not continuous control, AI autonomy or human identity.

Initial service CI rejected an unquoted YAML colon-space command; a later browser fixture lacked an explicit module path. Resource review made SQLite backup-check and early-return HTTP response closure explicit. Further browser checks exposed an asynchronous proof-element dereference and a refresh clicked before transaction loading finished. These checks now wait for the real API result while preserving all assertions. Failed runs on `bfcb5d8…`, `0e42cd5…`, `80adc32…` and `8b56376…` remain in GitHub; no tests or live checks were bypassed to obtain the final pass.

## Completion boundaries and next milestone

No known blocking defect remains for this documented local milestone. Source review was performed by the coding agent; independent review is not claimed. Raw-message interoperability with actual wallet connectors/hardware is unfinished. Legacy reservations need a claim-resolution policy. Database rollback/cloning can restore revocations and consumed challenges; guarantees assume one authoritative database. Privileged host access can rewrite the local audit. DNS is not hard-wall-clock bounded; provider restrictions, outages or retention can still produce explicit failures.

| Area | Verified scope | Still incomplete |
|---|---|---|
| AE-001–AE-005 | Reproducible offline simulations and synthetic datasets | Real autonomous agents, useful-work measurements and live economic operation |
| AE-006–AE-007 | Local authenticated persistent workspace, historical wallet proofs, migration and actual read-only chain observations | Wallet connector/enrollment, real agent/tool runtime, production service operations |
| Scanner / [PR #10](https://github.com/BuildWithAAI/buildwithAAI/pull/10) | Separate tested local candidate; current exact-head CI passed | Last complete live check failed required holder coverage; permitted holder-capable RPC, authorized live Telegram testing and deployment remain blocked |
| Public operations/security | Automated boundary tests and dated advisory checks | Reviewed production transport/TLS, host/domain, credential delivery, moderation, Windows ACLs/runtime patch verification, monitoring, retention and operational restore |
| Payments/trading/future chain | Synthetic policy research and read-only observations | Order/payment attribution, complete accounting/P&L, authorized user-wallet execution and blockchain consensus/economics |

**We can run simulations and produce labeled synthetic datasets now, and can collect real read-only transaction evidence when permitted providers are reachable. We cannot claim a complete publicly running AI agent economy or scanner launch.**

Next milestone: production transport and operational hardening of the authenticated workspace, then reviewed wallet connector/enrollment and a bounded real-agent test environment. Maintainer review/integration of the draft chain remains pending. Public deployment and user-wallet execution have separate authorization gates; no deployment, custody, live trades, token-payment operations or consensus/economic changes occurred.
