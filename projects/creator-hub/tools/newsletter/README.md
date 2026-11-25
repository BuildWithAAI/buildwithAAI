# Newsletter tools

Turns an episode's publish kit (`kit.json`, the `PublishKit` contract in `src/types.ts`) into an email draft for the Kit list. The signup page is `GET /subscribe` on the hub (`src/server/routes/subscribe.ts`).

## Commands

Run from `projects/creator-hub`. Relative paths resolve from the directory you ran `npm` in.

```sh
npm run newsletter -- draft ../video-studio/out/publish/zoora-ai/<slug>/kit.json
npm run newsletter -- lint out/newsletter/<slug>.md      # re-check a draft after editing it by hand
```

`draft` builds the email, lints it, and only if the lint passes writes:

- `out/newsletter/<slug>.md`: Markdown with `subject` and `preview` front matter, for review and editing.
- `out/newsletter/<slug>.html`: email-safe HTML. It is 600 px wide (fluid on phones), uses inline styles only, and has no scripts, images, web fonts or tracking pixels.

| Option | Meaning |
| --- | --- |
| `--offers <file>` | Offer registry used to check each offer. Default `config/offers.json`. Without a registry every offer is left out. |
| `--out <dir>` | Output folder. Default `out/newsletter` (gitignored). |
| `--hub <origin>` | Hub origin for relative offer links, e.g. `https://go.zoora.ai`. Default `PUBLIC_BASE_URL` if it is https. |
| `--youtube-id <id>` | The video's YouTube id, when `kit.json` does not have one yet. |
| `--brand <name>` | Brand name. Default `BRAND_NAME`; without it, the kit channel's own name: `Zoodger News` for `zoora-security`, `Zoora AI` for any other channel. |
| `--kit-draft` | Also create a draft broadcast in Kit (needs `KIT_API_KEY`). It is never sent or scheduled. You must choose its recipients: `KIT_SUBSCRIBER_FILTER=tag:<id>` (or `segment:<id>`, or `tag:12,34` for subscribers with every listed tag), or `--all-subscribers`. |
| `--all-subscribers` | With `--kit-draft`: no subscriber filter. Kit then addresses all subscribers, so use it only if every subscriber on the account agreed to episode emails with affiliate links. |

Exit codes: `0` ok, `1` problems found (nothing written), `2` usage error.

## What goes into the email

- The title, the summary and a "Watch on YouTube" button.
- Key takeaways: the chapter titles (minus intro and outro), each linking to its timestamp.
- Sources from the kit.
- Offers, linked through the hub as `/go/<id>?v=<slug>&s=email` so clicks are counted for this email. The disclosure sits directly above each link.
- The episode's other disclosure lines, a "we never DM you first" safety line, and a footer that says why the reader is getting the email. Kit adds the unsubscribe link and the postal address.

**Offers and regions.** An email reader's country is unknown. An offer therefore goes into an email only when the registry says it is live and allowed for an unknown country: `unknownCountry` is `"allow"` and there are no country lists. Exchanges and other restricted financial offers are always left out, and the CLI lists every offer it left out and why.

## What the lint blocks

- Income, return, price or guarantee claims, even when quoting a scam: *guaranteed*, *risk-free*, *get rich*, *passive income*, multipliers such as *100x* or *easy 2x in a month*, earnings figures in any currency or coin (*I made $5,000*, *earn £300 a week*, *earned 5 ETH*), percentage returns (*20% monthly returns*, *300% APY*), price targets (*could hit $500*, *to $250k by December*, *heading to $1*), *turn $100 into $10,000*, *you can't lose*, *100% safe*, *profit every day*, buy calls (*buy now*, *ape in*, *get in early*), *double your money*, *financial freedom*, *to the moon* and similar. The rules live in `src/claims.ts` (shared with the studio's config check) and mirror the publish kit's. Describe the trick without repeating its pitch. Softer words without figures (*returns*, *profit*, *invest*, urgency) only print warnings.
- A publish kit that failed its own `income-claims`, `restricted-offers` or any disclosure check: fix the kit first. Other failed kit checks (title length, captions...) are printed as warnings.
- An offer with no disclosure, or a disclosure that does not say what the relationship is.
- A rendered offer link without its disclosure right above it.
- Hub links not tagged `v=<slug>&s=email`.
- Placeholders (`TODO`, `REPLACE`, `example.com`), unsafe HTML, and a missing watch link.

## Kit setup (owner)

- The hub page posts `email_address` to `KIT_FORM_ACTION`. Kit handles unsubscribes, and the hub never receives the address.
- `KIT_FORM_ACTION` is required in production. The zoora.ai form `10168331` promises "product and build updates", while the hub page promises "new episodes and occasional recommendations" with labelled affiliate links, so create a separate Kit form for the hub (development falls back to `10168331`, and the hub warns if production uses it). Give that form's subscribers a tag and set `KIT_SUBSCRIBER_FILTER=tag:<id>`, so `--kit-draft` addresses only them.
- Turn on double opt-in for the hub's form (in Kit, the form's "incentive email"). The signup page and the email footer no longer promise a confirmation step, because nobody has checked the form's setting; once it is on, you may say so again.
- In the Kit form's settings, after subscribing either show Kit's success message or redirect to `https://<hub>/subscribe/thanks`. The hub's Content-Security-Policy only allows forms to post to itself and to Kit, so browsers can block a redirect to any other site, such as zoora.ai/success.html.
- Set a real postal address in Kit. Kit prints it in every email footer, and anti-spam law (CAN-SPAM) requires one.

## Kit API (optional)

`--kit-draft` calls `POST https://api.kit.com/v4/broadcasts` with the `X-Kit-Api-Key` header, `send_at: null` and `public: false`, which creates a draft. With `KIT_SUBSCRIBER_FILTER=tag:123` the body also carries `"subscriber_filter": [{"all": [{"type": "tag", "ids": [123]}]}]`. Docs: <https://developers.kit.com/api-reference/broadcasts/create-a-broadcast>. According to that page (read through search extracts, not opened), a broadcast without a filter goes to all subscribers, which is why the CLI refuses to create a draft until you choose. Create a v4 API key in Kit under Settings > Developer and export it as `KIT_API_KEY`. Never commit it. The client never retries, because a retry could create a duplicate draft.

**Not tested live.** api.kit.com and developers.kit.com were unreachable from the build machine, so the client, including the `subscriber_filter` shape, has only been tested against a mocked `fetch` (`kit-api.test.ts`). Make one test call on the real account before relying on it, and check the draft's recipients in Kit before you send it.

## Tests

```sh
node --test tools/newsletter/*.test.ts
```

The tests cover the draft built from `fixtures/kit.json` and `fixtures/offers.json`, the lint, the Kit client with a mocked `fetch`, and the CLI. The fixture offers are fake `.test` hosts.
