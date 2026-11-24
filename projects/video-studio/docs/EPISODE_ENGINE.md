# Episode engine: how to make a Zoora AI episode

Version 2026-11-24. One storyboard becomes a 1920×1080 episode, 1080×1920 Shorts and three 1280×720 thumbnails, in
English and in dubbed languages. Binding rules: `docs/PROJECT_INSTRUCTIONS.md` (characters, style, audio, delivery),
`docs/ART_GUIDE.md`, `docs/CHART_SPEC.md`. Contracts: `src/episode/types.ts` (`Storyboard`, `Timeline`, `Lang`).
The whole media pipeline around it (fact bank, publish kit, render farm, approvals, uploader) is
`docs/MEDIA_PIPELINE.md`; this page covers the episode itself, from storyboard to checked renders.

Status: run end to end on 2026-11-24 from a clean `public/generated/` with the demo episode
`content/zoora-ai/_engine-demo` in en, es and pt-br (results in section 9). The demo is a test episode: it is not
scheduled, and its es and pt-br files are machine translations.

## 1. The parts

| Step | Tool | Writes |
| --- | --- | --- |
| Claim gate | `scripts/claims` ([README](../scripts/claims/README.md)) | `out/claims/<slug>.<lang>.md` and `.json` |
| Dubbing | `scripts/dub` ([README](../scripts/dub/README.md)), `scripts/backtranslate` ([README](../scripts/backtranslate/README.md)) | `storyboard.<lang>.json`, `dub/sheet.<lang>.json`, `out/dub/<slug>.<lang>.md` |
| Voice | `scripts/voice` ([README](../scripts/voice/README.md)): Kokoro (kokoro-onnx 0.6.1, int8 model), Zoo = `im_nicola` | `public/generated/<channel>/<slug>/<lang>/`: `narration.wav`, `scenes/*.wav`, `timeline.json`, `phonemes.json` |
| Render | `src/episode` ([README](../src/episode/README.md)): compositions `Episode` (16:9) and `EpisodeShort` (9:16) | MP4 (H.264 High, yuv420p, BT.709, 30 fps, AAC) |
| Thumbnails | `scripts/thumbnails.ts` + `src/thumbnails` ([README](../src/thumbnails/README.md)): composition `Thumbnail` | `v0.png`, `v1.png`, `v2.png` per language, plus checks |

Episodes render from their own Remotion entry point, `src/episode/index.ts` (`EpisodeCompositions` and
`ThumbnailCompositions`), never from `src/index.ts`.

## 2. The files of one episode

| Path | What | Committed |
| --- | --- | --- |
| `content/<channel>/<slug>/research.md` | Facts with sources, and a `## Must not say` section (required; `- (none)` is fine). Optional `## Must not say (es)`, `(pt-br)`… with bans in that language | yes |
| `content/<channel>/<slug>/storyboard.json` | The master (English), the `Storyboard` contract | yes |
| `content/<channel>/<slug>/storyboard.<lang>.json` | One per dub, written by `dub import` | yes |
| `content/<channel>/<slug>/dub/sheet.<lang>.json`, `dub/backtranslation.<lang>.json` | Translation sheet and back-translation record (the audit trail) | yes |
| `content/<channel>/channel.json` | Zoo's voice per language (`zooVoice`) | yes |
| `data/private/names.txt` | The real names and handles behind every `[named person]` in research; the claim gate fails without it | **never** (gitignored, owner only) |
| `public/generated/<channel>/<slug>/<lang>/` | Voice output | no (gitignored) |
| `out/claims/`, `out/dub/`, `out/episodes/`, `out/thumbnails/` | Reports and renders | no (gitignored) |

The repository is public: a pushed storyboard is public for good. No secrets, real wallet addresses or private names
in any committed file (the claim gate fails on wallets and on names from the private list).

## 3. Write the storyboard

`storyboard.json` (contract in `src/episode/types.ts`): `version: 1`, `channel`, `slug`, `lang`, `sourceLang`,
`title`, `fiction`, `scenes[]`, `sources[]`, and optionally `offers`, `shorts`, `thumbnails`, `ui`, `translation`.

