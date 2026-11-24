# SFX library (`scripts/audio/sfx`)

Original sound effects for Zoora AI and The Zoo & Badger Show: 116 files in 27 variation groups,
48 kHz / 24-bit stereo WAV, each peak-normalised to -6 dBFS, with a manifest that gives every
file its sync point in frames, its suggested gain and its sources. Everything is synthesised in
code (modal bodies, filtered noise, friction models) or built from processed VCSL percussion
(CC0). Nothing is a stock sample; nothing imitates a dog's voice. Built on the audio engine
(`scripts/audio/audiolib`, `docs/AUDIO.md`).

```bash
cd projects/video-studio
python3 scripts/audio/sfx/build.py --export     # render, finish, measure, review, copy to public/audio/sfx (about 30 s)
python3 scripts/audio/sfx/sync_check.py         # render a sync check through Remotion and measure it (about 50 s)
python3 scripts/audio/sfx/build.py --audition   # one listening reel at the suggested gains + cue sheet (out/audio/sfx/audition/)
python3 scripts/audio/sfx/build.py --only keyboard --no-metrics   # iterate on one family (no export)
python3 scripts/audio/sfx/speech_mask.py <narration.wav> --out <speech_frames.json>   # where Zoo speaks, per frame (for placing UI sounds)
.venv-audio/bin/python -m unittest discover -s scripts/audio/sfx/tests -t scripts/audio/sfx   # 46 tests, about 3 s
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/audio/sfx/sfx.test.ts    # TS helper, 12 tests
```

`build.py` writes `out/audio/sfx/` (gitignored): `wav/<category>/<id>.wav`, `manifest.json`,
`report.json` (every measurement, every QA check and the engine's `metrics.py --profile sfx`
result for every file) and `review/<category>.png` (spectrogram and level sheets with the 30 fps
frame grid). `--export` copies the WAVs to `public/audio/sfx/<category>/` and writes
`public/audio/sfx/manifest.json`; it refuses to export when a fail-level check fails. The build
is deterministic: the same code renders the same files, bit for bit.

## What is in it

| Group | Files | What | Sync | Role |
| --- | --- | --- | --- | --- |
| `whoosh_short` | 4 | quick pass-bys, 0.4 s, left/right | peak (the pass-by) | transition |
| `whoosh_medium` | 4 | pass-bys, 0.8 s | peak | transition |
| `whoosh_long` | 3 | smooth pass-bys, 1.5 s | peak | transition |
| `whoosh_reverse` | 4 | swells into a cut: 15, 24 and 36 frames | end (the cut) | transition |
| `pop` | 4 | bullet pops, all on D5 (four touches, safe for `pick()`) | transient | ui |
| `pop_rise` | 4 | the rising list set D5, G5, A5, D6: use 01-04 in order, never `pick()` | transient | ui |
| `plop` | 4 | rounder water-drop plops, all on A4 | transient | ui |
| `tick` | 5 | soft wooden UI ticks (VCSL woodblock) | transient | ui |
| `swipe` | 5 | card swipes and page turns | start | ui |
| `key` | 10 | mechanical key, press on frame 0, release on frame 2-4 | transient | foley |
| `key_space` / `key_enter` | 4 + 4 | stabilised spacebar and Enter | transient | foley |
| `typing_burst` | 6 | 1.6-5.7 s of typing, every key on a frame, rig-synced | transient | foley |
| `typing_loop` | 3 | seamless 4.8 s (144-frame) typing loops, rig-synced | start | foley |
| `mouse_click` / `mouse_double` | 5 + 3 | micro-switch clicks and double-clicks | transient | foley |
| `mug` | 4 | a mug of coffee set down (one slid in, landing on frame 3) | transient / hit | foley |
| `chair_creak` | 4 | short creak, lean back, two-part settle, swivel squeak | start | foley |
| `ding` | 4 | notification: D5-A5, A5, the motif head D5-D5-A5, A4-D5 (VCSL vibraphone) | transient | notify |
| `success` | 4 | small, dry marimba "ta-da"s on D, G and A | transient | notify |
| `error` | 4 | soft comedic buzzes falling E-flat to D | transient | notify |
| `developing_pulse` | 4 | DEVELOPING blips: four single D4 pulses with their octave and twelfth, micro-varied (safe for `pick()`: one pitch, one rhythm) | transient | notify |
| `developing_double` | 3 | the DEVELOPING "du-dum": D4 on frames 0 and 4, micro-varied | transient | notify |
| `developing_loop` | 3 | seamless 90 BPM DEVELOPING loops (the show-bed tempo) | start | notify |
| `rekt_needle` | 4 | Rekt Meter needle to 1/4, 1/2, 3/4 and the full dial, on the Show's 24-frame ease | start | meter |
| `rekt_alarm` | 4 | rounded alarm rises with an octave-up layer (24, 36, 48 frames; one stepped D-G-A-D) | end (the top) | meter |
| `badger_paw` | 5 | paw taps, a walk and a scrabble on a hard floor (claws and pads) | transient | foley |
| `badger_tail` | 4 | tail thumps: one to four wags | hit (first thump) | foley |

