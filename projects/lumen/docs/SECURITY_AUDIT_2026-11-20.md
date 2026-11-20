# Security audit, 2026-11-20

Branches reviewed: `cursor/metaverse-m1` at `20ff075` (this app) and `cursor/zoora-signer` (the signer). Reviewer: Claude. The scope list at the end says what was and was not read.

No critical flaw was found in the code that was read. No committed secret was found. `npm audit` reports 0 known vulnerabilities in runtime dependencies. `pip-audit` reports none for the signer's locked requirements.

## Fixed in this change

| # | Severity | Finding | Fix |
| --- | --- | --- | --- |
| 1 | Medium | Minting opened when a signer URL and secret were set, with no enable flag. Spending and sales already needed an exact `true` | `MINT_ENABLED` must be the exact string `true` (`src/money/mint.ts`) |
| 2 | Medium | A mistyped `LUMEN_MINT_NETWORK` (for example `devnt`) fell through to mainnet | A set value other than `mainnet` or `devnet` closes minting |
| 3 | Medium | Mint and swap requests to the signer were signed over the body only. Two identical instructions carried the same signature, so a captured request could be sent again | Each body now carries a random `nonce` and `issuedAtMs` under the signature. `signerFresh` is the check the signer must run (`src/money/signerAuth.ts`) |
| 4 | Medium | Ticks could overlap. The loop started a tick every interval without waiting for the last one. A tick loads the state, may wait on the model, and saves, so a slow model call let an older tick overwrite newer memory and feelings. The model call had no timeout, so a hung endpoint made this permanent | One tick at a time per database, and a 20 second timeout on the model call. A failed call falls back to rules (`src/server/engine.ts`) |
| 5 | Medium | Anyone holding the id of a paid SOL order could post made-up signatures to the "I've paid" form. Each one wrote a refund flag for the owner to review, with no limit | Only a real, verified second payment is flagged (`src/money/solana.ts`) |
| 6 | Medium | The public SOL quote and verify actions had no limit of their own. Each quote made a price request and stored a row. Each verify spent one RPC call on a caller-chosen signature | Per-address and overall limits on both (`src/app/actions.ts`) |
| 7 | Low | Text inside an `<untrusted>` fence could write its own closing tag and continue as if it were the prompt. The model can still only pick an allowlisted action, so the reach was a spoken line | Fence tags inside the text are replaced, and the label is restricted (`src/brain/prompt.ts`) |
| 8 | Low | README, `.env.example` and `docs/NFT.md` said money switches turn on when keys exist. The code required an exact `true`. An owner following the docs would misjudge what is live | Docs corrected to match the code |
| 9 | Low | `POST /api/jarvis/chat` read a body of any size | 8 KB limit, same reader as the world routes |
| 10 | Low | The page rate limiter kept one entry per address with no ceiling between prunes | Capped at 20,000 entries, oldest dropped first |

Tests: `tests/audit20261120.test.ts`, plus three updated assertions in `tests/money.test.ts` and `tests/rereview10.test.ts`.

## Open, owner decision needed

