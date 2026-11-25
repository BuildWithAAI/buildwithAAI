# Wave 3: sound, brand and growth tools

Integration record, 2026-11-25 (UTC; the evening of 2026-11-24 in America/Chicago). Branch `claude/youtube-video-pipeline-dcfqfr`.

Wave 3 gave both channels their sound and their brand, and added the tools around the videos:

- **Zoora AI** (POV stories) and **Zoodger News** (`zoora-security`, @ZoodgerNews: crypto and AI security news, home of *The Zoo & Badger Show*). The channel name was decided by the owner on 2026-11-24 (`content/zoora-security/channel-copy.md`); another workflow is applying the rename across the code, so some renders still show only the show logo.
- Zoo is the host (always "Zoo", never in capitals). His voice is Kokoro `im_nicola`. Badger is nonverbal; his real dog sounds will come from the owner's recordings.

**One fact first: nobody has heard any of this audio.** This environment has no audio output. Every audio judgement in Wave 3 comes from measurements, spectrograms, score audits and a phone-speaker model. The owner's ears are the missing check, and section 1 says where to start.

## 1. Start here: listen and look first

`out/` is gitignored, so these files exist only in this checkout. Section 4 has the commands that rebuild them.

**Listen** on headphones first, then on a phone speaker. Note the file and the timestamp of anything that sounds cheap or wrong.

| # | File | What it is | What to judge |
| --- | --- | --- | --- |
| 1 | `out/audio/integration/audio-demo.mp4` | 31.5 s: the show sting, two narration lines by Zoo, the ducked bed, a bumper, typing and UI sounds, the 5 s theme button. Mastered to -14 LUFS | Is Zoo clearly on top? Does the bed's duck feel smooth or pumping? Are the sting and bumper the right level next to the voice? Do the short breaths before the bumper (12.9 s) and the theme button (25.6 s) sound intended or like dropouts? |
| 2 | `out/audio/music/review/review-reel.m4a` (index: `review-reel.txt`) | All 27 music cues at equal loudness; beds as their first 30 s | Sample realism (finger-plucked bass, FM electric piano, brass stab, pizzicato), groove, the theme's quiet B section and its lift, Badger's figure in the theme and the red-flag bumper |
| 3 | `out/audio/music/review/under-voice/` (8 files; start with `bed-show-neutral-underscore.m4a`) | Each underscore bed and the end-screen bed under Zoo's narration, with the default band-split duck | Is the music too quiet, too busy or right under the voice? Does `bed-show-light` sound like stock "explainer" music? Is `bed-story-curious` too forward on the phone? |
| 4 | `out/wave3/show-sting-with-jingle.mp4` and `out/wave3/zoora-sting-with-jingle.mp4` | The two intro stings rendered with their jingles (first time end to end) | Do the hits feel locked to the picture? The Zoora jingle's final notes fade out over the last 0.3 s |
| 5 | `out/audio/sfx/audition/sfx_audition.m4a` (index: `cues.md`) | All 119 effects at their suggested gains, 3.5 min; rebuilt 2026-11-25 from the committed code | The keyboard, chair creak, mug and Badger's tail thump are synthesized: are they convincing? |

**Look:**

| # | File | What to judge |
| --- | --- | --- |
| 6 | `public/brand/zoora-security/avatar-800.png` with `out/wave3/security-avatar-neck-notch.png` | Defect found by the integration: off-white tabs stick out past Badger's neck outline under the collar (section 7.1) |
| 7 | `public/brand/zoora-ai/banner-2560x1440.png`, `public/brand/zoora-security/banner-2560x1440.png`, then `out/brand/qa/previews/*-banner-views.png` | The banners, and how they crop on TV, desktop, tablet and phone |
| 8 | `out/product/crypto-security-checklist-free.pdf` (2 pages), then `out/product/crypto-security-checklist-full.pdf` (23 pages) | The first product. Rebuilt 2026-11-25 from the current content |
| 9 | `public/brand/*/endscreen-1920x1080.png`, `public/brand/*/watermark-150.png`, `public/brand/zoora-security/badges/` | End screens, watermarks and the series badges |

## 2. What was built

