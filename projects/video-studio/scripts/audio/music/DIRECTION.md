# Music direction: The Zoo & Badger Show and Zoora AI

Written 2026-11-24, before composing. It is the brief every cue in `scripts/audio/music/` is built and judged against. Owner's standard: "I don't want anything basic. I want quality. Quality is vital."

## 1. The sound in one sentence

A confident late-night trio (piano, bass, tight drums) dressed in noir colours (vibraphone, pizzicato and low strings) with a quiet tech edge (an analog pulse, a sub, glassy textures). It is premium-explainer calm with late-night timing, and the dry wit lives in the writing rather than in sound effects.

What it is **not**:
- No stock-music cheer: ukulele, whistling, glockenspiel bounce, "corporate" claps.
- No EDM: four-on-the-floor kicks, supersaw leads, drops, sidechain pumping.
- No spy-surf clichés: twangy guitar, minor-major "Bond" chord as the hook.
- No exposed General MIDI brass, choir or lead. Where a soundfont instrument is used, it sits inside a texture or is a real-sample set (the VSCO 2 strings).

## 2. The signature motif ("Zoo's motif")

Five notes on the rhythm of the show's name: **"ZOO and BAD-ger SHOW"**.

| | ZOO | and | BAD | ger | SHOW |
| --- | --- | --- | --- | --- | --- |
| Minor (home) | 1 | 1 | 5 | ♭5 | ♭3 |
| In D minor | D | D | A | A♭ | F |
| Major (uplift) | 1 | 1 | 5 | ♯4 | 3 |
| In D major | D | D | A | G♯ | F♯ |
| Onset (beats) | 0 | 0.75 | 1 | 1.5 | 2 |
| Length (beats) | 0.75 | 0.25 | 0.5 | 0.5 | 2 (held) |

Successive intervals: **0, +7, −1, −3** (minor) or **0, +7, −1, −2** (major). The tests look for this fingerprint in every cue's score.

Why it works:
- **Deadpan repeat.** The repeated tonic is Zoo's flat delivery.
- **Confident leap.** The fifth up is the host's confidence.
- **The wink.** The slide down through the blue note (♭5) is the dry wit: it is "wrong" for half a beat, then lands.
- **Mode-flexible.** Changing only the last note's mode turns it from noir (♭3) to resolved and helpful (3, with a lydian ♯4 on the way).

Derived forms (each cue states which it uses):
- **Head.** 1-1-5: the brand stamp in bumpers.
- **Tail.** 5-♭5-♭3: the sly slide, usable as a bass or string figure.
- **Retrograde.** ♭3-♭5-5-1-1: "rewind", used by the Correction bumper.
- **Augmentation.** 2x to 4x longer, for the Zoora AI story beds.
- **Ticker.** The repeated tonic becomes a 16th-note pulse, for DEVELOPING.

**Badger's figure.** Badger is nonverbal, so his musical voice is a reply: a falling semitone (♭2 to 1: E♭2 to D2) on pizzicato basses and celli and the finger-plucked bass. It is the musical side-eye. Leave room after it for the owner's real dog sounds; never write anything that imitates a dog. Since critic round 1 the celli double it an octave up (E♭4 to D4) and a dry cross-stick on its own track marks each note, because a phone speaker plays nothing of the low octaves. Since critic round 2 the figure has no kick (its sub was inaudible on a phone but drove the master limiter), and the double is compressed hard and fast and lifted at 1.5 kHz instead of being pushed: it reads as two low notes with a mid-register shadow, within 3 dB of the motif on a phone.

## 3. Harmony and writing rules

