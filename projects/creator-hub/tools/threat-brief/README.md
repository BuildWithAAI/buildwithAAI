# Daily Threat Brief (email)

Step 4 of the channel-2 pipeline (video-studio `CLAUDE.md`, "Channel 2"): a short daily email. There are two ways to build it:

- **After the owner approves the day's episode** (the daily pipeline's call, `--input`): the email is built only from the approved text the approval packet showed, never from the radar. See "Daily pipeline" below.
- **By hand from the radar** (`draft`): a round-up of the radar's top incidents, described below. The owner reviews it in Kit before sending.

The radar brief covers:

- today's top incidents, each with:
  - its status (CONFIRMED or DEVELOPING);
  - every reported loss figure, credited to the source that reported it;
  - a one-line, concept-level "how it worked";
  - its sources;
- the radar's corrections;
- Zoo's One Fix;
- the show link;
- why the reader is getting the email.

It writes a draft. **Nothing is ever sent.** With `--kit-draft` it also creates a Kit broadcast DRAFT, which the owner reviews and sends from Kit.

```sh
cd projects/creator-hub
node tools/threat-brief/cli.ts draft --radar ../video-studio/content/zoora-security/radar/2026-11-24.json \
     --show ../video-studio/out/daily/2026-11-24-binance/publish/kit.json --youtube-id <id>
node tools/threat-brief/cli.ts lint out/threat-brief/2026-11-24.md     # re-check after editing by hand
node --test tools/threat-brief/*.test.ts
```

`draft` writes `out/threat-brief/<date>.md`, Markdown with `subject` and `preview` front matter for review and editing. It also writes `out/threat-brief/<date>.html`, email-safe HTML: 600 px wide and fluid on phones, inline styles only, and no scripts, `<style>`, images, web fonts or tracking. Both files are written only when the lint passes. `out/` is gitignored.

