# Commerce routing research — AE-022

An executable **offline, synthetic** router now composes with AE-021 payer authority. Accepted purchases bind activity, method and recurring terms into the existing quote and share its principal/fee budgets. All actors, merchants, accounts, provider eligibility and outcomes are fixtures. No provider is contacted, account created, secret accepted or transaction submitted. Service version/schema remain 0.8.0/5; this CLI is not a model tool or HTTP endpoint.

## Activity rules

| Activity | Model behavior |
| --- | --- |
| Store subscriptions, print-on-demand, white-label supplies, marketing, APIs, agent services, YouTube production, collective services | Require owner activity/payee/purpose permissions, compatible merchant/method and an enabled, unexpired route owned by that operator |
| Instagram username trading | Refuse even if allowlisted; indexed official terms prohibit buying/selling/transferring account aspects including usernames |
| Crypto trading | Require separate trading authority; execution is unimplemented |
| Brokerage, YouTube channel and business account setup | Require an owner-account-setup workflow, which is unimplemented |
| Unknown activity | Refuse as unreviewed |

Labels do not prove what a real contract/resource does. Dishonest fixtures can mislabel merchants or activities. Production needs authenticated registrations and operation-specific tools binding actual actions to these terms. This CLI cannot detect disguised trading or authenticate approval.

Routes are `bank`, `stablecoin_card`, `solana_pay`, `x402`: simulated capabilities, not adapters. Quotes retain `SIMULATED_NETWORK`/`SIMULATED_UNIT`; real SOL/AAI/USDC and mainnet declarations are refused. Principal and fee units are separate synthetic denominations with no value/conversion rights.

The card candidate models virtual credit credentials. Shopify billing rejects prepaid and virtual credit cards, so the `shopify_billing` profile accepts only the modeled bank route. This is narrower than Shopify's accepted-card/eligible-ACH list; it does not say every virtual debit product is rejected. The known Printful profile accepts only the card candidate, rather than invented direct x402/bank/Solana Pay support. Actual card/bank acceptance remains untested.

No method fallback is automatic. Eligibility is rechecked before first submission. A refused submission retains its reservation until cancellation/expiry. Existing attempts reconcile even after route, invoice and mandate expiry/revocation.

## Recurrence, refunds and fulfillment

Store subscriptions must declare recurrence. An owner fixture approves subscription ID, exact merchant/activity/method, principal/fee ceilings per cycle, first due tick, period and maximum cycles. Each cycle has a half-open due window and stays bound after cancellation/failure: changing invoice/purchase IDs cannot charge it again. Retrying a failed cycle needs a future explicit policy rather than silent rebinding.

All cycles and aliases share lifetime budgets; there are no monthly resets, deposits, conversions or assumed income. Refunds reduce net settled principal but **do not replenish** allowance; fees are not refunded. Revocation cancels unsent authorizations and blocks new spending while retaining in-flight uncertainty. It does not cancel a real subscription or revoke real card/wallet permissions.

Settlement/refund evidence shares one unique receipt namespace. Partial/full refunds cannot exceed settled principal; duplicate observations reconcile once. Gross settled principal, refunds, net principal and fee consumption are separate. These are allocations, not business profit or revenue.

Print-on-demand/white-label purchases can record one supplier order after settlement and before any refund. Duplicate messages cannot create another order or reuse its supplier ID for another purchase. A later refund does not undo an already recorded order. `FULFILL` records fixture evidence; it never places a real order. Shipping, returns, disputes and customer receipts remain unimplemented.

The library serializes actions/snapshots with a process-local lock. An eight-request thread regression verifies one shared budget across two aliases. This is not a cross-process/database guarantee. Reports replay after exit; no durable queue/provider recovery worker exists.

## Run and verify

From this project directory with its existing supported Python setup:

```sh
python -m zoora_community.commerce run --input examples/commerce-input.json --out new-commerce-report.json
python -m zoora_community.commerce replay --input new-commerce-report.json --sha256 63987b20f2c135626eadb321097d5dc35cb4ce4ae7994c6163453f46e2145bfa
python -bb -X dev -W error scripts/commerce_evidence.py
```

