# Payer authority research — AE-021

The new offline CLI models an agent making routine purchase decisions within one declared operator's mandate. It fills the payer-side authorization gap alongside existing simulated agreements/receipts and the live local task queue. **All controllers, actors, invoices, attempted payments and settlement outcomes in this model are SYNTHETIC fixtures.** No money moves, signer exists, real wallet balance is maintained or live API authority is granted. The community service remains version 0.8.0 / schema 5.

## What is modeled

A policy lists one operator, its allowed agent aliases, approved payees/purposes, a per-payment principal ceiling, a cumulative principal budget, a separate cumulative fee budget and an authorization interval. Budgets are lifetime limits for this one book, not daily-reset limits, deposits, wallet balances, escrow or funds locked on a chain. All listed aliases share these budgets.

A quote binds stable purchase ID, merchant invoice ID, payer, payee, synthetic network/asset, purpose, resource SHA-256, exact amount, maximum transaction fee and invoice expiry. The resource digest represents the requested operation and terms; this model does not fetch or verify the resource. Exact retries reconcile to the original record. Changing a bound field conflicts; the same merchant/invoice cannot be assigned to another purchase. Trusted job runners must preserve purchase identities. Different invented purchase and invoice IDs can conceal the same underlying economic action; this model cannot infer semantic duplicates or honest counterparties.

| Action/state | Budget behavior |
| --- | --- |
| AUTHORIZE within a mandate | Reserve principal and maximum fee across aliases |
| SUBMIT | Produce one deterministic synthetic attempt ID and retain both reservations |
| Exact retry | Reuse the original purchase/attempt; never authorize another transfer |
| UNKNOWN outcome | Keep principal and fee ceiling reserved indefinitely pending evidence |
| CANCEL before submission | Release reservations, retain the used invoice identity |
| Invoice/mandate expiry or revocation | Cancel unsent authorizations; retain in-flight reservations |
| SETTLED fixture | Consume principal and actual fee; release unused fee allowance |
| FAILED fixture | Consume actual fee, release principal and unused fee allowance |
| Late resolution after revocation/expiry | Record the already-submitted outcome without granting new spending rights |

The interval ends are exclusive. A controller fixture can revoke but cannot undo a submitted payment. A cancellation is not a refund. A receipt is globally unique within the book; replaying it at a later observation tick does not debit again. Wrong actor/binding, reused receipts and an actual fee above the authorized ceiling are refused. Such refused fixtures leave the payment unresolved; the model cannot account for arbitrary externally observed transfers outside its simulated authorization. A future observation system must preserve real facts even when they violate policy and flag the discrepancy.

Actor/controller strings in these files are not authenticated identities. Deterministic attempt IDs, quote fingerprints and report pins are not secret capabilities or wallet signatures. There is no real signature verification, instruction parser, finality check, provider integration, x402/Solana Pay conformance, wallet custody, fund freezing or real reversal.

## Run and replay

From this directory, with the existing supported Python setup:

```sh
python -m zoora_community.spending run --input examples/spending-input.json --out new-spending-report.json
python -m zoora_community.spending replay --input new-spending-report.json --sha256 2e554c666231916e3f920c8358f9354aa6add9f5c4b0ec51bd1fb0b4f8c210a9
```

The committed example has 27 scripted actions. Its final accounting is 150 principal units spent, nine fee units spent, zero remaining reservations and one remaining fee unit. Principal and fee units are different synthetic denominations; do not sum them into a claimed asset balance or monetary return. Neither has value or conversion rights to AAI, SOL, USDC or Zoora currency.

The reference contains the entire input, action decisions, all intermediate states and final state, rather than only an aggregate success count. An uncertain payment remains reserved after revocation and authority expiry; a later fixture settles it. Failed transactions charge their fee. The example includes invoice duplication, changed destination, receipt conflicts and a cancellation refusal. These scripted outcomes are not measured autonomous-agent behavior or performance evidence.

The CLI prints the report fingerprint and capability flags. Outputs must be new paths; existing files/symlinks are never overwritten. Input/output parents must be trusted. Unix output mode is 0600; Windows ACL/durability review is not implied. An I/O failure during writing may leave a partial new output; do not treat that file as a verified report.

`replay` requires an independently trusted fingerprint. It regenerates the complete report and compares every field, including synthetic/capability flags. A modified scenario with its own new valid fingerprint is another experiment, not proof of original authority. Hash domain: `ZOORA_AE021_PAYER_AUTHORITY_V1` + NUL, followed by UTF-8 JSON with sorted keys, no whitespace and no NaN. This domain covers binding and attempt objects as well as report objects; their object shapes are distinct and fixed in version 0.1.0. A trusted external report pin protects the complete experiment.

## Bounds and validation

At most 256 actions, 32 retained purchases and 64 entries in each policy list; monetary/time integers are 0–10^12, with strictly positive principal. Booleans, floats, unexpected fields and backward time are refused. Input is bounded to 2 MiB and reports to 8 MiB. Whole-run inputs are validated before execution. These are research resource caps, not production throughput or scalability targets.

`tests/test_spending.py` covers authority boundaries, shared budgets, retries, independent fee accounting, invoice/receipt deduplication, late resolution, revocation, bounds, malformed inputs, external pins and actual normal/optimized subprocesses. `scripts/spending_evidence.py` runs 15 actual CLI/replay checks and a separate accounting audit that recomputes totals from all 28 retained state views without calling the model's accounting methods. The separate audit checks conservation of budget allocations; it does not validate a real chain or independent business revenue.

The model is not exposed through HTTP or registered as a local model tool. Reports can be replayed after process exit, but no durable live execution/resume worker is implemented. Existing earned-trust and provider-capacity research remains separate. For the intended system and current legal/rail research, see [the payment architecture](../../docs/AGENT_PAYMENT_SYSTEM.md).
