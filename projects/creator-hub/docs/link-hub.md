# Link hub: operating notes

The hub serves tracked links at `/go/<offer>?v=<video>&s=<source>`, a link-in-bio page at `/`,
`/disclosures`, `/privacy`, `/healthz` and an owner-only `/admin`. It logs every click per video and
source, shows each offer's disclosure next to its link, and hides restricted offers by region.

Status (2026-11-24): built and tested locally, and the Docker image was built and run here.
It has **not** been deployed, and the Cloudflare and Fly behaviour below has not been tested against
live services.

## Run it locally

```sh
cd projects/creator-hub
cp config/offers.example.json config/offers.json   # gitignored; put the real links here
node src/server/main.ts                             # http://localhost:8080
npm test && npx tsc --noEmit
```

With no `config/offers.json`, the server uses `offers.example.json` and forces every offer inactive.

## The offer registry (`config/offers.json`)

The shape is `OfferRegistry` in `src/types.ts`. The server checks it at startup and refuses to start
until every problem is fixed. It rejects:

- an id that is not a slug (`a-z`, `0-9`, `-`, 2–40 characters), or a duplicate id;
- a non-https `url` or `termsUrl`;
- a country that is not an ISO 3166-1 alpha-2 code. Use `GB` for the United Kingdom: `UK` is not ISO,
  and Cloudflare sends `GB`;
- an `exchange` offer, or any offer with `blockedCountries` or `allowedCountries`, whose `unknownCountry`
  is not `"block"`;
- an alternative that does not exist;
- an active offer whose URL is still a placeholder (`REPLACE`, example.com);
- a memecoin launchpad URL (for example pump.fun);
- a misspelled field such as `allowedCountry`. Other unknown fields only produce a warning.

Region rules at `/go`: a blocked country, or a country missing from a non-empty `allowedCountries`,
gets a "not available in your region" page (HTTP 451). That page shows the `restrictedReason` and the
alternatives allowed in that region, and never the destination. When the country is unknown, an offer
with `unknownCountry: "block"` is blocked. Inactive or expired offers get an "offer ended" page (410).
A date-only `expires` lasts to the end of that UTC day.

Sub-IDs: when `subIdParam` is set, the redirect appends `<subIdParam>=<videoId>.<source>`, using
`none` for a missing part. The rest of the registry URL is kept byte for byte.

## Environment

| Variable | Purpose |
| --- | --- |
| `PUBLIC_BASE_URL` | Public origin, e.g. `https://go.zoora.ai`. Required in production, and must be https |
| `PORT`, `HOST` | Listen port (default 8080) and optional address |
| `DATA_DIR` | SQLite directory (default `./data`). The file is `hub.sqlite` |
| `CONFIG_DIR` | Where `offers.json` / `studio.json` live (default `config/`) |
| `ADMIN_USER`, `ADMIN_PASSWORD_HASH` | Admin login. Create the hash with `node src/server/hash-password.ts` |
| `HASH_SECRET` | At least 32 random characters. Required in production |
| `KIT_FORM_ACTION` | Kit form URL (default: the existing form 10168331) |
| `FORM_ACTION_ORIGINS` | Extra https origins that forms may post or redirect to, e.g. the site of Kit's thank-you page |
| `CONTACT_EMAIL` | Public contact shown on pages |
| `BRAND_NAME` | Default `Zoora AI`. A second channel can run its own instance |
| `TRUST_PROXY` | `none` (default), `cloudflare` or `header` |
| `GEO_HEADER`, `IP_HEADER` | Header mode: the country header and/or the client-IP header |
| `PROXY_SECRET`, `PROXY_SECRET_HEADER` | Shared secret the proxy adds (default header `X-Origin-Secret`) |
| `RATE_LIMIT_BURST`, `RATE_LIMIT_PER_MINUTE` | Per-visitor limits (default 40 and 60). Each IP gets 10× both |

Generate a secret with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.

## Country detection

- **No proxy** (`TRUST_PROXY=none`): every visitor's country is unknown, so exchanges and other
  restricted offers are hidden for everyone. This is the safe default.
- **Fly.io alone**: Fly reports the client IP but not the country. Use `TRUST_PROXY=header` with
  `IP_HEADER=Fly-Client-IP`, as in `fly.toml.example`. Restricted offers stay hidden.
- **Cloudflare in front** (proxied DNS): use `TRUST_PROXY=cloudflare`. The country comes from
  `CF-IPCountry`, where `XX` and `T1` (Tor) count as unknown, and the IP from `CF-Connecting-IP`.
  Also add a Cloudflare request-header Transform Rule that sets `X-Origin-Secret` to a long random
  value, and set the same value as `PROXY_SECRET`. Without it, anyone who reaches the origin directly
  (e.g. `<app>.fly.dev`) could send a fake country header. Requests without the secret are treated as
  "country unknown".

zoora.ai currently uses Namecheap DNS with GitHub Pages, so a Cloudflare setup is an owner decision.

## Deploy on Fly.io

Follow the comments at the top of `fly.toml.example` (copy it to `fly.toml`). Use one machine and one
volume, because SQLite lives on the volume. The image runs the server as the non-root `node` user. If
the container starts as root (Fly mounts volumes owned by root), `docker/start.sh` gives `/data` to
`node` and drops privileges first.

## Admin

`/admin` uses HTTP Basic auth: scrypt, a constant-time comparison, and 10 failures per client before
a lockout. It shows:

- human clicks by offer, video and source for 7 and 30 days, counted once per visitor, offer and UTC
  day; the first click of the day keeps its video and source;
- blocked and other outcomes;
- page views;
- order requests, with a status change protected by a signed CSRF token and a `SameSite=Strict`
  cookie (`__Host-` on https).

`/admin/links` builds description text: each tracked link with its disclosure on the next line.

CSV exports (`?days=N` limits the range):

- `/admin/export/clicks.csv`: `ts,time_utc,offer_id,video_id,source,country,visitor_hash,is_bot,outcome,referrer_host`
- `/admin/export/video-clicks.csv`: `video_id,offer_id,source,hub_clicks` (de-duplicated human
  redirects; the sum per video is `VideoMetrics.hubClicks`)
- `/admin/export/orders.csv`: `id,time_utc,name,email,company,project_url,package_id,budget,deadline,message,consent,status`

Cells that start with `= + - @` get a leading `'` so spreadsheets do not run them as formulas.

## Data kept

Clicks and page views store a time, the offer or page, `v`/`s`, the country, the referring host name,
a bot flag, the outcome, and a visitor hash. The hash is HMAC-SHA256 keyed with `HASH_SECRET` plus the
UTC date, over IP (IPv6: its /64) and user agent, truncated to 16 hex characters. Raw IPs are never
stored, and `/go` sets no cookies.

A daily purge deletes clicks, page views and orders older than 13 months. Orders marked `won` are kept.
`/privacy` describes this in plain language.
