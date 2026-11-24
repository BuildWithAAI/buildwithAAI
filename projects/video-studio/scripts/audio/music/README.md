# Music: The Zoo & Badger Show and Zoora AI

Original music composed in code on the audio engine (`scripts/audio/audiolib`, docs in `docs/AUDIO.md`). The brief, the motif and every key, tempo and instrument choice are in [`DIRECTION.md`](DIRECTION.md). Sources and licences are in [`docs/AUDIO_LICENSES.md`](../../../docs/AUDIO_LICENSES.md), section "Music package".

```bash
python3 scripts/audio/music/build.py                  # render, master, measure and deliver every cue (about 20 min)
python3 scripts/audio/music/build.py bed-show-neutral # one cue; --no-export renders to out/ only; --list shows the ids
python3 scripts/audio/music/build.py --reviews-only   # refresh the self-reviews in the metadata from reviews.json
python3 scripts/audio/music/review.py                 # listening aids: a review reel and each bed under Zoo's voice
.venv-audio/bin/python -m unittest discover -s scripts/audio/music/tests -t scripts/audio/music
```

## The cues (`public/audio/music/`)

`manifest.json` lists every cue: path (relative to `public/`, for `staticFile`), length in seconds and samples, loop points, hits, key, tempo and loudness. Each cue also has `<id>.json`, the full metadata: sections, motif statements, spectrum, the checks that ran and the self-review.

| Cue | File | Length | Key, tempo | Loudness | Use |
| --- | --- | --- | --- | --- | --- |
| `theme-full` | FLAC, 16-bit | 68.4 s | D minor, 100 | -14 LUFS-I | cold opens, trailers |
| `theme-15s` | WAV, 24-bit | 15.0 s | D minor, 100 | -14 LUFS-I | short opens, promos |
| `theme-5s` | WAV, 24-bit | 5.0 s | D minor, 100 | -16 LUFS-I | logo sting, outs, Shorts endings |
| `intro-sting-show` | WAV, 24-bit | 4.0 s | D minor | -16 LUFS-I | the jingle for `ShowSting` |
| `intro-sting-zoora` | WAV, 24-bit | 4.0 s | F lydian, 100 | -16 LUFS-I | the jingle for `ZooraSting` |
| `bumper-rekt-meter` | WAV, 24-bit | 3.2 s | D minor, 100 | -16 LUFS-I | Headline / Rekt Meter |
| `bumper-red-flag` | WAV, 24-bit | 3.2 s | D minor, 100 | -16 LUFS-I | Badger's Red Flag |
| `bumper-one-fix` | WAV, 24-bit | 3.0 s | D major, 100 | -16 LUFS-I | Zoo's One Fix |
| `bumper-scam-of-the-week` | WAV, 24-bit | 3.4 s | D minor, 100 | -16 LUFS-I | Scam of the Week |
| `bumper-developing` | WAV, 24-bit | 3.4 s | D minor, 100 | -16 LUFS-I | DEVELOPING alert |
| `bumper-correction` | WAV, 24-bit | 3.4 s | D minor, 100 | -16 LUFS-I | Correction |
| `endscreen-bed` | WAV, 24-bit | 20.0 s | D minor, 100 | -26 LUFS-S | the end screen (end-aligned) |
| `bed-show-neutral` | FLAC, loop | 64.0 s | D dorian, 90 | -26 LUFS-S | the show, under Zoo |
| `bed-show-tension` | FLAC, loop | 64.0 s | D minor, 90 | -26 LUFS-S | how-it-worked, exploits |
| `bed-show-light` | FLAC, loop | 64.0 s | F major, 90 | -26 LUFS-S | lighter segments, One Fix |
| `bed-story-curious` | FLAC, loop | 64.0 s | F lydian, 75 | -26 LUFS-S | Zoora AI stories |
| `bed-story-tension` | FLAC, loop | 64.0 s | D minor, 75 | -26 LUFS-S | Zoora AI stories |
| `bed-story-ominous` | FLAC, loop | 64.0 s | D phrygian, 75 | -26 LUFS-S | Zoora AI stories |
| `bed-story-resolve` | FLAC, loop | 64.0 s | D major, 75 | -26 LUFS-S | Zoora AI stories |

