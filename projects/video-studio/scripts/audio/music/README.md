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

Critic round 1 (2026-11-24) measured the first build against Zoo's real voice and on a phone-speaker model; critic round 2 measured round 1's build per note, per stem and against four of Zoo's narrations. Everything below reflects both rounds of fixes; what changed and why is in "Round 1" and "Round 2" at the end.

## The cues (`public/audio/music/`)

`manifest.json` lists every cue: path (relative to `public/`, for `staticFile`), length in seconds and samples, loop points, hits, the sync point (`downbeatSec`), key, tempo and loudness. Each cue also has `<id>.json`, the full metadata: sections, motif statements, spectrum, the voice gate, the checks that ran and the self-review.

| Cue | File | Length | Key, tempo | Loudness | Use |
| --- | --- | --- | --- | --- | --- |
| `theme-full` | FLAC, 16-bit | 68.4 s | D minor, 100 | -16 LUFS-I | cold opens, trailers |
| `theme-15s` | WAV, 24-bit | 15.0 s | D minor, 100 | -16 LUFS-I | short opens, promos |
| `theme-5s` | WAV, 24-bit | 5.0 s | D minor, 100 | -16 LUFS-I | logo sting, outs, Shorts endings; the downbeat is at 2 frames |
| `intro-sting-show` | WAV, 24-bit | 4.0 s | D minor | -16 LUFS-I | the jingle for `ShowSting` |
| `intro-sting-zoora` | WAV, 24-bit | 4.5 s | F lydian, 100 | -16 LUFS-I | the jingle for `ZooraSting` (its bloom decays naturally by 4.5 s) |
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
  The split duck keeps the bed down through pauses under 0.8 s and comes back up over 1.2 s, so the mids do not bloom between phrases (critic round 2).
  In Remotion, play the ducked file, and pass its path through `underNarration()` from `manifest.ts`: it throws for a raw cue (`audio/music/...`) or any file not named `<name>.ducked.wav|flac`, so a bed cannot reach the mix unducked by mistake: `<Audio src={staticFile(underNarration('generated/<channel>/<slug>/en/bed.ducked.wav'))} />`. A `volume` callback can only apply one gain to every band, so it cannot reproduce the split duck; `--depth 6` (broadband) exists for that case and measures worse (critic round 2: 0.71-0.76 on the weakest beds, under the 0.75 gate).
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
- `composer/instruments.py`: the palette, as cached samplers. Every sample plays from its measured root (`measured_root`: harmonic partials 1-4 within 10 dB of the strongest), so the harp and the Kawai's low octaves are in tune with the synths.
- `composer/gmtune.py`: per-key, per-velocity intonation of the MuseScore VSCO 2 strings, measured once (`gm_tuning.json`) and corrected with MIDI Tuning Standard messages in each part's MIDI.
- `composer/synths.py`: our own voices, among them the finger-plucked bass (`FingerBass`, a waveguide string whose upper harmonics decay faster than its fundamental) and the kick, one fixed tuning (52 Hz) for every hit (`kick_tuning`).
- `composer/cues/*.py`: the compositions: theme, show cues, show beds, Zoora.
- `composer/render.py`: the pipeline from stems to master.
  - Stems are rendered per part (fluidsynth for the MuseScore strings, the VCSL samplers, our synths) and cached by content.
  - Loops: each stem's tail is folded onto its start, then mixed with wrap-around padding, so the reverbs and compressors see the seam. The master runs with `loop=True`.
  - Channel strips run in parallel; a track can shave its own peaks first (`peak_shave`: by a fixed amount, or every transient more than `max_plr_db` over the stem's own loudness), and the bus can carry a section ride (`bus_ride`, used on the full theme). Band cues compress the kick, snare, hats, claps, EP and brass fast and hold the piano's peaks (`theme.BAND_COMPS`, `BAND_PEAK_SHAVE`), so the master limiter works 4 dB or less.
  - The mix uses three reverbs (plate, hall, room; each return can be narrowed), bus EQ and the glue compressor. Mastering uses the engine's presets (`standalone`, `sting`, `bed`) plus `endscreen` (-18 LUFS-I); the theme cuts master at -16 LUFS-I with a -2.2 dBTP ceiling, the stings and bumpers at -1.5 dBTP.
- `composer/voicegate.py`: the voice gate. The references are four of Zoo's own narrations (`voiceref/*.json`: the engine demo, the show's real narration, zoo-badger-demo and the Spanish Zoora demo), stored as band levels, not audio. For each bed it computes a short-time band-audibility index (ANSI S3.5-1997 one-third-octave weights, 32 ms frames) under the planned duck for each narration; a bed passes when the lowest of them is 0.75 or more. The same index for speech-shaped noise at the same loudness is reported for information.
- `composer/targets.py`: the package's checks on top of the engine's `targets.json`: the voice gate replaces the old 1-4 kHz pocket check for beds, `endscreen` gets its own profile, the theme's loudness window is -16 LUFS-I, and the theme and end-screen music must stay at or under -1 dBTP after AAC 128 kb/s (the worst of ten encodes, `audiolib/codec.py`).
- `composer/audit.py`: what writing blind needs. It flags held semitone and minor-ninth rubs between parts, and ranges; the theme has a test that fails on any new one.
- Every render is measured with `scripts/audio/metrics.py` (loudness, true peak, spectrum balance, stereo and mono, noise, the tail or loop seam, spectrogram and waveform PNGs) plus the voice gate and the AAC check. Every cue passes every fail-level check.

