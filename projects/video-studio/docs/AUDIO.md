# Audio engine: music, stings and SFX from code

Version 1, 2026-11-24. Code: `scripts/audio/` (engine package `audiolib`, CLIs `metrics.py`, `render_reference.py`, `selfcheck.py`, `setup.sh`). Licences and evidence: `docs/AUDIO_LICENSES.md`. The composer owns `scripts/audio/music/**`, the sound designer `scripts/audio/sfx/**`; both build on this engine.

The owner's standard applies: broadcast and professional-YouTube quality, every sound fully owned. Everything here is deterministic (seeded), renders at **48 kHz**, and is measured before anyone listens.

## Quick start

```bash
cd projects/video-studio
scripts/audio/setup.sh                       # idempotent: apt pins, .venv-audio, sha256 checks, VCSL, selfcheck
python3 scripts/audio/render_reference.py    # 20 s trio -> out/audio/reference/ (about 12 s)
python3 scripts/audio/metrics.py out/audio/reference/reference_standalone.wav --profile standalone
.venv-audio/bin/python -m unittest discover -s scripts/audio/tests -t scripts/audio   # 85 tests, about 20 s
```

Every CLI re-executes itself inside `.venv-audio` (`audiolib.venv.ensure_venv`), so `python3` is enough. A script in `scripts/audio/music/` or `scripts/audio/sfx/` starts with:

```python
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))   # scripts/audio
from audiolib.venv import ensure_venv; ensure_venv()
from audiolib import dsp, fluid, humanize, io, master, synth, theory
from audiolib.midi import GM, Score
from audiolib.mix import Mix, Strip
from audiolib.sampler import Kit, SampleBank, Sampler
```

## Setup (`scripts/audio/setup.sh`)

| Step | What | Verified by |
| --- | --- | --- |
| System packages (Ubuntu 24.04 pins) | `fluidsynth=2.3.4-1build3`, `musescore-general-soundfont=0.2.1-1`, `musescore-general-soundfont-lossless=0.2.1-1` (362 MB; skip with `AUDIO_SKIP_LOSSLESS=1`), `fluid-soundfont-gm=3.1-5.3` | `dpkg-query` versions; installs with `apt-get` when root |
| Python | `.venv-audio/` (gitignored), `requirements.txt`: pedalboard 0.9.26, mido 1.3.3, numpy 2.5.5, scipy 1.18.1, soundfile 0.14.0 and their dependencies | `pip --require-hashes` (sha256 of every wheel) |
| Soundfonts | `MuseScore_General_Full.sf2/.sf3`, `FluidR3_GM.sf2` | size + sha256 against the pins (also in `audiolib/paths.py`) |
| VCSL | shallow fetch of commit `c1ea7bcc…4c7e` into `.cache/vcsl/` (gitignored; 3.8 GB of git objects + 5.8 GB checkout; skip with `AUDIO_SKIP_VCSL=1`) | HEAD, root tree hash `aee077de…ceaf`, clean checkout, CC0 LICENSE |
| Self-check | `selfcheck.py`: fluidsynth renders A4 from each soundfont (fundamental within 5 cents; measured -1.4 / +0.1 cents); a VCSL sample shifted a semitone lands within 0.5 cent (measured -0.055); loudness meter on the EBU 3341 case-1 sine (-22.99 LUFS); limiter holds -1 dBTP | exit code |

On a provisioned machine the script takes about 20 s (mostly hashing 724 MB of soundfonts).

## Conventions

- Audio is a `float64` numpy array shaped **(channels, samples)** at `core.SR = 48000`. Mono may be 1-D; `as_stereo` and `as_channels` normalise. Files are read and written with `io.read` / `io.write` (24-bit PCM with TPDF dither by default; digital silence stays exactly zero).
- Seeds: every random choice (noise, round robins, humanisation, reverb IRs, oscillator phases) comes from `core.rng(*parts)`, a SHA-256 of the parts. The same script renders the same file, bit for bit.
- Levels: `dB` everywhere; loudness in LUFS (BS.1770-4); true peak in dBTP (4x oversampled).

## Sources of sound

### 1. Soundfonts through fluidsynth (`audiolib.fluid`)

