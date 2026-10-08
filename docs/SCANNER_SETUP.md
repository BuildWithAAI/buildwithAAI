# AAI scanner: reproducible local setup and launch preparation

This release is a read-only scanner. It does not sign, execute transactions, custody funds, or activate token payments. Production entry points never import test fixtures.

## Run locally

From the repository root, use Python 3.11 or 3.12:

```sh
python -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements-scanner.txt
python -m unittest discover -s tests -v
python -m src.aai_scanner serve
```

Open http://127.0.0.1:8787 and submit a public token mint. The default RPC is Solana mainnet; the genesis hash is checked before accepting RPC evidence. Markets use DEX Screener's documented base-token pool endpoint. Public providers may throttle requests or return gaps. An operator can configure an HTTPS mainnet RPC using `AAI_RPC_URL`; provider credentials and URL paths are omitted from source receipts.

Configure up to two explicit backup HTTPS mainnet RPC URLs in comma-separated `AAI_RPC_FALLBACK_URLS`. There are no automatic third-party defaults. Each provider verifies the mainnet genesis before serving reads and rechecks it after five minutes. Recovery is attempted only for connection/deadline failures and HTTP 429/502/503/504; wrong-network, malformed data, authentication/403 and RPC application errors fail closed. Every failed attempt is retained with provider ID and hostname. A single recovery call has a scheduling budget of at most 30 seconds (twice the configured provider timeout); socket reads remain individually bounded and can overrun the scheduling budget while in progress. Identity-lock waits are bounded by that budget. No request loop sleeps or retries a throttled provider immediately.

HTTP `Retry-After` supports delay-seconds and dates. Cooldowns are shared across methods in one process; absent headers use 30 seconds for HTTP 429 and 3 seconds for connection/gateway failures. Numeric delays are bounded at 2^31-1 seconds. Another already-started request may finish during a cooldown. `/api/status` exposes safe provider counters, cooldowns and identity verification time. These are process-local observations, not an uptime guarantee. Backup providers can also deny expensive methods; recovery is not a substitute for a reliable operator-provisioned RPC. Solana documents that its shared public endpoints are not intended for production: https://solana.com/docs/rpc.

`.env.scanner.example` lists configuration names. It contains no secrets and is **not automatically loaded**. Export environment variables before starting the process. On Windows activate `.venv\Scripts\Activate.ps1` and set variables with `$env:NAME='value'`.

```sh
python -m src.aai_scanner smoke --output data/live-smoke.json
python -m src.aai_scanner smoke --require-holders --require-activity --output data/live-launch-gates.json
python -m src.aai_scanner backup data/backup-2026-10-08.sqlite3
```

The smoke command exits nonzero when mint or price evidence is missing. It records separate optional-source results. `--require-holders` and `--require-activity` make those sources mandatory for the command to pass. A successful basic smoke is not a successful strict smoke or every launch gate. `coverage` lists the five selected core sections and does not imply that every metric or advanced feature is available. The web report and Telegram summary explicitly identify partial coverage. Historical verification receipts in `docs/verification/` are dated evidence, never current prices.

SQLite stores watches, up to 100 observations per mint and 5,000 total observations, and Telegram polling offsets. Backups use SQLite's online backup API and integrity checks. Stop the service before restoring a backup to the configured database path; preserve the original database and its WAL/SHM files for recovery. Backups contain address history and must remain private. Watchlists are operator/workspace-wide, not per-user. This is a single-process private beta; multi-tenant accounts and distributed limits are not implemented.

## API and evidence

`POST /api/scan` accepts `{"mint":"...","refresh":false}`; `POST /api/wallet` accepts `{"address":"..."}`. Use `GET /api/history?mint=...`, `GET /api/watchlist`, `POST /api/watchlist`, `DELETE /api/watchlist`, and `GET /api/status`. Writes only modify local watches. Remote API calls require `Authorization: Bearer <application access token>`. `GET /api/health` checks process availability only, not provider health.

Supply and unit calculations preserve exact strings; the interface rounds display values and exposes exact values in tooltips/receipts. Price in SOL and USD wallet value use independently collected snapshots with non-atomic quality flags. Market cap and FDV remain distinct. Transactions mentioning a mint are not a complete trade or transfer ledger. Largest token accounts are not unique wallets. Token-2022 extension IDs are identified, but extension semantics remain unverified. Creation time, relationship inference, historical profit/loss, and unsupported metadata remain unavailable. No safety or fraud verdict is inferred.

Evidence distinguishes retrieval time from unknown upstream tick time, requested finalized commitment from independently proven finality, slots, source host, classification, transformation version, quality flags, and missingness. Cached observations keep original timestamps. Refresh is manual; stale retrievals are marked in the interface.

## Telegram: authorized test required

Provide `AAI_TELEGRAM_ENABLED=1`, `AAI_TELEGRAM_BOT_TOKEN`, and `AAI_TELEGRAM_ALLOWED_CHAT_IDS` through secure process configuration. Only allowlisted private chats receive replies. Never enter seed phrases or signing keys.

```sh
python -m src.aai_scanner telegram-check
python -m src.aai_scanner telegram
```

`telegram-check` verifies bot identity and rejects an existing webhook rather than deleting it. Polling supports `/start`, `/help`, `/scan <mint>`, `/wallet <address>`, and `/status`; there are no execution commands. Test all commands in the authorized private chat and verify report links use the operator's `AAI_PUBLIC_URL`. Polling retries delivery without advancing the offset; this gives at-least-once delivery, so duplicates can occur after an interrupted send. Rate limits suppress floods. Run one poller per bot. Bot credentials and chat access have not been supplied or live verified in this development session.

## Public deployment preparation

No public deployment has been performed. Choose the hosting target and provide deployment authorization before publishing. Use a supported host, an unprivileged service account, a dedicated persistent database directory, and a TLS reverse proxy. Keep Waitress bound to loopback; configure the HTTPS external origin in `AAI_PUBLIC_URL`, `AAI_PUBLIC_MODE=1`, and a strong application token. Generate a token privately with `python -c 'import secrets; print(secrets.token_urlsafe(32))'`. Do not commit it or put it in URLs. The browser holds it in memory only.

Keep the original external Host header through the reverse proxy. This application intentionally rejects unexpected Host and cross-origin API requests and does not trust forwarded client headers. All clients behind a proxy may share an application rate bucket; configure stronger per-client limits at the edge. Do not expose the database or backup files as static content. Do not put this single shared token beta behind a public paid subscription without adding tenant separation and access lifecycle controls.

Before inviting users, confirm HTTPS, authenticated access, rate limits, restart and backup recovery, provider coverage, responsive browser tests, live Telegram commands, and CI on the final release commit. Monitor process health and provider failures separately, including collection duration, 429/502 responses and storage growth. No alert delivery, uptime guarantee or security certification is claimed.

## Source documentation

- Solana RPC: https://solana.com/docs/rpc/http/getaccountinfo, https://solana.com/docs/rpc/http/gettokenlargestaccounts, https://solana.com/docs/rpc/http/getsignaturesforaddress, https://solana.com/docs/rpc/http/getbalance
- Solana chain identity: https://namespaces.chainagnostic.org/solana/caip2
- SPL Token-2022 layouts: https://www.solana-program.com/docs/token-2022
- DEX Screener API: https://docs.dexscreener.com/api/reference
- Telegram Bot API: https://core.telegram.org/bots/api
- Waitress: https://docs.pylonsproject.org/projects/waitress/en/latest/