## Measured (critic round 2 build, 2026-11-24)

Every cue passes every fail-level check of its profile.
- "Tilt" is the octave-band slope (pink = -3 dB/oct). "Harsh", "mud" and "box" are the 2-5 kHz, 200-500 Hz and 500-1000 Hz deviations from the pink line.
- "After AAC 128k" is the true peak after an ffmpeg AAC 128 kb/s encode (YouTube re-encodes): for the theme, stings, bumpers and end-screen music the worst of ten encodes of copies that differ only in their last-bit dither (`audiolib/codec.py`), because that encoder is chaotic on dense, bright material (one theme-15s master read from -1.9 to +0.2 dBTP across such copies, while Opus 128k read -1.5 on every one). Beds are not encoded: they peak 6-11 dB under the ceiling.
- "Phone loss" is the loudness lost on the critic's phone model (mono, 4th-order high-pass at 350 Hz, low-pass at 12 kHz, +3 dB at 3 kHz). Zoo's voice loses 5.4-5.7 LU on it (four narrations), so a cue near that keeps its balance against him on a phone.
- "Limiter" is the master limiter's gain reduction in 10 ms blocks: its maximum and the share of the cue where it works more than 1 dB (critic round 2's acceptance: 4 dB and 8 % on the theme, 3 dB on the red-flag bumper).
- LRA is not meaningful on 3 s bumpers.

