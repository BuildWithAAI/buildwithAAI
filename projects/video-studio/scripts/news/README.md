# News claim gate (channel 2, `zoora-security`)

The second step of the daily news pipeline (CLAUDE.md, "Channel 2"): **radar → claim gate → owner approval → render, publish kit, announcer, Threat Brief**. It checks a news storyboard against the facts the radar selected and the owner's rules, and writes a report the owner can read on a phone in the 5-minute review. It runs **in addition to** the general claim gate (`scripts/claims`, another workflow): when that exists it is run as a child process, and either way the news rules below are enforced here.

The gate only reads and writes local files. It never fetches, uploads or publishes anything.

```bash
cd projects/video-studio
node scripts/news/gate.ts <slug>                     # content/zoora-security/<slug>/{storyboard,brief}.json
node scripts/news/gate.ts <slug> --brief content/zoora-security/radar/2026-11-24.json --incident 2026-11-21-chainflip
node scripts/news/corrections.ts pinned <id>          # the pinned-comment text for a correction
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/news/tests/*.test.ts   # 147 tests
```

Exit codes: **0** pass, **1** fail (every failure has a fix hint), **2** usage error. Reports: `out/claims/news-<slug>.md` (for the owner) and `out/claims/news-<slug>.json` (for the approval page and the publish kit; it carries the sha256 of every input, so an approval can be tied to exactly the storyboard that passed).

## Inputs

| File | What the gate needs |
| --- | --- |
| `content/zoora-security/<slug>/storyboard.json` | The episode engine's `Storyboard` (`src/episode/types.ts`) plus two optional fields defined in `lib/types.ts` (`NewsStoryboard`): `analysis` and `news`. `fiction` must be `false`. |
| `content/zoora-security/<slug>/brief.json` | The facts the radar selected: `facts: [{id, text, sourceIds[], excerpts[]}]`, plus `sources` (`{id, url, title, publisher, kind, publishedAt, excerpt(s)}`) and `incidents` (`{id, name, status}`). `excerpts` may be strings (lined up with `sourceIds`) or `{sourceId, text}`. Status words `developing/unconfirmed/breaking/...` mean developing; an unknown word also means developing (fail closed). |
| a radar file instead of brief.json | `--brief content/zoora-security/radar/<date>.json --incident <id>` reads one incident of the radar's daily file (`scripts/radar`, schema `zoora-security/radar@1`), or a single incident object. Feed ids that repeat get suffixes (`coindesk`, `coindesk-2`); fact ids are `f1..fn`, and every stored article excerpt also becomes a fact (`e1..en`). A curated brief.json is still preferred (the report warns). |
| `content/zoora-security/corrections.json` | `{version: 1, corrections: [...]}`. Missing = no corrections. |
| `scripts/news/allowlist.json` | Names that are not private people (rule R4). |

### The two storyboard fields this gate adds

```jsonc
"analysis": [{
  "id": "a1",
  "kind": "fund-flow" | "pattern" | "comparison" | "stat",
  "basis": "own-data" | "source",       // we computed it, or a source states it
  "detail": "In our tracker sample, X is the second key-compromise drain in eight weeks ...",
  "sourceIds": ["src-tracker"],
  "sceneIds": ["s04"],                    // optional: the scene(s) that present it
  "method": "Filtered the stored tracker rows ... counted 2"   // optional; recommended for own-data
}],
"news": {
  "format": "daily-short" | "what-we-know" | "weekly-roundup" | "explainer",
  "developing": {"label": "DEVELOPING", "asOf": "2026-11-24T08:00:00Z"},   // or true, or "DEVELOPING"
  "incidentIds": ["inc-..."]
}
```

These live here, not in `src/episode/types.ts`, because that file belongs to the episode builder. The episode validator ignores unknown top-level fields, so a news storyboard still renders.

## Rules