## Using it in Remotion

```tsx
import manifest from '../../public/audio/sfx/manifest.json';
import {asManifest, nearestGapFrame, pick, pickSequence, rigStartFrame, sfx, startFrame, volume, volumeUnderSpeech} from '../../scripts/audio/sfx/sfx.ts';

const lib = asManifest(manifest);
const w = pick(lib, 'whoosh_medium', `cut-${sceneIndex}`);   // deterministic: never Math.random in Remotion
<Sequence from={startFrame(w, cutFrame)}>                    // the pass-by lands exactly on cutFrame
	<Audio src={staticFile(w.file)} volume={volume(w)} />       // suggested gain; volume(w, -3) trims 3 dB more
</Sequence>
const pops = pickSequence(lib, 'pop', bullets.length, sceneId);   // or sfx(lib, `pop_rise_0${i + 1}`) for the rising D-G-A-D set
// UI sounds go between Zoo's words: speech = speech_mask.py's "speech" array (or speechMaskFromSpans(word timings))
const at = nearestGapFrame(speech, bulletFrame) ?? bulletFrame;      // null: no gap within 6 frames
<Audio src={staticFile(pop.file)} volume={speech[at] ? volumeUnderSpeech(pop) : volume(pop)} />   // ui: 3 dB lower on a word
const t = sfx(lib, 'typing_burst_03');
<Sequence from={rigStartFrame(t, typingStart)}>              // every key on a frame where one of Zoo's fingers lands
```

### The sync contract

- One video frame at 30 fps is exactly 1600 samples at 48 kHz. Every `syncMs` and every event time
  in the manifest is a whole number of frames, so `startFrame(entry, f)` (= `f - syncFrame30`)
  puts the sync point exactly on frame `f`, with no drift. 1600 is a multiple of 800, so the same
  holds at 60 fps.
- `syncKind`: `transient`, an impact whose attack (half amplitude) is within 5 ms of the file
  start, measured; `hit`, an impact at `syncMs` after a lead-in (the mug slid into place, a tail
  thump after its swish); `peak`, a whoosh's pass-by as heard (the loudest K-weighted window, a
  tenth of the sound long, measured on the finished design and moved onto the next frame boundary
  with at most 33 ms of added silence in front); `end`, the top of a swell or rise, the moment to
  cut on; `start`, motion that starts with the file (a swipe, a creak, a needle leaving its rest).
- `events` lists the frames inside a file: each key of a typing burst (`press`, with velocity),
  each press and release of a click, each footfall and thump, the needle's stop on frame 24, the
  rise's top. Every press, footfall and thump has its attack within 5 ms of its frame (measured).
