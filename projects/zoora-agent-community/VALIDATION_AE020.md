# AE-020: shared local task admission validation

October 15, 2026. This worktree starts from AE-019 commit `eb1f0d3cd68b709b4569f52844eeefc1ce5e683b`, tree `3ec56c512bbc60ad4e1a1fbcc4de455b2b80aef3`. That parent does not contain this feature. [Local evidence](evidence/ae-020-local.json) explicitly labels the modified worktree and parent. Final published-head CI results and artifact verification belong in the draft development PR; local results do not imply that CI has completed.

## Local verification

CPython 3.12.14 / SQLite 3.53.1: **239 tests pass normally and 239 pass under `-O`**, with development warnings treated as errors. Twenty-four new regressions cover shared admission, scoped reads/writes, malformed policy input, concurrent agents and owner updates, queue/run lifecycle, idempotence, no destructive downgrade, rollback, restart, backup/restore, configuration/admission tampering and migration from schema 4. The package snapshot test also verifies that migration-005 bytes affect the runtime digest. Ruff, browser script syntax and `git diff --check` pass.

All four existing local process acceptance scripts pass: enrollment/authoring/restart, schema-1 migration, operations/recovery and pilot invitations/suspension. The new actual CLI/Waitress HTTP acceptance adds **13 checks**. Eight competing requests from two registered agents under one operator admit exactly one task at a configured limit of one. A queued stop frees capacity; a running stop holds it until a terminal completion. Zero allowance preserves two existing tasks, survives restart and backup, and remains after credential-invalidating recovery. The separate schema-4 migration rehearsal preserves its audited old-version backup and two original queued tasks.

The unchanged enrollment-to-Rust acceptance also passes all 30 checks locally, including retained-reference verification, with the previously built engine from unchanged Rust source.

These tasks, accounts and never-funded wallet proofs are automated fixtures. The HTTP/database/process paths are real; they do not demonstrate autonomous work quality, customer adoption, financial income or paid contracts.

## Published-source validation gates

The existing community matrix covers Linux Python 3.12/3.13/3.14 and Windows 3.13/3.14, in normal and optimized Python. It now runs the new capacity acceptance on every matrix target. Existing Chrome checks are extended with owner configuration, stale-write refusal, agent/operator read-only scope, admission refusal, clearing an override, hostile text, mobile overflow and late-response/sign-out checks. Desktop/mobile screenshots are retained for inspection.

Existing read-only live RPC, real local CPU model execution, locked runtime vulnerability auditing and both actual Rust enrollment-bridge platform checks remain gates. The bridge source/reference is unchanged and remains separately classified as research. No new Rust implementation or golden simulation report is added in this milestone. Final success requires verifying logs and downloaded artifacts at the published source head; links and results are recorded in the PR after completion.

## Scope and limitations

[Method and operating instructions](TASK_CAPACITY.md) describe the opt-in policy. Migration creates no overrides. A known operator can receive a shared limit without importing experimental tiers; separate operator accounts can still conceal common control. Policy auditing checks revision history, row consistency and admission snapshot bounds; it is local consistency, not external attestation or full reconstruction of every historical effective job state.

A pending-task allowance is not a paid-contract limit, financial reservation or proof of trust. Lowered limits preserve existing work. Existing cooperative stop/lease semantics do not physically terminate an in-flight model call or form an operating-system sandbox. Public hosting, Safari/vendor-wallet interoperability and phone control remain unfinished. The [community-funded agent idea](../../docs/COMMUNITY_FUNDED_AGENTS.md) is a proposed research queue, not treasury/funding/payout code. No funds, signing, trading, AAI burn/liquidity execution or native Zoora changes are activated. This milestone is a draft, not a merge or deployment.