Every finding has a rule, a code (`R1.number-not-in-excerpt`), a place (scene, surface, text) and a fix. Errors fail the gate; warnings and notes do not.

| Rule | Checks | Typical fix |
| --- | --- | --- |
| **INPUT** | Files readable; storyboard version 1, scenes, valid `{display\|spoken}` / `[src:id]` markup; `fiction: false`; brief well formed. | Fix the file. |
| **R1** facts | Every `[src:id]` claim matches a brief fact citing that source, and its **numbers, names and quotes are in the stored excerpt** of the cited source. Numbers are normalised (`$1.5M` = `1,500,000` = `1.5 million` = "one point five million dollars"); a qualifier ("about", "more than", "nearly") allows honest rounding, an unqualified rounding or an averaged figure fails. Dates match the excerpt or the source/incident date. Also: numbers in untagged sentences, titles, labels and thumbnails must be verified figures (or own-data analysis figures); the spoken side must say the number shown; sources must be in the brief, `verified`, and not on X/Telegram (unreachable here, so never reconstructed); the radar's own fact text must agree with its excerpt. **Tier C and listings:** an incident database's listing of another outlet's report (`listedReport`, the AI Incident Database) is never cited (`R1.listed-report`, also as `rekt.source` or `onScreen.source`), and when a tier-A/B source is cited, a claim's figures, names, quotes and wording must be in that source's own excerpt: a co-cited tier-C or listed excerpt never carries them (`R1.tier-c-only`). Hedges are read from every cited source. | Use the excerpt's figure or wording, cite the right source, or cut the claim. |
| **R2** developing | If a cited incident is developing: a visible DEVELOPING label (`news.developing`, or "DEVELOPING" in an on-screen title/bullet at or before the first developing claim) and the narration says "developing" before that claim. Each Short carrying a developing claim needs both again. | Add the label and the line "This is a developing story." |
| **R3** attribution | Accusations ("hacked by", "stole", "insider", "rug pull", "fraud", state actors, threat-group names) always need a named source; causes (hack, exploit, drain, compromise, phishing, malware, prompt injection, deepfake...) need one when the sentence is about a specific case; **loss amounts are always "reported by X"**. The name must be the cited source's publisher or an organisation its excerpt names ("according to X", "X says", "X's post-mortem says", "as listed by X", "It says" after an attributed sentence). Titles and thumbnails never accuse. | "According to <source>, ..." or cut it. |
| **R4** names | No personal names: two-word capitalised names, names after a role or title, appositions ("X, the founder"), ages, handles, given names, the radar's `[named person]` placeholder, blocked handles, and unknown capitalised words no source names. A one-word product name that is also a personal name (`ambiguousNames`: Claude, Codex) is known only without a person cue next to it ("Security researcher Claude", "Claude, 34,", "Codex said he ...", "Ernest Claude" are names). Chinese, Japanese or Korean script on any surface is refused (`R4.cjk-text`), and so is a storyboard source whose title carries a placeholder or handle, or whose link spells a given name and a surname (`R4.url-name`: use the brief's withheld form). An incident name the radar read only from a headline's shape (`nameKnown: false`) is not allowlisted for the run. **Officials** may be named only if they are in `allowlist.json` `officials` **and** a cited law-enforcement or regulator source names them. | Describe the role ("the exchange's CEO"). Add organisations to the allowlist. |
| **R5** how-to | No code spans, hex/addresses/selectors, function calls or code identifiers, payload/calldata/bytecode/PoC talk, shell commands, "how to bypass/exploit/...", prompt-injection or jailbreak strings, or a sequence of attack steps (narration or on-screen lists). AI stories: text addressed to an AI (`R5.ai-addressed`), a jailbreak instruction ("pretend you ...", "no rules": `R5.roleplay-instruction`), what an attack told the agent to do (`R5.told-the-agent`), and the setting that got past a safeguard ("don't ask again", auto-approve: `R5.bypass-setting`, except in a defensive frame such as "keep auto-run off"), quoted or paraphrased, even word for word from an excerpt. Characters that render as nothing anywhere in the storyboard fail (`R5.hidden-characters`). Defensive checklists are fine. | Explain the mechanism at concept level in one or two sentences. |
| **R6** speculation | No "probably", "likely", "rumor", "insiders say", "must have been", "allegedly" without a named source, question headlines about causes. A hedge passes only when the sentence is attributed and the cited excerpt itself uses the word. | State only what the sources confirm. |
| **R7** analysis | At least one `analysis` element, presented in a scene, that adds something (not a restated fact); a source-based pattern or comparison cites 2+ sources; source-based figures are in the excerpts; weekly round-ups include a fund-flow analysis; **every Short includes an analysis scene** ("don't publish daily unless each video adds real analysis"). | Add own-data analysis and show it. |
| **R8** corrections | `corrections.json` is valid; corrections for this episode or its incident produce the pinned comment `Correction (<YYYY-MM-DD>): ...`; a corrected claim is never repeated (even if a stale excerpt still supports it); correction texts follow the same rules; pending ones are flagged to pin. | Pin the comment; use the corrected fact. |
| **R9** price | No prices, price moves, market talk, buy/sell/hold advice, investment talk, income or return claims, or wallet/promo calls to action ("connect your wallet", "claim your airdrop"); chart scenes are refused because the chart template draws price/market-cap candles. Allowed: "price oracle manipulation", "never share your seed phrase", "not financial advice", a quoted scam message. | Cover the security story, not the market. |
| **R10** others' material | No screenshots, redrawn charts, "<X>'s chart/image", media credited to others, or `onScreen.image/screenshot/tweet/logo/...` keys (owner rule: "don't redraw ... others' material"). | Describe the finding and attribute it. |
| **GEN** | The general claim gate (`scripts/claims`): passed, failed, not found or skipped. | See its own report. |