| Component | Where | What it delivers | Commits |
| --- | --- | --- | --- |
| Audio engine | `scripts/audio/` (`audiolib`, `metrics.py`, `duck.py`, `setup.sh`); `docs/AUDIO.md` | Code-only synthesis and sampling (VCSL samples, two MIT soundfonts through FluidSynth), mixing and mastering to loudness targets, a quality meter (`metrics.py`: loudness, true peak, spectral balance, stereo, noise, hum, loop seams) and the band-split duck under narration (2 / 12 / 4 dB below 700 Hz / 700 Hz-5 kHz / above 5 kHz) | a4393f6, 2c646fc, c942dc7 |
| Music package | `scripts/audio/music/` → `public/audio/music/` (27 cues, one JSON per cue, `manifest.json`) | Zoo's five-note motif (D D A A♭ F) in every cue: the theme (68.4 s, 15 s, 5 s), two intro stings (show 4.0 s, Zoora 4.5 s), six segment bumpers (3.0-3.4 s), an end-screen bed and end-screen music (20 s), and 7 moods of 64 s seamless loop beds, each also as an "underscore" without the motif. Tempo-locked to whole frames at 30 fps; two critic rounds | 487ee40, 7825d35, 2cebaed, 46c0f4e |
| SFX library | `scripts/audio/sfx/` → `public/audio/sfx/` (119 WAVs, `manifest.json`) | 119 original effects in 28 groups: whooshes, UI pops and ticks, keyboard, desk, notifications, the DEVELOPING pulse, the Rekt Meter needle and alarm, Badger's paws and tail (no dog vocals). Every sync point on a 30 fps frame; suggested gains per role | aca9263, c64a933, 9cbfdff, 56a0c3b |
| Audio in Remotion | `src/audio/` (own entry point `src/audio/index.ts`) | `MusicBed` (the band-split duck applied per sample, the loop wrapped on the exact sample), `Sfx`, `Stinger`; the master step `src/audio/tools/master_mix.py` (-14 LUFS-I, true peak at most -1.5 dBTP); the `AudioDemo` mix check | 7225a8f |
| Branding kit | `src/branding/` (own entry point) → `public/brand/` (22 PNGs); `docs/BRANDING.md`; `content/*/channel-copy.md` | The Zoora jellyfish mark, the show logo, banners, avatars, watermarks, end screens, badges for 8 series in dark and light (16 PNGs), 4 s intro stings with a jingle hook, channel descriptions, keywords, playlists and two trailer scripts | 2455c88 |
| Visual QA | `scripts/qa/`, `src/qa/` | Renders sampled frames of any composition and reports text, safe-zone, face, contrast, off-model, banding and flicker defects with thumbnails | d02b2ff, c73f628 |
| Back-translation check | `scripts/backtranslate/` | A blind worksheet, an import that records who back-translated and how, and a comparison that flags meaning changes (numbers, negation, attribution, names, hedges) in the es and pt-br dubs | 2758cc1 |
| Topic finder | `scripts/topics/` | YouTube outlier research in our niches, turned into ranked original ideas in the weekly batch's backlog format. Live runs are blocked until YouTube approves the derived-metrics amendment | 770875e, f399cf1 |
| Product and sponsor kit | `content/products/crypto-security-checklist/`, `scripts/product/`, `docs/SPONSORS.md` | *The Crypto Security Checklist*: a free 2-page edition (19 checks) and a full 23-page edition (12 chapters, 3 printable templates, 50 cited sources), landing and Kit sign-up copy, and a sponsor media-kit generator | 5f7e796 (part), 6d401b4 |
| This integration | `docs/WAVE3.md`, `docs/FONT_LICENSES.md`, the fixes in section 3.3 | Cross-check, fixes, this record | see `git log -- docs/WAVE3.md` |

Delivered media in git: music 103 MB (12 WAV at 48 kHz/24-bit; the 15 long cues as 48 kHz/16-bit FLAC, because 24-bit copies would exceed the 10 MB per-file limit), SFX 27 MB (119 WAV, 48 kHz/24-bit stereo), branding 1 MB (22 PNG). The largest file is `theme-full.flac`, 7.8 MB.

