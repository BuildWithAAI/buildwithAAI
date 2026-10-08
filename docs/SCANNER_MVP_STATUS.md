# Scanner development status — 2026-10-08

Candidate version: **0.1.1**. Existing branch: `feat/aai-scanner-mvp`; draft PR #10. Public deployment: **NOT STARTED**. Code and docs are git-backed in this repository.

## Implemented

The local read-only API and responsive report UI support exact SPL/Token-2022 mint state, attributed USD/SOL market snapshots, wallet balance/address activity, saved watches, observations, evidence receipts and process status. Telegram commands are implemented and disabled by default. Signing, trades and token payments are absent.

This reliability milestone adds:

- Up to two explicitly configured backup HTTPS RPCs; each verifies and periodically rechecks mainnet identity.
- One attempt per provider, structured failure diagnostics, shared response cooldowns and bounded recovery/identity waits. No immediate repeat of a 429 request.
- No recovery around wrong-network, malformed responses, RPC application errors or authentication/403 errors.
- Actual provider attribution on both successful and failed receipts, recovery attempts and mixed-provider/slot quality flags.
- Explicit finalized request options matching receipt claims; one shared market snapshot for wrapped SOL.
- Partial core-section coverage in web/Telegram summaries and safe RPC counters/cooldowns in authenticated system status.
- Strict smoke flags requiring holder and/or activity retrieval. The basic smoke does not certify the complete launch checklist.

## Tested

All **86 offline tests** pass locally in Python 3.12, including 24 new recovery, coverage, timing, attribution, request-finality and strict CLI regressions. Compilation, Ruff E9/F and JavaScript syntax checks pass. The pinned runtime dependency audit found no known Waitress 3.0.2 advisories; this is not a full security certification.

Current browser tests cover desktop/mobile authenticated access, partial coverage, literal provider metadata, missing values, capacity errors, watches, wallet, risk and status. Verify their run and all Python checks against the new final commit before merging. Earlier run #4 (37834821723) passed on historical head `2fe2966bbffdabb80384b7ab44eba89a56f11b85`; it does not certify new changes.

## Real source evidence

`verification/scanner-reliability-live-2026-10-08.json` records an actual strict USDC check collected at **2026-10-08T21:25:51.497+00:00** (16:25 Chicago), mint slot **454664244**. Mint, USD/SOL market snapshots and address activity returned. Mainnet identity verified independently on both configured RPC providers.

The strict command correctly exited **1 / FAILED** because required holder retrieval encountered primary HTTP 429 and backup HTTP 403. Both attempts, source hosts and timestamps are retained. Successful live recovery of holder data is **not verified**; fake fallback success is used only in clearly marked offline tests. Dated receipts are historical observations, never production display data.

Earlier wrapped-SOL and real Waitress/USDC HTTP checks are recorded in the previous status/report history and dated receipt. Shared public RPC availability varied during testing; no uptime promise is made.

## Remaining launch gates

- Reliable holder-capable mainnet RPC: **BLOCKED** on successful permitted provider access. No paid infrastructure purchased or secrets changed.
- Live Telegram commands: **BLOCKED** pending secure credentials and an authorized private test chat; no messages sent.
- New final-head CI/browser checks: required before claiming verification of this milestone.
- Public hosting/TLS, monitoring, sustained operation and deployment: **NOT STARTED**, require a target and authorization.
- Complete accounting/P&L, token creation time, relationship inference, interpreted extension semantics, per-user tenancy and alerts: **NOT STARTED**. Their values are not simulated in the product.

Research PR #9 remains isolated and unmerged. Audited head `1ffffe30122f855b69e639ddd58ff6344949e905` passed 27 offline tests and CI run #9 (37834405514). Setup and provider configuration are documented in `SCANNER_SETUP.md`. This is a local development candidate with explicit external gates.
