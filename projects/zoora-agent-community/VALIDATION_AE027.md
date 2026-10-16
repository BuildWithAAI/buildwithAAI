# AE-027 validation — read-only customer preflight

October 16, 2026. Built on published AE-026 commit `99ddb48825aa53cc0fe12bced3859e73304ed10d`, tree `7f3b5898f90e823195d9093deba9d86476c196eb`. This file records actual local checks of modified source. The development PR records the exact published head/tree and subsequent source-matched CI results; the parent alone does not contain AE-027.

## Completed local verification

CPython **3.12.14**, SQLite **3.53.1**: **436 tests pass normally and 436 under optimized Python**, including **31 new regressions**. Tests use real locally verified HTTPS and separate CLI processes to check projection/redaction, strict identity and transport bounds, ambiguous/missing approvals, contradictory legacy KYC and requirements, refusal of generic customer APIs, original journal immutability and credential continuity. Preflight grants no payment, route, rotation, wallet or settlement authority.

The new separate-process acceptance passes **27 checks across 19 preflight CLI cases**. Measured requests: **16 exact-ID customer GETs and one separate original CREATE POST**, **17 local HTTPS requests total**, one original fixture transfer. Preflight creates zero transfer objects and zero POSTs. Three rejected local-input/argument cases cause no HTTP; a different returned ID, HTTP errors and malformed responses count as actual GETs even when observation is refused.

The original unknown-payment setup precedes the alternate-key check. A positive customer observation under that other fixture key does not permit credential rotation. A positive observation does not reopen the expired POST retry window. Both the original and restored journal retain exact file-byte hashes and matching complete audits across observation/refused operations. The restored journal remains `RECOVERY_ONLY`.

All **11 earlier acceptance workflows pass**: integration, migration, operations, pilot access, task capacity, spending, commerce, durable commerce, sandbox transport, reconciliation and recovery. The preceding sandbox/reconciliation/recovery check counts remain 18/21/26. Existing deterministic spending/commerce reports remain unchanged. Ruff and Git diff checks pass. No runtime dependency, frontend, Rust simulator or native Zoora protocol changes are made.

[Local machine-readable checkpoint](evidence/ae-027-local.json) identifies the worktree parent and actual counts. Local reports identify themselves as `LOCAL_UNCOMMITTED`; they are not mislabeled as a published commit run.

## Published-source requirements

All five existing Python/OS matrix targets run the new acceptance script after the 11 prior scripts. Normal and optimized suites, runtime audit, browser acceptance, actual CPU inference, read-only public RPC and both native identity bridge jobs remain enabled. Final-source job logs and all nine downloaded archive byte counts/digests/CRCs/source associations must be verified before reporting remote success.

New archived reports permit independent checks of case outcomes, false authority flags, request boundaries, exact GET paths, unchanged journal summaries/hashes and the isolated original POST count. They do not contain the customer response payloads or journal databases. Hash comparisons and supplied summaries cannot independently reconstruct those unarchived bytes or attest to an external provider.

## Operational meaning

The command is a standalone read-only diagnostic. It is not automatically run by transfer creation and cannot reconfigure an account or upgrade a journal. Current service **0.9.0/schema 6** and provider-journal **schema 3** stay unchanged. The exact customer UUID and private `sk-test` key file must come from the operator's approved sandbox account.

Official single-customer documentation currently shows `status`, terms, endorsements and deprecated capabilities, while guides also refer to `kyc_status`. The implementation preserves that distinction: it neither invents missing legacy status nor lets legacy approval replace missing current status. Unknown strings are redacted and blocked. Base endorsement is an onboarding signal for USD rails, not proof of a specific Solana/USDC route or card service. [Method and official sources](BRIDGE_PREFLIGHT.md).

**External Bridge requests: zero. Actual provider account/route/response compatibility: UNVERIFIED.** No real wallet signature, card, merchant purchase, blockchain transaction, fiat conversion, live balance, real-asset spending mandate, synthetic-budget conversion or verified settlement is added. The one fixture CREATE is a retained local test scenario, not revenue, TVL or a real transfer. A successful diagnostic cannot rotate credentials, credit accounting, release uncertainty or reactivate restored state.

[Community update draft](../../docs/community/AE027_COMMUNITY_UPDATE.md).
