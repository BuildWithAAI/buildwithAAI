# SOL sales

Buyers pay SOL to the owner's public wallet, `LUMEN_SOL_RECEIVE_ADDRESS`. That value is a public key. A private key does not belong in this app, its environment, or its logs.

Each order gets its own reference key. The price is the listing's USD cents, converted at a live SOL/USD quote from `LUMEN_SOL_PRICE_URL`. The quote expires in ten minutes. There is no backup rate in the code. If the price source does not answer, no quote is made.

The buyer pays from their own wallet. The server then reads the transaction from `LUMEN_SOL_RPC_URL` at `finalized` commitment. The RPC URL must be `https`. The price request and the RPC request each stop after 6 seconds. A SOL/USD quote outside $1–$100,000 is refused. It accepts the payment only when all of these are true:

- the recipient is the quoted public wallet
- the wallet's balance rose by at least the quoted lamports
- the order's reference key is in the transaction
- the signature has not been used for another order
- the payment was sent inside the quote window

A payment sent inside the window is fulfilled even if the chain read finishes after the quote expired. An overpayment is fulfilled for the quoted amount and the extra lamports are flagged for refund. A second signature on an order that is already paid is recorded and flagged for refund, and it does not deliver again.

The file or the NFT record is delivered only after that check. The ledger row stores the signature. An NFT sale uses the same quote and the same check. The mint key still stays in the separate signer.

Wrong recipient, underpayment, a reused signature, a payment sent after the quote expired, and a transaction that is not finalized are refused and do not deliver.
