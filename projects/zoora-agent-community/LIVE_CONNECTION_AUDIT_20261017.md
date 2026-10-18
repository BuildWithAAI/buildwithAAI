# Live connection and release audit — October 17, 2026

**Result: NOT READY FOR LIVE PAYMENTS OR PUBLIC AGENT-ECONOMY LAUNCH.** Real-read setup has been developed; this session has no accepted external chain response, production customer response, paid order, NFT issuance or commercial settlement.

This audits the recovered community/payment source and the new connection changes, not every BuildWithAAI product. Software tests are real executions against controlled inputs; simulation participants, balances, purchases and profits are artificial. They must never be described as live users, transactions, revenue, returns or demonstrated spam prevention.

## Source preservation and release finding

The local AE-032 checkout was initially present at `720675a191cdbabb1f66a95ab01fa4cc95bf2a2c`, with implementation at `0fd6a327978993394f7b98bb273aac28f90485d8`. Workspace maintenance subsequently removed that checkout, its evidence and `AE031-AE032-REVIEW.patch`. Searches found no recoverable copy of that patch or AE-032 validation file in saved files. The new clone does not contain the unpublished objects.

The recovered baseline is published AE-030, `3dbfdaf56265e169b8fab6c40e0c3a385d220c65`, on a separate local branch, `feature/live-connections-audit`. This is not an integrated AE-032 release. Restore the original patch/checkout before certifying AE-031/032; prose reconstruction would not be byte-for-byte recovery. The new connection module does not require the missing modules.