| Cue | Loudness | True peak | After AAC 128k | LRA | Tilt / harsh / mud / box (dB) | Stereo corr. / mono loss | Phone loss | Limiter max / >1 dB | Warnings |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `theme-full` | -16.0 LUFS-I | -2.5 dBTP | -1.9 dBTP | 7.0 | -5.29 / -6.43 / 0.98 / -1.30 | 0.76 / -0.76 | -4.3 LU | 3.7 dB / 1.5 % | none |
| `theme-15s` | -16.1 LUFS-I | -2.5 dBTP | -1.6 dBTP | 3.5 | -5.16 / -5.60 / 0.31 / -0.65 | 0.76 / -0.81 | -4.2 LU | 3.1 dB / 6.3 % | none |
| `theme-5s` | -16.1 LUFS-I | -1.8 dBTP | -1.3 dBTP | 3.1 | -5.45 / -7.24 / 1.85 / -0.60 | 0.74 / -0.65 | -3.8 LU | 1.7 dB / 1.4 % | none |
| `bumper-rekt-meter` | -16.2 LUFS-I | -1.8 dBTP | -1.5 dBTP | 20.1 | -4.59 / -4.30 / 0.90 / -0.94 | 0.65 / -1.04 | -3.0 LU | 2.9 dB / 5.0 % | noise.humDb |
| `bumper-red-flag` | -16.2 LUFS-I | -1.8 dBTP | -1.3 dBTP | 20.3 | -5.88 / -8.26 / 2.26 / -1.57 | 0.67 / -0.85 | -3.8 LU | 3.0 dB / 5.9 % | none |
| `bumper-one-fix` | -16.0 LUFS-I | -2.0 dBTP | -1.4 dBTP | 20.0 | -5.93 / -8.66 / 1.13 / 2.19 | 0.54 / -1.43 | -3.5 LU | 0.0 dB / 0.0 % | noise.humDb |
| `bumper-scam-of-the-week` | -16.0 LUFS-I | -2.3 dBTP | -2.0 dBTP | 1.1 | -4.74 / -5.22 / 0.09 / -3.78 | 0.71 / -0.98 | -3.8 LU | 0.6 dB / 0.0 % | noise.humDb |
| `bumper-developing` | -16.1 LUFS-I | -1.8 dBTP | -2.2 dBTP | 0.4 | -5.05 / -6.38 / -3.66 / -4.37 | 0.76 / -0.86 | -3.7 LU | 1.6 dB / 1.2 % | noise.humDb |
| `bumper-correction` | -16.2 LUFS-I | -3.6 dBTP | -3.4 dBTP | 0.0 | -6.64 / -11.45 / -2.30 / -0.60 | 0.67 / -0.89 | -5.7 LU | 0.0 dB / 0.0 % | none |
| `intro-sting-show` | -16.0 LUFS-I | -1.8 dBTP | -2.1 dBTP | 1.8 | -5.44 / -6.94 / 1.69 / -1.74 | 0.78 / -0.67 | -4.6 LU | 1.9 dB / 1.8 % | none |
| `endscreen-bed` | -26.0 LUFS-S | -7.2 dBTP | - | 0.6 | -5.40 / -8.86 / 2.76 / -1.90 | 0.86 / -0.51 | -6.1 LU | - | noise.humDb |
| `endscreen-music` | -18.0 LUFS-I | -2.5 dBTP | -2.4 dBTP | 1.0 | -5.55 / -9.66 / -0.27 / -0.74 | 0.86 / -0.55 | -5.5 LU | 0.0 dB / 0.0 % | none |
| `bed-show-neutral` | -26.0 LUFS-S | -6.3 dBTP | - | 2.3 | -5.34 / -9.10 / 2.20 / -4.08 | 0.84 / -0.51 | -6.0 LU | - | noise.hfFloorDbfs, loop.levelStepDb |
| `bed-show-neutral-underscore` | -26.0 LUFS-S | -6.3 dBTP | - | 2.2 | -5.59 / -8.97 / 2.91 / -4.74 | 0.87 / -0.40 | -6.5 LU | - | noise.hfFloorDbfs, loop.levelStepDb |
| `bed-show-tension` | -26.0 LUFS-S | -6.3 dBTP | - | 1.4 | -5.33 / -7.40 / -0.98 / -5.52 | 0.76 / -0.81 | -7.2 LU | - | noise.humDb, noise.hfFloorDbfs, loop.levelStepDb |
| `bed-show-tension-underscore` | -26.0 LUFS-S | -6.3 dBTP | - | 1.5 | -5.33 / -7.12 / -0.82 / -5.72 | 0.77 / -0.80 | -7.3 LU | - | noise.humDb, noise.hfFloorDbfs, loop.levelStepDb |
| `bed-show-light` | -26.0 LUFS-S | -6.3 dBTP | - | 1.2 | -4.88 / -6.36 / 1.97 / -3.88 | 0.87 / -0.48 | -4.9 LU | - | noise.humDb, loop.levelStepDb |
| `bed-show-light-underscore` | -26.0 LUFS-S | -6.3 dBTP | - | 1.4 | -4.89 / -6.01 / 2.16 / -4.37 | 0.87 / -0.50 | -5.0 LU | - | noise.humDb, loop.levelStepDb |
| `intro-sting-zoora` | -16.0 LUFS-I | -2.3 dBTP | -2.2 dBTP | 1.2 | -3.99 / -8.67 / -3.33 / 1.17 | 0.52 / -1.37 | -1.5 LU | 0.0 dB / 0.0 % | noise.humDb |
| `bed-story-curious` | -27.5 LUFS-S | -6.2 dBTP | - | 1.4 | -4.49 / -10.03 / 2.56 / 1.47 | 0.60 / -1.13 | -2.4 LU | - | loop.levelStepDb |
| `bed-story-curious-underscore` | -27.6 LUFS-S | -6.2 dBTP | - | 1.8 | -5.03 / -9.72 / 2.49 / 0.64 | 0.67 / -0.97 | -3.3 LU | - | loop.levelStepDb |
| `bed-story-tension` | -26.0 LUFS-S | -8.3 dBTP | - | 2.3 | -5.91 / -7.28 / 0.23 / -3.18 | 0.81 / -0.54 | -8.0 LU | - | spectrum.voicePocketDb |
| `bed-story-tension-underscore` | -26.0 LUFS-S | -7.8 dBTP | - | 3.4 | -5.97 / -7.80 / 1.42 / -4.79 | 0.80 / -0.58 | -8.6 LU | - | none |
| `bed-story-ominous` | -26.0 LUFS-S | -8.3 dBTP | - | 2.0 | -5.17 / -10.41 / -0.58 / 0.93 | 0.79 / -0.85 | -5.7 LU | - | noise.humDb |
| `bed-story-ominous-underscore` | -26.0 LUFS-S | -9.2 dBTP | - | 2.0 | -5.18 / -10.35 / -1.34 / -0.15 | 0.81 / -0.80 | -5.7 LU | - | noise.humDb |
| `bed-story-resolve` | -26.0 LUFS-S | -10.3 dBTP | - | 5.8 | -5.43 / -13.48 / -1.29 / -2.63 | 0.66 / -0.99 | -4.9 LU | - | loop.levelStepDb |
| `bed-story-resolve-underscore` | -26.0 LUFS-S | -10.6 dBTP | - | 5.1 | -5.45 / -13.02 / -0.57 / -3.14 | 0.66 / -0.99 | -5.4 LU | - | loop.levelStepDb |

