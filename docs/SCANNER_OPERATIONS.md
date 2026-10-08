# Scanner 0.1.2: host preparation and recovery

Status: **IMPLEMENTED / locally TESTED**, **not publicly DEPLOYED**. These templates target a single private workspace on a Linux host with systemd and Python 3.11/3.12. They do not provision infrastructure. Public deployment, spending and production secret changes require separate authorization. Keep reliable holder-capable RPC and authorized Telegram verification as launch gates.

## Prepared host layout

| Path | Owner / permission | Purpose |
| --- | --- | --- |
| `/opt/buildwithaai/releases/<commit>/` | root-owned, service-readable, not service-writable | Existing repository checkout pinned to an audited commit; own `.venv` |
| `/opt/buildwithaai/current` | root-owned symlink | Selected release; keep previous checkout for rollback |
| `/etc/buildwithaai/scanner.env` | root:root, 0600; parent 0700 | Private systemd environment, based on `deploy/scanner/scanner.env.example` |
| `/var/lib/aai-scanner/` | aai-scanner:aai-scanner, 0700 | Database and private snapshots; created by systemd StateDirectory |
| `/etc/systemd/system/aai-scanner.service` | root:root, 0644 | Template in `deploy/scanner/` |
| Caddy configuration and state | Dedicated Caddy service account | TLS edge; never expose application/database directories as files |

Create the `aai-scanner` system user/group without a login shell. Install the approved pinned checkout and create its virtual environment; install `requirements-scanner.txt`. Do not run application code as root. Install Caddy from its official release/package after validating the release signature/checksum. The rehearsal uses **Caddy 2.11.7**, official Linux amd64 archive SHA-256 `727b91701a392de6ebc5027509f548bf39979e5216340d0faed8fa5e69c84f8b`; this digest is also pinned in CI. Recheck advisories when selecting a deployment date.

Set the actual external HTTPS origin in `AAI_PUBLIC_URL`, a privately generated 32–128 character URL-safe token, an absolute persistent DB path, and permitted holder-capable mainnet provider URLs. The supplied example deliberately has an empty token and cannot start. Keep `AAI_HOST=127.0.0.1`, `AAI_PORT=8787`, `AAI_PUBLIC_MODE=1` and `AAI_TELEGRAM_ENABLED=0`. Do not put tokens in commands, URLs, tickets or commit history. This beta uses one shared workspace/token; it is not a public multi-tenant subscription platform.

Set the **Caddy service's** environment `AAI_SITE=https://<approved-domain>` to exactly match `AAI_PUBLIC_URL`; configure it through the Caddy service manager. The scanner's EnvironmentFile is not automatically read by Caddy. `AAI_UPSTREAM` defaults to `127.0.0.1:8787`. The template preserves the external Host, caps body/header size and sets timeouts. Its admin endpoint and config persistence are disabled; apply reviewed changes with a controlled Caddy restart. Do not enable access logging of request bodies, credentials or wallet history. Global Caddy operational logs are separate from access logs.

Before starting public Caddy, confirm authorization, DNS ownership/routing, firewall rules, certificate storage permissions and expected HTTPS origin. Validate its config with `caddy validate --config deploy/scanner/Caddyfile --adapter caddyfile`; validation alone does not issue certificates or prove working public TLS. The local rehearsal uses an explicit HTTP loopback site, avoiding public certificate activity.

Install the systemd unit after authorization. It runs the deployment doctor before serving, limits restart storms, binds through the private configured listener and restricts filesystem writes to managed state/temp directories. `ProtectSystem=strict` makes releases read-only; `StateDirectory` allows persistent writes. No supervisor was installed or started in this coding session. Syntax validation expands only the installation paths to the test checkout. Real boot, systemd sandbox behavior, graceful request drain and automatic restart must still be checked on the approved host. Shutdown can interrupt in-flight scans; acknowledge this maintenance window. SQLite transactions preserve already acknowledged watch writes in the crash rehearsal.

## Operator checks

With the private environment loaded securely by the service manager:

```sh
python -m src.aai_scanner doctor --deployment
python -m src.aai_scanner smoke --mint EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v --require-holders --require-activity --output data/strict-live.json
```

The doctor does no provider or Telegram requests; it checks local prerequisites and DB integrity. It cannot attest DNS/TLS, sufficient provider quota, authorized bot commands, monitoring delivery or launch approval. A strict live smoke must exit 0 with attributed real data before claiming complete core-section retrieval. Historical receipt prices must never feed production reports. Verify actual Telegram commands separately in the authorized private chat with securely provisioned bot configuration.

## Monitoring contract

