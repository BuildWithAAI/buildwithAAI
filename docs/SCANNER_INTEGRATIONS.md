# Scanner: provider qualification and authorized Telegram verification

Scanner 0.1.4 also provides [verification of the running HTTP API](SCANNER_HTTP_VERIFICATION.md). Qualify providers independently, then verify the installed application's package, authentication, reports and declared source receipts through its actual origin. Actual bot delivery remains its own authorized test gate.

This stage prepares the remaining live integrations. **No public deployment, bot messages, trading or funds movement have occurred.** Public launch still requires permitted provider capacity, actual private-chat command delivery, an approved host/domain, working TLS/supervision and monitoring. Provider credentials and bot tokens belong in private operator configuration, not chat, URLs, logs or git.

## Qualify the chosen RPCs

Solana's official `getTokenLargestAccounts` returns up to 20 largest TOKEN ACCOUNTS, not unique wallet holders. The scanner sends a documented mint plus finalized commitment and validates returned amounts/decimals/context. A 429 or 403 does not justify substituting fake concentration figures or retrying through undisclosed providers. Solana documents that shared public RPCs are not production infrastructure and can throttle/block requests.

Configure your permitted primary and up to two explicit fallback HTTPS mainnet endpoints through `AAI_RPC_URL` and `AAI_RPC_FALLBACK_URLS`. Obtain method support and sufficient limits from the provider; do not buy capacity or change production secrets without authorization. Then run:

```sh
python -m src.aai_scanner provider-check --mint EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v --require-all --output data/provider-capabilities.json
python -m src.aai_scanner smoke --mint EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v --require-holders --require-activity --output data/strict-live-smoke.json
```

Qualification checks each configured provider independently, first validating mainnet genesis, then mint/activity/balance, and largest accounts LAST. It reuses the scanner's mint, activity and holder validators. It does no market requests or SQLite initialization. No failed provider is hidden by another's success. Each method preserves source host, retrieval time, context slot where available, requested finality, raw response hash and safe failure metadata. Provider paths/query credentials are omitted. A provider has a scheduling budget of at most 60 seconds (five configured timeouts); individual socket operations remain bounded but an in-progress read can overrun scheduling time.

Without `--require-all`, exit 0 means at least one provider passed every required capability. With it, all configured providers must pass. The JSON records the policy, every provider and both aggregate results. This is a **point-in-time** read test for the selected mint/wallet. It does not establish sustained quota, price coverage, historical holder identity, cost-basis accounting or the scanner's actual failover route. Scanner recovery remains blocked around primary authentication/403, wrong-network or invalid-response failures. Select a working primary, resolve permission errors, then verify real scanner reports separately.

`verification/scanner-provider-qualification-live-2026-10-08.json` retains the dated actual check. Both configured providers verified mainnet and returned valid mint/activity/balance data; primary holders returned HTTP429 and approved backup holders HTTP403. The strict provider command correctly returned FAILED/exit 1. No holder-capable endpoint is claimed verified. Do not import these dated receipts into the live UI.

## Configure the intended Telegram bot privately

The optional `deploy/scanner/aai-scanner-telegram.service` is a prepared Linux systemd template. It uses the scanner release, unprivileged account, persistent directory and security restrictions, reads the private scanner environment plus `/etc/buildwithaai/telegram.env`, runs `telegram-check` before starting, and limits restart storms. It has NOT been installed or started. Actual supervision, filesystem sandbox behavior and boot remain host checks.

Use `deploy/scanner/telegram.env.example` as the shape of a root-owned 0600 file in a 0700 directory. Keep its disabled/incomplete defaults until authorized. Set only the operator-owned bot token, positive authorized PRIVATE chat IDs, and the expected bot username (AAIScanBot if that is the intended bot). Set `AAI_TELEGRAM_ENABLED=1` only when intentionally starting this bot. Enabling/running it can send messages and requires authorization for those chats. Never reuse wallet signing keys, enter seed phrases or put the bot token in the public application access field.