**Under Zoo's voice.** Each of four narrations (the engine demo, the show's real narration, zoo-badger-demo and the Spanish Zoora demo) over each bed looped under it, at the bed's level, with the band-split duck (and, for comparison, the broadband 6 dB duck), measured during speech. "Index" is the band-audibility index (1 = every band fully audible); the gate is the lowest of the four at 0.75. The SNR, frame and band columns are for the worst narration; speech-shaped noise at the same loudness is information only.

| Bed | Index, worst narration | demo en / show en / zoo-badger en / demo es | Speech-shaped noise | Broadband 6 dB duck | 1-4 kHz SNR median | Frames under 3 dB | Narrowest band |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `endscreen-bed` | 0.843 (zoo-badger en) | 0.849 / 0.845 / 0.843 / 0.852 | 0.685 | 0.817 | 25.3 dB | 7 % | 800 Hz, 17.5 dB |
| `bed-show-neutral` | 0.831 (show en) | 0.856 / 0.831 / 0.840 / 0.837 | 0.679 | 0.804 | 25.2 dB | 7 % | 800 Hz, 14.8 dB |
| `bed-show-neutral-underscore` | 0.836 (show en) | 0.862 / 0.836 / 0.844 / 0.844 | 0.674 | 0.809 | 24.7 dB | 7 % | 800 Hz, 16.0 dB |
| `bed-show-tension` | 0.794 (zoo-badger en) | 0.813 / 0.795 / 0.794 / 0.807 | 0.687 | 0.747 | 19.9 dB | 10 % | 800 Hz, 15.3 dB |
| `bed-show-tension-underscore` | 0.791 (zoo-badger en) | 0.812 / 0.795 / 0.791 / 0.807 | 0.683 | 0.743 | 19.4 dB | 11 % | 800 Hz, 16.0 dB |
| `bed-show-light` | 0.842 (show en) | 0.857 / 0.842 / 0.846 / 0.850 | 0.686 | 0.817 | 25.7 dB | 7 % | 800 Hz, 17.8 dB |
| `bed-show-light-underscore` | 0.849 (show en) | 0.866 / 0.849 / 0.851 / 0.856 | 0.685 | 0.824 | 26.3 dB | 7 % | 2000 Hz, 19.2 dB |
| `bed-story-curious` | 0.799 (zoo-badger en) | 0.814 / 0.804 / 0.799 / 0.810 | 0.747 | 0.760 | 14.7 dB | 18 % | 800 Hz, 10.4 dB |
| `bed-story-curious-underscore` | 0.829 (zoo-badger en) | 0.843 / 0.834 / 0.829 / 0.839 | 0.737 | 0.797 | 18.9 dB | 12 % | 800 Hz, 11.5 dB |
| `bed-story-tension` | 0.782 (show en) | 0.803 / 0.782 / 0.786 / 0.797 | 0.683 | 0.723 | 16.4 dB | 14 % | 800 Hz, 15.2 dB |
| `bed-story-tension-underscore` | 0.791 (show en) | 0.813 / 0.791 / 0.794 / 0.802 | 0.683 | 0.731 | 17.2 dB | 13 % | 1000 Hz, 17.9 dB |
| `bed-story-ominous` | 0.806 (zoo-badger en) | 0.839 / 0.815 / 0.806 / 0.825 | 0.683 | 0.767 | 17.8 dB | 14 % | 800 Hz, 11.5 dB |
| `bed-story-ominous-underscore` | 0.803 (zoo-badger en) | 0.840 / 0.813 / 0.803 / 0.823 | 0.684 | 0.764 | 17.3 dB | 14 % | 800 Hz, 12.1 dB |
| `bed-story-resolve` | 0.822 (show en) | 0.854 / 0.822 / 0.824 / 0.831 | 0.718 | 0.786 | 20.5 dB | 10 % | 800 Hz, 10.4 dB |
| `bed-story-resolve-underscore` | 0.813 (zoo-badger en) | 0.846 / 0.814 / 0.813 / 0.825 | 0.716 | 0.773 | 19.3 dB | 12 % | 800 Hz, 13.1 dB |