`fluid.render_part(score, "part", length)` renders one `GM` part to a stereo stem of exactly `length` seconds: one fluidsynth run per part (each stem gets its own mix strip), 48 kHz, 32-bit float, fluidsynth's own reverb and chorus off, **7th-order interpolation** (`interp 7`; the default is 4th order), polyphony 1024, a tail so releases are not cut. A note at time 0 starts 70 samples (1.5 ms) into every fluidsynth stem, so stems stay aligned with each other. `fluid.split_drums` splits a GM kit part into kick/snare/... stems (keep hi-hats together: the open hat is choked only inside one channel).

`GM("Electric Piano 1", soundfont="musescore")`: `musescore` resolves to the lossless MuseScore_General `.sf2` when installed (else the `.sf3`); `fluidr3` is FluidR3_GM. Drum kits: `GM(0, bank=128, drums=True)` (0 Standard, 8 Room, 16 Power, 24 Electronic, 25 TR-808, 32 Jazz, 40 Brush in both soundfonts).

**Measured caveat (GM bass).** The finger and pick bass presets (programs 33 and 34, the same samples in both soundfonts) carry loop-splice sidebands on held notes: energy 4-20 Hz from harmonics 1-3 at -33 to -46 dB against -51 dB for a clean string (a short sustain loop of about 110 ms). Subtle, but it is grain on every held note. Use `synth.PluckString` for bass lines (the reference does).

### 2. VCSL samples (`audiolib.sampler`)

`SampleBank.from_folder(paths.vcsl_dir(...), include="regex")` indexes WAVs by file name: note (`C4`, `F#2`), velocity layer (`vl3`/`v3`), round robin (`rr2`); every other token is the articulation (`JHPiano_Sus_Close`). `Sampler(bank, ...)` plays pitched multisamples or one-shots:

- nearest root at or below the note; pitch shift and 44.1 -> 48 kHz conversion in one polyphase windowed-sinc pass (Kaiser beta 8.6, 16 zero crossings; the ratio is rational to within 0.01 cent);
- velocity picks the layer and sets the gain, `amplitude = (velocity/127) ** velocity_power` (1.6-1.7 for pianos: about -10 dB at velocity 64);
- `normalize_layers="per_zone"` levels every zone to the loudest layer of its own key (BS.1770 loudness of its first 400 ms), so layers change only the timbre. **Use it on natural-dynamics sets**: the VCSL Kawai's layers span about 37 dB, and without levelling a velocity crossing 64 jumps 12 dB; with it, steps at layer boundaries are 1.3 dB or less;
- round robins rotate per key and layer; the head of each sample is trimmed to 1 ms before its first sample above -50 dB of its peak (onsets land on the beat);
- note-off: pitch-dependent damper release (`damper=(bass_s, treble_s, top_key)`; keys above `top_key` ring on, like real pianos above about E6); sustain-pedal intervals (CC64) defer note-offs; `pedal_bank` is used while the pedal is down; `release_bank` adds release (damper) noise, quieter the longer the note was held; a new strike on a sounding key chokes the old voice over 40 ms;
- `Kit({key: Sampler(..., one_shot=True)}, chokes=[[42, 44, 46]])` renders drum parts with choke groups; `Kit.render(part, score, length, only={...})` renders one stem per drum group.

Useful VCSL instruments (all CC0): `Chordophones/Zithers/Grand Piano, Kawai` (4 layers, 38 roots, releases: the reference piano; balanced), `Grand Piano, Steinway B` (3 layers, pedal and no-pedal sets, releases; darker), two uprights, harpsichords, harps; `Idiophones/Struck Idiophones/` hi-hat, suspended cymbals, glockenspiel, vibraphone, marimba, xylophone, tubular bells, shakers, claps, tambourines, triangles; `Membranophones/Struck Membranophones/` modern snares (hits, rimshot, cross-stick, taps), toms, concert bass drums (slow 25 ms swell: not a kit kick), timpani, frame drums, congas, bongos; `Electrophones/TX81Z` FM keys; `Aerophones/` recorders, organs, harmonicas, tenor sax.

### 3. Synthesis (`audiolib.synth`)