| Scene `type` | Required `onScreen` | Optional | Notes |
| --- | --- | --- | --- |
| `hook` | `title` | `kicker`, `subtitle` | Zoo reacts after the title lands |
| `talk` | | `title`, `bullets` (≤ 4), `cues`, `lowerThird` | Bullets appear on their words |
| `chart` | `pair` for seeded data, plus `chart` | `cues` (`[pumpWord, rugWord]`), `label` | Seeded data is synthetic: `illustrative: true` is required |
| `steps` | `steps` (1-5) | `title`, `cues` | |
| `quote` | `quote`, `attribution`, and `source` or a `[src:id]` | | A translated quote says so in its attribution |
| `cta` | | `title`, `button`, `cues`, `disclosure` | With `offers`, `disclosure` is required, shown AND said |
| `endscreen` | | `title` | Last scene, `minDurationSec: 20` |

Narration markup: `{display|spoken}` shows `display` and speaks `spoken` (write every number that could be read two
ways this way: `{$40,000|forty thousand dollars}`); `[src:id]` after a factual sentence cites `sources[id]` and is
neither shown in captions nor spoken.

Rules the render enforces before frame 0 (`src/episode/validate.ts`): Badger in at least one scene; the end screen
last; a seeded chart marked illustrative with a fictional pair; cited sources verified, `https`, with an `accessed`
date; offers disclosed on screen and in the narration; every UI label a non-English render needs in `ui`; the
timeline's words equal to the narration (an edit after the voice step fails the render). Text that does not fit its
box fails the render and names the text. Writing guidance per episode: `docs/prompts/03-episode.md`.

## 4. Make an episode: commands in order

Run from `projects/video-studio/`. These are the commands of the 2026-11-24 verification run, with `<slug>` for the
episode (`_engine-demo` there).

```bash
# 0. once per machine
npm ci
scripts/voice/setup.sh                          # .venv-voice + Kokoro model files (size and sha256 checked)

# 1. claim gate, master language (exit 0 = pass). Needs data/private/names.txt; only a run that cannot have the
#    list (CI, this cloud session) passes --no-names, and the report then says "names NOT checked"
node scripts/claims/check.ts content/zoora-ai/<slug>

# 2. voice (Zoo's voice comes from content/zoora-ai/channel.json: im_nicola)
.venv-voice/bin/python scripts/voice/build.py content/zoora-ai/<slug> --lang en --voice im_nicola

# 3. render: bundle AFTER the voice step (the bundle copies public/), then each output
npx remotion bundle src/episode/index.ts --out-dir=/tmp/episode-bundle
npx remotion render /tmp/episode-bundle Episode out/episodes/<slug>/en/episode.mp4 \
  --props='{"channel":"zoora-ai","slug":"<slug>","lang":"en"}'
npx remotion render /tmp/episode-bundle EpisodeShort out/episodes/<slug>/en/short1.mp4 \
  --props='{"channel":"zoora-ai","slug":"<slug>","lang":"en","shortId":"short1"}'

# 4. thumbnails (refuses a language whose claim report is missing, failed or older than the text it checked)
node scripts/thumbnails.ts zoora-ai/<slug> --lang en --out out/episodes/<slug>

# 5. check what was made (section 8): ffprobe, loudness, frames of every scene; optional automatic QA:
node scripts/qa/check.ts --entry src/episode/index.ts --comp Episode --props '{"channel":"zoora-ai","slug":"<slug>","lang":"en"}'
```

Exit codes: claim gate and dub tools 0 pass, 1 failed (findings listed), 2 bad input; voice 0 ok, 1 error, 2 bad
arguments, 3 `--fit-to` overflow (files written); thumbnails 0, 1 failed check or claim gate, 2 bad arguments.
`remotion.config.ts` already sets PNG frames, CRF 12, preset slow, yuv420p and BT.709: pass no encoder flags.

