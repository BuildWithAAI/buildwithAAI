# Audio licences: sources, evidence and exclusions

Verified 2026-11-24 for the audio engine (`scripts/audio/`, docs in `docs/AUDIO.md`). Every sound in our music and SFX comes from one of the sources below, from our own code (synthesis) or from recordings the owner supplies. Rule (binding for the composer and the sound designer): **use only sources listed as allowed here, and add any new source to this file with its evidence before its first use.** No AI music services, no loops or samples of unknown origin, no copyrighted recordings.

## Allowed sources

| Source | Version / pin | Licence | Evidence read (where) | Use |
| --- | --- | --- | --- | --- |
| Our own synthesis (`audiolib.synth`: PolyBLEP oscillators, noise, plucked string, pad, sub, riser, kick; `audiolib.reverb` IRs) | this repo | Our code; the output is ours | n/a | Anything |
| VCSL (Versilian Community Sample Library), Versilian Studios LLC | git `c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e`, tree `aee077dea292930ede43d557a4c5e9edb2a6ceaf`, from https://github.com/sgossner/VCSL | **CC0 1.0 Universal** (public-domain dedication) | `.cache/vcsl/LICENSE` (full CC0 1.0 legal code, checked by `setup.sh`); `.cache/vcsl/README.md`: "This collection is under a Creative Commons 0 license. Essentially it's Public Domain- you can do whatever you want with these sounds (even make commercial software), no royalties, no credit, no special terms." | Pianos, drums, percussion, mallets, anything in the set |
| MuseScore_General HQ soundfont 0.2.1 (S. Christian Collins) | Ubuntu 24.04 packages `musescore-general-soundfont` 0.2.1-1 (`MuseScore_General_Full.sf3`, sha256 `f9a37b36…aeae`) and `musescore-general-soundfont-lossless` 0.2.1-1 (`MuseScore_General_Full.sf2`, sha256 `59287cbb…0a8f`) | **MIT**, parts public domain or CC0 | `/usr/share/doc/musescore-general-soundfont/copyright` (Debian): "MuseScore_General_HQ SoundFont (MIT, parts PD or CC0)", listing MuseScore Drumline samples (CC0), the "Splendid Grand piano from AKAI S5000 (verified Public Domain)", VCSL crash samples (CC0), VSCO 2 CE strings (CC0), FluidR3 Mono (MIT, Michael Cowgill; temple blocks Ethan Winer; drumline cymbals Michael Schorsch) and the original Fluid R3 (MIT, Frank Wen), with the full MIT text. Per-preset sources: `MuseScore_General_HQ_Sample_Sources.csv` and `MuseScore_General_HQ_Readme.md` from the .deb (`dpkg-deb -x`; this container strips `/usr/share/doc` extras) | GM instruments through fluidsynth |
| FluidR3_GM soundfont (Frank Wen) | Ubuntu 24.04 package `fluid-soundfont-gm` 3.1-5.3 (`FluidR3_GM.sf2`, sha256 `74594e8f…1cb0`) | **MIT** | `/usr/share/doc/fluid-soundfont-gm/copyright`: "I hereby release Fluid under the MIT license, as described in COPYING", with the full MIT text; contributors credited; "constructed in part from samples found in the public domain … and largely from recordings of my own" | GM instruments through fluidsynth |

### Notes on the soundfonts