| Probe | Access | Meaning / action |
| --- | --- | --- |
| `GET /api/health` | No bearer, approved Host | Process responds; restart only for process failure, not optional provider gaps |
| `GET /api/ready` | Bearer, approved Host and origin | 200 local app prerequisites pass; 503 local config/runtime/assets/SQLite failure. Investigate storage rather than repeatedly restarting a corrupt database |
| `ready.data.status` | Same response | Last-report selected-section coverage and retrieval age, NOT continuous upstream health. No scans: UNVERIFIED; partial: UNAVAILABLE; after 120s: STALE |
| `GET /api/status` | Bearer | Last receipts, safe RPC cooldowns/request/failure counters, application/data checks and observation counts |
| Host/service/disk checks | Private operator tools | Disk space, DB/snapshot growth, permission failures, process exits, resource use and backup age |

Do not restart the process just because `data.status` is UNAVAILABLE/STALE; that discards useful cooldowns and does not repair provider quota. Do not treat `ready` HTTP 200 as a public launch certificate. Tokens stay in private monitor configuration, never query strings. Bearer checks share normal API limits; behind the supplied proxy all peers share the loopback rate bucket. Use low-frequency probes (for example health every 30s, ready every 60s) and an approved edge with per-client limits for a broader audience. No alert service or uptime guarantee is included.

## Snapshots and recovery

```sh
python -m src.aai_scanner backup /var/lib/aai-scanner/backup-<unique-timestamp>.sqlite3
python -m src.aai_scanner verify-backup /var/lib/aai-scanner/backup-<unique-timestamp>.sqlite3
python -m src.aai_scanner restore /var/lib/aai-scanner/backup-<unique-timestamp>.sqlite3 /var/lib/aai-scanner/restored-<new-timestamp>.sqlite3
```

Backups can run during service reads/writes using SQLite's online snapshot API. Publication verifies integrity/schema, fsyncs and atomically creates a new 0600 file without overwrite. It requires a filesystem supporting hard links; leave private writable snapshot capacity on the same volume. It does not encrypt snapshots, make off-host copies, schedule retention or establish recovery objectives. Provision encrypted off-host backups separately after authorization and periodically rehearse restoring them. The 30-second progress budget bounds SQLite's retry/copy loop, not a stuck filesystem syscall.

For recovery, stop the scanner (and any bot poller using this DB), retain the original database and its WAL/SHM files together, restore into a **new** file, verify counts, change `AAI_DATABASE` securely, run the doctor as the service user and restart. Do not copy only a live SQLite main file or delete its WAL. Existing destination files, symlinks and sidecars are refused. Future schema versions and corrupted snapshots are refused. A version-1 DB missing required tables is not silently repaired. `restore`/`verify-backup` do not load remote configuration or open the configured live DB. Polling offsets survive recovery; at-least-once Telegram delivery can still repeat a reply.

## Release and rollback

Choose a commit with all CI jobs passed on its exact head; archive its strict live smoke and operational evidence. Prepare a separate root-owned release directory and its dependencies, retain the current release, make and verify a new snapshot, and announce a maintenance window. Stop the scanner, select the prepared release through the current symlink, run the deployment doctor and start it. Check HTTPS/auth, local readiness, a strict real scan and authorized bot commands before admitting users.

For code rollback, stop the service and select the retained previous release. Schema remains **1** in this milestone; verify compatibility before reopening a newer DB with older code. If data rollback is required, restore the pre-upgrade snapshot into a new file and point configuration there. Preserve original files and unsuccessful release directories for diagnosis. No production changes or public launch are performed by these instructions automatically.

## Reproduce this stage locally

```sh
python -m unittest discover -s tests -v
python -m tests.operations_rehearsal --caddy /path/to/caddy --output data/operations-results.json
```

The rehearsal runs the actual Waitress production CLI behind the actual Caddy template on loopback, tests authentication/readiness and a watch write, kills its disposable scanner process, restarts, backs up online, rejects overwrite/corruption, restores to a new file, and checks restarted HTTP persistence plus polling state. It uses fresh private temporary state, not the user's DB. It performs no market/RPC calls, Telegram messages, transactions or public deployment. Without `--caddy`, proxy verification is explicitly NOT_TESTED. Linux `systemd-analyze` is required. CI repeats the full proxy rehearsal and stores its JSON evidence.

Sources: [Caddy reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), [request body limits](https://caddyserver.com/docs/caddyfile/directives/request_body), [global options](https://caddyserver.com/docs/caddyfile/options), [CLI validation](https://caddyserver.com/docs/command-line), [official release](https://github.com/caddyserver/caddy/releases/tag/v2.11.7), [systemd service](https://github.com/systemd/systemd/blob/main/man/systemd.service.xml), [systemd execution settings](https://github.com/systemd/systemd/blob/main/man/systemd.exec.xml).