| Primitive | Notes |
| --- | --- |
| `osc(shape, freq, n, oversample=1)` | sine, saw, square (pulse width), triangle. PolyBLEP saw/square and PolyBLAMP triangle: aliasing 18-20 dB under the naive waveforms (measured -40.6 dB at 440 Hz, -28.8 dB at 3.5 kHz for the saw). `oversample=2` reaches -52 to -62 dB, `4` reaches -70 to -81 dB. `freq` may be an array (glide, vibrato) |
| `supersaw(freq, n, voices, detune_cents)` | detuned stack, alternating pan, random phases; 2x oversampled by default |
| `noise(n, "white" / "pink" / "brown")` | unit RMS; pink is exact 1/f by FFT shaping (measured slope -3.0 dB/oct) |
| `adsr`, `env_points`, `lfo` | analog-style curves; release from wherever the envelope is (no click); LFO shapes sine, triangle, square, saw, sample-and-hold, smooth random; delay and fade-in |
| `svf(x, cutoff, q, mode)` | TPT state-variable filter (stable under fast modulation); per-sample cutoff arrays; about 1 s per 1.5 M samples |
| `ladder(audio, cutoff)` | pedalboard's Moog-style ladder, cutoff updated every 64 samples with state carried over (fast for long pads) |
| `pluck(midi, dur)`, `PluckString` | extended Karplus-Strong plucked string, exactly in tune (0.0 cents measured E1-D4), vectorised one period at a time; `PluckString(mono=True)` for bass lines (a new note mutes the last), `tone_hz`, `body` resonance |
| `supersaw_pad`, `sub_bass`, `riser`, `kick` | ready voices: breathing pad through a drifting ladder low-pass; sine sub with legato glide and phone-audible harmonics; noise-plus-saw riser with widening; tight acoustic-style kick (raise `amp_decay` for 808 boom) |

## Writing music (`audiolib.midi`, `theory`, `humanize`)

```python
score = Score(bpm=96, time_sig=(4, 4), key="D")             # tempo_changes=[(beat, bpm), ...]
keys = score.part("keys")                                    # instrument is attached at render time
for bar, sym in enumerate(["Gmaj9", "F#m7", "Em9", "A13sus4"]):
    keys.chord(theory.voicing(sym, 50, 74, prev=None), score.bar(bar), 3.9, vel=64)
keys.sustain(0.08, 15.9)                                     # CC64 down/up, in beats
keys.notes = humanize.roll(keys.notes, 16.0, score)          # spread chords (ms, low to high)
keys.notes = humanize.humanize(keys.notes, score, timing_ms=5, drift_ms=3, velocity=4, seed="keys")
keys.notes = humanize.swing(keys.notes, amount=0.56, grid=0.5)
score.save_midi("out/audio/demo.mid")                        # mido, 960 ticks per beat
```

- Times are in beats; `score.seconds(beat)` goes through the tempo map. `Part.note/chord/hit/cc/sustain/bend`; `GM_DRUMS` names ('kick', 'snare', 'hat_closed', ...).
- MIDI export: track 0 = tempo map and time signature, one track per part, note-offs before note-ons at equal ticks, same-key overlaps resolved (a re-strike cuts the older note), every track extended by `tail_seconds`.
- `theory`: chord symbols (`F#m7b5/C`, 40 qualities), scales, `voicing()` (least total movement from the previous voicing, no 2nds below C3 or 3rds below G2), `progression()`, `bass_note()`.
- `humanize`: timing = slow Ornstein-Uhlenbeck drift (a player pushing and pulling) + small Gaussian jitter, clipped to `max_ms`; velocity variance; swing on 8ths or 16ths; accents by position; rolled chords. Defaults are starting values to tune by ear.

## Mixing (`audiolib.mix`)

```python
mix = Mix(length=20.0, room="plate", return_eq=[{"kind": "peak", "f": 520, "q": 0.8, "db": -3}])
mix.add(Strip("piano", piano, eq=[{"kind": "highpass", "f": 45, "order": 2}, {"kind": "peak", "f": 580, "q": 0.9, "db": -3.5}],
              comp=Compressor(threshold_db=-26, ratio=2, attack_ms=18, release_ms=160, detector="rms"), width=1.1, bass_mono_hz=140, send_db=-8))
mix.add(Strip("bass", bass, comp=Compressor(threshold_db=-20, ratio=3, attack_ms=15), sat={"drive_db": 6, "kind": "asym", "mix": 0.5}, width=0))
mix.add(Strip("hats", hats, fader_db=-7.5, pan=0.3, inserts=[pedalboard.Chorus(rate_hz=0.3, depth=0.1, mix=0.2)]))
bus, report, stems = mix.render(return_stems=True)   # stems: post-fader strips + "reverb"; they sum to the bus input
```