**Formats.** The repository rule is "no file over 10 MB" (24-bit stereo WAV reaches 10 MB at 34.7 s).
- Cues up to that length ship as 48 kHz 24-bit WAV, the master itself.
- Longer cues ship as lossless 48 kHz FLAC: 24-bit when it fits, else 16-bit with TPDF dither (all of them did). FLAC is sample-exact, so loop points stay exact; AAC or Opus would add encoder priming and break the loops.
- The 24-bit WAV masters, AAC previews, pre-masters, MIDI, metrics JSON and pictures stay in `out/audio/music/<id>/` (gitignored).

## Using them in a video

- **Beds** loop seamlessly from sample 0 to the end (`loop.endSample` in the metadata). Every show bed is 90 BPM and every story bed is 75 BPM, so a cut or cross-fade on any bar line (2.667 s or 3.2 s) stays in time. Duck them under narration with the engine:
  ```bash
  python3 scripts/audio/duck.py --bed public/audio/music/bed-show-neutral.flac --voice public/generated/<channel>/<slug>/en/narration.wav \
      --out out/audio/<slug>/bed_ducked.wav --frames out/audio/<slug>/bed_gain.json
  ```
  Or play the bed in Remotion (`<Audio src={staticFile('audio/music/bed-show-neutral.flac')} loop volume={(f) => gains[f]} />`) with the per-frame gains from `--frames`.
- **Tempos land on frames.** 100 BPM = 18 frames per beat, 90 = 20 and 75 = 24 (at 30 fps), so beats and bars fall on whole frames.
- **Bumpers** start on their first downbeat at sample 0 and finish inside the file (each tail ends below -60 dBFS). `hits` in the metadata gives the accent times to cut on.
- **Intro stings** are timed to `src/branding`'s frames (`STING_HITS`).
  - The show jingle lands SHOW on frame 30 and Badger's D on frame 58.
  - The Zoora jingle lands on frame 54, with notes on frames 70 and 78.
  - Render them with `--props='{"jingle":"audio/music/intro-sting-show.wav"}'` (or `intro-sting-zoora.wav`).
  - The show sting hard-cuts at 4.0 s and the music is over by then.
- **The end-screen bed** is end-aligned: it ends at exactly 20.0 s. For a shorter end screen, start it later and fade in.

## How it is made

- `composer/notation.py`: the text notation for lines, chords and 16th-note drum grids.
- `composer/motif.py`: Zoo's motif and Badger's figure. Every statement is tagged, so the tests verify its pitch fingerprint in every cue.
- `composer/instruments.py`: the palette, as cached samplers.
- `composer/synths.py`: our own voices.
- `composer/cues/*.py`: the compositions: theme, show cues, show beds, Zoora.
- `composer/render.py`: the pipeline from stems to master.
  - Stems are rendered per part (fluidsynth for the MuseScore strings, the VCSL samplers, our synths) and cached by content.
  - Loops: each stem's tail is folded onto its start, then mixed with wrap-around padding, so the reverbs and compressors see the seam. The master runs with `loop=True`.
  - Channel strips run in parallel.
  - The mix uses three reverbs (plate, hall, room), bus EQ and the glue compressor. Mastering uses the engine's presets (`standalone`, `sting`, `bed`).
- `composer/audit.py`: what writing blind needs. It flags held semitone and minor-ninth rubs between parts, and ranges. Every cue was audited and its unintended rubs fixed; the theme has a test that fails on any new one.
- Every render is measured with `scripts/audio/metrics.py`: loudness, true peak, spectrum balance, stereo and mono, noise, the tail or loop seam, plus spectrogram and waveform PNGs. Every cue passes every fail-level check.

## Measured (final build, 2026-11-24)

Every cue passes every fail-level check of its profile. The numbers below are measured on the delivered files with `metrics.py`.
- "Tilt" is the octave-band slope (pink = -3 dB/oct).
- "Harsh", "mud" and "box" are the 2-5 kHz, 200-500 Hz and 500-1000 Hz deviations from the pink line.
- "Voice pocket" is 1-4 kHz against the bed's own tilt (negative = room for a voice).
- "Seam ratio" is the loop click check: 1 means the seam looks like its surroundings, and 2 fails.
- LRA is not meaningful on 3 s bumpers.

