# Owner direction: build the live Zoora economy

Effective October 29, 2026. Canonical repository: `BuildWithAAI/buildwithAAI`.

The owner explicitly authorizes production implementation: one layered website, connected services, persistent autonomous workers, supported model providers, noncustodial payments, and subsequently authorized execution. Continue building and testing the missing implementation; do not turn a missing feature into a permanent prohibition on developing it. Do not ask the owner to choose between cosmetic next steps when a required engineering dependency is clear.

Read [GROK.md](GROK.md), [the production build plan](docs/PRODUCTION_BUILD_PLAN.md), and [the current audit](docs/PRODUCTION_AUDIT_2026-10-29.md). Reuse the existing repository and deployment. Do not create another GitHub repository or silently replace the persistent community state.

## Scope and authority

- Historical `ABSTAIN` / `NO_EXECUTION` records describe the authority of their research runs and adapters. Preserve those truthful records. They do not prohibit implementing separately tested production adapters.
- Code-development authorization is separate from a wallet's transaction authorization. Implement genuine wallet signing, quotes, verified receipts, delegated spending policies and reconciliation. Never infer payment or spending permission from a login message.
- The $30 activation is USD-equivalent AAI, with 40% burn / 40% lock / 20% liquidity. It is not a message signature. An ordinary service payment is not evidence that this activation allocation occurred. Free owner-issued private-pilot invitations remain supported.
- Users control their wallets. Never commit private keys, seed phrases, API keys, bearer credentials, production databases or private model inputs. Use supported provider APIs or explicitly permitted user-side authentication; do not extract consumer browser sessions.
- Research fixtures, hand-written voters, hash checksums and caller-declared `CHAIN_READ` strings cannot become real payment receipts, trained animal brains, successful strategies or earnings.
- Keep existing immutable component pins and scientific validation intact. Upgrade them through an explicit compatibility change, not by deleting identity checks.
- Claims must follow observed tests, deployment status and runtime evidence. A merged source tree or rendered button is not proof of a running integration.

## Execution workflow

Inspect current source and hosting first. Implement complete vertical flows with real persistence, authorization, idempotency, bounded workers and failure handling. Run relevant unit, integration and browser checks. Fix observed failures. Commit code, schemas, contracts, operating instructions and dated evidence to this repository. Continue through the next unblocked milestone without another blanket approval request.

When a dependency really requires owner input, identify its exact configuration or signature, finish independent work, and leave a concrete tested integration ready for that input. Do not claim an unavailable credential, undeployed contract or unqualified model exists.
