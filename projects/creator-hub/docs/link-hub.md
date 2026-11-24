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
- a financial promotion without country rules: an `exchange`, or any offer marked
  `"financialPromotion": true` (staking, yield, lending, trading, signals, savings), must use
  `unknownCountry: "block"` and list `blockedCountries` or `allowedCountries`. In the UK a crypto
  financial promotion is restricted by law, wherever the company is based. A non-exchange offer whose
  name, link or disclosure mentions deposits, staking, yield, trading and the like gets a startup warning
  until it is marked;
- an alternative that does not exist;
- an active offer whose URL is still a placeholder (`REPLACE`, example.com);
- a memecoin launchpad: by host (pump.fun, letsbonk.fun, four.meme, sunpump.meme, believe.app, bags.fm,
  moonshot.money, clanker.world, virtuals.io), by a launchpad hidden inside a tracking link, or by its
  name, link or notes naming one. The list is in `src/launchpads.ts`;
- a misspelled field such as `allowedCountry`. Other unknown fields only produce a warning.

Region rules at `/go`: a blocked country, or a country missing from a non-empty `allowedCountries`,
gets a "not available in your region" page (HTTP 451). That page shows the `restrictedReason` and the
alternatives allowed in that region, and never the destination. When the country is unknown, an offer
with `unknownCountry: "block"` is blocked. Inactive or expired offers get an "offer ended" page (410).
A date-only `expires` lasts to the end of that UTC day.

Sub-IDs: when `subIdParam` is set, the redirect appends `<subIdParam>=<videoId>.<source>`, using
`none` for a missing part, or fills the parameter in when the link already has it (networks often hand
out links with an empty `subid=`). The rest of the registry URL is kept byte for byte.

## Environment

| Variable | Purpose |
| --- | --- |
| `PUBLIC_BASE_URL` | Public origin, e.g. `https://go.zoora.ai`. Required in production, and must be https |
| `PORT`, `HOST` | Listen port (default 8080) and optional address |
| `DATA_DIR` | SQLite directory (default `./data`). The file is `hub.sqlite` |
| `CONFIG_DIR` | Where `offers.json` / `studio.json` live (default `config/`) |
| `ADMIN_USER`, `ADMIN_PASSWORD_HASH` | Admin login. Create the hash with `node src/server/hash-password.ts` |
| `HASH_SECRET` | At least 32 random characters. Required in production |
| `KIT_FORM_ACTION` | The Kit form for the hub's episode emails. Required in production. Development falls back to the zoora.ai form 10168331, whose sign-ups agreed to "Zoora product and build updates", not episode emails; using it in production prints a warning |
| `FORM_ACTION_ORIGINS` | Extra https origins that forms may post or redirect to, e.g. the site of Kit's thank-you page |
| `CONTACT_EMAIL` | Public contact shown on pages. Required in production |
| `OPERATOR_NAME` | The person or business that runs the site, named on `/privacy` (default: `BRAND_NAME`) |
| `BRAND_NAME` | Default `Zoora AI`. A second channel can run its own instance |
| `TRUST_PROXY` | `none` (default), `cloudflare` or `header` |
| `GEO_HEADER`, `IP_HEADER` | Header mode: the country header and/or the client-IP header |
| `PROXY_SECRET`, `PROXY_SECRET_HEADER` | Shared secret the proxy adds (default header `X-Origin-Secret`). Required in production whenever the country comes from a header |
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
  value, and set the same value as `PROXY_SECRET`. **In production the server refuses to start without
  it**: anyone who reaches the origin directly (e.g. `<app>.fly.dev`) could otherwise send a fake country
  header and see offers blocked in their region, or fake an IP to get past the rate limits. Requests
  without the secret are treated as "country unknown".

zoora.ai currently uses Namecheap DNS with GitHub Pages, so a Cloudflare setup is an owner decision.

Which setting per platform (the client IP must come from a header the platform's proxy sets, or every
visitor shares the proxy's address as one rate-limit key):

| Where the hub runs | `TRUST_PROXY` | Headers | `PROXY_SECRET` |
| --- | --- | --- | --- |
| Directly on the internet (no proxy, no load balancer) | `none` | none | not used |
| Fly.io alone | `header` | `IP_HEADER=Fly-Client-IP` | optional (Fly describes this header as the address its proxy saw; the server warns that this was not verified) |
| Cloudflare in front (any host) | `cloudflare` | `CF-IPCountry`, `CF-Connecting-IP` | required in production |
| Your own nginx or Caddy | `header` | `IP_HEADER=X-Real-IP` (set by your proxy), optionally `GEO_HEADER` | required in production with `GEO_HEADER`; recommended otherwise |

With `TRUST_PROXY=none` in production, the server warns at startup, and once at run time when requests
arrive from a private or loopback address (a sign that a proxy is in front). Those requests are then
limited per visitor (IP and user agent) only, so one client cannot make every visitor share a 429.

## Deploy on Fly.io

Follow the comments at the top of `fly.toml.example` (copy it to `fly.toml`). Use one machine and one
volume, because SQLite lives on the volume. The image runs the server as the non-root `node` user. If
the container starts as root (Fly mounts volumes owned by root), `docker/start.sh` gives `/data` to
`node` and drops privileges first.

## Admin

`/admin` uses HTTP Basic auth: scrypt and a constant-time comparison. Sign-in limits are applied before
any password is hashed, so guesses sent at the same time count too:

- 10 failures per client, then one more every 90 seconds (a failure token is taken before the check and
  given back only when the password is right);
- 50 failures an hour from all clients together; beyond that, sign-in is locked for everyone until the
  budget refills, and the server logs it once (restart the server to clear it at once);
- at most 2 password checks at a time (scrypt uses 32 MiB each); more get a 429 without hashing;
- a correct `Authorization` header is trusted for 10 minutes in memory, so browsing the admin pages does
  not run scrypt on every request.

It shows:

- human clicks by offer, video and source for 7 and 30 days, counted once per visitor, offer and UTC
  day; the first click of the day keeps its video and source;
- blocked and other outcomes;
- page views;
- order requests, with a status change protected by a signed CSRF token and a `SameSite=Strict`
  cookie (`__Host-` on https).

`/admin/links` builds description text the way the publish kit does: an opening "Disclosure: some links
for this video are affiliate ... links" line, then each offer that may be shown everywhere with its
disclosure on the next line. A description is visible in every country, so offers restricted by region
are never named in it: one "More partner links, only where they are available in your country" line to
the hub's region-filtered page stands in for them, and the page lists them separately under "Hub page
only". Order e-mail addresses are percent-encoded in their `mailto:` links.

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
written to disk (they are keys of the in-memory rate-limit buckets until those are dropped), and `/go`
sets no cookies. The hash is pseudonymous, not anonymous: whoever holds `HASH_SECRET` can recompute it
for a known IP and user agent on any day, and an order stores the same day's hash, so it can be joined
to that day's clicks. `/privacy` says so.

A daily purge deletes clicks, page views and orders older than 13 months. Orders marked `won` are kept.
`/privacy` describes this in plain language.
