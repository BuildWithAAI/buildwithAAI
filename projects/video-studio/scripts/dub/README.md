# Dubbing tools (`scripts/dub`)

Turns an episode's master storyboard into `storyboard.<lang>.json`. Built 2026-11-24. TypeScript run directly by
Node 22; no dependencies; no translation API (an agent in the workflow or a person translates).

**Two ways to publish a dub; the owner chooses per video and language** (corrected 2026-11-24 after review):

| Mode | Voice step | What the viewer sees | Lip-sync |
| --- | --- | --- | --- |
| **Native upload** (a localized video or channel) | `build.py --lang es` (its own timing) | Its own render: Spanish on-screen text, captions, UI labels, Zoo's mouth from the Spanish audio | Yes |
| **Audio track** (YouTube multi-language audio on the master video) | `build.py --lang es --fit-to en` | The **English** picture: English on-screen text, chart labels and fiction/disclosure cards, and Zoo's **English** mouth shapes | No: only talking vs. pauses line up |

An audio-track dub is fitted **sentence by sentence**: each sentence is synthesized at the Kokoro speed (0.85-1.15)
that makes it as long as the English sentence, and starts where the English sentence starts, so Zoo talks while the
dub talks and pauses where it pauses (docs/research/dubbing-and-regions-2026-11-24.md §1.11). A sentence still longer
than its English sentence at 1.15 is placed where its excess shows least against Zoo's English mouth (into a short
pause rather than past a phrase end) and is reported, with the % to cut, even when the scene fits; a translation with a
different number of sentences falls back to the scene-level fit, with a warning. Write audio-track translations to
length: measured on the engine demo, a natural Spanish translation overflows 6 of 7 scenes, a length-aware one fits. The voice step refuses `--fit-to` for a storyboard with
offers or `fiction: true` unless the dub itself SAYS the disclosure and the fiction notice in its language (the
master picture shows them in English only); otherwise publish a native upload.

Languages: **es and pt-br first** (owner, 2026-11-24), then hi, it and zh (experimental). ja warns (its voice is
blocked until a real G2P is verified). **fr is refused**: Kokoro has no male French voice for Zoo. Zoo's voice for
every language is in `content/zoora-ai/channel.json` (`im_nicola`).

## Workflow (run from `projects/video-studio/`)

```bash
node scripts/claims/check.ts content/<channel>/<slug>                    # 1. the master passes the claim gate
node scripts/dub/cli.ts prepare content/<channel>/<slug> --lang es        # 2. writes content/<channel>/<slug>/dub/sheet.es.json
#                                                                          # 3. translator fills every "translation" and "method"
node scripts/dub/cli.ts import content/<channel>/<slug> --lang es         # 4. writes storyboard.es.json, then validates it
node scripts/claims/check.ts content/<channel>/<slug> --lang es           # 5. the translation passes the claim gate
python scripts/voice/build.py content/<channel>/<slug> --lang es --voice im_nicola              # 6a. voice, native upload (lip-synced render)
python scripts/voice/build.py content/<channel>/<slug> --lang es --fit-to en --voice im_nicola  # 6b. or an audio track on the English video
#                                                                          # 7. native review, then the owner marks it reviewed
node scripts/dub/cli.ts validate content/<channel>/<slug> --lang es       # any time
```

