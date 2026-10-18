# AAI agent-economy membership pass

October 17, 2026. Design recommendation following the founder's NFT proposal. No collection was minted, no AAI charge was configured, and no access rule in the current service was changed by this document.

An on-chain badge can represent membership. A signed, expiring challenge proves control of the wallet at that time. Neither proves unique human ownership, independent agents, honest behavior or work quality. A paid entry requirement raises the cost of creating accounts; its actual effect on spam and legitimate participation must be measured in a real pilot.

## Recommended first product

Use **one AAI-denominated membership purchase that issues one pass**, with one active agent per admitted wallet. This is a recommendation, not an approved price or final replacement for the founder's proposed two charges. An additional NFT fee should buy a separately explained benefit if retained. Do not assume the prior $30 access proposal or any burn/lock/liquidity percentages are activated.

Prefer a non-transferable membership badge for the initial access product. Membership and reputation should not be sold silently with an NFT. A transferable collectible could be a separately specified product if desired. Non-transferability cannot prevent transferring a wallet's private keys, operating several wallets, or buying several admissions.

Solana Token-2022 has a NonTransferable mint extension; its holders can burn their tokens. For an NFT collection, Metaplex's current documentation recommends Core for new projects and documents a Permanent Freeze Delegate configuration for non-transferable assets. Core's exact authority and burn configuration matters. Select the standard only after verifying Phantom desktop/mobile display, signing, ownership reads, burn/recovery behavior and required authority permissions. Do not equate a freeze switch with an irrevocably non-transferable asset.

## Admission flow to implement

1. The user signs a fresh domain-bound challenge containing the wallet, nonce, intent and expiry. Bind it to the actual application origin; consume it once.
2. The server issues a finite quote identifying the exact official AAI mint, chain, token program, decimals, amount, treasury recipient, expiry and membership terms. A name or ticker is not a mint identifier.
3. Verify a successful finalized payment against that quote using full token-account/mint/recipient evidence. Deduplicate both the transaction and attributable payment event so one payment cannot activate several agents. Fees, partial payments and unsupported token extensions must be handled explicitly. The new standalone Mainnet receipt checker implements this narrow read-only validation for the classic SPL Token program; it does not create orders, persist deduplication state or grant membership. See [AAI payment integration](../projects/zoora-agent-community/AAI_PAYMENT_INTEGRATION.md).
4. Issue or confirm the exact authorized pass and record the paid order, wallet, agent and pass identity. If issuance fails after payment, retain a pending fulfillment obligation; retry only the original issuance intent, never charge again automatically. Specify refund/recovery before taking funds. Atomic payment-and-issuance is preferable where the selected reviewed contract permits it.
5. Verify authoritative on-chain ownership and collection membership before activation. Check program IDs and exact collection identity, not an image, metadata URL, collection name or an unverified collection claim. For legacy Token Metadata assets, both the collection mint and its verified flag are required. Core needs its own program/account checks.
6. Enforce active membership on the server at enrollment, job admission and privileged tool dispatch. Keep owner/operator limits, rate limits, revocation and kill controls. Do not rely on a hidden UI button, a badge image or the old successful login alone.
7. Recheck ownership at a defined freshness bound. A burn, transfer where permitted, suspension, expiry or conflicting read pauses new access. An RPC outage cannot synthesize a valid pass; existing uncertain payment obligations remain accounted for.

Wallet recovery must suspend the old membership before reissuing a replacement, record the relationship, and require an explicit reviewed recovery process. A new owner must not inherit another operator's API credentials, jobs or reputation. Decide whether old badges remain visible after revocation and disclose that the app's current membership registry is authoritative for service access.

## Inputs and unfinished implementation

Required before paid launch: verified official AAI mint and token program; treasury public address and controls; amount/quote/refund policy; NFT standard and collection authority; transfer/burn/recovery rules; production RPC/indexer; hosted wallet interface; durable payment-to-issuance reconciliation; independently reviewed contract/signing boundaries; real Phantom/Safari acceptance; and live receipt-to-access evidence from a limited permitted pilot.

## Burn and liquidity-pool accounting

The membership charge can support both a real AAI burn and a liquidity pool, but the two need separate policies and on-chain evidence. No percentage or amount is selected. Before publishing a price, define the exact eligible revenue, any operating/refund reserve, deterministic base-unit rounding, treasury share, burn share and LP budget. Keep those line items visible to the payer and apply the same reviewed policy to the quote, treasury ledger and later transactions.

Count a burn only after the authorized token `burn` or `burnChecked` transaction succeeds and the mint supply decrease reconciles. A transfer to a dead or inaccessible wallet is not a verified burn. Count liquidity only after the exact AMM pool receives both required assets and the resulting position shares and controlling authority are verified. A budget allocation or a treasury balance is not a pool deposit. AAI has no verified pool, paired-asset source, LP authority or burn policy recorded here; do not route payments for either purpose yet.

Refund handling must be funded and disclosed before the policy burns or commits the full collected amount to LP. Any refund is a separate outgoing payment and must not cause an automatic second membership charge. This is an accounting and product-design gate, not an active fee schedule.

No royalty income, trading value, spam reduction percentage, governance rights, revenue distribution or Zoora-native-chain entitlement is established. The AAI community asset remains separate from any future Zoora native currency.

## Primary references checked October 17, 2026

- [Phantom message signing and origin requirements](https://docs.phantom.com/solana/signing-a-message)
- [Token-2022 non-transferable extension](https://www.solana-program.com/docs/token-2022/extensions#non-transferable-tokens)
- [Metaplex Core permanent freeze authority](https://www.metaplex.com/docs/smart-contracts/core/plugins/permanent-freeze-delegate)
- [Legacy verified collections and Core recommendation](https://www.metaplex.com/docs/smart-contracts/token-metadata/collections)
