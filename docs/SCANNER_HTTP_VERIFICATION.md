# Verify the running scanner through HTTP

Scanner 0.1.4 adds a bounded external check of the configured running API. Use it after installing a candidate, restarting it, or changing the approved reverse proxy. It checks the application that users actually reach. Local readiness, direct provider qualification and browser QA remain separate checks.

## Run against an existing server

Start the scanner normally. In another process, provide the same private scanner environment, including the application bearer token when configured, the intended `AAI_PUBLIC_URL`, and the approved RPC URLs. Environment configuration is not loaded automatically. Keep credentials in secure process configuration rather than arguments or URLs.

```sh
python -m src.aai_scanner verify-http \
  --mint EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v \
  --wallet 11111111111111111111111111111111 \
  --output data/http-release-check.json
```

The sample wallet is the public System Program address; its balance is an accounting sample, not a personal wallet or profit measurement. Supply other public addresses when appropriate. The command returns 0 only when every required check passes, otherwise 1. Invalid input/configuration can fail before an evidence file is written. The verifier never opens its configured client database. The target scanner's token request can save an observation and honors its normal minimum refresh/cache interval; existing watches and bot offsets are not changed.

The target is exactly the configured origin. HTTP is permitted only for the supported loopback configuration. Remote mode requires HTTPS and the separate application access token. Ordinary HTTPS certificate verification applies; there is no insecure TLS option. Redirects are refused, including redirects to another port/host. The verifier makes at most five API requests, with no immediate retry, and stops on an unexpected HTTP response, 429 or server failure. A 90-second scheduling budget, per-request timeouts of at most 10 seconds for lightweight routes / 35 seconds for reports, and a 2 MB response limit apply. An already-started socket read can overrun the scheduling budget. Safe HTTP status/Retry-After metadata is retained; error bodies, descriptions, credential-bearing provider URLs and bearer tokens are omitted.

## Required checks

| Check | Passing evidence |
| --- | --- |
| Process and release | Fresh process-only health, expected read-only/access state, matching scanner package version and content hash |
| Authentication | Anonymous readiness is HTTP401 when an application token is configured; explicit local-no-token scope otherwise |
| Application | Authorized readiness, supported local checks, execution disabled, no-store responses |
| Token report | Requested outer/inner mint, mainnet identity, mint, USD/SOL prices, largest accounts and address activity; matching recomputed coverage |
| Declared source receipts | Approved RPC/market hosts, methods, response hashes, fresh collection timestamps, requested finalized commitment/context slots for relevant RPC reads, and mainnet genesis |
| Wallet report | Requested public address, attributed valid nonnegative SOL balance, fresh collection time |

Synthetic, inferred or learned source labels, synthetic flags, missing hashes, unexpected hosts, wrong mainnet identity, unavailable measurements, stale/future timestamps, inconsistent coverage and malformed contracts cannot yield a pass. Source failures remain safe typed records, including approved hosts, HTTP codes and retry delays. Empty valid collections and observed zero balances are permitted; they do not prove a complete holder/trade history. Largest accounts remain token accounts rather than unique owners. USD/SOL derivation continues to use non-atomic market snapshots.

Collection freshness is limited to 120 seconds. Cached responses retain their original collection time; a refresh does not establish the upstream tick time. Mainnet identity receipts use the RPC layer's existing five-minute recheck window. The tool validates **server-declared receipts**; hashes/labels are not independent cryptographic attestation of upstream responses. Direct `provider-check` verifies configured providers independently, and real scanner responses must still be reviewed. Neither is a capacity or uptime guarantee.

`status=PASSED` is scoped to these selected HTTP/source-contract checks. `public_launch` and `telegram_commands` remain UNVERIFIED. This command does not test Telegram delivery, interpreted token extensions, full P/L, public browser access, certificate renewal, monitoring delivery, real host supervision/sandbox or sustained operation. Its result is not deployment authorization.

## Match installed package bytes

`GET /api/health` and authenticated status expose `release`: version, `SCANNER_PACKAGE_CONTENTS` scope and SHA256. The server captures this once at application startup. The client computes the same deterministic hash from the scanner's Python sources and required HTML/JS/CSS assets, with relative filenames and lengths. Bytecode caches, Git metadata, documents, tests, runtime dependencies and secrets are excluded. Missing assets, symlinks or unreadable package files produce UNVERIFIED identity.

A mismatched or older scanner stops before authenticated requests or scans. Run the verifier from the same immutable installed package; differing line endings or modified files also change the digest. This identifies package bytes, not the Git commit, a software signature, process-memory attestation or host integrity. Record the exact Git release commit and successful CI separately. Restart after package changes; the health identity describes bytes captured at startup.

## Offline wire rehearsal

```sh
python -m tests.http_rehearsal --output data/http-verification-rehearsal.json
```

This starts an actual disposable Waitress listener and invokes the production verification CLI. It verifies anonymous access rejection, authorized readiness, package identity, token/wallet wire contracts, client database isolation and target observation persistence. Its sources are explicitly SYNTHETIC. The live-data verifier MUST return FAILED/exit 1; the rehearsal passes only when that rejection and the HTTP checks occur. CI records this separately from the existing actual Caddy crash/backup/restore rehearsal. No provider reads, messages, public hosting or certificates occur.

## Disposable local check with actual provider reads

```sh
python -m tests.live_http_check --live \
  --mint EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v \
  --output data/live-http-release-check.json
```

This explicit utility starts the real production CLI on loopback with disposable private SQLite state and an ephemeral application token, then invokes the HTTP verifier. Only configured RPC settings are carried into that server; deployment and Telegram credentials are excluded. It sends actual permitted provider reads, records checkout head/dirty state and package identity, and removes its own temporary state/listener. The retained output is safe selected evidence. CI never runs it. A failed provider or partial report is a legitimate FAILED/exit 1, not permission to hide a gate or retry aggressively. It does not install/start a host service or deploy publicly.

The dated committed HTTP proof identifies the candidate package hash and pre-publication checkout state. Compare that package hash with the final tested release; the document commit can differ while runtime bytes remain identical. Dated receipts never supply the live UI with prices.

See [setup](SCANNER_SETUP.md), [provider/Telegram integration](SCANNER_INTEGRATIONS.md) and [operations](SCANNER_OPERATIONS.md). Primary references: [Python HTTP requests and redirect handlers](https://docs.python.org/3.12/library/urllib.request.html), [Python TLS contexts](https://docs.python.org/3.12/library/ssl.html), [Solana genesis](https://solana.com/docs/rpc/http/getgenesishash).