After any change to the storyboard or `research.md`, re-run the claim gate, then the voice step, then the renders.
The publish kit (`node scripts/publish-kit/cli.ts <channel>/<slug>`) then writes the upload texts and a
`render-plan.sh` that also applies the final loudness pass; see `docs/MEDIA_PIPELINE.md` §6.

## 5. Dub into another language

```bash
node scripts/dub/cli.ts prepare content/zoora-ai/<slug> --lang es       # dub/sheet.es.json for the translator
#  an agent in the workflow, or a person, fills every "translation" (there is no translation API)
node scripts/dub/cli.ts import content/zoora-ai/<slug> --lang es        # writes storyboard.es.json, then validates it
node scripts/backtranslate/cli.ts prepare zoora-ai/<slug> --lang es     # es and pt-br: blind back-translation...
node scripts/backtranslate/cli.ts import zoora-ai/<slug> --lang es --from out/backtranslate/zoora-ai/<slug>/es/worksheet.json --by claude-session --who claude-session --blind
node scripts/backtranslate/cli.ts compare zoora-ai/<slug> --lang es     # ...meaning changes ranked for the reviewer
node scripts/claims/check.ts content/zoora-ai/<slug> --lang es          # the dub passes the claim gate
node scripts/dub/cli.ts validate content/zoora-ai/<slug> --lang es      # any time; the claim gate runs its checks too
# then ONE voice mode (below):
.venv-voice/bin/python scripts/voice/build.py content/zoora-ai/<slug> --lang es --voice im_nicola              # native
.venv-voice/bin/python scripts/voice/build.py content/zoora-ai/<slug> --lang es --fit-to en --voice im_nicola  # audio track
```

`import` always records `translation: {status: "machine", method, reviewed: false}`. Until the owner records a native
review (section 7), every render and thumbnail of that language carries a **MACHINE TRANSLATION · needs native
review** badge, the voice step warns, and the claim report says so on its summary line.

The sheet gives the translator each string's context, a length budget (narration at most 1.1× the English; on-screen
text sized to its box), the claim tags, numbers and glossary terms that must survive, and the language's spoken
respellings (es `{on-chain|onchéin}`, `{bonding curve|bóndin kerv}`; pt-br `{on-chain|onchêin}`…). Spanish copy is
neutral Latin American (no "vosotros").

### Native upload or audio track (`--fit-to`)?

| | Native upload | Audio track on the English video |
| --- | --- | --- |
| Voice step | `build.py --lang es` | `build.py --lang es --fit-to en` (the master `timeline.json` must exist) |
| What the viewer sees | Its own render: translated on-screen text, captions, UI labels and chip | The **English** picture: English text, chart labels, fiction and disclosure cards |
| Zoo's mouth | Lip-synced to the dub | The English mouth shapes; only talking and pauses line up, sentence by sentence |
| Length | Follows the dub (demo: es 73.7 s, pt-br 71.9 s against en 59.0 s) | Must fit the master: each sentence at Kokoro speed 0.85-1.15, pauses shortened; exit 3 when it still overflows |
| Upload | A separate video | YouTube Studio, desktop only: Languages → the video → Add language → Dub. No API. Delete YouTube's auto-dub for that language first |

Use a **native upload** when:
- the video has `offers` or `fiction: true`: the voice step refuses `--fit-to` unless the dub itself SAYS the
  disclosure and the fiction notice, because the English picture shows them in English only;
- the story lives in on-screen text the viewer must read (bullets, steps, a quote, chart callouts);
- the translation is written naturally: on the demo, natural Spanish overflowed 6 of 7 scenes as an audio track;
- the owner wants lip-sync, or a separate localized upload.

Use an **audio track** when one video should carry every language (YouTube's multi-language audio; the research
recommends one channel over language channels, `docs/research/dubbing-and-regions-2026-11-24.md` §2), its on-screen
text is language-light, it has no offers and no fiction card, and the translation was **written to length**. On the
demo a length-aware Spanish rewrite fitted 7 of 7 scenes; the build still lists every sentence longer than its
English sentence, with the percentage to cut. The weekly batch plans es and pt-br as audio tracks
(`docs/CONTENT_CALENDAR.md`; batch inspect wants `mode: fit-to-master`), so write those translations to length.
Keep an audio-track build out of `public/` when a native timeline for the same language must stay (`--out-root <dir>`).