[PR #46](https://github.com/BuildWithAAI/buildwithAAI/pull/46) was freshly rechecked and remains open, draft and unmerged. Its recorded [community](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/38883028726) and [native identity](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/38883028753) workflows still report success. Those historical results are not fresh live acceptance for this patch. The main branch is not the integrated release of these stacked development branches.

## Actual readiness inventory

| Capability | Evidence now | Required next step |
| --- | --- | --- |
| Community, identities and jobs | Recovered local software; regression suite passes. Historical wallet signatures and scoped credentials exist. | Actual hosting, public transport/origins, enrollment operations and real iPhone/Phantom acceptance. |
| Existing Solana transaction observer | Historical live CI; fresh original script returned BLOCKED for all three cases. | Reachable permitted RPC and a fresh acceptance run. |
| New cluster/SOL balance check | Implemented actual RPC requests, genesis binding, finalized slot and optional exact balance. Mainnet and Devnet attempts both returned `CONNECTION_DNS_FAILED`; observation null. | Public agent wallet and reachable RPC. SOL balance is not AAI/USDC inventory or spending authority. |
| Sandbox payment pipeline | Durable admission, queue, create-once and recovery code; local TLS fixtures exercised. | Credentialed vendor interoperability and exact route acceptance. |
| New production Bridge account read | Separate exact-customer GET implemented and locally tested. External call NOT RUN: no authorized customer/key setup supplied. | Approved account, customer UUID and private host-side API-key file. |
| AAI membership payment receipt | New fixed-Mainnet `getTransaction` verifier checks one exact quote, unique memo, payer signature, classic SPL transfer and token-account deltas. Parser fixtures are local test data only. | No real quote/signature or authoritative AAI mint/treasury is configured; no external receipt was tested. Durable order uniqueness, checkout, NFT issuance and access enforcement remain unimplemented. |
| Production payment execution | No constrained signer or verified production payment-write integration. | Asset/recipient/amount limits, signing, settlement, refunds and useful-delivery reconciliation. |
| Storefronts, cards, print-on-demand | No operational connector verified in this community module. | Selected permitted accounts and specific checkout/fulfillment integration. |
| AE-031/032 books | Previously reported local work; exact source/evidence now unrecovered. | Restore and revalidate before integration. Previous 609-test result is not this branch's result. |
| NFT access | [Design recorded](../../docs/AAI_MEMBERSHIP_PASS.md). No mint, payment attribution or membership enforcement implemented. | Official mint/treasury, price/pass policy, issuance recovery, server admission and actual wallet verification. |
| Other projects | Scanner, replay and wider Zoora products were not freshly audited in this pass. | Their own exact-source and live-provider/Telegram/hosting acceptance. |

The DNS failures concern this execution environment. They do not demonstrate that Solana is down. No alternative destination or sample record was substituted to turn failure into success.

## Completed changes and verification

`zoora_community/live_connections.py` adds explicit real-service reads with fixed destinations/methods, strict TLS/JSON, private key files, bounded responses, no redirects, exact customer/cluster binding, redacted failures and exclusive timestamped reports. `solana-payment` reads one finalized Mainnet transaction and returns evidence only; `zoora_community/solana_payment_verifier.py` enforces exact transfer and quote facts, and cannot fulfill a membership. It has no model tool, payment-write path or fixture mode. [Setup instructions](LIVE_CONNECTIONS.md) and the [payment integration design](AAI_PAYMENT_INTEGRATION.md) document the gates.

`tests/test_live_connections.py` adds 18 security/transport regressions. `tests/test_solana_payment_verifier.py` adds 12 parser and fixed-RPC-boundary regressions. **574 tests pass normally and the same 574 pass under Python optimization**, using CPython 3.12.14. The new parser fixtures are controlled unit-test inputs, never live receipts or simulated economic outcomes. These are recovered AE-030's 544 plus 30 new tests, not an increase over the unrecovered AE-032 branch's 609. Ruff passes. Test counts do not measure economic activity or external acceptance.

Initial local TLS tests exposed a test replacing Python's global HTTPS class and a runtime attempt to adjust a socket closed during HTTP/1.0 response detachment. The test now patches only the module alias; the runtime uses the remaining socket when present and otherwise retains the response's existing timeout. The passing positive TLS test and exact negative error-code checks cover this correction. Initial failed-run logs are retained.

Current-status and operations text is corrected: the recovered community schema is 6, not the old operations introduction's schema 4. The [membership proposal](../../docs/AAI_MEMBERSHIP_PASS.md) distinguishes wallet control, access rights and anti-spam limits. No price, mint or charge is activated.

The [machine-readable record](evidence/live-connections-20261017.json) retains source/file/log digests and the two actual failed RPC reports from the earlier connection-only checkpoint. Its implementation digest predates the payment verifier and must not be treated as the current source digest. Both historical diagnostic invocations exit **2**, state **BLOCKED**, with no observation. No payment lookup was attempted because no real signature, official mint, treasury or quote was available. Real Bridge customer reads, wallet-balance reads, payment writes, NFT mints, burns, LP deposits and revenue observations in this session: **none**.

Current local package implementation digest after this verifier change: `6e8325cec1535c67be4d795e56c93a585cebeb09040af1847b0068059509fad3`. It covers package Python source files and `requirements.lock`; it is a content identifier, not a signed release or proof of deployment.

CI now includes both new real-RPC diagnostics, but those workflow changes have not run remotely. Remote CI, the separate acceptance scripts, actual local model/browser/vendor wallet, dependency-advisory refresh and native Rust tests were not rerun for this patch. Existing historical evidence remains dated. This is not a complete security audit or continuous operational service. Provider keys may have rights beyond this read-only command; host ACLs, secrets, patches, off-host backups and monitoring still require verification.

## Concrete remaining work

1. Recover the original AE-031/032 patch if retained elsewhere and reconcile the stacked branches. Keep this standalone diagnostic usable during recovery.
2. Publish reviewed source to the existing BuildWithAAI destination and run new remote checks. No publication occurred: a prior automatic approval review rejected the push because explicit authorization to publish potentially private changes to that destination was missing. No alternate write path was used.
3. Select the actual execution host and permitted production RPC. Publish an authoritative official AAI mint, decimals and treasury owner, then create a one-use stored quote with amount, expiry and random memo. Supply only public addresses and a real transaction signature to the receipt checker; put provider secrets directly on the host, not in chat. Retain the actual external outcome.
4. Check the operator's permitted Bridge production customer, then verify the exact payment route and merchant use case. A successful account read alone cannot clear those gates.
5. Complete one limited authorized real workflow with a useful deliverable, externally verified payment, fees/refunds and reconciled costs before broad access or charging for membership.

Full-scale readiness is blocked by source integration and external operating/payment capabilities. No percentage-complete, real profit or spam-prevention claim is established.

## Fresh live check in this work session

After installing only the hash-locked runtime dependencies, the actual Mainnet diagnostic called the configured Solana endpoint with fixture fallback disabled. It exited `2` with `CONNECTION_DNS_FAILED`; the report has `state=BLOCKED`, `observation=null`, `payment_writes=0`, and `wallet_execution=false`. The preserved raw report is [here](evidence/live-mainnet-attempt-20261017T1917.json). This is an environment DNS failure, not evidence that Solana is unavailable.

No simulator or synthetic marketplace workflow was run in this work session. The website now labels its API deployment mode separately from RPC configuration: it shows `RPC OFF` when disabled, and `RPC ON · NOT CHECKED` when the fixed endpoint is enabled. That badge reports configuration, never live endpoint health. The Linux service template enables read-only Solana RPC and accepts an optional service environment file for the public origin. `systemd-analyze verify` confirms this unit cannot run in the scratch workspace because its documented `/opt/.../.venv/bin/python` install path is absent; the unit remains an uninstalled template. This runtime has no configured public origin, provider credentials, authorized customer ID, public agent wallet, or verified token mint. The canonical token record remains `TBD — DO NOT GUESS`; payment checkout, membership issuance, burns, liquidity deposits and public hosting are therefore still blocked.
