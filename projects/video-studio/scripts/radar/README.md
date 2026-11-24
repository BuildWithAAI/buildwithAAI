# News radar (channel 2: crypto and AI security, working slug `zoora-security`)

Step 1 of the channel-2 pipeline in `projects/video-studio/CLAUDE.md`: watch incident
trackers, security-firm research, post-mortems and news, then write a sourced daily brief.
It has two lanes, **crypto security** and **AI security** (the owner's scope in
`content/zoora-security/channel.json`), and every incident and item says which lane it is in.
The claim gate (step 2) and the owner's review (step 3) come after it, so the radar
drafts research and never a script. Python 3 standard library only.

```bash
cd projects/video-studio
python3 scripts/radar/radar.py collect --date 2026-11-24                     # live
python3 scripts/radar/radar.py collect --date 2026-11-24 --offline-fixtures  # recorded fixtures
python3 -m unittest discover -s scripts/radar/tests -t scripts/radar         # 159 tests, about 5 s
```

| Output | Where |
| --- | --- |
| Machine brief | `content/zoora-security/radar/<date>.json` (live runs): `top`, `alsoSeen`, `laneTop` (each lane's best 5 ids), `counts.candidatesByLane`, and a `lane` on every incident, source entry, unclustered item and source row |
| Human brief | `content/zoora-security/radar/<date>.md`: top 5 with sources, status, lane and score reasons, the AI security lane's best 5, "also seen", unclustered items, source health |
| Polite cache | `.cache/radar/` (gitignored): parsed items (titles, links, dates, excerpts of 280 characters or fewer), ETag/Last-Modified, robots.txt |
| Offline runs | `.cache/radar/offline-out/` unless `--out-dir` is given, so fixture output never replaces a real brief |

Other options: `--window-days 3` (fresh window ending on `--date`), `--lookback-days 14`
(history and novelty), `--max-age-days 120` (oldest incident a follow-up can attach to),
`--only id,id`, `--no-cache`, `--history-dir`, `--user-agent`. The exit code is 0 when at
least one source was read, 1 when none was, and 2 for bad input.

## Rules every output line follows

1. **Every fact traces to a stored excerpt.** `facts[]` and `reportedLosses[]` carry a `quote`
   that is checked to be a substring of the stored source title or excerpt. A fact whose quote
   is missing is dropped.
2. **Loss figures are "reported by" a named source and never averaged.** Every figure is listed
   with its source. Ranking uses the lowest figure from the highest tier that gave one.
3. **Unconfirmed means "developing".** It is in the status, in the generated title, and in a note.
   The mechanism has its own status (`mechanismStatus`: stated, suspected or unknown, read from the
   source's full text before it is cut to an excerpt), so a confirmed incident with a suspected cause
   is titled "key compromise (suspected, per SlowMist)". When users' own keys or devices were hit, the
   title names the users ("Lighter users: key compromise"), not the protocol.
4. **No individual names.** `safety.redact_people` replaces likely personal names and known
   investigator handles with `[named person]` in every stored title and excerpt, and a subject
   that looks like a person is never used as the incident's protocol. Officials named in
   law-enforcement or regulator releases are the allowed exception. The radar does not read
   such releases directly, so it redacts them too, and the claim gate may restore an official
   from the primary release. A lone capitalised word before "says", "said", "told" or after
   "according to" is taken for a surname ("Saylor says") unless it is an organisation the run has
   seen (incident-database records, source names) or a well-known firm, and pseudonyms
   ("coordinated by Kruw", "an entity called ...") are redacted too. A name the run has seen used
   for a person (a role word before it, a personal pronoun after it in the same sentence, or a
   pseudonym cue: "Crypto trader X says his wallet was hacked") is then redacted in every title,
   excerpt and qualifier of the run, and can never be a subject or an outlet's origin, so "Was X
   hacked?" and "X-linked wallet" from other outlets cannot make X an incident's id, title or
   protocol (2026-11-24 live run). A firm that only "says" things ("Glassnode said") is not spread
   this way. AI products ("Claude Code", "Claude Opus 5", "Gemini CLI") are never taken for people,
   but "Claude Dupont said" still is; a name given by its surname alone ("a man surnamed X", with
   the name in its own script after it) is redacted, and a given name left in front of a redacted
   surname goes with it. The redaction is heuristic, so the claim gate stays responsible.
5. **No exploit how-tos.** `safety.redact_code` removes addresses, hashes, code spans, function
   calls and identifiers (`[code]`, `[address]`). Generated text uses only labels such as
   "key compromise" or "Bridge & Cross-Chain / Cross-Chain Message Spoofing". It contains no
   step lists or mechanisms.
6. **No price or investment talk.** Generated text contains none. Price-only stories are not
   listed. When a source text discusses prices, the incident carries a note.
7. **Don't speculate about others' material.** The radar does not paraphrase sources beyond
   labels. Headlines are quoted with attribution. Links that SlowMist cites (mostly x.com)
   are recorded as "cited by the source; not fetched".

`safety.check_generated()` lints generated text for names, code, price talk, step lists and
speculation. The end-to-end tests run it on every title and fact.

## Sources and tiers (`sources.json`)

| id | Kind | Tier | Notes |
| --- | --- | --- | --- |
| `defillama-hacks` | json-api | A | Structured backbone (fields below). |
| `slowmist-hacked` | html | A | Security firm's incident database, first page (20 cases). |
| `rekt-news` | html | A | Post-mortems. Only "<Protocol> - Rekt" posts form incidents. |
| `chainalysis-blog` | rss | A | Research. Product announcements are excluded. |
| `certik-blog`, `trm-blog` | html (cards) | A | Research and incident analyses. Promotional posts are excluded. |
| `coindesk`, `decrypt`, `cointelegraph`, `theblock`, `thedefiant`, `dlnews` | rss | B | Established outlets. The Defiant's `/frontier/` (AI) section is excluded. |
| `blockworks` | rss | B | **Unverified.** blockworks.co was refused by this session's network proxy, so it reports "skipped". |
| `web3isgoinggreat` | atom | C | Aggregator, CC BY-SA 3.0. Its entry times can be catch-up times. |
| `cryptonews`, `coinedition` | rss | C | Mixed original, sponsored and price content. |

AI-security lane (added 2026-11-24; `"lane"` is `ai` or `both`, every crypto source above is `crypto`):

| id | Kind | Tier | Lane | Notes |
| --- | --- | --- | --- | --- |
| `unit42-blog` | rss | A | both | Palo Alto Networks' research (AI-agent attacks and crypto drainers). Promotional posts and the "Threat Intelligence Highlights" digests are excluded. |
| `msft-security-blog` | rss | A | both | Microsoft Threat Intelligence and AI Red Team research. Product, award and analyst-ranking posts are excluded. |
| `embracethered-blog` | rss | A | ai | A researcher's primary AI-agent and prompt-injection research, low volume; attributed to the blog, never to a person. |
| `bleepingcomputer` | rss | B | both | Sponsored posts (author line "Sponsored by ...") and deals are excluded. |
| `therecord` | rss | B | both | Recorded Future News. Podcasts excluded. |
| `securityweek` | rss | B | both | The main feed (the AI-category feed is behind a Cloudflare challenge and is not used). Funding, M&A, people moves, webinars and round-ups are excluded. |
| `darkreading` | rss | B | both | Wire press releases (no author line) are excluded; the check switches itself off with a warning if most items lose their byline. |
| `krebsonsecurity` | rss | B | both | Crawl-delay 35 s (obeyed). Its tags name people, so no categories are kept. |
| `aiid` | rss (`aiid_rss`) | C | ai | The AI Incident Database: each item is ANOTHER outlet's report (the link is the original). Tracker, tier C, discovery only: never confirms, and facts come from the original report. Its citation link becomes the report's incident reference (`aiid:<n>`), which groups reports of one incident. |

- The general security outlets (`"cryptoContext": "strict"`) and every source outside the crypto lane need
  unambiguous crypto words for the crypto lane ("access tokens", "Microsoft Exchange" or "protocol" are not crypto
  there). "Cryptography" is never crypto context.
- Per-source rules in `sources.json`: `excludeUrlPatterns`, `excludeCategories`, `excludeTitlePatterns` (regex),
  `excludeSponsored`, `bylineRequired`, `stripFeedFooter` (WordPress "The post ... appeared first on" lines),
  `dropCategories`. The parser reads author lines only for these flags and never stores a name.

- **Tier A:** primary or official incident data, security-firm research and post-mortems.
  **Tier B:** established outlets. **Tier C:** aggregators. Tier C never counts toward confirmation.
- **Trackers** (`"tracker": true`: DefiLlama, SlowMist) are tier A for figures and dates, but an
  incident database never confirms an incident alone. A SlowMist record whose only reference is an
  X post is marked `unverified` (the radar cannot read X).
- Each entry has `terms` notes: robots.txt as read on 2026-11-24, copyright lines, what is stored.

### Politeness

- One User-Agent for every request.
- One request per second per host, or more when robots.txt sets `Crawl-delay`.
- robots.txt is fetched once a day per host (RFC 9309: longest match, Allow wins ties, `*` and
  `$` wildcards). A 404-style 4xx means no rules. A 401, 403 or 429, a 5xx or an unreachable host
  means "do not crawl this host now" (asked again after 6 hours).
- The radar obeys robots.txt for its own token and, because its output feeds an AI-assisted
  drafting step, also for Anthropic's user-directed agent token `Claude-User`. CoinDesk's
  robots.txt blocks named AI crawlers (ClaudeBot, anthropic-ai, Claude-Web) but has no group
  for Claude-User, so its `*` group (RSS allowed) applies.
- Conditional GETs (ETag / If-Modified-Since) and a per-source TTL (30 to 120 minutes).
- Retries: two at most, for 429 / 5xx / timeouts only. 403 and proxy refusals are never retried.
- Responses are capped at 8 MB, including gzip, and read in chunks within a 60-second wall-clock
  budget per request (a slow-drip server cannot hold a run).
- Only http and https can be opened: the opener has no ftp:, file: or data: handlers. Redirects are
  followed by hand, at most 5: https only, to the same host or a host listed in `sources.json`, with
  no credentials or unusual ports, and the new host's robots.txt and spacing are checked again.
- HTML is parsed into a capped DOM: nesting stops at 256 levels, stray end tags cost nothing, the
  traversal is iterative, and a page with more than 200,000 elements or a parse longer than 10 s is
  refused.
- XML is parsed with `xml.etree` (expat; no external entities). A structural expat pre-scan refuses
  any internal DTD subset or entity declaration before parsing, in any encoding (UTF-16 included)
  and wherever padding puts it. Feed text is only ever data: no shell, no eval, and
  `<script>` elements are dropped.
- A parse failure (layout change, bad XML) skips that source with a warning. The run never
  crashes.

**User-Agent.** The default is the generic `NewsRadar/0.1`, so the channel's name is not sent
to third parties unless the owner opts in. To identify by name, set
`RADAR_USER_AGENT='ZooraNewsRadar/0.1'` or pass `--user-agent`.

### DefiLlama `/hacks` fields (verified against the live API, 2026-11-24)

The API returns one JSON array; there were 1,375 records, from 2011-06-19 to 2026-11-22.

| Field | Type | Meaning |
| --- | --- | --- |
| `date` | int | Unix seconds at 00:00 UTC of the incident day (day granularity) |
| `name` | str | Target name, sometimes with a parenthetical: `Wagyu (XMR1)`, `Curve Finance (CowSwapBurner)` |
| `classification` | str or null | One of 13 classes: Access Control, Protocol Logic, Token & Share Accounting, Key Compromise, Oracle Manipulation, Frontend & Infrastructure, Input Validation, Reentrancy, Social Engineering, Bridge & Cross-Chain, Rugpull, Governance, Market Manipulation |
| `technique` | str or null | About 80 values, for example Private Key Compromised, Hot Wallet Key Compromised, DNS Hijack, Phishing, Address Poisoning, Unknown |
| `amount` | int, float or null | USD loss as recorded (65 nulls) |
| `chain` | list[str] or null | Affected chains (DefiLlama names, for example `Binance` for BNB Chain, `Hyperliquid L1`) |
| `bridgeHack` | bool | Bridge incident flag |
| `targetType` | str | DeFi Protocol, CEX, Wallet, Token, Chain, NFTfi, Gaming, Prediction Market... |
| `source` | str | Reference URL. **Empty for all 1,375 records on 2026-11-24**, so records link to the API URL with a `#name@date` fragment |
| `returnedFunds` | number or null | USD returned |
| `defillamaId` | str or null | Protocol id or `chain#<slug>` |
| `parentProtocolId` | str (optional key) | `parent#<slug>` |
| `language` | str or null | Contract language |
| `description` | str or null | Free-text summary, stored cut to 280 characters |

The parser keeps records from the 120 days before the run date and skips malformed records
with a warning.

## How a brief is built

1. **Relevance, in two lanes.** A source carries the lanes its `lane` names, and keeps an item that a
   lane it carries accepts. The item's own lane is `both` when it passes both rules.
   - **Crypto:** crypto context (in the text, categories or URL) and either an incident term (hack,
     exploit, drained, stolen, phishing, rug pull, compromise...) or a security topic (vulnerability,
     post-mortem, private keys, frozen funds...).
   - **AI:** AI context (an LLM, generative AI, a chatbot, an AI agent or coding agent, an MCP server,
     model weights, a deepfake or cloned voice, a named AI product such as Claude Code, Copilot, Gemini or
     ChatGPT) AND an AI-security incident or topic: prompt injection or a jailbreak, data or secrets exposed
     through an AI tool, a malicious or poisoned model, package, extension or MCP server, an AI-assisted
     intrusion or campaign, deepfake or voice-clone fraud, AI-generated phishing, AI-washing charges.
     Product launches, deals, funding, earnings, webinars, video round-ups, awards, "AI era" opinion and
     sponsored posts never count, and neither does AI used for defence or research ("discovered using AI").
   - Negated mentions such as "no evidence of a security breach" or "no evidence AI was used" do not
     count. Per-source exclusions apply, and vendor blogs drop promotional posts.
2. **Mentions.** Titles and excerpts are sanitised. Each mention gets dates, a subject, aliases,
   loss figures, chains, a type vote, a hedge flag ("suspected", "apparent", "investigating"...),
   legal terms and audience cues.
   - Excerpt figures come only from tier A/B, and never from sentences about other or possible
     losses.
   - Recoveries, freezes, forfeitures, bounties and laundering flows are not losses.
3. **Clusters.**
   - Seeds: DefiLlama and SlowMist records with matching names and incident dates within 2
     days. Aliases include parentheticals and owners named in the description
     ("Fusionist's Endurance Bridge", "Cyber's cross-chain bridge").
   - News, post-mortems and research attach to the best seed, which needs:
     - an alias in the title (or capitalised in the excerpt), and
     - a compatible date: a stated incident date within 3 days, or publication from 1 day
       before to 21 days after the incident (30 for post-mortems and research, 120 for
       follow-ups such as seizures, freezes and tracing, and for tier C).
     - A figure within 15% of the seed's database figure breaks ties between same-name
       incidents.
   - An item never joins an OLDER record when it reports a new or repeat attack ("a new attack",
     "hacked again"), dates its incident more than 3 days from the record, or states a figure
     more than 2x away from the record's.
   - Names must match exactly (aliases, case-insensitive); near-names such as Prisma/Prism or
     Sonne/Sonnet only merge when the chain, a date within 2 days and a figure within 15% agree.
   - The remaining incident news clusters by subject and date with complete linkage: every pair in
     a cluster must agree, so items days apart never chain into one incident. Items without a
     confident subject are listed as unclustered and never guessed.
   - AI incidents have no database seeds, and an AI-only item never joins a crypto seed ("National
     Cyber Security Centre" is not the Cyber Bridge hack). Their subject is the first AI product or
     company the headline names (a product over its own vendor: "Anthropic says ... Claude Code" is
     about Claude Code), else a headline subject that cannot be a person: a name the news gate's
     allowlist knows as an organisation, one with a digit ("123 Reg"), a distinctive token ("GoDaddy")
     or an organisation word at its end ("European Commission"). A two-word name that could be a person
     is never a subject. Reports that the AI Incident Database files under one incident cluster
     together through their `aiid:<n>` reference.
4. **Incident.** Each incident gets:
   - `{id, title, protocol, chains, type, dateUtc, reportedLosses, status, sources, postMortemUrl, evergreenTopic, notes}`
   - plus `statusReason`, `typeReason`, `mechanismStatus`, `mechanismKnown`, `userSide`, `facts`, `score`
     and `shortReady`, and when they apply `firstSeenUtc` and `dateNote` (no source states the date:
     `dateUtc` is null, never guessed from a publication date), `mechanismNote`, and `carriedSources`.
   - A headline's figure is this incident's only when it is not in a clause about another incident
     ("..., months after a $1 million exploit"). Qualifiers stay with figures ("almost $1 million"),
     and a figure that includes amounts a source says "may have" been lost is flagged.
   - **type** is one of exploit, phishing, drainer, rug, key-compromise, social-engineering,
     bridge, oracle, governance, other, or an AI type: prompt-injection, ai-agent-exploit,
     malicious-ai-tool, model-supply-chain, ai-data-exposure, ai-assisted-attack, deepfake-fraud,
     ai-phishing, ai-washing. It is taken from the highest tier that states a mechanism, with priority
     social-engineering > drainer > phishing > rug > key-compromise > oracle > governance > bridge >
     (the AI types: deepfake-fraud > ai-phishing > prompt-injection > malicious-ai-tool >
     model-supply-chain > ai-data-exposure > ai-agent-exploit > ai-assisted-attack > ai-washing) >
     exploit > other. An item in both lanes keeps a crypto mechanism a source states; a bare "hack", a
     generic exploit or "other" gives way to its AI type. Crypto-only items never get an AI type.
   - **evergreenTopic** is one of drainers, address-poisoning, phishing, key-management,
     bridge-security, oracle-manipulation, rug-pulls, social-engineering, fake-job-malware,
     ai-security (agents, prompt injection, malicious tools, model supply chain, data exposure) and
     ai-scams (deepfakes, cloned voices, AI phishing), or null when none fits (AI-assisted attacks,
     AI-washing).
   - **lane** is crypto, ai or both, from its sources' lanes.
5. **Status.** `confirmed` needs one of: an unhedged tier-A primary statement that is not an
   incident database (the project, a post-mortem, a security firm, a law-enforcement release); the
   project's own statement relayed by an unhedged tier-B outlet; or two unhedged tier-B outlets that
   do not relay the same origin (one vote per outlet). Newsletter round-ups never count. A source
   that walks the report back (a denial, a retraction, a false alarm) makes it `developing`.
   Everything else is `developing`, and the title says so.
6. **Fresh window.** By default this is the run date and the 2 days before it, judged by the
   freshest tier-A/B source. Aggregator timestamps and newsletter round-ups alone never make an
   old incident look new.
   A database record that surfaced since the last live run counts as fresh.

## Ranking

Each factor is between 0 and 1 and has a reason string in `score.factors.*.reason`. The total
is out of 100.

| Factor | Weight | Rule |
| --- | --- | --- |
| loss | 25 | log10 of the lowest figure from the best tier: $10K gives 0, $1B gives 1. **AI-security incidents** (an AI type in the ai or both lane) score concrete harm instead (`"basis": "harm"`): exploited or used in real attacks 0.45, users or data affected 0.3, a fix, advisory or takedown shipped 0.25, each at the best tier that states it (A 1.0, B 0.85, C 0.4; a hedged source half), +0.1 when two or more publishers state harm; a reported dollar figure still counts when it is higher |
| recency | 20 | Freshest tier-A/B source: 1 up to 24 h before the end of the run date, then linear down to 0 at 96 h |
| sources | 20 | Independent publishers weighted A 1.0, B 0.6, C 0.25, saturating at 2.5. Round-ups do not count |
| novelty | 15 | 1.0 if new in the window; 0.6 for a recent incident with new coverage; 0.4 for a follow-up to an incident more than 14 days old; 0.5 or 0.1 if already in a live radar of the last 14 days, with or without new items. The reason also counts same-type incidents in those 14 days |
| evergreen | 10 | 1.0 when the incident *is* the explainer topic (phishing, drainer, rug, social engineering, address poisoning, fake job; deepfake fraud, AI phishing, prompt injection, malicious AI tools). 0.7 for bridge or oracle, for users' own keys (user-side), for custody keys of a wallet or exchange with no institutional cues, and for AI data exposure or AI agent exploits. 0.6 for drainer exposure through approvals or front ends, and for AI model supply chain. 0.4 for protocol infrastructure keys |
| audience | 10 | Base from the target type (Wallet 0.9, CEX 0.8, DeFi Protocol 0.35...). Retail mechanisms are raised to 0.85 (and deepfake fraud, AI phishing and malicious AI tools; 0.6 for prompt injection, AI data exposure and agent exploits; 0.4 for model supply chain and AI-assisted attacks). Retail cues add 0.1 each (up to +0.3) and institutional cues subtract 0.1 each (down to -0.2) |

**Sourcing check for a daily Short** (`score.sourcing_bar`, still exported as `analysis_bar`).
`shortReady.ready` needs all of: confirmed status, 2 or more independent publishers, a mechanism a
source states (not suspected or unknown), and an evergreen strength of at least 0.6. It is NOT the
owner's "real analysis" rule: that is judged later by the daily system (`scripts/daily`) and by the
owner on the approval page.

**History and corrections.**
- Live briefs from the last 14 days provide novelty and `seenRecordKeys`. Offline outputs are
  ignored.
- An incident seen in an earlier live run keeps that run's `id`. Its earlier sources that have
  since rotated out of their feeds are carried over (`"carried": true`, with their figures) and
  still count for the status: a feed rotating is not a retraction. Only a source that walks the
  report back drops them.
- A status or type change, or the SAME source (the same article) now stating a different figure,
  is listed under `corrections` and "Correction candidates (pin if already published)". A new
  source repeating a known figure is not a correction.

## Fixtures and tests

- `fixtures/` holds trimmed recordings of every source from 2026-11-24 (2 to 8 items each,
  excerpts of at most 280 characters, no author fields). `tools/build_fixtures.py` rebuilt the
  crypto ones and `tools/build_ai_fixtures.py` the AI lane's (AI-security positives and the day's
  hard negatives: sponsored posts, launches, deals, a press release, opinion, AI incidents that are
  not security), both from raw payloads that are not committed. Names in the AI fixtures are redacted
  with the radar's own rules and author names are replaced.
- `fixtures/negative/` holds an entity bomb, a non-feed, broken XML, redesigned pages and a
  JSON error object.
- `fixtures/synthetic/` is invented data (people, a handle, an address, a function name) that
  must never reach output.
- `fixtures/history/` holds a hand-made previous brief for the novelty and correction tests.
- The tests cover text, safety, robots, fetch (fake opener, no network), parsers, classify,
  cluster, score, and the pipeline/CLI end to end. `tests/test_regressions.py` replays the review's
  scenarios: new attacks versus old records, chained news, near-names, headline figures about
  other incidents, feed rotation, id stability, same-source corrections, redirects to ftp:/file:/
  unlisted hosts and a slow drip against a real local server, entity declarations in UTF-16 and
  padded XML, hostile HTML, rate-limited robots.txt, surname and pseudonym redaction, and a
  person's name spread from one outlet's headline to every other outlet's text in the run.
- `tests/test_ai_lane.py` covers the AI lane: relevance on the day's titles (positives and hard
  negatives), types, exclusions (sponsored, press releases, digests, strict crypto context), subjects
  (products, never a person), redaction next to AI product names ("Claude Code" is not a person,
  "Claude Dupont said" still is), the AI Incident Database parser, harm scoring, lanes on every output,
  and the offline run with the crypto ranking unchanged.

## Known limits

- **Heuristics.** Subject extraction, name redaction and figure extraction are rules, not
  understanding. They are tuned on the 2026-11-24 feeds and tested, but the claim gate and
  the owner review remain the safeguard. The lone-surname rule errs toward redaction: an
  organisation the run has not seen ("Garantex said") becomes "[named person] said".
- **Renamed protocols.** A rename with no "formerly known as" hint anywhere in the record stays two
  incidents (the new name in the database, the old one in the news).
- **Unreachable sources.** X/Telegram are unreachable and never used: SlowMist reference links
  that point there are kept only as links. blockworks.co is refused by this environment's proxy.
- **DefiLlama dates are days.** Freshness of a database record uses its incident day, or
  "surfaced since the last live run" once history exists.
- **Shallow pages.** The first SlowMist page and the rekt.news home page are the only pages
  read, which is enough for a daily run but not for backfills.
- **AI lane heuristics.** The AI rules are regexes tuned on the 2026-11-24 feeds. General security
  outlets often report an AI-assisted incident without saying "AI" in the stored excerpt (BleepingComputer's
  Check Point and European Commission items did not), so those reports cannot corroborate the AI
  incident and most AI incidents start as developing on one outlet. Subjects are conservative: an AI story
  whose headline names no product or known organisation stays unclustered.
- **AI Incident Database dates** are when a report was added. A report whose text states no date looks
  fresh on that day; it stays tier C (developing, small weight).