## 6. The claim gate

`node scripts/claims/check.ts content/<channel>/<slug> [--lang <lang>]`, or `--all` for every storyboard. Full rules,
options and known limits: `scripts/claims/README.md`. It runs before the voice step and again before every render and
push. Each finding names the scene, the sentence as written and a fix. It FAILS on:

- **Facts without a source.** A sentence with a figure, a percentage, money, a number in words, a date, a superlative,
  an attribution ("according to"), a statistic ("seven in ten") or a named organisation needs a `[src:id]`; the source
  must exist, be verified, `https` and have an `accessed` date. Titles, Short titles, thumbnails and on-screen figures
  may only repeat a cited figure (rounded at their own precision, by at most 6%, never moved; a percentage needs a
  cited percentage).
- **Research bans.** Every phrase and figure in research.md's "Must not say" (and the language's own section).
- **Income and advice.** Guaranteed or risk-free returns, get-rich, passive income, multiples, buy calls, price
  predictions, "financial advice" framings, in the storyboard's language. A negation counts only inside its own clause;
  "not financial advice" is never a shield.
- **Persona and holdings.** Zoo presented as a human financial adviser or expert; an opinion on a named token, or a
  holding, without a spoken holdings disclosure.
- **Private names and wallets.** Any name from `data/private/names.txt` (never printed), any wallet address or hash,
  referral and invite links. No names list = a failure (`no-names-list`) unless `--no-names` is passed on purpose.
- **Disclosures and fiction.** With `offers`, the disclosure must be SAID (display-only markup does not count) and must
  not deny the relationship; `fiction: true` needs the fiction card or a fiction notice in the opening scene.
- **Dubs.** Different `[src:]` tags than the master, a changed number (shown or spoken), a missing or half-set
  translation record, master flags (`offers`, `fiction`, `tokenPromotion`, `holdings`) not carried over, offers in a
  dub (until a geo-aware link router exists), MiCA Art. 7 statement missing for es/it token promotion, ASCI rules
  for Hindi crypto promotion.

Warnings never fail but are read by a person: on-screen text that only looks factual, quote-less or old sources,
negated income phrases, names not checked, and the English "Must not say" list shown for a human read in a translation.
Waivers (`claimWaivers`: a sentence that only looks factual, an income word used as a warning) are listed for the owner.
The thumbnail script refuses a language without a current, passing report; the Remotion bundle cannot read `out/`, so
**`npx remotion render` does not check the report**: run the gate yourself first.

## 7. Languages and voices

Zoo speaks with Kokoro `im_nicola` in every language (owner decision, 2026-11-24; `content/zoora-ai/channel.json`);
only the phonemizer changes. Badger is nonverbal.

| Lang | State | G2P (voice step) | Fonts | Notes |
| --- | --- | --- | --- | --- |
| en | Master | espeak-ng `en-us` | Inter, Montserrat, Anton | Channel lexicon: "memecoins" → "meme coins", Pump.fun → "Pump dot fun" |
| es | Launch (owner) | espeak-ng `es` (Castilian sounds) | brand fonts | Neutral Latin American copy; machine-made respellings need a native ear |
| pt-br | Launch (owner) | espeak-ng `pt-br` | brand fonts | |
| hi | Supported, not launched | espeak-ng `hi` | + Noto Sans Devanagari | Audio quality untested by ear; ASCI rules for crypto promotion |
| it | Supported, not launched | espeak-ng `it` | brand fonts | The only dub without a foreign accent (`im_nicola` is Italian) |
| zh | Experimental | misaki 0.7.4 (jieba + pypinyin) | + Noto Sans SC | Quality unverified; YouTube is blocked in mainland China |
| ja | **Blocked** (owner) | misaki 0.7.4 (MeCab) exists | + Noto Sans JP | See below |
| fr | **Excluded** | none | | Kokoro v1.0 has no male French voice; every tool refuses `fr` |