Strip order: **gain staging** (each raw stem to -20 LUFS, so thresholds and faders mean the same on every stem) -> EQ -> compressor -> saturation -> pedalboard inserts -> width (mid/side, optional bass mono) -> pan/balance -> fader -> post-fader reverb send. Bus: strips + reverb return (with its own EQ) -> bus EQ -> **glue compressor** (linked, RMS, 2:1, 30 ms / 200 ms, sidechain high-pass 90 Hz, run on the bus staged to -18 LUFS) -> optional bus saturation.

pedalboard is the plugin host (`inserts=` takes any pedalboard plugins: Chorus, Phaser, Delay, LadderFilter, ...) and provides the true-peak limiter. Three core blocks are this package's own, for measured reasons (pedalboard 0.9.26):

| Block | pedalboard built-in | Measured problem | audiolib instead |
| --- | --- | --- | --- |
| High/low-pass | `HighpassFilter`, `LowpassFilter` | first order (6 dB/oct): 100 Hz HP is only -12.3 dB at 25 Hz | RBJ biquads and Butterworth/Linkwitz-Riley of any order, float64 (`dsp.eq`) |
| Compressor | `Compressor` (JUCE) | each channel detected separately: -13.5 dB on a loud left channel, 0 dB on a quiet right one (image shift) | linked soft-knee compressor, peak or RMS, sidechain HP, parallel mix, look-ahead (`dynamics.Compressor`) |
| Saturation | `Distortion` | not oversampled: aliasing at -15 dB (5 kHz sine, 20 dB drive) | 4x oversampled (8x above 12 dB drive), decimated at 90 % of Nyquist: worst alias below 20 kHz -109 dB at 20 dB drive (`dsp.saturate`: tanh, asymmetric, cubic) |
| Reverb | `Reverb` (Freeverb) | comb-filter tail rings metallically on piano | synthesised-IR convolution reverb (`reverb.py`): decorrelated L/R noise tail with per-octave decay (air absorbs highs first), early reflections, diffusion build-up, return EQ; presets `room` 0.7 s, `plate` 1.6 s, `hall` 2.4 s, `cathedral` 4.5 s (RT60 checked by Schroeder integration in the tests) |

## Mastering (`audiolib.master`)

| Preset | Target | Ceiling | Character |
| --- | --- | --- | --- |
| `bed` | median short-term **-26 LUFS-S** | -6 dBTP | broad dip centred on 2 kHz (-3.5 dB, Q 0.7, about 1-4 kHz) + -1 dB at 300 Hz + -1 dB air shelf; gentle 2:1 RMS compressor for even dynamics |
| `sting` | **-16 LUFS-I** | -1 dBTP | jingles, intro stings, logo hits; transients kept |
| `standalone` | **-14 LUFS-I** | -1 dBTP | music heard on its own; 1.5:1 glue |

`out, report = master.master(audio, "bed", loop=False)`; `master.export(path, out, report)` writes a **24-bit 48 kHz WAV**, an AAC preview (`.m4a`, 256 kb/s) and `.master.json`. Chain: stage to -18 LUFS -> 28 Hz rumble high-pass + preset EQ -> compressor -> gain into pedalboard's `BrickwallLimiter` (true-peak mode, internal ceiling 0.3 dB under the target, re-run lower if the package's own 4x meter still reads over) -> the gain is re-aimed by secant steps until the result is within 0.1 LU. Non-loops get 2 ms / 10 ms edge fades. `loop=True` processes `[tail | audio | head]` and keeps the middle, so compressor and limiter see the wrap-around and the seam stays seamless (tested).

YouTube publishes no loudness target; -14 LUFS-I / -1 dBTP is the community-measured reference (`docs/research/platform-facts-2026-11-23.md`), and the narration is normalised to -14 LUFS by `scripts/voice`.

### Beds under voice

A bed at -26 LUFS-S sits about 12 LU under -14 LUFS narration before any ducking, and its 1-4 kHz pocket keeps consonants clear. In the video mix, duck the bed a further 4-8 dB while Zoo speaks (starting values: about 150 ms attack before the first word, 400-600 ms release after the last), so the music breathes in pauses and under Badger's reactions. Keep SFX peaks for punchlines in the gaps between lines. These are starting values for the composer and the video mix to tune by ear.

