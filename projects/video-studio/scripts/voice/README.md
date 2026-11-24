# Voice step

Narration → Kokoro audio → word timings → ZOO's mouth shapes, for every language ZOO speaks.
Implements the `Timeline` contract in `src/episode/types.ts`. Built and verified 2026-11-24.

## Setup (once per machine)

```bash
cd projects/video-studio
scripts/voice/setup.sh        # idempotent; about 15 s here, 2 s when everything is already in place
```

- Creates `.venv-voice/` (gitignored) and installs the exact pins in `requirements.txt` (base set) and
  `requirements-cjk.txt` (ja/zh G2P; skip with `VOICE_SKIP_CJK=1`).
- Downloads `kokoro-v1.0.int8.onnx` (114,119,327 B) and `voices-v1.0.bin` (28,214,398 B) from the
  kokoro-onnx `model-files-v1.1` GitHub release into `.cache/kokoro/`, and refuses any file whose
  size or sha256 differs from the pin. `KOKORO_LOCAL_DIR=<dir>` copies instead of downloading (still verified).
- Needs Python 3.13 (tested), ffmpeg on PATH, and a C compiler for `mojimoji` (ja only).

## Build

```bash
python scripts/voice/build.py content/<channel>/<slug> --lang en
python scripts/voice/build.py content/<channel>/<slug> --lang es --fit-to en   # dub that matches the en timeline
python scripts/voice/build.py content/<channel>/<slug> --lang en --voice am_michael --speed 1.0
```

`build.py` re-executes itself inside `.venv-voice` when that exists. It reads `storyboard.<lang>.json`, or
`storyboard.json` when that file's `lang` matches. It writes to `public/generated/<channel>/<slug>/<lang>/`:

| File | What |
| --- | --- |
| `narration.wav` | One continuous mono 24 kHz PCM-16 track, normalized to -14 LUFS / -1 dBTP (see Loudness) |
| `scenes/<id>.wav` | Each scene cut sample-exactly from `narration.wav` (`TimelineScene.audio` points here) |
| `timeline.json` | The `Timeline` contract, plus the recorded additions below |
| `phonemes.json` | Debug: spoken text, phonemes, alignment method, fit tries and the loudness chain per scene |

Exit codes: `0` ok · `1` error (message on stderr) · `2` bad arguments · `3` `--fit-to` overflow (files are
written; shorten the translation, see `warnings` and `scenes[].overflowMs`). Other options: `--out-root`,
`--model-dir`, `--fps`, `--tail-ms`, `--last-tail-ms`, `-q`.

| Lang | Kokoro voice (male, ZOO) | G2P |
| --- | --- | --- |
| en | `am_michael` (owner may change) | espeak-ng `en-us` |
| es | `em_alex` | espeak-ng `es` (Castilian) |
| pt-br | `pm_alex` | espeak-ng `pt-br` |
| hi | `hm_omega` | espeak-ng `hi` |
| it | `im_nicola` | espeak-ng `it` |
| zh | `zm_yunjian` | misaki 0.7.4: jieba + pypinyin, tone arrows |
| ja | `jm_kumo` | misaki 0.7.4: MeCab (fugashi + unidic-lite) |

French has no male Kokoro v1.0 voice, so it is not supported.

Without `--voice`, Zoo's voice comes from `content/<channel>/channel.json` (`zooVoice.byLang[lang]`, else
`zooVoice.default`): the owner's binding choice is `im_nicola` for every language (CLAUDE.md, 2026-11-24). The table's
per-language voices apply only to content without a `channel.json` (for example the test fixtures). Added 2026-11-24
(engine demo), tested in `tests/test_channel_voice.py`.

## Narration markup

- `{display|spoken}`: captions show `display`, Kokoro says `spoken`: `{$40,000|forty thousand dollars}`.
  `{|uh}` is spoken only, `{SOL|}` shown only. A multi-word display shares the spoken span.
- `[src:id]` (or `[src:a,b]`): removed from captions and speech, with the whitespace repaired.
- Malformed markup fails the build before any synthesis, naming the scene.

## Text normalization (`voicelib/normalize/`)

Numbers, currencies, percentages, dates and symbols become words per language, from hand-written tables
(no num2words: 0.5.14 is LGPL-2.1 and has no Hindi or Chinese module). Captions keep the written form, and each display token
maps to its own spoken string. Tested cases include `$40,000`, `68.67%`, `2026`, `1.5M` and `0.25 SOL` in
all six languages (`tests/test_normalize.py`).