The theme's arc, the critic's acceptance (B at least 2 LU under A, A' at least 1.5 LU over it), measured on the delivered master:

| Section | intro | A | B | A' | coda |
| --- | --- | --- | --- | --- | --- |
| First build | -16.8 | -14.4 | -13.8 | -13.5 | -15.1 |
| Round 1 | -15.2 | -14.1 | -16.2 | -12.5 | -13.9 |
| Round 2 (mastered 2 LU lower) | -17.7 | -16.7 | -19.4 | -13.8 | -15.3 |

Badger's figure against the motif before it (BS.1770 on the two windows), full range / phone model:

| Cue | First build | Round 1 | Round 2 |
| --- | --- | --- | --- |
| `theme-full` | -2.8 / -4.5 dB | -1.8 / -2.9 dB | -1.8 / -2.9 dB |
| `theme-15s` | -2.6 / -4.4 dB | -1.8 / -2.4 dB | -2.4 / -2.8 dB |
| `theme-5s` | -3.9 / -5.0 dB | -0.3 / -0.8 dB | -1.2 / -2.9 dB |
| `intro-sting-show` | -2.1 / -1.3 dB | +0.9 / +1.3 dB | +0.1 / 0.0 dB |
| `bumper-red-flag` | -1.1 / -2.6 dB | +1.7 / +0.0 dB | -0.1 / -1.9 dB |

Round 1's numbers came with Badger's double at +11 dB, which drove the master limiter to 6-10 dB on his notes (critic round 2). Round 2 gives back a little of his level for a limiter under 4 dB; the acceptance is -3 dB or better on the phone model.

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
- **VSCO 2 pizzicato partials.** The per-key correction puts each pizzicato note's strongest partial within a few cents, but these samples' upper partials do not sit on exact harmonics: on the violas and on Badger's octave-up celli the 2nd-4th partials read 8-30 cents sharp of the corrected fundamental (measured per note in the delivered stems). On a phone speaker, which drops the fundamentals, those notes can read up to that much sharp. Replacing the pizzicato layer with a better-recorded CC0 set is the remaining fix.
- **Loudness of the theme.** The theme cuts master at -16 LUFS-I (the critic's limiter acceptance could not be met at -14 or -15 without squashing the hits); as a standalone upload they play 2 LU under -14 LUFS programme.
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

## Round 2 (critic, 2026-11-24): what changed

The critic measured round 1's build per note, per stem and per narration and heard nothing; so did this round. Each item: what changed, then the new measurement on the delivered files (the critic's number in brackets). Acceptance numbers are the critic's.

**Shared fixes**
- **Tuning.** Every sampled instrument now plays from its measured pitch.
  - `instruments.measured_root` estimates each sample's root from its harmonic partials 1-4 within 10 dB of the strongest, over 0.04-0.54 s, after a coarse search of ±150 cents (so a mislabelled sample is caught). The critic suggested partials 2-4 under C3; that read the harp's strong E1 fundamental 11 cents sharp, while the 10 dB rule drops the Kawai's weak low fundamentals just as well. The harp (`keep_layers=(3, 4)`) and the Kawai's sustains use it; the glockenspiel and kalimba keep their single-peak estimate. The search found one mislabelled Kawai sample: "A#-1" sounds A0 (root 20.91), so the old map played every note it served a semitone flat (a written B-flat 0 sounded A0).
  - Engine fix (`audiolib/sampler.py`): with fractional roots the sampler skipped a sample whose measured root sat a few cents above the key; it now takes the nearest root at or below key + 0.5 (`test_measured_fractional_roots`).
  - The MuseScore VSCO 2 strings are corrected per key and per velocity layer with MIDI Tuning Standard messages (`composer/gmtune.py`; the table `composer/gm_tuning.json` is keyed by the soundfont's hash). The critic proposed one -10 cent bend; the measured errors are per key (celli E-flat 3 +16.6 c, violas D4 -25 to -30 c) and change with velocity (two layered samples per key), so one bend could not fix them. Badger's pizzicato notes measured +16.6 / +11.4 / -4.5 / -4.5 c and now -0.2 / -0.4 / -0.5 / -0.5 c.
  - Tests: `PitchTests` on every harp root (±4 c) and on the Kawai's D1, D2, A2 and D3 (±5 c); `GmTuningTests` on the MTS encoding and the corrected keys.
  - Per-note intonation measured on the delivered stems against the MIDI (partials 1-4): piano D1 -0.7 c and D2 +0.1 c in theme-full (critic: -14.9 and -17.0 c); the FingerBass 0.0 c; the harp +0.1 c median, 0 of 9 beyond 10 c in bumper-one-fix, +0.1 c median, 0 of 159 beyond 10 c in bed-story-curious and +0.2 c median, 0 of 15 beyond 10 c in the Zoora jingle (critic: -11.2, -9.2 and -5.7 to -8.4 c); celli pizzicato -1.6 c median, 0 of 4 beyond 10 c in theme-15s (critic: +8 to +16 c). Each note's deviation is that of its strongest partial (`gmtune`'s measure). The VSCO 2 pizzicato samples' upper partials do not sit on exact harmonics: on Badger's octave-up double the 2nd-4th partials read about +8 c while the fundamental reads -2 c, and on the violas pizzicato up to +30 c (see Limits).
- **Master limiting and Badger.** The critic's recipe for Badger's octave-up double is in: its compressor works from -24 dB at 4:1 with a 0.5 ms attack, and PK(1500 Hz, +4 dB, Q 1) carries it on a phone. Its fader is set by the phone check, +10 dB: at the critic's +5 he sat 4-5 dB under the motif on the phone model. The recipe alone left the limiter at 9.2 dB on theme-15s, because Badger's cross-stick click and the band's stacked hits were the other triggers (measured stem by stem at every reduction over 3 dB). So:
  - Badger's cross-stick is 7 dB lower and low-passed at 5 kHz.
  - His figure has no kick under it: its sub drove the limiter, and a phone does not play it.
  - The red-flag bumper's deadpan click moved onto his cross-stick track.
  - Band cues compress the kick, snare, hats, claps, EP and brass fast (`theme.BAND_COMPS`) and hold the piano's hammer peaks to 14 dB over its own loudness (`BAND_PEAK_SHAVE`).
  - The theme cuts master at -16 LUFS-I. At -15, the critic's fallback, theme-full still limited 4.84 dB and theme-15s worked over 1 dB for 10.6 % of the cue; at -16 every acceptance number is met (accept: limiter 4 dB and 8 % on the theme, 3 dB on red-flag; Badger -3 dB or better on the phone model):

  | Cue | Master limiter: max, time over 1 dB | Badger vs the motif: full range / phone model |
  | --- | --- | --- |
  | `theme-full` | 3.70 dB, 1.5 % (8.29 dB, 24.0 %) | -1.8 / -2.9 dB |
  | `theme-15s` | 3.15 dB, 6.3 % (9.91 dB, 28.9 %) | -2.4 / -2.8 dB |
  | `theme-5s` | 1.70 dB, 1.4 % (3.2 dB) | -1.2 / -2.9 dB |
  | `intro-sting-show` | 1.92 dB, 1.8 % (2.1 dB) | +0.1 / 0.0 dB |
  | `bumper-red-flag` | 2.99 dB, 5.9 % (5.97 dB, 13.1 %) | -0.1 / -1.9 dB |
- **FingerBass.** The waveguide string now has a frequency-dependent loss filter (decay rate R0·(1 + (f/230 Hz)²), a one-pole low-pass in the loop) and a first-order Thiran allpass for the fractional delay, so the upper harmonics die faster than the fundamental, as on a plucked string, and the pitch stays exact. The critic's dynamic low-pass after the loop would have darkened the note without changing how it decays. Isolated notes, E1 to D3: harmonic 8 decays 3.1-15.3 times and harmonic 16 7.8-37 times faster than the fundamental (acceptance 3 and 5; it was 1.05 and 1.2), pitch within ±0.25 cents.
- **The planned duck.** The band-split duck fills pauses under 0.8 s and releases over 1.2 s (`audiolib/duck.py` `SPLIT_MIN_GAP`, `SPLIT_RELEASE`; broadband keeps 0.35 and 0.5 s); the 12 dB mid depth stays. Pauses where the mid band comes back up by 6 dB or more, per minute of narration: 9.0-13.4 before, 5.7-7.1 now on the four narrations (the critic counted 8.1-10.2 and 4.9-6.1 with its own definition). The Remotion path: `manifest.ts` exports `underNarration(src)`, which refuses any raw cue (`audio/music/...`) and any file not named `<name>.ducked.wav|flac`, so music under speech must come from `duck.py` (two node tests).
- **Voice gate.** `voice.index` is the minimum over four narrations in `voiceref/`: the engine demo (en), the show's real narration (2026-11-24-binance, en), zoo-badger-demo (en) and the Zoora demo dub (es). The 0.75 gate stays; `indexMinusSsn` is information only. Every bed's metadata lists the index per narration and the worst one.
- **Codec check in the engine.** `audiolib/codec.py` encodes ten copies (the file and nine last-bit dither variants) with ffmpeg's AAC at 128 kb/s and reports the worst; `metrics.py` computes `aac.truePeak128k` whenever a profile asks for it, so `metrics.py` with the music targets no longer exits 1 on `endscreen-music` for a missing metric.

**Per cue** (all numbers measured on the delivered files)
- **theme-full.** -16 LUFS-I; limiter 3.70 dB max, over 1 dB 1.5 % of the time (critic: 8.29 dB, 24.0 %); Badger -1.8 dB against the motif (phone model -2.9 dB) (acceptance -3). Kick: one tuning (52 Hz) for all 79 hits: their spectral peaks over the first 100 ms span 71.8-72.5 Hz, 0.18 semitones (critic: 61-75 Hz, 3.6 semitones). Piano D1 -0.7 c, D2 +0.1 c (-14.9, -17.0); the FingerBass 0.0 c median. A' lifts into its last phrase: bars 1-4 -13.9, bars 5-7 -13.2, the turnaround bar -15.7 LUFS (short-term range over A' 2.1 LU; it sat within ±0.5 LU for 19 s). Arc: intro -17.7, A -16.7, B -19.4, A' -13.8, coda -15.3 LUFS. -1.9 dBTP after AAC 128k (worst of ten).
- **theme-15s.** -16 LUFS-I; limiter 3.15 dB max, over 1 dB 6.3 % of the time (critic: 9.91 dB, 28.9 %); Badger -2.4 dB against the motif (phone model -2.8 dB). Piano D2 +0.0 c, D1 -0.5 c (-17.2, -11.8). -1.6 dBTP after AAC 128k (worst of ten).
- **theme-5s.** Limiter 1.70 dB max, over 1 dB 1.4 % of the time; Badger -1.2 dB against the motif (phone model -2.9 dB). Piano D2 +0.4 c on the SHOW hit (-17.2), celli pizzicato -1.6 c median (n 2, 0 beyond 10 c) (+8 to +12). -1.3 dBTP after AAC 128k (worst of ten).
- **intro-sting-show.** Limiter 1.92 dB max, over 1 dB 1.8 % of the time; Badger +0.1 dB against the motif (phone model 0.0 dB). Piano D2 -0.3 c (-17.0). Ceiling -1.5 dBTP: Opus 128k -1.6 dBTP (critic: -1.0); -2.1 dBTP after AAC 128k (worst of ten).
- **intro-sting-zoora.** Harp +0.2 c median (n 15, 0 beyond 10 c) against hard vibes 0.0 c median (n 7, 0 beyond 10 c) (critic: harp -5.7 to -8.4 c, 3.4-5.1 Hz beating); harp width 0.3: its stem's L/R correlation 0.95, mono loss -0.5 dB (critic: up to 3.7 dB on A5 and F6). 4.5 s long, the bloom released by 3.3 s and the bass drum and cymbal damped from 3.2 s: at 4.2 s the cue is down to -52.7 dBFS RMS, the hall tail of the tag notes (the drum and cymbal rang at -39 and -43 dBFS there before), and the final 0.3 s fade takes the rest (last 50 ms peak -59.9 dBFS). It is not yet a fully natural decay to -60 dBFS. Frame 70 (C6, 12 velocity firmer, the critic's fix): +0.8 dB at 0.9-1.6 kHz (critic: -1.4; +20 velocity measured only +1.4, because the logo hit still rings in that band); frame 78: +5.3 dB. -2.2 dBTP after AAC 128k (worst of ten).
- **bumper-red-flag.** Limiter 2.99 dB max, over 1 dB 5.9 % of the time (critic: 5.97 dB, 13.1 %; acceptance 3); Badger -0.1 dB against the motif (phone model -1.9 dB). Mud 2.26 dB (critic: 2.68; 4.7 before this bus EQ). On the button: piano D2 +0.1 c, bass +0.1 c median (n 2, 0 beyond 10 c), celli pizzicato -1.0 c median (n 5, 0 beyond 10 c), basses pizzicato -4.0 c median (n 2, 0 beyond 10 c) (critic: a 32 c spread). -1.3 dBTP after AAC 128k (worst of ten).
- **bumper-one-fix.** Harp +0.1 c median (n 9, 0 beyond 10 c) (critic: -11.2 c median, 6 of 9 beyond -10 c); the master limiter does not work (0.0 dB). -1.4 dBTP after AAC 128k (worst of ten).
- **endscreen-music.** The FingerBass now decays like a plucked string, and the bass sits 1.5 dB under the theme's: bass share -4.1 dB of the mix on full range (critic: -4.0; still the loudest stem, as in most grooves) and -12.2 dB on the phone model (critic: -8.9). the master limiter does not work (0.0 dB). -2.4 dBTP after AAC 128k (worst of ten); metrics.py now computes that check itself.
- **bed-show-tension.** Voice index 0.794-0.813 (worst zoo-badger en) over the four narrations; -26.0 LUFS-S; phone prominence against Zoo -1.6 dB. EP voicings change by section (three sets) and the second section's harmony moves (D D Eb Eb Bb G A A); bus PK(700, -4.5) and PK(500, -2). Underscore: Voice index 0.791-0.812 (worst zoo-badger en) over the four narrations; -26.0 LUFS-S; phone prominence against Zoo -1.7 dB.
- **bed-show-light.** Voice index 0.842-0.857 (worst show en) over the four narrations; -26.0 LUFS-S; phone prominence against Zoo +0.7 dB. Hall return -2 dB at width 0.8, bus LS(250, +2) and PK(800, -2); 200 ms correlation minimum -0.24 (critic: -0.45). Underscore: Voice index 0.849-0.866 (worst show en) over the four narrations; -26.0 LUFS-S; phone prominence against Zoo +0.6 dB. 200 ms correlation minimum -0.05 (critic: -0.28).
- **bed-story-curious.** Voice index 0.799-0.814 (worst zoo-badger en) over the four narrations; -27.5 LUFS-S; phone prominence against Zoo +3.2 dB (a spectral ratio that the level does not change; the bed masters 1.5 LU under the others, so on a phone it sits about where a +1.7 dB bed would at -26 LUFS-S). Harp +0.1 c median (n 159, 0 beyond 10 c) (critic: -9.2 c over 159 notes); harp width 0.3: 200 ms correlation minimum -0.03 (critic: -0.26); mastered at -27.5 LUFS-S. Underscore: Voice index 0.829-0.843 (worst zoo-badger en) over the four narrations; -27.6 LUFS-S; phone prominence against Zoo +2.3 dB. No bowed vibes, harp -8 dB, mastered at -27.5 LUFS-S.
- **bed-story-tension.** Voice index 0.782-0.803 (worst show en) over the four narrations; -26.0 LUFS-S; phone prominence against Zoo -2.4 dB. Piano drones D1 -0.6 c, D2 +0.1 c (critic: -15 to -32 c); bus PK(700, -4.5) and PK(500, -2). Underscore: Voice index 0.791-0.813 (worst show en) over the four narrations; -26.0 LUFS-S; phone prominence against Zoo -3.0 dB. The celli ostinato an octave up (G3-F4, out of Zoo's F0 range) and no viola double.
- **bed-story-resolve.** Voice index 0.822-0.854 (worst show en) over the four narrations; -26.0 LUFS-S; phone prominence against Zoo +0.6 dB. Harp +0.2 c median (n 10, 0 beyond 10 c) (critic: -10.1 c); piano -0.1 c median (n 159, 0 beyond 10 c) (critic: D4 -11.7 c). Underscore: Voice index 0.813-0.846 (worst zoo-badger en) over the four narrations; -26.0 LUFS-S; phone prominence against Zoo +0.2 dB.
- **Release-ready in round 2 and re-rendered with the shared fixes:** bumper-rekt-meter, bumper-scam-of-the-week, bumper-developing, bumper-correction, endscreen-bed, bed-show-neutral and bed-story-ominous (both versions). Their numbers are in the tables above.
- **SFX notify.** The `developing_pulse` pick group is four single D4 pulses with micro-variation only (one pitch and rhythm, a fixed sonic brand); the double pulse is its own group (`developing_double_01-03`); the D5 pulse and the four-pulse ticker left the group. `test_library.py` checks one pitch and one rhythm per group.
