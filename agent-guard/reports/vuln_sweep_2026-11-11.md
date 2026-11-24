# Vulnerability sweep: shared box and BuildWithAAI/buildwithAAI (Nov 11, 2026, about 3:43–4:20 AM CST)

Requested by the owner (Zoorped). The sweep was read-only on the repo, the remote and the box configuration. Nothing was pushed, commented, merged or deployed, and DNS, Fly, exchanges and wallets were not touched. Patches were written as files only and not applied: `/workspace/agent-guard/patches/2026-11-11/` (see its README.md). No secret values appear in this report.

Scope:
- the box: audit.py re-run, ports, Docker, keys, tokens, HUD, permissions, /tmp, cron, packages;
- PR #88 at 468dc57 (the deploy candidate);
- PR #91 at bc6489e;
- npm audit;
- gitleaks over the full history (734 commits);
- a fresh code pass for authz, SSRF, injection, CSP, secrets in logs and dependencies.

## Summary
| Sev | # | Item | Where | Patch |
|---|---|---|---|---|
| High | H-1 | Docker Engine API, no auth, no TLS, on 0.0.0.0:2375 | box (dockerd in a sidecar namespace; answers on 127.0.0.1 and 172.30.0.2) | sys-01 (owner) |
| High | H-2 | Plaintext RSA private key, world-readable (0644) since Nov 6 | /workspace/agent-tools/2955f96f-….txt:3 (pem_private_key) | sys-02 (owner: rotate) |
| High | H-3 | Two live Telegram bot tokens injected into every process | TELEGRAM_BOT_TOKEN (fp 36b2a46e, 117 procs), LUMEN_TELEGRAM_BOT_TOKEN (fp b34b1903, 113 procs) | sys-03 (owner: revoke) |
| High (platform) | H-4 | exec-daemon listens on 0.0.0.0 with the literal `--auth-token local` | ports 1337/1338/1339 and 14002–14020/13602–13620 (box processes 430, 1209595, …) | none (platform ticket) |
| Medium | M-1 | N-1r: a few addresses can hold all 200 visitor slots (visitors ON) | src/world/visitors.ts:20-21, 157-169, 257-268, 299-302 @bc6489e | code-04 |
| Medium | M-2 | npm audit: 2 critical, 1 high, 2 moderate (vitest/tinypool, postcss under next) | projects/lumen/package.json @468dc57 and @bc6489e | code-03 / code-08 |
| Medium | M-3 | OS and venv packages with published fixes | zlib1g, libreoffice; pip 25.1.1 in 5 venvs | sys-05 |
| Medium | M-4 | A tool transcript at 0644 holds labelled 64-hex "keys" (ledger keys, possibly HMAC) | /home/box/.cursor/projects/workspace/agent-tools/7ac38f83-….txt:30 | sys-02 |
| Low | L-1 | A pre-forked ledger crash-loops at boot | src/db/db.ts:72 @468dc57 | code-01 |
| Low | L-2 | Cold-start "database is locked" (schema before busy_timeout) | src/db/db.ts:443-445 @468dc57 | code-01 |
| Low | L-3 | USPS exemption also applies to merchant and reason | src/money/checkoutQueue.ts:125 @468dc57 | code-02 |
| Low | L-4 | False positives: IMpb 420+ZIP about 100%, random UUID in receipt 42% | src/money/checkoutQueue.ts:134-215 | code-02 |
| Low | L-5 | Token-field skip applies at any depth. The failure reason is stored uncapped in the append-only ledger | src/money/checkoutQueue.ts:36, 270 | code-02 |
| Low | L-6 | L-14: chunk_chain_broken is sticky and nothing lifts it | src/world/chunkEdits.ts:276, 463-481 @bc6489e | code-05 |
| Low | L-7 | L-16: a runtime fork is not caught until the next boot | src/world/chunkEdits.ts:275-286, 309 @bc6489e | code-05 |
| Low | L-8 | L-15: predeploy writes and migrates, passes on a missing file, has an undeclared vite-node, and nothing runs it | scripts/predeploy-chunk-chain.ts:1-10, package.json:13 @bc6489e | code-06 |
| Low | L-9 | 13 more agent-tools transcripts are world-readable | /home/box/.cursor/projects/workspace/agent-tools/*.txt | sys-04 |
| Low | L-10 | HUD cookie holds the raw HUD token for 30 days (not a session id) | /workspace/aai/aai/hud.py:182, 272 | none (aai repo; recommend a server-side session id) |
| Low/Info | L-11 | The box user has passwordless sudo, so any agent or prompt-injected subprocess is root | box | none (platform design) |
| Info | I-1..I-7 | PR #91 Re-check 2 Info items | see Re-check 2 | code-07 |

## System findings

**H-1 Docker API on 2375.**
- `GET /_ping` returns OK and `/version` returns engine 29.1.4, API 1.52, with no credentials on 127.0.0.1 and on 172.30.0.2.
- The engine reports 0 containers and 1 image.
- dockerd is not in the box's PID namespace, so it runs in a sidecar that shares the network namespace.
- Anyone who can reach the port can start a privileged container that mounts the host. I did not test that, because it would be a write.
- The subnet currently shows only its gateway (172.30.0.1). Real exposure depends on the platform firewall.
- sys-01 drops 2375 except on loopback via nftables. nftables and iptables are not installed, and the sandbox may lack CAP_NET_ADMIN.
- The durable fix is platform-side: a unix socket, or 127.0.0.1 plus `--tlsverify`.
- Owner decision.

**H-2 RSA key.**
- The file still exists: 1790 bytes, mode 0644, owner box. audit.py flags it as pem_private_key at line 3. I did not open it.
- It sat world-readable in a shared workspace for 5 days. Treat it as exposed.
- Rotate the key wherever the public half is trusted, then chmod or delete it (sys-02 does only the chmod).

**H-3 Telegram tokens.**
- Two distinct bot tokens (46 characters, fingerprints above) appear in the environment of nearly every box-user process: bash, node, Xvfb, x11vnc, Chrome and npm.
- They are not set in any rc file, so the platform injects them.
- Any npm or pip postinstall script, or any prompt-injected agent subprocess, can read and exfiltrate them.
- Revoke and reissue both in @BotFather, store them in the vault, and inject each only into the process that needs it.
- sys-03 only unsets them in new interactive shells.
- Owner decision.

**H-4 exec-daemon.**
- `/exec-daemon/index.js serve --port 1337 … --auth-token local` and per-agent copies bind to `*`/0.0.0.0 and answer on 172.30.0.2.
- The token is a literal string, "local".
- I did not try to use it. Any attempt would be an execution. Report it to the platform.

**HUD 127.0.0.1:57025.** AAI_HUD_TOKEN is now set (it was the Medium in the Nov 6 audit).
- Every route is gated.
- There's a Host check.
- Cross-origin POSTs are refused.
- /api/* requires JSON.
- The token file `~/.config/aai/hud_token` is 0600.
- Remaining: L-10. Also, the token sits in the HUD process environment, so any same-uid process can read it from /proc (inherent).

**Listening ports.**
- On 0.0.0.0/*: 2375 (Docker), 1337–1340 (exec-daemon and window router), 6080/6081 (websockify for VNC), 8790, 26500, 50052 (platform, no HTTP answer), and 13602–13620/14002–14020 (per-agent exec-daemons).
- Loopback only: 57025 (HUD), 59xx (x11vnc), 8791.

**Permissions and secrets (audit.py re-run).**
- Summary: 18 CRITICAL, 31 HIGH, 116 LOW.
- After triage, the only real items are H-2 and M-4. The rest are false positives:
  - "possible_seed_phrase" hits on prose: Vercel SKILL.md, i18n bundles, ai-portals JS, live_model_evidence.py:141;
  - `AAI_TEST_ACCESS_TOKEN: synthetic…` in scanner-tests.yml:81;
  - repeated hits from scratch clones in /tmp.

**Other box checks.**
- No crontabs or user systemd units. Shell history is empty.
- /tmp has many browser profile dirs, all at 0700. Cookies and Login Data are 0600.
- The dotenv files found are all `.example`.

**Packages (OSV querybatch, 665 packages).**
- Python: only pip 25.1.1 is affected (12 GHSA) in 5 venvs.
- Debian 13, packages with a fix newer than what's installed:
  - zlib1g +deb13u1 (3 CVEs);
  - libreoffice +deb13u9 (1 CVE);
  - linux 6.12.116 (host kernel, platform only).
- The samba and postgresql-common hits are version-comparison false positives.

## Code findings

**PR #88 @468dc57 (deploy candidate).** The Re-check 6 verdict (GO) stands. The open Lows are now patched:
- **L-1/L-2 → code-01.**
  - Sets busy_timeout before WAL and the schema, and retries SQLITE_BUSY on journal_mode and DDL. Probe: six processes opening a fresh file at once failed 5 of 6 before, and passed 6/6 in three runs after.
  - Creates the unique prev_hash index after the schema. A forked file now boots with `kill=1` and `ledger_forked=1`, one desk alert and one log line, instead of throwing "UNIQUE constraint failed" on every boot.
- **L-3/L-4/L-5 → code-02.**
  - merchant and reason get no USPS/IMpb exemption, so a USPS-valid number hiding a test Visa is rejected there and still accepted in receipt.
  - IMpb 420+5/9-digit ZIP plus a Mod 10-valid USPS number: 0 of 300 flagged.
  - Random UUIDs in receipt: 0.8% flagged (4 of 500), down from 42%. A UUID carrying a 13-digit run is still scanned.
  - The server-token skip now applies only at the top level.
  - The failure reason is reduced to one line with no control characters, at most 200 characters, before it reaches the ledger.
  - SKU-style joining false positives (`12AB3456CD…`) are left as an accepted fail-closed false positive.
- **id/claimToken/token/idempotencyKey storage.** Rechecked: reportCheckout still only compares id and claimToken and stores neither. The route ignores other keys. code-02 removes the nested-object skip.
- **M-2 → code-03.**
  - vitest 3.2.7 pulls tinypool 1.1.1 (GHSA-5gmw-xhrv-c9v3 and GHSA-85c8-ppgw-ccpr, prototype-pollution RCE gadgets) and @vitest/mocker (GHSA-82fw-gwwq-j7x9, GHSA-qxg6-89mg-rqv8). These are dev and CI only.
  - next 15.5.29 pins postcss 8.4.31 (GHSA-6g55-p6wh-862q, GHSA-r28c-9q8g-f849, GHSA-fxqj-rqcc-2cmp, GHSA-qx2v-qp2m-jg93). This is build-time only, with no attacker-controlled CSS today.
  - The patch moves to vitest ^4.1.12, adds a postcss ^8.5.32 override, and declares esbuild (scripts/telegram-poll.mjs imports it, and it only arrived through vite 7). Vite 8 needs the jsx runtime set in vitest.config.
  - npm audit goes from 5 to 0.

**PR #91 @bc6489e.** These are the Re-check 2 items, now patched:
- **code-04 (M-1, N-1r).**
  - At most 8 distinct tokens per address (IPv6 /64) per 15-minute idle window, across move, say and resume.
  - When the list is full of active rows, the prefix holding more than 16 rows loses its oldest-created row.
  - The cap runs after the prefix and rate checks, so a refused request no longer evicts anyone.
  - Attacker cost goes from 7 addresses plus 1 keepalive IP to at least 13 registration prefixes plus 25 keepalive addresses, and fair-share eviction still lets newcomers in.
  - Residual: Sybil resistance is inherent. Consider proof-of-work or owner approval before visitors go ON at scale.
- **code-05 (L-6, L-7).**
  - Each append re-hashes the last row (O(1)). On a mismatch it rolls back, freezes writes and returns CHAIN.
  - The freeze lifts when verify passes, at boot or from the new "Re-check the chunk chain" desk button. Creative and territory flags stay as the owner left them.
  - One existing test changed: its forged legacy row is now correctly chained.
- **code-06 (L-8).**
  - predeploy is now read-only: it never creates the file, never migrates and never writes an alert.
  - It fails on a missing file, on old-hash rows or on a broken chain.
  - vite-node is declared.
  - HOSTING_FLY.md gains a VACUUM INTO copy step. The Fly release machine has no volume, and the runtime image has no scripts, so the check runs on a copy. Check the PowerShell quoting before relying on it.
- **code-07 (Info).**
  - Rejects `\p{Default_Ignorable_Code_Point}`.
  - Nearby filters private chunks before the 64-row cap and orders by seen_at.
  - The chain refuses a Zoora privacy-off row.
  - Adds an import-graph sink test (mutation: importing `nearbyGuests` into src/brain makes it fail).
  - .env.example lists LUMEN_VISITORS_ENABLED and LUMEN_CLAIM_CEILING.
- **code-08.** Same as code-03, regenerated on top of code-06 so the two lockfile edits don't conflict.

**Verification.**
- Each code patch passed `git apply --check` on its base, and each base plus one patch passed tsc, vitest and build.
- Stacked results:
  - 468dc57 + 01,02,03: 211/211 tests, build OK, audit 0.
  - bc6489e + 01,02,04,05,06,07,08: 239/239 tests (41 files), build OK, audit 0, local CSP smoke with system Chrome `csp-smoke-ok`.
- code-01 and code-02 also apply cleanly on bc6489e.

**Fresh pass, no new issues found:**
- **Authz:** every /api/checkout/* route and /api/privacy/charge use checkoutAuth. The Stripe webhook verifies the signature, with a previous-secret rollover. /api/delivery/[token] is token-gated and served with `CSP: sandbox` from middleware (src/middleware.ts:62-66). Owner desk actions sit behind `gate()` (src/app/actions.ts:16-22).
- **SSRF:** server fetches go only to env-configured URLs (LLM base, signer, Solana RPC and price, Stripe), and the DEX quote passes through `vetResearchUrl`.
- **Injection:** visitor and guest text goes through moderateNote and quarantine, and SQL is parameterized.
- **Secrets in logs:** telegramPoll redacts them. No other log line prints a token, header or cookie.
- **Info:** the shop text and SVG delivery branch lacks `X-Content-Type-Options: nosniff` (src/app/api/delivery/[token]/route.ts:25), but the sandbox CSP from middleware covers it.

**gitleaks over the full history (734 commits): 53 hits, all false positives.**
- Solana mint addresses in `TOKEN = "…"` (44-character base58, public).
- Synthetic test keys (zoora-platform tests, telegram.test.ts, brain.test.ts).
- `credential_id` identifiers in evidence JSON.
- Rugcheck and trade fixtures.
- One private-key fixture explicitly named `bridge-localhost-public-test-key.pem`. Make sure it's trusted nowhere.
- No live secret was found in history.

## Owner decisions needed
1. **sys-01 Docker.** Approve the loopback-only firewall, or ask the platform to rebind dockerd. Either could break external Docker use.
2. **sys-02 RSA key.** Rotate it where it's trusted, then chmod 600 or delete it.
3. **sys-03 Telegram.** Revoke and reissue both bot tokens and stop box-wide injection.
4. **H-4.** Report the exec-daemon `--auth-token local` on 0.0.0.0 to the platform.
5. **sys-04 `--delete-stale`** (deletion) and the **sys-05** maintenance window.

## Applied 2026-11-11 (04:08–04:20 CST, owner approval [t34u]: "Fix whatever is needed and remove what's not")

Nothing in the repo or remote was touched, and no code patch was applied (they go to Software Engineer). Exchanges, wallets, DNS and Fly were not touched. No other agent's process or server was touched: not the HUD (it is pid 1125982 on 127.0.0.1:57025, not 905852, and was left alone), not /tmp/zsec-rc3, not the r29 podman containers or /tmp/lumen-r29-*.

| Item | Result |
|---|---|
| sys-01 Docker 2375 | **Applied.** nftables table `inet agentguard_docker` drops tcp/2375 except on lo. Nothing on the box uses Docker over TCP: no DOCKER_HOST in any process environment, no docker CLI, no ~/.docker, no client connections, and the only podman containers (r29) don't use it. Verified from a temporary netns (10.199.0.2, removed after): 172.30.0.2:2375 times out (6 packets dropped), port 6080 on the same IP still returns 200, and 127.0.0.1:2375 still answers. Not persistent across a box restart. **Lasting fix: the platform rebinds dockerd** to a unix socket or 127.0.0.1+TLS. Rollback: `sudo nft delete table inet agentguard_docker`. |
| sys-02 RSA key | **Removed.** chmod 600 first, then `shred -u -z`. Nothing referenced it: no ssh config (no ~/.ssh, empty /root/.ssh, no authorized_keys anywhere), no git remote or sshCommand, no env, script or config. The only mentions were agent-guard reports, and no process held it open. It was a stale Nov 6 tool-output file. The public half is recorded in reports/rsa_key_2955f96f_public_record.txt (600): RSA-2048, SSH `SHA256:pJhSpXlYBOxogUc1vHsrDOOZezB1UaEOW7J36L/0jZg`, MD5 `6d:94:ec:92:e4:f1:b0:d3:d8:41:c4:77:64:d4:6c:4e`, SPKI-DER SHA256 `ccc6cd9c…a2a773a`. On ext4, shred is best-effort: journal and block-remap copies may survive, so **revocation is still required.** |
| sys-02 transcript 7ac38f83 | **Removed** (chmod 600, then shred). A stale Nov 6 tool transcript, not referenced or held open by any agent. |
| sys-03 Telegram | **Applied.** `~/.bashrc` unsets both variables in new interactive shells (backup ~/.bashrc.agentguard.bak). No Telegram poller runs on the box: the Lumen poller runs on Fly, the HUD restart script already strips both variables, and the scanner telegram.py isn't running. Processes that already have them keep them (113 and 110 processes). **Not revoked.** |
| sys-04 permissions | **Applied with a change.** `chmod o-rwx` (to 640) on 958 files (agent-tools transcripts, workspace .db/.sqlite) instead of 600, because the platform user sand-host is in group box and reads through group permissions. Skipped /home/box/sand-data (platform stores) and the mesa caches; /home/box is 0710, so they aren't world-reachable anyway. New agent-tools files are still created 644 (umask), so they'll need re-running or a platform umask fix. |
| sys-04 /tmp | **Deleted 2601 entries, about 35 GB** (disk went from 80% to 52%). Criteria: box-owned, newest file inside untouched for more than 24 h, no process holding it (cwd, exe, open fd or cmdline). That's 2522 Chrome temp leftovers (.com.google.Chrome.*, com.google.Chrome.*, scoped_dir*), 24 zoora-world/zoora-token test dirs, and 55 loose scratch files (screenshots, repo bundles, npm/img/cron logs, a test SMTP key and cert, the latter shredded). Full list: reports/tmp_deleted_2026-11-11.txt (600). Kept: everything newer than 24 h, all sand-*/xvfb/x11vnc/xfce/dbus/xdg platform and desktop files, root-owned and sand-host files, .sand-browser, cursor-mcp-browser-opens, mt5_adapter.bak (possibly someone's rollback copy), uv locks, /tmp/zsec-rc3 and /tmp/zsec-tools. /tmp/lumen-r19-scratch no longer existed. |
| sys-05 apt | **Blocked, not applied.** apt-get update fails: the platform egress at 198.18.0.1 returns 500 for apt on trixie-security and trixie-updates (TLS EOF over https), although curl to the same URL returns 200. I tried apt's own transport options and a one-off https source list, with no config changes. I didn't hand-install .debs around apt. zlib1g stays at 1:1.3.dfsg+really1.3.1-1+b1 and libreoffice at +deb13u8 (no soffice running). **Platform egress fix needed**, then re-run sys-05. |
| sys-05 pip | **Applied.** pip 25.1.1 → 26.3 in /workspace/aai/.venv, fa-venv, security-pipeline/.venv, solana-meme-risk/.venv and tiktok/.venv. OSV lists 0 advisories for 26.3. No service was restarted. |

**audit.py comparison** (reports/audit_20261111T034349.json vs audit_20261111T041521.json):
- Before: 18 CRITICAL, 8 HIGH, 116 LOW, 6 INFO-platform.
- After: 16 CRITICAL, 10 HIGH, 113 LOW, 6 INFO-platform.
- Resolved: the pem_private_key and evm_private_key hits (the two real ones). The rest of the churn is scratch clones: my deleted zsec11 worktrees and lumen-r28-9b drop out, and the r29 executor's new /tmp/lumen-r29* clones add the same false positives.
- New CRITICAL/HIGH: /tmp/lumen-r29-sec/env (evm_private_key, lumen_desk_secret, owner_access_token, owner_session_secret). It's another agent's r29 test env from 04:08, mode 600 in a 700 dir, so it isn't exposed. Left alone. That agent should delete it when its run ends.
- Net real findings: 0 real CRITICAL left on the box.

**Still with the owner or platform:**
1. Revoke and reissue both Telegram bot tokens in @BotFather (fingerprints 36b2a46e and b34b1903), and stop box-wide injection.
2. Revoke the RSA key above wherever it's trusted (GitHub or deploy keys, servers, signing).
3. Platform report: exec-daemon on 0.0.0.0 with `--auth-token local`, dockerd on 0.0.0.0:2375 (rebind it; the nft rule is a stopgap until the box restarts), apt egress returning 500, and the 644 umask on agent-tools files.
