# Music: The Zoo & Badger Show and Zoora AI

Original music composed in code on the audio engine (`scripts/audio/audiolib`, docs in `docs/AUDIO.md`). The brief, the motif and every key, tempo and instrument choice are in [`DIRECTION.md`](DIRECTION.md). Sources and licences are in [`docs/AUDIO_LICENSES.md`](../../../docs/AUDIO_LICENSES.md), section "Music package".

```bash
python3 scripts/audio/music/build.py                  # render, master, measure and deliver every cue (about 30 min; stems are cached)
python3 scripts/audio/music/build.py bed-show-neutral # one cue; --no-export renders to out/ only; --list shows the ids
python3 scripts/audio/music/build.py --reviews-only   # refresh the self-reviews in the metadata from reviews.json
python3 scripts/audio/music/voicegate.py public/audio/music/bed-show-neutral-underscore.flac   # a bed against Zoo's voice
python3 scripts/audio/music/review.py                 # listening aids: a review reel and each underscore bed under Zoo's voice
.venv-audio/bin/python -m unittest discover -s scripts/audio/music/tests -t scripts/audio/music
node --test scripts/audio/music/tests/manifest.test.ts
```

Critic round 1 (2026-11-24) measured the first build against Zoo's real voice and on a phone-speaker model. Everything below reflects the fixes; what changed and why is in "Round 1" at the end.

## The cues (`public/audio/music/`)

`manifest.json` lists every cue: path (relative to `public/`, for `staticFile`), length in seconds and samples, loop points, hits, the sync point (`downbeatSec`), key, tempo and loudness. Each cue also has `<id>.json`, the full metadata: sections, motif statements, spectrum, the voice gate, the checks that ran and the self-review.

| Cue | File | Length | Key, tempo | Loudness | Use |
| --- | --- | --- | --- | --- | --- |
| `theme-full` | FLAC, 16-bit | 68.4 s | D minor, 100 | -14 LUFS-I | cold opens, trailers |
| `theme-15s` | WAV, 24-bit | 15.0 s | D minor, 100 | -14 LUFS-I | short opens, promos |
| `theme-5s` | WAV, 24-bit | 5.0 s | D minor, 100 | -16 LUFS-I | logo sting, outs, Shorts endings; the downbeat is at 2 frames |
| `intro-sting-show` | WAV, 24-bit | 4.0 s | D minor | -16 LUFS-I | the jingle for `ShowSting` |
| `intro-sting-zoora` | WAV, 24-bit | 4.0 s | F lydian, 100 | -16 LUFS-I | the jingle for `ZooraSting` |
| `bumper-rekt-meter` | WAV, 24-bit | 3.2 s | D minor, 100 | -16 LUFS-I | Headline / Rekt Meter |
| `bumper-red-flag` | WAV, 24-bit | 3.2 s | D minor, 100 | -16 LUFS-I | Badger's Red Flag |
| `bumper-one-fix` | WAV, 24-bit | 3.0 s | D major, 100 | -16 LUFS-I | Zoo's One Fix |
| `bumper-scam-of-the-week` | WAV, 24-bit | 3.4 s | D minor, 100 | -16 LUFS-I | Scam of the Week |
| `bumper-developing` | WAV, 24-bit | 3.4 s | D minor, 100 | -16 LUFS-I | DEVELOPING alert |
| `bumper-correction` | WAV, 24-bit | 3.4 s | D minor, 100 | -16 LUFS-I | Correction |
| `endscreen-bed` | WAV, 24-bit | 20.0 s | D minor, 100 | -26 LUFS-S | the end screen under Zoo's voice-over (end-aligned) |
| `endscreen-music` | WAV, 24-bit | 20.0 s | D minor, 100 | -18 LUFS-I | the end screen with nobody speaking (end-aligned) |
| `bed-show-neutral` / `-underscore` | FLAC, loop | 64.0 s | D dorian, 90 | -26 LUFS-S | the show |
| `bed-show-tension` / `-underscore` | FLAC, loop | 64.0 s | D minor, 90 | -26 LUFS-S | how-it-worked, exploits |
| `bed-show-light` / `-underscore` | FLAC, loop | 64.0 s | F major, 90 | -26 LUFS-S | lighter segments, One Fix |
| `bed-story-curious` / `-underscore` | FLAC, loop | 64.0 s | F lydian, 75 | -26 LUFS-S | Zoora AI stories |
| `bed-story-tension` / `-underscore` | FLAC, loop | 64.0 s | D minor, 75 | -26 LUFS-S | Zoora AI stories |
| `bed-story-ominous` / `-underscore` | FLAC, loop | 64.0 s | D phrygian, 75 | -26 LUFS-S | Zoora AI stories |
| `bed-story-resolve` / `-underscore` | FLAC, loop | 64.0 s | D major, 75 | -26 LUFS-S | Zoora AI stories |