## 3. What the integration checked

### 3.1 Tests and the typecheck, re-run

Every suite was run again from `projects/video-studio/`. All pass.

| Suite | Command | Result |
| --- | --- | --- |
| Audio engine | `.venv-audio/bin/python -m unittest discover -s scripts/audio/tests -t scripts/audio` | 93 OK |
| Music | `.venv-audio/bin/python -m unittest discover -s scripts/audio/music/tests -t scripts/audio/music` | 64 OK (before and after the edits in 3.3) |
| SFX | `.venv-audio/bin/python -m unittest discover -s scripts/audio/sfx/tests -t scripts/audio/sfx` | 46 OK (before and after) |
| Audio tools (Python) | `.venv-audio/bin/python -m unittest discover -s src/audio/tools/tests -t src/audio/tools` | 10 OK |
| Topic finder | `python3 -m unittest discover -s scripts/topics/tests -t scripts/topics` | 166 OK |
| Music manifest, SFX helper, audio components | `node --test scripts/audio/music/tests/manifest.test.ts scripts/audio/sfx/sfx.test.ts "src/audio/tests/*.test.ts"` | 6 + 12 + 84 pass |
| Branding | `node src/branding/tests/run.ts` | 34 pass on the committed code; 36 in the working tree, which also holds another workflow's uncommitted rename tests |
| Visual QA | `node --test "scripts/qa/tests/*.test.ts"`; `node scripts/qa/selftest.ts` | 77 pass; 16 of 16 fixtures, 31 of 31 planted defects caught, no unexpected finding (183 s, run on the committed code) |
| Back-translation | `node --test "scripts/backtranslate/tests/*.test.ts"` | 121 pass |
| Product | `node --test "scripts/product/tests/*.test.ts"` | 57 pass |
| Typecheck | `npx tsc --noEmit` | exit 0, no errors, whole project |

Add `--disable-warning=MODULE_TYPELESS_PACKAGE_JSON` after `node` to silence Node's module-type notice.

### 3.2 Measurements and looks

