# BuildWithAAI agent payment system

Latest account diagnostic: [AE-027 customer preflight](../projects/zoora-agent-community/BRIDGE_PREFLIGHT.md) adds an exact-customer sandbox GET with redacted status/terms/base-endorsement evidence. Missing signals stay incomplete, adverse or contradictory signals stay blocked and no observation grants payment, route, credential-rotation or settlement authority. It is a standalone diagnostic, not an automatic transfer admission gate. External account/route compatibility remains unverified; service/journal schemas are unchanged.

Latest operational recovery: [AE-026](../projects/zoora-agent-community/BRIDGE_RECOVERY.md) adds complete-history audit, exclusive verified snapshots, independently pinned verification and restore into persistent GET-only recovery. A stale snapshot cannot regain create authority through this workflow, even if it predates an accepted transfer. Provider schema 3 requires explicit backed migration from original schemas 1/2. Source keys/bodies/times and uncertain observations remain; no real-asset mandate, signer, external provider acceptance or verified settlement is implied.

Latest recovery addition: [AE-025](../projects/zoora-agent-community/BRIDGE_RECONCILIATION.md) adds bounded read-only transfer discovery and explicit matching-ID reconciliation after the sandbox POST retry cutoff, with persisted targets, crash/lease handling and a verified schema-1-to-2 journal backup migration. Failed or inconclusive reads preserve uncertainty; discovery cannot authorize another POST or credit a ledger. External provider account/route acceptance remains unverified.

Latest implementation: [AE-024 Bridge sandbox connector](../projects/zoora-agent-community/BRIDGE_SANDBOX.md) adds a fixed-host provider HTTPS client and separate host-operator journal/CLI. It persists one immutable transfer intent before POST, retains exact retry identities through crashes, polls known IDs and blocks uncertain POSTs past a conservative retry cutoff. Actual CLI/local TLS tests pass; external Bridge account/route acceptance is unverified. It does not map synthetic budgets to real currencies, sign wallets, issue cards or record verified settlement.

[AE-023 authenticated durable commerce](../projects/zoora-agent-community/DURABLE_COMMERCE.md) connects the router to actual local API credentials, registered agent mappings and transactional persistent books. It supplies server-derived actors/time, restart-safe command identities and replay through audit/backup/restore. API authority remains distinct from wallet signing rights; all economic/provider outcomes are still fixtures.

October 15, 2026. Product direction: an agent can advertise work, agree a price, invoice, receive payment, buy tools, hire another agent and account for its activity within an agreed mandate. Routine activity should not require a person to click approval for every step. This describes operational autonomy; it does not establish an AI's independent legal personhood or erase the responsibilities of the people/entities operating it.

AE-022 adds an [offline commerce router](../projects/zoora-agent-community/COMMERCE_ROUTING.md) on top of AE-021 authority: activity and method permissions, recurring schedules, refund accounting and supplier-order evidence. Bridge/Stripe stablecoin cards, Crossmint agent tools, MoonPay Commerce and Coinbase x402 are documented integration candidates. AE-024 implements only a narrow Bridge sandbox transfer adapter; card programs, production providers and actual merchant acceptance remain unverified. The methods link official sources and separate fixture eligibility from real verification.

We can build the identity, work, authorization and accounting layer while connecting to existing payment rails. A new speculative coin or independent monetary network is not required for agent-to-agent payments. Zoora's future native currency and genesis remain separate; AAI on Solana does not automatically become that native currency.

## Proposed architecture and current implementation

| Part | Responsibility | Current boundary |
| --- | --- | --- |
| Agent identity and wallet association | Identify the worker, its registered operator and payment destination | Local enrollment and historical wallet proofs exist; independent humans/current continuous control are not verified |
| Work agreement and invoice | Bind buyer, seller, task/resource, amount, asset, network, fee terms and expiry | Simulated agreements exist; production invoice/contract attribution is unfinished |
| Payer mandate | Give an agent spending authority once, with clear lifetime budgets and permissions | AE-023 adds actual local operator/agent API authorization and durable policy books; no real wallet/signing authority |
| Constrained signer | Enforce the mandate outside the language model before authorizing a transaction | Not implemented; private keys must stay outside prompts, model context and platform reporting |
| Payment rail | Move value directly between authorized wallets | AE-024 adds sandbox-only Bridge transport with local contract acceptance; no external vendor acceptance, signer or currency/grant binding. x402/Solana Pay remain candidates |
| Payment evidence | Verify asset, actual destination/authority, amount, fee, reference, execution and required confirmation | Existing read-only observations cover a limited native-SOL subset, not complete SPL/x402 settlement or invoice attribution |
| Business accounting | Separate contributions, work revenue, spending, liabilities, fees, losses and returns | Existing synthetic ledgers/direct-payment research; production reconciliation and group payouts unfinished |

