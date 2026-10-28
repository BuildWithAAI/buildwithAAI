# AE-023 validation — authenticated durable commerce

October 15, 2026. Based on published AE-022 commit `dd91839d40b90834d588f9c1ebdb630cc5fffc47`, tree `4f47066bacd86742ff60c85a575d3cb5c1ca2edb`. Local results below describe the modified worktree, not its parent. Published source, final CI and archive verification are recorded in the development PR.

## Local checks

CPython 3.12.14 / SQLite 3.53.1: **317 tests pass normally and 317 optimized**. This includes **29 new regressions**: 27 durable-commerce tests plus two schema-5 migration/rollback tests. The existing package-digest regression also now covers the schema-6 DDL.

Tests exercise actual local API credential scope, registered one-to-one bindings, forbidden caller actor/payer/time, immutable request conflicts, separate operator books, thread/database and actual two-process budget races, abrupt exit before commit, recovery, one retained attempt, expiry/revocation, credential rotation/suspension, partial refunds, supplier evidence, backup/restore and tampered/rehashed histories. They establish local policy and consistency, not wallet authority or payment verification.

The new actual CLI/Waitress rehearsal passes **16 checks**, retaining **20 commands and 21 state views**. An eight-request HTTP race admits one 60-unit purchase into a 100-unit budget. A killed service recovers an unresolved 30-unit attempt and reconciles the same request identity. Operator revocation retains it; later synthetic settlement is recorded. Final scripted allocations: 90 principal settled, ten refunded, 80 net principal and three separately denominated fee units spent. These are not money, business revenue or profit.

The rehearsal independently rebuilds the complete model report from stored commands and audits each state. Generated account IDs, clock values and the winning alias differ per run, so its fingerprints are run-specific rather than cross-platform golden values. API credentials are absent from the tested database, CLI output and service logs.

Seven prior acceptance scripts pass: integration, migration, operations, pilot access, task capacity, payer authority and commerce routing. The previous 15 payer checks and 19 commerce checks retain their complete deterministic references unchanged. Ruff and Git diff checks pass. No runtime dependency was added. Local evidence is `evidence/ae-023-local.json`.

## Migration and CI gates

Service 0.9.0/schema 6 requires an explicit offline upgrade from schemas 1–5 and an exclusive audited backup. Tests and actual CLI verify schema-5 migration, preserved account/task history, no automatically created commerce grants, and rollback on failure. Existing historical migration evidence now checks the current schema constant while still checking each old backup's original version.

The community workflow adds durable commerce acceptance on all five existing Python/OS targets. Full normal/optimized unit suites, prior acceptance scripts, browser checks, actual CPU model, read-only RPC and the two-platform native identity bridge remain enabled. Local success does not imply remote success; final-source checkout/log/archive checks must be reported in the PR. Rust source and earlier golden histories are unchanged.

## Boundaries

Actual local authentication, HTTP operation, SQLite persistence and recovery are implemented. Merchant identities, provider eligibility and economic outcomes are fixtures. A stored operator instruction is not a wallet signature, legal-business authorization, verified human identity, externally authenticated settlement or a completed supplier order.

No provider/card/bank/signer integration, external transaction, real wallet balance, currency conversion, durable network executor, public hosting/iPhone controls or browser payment UI is delivered. Customer receipt accounting and provider retries/captures/reversals remain separate work. No AAI economics, investment payout or native Zoora protocol change is activated.

Trusted local state and an honest host remain assumptions. Internal replay/auditing can detect tested inconsistencies; it does not defeat a host that rewrites all records consistently. Restoring an old backup does not recover later external facts. Budgets/invoice deduplication apply per book, not across all an operator's books. [Method](DURABLE_COMMERCE.md) documents API shapes, limits and the next provider boundary.
