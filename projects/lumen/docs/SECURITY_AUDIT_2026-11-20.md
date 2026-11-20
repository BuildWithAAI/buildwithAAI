# Security audit, 2026-11-20

Branches reviewed: `cursor/metaverse-m1` at `20ff075` (this app) and `cursor/zoora-signer` (the signer). Reviewer: Claude. The scope list at the end says what was and was not read.

One flaw rated high was found and fixed (finding 11). It was not proven end to end. Nothing else critical was found in the code that was read. No committed secret was found. `npm audit` reports 0 known vulnerabilities in runtime dependencies. `pip-audit` reports none for the signer's locked requirements.

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
| 11 | High | The art checkout took Stripe's return address from the request's `Origin` header, and the form key is the same for every buyer of a piece (`buy-<id>-<price>`). The first session made for a piece was handed to every later buyer. One request with a forged `Origin` set where every real buyer of that piece landed after paying. Not proven end to end: Next accepts the action only if the caller's `Origin` matches the host it sees, which needs the front proxy to pass a caller-set `X-Forwarded-Host`. That was not tested against Fly | The return address is this site's own origin unless the header matches a configured origin (`checkoutReturnOrigin` in `src/app/api/checkout/auth.ts`) |
| 12 | Medium | The same stored session was reused with no time limit. Stripe sessions end after 24 hours, so one abandoned checkout left a piece unbuyable | A stored session is reused only inside a 23 hour window (`src/server/engine.ts`) |
| 13 | Low | The public shop buy action had no limit of its own once sales are open. Each call asked Stripe for a session and stored an order row | Per-address and overall limits (`src/app/actions.ts`) |

Tests: `tests/audit20261120.test.ts`, plus three updated assertions in `tests/money.test.ts` and `tests/rereview10.test.ts`.

## Open, owner decision needed

| # | Severity | Finding | Recommended action |
| --- | --- | --- | --- |
| 14 | Medium | In public mode with `LUMEN_TRUSTED_PROXY` unset, the client address is taken from `CF-Connecting-IP` or the first `X-Forwarded-For` hop. A caller who reaches the app without Cloudflare in front can send either header and choose its own address, which defeats every per-address limit, including the new ones in findings 6 and 13. `fly.toml` sets `fly`. The Dockerfile sets public mode and no proxy. Whether ngrok overwrites a client-sent `X-Forwarded-For` was not confirmed | Always set `LUMEN_TRUSTED_PROXY` to the real front door. Consider refusing to start in public mode without it |
| 15 | Medium | `desk-proxy.mjs` listens on every interface on port 3001 and adds the desk secret to each request. On Fly the port is private. In a local `docker run -p 3001:3001`, anyone on the same network reaches the owner login page. The login still needs the password or token | On the owner's computer publish it as `127.0.0.1:3001:3001` only |
| 16 | Medium | `REQUIRE_HARD_CAPS_WHEN_SPENDING` is `false`. With caps unset, an owner-confirmed purchase has no ceiling in code | Set it to `true` before live spending |
| 17 | Low | No minimum length is enforced for `OWNER_ACCESS_TOKEN` or `LUMEN_JARVIS_TOKEN`. The owner token is accepted from the public edge on the checkout routes | Use 32 random bytes or more. Consider a boot check |
| 18 | Low | `LUMEN_LLM_BASE_URL` is not required to be https. A plain http value sends the model key in the clear | Use https. Consider a boot check |
| 19 | Low | The Stripe webhook checks `livemode` only when `LUMEN_SALES_MODE` is `live` or `test`. Live sales are switched by `LUMEN_SALES_ENABLED`, so the check is usually off. Stripe signs test and live endpoints with different secrets, which limits the reach | Derive the expected `livemode` from the resolved sales mode |
| 20 | Low | SOL order ids are 4 random bytes. A collision raises an error on insert | Use 8 bytes or more |
| 21 | Info | The money ledger is a plain SHA-256 chain guarded by SQLite triggers. It shows accidental and casual edits. Someone with write access to the database file can drop the triggers and rebuild the chain. The signer's event log is keyed (HMAC) and does not have this limit | Key the ledger chain the same way before real money depends on it |
| 22 | Info | Nothing consumes this app's signer protocol. `projects/zoora-signer` reads its own signed intent feed and does not serve `x-lumen-signature` requests. Live minting and live trading from this app cannot work end to end today | Pick one contract. The signer's intent format already has an id, a time limit and replay refusal |