- **French** is excluded because Zoo is an adult man and Kokoro v1.0 has no male French voice. The engine, the voice
  step, the claim gate and the dub tools all refuse `fr`.
- **Japanese** through espeak reads every kanji as "Japanese letter". The voice step has a misaki (MeCab) path that
  reads kanji (its test reads 暗号 as aŋɡoː), but no native speaker has heard it, so the owner's decision keeps ja
  blocked: `channel.json` has no ja voice, `dub prepare` and `validate` warn, and the claim lexicon is partial.
- Inter, Montserrat and Anton have no Devanagari or CJK glyphs: hi, zh and ja add the Noto families (bundled from
  `@fontsource`, OFL), and the render waits until every face is loaded.
- Kokoro's own male voices for other languages (`em_alex`, `pm_alex`, `hm_omega`, `zm_yunjian`, `jm_kumo`) exist in
  `voicelib/langs.py` for content without a `channel.json` (test fixtures); they are not Zoo.

## 8. Check what was made

For every MP4: `ffprobe` (H.264 High, yuv420p, BT.709, 30 fps, 1920×1080 or 1080×1920, AAC 48 kHz), the frame
count against `timeline.json`, and loudness (`ffmpeg -i x.mp4 -af ebur128=peak=true -f null -`: about -14 LUFS,
true peak under -1 dBTP; `narration.wav` is normalized to -14 LUFS / -1 dBTP by the voice step). Then LOOK at the
first, middle and last frame of every scene of every language, taken from the MP4, not from stills (ART_GUIDE QA).
The voice step checks lip sync itself (`timeline.warnings`); `scripts/voice/tests/test_demo_sync.py` re-checks the
built demo. Thumbnails: `out/.../<lang>/check/sheet.png` shows each one at 168×94.

## 9. The 2026-11-24 verification run

RESULTS_PLACEHOLDER

## 10. Owner review steps (before anything is published)

1. **Names list.** Create `data/private/names.txt` (one name or `@handle` per line) with the real names behind every
   `[named person]` in the research files, then re-run the claim gate without `--no-names`. Until then no report has
   checked names.
2. **Read the claim reports** (`out/claims/<slug>.<lang>.md`): the claims and their sources, every waiver, the rules
   the gate could not check, and the warnings. Open the cited pages yourself where a fact matters.
3. **Watch and listen** to every render with sound, at full size and on a phone. Check Zoo and Badger against the
   model sheets, the charts (green up, red down, "Illustrative · fictional token"), captions and the mouth.
4. **Native-speaker review of every dub, before it is published in any form** (an upload, an audio track, a
   localized title or thumbnail):
   - a native speaker reads every line aloud against the review sheet at the end of `out/dub/<slug>.<lang>.md` and
     the back-translation report (`scripts/backtranslate`), listens to the dubbed `narration.wav`, and checks the
     respellings, numbers, the disclosure and fiction wording, the translated quotes and the `## Must not say (<lang>)`
     section;
   - fixes go through the sheet (`dub prepare` carries the rest over, then `dub import`), never by hand-editing only
     the storyboard;
   - then only the owner sets, in `storyboard.<lang>.json`, the full record
     `"translation": {"status": "native-reviewed", "method": "machine", "reviewed": true, "reviewer": "<initials or role>", "date": "YYYY-MM-DD"}`
     (never a private full name: the repository is public);
   - re-run `dub validate`, the claim gate, the voice step and the renders; the badge then disappears. Never publish a
     render that still shows the badge.
5. **Audio tracks:** in Studio set automatic dubbing to "Publish manually", delete that language's auto-dub, then
   upload the track (desktop only). Spot-check the auto-dubs YouTube keeps for other languages.
6. **Thumbnails:** run Test & Compare on the default thumbnail first; add localized thumbnails only after the test
   ends (changing a thumbnail stops a running test).