| Cue | Loudness | True peak | LRA | Tilt / harsh / mud / box (dB) | Voice pocket | Stereo corr. / mono loss | Seam ratio | Warnings |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `theme-full` | -14.0 LUFS-I | -1.3 dBTP | 3.1 | -4.5 / -4.53 / 0.52 / 0.22 | -0.28 | 0.7 / -0.9 |  | none |
| `theme-15s` | -14.0 LUFS-I | -1.3 dBTP | 3.7 | -4.74 / -4.82 / 0.33 / 0.34 | 0.3 | 0.714 / -0.9 |  | humDb |
| `theme-5s` | -16.0 LUFS-I | -1.3 dBTP | 4.2 | -5.5 / -6.75 / 1.14 / -0.28 | 1.77 | 0.746 / -0.72 |  | humDb |
| `intro-sting-show` | -16.0 LUFS-I | -1.3 dBTP | 2.6 | -5.32 / -6.25 / 0.95 / -0.16 | 1.86 | 0.705 / -0.82 |  | humDb |
| `intro-sting-zoora` | -16.0 LUFS-I | -1.2 dBTP | 0.6 | -4.68 / -8.9 / -2.11 / 2.29 | 0.34 | 0.555 / -1.25 |  | humDb |
| `bumper-rekt-meter` | -16.0 LUFS-I | -1.3 dBTP | 20.1 | -4.52 / -4.28 / 0.88 / 0.06 | -0.32 | 0.622 / -1.1 |  | humDb |
| `bumper-red-flag` | -16.0 LUFS-I | -1.3 dBTP | 20.5 | -5.79 / -8.46 / 0.52 / -3.23 | -0.08 | 0.652 / -0.72 |  | humDb |
| `bumper-one-fix` | -16.0 LUFS-I | -1.1 dBTP | 20.0 | -5.5 / -8.16 / 1.41 / 2.44 | 2.86 | 0.525 / -1.37 |  | humDb |
| `bumper-scam-of-the-week` | -16.0 LUFS-I | -1.3 dBTP | 1.1 | -3.96 / -3.45 / -0.25 / -2.15 | -2.18 | 0.677 / -0.93 |  | humDb |
| `bumper-developing` | -16.1 LUFS-I | -1.3 dBTP | 0.5 | -4.25 / -5.64 / -3.78 / -3.43 | -2.63 | 0.533 / -1.41 |  | humDb |
| `bumper-correction` | -16.0 LUFS-I | -3.2 dBTP | 0.0 | -5.26 / -8.56 / 0.75 / 3.43 | 3.21 | 0.434 / -1.54 |  | none |
| `endscreen-bed` | -26.0 LUFS-S | -6.3 dBTP | 1.0 | -4.41 / -8.15 / 1.02 / 0.53 | -7.99 | 0.755 / -0.86 |  | none |
| `bed-show-neutral` | -26.0 LUFS-S | -6.3 dBTP | 2.4 | -5.12 / -9.31 / 1.12 / -1.44 | -6.02 | 0.824 / -0.51 | 0.602 | hfFloorDbfs, levelStepDb |
| `bed-show-tension` | -26.0 LUFS-S | -6.3 dBTP | 0.9 | -5.41 / -9.47 / -0.98 / -0.6 | -6.93 | 0.757 / -0.8 | 0.467 | humDb, hfFloorDbfs, levelStepDb |
| `bed-show-light` | -26.0 LUFS-S | -6.3 dBTP | 0.9 | -4.4 / -6.8 / 2.66 / 1.26 | -7.37 | 0.768 / -0.79 | 0.259 | humDb, hfFloorDbfs, levelStepDb |
| `bed-story-curious` | -26.1 LUFS-S | -6.2 dBTP | 1.0 | -4.45 / -12.37 / 2.54 / 3.68 | -7.91 | 0.372 / -1.75 | 0.025 | levelStepDb |
| `bed-story-tension` | -26.0 LUFS-S | -8.6 dBTP | 2.1 | -6.31 / -11.2 / 2.2 / 0.68 | -3.35 | 0.804 / -0.55 | 0.027 | levelStepDb |
| `bed-story-ominous` | -26.0 LUFS-S | -8.1 dBTP | 1.8 | -6.13 / -12.02 / 0.22 / 0.6 | -6.46 | 0.86 / -0.56 | 0.048 | humDb, levelStepDb |
| `bed-story-resolve` | -26.0 LUFS-S | -11.2 dBTP | 3.2 | -5.43 / -13.87 / 1.13 / 0.96 | -8.63 | 0.428 / -1.68 | 0.716 | levelStepDb |