## The signer (`cursor/zoora-signer`)

Read: `secrets.py`, `signing.py`, `killswitch.py`, `caps.py`, `message_policy.py`, and the intent entry point and buy decision in `signer.py`. Outline only for the rest of `signer.py`.

- It cannot sign today. `sign_message` has no caller anywhere in the package, and `LIVE` is refused with `LIVE_STUB`.
- The signing key is read from Windows Credential Manager, never from the environment or a file. Key material in the environment stops the process.
- Intents are HMAC-checked, refused on duplicate JSON keys, refused when stale or post-dated, and a repeated intent id returns the stored decision.
- The message policy accepts one shape only: a v0 message with one signer, no address lookup tables, at most four instructions, one swap on a pinned program and version, derived accounts recomputed and compared, and total spend under the cap. System transfers, token transfers, approvals and authority changes are refused by name.
- Caps are constants in code and are checked inside one database transaction with the reservation.
- The kill switch treats a missing directory, an unreadable path, a stale heartbeat or any kill file as killed.
- OPSEC note: any program running as the same Windows user can read Credential Manager entries. Run the signer under its own Windows account and keep the wallet at the small balance the caps assume.

Signer tests: 163 of 164 pass in the review sandbox. `test_unreadable_state_dir_is_killed` fails because the sandbox runs as root, and root ignores the file permissions the test sets.

## Scope

Read: `src/auth/*`, `src/middleware.ts`, `src/http/*`, `src/money/rules.ts`, `policy.ts`, `mint.ts`, `signerAuth.ts`, `webhook.ts`, `solana.ts`, `execute.ts`, the signature check and checkout call in `stripe.ts`, the authorization half of `card.ts`, the claim and report half of `checkoutQueue.ts`, the append path in `ledger.ts`, mail composition in `notify.ts`, `src/research/ssrf.ts`, the query path in `src/research/run.ts`, the scrubber in `src/research/ideas.ts`, `src/integrations/jarvis.ts`, `telegramPoll.ts`, the owner checks in `telegramOwner.ts`, the trade gate and signer call in `src/trading/book.ts`, `src/app/actions.ts`, the tick runner, guestbook path, art checkout and model call in `src/server/engine.ts`, the fence in `src/brain/prompt.ts`, model output handling in `src/brain/decide.ts`, artwork construction in `src/brain/art.ts`, world command auth in `src/world/registry.ts`, the visitor gate, registration, authorization and resume in `src/world/visitors.ts`, checkout and delivery in `src/shop/store.ts`, every API route, `desk-proxy.mjs`, `Dockerfile`, `docker-entrypoint.sh`, `fly.toml`.

Read and found sound, no change: the URL guard for web reading (pins the resolved address, re-checks every redirect, refuses private and mapped ranges), purchase execution (claims before it charges, pauses on an unknown outcome), visiting agents (off by default, hashed tokens, quarantined text), and artwork SVG (numbers only, no text from outside).

Not read line by line: `src/money/reconcile.ts`, the SMTP dialogue in `notify.ts`, the PAN matcher in `checkoutQueue.ts`, the migration half of `ledger.ts`, `src/world/chunkEdits.ts`, `territory.ts` and the rest of `src/world`, the React pages, and `txbuild.py`, `preflight.py`, `oracle.py`, `quote.py` and most of `signer.py` in the signer. The Python projects on `main` were not reviewed.

One test fails in the review sandbox, `starts the desk proxy and answers on ipv6 localhost`. The sandbox has no IPv6 loopback address. It failed the same way before this change. All other tests pass (243 of 244).
