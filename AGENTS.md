# Owner direction: build the live Zoora economy

Effective October 29, 2026. Payment scope amended November 9, 2026 by Zoorped. Canonical repository: `BuildWithAAI/buildwithAAI`.

The owner authorizes production implementation of one layered website, connected services, persistent workers, supported model providers, and the noncustodial v1 economy in [the production build plan](docs/PRODUCTION_BUILD_PLAN.md). Continue building and testing the missing v1 implementation. Do not treat a closed November 9 gate as a feature to implement early. Do not ask the owner to choose between cosmetic next steps when a required engineering dependency is clear.

Read [GROK.md](GROK.md), [the production build plan](docs/PRODUCTION_BUILD_PLAN.md), and [the current audit](docs/PRODUCTION_AUDIT_2026-10-29.md). Reuse the existing repository and deployment. Do not create another GitHub repository or silently replace the persistent community state.

## Scope and authority

- Historical `ABSTAIN` / `NO_EXECUTION` records describe the authority of their research runs and adapters. Preserve those truthful records. They do not prohibit implementing separately tested production adapters.
- Code-development authorization is separate from a wallet's transaction authorization. v1 payments are classic SPL USDC. The user signs each payment in Phantom or Solflare, or sets spending caps in the Solana Foundation Pay tool on their own machine. Implement quotes, user signatures, verified receipts, and reconciliation. Never infer payment or spending permission from a login message. Zoora does not operate a delegated or session signer in v1. That signer waits on legal review of the FinCEN control analysis.
- The $30 activation fee and the 40/40/20 burn, lock, and liquidity split are on hold. They are not in v1. A login signature is not a fee, and an ordinary service payment is not that held fee. Reintroduce the charge only as a plain service fee after counsel review. Free owner-issued private-pilot invitations remain supported.
- Zoora stores a user's Solana wallet public key and metadata only. It does not store seeds, private keys, or hosted balances. Users fund their own wallets. Zoora earns by selling research and services over x402 to `<COMPANY_RECEIVE_ADDRESS>`. Do not invent that address. External agents are paid to the seller owner's public key. See [external agent onboarding](docs/EXTERNAL_AGENT_ONBOARDING.md).
- Escrow for longer jobs is not in v1. Any token is removed from the plan. Do not add a mint, burn, lock, liquidity program, or stake asset to v1.
- Users control their wallets. Never commit private keys, seed phrases, API keys, bearer credentials, production databases or private model inputs. Use supported provider APIs or explicitly permitted user-side authentication; do not extract consumer browser sessions.
- Research fixtures, hand-written voters, hash checksums and caller-declared `CHAIN_READ` strings cannot become real payment receipts, trained animal brains, successful strategies or earnings.
- Keep existing immutable component pins and scientific validation intact. Upgrade them through an explicit compatibility change, not by deleting identity checks.
- Claims must follow observed tests, deployment status and runtime evidence. A merged source tree or rendered button is not proof of a running integration.

## Execution workflow

Inspect current source and hosting first. Implement complete vertical flows with real persistence, authorization, idempotency, bounded workers and failure handling. Run relevant unit, integration and browser checks. Fix observed failures. Commit code, schemas, contracts, operating instructions and dated evidence to this repository. Continue through the next unblocked milestone without another blanket approval request.

When a dependency really requires owner input, identify its exact configuration or signature, finish independent work, and leave a concrete tested integration ready for that input. Do not claim an unavailable credential, undeployed contract or unqualified model exists.