Exit codes: **0** ok, **1** refused or failed checks (listed), **2** bad input (usage, missing files, bad JSON,
unsupported language). Tests: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/dub/tests/dub.test.ts`.

## prepare: the translation sheet

`dub/sheet.<lang>.json` holds every string a viewer hears or sees: title, narration, each on-screen field, cue words,
claim-waiver matches, Short titles, thumbnail texts and the UI labels the render needs (fiction card, sources,
illustrative chip, subscribe, end-screen labels). Each item has:

- `context`: the scene, the template field and what it does (e.g. "Cue: copy the word from YOUR narration...").
- `budget`: narration at most 1.1x the source (speech; an audio-track dub cannot fit more, measured 2026-11-24), other text at most 1.35x; for on-screen fields also `hardMaxChars`, the estimated most the template box
  takes at its smallest font size (landscape, and the Short layout when the scene is in a Short); YouTube titles 100
  characters; thumbnails 4 words (zh/ja: 10 characters).
- `claimTags` that must survive, `markup` ({display|spoken} pairs), `numbers` (values to keep), `glossary` terms and
  `urls` in that string.
- `translation` (empty) and an optional `note` for the native reviewer.

Since 2026-11-24 the sheet also has one item per source title (`sources.<id>.title`: the sources card shows it; the URL
never changes), asks for "(translated quote)" in the translator's language on a real quote's attribution (the quote
card shows a translation, not the speaker's own words), and lists `spokenRespellings` for the target language
(`lib/glossary.ts`: es `{on-chain|onchéin}`, `{bonding curve|bóndin kerv}`, pt-br `{on-chain|onchêin}`, ...), which the
translator writes as `{term|spoken}` and the native reviewer checks by ear.

The sheet also lists the episode's do-not-translate glossary (Zoo, Badger, Zoora, Pump.fun, Bubblemaps, Solana,
named organisations, tickers such as `$DEMO` and `SOL`, URLs; extras in `<episode>/dub/glossary.json`), the
target language's income-claim lexicon, and `fixed` fields copied as is (the chart's ticker pair). Re-running
prepare carries over every translation whose source did not change; with no earlier sheet, an existing
`storyboard.<lang>.json` seeds it (each seeded item gets a note to re-check it). `--fresh` starts empty.

## import

Refuses a sheet whose source storyboard changed since prepare (sha256), a sheet with a missing or empty translation,
and overwriting a translation marked `native-reviewed` (unless `--force`). Everything that is not text (scenes,
types, characters, charts, sources, offers, shorts, thumbnail designs) is copied from the master. It writes
`"translation": {"status": "machine", "method": "machine" | "human", "reviewed": false}`, so renders carry the
"MACHINE TRANSLATION · needs native review" badge, then runs validate.

## validate

Errors: unsupported language or `fr`; non-text fields differ from the master; a scene's `[src:id]` tags differ;
a number of the source is missing or reads differently; a glossary term is missing; a URL changed or was added;
an on-screen string is too long for its box (estimated) or a thumbnail breaks its limits; a cue word is not in the
translated narration; a waiver match is not in the translated scene; a missing UI label; a fiction card that does
not say "fictional"; an income/return/financial-advice phrase in the target language (es, pt-br, hi, it, zh
lexicons); a private name or wallet; a missing or inconsistent `translation` record; and anything the episode
engine's own validator rejects (`src/episode/validate.ts`, loaded when available).
Since 2026-11-24 also: the **spoken** side of every `{display|spoken}` pair (`spoken-numbers`: its value must match
the source pair's spoken value, and its own display within rounding, so "casi noventa millones" for 18,67 millones
fails); a disclosure that names a different relationship than the source's, or negates it (`disclosure-relationship`:
"no está patrocinado y no recibo ninguna comisión"); a negated fiction card ("Historia no ficticia"); and, when
`dub/backtranslation.<lang>.json` exists (scripts/backtranslate), its English is scanned with research.md's English
"Must not say" list and the English income lexicon. Numbers in words are parsed with the voice step's own word tables
(`lib/numwords.ts`; the tests compare them with `scripts/voice/voicelib/normalize/*.py`).
Warnings: length above 1.1x the source for narration (speech length: Han counts 3, kana 2) or 1.35x for other text (width for on-screen
text), numbers the source does not have, a number the source spells out for the voice without a {display|spoken}
pair in the translation, untranslated strings.

Numbers are read exactly the way the voice step speaks them (`lib/numbers.ts` ports `parse_num` from
`scripts/voice/voicelib/normalize/common.py`): in es / it / pt-br "40.000" and "40,000" are forty thousand, "1,5" and
"68.67" are decimals, and "1,234" is 1.234, so an English "1,234" kept in Spanish is an error. Devanagari and
full-width digits, scales (`$1.5M`, `4万`, million, millones, लाख, करोड़, 亿) and percent words (por ciento, प्रतिशत,
百分之) count; Chinese numerals with a unit (四万, 三点五) count; 十分 ("very"), 千万别 ("never") and ordinals do not.

The report (`out/dub/<slug>.<lang>.md` and `.json`) ends with a side-by-side **native review sheet**: every key,
source, translation and the flags on it.

## Native review and the record

Have a native speaker read every line aloud before publishing. Only the owner then sets, in `storyboard.<lang>.json`:
`"translation": {"status": "native-reviewed", "method": ..., "reviewed": true, "reviewer": "<initials or role>", "date": "YYYY-MM-DD"}`.
Never a private full name in `reviewer`: the repo is public. validate rejects a half-set record.

## Contract additions (`src/episode/types.ts`, optional)

| Field | Meaning |
| --- | --- |
| `Storyboard.translation.method` | `'machine'` (an agent or MT translated it) or `'human'`. |
| `Storyboard.translation.reviewed` | `true` only together with `status: 'native-reviewed'` (validate enforces it). |
| `StoryboardScene.claimWaivers` | The claim gate's waivers (`scripts/claims/README.md`); their `match` is translated. |

The episode engine's existing `translation.status` stays the switch for the render badge.

## Rules for dubs elsewhere (the claim gate, `scripts/claims`)

`node scripts/claims/check.ts <episode> --lang <lang>` runs this validator's record, number and tag checks too, so its
report (the one batch and the renders read) covers them, and prints the translation status on its summary line. It
also fails a dub that carries offers (until a geo-aware link router exists; an owner waiver `dubOffersWaiver` can
record the decision for non-exchange offers) or any exchange/token offer, and applies MiCA (es, it), ASCI (hi),
persona and holdings rules. See `scripts/claims/README.md`.

Not in these tools (other workflows own them): the render badge and batch's "reviewed" read only
`translation.status` (src/episode/Episode.tsx, src/thumbnails/spec.ts, scripts/batch/lib/inspect.ts); they should also
require `reviewed: true` with a reviewer and a date, as validate does.

## Known limits

- The box budgets are estimates (measured average glyph widths per font role; Devanagari 0.43 em, CJK 1 em) from a
  snapshot of `src/episode/layout/specs.ts`; the test suite fails when the engine's layout changes. The render's own
  fit check is final.
- Numbers written only in words in the source ("ten thousand") are not compared; a translation that writes them in
  digits gets an "extra number" warning.
- Lexicons and style notes for es, pt-br, hi, it and zh are machine-made and need native review. Japanese is partial.
- Translation quality (meaning, tone, idiom) is not machine-checked here: that is the native review.
- The chart's own header, footer and callout text come from `src/charts` and stay English in dubbed renders.
- Number-word parsing covers en, es, pt-br, it, hi and zh; unusual forms (fractions in words, ordinals) are not
  compared.
