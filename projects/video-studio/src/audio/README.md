# src/audio: music, effects and stingers inside Remotion

The audio integration plays the music package (`public/audio/music/`) and the SFX library (`public/audio/sfx/`) in Remotion compositions, under Zoo's narration, on the frame grid, and checks the delivered mix. It also renders the **AudioDemo**, a 31.5 s mix that exercises every part.

- **Import the API from `src/audio/api.ts`.** `src/audio/index.ts` is only the AudioDemo's Remotion entry point (separate from `src/Root.tsx`, `src/episode/index.ts` and `src/show/index.ts`).
- **Pure core.** Everything that decides what plays and how loud is pure TypeScript in `core/` (no Remotion import), tested in Node. The components in `components/` only place it on Remotion's timeline.
- **Status.** Built and measured on Remotion 4.0.541 (pinned). The Episode template plays it (2026-11-25) through its own sound plan: `src/episode/audio/` and `docs/EPISODE_ENGINE.md` §12. The Show template does not use it yet: its owner wires it in using the calls in "How the templates call it" below. Nobody has listened to the result; every judgement here comes from measurement.

## API

| Call | What it does |
| --- | --- |
| `<MusicBed src\|mood duck={{timeline, depthDb, attackMs, releaseMs}} loop/>` | A bed that ducks under the narration, per sample, and loops on its exact loop points. |
| `<Sfx id at variant? index? gainDb? underSpeech?/>` | One library sound, its sync point (impact, pass-by, top of a rise) on frame `at`. |
| `<SfxScene id>` | Seeds the variation choice of every `<Sfx>` inside it (use the storyboard scene id). |
| `<SfxCues cues/>` | Plays cues planned by the helpers below. |
| `<Stinger id at?/>` | A theme sting, channel intro sting or bumper, its first downbeat on frame `at`. |
| `sfxForTransition(type, {at, frames, scene})` | The whoosh for a transition, or null for `cut` and `fade`. |
| `sfxForBulletReveal({at, index, count, scene})` | The pop for a bullet reveal. Up to 4 bullets climb the ordered D5-G5-A5-D6 set. More use pitch-stable D5 pops that never repeat a file back to back. |
| `typingClicks(fromFrame, toFrame, density, {scene, text?, isStrike?})` | Keyboard clicks on whole frames at about `density` keys/s. With `text`, one key per character, plus the space bar and Enter. |
| `strikePredicate(fingerLift)` | Zoo's finger strikes as a frame predicate, built from the rig's own `fingerLift` (`src/characters/zoo`), for `isStrike`. |
| `placeStinger(id, at)`, `stingerRest(placement)` | Where a stinger plays, and the rest the bed takes for it (out before it, back in over its tail). |
| `speechSpansFromTimeline(tl)`, `speechSpansFromScenes(...)`, `narrationSpans(url)` | Where Zoo speaks: from word timings, from re-timed scenes (Shorts), or from the narration's RMS. |

All are exported by `api.ts`. Time values in `duck.speech` and `rests` are **absolute composition seconds**; frames are composition frames at 30 fps (the SFX library is cut at 30 fps and refuses other rates).

### `<MusicBed>`

```tsx
<MusicBed mood="neutral" duck={{timeline}} />                                    // show bed, -underscore version, defaults below
<MusicBed src="bed-story-tension-underscore" duck={{timeline, depthDb: 9}} levelDb={-2} />
<MusicBed mood="tension" duck={{narration: {src: 'generated/zoora-security/<slug>/en/narration.wav'}}} />  // speech RMS
<MusicBed mood="neutral" duck={{speech}} rests={[stingerRest(placeStinger('bumper-red-flag', 900))]} lift={{db: 6}} />
```

