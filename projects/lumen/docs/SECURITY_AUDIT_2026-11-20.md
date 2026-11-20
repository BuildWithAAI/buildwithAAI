# Security audit, 2026-11-20

Branch reviewed: `cursor/metaverse-m1` at `20ff075`. Reviewer: Claude. This is a partial audit. The scope list at the end says what was and was not read.

No critical flaw was found in the code that was read. No committed secret was found. `npm audit` reports 0 known vulnerabilities in runtime dependencies.

## Fixed in this change

| # | Severity | Finding | Fix |
| --- | --- | --- | --- |
| 1 | Medium | Minting opened when a signer URL and secret were set, with no enable flag. Spending and sales already needed an exact `true` | `MINT_ENABLED` must be the exact string `true` (`src/money/mint.ts`) |
| 2 | Medium | A mistyped `LUMEN_MINT_NETWORK` (for example `devnt`) fell through to mainnet | A set value other than `mainnet` or `devnet` closes minting |
| 3 | Medium | Mint and swap requests to the signer were signed over the body only. Two identical instructions carried the same signature, so a captured request could be sent again | Each body now carries a random `nonce` and `issuedAtMs` under the signature. `signerFresh` is the check the signer must run (`src/money/signerAuth.ts`) |
| 4 | Low | README, `.env.example` and `docs/NFT.md` said money switches turn on when keys exist. The code required an exact `true`. An owner following the docs would misjudge what is live | Docs corrected to match the code |
| 5 | Low | `POST /api/jarvis/chat` read a body of any size | 8 KB limit, same reader as the world routes |
| 6 | Low | The page rate limiter kept one entry per address with no ceiling between prunes | Capped at 20,000 entries, oldest dropped first |

Tests: `tests/audit20261120.test.ts`, plus three updated assertions in `tests/money.test.ts` and `tests/rereview10.test.ts`.

## Open, owner decision needed

| # | Severity | Finding | Recommended action |
| --- | --- | --- | --- |
| 7 | Medium | In public mode with `LUMEN_TRUSTED_PROXY` unset, the client address is taken from `CF-Connecting-IP` or the first `X-Forwarded-For` hop. A caller who reaches the app without Cloudflare in front can send either header and choose its own address, which defeats every per-address limit. `fly.toml` sets `fly`. The Dockerfile sets public mode and no proxy. Whether ngrok overwrites a client-sent `X-Forwarded-For` was not confirmed | Always set `LUMEN_TRUSTED_PROXY` to the real front door. Consider refusing to start in public mode without it |
| 8 | Medium | `desk-proxy.mjs` listens on every interface on port 3001 and adds the desk secret to each request. On Fly the port is private. In a local `docker run -p 3001:3001`, anyone on the same network reaches the owner login page. The login still needs the password or token | On the owner's computer publish it as `127.0.0.1:3001:3001` only |
| 9 | Medium | `REQUIRE_HARD_CAPS_WHEN_SPENDING` is `false`. With caps unset, an owner-confirmed purchase has no ceiling in code | Set it to `true` before live spending |
| 10 | Low | No minimum length is enforced for `OWNER_ACCESS_TOKEN` or `LUMEN_JARVIS_TOKEN`. The owner token is accepted from the public edge on the checkout routes | Use 32 random bytes or more. Consider a boot check |
| 11 | Info | Nothing consumes the signer protocol yet. `projects/zoora-signer` on `cursor/zoora-signer` is a CLI that refuses to sign or broadcast by design, and it does not serve `x-lumen-signature` requests. Live minting and live trading cannot work end to end today | Decide the signer contract before either is switched on. The signer must enforce finding 3 |

## Scope

Read: `src/auth/*`, `src/middleware.ts`, `src/http/bodyLimit.ts`, `src/http/publicRead.ts`, `src/money/rules.ts`, `src/money/policy.ts`, `src/money/mint.ts`, `src/money/signerAuth.ts`, `src/integrations/jarvis.ts`, `src/integrations/telegramPoll.ts`, the owner checks in `src/integrations/telegramOwner.ts`, the signer call and trade gate in `src/trading/book.ts`, the Stripe, Telegram, Jarvis, checkout, delivery and Privacy.com routes, `desk-proxy.mjs`, `Dockerfile`, `docker-entrypoint.sh`, `fly.toml`.

Not read line by line: `src/server/engine.ts` (949 lines, includes the model call), `src/money/ledger.ts`, `execute.ts`, `webhook.ts`, `checkoutQueue.ts`, `card.ts`, `solana.ts`, `src/research/ssrf.ts`, `src/shop/store.ts`, the world and visitor routes, the React pages, and all of `projects/zoora-signer` (about 5,600 lines of Python). The Python platform on `main` was not reviewed.

One test fails in the review sandbox, `starts the desk proxy and answers on ipv6 localhost`. The sandbox has no IPv6 loopback address. It failed the same way before this change.