**Two versions of every bed.** `<bed>` carries the motif (for intros, outros and the gaps between lines); `<bed>-underscore` mutes the motif and the lead lines and is the one to put under speech. Both share tempo, key, form and loop points, so an editor can cross-fade from one to the other on any bar line.

**Formats.** The repository rule is "no file over 10 MB" (24-bit stereo WAV reaches 10 MB at 34.7 s).
- Cues up to that length ship as 48 kHz 24-bit WAV, the master itself.
- Longer cues ship as lossless 48 kHz FLAC: 24-bit when it fits, else 16-bit with TPDF dither. FLAC is sample-exact, so loop points stay exact; AAC or Opus would add encoder priming and break the loops.
- The 24-bit WAV masters, AAC previews, pre-masters, stems, MIDI, metrics JSON and pictures stay in `out/audio/music/<id>/` (gitignored). Stems are not shipped (`build.py <id> --stems --no-export` writes them).

## Using them in a video

- **Beds under speech: the underscore, ducked by band.** Duck every bed with the engine's band-split duck (the default of `scripts/audio/duck.py`): -2 dB under 700 Hz, -12 dB from 700 Hz to 5 kHz, -4 dB above, while Zoo speaks. It clears his consonant band and leaves the bed's body, so the music stays more present than with a broadband duck and his words stay clearer:
  ```bash
  python3 scripts/audio/duck.py --bed public/audio/music/bed-show-neutral-underscore.flac --voice public/generated/<channel>/<slug>/en/narration.wav \
      --out out/audio/<slug>/bed_ducked.wav --frames out/audio/<slug>/bed_gain.json
  ```
  In Remotion, play the ducked file (`<Audio src={staticFile(...)} />` on a copy in `public/`). A `volume` callback can only apply one gain to every band, so it cannot reproduce the split duck; `--depth 6` (broadband) exists for that case and measures worse (the table below).
- **Do not make a bed more present by ducking less or raising it.** The first README's options were measured unsafe (critic round 1): a 3 dB duck dropped the band-audibility index to 0.61-0.66, and -23 LUFS-S with a 3 dB duck to 0.54-0.60, against 0.75 for speech-shaped noise. Every bed passes the voice gate at -26 LUFS-S with the split duck; any other setting needs `voicegate.py` re-run on the result.
- **Beds loop seamlessly** from sample 0 to the end (`loop.endSample`). Show beds are 90 BPM and story beds 75 BPM, so a cut or cross-fade on any bar line (2.667 s or 3.2 s) stays in time.
- **Tempos land on frames.** 100 BPM = 18 frames per beat, 90 = 20 and 75 = 24 (at 30 fps).
- **Sync points.** `theme-5s` starts with two frames of silence, so a placement one frame early never clips its first hit: start it with `downbeatStartFrame(cue, frame)` from `manifest.ts` (`frame - 2`) to put the downbeat on `frame`. Every other cue's downbeat is at sample 0 (`downbeatSec` 0).
- **Bumpers** start on their first downbeat and finish inside the file (each tail ends below -60 dBFS). `hits` in the metadata gives the accent times to cut on.
- **Intro stings** are timed to `src/branding`'s frames (`STING_HITS`): the show jingle lands SHOW on frame 30 and Badger's D on frame 58; the Zoora jingle lands on frame 54, with notes on frames 70 and 78. Render them with `--props='{"jingle":"audio/music/intro-sting-show.wav"}'` (or `intro-sting-zoora.wav`). The show sting hard-cuts at 4.0 s and the music is over by then.
- **The end screen.** `endscreen-bed` goes under Zoo's call to action (duck it like a bed); `endscreen-music` is for an end screen with nobody speaking (-18 LUFS-I, 4 LU under the narration). Both end at exactly 20.0 s: for a shorter end screen, start them later and fade in.

## How it is made

