# Sponsors: media kit, packages, vetting and disclosures

Version 1, 2026-11-24. For both channels: Zoora AI and the security channel (The Zoo & Badger Show; the channel's
display name is still to be chosen).

What this file gives you:

1. a **media-kit template** whose numbers are filled from the revenue dashboard's `metrics.csv` and from YouTube
   Studio, never typed by hand;
2. **audience notes** that say what we know and what we don't, with no invented numbers;
3. the **sponsorship packages** (what each one includes; the prices are yours to set);
4. a strict **vetting checklist** for crypto and AI sponsors, tied to the link hub's region rules;
5. the **disclosure rules** (FTC, YouTube, spoken and on screen);
6. **email templates** for outreach and for answering sponsors.

Nothing here is legal advice. The facts about laws and platform rules come from
[`docs/research/platform-facts-2026-11-23.md`](research/platform-facts-2026-11-23.md), which marks what was read at
the source and what came from search extracts. Get a lawyer's sign-off before the first paid deal.

## 1. Make the media kit

```sh
# 1. In projects/creator-hub, build the dashboard from your YouTube Studio export (see tools/dashboard/README.md)
npm run dashboard                                                        # zoora-ai -> out/dashboard/metrics.csv
npm run dashboard -- --channel zoora-security --out out/dashboard/zoora-security

# 2. Optional: copy the audience facts from YouTube Studio into a JSON file (format below), then
cd ../video-studio
node scripts/product/media-kit.ts --channel zoora-security --contact you@yourdomain
```

It writes `out/sponsors/<channel>/media-kit.md`, `.html` and `.pdf` (all gitignored; the kit holds live figures).

| Option | Default | Meaning |
| --- | --- | --- |
| `--channel` | (required) | `zoora-ai` or `zoora-security`. Names and handles come from `content/<channel>/channel.json` |
| `--metrics` | `../creator-hub/out/dashboard/metrics.csv` (zoora-ai) or `../creator-hub/out/dashboard/<channel>/metrics.csv` | The dashboard's `metrics.csv` |
| `--audience` | `../creator-hub/data/media-kit/<channel>.audience.json` | Facts copied from YouTube Studio (format below). `data/` is gitignored |
| `--prices` | `../creator-hub/data/media-kit/prices.json` | Your prices, e.g. `{"price.segment": "$1,200", "price.short": "$400"}`. Without it each price reads "On request" |
| `--as-of` | today (UTC) | The date printed on the kit, and the end of the "recent videos" window |
| `--window-days` | 90 | The "recent videos" window |
| `--contact` | `CONTACT_EMAIL` env | The contact line |
| `--strict` | off | Exit 1 if any figure is missing, so a kit with gaps can't go out by accident |
| `--no-pdf` | off | Markdown and HTML only (no browser) |

Exit codes: 0 written; 1 written but `--strict` found missing figures; 2 bad arguments or unreadable input.

**Audience file** (`<channel>.audience.json`). Copy these from YouTube Studio > Analytics > Audience, for the same
period as the dashboard export, and write the date you copied them. Every field is optional; a missing field shows
"not yet available" in the kit:

```json
{
  "asOf": "2027-01-31",
  "subscribers": 0,
  "returningViewersPct": 0,
  "topCountries": [{"country": "United States", "pct": 0}],
  "ageGroups": [{"range": "25-34", "pct": 0}],
  "gender": [{"label": "Male", "pct": 0}],
  "devices": [{"label": "Mobile phone", "pct": 0}]
}
```

(The zeros are a format example, not data.) The script rejects percentages outside 0-100 and lists that add up to
more than 100%.

### How each figure is worked out

All figures come from `metrics.csv` rows for the chosen channel. An empty cell means unknown and is skipped, never
counted as zero. Revenue columns are never read: the kit shows audience, not earnings.

