# AE-022 validation — commerce routing

October 15, 2026. Based on draft AE-021 commit `eb96f442cfc486305d8797d035be93cb5d57a607`. This document records checks of the modified local worktree, not a claim that its parent already contained AE-022. Published source SHA, remote CI results and any remaining gates belong in the development PR.

## Local verification

CPython 3.12.14 / SQLite 3.53.1: **288 tests pass normally and 288 under optimized Python**, including 27 new commerce regressions. The new tests cover activity/merchant/method rules, expired eligibility, complete quote/terms binding, subscription windows/prices/cycles, shared budgets, an eight-thread admission race, uncertainty, revocation, receipt identity, partial/full refunds, delivery evidence and actual CLI behavior.

The new actual CLI/evidence runner passes **19 checks**, retaining all **38 actions and 39 state views**. Normal/optimized output matches the complete 163,031-byte reference, fingerprint `63987b20f2c135626eadb321097d5dc35cb4ce4ae7994c6163453f46e2145bfa`. Its independent auditor imports neither payment model and rejects corrupted refund, binding and budget records. Rehashed fabricated accounting also fails complete replay.

Final scripted allocations: 130 principal settled, 25 refunded, 105 net principal, eight fee units spent; twenty principal/seven fee units unused and zero reserved. Principal/fee units are separate synthetic denominations, not money, sales or profit.

The earlier payer CLI's 15 checks and 27-action reference still pass unchanged. Five prior actual CLI/HTTP scripts also pass: integration, migration, operations/recovery, pilot access and task capacity. Ruff and Git diff checks pass. No dependency was added. Machine-readable local evidence is in `evidence/ae-022-local.json`.

## Published-source gates

The existing community CI adds commerce CLI/replay/auditing on every Python/OS matrix target, alongside full unit suites, prior acceptance scripts, browser controls, actual local model and read-only RPC. Existing identity/native-bridge regressions remain enabled. Local results do not imply those remote jobs ran or passed; record their actual status and exact source in the PR.

The existing 27-action payer reference and Rust sources were not modified. This milestone did not locally repeat native-engine benchmarks or real provider/Telegram/wallet tests. There is no UI change or verified iPhone/Safari deployment.

## Scope

Offline process-local research only: no authenticated mandates, provider clients, real account/store creation, keys, currency conversion, wallet balances/signing, customer receipts, shipping, trading or durable payment worker. Eligibility and outcome inputs are fixtures; the tests cannot establish legal permissions, merchant honesty, production acceptance or useful autonomous work.

Fulfillment is recorded evidence, not supplier dispatch. Lifetime budget is not restored after refunds. Cycles cannot be rebound after cancellation/failure without a future explicit retry policy. Known platform checks are narrower model profiles rather than universal card acceptance rules. Arbitrary mislabeling of merchants/resources remains outside the fixture model's ability to detect.

No live AAI fee, burn, liquidity, investment distribution or native Zoora change; service remains version 0.8.0/schema 5. See [method and source links](COMMERCE_ROUTING.md) and [architecture](../../docs/AGENT_PAYMENT_SYSTEM.md).