7. Uploads stay manual unless the owner asks for API uploads; agents never approve or publish for the owner
   (`CLAUDE.md`, Media multipliers).

## 11. Known limits

Gates and review
- `data/private/names.txt` does not exist yet, so a default claim run fails by design (`no-names-list`). The demo
  passes only with `--no-names`, and the thumbnail script's report check (`src/episode/node/claimGate.ts`) accepts such
  a report: it checks pass, errors, episode and freshness, not whether names were checked.
- `npx remotion render` and the voice step do not check the claim report (the bundle cannot read `out/`);
  `calculateMetadata` enforces only what the bundle can see (spoken disclosure, verified https sources with a date,
  narration = timeline). Run the gate first. The render farm's plan job runs the gate itself, and on GitHub it refuses
  real episodes until it can run with a names list (`CLAUDE.md`, Media multipliers).
- Claim detection is lexical: a claim with no figure, date, superlative, attribution or known organisation passes
  unless the research list bans it. The non-English lexicons, the research "Must not say (es)/(pt-br)" sections and the
  es/pt-br respellings are machine-made. The MiCA Art. 7 and ASCI texts were not read (EUR-Lex and ascionline.in are
  blocked here): those rules match key clauses and need legal review.
- The render and thumbnail badge (and batch's "reviewed") read `translation.status` alone, as the contract says; the
  claim gate, `dub validate` and the voice step require the full record. Set the full record.
- `dub validate` alone accepts a `[src:]` tag moved to another sentence of the same scene; the claim gate catches it.
- `Storyboard.holdings`, `tokenPromotion` and `dubOffersWaiver` are read by the claim gate only and are not yet typed
  in `src/episode/types.ts`.

Voice and dubs
- No native speaker has heard es, pt-br, hi, it, zh or ja. espeak `es` is Castilian; `im_nicola` gives every language
  an Italian accent (accepted by the owner). Nothing in this verification was judged by ear: loudness, lip sync and
  silence edges were measured, frames were looked at.
- Kokoro's ONNX graph samples noise, so two builds of the same text are not bit-identical: lengths and word timings
  repeat, a quiet frame's level does not. Rule 7 of the mouth track keeps every build inside the lip-sync tolerance;
  keep the `timeline.json` and `narration.wav` of every uploaded version.
- Number readings still worth a `{display|spoken}` pair (checked on 2026-11-24): "A $3.5B hack" is read "three point
  five billion dollars hack", "Between 5-10 wallets" "between five to ten wallets", and "100,000+" stays as written
  (the build warns about the leftover symbol).
- Audio-track dubs carry the English picture and mouth. Natural Spanish overflowed 6 of 7 demo scenes (68.5 s against
  59.0 s); a length-aware rewrite fitted 7 of 7, with 5 sentences still 3-29% longer than the English ones. A
  pt-br audio track was not measured. Sentence spans come from Kokoro's token timings, whose phrase-final phone runs
  about 250 ms past the voice in master and dub alike.

Picture
- The chart's own header, footer ("Illustrative · fictional token") and callouts are English in dubbed renders
  (`src/charts` is owned by the charts workflow); the engine adds a localized "illustrative" chip outside the panel.
- Slides are a short push under a fade (no motion blur: `@remotion/transitions` 4.0.541 has no `motionBlur` prop and
  `@remotion/motion-blur` is not installed); a transition holds the incoming scene on its first frame for up to 18
  frames (no breathing there).
- Shorts: Badger reacts in an insert shot (his head would sit in the caption band in a shared frame); with less than
  24 frames after a scene's key beats there is no insert, and his tail enters the button column during inserts (no
  text there). Vertical cuts between templates whose Zoo scale differs 7-15% are hard cuts.
- Captions can still start a page with a one-word line in Spanish where the only alternative ends a line on an
  article; zh and ja have no phrase rules.
- Zoo and Badger are being repaired in parallel (repair round 2): renders use the character code present at bundle
  time, and the thumbnail rig boxes (`src/thumbnails/layout.ts` RIG) need a probe re-run after character changes.
