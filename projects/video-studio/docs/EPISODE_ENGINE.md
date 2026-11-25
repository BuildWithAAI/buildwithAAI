# Episode engine: how to make a Zoora AI episode

Version 2026-11-25 (sound: section 12). One storyboard becomes a 1920×1080 episode, 1080×1920 Shorts and three 1280×720 thumbnails, in
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
| Sound (2026-11-25) | `src/episode/audio` (the sound plan) and `src/episode/tools/render.sh` (plan, picture + lossless mix, voice stem, master, gate), over `src/audio` ([README](../src/audio/README.md)) and the music and SFX packages | the mastered MP4 plus `.audio-plan.json`, `.cues.md`, `.master.json`, `.audio.json` (section 12) |
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
`title`, `fiction`, `scenes[]`, `sources[]`, and optionally `offers`, `shorts`, `thumbnails`, `ui`, `translation`,
`music`.

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

Sound fields (all optional; section 12; read from the master storyboard for every language):

| Field | Values | Default |
| --- | --- | --- |
| `scene.bed` | The music **from this scene on**: `curious`, `tension`, `ominous`, `resolve`, `none`. Mark acts, not templates: a region shorter than 8 bars (25.6 s) is merged unless you set it, and the bed changes at most once a minute | `curious` for the whole story (the end screen has its own music; there only `none` is allowed) |
| `scene.sfx` | `{transition, items, accent}`: a wipe's whoosh (off with `false`; a slide's soft air only with `true`), list pops in the gaps of the speech, the CTA's click (on) and the chart rug's tick (off unless `true`) | as listed |
| `shorts[].bed` | One bed for the whole Short | the mood of its first scene |
| `music.offset` | 0-4: which 4-bar phrase of the beds' 64 s loop the episode's clock starts on | the planner's choice |
| `music.sting` | `"after-hook"`: the Zoora AI brand sting after the cold open; the hook needs room (the render names the `minDurationSec` it needs) | off |
| `music.stingTagline` | The sting card's tagline in this file's language (required in a dub with the sting) | "Crypto and AI stories, starring you." |

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
scripts/audio/setup.sh                          # .venv-audio (hash-pinned numpy, scipy, soundfile): the master and the gate

# 1. claim gate, master language (exit 0 = pass). Needs data/private/names.txt; only a run that cannot have the
#    list (CI, or a machine without the private file) passes --no-names; the report then says "names NOT checked"
node scripts/claims/check.ts content/zoora-ai/<slug>

# 2. voice (Zoo's voice comes from content/zoora-ai/channel.json: im_nicola)
.venv-voice/bin/python scripts/voice/build.py content/zoora-ai/<slug> --lang en --voice im_nicola

# 3. render with sound: bundle AFTER the voice step (the bundle copies public/), once per batch; then every output
#    goes through render.sh: plan, picture + lossless mix, voice stem, the 2-pass master, the gate (below, section 12)
npx remotion bundle src/episode/index.ts --out-dir=/tmp/episode-bundle
src/episode/tools/render.sh zoora-ai/<slug> --lang en --bundle /tmp/episode-bundle --out out/episodes/<slug>/en/episode.mp4
src/episode/tools/render.sh zoora-ai/<slug> --lang en --short short1 --bundle /tmp/episode-bundle --out out/episodes/<slug>/en/short1.mp4

# 4. thumbnails (refuses a language whose claim report is missing, failed or older than the text it checked)
node scripts/thumbnails.ts zoora-ai/<slug> --lang en --out out/episodes/<slug>

# 5. check what was made (section 8): ffprobe, loudness, frames of every scene, then the automatic visual QA of
#    every language and format (EpisodeShort: add "shortId" to the props); it writes a report with marked frames
node scripts/qa/check.ts --entry src/episode/index.ts --comp Episode --props '{"channel":"zoora-ai","slug":"<slug>","lang":"en"}'
```

Exit codes: claim gate and dub tools 0 pass, 1 failed (findings listed), 2 bad input; voice 0 ok, 1 error, 2 bad
arguments, 3 `--fit-to` overflow (files written); `render.sh` 0 delivered and passed (warnings allowed), 1 the gate or
the master failed (every file kept, the report named), 2 bad input or a step failed; thumbnails 0, 1 failed check or
claim gate, 2 bad arguments. `remotion.config.ts` already sets PNG frames, CRF 12, preset slow, yuv420p and BT.709:
pass no encoder flags.

**What `render.sh` runs: two passes and a master.** `$B` is the bundle, `$O` the output path without `.mp4`, `$P` the
props of section 3's render plus `"audioPlanHash"` (and `"shortId"` for `EpisodeShort`):

```bash
# 1. the plan: the music, the duck, the effects and the master's gate lines, computed from the files on disk by the
#    same code the render runs; JSON for the gate, a cue sheet for the owner; the plan's hash is the last line printed
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON src/episode/dev/audioPlan.ts zoora-ai/<slug> --lang en [--short short1] \
  --out "$O.audio-plan.json" --cues "$O.cues.md"
# 2. pass 1, the picture: the MP4 without audio, and the mix written beside it losslessly (pcm-16) in the same pass.
#    calculateMetadata refuses to start when its own plan hashes differently (a stale bundle, or a storyboard or
#    timeline changed after step 1)
npx remotion render "$B" Episode "$O.picture.mp4" --separate-audio-to="$O.mix.wav" --props="$P"
# 3. the voice stem: the same composition with the narration only, no picture and no fonts (13 s for the demo)
npx remotion render "$B" Episode "$O.voice.wav" --codec=wav --config=src/audio/remotion.wav.config.ts \
  --props="<$P with \"audioStems\":[\"voice\"]>"