- en: US style ("four hundred two"), years in pairs, dates with ordinals, `$1.50` → "one dollar and fifty cents".
- es / it / pt-br: comma decimals ("coma", "virgola", "vírgula"), apocope ("un dólar", "veintiún mil"),
  "de/di" after an exact million, pt-br "e" connectors and singular below 2 ("1,5 milhão").
- hi: Indian grouping (लाख, करोड़); "$1.5M" → "पंद्रह लाख डॉलर"; the danda is spoken as a full stop.
- zh: 万/亿 grouping, 零 rules, 两 before 千/万/亿; years digit by digit before 年; signed % → 上涨/下跌.
- ja (minimal; misaki reads integers itself): separators, currency, %, decimals and 1.5M.
- Written-number conventions: es/it/pt-br read "68.67" as a decimal and "40,000" as forty thousand,
  because crypto copy is often written English-style. Use markup whenever a number could be read two ways.
- Tickers: BTC → bitcoin, ETH → ether, SOL → sol, USDC/USDT spelled out. Native review decides the house style.
- Since 2026-11-24 (review): multi-character currency prefixes with or without a space (`US$40,000`, `R$ 40 mil`,
  `A$5`, `C$10`, `MX$200`) and a sign before a separate number (`€ 200`); percent ranges (`5-10%` → "five to ten
  percent", "cinco a diez por ciento", never "five minus ten"); `#1` / `nº 1` → "number one"; es/pt-br/it `10h30`
  ("dez e trinta", feminine "duas horas"), also spaced (`10 h` → "diez horas", never "diez hache"); fractions up to tenths (`1/3` → "one third", "un tercio", "um terço").
  Every case the review found is in `tests/test_normalize.py` (`ReviewCases`).
- The build **warns** when a spoken token still holds a digit or one of `$ % # € £ ¥ ₹ /` after normalization
  (espeak would read it as written); write such a case as `{display|spoken}`.

## Pronunciation lexicon (`voicelib/lexicon.py`)

Applied to each written token before G2P (captions keep the written form): en `memecoins` → "meme coins" (espeak said
MEM-ih-coins), `DeFi` → "dee fye", `CEX` → "C E X", `KOL(s)` → "K O L('s)", `Pump.fun` → "Pump dot fun" (espeak read
the dot as a sentence break), plus `NFTs`, `ATH`, `DYOR`, `KYC`, `AML`, `degen(s)`; es `on-chain` → "onchéin", pt-br
"onchêin" (espeak es said "on-cháin"), `Pump.fun` respellings, and the dub glossary's other single-word respellings
(`memecoin(s)` → "mimcoins" / "mímcoins", `CoinGecko`, `Bubblemaps`; `tests/test_normalize.py` keeps the two lists equal),
so a dub that forgets the markup is read the same way. A `{display|spoken}` pair still wins. The es/pt-br entries are
machine-made respellings for the native reviewer.

## Word timings

espeak phonemizes each scene in context, which keeps the audio natural. Per-word phonemization was
measured to say "a" as `ˈeɪ`, "to" as `tuː` and drop flaps. Kokoro reports one timing per phoneme character.
- Phoneme-word count equals the spoken-word count: 1:1.
- Otherwise (espeak merges "in the" into `ɪnðə`, "that the" into `ðætðə`, or splits numbers): a phonetic
  Needleman-Wunsch alignment of each word's isolated phonemes against the contextual stream, exact to the phone.
- If that alignment is poor: proportional by phoneme length, with a warning in `timeline.warnings`.
- zh/ja: exact, because phonemes are built word by word.

Words are scene-relative integer ms. Punctuation-only tokens join the previous caption word. zh/ja
captions join words without spaces. `stressMs` (an optional contract field, read by the episode engine
for head accents, ART_GUIDE MO11) is the onset of a word's last primary-stressed vowel, taken from the
timing of Kokoro's `ˈ` mark. It is absent for unstressed clitics and for zh/ja, which have no stress marks.

## Mouth shapes (`voicelib/visemes.py`)

ART_GUIDE LP2/LP3 (binding), one `MouthShape` per frame at 30 fps:
- Mapping: p b m → mbp; rounded vowels and w → oh; open vowels → ah; i ɪ e j → ee; other phones →
  slightlyOpen. ː, aspiration, nasalization and tone arrows fold into the previous phone; stress marks
  and ʔ fold into the next.
- Snap to the audio (2026-11-24, review): Kokoro gives the last phone before punctuation 300-400 ms while the voice
  stops about 250 ms earlier, and the residual after it sits 34-39 dB under the peak, so the mouth stayed open 5-10
  frames after every phrase. Now the phrase-final phone ends where the take's 5 ms energy falls more than 28 dB under
  the phrase peak (+15 ms), and a phone after a pause (or a voiced space) starts where its sound starts, at most
  120 ms earlier. Kokoro's token timings also run about 47 ms behind the sound (cross-correlation of token openness
  with the energy envelope); every timing moves 47 ms earlier (`voicelib/takes.py`), words and stress marks too.
