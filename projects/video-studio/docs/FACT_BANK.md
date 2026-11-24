# Fact bank

Verify a fact once, then cite it in every video and language with its source attached. A writer tags a claim in the narration as `[fact:<id>]`. `to-storyboard` turns the tag into the claim gate's own `[src:<id>]` and adds a matching `sources[]` entry. The claim gate (`scripts/claims`) then runs unchanged.

Built 2026-11-24 (owner request 5, "Reusable fact bank"). TypeScript runs directly on Node 22 with type stripping. It has no dependencies.

| Path | What it is |
| --- | --- |
| `content/facts/facts.jsonl` | The bank: one fact per line, sorted by id, keys in a fixed order (a change to a fact is a one-line diff). |
| `content/facts/hosts.json` | The hosts `verify` may fetch: the news hosts the owner allowed in this environment, with what each returned on 2026-11-24. |
| `content/facts/SEED.md` | Where the first 39 facts came from, what was left out, and why. |
| `scripts/facts/cli.ts` | The CLI (entry point). The code is in `scripts/facts/lib/`. |
| `scripts/facts/tests/facts.test.ts` | Tests: 52 cases, no network. |

## A fact

```json
{"id": "pumpfun-coingecko-90-day-survivors",
 "statement": "CoinGecko found that just 850,180 Pump.fun tokens, or 4.55%, lasted more than 90 days.",
 "numbers": ["850,180", "4.55%", "more than 90"], "entities": ["CoinGecko", "Pump.fun"],
 "tags": ["pump-fun", "token-survival"], "volatility": "historical",
 "verification": "direct-read", "verifiedAt": "2026-11-24", "recheckAfter": "2027-11-24",
 "sources": [{"url": "https://crypto.news/…", "title": "…", "publisher": "crypto.news", "published": "2026-06-25",
   "tier": "secondary", "accessed": "2026-11-24",
   "excerpt": "CoinGecko said 12.8m tokens, or 68.67% of the total, recorded their final Pump.fun bonding-curve trade on launch day. … The report said just 850,180 tokens, or 4.55%, lasted more than 90 days",
   "checks": [{"at": "2026-11-24", "by": "verify", "result": "found", "detail": "excerpt found in the page text (HTTP 200)"}]}],
 "languages": {"es": {"statement": "…", "translation": "machine", "reviewed": false}},
 "usage": ["zoora-ai/pumpfun-top-caller"], "notes": "…"}
```

| Field | Rule |
| --- | --- |
| `id` | 3–64 characters: `a-z`, `0-9` and single hyphens. Cited as `[fact:<id>]`. |
| `statement` | One atomic claim in English, plain text with no markup, at most 600 characters. If it is someone's estimate, it is attributed ("Sparsity Research estimated…"). |
| `numbers` | Every figure in the statement as written there, with its qualifier ("about 850,000", "over $1 billion", "January 19, 2024"). It is an error if a figure in the statement is not listed, or if a listed figure is not in the statement. Digits inside a name are not figures when the name is listed in `entities` ("GPT-5", "Claude Opus 4.5", "Alpha Arena Season 1"). |
| `entities` | Organisations, products, places and named events. **Never private individuals.** `"A\|B"` lists aliases (`"Andreessen Horowitz\|a16z"`). |
| `tags` | Topic tags in lower-case kebab-case. Search and the weekly planner use them. |
| `volatility` | `volatile` (prices, totals to date, live programmes, open cases) gets a **30-day** recheck. `historical` (settled past events) gets **365 days**. |
| `verification` | `direct-read`: an excerpt was found on the live page, by `verify` or by a person in a browser (`confirm`). `search-extract`: the claim was seen only in search-engine extracts. `unverified`: never verified, or a direct read no longer finds any excerpt. |
| `verifiedAt`, `recheckAfter` | YYYY-MM-DD. `recheckAfter` is the **last fresh day**: a volatile fact verified 2026-11-24 is fresh through 2026-12-24 and stale from 2026-12-25. Both are `null` when unverified. A recheck date beyond the policy is an error. |
| `sources[]` | At least one. `url` (https only, at most once per fact), `title` (the page's headline), `tier` (`primary`: the original document or the company's own release; `secondary`: a news outlet with editors; `tertiary`: aggregators, flash news, vendor blogs, social posts), `accessed`, `excerpt`, `checks`. Optional: `publisher`, `published`, and `cardTitle` (below). |
| `excerpt` | **At most 280 characters, copied from the page, never paraphrased.** `…` (or `...`) joins passages of the same page in page order, and can leave out a private person's name. Each passage is at least 8 characters. Every excerpt must contain at least one of the claim's figures or entities, and every listed figure must be in at least one excerpt. |
| `checks[]` | The source's history, oldest first, last 10 kept: `{at, by: verify \| person \| search, result: found \| missing \| unreachable \| not-allowed, detail}`. `direct-read` is valid only with a `found` check by `verify` or `person` dated `verifiedAt`. `search-extract` needs a `found` check by `search`. Only the tools write `verify` and `person` checks. |
| `cardTitle` | Optional. Replaces the headline on the episode's sources card (which shows "title · domain") when the headline overstates the claim or repeats a must-not-say line, for example "…Gaslit Into Losing Millions". It must name the publisher. |
| `languages` | `{es?, pt-br?, hi?, it?, zh?, ja?}`, each `{statement, translation: machine \| human, reviewed?}`. A translation whose digits differ from the English is a warning. Only the owner sets `reviewed: true`. |
| `usage` | `"<channel>/<slug>"` of every episode that cites the fact. `to-storyboard --write` maintains it, so a correction can find every video that used the fact. |
| `notes` | How to say it safely: the research checker's caveats and must-not-say lines. |