- **Chord colour.** Minor 9ths and 11ths, maj7♯11 on ♭VI, half-diminished ii, altered dominants (7♭9, 7♭13), sus4 chords. Use pedal points for the beds, so the harmony moves while the bass stays calm under the voice. Use chromatic and lament bass lines (D-C-B♭-A) for the noir colour.
- **Voice leading.** Every chord change is voice-led (least total movement, via `audiolib.theory.voicing(prev=...)` or written by hand). No parallel block chords in the comping.
- **Variation every 8 bars.** Each 8-bar section adds, removes or re-voices at least one layer, and the drum pattern changes its fills and accents. Two identical consecutive bars are allowed only for a deliberate ostinato.
- **Dynamics.** The full theme builds (intro, A, B, A', button). Stings land on a hit. Beds breathe in 8-bar arcs but return to their starting level at the loop point, so the loop never jumps.
- **Humanised.** Slow timing drift plus jitter (`humanize.humanize`), rolled piano chords, velocity variance, a light swing (54-57 %) where the groove wants it, and the bass a few ms behind the beat. No machine-gun repetition: round robins on every sampled drum, varied ghost notes.

## 4. Keys and tempos (justified)

Everything is centred on **D** (D minor, D major, F major/lydian), so any two cues can be cut together without a key clash. D minor is a natural key for the string sections (open D and A strings).

**Zoo's voice, measured (critic round 1, 2026-11-24; this replaces the first estimate of "about 100-160 Hz").** Four Kokoro `im_nicola` narrations: F0 median 81-88 Hz, P5-P95 68-119 Hz, the strongest one-third-octave band at 80 Hz, a 1-2.5 kHz band 18-26 dB under the spectrum's peak and a presence peak near 5 kHz. So the bass's D2-A2 notes sit inside his F0 range, and his consonants are weak exactly where a bed's mids live. Under his voice: the bass is dark (it may share his register, not his consonant band), pulses and motif statements stay above about 180 Hz (out of his F0 band), the bed bus dips 1.25 and 2 kHz, beds are ducked by band (2 / 12 / 4 dB at 700 Hz and 5 kHz), and every bed has an UNDERSCORE version without the motif.

Every tempo has an **integer number of video frames per beat at 30 fps** (BPM = 1800 / frames). Cuts land exactly on beats, and loop lengths are whole frames and whole samples.

| Family | Key | BPM | Frames/beat | Why |
| --- | --- | --- | --- | --- |
| Theme, 15 s, 5 s, bumpers, end screen | D minor | 100 | 18 | Confident walking pace; the motif takes 1.2 s from ZOO to SHOW, readable on a phone |
| Show intro sting | D minor | ≈138 (motif timed to the sting's frames) | — | SHOW lands on the ampersand hit (1.00 s); Badger's figure on his look (1.93 s) |
| Show beds (neutral, tension, light) | D dorian / D minor / F major | 90 | 20 | One tempo and one key family, so an editor can cross-fade between moods on any bar line |
| Zoora AI story beds (curious, tension, ominous, resolve) | F lydian / D minor / D phrygian / D major | 75 | 24 | Cinematic and unhurried; the shared tempo lets beds switch on bar lines; tension (Dm) resolves to D major |
| Zoora AI intro sting | F lydian | 100 | 18 | The motif's SHOW lands on the logo hit (1.80 s) |

## 5. Palette (real samples first, synthesis as glue)

| Role | Source (licence in `docs/AUDIO_LICENSES.md`) |
| --- | --- |
| Piano (motif, comping) | VCSL Kawai grand, levelled velocity layers, pedal and releases (CC0) |
| Noir colour | VCSL vibraphone, soft and hard mallets; bowed vibraphone for textures (CC0) |
| Strings | MuseScore_General VSCO 2 sections (violins, violas, celli, basses: slow, fast, pizzicato, tremolo; the CC2 "Expr." banks for swells) (MIT; the samples are CC0) |
| Bass | Our finger-plucked string (`FingerBass`: a waveguide string with a triangle-and-noise finger excitation, a frequency-dependent loss filter and a fractional-delay allpass) plus a sine sub layer. It replaced the engine's plucked string in critic round 1 (44 % of its power at 1-4 kHz, clavinet-bright). Critic round 2 found its spectrum static (every harmonic decaying at the same 17 dB/s, an organ signature); the loss filter now makes the upper harmonics die 3-12 times faster than the fundamental, as on a plucked string |
| Drums | Synth kick (engine; 0.11 s body, one fixed tuning, 52 Hz, for every hit: per-hit tuning to the bass spread its pitch over 3.6 semitones, an 808 idiom) layered with the MuseScore kit kick; VCSL snares, cross-stick, hi-hats, claps, shaker, cymbals, toms, frame drum, concert bass drum, timpani (CC0/MIT) |
| Mallets and sparkle | VCSL marimba, glockenspiel (sparingly), tubular bells, concert harp, kalimba, vibraphone (soft, hard and bowed). The MuseScore celesta is no longer used (weak sample credit, a slow attack) |

**Intonation (critic round 2).** Every sampled instrument plays in tune with the synths (which are exact). The VCSL harp (6-12 cents flat) and the Kawai's bottom two octaves (10-26 cents flat) are played from each sample's measured root (`instruments.measured_root`: the harmonic partials 1-4 within 10 dB of the strongest, so a weak fundamental cannot pull it); the MuseScore VSCO 2 strings (up to 30 cents off per key, and per velocity layer) get a measured per-key correction sent as MIDI Tuning Standard messages (`composer/gmtune.py`, table `gm_tuning.json`).
| Tech edge | Our own synthesis: FM tine electric piano, analog pad, pulse arpeggiator, brass stab, sub drone, risers and reverse swells |

## 6. Mix and master rules

- **Beds are judged by Zoo's voice.** Keep 1-4 kHz sparse in the arrangement: no busy mid melodies, soft mallets, hats tucked, EQ dips on mid instruments, and the bed bus pocket at 1.25 and 2 kHz (-3 dB each). The gate is voice-referenced (`composer/voicegate.py`): with the planned band-split duck, the band-audibility index of the reference narration over the bed must be 0.75 or more and not below speech-shaped noise at the same loudness. (The old gate, a 1-4 kHz pocket against the bed's own tilt, passed beds that masked his voice more than noise does.)
- **Underscore.** Every bed ships twice: with the motif (for intros, outros and gaps) and as `-underscore`, with the motif and lead lines muted, for use under speech.
- **Low end.** Mono below about 120 Hz, the kick and bass in separate bands, no 200-500 Hz build-up (mud of 3 dB or less), and reverb returns high-passed at about 200 Hz.
- **Loudness** (engine presets):
  - theme full and 15 s: `standalone` at -16 LUFS-I (critic round 2: at -14 the master limiter took 7-10 dB off the hits and Badger's notes; at -16 it takes under 4) with a -2.2 dBTP ceiling and 2 dB less air above 9 kHz, so they stay under -1 dBTP after AAC 128 kb/s (the worst of ten encodes);
  - 5 s sting, bumpers and intro stings: `sting` (-16 LUFS-I, -1.5 dBTP, clean tail);
  - band cues hold their attacks before the master: fast compressors on the kick, snare, hats, claps, EP and brass, and the piano's hammer peaks held to 14 dB over its own loudness, so the master limiter never works more than 4 dB;
  - beds and the end-screen bed: `bed` (-26 LUFS-S median, -6 dBTP; loops mastered with `loop=True`);
  - the end-screen music with nobody speaking: `endscreen` (-18 LUFS-I, -2 dBTP).
- **Loops are seamless by construction.** One cycle is rendered with its tail. The tail is folded onto the start, so the release and reverb from the last bar ring into bar 1. The cycle is mixed with wrap-around padding, so the reverb and compressors see the seam, then mastered with `loop=True`. Each bed is checked with `metrics.py --loop`.
- **Every cue is measured.** Loudness, true peak, spectrum balance, stereo and mono, noise, and the tail or loop seam. The spectrogram is looked at, and each cue gets a short honest self-review in the README.

## 7. Cue briefs

| Cue | Length | Brief |
| --- | --- | --- |
| Theme, full | 60-75 s | Intro (piano motif over a low D, pulse fades in), A (groove in, motif and answers), B (strings swell, counter-line, ♭VI colour), A' (full: motif in octaves on piano, vibes and pizzicato, brass stabs on the hits), button: the motif plus Badger's figure |
| Theme, 15 s | 15 s | Intro motif, 4 bars of A, button at 12.0 s, ring-out |
| Theme, 5 s sting | 5 s | Pickup, motif, button by 2.4 s, ring-out |
| Bumper: Headline / Rekt Meter | about 3 s | The meter fills (snare roll and rising pizzicato), then the motif's tail lands as a punchy stab |
| Bumper: Badger's Red Flag | about 2.5 s | Motif head, a deadpan rest, Badger's figure. Room left after it for a real dog huff |
| Bumper: Zoo's One Fix | about 3 s | Major-mode motif on vibes and piano; resolves to D6/9 (no major 7th under the tonic) with a harp sparkle |
| Bumper: Scam of the Week | about 3 s | Low, sly motif (piano and pizzicato) with a brushed swish; ends unresolved (B♭7♯11) |
| Bumper: DEVELOPING | about 3 s | The tonic turns into a 16th-note ticker that rises; the motif head in tremolo strings; ends suspended (Dsus) |
| Bumper: Correction | about 3 s | Reverse swell ("rewind"), then the motif's retrograde, calm on piano and soft strings, resolving to D |
| Show bed, neutral | 64 s loop | D dorian over a D pedal; EP, bass, soft kick, cross-stick and shaker; motif fragments on vibes every 8 bars |
| Show bed, tension | 64 s loop | D minor and phrygian; muted 16th pulse (two octaves over the bass, out of Zoo's register), low string drone with an E♭ neighbour, ticking; the motif slow on soft vibes at D5 |
| Show bed, light | 64 s loop | F major (lydian wink); pizzicato, swung brushes-style hats, short bass, vibes; the major motif |
| Story bed, curious | 64 s loop | F lydian; harp, kalimba or celesta ostinato, pizzicato, marimba, bowed-vibes sustains; the motif augmented |
| Story bed, tension | 64 s loop | D minor; low string ostinato doubled an octave up by violas, pulse, ticking, cymbal swells; motif fragments on vibes and violins. The underscore plays the ostinato an octave up (G3-F4), out of Zoo's F0 range |
| Story bed, ominous | 64 s loop | D phrygian; drones, sparse low piano with the tritone, gong and bass-drum swells; the motif very slow |
| Story bed, resolve/uplift | 64 s loop | D major; piano arpeggios, string swells, a gentle pulse; the major motif resolving |
| End-screen bed | 20 s | Theme groove, light; under Zoo's voice-over the vibes rest until the motif and button at 16.8 s, ending at exactly 20.0 s (end-aligned). A second version, `endscreen-music`, keeps the vibes answers for an end screen with nobody speaking (-18 LUFS-I) |
| Zoora AI intro sting | 4.5 s | A rising harp and string shimmer; the lydian motif on hard-mallet vibes doubled by the harp lands on the logo hit at 1.80 s; two notes under the wordmark and the tag (2.33 s and 2.6 s); the bloom is released by 3.3 s and decays naturally (critic round 2: at 4.0 s it was cut, not finished) |
| Show intro sting | 4 s | A drum pickup; the motif with SHOW on the ampersand hit (1.00 s); Badger's figure on his judging look (1.93 s); out cleanly by 4.0 s (the sting hard-cuts) |