- Rig sync (typing): `src/characters/zoo/views/Typing.tsx` animates fingers with `fingerLift`, a
  pattern that repeats every 36 frames; a finger lands on its key on 23 of the 36 frames. Bursts
  and loops only put keys on those frames (`sfxlib/rig.py` holds a copy of the formula, read
  2026-11-24). Start the file on a typing-pose frame `f` with `f % 36 == rig.startRigFrameMod36`
  (`rigStartFrame` finds the next one) and every key falls on a visible finger strike; started
  anywhere else, every key still lands exactly on a frame. If that rig function changes, rebuild.
- Proven through Remotion: `sync_check.py` renders `SfxSyncCheck` (`remotion/SyncCheck.tsx`, its
  own entry point and config: the project config's x264 preset blocks WAV output, and AAC would
  add encoder delay) with eight files placed by `startFrame()`. Cross-correlation finds every file
  at exactly 0 samples from where `startFrame()` puts it. Attacks land 0.08-2.9 ms after their
  frames (the tail thump's padded drum is the slowest) and the whoosh's pass-by 0.56 ms from its
  frame (2026-11-24, Remotion 4.0.541, `Html5Audio`).
- Needle: `rekt_needle_*` follows `SWEEP_FRAMES = 24` and `EASE.inOut = bezier(0.45, 0, 0.25, 1)`
  from `src/show/graphics/RektMeter.tsx`. Start it on the meter's `start` frame: a detent ticks
  every time the needle passes 1/40 of the dial (louder on the six decade marks), so the ticks
  match the motion, and the stop clunk lands on frame 24.

### Levels

Files are peak-normalised to -6 dBFS, so their loudness differs with their shape. Each entry's
`suggestedGainDb` (and `suggestedVolume` for `<Audio volume>`) brings it to its role's target,
measured as `lufs200Max`: BS.1770 K-weighted loudness in a 200 ms window, maximised over the file.

| Role | Target (200 ms window) | For |
| --- | --- | --- |
| transition | -21 LUFS | whooshes and swells, usually in a gap between lines |
| meter | -22 LUFS | Rekt Meter needle and alarm |
| notify | -21 LUFS | ding, success, error, DEVELOPING |
| ui | -27 LUFS (-3 dB more on a word: `underSpeechTrimDb`) | pops, plops, ticks, swipes, best in the gaps between Zoo's words |
| foley | -28 LUFS | keyboard, mouse, mug, chair, Badger |

Narration sits at -14 LUFS-I (its 200 ms peaks about -9). These are starting values: tune each
scene by ear.

**Phone speakers (critic round 1, 2026-11-24).** On a phone-speaker model (the mono sum through a
4th-order 350 Hz high-pass, a 12 kHz low-pass and +3 dB at 3 kHz) Zoo's narration loses about
5.4 LU. Whooshes, pops, ticks and swipes lose nothing (they gain 0.2-1.6 dB), so at the first
targets (-18 and -24) they played 6-7 dB hotter against him on a phone than on headphones: the
transition and ui targets came down 3 dB. Every file's `loudness.phoneLossDb` is in the manifest.
The ticks sit at 1.7-2.2 kHz, right on his consonants, so UI sounds go in the gaps between words
(`speech_mask.py` + `nearestGapFrame`), or 3 dB lower (`volumeUnderSpeech`) when they must land on a
word. The other way round, sounds whose body sits under a phone's range must not vanish there: a
fail-level check holds the DEVELOPING blips to a loss of 3 dB or less (they lost 4.6-6.2 dB with
the body at D4, so the tick carried them: now a D5 partial at -2 dB and an A5 at -10 dB carry them,
measured -2.7 to -2.8) and the Rekt alarm to 4 dB or less (it lost 7.1 dB; now an octave-up
triangle-and-saw layer through a 3 kHz low-pass and a lighter sub octave, measured -1.6 to -3.7, its
2-5 kHz still 21-24 dB under 0.2-2 kHz, so never shrill). The rest of notify and meter must stay
within 4 dB.

**Pitch groups.** `pick()` chooses at random inside a group, so a group keeps one pitch: `pop` and
`plop` vary only the touch (critic round 1: they each spanned an octave, so the pitch jumped between
uses). The ordered rising set is its own group, `pop_rise`, used by index.

- Why 200 ms and not the EBU momentary 400 ms window: loudness integrates the energy of roughly
  the first 200 ms of a sound, so equal energy within it sounds equally loud. A 400 ms window
  under-reads a 20 ms click by about 3 dB more than our ears do. Measured on this library, the
  400 ms basis would have given a key click +6.8 dB and pushed its peak to +0.8 dBFS. Very short
  sounds read about 3 dB higher on 200 ms than on 400 ms, and sustained ones 1-2 dB.
  `lufsMomentaryMax` (400 ms) and `lufs100Max` are in the manifest for reference.
- No suggested gain ever lifts a file's true peak above -6 dBTP (`gainCapped`). Remotion sums
  tracks without a limiter, and -6 dBTP is the engine's ceiling for beds for the same reason.
  Clicks therefore sit 1-4 dB under the foley target, which suits background typing.

## How the sounds are made (sound design)

The family shares one language: rounded attacks (no step at sample 0), causal high- and low-pass
finishing (nothing smeared before a transient), no fizz above about 12-14 kHz, and the same three
tiny synthesised rooms (`space.py`). The voice is dry Kokoro, so the effects stay close and dry:
desk 0.16 s for keys, clicks, mug and paws; set 0.3 s for creaks and thumps; air 0.45 s for
whooshes and tonal UI. Tonal sounds use only D, G and A, the pitch classes shared by every bed in
`scripts/audio/music/DIRECTION.md`, so no effect clashes with the music under it. The error's
E-flat is the one deliberate "wrong" note.

- **Whooshes:** a physical pass-by. Amplitude about 1/distance around the closest approach, with a
  quicker build than release. The band-pass centre rises as the source closes in and drops after
  it passes (Doppler, up to 0.45 octave). A constant-power pan crosses the image, a brown-noise
  body adds weight, a resonant "edge" layer (Q 4.5) shapes the swish, and a 9-14 Hz random
  flutter adds turbulence. Reverse swells rise like a reversed decay into the cut, then fall to
  silence in 50 ms.
- **Pops and plops:** a sine that snaps up into its pitch in about 6 ms (the "p"), an octave
  partial, a soft sub thump and a breath of noise. The plop is a slower, rounder water-drop
  chirp. Both are dry: on the air room a pure tone rang like a bell, so they moved to a whisper
  of the desk room. The four `pop` variations differ in snap, decay, octave partial and breath,
  not pitch.
- **Ticks:** VCSL woodblock strikes raised 3-6 semitones (the main mode lands near A6), damped to
  a 25-35 ms "tok" and darkened.
- **Swipes:** friction noise following a flicked card's speed (full speed 38% in, then a longer
  glide). The level, the band and a sparse paper grain follow that speed, ending in a soft edge
  flick; the page turns also get a low flap.
