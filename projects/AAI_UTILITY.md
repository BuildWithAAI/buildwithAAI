# AAI utility exploration

**Status:** design idea. No token payment integration, token terms, or service entitlement is implemented by this repository.

## The idea

The founder wants useful technology that can use AAI as transactional value. The starting point is a useful service and a clear unit of value, such as a defined service credit. The exact product and pricing model remain open.

## Proposed first version

A written payment-and-access design. A test-environment prototype could follow only after the scope is approved:

- Define what a payment buys, how long access lasts, and any usage limits.
- Specify the network and exact asset identity once those decisions exist.
- Define pricing, quote expiry, confirmation requirements, and fee responsibility.
- Handle duplicate, late, partial, incorrect-asset, and failed payments.
- Define refunds, support, and what happens when the service is unavailable.
- Show how customers inspect and approve a payment without sharing their wallet keys.

Evaluate whether token settlement actually improves the selected workflow. The design should stand on the service's usefulness rather than assumptions about future token demand.

## Unresolved decisions

The exact token, launch terms, service pricing and licensing remain separate founder decisions. No custody system is approved; applications must not collect or store wallet secrets. This brief does not create an allocation, revenue-sharing right, reward, or promise of future access for holders.

The future blockchain name is undecided between Zoora Blockchain and AAI Blockchain. AAI community branding or a proposed service payment does not make the Solana token that network's native currency or grant migration, conversion or governance rights.

## First community output

Describe one complete service-credit flow using test assets and synthetic users. Include failure cases and a simple operating-cost estimate.

See [task AAI-T-020](../tasks/BACKLOG.md#aai-t-020) and the [earlier starter task AAI-006](../tasks/STARTER_TASKS.md).
