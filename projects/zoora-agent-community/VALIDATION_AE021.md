# AE-021 validation — delegated payer authority

October 15, 2026. Development is based on AE-020 commit `7e2ef806b04925d954373c0898318ceb66a02f22`, tree `0bef1522711fab4d3f259c19163884fed9d44edd`. That parent does not contain the payer-authority model. Local results below describe the modified worktree; final published-source results and downloaded artifact verification are recorded in the draft development PR. No merge, deployment or live payment is part of this milestone.

## Local checks

CPython 3.12.14 / SQLite 3.53.1: 261 tests pass normally and 261 pass under `-O`, including 22 new spending regressions. The new actual normal/optimized CLI acceptance passes 15 checks. It reproduces the retained 27-action report byte for byte, independently reconciles 28 state views and verifies external pins, rehashed accounting tampering and exclusive output behavior. Final local full-suite results are recorded in `evidence/ae-021-local.json` after completion. Ruff and diff checks are required.

The deterministic reference is `examples/spending-reference.json`, fingerprint `2e554c666231916e3f920c8358f9354aa6add9f5c4b0ec51bd1fb0b4f8c210a9`, 69,031 UTF-8 bytes including its terminal newline. It is retained in full with the original input. The final allocation is 150 synthetic principal units and nine separately denominated fee units spent, zero reserved and one fee unit remaining. These are scripted budget allocations, not real wallet balances, revenue or profits.

## Published source gates

The community workflow adds spending CLI/replay/accounting acceptance on all five existing Python/OS combinations, alongside normal/optimized unit suites, prior HTTP/migration/recovery controls, browser checks, actual CPU model execution and read-only live RPC. The existing Linux/Windows Rust bridge workflow remains a required regression check; no Rust source or preceding golden report changes are introduced.

Success requires checking the final checkout SHA in job logs and the source summaries, digests, sizes and CRCs of downloaded archives. Each matrix artifact retains both `spending-evidence.json` and the complete `spending-report.json`. Fresh reports must match the committed deterministic reference on every platform and normal/optimized Python. Final evidence belongs in the PR, rather than being inferred from this pre-publication document.

## Boundaries

All authority/identity, invoice, attempt, fee and settlement inputs are synthetic. The engine has no network, key management, wallet balances, live authorization, transaction execution or chain verification. The actual CLI and accounting/replay code paths are tested. Production signer enforcement, authenticated mandates, durable execution recovery, SPL accounting, x402/Solana Pay conformance and paid work attribution remain unfinished. Source/report fingerprints do not establish human identity, legal authority, economic value or an honest host.

The model is a budget-policy book, not a new currency, deposit-taking service or account for customer funds. Existing local service schema/version and Rust historical semantics remain. It does not activate AAI fees, burn/liquidity operations, community investment payouts or native Zoora changes. See [method](SPENDING_AUTHORITY.md), [architecture](../../docs/AGENT_PAYMENT_SYSTEM.md) and [community draft](../../docs/community/AE021_COMMUNITY_UPDATE.md).