- **Keyboard:** a lubed, "thocky" board, premium and much less fatiguing under narration than a
  clicky one. Each keystroke has a quiet finger-contact tap; a bottom-out that rings the keycap
  and plate modes (8-25 ms, inharmonic, plus a cloud of short texture modes up to 7 kHz) and the
  case "thock" (380-650 Hz); a band-passed click; the keycap skirt rebounding 2.5-5 ms later (a
  quieter second impact); and a lighter, higher release 2-4 frames later. Spacebar and Enter have
  stabiliser double hits. Each keyboard position has a fixed timbre (repeated letters match) plus
  a little per-strike variation, and positions are panned slightly like the hands. Measured:
  -30 dB within 24 ms in every octave band (the top octaves in 1-13 ms), as real plastic keys decay. The
  rhythm (`rig.py`) uses log-normal intervals around 4.2 frames (about 70 words a minute) with a
  2-frame minimum, a later start on each word, spaces between words, thinking pauses of 8-14
  frames and Enter at line ends. The low case and desk modes (136-215 Hz) sit between mains
  harmonics.
- **Mouse:** micro-switch snap (2.9-5.6 kHz, 2.5-4 ms) in a plastic shell (0.85-1.9 kHz) on a desk;
  the release is lighter and higher.
- **Mug:** a damped wooden desk knock (140-1250 Hz), the ceramic shell's short "tink" (damped by
  the coffee), the base rim's second contact and a faint slosh. One variation slides in first,
  with grainy friction.