- **AudioDemo loudness, re-measured from the delivered MP4:** ffmpeg `ebur128` reads -14.1 LUFS integrated, true peak -1.8 dBFS, LRA 8.0 LU; `loudnorm` reads -14.16 LUFS and -1.77 dBTP; the engine's meter reads -14.1 LUFS, -1.8 dBTP, PSR 12.6 dB. This matches the claim (-14.04 LUFS, -1.77 dBTP). Video: H.264 High, yuv420p, BT.709, 1920x1080, 30 fps; audio AAC-LC 48 kHz stereo, 320 kb/s. The engine's music profile fails one check on it, `spectrum.mudDb` 6.11 (limit 3): the excess is in Zoo's voice (9.55 on the voice stem), not the music.
- **AudioDemo picture through the visual QA:** 22 contrast errors, all of them the read-along line's not-yet-spoken words in silver on the light background (1.29:1). The screen is an internal mix check labelled "not for publishing", so this is cosmetic. Nothing else was flagged. Report: `out/wave3/qa-audiodemo/report.md`.
- **The intro stings with their jingles,** rendered end to end for the first time (`out/wave3/`):
  - `ShowSting` with `intro-sting-show.wav`: 4.011 s, -16.0 LUFS-I, -2.1 dBTP after Remotion's AAC. The jingle's onsets land -8.0, -5.3, +1.3 and +2.7 ms from the visual beats at frames 4 (plate in), 30 (SHOW, the ampersand turns teal), 45 and 58 (Badger's look).
  - `ZooraSting` with `intro-sting-zoora.wav`: 4.501 s (the duration follows the jingle), -16.0 LUFS-I, -2.3 dBTP. The motif start, the logo hit and the wordmark note land -5.3, -5.3 and +13.3 ms from frames 18, 54 and 70. Every hit is inside half a frame (16.7 ms).
  - The bell shimmer at frame 6 is a swell, and the tag note at frame 78 is soft, so neither shows as a sharp onset; the composer reports the same.
- **SFX reproducibility:** a full rebuild from the committed code produced all 119 committed WAVs bit for bit, and a manifest identical to the committed one except its date. The rebuild also refreshed the audition reel, which predated two rounds of fixes.
- **Licences, audited against what actually sounds:** the MIDI of all 27 cues uses only instruments and kit pieces listed in `docs/AUDIO_LICENSES.md` (the tambourine and triangle are mapped in code but never played; the removed GM celesta plays nowhere). The SFX manifest's 36 sample uses come from 15 VCSL files (CC0, pinned commit) listed in the SFX table; the other 107 sources are our own synthesis. No SFX tag or description mentions a dog vocal. All six fonts are SIL OFL 1.1 and are now recorded in `docs/FONT_LICENSES.md`.
- **Delivery rules:** no committed file over 10 MB; no secrets in the Wave 3 paths (pattern scan); no Wave 3 composition registered in `src/Root.tsx` (each has its own entry point); the ART_GUIDE static scan finds nothing in `src/branding` or `src/audio` (the only hits in Wave 3 are the QA tool's own detectors and its planted-defect fixtures).
- **Branding stills looked at:** both banners, both avatars and the teal alternative, both end screens, the watermarks and the badges. They are clean and cohesive; the characters' anatomy and markings match the sheets (Zoo's pin and Badger's dark ear on the correct sides). One defect: the security avatar's neck (section 7.1).
- **Checklist PDFs** rebuilt from the current content (`out/product/` refreshed) and looked at: a contact sheet of all 23 full-edition pages, plus both free pages and full pages 1, 10 and 23 at full size. Lint 0 errors and 0 warnings; 2 and 23 pages; fonts embedded, no raster images; in the extracted text the host's name is never in capitals and there are no promises. The About page now gives Zoodger News (youtube.com/@ZoodgerNews) for corrections. It reads as a professional, well-sourced editorial product.

### 3.3 Fixes made by the integration

- **The host's name in capitals, in Wave 3 files.** The motif's syllable notation wrote its three stressed syllables in capitals, the host's name included; it now reads "Zoo and Bad-ger Show" in `scripts/audio/music/DIRECTION.md`, `scripts/audio/music/composer/motif.py`, `scripts/audio/music/composer/cues/show_cues.py`, `scripts/audio/sfx/sfxlib/families/notify.py` and the delivered `public/audio/sfx/manifest.json` (`ding_03`'s description). Comments and descriptions only: no audio changed, and the rebuilt manifest matches the edited one.
- **Stale duck description.** The SFX manifest and `sfxlib` still described the old broadband 6 dB duck; they now describe the band-split duck that is the engine's default (`sfxlib/manifest.py`, `sfxlib/core.py`, `public/audio/sfx/manifest.json`).
- **Jingle hook in `docs/BRANDING.md`.** Its example pointed at `audio/zoora-ai/sting.wav`, which never existed; it now gives the two working commands with the delivered jingles.
- **Font licences.** `docs/FONT_LICENSES.md` records all six fonts (pin, licence, copyright line, licence-text location, source, where each is loaded).

### 3.4 The capitalised host name across the repository

No Wave 3 file now writes the host's name in capitals, except where a rule or test names the banned spelling (the copy, product, QA and back-translation linters and their tests) and the back-translation proof records, which quote the engine-demo fixture verbatim. Outside Wave 3 the capitalised form still appears in more than 100 files owned by other workflows, mostly the character repair decision IDs (which put the name in capitals before `-P1`, `-P2` and so on) and comments in `src/characters`, `docs/ART_GUIDE.md`, `docs/CHARACTERS.md` and `src/episode`. One of them is on screen: the engine-demo lower third (`src/episode/dev/fixtures/engine-demo/storyboard*.json`, the name in capitals in en, es, pt-br, hi and zh), which the visual QA and the back-translation check both flagged. CLAUDE.md already lists that sweep as pending for the owning workflows.

## 4. Commands

Run from `projects/video-studio/`. Each tool's README has the full option list.

| Task | Command |
| --- | --- |
| Set up the audio engine (FluidSynth and soundfonts from Ubuntu packages, the venv, the VCSL clone; about 20 s once provisioned) | `scripts/audio/setup.sh` (VCSL takes about 9.6 GB in `.cache/vcsl`; `AUDIO_SKIP_VCSL=1` skips it, but then the pianos, mallets and drums are unavailable) |
| Measure any audio file against the targets | `python3 scripts/audio/metrics.py <file> --profile standalone\|bed\|sfx [--loop]` |
| Duck a bed under narration | `python3 scripts/audio/duck.py --bed <bed> --voice <narration.wav> --out <out.wav> --frames <gains.json>` |
| Rebuild the music (about 25 min without the stem cache) | `python3 scripts/audio/music/build.py` (one cue: `build.py <id> [--stems]`; `--list` shows the ids) |
| Music review reel and under-voice mixes | `python3 scripts/audio/music/review.py` |
| Rebuild the SFX (about 1 min) and the audition reel | `python3 scripts/audio/sfx/build.py --audition` (add `--export` to write `public/audio/sfx/`) |
| Prove SFX frame sync through Remotion | `python3 scripts/audio/sfx/sync_check.py` |
| The AudioDemo: voice, mix, master and 11 gated checks (2-3 min) | `src/audio/tools/demo.sh` |
| Master any delivery to -14 LUFS | `.venv-audio/bin/python src/audio/tools/master_mix.py --wav <render.wav> --video <render.mp4> --out <final.mp4> --wav-out <master.wav> --report <master.json>` |
| Branding renders and QA (115 checks) | `node src/branding/render.ts`; QA only: `node src/branding/qa/run.ts` |
| Stings with their jingles | `npx remotion render src/branding/index.ts ShowSting <out.mp4> --props='{"jingle":"audio/music/intro-sting-show.wav"}'`; `ZooraSting` with `audio/music/intro-sting-zoora.wav` |
| Visual QA on any composition | `node scripts/qa/check.ts --entry <entry> --comp <id> [--props '<json>']` |
| Back-translation | `node scripts/backtranslate/cli.ts prepare\|import\|compare zoora-ai/<slug> --lang es\|pt-br` |
| Topic finder (fixtures; live runs exit 3 until the amendment is recorded) | `python3 scripts/topics/topics.py find --fixtures --merge-preview`; `topics.py plan` |
| Checklist PDFs (about 30 s) | `node scripts/product/build.ts` (`--skip-spots` reuses the art) |
| Sponsor media kit | `node scripts/product/media-kit.ts --channel zoora-security` |

## 5. Owner inputs needed

Most important first.

1. **Listen and look** (section 1), then say what to change. Nothing else can stand in for this.
2. **Music level under Zoo.** With the default band-split duck, Zoo sits 14.5 LU over everything else while he speaks in the AudioDemo (14.0 LU in the weakest phrase). Two timings exist: the Remotion path (`src/audio`) releases the duck in 450 ms, the offline engine (`duck.py`) in 1.2 s; both hold the duck through pauses under 0.8 s. The critic measured the engine's earlier timing (0.5 s release, holding only through pauses under 0.35 s) letting the bed's mids bloom back 8-10 times a minute on real narration; the current engine timing brought that to 5-6. If the AudioDemo's bed sounds like it pumps, switch the Remotion path to 1.2 s.
3. **Theme loudness.** The theme cuts are mastered at -16 LUFS-I, 2 LU under YouTube's -14 reference, so the limiter stays gentle (at -15 it worked 4.8 dB). Approve -16, or ask for louder.
4. **Badger's real dog sounds** (huffs, grumbles, whines), recorded clean, as planned in CLAUDE.md. The red-flag bumper and the theme leave room for one after his figure. A short phone recording of his paws on a hard floor and his tail thumping would also beat the synthesized foley.
5. **Optional: your own keyboard,** a few dozen key strikes plus space and Enter in a quiet room, to replace the synthesized keys in the same frame-locked rhythm.
6. **Where the audio lives.** 130 MB of original music and SFX now sit in a public repository: anyone can download it, and it stays your copyright. Each re-export adds to the git history. If exclusivity or repo size matters, move it to Git LFS, release assets or private storage.
7. **Security avatar:** silver (default) or teal (`out/brand/alt/zoora-security-avatar-teal-800.png`), re-rendered once the neck defect is fixed.
8. **Topic finder:** a Google Cloud project used only by this tool, an API key restricted to the YouTube Data API (through the secure credential form, never a file), and YouTube's approval of the derived-metrics amendment (`scripts/topics/README.md`).
9. **Dubs:** native Spanish and Brazilian Portuguese reviewers for the glossary and the back-translation reports, and the Spanish number convention (1,500.5 or 1.500,5). Future back-translations should be done blind.
10. **The checklist:** a public corrections email, the URL and price where the full edition is sold, the refund and update policy, the copyright holder's legal name (now "Zoora AI"), and the Kit form and sequence (`content/products/crypto-security-checklist/kit-flow.md`).
11. **Sponsors:** prices, your audience export from YouTube Studio, and a lawyer's sign-off before the first paid deal (`docs/SPONSORS.md`).
12. **Trailers:** approve the two scripts in `content/*/channel-copy.md`; they can then be voiced and rendered.
13. **Optional:** upload one private test video to see YouTube's real AAC and Opus encodes of the theme (our checks used ffmpeg's encoder), and decide whether visual QA should gate the daily Short.

