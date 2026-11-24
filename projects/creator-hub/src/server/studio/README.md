# Studio: video-service order page

A sales page for explainer videos plus a quote-request form. Built 2026-11-24. Route module: `src/server/routes/studio.ts`. Helpers: this folder.

| Route | What it does |
| --- | --- |
| `GET /studio` | Offer page: hero, what you get, process, packages, portfolio (only if set), FAQ, terms, request form |
| `POST /studio` | Rate limit, drop honeypot hits quietly, validate, store in `orders`, then `303` to `/studio/thanks` |
| `GET /studio/thanks` | Confirmation page (`noindex`) |
| `GET /studio/style.css` | The pages' stylesheet. It is served as a file because the core CSP (`default-src 'self'`) blocks inline styles |

## Set it up

1. Copy `config/studio.example.json` to `config/studio.json`. The real file is gitignored. Without it, development shows the example, and production answers `/studio` with `503` (not indexed), so the unreviewed example offer is never published.
2. Edit packages, deliverables, budget ranges and FAQ answers so they match what you will actually deliver.
3. Check the file: `node src/server/studio/check-config.ts config/studio.json` (run it from `projects/creator-hub`).
4. Restart the server.

| Setting | Meaning |
| --- | --- |
| `priceUsd` | `null` shows "Contact for a quote". Enter a number only once you have decided the price. |
| `turnaroundDays` | Whole days from an approved brief to delivery. `null` shows "Agreed after the brief". |
| `revisions` | Revision rounds included. `null` shows "Agreed in your quote". |
| `portfolio` | `[{title, url, description?, client?}]`, https links only. List only real, published work you are allowed to show. Empty hides the section. |
| `stripePaymentLinks` | Optional `{"<package id>": "https://buy.stripe.com/..."}`. A "Pay online with Stripe" button appears only for those packages, with a note to pay only after the quote is confirmed. A package needs a decided `priceUsd` before it can have a payment link. Stripe payment links live on `buy.stripe.com` unless you set up a custom domain. |
| Keys starting with `_` | Notes, ignored. Any other unknown key is an error, which catches typos like `priceUSD`. |

The terms are in `copy.ts`, not in the config, so a config edit cannot remove them. Change them only on purpose.

Package names, summaries, deliverables, FAQ answers, portfolio entries and budget ranges are checked for claims the studio never makes: income, return or price claims (the shared rules in `src/claims.ts`, the same as the newsletter's) and promises of results such as "get 100k views". A denied claim or a question is fine ("Do you guarantee views? No."). A failing config names the setting, for example `packages[0].summary makes a claim the studio never makes (guaranteed: "Guaranteed")`.

An invalid config does not crash the server. `/studio` answers `503` and the log names the bad setting once, for example `packages[0].priceUsd`.

## Environment

| Variable | Purpose |
| --- | --- |
| `NOTIFY_WEBHOOK_URL` | Optional. Receives one POST per new order with only `{id, packageId, ts, text}`: no name, email, company, link or message. It must be https; plain http is allowed only for 127.0.0.1 or localhost. The timeout is 3 s, and the call happens after the order is stored and the visitor is redirected, so a failure never loses an order. It works as a Slack incoming webhook (Slack reads `text`). For Discord, add `/slack` to the end of the webhook URL. The URL is treated as a secret and never logged. |
| `CONTACT_EMAIL` | Read by the core. Shown as the reply address. When it is empty, the pages leave out the email sentences. |

## What is stored

- `orders`: one row per request, using prepared statements. `status` is `new`, or `spam` when the core flags the user agent as a bot. Spam rows are kept for review and trigger no notification. The admin (`/admin`) changes status and exports CSV.
- `page_events` (`page = 'studio'`): one row per arrival on `/studio`, with `?s=<source>` and `?v=<video id>` when valid. Link to the page as `/studio?s=yt&v=<videoId>` so the dashboard can tell which video sends studio visitors. The internal "Request this package" links (`?package=`) are not counted.
- Logs carry the order id, package and status only, never personal data.

## Spam and abuse

- A hidden honeypot field (`studio_hp`). A post that fills it gets the normal redirect, and nothing is stored.
- A token bucket from `security.ts` keyed by client IP: 6 posts, then 1 more every 150 s. Above that the form is shown again with `429` and `Retry-After`, and the typed values are kept. The core's global limit applies on top.
- The same request from the same visitor within 10 minutes (a double click) is stored once.

## Tests

```
node --test src/server/studio/*.test.ts src/server/routes/studio.test.ts
```

They cover validation, the honeypot, storage (against `src/db/schema.sql` in memory), escaping, the rate limit, duplicates, webhook privacy and failure, and config errors. Webhook tests use a stub or a 127.0.0.1 listener; nothing calls the internet.

## Known limits

- The core caps form bodies at 16 KB. A message close to the 5,000-character limit written in a non-Latin script can exceed that after URL-encoding, and the core then answers `413`.
- `orders` has no source or video columns, so a request is not tied to the video that sent it. Page views are. Tying requests to videos needs a schema migration.

## Sources

Checked 2026-11-24 through search-engine extracts only. The docs hosts (docs.slack.dev, discord.com, docs.stripe.com) are blocked in this environment, so re-check them before you rely on these details.

- Slack incoming webhooks: POST JSON with a `text` field. https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/
- Discord "Execute Slack-Compatible Webhook": the webhook URL plus `/slack`. https://discord.com/developers/docs/resources/webhook (seen only through secondary sources)
- Stripe payment links on `buy.stripe.com`, with optional custom domains: https://docs.stripe.com/payments/checkout/custom-domains
- UK cryptoasset promotions (FCA, s21 FSMA): `projects/video-studio/docs/research/platform-facts-2026-11-23.md`
