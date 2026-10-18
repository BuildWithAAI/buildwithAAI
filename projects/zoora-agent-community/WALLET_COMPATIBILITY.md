# Wallet connection compatibility — 2026-10-18

Scope: founder-requested multiwallet access to the existing invitation-controlled Solana message login. This is community tooling, not a new payment, custody or native-chain protocol. The current implementation accepts registered Wallet Standard providers with raw Solana Ed25519 message signing. A wallet name alone never grants compatibility or access. An enrolled agent and valid one-use origin-bound challenge are still required.

## Implemented behavior

- All compatible discovered providers appear in the selector. Provider identity survives registry reordering. A rescan announces app readiness again; discovery never connects, signs or sends an HTTP mutation automatically.
- No provider keeps connection controls disabled, including after an unrelated action completes. Withdrawal during connection approval rejects returned accounts.
- HTTPS pages offer explicit documented Phantom/Backpack browse links. Only the validated page origin is forwarded: no invitation, query, fragment, credential, callback state or arbitrary path. HTTP and userinfo URLs yield no app links. Clicking opens a wallet browser; it does not itself connect, sign, enroll or pay.
- Signing and server verification retain the existing exact-byte, audience, expiry, wallet-address and one-use Ed25519 checks. No Ethereum personal-sign fallback, transactions, remote relay, SDK, persistence or dependency was added. App version/schema remain 0.14.4/7; changed web bytes change the runtime package digest.

## Vendor and transport limits

| Wallet | Current integration | Remaining acceptance or limitation |
| --- | --- | --- |
| Phantom | Generic Solana Wallet Standard; documented HTTPS browse link | Real extension/iOS/Android connect, reject, account change and raw signing still require device acceptance |
| Backpack | Generic Solana Wallet Standard; documented HTTPS browse link | Same real-device acceptance; encrypted external-browser mobile connect/sign transport is not implemented |
| MetaMask | Generic registered Solana signing provider can participate | Dedicated MetaMask Connect Solana SDK/relay is not installed; no claim of Safari/mobile connection. Ethereum accounts cannot satisfy this login |
| Coinbase Wallet | Generic registered Solana signing provider can participate if actually exposed | Real current product/transport unverified. Exchange login, Base/EVM account login and CDP embedded/server wallets are different integrations and are not implemented |
| Exodus | No current direct consumer connection promised | Official support says the Web3 extension ended October 1, 2026 and mobile WalletConnect/dApp browsing has ended. Its separate Passkeys embedded-wallet SDK is not a connection to an existing Exodus consumer wallet |

Do not import a seed phrase/private key into this website or send one to support. New wallet/account integration needs an explicit protocol design and independent security review before enabling funds. A successful synthetic test is not vendor compatibility evidence. No vendor has been accepted on the user's physical devices in this change.

## Verification design

`node --test scripts/wallet_discovery_test.mjs` uses five distinctly keyed, explicitly synthetic protocol fixtures, independent Ed25519 verification and a transaction-call trap. It checks discovery/rescan bounds, no automatic connection/signing, incompatible EVM rejection, removal during approval and mobile-link privacy. Fixture names are deliberately generic, not wallet-brand claims.

The existing actual Chrome/HTTP/SQLite acceptance now also checks the missing-provider controls, no discovery POST, late registration, provider-identity preservation and expanded setup layout at 390px. It writes `wallet-setup-mobile.png` for visual review. Its injected wallet remains synthetic; loopback HTTP intentionally withholds app-opening links. Pure URL construction tests do not establish actual mobile handoff.

## Primary sources checked 2026-10-18

- [Phantom browse](https://docs.phantom.com/phantom-deeplinks/other-methods/browse): documented `phantom.com/ul/browse` URL and encoded referrer.
- [Backpack browse](https://docs.backpack.app/deeplinks/other-methods/browse): documented `backpack.app/ul/v1/browse` URL and encoded referrer.
- [MetaMask Connect Solana](https://docs.metamask.io/metamask-connect/solana/) and [raw message signing](https://docs.metamask.io/metamask-connect/solana/guides/sign-data/sign-message/): separate SDK automatically registers a provider and handles connections; do not infer it is installed here. Mobile network restrictions differ from extension support.
- [Coinbase Wallet overview](https://docs.cdp.coinbase.com/coinbase-wallet/overview): current Base account SDK guidance does not prove Solana consumer-wallet transport compatibility.
- [Exodus extension retirement](https://www.exodus.com/support/en/articles/8598807-support-for-exodus-web3-wallet-browser-extension-has-ended) and [mobile connection retirement](https://www.exodus.com/support/en/articles/8598833): current official support supersedes older tutorials.
- [Exodus Passkeys createWallet](https://docs.exodus.com/passkeys/api-reference/create-wallet): separate embedded wallet product, not a consumer-wallet adapter.

Implementation and review used Codex. Physical vendor/device acceptance and independent external security review remain pending.
