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
| `--brand <name>` | Brand name. Default `BRAND_NAME` or `Zoora AI`. |
| `--kit-draft` | Also create a draft broadcast in Kit (needs `KIT_API_KEY`). It is never sent or scheduled. |

Exit codes: `0` ok, `1` problems found (nothing written), `2` usage error.

## What goes into the email

- The title, the summary and a "Watch on YouTube" button.
- Key takeaways: the chapter titles (minus intro and outro), each linking to its timestamp.
- Sources from the kit.
- Offers, linked through the hub as `/go/<id>?v=<slug>&s=email` so clicks are counted for this email. The disclosure sits directly above each link.
- The episode's other disclosure lines, a "we never DM you first" safety line, and a footer that says why the reader is getting the email. Kit adds the unsubscribe link and the postal address.

**Offers and regions.** An email reader's country is unknown. An offer therefore goes into an email only when the registry says it is live and allowed for an unknown country: `unknownCountry` is `"allow"` and there are no country lists. Exchanges and other restricted financial offers are always left out, and the CLI lists every offer it left out and why.

## What the lint blocks

- Income, return or guarantee claims, even when quoting a scam: *guaranteed*, *risk-free*, *get rich*, *passive income*, multipliers such as *100x*, *double your money*, *financial freedom*, *to the moon*, price targets and similar. Describe the trick without repeating its pitch. Softer words (*returns*, *profit*, *invest*, urgency) only print warnings.
- An offer with no disclosure, or a disclosure that does not say what the relationship is.
- A rendered offer link without its disclosure right above it.
- Hub links not tagged `v=<slug>&s=email`.
- Placeholders (`TODO`, `REPLACE`, `example.com`), unsafe HTML, and a missing watch link.

## Kit setup (owner)

- The hub page posts `email_address` to `KIT_FORM_ACTION`. The default is the zoora.ai form `10168331`. Kit runs double opt-in and unsubscribe, and the hub never receives the address.
- The zoora.ai form promises "product and build updates". The hub page promises "new episodes and occasional recommendations" with labelled affiliate links. A separate Kit form for the hub, set through `KIT_FORM_ACTION`, keeps those two consents apart. Only send episode emails to people who signed up for them.
- In the Kit form's settings, after subscribing either show Kit's success message or redirect to `https://<hub>/subscribe/thanks`. The hub's Content-Security-Policy only allows forms to post to itself and to Kit, so browsers can block a redirect to any other site, such as zoora.ai/success.html.
- Set a real postal address in Kit. Kit prints it in every email footer, and anti-spam law (CAN-SPAM) requires one.

## Kit API (optional)

`--kit-draft` calls `POST https://api.kit.com/v4/broadcasts` with the `X-Kit-Api-Key` header, `send_at: null` and `public: false`, which creates a draft. Docs: <https://developers.kit.com/api-reference/broadcasts/create-a-broadcast>. Create a v4 API key in Kit under Settings > Developer and export it as `KIT_API_KEY`. Never commit it. The client never retries, because a retry could create a duplicate draft.

**Not tested live.** api.kit.com was unreachable from the build machine, so the client has only been tested against a mocked `fetch` (`kit-api.test.ts`). Make one test call on the real account before relying on it. Review the draft and choose its recipients in Kit, then send it from Kit.

## Tests

```sh
node --test tools/newsletter/*.test.ts
```

The tests cover the draft built from `fixtures/kit.json` and `fixtures/offers.json`, the lint, the Kit client with a mocked `fetch`, and the CLI. The fixture offers are fake `.test` hosts.