**Under Zoo's voice** (`review.py`: the engine demo narration, Kokoro `im_nicola`, each bed ducked 6 dB by `duck.py`, measured during speech):

| Bed | Voice over bed, overall | 100-300 Hz | 300-1000 Hz | 1-4 kHz | 4-8 kHz |
| --- | --- | --- | --- | --- | --- |
| `bed-show-neutral` | 18.2 LU | 19.7 dB | 19.5 dB | 10.9 dB | 19.5 dB |
| `bed-show-tension` | 18.4 LU | 20.7 dB | 21.2 dB | 14.6 dB | 18.4 dB |
| `bed-show-light` | 18.3 LU | 23.2 dB | 17.4 dB | 12.4 dB | 13.9 dB |
| `bed-story-curious` | 18.5 LU | 25.1 dB | 16.9 dB | 9.0 dB | 19.5 dB |
| `bed-story-tension` | 18.7 LU | 17.3 dB | 21.6 dB | 16.3 dB | 30.0 dB |
| `bed-story-ominous` | 18.4 LU | 18.0 dB | 24.2 dB | 17.8 dB | 28.5 dB |
| `bed-story-resolve` | 19.4 LU | 22.9 dB | 18.7 dB | 14.6 dB | 28.9 dB |
| `endscreen-bed` | 18.6 LU | 21.9 dB | 19.8 dB | 12.2 dB | 15.9 dB |

The consonant band (1-4 kHz) has the least margin in every bed. Speech carries less energy up there, and the master re-levels a bed after its pocket EQ, so a deeper static dip buys little: going from -3.5 dB to -7.5 dB at 2.5 kHz gained 1-2 dB there. 9-18 dB is still a clear margin. For the curious and neutral beds under fast or soft-spoken narration, duck 8 dB instead of 6 (`duck.py --depth 8`).

The warnings left, and why they stay:

- **`loop.levelStepDb` (beds).** Every loop starts on a downbeat, so the first 100 ms holds that hit and the last 100 ms is the end of a bar. The seam itself measures well under the click threshold (seam ratio well under 1; 2 fails).
- **`noise.hfFloorDbfs` (show beds).** The 8-16 kHz "floor" is the continuous shaker and hats. It is not hiss; every source is clean to -84 dBFS or better.
- **`noise.humDb` (short stings, some beds).** Sustained D and A bass partials near 55-60 Hz and their harmonics trip the mains-hum heuristic on short or bass-heavy files. No source contains mains hum.

## Self-review

The honest notes per cue are in [`reviews.json`](reviews.json) and are copied into each cue's metadata (`selfReview`). The common thread: every judgement here comes from measurements, score audits and spectrograms. Nobody has listened, because this session has no audio output.

## Limits

- **Not heard.** Listen to `out/audio/music/review/review-reel.m4a` and the `under-voice/` mixes on headphones and a phone speaker before release.
- **Synthetic voices.** The FM tine piano, analog pad, pulse and brass stab are our own synthesis: measured clean, but their realism is unverified. The weakest sample sets are the MuseScore celesta and the VSCO strings' soft attacks (legato is simulated by overlap; there are no true legato transitions).
- **VCSL octave labels (found and fixed here).** Several VCSL sets name middle C "C3" (the Yamaha convention): the Kawai grand, Yamaha upright, vibraphone (soft, hard, bowed), marimba, glockenspiel and kalimba. Their samples sound an octave above the label. The engine's `Sampler` takes file names at face value, so it plays these sets an octave above the written note; the engine's reference render does too. Measured by harmonic product spectrum over every sample:
  - Kawai +11.98 semitones; upright, vibraphone and bowed vibraphone +12.00; marimba +11.99; glockenspiel +12.12;
  - the Steinway B and the concert harp are correct (0).
  `composer/instruments.py` corrects the roots. The kalimba and glockenspiel also get each sample's measured pitch (the mbira's tines are up to 44 cents off equal temperament; the glockenspiel is 12-16 cents sharp), and `PitchTests` checks that a written A4 sounds at 440 Hz on every pitched VCSL set used.
- **Engine edge case.** An RMS compressor can return NaN in digital silence after loud audio (audiolib 1.0.0: `uniform_filter1d` dips a few ulp below zero, then `sqrt`). This package wraps every compressor in `render.SafeCompressor`; the engine itself is unchanged.
