# Claim gate (`scripts/claims`)

Every script runs through this gate before voice and render. One bad video can take down every channel, so it fails
on anything that could be an unsourced fact, a banned phrase, an income claim, a private name or a real wallet.
Built 2026-11-24. TypeScript run directly by Node 22 (type stripping); no dependencies.

## Commands (run from `projects/video-studio/`)

| What | Command |
| --- | --- |
| One episode, its master language | `node scripts/claims/check.ts content/<channel>/<slug>` |
| One translation | `node scripts/claims/check.ts content/<channel>/<slug> --lang es` |
| Every storyboard and language (CI, pre-render) | `node scripts/claims/check.ts --all` |
| Tests | `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/claims/tests/claims.test.ts` |

Options: `--names <file>` / `--no-names`, `--research <file>`, `--offers <file>`, `--out-dir <dir>`,
`--today YYYY-MM-DD`, `--json`, `-q`. Exit codes: **0** pass, **1** the gate failed, **2** bad input (usage, missing
files, bad JSON, unsupported language; `fr` is refused: Kokoro has no male French voice).

**Private names (2026-11-24):** without a names list the gate FAILS (`no-names-list`): the owner creates
`data/private/names.txt` (gitignored) with the real names and handles behind every `[named person]` in the research
files. A run that cannot have the list (CI) passes `--no-names` explicitly; the report, the PASS/FAIL line and the
`--all` summary then say "names NOT checked". Every summary line also shows a translation's review status.

