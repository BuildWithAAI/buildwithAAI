# Scanner development status — 2026-10-08

Branch: `feat/aai-scanner-mvp`; existing draft PR #10. Public deployment: **NOT STARTED**.

## Implemented and locally tested

- Read-only mint inspection for legacy SPL and Token-2022 with exact supply and authority state.
- Mainnet identity verification; bounded HTTPS RPC and documented DEX Screener base-token pool integration.
- Source-backed API, USD/SOL prices, distinct market cap/FDV, explicit missingness and source failures.
- Responsive dark interface: token report, wallet balance/activity, risk/evidence, observations, saved watches and process/provider status.
- SQLite persistence and tested backup recovery, configurable access adapter, same-origin/Host checks, bounded requests, provider budgets and safe error handling.
- Disabled-by-default allowlisted Telegram adapter; all commands and delivery failures tested offline.
- 62 Python tests passed on local Python 3.12.14; compilation, JavaScript syntax and Ruff E9/F static checks passed. Browser CI run #3 (37834242975) passed desktop/mobile checks on 7601af6966b68d16af354668a5d8ced9d4c01e52; screenshots were reviewed. The final candidate adds access-dialog checks and must pass CI again. Pinned runtime dependency audit found no known Waitress 3.0.2 vulnerabilities; this is not a security certification.

## Real integrations verified

The dated receipt `verification/scanner-live-smoke-2026-10-08.json` records a successful read-only wrapped-SOL smoke against actual Solana mainnet RPC and DEX Screener. Mint slot: 454639308; collected 2026-10-08T19:33:54.949+00:00. USD/SOL price evidence and address activity returned; largest-token-account source failed.

A real Waitress HTTP/API check on 2026-10-08T19:41:41.613+00:00 also returned USDC mint/market/activity evidence, slot 454641046. Holder retrieval failed and remains a provider coverage limitation. Prices in historical receipts are not current prices. Public RPC failures were also observed during this session; configured provider reliability must be established before public beta.

## Remaining launch gates

- Live Telegram commands: **BLOCKED** pending bot credentials and an authorized private test chat; no messages sent.
- Holder integration: **BLOCKED** on successful provider response; missing accounts are shown explicitly, never fabricated.
- Browser report/layout checks: **VERIFIED** by run #3 and screenshot review. Final-head CI/authentication browser checks: must be reverified after the last changes.
- Public hosting, TLS, monitoring, operational checks and deployment: **NOT STARTED**; require a target and authorization.
- Complete P/L ledger, relationship inference, token creation time, interpreted Token-2022 extensions, per-user tenancy and alerts: **NOT STARTED**. These are not simulated in the product.

Reproduce setup and smoke verification using `SCANNER_SETUP.md`. Research PR #9 remains isolated from scanner launch. Its audit fixes at 1ffffe30122f855b69e639ddd58ff6344949e905 passed 27 tests and CI run #9 (37834405514); it remains unmerged. This is a working local candidate, not a deployed or fully launch-gated MVP.