**Figures are compared as values, not strings.** "$1.08B", "$1.08 billion" and "1,080,000,000 dollars" are equal. A percentage never matches money, ETH never matches SOL, and "5%" does not match inside "45%". Dates match in any common form ("19 Jan. 2024", "2024-01-19", "January 19th, 2024"). A date with no year counts if the excerpt names the year elsewhere, for example in its dateline. Qualifiers set the tolerance:

| Statement says | An excerpt supports it with |
| --- | --- |
| `68.67%` | exactly 68.67% |
| `about 850,000` | 850,180 (the same value at the precision written; half a unit, inclusive) |
| `over $1 billion`, `more than 80%` | anything at or above the figure ($1.08B, 82%) |
| `fewer than 5`, `under 10%` | anything at or below |
| `nearly 50%`, `just under $150 million` | at or below, and at least 80% of the figure |

**Privacy.** Statements, notes, entities, titles, URLs, excerpts and translations are checked against the claim gate's own detectors (`scripts/claims/lib/names.ts`, `wallets.ts`). That means the private names list `data/private/names.txt` (gitignored) when it exists, wallet-like strings, and the redaction placeholder "[named person]". A matched name is never printed: the message says "private name #N".

## Commands (run from `projects/video-studio/`)

| What | Command |
| --- | --- |
| Find a fact to cite | `node scripts/facts/cli.ts search pump.fun graduation` (prints the `[fact:<id>]` to paste; `--tag`, `--entity`, `--status usable`, `--lang es`, `--json`) |
| Read one fact | `node scripts/facts/cli.ts show <id>` |
| Resolve a storyboard | `node scripts/facts/cli.ts to-storyboard content/<channel>/<slug> --all-langs --write` (every `storyboard*.json` of the episode, all or none; or one file: `--lang es` for `storyboard.es.json`; `--check` only reports; with neither it prints the result) |
| Pre-render gate | `node scripts/facts/cli.ts to-storyboard content/<channel>/<slug> --all-langs --check --strict` (exit 1 while any `[fact:]` tag is unresolved or any cited fact is unverified or stale) |
| Facts due for a recheck | `node scripts/facts/cli.ts stale` (`--within 14` adds those going stale in the next 14 days) |
| Re-verify | `node scripts/facts/cli.ts verify --all-due` (or `verify <id>...`, or `verify --all`; `--dry-run` writes nothing) |
| Record a browser read | `node scripts/facts/cli.ts confirm <id> --source 1 --by owner` |
| Add facts | `node scripts/facts/cli.ts add` (asks for each field) or `add --json facts.json` (an object, an array or JSON Lines) |
| Check the bank | `node scripts/facts/cli.ts validate` |
| Tests | `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/facts/tests/facts.test.ts` |

Common options: `--bank <file>`, `--today YYYY-MM-DD` (default: today in America/Chicago), `--names <file>` or `--no-names`, `--json`. Exit codes: **0** ok; **1** refused or failed (validation errors, a refused storyboard, a fact still unusable after `verify`); **2** bad input.

### The writer's loop

