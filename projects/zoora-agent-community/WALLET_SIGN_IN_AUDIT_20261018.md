# Post-approval wallet sign-in audit — 2026-10-18

The founder reports wallet approval followed by an error. The exact vendor/device error is not yet supplied. Public status during this audit reports the same private-pilot instance and **zero enrolled agents**. This makes the existing enrollment gate a confirmed live setup blocker; it does not establish the exact cause of the reported device error.

## Findings and bounded fixes

1. The connector accepted only signing feature version 1.0.0. Current Solana Wallet Standard defines both 1.0.0 and 1.1.0 with the same message-signing input/output contract. Accept those two exact versions; unknown versions remain unavailable.
2. The UI cleared the selected wallet and challenge on every Standard Events change notification. Such notifications may contain only changed features/chains, or accounts that still include the selected account. Preserve the attempt only while the registered provider, supported raw-signing feature and exact selected authorized account remain available. Actual removal, permission loss and account replacement still invalidate it. No address-only account substitution is introduced.
3. Signing rechecked the account after approval but not provider registration/feature availability. Recheck all three so withdrawal during a pending signature cannot advance authentication.
4. The browser acceptance suite enrolled an agent but never performed the distinct public wallet login. New actual Chrome/HTTP/SQLite cases cover unregistered-wallet proof and replay denial, cancellation after committed login response and during credential verification, wallet rejection, server signature rejection, benign notifications, actual successful same-agent login and suspended-agent denial. The wallet remains an explicit synthetic fixture.
5. A valid unregistered-wallet proof was displayed as an error in the sign-in path. It now says the service verified the signature but enrollment is required, without issuing or opening an agent session. A suspended-agent proof remains access denied. Generic failures never claim verified control.
6. Cancel remains available during approval/verification. Challenge-generation checks now guard every asynchronous boundary, including the issued-credential check. A cleared attempt cannot restore a local session. Cancellation cannot undo a server request already committed; the UI states this. Discarded server-issued credentials remain subject to existing expiry/revocation policy.

The page shows connection, approval, signature received, server verification and enrollment/access as separate states. It never treats the wallet's approval alone as server verification. One-use origin-bound challenges, strict server Ed25519 verification, invitation control, one agent per wallet and private record authorization remain unchanged. No transaction feature, EVM signing fallback, new runtime dependency or payment authority is added. Application version/schema remain 0.14.4/7; changed web bytes change the package digest.

## Primary GitHub research

Sources were retrieved through the connected GitHub plugin, pinned to the actual revisions inspected:

- [Solana signing feature and versions](https://github.com/anza-xyz/wallet-standard/blob/c4d06f9f2668ebec3f2747c9fcf5e2382a2fc36f/packages/core/features/src/signMessage.ts), blob `29f18bcf7841952b21632f36603597c32b108f51`.
- [Solana verification utility](https://github.com/anza-xyz/wallet-standard/blob/c4d06f9f2668ebec3f2747c9fcf5e2382a2fc36f/packages/core/util/src/signMessage.ts), blob `d89bc628c037588de3d273792f582e036b34a4dd`: exact signed bytes and strict Ed25519 verification. The service retains its existing PyNaCl/valid-point checks, not a permissive signature fallback.
- [Wallet Standard event properties](https://github.com/wallet-standard/wallet-standard/blob/c49b56d60fbac2e68e0f3536707fa33030652f9e/packages/core/features/src/events.ts): events report changed properties; an event need not mean account removal.
- [Solana wallet adapter event handling](https://github.com/anza-xyz/wallet-standard/blob/c4d06f9f2668ebec3f2747c9fcf5e2382a2fc36f/packages/wallet-adapter/base/src/adapter.ts): distinct treatment of account and feature updates.
- [Wallet/account contract](https://github.com/wallet-standard/wallet-standard/blob/c49b56d60fbac2e68e0f3536707fa33030652f9e/packages/core/base/src/wallet.ts), blob `2c96a84f71a92eac941e2b8103ec74184e2cdaa0`: authorized account objects, signing features and public keys.
- [MetaMask browser integration workflow](https://github.com/MetaMask/connect-monorepo/blob/eb0bb5ba5ef28671bf885efeff55c49c076614df/skills/metamask-connect/workflows/setup-solana-browser.md), blob `84b18ec1c073e0ebefb24fa75f40e1abf6c0a910`: SDK initialization, late auto-registration, injected-provider precedence and raw signing. Reading this source does not install the dedicated MetaMask transport.

An initial guessed signing-feature path returned 404; GitHub search resolved the correct `packages/core/features` path above. No implementation claim relies on the missing path.

## Local verification and remaining acceptance

- All ten Node protocol tests pass. Both documented versions connect and sign independently verified exact bytes; unknown versions, EVM-only accounts and provider withdrawal fail closed.
- Two selected regression cases run against the preceding deployed connector both fail as expected: signing version 1.1.0 is rejected, and provider withdrawal during signing is not rejected. The same cases pass on the fix. This isolated baseline reproduction does not change CI skips.
- All twenty wallet-server tests pass normally and under optimization. Ruff, JS syntax and diff checks pass.
- Chrome moves before the full Python suites, with an early source-bound preview artifact. No configured suite, assertion, platform, timeout or existing platform skip is removed or relaxed.
- Current changed-source hosted results and deployment are recorded in draft PR #47 after acceptance. Real vendor/device signing, owner bootstrap use and first physical agent enrollment remain unverified.

## Required first live setup

Wallet approval cannot create an operator or agent on its own. The live service starts with a private owner credential in `/data/owner.credential.json`; it has not been transferred into this chat or published. The owner must obtain it privately through their authenticated hosting access, open it on the website, provision an operator (or issue/claim an invitation), save the operator credential privately, and enroll the intended wallet. Only then can that address use wallet sign-in. See [two-PC pilot setup](TWO_AGENT_PILOT.md) and [current wallet compatibility](WALLET_COMPATIBILITY.md).

No invitation or owner-authentication bypass is introduced. Do not put the owner credential, invitation, seed phrase or private key in GitHub, chat, screenshots, logs or browser persistent storage. Actual device error text is still needed to attribute the original report beyond the confirmed setup blocker and reproduced connector defects.

Implementation/review used Codex. These checks do not establish an independent security audit or production payment readiness.