## Metrics (`scripts/audio/metrics.py`)

```bash
python3 scripts/audio/metrics.py file.wav --profile standalone|sting|bed|sfx|none [--loop] [--json out.json] [--png base] [--no-png] [-q]
```

JSON on stdout (or `--json`), a human summary on stderr, a spectrogram PNG (log frequency 20 Hz-20 kHz, 120 dB range) and a waveform PNG. Exit codes: **0** all fail-level checks pass, **1** a fail-level check failed, **2** bad arguments or unreadable file.

| Metric | Definition |
| --- | --- |
| `loudness.*` | ffmpeg `ebur128` (true peak on): integrated, LRA, true peak; short-term max / median / 10th percentile and momentary max from the per-100 ms log (full windows only); `numpyIntegrated` and `meterDeltaLu` cross-check this package's meter (agreement within 0.02 LU on the test signals) |
| `psr` | per 3 s window (hop 1 s): sample peak minus window loudness; min and median. Once loudness and ceiling are fixed, PLR and crest factor are nearly pinned; PSR still shows squashed transients |
| `crestFactorDb`, `dcOffset`, `clipping` | peak/RMS; per-channel mean; samples at >= 0.9999 FS and runs of 3+ |
| `stereo` | correlation (whole file, 400 ms windows), correlation below 150 Hz, mono fold-down loss = LUFS((L+R)/2) - LUFS(stereo), side/mid ratio |
| `spectrum` | Welch LTAS, mean power density per octave (31.5 Hz-16 kHz) against a **-3 dB/oct target tilt** (pink) fitted over 63 Hz-8 kHz; own slope; `harshnessDb` (2-5 kHz), `mudDb` (200-500 Hz), `boxinessDb` (500-1000 Hz), `presenceDb` (1-4 kHz) as mean deviation from the target tilt; `voicePocketDb` = 1-4 kHz against the track's own tilt (negative = room for a voice) |
| `loop` (`--loop`) | `clickRatio` = sharpest second difference within 1 ms of the seam over the sharpest in the 50 ms around it (a hit on the downbeat reads about 1-1.5; a sine cut mid-cycle reads 254); `levelStepDb` last vs first 100 ms |
| `noise` | minimum statistics (5th percentile per bin of smoothed STFT power, bias-corrected so stationary white noise reads its true level: tested to 1 dB at -60 and -80 dBFS): broadband (an upper bound under dense music: the reference reads -37 dBFS although its piano samples are clean to -84 dBFS) and 8-16 kHz (`hfFloorDbfs`); `humDb` = prominence of persistent 50/60 Hz peaks and harmonics, counted only above -85 dBFS (a -50 dBFS 60 Hz hum reads -50.0 dBFS, 57 dB prominent) |
| `silence` | leading/trailing digital silence, onset (first sample above -60 dBFS), RMS of the last 10 ms |

### Targets (pass/fail)

Generated from `scripts/audio/targets.json` by `metrics.py --targets-table`; a unit test fails if this table and the JSON differ.