The report goes to `out/claims/<slug>.<lang>.md` (and `.json`, gitignored). Every failure names the scene, the
sentence as written in the storyboard, and a fix. It also lists every cited claim with its sources, every source,
every waiver (for the owner's review), and the research rules the gate could not turn into patterns.

## What fails the gate

| Rule | Fails when |
| --- | --- |
| `unsourced-claim` | A narration sentence looks factual and has no `[src:id]`. Factual = digits, %, money (signs or words), numbers in words (thousand, million, half of, one in ten), dates, superlatives in context (the largest, was the first, the only X, most tokens), attributions (according to, reportedly, researchers found), or a named organisation (SEC, Chainalysis, Bubblemaps, Pump.fun, Binance, OpenAI... see `lib/lexicon.ts` `ORGS`). |
| `unknown-source` | `[src:id]` has no entry in `storyboard.sources`. |
| `quote-unsourced` | A quote scene has no `[src:id]` and its attribution/source line does not say it is fictional ("(fictional composite)"). |
| `source-unverified`, `source-status`, `source-not-https`, `source-no-accessed`, `source-accessed-future` | A source is unverified, not `https`, has no (or a future) `accessed` date. Older than 180 days warns. |
| `must-not-say` | A phrase or figure from the episode's `research.md` "Must not say" section (see below). |
| `income-claim` | Guaranteed / risk-free / get rich / passive income / can't lose / 10x-and-up multiples / "financial advice" framings / buy calls / price predictions / easy money, in the storyboard's language (en, es, pt-br, hi, it, zh; ja partial). Negations pass: "This is not financial advice", "Nothing is risk-free". |
| `private-name` | A name from `data/private/names.txt` (gitignored; one name or `@handle` per line, `#` comments). Never printed: reports say "private name #N". |
| `wallet-address` | EVM addresses and hashes, base58 (Solana, Bitcoin, Tron) addresses and signatures, bech32, shortened forms (`7xKX…gAsU`). Also in source URLs (the repo is public). Never printed. |
| `referral-link` | Telegram/Discord invites or referral parameters in on-screen text or narration. |
| `no-fiction-disclaimer` | `fiction: true` and neither the fiction card (`ui.fictionDisclaimer`, English default for `en`) nor any scene says the story is fictional. |
| `disclosure-not-spoken`, `no-spoken-disclosure` | `offers` is set and the narration does not SAY the disclosure (display-only `{text\|}` markup does not count). The relationship comes from creator-hub's offer registry (affiliate, own product, sponsor). |
| `tags-differ` | A translation's scene cites different `[src:id]` tags than the source scene. |
| `no-names-list` | No `data/private/names.txt` and no `--no-names` (added 2026-11-24). |
| `persona` | Zoo presented as a human financial adviser or expert, in any language (YouTube AI-persona policy). "I'm not a financial adviser" passes. |
| `holdings-disclosure`, `holdings-mismatch` | An opinion on a named token ("this coin is undervalued"), or holding one, without a spoken holdings disclosure (MiCA Art. 91); `holdings: "none"` contradicting "I hold ...". |
| `onscreen-unsourced`, `onscreen-figure-uncited` | An on-screen figure in a scene that cites nothing; in a citing scene, an on-screen figure no cited sentence of that scene says (digits or words: "90 days" is backed by "Ninety days later"). |
| `title-unsourced` | The title, a Short title or a thumbnail makes a figure or superlative claim no cited sentence makes. A figure may round a cited one at its own written precision (capped at 6%: "69%" or "nearly 70%" for 68.67%) but never move it ("73%" for 69% fails), and a percentage needs a cited percentage ("90%" is not "ninety days"); the same matching applies to on-screen figures. |
| `disclosure-negated`, `disclosure-relationship` | A "disclosure" that denies the relationship ("not sponsored, no commission"); a translation that does not name the same relationship as the master. |
| `dub-offers` | A translation carries offers (until a geo-aware link router exists; `dubOffersWaiver` records the owner's decision for non-exchange offers) or any exchange/token offer or token promotion (never in a dub). |
| `mica-statement` | es/it token promotion without the MiCA Art. 7(1)(e) statement, spoken and on screen. |
| `asci-disclaimer`, `asci-ai-persona`, `asci-banned-word`, `asci-fiu-ind` | hi promotion featuring crypto: the ASCI disclaimer in the last scene (and the first, 6+ scenes), "animated character, AI voice", no currency/securities/custodian/depositories, FIU-IND-registered exchanges only. |
| `dub-translation-record`, `dub-numbers`, `dub-spoken-numbers`, `dub-claim-tags` | A translation fails the dub validator's record, number or tag checks (scripts/dub), so this one report covers them. |
| `dub-structure` | A translation does not carry the master's `offers`, `fiction`, `tokenPromotion` or `holdings` (added 2026-11-24). The offer, fiction, MiCA and ASCI rules then use the master's values, so dropping them never skips a rule. |
| `no-research`, `no-must-not-say` | The episode has no `research.md`, or it has no "Must not say" section (`- (none)` is fine). |

Warnings (never fail): on-screen text that looks factual (no figure) in a scene that cites nothing, short (one or
two word) must-not-say phrases, unquoted figures in a prohibition, stale or quote-less sources, unused sources or
waivers, negated income phrases (`income-negated`: listed so a person checks the negation covers them),
`names-not-checked`, and `must-not-say-language` (a translation: see below).

**Negation (2026-11-24):** a negation counts only inside its own clause: the window stops at , ; : and at "but / pero
/ mas / però / ma / लेकिन / 但", and never reaches back past another rule's hit. "Not financial advice, buy now.",
"No es consejo financiero, compra ahora." and "Nadie pierde aquí, ganancias garantizadas." fail; "not financial
advice" is never a shield (research §4.9). Disclosure and fiction wording is negation-checked the same way, and only
the fiction card or the OPENING scene counts as the fiction notice.

**Translations (2026-11-24):** the research "Must not say" phrases are English, so in a translation they match only
figures, handles and names: every rule is listed in the report for a human read (`must-not-say-language`). Add a
`## Must not say (<lang>)` section to research.md with the bans in that language; the gate matches it. When
`dub/backtranslation.<lang>.json` exists (scripts/backtranslate), its English is scanned with the English list and
income lexicon (stale items are skipped and counted).

## The research "Must not say" section

The research agents write bullets for people; the parser reads them like an editor:
- Quoted phrases in a prohibition are banned (`'Pump.fun is a scam'`, `"..."`, `‘...’`, `` `...` ``). Apostrophes
  inside words do not end a quote.
- `'A / B / C'` are alternatives (`'Pump.fun is a scam / rigged casino'` also bans "Pump.fun is a rigged casino");
  `scams/fraud` expands the same way; leading/trailing `...` is dropped; `[named person]` matches any 1-4 words.
- `'Graduated' or 'LP burned' means safe` bans "Graduated means safe" and "LP burned means safe".
- A parenthesis that only lists figures bans each one: `($9.99M, 777 calls, 73%, 9q8zt)`.
- Instructions are not bans: `Use 'over $2 billion'`, `(say 'alleged' or 'estimated')`, and explanations after the
  prohibition are skipped.
- Phrases of 3+ words, or with a figure, handle or proper noun, are errors; 1-2 plain words are warnings.
- Bullets with nothing quotable ("Any how-to: ...") are listed in the report under "rules the gate cannot fully
  check" so a person reads them against the script.

## Waivers (`claimWaivers`, a recorded contract addition)

Some sentences only look factual ("You copy a caller on Pump.fun.", "Ten thousand strangers buy your coin."), and
some income words are a warning, not a promise ("Scammers promise guaranteed returns."). Mark them in the scene:

```json
"claimWaivers": [
  {"match": "You copy a caller on Pump.fun", "rule": "factual", "reason": "story action, not a claim about the platform"},
  {"match": "Scammers promise guaranteed returns", "rule": "income", "reason": "describes a scam pitch as a warning"}
]
```

`match` is copied from the narration or on-screen text in that file's language (dubbing translates it). A factual
waiver covers the sentence that contains it; an income waiver covers the hit inside it. Waivers never cover
attributions ("according to"), research must-not-say phrases, private names or wallets. Every waiver is listed in
the report for the owner; unused ones warn.

## Contract additions (`src/episode/types.ts`, optional)

| Field | Meaning |
| --- | --- |
| `StoryboardScene.claimWaivers` | `Array<{match, rule: 'factual' \| 'income', reason}>` (above). |
| `Storyboard.translation.method`, `.reviewed` | Recorded by the dubbing tools (see `scripts/dub/README.md`). |
| `Storyboard.holdings` (2026-11-24) | `'none' \| string[]`: what the host holds of the tokens discussed (MiCA Art. 91). Read by the gate only. |
| `Storyboard.tokenPromotion` (2026-11-24) | `true` when the video promotes a token: MiCA Art. 7 statement in es/it; never in a dub. Read by the gate only. |
| `Storyboard.dubOffersWaiver` (2026-11-24) | In `storyboard.<lang>.json` only: `{reason, approvedBy, date}`, the owner's geo-routing decision for a dub's non-exchange offers. Read by the gate only. |

These three are not yet typed in `src/episode/types.ts` (another workflow owns it); the engine ignores them. Offer
registry entries may carry `category` (`exchange`, `token`, ...) and `fiuIndRegistered: true` (India).

## Known limits

- Detection is lexical. It cannot read meaning: a factual claim with no number, date, superlative, attribution or
  known organisation passes ("The platform pays callers to dump on you" is caught only through the research list).
  The owner's review of the claim map stays necessary.
- The organisation list is curated (`ORGS`); add names as channels need them. Org mentions in story action need a
  waiver, by design.
- Non-English lexicons (es, pt-br, hi, it, zh) are machine-made and need a native speaker's review like every
  translation; the Japanese lexicon is partial. Every non-English report says so.
- The official es/it MiCA Art. 7 wording and any Hindi ASCI text were not read here (EUR-Lex and ascionline.in are
  blocked): those rules look for key clauses and need legal review of the exact text.
- Title and thumbnail claims are matched to cited sentences by figure values and shared content words, not meaning.
- Spelled-out numbers in non-English text ("diez mil") are caught through the scale words only.