- **MIT condition.** MIT requires the copyright and permission notice in "all copies or substantial portions of the Software". We do not redistribute the soundfonts (they come from Ubuntu's packages at render time), and the notices are kept here and in the Debian copyright files. Rendered music is a new performance through a synthesizer, not a copy of the soundfont; no on-screen or description credit is required. A courtesy credit line in a channel's "About" text is optional: "Some instruments: FluidR3 GM (Frank Wen, MIT) and MuseScore General (S. Christian Collins, MIT)".
- **Two presets with weaker provenance** in MuseScore_General (from its sample-sources CSV): "Trumpet" (bank 0, preset 56: "Samples: uncredited | License: Public Domain") and "Synth Bass 2" (bank 0, preset 39: "Original License: public domain", uncredited). The package licence still covers them, but the upstream credit is thin. **Policy: do not feature these two presets in exposed, signature parts** (theme melodies, stings); use another source or synthesis there.
- **Recording-quality caveat (not licensing):** the GM finger and pick bass presets (programs 33, 34; same samples in both soundfonts) have loop-splice sidebands on held notes (measured, see `docs/AUDIO.md`). Prefer `synth.PluckString` for bass lines.

## Tools (they do not license the output)

| Tool | Version | Licence | Role |
| --- | --- | --- | --- |
| FluidSynth | 2.3.4 (Ubuntu `fluidsynth` 2.3.4-1build3) | LGPL-2.1+ (`/usr/share/doc/fluidsynth/copyright`) | Renders MIDI through soundfonts |
| pedalboard (Spotify) | 0.9.26 | GPL-3.0 (PyPI metadata) | True-peak limiter, chorus/delay/phaser/ladder filter. A GPL tool places no licence on audio it processes; we do not distribute pedalboard |
| mido | 1.3.3 | MIT | MIDI files |
| numpy / scipy / soundfile (+ cffi, pycparser, packaging, typing_extensions) | 2.5.5 / 1.18.1 / 0.14.0 | BSD-3-Clause (deps: MIT, BSD-3-Clause, Apache-2.0 or BSD-2-Clause, PSF-2.0) | DSP, file I/O |
| ffmpeg | 6.1.1 (Ubuntu) | GPL build (tool) | Loudness measurement (ebur128), spectrograms, AAC previews |

## Excluded (not clearly permissive for commercial YouTube use)

| Candidate | Why excluded |
| --- | --- |
| `avldrums.lv2-soundfont` (AVL Drumkits) | CC-BY-SA 4.0: attribution plus share-alike on adaptations; not "clearly permissive" for our owned-music goal |
| `fluid-soundfont-gs`, `timgm6mb-soundfont`, `fluidr3mono-gm-soundfont`, `opl3-soundfont`, `csound-soundfont` | Not needed (duplicates of the above or lower quality); licences not reviewed, so not allowed |
| YouTube Audio Library, Pixabay, Freesound, other stock libraries | Out of scope for owned music: licences are per track, change over time, and Content ID exposure is unknown (`docs/research/platform-facts-2026-11-23.md`) |
| AI music generators | Excluded by the owner's brief |

## Content ID note (honest)

The music is composed in code and rendered from CC0, MIT and public-domain samples, so it carries no third-party composition or recording rights. That does not make a Content ID false positive impossible: the same public samples (especially VCSL and the GM soundfonts) are used by many others, and somebody could register a track built from them. Risk is lowest for original compositions with our own arrangement and processing, and we never use pre-made loops. Keep each project's render script, MIDI and stems (the engine writes them) as evidence of independent creation, in case a claim needs disputing.

## SFX library (`scripts/audio/sfx/`, delivered to `public/audio/sfx/`)

Added 2026-11-24 by the sound designer. Every effect is either our own synthesis (the code in `scripts/audio/sfx/`) or a processed VCSL one-shot (CC0, the pinned commit above). No new source was added. Each entry of `public/audio/sfx/manifest.json` lists its exact sources (path, commit, licence, pitch shift); `scripts/audio/sfx/build.py` regenerates every file bit for bit, which is the evidence of independent creation if a claim ever needs disputing.

| Asset (VCSL path) | Licence | Where its licence text is | Used for |
| --- | --- | --- | --- |
| `Idiophones/Struck Idiophones/Woodblock/` `wood_click_f_rr1`, `wood_click_f_rr2`, `wood_click_ff`, `wood_click3_vl2` | VCSL, CC0 | `.cache/vcsl/LICENSE` | soft UI ticks (raised 3-6 semitones, damped to 25-35 ms) |
| `Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/` `Vibes_soft_D4_v2_rr1_Main`, `Vibes_soft_A4_v2_rr1_Main`, `Vibes_soft_G3_v2_rr1_Main` | VCSL, CC0 | same | the notification dings (they sound D5, A5 and G4: VCSL labels use C3 = middle C) |
| `Idiophones/Struck Idiophones/Marimba/` `Marimba_hit_Outrigger_C4_med_01`, `_G4_med_01`, `_B4_med_01`, `_F3_med_01` | VCSL, CC0 | same | the success cues |
| `Membranophones/Struck Membranophones/Frame Drum/` `HDrumL_HitMuted_v3_rr1/rr2_Sum`, `HDrumS_HitMuted_v3_rr1/rr2_Sum` | VCSL, CC0 | same | Badger's tail thumps |
| Our synthesis (`scripts/audio/sfx/sfxlib/`: modal bodies, filtered noise, stick-slip friction, PolyBLEP oscillators) | our code | n/a | whooshes, pops, plops, swipes, keyboard, mouse, mug, chair, error, DEVELOPING, Rekt Meter, paws |

Not used: soundfont presets, stock SFX libraries, AI audio, and any dog vocal: Badger's voice will come from the owner's own recordings (CLAUDE.md).

## Music package (`scripts/audio/music/`, delivered to `public/audio/music/`)

Added 2026-11-24 by the composer. Every cue in the package uses only the allowed sources above; no new source was added. This table is the per-asset record, so a claim can be answered with the exact sample folders and presets. The render scripts, MIDI (`out/audio/music/<id>/<id>.mid`) and stems (`build.py --stems`) are the evidence of independent creation.

| Asset | Source (allowed above) | Where its licence text is | Used for |
| --- | --- | --- | --- |
| `Chordophones/Zithers/Grand Piano, Kawai` (Sustains, Releases) | VCSL, CC0 | `.cache/vcsl/LICENSE` | the motif, comping, arpeggios; a reversed chord as the "rewind" and "bloom" swells |
| `Idiophones/Struck Idiophones/Vibraphone` (Soft Mallets, Bowed) | VCSL, CC0 | same | motif doublings, replies; bowed sustains in the story beds |
| `Idiophones/Struck Idiophones/Marimba`, `Glockenspiel` | VCSL, CC0 | same | story-bed colour, sparkle |
| `Chordophones/Composite Chordophones/Concert Harp` (mf and f layers) | VCSL, CC0 | same | ostinatos, lifts, the Zoora sting shimmer |
| `Idiophones/Plucked Idiophones/Kalimba, Kenya` | VCSL, CC0 | same | the curious bed |
| `Membranophones/Struck Membranophones/Snare Drum, Modern 2` (hits, taps, cross-stick, rolls), `Snare Drum, Modern 3` (rimshot), `Tom 1`, `Tom 2` (stick), `Frame Drum`, `Bass Drum 2` | VCSL, CC0 | same | the kit, fills, heartbeat, cinematic hits |
| `Idiophones/Struck Idiophones/Hi-Hat Cymbal`, `Claps`, `Shaker, Small`, `Woodblock`, `Suspended Cymbal 1` (stick hits, roll, scrape), `Suspended Cymbal 2` (soft hits, bell, crescendo swells) | VCSL, CC0 | same | hats, claps, shakers, the clock, crashes and swells |
| MuseScore_General VSCO 2 strings: banks 20/21 violins, 30/31 violas, 40/41 celli, 50/51 basses; programs 44 tremolo, 45 pizzicato, 48 fast, 49 slow (21/31/41/51 are the CC2 "Expr." banks) | MuseScore_General 0.2.1, MIT; these samples are VSCO 2 CE, CC0 | `/usr/share/doc/musescore-general-soundfont/copyright`; per-preset credits in `MuseScore_General_HQ_Sample_Sources.csv` (from the .deb) | every string part |
| MuseScore_General bank 0 program 8 "Celesta" | MuseScore_General, MIT (sample credit not itemised in the CSV) | same | the motif in the curious bed and the Zoora sting |
| MuseScore_General bank 128 program 0 "Standard" kit, kick only | MuseScore_General, MIT | same | a quiet beater layer on the synth kick |
| Our synthesis (`composer/synths.py`): FM tine piano, analog pad, pulse, brass stab, sine sub, synth kick, plucked-string bass and muted guitar, noise and reverse swells | our code | n/a | colour, glue, bass, kick |

Not used: the two weakly credited MuseScore_General presets (Trumpet 0:56, Synth Bass 2 0:39), the GM bass presets 33/34, any GM lead, choir or brass. The intro stings ship as jingles for `src/branding` (ZooraSting, ShowSting) and carry the same licence as the rest of the package.