| Placeholder | Rule |
| --- | --- |
| `stats.videos`, `stats.longVideos`, `stats.shorts` | Rows for the channel, by `format` |
| `stats.dataRange` | First and last `publishedAt` |
| `stats.totalViews` | Sum of `views` |
| `stats.medianViewsLong`, `stats.medianViewsShort` | Median `views` per long video and per Short |
| `stats.recentVideos`, `stats.recentMedianViewsLong` | Videos published in the window before `--as-of`, and the median views of its long videos |
| `stats.avgViewDurationLong` | Average view duration of long videos, weighted by views |
| `stats.medianPercentViewedLong` | Median `avgPercentViewed` of long videos |
| `stats.medianCtrLong` | Median thumbnail click-through rate of long videos with 100+ views (the dashboard's rule: YouTube says CTR varies widely below 100 views; Shorts have no thumbnail CTR) |
| `stats.subscribersGained` | Sum of `subscribersGained` |
| `stats.hubClicksPer1k` | Hub clicks from YouTube links per 1,000 views (`hubClicksYoutube` over `views`, rows that have both) |
| `audience.*` | Copied from the audience file |
| `price.*` | Copied from the prices file; "On request" without it |

Lifetime figures depend on the dates you exported from Studio. Export a fixed period (for example the last 90 or
365 days) and say which in the cover email.

### The template

The block between the markers is the template. Edit the words freely; keep the `{{placeholders}}`. The syntax is the
product content dialect (`scripts/product/README.md`): `{{key}}` or `{{key|text shown when missing}}`.

<!-- media-kit:start -->
```text
---
title: {{kit.channelName}}
subtitle: Media kit
editionLabel: Media kit
version: {{kit.version}}
date: {{kit.dateIso}}
---

# {{kit.channelName}}: media kit {#media-kit kind=front spot=about-pair}

> {{kit.tagline}}

:::cards {.stats}
- **{{stats.medianViewsLong}}.** Median views per long video
- **{{stats.avgViewDurationLong}}.** Average view duration, long videos
- **{{stats.medianPercentViewedLong}}.** Median share of each long video watched
- **{{audience.subscribers}}.** Subscribers on {{audience.asOf|the date we last checked}}
:::

## The show

{{kit.about}}

## Audience

From YouTube Studio, {{audience.asOf|date not given}}.

| Measure | Value |
| --- | --- |
| Subscribers | {{audience.subscribers}} |
| Returning viewers | {{audience.returningViewers}} |
| Top countries | {{audience.topCountries}} |
| Age | {{audience.ageGroups}} |
| Gender | {{audience.gender}} |
| Devices | {{audience.devices}} |

## Performance

Videos published {{stats.dataRange}}, figures as of {{stats.asOf}}.

| Measure | Value |
| --- | --- |
| Videos | {{stats.videos}} ({{stats.longVideos}} long, {{stats.shorts}} Shorts) |
| Views | {{stats.totalViews}} |
| Median views, long videos | {{stats.medianViewsLong}} |
| Median views, long videos from the last {{stats.windowDays}} days | {{stats.recentMedianViewsLong}} |
| Median views, Shorts | {{stats.medianViewsShort}} |
| Average view duration, long videos | {{stats.avgViewDurationLong}} |
| Median click-through rate, long videos | {{stats.medianCtrLong}} |
| Subscribers gained from these videos | {{stats.subscribersGained}} |
| Link clicks per thousand YouTube views | {{stats.hubClicksPer1k}} |

Every figure comes from YouTube Studio or our own link hub. We don't estimate, round up or project.

## Sponsorship options

| Option | What's included | Price |
| --- | --- | --- |
| Integrated segment | 45 to 75 seconds in a long video, read by Zoo in our words, placed outside the news segments. Spoken and on-screen disclosure, a link in the description through our link hub, and a click report after 30 days. | {{price.segment|On request}} |
| Short mention | A short, clearly labelled mention at the end of a Short, with the brand link YouTube allows for reported brand deals. | {{price.short|On request}} |
| Newsletter slot | One labelled "Sponsored" block in our weekly email, written by us. | {{price.newsletter|On request}} |
| Monthly partner | Four integrated segments in a month, plus the newsletter slot. | {{price.monthly|On request}} |

## How we work with sponsors

- **We vet first.** Every sponsor passes our written checklist: licences where they operate, no promised returns, a named team, audits, incident and regulatory history.
- **We disclose, every time.** Out loud and on screen, in the description next to the link, and with YouTube's paid-promotion setting.
- **We keep our coverage independent.** Sponsors don't see scripts before air except to correct facts about their own product, can't buy or block coverage, and never appear inside our news analysis.
- **We don't take tokens.** We're paid in money, not in tokens or allocations.

## Contact

{{kit.contact|Contact details on request}}
```
<!-- media-kit:end -->

## 2. Audience notes (what we know, and what we don't)

- **Who the shows are made for.** Adults who hold crypto or use AI tools and want to keep their money and accounts
  safe; Zoora AI also tells cautionary stories about crypto trading and AI. Both channels are set as "not made for
  kids" (CLAUDE.md), and the shows contain no trading advice or price talk.
- **Languages.** English first. Spanish and Brazilian Portuguese dubs are the next launch languages (owner decision,
  2026-11-24).
- **What we can't say yet.** We have no audience numbers until the channels have run long enough for YouTube Studio
  to report them. Until then, every audience figure in the kit reads "not yet available". We never quote a number we
  can't show a screenshot for.
- **Where the numbers come from.** YouTube Studio > Analytics > Audience (subscribers, returning viewers, countries,
  age, gender, devices), the Studio export behind the dashboard (views, watch time, click-through), and the link
  hub (de-duplicated human clicks; no IP addresses stored).
- **What sponsors may ask for, and what we give.** Screenshots of the Studio pages behind each figure, the export
  date range, and the hub's click report for their link. Never a viewer's personal data: the hub stores none to give.

## 3. Sponsorship packages (structure; prices are yours)

| Package | Includes | Doesn't include | Price |
| --- | --- | --- | --- |
| **Integrated segment** (long video) | 45-75 s read by Zoo, written by us from the sponsor's facts; placed after the news segments or before the outro, never inside "How it worked" or "Our check"; spoken + on-screen disclosure; hub link in the description; optional pinned comment; 30-day click report | Script approval (only factual corrections about their own product); usage rights to the clip; "presented by" on news segments | owner |
| **Short mention** | A labelled 5-10 s mention at the end of a Short; the single brand link YouTube allows on a Short for a reported brand deal (platform-facts: "A Short can carry a single brand-site link only for a reported brand deal") | A dedicated Short about the sponsor | owner |
| **Newsletter slot** (Threat Brief) | One "Sponsored" block written by us, with the disclosure above the link; sent to subscribers whose consent covers recommendations | Their own copy, tracking pixels, list rental | owner |
| **Monthly partner** | Four integrated segments + four newsletter slots; category exclusivity for that month | Exclusivity beyond the month; coverage changes | owner |
| **Add-ons** | X and Telegram posts with the disclosure; a listing on the hub's link page (region-aware) | Paid posts in other people's channels | owner |

Never offered, at any price:

- dedicated "review" videos, or any sponsor content inside news segments;
- the sponsor's own script read verbatim, or approval of anything except facts about their product;
- removing or softening coverage of the sponsor or its industry, or delaying a correction;
- Zoo and Badger in the sponsor's own ads (a separate licence, the owner's decision);
- payment in tokens, token allocations or "points" (platform-facts: accept no token payments for features; SEC
  Section 17(b) requires disclosing the amount if a token turns out to be a security);