<!-- targets:begin -->
| Profile | Metric | Pass when | Severity | Why |
| --- | --- | --- | --- | --- |
| all | `format.sampleRate` | 48000 (exact) | fail | the video pipeline and Remotion run at 48 kHz |
| all | `dcOffset.max` | <= 0.001 | fail | DC wastes headroom and clicks at edits |
| all | `clipping.samples` | <= 0 | fail | no sample may reach full scale |
| all | `clipping.runs` | <= 0 | fail | 3+ consecutive full-scale samples = hard clipping |
| all | `loudness.meterDeltaLu` | -0.2 to 0.2 | warn | ffmpeg and the numpy meter should agree; a gap means an odd file |
| all | `noise.humDb` | <= 10 | warn | a persistent 50/60 Hz peak (with harmonics) means mains hum in a recording |
| standalone | `loudness.integrated` | -14.5 to -13.5 | fail | -14 LUFS-I, YouTube's widely reported reference (not an official spec) |
| standalone | `loudness.truePeak` | <= -1 | fail | -1 dBTP leaves room for lossy encoding overshoot |
| standalone | `psr.medianDb` | >= 8 | warn | below about 8 dB the transients are squashed |
| standalone | `stereo.correlation` | >= 0 | fail | negative correlation cancels on phones and mono speakers |
| standalone | `stereo.monoLossDb` | >= -3 | fail | the mono fold-down must not lose more than 3 dB |
| standalone | `stereo.lowCorrelation` | >= 0.9 | warn | bass below 150 Hz should be mono |
| standalone | `spectrum.slopeDbPerOct` | -6 to -1.5 | warn | overall tilt near pink (-3 dB/oct); typical mixes sit at -3 to -5 |
| standalone | `spectrum.harshnessDb` | <= 3 | fail | 2-5 kHz excess is fatiguing on phone speakers and earbuds |
| standalone | `spectrum.mudDb` | <= 3 | fail | 200-500 Hz excess sounds boxy and masks speech |
| standalone | `spectrum.boxinessDb` | <= 4 | warn | 500-1000 Hz excess sounds boxy or honky (the reference's first mix read +6) |
| standalone | `noise.hfFloorDbfs` | <= -60 | warn | 8-16 kHz floor: hiss louder than this is never acceptable; the reference trio's hats and cymbals read about -62 (the estimate is an upper bound) |
| sting | `loudness.integrated` | -16.5 to -15.5 | fail | -16 LUFS-I: matches speech-led content without jumping out |
| sting | `loudness.truePeak` | <= -1 | fail | -1 dBTP leaves room for lossy encoding overshoot |
| sting | `stereo.correlation` | >= 0 | fail | negative correlation cancels on phones and mono speakers |
| sting | `stereo.monoLossDb` | >= -3 | fail | the mono fold-down must not lose more than 3 dB |
| sting | `spectrum.harshnessDb` | <= 3 | fail | 2-5 kHz excess is fatiguing on phone speakers and earbuds |
| sting | `spectrum.mudDb` | <= 3 | fail | 200-500 Hz excess sounds boxy |
| sting | `spectrum.boxinessDb` | <= 4 | warn | 500-1000 Hz excess sounds boxy or honky |
| sting | `silence.tailEndDbfs` | <= -60 | fail | a sting must end cleanly, not on a cut |
| bed | `loudness.shortTermMedian` | -27 to -25 | fail | about -26 LUFS-S: roughly 12 LU under -14 LUFS narration before ducking |
| bed | `loudness.shortTermMax` | <= -22 | fail | no section may climb toward the voice |
| bed | `loudness.truePeak` | <= -6 | fail | headroom for summing with voice and SFX |
| bed | `loudness.lra` | <= 8 | warn | even dynamics make ducking predictable |
| bed | `spectrum.voicePocketDb` | <= -1.5 | fail | the 1-4 kHz pocket where speech intelligibility lives |
| bed | `spectrum.mudDb` | <= 3 | warn | 200-500 Hz excess masks the voice's body |
| bed | `stereo.correlation` | >= 0 | fail | negative correlation cancels on phones and mono speakers |
| bed | `stereo.monoLossDb` | >= -3 | fail | the mono fold-down must not lose more than 3 dB |
| bed | `noise.hfFloorDbfs` | <= -72 | warn | hiss under a quiet bed is exposed when the voice pauses (the reference bed reads about -74) |
| bed | `loop.clickRatio` (with `--loop`) | <= 2 | fail | a seam much sharper than the 50 ms around it is a cut waveform (a click) |
| bed | `loop.levelStepDb` (with `--loop`) | -3 to 3 | warn | loops should not jump in level at the seam |
| sfx | `loudness.truePeak` | <= -1 | fail | -1 dBTP leaves room for lossy encoding overshoot |
| sfx | `silence.onsetMs` | <= 5 | warn | the sound should start within 5 ms so it syncs to the frame it is placed on |
| sfx | `silence.tailEndDbfs` | <= -60 | fail | one-shots must end cleanly, not on a cut |
| sfx | `noise.floorDbfs` | <= -70 | warn | hiss around a one-shot is audible when it is layered |
<!-- targets:end -->

### Reading the spectrogram

- **Aliasing** shows as faint lines falling while the music's partials rise (mirror images). **Clicks** are thin vertical lines through the whole spectrum where no drum hits. **Hum** is a steady horizontal line at 50/60 Hz and multiples. **Hiss** is a uniform floor that does not follow the music.
- **Known display artefact:** under a sustained low note, ffmpeg's `showspectrumpic` draws regular vertical stripes in the 40-300 Hz band (its short analysis window beating with the low frequencies). A mathematically steady synthetic tone shows the same stripes, so they are not in the audio (checked 2026-11-24 on the reference's final chord).

