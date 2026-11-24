# Back-translation check (`scripts/backtranslate`)

Every Spanish and Brazilian Portuguese script is translated back into English, **by a Claude session or a person,
never by a translation API**, and compared with the English original by deterministic checks. Anything that changed
in meaning (a number shifted, "allegedly" lost, a warning softened, a name translated, a source tag dropped) is
flagged and ranked by risk, so the native speaker's review starts with what matters. Built 2026-11-24. TypeScript run
directly by Node 22; no dependencies; no network.

It fills the gap the dubbing tools leave on purpose: `scripts/dub` checks structure (tags, numbers, glossary names,
box lengths) and says "translation quality (meaning, tone, idiom) is not machine-checked here". This tool checks
meaning; the native reviewer still judges tone, idiom and fit.

## Where it sits in the dubbing workflow

```
scripts/dub prepare -> translate -> scripts/dub import / validate -> scripts/claims (lang) -> BACK-TRANSLATION CHECK -> native review -> voice/render
```

## Commands (run from `projects/video-studio/`)

```bash
node scripts/backtranslate/cli.ts prepare zoora-ai/<slug> --lang es          # 1. blind worksheet (Spanish only, no English)
#                                                                             2. a Claude session or a person fills it
node scripts/backtranslate/cli.ts import  zoora-ai/<slug> --lang es \
     --from out/backtranslate/zoora-ai/<slug>/es/worksheet.json \
     --by claude-session --who "claude-session" --blind                      # 3. record it (or --by human --who ES-1)
node scripts/backtranslate/cli.ts compare zoora-ai/<slug> --lang es          # 4. ranked report + rubric
```