- giveaways or airdrops tied to buying, following or connecting a wallet (YouTube's spam and contest policies).

How to set the prices: decide what you charge per thousand views for each format, then multiply by the kit's median
views for that format. Use the median, not the best video, and say so in the quote. The dashboard's per-thousand-views
rates are past results, not a forecast.

## 4. Sponsor vetting checklist (crypto and AI)

Run it before any call about money. Save the answers, with links and the date, in
`../creator-hub/data/sponsors/<sponsor>.md` (gitignored: this repository is public). Any **stop** answer ends the
conversation. Re-run it before every renewal and after any incident.

### Stop at once if any of these is true

- [ ] The sponsor, its site, its ads or its social posts promise or imply returns: "guaranteed", "risk-free", fixed
      yields, "passive income", multipliers, copy-trading results, "AI trading bots" that make money. The FTC says
      promises of guaranteed returns are always scams, and the CFTC warns about AI trading-bot pitches
      (sources: consumer.ftc.gov "What To Know About Cryptocurrency and Scams"; cftc.gov advisory "AI Won't Turn
      Trading Bots into Money Machines", 2024-01-25).
- [ ] It is a memecoin launchpad, a token sale, presale or ICO, a "recovery" service, a mixer, an online casino or
      an NFT or skin gambling site. (Launchpads are refused by the hub at startup; gambling links are banned by
      YouTube's 2025 rules; the FBI warns that crypto "recovery" firms target victims.)
- [ ] The product asks users for a seed phrase or private key, or to "connect your wallet to claim" anything.
- [ ] The team is anonymous: no named executives, no legal entity, no registered address.
- [ ] The company, its founders or its product are on a sanctions list (check the US Treasury OFAC SDN list), or
      face open fraud charges.
- [ ] It wants to pay in tokens, or to set what we say about it in news coverage.
- [ ] For AI tools: it clones voices or faces without the subject's consent, or sells "AI" capabilities it can't
      show (AI-washing).

### Licences, per region

Financial products (exchanges, brokers, wallets with built-in swaps, staking or lending, payment apps) need
licences or registrations in each place they serve. Check the regulator's own register yourself; don't accept a
screenshot. Examples, not a complete list:

| Region | What to check |
| --- | --- |
| United States | FinCEN money services business registration, state money-transmitter licences (NMLS Consumer Access), and New York's BitLicense where it serves New York |
| United Kingdom | FCA registration as a cryptoasset business, and how its UK promotions are approved. A crypto promotion to UK consumers needs an FCA-authorised route, wherever the company is based; breaking this is a criminal offence (platform-facts, FCA PS23/6) |
| European Union | Authorisation as a crypto-asset service provider under MiCA (ESMA keeps a register) |
| Canada | FINTRAC money services business registration, and the provincial securities regulators' rules for crypto trading platforms |
| Australia | AUSTRAC digital currency exchange registration |
| Elsewhere | The national financial regulator's register; if you can't find the firm, it's a stop |

- [ ] List every country the sponsor serves and every country its terms exclude ("restricted jurisdictions").
- [ ] Record the licence or registration number per country, with the register link and the date you checked.
- [ ] Where it has no licence, it must exclude that country in its own terms and block sign-ups from it.

### The hub's region rules must match

The sponsor's real coverage, not its marketing, decides how the link can be used:

- [ ] Add the sponsor to `../creator-hub/config/offers.json` as an offer with `relationship: "sponsor"`.
- [ ] Financial products: `financialPromotion: true` (or `category: "exchange"`), `unknownCountry: "block"`, and
      `blockedCountries` or `allowedCountries` that match the sponsor's licences and its restricted list exactly.
      The hub refuses to start until a financial promotion has country rules (`docs/link-hub.md`).
- [ ] Use ISO country codes (`GB`, not `UK`), and write a `restrictedReason` the hub can show blocked visitors.
- [ ] **A video is visible everywhere.** A sponsor that is blocked in any country can't be named in a title, a
      script, a thumbnail or a post (the publish kit enforces this for offers). In practice: no exchange, broker or
      yield product gets an integrated video segment; at most a hub-page listing that the hub filters by country.
      YouTube announced age and location controls for branded content around September 2026, "rolling out ... in
      the coming months" (platform-facts); don't rely on them until you have tested them on the live channel.
- [ ] Security products with no financial service (hardware wallets, security keys, password managers, AI safety
      tools) may use `unknownCountry: "allow"` if they ship and sell everywhere they claim to.

### Track record

- [ ] **Team:** named founders and executives, their past companies, the legal entity, its registration number and
      address. Check that the people exist outside the sponsor's own site.
- [ ] **Audits:** for anything on-chain, published audits from known firms. Open the report on the auditor's own
      site, check that its scope covers the contracts actually deployed (addresses and dates), and that critical and
      high findings are fixed. A bug bounty is a plus; an audit badge alone is not evidence.
- [ ] **Custody:** for anything that holds customer funds, proof of reserves that includes liabilities, and who
      attests it. Assets without liabilities prove little.
- [ ] **Past incidents:** search our radar (`scripts/radar`), rekt.news, SlowMist's Hacked database and Chainalysis
      for hacks, drains and outages. How did they respond: a public post-mortem, user reimbursement, silence?
- [ ] **Regulatory actions:** search the SEC, CFTC, FTC and Justice Department press releases, the relevant state
      regulators, the FCA warning list, and IOSCO's I-SCAN investor alerts for the company and its founders.
- [ ] **Lawsuits:** a court-records search for the company name (for example CourtListener).
- [ ] **AI sponsors:** what user data they keep and train on, whether they hold a security audit or certification,
      the permissions their apps or extensions ask for, how agents are kept from acting on hidden instructions
      (prompt injection), and whether their capability claims can be shown on a call.
- [ ] **Security-product sponsors:** where they sell (official stores only), past breaches of customer data,
      firmware and update practices, independent security reviews.

### Contract terms we require

- [ ] The sponsor warrants that it is licensed where it operates and that its claims to us are true.
- [ ] We write the script; the sponsor may correct facts about its own product only.
- [ ] We can pull or move a segment before publishing, without penalty, if the sponsor has an incident or a
      regulatory action.
- [ ] Disclosures are ours to decide and can't be shortened (section 5).
- [ ] Payment in money, on agreed terms; no tokens, no revenue share in tokens.
- [ ] No viewer data changes hands. Click reports are aggregate.

**Decision record:** who checked, the date, every link, the answers above, and the result (go, no-go, go with
limits). Keep it with the contract.

## 5. Disclosure requirements

Every sponsored placement, every time:

- **Say it out loud** at the start of the segment, in plain words, at normal speed and volume: "This part of the show
  is sponsored by {Sponsor}. They paid for it. They don't get a say in our coverage."
- **Show it on screen** for the whole segment: "Sponsored by {Sponsor} · Paid partnership", large, high-contrast,
  not over busy art, at least as long as the spoken line. FTC: a disclosure in a video must be in the video itself,
  and both audio and visual when the claim is both; small text that flashes by is not enough (16 CFR 255; "Disclosures
  101 for Social Media Influencers").
- **Description:** the first lines say "Sponsored by {Sponsor}. Paid partnership.", and the sponsor's hub link carries
  its disclosure on the line above it. Not only at the bottom, not hidden behind "more" (FTC FAQ).
- **YouTube Studio:** tick "My video contains paid promotion" (branded content) on every sponsored video. YouTube
  then shows its own label, but the FTC says a platform tool alone may not be enough, so keep the spoken and
  on-screen disclosure too.
- **Shorts:** the same spoken and on-screen disclosure; the only brand link YouTube allows on a Short is the one for
  a reported brand deal.
- **Newsletter:** a "Sponsored" label above the block, and the disclosure next to the link.
- **Live streams:** repeat the disclosure regularly (FTC "Disclosures 101").
- **Affiliate links** (any deal that pays per sign-up or sale): say so next to the link and in the video, like a
  sponsorship.
- **Our own products** (the checklist, the studio services): say "This is our own product" out loud and on screen,
  and tick the paid-promotion box when the relationship isn't obvious (platform-facts: YouTube counts a creator's own
  brands as endorsements "if the relationship between creator/brand is not clear").
- **Securities:** we don't promote securities or tokens for pay. If that ever changed, Section 17(b) requires
  disclosing the payment, its source and its amount, and counsel signs off first.
- **United Kingdom:** we don't run crypto financial promotions that UK viewers can see, unless an FCA-authorised firm
  has approved them (see section 4).

## 6. Email templates

### Outreach to a sponsor we'd like to work with

> **Subject:** Sponsoring The Zoo & Badger Show
>
> Hi {Name},
>
> I make The Zoo & Badger Show, an animated news show about crypto and AI security: what happened, how it worked, and
> one fix viewers can make today. Our audience is people who want to keep their money and accounts safe, which is why
> I'm writing to you about {Product}.
>
> Our media kit is attached. Every figure in it comes from YouTube Studio or our own link hub, dated, with nothing
> estimated.
>
> How we work: we write the segment in our own words from your facts, you can correct anything factual about your
> product, and every sponsorship is disclosed out loud, on screen and in the description. We vet every sponsor first,
> so if we go ahead I'll send a short questionnaire about licences, audits and incident history.
>
> Would a 20-minute call next week work?
>
> {Your name}
> {Channel} · {Contact email}

### Reply to an inbound sponsor request

> **Subject:** Re: {Their subject}
>
> Hi {Name},
>
> Thanks for getting in touch about {Product}. Before we talk numbers, we run every sponsor through the same checks.
> Could you send:
>
> 1. the legal entity, its registration number and address, and the names of your founders or executives;
> 2. the countries you serve and the ones you exclude, with your licence or registration numbers in each;
> 3. links to your security audits (on the auditor's own site) and your bug bounty, if you have them;
> 4. any security incidents, regulatory actions or lawsuits in the last three years, and how they were resolved;
> 5. the claims you'd like us to mention, with the evidence for each.
>
> Two things we don't do, so we don't waste your time: we don't mention returns, yields or prices, and we don't accept
> payment in tokens. Every sponsorship is disclosed out loud, on screen and in the description, and sponsors don't
> review our news coverage.
>
> Our media kit is attached. Once we've reviewed your answers, I'll send dates and options.
>
> {Your name}
> {Channel} · {Contact email}

### Declining

> **Subject:** Re: {Their subject}
>
> Hi {Name},
>
> Thanks for the offer. After our usual checks we won't be able to work together on this one. It isn't a judgement
> on your team: our rules for what we can feature are strict, and {Product} falls outside them.
>
> All the best,
> {Your name}

## 7. Files

| File | What it is |
| --- | --- |
| `docs/SPONSORS.md` | This file, including the media-kit template |
| `scripts/product/media-kit.ts` | Fills the template from `metrics.csv`, the audience file and the prices file; writes Markdown, HTML and PDF |
| `scripts/product/lib/metrics.ts` | The statistics and the placeholder filler (pure, tested) |
| `../creator-hub/data/media-kit/*.json` | Your audience facts and prices (gitignored) |
| `../creator-hub/data/sponsors/*.md` | Vetting records (gitignored) |