The application's bearer token and Telegram bot token are different credentials. `AAI_PUBLIC_URL` must lead to the scanner report interface. Remote reports require an approved HTTPS origin and the separate application access token; Telegram does not bypass that gate or put tokens in links. A local report URL works on the local machine but does not establish a phone-accessible public deployment.

Run a read-only identity check in the securely configured environment:

```sh
python -m src.aai_scanner telegram-check
```

It checks typed bot identity and optional expected username, plus a valid EMPTY webhook URL/pending-update count. It never deletes a webhook or consumes updates. It emits only identity metadata, allowed-chat COUNT, pending-update count and `commands_verified=false`; no messages are sent. Existing webhook, mismatched bot, missing identity, invalid response or bad credentials is a blocker. Preserve any existing bot integration rather than switching it silently.

## Verify actual command delivery in the authorized chat

After the authorized operator starts exactly one poller, send these commands from the allowed private chat and retain a dated test record tied to the exact release commit:

| Command | Required observation |
| --- | --- |
| `/start` | Identifies the read-only scanner; no signing/trade/payment action |
| `/help` | Lists supported commands and asks only for public addresses |
| `/scan <known mint>` | Real mint/prices, explicit source hosts/retrieval time, coverage gaps and working details link; no fabricated holders |
| `/wallet <public address>` | Attributed SOL balance/retrieval time; balance is not profit; unsupported P/L unavailable |
| `/status` | Last report coverage/freshness and last observed sources, clearly separate from continuous health |
| Invalid address / unsupported command | Useful local error; no network scan/signing action from invalid input |
| Normal refresh / repeated commands | Cache timestamps remain honest; flood notice appears without a retry storm |

Verify that forbidden chats do not receive replies using an explicitly authorized second test chat; do not send unsolicited probes to other users. Retain observed message IDs and collection times privately. Identity check success alone is not live command evidence. CI tests all commands only through clearly SYNTHETIC offline transport.

## Delivery, errors and process scope

After `sendMessage`, a typed message ID and matching PRIVATE chat receipt are required before advancing the persisted update offset. Missing/malformed/wrong-chat acknowledgements are failures, not delivery. Updates must have valid increasing unique IDs; invalid or unordered batches are refused before sending. Failed delivery leaves its update pending. At-least-once delivery can duplicate a reply after network ambiguity or a crash; exactly-once messaging is not promised.

Telegram HTTP429 JSON error bodies often provide `parameters.retry_after`; the adapter reads that bounded body without logging its description or token-bearing URL. Header and JSON delays are preserved conservatively. Shared process cooldown prevents immediate requests of another method. Long waits are split into at most 30-second chunks. Transient connection/500/gateway errors retry with a cooldown; authentication/403, competing-poller 409 and invalid API responses stop for operator intervention. The service manager also caps restart storms. Do not run multiple pollers for one bot.

Web and bot processes have separate RPC cooldowns, caches and rate counters; budget provider capacity for both. SQLite coordinates persistent watches/observations and bot offsets, but each `/status` describes only its own process's last sources. There is no shared distributed limiter, public tenant system, wallet signing, trading, alerts or payment logic. Bot supervision is optional and cannot block local scanner use.

Official sources: [Solana largest accounts](https://solana.com/docs/rpc/http/gettokenlargestaccounts), [Solana RPC production warning](https://solana.com/docs/rpc), [Telegram responses/errors](https://core.telegram.org/bots/api#making-requests), [getMe](https://core.telegram.org/bots/api#getme), [getWebhookInfo](https://core.telegram.org/bots/api#getwebhookinfo), [getUpdates](https://core.telegram.org/bots/api#getupdates), [sendMessage](https://core.telegram.org/bots/api#sendmessage), [ResponseParameters](https://core.telegram.org/bots/api#responseparameters).
