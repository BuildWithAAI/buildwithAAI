# SOL sales

Buyers pay SOL to the owner's public wallet, `LUMEN_SOL_RECEIVE_ADDRESS`. That value is a public key. A private key does not belong in this app, its environment, or its logs.

Each order gets its own reference key. The price is the listing's USD cents, converted at a live SOL/USD quote from `LUMEN_SOL_PRICE_URL`. The quote expires in ten minutes. There is no backup rate in the code. If the price source does not answer, no quote is made.

The buyer pays from their own wallet. The server then reads the transaction from `LUMEN_SOL_RPC_URL` at `finalized` commitment. It accepts the payment only when all of these are true:

- the recipient is the quoted public wallet
- the wallet's balance rose by at least the quoted lamports
- the order's reference key is in the transaction
- the signature has not been used for another order
- the quote has not expired

The file or the NFT record is delivered only after that check. The ledger row stores the signature. An NFT sale uses the same quote and the same check. The mint key still stays in the separate signer.

Wrong recipient, underpayment, a reused signature, an expired quote, and a transaction that is not finalized are refused and do not deliver.