| Option | Meaning |
| --- | --- |
| `--radar <file>` | The radar's daily file (`zoora-security/radar@1`). Required. |
| `--show <kit.json>` | Today's episode (its publish kit). Supplies the title, the YouTube link and the One Fix. Without it, the brief says "No new episode today." |
| `--youtube-id <id>` | The video's id when the kit does not have it yet. Without an id the draft shows a placeholder, which blocks `--kit-draft`. |
| `--fix <text>` | Zoo's One Fix. The default is the show's (from the kit summary's "Zoo's one fix: …"), else the fix for the top incident's explainer topic (`concepts.ts`). |
| `--count <n>` | Number of incidents, 1-5 (default 3). |
| `--out <dir>` | Output folder (default `out/threat-brief`). |
| `--allowlist <file>` | Names that are not people. Default: the news gate's `../video-studio/scripts/news/allowlist.json`. |
| `--brand <name>` | Show name (default "The Zoo & Badger Show", while channel 2's display name is undecided). |
| `--kit-draft` | Also create a Kit broadcast DRAFT. Needs `KIT_API_KEY`, and the recipients: `THREAT_BRIEF_KIT_FILTER=tag:<id>` (the tag of the Threat Brief sign-up) or `--all-subscribers`. `send_at` is always null. |
| `--new-draft` | With `--kit-draft`: create another draft even though one exists for this date. |
| `--ledger <file>` | Kit-draft ledger, relative to where you run the command (default `data/threat-brief/ledger.json`, gitignored). `THREAT_BRIEF_LEDGER` overrides the default and is relative to `projects/creator-hub`, so the daily's call (run from `video-studio`) and a manual run share one ledger. It prevents a second draft for the same date. |

Exit codes: `0` ok, `1` problems found (nothing written, or the Kit draft was not created), `2` usage error.

## How each line is built (accuracy rules)

- **Incidents**: the radar's `top` (then `alsoSeen`), in the radar's score order. The heading is the radar's own safety-checked title. The radar has two lanes (crypto and AI security): when the first `--count` incidents miss one lane and the radar has an incident in it, the last place goes to that lane's best incident that stands alone (`pickIncidents`: at least one tier-A or tier-B source that is not a listing), so an AI story is never lost behind crypto ones while an aggregator-only or listing-only incident never displaces a better-sourced one. After such a swap the preview and intro say "the top 2 incidents ... plus the radar's top AI-security incident", never "the top 3". An incident only an incident database lists is left out. AI types have their own labels and One Fix topics (`ai-security`, `ai-scams`, `ai-attacks`, `ai-washing` in `concepts.ts`); the radar's "fraud" labels are shown as "deepfake or voice-clone scam" and "AI-washing case" (an unattributed "fraud" is an accusation the lint refuses). An AI incident whose subject the radar read only from a headline's shape (`subjectKnown: false`) is named by its type and outlet ("data exposure through an AI tool, reported by X"), never by that word, which is not allowlisted.
- **Listings and blogs**: an AI Incident Database listing (`listedReport`) is never a source line, a "First reported" date or a figure (its title and link are another outlet's; its date is when the database added it); tier-C dates never set "First reported". A single researcher's blog (`confirmsAlone: false`) counts as one outlet's vote, never as a tier-A confirmation. A source whose link the radar withheld (it names a person) is labelled as the outlet's address.
- **When**: the incident date as a database states it ("When (per DefiLlama)"), else "First reported" with the day the first linked source was published. Chains appear only as a database lists them ("Chains (per DefiLlama)").
- **Status**: re-checked against every tier-A and tier-B source's title and stored excerpt, not only the radar's own hedge flag. A source whose text hedges ("suspected", "apparent", "possible", "may have", "under investigation", ...) never counts as reporting it "without hedging". The hedges about the incident itself are quoted with their source: "Confirmed: DefiLlama reports it without hedging. Still hedged in the sources: “suspected compromise of the aggregate signing key”, per SlowMist; “suspected key theft”, per The Defiant." A hedge about something else (where funds went next) is not quoted, but its source still does not count as unhedged. When no tier-A source, and no two tier-B outlets, are left without a hedge, a radar "confirmed" incident is shown as DEVELOPING (never the other way round). Developing incidents carry a DEVELOPING pill, a "DEVELOPING ·" heading and "details may change". The subject line counts them.
- **Reported loss**: each figure appears as its source wrote it (taken from the radar's stored quote), links to that source and says "reported by <publisher>". Rules:
  - tier A first, then B, then C, at most 4 figures;
  - a figure whose quote does not match the radar's number is left out;
  - when sources disagree, the brief says so and **never averages**.
- **How it worked**: concept level only.
  - First choice: the source's own classification, quoted and attributed ("DefiLlama classifies it as “Key Compromise / Validator Key Compromised”"), plus a database's attack-method label if it adds something. Then the definition of that source's category, worded as the source's category: "DefiLlama's category “Key Compromise” covers cases where someone other than the rightful holder gained control of a key that can approve transactions." (`concepts.ts`). A definition never says how the incident worked and adds no cause or consequence: the sources can disagree with a category (for Chainflip, DefiLlama's own text describes an exploited vulnerability in a signing system).
  - If the heading names a mechanism the classification does not, a quoted headline that supports it is added.
  - With no classification, the brief uses the first safe headline that names a mechanism, quoted with its publisher.
  - Otherwise: "The sources have not described how it happened yet."
- **Sources**: one per publisher, https only, no newsletter round-ups, at most 4. A headline is quoted ("Publisher: “…”") only when it passes the safety rules. Otherwise the link is labelled "Publisher article, date". That catches a personal name, an unknown capitalised word that may be a surname the radar's redaction missed, price talk, or a how-to.
- **Corrections**: the radar's `corrections` (status, type or figure changes since an earlier run) in plain words. Corrections already published for today's episode come first.
- **Footer**: why the reader gets the email, the safety line ("never DMs you first…") and "Not financial advice". Kit adds the unsubscribe link and the postal address.

## The lint (news gate, scaled down)

`safety.ts` mirrors the news claim gate (`video-studio/scripts/news/lib/lexicon.ts` and `names.ts`, 2026-11-24) for short text. The announcer uses the same file.

| Rule | Blocks |
| --- | --- |
| names (R4) | The radar's `[named person]` and `[non-English text]` placeholders, @handles, the gate's blocked nicknames, given name + surname, a name after a role, title or kinship word in any case (a Title Case headline capitalises the role: "Victim Kiro Loses ...", "Researcher Sora Finds ...", "Hacker ‘Sora’ ..."; only a listed verb or noun after the role, such as "Victim Loses" or "Hacker Group", is not a name, so an unlisted one costs the quote, never a leak), a speaker who refers to himself or herself ("Claude said he lost ...", "Kevin Says He ..."), "X, the founder", ages, for names that start with any capital letter ("José", "Łukasz", "Сергей"). An unknown capitalised word in a sentence-case line is a warning (it may be a surname). A multi-word allowlist name is allowed only as the whole phrase ("OpenAI Sora" never makes a lone "Sora" known), and one-word product names that are also personal names (Claude, Sora, Jules, Kiro, Cline, Gemma, Veo, Devin, Manus, Reg, plus the gate's `ambiguousNames`) never shield a person next to a role word or an apposition and are never known inside a quoted headline. A headline with Chinese, Japanese or Korean script is never quoted. |
| how-to (R5) | Code spans, hex or base58 addresses, function calls, snake_case identifiers, contract-code terms, shell commands, payload or proof-of-concept talk, "how to bypass/exploit…", prompt-injection strings, the radar's `[code]` placeholder, and attack sequences ("first… then…" with attack verbs). Also text addressed to an AI, a jailbreak instruction ("pretend you ...", "you are now ..."), what an attack told the agent to do (the AI described or named by product: "told the coding agent to ...", "told Copilot to upload ..."), quoted words that instruct an AI whoever is quoted (an override such as "ignore your rules", or an imperative that moves secrets or data somewhere: `ai-quoted-instruction`), and the radar's `[instruction]` placeholder. A user's own request ("asked the assistant to summarize the page") and defensive advice are fine. |
| attribution (R3) | Accusations (stole, rug pull, fraud, state actors, threat groups from the allowlist) without a named source; a loss figure without "reported by" (one per figure) or another attribution; averaged or combined figures. |
| speculation (R6) | probably, likely, rumours, "may have been", "allegedly", unless quoted from a named source. |
| price (R9) | Price, price moves, market talk, investment talk, buy or sell calls, ROI/APY, wallet calls to action, and every income claim in the hub's shared `src/claims.ts`. |
| placeholders | TODO, `example.com`, `[show link …]`, and Kit/Liquid braces. |
| structure | A label on every incident (and in the HTML), a source for every figure and incident, Zoo's One Fix, the "You're getting this" footer, https links only, and email-safe HTML. |

Every field is checked on its own, and then the whole rendered body (the Markdown and the email's visible text) goes through the same rules, so a rule that only fires on the joined text still blocks the files and the Kit draft. The checks are heuristics that fail closed. The owner still reviews the draft before sending it from Kit.

## Kit (optional draft)

This reuses the newsletter's client (`../newsletter/kit-api.ts`): `POST https://api.kit.com/v4/broadcasts` with `send_at: null` and `public: false`, which creates a draft, never a send ([docs](https://developers.kit.com/api-reference/broadcasts/create-a-broadcast)). The recipients come from `THREAT_BRIEF_KIT_FILTER`. This is deliberately not the newsletter's `KIT_SUBSCRIBER_FILTER`: the daily brief goes only to people who asked for it.

The ledger records each draft, write-ahead. Only a refusal from Kit (an HTTP status from 300 to 499) is recorded as `failed` and may be retried. Everything else is recorded as `pending`, because a draft may exist: no answer, a 5xx, or a 2xx answer that cannot be confirmed (the body breaks off, there is no broadcast id, or Kit reports the broadcast as scheduled). The report then says "NOT CONFIRMED ... A draft may exist": check Kit's broadcasts before running again with `--new-draft`. A malformed `KIT_API_KEY` is refused before anything is recorded. api.kit.com could not be reached from the build machine, so this path has only been tested against a mocked `fetch`.

## Daily pipeline

`video-studio/scripts/daily/lib/postapproval.ts` calls `node tools/threat-brief/cli.ts --input <post-input.json> --out <dir> [--dry-run]` after the owner's APPROVE. This tool accepts that call, and the email it builds (`daily.ts`) is the approved one. The CLI's entry check compares real paths, so it also runs when launched through a symlinked path (a symlinked checkout, macOS's `/tmp`); it used to exit 0 having done nothing there. The daily launches it by its real path and treats an exit 0 with no "wrote" line and no new file as a failure (`hub-failed`), and prepare's radar draft counts as written only when `<date>.md` and `<date>.html` exist and are fresh. Every text the tool reads is stripped of characters that render as nothing (hidden instructions):

- **Only the approved PostInput is used**: the title, "What we know" (each fact with its sources), "Our analysis", Zoo's One Fix, the corrections, "Also on the radar" (name, status and links only) and the sources, in the approval packet's order. The radar file is never read, so the email cannot carry an incident, a figure, a status or an explanation the owner did not see.
- Every field goes through the rules again, then the rendered body. An unsafe fact, analysis line, fix, correction or title blocks the brief (nothing is written). An unsafe "also on the radar" name is left out with a note, and a headline that fails the rules is replaced by its publisher's name. Everything is escaped, Kit's `{{ }}` and `{% %}` included.
- `<date>.md` and `<date>.html` are written to `--out`, with the input's sha256 in the front matter.
- Without `--dry-run`, a Kit DRAFT is created when `KIT_API_KEY` is set (with no key it is skipped), and only when:
  - the brief is final: at least one approved fact and the video link (the daily passes the id on after the manual upload is recorded);
  - the owner's daily content approval covers this exact email: `content/zoora-security/<slug>/approval.json` under `--studio-root` (default `../video-studio`), or `--approval <file>`, approves the same slug and title, the DEVELOPING label if it was a developing story, the recorded video id, and a storyboard unchanged since approval (`../announcer/approval.ts`);
  - the recipients are chosen (`THREAT_BRIEF_KIT_FILTER` or `--all-subscribers`).
- The draft's description and the ledger name the approval's version hash and the input's sha256, and the ledger stores the sha256 of exactly the content sent to Kit.

## Fixtures and tests

`fixtures/` holds an invented radar file (all hosts on reserved `.test` domains). It covers:

- a confirmed incident with figures from three tiers, a mismatched quote, a newsletter round-up, an http link and a headline naming a person;
- a developing incident;
- an incident whose only mechanism headline talks price;
- one without a stated mechanism;
- malformed entries;
- radar corrections.

There is also a show kit, a daily `PostInput` and a small allowlist. The suites cover the rules (`safety.test.ts`), the reader, builder, hedges, renderers and lint (`brief.test.ts`), and the CLI (`cli.test.ts`): the Kit draft and its ledger states with a mocked `fetch`, and the daily call with approval records built in a temporary stand-in for `video-studio`.