- Per-language overrides: es/it β → mbp; hi ə → ah (a full vowel, not an English schwa); pt-br y → ee;
  zh ɨ → ee; ja ɯ/β/ɸ → oh.
- Rules: the track leads the audio by 1 frame; every /p b m/ gets at least one frame; an RMS gate treats
  4+ frames 32 dB under the scene peak as a pause (it was 40 dB, which never fired on the phrase-final residual).
- Every build measures lip sync on the normalized audio (`visemes.sync_landmarks`, the review's method: voiced =
  within 28 dB of the scene peak): the mouth must close within 2 frames of each phrase's last voiced frame and open
  0-2 frames before each phrase; otherwise `timeline.warnings` says which scene. Measured on the demo after the fix:
  en phrase ends -2..-1 frames (were +5..+8), onsets -2..0 (mbp-initial phrases read -2: the lips press before the
  /m/); `tests/test_demo_sync.py` checks en, es and pt-br whenever the demo is built.
- Pauses: under 4 frames hold the previous shape, 4–10 frames slightlyOpen, 11 or more closed; closed before
  and after speech.
- Every shape is held at least 2 frames (a 1-frame mbp is extended, never dropped).
- Decision: LP3's ah → closed in-between is 2 frames, not 1, because LP3, QA 10.8 and the brief all forbid
  1-frame shapes.
- Measured: 5.4–7.8 changes/s in English after the 2026-11-24 snap-to-audio fix (5.1–5.9 before, when the stretched
  phrase-final vowels held 12–14 frames; the ART_GUIDE M2 figure is 5.1); 6–8/s in faster-syllable languages.

## Takes are reproducible (`voicelib/takes.py`)