## 6. Honest quality assessment

**Built to a professional standard and verified here:**

- The audio plumbing. Loudness is exact (the AudioDemo delivers -14.0 LUFS, -1.8 dBTP), every sound lands on its planned sample, the bed's duck matches the engine's offline duck to the 16-bit noise floor, and the SFX rebuild bit for bit.
- The sync between picture and music. The stings' hits land within half a frame of the animation.
- The checklist PDFs. They read like a careful editorial product: consistent design, cited sources, no promises.
- The branding stills. They are clean and cohesive, and hold up at YouTube's display sizes.
- The tools (visual QA, back-translation, topic finder). Well tested, they refuse unsafe actions and stop for the owner where the rules require it.

**Not proven, and where it may fall short of broadcast quality:**

- **Nobody has listened.** Two rounds of an adversarial critic fixed real problems by measurement: a bass that masked Zoo's consonants, a kick that beat against the bass, instruments up to 17.5 cents out of tune, over-limiting on Badger's notes and a pumping duck. Measurement cannot judge feel, groove or realism. Expect the synthesized parts (the finger-plucked bass, FM electric piano, brass stab, Badger's cross-stick) and the synthesized foley (keyboard, chair, mug, tail) to be where an ear objects first.
- **Known residual audio issues, measured:**
  - The VSCO 2 pizzicato samples have upper partials 8-30 cents sharp, so Badger's octave-up double can read slightly sharp on a phone.
  - The Zoora jingle fades over its last 0.3 s instead of ringing out.
  - `bed-story-curious` plays about 3 dB more forward against Zoo on a phone than on headphones.
  - The bass is still the loudest element of `endscreen-music`.
  - `bumper-red-flag` meets its limiter limit (at most 3 dB of gain reduction) with only 0.01 dB to spare.
- **The music library is thin for daily use.** 7 moods, each as 2 versions of a 64 s loop, serve both channels. A 10-minute episode loops one bed about 9 times. YouTube's inauthentic-content guidance warns against one bed reused across many uploads. More arrangements per mood (or 128 s cycles) are the next composing job.
- **The dialogue in the AudioDemo runs about 2.5 LU hot.** 21 of its 31.5 s are music only, so reaching -14 LUFS lifts Zoo to about -11.5 LUFS while he speaks. A speech-led episode needs no such lift (simulated: +0.05 dB). Zoo's Kokoro voice also measures boxy (+9.6 dB at 200-500 Hz); it needs an EQ decision in the voice step after the owner listens.
- **The branding is good, not agency-grade.**
  - The character outlines on the banners are 2.1-2.8 px, under the house minimum of 3 px, because the shared rig fixes the line width.
  - The Zoora banner's characters are small.
  - The stings are restrained but simple.
  - The security avatar has the neck defect in section 7.1.
- **The tools are unproven on live data.** The topic finder has never called the real API. The back-translation proofs were not blind, and its rules were tuned on the same demos. 41 of the checklist's 50 sources were confirmed only through search-engine extracts (marked in the PDF).

**Verdict:** Wave 3 is complete, tested and integrated as infrastructure, a first full set of assets and a first product. It is not yet proven at broadcast quality, and it cannot be until the owner has listened on headphones and a phone, and the defects in section 7 are closed.

## 7. Remaining gaps

### 7.1 Defects found by the integration

- **Security avatar, Badger's neck** (`public/brand/zoora-security/avatar-800.png`, and the teal alternative): between the collar and the shoulders, an off-white fill sticks out past the body outline on both sides (right side about 12 x 45 px at x 555-568, y 605-650). It is inside the visible circle. A render of the avatar from the current committed rig shows the same tabs, so it is a rig problem at this scale, not a stale file. The current rig's mouth also differs from the committed avatar's. Owner of the fix: the Badger rig workflow (`src/characters`, round 5 in progress). Then re-render with `node src/branding/render.ts --only=avatar` and look again. Evidence: `out/wave3/security-avatar-neck-notch.png` (top: committed file; bottom: the current rig).
- **AudioDemo read-along contrast** (cosmetic): not-yet-spoken words at 1.29:1. Raise them to at least 3:1 if the demo is ever shown outside the team.

### 7.2 Integration seams still open

- **The episode and show templates do not play music or SFX yet.** `src/episode` and `src/show` render narration only. Their owners must add `MusicBed`, `Stinger` and the SFX calls exactly as documented (and typechecked) in `src/audio/README.md`, and finish every delivery with `master_mix.py`. Until then, no published video has the Wave 3 sound.
- **The end screens are silent.** `BrandEndScreen` has no audio prop. `endscreen-music.wav` (20 s, -18 LUFS-I, for silent end screens) and `endscreen-bed.wav` (-26 LUFS-S, under a voice-over) are ready to wire in.
- **The default sting renders are silent.** `node src/branding/render.ts` renders them without a jingle; use the commands in section 4.
- **Duck timing differs between paths** (450 ms release in `src/audio`, 1.2 s in the engine): see owner input 2.
- **The voice step's narration carries a DC offset that switches on with speech** (a 50 ms mean of about +0.17). The master step's 20 Hz high-pass removes it, but a render that skips the master keeps it. Owner of the fix: the voice step.
- **Remotion internals.** `PcmTrack` depends on Remotion internals; the version is pinned (4.0.541) and `src/audio/tests/internals.test.ts` must pass before any upgrade.
- **Engine conventions handled downstream.** The engine's VCSL sampler still reads VCSL's "C3 = middle C" file labels at face value, so the engine's own reference render plays the Kawai an octave high. The music and SFX packages correct for it separately. The engine's RMS compressor can return NaN on digital silence; the music package guards it. A follow-up should move both fixes into `audiolib`.

### 7.3 For other workflows (not edited here)

- **Engine demo:** the lower third writes the host's name in capitals and sits on Badger's face (`src/episode/dev/fixtures/engine-demo`). The es and pt-br storyboards have no thumbnail text, and the dub renders "bonding curve" as "launch curve" and "hype" as "promote".
- **Show** (visual QA, 2026-11-24): the ShowShort diagram note sits under the Shorts action buttons (0:18-0:30), and the ShowEpisode cold-open logo's "Show" line ends 11 px inside the bottom title-safe margin. Re-check after the show workflow's later fixes.
- **The sweep of the capitalised host name** in comments, decision IDs and docs in `src/characters`, `src/episode` and `docs/` (section 3.4).
- **The channel rename** (Zoodger News) is being applied by another workflow. The security banner draws only the show logo until `BannerShow.tsx` gains the channel name.

### 7.4 Housekeeping

- **Disk:** VCSL takes about 9.6 GB in `.cache/vcsl`. The music stem cache (`out/audio/music/_stem_cache`) grew to 4-7 GB in earlier builds and is 37 MB now; deleting it only makes rebuilds slower. Remotion renders leave `/tmp/remotion-webpack-bundle-*` folders of about 200 MB each (17 of them, 3.1 GB, at the time of writing), so clean out old ones that no running render uses. The disk is 68% used.
- **Scratch evidence** from this integration (the QA run on the AudioDemo, stings with jingles, the avatar crops, the re-measured AudioDemo metrics) is copied to `out/wave3/`.