- **Chair:** stick-slip friction. A train of slips whose rate glides (it sets the creak's pitch)
  and whose spacing and strength wander rings the chair's plastic and metal modes (0.4-3 kHz).
  Each slip also releases a little broadband rasp.
- **Ding:** VCSL soft-mallet vibraphone, the instrument of the music's noir colour. The D5-A5
  chime needs no pitch shift (see the VCSL note below). Each note is held 0.25 s then damped
  (about 1.1 s in all), the A5 fourth partial (3.5 kHz) is eased 3 dB, and the air room adds a
  little bloom.
- **Success:** VCSL marimba, mid-channel only (its wide stereo pair combed in mono, correlation
  0.33), damped after 60 ms: small and dry. **Error:** band-limited pulse plus saw, low-passed at
  1.6 kHz with a nasal bump at 650 Hz, a 28 Hz buzz flutter and a 4 dB sag across each buzz. It's
  comedic, never a game-show buzzer.
- **DEVELOPING:** a sine D4 with its octave (-2 dB) and twelfth (-10 dB) and a band-passed tick,
  blooming in the air room. The loops run at 90 BPM (20 frames a beat), the show-bed tempo, with
  the first beat on frame 10 so the seam falls between pulses.
- **Rekt Meter:** synthesised detent ticks on the dial crossings (see Sync) over a servo hum that
  follows the needle's speed, then the stop clunk and a tiny spring. The alarm is a band-limited
  triangle and square (detuned 6 cents) with a light sub octave, rising toward D, plus an octave-up
  layer (mostly triangle, a little saw, low-passed at 3 kHz) as loud as the body, so a phone speaker
  plays it. Its tremolo speeds up from 3 to 8 Hz, it swells 18 dB, and the body's low-pass opens
  only to 2.4 kHz (centroid 330-480 Hz), so it is tense without ever being shrill.
- **Badger:** paws are a soft pad thud plus one to three claw ticks landing a few ms apart
  (keratin on hardwood). Tail thumps are VCSL frame-drum muted hand hits (the large drum +3
  semitones for the thump, the small drum -4 for the padded "fwap", both darkened) after a short
  fur swish, wagging every 8-9 frames. There are no vocal sounds: Badger's voice will come from
  recordings of the owner's dog (CLAUDE.md).

## Quality checks (every file, every build)

`report.json` holds the numbers. Fail-level checks (the build exits 1 and will not export):
- sample peak -6.00 dBFS (±0.05) and true peak ≤ -1 dBTP; measured -5.75 to -6.0 dBTP;
- no clipped samples; DC ≤ 1e-4;
- the last 10 ms ≤ -60 dBFS, ending in true digital silence: finishing appends 512 zero samples,
  so the 24-bit writer's dither never lands on the final block;
- the sync point on a frame boundary, and impacts' attacks within 5 ms of their sync point;
- no harsh resonance, meaning a narrow peak (12 dB or more above the third-octave-smoothed
  spectrum) in 2-6 kHz, within 12 dB of the loudest peak, ringing 80 ms or more;
- L/R correlation ≥ 0, and seamless loops (seam click ratio ≤ 2);
- phone translation: the DEVELOPING groups lose 3 dB or less on the phone model, the Rekt alarm,
  and every other notify and meter sound, 4 dB or less.

Warn-level checks: every event's attack within 5 ms of its frame; the design decayed to -60 dB
before its buffer ended (so finishing never cuts an audible tail); a whoosh's measured pass-by
within one frame of its sync point; 2-5 kHz no more than 6 dB above 0.2-2 kHz.

Result of the final build (2026-11-24, after critic round 1): 116 files, **0 fail-level and 0 warn-level QA findings**.
The engine's `metrics.py --profile sfx` reports **0 failures** on every file. It does give 65
warnings, all of which I checked:

- `silence.onsetMs` (32 files) is by design: whooshes, swipes, creaks, loops, tail thumps and the
  slid mug start softly (their sync point is not at the start). Every impact (`transient`) starts
  within 5 ms.
- `noise.floorDbfs` (28 files) comes from dense or sustained content. The estimator takes a
  percentile of 170 ms-smoothed spectra, so a ringing ding or continuous typing reads as "floor".
  The real hiss check disagrees: the 8-16 kHz floor of these files is -90 to -144 dBFS, except
  typing (-61 to -71, still the keys themselves), and the quietest 50 ms of every file is -68 to
  -144 dBFS.
- `noise.humDb` (5 typing files) is caused by frame locking. Keys on a 1/30 s grid make a comb at
  multiples of 30 Hz (60, 120, 150, 180 Hz) in the long-term spectrum. Proof: the same keys at
  unquantised times read 3.6 dB (frame-locked 9-13 dB). It is not a tone and is not audible as
  one. Frame locking is kept, because it is what syncs keys to Zoo's fingers.
- Three engine metrics are undefined for very short files (integrated loudness under 0.4 s, the
  noise floor under 1 s, hum under 2.7 s). They are listed as `notApplicable` in the report.

Per-group measurements (`out/audio/sfx/report.json`):

| Group | Length ms | Centroid Hz | 2-5 kHz vs 0.2-2 kHz | Notes |
| --- | --- | --- | --- | --- |
| whoosh short / medium / long | 660-716 / 995-1051 / 1670-1686 | 1490-2520 | -6.1 to 0 dB | level 150 ms after the pass-by: about 15 dB down (short), 4-7 dB (medium), 2-5 dB (long, broad swells) |
| whoosh reverse | 575-1273 | 910-1380 | -11 to -7 dB | darkest: the swell opens toward the cut |
| pop / plop | 129-143 / 156-174 | 586-1172 / 288-578 | -61 to -33 dB | pure, in tune (tests: within 15 cents) |
| tick / swipe | 124-141 / 271-416 | 1660-2170 / 1860-2230 | -15 to -1 dB | |
| keys (alpha, space, Enter) | 170-245 | 700-1570 | -17 to -3.5 dB | thocky; -30 dB within 24 ms in every band |
| typing bursts / loops | 1587-5702 / 4800 | 800-940 | -14 to -12 dB | 6.6-10.4 keys a second over a burst |
| mouse / mug / chair | 183-322 / 176-278 / 496-1014 | 1270-1470 / 490-610 / 640-1050 | -20 to -6.5 dB | |
| ding / success / error | 1077-1161 / 487-525 / 322-436 | 560-1080 / 370-430 | -56 to -21 dB | softest top in the library |
| DEVELOPING pulse / loop | 518-942 / 2667 | 343-739 | -59 to -44 dB | phone loss -2.7 to -2.8 dB (pulse_03 on D5: +0.2) |
| Rekt needle / alarm | 1051-1072 / 1186-1962 | 810-1110 / 331-480 | -27 to -5 dB | the alarm: phone loss -1.6 to -3.7 dB |
| Badger paws / tail | 229-680 / 376-1260 | 690-970 / 360-420 | -21 to 0 dB | claws are the brightest foley |

## Honest self-review

Nobody has listened to these files: this session has no audio output. Every judgement comes from
measurements and the review sheets I looked at: spectrograms with the frame grid, envelopes,
pitch, decay per octave band, loudness, correlation and resonance scans. Where a producer's ear
should go first, most doubtful first:

1. **Keyboard realism.** Modal synthesis gets the decay, spectrum and rhythm right on paper, but
   real recorded keys have micro-details (rattle, irregular release timing, case resonances) that
   synthesis approximates. Of everything here, this family is the one most likely to sound
   "synthetic" on headphones. If it does, the fix is a recorded keyboard: record the owner's own
   keyboard (we would own it) and slot those strikes into the same frame-locked rhythm.
2. **Chair creaks and the mug** are physically modelled. Without recordings to compare against,
   their "material" (plastic vs wood vs ceramic) is a design estimate.
3. **Whooshes** are the most conventional and probably the most solid. The short ones' audible
   body is about 0.35 s; the rest of their 0.66-0.72 s files is a quiet room tail. The long ones
   swell broadly (`whoosh_long_02` is within 1 dB of its peak 150 ms before it), so for a sharp
   "pass" moment use a medium.
4. **Ding, success and ticks** use real recorded instruments (VCSL vibraphone, marimba,
   woodblock), so their timbre is natural. The vibraphone notes show a slow beating, which is in
   the recording (bar and resonator).
5. **Levels:** the role targets are reasoned starting points, not listened mixes.
6. **Badger's tail thump** is a drum-based approximation of a tail on a floor. It reads as a soft
   padded thump, but a real recording of Badger's tail would beat it.

## Licences and provenance

- Synthesis: original code in this folder; the output is ours.
- VCSL (Versilian Community Sample Library), CC0 1.0, commit `c1ea7bcc`, pinned and verified by
  `scripts/audio/setup.sh`; see `docs/AUDIO_LICENSES.md`. These 15 files are used, processed:
  - woodblock: `wood_click_f_rr1`, `wood_click_f_rr2`, `wood_click_ff`, `wood_click3_vl2`;
  - soft-mallet vibraphone: `Vibes_soft_D4/A4/G3_v2_rr1_Main`;
  - marimba: `Marimba_hit_Outrigger_C4/G4/B4/F3_med_01`;
  - frame drum: `HDrumL/HDrumS_HitMuted_v3_rr1/rr2_Sum`.
  Every manifest entry lists its exact sources (path, commit, licence, pitch shift).
- Tools: numpy, scipy, soundfile (BSD) and pedalboard (GPL-3.0). These are tools; they place no
  licence on the audio.

## VCSL pitch labels: a finding for the music side

Measured 2026-11-24: VCSL file names use the "C3 = middle C" octave numbering. A file labelled D4
sounds D5 (587 Hz) in the scientific numbering the engine uses (`core.note_number('C4') == 60`).
Across the Kawai piano, vibraphone, marimba, hand chimes and glockenspiel, the energy at the
labelled pitch sits 27-102 dB below the energy one octave up. `sfxlib/vcsl.py` handles this
(`sounding_midi`), and a test measures the pitch of every mallet note used here. The engine's
sampler (`audiolib/sampler.py`) maps the labels as written, so the reference render and any music
using VCSL pitched instruments sound an octave higher than their MIDI notes. That belongs to the
audio engine and the composer to confirm and fix; this folder does not touch it.

## Layout

```
scripts/audio/sfx/
  build.py            CLI: render, finish, write, measure, review, export
  sync_check.py       renders remotion/SyncCheck.tsx through Remotion and measures where every sound lands
  remotion/           SfxSyncCheck composition, its entry point and its audio-only render config
  sfx.ts, sfx.test.ts typed manifest access for Remotion (startFrame, volume, pick, rigStartFrame)
  sfxlib/             core, prims, vcsl, space, rig, finish, measure, manifest, review
  sfxlib/families/    whoosh, ui, keyboard, desk, notify, rekt, badger
  tests/              stdlib unittest (primitives, rig, finishing, measurements, VCSL pitch, families, the exported library)
  speech_mask.py      per-frame speech mask of a narration, for placing UI sounds in the gaps
public/audio/sfx/     manifest.json and <category>/<id>.wav (27 MB, largest file 1.6 MB)
```