| Prop | Default | Notes |
| --- | --- | --- |
| `src` or `mood` (+ `channel`, `underscore`) | | `mood`: show `neutral`/`tension`/`light`, story `curious`/`tension`/`ominous`/`resolve`. With a duck, the `-underscore` version (motif and lead lines muted for speech). |
| `duck.timeline` (+ `timelineOffsetSec`) / `duck.speech` / `duck.levels` / `duck.narration` | none | Word timings, explicit spans, a level track, or the narration audio's RMS, read during the render. The engine's voice-activity rule: within 30 dB of the 95th-percentile level, above -55 dBFS, runs of 80 ms or more. |
| `duck.depthDb`, `attackMs`, `releaseMs` | **12 dB, 120 ms, 450 ms** | Lookahead = attack, so the duck is complete on the first word. |
| `duck.minGapMs` | 800 ms | Pauses shorter than this stay ducked, so the bed does not pump between words. Critic round 2 measured that filling pauses under 0.8 s halves the mid-band "blooms" at the same intelligibility. |
| `duck.split` | `true` | The engine's band-split duck. The bed is split at 700 Hz and 5 kHz (zero-phase, Linkwitz-Riley 8th-order magnitude, bands sum exactly), and `depthDb` applies to Zoo's consonant band: 2 / 12 / 4 dB at the default. `split: false` is a broadband duck; `depthsDb: [low, mid, high]` sets each band. |
| `lift` | off | "Music up" in pauses of 1.8 s or more (e.g. `{db: 6}`). It raises the bed's peaks, so pair it with the master step. |
| `loop` | the cue's loop points | Every bed is a seamless 64 s loop; the wrap is sample-exact, and the bands are split circularly so each band loops too. |
| `levelDb`, `fadeInMs`, `fadeOutMs`, `rests`, `startAtSec`, `durationInFrames` | 0, 0, 0, none, 0, the enclosing Sequence | Beds are mastered at -26 LUFS-S to sit under -14 LUFS narration; keep `levelDb` at 0 unless the owner asks (the Episode's planner trims the louder story beds so each sits at the same level under the voice). A rest's `floorDb` (added 2026-11-25) dips the bed to that level instead of silence. |
| `fadeCurve`, `fadeOutCurve` (added 2026-11-25) | `'raisedCosine'` | `'equalPower'` for one half of a crossfade between two beds: sin(π/2 · raised cosine), so the summed power stays constant through the overlap. `fadeShape(u, curve)` in `core/envelope.ts`. |

The bed plays through **`PcmTrack`**, which writes every frame's samples itself (Remotion's `inline-audio` render assets, the mechanism `@remotion/media`'s `<Audio>` uses) with the gain evaluated per sample. Remotion's own `<Html5Audio volume={f => ...}>` cannot do this; see "Why PcmTrack". In the Studio preview the bed plays through `<Html5Audio>` with a per-frame broadband volume: an approximation for previewing only. Only renders are judged.

This is the in-render equivalent of `scripts/audio/duck.py`'s pre-ducked bed (`underNarration()` in `scripts/audio/music/manifest.ts` exists for that path): the same split, depths and voice-activity rule, reproduced to the 16-bit floor (AudioDemo: residual -85.7 dBFS peak against the engine's own `split_bands`). A template uses one path or the other, never both.

### `<Sfx>`, transitions, bullets, typing

```tsx
<SfxScene id={scene.id}>
  <Sfx id="whoosh_medium" at={cutFrame} index={0} />          // a group: the variation comes from the scene + index
  <Sfx id="pop_rise_02" at={revealFrame} underSpeech />      // an exact file; -3 dB when it plays under Zoo
</SfxScene>
<SfxCues cues={[
  sfxForTransition('slide', {at: span.from - span.preroll, frames: span.transitionFrames, scene: span.id}),
  ...bullets.map((b, i) => sfxForBulletReveal({at: b.frame, index: i, count: bullets.length, scene: span.id})),
  ...typingClicks(typeFrom, typeTo, 6.5, {scene: span.id, text: 'check it twice\n', isStrike: strikePredicate(fingerLift)}),
].filter((c) => c !== null)} />
```

