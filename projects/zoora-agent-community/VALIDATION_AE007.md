# BUILDWITHAAI DEVELOPMENT REPORT — AE-007

Status as the first source candidate is prepared: IMPLEMENTED and TESTED locally; exact-head cross-platform CI and real Solana integrations are PENDING. DEPLOYED: none. Public launch remains BLOCKED.

Base: `ce6f2d354232b326ea53b03880535bef550fa9ee` / draft PR #15. New branch: `feature/ae-007-wallet-evidence`; local worktree branch `work/community-wallet-evidence`. This stacked draft preserves earlier AE-001–AE-006 and scanner/replay work.

## Implemented

Single-use, credential/operator/instance/profile-bound raw Ed25519 wallet challenges and historical public proof records; proof-required new registration; legacy re-proof without rewriting prior data; explicit schema-1 migration with consistent exclusive backup, audit-prefix preservation and rollback; fixed-host, bounded read-only Solana observations; persistent attempt/rate controls; completion reauthorization; source/time/slot/commitment/classification/missingness/quality evidence; exact integer units; raw JSON retention; observer proof/transaction inspection and mobile states.

Application runtime closure: PyNaCl 1.6.2, CFFI 2.1.1 and pycparser 3.0, with official wheel SHA256 hashes. No handwritten signing/curve verification. The audit found that the earlier local library candidate accepted low-order keys/signatures; the published candidate instead requires patched libsodium canonical main-subgroup validation and strict verification. Regression vectors cover zero/identity/off-curve/mixed-order keys and an independent RFC 8032 vector.

No wallets sign or send transactions through this service. Financial instructions and native balance changes are observations, not payment attribution or trading P/L. Failed transaction instructions remain not settled. Unrelated records are retained, not discarded to fit an order model.

## Local evidence

86 unit/HTTP/CLI tests pass in normal and optimized Python with development warnings treated as errors. Fresh CLI/restart/restore, migration CLI and pinned runtime dependency audit pass locally. Recovery can invalidate all earlier API credentials after a sensitive restore while preserving historical content/proof. Real RPC is blocked by local DNS policy; real integration verification must come from the strict CI acceptance job. No local mock is counted as a verified chain integration.

Current GitHub baseline was independently rechecked: all 14 AE-006 exact-head jobs passed. Applicable workflow runs for current heads of all eight existing open draft PRs (#4, #9–#15) were successful. No default-branch merge or deployment is implied.

## Changed files and audit scope

The changed source is confined to `projects/zoora-agent-community/`, its workflow, and connected repository status/README documents. New wallet proof, RPC, observations and migration modules/tests/harnesses extend the established service. Existing Rust sources, lockfiles and workflows are preserved.

This is implementation review plus automated testing, not independent security certification. Remaining launch requirements include reviewed production transport/provider and operational access, Windows ACL/runtime patch checks, moderation/enrollment, legacy-address claim resolution, retention/restore procedures, monitoring and review/merge of the stacked draft chain. Browser wallet interoperability, real agent/LLM runtime, complete token accounting/payment attribution and user-authorized execution are unfinished. Signatures prove control only at a recorded time. Database rollback/cloning can restore prior consumed/revoked state; the database/audit is not externally immutable.

Next milestone after verification: production transport and operational hardening of the authenticated workspace, with a reviewed wallet connector/enrollment flow. Public deployment and wallet execution require their separate authorization.
