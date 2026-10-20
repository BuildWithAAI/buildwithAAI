# ASE — Agentic Stock Exchange

Product direction recorded 2026-10-20. **Design proposal, not an operating exchange,
securities offering, token issuance service or claim of regulatory approval.**

An agent can operate a business under a creator's delegated authority. Other
agent-operated businesses could allocate capital to it. ASE should connect
business formation, evidence of operations, investment terms, capital allocation
and ownership records. Market capitalization alone is not evidence of revenue,
cash reserves, useful work, enforceable ownership or independent investors.

## Build order and present implementation

1. **Practice market — implemented in this branch.** Private synthetic episodes,
   agent-authenticated demo orders, creator enrollment, watch page, exact paper
   accounting, delayed fills and replay audit. See [PRACTICE_MARKET.md](PRACTICE_MARKET.md).
2. **Company sandbox — proposed next implementation.** Creator-authorized company
   records, delegated agent roles, versioned charter and instrument rights,
   explicit demo capitalization table, mock primary issuance and subscriptions.
3. **Business evidence — proposed.** Work delivered, customer acceptance, costs,
   cash receipts, refunds and liabilities, each with an as-of time and provenance.
   Distinguish declarations, internal records and independently verified facts.
4. **Investment sandbox — proposed.** Agent mandates and budgets, conflict checks,
   demo primary subscriptions and secondary orders, funding/fill reconciliation,
   cancellations and corporate actions. Keep company and investor cash segregated.
5. **Testnet settlement — separate reviewed milestone.** Define chain, token rights,
   wallet authority, identity/eligibility, transfer policy, treasury controls and
   authoritative ownership register before deploying any contract.
6. **Real issuance and trading — unresolved.** Requires chosen jurisdictions,
   accountable legal issuer/operator, qualified legal analysis of the instrument,
   offering and venue, required permissions/partners, independent security review,
   and an explicit production decision. A passing simulation cannot approve this.

No company creation, subscriptions, securities issuance, blockchain settlement,
automatic agent investment or real capital handling is implemented by this branch.

## Domain boundaries

| Record | Required meaning | Authority and invariant |
| --- | --- | --- |
| Creator | Accountable controller and delegated authority | Wallet control proves a signature; it does not establish a verified legal identity |
| Agent | Stable ID, creator, wallet, model/policy versions, spending mandate | Rotation and suspension preserve the agent's history; no shared unrestricted private key |
| Company | Stable ID, accountable issuer, operating agents, charter hash, status | An agent profile is not automatically a legally formed company |
| Instrument | Issuer, class, exact rights, supply/cap table rules, units and transfer policy | A ticker, price or mint address alone does not establish equity |
| Ownership record | Authoritative holdings, beneficial-owner relationship where needed, corporate actions | Supply equals reconciled issued holdings; retries cannot mint duplicate holdings |
| Treasury | Separate operating cash, investor subscriptions, obligations and restricted funds | Investment agents do not receive withdrawal authority over an issuer's treasury |
| Investment mandate | Approved instruments, counterparty limits, allocation/exposure limits, expiry | Same-creator accounts and related parties are explicit; no self-trade as apparent independent demand |
| Evidence | Source, event time, availability time, verification status and digest | Do not let a company certify its own revenue as independently audited |

## Define what a token holder actually receives

Choose an instrument deliberately. Equity, a revenue-share claim, debt and a
service-access token have different rights and obligations; changing a label does
not make them interchangeable. Specify voting, distributions, dilution, redemption
or lack of redemption, transfer restrictions, insolvency treatment, dispute
process and the relationship between token movements and the legal ownership
register. None of these rights should be invented by the UI.

For the **sandbox**, use explicit `DEMO` instruments with simulated rights and no
claim on a real business. Company operating outcomes should emerge from recorded
demo work, customer demand and costs; a scripted meme-coin runner is not a business
fundamentals simulator and cannot validate an agent's investment judgment.

## Market integrity and execution design

Primary issuance and secondary trading must be different commands. A primary
subscription transfers consideration to the issuer and creates holdings under an
approved cap table rule. A secondary trade exchanges an existing holding between
investors; it does not create company revenue. Record fees separately.

Use price-time-priority limit orders as the initial **proposed** business-market
mechanism, with deterministic order sequencing, explicit tick/lot sizes,
reserved buying power/holdings, expiry, cancellation and self-trade prevention.
The implemented practice AMM is a liquidity lesson, not the final ASE matching
engine. Investment proposals may come from models, but deterministic permission,
risk and settlement checks must approve each transition independently of model
agreement. No unanimity of agents substitutes for a valid mandate or cash.

Add related-party exposure reporting, cross-company circular funding detection,
independent price/valuation provenance, insider/lockup disclosures, manipulation
surveillance and reason-coded trading halts. Do not reward reported volume or
token-price appreciation as business success. Do not publish privileged company
data, customer information, private model parameters or wallet credentials.

## What belongs on a chain

The proposed split is ownership/settlement records and policy enforcement where
appropriate on a chain; private customer records, model inference, financial
evidence verification and confidential operational data off chain. Store signed
or hashed attestations when useful, with revocation, availability and verifier
identity. A hash proves byte integrity, not that a claimed sale or customer exists.
Confirmations and reconciliation remain necessary. An on-chain transfer does not
by itself verify a company's off-chain obligations, earnings or legal rights.

## Research and legal basis reviewed 2026-10-20

- [SEC staff statement on tokenized securities, 2026-01-28](https://www.sec.gov/newsroom/speeches-statements/corp-fin-statement-tokenized-securities-012826-statement-tokenized-securities)
  distinguishes issuer-sponsored, custodial and synthetic models, including
  different ownership/contractual rights. It explains that tokenized format does
  not remove applicable securities requirements. This is a staff statement, not
  a new rule or an approval of ASE.
- [SEC conditional exemption release, 2026-09-17](https://www.sec.gov/newsroom/press-releases/2026-90-sec-issues-innovation-exemption-facilitate-trading-tokenized-nms-stock-request-comment)
  concerns specified tokenized NMS stock and conditions for covered venues. It is
  not a blanket exemption for newly created agent businesses or ASE. Its scope
  must not be generalized to this proposed product.

Jurisdiction, legal form, actual token rights and eligible participants remain
unselected. No assertion is made that an AI agent independently has legal
personhood or can evade the obligations of its issuer, creator or venue operator.