kokoro-onnx 0.6.1 runs with `trim=False`, `sentence_pause=0`, `clause_pause=0`: its trim and pause insertion measured
the noise-driven waveform, so the same phonemes gave 6339, 6329 and 6419 ms, and its spliced zeros ticked at -38 dBFS.
The take is finished from the model's token durations instead: the 47 ms timing correction, 150 ms kept before the
first phone (of the model's 300 ms pad), silence topped up to 250 ms after a sentence mark and 100 ms after a clause
mark the model stopped on (kokoro-onnx's own defaults), inserted at the quietest millisecond inside the mark token,
and 5 ms raised-cosine fades at every silence edge and both ends. Same input, same length and timings; no sample next
to digital silence above -50 dBFS (`tests/test_takes.py`; the demo narration measured -90 dBFS at worst).

## Scene timing

`durationMs = speechMs + tail` (350 ms; 600 ms on the last scene), at least `minDurationSec`, rounded
**up to 100 ms**. That is the grid where ms and frames are both whole at 30 fps (3 frames, 2400 samples),
so `startMs`, `durationMs` and `totalMs` are integers and `frames = ms × fps / 1000` exactly.
`startMs` is cumulative. Scenes with empty narration are silent (closed mouth, no words).

## `--fit-to <masterLang>` (dubbing onto the same video)

An audio-track dub plays over the master picture: Zoo's mouth shapes and every on-screen text are the master's. So
since 2026-11-24 the fit is **per sentence**: every build records each scene's sentence spans (`sentences`, below), and
a dub synthesizes each sentence on its own, at the Kokoro speed (0.85–1.15, secant search, at most 5 takes) that makes
its speech as long as the master sentence, then places it where the master sentence starts (never closer than 120 ms
to the previous one). Talking and pauses line up with the master's mouth. A sentence still longer than its master
sentence at 1.15 starts where its excess shows least against the master's mouth track (each 10 ms start between the
previous sentence's end + 120 ms and the master start is scored by the frames where the dub's talking or silence
disagrees with the master mouth): talking into a short master pause is invisible (pauses under 11 frames show a
slightly open mouth), talking past a phrase end is not. Without a mouth track, half the excess goes each side. If the
scene would still overflow, the pauses are shortened from the end backwards (down to 120 ms) before the scene is
lengthened. Every sentence more than 100 ms longer than its master sentence is reported even when the scene fits
("sentence 2 is 225 ms longer than the en sentence even at speed 1.15: it starts 122 ms before and ends 103 ms after it
... Shorten it by about 13%"), and so is one pushed late or pulled early by its neighbours. When the sentence count
differs from the master's, or the master has no `sentences` (built before this change), the scene is fitted as a whole,
with a warning. Each scene keeps the master's `durationMs` and leaves 150 ms of air; if it still overflows, it is
lengthened, reported (`overflowMs`), and `build.py` exits 3.

`--fit-to` is refused for a storyboard with `offers` or `fiction: true` unless the dub SAYS the disclosure and the
fiction notice in its language (the master picture shows them in English only); otherwise publish a native upload.
The master's `storyboard.json` flags count too, so a translation that lost them is still refused.

## Loudness

Kokoro's raw narration sits at about -25 to -28 LUFS with an 18–20 dB crest factor. ffmpeg loudnorm
alone then falls back to its dynamic mode and plateaus 1.5–2.3 LU short of -14 (zh reached -16.2 even
when asked for -9).

Chain:
1. A look-ahead limiter (alimiter, latency-compensated, -2 dBFS). Its gain may exceed the linear-safe
   gain by at most 6 dB, so no 10 ms frame loses more than about 6 dB (measured p99 4.4–5.4 dB).
2. Two-pass loudnorm (`linear=true`, true-peak aim -1.2 dBTP, at most two secant corrections of the target).
3. A final measurement, recorded in `timeline.loudness`; a warning is added when it is more than 1 LU off
   or above -1 dBTP.

Fixture results: -14.1 to -14.8 LUFS, true peak at or below -1.07 dBTP. The chain keeps the exact sample
count and alignment (verified with clicks), so scene cuts stay sample-exact.

## Contract additions (optional fields; typed in `timeline-additions.ts`)

- `Timeline.narration`: path (relative to `public/`) of the continuous `narration.wav`.
- `TimelineScene.speed`: fit-to-master only; the Kokoro speed of that scene.
- `TimelineScene.overflowMs`: fit-to-master only; present when the dub did not fit even at 1.15.
- `TimelineScene.sentences` (2026-11-24): `[{startMs, endMs}]`, each sentence's speech (first phone start to last phone
  end, split at . ! ? …), scene-relative; the per-sentence fit aims for them.

## Warnings the step writes

- Translated storyboards (`lang != sourceLang`): `machine translation: needs native review ...`, until the
  storyboard carries the whole review record `translation: {status: 'native-reviewed', reviewed: true, reviewer, date}`
  (since 2026-11-24 the same rule as dub validate and the claim gate; a half-set record still warns).
- zh/ja: the pronunciation comes from misaki and has not been checked by a native speaker.
- A proportional word-timing fallback, dropped letters, loudness off target, and fit overflows.
- Digits or symbols left in the spoken text; a lip-sync check outside its tolerance; a dub sentence longer than its
  master sentence; a sentence-alignment fallback.

## Tests

```bash
.venv-voice/bin/python -m unittest discover -s scripts/voice/tests -t scripts/voice -v   # ~2.5 min with synthesis
python3 -m unittest discover -s scripts/voice/tests -t scripts/voice                    # unit tests only (e2e skips)
```

- Unit tests (stdlib only; the numpy-based take tests skip without numpy): markup, normalization tables and the
  review's number cases, the lexicon, viseme mapping and track rules (snap to audio, -32 dB gate, sync landmarks),
  take finishing (determinism, fades), phonetic alignment, scene timing, fit-to-master maths and the per-sentence fit
  (with a fake Kokoro), the audio-track refusal, the timeline validator.
- `test_demo_sync.py`: lip sync and silence-edge steps on the built demo (`public/generated/zoora-ai/_engine-demo`),
  skipped when it is not built.
- `test_e2e.py`: real synthesis in all 7 languages (fixtures in `tests/fixtures/zoora-ai/voice-smoke/`),
  an es → en fit-to-master dub, and the produced JSON checked against `src/episode/types.ts` with `tsc`
  (`satisfies VoiceTimeline`).
- `VOICE_SAMPLES_DIR=<dir>` keeps every narration.wav and timeline; `VOICE_SKIP_E2E=1` skips synthesis.

## Known limits

- No native speaker has checked es, pt-br, hi, it, zh or ja. Kokoro's zh/ja quality via misaki 0.7.4 is
  plausible (correct readings, sensible durations) but unverified by ear.
- espeak `es` is Castilian (θ for c/z). Latin-American copy will still sound Castilian.
- English uses espeak, not misaki's own English G2P (which needs spaCy and model downloads).
- `npm run voice` is not wired: `package.json` belongs to another workflow.
