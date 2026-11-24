# Zoora's world (Lumen) — independent pre-launch security pass
Head of Security · Tue Nov 10, 2026, 2:55 PM CST · read-only

**Scope.** PR BuildWithAAI/buildwithAAI#88, branch `cursor/lumen-jellyfish-9263`, project `projects/lumen`.
- **The branch moved.** The brief named c001f2e, but the PR head is now **72176cc** (pushed Nov 10, 2:43 PM CST). Four commits sit on top: d312c10, d4dcd31 and 6bc8b54 (money fixes), plus **8488500** (the zoora.ai site changes: the www→apex redirect, the Kit signup form, a CSP change and LUMEN_ORIGIN in fly.toml). Head of Systems' last delta stopped at c001f2e. This pass covers 72176cc.
- PR state: open, mergeable "clean", one check (`next-build`) green on 72176cc. The repo is **public**.

**Method.** I did nothing beyond reading and local testing: no push, comment, merge, deploy, fly command, DNS change, or secret edit.
- A throwaway public clone in /tmp, with gitleaks 8.21.2 run over all 91 branches (689 commits).
- `npm audit --package-lock-only`.
- A local `next build` of the standalone image and `node server.js` with the fly.toml env and fake owner secrets.
- curl probes, plus headless Chrome to check the CSP.
- Public DNS read through DNS-over-HTTPS (dig isn't installed), crt.sh, and the GitHub repo and PR metadata.
- Cleanup: the scratch clone, build, test DB and scan outputs were removed afterwards. Only the gitleaks binary is left, at /tmp/zsec-tools.

The RSA key file was only stat'ed. It was excluded from my own scan by building a hard-link set without it; those links have since been removed and the originals are intact (843 files).

---
## Verdict
**Public no-money launch: NOT YET. Fix 2 items and settle 1 decision first, then GO.** Nothing in the app can spend, sell, mint or trade with fly.toml as it ships (Head of Systems verified this, and nothing in 8488500 changes it). The blockers are:
1. **HIGH:** the CSP breaks the site in real browsers.
2. **HIGH:** the public repo has secret scanning, push protection and Dependabot all off.
3. A **cutover order** for zoora.ai DNS that avoids a dangling record or takeover window. Email spoofing protection (DMARC) should land the same day.

---
## 1. Findings for PR #88 (at 72176cc)

### HIGH
**H1. The CSP blocks Next.js's own inline scripts, so no page hydrates in a browser.** `src/auth/publicMode.ts:47` (sent via `next.config.ts` `headers()`).
- `script-src 'self'` has no nonce, hash or `'unsafe-inline'`. App Router pages ship inline `self.__next_f.push(...)` scripts; the home page has 14.
- Headless Chrome on `/world` logged repeated "Executing inline script violates … script-src 'self'".
- Effect: every client component is dead, including the 3D world view and anything interactive. Plain HTML forms like the Kit signup still post.
- Earlier reviews checked headers with curl, so they couldn't catch this.
- Fix: use a **nonce-based CSP from middleware**, the Next.js documented pattern:
  - Per request, generate a nonce and send `script-src 'self' 'nonce-<n>' 'strict-dynamic'`. Keep the other directives, and drop the static CSP from `headers()`.
  - The layout is already `force-dynamic`.
  - Don't "fix" it with `'unsafe-inline'`.
- Add a Playwright or Chrome test that fails on any CSP console violation for `/` and `/world`.

**H2. Public repo with no secret scanning, push protection or Dependabot.** GitHub repo settings: `secret_scanning`, `secret_scanning_push_protection`, `dependabot_security_updates` and the non-provider patterns are all `disabled`.
- Many agents push to this public repo, so one leaked token is public within seconds.
- Fix (owner): Settings → Code security → turn on Secret scanning, Push protection, Dependabot alerts and Dependabot security updates. Add `.github/dependabot.yml` for `npm` in `/projects/lumen` and for `github-actions`.

### MEDIUM
**M1. `/index.html` and `/success.html` redirect to `https://localhost:3000/...`.** `src/middleware.ts:75` (`new URL(target, request.url)`).
- Reproduced with `Host: zoora.ai`, `X-Forwarded-Host: zoora.ai`, `X-Forwarded-Proto: https` and `HOSTNAME=0.0.0.0`. I got `301 https://localhost:39123/success`. On Fly that becomes localhost:3000.
- If Kit's form "success" redirect, or old links, point at `/success.html`, new subscribers land on a broken page.
- Fix: build the absolute URL from the apex: `NextResponse.redirect(new URL(path + search, APEX), 301)`. Also set Kit's redirect URL to `https://zoora.ai/success`.

**M2. The owner-login gate fails open: a missing header counts as trusted.** `src/auth/publicMode.ts:20-23`; uses at `src/app/actions.ts:38,66`, `src/app/admin/page.tsx:15-16` and `src/app/admin/ledger/page.tsx:17-18`.
- The login form and the login action are served to any request that has no Fly-Client-IP, or an empty one. I verified that an empty or whitespace value opens `/admin/login`.
- This is fine for Fly's public edge, which always sets the header. It is not fine for anything else that reaches port 3000: another app in the same Fly org over 6PN/`.internal`, a future non-HTTP service, or a sidecar.
- Separately, `gate()` (`actions.ts:16-20`) and the admin pages accept a valid session cookie **from the public edge**, so a stolen cookie works on zoora.ai.
- Fix:
  - Use a positive signal. Run the desk on a second, internal-only port that isn't in `[http_service]` (e.g. 3001, reached via `fly proxy 3001:3001`), or require a desk-only header secret in addition to the missing Fly-Client-IP.
  - Also apply `loginReachable()` inside `gate()` and the admin pages, so owner sessions only work off the public edge.
  - Keep `lumen-tidepool` alone in its Fly org, or at least with no internet-facing apps that can make outbound requests.

**M3. The zoora.ai email domain can be spoofed.** Public DNS today:
- SPF `v=spf1 include:spf.efwd.registrar-servers.com ~all` (softfail)
- **no DMARC** (`_dmarc` NXDOMAIN)
- no DKIM for Kit
- MX = Namecheap email forwarding
- Fix: see section 1b steps 7-8.

**M4. No CAA records and no DNSSEC** (no DS at `.ai`). See 1b steps 6 and 9.

**M5. The cutover plan is incomplete, and there's a takeover window if steps run out of order.**
- `HOSTING_FLY.md:151-178` documents only `world.zoora.ai`, but the launch is on the **apex and www**.
- `www.zoora.ai` is a CNAME to `buildwithaai.github.io`, the apex has GitHub Pages A records, and `sites/zoora-newsletter/public/CNAME` (on main) claims the domain on Pages.
- `lumen-tidepool.fly.dev` is NXDOMAIN, so the Fly app hasn't been created yet.
- Fix: follow the order in section 1b and add an apex/www section to HOSTING_FLY.md (A + AAAA for the apex, since Namecheap can't CNAME the apex).

### LOW
- **L1. Dependencies** (`package-lock.json`).
  - Next **15.5.29**: no direct advisory. It's patched for CVE-2025-29927, and middleware does no auth anyway. Probing with `x-middleware-subrequest` still gave 404 on /admin.
  - Advisories:
    - `postcss` ≤8.5.22 (HIGH, via next): build-time CSS tooling only, not reachable at runtime.
    - `vitest` 3.2.7 / `tinypool` (CRITICAL) and `@vitest/mocker`: dev-only, not in the standalone image, CI exposure only.
  - Fix: plan a vitest ≥5.1 upgrade, and take Next 15.5.x patch bumps through Dependabot.
- **L2. Docker image hardening.** `Dockerfile:1,10` uses `node:22-bookworm-slim` with no digest pin. `Dockerfile:20` runs `chown -R node:node /app /data`, so the runtime user can rewrite app code. Fix: pin `@sha256:` digests, and chown only `/data`. Root-owned `/app` is enough.
- **L3. HSTS.** `max-age=31536000; includeSubDomains`, no preload (good). Every subdomain then has to serve HTTPS, including any future Kit or link-tracking CNAME. **Don't submit to the preload list** until zoora.ai has run on Fly for several weeks.
- **L4. Same-origin SVG.** `src/app/api/delivery/[token]/route.ts:13` serves SVG inline on the zoora.ai origin, and `src/app/gallery/page.tsx:18` uses `dangerouslySetInnerHTML` for `art.svg`. Today the SVG is purely procedural (`src/brain/art.ts:16`, a hex-validated colour and numbers), so it's safe. Defence in depth: add `Content-Security-Policy: sandbox` and `X-Content-Type-Options: nosniff` on delivery responses, and keep a test proving no visitor, LLM or web text reaches `svg`.
- **L5. No app logging.** There's no `console.*` anywhere in `src/`, so Fly logs will show nothing about 429 spikes, held notes, webhook rejects or 5xx causes. Fix: add one-line structured logs (no bodies, tokens or IPs beyond /24 or /48) for 429s, login attempts, webhook BAD_SIGNATURE, 413s and unhandled errors.
- **L6. Public test private key.** `projects/zoora-agent-community/tests/fixtures/bridge-localhost-public-test-key.pem` is a PKCS#8 private key for a localhost test cert. It's a fixture, but scanners will keep flagging it. Fix: add a `.gitleaks.toml` allowlist entry and a README note; never reuse it.
- **L7. /48 eviction scan.** `src/auth/ownerToken.ts` `addPrefix48Miss` loops over the whole 4,096-entry map on every insert once the map is full of live blocks. That's bounded and fine, but O(n) per miss under attack; prune on a timer.
- **L8. Where to deploy from.** The box shares one uid across all agents and has an unauthenticated Docker API (section 3). Run `fly auth`/`fly deploy`/`fly secrets import` from **Zoorped's own machine**, not this box. A Fly API token on the box can be read and used by any agent.

### Checked and OK
- **Secrets handling**
  - Branch history: gitleaks found no real secrets in 689 commits across 91 branches. The 49 hits are Solana mint and token addresses, a `sk_test_` placeholder (`projects/lumen/tests/brain.test.ts:220`), synthetic test keys, 32-hex credential IDs in evidence JSON, and the fixture key above.
  - No `.env` was ever committed; only `.env.example` and `.env.scanner.example`, both empty.
  - No `NEXT_PUBLIC_*` in Lumen. No secrets in fly.toml or the Dockerfile. `.dockerignore` covers `.env` and `.env.*`.
- **Fly config**
  - `[env]` holds config only: LUMEN_PUBLIC_MODE=true, LUMEN_ORIGIN=https://zoora.ai, LUMEN_TRUSTED_PROXY=fly, PORT=3000, LUMEN_DATA.
  - `force_https`; concurrency hard_limit 25; health check on `/healthz`.
  - Runs as `node` via gosu; standalone output; a 1GB volume with snapshots (5-day retention).
- **Headers sent on every route, including API:** CSP (but see H1), HSTS, XFO DENY, nosniff, Referrer-Policy no-referrer, Permissions-Policy, COOP, CORP; `X-Powered-By` is off.
- **Route probes** with Fly-Client-IP set: `/admin`, `/admin/login`, `/admin/ledger`, `/.env` and `/api/delivery/x` all return 404. `/api/jarvis/chat` and `/api/checkout` return 401; `/world` and `/success` 200. www → `https://zoora.ai/<path>` keeps the path.
- **Auth details:** bearer tokens are compared with `timingSafeEqual` everywhere (owner, jarvis, world, stripe, signer). No CORS headers are emitted, so the browser same-origin default applies.
- **Input handling and rate limits:** covered in depth by Head of Systems (re-reviews 9-16); nothing in 8488500 reopens them. The Kit form posts straight from the browser to Kit with no server proxy and no API key, and CSP `form-action` allows only `'self' https://app.kit.com`.

## 1b. DNS cutover plan for zoora.ai (owner-run, in this order)
Today, per public DNS on Nov 10, 2:47 PM CST:
- NS: Namecheap (`dns1/2.registrar-servers.com`)
- Apex A: GitHub Pages ×4, no AAAA
- `www`: CNAME to `buildwithaai.github.io`
- MX: Namecheap eforward; SPF `~all`; no DMARC, CAA or DS
- `world.zoora.ai`: doesn't exist
- crt.sh shows 2 certificates, both Let's Encrypt for www.

Steps:
1. **Before touching DNS:** in GitHub org settings → Pages → **Verified domains**, verify `zoora.ai`. This stops any other GitHub account from claiming `www`/apex on Pages while records still point at GitHub.
2. Lower the TTL on the apex and `www` to 300s a day ahead, if Namecheap allows it.
3. Create the Fly app in Zoorped's org (`lumen-tidepool`), deploy, and confirm `https://lumen-tidepool.fly.dev/healthz` returns 200 and `/admin/login` returns 404. Do this from Zoorped's machine (L8).
4. Run `fly certs add zoora.ai` and `fly certs add www.zoora.ai`, then `fly ips list` (shared IPv4 + IPv6; no dedicated IPv4 needed).
5. In Namecheap, **in one sitting**:
   - Replace the 4 GitHub A records on `@` with Fly's A (shared v4) plus AAAA.
   - Change `www` to CNAME `lumen-tidepool.fly.dev`.
   - Don't add `world` unless it's used. If it is, add it the same way and add the cert.
6. Run `fly certs check` for both names until "Issued". **Then** add CAA records: `0 issue "letsencrypt.org"`, `0 issuewild ";"` and `0 iodef "mailto:<owner inbox>"`. Re-check against Fly's docs for which CA Fly currently uses before adding, because a wrong CAA silently breaks renewals.
7. **Email, same day.** Add `_dmarc` TXT `v=DMARC1; p=none; rua=mailto:<owner inbox>; fo=1`.
   - If Kit sends as `@zoora.ai`, add Kit's DKIM/SPF records from Kit's domain-authentication page.
   - After about 2 weeks of clean reports, move to `p=quarantine`, then `p=reject`.
   - Tighten SPF to `-all` once every sender is listed.
8. If any subdomain never sends mail, publish `v=spf1 -all` on it, and keep DMARC `sp=reject` once you're at reject.
9. **After about a week of stable running,** enable DNSSEC in Namecheap (Advanced DNS → DNSSEC; Namecheap publishes the DS to `.ai`). Don't do it mid-cutover.
10. Retire Pages last: remove the custom domain from the newsletter Pages site (`sites/zoora-newsletter/public/CNAME`) only **after** DNS points at Fly. Keep the GitHub domain verification permanently.
11. Afterwards, verify:
    - `curl -sI https://zoora.ai/` shows the headers and `server` is not GitHub.
    - `/admin/login` is 404 and `/healthz` is 200.
    - `http://` → `https://` works.
    - `https://www.zoora.ai/x` → `https://zoora.ai/x`.
    - No GitHub A records remain anywhere.

---
## 2. Post-launch monitoring plan
| Check | Where | How often | Alert when |
|---|---|---|---|
| Uptime `/healthz` | Box (S1) + external (UptimeRobot/Better Stack free tier) | 5 min | not 200 twice in a row |
| TLS expiry, apex + www | Box (S1) | daily | < 21 days, or issuer changes |
| Security-header regression + closed routes | Box (S2) | hourly | any header missing; `/admin*` not 404; `/.env` not 404; any CSP violation on `/` and `/world` (headless Chrome) |
| DNS change watch | Box (S3) | 15 min | any change to A/AAAA/CNAME/MX/TXT/CAA/NS/DS or `_dmarc`, or new subdomains in CT |
| Cert Transparency | Box (S3, crt.sh) | hourly | new cert for `*.zoora.ai`, or an issuer other than Let's Encrypt |
| Lookalike/phishing domains | Box (S4, `dnstwist`) | daily | a new registered permutation, especially with MX or a live web server |
| Secret scan of the public repo | Box (S5, gitleaks) | hourly | a new finding vs the baseline; plus GitHub secret scanning + push protection (H2) |
| Dependency alerts | GitHub Dependabot (H2) + box `npm audit` (S5) | daily | new high/critical in prod deps |
| Fly errors, restarts, memory | Fly dashboard / Grafana (fly-metrics.net) alerts, owner-side | live | 5xx > 1% over 5 min, restart, memory > 400MB of 512MB, health check failing |
| Abuse / rate limits | App logs (needs L5) → Fly log alert; box can only sample `/ideas` and `/guestbook` | 15 min | 429 burst, global guestbook cap hit, BAD_SIGNATURE spike |
| DMARC reports | Owner inbox | weekly | spoofed sends from zoora.ai |

Box-runnable proposals (not installed, and no cron created). They're read-only and public-only, need no Fly token, and alerts would go to the existing desk or Telegram path:
```bash
# S1 uptime + TLS
curl -fsS -m 10 https://zoora.ai/healthz | grep -q '"ok":true' || echo "ALERT healthz"
for h in zoora.ai www.zoora.ai; do echo | openssl s_client -servername $h -connect $h:443 2>/dev/null | openssl x509 -noout -enddate -issuer; done   # alert if <21d or issuer changes
# S2 headers + closed routes + CSP-in-browser
H=$(curl -sSI -m 10 https://zoora.ai/); for k in content-security-policy strict-transport-security x-frame-options x-content-type-options referrer-policy permissions-policy; do echo "$H" | grep -qi "^$k:" || echo "ALERT missing $k"; done
for p in /admin /admin/login /admin/ledger /.env; do c=$(curl -s -o /dev/null -w '%{http_code}' https://zoora.ai$p); [ "$c" = 404 ] || echo "ALERT $p=$c"; done
timeout 40 google-chrome --headless=new --no-sandbox --enable-logging=stderr --virtual-time-budget=5000 --dump-dom https://zoora.ai/world 2>&1 >/dev/null | grep -c 'Content Security Policy'   # want 0
# S3 DNS + CT (DoH, since dig is not installed)
for n in zoora.ai www.zoora.ai _dmarc.zoora.ai; do for t in A AAAA CNAME MX TXT CAA NS DS; do curl -s "https://dns.google/resolve?name=$n&type=$t" | python3 -c 'import json,sys;print(sorted(a["data"] for a in json.load(sys.stdin).get("Answer",[])))'; done; done | sha256sum   # diff vs stored baseline
curl -s 'https://crt.sh/?q=%25.zoora.ai&output=json' | python3 -c 'import json,sys;print(sorted({(c["id"],c["name_value"],c["issuer_name"]) for c in json.load(sys.stdin)}))'   # diff vs baseline
# S4 lookalikes (one-time: pip install --user dnstwist)
dnstwist --registered --format csv zoora.ai   # diff vs baseline
# S5 repo secrets + deps (anonymous public clone, read-only)
git -C /tmp/zoora-watch fetch -q --all && /tmp/zsec-tools/gitleaks git --log-opts="--all --since=2.hours" --redact -r /tmp/gl.json /tmp/zoora-watch
cd /tmp/zoora-watch/projects/lumen && npm audit --package-lock-only --omit=dev --audit-level=high
```
Needs the owner (not the box): Fly metrics and log alerts, GitHub security features, DMARC rua inbox, an external uptime monitor.

---
## 3. agent-guard re-check
`python3 audit.py --budget 240` ran at **2:48 PM CST** in 31s, exit 2.
- Report: `reports/audit_20261110T144851.json` and `latest.md`.
- Summary: CRITICAL 7, HIGH 18, MEDIUM 1, LOW 50.
- The counts are inflated by my scratch clone under /tmp and a since-removed /tmp/lumen-r17 copy.

### Re-triage of CRITICAL / HIGH
| Sev (tool) | Location | Verdict |
|---|---|---|
| CRITICAL pem_private_key | `/workspace/agent-tools/2955f96f-ed4d-4358-920f-017bff5a4b7d.txt:3` | **REAL.** A plaintext RSA private key, still present: mode **644**, box:box, 1,790 B, mtime Nov 6 3:52 PM CST. Its owning service is still unidentified. **Blocker remains.** Not opened. |
| CRITICAL evm_private_key | `/home/box/.cursor/projects/workspace/agent-tools/7ac38f83-1261-40e9-b553-1b57f89d90b6.txt:30` | **False positive.** A list of 64-hex SHA-256 dedupe keys from the `tg_send.py` message ledger (the file shows `hashlib.sha256(...)` producing the key). Not a key. While checking it, a 9-character fragment of one of these non-secret hashes showed in my terminal. |
| CRITICAL possible_seed_phrase | `…/projects/zoora-agent-community/scripts/live_model_evidence.py:141` (flybrain/repo, roadmap-audit, my clone) | **False positive.** An English test-assertion message with punctuation, a slash and several non-BIP39 words. It's not a mnemonic, a BIP39 test vector or a wordlist. Words not printed. |
| CRITICAL possible_seed_phrase ×2 | Vercel plugin `skills/flags-sdk/SKILL.md:171`, `upstream/SKILL.md:70` | **False positive** (platform docs prose). |
| HIGH kv:aai_test_access_token ×4 | `.github/workflows/scanner-tests.yml:81` (all copies) | **False positive.** A 38-character `synthetic_…` CI value. |
| HIGH listener | `0.0.0.0:2375` Docker Engine API | **REAL, still open.** `GET /_ping` → `OK` with no auth at 2:52 PM CST. Platform-owned. **Blocker remains.** |
| HIGH trading_code ×2 | `zoora_community/practice_engine.py` | **False positive.** An HMAC over a synthetic world ("No network, signer… or real money"). |
| HIGH loose perms ×10 | as listed | Only the RSA file matters (should be 600, and really deleted after rotation). The rest are public repo files. |
| HIGH (HUD) | `aai hud` pid 748286 on 127.0.0.1:57025 | **REAL.** No `AAI_HUD_TOKEN`; `GET /` → 200 with no auth. Loopback only, but on a shared uid any agent or process can drive it. **Blocker remains.** |
| INFO | `TELEGRAM_BOT_TOKEN` in a process env | Name only, value not read. Same shared-uid exposure. |

### (a) Possible keys in /workspace/agent-tools, classified
I scanned **842 files** (all except the RSA file) with gitleaks:
- 1,459 generic hits in 308 files, **0 real**.
  - 1,151 are Solana token mint addresses (`tokenAddress`, base58 43-45 chars).
  - 306 are X API pagination cursors (`next_token`/`previous_token`).
  - 2 are `token` fields holding token addresses.
- The audit's stronger patterns (PEM, EVM 64-hex with a key label, Solana keypair arrays, labelled base58 secrets) hit **only** the RSA file.

I also scanned `/home/box/.cursor/projects/workspace/agent-tools` (89 files):
- 22 hits, **0 real**: EVM or SPL contract and mint addresses, and one scraped TikTok page (`9e796654…txt:2`) carrying that site's public Firebase web API key, a CSRF token and UrlKeys. Those are public page-embedded values. Info only.
- Plus the 7ac38f83 hash list above.

### (b) Seed-phrase hit "in the flybrain script"
`/workspace/flybrain/repo/projects/zoora-agent-community/scripts/live_model_evidence.py:141` is the same line in all three copies. It's a false positive, as above. To quiet the scanner, add `# agent-guard: allow-prose` or an allowlist entry.

### Earlier go-live blockers
| Blocker | Status Nov 10, 2:55 PM CST |
|---|---|
| Plaintext RSA key in `/workspace/agent-tools` | **OPEN** (present, 644) |
| Docker API 2375 without auth | **OPEN** (answers unauthenticated) |
| Shared uid for all agents | **OPEN** (everything runs as uid 1000 `box`) |
| Exchange keys not hardened | **OPEN on the exchange side, unverifiable from here.** No exchange keys are on the box; the env-name scan only found TELEGRAM_BOT_TOKEN. Trade-only, no withdrawals, IP allowlist and capped sub-account are still unconfirmed. |
| HUD without AAI_HUD_TOKEN | **OPEN** |

These are box-level blockers for **live trading or keys**. They don't block the Fly-hosted zoora.ai launch **as long as** Fly credentials and app secrets never touch this box (L8).

---
# Re-verification at 19541ca / 2f5d1c6 (Tue Nov 10, 2026, 3:20 PM CST)
**Method.** Read-only.
- A fresh anonymous public clone in /tmp at **2f5d1c6** (the PR head; 19541ca holds the code, 2f5d1c6 the build log). The range 72176cc..2f5d1c6 is 5 commits and 75 files.
- `npm ci` and `next build` (exit 0); vitest **178/178** in a clean env; `tsc` 0.
- The standalone `server.js` plus `desk-proxy.mjs` run locally with the fly.toml env and fake owner secrets.
- Playwright 1.55.1 driving the box's Chrome with extensions off; curl probes; the GitHub API.
- I made no push, comment, merge, deploy, fly command, DNS change or settings change.
- Cleanup: the scratch clone, test DB, servers and scripts were deleted afterwards.
- One process here isn't mine and I left it alone: a `node ./desk-proxy.mjs` under `/app` (pid 807843, started about 3:17 PM CST). It's probably Software Engineer's container test.

Their labels map to my original IDs: M3=M1, M4=M2, M5=M5, L6=L2, L7=L4, L8=L5, L9=L1, L10=L6, L11=L7.

| Item | Result | Evidence |
|---|---|---|
| **H1 nonce CSP** | **PASS (code). FAIL (CI guard)** | See H1 notes below. |
| **H2 repo security** | **PASS** | `.github/dependabot.yml` covers npm `/projects/lumen` and github-actions weekly. GitHub API now shows `secret_scanning`, `secret_scanning_push_protection` and `dependabot_security_updates` **enabled**. Non-provider patterns and validity checks are still disabled (optional). |
| **M3 (my M1) redirects** | **PASS** | `/index.html` → `https://zoora.ai/` and `/success.html?x=1` → `https://zoora.ai/success?x=1`, with `X-Forwarded-Host` as zoora.ai or evil.example and `X-Forwarded-Proto: http`. `www` + `/world?a=b` → `https://zoora.ai/world?a=b`. `//evil.example/x` gets Next's same-host 308 slash-collapse, not an open redirect. |
| **M4 (my M2) desk gate** | **PARTIAL** | See M4 notes below. |
| **M5 apex docs** | **PASS with gaps** | See M5 notes below. |
| **L6 (my L2) image** | **PASS** | Both stages are pinned at `node:22-bookworm-slim@sha256:aaa4b5ba…`. Only `/data` is chowned (`Dockerfile:19` and the entrypoint), so `/app` stays root-owned. |
| **L7 (my L4) SVG sandbox** | **FAIL** | See L7 notes below. |
| **L8 (my L5) logging** | **PASS** | See L8 notes below. |
| **L11 (my L7) /48 eviction** | **PASS (Low residual)** | See L11 notes below. |
| **L10 (my L6) gitleaks allowlist** | **FAIL, and it's a regression** | See L10 notes below. |
| **L9 (my L1) vitest** | Deferred, **accepted** | Dev-only. The production audit (`--omit=dev`) shows only `next` (moderate) and `postcss` (high), both build-time postcss. |

### H1 notes
- **CSP header:** `src/middleware.ts:34-62` and `src/auth/publicMode.ts:62-73` produce `script-src 'self' 'nonce-…' 'strict-dynamic'`. There's no `unsafe-inline` for scripts, and the static CSP is gone from `headers()`.
- **Nonce quality:** 16 bytes from `crypto.getRandomValues`. All 40 requests across `/ /world /guestbook /gallery /success` got 40 unique nonces. Every `<script>` carried exactly the header nonce, with no script missing one.
- **Caching:** responses are `Cache-Control: private, no-cache, no-store`, with no `age` or `x-nextjs-cache`.
- **In the browser:** Playwright on `/`, `/world` and `/guestbook` showed `data-hydrated=yes`, **0 CSP violations**, 0 console errors and 0 page errors. `/world` rendered its canvas and the "Drag to look around" tip.
- **CI guard:** the `next-build` check on 2f5d1c6 **failed** at "Install Playwright Chromium" (`npx playwright install --with-deps`), so the smoke step was **skipped**. The smoke script also writes to `/opt/cursor/artifacts` (`scripts/csp-smoke.mjs`), a path that probably isn't writable on GitHub's runners.

### M4 notes
**PASS:**
- On :3000, `/admin`, `/admin/login` and `/admin/ledger` return **404** for all of these: a public Fly-Client-IP, a missing header, an empty header, and a forged `x-lumen-desk`.
- `gate()` (`actions.ts:16-21`), `logout`, the login and admin pages, and `ledger` all call `loginReachable(flyIp, env, x-lumen-desk)`. That compare is constant-time, against a 24-byte random secret generated at boot.
- I logged in through the desk proxy, then replayed that **session cookie with Fly-Client-IP on :3000**. `/admin` and `/admin/ledger` both returned **404**.
- In `fly.toml`, `[http_service] internal_port=3000` is the only service. There's no `[[services]]`, so 3001 can't be reached from the public edge.

**FAIL:**
- (a) **The desk proxy won't start in the image.** `docker-entrypoint.sh` runs `gosu node ./desk-proxy.mjs &`, but `desk-proxy.mjs` is mode **100644 with no shebang**. Reproduced: exec gives "Permission denied" (126), and even with +x, sh hits a syntax error. The owner would have no desk at all. It fails closed, so this is functional, not a security hole. Fix: `gosu node node ./desk-proxy.mjs &`.
- (b) The proxy listens on `0.0.0.0` (IPv4 only). `fly proxy` reaches machines over 6PN IPv6, so bind `::` and confirm `fly proxy 3001:3001` works on the first deploy.
- (c) `src/app/api/checkout/auth.ts:46` still accepts the **owner session cookie from the public edge**. Replayed with Fly-Client-IP, `/api/checkout/report` passed auth and returned `400 CLAIM`, not 401. Low for a no-money launch; fix before any money.

### M5 notes
- `HOSTING_FLY.md` "Apex zoora.ai and www" gets the order right where it matters:
  - verify the domain in GitHub Pages first
  - keep the MX and SPF records
  - A and AAAA from `fly ips list`, `www` CNAME to `lumen-tidepool.fly.dev`
  - `fly certs add` and `check` for both names
  - remove the GitHub Pages custom domain **after** zoora.ai serves the app
- Gaps compared with section 1b:
  - it doesn't say to keep the GitHub verification permanently
  - no TTL lowering
  - no CAA after the certs issue
  - no DMARC (`p=none` then tightened) or Kit DKIM
  - no DNSSEC a week later
  - no post-cutover verification list
- The table comes before the `fly certs add` block. Say explicitly to run `certs add` right before switching DNS.

### L7 notes
- The route sets `Content-Security-Policy: sandbox` (`api/delivery/[token]/route.ts`), but the middleware **overwrites** it. Live response for a test delivery token: `content-security-policy: default-src 'self'; … script-src 'self' 'nonce-…' 'strict-dynamic' …`, with no `sandbox`. `nosniff` is present.
- Fix: in middleware, send `sandbox` (or `default-src 'none'; style-src 'unsafe-inline'; sandbox`) for `/api/delivery/*` instead of the page CSP.
- New functional bug: `labelDownload()` (`src/shop/delivery.ts`) puts the licence comment **before** `<?xml …?>`. The XML declaration then isn't at the start, so the SVG is malformed and browsers won't render it. Put the comment after the declaration. This is Low today because sales are off.

### L8 notes
- `src/http/log.ts` writes fixed fields only: ts, event, status, route.
- All 20 call sites pass constant strings.
- `instrumentation.ts` `onRequestError` logs only the error name and the route template.
- The desk proxy logs only a boot failure.
- No bodies, tokens, cookies, IPs, notes or secrets are logged.

### L11 notes
`addPrefix48Miss` now evicts from an insertion-ordered `prefix48Evict` map, so eviction is O(1). Pruning is amortized every 60s on request, not on a timer. Blocked buckets are never in the eviction set, so while an attack is going on the map can grow past 4,096. That's bounded by the 15-minute expiry and the request rate (an estimated tens of MB at about 500 req/s). Low.

### L10 notes
- `.gitleaks.toml` has only `[allowlist]` and no `[extend] useDefault = true`. In gitleaks 8 a custom config **replaces** the default rules.
- So anyone running gitleaks from the repo root (CI, pre-commit, me) now gets **zero rules and zero findings**: full history gives 0, against 48 with `useDefault` plus the same allowlist.
- Fix: add `[extend]\nuseDefault = true` above `[allowlist]`. GitHub secret scanning is unaffected.

**New commits.**
- **Secrets:** gitleaks (default rules) over 72176cc..2f5d1c6 found none. The only key-shaped strings are test fixtures like `"sk_live_x"` and `"whsec"` in tests.
- **Public money paths:** still closed. `/api/checkout` and `/api/jarvis/chat` return 401; the Stripe and Telegram webhooks 405 on GET; `/.env` and `/zoora/SOUL.md` 404. No secret strings appear in `/`, `/shop`, `/floor` or `/books`.
- **New routes:**
  - `/safety` is a static page.
  - `POST /api/world/here` (presence) is rate-limited to 30/min/IP, plus the page limit, with the slot regex-checked.
  - Low: anyone can inflate the "here" count by rotating slots, and `notePresence` sweeps the whole map on every call (bounded by the 45s window).

**Verdict: no-money launch is still NO-GO, but it's close.** Must fix:
1. The desk proxy start command (M4a).
2. The CI smoke failing and skipped (H1 guard).
3. The `.gitleaks.toml` that disables all rules (L10).

Should fix before or right after launch:
- L7 sandbox overwrite
- the SVG comment placement
- M4b (bind `::`)
- M5 doc gaps

Before money: M4c.

---

## Re-check 2 at 2a91f6d (Nov 10, 2026, ~4:10 PM CST)

Scope: 11 commits from 2f5d1c6 to 2a91f6d. Read-only. I used an anonymous scratch clone, ran it locally on ports 3300/3301, and then deleted the clone. Nothing was pushed, commented, deployed or changed.

### Blockers

| ID | Claim | Result | Evidence |
|---|---|---|---|
| M4 | The desk starts through `gosu node node ./desk-proxy.mjs` and listens dual-stack on `::` | **PASS** | I copied the entrypoint, changing only the /data path, and used a gosu shim. desk-proxy.mjs is still 100644, which works because `node` is the interpreter. The listener came up on `*:3301`. `http://[::1]:3301/admin/login` returned 200, and so did 127.0.0.1:3301. On :3300 with Fly-Client-IP, /admin/login returned 404. fly.toml has only `[http_service] internal_port=3000` and no `[[services]]`, so 3001 is not public. |
| H1 | CI is on ubuntu-24.04, smoke output goes to $RUNNER_TEMP, and the smoke step passes | **PASS** | Run 42910155836: head_sha 2a91f6d, event pull_request, conclusion success, 3:58–4:00 PM CST, runner label ubuntu-24.04. Step 8 "Install Playwright Chromium" and step 9 "CSP hydration smoke" both succeeded. My local Playwright run (Chrome, extensions off) covered /, /world, /guestbook and /gallery: all hydrated, 0 CSP violations, 0 console errors, every script had a nonce, and the nonce rotated on each request. |
| L10 | `.gitleaks.toml` has `[extend] useDefault=true` and allowlists only the localhost PEM | **PASS** (the counts differ, explained here) | Full history across 93 refs: 50 findings with defaults only and 49 with the repo config. The only extra finding under defaults is the private-key rule on `projects/zoora-agent-community/tests/fixtures/bridge-localhost-public-test-key.pem`. For the PR branch alone the counts are 21 and 20. The claimed 44/43 is a different ref scope, with the same delta of 1. All 49 are false positives (triage below). |

Gitleaks triage of the 49. No values are printed here.
- **41 are public Solana mint or pubkey addresses** (base58, 32–44 characters). The keys are `TOKEN`, `token_address`, `from_/to_token_address` and `pubkey`, in `src/multi_brain_research/*.py` and `src/solana_research/*.py`, `research/HOST_CAPTURE.md`, `tests/fixtures/giant-brain-*` and `tests/test_{holder_capture,pool_trades}.py`. These are not secrets.
- **4 are hex `credential_id` values** in `projects/zoora-agent-community/evidence/ae-009/ae-010*.json`. These are record identifiers, kept separate from the `token` field. They are not secrets.
- **4 are test placeholders:**
  - `projects/lumen/tests/telegram.test.ts` (LUMEN_XAI_API_KEY fixture)
  - `projects/lumen/tests/brain.test.ts` (an `sk_test`-prefixed 18-character fake)
  - `projects/zoora-platform/tests/browser.cjs` (sealedKey)
  - `projects/zoora-platform/tests/test_provider_vault.py` (SYNTHETIC_KEY)

  Each contains test or synthetic wording and is too short to be real.
- No live-prefixed Stripe key, private key or real token turned up. The allowlist can stay narrow; you could add path allowlists for the research fixtures if the noise bothers you.

### Should-fix items

| Item | Result | Evidence |
|---|---|---|
| Delivery sandbox CSP | PASS | Live GET `/api/delivery/<token>` returns 200 with `content-security-policy: sandbox`, `image/svg+xml` and `nosniff`. An unknown token returns 404. Middleware returns early for /api/delivery and skips the page rate limit. That is acceptable because tokens are `randomBytes(24)`, 192 bits, in all three issuers. |
| SVG XML declaration first | PASS | The body starts with `<?xml version="1.0" encoding="UTF-8"?>`, followed by the licence comment. |
| M5 docs | PASS, minor gap | HOSTING_FLY.md now covers: GitHub verification kept permanently, CAA for letsencrypt plus `issuewild ";"` after certs are issued, DMARC p=none, DNSSEC a week later, and a post-cutover check list. Still missing: lowering the TTL about a day before the switch. |
| auth.ts: owner cookie gets 401 from the public edge | PASS | I logged in through the desk ([::1]:3301) and got the `lumen_owner` cookie. With that cookie, POST /api/checkout/report through the desk returned 400 (CLAIM), meaning it got past auth. Through the edge (Fly-Client-IP set) it returned **401**. It also returned 401 with a forged `x-lumen-desk`. /admin through the edge returned 404. |
| Presence cap with timer pruning | PASS (Low residual) | 8 per /64, a global cap of 256 with oldest-first eviction, and pruning every 15 s, driven by requests. Residual: about 32 /64s can fill the 256 cap and churn real visitors out. That's cosmetic only. |
| 4,096 LRU cap on blocked /48s | PASS (accepted residual) | When no unblocked bucket is left, the oldest blocked bucket is evicted, which lifts its block. Accepted. |

### Head of Systems items in 0ee3152 (security spot-check)

All PASS, with no regressions:
- **WebGL fallback:** a static card with no HTML injection.
- **Smoke process-group kill:** `process.kill(-pid)` targets only its own detached child group, there's a 180 s hard timeout, and the port is chosen at random.
- **Crisis patterns:** NFKC-folded, with a "suicide squad" exclusion and a neutral reply for heavy notes.
- **Guestbook:** `scrubInstructions` runs before storage. Scrubbed-out notes show as "This note was set aside" and get no reply.
- **Guestbook /64 buckets:** done through `bearerAddress`.
- **CSP form-action:** narrowed to the exact Kit form URL.
- **FloorView:** live rows are hidden unless the mode is LIVE, and raw JSON is no longer printed.
- **PAN filter (Low):** solid digit runs of 20–22 characters are treated as not-a-card. A PAN padded with 1–3 extra digits would get through `rejectPan`. Suggest windowing those too.

### Build and tests

- `npm ci` and `next build` pass.
- `tsc --noEmit` passes.
- vitest (clean env): **190/190** passed in 6 of 7 runs. The first run had 1 failure that I couldn't reproduce in 6 more runs, so it's probably a timing flake.

### Tick scene publisher (5257e13, b236723, c0d1434)

PASS. `parseScene` uses a strict allowlist:
- Fields are a fixed set, and the values are enums.
- `why` is 8–180 characters, with no URLs and no spend, price or checkout words.
- At most 6 gallery ids.

`publishScene` re-validates and honours freeze. It allows at most 1 publish per 10 minutes and 8 per day (UTC), and keeps an 8-item history.
- `sceneWhy` ignores visitor text and always returns a canned line, so no untrusted input reaches the public scene.
- Gallery ids come from the `creations` table, which holds SVGs from the internal generator only.
- Rollback and freeze are server actions behind `gate()` on the desk only.
- React escapes the output. The only `dangerouslySetInnerHTML` is the gallery SVG, which predates this change and comes from the generator.

### Telegram owner commands and polling (fa5d843, 2a91f6d)

Verified as good:
- **No shell or file access:** there's no `child_process` or file read anywhere in the Telegram path. Only 5 commands are handled: /mood, /needs, /status, /world and /help. All of them read state.
- **Unknown slashes:** an unknown slash command such as `/spend` is treated as ordinary talk.
- **Spend guard:** `ownerChat` throws CHAT_SPEND_LEAK if any intents or wishes come back.
- **Money and trading flags:** `pollSafeEnv` and `preparePollEnv` delete LUMEN_MONEY_LIVE and LUMEN_TRADING_LIVE and set sales, spend and mint to off. The poller refuses to start if money is still live, and `pollCycle` throws POLL_MONEY. `moneyLive`/`tradingLive` read the env only, and no code in src or scripts assigns them at runtime.
- **Token redaction:** error text is passed through `redactSecrets` for the token, any 8+ character secret and `api.telegram.org/bot…` URLs. set-commands logs only a status. The notify transport never logs the URL.
- **Rate limits:** owner dispatch is limited to 30/min, ownerChat to 30/hour, and text is cut to 500 characters.
- **No public endpoint in poll mode:** it uses outbound getUpdates and calls deleteWebhook. On the Fly app, /api/telegram/webhook returns 404 when it isn't configured (verified) and 405 on GET. When configured, it needs live mode plus a constant-time secret header.

Findings:
1. **Medium: owner auth checks chat.id only.**
   - `dispatchOwnerMessage` gets only `chat.id`. It ignores `from.id` and doesn't check `chat.type === "private"`.
   - If LUMEN_TELEGRAM_OWNER_CHAT_ID is ever a group or supergroup id (a negative number), every member of that group is treated as the owner. In a private chat, the chat id is the owner's user id and that can't be spoofed.
   - Fix: require `chat.type === "private"`, `from.id === OWNER_USER_ID` and a positive id. Reject `via_bot` and forwarded messages.
2. **Medium: "read-only" is not true for free text.**
   - Plain messages go to `engine.ownerChat`. That writes to the `messages` table and calls `saveState`, so the owner's text changes Zoora's mood and memory.
   - If `LUMEN_XAI_API_KEY` is set, the text plus her state is also sent to api.x.ai.
   - It still can't spend, change toggles or deploy. But either document it as "talk writes local memory", or add a `LUMEN_TELEGRAM_COMMANDS_ONLY` switch.
3. **Low: the poller uses a local database.** `createEngine` opens `LUMEN_DATA` or `./data/lumen.sqlite` on the machine running the poller, not the Fly volume. /status and /mood show the local state, which won't match production. It also seeds that database.
4. **Low: `telegram_drops` grows without limit.** Every message from a non-owner inserts a row. Cap it or prune it.
5. **Low: env and temp files.**
   - `pollSafeEnv` keeps every other env var, so any Stripe, Solana or exchange keys in the shell would be inherited. Run it with a minimal env.
   - The esbuild bundle in `tmpdir()/lumen-tg-*` is never deleted.
6. **Low: the docs' getUpdates curl puts the token in the URL**, which makes it visible in the process list while it runs.
7. **Ops: one token can't do both.** The poller's deleteWebhook disables a Fly webhook that uses the same bot. Run one mode only.

If the token leaks: an attacker can read pending owner messages, message the owner as Zoora (phishing risk), and redirect updates through setWebhook. They can't reach money, trading, deploys or the server. Revoke the token in BotFather.

Box risk, if "Software Engineer's computer" means this shared box (checked just now):
- **Shared uid:** every agent runs as uid `box`. Five same-uid processes already have a TELEGRAM bot token variable in their environment, which any same-uid process can read from `/proc/*/environ`. I checked variable names only.
- **Docker:** port 2375 listens on **0.0.0.0** with no auth (`/_ping` returns 200), which gives root to anyone who can reach it.
- **RSA key:** the plaintext key at /workspace/agent-tools/2955f96f-….txt still exists, mode 644, 1790 B.

### Verdicts

- **No-money launch: GO.** All 3 blockers pass. Should-fix items pass, with minor residuals (TTL note, PAN 20–22 digit gap, presence churn).
- **Telegram polling: CONDITIONAL GO, but not on this shared box until conditions 1–4 are met:**
  1. Use a dedicated new bot from BotFather that's only for this, revocable, and not shared with Fly or alerts.
  2. Owner auth checks `from.id` plus `chat.type === "private"`, not just chat.id.
  3. Run the poller under its own OS user, or on a separate machine, with a minimal env: only the token, owner id and data path. No Stripe, Solana, exchange or xAI keys unless they're wanted.
  4. On this box, first close Docker 2375 and move or tighten the RSA key.
  5. Document that free text writes local memory, or add commands-only mode.
  6. Disable the Fly webhook for this bot.
  7. Cap `telegram_drops`.

---

## Re-check 3 at c3cd0b4 (Nov 10, 2026, ~4:38 PM CST)

Scope: d35c2b5, d89bbf2 and c3cd0b4 on top of 2a91f6d. Read-only. I used an anonymous scratch clone and a local run on ports 3400/3401, and deleted both afterwards. The poller was never run with a token.

Build and tests:
- `npm ci`, `next build` and `tsc` all pass. vitest passed **197/197** in each of 3 clean-env runs.
- gitleaks on the 3 new commits: 2 hits, both `LUMEN_XAI_API_KEY` test fixtures at `tests/telegram.test.ts:185` and `:381`. Both are false positives.

| Item | Result | Evidence |
|---|---|---|
| (a) Owner auth | **PASS** (Low notes) | `ownerUpdateAllowed` (telegramOwner.ts:41) needs chat.type==="private" AND from.id===OWNER_USER_ID AND chat.id===OWNER_CHAT_ID. It drops edited messages and forward_date/from/origin/sender_name, and fails closed when either id is unset or blank. My probe: group, supergroup, channel, other user, missing `from`, forwards, edits, unset or blank ids and undefined messages were all denied. Over the webhook, callback_query, channel_post and edited-only updates returned 200 and never reached dispatch. **Low:** the env ids are compared as strings with no numeric check (:43, :48). Ids like "abc", "012345" or "1.2345e4" can never match a real Telegram id, so this does fail closed, but nothing says the config is broken and the poller starts. `ownerTelegram` (:64) also reports "live" without USER_ID. is_automatic_forward and via_bot are accepted, but neither can happen in a private owner chat. |
| (b) Commands-only by default | **PASS** | `commandsOnly` returns true unless the value is exactly "false" (case and whitespace ignored). Plain text and unknown slashes both get the canned line: talk() was never called, the `messages` table stayed at 0 rows, and there was no xAI path. In poll mode the child's env allowlist drops `LUMEN_TELEGRAM_COMMANDS_ONLY` and `LUMEN_XAI_API_KEY`, so talk can't be turned on there at all. |
| (c) Poll env | **PASS for isolation; the denylist is partial** | The child runs with exactly PATH, NODE_ENV, TZ, LUMEN_TELEGRAM_MODE, LUMEN_DATA and the 3 Telegram vars. NODE_OPTIONS and every other secret were dropped (verified). The refusal denylist (scripts/telegram-poll.mjs:11-19) matches exact LUMEN_MONEY_LIVE/LUMEN_TRADING_LIVE, the `STRIPE_*` prefix (case-sensitive), and the substrings ISSUING/PRIVACY/SIGNER/MINT in the name. **It does not refuse:** SOLANA_PRIVATE_KEY, LUMEN_TRADING_PRIVATE_KEY, LUMEN_CARD_ISSUER (ISSUER isn't ISSUING), LUMEN_STRIPE_*, lowercase stripe_*, LUMEN_SPEND/SALES_ENABLED, LUMEN_SMTP_PASSWORD, LUMEN_XAI/LLM_API_KEY, OWNER_*, LUMEN_DESK_SECRET, exchange, AWS and GitHub tokens. It also ignores set-but-empty values. The allowlist means none of these reach the poller, so this is Low. **Low:** running `node scripts/telegram-poll.mjs --minimal` directly (:96) skips the clean-env respawn and keeps the full parent env, apart from the money flags it removes. The money vars are still refused there; I verified other secrets get through. The temp bundle is now deleted: no `lumen-tg-*` left after runs. |
| (d) deleteWebhook / one mode per bot | **PASS (docs plus behaviour)** | `pollStartup` calls `deleteWebhook`. TELEGRAM.md says one bot per mode and a separate alert bot. Nothing in code stops the same token being set on Fly. That's an ops rule. |
| (e) telegram_drops cap | **PASS (landed)** | `pruneTelegramDrops` (:53) runs on every drop, keeping 7 days and at most 1,000 rows. 1,300 spam drops left exactly 1,000 rows. |
| (f) Desk cookie | **PASS (Low hardening)** | **Live:** a desk login (127.0.0.1:3401) set `HttpOnly; SameSite=strict; Max-Age=43200` with no Secure flag. I replayed the login action at the public app (:3400) with Fly-Client-IP plus a spoofed `X-Forwarded-Proto: http`, a junk `x-lumen-desk` and `Host: 127.0.0.1:3001`; also with no Fly-Client-IP, a junk desk header and Host 3001; and with Host `localhost:3001`. **Every one got a 303 to `/` with no owner cookie**, because `loginReachable` checks the desk secret in constant time before any cookie is set (actions.ts:50). The desk proxy overwrites X-Forwarded-Proto with `http`, so a client sending "https" through the desk doesn't change anything. The Host header is never consulted. Unit check: proto https always sets Secure; non-desk requests always set Secure; SameSite is strict in every case. **Low:** `deskHttp` (actions.ts:55) is based on whether the `x-lumen-desk` header is *present*, not on whether it was validated. In non-public mode (dev) `loginReachable` returns true, so any client header gives a non-Secure cookie there. Production sets LUMEN_PUBLIC_MODE=true in fly.toml, so it doesn't apply. Fix: derive deskHttp from the validated check (`publicModeOn() && loginReachable(...)`). **Info:** cookies aren't port-scoped, so a non-Secure lumen_owner cookie on 127.0.0.1 is also sent to every other local http service the owner opens on 127.0.0.1. It lasts 12h. Advise logging out after desk use. |
| (g) d35c2b5, world as home | **PASS** | No new route handlers. `/world` gets a 307 to `/` that keeps the query string. A spoofed Host or X-Forwarded-Host can't redirect elsewhere, and `//evil.com/world` normalises on the same origin. There's no CSP change: Playwright on `/`, `/world`→`/`, `/guestbook` and `/gallery` showed all hydrated, 0 CSP violations, 0 errors, strict-dynamic, and every script had a nonce. The new `x-lumen-path` header is always set by middleware and only changes layout. `bubble.ts` uses only her own state, with canned guest replies and a blocklist for URLs, keys and spend words. `publicBooks` shows only confirmed totals, with no ids or wallets. **Low (carried over):** checkoutQueue.ts:63-64 treats 20/22-digit runs starting with 9, and 15-digit runs starting with 96, as tracking numbers. A card number padded with a leading 9 plus 3–5 digits would skip `rejectPan`. |
| (h) CI | **PASS** | Run 42914667538: head_sha c3cd0b4, pull_request, success. The CSP hydration smoke step ran from 4:28:02 to 4:28:50 PM CST (48 s, not skipped). The `lumen-smoke` artifact is 461 KB, and the workflow still checks for `csp-smoke-ok` and `world-fallback.png`. The smoke test now also checks that the desk proxy opens /admin/login. |

**Verdict: code GO** for the no-money launch, and **GO for polling code**. The ops conditions from Re-check 2 still apply: 3 (own OS user or machine, minimal env) and 4 (Docker 2375 and the RSA key). Also, the box currently has a live `LUMEN_TELEGRAM_BOT_TOKEN` in 39 process environments; see triage_audit_20261110T161023.md.

---

## Re-check 4 at d7c3e37 (Nov 10, 2026, ~5:41 PM CST)

Scope: 49be082, 2781eb8 and d7c3e37 on top of c3cd0b4. Read-only. I used an anonymous scratch clone and a local run on ports 3500/3501, and deleted both afterwards. No real tokens were used.

Build and tests:
- `npm ci`, `next build` and `tsc` pass.
- vitest **200/200** passed in 2 of 8 default runs. The other runs had 2–4 tests hit the 5 s timeout while box load was about 14.7: the recheck "owner session cookie on the public edge" test, plus world restart and money held-execute tests. With `--testTimeout=30000` the full suite passed 200/200, and the 3 affected files passed 49/49. These were timing failures, not assertion failures. CI passed.
- gitleaks on c3cd0b4..d7c3e37: 0 findings.

### 1) The four Lows from Re-check 3

| Low | Result | Evidence |
|---|---|---|
| deskHttp | **FIXED** | actions.ts now requires `publicModeOn() && loginReachable(...) && proto !== https`. There is also a new `deskHttpSession` helper in owner.ts. Unit check: public+reachable+http drops Secure; https, not reachable, or not public all keep Secure. Live replay against the public app (:3500) with Fly-Client-IP + https, spoofed `X-Forwarded-Proto: http` + junk `x-lumen-desk` + `Host: 127.0.0.1:3001`, or no Fly-Client-IP + junk desk header: all got a 303 to `/` with **no owner cookie**. Through the desk the cookie is `HttpOnly; SameSite=strict; Max-Age=43200` without Secure, as designed. |
| Telegram ids numeric, user id required | **FIXED** | `numericTelegramId` = `^[1-9][0-9]{0,19}$`. "abc", "012345", "-12345", "1.2e4", fullwidth digits, 21 digits and "" all stay in mock mode and deny. A missing user id means mock. Values with surrounding whitespace are trimmed and accepted, which is fine. |
| Poll denylist / `--minimal` | **FIXED** (Low residual) | `--minimal` refuses to start unless the non-empty env is exactly the 8 allowlisted names. Verified: a bare env refuses, an extra LUMEN_DESK_SECRET refuses, and adding NODE_OPTIONS fails `pollEnvAllowed`. The parent denylist now also catches *PRIVATE_KEY*, *ISSUER*, *STRIPE* (any case), *_SECRET and *_TOKEN. It still doesn't refuse LUMEN_SMTP_PASSWORD, *_API_KEY (XAI, LLM, SEARCH), OWNER_PASSWORD_HASH, AWS_SECRET_ACCESS_KEY, LUMEN_SOL_RPC_URL, NODE_OPTIONS or the SPEND/SALES flags. The child env is the exact allowlist, so none of these reach the poller. Cosmetic. |
| Padded card gap | **NOT CLOSED (Low)** | See below. |

### 2) Delta review

**2781eb8: card filter, fuzzed with Luhn-valid Visa, MC (5x and 2-series), Amex, Discover, JCB, 13- and 19-digit PANs, 40–60 samples per shape.**

What the filter catches:
- plain, spaced, dashed and dotted numbers
- NBSP and ZWSP separators
- fullwidth and Arabic-Indic digits
- a card inside text
- a card with 1–3 junk digits after it, or 2 before it
- repeated-digit padding such as `99…card…99`

Misses (checkoutQueue.ts:63-65 `trackingDigits`, :101 `paddedCard`, :118 `wrappedCard`, :68 `trackingToken`, :51 `CARD_JOIN`):
- **`9` + random digits + card, padded to 20 or 22 digits:** 80–95% missed. `wrappedCard` only tries 16-digit windows with at least 2 digits on each side, and `paddedCard` only accepts repeated padding. The same shape in 4-digit groups (`9123 4111 …`) is also missed about 90% of the time.
- **`1Z` + a 16-digit card:** 100% missed, because `trackingToken` treats any 1Z+16 alphanumeric string as a UPS number.
- **ZWJ, soft hyphen, or a letter between groups:** 100% missed. `CARD_JOIN` has ZWSP but not U+200D, U+00AD or letters.

Compared with 49be082, the gap wasn't closed there either, and 2781eb8 widened some shapes slightly: `9`+3+card went from 40/60 to 56/60 missed.

On real tracking numbers, the filter wrongly flags about 17 in 200 random 20/22-digit numbers starting with 9 (usability, not security).

Severity is **Low**. `rejectPan` is defense in depth on a bearer-authenticated checkout report path, checkout is closed for the no-money launch, and a deliberately evasive client can't be stopped by a regex. But the "gap closed" claim is not accurate.

**2781eb8: CI screenshots.** The upload adds `desk-login.png`, `home-mobile.png` and `home-tablet.png`.
- `desk-login.png` is taken **after** login, on the "Zoora, in private" owner desk, using a CI-only instance. That instance has hardcoded fixture credentials (`csp-smoke.mjs:78-90`, already public in the repo) and a fresh temp DB. The admin page renders no env values (`admin/page.tsx` only uses env through `loginReachable`), and cookies aren't screenshotted. No real secret is exposed.
- The repo is **public**, and artifact `lumen-smoke` (787 KB) expires 2027-02-08, which is the 90-day default. Any signed-in GitHub user can download it, which reveals the private desk layout.
- **Low:** add `retention-days: 7`, and take the desk shot before login (or don't upload it).
- The workflow has `permissions: contents: read` and pinned actions.

**d7c3e37: mobile layout.** Files changed: globals.css, WorldView.tsx, a new `src/world/labels.ts` (pure geometry and text functions, no DOM, fetch or imports), tests and csp-smoke.
- No new routes. No middleware, auth, layout or CSP changes. No links, redirects, `dangerouslySetInnerHTML`, inline HTML handlers or `url()`/`@import` in CSS. The new interactivity is React `onClick` state toggles for Menu, Places, place choice and Sound.
- Playwright on `/`, `/world` (→ `/`), `/guestbook` and `/gallery`, at desktop 1366×900, iPhone 13, Pixel 7 and tablet 768×1024, with the Menu and Places toggles opened on mobile:
  - all 16 pages hydrated, 0 CSP violations, 0 console errors
  - every script had a nonce
  - 0 elements with `on*` attributes, 0 external links

### 3) CI

Run 42923585367:
- head_sha d7c3e37, pull_request, success, ubuntu-24.04
- "Install Playwright Chromium" succeeded, and "CSP hydration smoke" **ran for 3m06s** (5:29:15–5:32:21 PM CST)
- the upload succeeded

### Verdict

**GO for d7c3e37 as the no-money deploy candidate.** Open Lows: the card filter bypasses and CI artifact retention/desk screenshot. Neither blocks a launch with no money. The ops conditions for Telegram polling (own user or machine, Docker 2375, RSA key, the live token in the box env) are unchanged.

---

## Re-check 5 at 0ff1fcb (Nov 10, 2026, ~6:11 PM CST)

Scope: 0ff1fcb on top of d7c3e37. Read-only. I used an anonymous scratch clone and a local run on ports 3600/3601, and deleted both afterwards.

Build and tests:
- `npm ci`, `next build` and `tsc` pass. vitest passed **201/201** in 3 of 3 clean runs; `testTimeout: 15000` is now in vitest.config.ts.

### 1) Card filter (checkoutQueue.ts)

I re-ran the Re-check 4 fuzz: 8 card types (Visa 13/16/19, MC 5x/2-series, Amex, Discover, JCB), 40 samples each, so 320 per shape.

| Shape | d7c3e37 miss | 0ff1fcb miss |
|---|---|---|
| `9` + random digits + card (20) | 80–95% | **11%** |
| `9` + card + random digits (20) | ~70% | **11%** |
| `9` + 2 random + card + random (22) | ~85% | **10%** |
| `9` + random digits + card, in 4-digit groups | ~90% | **8%** |
| `99…card…99` (repeated padding) | 0% | 9% |
| `1Z` + 16-digit card, plain or spaced | 100% | **0%** |
| ZWJ, soft hyphen, U+2060, U+FEFF, or one letter between digits | 100% | **0%** |
| plain, spaced, dashed, dotted, NBSP, ZWSP, fullwidth, Arabic-Indic, in text, card ± 1–3 junk digits | 0% | 0% |

**Remaining misses (Low):**
- **About 10% residual on 9-padding** (:113-115). `nineTrackingCard` lets any 20/22-digit `9…` number through whenever the whole number passes `uspsMod10`. That happens by chance 1 time in 10. A client that picks the last digit on purpose can do it every time: a USPS-valid padded card was missed in 310 of 320 tries. This is inherent to the design: a real USPS number can't be told apart from a card padded to look like one.
- **Separators not joined, 100% missed:** two or more letters (`4111ab1111…`), `+`, `*`, and combining marks such as U+0301. The causes are `joinSingleLetters` (:124-125, one letter only), `CARD_JOIN` (:51, which lacks `+`, `*` and other symbols), and `\p{Cf}` not covering `\p{Mn}`.

False positives (500 each):
- Mod10-valid USPS 22 (94…), USPS 20 (92…), the same grouped, FedEx SmartPost 92…: **0/500**.
- FedEx 12, FedEx 15 96…, UPS 1Z alphanumeric, Amazon orders, phone numbers, price/date text: **0/500**.
- **UPS 1Z with an all-digit tail: 53/500 (~10%)**. A numeric tail that happens to pass Luhn is now rejected (:69). That's a usability cost, not a security one.
- Non-check-digit 9… numbers: 353/500 flagged. Real USPS numbers carry a check digit, so this is expected.

**Cost, no ReDoS.** Every regex is linear. Times on adversarial inputs (digits only, digit+letter alternating, digit+ZWJ, digit+soft hyphen, dash-separated, 4-digit groups, fullwidth digits, repeated Amazon-like strings, letters only): **at most 5 ms at 10k characters and at most 43 ms at 100k**. The `/api/checkout/report` body is also capped at 8 KiB (`WORLD_MAX_BYTES`).

### 2) CI artifact

- `retention-days: 7` is in the workflow (`.github/workflows/lumen.yml:55`). Run 42927634618's artifact `lumen-smoke` (737 KB) expires on 2026-11-17 at 6:04 PM CST, 7 days out.
- In `csp-smoke.mjs`, `desk-login.png` is taken at :214, right after `goto` and waiting for the input (:212-213), and **before** `fill(ownerToken)` and Enter (:215-216).
- Anonymous download of the artifact zip returns 401, and I didn't use credentials, so I couldn't open the CI artifact itself. Instead I reproduced the same sequence locally. The screenshot shows only the "Owner login" form with an empty input (value length 0) and 0 cookies, plus the public nav and AI notice. **PASS**, verified through code and a local reproduction.

### 3) Layout Lows

- Changes are in globals.css, WorldView.tsx (a new React `onClick` that toggles the thought bubble), labels.ts (pure functions), tests and the smoke script.
- No new files or routes. No middleware, auth, layout or CSP changes. No links, redirects, scripts, `dangerouslySetInnerHTML`, inline HTML handlers, or CSS `url()`/`@import`.
- Playwright on `/`, `/world` (→ `/`), `/guestbook` and `/gallery`, at desktop 1366×900, iPhone 13, Pixel 7 and tablet 768×1024. On mobile I also opened Dismiss, Menu, Places, the greeting drawer and the thought bubble. Results across all 16 pages:
  - all hydrated, **0 CSP violations**, 0 console errors
  - every script had a nonce
  - 0 `on*` attributes, 0 external links

### 4) CI

Run 42927634618:
- head_sha 0ff1fcb, pull_request, success, ubuntu-24.04
- "Install Playwright Chromium" succeeded, and "CSP hydration smoke" **ran for 4m16s** (5:59:49–6:04:05 PM CST)
- the upload succeeded

### Verdict

**GO for 0ff1fcb as the no-money deploy candidate.** Open Lows:
- 9-padding is about 10% by chance and can be forced by an adversary (inherent).
- Two-letter, `+`, `*` and combining-mark separators aren't joined.
- UPS 1Z numeric false positives are about 10%.

None of these block the launch: checkout is closed, and the filter is defense in depth on a bearer-authenticated path. Telegram ops conditions are unchanged.

---

## Re-check 6 — 468dc57 (delta 0ff1fcb..468dc57: 47fd687, 5d090cf, 468dc57) — Nov 10, 2026 ~7:05 PM CST

**Verdict: GO for 468dc57 as the no-money deploy candidate.** No High/Critical. Two Lows + infos below; one pre-deploy check for Head of Systems (prod ledger fork query).

### Build / tests / CI
- Clean clone at 468dc570ef34; `npm ci`, `tsc --noEmit` = 0, vitest 34 files / 204 tests passed ×3, `next build` = 0. gitleaks 0ff1fcb..HEAD (3 commits): no leaks.
- CI run 42933124587: head_sha 468dc570ef34…, event pull_request, conclusion **success**, 6:39–6:45 PM CST. Step 9 "CSP hydration smoke" really ran (6:41:29–6:45:50 PM CST, 4m21s); artifact `lumen-smoke` 736 KB, expires Nov 17 6:45 PM CST (not downloaded: anonymous = 401).
- Delta touches no app/route/middleware/auth/CSP/next.config/fly.toml/Dockerfile/entrypoint/desk-proxy files. Local standalone run (public mode) + Playwright (system Chrome) on / /world /guestbook /gallery × desktop, iPhone 13, Pixel 7, iPad: 16/16 200, hydrated, nonce+strict-dynamic CSP, **0 CSP violations**, 0 page errors.

### Card filter (src/money/checkoutQueue.ts)
Fuzz, 8 card types × 40 (miss rate):
- 0%: plain, spaced4, dashed, c+junk3, in text, fullwidth, ZWJ, soft hyphen, combining U+0301, 1/2/3-letter sep, plus, star, hash, newline, 1Z+card16. (Re-check 5 gaps for 2-letter, +, *, U+0301 are closed.)
- 9-padding (USPS Mod10 collision): 9+rand+c 12%, 9+c+rand 9%, 9+2rand+c+rand 9%, grouped 5%, 99..c..99 11% (unchanged vs Re-check 5).
- Adversarial USPS-valid padding: **97% miss** (accepted pre-live-money item — confirmed, nineTrackingCard exempts all windows when uspsMod10 passes, checkoutQueue.ts:123-125).
- 100% miss: 4-letter sep, " and ", `)`, `'`, `=`, emoji separators (deliberate obfuscation; caller is the trusted claim-token holder, so this is a guard against accidents, not an adversary).
FPs (1000 each): valid USPS **every prefix 90–99, lengths 20 and 22: 0/1000** each. FedEx 12, 15 96…, UPS 1Z alnum, DHL 10, USPS intl 13, order ids, addresses, phones, Amazon 112-…, price text: 0. UPS 1Z digits 2.6% (was 10%).
- **My Re-check 5 edge rule did cause it:** applied to valid USPS it flags 94… 35% (len20) / 43% (len22), and 19–43% across 90–99. Cause: the second digit "4" (and 5x/3x/6x after "9") starts a known-IIN window at offset 1, and each 15/16 window near an edge passes Luhn ~10%. SE's revert was right.
- **New FPs from 1–3-letter joining (47fd687/468dc57) [Low, usability, fail-closed]:** "12AB3456CD7890EF1234"-style SKUs 0→15–25%; a bare random UUID in receipt 13%→42% (only exempt in id/claimToken/token/idempotencyKey). Pre-existing and unchanged: USPS IMpb with 420+ZIP routing (30/34 digits) ~100%, FedEx 96… 22-digit 62% / 34-digit 100%, FedEx 61… 20-digit 18%, two 13-digit ms timestamps ~100%, dates 7–10%, INV-style 25%. All cause a PAN_REJECTED 400, never a leak.
- ReDoS: max 37 ms at 100k chars across 11 shapes (digits, digit+1/3/4 letters, combining, ZWJ, plus, fullwidth, groups). Body cap 8 KiB. Not exploitable.
- Token skip (checkoutQueue.ts:12, 25-31, 36): cards hidden in a 32-hex (one letter), 22/43 base64url, or UUID-shaped value under id/claimToken/token/idempotencyKey are **not** rejected (confirmed). Digits-only 32 chars is still scanned and rejected; same shapes in receipt are rejected. **Not exploitable for storage:** reportCheckout (checkoutQueue.ts:252-300) only compares id/claimToken against the server row and never persists them; any other key is ignored. Info. Keep it that way (if a future field named token/id is ever stored, the skip becomes a bypass).
- USPS hidden-card: no content-only rule reaches 0 real-USPS FPs (any inner-window test inherits ~10%/window Luhn chance). Cheap field-aware option: apply the strict rule (no USPS exemption) to `merchant` and `reason`, where tracking numbers never belong; keep the exemption only for `orderNumber`/`receipt`, and keep **manual review** as the control there before live money.

### Ledger (src/money/ledger.ts, src/db/db.ts, src/build/provenance.ts)
- v2→v3 migration (ledger.ts:197-223) built a real v2 DB with 0ff1fcb code (50 rows), opened 3× with 468dc57: version 3, verify true, 50 rows, hashes stable across opens (idempotent), non-hash columns byte-identical (no data loss), append-only trigger restored, 0 alerts.
- Crash mid-migration (SIGKILL after DROP TRIGGER, 25 rows rewritten and version=3 written, no COMMIT): reopened file still v2 with 0 changed rows and the trigger intact; next open migrated cleanly (v3, verify true, data identical). Atomic.
- Old rows remain verifiable under the v3 hash (contentHash null inside the payload); migration refuses to rewrite a chain that doesn't verify under v2 (alert instead).
- Concurrency: 8 separate processes × 400 appends (with idempotent replays) on one file: 2800 rows, 2800 distinct prev_hash, verify true, 0 errors. Same harness on 0ff1fcb code forked (353 rows / 348 distinct prev, 1400+ busy errors) → BEGIN IMMEDIATE (ledger.ts:260-263) + unique prev_hash (db.ts:72) + retry (ledger.ts:253) fixes it.
- Tamper: UPDATE/DELETE incl. content_hash blocked by triggers ("append-only"); IDEMPOTENCY_CONFLICT on reuse with a different content hash. Only code paths that UPDATE ledger_entries are the 3 migrations (ledger.ts:89, 166, 208), all inside BEGIN IMMEDIATE and gated by version + verification; no route exposes them. No DELETE/DROP/VACUUM on ledger anywhere in src.
- **Low — boot fails on a pre-forked prod ledger:** db.ts:72 creates the unique index inside SCHEMA (db.ts:443) before migrations. A DB that already has duplicate prev_hash throws "UNIQUE constraint failed: ledger_entries.prev_hash" and openDatabase dies (crash loop, fail-closed; reproduced). Before deploying, Head of Systems should run, read-only on the volume: `SELECT prev_hash, COUNT(*) FROM ledger_entries GROUP BY prev_hash HAVING COUNT(*) > 1;` (expect 0 rows).
- **Info — cold-start lock:** SCHEMA runs before `PRAGMA busy_timeout` (db.ts:443 vs 445), so two processes opening a fresh DB at once get "database is locked" (5/6 failed in test; pre-existing in 0ff1fcb). Move busy_timeout above SCHEMA.
- Data: content_hash is SHA-256 of public art SVG, song tune, or build {kind,title,why,placeId,params} (provenance.ts:65-76, 89-103). No secrets, tokens, IPs, or visitor identifiers hashed. Song tunes are now stored in kv `song-body:<id>` (provenance.ts:78, registry.ts:323), and each piece adds one ledger audit row. Growth is bounded by owner-issued world tokens plus the 90 s per-action gate. Info: watch volume growth.

### Box (unchanged, out of PR scope)
RSA key file at /workspace/agent-tools/2955f96f-….txt still exists, still mode 644.

### Cleanup
Removed /tmp/zsec7, the /tmp/zsec7-old worktree, /tmp/zsec7-run, /tmp/zsec7-dbs and the logs. Killed my next-server on 127.0.0.1:3700. Probe tests deleted. No other agents' processes were touched.

## Hotfix afb3876 (PR #88 head, one commit on 468dc57) — Nov 11, 2026 ~4:40 AM CST

Delta review of `afb38766c0f87b62a0ec4e18cc24a80d57f46f69` as the no-money deploy candidate. READ-ONLY. Scratch `/tmp/zsec-hf` (mode 700), anonymous clone, removed after this section. Other agents' dirs and processes were not touched.

**Verdict: GO for afb3876 as the no-money deploy candidate.** Live money remains NO-GO (unchanged).

**ZWJ call: accept for launch.** Do not veto the loosening of U+200D. BANNED and the PAN scan still catch hidden phrases/cards on the `textForCheck` copy; emoji ZWJ sequences can now be stored as intended. See L-HF1 (follow-up, not a veto) and L-HF2.

### Diff

`git diff --stat 468dc57..afb3876` is only the four claimed files, +42/−4:

- `projects/lumen/src/brain/social.ts` — `stripHiddenForCheck` / `textForCheck` (social.ts:21-28); NOTE_CONTROL drops U+200D (social.ts:34-35); BANNED runs on `textForCheck(note)` (social.ts:40); stored return is still the trimmed original `note` (social.ts:38, 41).
- `projects/lumen/src/money/checkoutQueue.ts` — string path is `textHasPan(textForCheck(item))` (checkoutQueue.ts:40); `textHasPan` strips FE0F/U+20E3 then `looksLikePan` (checkoutQueue.ts:168-170).
- `projects/lumen/tests/brain.test.ts` — ZWJ/FE0F BANNED cases; keeps ❤️, 👩‍💻, skin-tone thumb.
- `projects/lumen/tests/predeploy.test.ts` — keycap-digit PAN.

Nothing else changed in the commit. PR #88 is open, not draft, head matches this SHA, base `main` `a30f992`.

### 1) CI run 43004297382

Checked through the GitHub API, not from Software Engineer's report.

- Only workflow run on `afb38766c0f87b62a0ec4e18cc24a80d57f46f69` (`list_workflow_runs?head_sha=` returned total_count 1).
- `get_workflow_run`: status `completed`, conclusion `success`, event `pull_request`, branch `cursor/lumen-jellyfish-9263`, head_sha exact match, run_attempt 1, run_number 38, workflow "Lumen".
- Created/started 4:31:15–4:31:18 AM CST (2026-11-11T10:31:15Z). Completed 4:37:01 AM CST (2026-11-11T10:37:01Z).
- Sole job `next-build` (id 130467820839): conclusion `success`. Steps: Test success (4:31:31–4:31:40 AM CST), Typecheck success (4:31:40–4:31:45), Production build success (4:31:45–4:32:18), Install Playwright Chromium success (4:32:18–4:32:37), CSP hydration smoke success (4:32:37–4:36:58 AM CST), Upload smoke screenshots success (4:36:58–4:36:59).
- Artifact `lumen-smoke` id 13848400332, 742,377 bytes, expired=false, created 4:36:59 AM CST, expires 4:36:58 AM CST on Nov 18, 2026 (2026-11-18T10:36:58Z). Public API.

### 2) BANNED probes (new vs 468dc57)

`textForCheck` strips ZWSP–ZWJ, U+2060, BOM, soft hyphen, FE00–FE0F, U+20E3, E0100–E01EF, then NFKC, then strips again. Probes ran the live `moderateNote` against a faithful inlined copy of 468dc57 `moderateNote`.

**Newly caught (accepted at 468dc57, now NOTE_REJECTED), for every BANNED entry tested (https?://, www., `<script`, seed phrase, private key, both child-safety patterns):** FE0F inside words, E0100 and E01EF selectors, U+2060, soft hyphen, fullwidth ASCII, stacked FE0F. Mixed VS+ZWJ+U+2060 also rejected. ZWJ inside or between words is NOTE_REJECTED now (it was NOTE_CONTROL before — still rejected, reason changed). ZWNJ remains NOTE_CONTROL. Case and ordinary whitespace/tab collapse still reject, as before.

**NFKC vs homoglyphs:** NFKC folds fullwidth ASCII (confirmed: fullwidth "seed phrase" and fullwidth `https://` now reject; `textForCheck` returns the ASCII form). NFKC does **not** fold Cyrillic or Greek confusables (`"ѕееd рhraѕе"` and `"рrivаte kеy"` stay non-ASCII after NFKC; both SHAs accept). **Already a gap at 468dc57, not new.** `foldConfusable` in `ideas.ts` is not used here.

**Pre-existing BANNED residuals (same accept on both SHAs, not introduced by this commit):**

- Tag characters (U+E0000–E007F), e.g. TAG SPACE between "seed" and "phrase".
- Combining marks: U+034F (CGJ) between letters; U+0301 on vowels (NFKC composes to `é` etc. and misses `/seed phrase/`).
- Punctuation and nospace splits: "seed-phrase", "seed.phrase", "seedphrase".
- U+2061, U+2063, Hangul filler U+3164, C1 controls (e.g. U+009F).
- BOM *between letters*: U+FEFF is in `stripHiddenForCheck` (social.ts:22), but `moderateNote` does `trim()` + `\s+` collapse (social.ts:38) *before* `textForCheck`. In JS, `\s` includes U+FEFF, so `"s\\uFEFFe\\uFEFFed phrase"` becomes `"s e e d p h r a s e"` and `/seed phrase/` misses. `textForCheck` of the already-collapsed string cannot recover it. Same accept at 468dc57. Follow-up: strip hidden / format characters before whitespace collapse, and/or also test a no-space copy.

Store check: 0 mismatches. When a note is accepted, the stored string is the trim + whitespace-collapsed original, including remaining ZWJ/VS.

### 3) PAN scan

`rejectPan` string path uses `textHasPan(textForCheck(item))`. `looksLikePan` already did NFKC + `CARD_JOIN` (`\p{Cf}|\p{Mn}`) at 468dc57, so fullwidth digits and FE0F-inside-digits were already flattened. The real new coverage is keycap digits: U+20E3 is Me, not Mn/Cf, so the old flatten of a keycap Visa left U+20E3 between digits (length 32, not a Luhn group). Now rejected.

Probes (Visa 4242…4242): plain, keycap, fullwidth, VS-inside, ZWJ-inside, soft-hyphen, grouped — all rejected. False-positive checks all clean: "I saw two crabs and four shells on the 12th, call me at 415-555-1212", a date, a phone, ❤️, 👩‍💻, a single keycap 4️⃣, short "pin 4242", empty.

### 4) Storing the original text

Does not reintroduce XSS or a filtered-HTML confusion on the render path.

- Guestbook body and author are React text children (`guestbook/page.tsx:67-69`). Admin thoughts are also React text. `dangerouslySetInnerHTML` remains only for `art.svg` on the gallery page. CSP is unchanged: per-request nonce + `'strict-dynamic'` (`publicMode.ts:62-67`, set in `middleware.ts`).
- Stored gift notes (`engine.ts` leaveGift, `untrusted=1`) are not rendered on the public guestbook. The public feed line is a fixed sentence, not the visitor note. Crisis audits store the kind (`'gift'` / `'guestbook'`), not the body.
- Telegram desk "thoughts" are rows from `telegram_outbox`, not guestbook/gift bodies. The ledger is not fed visitor notes.
- `scrubInstructions` (`ideas.ts:106-130`) already uses a broader `PROBE_HIDDEN` (includes ZWJ and tags) plus confusable folding on a probe copy, and still strips jailbreaks that use ZWJ. The public body keeps the original (minus U+202E).
- Residual is not render/XSS; it is downstream *semantic* checks that still read the raw stored string. See L-HF1.

Author is still only `.slice(0, 40)` and never goes through `moderateNote` (pre-existing; ZWJ in names was already possible at 468dc57 because names never hit NOTE_CONTROL).

### 5) ZWJ loosening

U+200D is no longer NOTE_CONTROL so 👩‍💻, 👨‍👩‍👧, and other emoji joins can be stored (confirmed; they were NOTE_CONTROL at 468dc57). ❤️ and 👍🏽 were already accepted.

**Can ZWJ hide or break display?** Yes, in limited ways, not enough to veto launch:

- ZWJ between ordinary letters (`h‍e‍l‍l‍o`) and a 20-ZWJ prefix + "hello" are stored. Browsers may join or show an odd glyph; copy-paste keeps the ZWJs. This is a hiding/spoof channel in the DOM text, not HTML injection.
- A ZWJ-only note is truthy after trim, so guestbook will store it (not EMPTY).
- Long ZWJ chains are bounded by NOTE_MAX / 280.
- Name spoofing via ZWJ is pre-existing (author is unfiltered).

**L-HF1 [Low, new residual, not a veto]:** `crisisMatch` (`crisis.ts:29-32`, called from `engine.ts:347` and `engine.ts:394`), `heavyNote` (`crisis.ts:35`, used for guest replies), `replyToOwner`'s hook regex (`social.ts:231-233`), and `SPEND_WORDS` (`registry.ts:66, 541`) all run on the stored original, not `textForCheck`.

- `"I want to kill\u200D myself"` and mid-word ZWJ: `moderateNote` now OK (was NOTE_CONTROL), `crisisMatch` is false, and the note would be published on the guestbook instead of returning CRISIS / 988. That is worse than the old hard reject.
- `"ignore\u200D previous instructions"` and mid-word ZWJ miss `replyToOwner`'s hook; `scrubInstructions` still SCRUBBED those (already strips ZWJ).
- Mid-word `"b\u200Duy"` misses `SPEND_WORDS`; trailing `"buy\u200D"` still matches because `\b` sees ZWJ as a non-word character.

FE0F / soft hyphen / U+2060 crisis misses are **pre-existing** (those characters were already allowed at 468dc57, and `crisisMatch` only does NFKC + a limited punctuation fold). Follow-up: run `crisisMatch`, `heavyNote`, `replyToOwner` hooks, and `SPEND_WORDS` on `textForCheck` (or a shared stripped copy). Preferably also cover tags / `\p{Mn}` / `\p{Cf}` there.

**L-HF2 [Info/Low, accepted]:** ZWJ as a letter-joining or padding channel, as above. Accept for launch so emoji works. No further launch condition.

### 6) Local suite

- `tsc --noEmit`: clean (exit 0).
- `npx vitest run` ×3: 34 files, 206 tests, all passed (exits 0). Two tests added vs 468dc57 (204→206).
- `npx next build`: exit 0.
- gitleaks on `468dc57..afb3876`: 1 commit scanned, no leaks.
- CSP hydration smoke: patched copy used desk port **3825** (not 3001), `LUMEN_DATA=/tmp/zsec-hf/lumen-smoke-hf.sqlite`, system Chrome `/usr/bin/google-chrome-stable`, build skipped because it had already succeeded. Exit 0, `csp-smoke-ok`, screenshots written (home, guestbook, world-tip, home-mobile, home-tablet, world-fallback, desk-login). Port 3825 closed after the run. The `/app` desk-proxy was left alone.

### Cleanup

Removed `/tmp/zsec-hf` after writing this section. Did not glob-delete `/tmp/lumen-smoke-*.sqlite`. Did not touch `/tmp/zsec-tools`, `/tmp/zsec11`, or other agents' processes.

### Ready-to-send message for Software Engineer

Hotfix afb3876 (PR #88) is GO as the no-money deploy candidate.

CI run 43004297382 is green on this exact SHA — it is the only run on it. Job next-build succeeded, including the CSP hydration smoke. Artifact lumen-smoke (742,377 bytes) expires 4:36 AM CST on Nov 18, 2026.

I accepted the ZWJ loosening for launch. BANNED still catches seed phrase, private key, links, script, and the child-safety patterns when they are hidden with ZWJ, FE0F, E0100–E01EF, U+2060, soft hyphen, or fullwidth ASCII (NFKC). Emoji joins (👩‍💻, 👨‍👩‍👧) and ❤️ / 👍🏽 are kept. The original trimmed text is what gets stored; guestbook and admin render it as React text, and CSP is unchanged, so storing the original does not reintroduce XSS. Telegram, the desk, and the ledger do not re-read visitor notes as if they had been filtered.

One Low to follow up, not a launch veto: crisisMatch, heavyNote, replyToOwner's hook regex, and SPEND_WORDS still run on the stored original, not textForCheck. A ZWJ inside "kill myself", "ignore previous instructions", or "buy" bypasses those hooks. At 468dc57 those strings were NOTE_CONTROL and never stored; now a ZWJ-hidden crisis note can be published on the guestbook instead of returning the 988 path. scrubInstructions already strips ZWJ and still caught the jailbreak probes. Please run those four checks on textForCheck (or a shared stripped copy).

Pre-existing gaps, unchanged and not introduced by this commit: NFKC does not fold Cyrillic or Greek lookalikes; tag characters, U+034F, combining accents, punctuation or nospace splits, U+2061/U+2063, Hangul filler, and C1 controls still miss BANNED. Also, U+FEFF is `\s` in JavaScript, so a BOM between letters is collapsed to spaces before textForCheck and still bypasses (same at 468dc57). Worth stripping hidden characters before whitespace collapse.

PAN: keycap digits are newly caught (U+20E3 is Me, not in CARD_JOIN). Fullwidth and VS-inside digits were already covered. No false positives on the usual crabs/shells text, dates, phones, or emoji.

Locally: tsc clean, tests 206 passed three times, production build ok, gitleaks clean on 468dc57..afb3876, CSP smoke ok on an isolated desk port. The diff is only the four claimed files (+42/−4). Live money remains NO-GO.

## Hotfix 20ff075 (PR #88 head, one commit on afb3876) — Nov 11, 2026 ~4:57 AM CST

Delta review of `20ff0750a38868a6cfb4233e24e3966360722792` as the no-money deploy candidate. READ-ONLY. Scratch `/tmp/zsec-hf2` (mode 700), anonymous clone, removed after this section. Other agents' dirs and processes were not touched.

**Verdict: GO for 20ff075 as the no-money deploy candidate.** Live money remains NO-GO.

L-HF1 is fixed for the crisis *publish* path on ZWJ, FE0F, BOM, U+2060, soft hyphen, and fullwidth. Tag characters used as spaces are a remaining Low (a crisis phrase can still be published). Author screening is present and covers BANNED / links / control, with a 40-character store cap; it does not run crisis or PAN.

### Diff

`git diff --stat afb3876..20ff075` is only the claimed surfaces: `crisis.ts`, `social.ts`, `engine.ts`, `registry.ts`, plus tests `brain.test.ts`, `guestbook.test.ts`, and `world.test.ts` (+64/−15). No unexpected files.

### 1) CI run 43006458642

Checked through the GitHub API.

- Only workflow run on `20ff0750a38868a6cfb4233e24e3966360722792`.
- `get_workflow_run`: status `completed`, conclusion `success`, event `pull_request`, branch `cursor/lumen-jellyfish-9263`, head_sha exact match, run_attempt 1, run_number 40, workflow "Lumen".
- Started 4:46:49 AM CST (2026-11-11T10:46:49Z), finished 4:51:42 AM CST (2026-11-11T10:51:42Z).
- Sole job `next-build` (id 130475040307): conclusion `success`. Test, Typecheck, Production build, and CSP hydration smoke (4:48:04–4:51:38 AM CST) all succeeded.
- Artifact `lumen-smoke` id 13849126333, 738,165 bytes, expired=false, created 4:51:39 AM CST, expires 4:51:38 AM CST on Nov 18, 2026 (2026-11-18T10:51:38Z).

### 2) textForCheck on crisis, heavy, owner hook, and SPEND_WORDS

All four now call `textForCheck`:

- `crisisMatch` (crisis.ts:32) and `heavyNote` (crisis.ts:38) run it on their input. Guestbook/gift also pass `textForCheck(note)` on the *raw* body (engine.ts:347, 396); the extra wrap is idempotent.
- `replyToOwner` (social.ts:234) runs the hook regex on `textForCheck(clean)`, but `clean` is first whitespace-collapsed from the original (social.ts:232-234).
- `SPEND_WORDS` (registry.ts:541) runs on `textForCheck(said.note)`, and `said.note` is already the collapsed stored form.

**Probes (ZWJ, FE0F, BOM, U+2060, soft hyphen, tags, fullwidth):**

- Crisis publish path: ZWJ, FE0F, BOM (including `k\uFEFFill myself`), U+2060, soft hyphen, and fullwidth all return `{ ok: false, error: "CRISIS" }` for guestbook and `leaveGift`. Nothing is written. `CRISIS_REPLY` still contains 988. L-HF1 cases (`kill‍ myself`, `ki‍ll myself`, `kill️ myself`, soft hyphen, U+2060, BOM) all match.
- U+061C in a crisis (or any) note is `NOTE_CONTROL` and is not stored. `crisisMatch` itself would have been true after the strip.
- **Tag characters used in place of spaces miss.** `kill[U+E0020]myself` and `kill[U+E0061]myself`: `textForCheck` strips the tags and concatenates to `killmyself`, so `\bkill myself\b` fails. Both guestbook and gift **accepted and stored** the note (1 message and 1 gift in the probe). The same concatenation accepts `seed[TAG SPACE]phrase` as `seedphrase` (BANNED miss). Spend/jail hooks also miss when the required space was only a tag. Follow-up: decode tags (as `scrubInstructions` already does) or treat a stripped separator as a space.

- **BOM residual on the spend/hook path only.** `textForCheck` of the raw BOM-split `please buy this` is `please buy this` (caught). After `moderateNote` stores the collapsed form `p l e a s e b u y t h i s`, `SPEND_WORDS` and the owner hook — which see that collapsed string — miss. BANNED and the crisis *publish* path do not have this bug, because they run `textForCheck` on the raw input *before* `\s+` collapse (social.ts:40; engine.ts:347, 396). Follow-up: run those two hooks the same way.

### 3) Default_Ignorable strip and whitespace order

`stripHiddenForCheck` now includes `\p{Default_Ignorable_Code_Point}` (social.ts:22). ZWJ and FE0F are default-ignorable, so they disappear from the *check* copy (`👩‍💻` → `👩💻`); they are not in `NOTE_CONTROL`, so the **stored** note keeps the original emoji sequence. Confirmed kept as-is: ❤️, 👩‍💻, 👍🏽, 👨‍👩‍👧, 🇺🇸, 1️⃣.

BANNED now does `textForCheck(input)` and only then trims / collapses (social.ts:40). BOM between letters is stripped first, so `s[BOM]e[BOM]ed phrase` becomes `seed phrase` and is `NOTE_REJECTED`. (Collapsing first still produces `s e e d p h r a s e`; that is no longer the BANNED path.)

### 4) U+061C in the control regex

Present in `NOTE_CONTROL` (social.ts:35). `hello\u061Cworld` and `seed\u061C phrase` are `NOTE_CONTROL`. It is also Default_Ignorable. Side effect: an Arabic name that includes ALM (`محمد\u061Cعلي`) is rejected as a guestbook author. Low typography false positive.

### 5) Author-field moderation

`screenedAuthor` (engine.ts:454-457) is used from `leaveGift` (engine.ts:351) and `guestbook` (engine.ts:407-408). It calls `moderateNote(author, Math.max(author.length, 140))`, then stores `(author || "visitor").slice(0, 40)`.

Runs, via `moderateNote`:

- Control characters (`NOTE_CONTROL`, including U+061C).
- BANNED on `textForCheck` of the *raw* author (links `https?://` / `www.`, `<script`, seed phrase, private key, child-safety patterns). A `seed phrase` hidden after 100 padding characters is still rejected. BOM-split `s[BOM]eed phrase` is rejected.

Does **not** run:

- Crisis. Authors `kill myself` and `I want to die` were stored and the note was published.
- PAN. Author `4242424242424242` was stored. (`moderateNote` on this branch has no card scan; that exists on the metaverse branch.)

Length: the *stored* name is capped at 40 (an 80-character `A…` name stored as 40 `A`s). The `moderateNote` max is `Math.max(author.length, 140)`, so `NOTE_TOO_LONG` never fires on the author; the full string is scanned, then sliced. That scan-full behavior is useful for a banned phrase past column 40.

Normal names accepted, no false positives: Ada, José, María-José, O'Connor, Jean-Luc, 李明, 田中花子, محمد, فاطمة, Анна, Ιωάννης, अनिल, 🌸Ada, and `Ada 👩‍💻`. ZWJ in `Ad‍a` is stored (display spoof, same ZWJ loosening as notes).

`leaveGift` still appends the *raw* `author` to `visitorSeen` (engine.ts:361), not `named.name`. Guestbook was updated to the sliced name (engine.ts:424).

### 6) False positives (crisis / spend / hook)

This commit does not change the regexes themselves; these are the patterns as they behave after `textForCheck`.

- `killing it`, `killing time`, `die-hard fan`, `die hard fan without hyphen`: none. Good.
- `buy-in`: **SPEND_WORDS** (`\bbuy\b` treats `-` as a boundary) and **owner hook** (`buy` is a substring, no word boundary).
- Also trip spend and/or the hook (pre-existing): `checkout of the hotel later`, `wire sculpture`, `charge of the group`, `purchase a tray of pigments`. `I'm buying time` / `a buyer came by` trip the hook only (`buy` as a prefix). `I spent the afternoon on the rim` does not (`spent` ≠ `spend`).
- `ending it here with a joke`, `thanks for ending it`, `I'm ending it`: **CRISIS** (`\bending it\b` at crisis.ts:13). Pre-existing and broad; those notes would get the 988 path and would not be published.
- HEAVY only (guest reply, not a block): `hurt feelings`, `it doesn't hurt to try`, `I hate missing the boats`, `an empty shell`, `self-harm awareness week`.
- `I liked Suicide Squad` is still excluded. `the tide is kind` trips nothing.
- Owner chat: `what should I buy you` still hits the wishlist reply first (that test stays on `clean`, not `textForCheck`); `please buy this` and `b‍uy this now` hit the hook as intended.

### Local suite

- `tsc --noEmit`: clean.
- `npx vitest run` ×3: 34 files, 208 tests, all passed (206 at afb3876; two new guestbook tests).
- `npx next build`: exit 0.
- gitleaks on `afb3876..20ff075`: 1 commit, no leaks.
- CSP hydration smoke: desk port **3845**, system Chrome, `LUMEN_DATA` under the scratch dir, build skipped. Exit 0, `csp-smoke-ok`, expected screenshots. Port closed after the run.

`npm ci` reported 5 existing audit findings (2 moderate, 1 high, 2 critical). This delta does not change `package.json` / the lockfile; same as afb3876.

### Cleanup

Removed `/tmp/zsec-hf2`. Did not glob-delete `/tmp/lumen-smoke-*.sqlite`. Did not touch `/tmp/zsec-tools` or other agents' processes.

### Ready-to-send message for Software Engineer

Hotfix 20ff075 (PR #88) is GO as the no-money deploy candidate.

CI run 43006458642 is green on this exact SHA — it is the only run on it. Job next-build succeeded, including the CSP hydration smoke. Artifact lumen-smoke (738,165 bytes) expires 4:51 AM CST on Nov 18, 2026.

The diff is only crisis.ts, social.ts, engine.ts, registry.ts, and their tests. L-HF1 is fixed for the crisis publish path: ZWJ, FE0F, BOM, U+2060, soft hyphen, and fullwidth all return CRISIS on guestbook and leaveGift, nothing is stored, and the 988 reply is unchanged. BANNED now strips hidden characters *before* whitespace collapse, so a BOM between letters in "seed phrase" is rejected. U+061C is in NOTE_CONTROL. Emoji sequences (❤️, 👩‍💻, 👨‍👩‍👧, 🇺🇸, 👍🏽) are still stored as-is.

Please still follow up, not launch-blocking:

- Tag characters used as spaces are stripped and the letters are concatenated, so "kill[TAG SPACE]myself" was published on both guestbook and gifts, and "seed[TAG SPACE]phrase" misses BANNED. Decode tags, or treat a stripped separator as a space.
- replyToOwner and SPEND_WORDS still run textForCheck on the already-collapsed stored/clean string, so a BOM between letters in "buy" / "ignore previous instructions" still misses those two hooks. Use the same raw-then-collapse order as BANNED and the crisis path.
- screenedAuthor is in place and catches BANNED, links, script, and control characters, with a 40-character store cap. Normal Latin, accented, CJK, Arabic, Cyrillic, Greek, Devanagari, and emoji names passed. It does not run crisis or PAN: authors "kill myself" and 4242424242424242 were stored. leaveGift still records the raw author in visitorSeen, not the sliced name. An Arabic Letter Mark in a name is NOTE_CONTROL (false positive).
- False positives from the existing regexes, unchanged by this commit: "killing it" and "die-hard fan" are clean; "buy-in" trips SPEND_WORDS and the owner hook; "ending it" trips CRISIS (`\bending it\b`).

Locally: tsc clean, tests 208 passed three times, production build ok, gitleaks clean, CSP smoke ok on an isolated desk port. Live money remains NO-GO.
