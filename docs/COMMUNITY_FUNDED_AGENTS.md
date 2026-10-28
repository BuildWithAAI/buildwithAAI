# Community-funded agents — proposal for simulation

Recorded October 15, 2026 from the founder's idea: create an agent that receives community funding, builds within an agreed purpose and shares available profits according to each contributor's amount and eligible funding time. This is **PROPOSED**. No wallet, treasury, offering, deposit address, payout entitlement or financial executor has been created.

The product remains an agent workforce platform. Funding a community agent does not require launching a speculative coin or creating a token launchpad.

## Funding and authority

| Model | Meaning |
| --- | --- |
| Gift/donation mode | Support without a promised financial return or ownership share; do not later treat a gift as an investment without a separate agreement |
| Profit-sharing mode | Contributors expect financial participation; record it as an investment proposal requiring review of the concrete structure and applicable jurisdictions |
| Agent purpose | A published mandate defines what the agent may build, its budget and allowed actions; autonomy operates within that mandate |
| Contributor rights | Purpose, voting, withdrawal, loss allocation, fees, profit definition and changes must be agreed before accepting contributions |
| Platform economics | Any AAI reserve, burn or liquidity allocation must be separately specified and visible in the accounting; no allocation or fee rate is selected here |

In the U.S., an arrangement pooling contributions with an expectation of profits from others' work can raise investment-contract issues. Calling the payments donations or assigning actions to an AI does not resolve the legal classification. This is a preliminary application of current sources, not a conclusion that this specific proposed product is lawful or unlawful. Review the actual offering, entity, custody, investor locations and other applicable requirements with qualified counsel before real contributions or public solicitation.

Current sources: [SEC March 2026 interpretation](https://www.sec.gov/files/rules/interp/2026/33-11412.pdf), particularly the investment-contract discussion, and [September 28, 2026 SEC FAQs](https://www.sec.gov/about/divisions-offices/division-corporation-finance/faqs-crypto-assets). The withdrawn 2019 framework is not the current basis for this proposal. Sources checked October 15, 2026.

## Wallet design to investigate

Phantom supports agent wallet operations and documents spending-limit policies. Its terms still describe the person/entity authorizing the agent as the wallet owner and controller, responsible for its actions, and prohibit sharing private keys or seed phrases with the agent. An agent connection therefore does not establish that nobody else has control.

Preferred research direction: a dedicated contract-controlled treasury, limited agent execution authority and explicit contributor exit/payout rules. Solana program-derived addresses have no private key and can be authorized through their program. The program, delegate permissions and any upgrade/emergency authorities still determine actual control. A PDA alone does not guarantee decentralization or eliminate software/host risk. Phantom would be a participant interface, not proof that the treasury is controlled solely by an AI.

Before selecting a design, document all actors who can spend, change rules, upgrade code, rotate agent credentials, pause execution or recover access. Include the infrastructure operator's ability to replace or influence the agent. A community recovery mechanism and an immutable program have different tradeoffs; neither is selected here. Never describe hidden admin control as agent-only ownership.

Sources: [Phantom Agent Kit](https://github.com/phantom/phantom-agent-kit), [Phantom terms](https://phantom.com/terms), [Phantom spending limits](https://docs.phantom.com/spending-limits) and [Solana PDA documentation](https://solana.com/docs/core/pda), checked October 15, 2026. No Phantom integration, wallet connection or blockchain write was performed for this proposal.

## Amount and time accounting to simulate

A candidate rule for one defined payout period is:

`contributor weight = integral of eligible contributed balance over time during that period`

`candidate payout = available distributable profit × contributor weight / total eligible weight`

For illustration, 100 synthetic units eligible for 20 days and 200 eligible for 10 days each produce 2,000 unit-days. That equality describes an allocation weight, not a promised yield or principal guarantee.

This formula is an experiment, not a contract specification. It needs contribution/withdrawal checkpoints and rules for when profits were actually earned. A late deposit must not purchase profits already accrued before entry. Compare time-weighted period allocation with share issuance/redemption at reconciled net asset value, using event checkpoints and separate treatment of unpriced work in progress. Do not combine unlike assets without an explicit valuation method and timestamp.

The ledger must distinguish external contributions from earned revenue, return of capital, realized gains/losses, unrealized valuation changes, liabilities, operating costs, reserves, platform fees and distributions. **New contributions are never profit and cannot fund a purported profit payout.** Distributable amounts must reconcile to earned net results, prior loss recovery rules and available assets after liabilities/reserves; a cash balance is not proof of profit. A loss period may have no distribution, and contributed capital can be lost.

Use integer base units, explicit time units, deterministic rounding and a recorded remainder. Record each distribution's period, cutoff, formula version, source receipts/costs, eligible ownership snapshot and per-wallet claim. Test duplicate deposits, duplicate claims, withdrawal/redeposit timing, wallet changes, failed transfers, stale valuations, fees, empty pools and total loss. A record identifying a contributor wallet still does not establish independent people or legal eligibility.

## Development queue

These are proposed, unassigned tasks. No unattended agent has been started and no production parameters are approved.

| ID | Deliverable | Acceptance boundary |
| --- | --- | --- |
| CFA-001 | Deterministic funding/expense/loss/distribution simulation | Synthetic units only; conservation and no deposit-as-profit; checkpoint and late-entry examples |
| CFA-002 | Authority and treasury threat model | Every spend, upgrade, delegation, pause, exit and recovery controller listed; no agent-only claim contradicted by admin powers |
| CFA-003 | Contributor agreement and jurisdiction questions | Gift and investment structures distinguished; actual qualified review before solicitation/funds |
| CFA-004 | Contributor accounting viewer | Reconciled allocation, fees, losses and missing evidence displayed; no fabricated returns |

The current AE-020 task allowance is only a local resource policy across agents registered under the same operator. It does not authorize fundraising, custody, investment decisions or profit distribution. Existing simulator trust/membership experiments remain research until separately integrated.
