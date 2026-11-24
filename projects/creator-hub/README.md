# Creator hub

Business tools for the Zoora AI YouTube channel (@ZooraTechnologies) and the planned crypto-security news channel:

- a tracked link hub with automatic disclosures and region rules;
- a video-service order page;
- an email signup page;
- command-line tools for comment moderation, revenue reporting and newsletter drafts.

The publish kit, which turns one episode into posts for every platform, lives next door in
[`projects/video-studio/scripts/publish-kit`](../video-studio/scripts/publish-kit/README.md).

**Status (2026-11-24):** built and tested on the build machine. Nothing is deployed. No live call was made to
YouTube, Kit, Fly.io, Cloudflare, Slack, Discord or Stripe. See
[What is verified and what is not](#what-is-verified-and-what-is-not).

## The six tools

| # | Tool | Where | Runs on | Details |
| --- | --- | --- | --- | --- |
| 1 | Tracked link hub | `src/server`: `/go/<offer>`, `/`, `/disclosures`, `/privacy`, `/admin` | the server | [docs/link-hub.md](docs/link-hub.md) |
| 2 | One video in, every platform out | `../video-studio/scripts/publish-kit` | your computer | [publish kit README](../video-studio/scripts/publish-kit/README.md) |
| 3 | Comment scam guard | `tools/comment-guard` | your computer | [README](tools/comment-guard/README.md) |
| 4 | Revenue dashboard | `tools/dashboard` | your computer | [README](tools/dashboard/README.md) |
| 5 | Video-service order page | `/studio`: `src/server/routes/studio.ts`, `src/server/studio/` | the server | [README](src/server/studio/README.md) |
| 6 | Email list | `/subscribe`: `src/server/routes/subscribe.ts`, plus `tools/newsletter` | the server and your computer | [README](tools/newsletter/README.md) |

### 1. Tracked link hub

Every affiliate or referral link goes out as `https://go.zoora.ai/go/<offer>?v=<video>&s=<source>`. `v` is
the YouTube id or the episode slug. `s` is one of `yt`, `shorts`, `tiktok`, `reels`, `x`, `email`, `bio`, `site`
or `other`.

- **Click logging.** Each click is logged per offer, video and source, with the country and the outcome. The
  hub stores no IP address and sets no cookie.
- **Redirect and sub-IDs.** The hub redirects (302) to the partner link in `config/offers.json`. When the
  programme supports sub-IDs, it adds `<subIdParam>=<video>.<source>`, so payouts can be tied to a video.
- **Region rules.** A visitor is blocked when the offer is blocked in their country, or when their country is
  unknown and the offer says `unknownCountry: "block"`. Blocked visitors get a "not available in your region"
  page (451), which never shows the destination and suggests alternatives allowed where they are. Ended offers
  get 410.
- **Automatic disclosures.**
  - The link-in-bio page `/` shows each offer's relationship and disclosure right above its link. It adds a
    risk warning to an exchange offer whose disclosure lacks one.
  - `/disclosures` lists every relationship.
  - `/admin/links?v=<video>&s=yt` builds paste-ready description text with a disclosure under each link.
    Offers that are restricted by region are never named in it.
- **Owner page (`/admin`, password protected).**
  - Human clicks by offer, video and source over 7 and 30 days, counted once per visitor, offer and day.
  - Region blocks, page views and studio requests.
  - CSV exports for the dashboard.
- **Startup checks.** The server refuses to start while the offer registry has a problem:
  - a country code that is not ISO (use `GB`, not `UK`);
  - an exchange or other financial promotion without country lists and `unknownCountry: "block"`;
  - a placeholder URL on an active offer;
  - a memecoin launchpad, found by host, by tracking-link target, by name or in the notes. Pump.fun and other
    launchpads are never offers.

### 2. One video in, every platform out (publish kit)

From `projects/video-studio`, `node scripts/publish-kit/cli.ts <channel>/<slug>` reads the episode's
`episode.json`, plus its captions and voice timeline when they exist. It writes `out/publish/<channel>/<slug>/`:

- **YouTube.** The description and the pinned comment. The description starts with the disclosure, follows each
  hub link with its disclosure, and lists the chapters and sources.
- **Other platforms.** Post text for Shorts, TikTok, Reels, X and Instagram, each within that platform's limits.
  - X posts carry hub links tagged `s=x`.
  - Shorts, TikTok, Reels and Instagram captions cannot hold clickable links, so they point to the link in your
    profile (`/?s=tiktok`, `/?s=reels`).
  - Every offer a post names carries its disclosure.
- **Captions.** `captions.srt` and `captions.vtt`.
- **Render plan.** `render-plan.sh` holds the commands that render the long video, each vertical Short and the
  thumbnails, plus loudness normalisation. The kit never renders by itself: run the plan, or use the render farm
  (`.github/workflows/video-render.yml`).
- **Checks.** `checklist.md` lists 22 automatic checks, failures first, then the manual upload steps. The checks
  include:
  - each scene that promotes an offer states the relationship in its narration (read from the captions);
  - no income, return, price or buy-call wording, in the narration too;
  - every offer link goes through the hub, and region-restricted offers are never named;
  - "made for kids" is off, and the AI-label setting carries its reason.

  Showing the disclosure on screen and ticking the YouTube Studio boxes are manual steps on the checklist.
- **kit.json.** The manifest that the newsletter, the dashboard and the uploader read.

### 3. Comment scam guard

- **Dry run.** `npm run guard` reads recent comments through the YouTube Data API and writes a report. It scores
  each comment for "WhatsApp me" bots, impersonators of the channel, seed-phrase and wallet-drainer scripts, fake
  "account managers" and recovery scams. It changes nothing.
- **Holding.** `npm run guard -- apply --confirm --from-report latest` holds the high-scoring comments for review
  in YouTube Studio. `release` undoes a hold. The guard never deletes, rejects or bans.
- **Studio settings.** `npm run guard -- blocked-words` prints a blocked-words list and the recommended Studio
  settings. It needs no API.
- **Accuracy.** Measured once on fresh comments, before any tuning, it flagged 79% of scams, held 57%, and flagged
  1.4% of genuine comments. Real comments may differ, so run the dry run for a week before using `apply`.

### 4. Revenue dashboard

`npm run dashboard` combines three sources into `out/dashboard/metrics.csv` and a static `index.html`:

- the YouTube Studio CSV export, or the YouTube Analytics API;
- the hub's de-duplicated clicks per video;
- affiliate payout CSVs, tied to videos through the sub-ID.

At 10, 20, 30... videos it writes `recommendations.md`. Per format, topic and offer it says double down, test,
cut or steady, with the numbers behind each call. Below 10 videos it says the sample is too small. Offers that
are restricted by region never get "double down". The dashboard describes past results and makes no
prediction of earnings.

### 5. Video-service order page

`/studio` is a sales page for explainer videos with a quote-request form. It shows packages, deliverables,
process and FAQ, plus plain-language terms: no guaranteed results, no investment promises, and no crypto
financial promotions for clients on our own channels.

- **Requests.** They are stored in SQLite (`orders`) and managed in `/admin`. An optional webhook pings Slack or
  Discord with the order id only.
- **Prices and terms.** Until you set prices, turnaround and revisions in `config/studio.json`, the page shows
  "Contact for a quote" and "Agreed after the brief".
- **Before launch.** Production answers 503 until `config/studio.json` exists, so the starter example is never
  published.

### 6. Email list

- **Signup page.** `/subscribe?s=<source>&v=<video>` shows the Kit form with its consent text. The browser sends
  the address straight to Kit; the hub never receives it.
- **Newsletter drafts.** `npm run newsletter -- draft <kit.json>` turns an episode's publish kit into an email
  draft (Markdown and email-safe HTML).
  - Links are tagged `s=email`, and each offer's disclosure sits right above its link.
  - Only offers allowed for an unknown country go in, because an email reader's country is unknown. Exchanges
    are always left out.
  - A lint blocks income, return and price claims and missing disclosures.
- **Kit draft.** `--kit-draft` also creates an unsent draft broadcast in Kit. It needs `KIT_API_KEY` and a chosen
  audience, and you send it from Kit.

### Other tools in this folder

Other folders under `tools/` come from separate workflows, for example:

- `tools/uploader`: uploads an episode as private only after you approve the exact file and metadata;
- `tools/retention`: scene-by-scene audience retention.

Each has its own README.

**Second channel.** The comment guard (`auth --account news`), the dashboard (`--channel`), the publish kit and
the uploader already handle a second channel. One hub can serve both channels' links. Run a second instance
(another Fly app with its own `BRAND_NAME` and hostname) only if the news channel needs its own branded link
page.

## How it fits together

**Why a subdomain.**

- zoora.ai is a static GitHub Pages site (`sites/zoora-newsletter/public`), and its newsletter form posts
  straight to Kit.
- A static site cannot log clicks or check a visitor's region before redirecting. A path like
  `zoora.ai/go/<offer>` would need a server or proxy in front of the whole site.
- So the hub is one small Node server on its own subdomain, such as `go.zoora.ai`. The apex, `www`, the mail
  records and the newsletter site stay as they are. (`projects/lumen/docs/HOSTING_FLY.md` describes a possible
  later move of the apex to Fly; the hub does not depend on it.)

```
 Viewer on YouTube, Shorts, TikTok, Reels, X or email
   |   https://go.zoora.ai/go/<offer>?v=<video>&s=<source>
   v
 Cloudflare proxy (recommended): sets the visitor's country (CF-IPCountry) and the shared secret header
   |
   v
 Fly.io: one machine running `node src/server/main.ts` ----- /data/hub.sqlite on a Fly volume
   |   checks the offer and the region, logs the click
   +-- 302 to the partner link (only where the offer is allowed)
   +-- 451 "not available in your region", 410 "offer ended", 404

 Your computer (never deployed):
   publish kit --> kit.json --+--> newsletter draft --> Kit (draft only, you send it)
                              +--> dashboard <-- Studio CSV, /admin/export/*.csv, payout CSVs
                              +--> uploader (after your approval)
   comment guard <--> YouTube Data API (dry run by default)
```

**The server.** One Node process built on `node:http`.

| Path | What it serves |
| --- | --- |
| `/go/<offer>` | The tracked redirect: 302, 451, 410 or 404 |
| `/` | Link-in-bio page. Use `/?s=tiktok` or `/?s=reels` as the profile link |
| `/disclosures`, `/privacy` | Every relationship; what is logged and for how long |
| `/studio`, `/studio/thanks` | Order page and confirmation |
| `/subscribe`, `/subscribe/thanks` | Kit signup and "check your inbox" |
| `/admin`, `/admin/links`, `/admin/export/*.csv` | Owner only: reports, link builder, CSV exports, order status |
| `/healthz`, `/robots.txt` | Health check (`{"ok":true}`) and crawler rules |

- **Data.** One SQLite file, `$DATA_DIR/hub.sqlite`, through `node:sqlite`. Run exactly one machine: the
  database lives on one volume, and the rate limits and sign-in lockouts are kept in memory.
- **Pages.** Plain HTML and CSS with no JavaScript, the system font stack and the brand colours (#0B0C0F,
  #F4F6F8, teal #29B8AD). They work at phone width and respect reduced motion. The hub pages follow the
  visitor's light or dark setting; the studio pages are dark only.
- **Security.**
  - A strict Content-Security-Policy (no inline script or style) and HSTS on https.
  - Signed CSRF tokens on admin forms.
  - An scrypt admin password with lockouts.
  - Prepared SQL statements and escaped HTML.
  - A 16 KB limit on form bodies, and rate limits per visitor and per IP.
  - Visitor codes are an HMAC of the IP and user agent with a daily key, so raw IPs are never stored.
- **Shared contracts.** The tools talk through `src/types.ts` (offers, clicks, orders, video metrics, the publish
  kit manifest), `src/server/http.ts` (route modules) and `src/db/schema.sql`. Two optional fields were added on
  2026-11-24: `Offer.financialPromotion` and `HubConfig.operatorName`.

## Why there are no runtime dependencies

`package.json` has no `dependencies`. It has only `devDependencies` for the typecheck: TypeScript 5.9.3 and
`@types/node` 22.18.12, pinned in `package-lock.json`.

- **No build step.** Node 22.18 and later run the `.ts` sources directly by stripping the types, so the code in
  git is the code that runs. That allows only erasable TypeScript (no enums, namespaces or parameter
  properties) and needs explicit `.ts` import paths; `tsconfig.json` enforces both.
- **The standard library is enough.** `node:http` serves, `node:sqlite` stores, `node:crypto` does scrypt, HMAC
  and random secrets, `node:test` tests, and `node:fs` reads files.
- **Nothing to audit or patch.** The hub handles affiliate links, an admin login and order requests, and the
  repository is public. With no third-party package in the request path, there is no dependency supply chain
  to audit or patch: updating Node is the whole update story. The Docker image runs no `npm install`.
- **Trade-offs.** `node:sqlite` is still marked experimental in Node 22 and prints a warning (the image hides it).
  HTML is built with small escaping helpers instead of a template engine.

## Run it locally

You need Node 22.18 or newer (22.23 was used here). Run everything from `projects/creator-hub`.

```sh
npm ci                                              # TypeScript and Node types, for the typecheck only
cp config/offers.example.json config/offers.json    # optional: your real offers (gitignored)
cp config/studio.example.json config/studio.json    # optional: your real packages (gitignored)
node src/server/main.ts                             # http://localhost:8080 (npm start does the same)
```

Without these files the server uses the examples: every offer is inactive, and `/studio` shows the example (in
development only).

To sign in to `/admin` locally:

1. Run `node src/server/hash-password.ts`. It asks for the password twice and prints a hash.
2. Start the server with `ADMIN_USER=owner ADMIN_PASSWORD_HASH=<hash> node src/server/main.ts`. In PowerShell:
   `$env:ADMIN_USER="owner"; $env:ADMIN_PASSWORD_HASH="<hash>"; node src/server/main.ts`.

The tools:

```sh
npm run guard -- blocked-words                   # comment guard: Studio settings, no API needed
npm run guard                                    # comment guard: dry run (needs `npm run guard -- auth` once)
npm run dashboard                                # revenue dashboard from the files in data/
npm run newsletter -- draft ../video-studio/out/publish/zoora-ai/<slug>/kit.json
cd ../video-studio && node scripts/publish-kit/cli.ts zoora-ai/<slug>   # publish kit
```

## Tests and CI

```sh
cd projects/creator-hub
npm test                                     # node --test over src/, tools/ and test/
npx tsc --noEmit                             # typecheck
cd ../video-studio
node --test "scripts/publish-kit/*.test.ts"  # publish kit
```

Tests run against fixtures, temporary folders and mocked HTTP. They never call the internet. The server tests
start a real hub on a random local port.

[`.github/workflows/creator-hub.yml`](../../.github/workflows/creator-hub.yml) runs these commands. It also runs
the publish kit's strict typecheck, using creator-hub's TypeScript. It runs:

- on pull requests and on pushes to `main` that touch `projects/creator-hub`, the publish kit or its example
  episode;
- by hand, from the Actions tab, once the workflow file is on `main` (GitHub starts manual runs only for
  workflows on the default branch).

Pushes to other branches do not run it, so open a pull request to get a run.

It uses a read-only token and actions pinned to commit SHAs. It starts nothing and deploys nothing.

## Configuration files

Real configuration files are gitignored. Only the `*.example.*` templates are committed, because this
repository is public.

| File (gitignored) | Start from | Used by | Holds |
| --- | --- | --- | --- |
| `config/offers.json` | `config/offers.example.json` | hub, publish kit, newsletter, dashboard | The offer registry: affiliate and referral URLs, disclosures, country rules, sub-ID parameter ([details](docs/link-hub.md#the-offer-registry-configoffersjson)) |
| `config/studio.json` | `config/studio.example.json` | `/studio` | Packages, deliverables, prices, FAQ, portfolio, optional Stripe links. Check it with `node src/server/studio/check-config.ts config/studio.json` |
| `config/payouts.json` | `config/payouts.example.json` | dashboard | How to read each affiliate network's payout CSV |
| `data/videos.csv` | `tools/dashboard/videos.example.csv` | dashboard | Per-video format, topic tags and alias slugs |
| `config/youtube-oauth.json` | written by `npm run guard -- auth` | comment guard | Google refresh tokens (mode 0600). Never commit it |
| `fly.toml` | `fly.toml.example` | Fly.io | App name, region, public settings. It holds no secrets and may be committed |
| `.env` | none | `docker run --env-file` | Local environment for the container. Ignored by the repository's root `.gitignore` |

Data and output folders are gitignored as well: `data/` (database, exports, payout files) and `out/` (reports,
dashboard, newsletter drafts). The Docker image is built from an allow-list (`.dockerignore`), so tools, tokens,
`.env` files and `data/` never enter it.

## Environment variables

**The server** (`src/server/config.ts`). With `NODE_ENV=production`, which the Docker image sets, the server
refuses to start until every variable marked "production" is set. It logs a warning for each risky setting.

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `PUBLIC_BASE_URL` | production | `http://localhost:<PORT>` | The public origin, e.g. `https://go.zoora.ai`. It must be https in production |
| `HASH_SECRET` | production | a random one per process | At least 32 random characters. It keys the daily visitor code |
| `KIT_FORM_ACTION` | production | the zoora.ai form 10168331 (development only) | The subscriptions URL of the Kit form for episode emails. Create a separate form: the zoora.ai form's sign-ups agreed to other emails |
| `CONTACT_EMAIL` | production | none | The public contact shown on `/privacy`, `/disclosures` and `/studio` |
| `ADMIN_USER`, `ADMIN_PASSWORD_HASH` | both or neither | unset, so `/admin` is off | The admin login. Make the hash with `node src/server/hash-password.ts` |
| `OPERATOR_NAME` | recommended | `BRAND_NAME` | The person or business named on `/privacy` |
| `TRUST_PROXY` | | `none` | `none`, `cloudflare` or `header`. See [Cloudflare](#strongly-recommended-cloudflare-in-front-so-country-rules-work) |
| `PROXY_SECRET` | production, when the country comes from a header | none | At least 32 characters. Proxy headers are trusted only on requests that carry it |
| `PROXY_SECRET_HEADER` | | `X-Origin-Secret` | The header that carries `PROXY_SECRET` |
| `IP_HEADER`, `GEO_HEADER` | header mode | none | The client-IP header (Fly: `Fly-Client-IP`) and the country header |
| `FORM_ACTION_ORIGINS` | | none | Extra https origins that forms may post or redirect to, separated by spaces |
| `BRAND_NAME` | | `Zoora AI` | The name on every page |
| `PORT`, `HOST` | | `8080`, all addresses | Where the server listens |
| `DATA_DIR` | | `./data` (`/data` in the image) | The folder that holds `hub.sqlite` |
| `CONFIG_DIR` | | `config/` | The folder that holds `offers.json` and `studio.json` |
| `RATE_LIMIT_BURST`, `RATE_LIMIT_PER_MINUTE` | | `40`, `60` | Limits per visitor. Each IP gets 10 times both |
| `NOTIFY_WEBHOOK_URL` | | none | Studio: one POST per new order with only `{id, packageId, ts, text}`. https only (plain http only for localhost). Treated as a secret: never logged |

**The tools** (they run on your computer).

| Variable | Tool | Meaning |
| --- | --- | --- |
| `HUB_BASE_URL` | publish kit | The hub origin in kit links. Default `https://go.zoora.ai` |
| `KIT_API_KEY` | newsletter `--kit-draft` | A Kit v4 API key (Kit: Settings > Developer) |
| `KIT_SUBSCRIBER_FILTER` | newsletter `--kit-draft` | The draft's audience: `tag:<id>`, `segment:<id>` or `tag:12,34`. Or pass `--all-subscribers` |
| `PUBLIC_BASE_URL`, `BRAND_NAME` | newsletter | The hub origin when `kit.json` has relative links, and the brand name |
| `YOUTUBE_OAUTH_FILE` | comment guard | The credentials file. Default `config/youtube-oauth.json` |
| `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` | comment guard `auth` | Instead of `--client-secrets <file>` |
| `GUARD_CHANNEL_NAMES`, `GUARD_TRUSTED_CHANNELS`, `GUARD_OWN_HANDLES` | comment guard | Names to protect, channels never flagged, and handles you own. Comma-separated |
| `DATA_DIR` | dashboard, retention | Where the inputs are. Default `projects/creator-hub/data` |
| `YT_ANALYTICS_ACCESS_TOKEN`, or `YT_ANALYTICS_CLIENT_ID`, `YT_ANALYTICS_CLIENT_SECRET` and `YT_ANALYTICS_REFRESH_TOKEN` | dashboard `--api`, retention | YouTube Analytics API access |
| `UPLOADER_STATE_DIR`, `UPLOADER_OAUTH_FILE`, `UPLOADER_CLIENT_ID`, `UPLOADER_CLIENT_SECRET` | uploader | See `tools/uploader/README.md` |
| `RETENTION_DERIVED_METRICS`, `RETENTION_POLICY_DATE`, `VIDEO_STUDIO_DIR` | retention | See `tools/retention/README.md` |

Make a random secret with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.

## Deploy on Fly.io

The Fly account, installing `flyctl` and signing in are covered in
[`projects/lumen/docs/HOSTING_FLY.md`](../lumen/docs/HOSTING_FLY.md). Use the personal organization, as that
document does. The hub is a second app in the same organization.

**Cost.** Fly bills every running machine and volume. A personal organization's bill under $5 for the month is
waived, but the waiver is not a cap: at $5 or more the whole bill is charged. Lumen's own estimate is about
$3.84 a month (HOSTING_FLY.md), so Lumen and the hub together may cross the line. After the first deploy, check
the estimate on the Billing page and keep the spend alert that document sets up. Never allocate a dedicated IPv4
(`fly ips allocate-v4` without `--shared`): it costs extra and the hub does not need one.

Run these from `projects/creator-hub`, on the computer that holds your real `config/offers.json` and
`config/studio.json`. `fly deploy` copies them into the image; they are never committed. `zoora-hub` and `iad`
are examples: pick any free app name, and the region closest to most viewers (Lumen uses `iad`).

1. Create the app and its volume.

   ```sh
   cp fly.toml.example fly.toml            # then replace every REPLACE value (see below)
   fly apps create zoora-hub
   fly volumes create hub_data --size 1 --region iad -a zoora-hub
   ```

   In `fly.toml`, set:
   - `app` and `primary_region`;
   - `PUBLIC_BASE_URL` (`https://go.zoora.ai`) and `CONTACT_EMAIL`;
   - `KIT_FORM_ACTION`, your new Kit form for episode emails;
   - optionally `OPERATOR_NAME`.

   Keep `TRUST_PROXY = "header"` and `IP_HEADER = "Fly-Client-IP"` until Cloudflare is set up.

2. Set the secrets. They never go in `fly.toml`.

   ```sh
   node src/server/hash-password.ts        # type the admin password twice; it prints the hash
   fly secrets set -a zoora-hub ADMIN_USER=owner ADMIN_PASSWORD_HASH=<the printed hash>
   ```

   For `HASH_SECRET`, in bash or zsh:

   ```sh
   fly secrets set -a zoora-hub HASH_SECRET="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
   ```

   In PowerShell:

   ```powershell
   $s = node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   fly secrets set -a zoora-hub HASH_SECRET=$s
   ```

3. Deploy one machine. SQLite lives on one volume, so never run two.

   ```sh
   fly deploy --ha=false -a zoora-hub
   ```

4. Check it.
   - `fly status -a zoora-hub` and `fly checks list -a zoora-hub` should show the machine running and healthy.
   - `fly logs -a zoora-hub` shows the startup warnings, such as which config files were found and whether a
     country header is trusted.
   - `https://zoora-hub.fly.dev/healthz` should answer `{"ok":true}`.

**How it runs.** The image runs the server as the unprivileged `node` user. Fly mounts the volume owned by root,
so the start script gives `/data` to `node` and drops privileges first. The machine stays on
(`auto_stop_machines = "off"`), so redirects are instant and the daily data purge runs. Fly checks `/healthz`
every 30 seconds.

**Changing offers or packages later.** Edit `config/offers.json` or `config/studio.json`, then run `fly deploy`
again.

**Backups.** Fly takes daily snapshots of the volume and keeps them for 5 days by default (HOSTING_FLY.md shows
how to list and restore them). For the dashboard, download `/admin/export/video-clicks.csv` instead of copying
the live database.

## DNS: go.zoora.ai at Namecheap

zoora.ai's DNS is at Namecheap. These steps add only the `go` record and leave everything else alone.

1. Ask Fly for the certificate and the records it wants:

   ```sh
   fly certs add go.zoora.ai -a zoora-hub
   fly certs setup go.zoora.ai -a zoora-hub
   ```

   The records it prints are the source of truth.

2. In Namecheap, open Domain List, then zoora.ai, Manage, Advanced DNS, and Add New Record. Use host `go`;
   Namecheap adds `.zoora.ai` itself. Use whichever form Fly asks for:

   | Type | Host | Value |
   | --- | --- | --- |
   | CNAME | `go` | `zoora-hub.fly.dev` |

   or

   | Type | Host | Value |
   | --- | --- | --- |
   | A | `go` | the shared IPv4 from `fly ips list -a zoora-hub` |
   | AAAA | `go` | the IPv6 from `fly ips list -a zoora-hub` |

3. Wait for DNS, then run `fly certs check go.zoora.ai -a zoora-hub` until the certificate is issued.

4. Open `https://go.zoora.ai/healthz`.

The apex `zoora.ai`, `www`, the MX, SPF and verification records, and the GitHub Pages newsletter site do not
change.

## Strongly recommended: Cloudflare in front, so country rules work

**Why.** The hub can only apply country rules when a trusted proxy tells it the visitor's country. Fly reports
the visitor's IP but not their country. So without Cloudflare, every visitor's country is unknown, and every
offer with `unknownCountry: "block"` (exchanges and other financial promotions) is hidden for everyone. That is
safe, and unrestricted offers such as security products work normally, but restricted offers never show
anywhere. With Cloudflare's proxy in front and `TRUST_PROXY=cloudflare`, the hub reads the country from
`CF-IPCountry` and the IP from `CF-Connecting-IP`. It trusts them only on requests that carry the shared secret,
because the origin stays reachable directly at `zoora-hub.fly.dev`.

**What moves.** On Cloudflare's Free and Pro plans the zone must use Cloudflare's nameservers. The partial (CNAME)
setup that keeps Namecheap DNS is for Business and Enterprise plans only. So all of zoora.ai's DNS moves to
Cloudflare. Before switching the nameservers at Namecheap:

- **Check the copied records.** Cloudflare's import must have every record: the GitHub Pages records for
  `zoora.ai` and `www`, the MX and SPF records, the TXT verification records and any Kit DKIM records. Keep
  `zoora.ai` and `www` on **DNS only** (grey cloud), so GitHub Pages works exactly as now.
- **Move mail forwarding first.** Namecheap's free email forwarding only works while Namecheap hosts the DNS
  (Namecheap's own help article). If you use it, set up another forwarder, such as Cloudflare's Email Routing,
  first.

Then:

1. **The `go` record.** Add it in Cloudflare as above, at first as **DNS only**. Add the validation record that
   `fly certs setup go.zoora.ai` prints: a `_fly-ownership` TXT record, or an `_acme-challenge` CNAME, which must
   stay DNS only. Run `fly certs check go.zoora.ai` until it is issued, then switch `go` to **Proxied** (orange
   cloud). Keep the validation record so renewals work.
2. **SSL/TLS mode.** Set it to **Full (strict)**. Flexible causes a redirect loop with Fly's `force_https`.
3. **IP Geolocation.** In the Network settings, turn it **on**. That is what adds `CF-IPCountry`.
4. **The shared secret.** In Rules, open Transform Rules and add a request-header rule for `go.zoora.ai`. Its
   action "Set static" sets `X-Origin-Secret` to a long random value, such as the one-liner's output above. Then
   run `fly secrets set -a zoora-hub PROXY_SECRET=<the same value>`.
5. **fly.toml.** Replace the `TRUST_PROXY` and `IP_HEADER` lines with `TRUST_PROXY = "cloudflare"`, then run
   `fly deploy --ha=false -a zoora-hub`. In production the server refuses to start in this mode without
   `PROXY_SECRET`.
6. **Test it.** Use an offer that is blocked in your own country, such as one blocked in the US, and send a fake
   country header with curl (`curl.exe` on Windows):
   - `curl -s -o /dev/null -w "%{http_code}\n" -H "CF-IPCountry: DE" https://go.zoora.ai/go/<offer>` must
     print 451, because Cloudflare replaced the fake header with your real country;
   - the same request to `https://zoora-hub.fly.dev/go/<offer>` must also print 451, because it has no secret;
   - `/admin` shows region blocks by country, so you can see that real countries arrive.

   If either request prints 302, stop: the country header can be faked. Fix the setup before activating any
   restricted offer.

**Limits of country rules.** IP geolocation is an estimate, and visitors on a VPN appear elsewhere. Cloudflare's
own documentation says not to use it as the only signal for compliance-critical restrictions. So the hub's
region filter is a safety net, not legal clearance. The binding rules still apply:

- restricted offers are never named in videos, posts or emails (the publish kit and the newsletter enforce
  this);
- get legal review before promoting any of them.

**Sources**, read 2026-11-24 through search-engine extracts, because fly.io and developers.cloudflare.com were
blocked from the build machine. Re-check them before relying on them:

- [Fly custom domains](https://fly.io/docs/networking/custom-domain/) and
  [Understanding Cloudflare](https://fly.io/docs/networking/understanding-cloudflare/)
- [Cloudflare IP geolocation](https://developers.cloudflare.com/network/ip-geolocation/) and
  [HTTP headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/) (`CF-IPCountry`: `XX` means
  no data, `T1` means Tor; both count as unknown)
- [Partial (CNAME) setup](https://developers.cloudflare.com/dns/zone-setups/partial-setup/)
- [Request header Transform Rules](https://developers.cloudflare.com/rules/transform/request-header-modification/)
- [Namecheap free email forwarding](https://www.namecheap.com/support/knowledgebase/article.aspx/308/2214/how-to-set-up-free-email-forwarding/)

## Owner inputs needed

Required before launch:

- [ ] **Affiliate and referral URLs.** Put them in `config/offers.json` (gitignored), then set `"active": true`.
      For each offer:
  - the programme's terms URL;
  - its sub-ID parameter, if it has one;
  - the complete restricted-country list, copied from the programme's own page. The example Bybit entry blocks
    only US and GB;
  - a disclosure that names the relationship and the benefit, e.g. "Affiliate link: I may earn a commission if
    you buy."

  Mark staking, yield, lending, trading or signals offers `"financialPromotion": true`. No launchpads.
- [ ] **Studio prices and packages.** Create `config/studio.json` from the example. Set `priceUsd`,
      `turnaroundDays` and `revisions` only once you have decided them; they stay "Contact for a quote" until
      then. Make the deliverables and FAQ match what you will actually do. Add portfolio entries only for real,
      published work.
- [ ] **Admin login.** Run `node src/server/hash-password.ts`, then set `ADMIN_USER` and `ADMIN_PASSWORD_HASH` as
      Fly secrets.
- [ ] **`HASH_SECRET`.** At least 32 random characters, as a Fly secret.
- [ ] **`CONTACT_EMAIL`**, the public business address, and **`OPERATOR_NAME`**, the person or business named on
      `/privacy`.
- [ ] **A Kit form for episode emails.**
  - Create it, and put its subscriptions URL in `KIT_FORM_ACTION`.
  - Turn on double opt-in, and tag its subscribers.
  - Set its after-signup redirect to `https://go.zoora.ai/subscribe/thanks`, or use Kit's success message.
  - Set a postal address in Kit; anti-spam law requires one in every email.
- [ ] **Fly and DNS.** The Fly app name and region, the volume, the deploy, and the `go` record at Namecheap.
- [ ] **Cloudflare.** Decide whether to put it in front. If yes: the nameserver move, Full (strict), IP
      Geolocation, the Transform Rule and `PROXY_SECRET`.
- [ ] **Public wording.** Review the text that states your practices and confirm or edit it:
  - "will never DM you first, ask for your seed phrase or ask you to connect a wallet";
  - the disclosure and sponsorship statements on `/disclosures`;
  - the 13-month retention on `/privacy`;
  - the studio's terms. Have a lawyer review them, and every offer that is restricted by region.

For the tools:

- [ ] **YouTube OAuth client.** In one Google Cloud project, enable YouTube Data API v3. Set the consent screen
      to In production (in Testing, tokens expire after 7 days). Create a Desktop-app OAuth client and run
      `npm run guard -- auth --client-secrets <file>`. The uploader and retention tools use the same kind of
      client, and the dashboard's optional `--api` uses YouTube Analytics API access (`YT_ANALYTICS_*`).
- [ ] **Comment guard.** Paste the `guard blocked-words` list into Studio and apply its settings. Add your own
      handles (`GUARD_OWN_HANDLES`), and run the dry run for about a week before using `apply`.
- [ ] **Dashboard inputs.** Export YouTube Studio's Content table into `data/youtube/`, with Studio set to
      English. Map each payout CSV in `config/payouts.json`. Fill `data/videos.csv`.
- [ ] **Publish kit, per episode.** Speak the disclosure in each scene that promotes an offer, and keep it on
      screen. Re-run the kit with `--youtube-id` after the upload. Set the profile links to
      `https://go.zoora.ai/?s=tiktok` and `?s=reels`.
- [ ] **Optional: `KIT_API_KEY`** (plus `KIT_SUBSCRIBER_FILTER`), for `npm run newsletter -- draft --kit-draft`.
- [ ] **Optional: `NOTIFY_WEBHOOK_URL`**, a Slack or Discord webhook, to hear about new studio requests.
- [ ] **Optional: Stripe Payment Links** per studio package, only once that package has a price.

## What is verified and what is not

Verified on the build machine (Linux, Node 22.23.5, 2026-11-24):

- **Tests.** The final integration run (08:47 UTC) gave:
  - `npm test` in creator-hub: `# tests 726`, `# suites 155`, `# pass 726`, `# fail 0`. That count includes
    tools other workflows were still adding;
  - `npx tsc --noEmit`: exit 0;
  - the publish kit's `node --test "scripts/publish-kit/*.test.ts"`: `# tests 117`, `# suites 37`, `# pass 117`,
    `# fail 0`;
  - its strict typecheck: exit 0.
- **CI commands.** The commands in `.github/workflows/creator-hub.yml` were run in a fresh copy of these folders
  (a new git work tree, `npm ci` from the registry). The workflow has not run on GitHub yet.
- **Docker image.** It was built from the current sources and run here.
  - In production with missing settings, it exits 1 and lists every problem.
  - With the Fly settings from `fly.toml.example`, it turns healthy, and the server runs as uid 1000 with
    no-new-privileges.
  - The routes answer as documented: `/studio` gives 503 without `studio.json`, and `/admin` gives 401 and then
    200 with the password.
  - In Cloudflare mode with `PROXY_SECRET`, an exchange blocked in US and GB gave 451 for GB, US and unknown
    countries, and a 302 for DE. Without the secret, or with a wrong one, DE gave 451. An unrestricted offer
    redirected with its sub-ID. The 451 page never contained the destination.
- **Reviews.** Independent reviews for security, compliance and correctness ran live attacks and probes against
  a local hub and the tools. They covered open redirects, spoofed proxy headers, XSS, SQL injection, CSRF,
  request smuggling, body limits, admin brute force, ReDoS, disclosure placement, region rules, claim lints and
  email consent. Their defects were fixed and re-tested.
- **Screens.** The builders checked the pages in headless Chromium at phone width and on desktop, in light and
  dark. After the review fixes, `/`, the 451 page, `/disclosures`, `/privacy`, `/studio` and `/subscribe` were
  checked again at 390 px.

Not verified. **No live API call was made, and nothing was deployed:**

- **Hosting.** No Fly.io deploy, Cloudflare setup or DNS change. The `fly.toml` keys, the Fly and Cloudflare
  behaviour and the certificate steps come from documentation extracts, not from a real deployment.
- **APIs.** No call to the YouTube Data API, the YouTube Analytics API, Google OAuth, the Kit API (including the
  `subscriber_filter` shape), Slack or Discord webhooks, or Stripe. Their clients are built from the official
  documentation (or Google's discovery documents) and tested only against mocks and recorded-shape fixtures.
- **Documentation hosts.** Many were blocked from the build machine and were read only through search
  extracts: fly.io, developers.cloudflare.com, developers.kit.com, support.google.com and most of
  developers.google.com, docs.slack.dev, discord.com and docs.stripe.com. Each tool's README lists its sources.
- **Real-world inputs.** Not checked against real data:
  - the YouTube Studio export header names;
  - email rendering in Gmail, Outlook or Apple Mail;
  - the comment guard's accuracy on real comments.
- **Windows.** The commands were run on Linux only, not on Windows.
- **Not legal advice.** None of this is legal advice. The disclosures, the studio terms and any region-restricted
  offer need the owner's review, and a lawyer's.

## Database

`src/db/schema.sql`, version 1, is shared by every module.

| Table | Holds |
| --- | --- |
| `clicks` | One row per `/go` request: time, offer, video, source, country, visitor code, bot flag, outcome, referrer host |
| `page_events` | Page views of `/`, `/studio`, `/subscribe` and its thanks page, with source and video |
| `orders` | Studio requests and their status |
| `meta` | `schema_version` |

A daily purge deletes clicks, page views and orders older than 13 months; orders marked `won` are kept.

**Migrations.** None yet. Change the schema only together with a note here: what changed, why, and the SQL to
upgrade an existing `hub.sqlite`. Changes suggested by the builders, not made:

- an index on `clicks (ts)`, if the click volume grows;
- `source` and `video_id` columns on `orders`, to tie a request to the video that sent it.

## Layout

```
projects/creator-hub/
  README.md            this file
  src/types.ts         shared contracts (offers, clicks, orders, metrics, publish kit manifest)
  src/claims.ts        income and result claim rules (newsletter, studio config check)
  src/launchpads.ts    the memecoin-launchpad block list
  src/db/schema.sql    SQLite schema v1
  src/server/          the hub: main.ts, app.ts, config.ts, geo.ts, offers.ts, routes/, studio/
  tools/               comment-guard, dashboard, newsletter, uploader, retention, ...
  config/*.example.*   templates for the gitignored config files
  docs/link-hub.md     the link hub's operating notes
  Dockerfile, docker/start.sh, fly.toml.example   deployment
```