# 4. pass 2, the master: 20 Hz high-pass, one gain to -14 LUFS-I into a true-peak limiter at -1.5 dBTP, libfdk AAC
#    320 kb/s, the picture's video stream copied untouched; measured again after the encode and after AAC and Opus
#    128 kb/s re-encodes (what YouTube serves). Over -1 dBTP after the encode, or over 0 dBTP after a re-encode, lowers
#    the ceiling and repeats the pass (at most 5 rounds)
.venv-audio/bin/python src/audio/tools/master_mix.py --wav "$O.mix.wav" --video "$O.picture.mp4" --out "$O.mp4" \
  --wav-out "$O.master.wav" --report "$O.master.json"
# 5. the gate (section 12.3): the render is the plan (a null test), Zoo on top, the duck follows the voice,
#    voice-free bed changes and transitions, the effects, the delivery
.venv-audio/bin/python src/episode/tools/audio_check.py --plan "$O.audio-plan.json" --mix "$O.mix.wav" --voice "$O.voice.wav" \
  --picture "$O.picture.mp4" --delivered "$O.mp4" --master "$O.master.json" --report "$O.audio.json"
```

- Only `<name>.mp4` has sound; the picture pass has none, so an unmastered file cannot be uploaded by mistake. Keep
  `<name>.cues.md` (the owner listens with it), `.audio-plan.json`, `.master.json` and `.audio.json` with the delivery;
  `.picture.mp4`, `.mix.wav`, `.voice.wav` and `.master.wav` are working files (11.5 MB a minute for each 16-bit WAV,
  17 MB for the 24-bit master).
- A dub's audio track (`--fit-to` voice): `render.sh zoora-ai/<slug> --lang es --audio-track --bundle <b> --out
  out/episodes/<slug>/es/audio-track.m4a` renders the mix without a picture (`--codec=wav`), masters it to .m4a (AAC)
  or .wav, and gates it the same way. It needs the master's `timeline.json` in `public/generated/`.
- Without `--bundle`, render.sh bundles into a temporary folder for that one output and deletes it afterwards; for a
  batch, bundle once after the voice step and pass `--bundle`.
- **Do not apply another loudness pass.** The delivered MP4 is mastered and gated; a second `loudnorm` (the publish
  kit's `render-plan.sh` still adds one after a plain `npx remotion render`) re-encodes the AAC and moves the true
  peak. Use render.sh for Episode outputs until the publish kit calls it.
- A plain `npx remotion render ... Episode` still works (tests, a quick look): it plays the same plan, unmastered and
  ungated, with the narration's DC offset (section 11).

After any change to the storyboard or `research.md`, re-run the claim gate, then the voice step, then the renders.
The publish kit (`node scripts/publish-kit/cli.ts <channel>/<slug>`) then writes the upload texts and a
`render-plan.sh`; see `docs/MEDIA_PIPELINE.md` §6.

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
review (section 10), every render and thumbnail of that language carries a **MACHINE TRANSLATION · needs native
review** badge, the voice step warns, and the claim report says so on its summary line.

The sheet gives the translator each string's context, a length budget (narration at most 1.1× the English; on-screen
text sized to its box), the claim tags, numbers and glossary terms that must survive, and the language's spoken
respellings (es `{on-chain|onchéin}`, `{bonding curve|bóndin kerv}`; pt-br `{on-chain|onchêin}`…). Write Spanish in
neutral Latin American (no "vosotros"; research §3.8).

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
count against `timeline.json`, and the sound gate's report `<name>.audio.json` (render.sh prints its summary: the
null test, Zoo on top, duck coverage, voice-free windows, effects, -14 LUFS-I ± 0.5 and at most -1 dBTP delivered,
after AAC and Opus re-encodes too; section 12.3). `ffmpeg -i x.mp4 -af ebur128=peak=true -f null -` should agree
with it. Listen with the cue sheet `<name>.cues.md` (section 12.4). The Remotion Studio preview plays the beds through
a per-frame broadband approximation: judge the delivered files only. Then LOOK at the
first, middle and last frame of every scene of every language, taken from the MP4, not from stills (ART_GUIDE QA).
The voice step checks lip sync itself (`timeline.warnings`); `scripts/voice/tests/test_demo_sync.py` re-checks the
built demo. Thumbnails: `out/.../<lang>/check/sheet.png` shows each one at 168×94. Then run `scripts/qa` on every
language's Episode and Short ([README](../scripts/qa/README.md)): it checks the DOM of every frame (text clipped or
outside the safe area, captions over faces, one-frame states) and pixel-checks sampled frames. Sampled frames miss
what lasts one frame or a few pixels: on the demo it caught three engine bugs the frame review had passed (section 9).

## 9. The 2026-11-24 verification run

Run from a clean `public/generated/zoora-ai/_engine-demo/` (deleted first), with the commands in sections 4 and 5.
Scratch evidence (frames, contact sheets, logs): the session scratchpad `engine/final/` (may be cleared).

Gates
- Claim gate, default run (no names list): FAIL, 1 error `no-names-list`, exit 1, as designed. With `--no-names`:
  en PASS (0 errors, 4 warnings: names not checked, 3 sources without a quote), es and pt-br PASS (0 errors, 5
  warnings: the same plus the English "Must not say" list shown for a human read); `--all --no-names`: 4 storyboards,
  0 failed.
- `dub validate`: es PASS (0 errors, 18 length warnings), pt-br PASS (0 errors, 15 length warnings).

Voice (Kokoro `im_nicola`)
- en 59.0 s, -14.15 LUFS, -1.20 dBTP, 0 warnings. es 73.7 s, -14.18 LUFS, -1.19 dBTP; pt-br 71.9 s, -14.01 LUFS,
  -1.27 dBTP; each with 1 warning, the machine-translation notice. Against the builds made earlier the same day, every
  speech length and word timing is identical, and 4, 4 and 9 mouth frames differ (of 1770, 2211 and 2157).
- Lip sync by the demo test's own measure: every phrase end within 2 frames of the voice, every onset 0-2 frames
  ahead (mbp presses 2-3 frames ahead), no 1-frame shapes, in all three languages.
- Found and fixed during this run: the first clean build failed `test_demo_sync.py` (es s04 opened the mouth 3 frames
  before a phrase; the build before had -1) and lost the lip press of en's first word, because Kokoro's output differs
  slightly per build (section 11). The voice step now keeps a press right before a phrase through its silence gate and
  moves any landmark the check finds out of tolerance (`scripts/voice/README.md`, rule 7). Two more scratch rebuilds:
  es needed the same move at s04 (2 frames, -3 → -1) and passed; pt-br passed unchanged.

Renders. The demo was rendered in four passes as the fixes below landed; the final files are the en episode and the
three Shorts of pass 3 and the es and pt-br episodes of pass 4 (the pass-4 fix does not move the others' sources lines:
stills from both bundles at frames that show them are pixel-identical). All H.264 High, yuv420p, BT.709, tv range, 30 fps, AAC-LC 48 kHz
stereo; video length equals the timeline to the frame; the AAC stream runs 1-15 ms longer.

| Output | Frames | Length | Loudness | True peak | Size |
| --- | --- | --- | --- | --- | --- |
| en `episode.mp4` 1920×1080 | 1770 | 59.0 s | -14.1 LUFS | -4.2 dBFS | 9.3 MB |
| en `short1.mp4` 1080×1920 | 435 | 14.5 s | -14.0 LUFS | -4.2 dBFS | 2.2 MB |
| es `episode.mp4` | 2211 | 73.7 s | -14.2 LUFS | -4.2 dBFS | 11.7 MB |
| es `short1.mp4` | 618 | 20.6 s | -14.0 LUFS | -4.2 dBFS | 2.9 MB |
| pt-br `episode.mp4` | 2157 | 71.9 s | -14.0 LUFS | -4.3 dBFS | 11.3 MB |
| pt-br `short1.mp4` | 615 | 20.5 s | -13.9 LUFS | -4.3 dBFS | 2.9 MB |

- Looked at: the first, middle and last frame of every scene of the six final MP4s (90 frames, taken from the MP4s),
  full-size crops of the es hook title and of the es and pt-br sources lines before and after the fix, the 15 frames of
  the es Short's CTA title rise, and (first pass) a 32-frame strip of the en Short's first transition. Zoo and Badger
  on model in every frame (Badger's dark ear cap on the viewer's right, one teal tag, the withers patch), Badger in 5 of
  7 scenes and in an insert in each Short scene; translated text and accents (PRIMER DÍA, ¿Quién tiene el
  suministro?, sobrevivência), the "(cita traducida)" / "(citação traduzida)" attributions, "bonding curve" and the
  MACHINE TRANSLATION badge on every es and pt-br frame; charts green up and red down with the illustrative label (and
  the localized chip in es/pt-br). A title's first frame can show a descender cut by its rising mask ("hvpe"): that is
  one frame of the 10-frame rise, not a defect.
- All 12 transitions of the final files (3 per episode, 1 per Short) run in silence: the loudest frame inside any
  transition window is -92.8 dBFS. (These renders had no music. Since 2026-11-25 a transition is **voice-free**: the
  bed plays through it and Zoo never speaks in it; the sound gate checks every transition window, section 12.) The Shorts' button column (x ≥ 950, y ≥ 960) is empty in every 12th frame of the
  chart scenes; only Badger's tail enters it during his inserts.
- Thumbnails (17:45 UTC; no thumbnail, character or chart code changed after them): 9 PNGs (3 per language), every
  check passed, 130.5-148.1 KB, headline contrast 15.9-16.1:1, letters 13.1-19.2 px tall at 168×94; the es/pt-br ones
  carry the badge. Warning on 6 of 9: Badger's head is drawn 5-11% past the rig box in `src/thumbnails/layout.ts` (the
  characters changed; re-run the probe).
- Audio track (`--fit-to en`, natural es, kept out of `public/`): exit 3 as expected; 6 of 7 scenes overflow at speed
  1.15 (68.5 s against 59.0 s) and every sentence is named with the share to cut (13-38%).
- Automatic visual QA (`scripts/qa`: the DOM of every frame, and 108-125 frames per episode at full size) found three
  engine bugs that the frame review had missed. All three were fixed during this run, each with a regression test
  (`src/episode/tests/review.test.ts`, "final check"; details in `src/episode/README.md`):
  1. es: the hook title's reveal mask cut the top 16% off "PRIMER DÍA" (the accent of Í was a sliver; an earlier
     review had passed it), and opening the mask alone ran the accent into the E of "EL" above. A title line with an
     accented capital now gets 0.12 em more room above it, and its mask opens 0.35 em above the line.
  2. es Episode s02, which cites one study in three sentences: the sources line blanked for one frame and wiped in
     again at each sentence (frames 281 and 455). A claim citing the source on screen now extends the line; a
     different source swaps the text in place.
  3. pt-br Episode s02: the sources card's padding pushed a long line 9 px past the right safe edge (the es card
     crossed it by 16 px). The card, padding included, now stays inside the safe area; such a line slides left and ends
     flush with the review badge.

  Final QA, run on the code that made the final files (18:37-18:46 UTC): the three Shorts PASS (0 errors, 0
  warnings); each episode FAILS on one error, Badger's face up to 14 px inside the bottom margin (section 11), and has
  0 warnings. The 45-66 notes per file "for information" (not counted) were read: text inside a reveal mask while it
  builds, chart labels crossing faces only during the s03 → s04 slide, the decorative quote mark at 2.27:1, and in the
  Shorts Google's stricter vertical-ads zone. Two are worth a look in the art review: a step line (en "Who is paid to hype
  it?", es and pt-br the second step) and the pt-br end-screen title sit inside the clear zone around Badger's and
  Zoo's faces (ART_GUIDE CV4c).

Tests (all re-run after the last code change, 18:37-18:44 UTC)

| Suite | Command | Result |
| --- | --- | --- |
| Typecheck, whole project | `npx tsc --noEmit` | exit 0 |
| Engine | `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON src/episode/tests/run.ts` | 68/68 |
| Thumbnails | `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test src/thumbnails/test/thumbnails.test.ts` | 16/16 |
| Claim gate + dub tools | `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/claims/tests/claims.test.ts scripts/dub/tests/dub.test.ts` | 107/107 |
| Back-translation | `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/backtranslate/tests/*.test.ts` | 120/120 |
| Show, branding (use engine parts) | `node … src/show/tests/run.ts`, `node … src/branding/tests/run.ts` | 35/35, 34/34 |
| QA tool, unit | `node … --test scripts/qa/tests/*.test.ts` | 63/63 |
| Charts (read-only here; drawn by the chart scene) | `npm run test:charts` | exit 0: 10,000 seeds with 0 issues, 9/9 bad series caught |
| Voice, unit | `python3 -m unittest discover -s scripts/voice/tests -t scripts/voice` | 134 run, OK (12 synthesis tests skipped) |
| Voice, with real synthesis in 7 languages and the built demo | `.venv-voice/bin/python -m unittest discover -s scripts/voice/tests -t scripts/voice` | 134/134 (284 s) |

## 10. Owner review steps (before anything is published)

1. **Names list.** Create `data/private/names.txt` (one name or `@handle` per line) with the real names behind every
   `[named person]` in the research files, then re-run the claim gate without `--no-names`. Until then no report has
   checked names.
2. **Read the claim reports** (`out/claims/<slug>.<lang>.md`): the claims and their sources, every waiver, the rules
   the gate could not check, and the warnings. Open the cited pages yourself where a fact matters.
3. **Watch and listen** to every render with sound, at full size and on a phone. Check Zoo and Badger against the
   model sheets, the charts (green up, red down, "Illustrative · fictional token"), captions and the mouth. Listen with
   the render's cue sheet and decide the sound questions in section 12.4; publish only files `render.sh` delivered
   with the gate passed.
4. **Native-speaker review of every dub, before it is published in any form** (an upload, an audio track, a
   localized title or thumbnail):
   - a native speaker reads every line aloud against the review sheet at the end of `out/dub/<slug>.<lang>.md` and
     the back-translation report (`scripts/backtranslate`), listens to the dubbed `narration.wav`, and checks the
     respellings, numbers, the disclosure and fiction wording, the translated quotes and the `## Must not say (<lang>)`
     section;
   - fixes go through the sheet (`dub prepare` carries the rest over, then `dub import`), never by hand-editing only
     the storyboard;
   - then only the owner sets, in `storyboard.<lang>.json`, the full record
     `"translation": {"status": "native-reviewed", "method": "<machine or human, as imported>", "reviewed": true, "reviewer": "<initials or role>", "date": "YYYY-MM-DD"}`
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
- Landscape hook and steps: while Badger looks up at the end of those scenes, his face and ears sit up to 14 px inside
  the 54 px bottom margin (ART_GUIDE MO18) for 1.5-1.7 s (es: frames 122-173 and 1154-1199). `scripts/qa` reports it as an error in every
  episode; the engine's own face test allows landscape faces down to the frame edge (y 1080) on purpose, since Badger
  stands in the bottom corner, cropped by the frame. A placement call for the art review, not changed here.
- Only the hook title has room for accented capitals. The wipe reveals of the talk, steps and end-screen titles still
  clip at their box top, which could shave the tip of an accent on a capital at the start of a title (none in the demo).
  Run `scripts/qa` on every dubbed render: it reports such clipping as `text-clipped`.
- Zoo and Badger are being repaired in parallel (repair round 2): renders use the character code present at bundle
  time, and the thumbnail rig boxes (`src/thumbnails/layout.ts` RIG) need a probe re-run after character changes.

Sound (2026-11-25; section 12)
- **Nobody has heard it.** Every sound claim is a measurement: levels, the null test, masking indices, timing against
  the word timings. The owner's listening pass (12.4) decides the open questions.
- The gate's acoustic lines were calibrated on the one demo (59-74 s, 3 languages × 4 moods × 5 clock offsets, 60
  mixes and 40 wrong-duck controls); recheck them on the first real episodes (`audio_sim.py`, 12.5).
- The demo places no effect: its narration leaves no 4-frame gap at any reveal and its slides are silent by rule.
  The effect rules are tested on padded fixtures only.
- The bed level table (`bedLevels.json`) and the harmony table (`moods.ts` `HARMONY`, copied from the composer's
  scores) describe today's beds: after the composer re-renders a story bed, run `bed_levels.py` (the engine test
  fails on a changed bed) and update `HARMONY` by hand (no test compares it with the score).
- The sting is opt-in and the demo's hook has no room for it (the render names the `minDurationSec` it would need);
  it has been measured on a padded fixture only.
- The Studio preview plays the beds through a per-frame broadband approximation. Judge the delivered files only.
- Picture renders are the slow part: 134-174 s for the 59-74 s demo episodes on this 4-core machine; the voice stem
  adds 11-14 s and the master and the gate about 26 s (12.5 has the proof times and a 12.75-minute probe).
- Kokoro's narration carries a DC offset; the master's 20 Hz high-pass removes it from the delivery. A plain
  `npx remotion render` keeps it (src/audio README, Limits).
- The end screen's music is not the same in every language: the music-up plays wherever the episode's one clock
  sits in the 64 s resolve loop when the end screen starts. On the demo, en plays the loop's hi-hat section and
  wraps to its sparse first section at 0:51.1, 8 s before the end; es plays only the sparse section. The end-screen
  music measures -18.2 LUFS (en) against -21.4 LUFS (es); listen to both (12.6).
- Transitions are voice-free, not silent: the bed plays through them at about -29 to -36 LUFS (12.6). Literal
  silence in a transition would be a design change (a rest in the plan), not a fix.

## 12. Sound: music, effects, the master and the gate

Added 2026-11-25. Every Episode and Short plays the music package (`public/audio/music/`, the four Zoora AI story
beds and their `-underscore` versions) and the SFX library (`public/audio/sfx/`) under Zoo's narration, through
`src/audio` ([README](../src/audio/README.md)). **Nobody has heard the result yet**: everything below was measured,
not judged by ear (this environment has no audio output). The owner's listening steps are in 12.4.

### 12.1 The plan

`src/episode/audio/plan.ts` decides everything before frame 0, from the storyboard, the timeline (and, for a dub, the
master's), the music and SFX manifests and the beds' level table (`src/episode/audio/bedLevels.json`). It is pure:
the render's `calculateMetadata`, the audio-plan CLI and the tests run the same code, and the plan is plain JSON with
a SHA-256 hash. Every number below is in `src/episode/audio/constants.ts`.

- **Moods by act, not by template.** `scene.bed` marks "from here on" (section 3); without one the story plays
  `curious`. A region lasts at least 8 bars (25.6 s) unless the writer set it, and the bed changes at most once a
  minute (the end screen excepted). Under speech each mood plays its `-underscore` version (motif and lead muted).
- **The same level under the voice.** The tension and ominous underscores play 2.2-2.5 dB louder under the duck than
  curious; each bed is trimmed (never raised) to the curious level: curious 0, resolve -1.1, ominous -2.1, tension
  -2.5 dB. Without the trim, correct tension mixes failed the gate's worst-phrase and index lines.
- **One clock.** Every bed of an episode plays on one musical clock: a bed entering at frame `f` starts `f × 1600`
  samples into its 64 s loop, plus an offset of a whole 4-bar phrase (0-4 × 12.8 s), so the music never jumps
  between sections at a change. The planner tries the phrases in a seeded order (the loop's base section first) and
  takes the first whose estimated worst phrase sits 14 LU under the voice (2 LU above the gate's line); `music.offset`
  overrides it. A Short uses the offset of its own seed.
- **The opening** fades in from silence over the first sentence (1-4 s): the hook's first words are never fighting a
  full bed, and no effect plays in the opening scene.
- **Bed changes only where Zoo is silent:** in the window from the outgoing scene's last sound to the incoming
  scene's first voiced frame (or 12 frames in), with a guard frame each side. An equal-power crossfade of 9-24 frames;
  where the two beds' bars clash at that moment (a semitone between notes foreign to each other, from the composer's
  scores: `src/episode/audio/moods.ts` `HARMONY`) the fades are staggered: a short breath, listed in the cue sheet
  for the owner to judge. With less room than 9 frames the bed plays on to the next boundary with room.
- **The duck:** 2 / 12 / 4 dB below 700 Hz / 700 Hz-5 kHz / above 5 kHz (the band-split duck the voice gate
  measured), 120 ms attack with lookahead, 1.2 s release. Pauses under 2 s stay ducked, and the duck is also held
  through every scene change with less than 3 s of silence, every bed change, and every Badger reaction beat (from 6
  frames before his reaction to 30 frames after it, or Zoo's turn + 10): the joke lands on a steady bed, not a swell.
- **Rests.** After 2 loops (128 s) of one bed, the bed dips 18 dB (never to digital silence) for a scene and at least
  8 bars, then comes back on a phrase start under the duck; a rest late in a region carries on to the next bed change.
- **The end screen:** `bed-story-resolve-underscore` under the outro line, then, once the duck has released, a
  2-beat equal-power "music up" to the motif version (+8 dB) ending on a bar line, faded over the last 2 s so it ends
  on the last frame. Without an end screen the bed fades over the final voice-free tail.
- **Shorts:** one bed for the whole Short (its first scene's mood, or `shorts[].bed`), ducked from the Short's own
  windows, fading in over the first sentence and out over at most the last 12 frames (a clean loop on replay); no
  sting.
- **Effects, sparingly** (PROJECT_INSTRUCTIONS: restraint). A list item (bullet, step) gets a soft pitch-stable pop
  (-30 LUFS) only where Zoo leaves a 4-frame gap from 1 frame before to 4 frames after its reveal; the CTA's click
  only when the button press lands in a gap of the speech; a wipe gets a short whoosh (at most -24 LUFS and 6 LU over
  the bed, its pass-by on the wipe's fastest frame) unless its tail would reach the first word; a slide is silent
  unless `sfx.transition` is true; the chart's rug is silent unless `sfx.accent` is true. At most 3 effects in 10 s, 6 a minute and 6 a scene,
  6 frames apart, and nothing within 0.5 s of a spoken disclosure. Every effect left out is listed with its reason.
  On the demo, whose narration runs without 4-frame gaps at its reveals, no effect is placed.
- **The brand sting** (`music.sting: "after-hook"`, off by default): `intro-sting-zoora` (4.5 s) after the hook, in
  a slot that starts after the hook's last sound, Badger's reaction + 30 frames and the fiction card, keeps at most
  4 s without narration in the first 12 s, and cuts to the next scene; the bed rests under it. Never in Shorts.
- **Dubs.** A dub's plan needs the master's storyboard and timeline (the render names the missing file). The bed map,
  offset and sting come from the master storyboard; a native dub's duck, windows and effects follow its own voice; an
  audio track (`--fit-to`) places effects on the master's picture and checks every window against the dub's voice.

### 12.2 The cue sheet

`<name>.cues.md` lists every bed segment (cue, in and out, loops, clock position, level, fades), every change with its
timecode and voice-free window, the breaths and dips to judge, the duck and its holds, the sting, every effect placed
and every effect left out with its reason, and what to listen for.

### 12.3 The gate (`src/episode/tools/audio_check.py`)

The gate runs on the render's own lossless mix, its voice stem and the delivered file. It fails the delivery (exit 1)
on any FAIL line; WARN lines are read by a person.

| Check | What | Line |
| --- | --- | --- |
| null | The render is the plan: mix − voice − (beds, stingers and effects rebuilt from the plan) | residual ≤ -60 dBFS peak |
| voice-over-rest, worst-phrase | Zoo over everything else under speech; the worst phrase | ≥ 10 LU (warn < 14); ≥ 12 LU (warn < 13) |
| index, index-p10, under-3db | The band-audibility index and the 1-4 kHz frames under 3 dB | ≥ 0.75; ≥ 0.45; ≤ 16 % |
| worst-phrase-snr | The worst phrase's median 1-4 kHz voice-to-rest ratio (Zoo's consonants) | ≥ 12.5 dB (warn < 13) |
| phone | The same on a phone-speaker model | warn < 12 LU |
| duck-coverage | The bed's mid band at least 10 dB down while Zoo is heard | ≥ 98 % of voiced 10 ms frames |
| voice-free | No voice in a bed change, a fade, the sting slot or a transition | ≤ -60 dBFS |
| sfx-masking | Effects over the voice: 1-4 kHz voice-to-rest, first 150 ms (phone model in Shorts) | fail < 6 dB, warn < 10 dB |
| protect | The first second of speech and a spoken disclosure | ≥ 15 LU and ≥ 15 dB |
| premaster-peak, master-gain, limiter | Remotion's sum has headroom; the master's gain within ±3 dB; the limiter on transients only | < -0.1 dBFS; ±3 dB; warn > 1 % |
| platform-reencode | True peak after AAC and Opus 128 kb/s re-encodes | fail > 0, warn > -0.5 dBTP |
| loudness, true-peak, dc, dialogue | The delivery (ours and ffmpeg's meter) | -14 ± 0.5 LUFS-I; ≤ -1 dBTP; ≤ 0.001; dialogue warn outside -15 to -12.5 LUFS |
| streams | AAC-LC 48 kHz stereo, the picture's video stream copied bit for bit, audio as long as the video | |
| plan-rules | Effect caps and spacing, no effect in the opening scene or near a disclosure, the clock, the final fades | |

Before the null test the gate proves its Python port of the gain law against the TypeScript one (the plan's
`gainProbe`). A wrong duck (the English duck under the Spanish voice) passes the loudness lines almost as well as a
good one, and is caught either way: a plan built from the wrong timeline fails duck coverage (73-75 %) and the worst
phrase's 1-4 kHz ratio; a render that plays something other than its plan fails the null test (12.5).

### 12.4 Listening (the owner)

Listen on headphones and on a phone speaker, with the cue sheet open, before anything with sound is published:

1. The demo deliveries: `out/episodes/_engine-demo/sound/<lang>/episode.mp4` and `short1.mp4` (en, es, pt-br), each
   with its `.cues.md`.
2. The A/B clips in `out/episodes/_engine-demo/sound/listen/` (offline mixes from the plan, mastered like a delivery;
   each with its cue sheet and plan):
   - `en.as-delivered.m4a` against `en.sfx-on-every-reveal.m4a`: no effects (the rule: pops only in gaps of the
     speech) against a pop on every bullet and step reveal, 3 dB down where it lands on a word;
   - against `en.release-450ms.m4a`: the duck's 1.2 s release against the AudioDemo's 450 ms (more "breathing"
     between sentences);
   - against `en.no-opening-fade.m4a`: the bed fading in under the first sentence against starting at full level;
   - `es.as-delivered.m4a` against `es.wrong-duck.m4a`: what the gate's null test and duck coverage catch (the
     English duck under the Spanish voice);
   - `en.sting-on.m4a` against `en.sting-off.m4a`: the brand sting after the cold open, on a scratch copy of the demo
     whose hook has five sentences (the demo's own one-sentence hook leaves no room for it).
3. Decide, and tell the engine's owner:
   - Are the bed changes and breaths clean (no smear of two keys, no dropout)? The cue sheet lists each one.
   - Is a transition with the bed playing through it right (the rule is now "voice-free", not silent)?
   - Release 1.2 s or 450 ms? Effects only in gaps (today) or on the reveal frame? When the CTA press lands on a
     word: no click (today), or a click just after the word?
   - Should the brand sting play after the hook by default (it needs a longer hook)?
   - Is the music level under Zoo right (about 17 LU under him on the demo), on the phone too?

### 12.5 Measured on 2026-11-25 (not heard)

**Gate calibration** (`src/episode/tools/audio_sim.py`, offline mixes rebuilt from the plans): 60 correct mixes (the
demo in en, es and pt-br, each story mood forced over the whole episode, each of the 5 clock phrases) against 40
wrong-duck controls (es and pt-br under the English plan's duck):

| Measure | Correct mixes | Wrong-duck controls | Line |
| --- | --- | --- | --- |
| Zoo over the rest under speech | 15.97-18.09 LU | 15.36-16.56 LU | ≥ 10 LU |
| Worst phrase | 14.05-16.39 LU | 12.36-14.87 LU | ≥ 12 LU |
| Band-audibility index / its P10 | 0.786-0.868 / 0.475-0.670 | 0.781-0.831 / 0.449-0.618 | ≥ 0.75 / ≥ 0.45 |
| Frames under 3 dB at 1-4 kHz | 7.4-13.7 % | 11.8-18.2 % | ≤ 16 % |
| Worst phrase at 1-4 kHz | 13.3-19.1 dB | 2.3-12.1 dB | ≥ 12.5 dB |
| Duck coverage | 100 % | 72.8-74.8 % | ≥ 98 % |
| Result | all 60 pass | all 40 fail 2-4 lines (coverage and the worst phrase at 1-4 kHz in every one) | |

Under these quiet, trimmed underscores a wrong duck costs only about 1 LU overall, so the loudness and index lines
cannot tell it apart; duck coverage and the worst phrase's 1-4 kHz ratio can, and the null test catches any render
that differs from its plan. Before the bed trims (12.1), correct tension mixes measured 14.0-14.8 LU over the rest
and failed the worst-phrase line (11.55 LU) and the index P10 line (0.471). The worst-phrase lines were set on mixes
of 8-10 phrases; a 10-minute episode has about 15 times more, so its worst phrase will sit lower: recheck the lines
on the first real episodes.

**Proof renders** (`render.sh`, one bundle, `out/episodes/_engine-demo/sound/<lang>/`; every check passed with no
warning). Each Episode plays curious under the story, a staggered change (the bars clash) to the resolve underscore
in the voice-free window before the end screen, the music-up and the final 2 s fade; each Short one curious bed. No
effect is placed (12.1). Clock phrase 1 everywhere (the first estimate over 14 LU).

| Output | Null test | Zoo over the rest / worst phrase | Worst phrase at 1-4 kHz | Duck coverage | Delivered | AAC / Opus 128 kb/s | Render (picture + mix, voice stem, total) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| en `episode.mp4` (59.0 s) | -81.1 dBFS | 16.7 / 15.9 LU | 16.4 dB | 100 % | -14.02 LUFS, -2.1 dBTP | -2.1 / -2.2 dBTP | 134 s, 11 s, 171 s |
| en `short1.mp4` (14.5 s) | -86.7 dBFS | 17.3 / 16.5 LU | 21.3 dB | 100 % | -14.01 LUFS, -4.3 dBTP | -4.3 / -3.9 dBTP | 38 s, 6 s, 55 s |
| es `episode.mp4` (73.7 s) | -80.9 dBFS | 16.7 / 14.2 LU | 16.5 dB | 100 % | -14.01 LUFS, -2.6 dBTP | -2.6 / -2.5 dBTP | 174 s, 14 s, 215 s |
| es `short1.mp4` (20.6 s) | -86.6 dBFS | 17.0 / 16.4 LU | 17.6 dB | 100 % | -14.01 LUFS, -3.2 dBTP | -3.2 / -3.0 dBTP | 36 s, 5 s, 52 s |
| pt-br `episode.mp4` (71.9 s) | -80.9 dBFS | 17.0 / 15.5 LU | 16.4 dB | 100 % | -14.01 LUFS, -3.0 dBTP | -3.5 / -2.8 dBTP | 146 s, 14 s, 186 s |
| pt-br `short1.mp4` (20.5 s) | -86.6 dBFS | 17.1 / 16.7 LU | 17.6 dB | 100 % | -14.01 LUFS, -3.7 dBTP | -3.6 / -3.7 dBTP | 39 s, 6 s, 55 s |

The master's gain was -0.16 to +0.96 dB and the limiter never acted (0 % of blocks over 1 dB); voice-free windows
held the voice at -85.7 dBFS or quieter; the first second of speech sat 40.9-43.5 LU over the music (the bed is
still fading in); dialogue after the master measured -14.0 to -13.1 LUFS. Every delivered video stream is
bit-identical to its picture render, and the audio runs exactly as long as the video.

### 12.6 Second proof on the demo, measured independently (2026-11-25)

Run on commit 13f1456 with a clean tree and the commands of section 4: the claim gate with the private names list
(en PASS, 0 errors, 3 warnings; es PASS, 0 errors, 4 warnings; 57 names checked), one bundle, then `render.sh` for the
en and es Episode and short1. All four gates passed with no warning, and every gate number equals 12.5 (the same
plans, so the same mixes). Each delivery was then measured again outside the gate: ffmpeg `ebur128` and `loudnorm` on
the MP4; the AudioDemo's `measure_mix.voice_on_top` on the decoded AAC (Zoo as delivered = the voice stem through the
master's own 20 Hz high-pass and gain, the rest = the decoded file minus that); word times and transition windows
recomputed from `timeline.json` with `timing.ts` instead of read from the plan.

| Output | Integrated, ffmpeg / ours | True peak | LRA, whole / to 1 s after the last word | Zoo over the rest, delivered / worst phrase | Phone model | Index / P10 | Frames under 3 dB at 1-4 kHz |
| --- | --- | --- | --- | --- | --- | --- | --- |
| en `episode.mp4` | -14.0 / -14.02 LUFS | -2.1 dBTP | 6.5 / 2.3 LU | 16.7 / 15.9 LU | 15.8 / 15.0 LU | 0.844 / 0.627 | 10.4 % |
| en `short1.mp4` | -14.0 / -14.01 | -4.3 | 2.2 / 2.2 | 17.3 / 16.5 | 16.5 / 15.7 | 0.894 / 0.756 | 5.6 % |
| es `episode.mp4` | -14.0 / -14.01 | -2.6 | 9.1 / 2.7 | 16.7 / 14.2 | 15.5 / 13.0 | 0.850 / 0.661 | 7.4 % |
| es `short1.mp4` | -14.0 / -14.01 | -3.2 | 2.7 / 2.7 | 17.0 / 16.4 | 16.0 / 15.4 | 0.873 / 0.719 | 6.6 % |

- **LRA.** The episodes' wider whole-file range comes from the end screen's music alone (-18.2 LUFS en, -21.4 es);
  the story itself holds 2.3-2.7 LU, every scene before the end screen between -12.6 and -13.7 LUFS-I.
- **AAC.** Every file decodes under `ffmpeg -xerror` without an error: AAC-LC, 48 kHz, stereo, 320 kb/s, audio and
  video both 59.000 / 14.500 / 73.700 / 20.600 s. The decode is sample-aligned with the 24-bit master WAV (lag 0) and
  matches it at 39.9-43.5 dB SNR below 16 kHz; it runs 320-384 samples past the last frame at -92 dBFS or quieter
  (encoder padding). Remotion's ffmpeg has no libfdk_aac decoder, so only ffmpeg's own decoder was used.
- **The first 2 s.** No stinger and no effect in any plan. The bed fades in from silence under the hook: -50 / -52
  LUFS momentary at 1 s and -37 / -39 LUFS at 2 s (en / es), still 6-8 LU under its later ducked level (about -31
  LUFS) and at least 21.3 LU under Zoo in every 400 ms window. In es the voice starts 55 ms before the timeline's first
  word, so the mid-band duck is 6.8-8.3 dB on two 10 ms frames, where the bed is still at -83 dBFS.
- **Bed changes and effects against the words.** No effect is placed (9 left out per episode, 2 per Short, each with
  its reason in the cue sheet). The bed change before the end screen, the music-up and the final fade overlap no
  word, and the voice stem is at -85.7 dBFS or quieter inside them; only the opening fade-in runs under the first
  sentence, by design (12.1). The staggered change dips the bed 11.1 dB (en) and 12.4 dB (es) for 30 ms: the breath
  the cue sheet asks the owner to judge.
- **Transitions** (fade, slide and fade in each episode, one fade in each Short): voice-free, not silent. Zoo stays
  under -87.5 dBFS (10 ms RMS) and -78.3 dBFS peak in every window, and no effect plays; the bed plays through at -29
  to -36 LUFS. In es the timeline's last word of s03 ("agonía.") ends 25 ms into the slide (Kokoro's phrase-final
  overrun, section 11) while the voice stem is already under -98 dBFS there.
- **The picture is unchanged.** The pre-audio engine (`src/episode` at a2cb0ca) with the same characters renders
  bit-identical pictures: each of the four picture MP4s has the same MD5 as the pre-audio engine's, and each delivered
  MP4 carries that video stream bit for bit. The frames around every scene boundary were also looked at, taken from the delivered MP4s.
- **For the listening pass.** The end-screen music differs by language (section 11): en has a hi-hat layer (above
  6 kHz, about -35 dBFS) that stops at 0:51.1 when the resolve loop wraps to its sparse first section; es never
  has it. The engine's music-master profile (`metrics.py --profile standalone`, information only, as for the
  AudioDemo) reads mud 8.0-9.2 dB (Zoo's voice), a -6.0 to -6.3 dB/oct tilt and, on two files, "hum": sustained bed
  bass notes near 49 and 61 Hz showing in the mix's 10th-percentile floor (the voice and the music alone read 0-4.7
  dB); nothing here is recorded.
- **Visual QA** (`scripts/qa`): both Shorts PASS (0 errors, 0 warnings). Each episode FAILS on one error, 0
  warnings: Badger's face and ears 14 px inside the bottom margin for the whole steps scene (en frames 669-875, es
  918-1199), the placement call in section 11, now over the whole scene since the Badger head rescale. The picture is
  the pre-audio engine's, bit for bit, so this is not a sound regression.

Evidence (renders, plans, cue sheets, gate and measurement JSON, frames, QA reports) is in the session scratchpad
`ep-audio/` and may be cleared.