- **Variation.** Each (group, scene) walks its own seeded permutation, so a file never repeats back to back (even across the wrap), every variation plays before any repeats, and the same place always plays the same file in every render tab. Never `Math.random`.
- **Transitions.** `cut` and `fade` stay dry (a hard cut inside a sequence, a fade for a time jump: ART_GUIDE MO16). `slide` → `whoosh_medium`, `wipe` → `whoosh_short`, `chapter` → `whoosh_long`, all with the pass-by mid-transition (where a minimum-jerk push moves fastest). `reverse` → `whoosh_reverse`, its swell landing on the cut.
- **Typing.** Keys land on whole frames at least 2 frames apart. Intervals are log-normal (σ 0.35), words end in a space bar with a slightly longer gap, and 10% of words get a thinking pause. Letters, space bars and Enter each walk their own variation order, so no key file repeats back to back. Velocity is 0 to -3 dB, never above the suggested gain (the library caps keys at -6 dBTP). `isStrike` moves a key at most 1 frame onto one of Zoo's finger strikes (more than 90% land on one in the tests).
- **Levels.** Every cue plays at the library's `suggestedGainDb` (200 ms K-weighted targets: whooshes -21, Rekt Meter -22, notifications -21, UI -27, foley -28 LUFS), plus `gainDb`, plus the role's `underSpeechTrimDb` with `underSpeech`. Placement is a constant gain, which Remotion's mixer applies exactly (0.0 ms placement error measured on 20 cues).

### `<Stinger>`

```tsx
const bumper = placeStinger('bumper-rekt-meter', 438);         // its downbeat on frame 438 (it starts at 436: 2-frame pre-roll)
<Stinger id="bumper-rekt-meter" at={438} />
<MusicBed mood="neutral" duck={{timeline}} rests={[stingerRest(bumper)]} />   // the bed steps out for it
```

The level is the cue as mastered (-16 LUFS-I), trimmed so its true peak is at most **-2 dBTP** (`PEAK_BUDGET_DBTP`): Remotion sums tracks with no bus limiter, and AAC overshoots. Every sting and bumper in the package is at -1.8 dBTP or lower, so the trim is 0 to -0.2 dB. `levelDb` overrides it. `placeStinger(...).hits` gives the frames of the cue's musical hits (SHOW lands, Badger's E-flat and D...) for animation.

## How the templates call it (for their owners; this integration does not edit them)