- `composer/notation.py`: the text notation for lines, chords and 16th-note drum grids.
- `composer/motif.py`: Zoo's motif and Badger's figure. Every statement is tagged, so the tests verify its pitch fingerprint in every cue (and its absence in every underscore).
- `composer/instruments.py`: the palette, as cached samplers.
- `composer/synths.py`: our own voices, among them the finger-plucked bass (`FingerBass`) and the kick, tuned per hit to the bass note above it (`kick_tuning`).
- `composer/cues/*.py`: the compositions: theme, show cues, show beds, Zoora.
- `composer/render.py`: the pipeline from stems to master.
  - Stems are rendered per part (fluidsynth for the MuseScore strings, the VCSL samplers, our synths) and cached by content.
  - Loops: each stem's tail is folded onto its start, then mixed with wrap-around padding, so the reverbs and compressors see the seam. The master runs with `loop=True`.
  - Channel strips run in parallel; a track can shave its own peaks first (`peak_shave`, used on Badger's figure) and the bus can carry a section ride (`bus_ride`, used on the full theme).
  - The mix uses three reverbs (plate, hall, room), bus EQ and the glue compressor. Mastering uses the engine's presets (`standalone`, `sting`, `bed`) plus `endscreen` (-18 LUFS-I); the theme masters with a -2 dBTP ceiling.
- `composer/voicegate.py`: the voice gate. The reference is Zoo's own narration (`voiceref/zoo-im_nicola.json`, measured from the engine demo). For each bed it computes a short-time band-audibility index (ANSI S3.5-1997 one-third-octave weights, 32 ms frames) under the planned duck, and the same index for speech-shaped noise at the same loudness. A bed passes at 0.75 or more and not below the noise.
- `composer/targets.py`: the package's checks on top of the engine's `targets.json`: the voice gate replaces the old 1-4 kHz pocket check for beds, `endscreen` gets its own profile, and the theme must stay at or under -1 dBTP after an AAC 128 kb/s encode.
- `composer/audit.py`: what writing blind needs. It flags held semitone and minor-ninth rubs between parts, and ranges; the theme has a test that fails on any new one.
- Every render is measured with `scripts/audio/metrics.py` (loudness, true peak, spectrum balance, stereo and mono, noise, the tail or loop seam, spectrogram and waveform PNGs) plus the voice gate and the AAC check. Every cue passes every fail-level check.

## Measured (critic round 1 build, 2026-11-24)

Every cue passes every fail-level check of its profile.
- "Tilt" is the octave-band slope (pink = -3 dB/oct). "Harsh", "mud" and "box" are the 2-5 kHz, 200-500 Hz and 500-1000 Hz deviations from the pink line.
- "After AAC 128k" is the true peak after an ffmpeg AAC 128 kb/s encode (YouTube re-encodes): for the theme, stings and bumpers the worst of five encodes of copies that differ only in their last-bit dither, because that encoder is chaotic on dense, bright material (one theme-15s master read from -1.9 to +0.2 dBTP across such copies, while Opus 128k read -1.5 on every one); for beds, one encode (they peak 5-11 dB under it).
- "Phone loss" is the loudness lost on the critic's phone model (mono, 4th-order high-pass at 350 Hz, low-pass at 12 kHz, +3 dB at 3 kHz). Zoo's voice loses 5.4 LU on it, so a cue near 5.4 keeps its balance against him on a phone.
- LRA is not meaningful on 3 s bumpers.

| Cue | Loudness | True peak | After AAC 128k | LRA | Tilt / harsh / mud / box (dB) | Stereo corr. / mono loss | Phone loss | Warnings |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `theme-full` | -14.0 LUFS-I | -2.5 dBTP | -1.2 dBTP | 4.8 | -4.96 / -6.12 / 1.20 / -1.19 | 0.72 / -0.89 | -4.1 LU | none |
| `theme-15s` | -14.1 LUFS-I | -2.5 dBTP | -1.8 dBTP | 3.5 | -4.88 / -5.66 / 1.05 / -0.63 | 0.69 / -0.99 | -4.1 LU | none |
| `theme-5s` | -16.0 LUFS-I | -1.3 dBTP | -1.2 dBTP | 2.7 | -5.17 / -6.50 / 2.43 / -0.76 | 0.73 / -0.76 | -3.7 LU | none |
| `intro-sting-show` | -16.1 LUFS-I | -1.3 dBTP | -1.1 dBTP | 1.6 | -5.08 / -6.02 / 2.17 / -1.49 | 0.72 / -0.78 | -4.2 LU | none |
| `intro-sting-zoora` | -16.0 LUFS-I | -2.7 dBTP | -2.6 dBTP | 0.7 | -4.19 / -9.71 / -2.08 / 1.35 | 0.45 / -1.65 | -2.0 LU | humDb |
| `bumper-rekt-meter` | -16.1 LUFS-I | -1.3 dBTP | -1.1 dBTP | 20.1 | -4.54 / -4.24 / 1.63 / -0.55 | 0.64 / -1.03 | -3.3 LU | humDb |
| `bumper-red-flag` | -16.0 LUFS-I | -1.3 dBTP | -1.3 dBTP | 20.4 | -5.16 / -7.44 / 2.68 / -3.16 | 0.64 / -0.66 | -3.6 LU | humDb |
| `bumper-one-fix` | -16.1 LUFS-I | -1.3 dBTP | -2.0 dBTP | 20.0 | -5.73 / -8.59 / 1.42 / 1.94 | 0.53 / -1.39 | -3.4 LU | humDb |
| `bumper-scam-of-the-week` | -16.0 LUFS-I | -1.3 dBTP | -0.7 dBTP | 1.2 | -4.34 / -3.70 / -0.48 / -3.85 | 0.70 / -1.09 | -3.3 LU | humDb |
| `bumper-developing` | -16.1 LUFS-I | -1.3 dBTP | -1.1 dBTP | 0.4 | -4.50 / -6.08 / -3.31 / -5.13 | 0.69 / -1.08 | -3.4 LU | humDb |
| `bumper-correction` | -16.0 LUFS-I | -3.2 dBTP | -3.4 dBTP | 0.0 | -6.67 / -11.96 / -0.60 / 0.70 | 0.62 / -0.99 | -5.5 LU | none |
| `endscreen-bed` | -26.0 LUFS-S | -6.9 dBTP | -7.5 dBTP | 0.6 | -5.03 / -8.50 / 2.61 / -1.11 | 0.83 / -0.65 | -5.3 LU | none |
| `endscreen-music` | -18.1 LUFS-I | -2.3 dBTP | -1.9 dBTP | 1.0 | -4.97 / -7.57 / -0.25 / -1.36 | 0.83 / -0.65 | -4.8 LU | none |
| `bed-show-neutral` | -26.0 LUFS-S | -6.3 dBTP | -5.2 dBTP | 2.2 | -5.28 / -9.11 / 2.37 / -3.32 | 0.83 / -0.53 | -5.8 LU | hfFloorDbfs, levelStepDb |
| `bed-show-neutral-underscore` | -26.0 LUFS-S | -6.3 dBTP | -6.2 dBTP | 2.3 | -5.30 / -8.90 / 2.73 / -4.09 | 0.84 / -0.51 | -5.9 LU | hfFloorDbfs, levelStepDb |
| `bed-show-tension` | -26.0 LUFS-S | -6.3 dBTP | -6.7 dBTP | 1.3 | -5.40 / -8.74 / -0.14 / -2.00 | 0.74 / -0.83 | -5.9 LU | humDb, hfFloorDbfs, levelStepDb |
| `bed-show-tension-underscore` | -26.0 LUFS-S | -6.3 dBTP | -6.6 dBTP | 1.3 | -5.32 / -8.38 / 0.14 / -2.05 | 0.73 / -0.86 | -5.9 LU | humDb, hfFloorDbfs, levelStepDb |
| `bed-show-light` | -26.0 LUFS-S | -6.3 dBTP | -4.8 dBTP | 1.3 | -4.62 / -6.38 / 2.36 / -1.74 | 0.81 / -0.62 | -4.0 LU | levelStepDb |
| `bed-show-light-underscore` | -26.0 LUFS-S | -6.3 dBTP | -6.0 dBTP | 1.5 | -4.61 / -6.01 / 2.68 / -2.10 | 0.82 / -0.60 | -4.1 LU | levelStepDb |
| `bed-story-curious` | -26.0 LUFS-S | -6.2 dBTP | -5.7 dBTP | 1.3 | -4.53 / -10.46 / 2.71 / 1.92 | 0.52 / -1.38 | -2.6 LU | levelStepDb |
| `bed-story-curious-underscore` | -26.1 LUFS-S | -6.2 dBTP | -5.9 dBTP | 1.2 | -4.78 / -10.57 / 2.70 / 0.79 | 0.56 / -1.31 | -2.8 LU | levelStepDb |
| `bed-story-tension` | -26.0 LUFS-S | -8.9 dBTP | -9.1 dBTP | 1.9 | -5.99 / -8.69 / 1.69 / 0.25 | 0.80 / -0.55 | -6.6 LU | levelStepDb |
| `bed-story-tension-underscore` | -26.0 LUFS-S | -8.4 dBTP | -8.2 dBTP | 2.0 | -5.99 / -8.91 / 1.90 / -0.05 | 0.79 / -0.56 | -6.7 LU | levelStepDb |
| `bed-story-ominous` | -26.0 LUFS-S | -10.5 dBTP | -10.2 dBTP | 1.9 | -5.19 / -10.55 / -0.42 / 1.22 | 0.80 / -0.83 | -5.7 LU | humDb |
| `bed-story-ominous-underscore` | -26.0 LUFS-S | -10.8 dBTP | -10.5 dBTP | 2.3 | -5.24 / -10.56 / -0.94 / 0.23 | 0.82 / -0.74 | -6.0 LU | humDb |
| `bed-story-resolve` | -26.0 LUFS-S | -11.1 dBTP | -11.0 dBTP | 3.4 | -5.50 / -14.36 / 0.82 / -0.84 | 0.61 / -1.12 | -4.5 LU | levelStepDb |
| `bed-story-resolve-underscore` | -26.0 LUFS-S | -10.8 dBTP | -10.7 dBTP | 3.4 | -5.49 / -14.26 / 1.19 / -0.96 | 0.60 / -1.13 | -4.6 LU | levelStepDb |

**Under Zoo's voice.** The reference narration over each bed looped under it, at -26 LUFS-S, with the band-split duck (and, for comparison, the old broadband 6 dB duck), measured during speech. "Index" is the band-audibility index (1 = every band fully audible; the gate is 0.75 and the noise reference).

| Bed | Index, band-split duck | Speech-shaped noise, same loudness | Index, broadband 6 dB duck | Voice over bed | 1-4 kHz SNR median | Speech frames under 3 dB (1-4 kHz) | Narrowest band |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `endscreen-bed` | 0.826 | 0.692 | 0.791 | 15.4 LU | 22.6 dB | 8 % | 800 Hz, 15.3 dB |
| `bed-show-neutral` | 0.836 | 0.680 | 0.808 | 14.9 LU | 24.2 dB | 8 % | 800 Hz, 15.8 dB |
| `bed-show-neutral-underscore` | 0.840 | 0.679 | 0.811 | 14.8 LU | 24.1 dB | 8 % | 1250 Hz, 19.0 dB |
| `bed-show-tension` | 0.786 | 0.691 | 0.741 | 15.3 LU | 20.0 dB | 9 % | 800 Hz, 10.8 dB |
| `bed-show-tension-underscore` | 0.780 | 0.688 | 0.734 | 15.2 LU | 19.2 dB | 10 % | 800 Hz, 11.5 dB |
| `bed-show-light` | 0.830 | 0.689 | 0.800 | 15.2 LU | 23.7 dB | 9 % | 800 Hz, 15.3 dB |
| `bed-show-light-underscore` | 0.838 | 0.687 | 0.809 | 15.2 LU | 24.1 dB | 8 % | 800 Hz, 17.9 dB |
| `bed-story-curious` | 0.798 | 0.712 | 0.759 | 16.3 LU | 14.3 dB | 18 % | 800 Hz, 9.8 dB |
| `bed-story-curious-underscore` | 0.799 | 0.708 | 0.760 | 16.1 LU | 14.9 dB | 17 % | 800 Hz, 10.6 dB |
| `bed-story-tension` | 0.790 | 0.687 | 0.734 | 15.2 LU | 17.8 dB | 13 % | 800 Hz, 12.7 dB |
| `bed-story-tension-underscore` | 0.794 | 0.689 | 0.738 | 15.2 LU | 17.4 dB | 12 % | 800 Hz, 13.9 dB |
| `bed-story-ominous` | 0.839 | 0.688 | 0.806 | 15.2 LU | 19.9 dB | 10 % | 800 Hz, 11.6 dB |
| `bed-story-ominous-underscore` | 0.846 | 0.687 | 0.815 | 15.2 LU | 20.1 dB | 9 % | 800 Hz, 12.7 dB |
| `bed-story-resolve` | 0.835 | 0.714 | 0.802 | 16.4 LU | 21.6 dB | 8 % | 800 Hz, 9.8 dB |
| `bed-story-resolve-underscore` | 0.832 | 0.713 | 0.796 | 16.3 LU | 21.1 dB | 8 % | 800 Hz, 11.1 dB |

The theme's arc, the critic's acceptance (B at least 2 LU under A, A' at least 1.5 LU over it), measured on the delivered master:

| Section | intro | A | B | A' | coda |
| --- | --- | --- | --- | --- | --- |
| First build | -16.8 | -14.4 | -13.8 | -13.5 | -15.1 |
| Round 1 | -15.2 | -14.1 | -16.2 | -12.5 | -13.9 |

Badger's figure against the motif before it (BS.1770 on the two windows), full range / phone model:

| Cue | First build | Round 1 |
| --- | --- | --- |
| `theme-full` | -2.8 / -4.5 dB | -1.8 / -2.9 dB |
| `theme-15s` | -2.6 / -4.4 dB | -1.8 / -2.4 dB |
| `theme-5s` | -3.9 / -5.0 dB | -0.3 / -0.8 dB |
| `intro-sting-show` | -2.1 / -1.3 dB | +0.9 / +1.3 dB |
| `bumper-red-flag` | -1.1 / -2.6 dB | +1.7 / +0.0 dB |

The warnings left, and why they stay:

- **`loop.levelStepDb` (beds).** Every loop starts on a downbeat, so the first 100 ms holds that hit and the last 100 ms is the end of a bar. Measured at every bar line, each seam's step sits inside the steps the same bed makes at its own bar lines, and the seam is sample-continuous (click ratio well under the fail level of 2).
- **`noise.hfFloorDbfs` (show beds).** The 8-16 kHz "floor" is the continuous shaker and hats. It is not hiss; every source is clean to -84 dBFS or better.
- **`noise.humDb` (short stings, some beds).** Sustained D and A bass partials near 55-60 Hz and their harmonics trip the mains-hum heuristic on short or bass-heavy files. No source contains mains hum.

## Self-review

The honest notes per cue are in [`reviews.json`](reviews.json) and are copied into each cue's metadata (`selfReview`). Every judgement here comes from measurements, score audits and spectrograms. Nobody has listened, because this session has no audio output.

## Limits

- **Not heard.** Listen to `out/audio/music/review/review-reel.m4a` and the `under-voice/` mixes on headphones and a phone speaker before release. The phone numbers come from a model, not a phone.
- **Library depth.** Seven moods, each in a motif and an underscore version: 14 loops of 64 s. A 10-minute episode still loops one bed about nine times. The critic asked for two more arrangement variants per mood or 128 s cycles; they are not built yet (see the round-1 notes).
- **Synthetic voices.** The FM tine piano, analog pad, pulse, brass stab and the finger-plucked bass are our own synthesis: measured clean, realism unverified. The VSCO strings' soft attacks remain the weakest samples (legato is simulated by overlap).
- **VCSL octave labels (found and fixed here).** Several VCSL sets name middle C "C3" (the Yamaha convention): the Kawai grand, Yamaha upright, vibraphone (soft, hard, bowed), marimba, glockenspiel and kalimba. Their samples sound an octave above the label. The engine's `Sampler` takes file names at face value, so it plays these sets an octave above the written note; the engine's reference render does too. Measured by harmonic product spectrum over every sample:
  - Kawai +11.98 semitones; upright, vibraphone and bowed vibraphone +12.00; marimba +11.99; glockenspiel +12.12;
  - the Steinway B and the concert harp are correct (0).
  `composer/instruments.py` corrects the roots. The kalimba and glockenspiel also get each sample's measured pitch (the mbira's tines are up to 44 cents off equal temperament; the glockenspiel is 12-16 cents sharp), and `PitchTests` checks that a written A4 sounds at 440 Hz on every pitched VCSL set used.
- **Engine edge case.** An RMS compressor can return NaN in digital silence after loud audio (audiolib 1.0.0: `uniform_filter1d` dips a few ulp below zero, then `sqrt`). This package wraps every compressor in `render.SafeCompressor`; the engine itself is unchanged.

## Round 1 (critic, 2026-11-24): what changed

The critic measured everything and heard nothing; so did this round. Each item: what changed, then the new measurement (critic's number in brackets).

**Shared fixes**
- **BASS-FIX.** The engine's plucked string read clavinet-bright (11 % of its power under 150 Hz, 44 % at 1-4 kHz). The critic's recipe (low-pass, less drive) did not reach its own acceptance (1-4 kHz -6.7 dB, under 150 Hz -8.5), because a noise-excited Karplus-Strong string is bright at the source. The bass is now `synths.FingerBass`: the same string with a finger excitation (a triangle pulse plus noise low-passed at six times the note's fundamental), then the bass strip (LP 1.5 kHz in beds and the end-screen bed, 2.5 kHz elsewhere; no 850 Hz lift; drive 2.5 dB at mix 0.3). After the strip: 1-4 kHz -16.6 dB of its power and under 150 Hz -0.6 dB in the band version; -19.3 / -0.5 in the bed version (acceptance: -15 or less, -4 or more). `FingerBassTests` checks it.
- **KICK-FIX.** The synth kick decays in 0.11 s with 2 dB of drive (was 0.2 s and 4 dB), its beater layer sits 5 dB under it (9 in beds, with its 3.2 kHz click cut there), and every kick hit is tuned to the bass note above it (the bass's pitch class between 45 and 62 Hz, else its fifth, else 55 Hz), so no hit beats against the bass (25 of 82 theme kicks and 24 of 60 show-tension kicks did). In stings and bumpers the kick is 3 dB down and the snare 2 dB up. On the landings the kick now sits 8.7-13.1 dB under the mix (it was the loudest or second-loudest element, 2.9-5.5 dB under).
- **DUCK-FIX.** `scripts/audio/duck.py` now ducks by band by default (zero-phase Butterworth splits at 700 Hz and 5 kHz; -2 / -12 / -4 dB). `docs/AUDIO.md` has the details.
- **POCKET-FIX.** Every bed bus dips 1.25 and 2 kHz by 3 dB (was one broad 2.5 kHz dip), and the bed gate is now voice-referenced (`composer/voicegate.py`, `targets.py`): the old 1-4 kHz pocket number is a warning only.
- **UNDERSCORE.** Every bed has a `-underscore` version without the motif and lead lines; the tests check that no motif statement survives in them.
- **Humanising.** The EP and bass in beds and the end screens vary velocity by 8 (was 4).
- **Zoo's F0.** `DIRECTION.md` now states the measured voice (F0 median 81-88 Hz, P5-P95 68-119 Hz). Bed pulses and motif statements are kept above 180 Hz (`test_no_bed_line_in_zoos_f0_range`).

**Per cue** (all numbers measured on the delivered files)
- **theme-full.** B lost its snare and hats (cross-stick and shaker only), its pad, EP, piano, kick and string swells came down; A' gained a sustained pad and violas per chord (voicings audited clean), brass -3 dB and claps -7.5 dB; the glue is -18 dB at 1.5:1; a bus ride of -0.4 / -1.1 / +0.2 dB on A / B / A' finishes what the master limiter flattens. The muted guitar is low-passed at 2.5 kHz and sits at -14 dB. Badger's figure gained the celli double (E-flat 4 to D4) and his own cross-stick, and both of his tracks have their peaks shaved (`peak_shave`), because his stacked transients drove the limiter to 9 dB of gain reduction on his button. Ceiling -2.2 dBTP, 2 dB less air above 9 kHz, kick 1 dB under the other cues. Sections (LUFS): intro -15.2, A -14.1, B -16.2, A' -12.5, coda -13.9: B 2.1 LU under A and A' 1.6 LU over it (critic: B +0.6 over A, A' +0.9). Badger's button against the coda motif: -1.8 dB full range, -2.9 dB on the phone model (-2.8, -4.5). True peak -2.5 dBTP; after AAC 128 kb/s -1.2 dBTP, the worst of five encodes (-0.3). The bass stem: 1-4 kHz -16.6 dB of its power, under 150 Hz -0.6 dB (-3.6, -9.7).
- **theme-15s.** The band's first bar answers on vibes instead of a third motif statement (now stated twice); BASS-FIX, KICK-FIX, Badger's double and peak control; ceiling -2.2 dBTP and the same air cut. Badger -1.8 dB full / -2.4 dB phone (-2.6, -4.4); the kick on the landing 8.7 dB under the mix (5.1); after AAC -1.8 dBTP, worst of five.
- **theme-5s.** Two frames (66.7 ms) of digital silence before the downbeat, recorded as `downbeatSec` 0.0667 / `downbeatFrame30` 2 (and `downbeatStartFrame()` in `manifest.ts`); KICK-FIX, Badger's double. Badger -0.3 dB full / -0.8 dB phone (-3.9, -5.0); the kick on the landing 12.7 dB under the mix (5.5), the piano leads at 4.7 dB under; after AAC -1.2 dBTP.
- **intro-sting-show.** Kick -3 dB, its beater 5 dB under it, snare +2 dB, the piano octaves on SHOW +2 dB; Badger on the finger-plucked bass with the double and cross-stick. On the SHOW hit the piano leads (5.1 dB under the mix) and the kick is 12.9 dB under (it was the loudest element, 2.9 dB under). Onsets: snare, cymbal and brass start between -2 and +5 ms of frame 30 (within half a frame); Badger's D 7-15 ms after frame 58. Badger +0.9 dB full / +1.3 dB phone against the motif; after AAC -1.1 to -1.2 dBTP.
- **intro-sting-zoora.** The celesta is gone: hard-mallet vibraphone doubled by the harp carries the motif, over the soft vibes; the hit labels use Zoora wording. Phone loss 2.0 LU, after AAC -2.6 dBTP, harshness -9.7 dB.
- **bumper-rekt-meter.** Brass -9 dB, doubled by violas (fast bowing) at -6 dB. On the landing the brass is 16.8 dB under the mix (8.4) and the kick 13.1 dB under (4.6). Violas carry the stab at 10 dB under the mix (5.9 dB on the phone model); after AAC -1.1 dBTP.
- **bumper-red-flag.** Badger's notes on the finger-plucked bass, pizzicato celli and basses, the octave-up celli double (velocity 84) and his own cross-stick. Badger against the motif head: +1.7 dB on full range, 0.0 on the phone model (critic: -1.1 and -2.6). Mud 2.7 dB (it read 3.0 after the bass change until the double was cut 3 dB at 300 Hz); after AAC -1.3 dBTP.
- **bumper-one-fix.** Labelled D6/9; the EP has PK(400, -2, 1.0). Phone loss 3.4 LU; after AAC -2.0 to -2.2 dBTP.
- **bumper-scam-of-the-week.** The landing kick is tuned to the B-flat under it (no 3.3 Hz beat) and decays in 0.11 s; on the landing it is 12.4 dB under the mix. After AAC -0.7 dBTP, the worst of five (a warning-level check for stings: -0.5).
- **bumper-developing.** The piano left the ticker (pulse and hats only); brass -3 dB. Phone loss 3.4 LU; after AAC -1.1 dBTP.
- **bumper-correction.** Bus PK(650, -4.5, 1.2) and rewind width 0.7: boxiness 0.7 dB (3.43), mono loss 1.0 dB (1.54), windowed correlation minimum +0.20 (-0.05). Not applied: mastering it at -17 LUFS-I (the bumpers stay level-matched at -16). Phone loss 5.5 LU, after AAC -3.4 dBTP.
- **endscreen-bed and endscreen-music.** BASS-FIX, hats -10 dB, pulse -15 dB (and an octave up), no vibes replies in bars 0-5, the voice pocket, a 2.5 dB shelf under 150 Hz, the split duck. Index 0.83 against 0.69 for speech-shaped noise at the same loudness (first build, broadband duck: 0.67-0.69 against 0.76), narrowest band 800 Hz with 15.3 dB of margin (9.7), 8 % of speech frames under 3 dB in 1-4 kHz (28-29 %), phone loss 5.3 LU. `endscreen-music` is the new no-voice master at -18 LUFS-I (-18.1 LUFS-I, -2.3 dBTP, -1.9 dBTP after AAC, phone loss 4.8 LU).
- **bed-show-neutral.** BASS-FIX, POCKET-FIX, DUCK-FIX, UNDERSCORE, EP PK(400, -2) with brightness 1.1, the 150 Hz shelf. Index 0.84 against 0.68 for noise (first build: 0.71-0.72 against 0.75), 1-4 kHz median SNR 24 dB, 7-8 % of frames under 3 dB (28 %), phone loss 5.8-5.9 LU (4.5).
- **bed-show-tension.** Pulse two octaves over the bass (196-311 Hz), -14 dB and low-passed at 1.5 kHz; the motif on soft vibes at D5, motif version only; per-hit kick tuning; the EP re-voices every 4 bars and the bass walks into each phrase; hats -14 dB; the 150 Hz shelf. Index 0.78-0.79 against 0.69 for noise (first build: 0.70-0.71 against 0.76); phone loss 5.9 LU (5.9). Pitched lines under 180 Hz: only bass, sub, kick and the string drone remain there.
- **bed-show-light.** Pizzicato on quarters (8ths only in bars 16-21) at -9 dB, hats on quarters, no claps. Index 0.83-0.84 against 0.69 for noise (first build: 0.71-0.72 against 0.76); 1-4 kHz onsets within 15 dB of the voice 82-104 a minute (147 with the same duck before); syllable-rate modulation share 0.45-0.46 (0.51-0.53): still the busiest bed.
- **bed-story-curious.** Bowed vibes -6 dB, marimba width 0.5, harp 0.7, pad 0.8, the celesta replaced by soft vibes, bus PK(700, -2). Index 0.80 against 0.71 for noise (first build: 0.75-0.76, about equal to noise), 1-4 kHz median SNR 14-15 dB (5.7-6.1), frames under 3 dB 17-18 % (40 %), narrowest band 9.8-10.6 dB (3.8-4.4), correlation 0.52-0.56 (0.37), mono loss 1.3-1.4 dB (1.75), boxiness 0.8-1.9 dB (3.68). Phone loss still 2.6-2.8 LU (2.4).
- **bed-story-tension.** Violas (fast bowing) double the ostinato an octave up; woodblock 32/24; the motif fragments moved to vibes and violins (motif version only). Phone loss 6.6-6.7 LU (7.9). Index 0.79 against 0.69 for noise (first build: 0.77-0.79 with the broadband duck, 0.83 with this duck: the upper layer costs some intelligibility margin).
- **bed-story-ominous.** Saturated tremolo basses, a bowed-vibes D4/A4 drone, a 600-900 Hz skin click on each heartbeat, the parts a phone cannot play turned down and a 3 dB shelf under 150 Hz: phone loss 5.7-6.0 LU (9.2; acceptance 6 or less). The bar-16 drones ring through the seam: the restart is now 1.5 LU under the bar before it (+3.3 LU, the loop's largest step). The motif is at D4/D5 and only in the motif version. Index 0.84-0.85.
- **bed-story-resolve.** Piano width 0.6, harp 0.7: correlation 0.60-0.61 (0.43), windowed minimum +0.11 (-0.39), mono loss 1.1 dB (1.68). Index 0.83 against 0.71 for noise (first build: 0.74-0.77, just under noise at 0.77); narrowest band 800 Hz at 9.8-11.1 dB (7.5).
- **SFX.** Whooshes target -21 LUFS (all 15 suggested gains 3 dB lower); UI sounds -27 LUFS with a -3 dB trim under speech and `speech_mask.py` plus `nearestGapFrame()` to place them in Zoo's gaps; the pop and plop groups hold one pitch each (the rising set is its own ordered group); the DEVELOPING pulse and loop gained a D5 partial (phone loss 2.8 dB or less; was 4.6-6.2); the rekt alarm gained an octave-up layer through a 3 kHz low-pass (phone loss 1.6-3.7 dB; was 7.1). Committed separately (56a0c3b).

**Library depth (critic's #4, HIGH): partly done.** The underscore versions give every mood a version for speech, and the beds now vary more inside their minute (the show-tension EP re-voices every 4 bars and the bass walks into each phrase). The two more arrangement variants per mood (or 128 s cycles) and shipped stems are **not** done: 14 more 64 s beds would take another round of composing and measuring, and the stems run about 60 MB per bed (14 to 28 tracks as 24-bit FLAC), over 800 MB for the 14 beds, too much for a public repository. The stems are rendered on request (`build.py <id> --stems --no-export`).