- `<episode>` is `<channel>/<slug>` (content/), `_dev/<slug>` (the dev fixtures), a folder holding `storyboard.json`,
  or a channel-copy `.md` file whose fenced blocks ```` ```text id=<id> ```` have translations `id=<id>-<lang>`
  (e.g. `content/zoora-ai/channel-copy.md`, whose description drafts need this check before they are published).
- `--lang es | pt-br` (the launch languages). `fr` is refused (no male French voice); other languages are refused
  because the Spanish/Portuguese cue lists and number parsers are what make the direct checks work.
- Files: worksheets and reports go to `out/backtranslate/<channel>/<slug>/<lang>/` (`--work-dir`). The imported
  record is kept with the episode, next to the dub sheet: `content/<channel>/<slug>/dub/backtranslation.<lang>.json`
  (`--record`; `_dev` fixtures and copy files keep it in the work dir). Commit the record with the episode: it is
  the audit trail of who back-translated what.
- Re-running `prepare` asks only for segments without a back-translation of their CURRENT text (`--all` for every
  segment). Each item carries a hash of the exact translated string; when the translation changes, its old
  back-translation is "stale" and `compare` reports the segment as not checked.
- `--glossary <file>` adds terms (same format as `glossary.json`; repeatable). `--json` / `-q` change the output.

Verdicts: **FIX** (a high finding) · **REVIEW** (medium findings for the native reviewer) · **CLEAR** (low/info only)
· **INCOMPLETE** (segments without a back-translation of the current text). Exit codes: 0 (REVIEW, CLEAR, or a
successful prepare/import), 1 (FIX, INCOMPLETE, or import rejected items), 2 (bad input).

## The back-translation itself

`prepare` writes `worksheet.json` (for a Claude session) and `worksheet.md` (for a person). Neither contains the
English. The rules printed at the top: translate literally, one English sentence per sentence; work blind; keep
numbers, names and `[src:id]` tags exactly; do not fix mistakes or add/drop words like "allegedly", "may", "never";
write two readings as `a/b`; comments in `[note: ...]`; never paste into a translation website or API.

To have a Claude session do it: open a NEW session, give it only `worksheet.json` and the instructions inside it,
and ask it to fill every `"bt"` and return the file. A session that has the English storyboard in its context is not
blind: import its work with `--saw-source` (the report then warns that agreement may be overstated).

`import` refuses: a text made from an older translation (hash), one that reads as Spanish/Portuguese, a copy of the
translation, unknown or duplicate ids, `--by` other than `claude-session` or `human`, and a `--who` that looks like a
full name (the repository is public: initials or a role).

## What `compare` checks

Each segment: the title, every narration and on-screen string (cue words excluded), Short titles, thumbnail texts,
UI and show labels, the DEVELOPING label, or a channel-copy paragraph. English source vs back-translation (meaning),
and English source vs the Spanish/Portuguese text itself where it can be read reliably (an independent second signal:
when the two disagree, the finding says "possibly a back-translation slip" and drops one level).

| Check | Catches | Severity |
| --- | --- | --- |
| Numbers and units | value shifted (10,000 -> 100,000), unit or currency changed or dropped, number missing/added, "more than" <-> "less than", "only" -> "more than", the Spanish "billón" (10^12) and "mil" (thousand) traps, English digit style a reader would misread ("1,500" is 1,5 in Brazil), bare "$" (pesos in much of Latin America), ordinals ("day two" = "segundo día") | high / medium / low |
| Negation | a "not/never/no" lost or added; "never" softened to "not"/"avoid" (high for an instruction, medium for a statement); rephrasings ("hates" / "no le gusta") as low | high / medium / low |
| Modality | "may" -> "will" (hardened), "may" dropped, "must" -> "can"/"should", an instruction turned into an option ("Check" -> "you could check"), "guaranteed" added, "always" dropped | high / medium |
| Hedges and attribution | "allegedly", "according to / says / warned / put it", "preliminary / developing / unconfirmed" lost | high |
| Names | an organisation or product dropped, added, or swapped for another ("CoinGecko" -> "CoinMarketCap" is high) | high / medium |
| Glossary | a name translated as a common noun (Badger -> "tejón"), a do-not-translate name changed, a term without an accepted rendering, the owner's "Zoo, never ZOO" rule | high / medium / low |
| Claim tags | a `[src:id]` missing (the claim loses its source), extra, or moved to another sentence | high / medium |
| Voice | the dub's `{display|spoken}` numbers differ from what the English voice says; respellings for the voice listed for the reviewer | high / info |
| Sentences | a sentence omitted (alignment, not just counts) or added; merged/split sentences | high / medium / low |
| Similarity | token overlap (stems, synonym families, idioms) per segment, plus key-term agreement; very low overlap; the words that did not come back | high / medium / low |
| Back-translation sanity | still in Spanish/Portuguese; word-for-word the English in most long lines (probably not blind) | high / note |

The report (`report.md`, `report.json`) ranks segments by risk (findings weighted high 30, medium 10, low 3, plus
the similarity gap), shows English / translation / back-translation side by side with a checkbox line for the
reviewer, lists clean segments with the words that did not come back, and ends with the rubric below.

## Rubric for the native reviewer (printed in every report)

Score each flagged segment 2 (right), 1 (small fix) or 0 (wrong) on: **Meaning** (facts, numbers, units, names),
**Certainty** (attribution and hedges kept), **Warnings** (negations and absolutes kept; instructions stay
instructions), **Terms and names** (glossary; Zoo, Badger, Zoora AI untranslated), **Natural and regional**
(native adult register; Latin American Spanish with "tú" / Brazilian Portuguese with "você"; digits and currency for
the audience), **Fit and voice** (box fit, spoken numbers, caption breaks). OK / Fix / Retranslate; any 0 on Meaning,
Certainty or Warnings blocks publication. The owner then records `translation.status: "native-reviewed"` with
initials or a role.

## Proof (2026-11-24)

`node scripts/backtranslate/proof/run.ts [--out <dir>]` re-runs everything below (also `tests/proof.test.ts`).
The back-translations in `proof/` were written literally by this Claude session, which had read the English first,
so they are recorded as NOT blind.

**Clean runs** (normal prepare -> import -> compare path):

| Episode | Spanish | Portuguese |
| --- | --- | --- |
| `content/zoora-ai/_engine-demo` (the real dub; snapshot in `proof/zoora-ai-engine-demo`, live folder checked too) | CLEAR: 0 high, 0 medium, 12 low | CLEAR: 0 high, 0 medium, 8 low |
| `_dev/engine-demo` (dev fixture) | REVIEW: 3 medium (thumbnails not translated), 4 low | same |
| show excerpt (news-channel test data in `proof/show-excerpt`) | CLEAR: 0 findings | - |
| Zoora AI channel description drafts (`content/zoora-ai/channel-copy.md`) | CLEAR: 6 low | CLEAR: 5 low |

What the low findings say about the real dub, for the native reviewer: "bonding curve" became "curva de lanzamiento"
/ "curva de lançamento" (launch curve; a technical term), "hype" became "promote" (loses the pejorative sense), "Watch
next" lost "watch" (es), the thumbnail "WHY MEMECOINS DIE" dropped "memecoins", "launch-day numbers" dropped "day",
"holds the supply" became "tiene el suministro". On the dev fixture: "top caller" became "caller famoso" (famous),
the lower third still says "ZOO" in English and both translations (owner rule: "Zoo"), and the three thumbnail texts
were never translated. In the channel descriptions: "fictional composites" lost "composite" in both languages, and
"Your hosts are" became "Te acompañan" (es).

**Injected errors**: each edits one string of a scratch copy and supplies the literal back-translation of the edited
text. Caught = an expected finding on that segment at the expected severity, and no new medium/high finding
anywhere else. **17 of 17 caught.**

| Key | Error | Caught by |
| --- | --- | --- |
| C1 (core, es) | 68.67% transposed to 86.67% (captions and voice) | high number-changed, spoken-number-changed |
| C2 (core, pt-br) | "most new memecoins never see day two" -> "...reach day two" | high negation-lost |
| C3 (core, es) | "only 4.55%" -> "more than 4.55%" | high number-qualifier-flipped |
| C4 (core, es) | "Bubblemaps analysts warned:" dropped | high attribution-lost |
| C5 (core, pt-br) | CoinGecko -> CoinMarketCap | high entity-swapped |
| D1-D8 (dev fixture) | 10,000 -> 100,000; "never buy" -> "buy"; "Never buy" -> "Avoid buying"; "As one caller put it" dropped; Badger -> "el tejón"; `[src]` tag dropped; a sentence dropped; "do three things" -> "you can do three things" | high, except the last (medium instruction-softened) |
| S1-S4 (show excerpt) | "may change" -> "are going to change"; "allegedly" dropped; "According to FixtureSwap's preliminary review" dropped; $4.2 million -> "US$ 4,2 mil" ($4,200) | high |

**Held-out run** (translations not used while building: `scripts/assets/.../fixture-fake-support` es, 24 segments,
and the voice smoke test es + pt-br, 6 segments; back-translated the same way). Before any change: 1 high and 5
medium false alarms in 30 segments ("so you don't have to" -> "por ti" read as a lost negation; "DMs" read as a name
three times; "1.5 M tokens" not read as a million). After general fixes (common abbreviations are not names, an upper
case "M" is a million, the "so you don't have to" / "for you" call-to-action formula is forgiven once while "so you
have to" stays an inversion): 0 high, 0 medium. That second number is no longer held out; expect some false alarms
on new episodes.

## Limits (honest)

- Back-translation quality bounds the check. A back-translator who silently fixes an error hides it; the direct
  checks on the translation (digits and number words, negation and hedge words, names, tags) catch some of those,
  not all. Not-blind back-translations overstate agreement.
- No judgement of tone, idiom, humour, register, regional naturalness or on-screen fit: that is the native review.
- The English lexicons and the Spanish/Portuguese cue lists, number words and glossary renderings are machine-made
  (2026-11-24) and need a native speaker's review; "proposed" glossary entries only raise low findings.
- Rules were calibrated on the demo episodes above; false alarms on new material are expected (most will be low).
  Known blind spots: a one-word name at the start of a sentence that the translation drops (only the similarity
  check sees it); sarcasm and idioms outside the synonym and phrase lists; meaning carried by word order.
- es/pt-br only.

## Tests

`node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/backtranslate/tests/*.test.ts` (120 tests: text,
numbers, lexicons, similarity and alignment, glossary and segments, every finding type, the CLI end to end, and the
proof). Typecheck: `npx tsc --noEmit` (this folder is clean).

## Files

`cli.ts` (entry) · `glossary.json` · `lib/`: `main.ts` (CLI), `load.ts` (episodes, copy files), `segments.ts`
(aligned strings; narration markup via the engine's own `src/episode/markup.ts`), `worksheet.ts` (prepare),
`importer.ts`, `compare.ts`, `report.ts`, `numbers.ts`, `lexicon.ts`, `entities.ts`, `glossary.ts`, `similarity.ts`,
`synonyms.ts`, `stem.ts`, `align.ts`, `text.ts`, `types.ts` · `proof/` (injections, runner, stored literal
back-translations, snapshots) · `tests/`.