## The reference render (`render_reference.py`)

20.0 s, 96 BPM, D major: | Gmaj9 | F#m7 | Em9 | A9sus4 A13 | Gmaj9 | F#m7 Bm9 | Em9 A9sus4 | Dmaj9 |. Kawai grand (VCSL, levelled layers, releases, pedal), plucked-string bass (engine), GM kit kick (MuseScore), VCSL snare / cross-stick / taps / hi-hats / suspended cymbal; humanised (rolled chords, OU drift + jitter, 56 % swing, the bass 8 ms behind the beat); mixed on the bus with the plate reverb; mastered twice. It renders in about 12 s and writes `out/audio/reference/`: raw and post-fader stems, `reference.mid`, `reference_premaster.wav`, `reference_standalone.wav/.m4a`, `reference_bed.wav/.m4a`, metrics JSON and PNGs, `report.json`.

Measured 2026-11-24 (final version):

| | standalone | bed |
| --- | --- | --- |
| Loudness | -14.0 LUFS-I (S median -14.0, max -13.3), LRA 0.6 LU | S median -26.0, max -25.4 LUFS, LRA 0.9 LU |
| True peak / sample peak | -1.3 / -1.3 dBFS | -7.3 dBTP |
| PSR median | 12.7 dB (transients intact) | 17.0 dB |
| Stereo | correlation 0.57, bass correlation 1.00, mono loss -1.2 dB | 0.60, 1.00, -1.1 dB |
| Tilt / harshness / mud / boxiness | -3.5 dB/oct / -4.3 / -1.0 / +1.3 dB | -3.9 / -5.3 / -0.7 / +0.9 dB |
| Voice pocket | -1.8 dB | -3.6 dB |
| Noise floor (broadband / 8-16 kHz) | -37 (music) / -62 dBFS | -50 / -74 dBFS |
| Limiter | 0.8 dB average, 6.0 dB max gain reduction | not engaged (ceiling -6 dBTP) |
| Result | PASS, 0 warnings | PASS, 0 warnings |

What the measurements changed on the way (all in the script's history): the first mix had a +6 to +11 dB build-up at 400-630 Hz (pedalled common tones; reverb accumulation) and a dull top (-5 dB above 1.6 kHz): fixed with a piano cut at 580 Hz, a reverb-return scoop at 520 Hz and a gentle bus tilt; the GM finger bass was replaced by the plucked-string model (loop sidebands); fast compressor attacks on kick and snare (9-13 dB of gain reduction on every hit) were slowed so the hits keep their punch.

## Limits (honest)

- Nobody listened in this session: there is no audio output here. Every judgement above is measured (loudness, spectra, envelopes, tuning, aliasing, seams) and the spectrograms were inspected, but a producer's ear on headphones and on a phone speaker is still the final check. Listen to `out/audio/reference/reference_standalone.m4a` before trusting the defaults for a release.
- Sample quality bounds realism: VCSL pianos and drums are real recordings (good); GM soundfont instruments are General MIDI quality (fine for pads, mallets and textures; weakest for exposed solo brass, strings and bass). There is no sampled electric bass or kit kick in VCSL; the engine's plucked string and synth kick fill those gaps.
- The broadband noise floor is an upper bound under dense music; the 8-16 kHz floor and hum checks carry the noise verdict.
- The loop-seam check can miss a click hidden under dense noise-like material (where it is masked anyway).
- Content ID: see `docs/AUDIO_LICENSES.md`.

## Updating pins

- Python: bump the versions in `scripts/audio/requirements.txt`, regenerate the `--hash` lines from `https://pypi.org/pypi/<name>/<version>/json` (sdist, pure wheels and every cp313 wheel), run `setup.sh` and the tests.
- Soundfonts: if Ubuntu changes a package, `setup.sh` fails on the sha256; review the new copyright file, then update the pins in `setup.sh` and `audiolib/paths.py` together.
- VCSL: fetch the new commit, read its LICENSE and README, update `VCSL_COMMIT`/`VCSL_TREE` in `setup.sh` and `audiolib/paths.py`, rerun the tests and the reference render.
- After any change: `python3 scripts/audio/render_reference.py` must still PASS both profiles, and `metrics.py --targets-table` must match this file.
