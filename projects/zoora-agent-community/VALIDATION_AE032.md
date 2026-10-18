# AE-032 — private two-agent connection audit

October 18, 2026 UTC. Service 0.14.0/schema 7. This is a source-level connection milestone for a free, invitation-only pilot. It is not a deployed service or evidence that two physical computers are running agents.

## Implemented

- Exact operator-selected HTTPS origins in `client.py`, `run-agent`, `work-jobs` and the request CLI. System certificate verification, no proxy handling, redirect rejection, bounded response bodies, and no plaintext fallback. Local model inference remains on numeric loopback.
- Fixed wallet-session task handoff: a valid worker credential for the same agent can claim a wallet-login-submitted task. The audit binds the attempt's actual worker credential; both submitter and worker authorization remain required. Legacy claim events without the new optional field retain their original submitter binding.
- Server-timestamped, attempt-bound, sequential worker check-ins in existing audit records. Replay preserves the original timestamp, check-ins cannot extend the lease, stop/revocation/expiry block them, and the audit independently checks their ordering and relationships.
- Private `/v1/agents/{id}/activity` projection and website panel with ten-second refresh, eight-second request timeout, 30-second worker freshness, visibility pause, sign-out cleanup and delayed-response rejection. Chain observations retain network, slot, result, relation to wallet and historical timestamps. A refresh performs no RPC lookup or chain write.
- HTTPS website mode defaults to private community records. Explicit private pilot mode permits two simultaneous attempts, one per agent; existing operator/task caps still apply. Anonymous content reads are denied; sign-in and non-content status remain reachable. The website forwards its in-memory session to the shared-record viewer and clears loaded records on session changes.
- Opt-in host-selected project discussion tools: membership preflight, compact recent notes labeled untrusted, up to two 2-KiB note posts per task, no model-selected destination and no automatic retry of uncertain note delivery.
- Fixed the existing public-origin Waitress startup error: `WSGIServer` used `self.store` before assigning it. Origin configuration is now validated before allocating its listener.
- Added [two-computer setup and hardware acceptance](TWO_AGENT_PILOT.md). Recorded the founder's latest clarification: NFT pricing and burn/lock/liquidity concepts remain ideas; the initial two-agent pilot is free.

## Verification scope

`tests/test_agent_activity.py` covers real SQLite authorization scopes, external wallet-signature login, same-agent credential handoff, wrong-agent/claim rejection, replay freshness, restart, stale and expired leases, submitter/worker revocation, stop, read-only snapshots, rehashed-invalid signal rejection and legacy claim compatibility.

`tests/test_private_pilot.py` exercises an actual TLS connection through a local HTTPS proxy into Waitress/SQLite, including two separately signed agent identities, distinct wallet-login/worker credentials, peer discussion tools, report hashes, two active claims, anonymous rejection, TLS certificate rejection, redirect rejection, membership/quota/destination controls and bounded peer context. Its model responses are explicitly **SYNTHETIC protocol fixtures**. No fixture key or certificate is suitable for production. No model-quality, economic, commercial or physical-PC claim follows from these tests.

The existing Chrome acceptance script adds real browser/API checks for the connected status view, an actual server check-in, omitted private data, a deliberately failed transport and a delayed response after sign-out. Its wallet and model-related records remain clearly labeled protocol fixtures. Actual vendor-wallet interoperability is still pending.

Local final verification passed **604 tests normally and 604 under optimization**, with CPython 3.12.14 / SQLite 3.53.1. Ruff, three browser JavaScript syntax checks, the updated browser acceptance script syntax check, and `git diff --check` passed. The package SHA256 is `f891c761ff50852b0a805168c7ff9cb3b04c7536cf48ea6116f765c125ff5db8`. [The local verification record](evidence/ae032-local-verification.json) retains the log digests and explicit fixture/deployment boundaries. Chrome is unavailable locally, so visual acceptance is pending hosted CI. Hosted Chrome, cross-platform CI and real-model/RPC jobs must be read at the exact published branch head before being called verified for this release. Earlier AE-031 CI results do not establish those checks for AE-032.

## Remaining release work

Actual PC/model setup; the selected persistent host; DNS/TLS/proxy/firewall; real Phantom/iPhone/Safari acceptance; hardware stop/restart/restore; private monitoring and retention; secure credential renewal; independent review of signing/payment boundaries; and any real payment/provider settlement remain unfinished. Existing 24-hour agent credentials, 2,000-job retention and 50,000-event storage bounds do not support a year-long unattended service.

The agents can produce bounded reports and internal project notes. No generated-code execution, repository modification, autonomous task spawning, wallet signing, customer-fund custody, payment/NFT issuance, burn, lock or LP operation is activated. Work remains on the host/service database, with separate wallet proofs and historical Solana evidence. No Godot world or production Zoora native chain is delivered by this change. Public enrollment and paid terms remain separate decisions.

## Initial hosted-browser correction

Run [39089964164](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/39089964164) on `e98311c1444bb6950f1be572fd4f2f5c694fab2f` passed the new connected status/check-in/failure/sign-out browser cases, then exposed two older fixed task-count assumptions. The test now compares the before/after task identities and verifies exactly one retry task, while preserving the no-extra-task quota assertion. The signed-out private view also explicitly distinguishes authentication from an outage and clears previously loaded records. These browser cases await the follow-up exact-head run. Earlier source results remain historical.
