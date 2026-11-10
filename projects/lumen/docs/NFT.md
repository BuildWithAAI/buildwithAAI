# Zoora NFT collection

Owner accepted live-money risk without a test stage on 2026-11-09.

One-of-one pieces on Solana mainnet. There is no devnet stage. `MINT_ENABLED` is on when `MINT_SIGNER_URL` is an `https://` address, and off when that address is missing or `MINT_ENABLED=false`. The keeper mint kill switch stops it. Zoora and the model never see a private key. If a private key is placed in this app's environment, minting stays closed.

## Standard

Metaplex Core. A Core asset is a single account, which fits a one-of-one, and it can store a royalty plugin paid to a creator. Source: [Metaplex Core overview](https://developers.metaplex.com/core) and [Royalties](https://developers.metaplex.com/core/royalties), read 2026-11-10. Token Metadata remains the older standard and needs a mint plus a metadata account. Core is the one this app will use.

The collection or treasury wallet belongs to the owner. Sales of minted pieces are paid to that wallet. This app does not custody it.

## Metadata and cost

| Store | What it holds | Cost to know |
| --- | --- | --- |
| Arweave | The image and JSON, paid once | A few cents to a few dollars per file, depending on size. The Irys or ArDrive price at mint time is the real number. |
| IPFS | The image and JSON, pinned by a service | Pinning is a monthly fee. An unpinned file can disappear. |
| On the asset | A URI pointing at the JSON | Solana rent for a Core asset is a small SOL amount, plus the transaction fee. Check the current rent before minting. |

Royalties are enforced only where the buyer and the marketplace honor the plugin. A private transfer can skip them. The plugin still names the owner's wallet as the payee.

## Signer

Minting is a POST to the owner's signer process. The body is `{ "instruction": "mint_one", "network": "mainnet", "name", "uri" }`. The signer holds the key, signs that instruction only, and enforces a per-day cap. It must authenticate the caller: the request includes `x-lumen-signature`, an HMAC-SHA256 of the body using `LUMEN_MINT_SIGNER_SECRET`, and a missing signature is refused. Network stays `mainnet` unless the owner sets `LUMEN_MINT_NETWORK=devnet` for their own testing. This repository does not contain that key and does not log it.

## Legal and tax flags

This is not legal advice. Before a public mint, the owner should ask a lawyer and a tax preparer about:

- Whether a one-of-one sale is ordinary income, and which forms report it.
- Sales tax or VAT where the buyer lives.
- Securities treatment if a piece is sold as an investment rather than as art.
- The right of publicity and copyright. The same IP rules as the shop apply: no copied work, no trademark costume, no real person's likeness.
- Wallet security: a hardware wallet or a signer on a separate machine, not a key in the app, the model, or a chat log.

## What is implemented

`src/money/mint.ts` decides whether minting is open and can ask the signer. It does not submit a Solana transaction itself. The collection, the provenance URI, and the daily cap inside the signer are still to be built. The public books stay the record of confirmed money.