The 38-action reference retains every decision and intermediate state. Final allocations: 130 synthetic principal settled, 25 refunded, 105 net principal and eight separately denominated fee units spent. Twenty principal and seven fee units remain unused; none remain reserved. These scripted outcomes do not measure autonomous behavior or financial returns.

Replay regenerates the entire report and requires a separately trusted pin. Hash domain: `ZOORA_AE022_COMMERCE_ROUTER_V1` plus NUL, then canonical UTF-8 JSON (sorted keys, no whitespace/NaN). The full request also binds through that domain into AE-021's resource hash; the original resource digest remains inside the request. Hashes do not authenticate operators or remote resources.

Limits: 256 actions, 32 admitted purchases, integers at most 10^12, 2 MiB input, 8 MiB published report, 64 merchants, four routes, 32 subscriptions. Entire inputs validate before execution. Extra fields, integer booleans and backward time fail. Reports require new paths and trusted parent directories. Unix mode is 0600; Windows ACL/durability guarantees are not implied.

The actual normal/optimized CLI acceptance covers reference bytes, external pins, overwrite refusal, secret-shaped fields and rehashed tampering. A separate auditor recomputes 39 state views, budgets, refunds, identity uniqueness and request/authority hash binding without importing either payment model. It verifies consistency, not chain/business facts.

## Providers and remaining work

| Candidate | Documented fit | Unverified for this project |
| --- | --- | --- |
| Bridge + Stripe | Stablecoin cards, noncustodial Solana USDC funding | Program/business approval, agent attribution, real bounded delegation, acceptance |
| Crossmint | Agent wallets, saved-card credentials, checkout tools | Owner-controlled integration; saved cards are distinct from Phantom-USDC funding |
| MoonPay Commerce/Solana Pay | Shopify crypto checkout and wallet settlement | KYB, store eligibility, checkout/refund/order integration |
| Coinbase x402 | Compatible paid machine/API requests | Constrained signer, conforming SDK/verifier, provider acceptance |

Next: authenticated mandates, constrained signing outside model prompts, durable intents/idempotency and verified provider evidence. Card authorization/capture/reversal, chargebacks, customer receipts, recurring cancellation and supplier dispatch need their own adapters/lifecycles. AE-022 adds no messaging, collective governance, unrestricted purchases, guaranteed income, AAI economics, investment distributions or native Zoora changes. Naming a collective does not grant another operator's budget.

## Official sources reviewed October 15, 2026

- [Bridge funding](https://apidocs.bridge.xyz/platform/cards/overview/funding-strategies) and [commercial issuing](https://apidocs.bridge.xyz/platform/cards/overview/commercial-issuing).
- [Crossmint cards](https://docs.crossmint.com/agents/cards/overview) and [wallets](https://docs.crossmint.com/agents/wallets/overview).
- [MoonPay Shopify plugin](https://docs.hel.io/docs/solana-pay-shopify-plugin).
- [Coinbase CDP Facilitator](https://docs.cdp.coinbase.com/x402/seller/facilitator).
- [Shopify billing](https://help.shopify.com/en/manual/your-account/manage-billing/paying-your-bills/making-payments/payment-methods-for-bills).
- [Printful billing](https://help.printful.com/hc/en-us/articles/50264607936785-How-does-the-Printful-billing-system-work).
- [Instagram terms](https://www.facebook.com/help/581066165581870): indexed official text supports the username rule; direct retrieval was login/rate limited. No authenticated session was used.
- [YouTube permissions](https://support.google.com/youtube/answer/9367690?hl=en): account authority differs from spending rights.

These sources establish candidate capabilities, not our eligibility, universal acceptance or an independent security audit. [Authority model](SPENDING_AUTHORITY.md) · [Validation](VALIDATION_AE022.md) · [Architecture](../../docs/AGENT_PAYMENT_SYSTEM.md).
