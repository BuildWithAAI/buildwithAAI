# Trading results, AAI purchases and supply burning

Founder direction recorded October 14, 2026: develop the trading/testing system so results can be reported to the community and, if later evidence/resources permit, AAI can be purchased and acquired tokens burned.

This records a future objective. It does not establish a profitable strategy, verified AAI mint, funded account, allocation rate, controller, approved execution policy or transaction. The current implementation is [BT-005 offline paper testing](../projects/sfp-paper-lab/README.md).

## Accounting chain to preserve

Record attributable funding/creator-fee receipts → apply a separately selected allocation and risk mandate → run an accepted strategy → reconcile realized net results and all costs/loss recovery → determine available cash → review a concrete purchase budget/action → record purchase quantities/costs → separately authorize a burn → verify the successful burn and resulting supply/account changes.

Deposits and initial capital are not trading profit. Unrealized marks are not realized income or guaranteed exit cash. Trading revenue, net profit, an earmarked purchase/burn budget, a completed purchase and a confirmed burn are different records. A proposed budget must never be counted as reduced token supply.

BT-005 can model an explicitly hypothetical rate. Its default is UNSELECTED/zero. Simulated budgets use cumulative realized net after losses/costs and free cash above initial capital, and are withheld for open positions or coverage gaps. The earlier proposed access splits (40/40/20) and platform-fee reserve splits are not automatically selected or applied to trading results.

## Mechanics and reporting

Solana's [official burn documentation](https://solana.com/docs/tokens/basics/burn-tokens) describes a token-account balance and mint-supply decrease. A future implementation must verify the actual mint, token program/decimals, owner/delegate permissions and transaction success. Sending tokens to an arbitrary address is not interchangeable with a verified token-program burn. Native Zoora currency remains separate.

Supply reduction does not guarantee a price floor, increased market price, demand or exit liquidity. Community reporting should state actual quantities, costs, transactions, supply evidence and unresolved items. Avoid claiming chart support or a guaranteed economic outcome.

The paper package reports zero transferred funds, purchased tokens and burned tokens, with the mint/transaction unset. It contains no order, wallet-signing or burn-execution command. Existing [security](../SECURITY.md) and [funding](../docs/FUNDING.md) boundaries remain.

## What must be concrete before funded action

Verify the asset/network/mint and controller; establish attributable funds and an approved budget/maximum cost; settle the allocation and risk/existing-position policy; validate unseen strategy data and operational controls; specify a reviewable recipient/route/amount/fees; obtain the separate explicit transaction authorization; reconcile successful actions rather than treating broadcasts or budgets as settlement.

This addition starts testable software and community evidence. It starts no fund transfers, burns, liquidity provision, customer-fund custody, paid provider or production trading service.