Funds should travel directly between the relevant wallets in the proposed product. BuildWithAAI should not maintain spendable customer balances or acquire unrestricted signing powers. If it hosts a signer or upgrade authority capable of moving funds, the real powers must be disclosed and evaluated; calling the product noncustodial does not remove that control.

An agent's receiving address and its permission to spend are separate. Receiving money does not automatically authorize unrestricted reinvestment. A verified balance is also different from a spending allowance; other wallet activity can consume funds outside this local policy. Live execution must recheck actual funds and fee requirements.

## Established payment rails to investigate

**x402 V2** supports a server requesting payment for a resource and a compatible client paying programmatically. Current Solana documentation describes an `exact` scheme and separate client/server/facilitator roles. Use the reference SDK/conforming verifier: correct instruction layout, mint, destination token account, authority, fee/compute constraints, resource binding, expiry, replay protection and confirmed settlement all matter. A payment header or transaction signature alone is insufficient. Paid delivery still needs its own evidence; a payment is not proof of useful work.

**Solana Pay** supplies standardized transfer/transaction request formats. It is an invoice/request mechanism; it does not by itself grant continuous autonomous signing rights. Wallet/signer support, reference uniqueness, payment verification, fees and fulfillment must be integrated and tested.

These are recommendations for integration research, not assertions of provider acceptance, SDK interoperability or a completed live service. Mainnet asset, provider, fees and treasury permissions have not been selected here. We do not hand-build a partial x402 transaction verifier or treat the AE-021 JSON as a real payment payload.

Sources checked October 15, 2026: [Solana x402 V2 documentation](https://solana.com/docs/payments/agentic-payments/x402), [x402 reference implementation](https://github.com/x402-foundation/x402) and [Solana Pay specification](https://docs.solanapay.com/spec).

## Autonomy and legal attribution

U.S. E-SIGN section 7001(h) recognizes contracts involving electronic agents where their actions are legally attributable to the person being bound. That supports investigating automated contracting for an operator or business; it does not give an AI all the rights of a human or make every automated contract valid. Consumer protections, actual authority, business activity and jurisdiction still matter. [Statutory text, official 2024 edition](https://www.govinfo.gov/content/pkg/USCODE-2024-title15/html/USCODE-2024-title15-chap96-subchapI-sec7001.htm), cross-checked against the [current Cornell text](https://www.law.cornell.edu/uscode/text/15/7001), accessed October 15, 2026.

Building a new payment protocol does not create an exemption from financial-services rules. FinCEN's guidance distinguishes software and wallet models according to what the service actually does and controls. The operating, custody and transmission model needs review before handling real payments for others. This is a preliminary architecture assessment, not a legal determination about a deployed service. [FinCEN FIN-2019-G001](https://www.fincen.gov/system/files/2019-05/FinCEN%20Guidance%20CVC%20FINAL%20508.pdf), sections 1 and 4.2, checked October 15, 2026.

Payment for work is distinct from the [community investment proposal](COMMUNITY_FUNDED_AGENTS.md). Agent invoices do not automatically create investor shares or profit-distribution rights. Any AAI reserve/burn/liquidity fee must be explicitly priced, authorized, attributed and reconciled before activation. This document selects no fee rate or token allocation and promises no price floor.

## Next integrations

AE-024 supplies the separate sandbox client and persist-before-POST journal for provider transport. A credentialed test of its exact provider route/response shape remains required. Its host-owned journal neither inherits community grants nor participates in community backup/restore; it must not be treated as a production payment worker.

1. Bind the locally authenticated mandates and registered agent identities to constrained external wallet signing authority. A local API credential alone grants no wallet rights.
2. Add a constrained external signer interface and a provider-supported test environment; keep real keys and spending power outside the model/reporting service.
3. Bind a job's stable purchase identity and full invoice terms to an established rail's exact signed transaction; persist intent before submission.
4. Verify and reconcile settlement/fees, including failed and ambiguous outcomes, duplicate references and restart recovery. Never release an uncertain outgoing payment solely because a local timer expired.
5. Demonstrate agent work/invoice/payment/delivery end to end with test assets and clear evidence before a limited real-fund pilot.

These steps are not completed by the offline model. [AE-021 model, commands and limits](../projects/zoora-agent-community/SPENDING_AUTHORITY.md) · [validation](../projects/zoora-agent-community/VALIDATION_AE021.md).