Both templates already resolve `r.timeline` (the voice step's Timeline) and play `r.narration` with one `<Html5Audio>` (landscape) or per-scene windows (Shorts).

**Episode: done (2026-11-25).** `src/episode/audio/plan.ts` plans every bed, crossfade, rest, duck hold, sting and effect from the storyboard and timeline, and `src/episode/audio/EpisodeAudio.tsx` plays the plan with `<MusicBed>` (one per bed segment, `startAtSec` on the episode's one musical clock, equal-power crossfades), `<Stinger>` and `SfxPlay`. The sketch below was the starting point it replaced; the Show can still use it:

```tsx
import {MusicBed, SfxCues, Stinger, placeStinger, stingerRest, sfxForTransition, speechSpansFromScenes} from '../audio/api';
// landscape: the bed under the whole episode, ducked by the word timings
<MusicBed mood="curious" channel="story" duck={{timeline: r.timeline}} fadeInMs={800} fadeOutMs={1500} />
// one whoosh per scene entrance (spans from timing.ts; preroll frames run before `from`)
<SfxCues cues={spans.map((s) => sfxForTransition(s.transition, {at: s.from - s.preroll, frames: s.transitionFrames, scene: s.id})).filter((c) => c !== null)} />
// Shorts (vertical): scenes are re-timed, so build the speech spans from where each scene now plays
const speech = speechSpansFromScenes(spans.map((s) => ({atSec: s.from / fps, untilSec: (s.from + s.durationInFrames) / fps, words: r.timeline.scenes[s.index].words})));
<MusicBed mood="curious" channel="story" duck={{speech}} />
```

- Pick the mood per episode, or per chapter with one `<MusicBed>` per `<Sequence>` and crossfades (`fadeInMs`/`fadeOutMs` overlapping by about 1 s). The story beds are `curious`, `tension`, `ominous` and `resolve`.
- The end screen uses `endscreen-music` (no voice over it) or `endscreen-bed` (under a voice-over), through `<Stinger>`. Both are 20 s one-shots.
- Chart reveals and steps: `sfxForBulletReveal` per revealed item, with `underSpeech: true` when Zoo is talking (UI pops sit at 1.7-2.6 kHz, on his consonants). Better: move the pop to the nearest pause with `nearestGapFrame` (`scripts/audio/sfx/sfx.ts`).

**Show (`src/show/Show.tsx`, `ShowView`)**:

```tsx
<Stinger id="intro-sting-show" at={0} />                                 // or theme-5s / theme-15s for the open
<MusicBed mood="neutral" duck={{timeline: r.timeline}} rests={bumpers.map((b) => stingerRest(b))} />
{bumpers.map((b) => <Stinger key={b.cue.id} id={b.cue.id} at={b.downbeat} />)}
// the show's transitions run over the incoming scene's first frames (no preroll): the whoosh is placed from `from`
<SfxCues cues={spans.map((s) => sfxForTransition(s.transition, {at: s.from, frames: s.transitionFrames, scene: s.id})).filter((c) => c !== null)} />
// bumpers: placeStinger(<id>, <first frame of the segment>) for each segment that opens with one:
//   badgerRedFlag -> bumper-red-flag, zooOneFix -> bumper-one-fix, scamOfTheWeek -> bumper-scam-of-the-week,
//   correction -> bumper-correction, the Rekt Meter -> bumper-rekt-meter, a developing story -> bumper-developing
```

- **A bumper needs room.** It is 3.0-3.4 s of music with no voice over it. Put it in the silence before a segment (the show's timing model decides where), with its downbeat on the segment's first frame. The bed rests from 2 frames before it until its tail (`stingerRest`).
- **Rekt Meter.** `rekt_needle_*` and `rekt_alarm_*` from the SFX library carry their own sync points: `<Sfx id="rekt_needle" at={needleStart} />`.
- **Badger** stays nonverbal. His foley (`badger_paw`, `badger_tail`) goes after Zoo's line, never over it. Real dog sounds come later from the owner's clips.
- **Typing at the desk:** `typingClicks(from, to, 6.5, {scene, isStrike: strikePredicate(fingerLift)})` with `fingerLift` imported from `src/characters/zoo`. The clicks then land on the frames where Zoo's fingers strike.

**Then master the render** (both templates; the Episode's `src/episode/tools/render.sh` does all of it and gates the result):

```bash
npx remotion render <bundle> <Composition> out/x.raw.mp4 --separate-audio-to=$PWD/out/x.wav --props=...  # picture + lossless mix, one pass
.venv-audio/bin/python src/audio/tools/master_mix.py --wav out/x.wav --video out/x.raw.mp4 --out out/x.mp4 --wav-out out/x.master.wav --report out/x.master.json
.venv-audio/bin/python src/audio/tools/master_mix.py --wav out/x.wav --out out/x.m4a      # audio only (a dub's audio track): .m4a or .wav
```

`--separate-audio-to` writes the same pcm-16 mix as `--codec=wav` (the render's audio path is identical) while the picture renders, so one pass gives both; pass it an absolute path (Remotion resolves a relative one against its root). The audio-only `--codec=wav --config=src/audio/remotion.wav.config.ts` render is still the way to render a stem or an audio track without a picture.

## Levels and delivery

| Element | Level as delivered to the mix | Source |
| --- | --- | --- |
| Narration (Kokoro `im_nicola`) | -14 LUFS-I, about -4.2 dBTP after Remotion's equal-power stereo upmix | voice step |
| Beds | -26 LUFS-S (stories -27.5 to -26), true peak -6.2 dBTP or lower; ducked 2/12/4 dB under speech | music package |
| Stings, bumpers | -16 LUFS-I, trimmed to -2 dBTP or lower | music package + `<Stinger>` |
| SFX | 200 ms targets: -21 (whoosh), -22 (meter), -21 (notify), -27 (UI), -28 (foley) LUFS | SFX library |

**Master step (`tools/master_mix.py`)**, the bus a broadcast mix ends with:
1. A 20 Hz 2nd-order subsonic high-pass. It removes the narration's DC (see Limits) and loses 0.4 dB at D1 (36.7 Hz), the lowest bass note in the package.
2. One static gain to -14 LUFS-I (BS.1770-4) into the engine's true-peak limiter at -1.5 dBTP; the gain is re-aimed until the limited result is within 0.05 LU.
3. AAC with Remotion's own encoder (`libfdk_aac` 320 kb/s through `npx remotion ffmpeg`), the render's video copied untouched.
4. The MP4 is decoded and measured again. If AAC pushed the true peak over -1 dBTP, the ceiling drops and steps 2-4 repeat.
5. (2026-11-25) The mastered mix is also encoded as the platforms re-encode an upload (AAC-LC and Opus at 128 kb/s), decoded and measured: over 0 dBTP on either lowers the ceiling and repeats too; over -0.5 dBTP is a warning in the report. Transients overshoot more at 128 kb/s than at 320. `--no-stream-check` skips it.

Without `--video` the master delivers audio only (`--out` .wav 24-bit or .m4a AAC 320 kb/s) with the same steps.

No EQ, no compression. **For a speech-led episode the master is a safety net.** A simulated episode (the intro sting, then the show's real 59 s narration over `bed-show-neutral-underscore` with the band-split duck) measures -14.05 LUFS-I / -1.63 dBTP before the master; the master adds +0.05 dB and limits nothing. The AudioDemo is different: 21 of its 31.5 s are music-only, so its raw mix sits at -16.4 LUFS-I and the master adds +2.6 dB (below).

## Why PcmTrack (measured)

`tools/probe_duck.sh` renders one bed under a 12 dB, 120 ms / 450 ms duck through Remotion's `<Html5Audio volume={f => ...}>` and through `PcmTrack`, and compares both with the ideal per-sample duck (`out/audio/integration/probe/compare.json`):

| | Residual vs ideal (RMS / peak) | 5 ms windows where the >3 kHz residual is within 20 dB of the signal | Largest gain jump (32-sample blocks) |
| --- | --- | --- | --- |
| `<Html5Audio volume>` | -52.0 / **-22.2 dBFS** | **220 of 2000** (worst +8.3 dB, on the attack at 6.40 s) | **11.3 dB**, at sample 307200 = 75 × 4096 |
| `PcmTrack` | -96.3 / -86.5 dBFS (16-bit dither floor) | 3 of 2000 (worst -17.7 dB) | 0.35 dB |

Remotion applies a volume callback once per decoder packet (FLAC frames of 4096 samples, 85 ms), so a 120 ms attack lands as one 11 dB step: zipper noise and a click. A broadband duck through that path also cannot reproduce the band split. `PcmTrack` evaluates the raised-cosine curve per sample (largest step 0.0033 dB per sample at a 120 ms / 12 dB attack, tested), wraps loops on the exact sample, and registers each frame's samples before releasing the frame. That frame protocol is the same as `@remotion/media`'s `<Audio>`: a frame is never captured without its audio.

It depends on Remotion internals (`Internals.RenderAssetManager`, `inline-audio`). Every Remotion package is pinned to 4.0.541, and `tests/internals.test.ts` fails if an upgrade removes or changes them.

## AudioDemo (31.5 s, 1920×1080, 30 fps)

Theme sting → slide (whoosh) → Zoo's line 1 over the ducked bed (`bed-show-neutral-underscore`, entering on its last bar so the render crosses the loop seam under speech) → three bullets with rising pops → Rekt Meter bumper (the bed rests) → wipe (whoosh) → line 2 → a typing beat ("check it twice", one key per character, Enter) → theme button (`theme-5s`, the bed fades out under it). The picture is plain and labelled "internal mix check, not for publishing": section titles, the words as they are spoken, and a panel that draws the plan the audio is rendered from (speech, the bed's mid and low duck curves, stingers, SFX, a playhead).

```bash
src/audio/tools/demo.sh        # about 3 min: voice if missing, plan, lossless mix + 4 stems, MP4, master, measure, engine metrics
src/audio/tools/rms_check.sh   # about 1 min: the speech-RMS duck renders byte-identical to Node-computed spans
src/audio/tools/probe_duck.sh  # about 1 min: Html5Audio volume vs PcmTrack (table above)
```

The narration comes from the voice step: `.venv-voice/bin/python scripts/voice/build.py src/audio/dev/fixtures/zoora-security/_audio-demo --lang en --voice im_nicola`. It writes two lines, 4.3 s of speech each, to `public/generated/zoora-security/_audio-demo/en/`, which is gitignored.

### Measured (2026-11-25, `out/audio/integration/report.json`)

| Check | Result |
| --- | --- |
| Delivered MP4 loudness | **-14.04 LUFS-I** (ffmpeg ebur128 -14.1), LRA 7.9 LU |
| Delivered MP4 true peak | **-1.77 dBTP** (ffmpeg -1.8); AAC-LC 48 kHz stereo 320 kb/s; H.264 High, yuv420p, BT.709 |
| Delivered DC offset | 0.00001 (raw mix 0.0184, from the narration) |
| Voice on top (under speech) | Voice **14.5 LU over everything else** (worst phrase 13.95 LU); band-audibility index 0.88 (P10 0.73, gate 0.75); 1-4 kHz voice-to-rest median 29 dB, 4% of speech frames under 3 dB |
| Bed vs its plan, per sample | Residual -96.9 dBFS RMS, -85.7 dBFS peak (16-bit floor); -87.2 dBFS around the loop seam |
| Placement | 20 SFX, 3 stingers (downbeats) and 2 narration lines all within 0.0 ms of their planned sample |
| Stems sum to the mix | residual -240 dBFS (nothing else in the mix) |
| Remotion's raw mix | -16.42 LUFS-I, -1.0 dBTP (the master adds +2.59 dB; limiter max 3.75 dB, over 1 dB on 2.3% of 10 ms blocks) |
| Sections, delivered | sting -14.2, line 1 -12.1, bullets -18.2, bumper -14.3, line 2 -11.9, typing -18.7, theme button -14.6 LUFS-I |
| Engine `metrics.py --profile standalone` | passes everything but `spectrum.mudDb` 6.1 (limit 3). The voice stem alone reads 9.6 and the music stems 1.7-2.4: it is Zoo's voice measured against a music-master profile |

## Tests and checks

```bash
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test "src/audio/tests/*.test.ts"   # 92 tests, about 1 s
.venv-audio/bin/python -m unittest discover -s src/audio/tools/tests -t src/audio/tools  # 14 tests: master (also audio-only .wav and .m4a, chunked meters equal to the engine's), alignment, voice-on-top, meters
npx tsc --noEmit
```

The TS tests cover the duck curve (timing, lookahead, gap filling, continuity, a per-sample step bound), the band split (Butterworth Qs, -6.02 dB crossover, exact band sum, seamless circular split), the PCM renderer (frame tiling, loops, offsets, mono upmix, deterministic dither, overs), speech spans (timeline, re-timed scenes, RMS; on the real narration the RMS spans cover more than 90% of the spoken words), SFX choice and helpers on the real manifest, music placement and the peak budget, the WAV and FLAC readers (every committed FLAC's STREAMINFO equals its manifest length), the AudioDemo plan, and the Remotion internals.

## Limits and open items

- **Nobody has listened.** This session has no audio output. The mix, the duck's feel and the balance were judged by measurement only.
- **The narration has a large DC component (voice step, `scripts/voice`; not fixed here).** Every `narration.wav` measured has a 50 ms mean of about +0.17 while Zoo speaks and exactly 0 in pauses: a whole-file mean of +0.07 to +0.10 over 7 files, with peaks of +0.87 / -0.50. It thumps at every phrase and wastes headroom. The master step's 20 Hz high-pass removes it from the delivery. A render that skips the master step keeps it, and the voice step should remove it at the source.
- **Zoo's voice reads boxy against a music profile** (+9.6 dB "mud", 200-500 Hz over a pink tilt). A dialogue EQ (a high-pass near 70 Hz, about -3 dB around 300 Hz, a little presence) is a decision for the owner's ear and the voice step. This integration does not change his timbre.
- **The demo's dialogue is about 2.5 LU hot.** Hitting -14 LUFS-I with 21 s of music-only content puts Zoo at -11.5 LUFS (speech-gated). In a speech-led episode the master changes almost nothing (simulated above).
- **Preview ≠ render** for beds: the Studio plays a per-frame broadband approximation (the whole file at the low band's gain, each loop pass restarted as its own sequence); judge renders only.
- **Remotion internals:** see "Why PcmTrack". Check them with `tests/internals.test.ts` before any upgrade.
- **The default duck release is the brief's 450 ms.** The engine's offline split duck (`duck.py`) uses 1.2 s, which makes the blooms in paragraph pauses gentler. Both fill pauses under 0.8 s. Pass `releaseMs: 1200` for the engine's feel.
