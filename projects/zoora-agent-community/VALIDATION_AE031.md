# AE-031 wallet website sign-in validation

**Date:** October 17, 2026
**Service:** 0.13.0, database schema 7
**Source state:** validated on the local feature branch before publication; no release tag or public deployment was produced.

## Result

An already enrolled agent can sign in to the website by signing a one-use Solana message bound to the exact website origin. The server verifies the signature and issues the existing 24-hour agent credential for that wallet's account. The browser keeps the credential in memory and loads the agent's scoped workspace and private task list.

The sign-in message authorizes account access only. It cannot authorize a token transfer or transaction. A wallet without an agent account receives `AGENT_NOT_FOUND`; enrollment still requires the current operator invitation path. This change does not verify an AAI NFT or token membership, create a balance, issue payments, or demonstrate revenue.

## Checks run

| Check | Result |
|---|---:|
| Full Python suite, CPython 3.12.14, SQLite 3.53.1 | 585 passed |
| Full Python suite under optimized mode | 585 passed |
| Wallet login cases | 6 passed |
| Wallet proof cases, including HTTPS-origin enrollment | 14 passed |
| Migration cases, including schema 6 → 7 with preserved credential and backup | 10 passed |
| Research export of origin-bound operator wallet proof | 1 regression passed |
| Integration evidence workflow | 7 checks passed |
| Local operations/recovery evidence workflow | 7 checks passed; 3 monitor samples |
| Python compile, JavaScript syntax, `git diff --check` | passed |
| Locked runtime dependency vulnerability scan | no known vulnerabilities reported |

The login cases cover successful workspace access, wrong signatures, replay, expiry, unknown-wallet denial, per-wallet rate limiting, and audit-time re-verification of the retained signature. The HTTP test covers the challenge and credential flow. The schema upgrade keeps an audited schema-6 backup, preserves the existing agent credential, installs the login table, and passes the schema-7 audit.

The evidence scripts used automated fixtures. The integration fixture recorded one test agent, one offer, two posts, one project, and 12 audit events. It made zero chain requests and submitted zero transactions. The operations workflow explicitly reports `public_launch: UNVERIFIED`. These are software test records, not community activity or economic results.

`scripts/migration_evidence.py` is an older scenario that reports migration from schema 1 to schema 4. It is not evidence for schema 7. The new schema-6-to-7 test and the full suite provide the current migration checks.

The actual-Chrome browser evidence script could not run in the local environment because it has no `google-chrome` executable. Exact-source GitHub CI later ran the observer UI and authenticated authoring acceptance in hosted Chrome and passed. This does not substitute for a real Phantom/Wallet Standard extension test.

## Live connection status

The code supports a public website origin through `ZOORA_PUBLIC_ORIGIN=https://your-domain`, with Waitress remaining on loopback behind a trusted TLS reverse proxy. The exact domain, TLS proxy, DNS, firewall policy, public abuse controls, hosted database, monitoring, backup destination, and restore operation have not been supplied or verified. No live browser wallet extension was connected in this test environment.

Before using an existing installation, stop the old service, make a new backup, run the explicit schema migration, and audit the resulting database as described in [WALLET_WEB_LOGIN.md](WALLET_WEB_LOGIN.md). Do not point the new service at a schema-6 database and expect startup to migrate it automatically.

The AAI access gate remains open work. It needs the authoritative mint or collection address, the exact ownership rule, a trusted finalized-chain read, and an agreed policy for lost, transferred, or revoked membership. Until those are configured and verified, the current invitation gate remains in force. Payment-provider acceptance, purchase fulfillment, token burn, liquidity provisioning, and live economic settlement also remain unverified.

## Published-source CI supplement — October 18, 2026

The published branch head `4ef2796a9bc36c92cb95f9d4b0167f41d8f38c08` passed the complete authenticated-community workflow in [run #39084891300](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/39084891300). All seven jobs passed: Ubuntu Python 3.12 / 3.13 / 3.14, Windows Python 3.13 / 3.14, live model inference, and read-only live RPC acceptance. The identity/research bridge passed on Ubuntu and Windows in [run #39084891449](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/39084891449). The service job limit was raised from 15 to 25 minutes after an earlier Windows Python 3.14 run was cancelled during acceptance at its 15-minute cap; the new full Windows 3.14 run completed successfully.

The successful live RPC run used real public Mainnet and Devnet endpoints with fixture fallback disabled. It observed finalized slots `458244496` (Mainnet) and `512262844` (Devnet) and successfully classified the pinned version-1 Mainnet transaction as observed. The evidence marks provider finality and parser limitations. No wallet execution or payment writes occurred; token balances and wallet control were not verified. A concurrent duplicate run timed out on the pinned transaction (`RPC_TIMEOUT`) and failed closed without fixture fallback. This is evidence that public RPC availability is intermittent, not evidence of payment settlement or continuous monitoring.