1. `search` the bank and paste the tag after the claim: `CoinGecko found that 68.67% of 18.67 million Pump.fun tokens made their last bonding-curve trade on launch day [fact:pumpfun-coingecko-launch-day-deaths].` A tag can list several facts, `[fact:a,b]`, and works only in `scenes[].narration`, outside `{display|spoken}` markup.
2. `to-storyboard <episode> --all-langs --write`. Each tag becomes `[src:<id>]`, and `sources[]` gets one entry per fact: its best source (read directly first, then the stronger tier, then the latest read), `quote` = the excerpt, `status: "verified"`. Everything else in the file keeps its formatting. Nothing is written when anything is refused:
   - unknown ids;
   - facts that fail validation, are unverified, or are stale;
   - tags outside narration or inside `{…|…}`;
   - an existing source with the same id that points elsewhere.
   A `search-extract` fact is a warning ("nobody has opened the page"), and an error with `--require-direct`.
3. Run the claim gate as usual: `node scripts/claims/check.ts content/<channel>/<slug>`.
4. Right before voice and render, run `to-storyboard <episode> --all-langs --check --strict`. It fails while a tag is unresolved, because an unresolved tag would reach the captions as text. It also fails when a fact cited earlier has gone stale. `--write` refreshes the sources it wrote.

Translations keep the same tags (the claim gate checks that), and `--all-langs` resolves them together with the English. A fact without a statement in that language is a warning, because the translator should compare against the English claim.

### How `verify` decides

For every source whose host is on `content/facts/hosts.json`, `verify` fetches the page. It follows redirects by hand, checks every hop against the allowlist, spaces requests to the same host, and caps the size. It then looks for the excerpt in the page text, or in the article data the page embeds (script-rendered sites).

| What happened | Source check | Fact |
| --- | --- | --- |
| The excerpt is on at least one source | `found` | `direct-read`; `verifiedAt` today; `recheckAfter` renewed |
| A page was read but no excerpt is on it | `missing`, plus up to 3 sentences from the page to fix the excerpt with | `unverified` (to-storyboard refuses it until fixed) |
| No page could be read (bot challenge, error, timeout, PDF, not the cited article) | `unreachable` | unchanged: **never counted as verified** |
| The host is not on the list (or a redirect leaves it) | `not-allowed`; nothing fetched | unchanged |

A source whose last read was `missing` is never cited. `confirm` is for pages this environment cannot read: on 2026-11-24 theblock.co (Cloudflare challenge), coindesk.com (Vercel checkpoint), thedefiant.io (Cloudflare block), and blockworks.co (redirects to blockworks.com, which is not allowed). A **person** reads the page in a browser, sees the excerpt, and runs `confirm <id> --source <n|url> --by <role or initials>`. Never put a full private name in `--by`: the repo is public. An agent never uses `confirm`.

**Network.** This cloud session reaches the web through an HTTPS proxy that Node's `fetch` ignores, so `cli.ts verify` re-runs itself with `NODE_USE_ENV_PROXY=1`. Adding hosts to `hosts.json` does not open them: the owner approves hosts in the environment settings first. On a machine with open network, such as GitHub Actions or a laptop, `verify --all-due --any-host` reads any https source. A monthly `verify --all-due` keeps volatile facts fresh. It exits 1 when a fact stays unusable, so a person looks.

## The seed

The 39 facts imported on 2026-11-24 are the research fact-checker's "holds" verdicts for the two Zoora AI episodes:

- 24 facts were imported as `search-extract`, where the checker cited that page.
- 15 were imported as `unverified`, where the bank cites a different article on an allowed host because the checker's page is unreadable here.

All 39 were then re-verified by direct fetch: every excerpt was on its page, so every fact is `direct-read`. `content/facts/SEED.md` lists each fact and every "holds" claim left out, with the reason. The reasons include private individuals, must-not-say figures, and sources this session cannot read. It also lists the conflicts found along the way.

## For other tools

- **The file contract** is `facts.jsonl` as above. Read it with `scripts/facts/lib/store.ts` (`loadBank`) and judge freshness with `lib/stale.ts` (`freshness`, `isUsable`, `dueFacts`). The weekly batch planner, for example, can list `usable` facts by tag.
- **JSON output:** `search --json`, `stale --json`, `verify --json`, `validate --json` and `to-storyboard --check --json`.
- `to-storyboard` writes only fields the claim gate already knows (`[src:]`, `sources[]` with `id`, `title`, `url`, `quote`, `accessed` and `status`). `src/episode/types.ts` is unchanged.

## Known limits

- The excerpt check is textual. It proves the words are on the page, not that they mean what the statement says. The statement's wording is the writer's and the owner's responsibility, guided by each fact's `notes`.
- A page that changes its wording turns a fact `unverified` on the next `verify`. That is by design: a person picks a new excerpt from the suggested sentences.
- Figures written only in words ("two weeks") are not checked as figures; write digits when a figure matters.
- The machine translations in the seed have not had a native review.
