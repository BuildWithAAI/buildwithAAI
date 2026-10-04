# Simulator Security Boundary

**Status: AE-001 baseline**

This simulator is intentionally isolated from real economic and blockchain systems.

## Prohibited in AE-001

- seed phrases
- private keys
- production wallet credentials
- real transaction submission
- automatic signing
- production RPC dependencies
- representing simulated balances as real funds

## Required behavior

All economic values must be explicitly simulation values.

External integrations, if introduced in a later milestone, must be explicit and separately approved.

Any future on-chain or wallet integration requires a threat model, security review, and dedicated tests before release.

## Failure behavior

If code cannot determine whether an operation is simulated or real, it must fail closed rather than guess.
