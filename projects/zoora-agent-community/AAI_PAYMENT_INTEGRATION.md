# AAI membership payment connection

October 17, 2026. This is the first real-chain payment verification layer for the proposed membership pass. It makes **read-only** Mainnet RPC calls. It does not create a quote, collect funds, mint an NFT, activate access, burn AAI, add liquidity, or send a refund.

## What the verifier checks

`zoora_community.live_connections solana-payment` accepts a submitted transaction signature and exact quote facts, then queries the fixed Solana Mainnet endpoint. It checks the Mainnet genesis hash, observes a finalized slot, and requests the transaction at `finalized` commitment using `jsonParsed` with transaction-version support set to 1. The parser requires:

- The requested signature is the transaction's first signature, the transaction succeeded, and the payer appears as a signer and the transfer authority.
- The transaction's block time falls inside the supplied quote window, which can be at most 24 hours.
- One classic SPL Token transfer has the exact mint, raw-unit amount and decimals. The sender token account is owned by the payer, the destination token account is owned by the exact treasury recipient, and their before/after balances show exactly the quoted movement.
- One exact `ZOORA-MEMBER-<random>` memo appears immediately before the transfer. The server must generate a fresh unpredictable memo per quote and store it with that quote.

The verifier rejects failed or ambiguous transactions, missing token-balance evidence, changed quote values, extra AAI token-account movements, Token-2022, and transfer-fee instructions. It does not infer a mint from a token name or ticker. The current AAI mint and payment treasury are **not recorded as verified project configuration**, so the command requires both as explicit public-address inputs and must not be used with guessed values.

The report's `PAYMENT_VERIFIED` state means only that one RPC provider returned transaction evidence matching the exact supplied quote. Solana documents `getTransaction` as a provider RPC result that may be `null`; its result is not a validator signature. Payment production code must also validate the quote against a durable server order and enforce unique constraints for both the memo and transaction signature before it can fulfill anything. A caller cannot safely reuse this diagnostic report as an access grant.

## Command shape

Run from this project directory only after the project has published the exact quote and verified AAI/treasury addresses through an authoritative project source:

```sh
python -m zoora_community.live_connections solana-payment \
  --signature <SUBMITTED_TRANSACTION_SIGNATURE> \
  --payer <PAYER_PUBLIC_WALLET> \
  --recipient <APPROVED_TREASURY_OWNER_WALLET> \
  --mint <OFFICIAL_AAI_MINT> \
  --amount-raw <QUOTED_INTEGER_BASE_UNITS> \
  --decimals <VERIFIED_MINT_DECIMALS> \
  --memo <UNIQUE_ZOORA-MEMBER-QUOTE_MEMO> \
  --quote-created-at <UNIX_SECONDS> \
  --quote-expires-at <UNIX_SECONDS> \
  --out <NEW_PRIVATE_REPORT_FILE>
```

The output file is exclusive and private. Exit `0` means the payment evidence matched; exit `2` means blocked or unverified; exit `1` means local input/output failure. No report state grants wallet authority, agent permissions or NFT access. A report hash identifies response bytes but does not authenticate the RPC provider. The implementation makes no automatic retries and no writes.

## Membership and refund sequence still to build

The production application needs a durable state machine around this read:

1. Generate and store a one-use order with the official mint, treasury, token program, decimals, raw amount, payer binding, expiry, random memo, membership terms and refund terms.
2. Present the exact AAI transfer through a reviewed Phantom/Solana Pay flow. Require the payer to approve the transaction in their wallet; no application server or agent holds the payer's signing key.
3. Submit the transaction signature to the verifier. On an outage or incomplete response, keep the order pending and do not manufacture a receipt. On success, atomically claim the signature and memo for that order using unique database constraints.
4. Record payment before pass issuance. Issue only the approved collection asset to the payer's wallet, then independently read back the exact mint/collection ownership at the chosen commitment. If issuance fails, keep a fulfillment obligation and retry only the same approved issuance request; never charge again automatically.
5. Grant access only after server-side verification of the exact pass and its active status. Recheck status at enrollment, job admission and privileged tool dispatch. A payment receipt alone is not membership.
6. Process refunds as separate, authorized outflows with their own idempotent order, wallet, amount, fee and chain evidence. No cancellation flag reverses an on-chain payment.

This workflow is not yet connected to the community database, Phantom, a pass collection or an access middleware. The pass standard, official mint and treasury, price, hosting origin, account recovery behavior, refund window and collection authority remain decisions to finalize. The current standalone CLI is an operator diagnostic, not a production purchase service.

## AAI burn and LP treatment

Recommended commercial structure: one clearly priced AAI membership purchase, with any pass issuance or operating cost shown before approval. After collection, a separately approved accounting policy may allocate a portion of eligible membership revenue to an AAI burn and a portion to liquidity. No allocation percentages or amounts are active.

The policy must define, in exact base units and deterministic rounding, the membership charge, eligible net revenue, refund/operating reserve, burn amount, treasury amount and LP budget. A burn counts only after an authorized SPL Token `burn`/`burnChecked` transaction succeeds and the supply change is reconciled. Sending AAI to an inaccessible address is not reported as a burn.

Liquidity is a separate investment action. An AAI allocation counter or reserved balance is not a deposit. Before any LP transaction, the operators must choose the exact pool/program and AAI pair asset, source and authorize both assets, disclose custody/withdrawal controls and impermanent-loss exposure, execute a reviewed deposit, and verify the minted position shares and their controlling wallet or lock. The membership verifier never routes AAI to a burn or pool.

## Current gate status

| Gate | Status |
| --- | --- |
| Fixed Mainnet `getTransaction` connection and strict parser | Implemented locally; deterministic JSON fixtures only for parser tests |
| Fresh Mainnet payment observation | Not run; no verified AAI mint, treasury, quote or real transaction signature supplied |
| AAI mint/decimals and treasury authority | Unverified / unset |
| Unique quote creation, persistence and replay prevention | Not implemented |
| Phantom checkout and actual payment acceptance | Not implemented or verified |
| NFT issuance and server membership enforcement | Not implemented |
| Burn execution and supply reconciliation | Not implemented |
| LP adapter, paired asset, deposit and position custody | Not implemented |
| Production hosting, monitoring, recovery, iPhone/Safari acceptance | Not verified |

The local JSON fixtures are parser test data only. They are not live transactions, simulated market outcomes, revenue or evidence of AAI payment acceptance.

## Primary references checked October 17, 2026

- [Solana `getTransaction` RPC method](https://solana.com/docs/rpc/http/gettransaction)
- [Solana RPC JSON structures, including parsed messages and token balances](https://solana.com/docs/rpc/json-structures)
- [Solana token transfer instructions](https://solana.com/docs/tokens/basics/transfer-tokens)
- [Solana Pay transfer requests, unique reference/memo guidance and server validation flow](https://docs.solanapay.com/spec) and [merchant integration](https://docs.solanapay.com/core/transfer-request/merchant-integration)
- [Solana Token-2022 extension guide, including transfer fees](https://www.solana-program.com/docs/token-2022/extensions)
- [Solana token burn](https://solana.com/docs/tokens/basics/burn-tokens)
