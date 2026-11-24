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

## Narration markup

- `{display|spoken}`: captions show `display`, Kokoro says `spoken`: `{$40,000|forty thousand dollars}`.
  `{|uh}` is spoken only, `{SOL|}` shown only. A multi-word display shares the spoken span.
- `[src:id]` (or `[src:a,b]`): removed from captions and speech, with the whitespace repaired.
- Malformed markup fails the build before any synthesis, naming the scene.

## Text normalization (`voicelib/normalize/`)

Numbers, currencies, percentages, dates and symbols become words per language, from hand-written tables
(no num2words: it is LGPL-2.1 and has no Hindi). Captions keep the written form, and each display token
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

## Word timings

espeak phonemizes each scene in context, which keeps the audio natural. Per-word phonemization was
measured to say "a" as `ˈeɪ`, "to" as `tuː` and drop flaps. Kokoro reports one timing per phoneme character.
- Phoneme-word count equals the spoken-word count: 1:1.
- Otherwise (espeak merges "in the" into `ɪnðə`, "that the" into `ðætðə`, or splits numbers): a phonetic
  Needleman-Wunsch alignment of each word's isolated phonemes against the contextual stream, exact to the phone.
- If that alignment is poor: proportional by phoneme length, with a warning in `timeline.warnings`.
- zh/ja: exact, because phonemes are built word by word.

Words are scene-relative integer ms. Punctuation-only tokens join the previous caption word. zh/ja
captions join words without spaces.

## Mouth shapes (`voicelib/visemes.py`)

ART_GUIDE LP2/LP3 (binding), one `MouthShape` per frame at 30 fps:
- Mapping: p b m → mbp; rounded vowels and w → oh; open vowels → ah; i ɪ e j → ee; other phones →
  slightlyOpen. ː, aspiration, nasalization and tone arrows fold into the previous phone; stress marks
  and ʔ fold into the next.
- Per-language overrides: es/it β → mbp; hi ə → ah (a full vowel, not an English schwa); pt-br y → ee;
  zh ɨ → ee; ja ɯ/β/ɸ → oh.
- Rules: the track leads the audio by 1 frame; every /p b m/ gets at least one frame; an RMS gate treats
  4+ frames 40 dB under the scene peak as a pause.
- Pauses: under 4 frames hold the previous shape, 4–10 frames slightlyOpen, 11 or more closed; closed before
  and after speech.
- Every shape is held at least 2 frames (a 1-frame mbp is extended, never dropped).
- Decision: LP3's ah → closed in-between is 2 frames, not 1, because LP3, QA 10.8 and the brief all forbid
  1-frame shapes.
- Measured: 5.1–5.9 changes/s in English (the ART_GUIDE target was 5.1); 6–8/s in faster-syllable languages.

## Scene timing

`durationMs = speechMs + tail` (350 ms; 600 ms on the last scene), at least `minDurationSec`, rounded
**up to 100 ms**. That is the grid where ms and frames are both whole at 30 fps (3 frames, 2400 samples),
so `startMs`, `durationMs` and `totalMs` are integers and `frames = ms × fps / 1000` exactly.
`startMs` is cumulative. Scenes with empty narration are silent (closed mouth, no words).

## `--fit-to <masterLang>` (dubbing onto the same video)

Each scene keeps the master's `durationMs`. The Kokoro speed is solved per scene within **0.85–1.15**:
the model is speech ≈ a/speed + b, solved with a secant step and re-synthesized, at most 5 takes. The
target is the master's `speechMs`, so the dub keeps the master's pacing and visual beats. The speech
must also leave 150 ms of air before the next scene. The scene is then padded with silence. If even 1.15
is too long, the scene is reported in `warnings` with the overflow in ms and the percentage to cut, and
recorded in `overflowMs`. The scene is then lengthened (so speech never overlaps or gets cut), the track
no longer lines up with the master, and `build.py` exits 3. `mode` is `fit-to-master` with `masterLang`.

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

## Warnings the step writes

- Translated storyboards (`lang != sourceLang`): `machine translation: needs native review ...`. The step
  cannot see whether the owner confirmed a translation, so it always says so.
- zh/ja: the pronunciation comes from misaki and has not been checked by a native speaker.
- A proportional word-timing fallback, dropped letters, loudness off target, and fit overflows.

## Tests

```bash
.venv-voice/bin/python -m unittest discover -s scripts/voice/tests -t scripts/voice -v   # ~2.5 min with synthesis
python3 -m unittest discover -s scripts/voice/tests -t scripts/voice                    # unit tests only (e2e skips)
```

- Unit tests (stdlib only): markup, normalization tables, viseme mapping and track rules, phonetic
  alignment, scene timing and fit-to-master maths (with a fake Kokoro), the timeline validator.
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