The checks are English-first heuristics. They are built to fail closed: an unknown capitalised name, status word or excerpt mismatch blocks rather than passes. The owner's review stays the final step.

## Allowlist (`allowlist.json`)

Lists: `show`, `publishers`, `securityFirms`, `organisations`, `protocols`, `chains`, `agencies` (agencies and courts), `places`, `terms` (tickers and acronyms), `attributedGroups` (threat groups: R3 requires an attribution wherever one is named), `blocked` (handles and nicknames of individuals, always flagged; listing implies nothing about anyone), `aliases` (spellings that count as the same name, e.g. FBI / Federal Bureau of Investigation), optional `tickers`, and `officials`. The brief's incident names, publishers and organisation entities are added automatically for each run.

AI products and companies are organisations here (Claude, Claude Code, Claude Opus, Gemini, Gemini CLI, Copilot, Copilot Studio, ChatGPT, Codex, Grok, Llama, OpenRouter...), so R4 never reads them as unknown personal names in the AI-security lane, while a person next to them ("Claude Dupont said", a researcher's name or handle) is still refused (`tests/ai-names.test.ts`). Product names that are also common given names or surnames are listed only in multi-word forms ("Google Gemma", "AWS Kiro", "Kiro IDE", "Cline extension", "Google Veo", "Cisco Talos"); the one-word ones the gate keeps are in `ambiguousNames`, where person cues still apply (`tests/review-fixes.test.ts`). The radar also reads this file to accept an AI incident's subject as an organisation, and warns (and reads AI subjects as known products only) when it is missing.

Officials (empty by default): add one only from a law-enforcement or regulator release, for example

```json
{"name": "Full Name", "role": "U.S. Attorney", "agency": "U.S. Attorney's Office, SDNY", "sourceUrl": "https://www.justice.gov/...", "addedOn": "YYYY-MM-DD"}
```

and cite that release in the episode (brief source `kind: "law-enforcement"` or `"regulator"`). Never add a private individual to any list.

## Corrections

```bash
node scripts/news/corrections.ts add --slug <slug> --correct "FixtureSwap says the loss was $4.2 million, according to Example Wire." \
     --source src-wire [--wrong "FixtureSwap lost $4.8 million"] [--timestamp 00:07] [--incident <id>]
node scripts/news/corrections.ts pinned <id>         # copy this into the pinned comment on the video and its Shorts
node scripts/news/corrections.ts mark-pinned <id>    # after pinning
node scripts/news/corrections.ts list | check
```

The date defaults to the owner's calendar day in **America/Chicago**. `add` refuses a corrected text that names a person, speculates or talks price. The pinned comment leaves out the old wording if it breaks a rule.

## General claim gate (`scripts/claims`)

When `scripts/claims/check.ts` exists, the gate runs it the way its `--help` says (read 2026-11-24): `node scripts/claims/check.ts <the storyboard's folder> --out-dir <this gate's --out> --names data/private/names.txt`, or `--no-names` when that gitignored list is not on the machine (a fresh cloud checkout never has it; the result's note says so, and R4 still refuses every unknown personal name). The language is the storyboard's own. Other entry points (`{gate,cli,index,run,main,claims}.ts` with node, `{gate,check,cli,run,main,claims}.py` / `__main__.py` with python3) get one argument, `zoora-security/<slug>`. Runs are from the video-studio folder, with a 180 s timeout. Exit 0 = passed; anything else fails the news gate (its output tail is in the report). `NEWS_GENERAL_GATE_CMD` overrides discovery with a JSON argv, e.g. `["node","scripts/claims/check.ts","{storyboard}"]` (placeholders `{channel} {slug} {storyboard} {brief} {root}`). `--general-gate require` makes a missing general gate an error; `off` skips it. A run started by another gate sets `NEWS_GATE_PARENT` so the two never call each other in a loop.

## Files

| Path | What |
| --- | --- |
| `gate.ts`, `corrections.ts` | CLIs (thin entry points; they hide Node's `MODULE_TYPELESS_PACKAGE_JSON` warning for `src/episode/markup.ts`) |
| `lib/run.ts` | Reads the files, runs the rules and the general gate, writes the reports |
| `lib/rules.ts` | The rules R1-R10 |
| `lib/context.ts` | Text units, evidence per cited source, attribution resolution, analysis presentation |
| `lib/claims.ts` | Sentences and claims, using the episode engine's markup parser |
| `lib/numbers.ts`, `lib/names.ts`, `lib/attribution.ts`, `lib/lexicon.ts`, `lib/text.ts` | Number normalisation, name scanning, attribution phrases, rule lexicons, text helpers |
| `lib/brief.ts`, `lib/corrections.ts`, `lib/allowlist.ts`, `lib/general-gate.ts` | Input readers and the scripts/claims adapter |
| `lib/report.ts`, `lib/types.ts` | The Markdown report and the contracts |
| `fixtures/` | A passing fixture, one deliberately bad storyboard per rule (25 cases, `cases.json`), built by `build-fixtures.ts`; all fictional, on reserved example domains |
| `tests/` | node:test suites (numbers, text/names/attribution, adapters and CLIs, rule behaviour, every fixture) |

Rebuild the fixtures after changing the passing one: `node scripts/news/fixtures/build-fixtures.ts` (the tests fail if they are stale).

## Known gaps

- The episode renderer (`src/episode`) does not draw `news.developing` yet; until it does, the gate warns and wants "DEVELOPING" in the first scene's title as well.
- The general gate's interface is a guess (`<channel>/<slug>`); see `NEWS_GENERAL_GATE_CMD`.
- Spoken-number checks and the lexicons are English. Other languages get the structural checks (sources, numbers, names, labels with the language's word for "developing" where known).
- Name detection is heuristic. It errs towards flagging; the fix is an allowlist entry for organisations, never for people.
