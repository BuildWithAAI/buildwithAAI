# AE-024 validation — Bridge sandbox transport and recovery

October 15, 2026. Based on published AE-023 commit `91e7caa1bca3bb74eacd3e4af6e7f1b68a9e6933`, tree `d174d88f2115bc2b8b8b38f6cf8445895d830d03`. Results below describe the modified local source. Final published source, remote CI and archive verification are recorded in the development PR.

## Local checks

CPython 3.12.14 / SQLite 3.53.1: **350 tests pass normally and 350 optimized**, including **33 new tests**. Ruff and diff checks pass. No runtime dependency was added; service version/schema remain 0.9.0/6.

New tests use real locally verified TLS, exact HTTP headers/body, certificate refusal, strict JSON/decimal inputs, response term/ID binding, error redaction, response-size/timeout bounds, local private-file checks, SQLite serialization and corruption refusal. Actual CLI process death after provider-fixture acceptance retains an incomplete intent. A new process recovers the same key/body; another active process is refused during the lease. Stale completion cannot replace a newer result. Failed polls retain old evidence with its original timestamp while marking the latest observation uncertain.

The new actual CLI/local HTTPS acceptance passes **18 checks**: four saved intents, nine committed attempts, nine actual HTTPS requests and four unique local fixture transfer objects. Independent SQLite inspection recomputes every saved request digest and the attempt count. API bearer keys are absent from the tested database and CLI output. The harness injects clock values to test the 60-second lease and conservative 23-hour retry boundary without waiting; it redirects only test processes to the local TLS fixture.

## CI gates and interpretation

All five existing Linux/Windows Python targets retain full normal/optimized suites and previous CLI/HTTP/browser checks, and add the Bridge sandbox contract acceptance. Existing local model, read-only RPC and both native identity bridge jobs remain enabled. Final-source checkout/log/archive verification must be recorded in the PR. New UUIDs make wire digests run-specific; each report must retain matching retry body/key pairs, counts and scope rather than match bytes across runs.

The test-provider fixture implements selected documented contracts; it cannot establish that Bridge accepts this client, customer, route or response shape. **External Bridge requests: zero. Vendor account/route acceptance: UNVERIFIED.** No actual payment, card, signer, blockchain transaction, production provider approval, commerce-budget conversion or native Zoora change is delivered. A sandbox provider's `payment_processed` label is never applied as verified settlement.

This CLI uses a separate host-owned journal. It is not an authenticated agent-facing endpoint and is not included in community backup/restore. No cross-journal deduplication, authenticated account continuity during credential rotation, manual known-ID import, webhook verification, continuous worker or fresh funds/fee verification is implemented. An honest durable host, intact journal and sane wall clock remain assumptions. Windows ACL/power-loss behavior is not certified. See [method and commands](BRIDGE_SANDBOX.md).