| # | Severity | Finding | Recommended action |
| --- | --- | --- | --- |
| 11 | Medium | In public mode with `LUMEN_TRUSTED_PROXY` unset, the client address is taken from `CF-Connecting-IP` or the first `X-Forwarded-For` hop. A caller who reaches the app without Cloudflare in front can send either header and choose its own address, which defeats every per-address limit, including the new ones in finding 6. `fly.toml` sets `fly`. The Dockerfile sets public mode and no proxy. Whether ngrok overwrites a client-sent `X-Forwarded-For` was not confirmed | Always set `LUMEN_TRUSTED_PROXY` to the real front door. Consider refusing to start in public mode without it |
| 12 | Medium | `desk-proxy.mjs` listens on every interface on port 3001 and adds the desk secret to each request. On Fly the port is private. In a local `docker run -p 3001:3001`, anyone on the same network reaches the owner login page. The login still needs the password or token | On the owner's computer publish it as `127.0.0.1:3001:3001` only |
| 13 | Medium | `REQUIRE_HARD_CAPS_WHEN_SPENDING` is `false`. With caps unset, an owner-confirmed purchase has no ceiling in code | Set it to `true` before live spending |
| 14 | Low | No minimum length is enforced for `OWNER_ACCESS_TOKEN` or `LUMEN_JARVIS_TOKEN`. The owner token is accepted from the public edge on the checkout routes | Use 32 random bytes or more. Consider a boot check |
| 15 | Low | `LUMEN_LLM_BASE_URL` is not required to be https. A plain http value sends the model key in the clear | Use https. Consider a boot check |
| 16 | Low | The Stripe webhook checks `livemode` only when `LUMEN_SALES_MODE` is `live` or `test`. Live sales are switched by `LUMEN_SALES_ENABLED`, so the check is usually off. Stripe signs test and live endpoints with different secrets, which limits the reach | Derive the expected `livemode` from the resolved sales mode |
| 17 | Low | SOL order ids are 4 random bytes. A collision raises an error on insert | Use 8 bytes or more |
| 18 | Info | The money ledger is a plain SHA-256 chain guarded by SQLite triggers. It shows accidental and casual edits. Someone with write access to the database file can drop the triggers and rebuild the chain. The signer's event log is keyed (HMAC) and does not have this limit | Key the ledger chain the same way before real money depends on it |
| 19 | Info | Nothing consumes this app's signer protocol. `projects/zoora-signer` reads its own signed intent feed and does not serve `x-lumen-signature` requests. Live minting and live trading from this app cannot work end to end today | Pick one contract. The signer's intent format already has an id, a time limit and replay refusal |

## The signer (`cursor/zoora-signer`)

Read: `secrets.py`, `signing.py`, `killswitch.py`, and the intent entry point in `signer.py`. Outline only for the rest of `signer.py`.

- It cannot sign today. `sign_message` has no caller anywhere in the package, and `LIVE` is refused with `LIVE_STUB`.
- The signing key is read from Windows Credential Manager, never from the environment or a file. Key material in the environment stops the process.
- Intents are HMAC-checked, refused on duplicate JSON keys, refused when stale or post-dated, and a repeated intent id returns the stored decision.
- The kill switch treats a missing directory, an unreadable path, a stale heartbeat or any kill file as killed.
- OPSEC note: any program running as the same Windows user can read Credential Manager entries. Run the signer under its own Windows account and keep the wallet at the small balance the caps assume.

Signer tests: 163 of 164 pass in the review sandbox. `test_unreadable_state_dir_is_killed` fails because the sandbox runs as root, and root ignores the file permissions the test sets.

## Scope

Read: `src/auth/*`, `src/middleware.ts`, `src/http/*`, `src/money/rules.ts`, `policy.ts`, `mint.ts`, `signerAuth.ts`, `webhook.ts`, `solana.ts`, the signature check in `stripe.ts`, the authorization half of `card.ts`, `src/integrations/jarvis.ts`, `telegramPoll.ts`, the owner checks in `telegramOwner.ts`, the trade gate and signer call in `src/trading/book.ts`, `src/app/actions.ts`, the tick runner, guestbook path and model call in `src/server/engine.ts`, the fence in `src/brain/prompt.ts`, the scrubber in `src/research/ideas.ts`, model output handling in `src/brain/decide.ts`, world command auth in `src/world/registry.ts`, every API route outside `world/visitors`, `desk-proxy.mjs`, `Dockerfile`, `docker-entrypoint.sh`, `fly.toml`.

Not read line by line: `src/money/ledger.ts`, `execute.ts`, `checkoutQueue.ts`, `reconcile.ts`, `notify.ts`, `src/research/ssrf.ts` and `run.ts`, `src/shop/store.ts`, the visitor routes and `src/world/visitors.ts`, the rest of `src/world`, the React pages, and most of `signer.py`, `txbuild.py` and `message_policy.py` in the signer. The Python projects on `main` were not reviewed.

One test fails in the review sandbox, `starts the desk proxy and answers on ipv6 localhost`. The sandbox has no IPv6 loopback address. It failed the same way before this change. All other tests pass (242 of 243).
