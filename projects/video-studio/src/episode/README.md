# Episode engine: scene templates, Episode and EpisodeShort

Renders a storyboard plus its voice timeline into a 1920×1080 episode and 1080×1920 Shorts, in any supported language. Binding rules: `docs/PROJECT_INSTRUCTIONS.md`, `docs/ART_GUIDE.md`, `docs/CHART_SPEC.md`. Contracts: `src/episode/types.ts`.

## Commands (run from `projects/video-studio/`)

| What | Command |
| --- | --- |
| Episode or Short, with sound (deliveries) | `src/episode/tools/render.sh <channel>/<slug> --lang <lang> [--short <id>] [--bundle <dir>] --out out/episodes/<slug>/<lang>/episode.mp4`: plan, picture + lossless mix, voice stem, 2-pass master, gate (`docs/EPISODE_ENGINE.md` §4, §12). Exit 0 delivered and passed, 1 gate or master failed, 2 bad input |
| A dub's audio track (`--fit-to` voice) | `src/episode/tools/render.sh <channel>/<slug> --lang es --audio-track [--bundle <dir>] --out <path>.m4a` |
| The sound plan and cue sheet only | `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON src/episode/dev/audioPlan.ts <channel>/<slug> --lang <lang> [--short <id>] [--out plan.json] [--cues cues.md] [--variant '<json>'] [--check plan.json]` (prints the plan's hash last; `--check` exit 1 when the files on disk now give another plan) |
| The gate on a render | `.venv-audio/bin/python src/episode/tools/audio_check.py --plan P.json --mix M.wav --voice V.wav [--picture X.mp4] [--delivered D.mp4 --master D.master.json] --report R.json` (exit 0 pass, 1 fail, 2 bad input) |
| Offline mixes from a plan (calibration, A/B clips) | `.venv-audio/bin/python src/episode/tools/audio_sim.py --plan P.json [--duck-from Q.json] [--master --wav-out x.wav] [--json out.json]` |
| The story beds' level table | `.venv-audio/bin/python src/episode/tools/bed_levels.py [--check]` (re-run after the composer re-renders a story bed) |
| Episode, picture and plain mix (no master, no gate) | `npx remotion render src/episode/index.ts Episode out/episodes/<slug>/<lang>/episode.mp4 --props='{"channel":"zoora-ai","slug":"<slug>","lang":"en"}'` |
| Short, the same | `npx remotion render src/episode/index.ts EpisodeShort out/episodes/<slug>/<lang>/<shortId>.mp4 --props='{"channel":"zoora-ai","slug":"<slug>","lang":"en","shortId":"<id>"}'` |
| One frame | `npx remotion still src/episode/index.ts Episode out/x.png --frame=120 --props=...` |
| Tests | `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON src/episode/tests/run.ts` (engine and sound) and `.venv-audio/bin/python -m unittest discover -s src/episode/tools/tests -t src/episode/tools` (the gate: its gain-law port against the TypeScript, the null test's sensitivity) |
| Frames worth inspecting | `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON src/episode/dev/sampleFrames.ts <storyboard.json> [landscape\|vertical] [--props out.json]` |
| Typecheck | `npx tsc --noEmit` |

- Claim gate first: `node scripts/claims/check.ts content/<channel>/<slug> [--lang <lang>]` (exit 0) before the voice step and every render. Node tools check its report with `claimGateProblems()` (`src/episode/node/claimGate.ts`: the report exists, passed, names this episode and language, and is newer than the storyboard, the source storyboard and `research.md`); `scripts/thumbnails.ts` refuses to render without it. The Remotion bundle itself cannot read `out/` (a webpack context on a missing directory breaks the bundle), so `calculateMetadata` enforces what it can see: a spoken offer disclosure, verified https sources with an accessed date on real channels, and a timeline whose words are the storyboard's narration (an edit after the voice step fails the render).
- Voice first: `python scripts/voice/build.py content/<channel>/<slug> --lang <lang> --voice im_nicola` writes `public/generated/<channel>/<slug>/<lang>/timeline.json` and `narration.wav`. Without a timeline the render stops with that instruction.
- Bundle once to render many stills quickly: `npx remotion bundle src/episode/index.ts --out-dir=<dir>`, then pass `<dir>` instead of `src/episode/index.ts`.
- The default props render the dev fixture `src/episode/dev/fixtures/engine-demo` (channel `_dev`). Only `_dev` falls back to a **mock timeline** when no voice output exists; the result is silent and carries a SILENT PREVIEW badge.

## Props

`{channel, slug, lang, shortId?, captions?, timelineOverride?, audioStems?, audioPlanHash?}`

- `lang`: `en | es | pt-br | hi | it | zh | ja`. French is rejected (Kokoro has no male French voice).
- `captions`: burned-in captions. Default **off** for `Episode` (YouTube carries subtitles; PROJECT_INSTRUCTIONS: captions only when requested), **on** for `EpisodeShort`.
- `shortId`: which `storyboard.shorts[]` entry; default the first.
- `timelineOverride`: a `Timeline` object used instead of `timeline.json` (tests, mock renders).
- `audioStems` (measurement renders only): play only these of `voice`, `music` (the beds and the sting) and `sfx`, with a blank picture and no fonts (render.sh's voice stem is `["voice"]`).
- `audioPlanHash`: the hash the audio-plan CLI printed; the render stops before frame 0 when its own plan hashes differently (render.sh passes it; the gate then rebuilds the music from the same plan).

`calculateMetadata` loads `content/<channel>/<slug>/storyboard.json` (en) or `storyboard.<lang>.json`, then the timeline, validates both (every error is listed before frame 0), plans the charts, and sets the duration from `timeline.totalMs` (Short: the sum of its scenes).

## Timing, audio and transitions

- Every scene is a `<Sequence>` at its own audio frame (`startMs`). A `transitionIn` (`fade` 12 f, `slide` / `wipe` 18 f) **overlaps visuals only and is voice-free** (`timing.ts`; Zoo is never heard in it, and since 2026-11-25 the music bed plays on through it): it starts after the outgoing scene's last voiced frame (+2 f for the sound's decay) and ends by the incoming scene's first voiced frame. It first uses the outgoing scene's silent tail: the incoming scene's visuals start `preroll` frames before its audio frame, held on its own frame 0 (`<Freeze>`); whatever is left runs in the incoming scene's leading silence over a `tail` of the outgoing scene. Less silence than 8 f (fade) or 12 f (slide, wipe): a hard cut. Total length and lip-sync are identical to hard cuts.
- Curves (`transitionProgress`): fade = sine in-out; slide and wipe = a critically damped curve normalised to reach rest exactly at the end (no snap). A **slide** is a short push (12% of the width) under a fade, so its fastest frames are almost transparent; a **wipe**'s edge carries 180°/16-sample motion blur drawn as non-overlapping strips (`wipeStrips`). Stacking translucent full-frame copies for blur is avoided on purpose: in this headless Chrome 16 copies of `#E6E8EB` over itself came out 5 levels darker.
- A scene with no `transitionIn` enters on a hard cut, except where that cut would be a landscape **jump cut** (ZOO on the same side, nearly the same size, moved under 300 px: `layout/faces.ts isJumpCut`), which gets a short fade. An explicit `transitionIn` always wins.
- Episode: **one** `<Audio>` plays `timeline.narration` (default `generated/<channel>/<slug>/<lang>/narration.wav`).
- Short: its scenes only, retimed from frame 0; each plays its own window of the same `narration.wav` (`trimBefore` = the scene's frame in the full episode).
- Music, the brand sting and the effects come from the **sound plan** (`audio/plan.ts`, below), computed in `calculateMetadata` (`ResolvedEpisode.audio`) and played by `audio/EpisodeAudio.tsx` through `src/audio`'s `MusicBed`, `Stinger` and `SfxPlay`. Since 2026-11-25 a transition is **voice-free**, not silent: the bed plays through it (bed changes themselves happen only in those voice-free windows).
- ZOO's mouth is `timeline.mouth[frame]` of the scene; outside the track it is `closed`.

## Scene templates and their `onScreen` keys

All on-screen copy comes from `onScreen` in the storyboard's language. Text boxes shrink to a floor, then wrap; a list shares one size and shrinks as a block; anything that still does not fit **fails the render** and names the text (nothing is clipped silently).

| `type` | Required | Optional | Notes |
| --- | --- | --- | --- |
| `hook` | `title` | `kicker`, `subtitle` | Display title (Anton; Montserrat 900 for hi/zh/ja). ZOO reacts after the title lands: a brow lift, or a swap to `zoo.expression` on a blink. |
| `talk` | | `title`, `bullets` (≤ 4), `cues`, `lowerThird` | Bullets appear on their word timings: `cues[i]` is the word that reveals bullet i (default: its first 4+ letter word). ZOO points at the first (and last of 3+) bullet in landscape; the newest bullet is the dark card. |
| `chart` | `chart`, `pair` for seeded data | `cues` (`[pumpWord, rugWord]`), `label` | `CandlestickChart` (src/charts). Seeded data is synthetic and must be `illustrative: true`. The rug completes on (or just before) `cues[1]`; ZOO points as the pump completes, then turns to camera for the deadpan beat. |
| `steps` | `steps` (1–5) | `title`, `cues` | Numbered steps revealed on their words; ZOO glances at each. |
| `quote` | `quote`, `attribution`, and `source` or a `[src:id]` | | Kinetic: each word appears as ZOO says it (spread evenly if the narration does not read it). |
| `cta` | | `title`, `button`, `cues`, `disclosure` | Subscribe by default (`ui.subscribe`). With `storyboard.offers`, `disclosure` is **required**, shown for the whole scene, and must also be **said** in the narration (validated). |
| `endscreen` | | `title` (outro line) | Must be the last scene and hold 20 s (`minDurationSec: 20`). Two empty 16:9 zones and one circle are laid out for YouTube's end-screen elements. In a Short it is a plain outro card. |

Any scene: `zoo: {present, expression, pose, view}`, `badger: {present, reaction}`, `transitionIn`, `showSources`, `onScreen.badgerCue` (the word for Badger's reaction).

## Performance

- ZOO: seeded natural blinks every 2–6 s; extra blinks in phrase-end pauses (≥ 11 f) and on every expression/view swap (the swap lands on the closed frame); 1–2° head accents on stressed words (`TimelineWord.stressMs` from the voice step, else estimated), about half of the phrases; point gestures (front view only) with eyes leading, wind-up and a 12 f swing; 2-frame eye darts.
- Badger: one reaction per scene (`judge`, `lookUp`, `happy`, `worried`, `shocked`, `neutral`) at the reaction beat (about 12 f after the last word, or after the rug, or `badgerCue`); swaps hidden in blinks. The validator requires Badger in at least one scene per episode.
- Shorts: Badger's head sits at half ZOO's height, so a shared frame would put his face in the caption band. He reacts in an **insert shot** (a hard cut to Badger alone) instead. The insert never covers a scene's key beats (`direction.ts` `beats`, `placeInsert`): the chart's rug candle forming and holding (`[rugDone - RUG, rugDone + HOLD)`), ZOO's turn to camera after it (kept clear whenever a readable insert still fits), the CTA button press (`[press - 6, press + 12)`), bullet and step reveals, the quote building, the hook title landing. It lasts about 1.5 s (45 f), then cuts back to the main shot for at least 1 s, or holds to the scene's end when less than 1 s would be left; with less than 24 f after the beats there is no insert. Badger reacts 10 f after the cut.

## Localization

- Captions (`captions/pages.ts`): pages of 2-4 words chosen by phrase, not filled greedily: no one-word page (unless the sentence is one word), no page ending on a word that leans on the next one (`text/phrasing.ts`: articles, prepositions, conjunctions, auxiliaries, "never"... in en, es, pt-br, it; Hindi postpositions never start a page), breaks preferred at pauses and commas. Two-line pages are balanced and never end a line on such a word. Every page is clipped to the end of its scene.
- Fonts: brand Inter / Montserrat / Anton; `hi` adds Noto Sans Devanagari, `zh` Noto Sans SC, `ja` Noto Sans JP (bundled from `@fontsource`, OFL). The brand family comes first, so Latin text keeps the brand look. Rendering waits until every face is loaded.
- Accented capitals in the hook's display title (2026-11-24, final check): Anton at line-height 1.02 has no room for an accent on a capital, so the es demo's "PRIMER DÍA" lost the top of its accent to the line's reveal mask (`scripts/qa`: text-clipped, 16%). A title line with a mark above a letter now gets 0.12 em more room above it (`layout/blocks.ts` `titleLineTops`, used for the block height too), and each line's mask (`RiseClip` `headroom`) opens 0.35 em above the line. Other templates' wipe reveals still clip at their box top; run `scripts/qa` on dubbed renders.
- Devanagari and CJK get extra line height; CJK breaks between dictionary words (`Intl.Segmenter`) with kinsoku rules; the danda ends sentences. Where the dictionary splits a compound ("顶级"), mark the only allowed break points of that string with zero-width spaces (U+200B): `"你成了\u200B顶级喊单人"`.
- UI labels (not scene copy) come from `storyboard.ui`; English has defaults. A non-English storyboard must carry every label its render shows, or validation fails: `fictionDisclaimer` (fiction), `sources`, `illustrative` (charts), `subscribe` (CTA without `button`), `watchNext` and `subscribeSlot` (end screen).
- A storyboard whose `lang` differs from `sourceLang` renders with a **MACHINE TRANSLATION · needs native review** badge until `translation.status` is `native-reviewed`.
- Known limit: the chart's own header, footer and callout text (src/charts, read-only here) are English; non-English renders add the localized illustrative chip under the panel.

## Sound (2026-11-25)

The whole design, the gate and the owner's listening steps: `docs/EPISODE_ENGINE.md` §12. In short:

- `audio/plan.ts` `planEpisodeAudio(input)` is pure: storyboard + timeline (+ the master's for a dub) + the music and SFX manifests + `audio/bedLevels.json` → `EpisodeAudioPlan` (plain JSON, SHA-256 `hash` over its canonical form, `audio/hash.ts`). The render (`load.ts`), the CLI (`dev/audioPlan.ts`, inputs from disk via `node/audioInputs.ts`) and the tests all call it.
- Moods by act (`scene.bed` from here on; regions of 8+ bars, one change a minute at most), every bed trimmed to the same loudness under the voice (`BED_UNDER_VOICE`), one musical clock offset by a 4-bar phrase, bed changes only in the voice-free window between scenes (equal-power, or staggered when the bars clash: `audio/moods.ts` `HARMONY`), a 2/12/4 dB band-split duck held through short pauses, scene changes and Badger's reaction beats, rests after 2 loops, the end screen's music-up on a bar line, sparing effects in the gaps of the speech, an opt-in brand sting. Every number is in `audio/constants.ts`.
- `audio/cueSheet.ts` writes the owner's cue sheet (every change with its timecode, the breaths to judge, the effects placed and left out).
- `tools/render.sh` runs the 2-pass delivery; `tools/audio_check.py` is the gate (the null test rebuilds the music, stingers and effects from the plan with a Python port of the gain law, proved against the plan's `gainProbe` first); `tools/audio_sim.py` mixes offline from a plan.
- The Studio preview plays the beds through a per-frame broadband approximation (`PcmPreview`): judge renders only.

## Contract additions (types.ts; all optional)

| Field | Meaning |
| --- | --- |
| `StoryboardScene.bed` | 2026-11-25. The music from this scene on: `curious`, `tension`, `ominous`, `resolve` or `none`; read from the master storyboard for every language. End screen: only `none`. |
| `StoryboardScene.sfx` | 2026-11-25. `{transition?, items?, accent?}`: a wipe's whoosh (default on; a slide's only when true), list pops in speech gaps (default on), the CTA click (default on) and the chart rug's tick (default off). |
| `Storyboard.shorts[].bed` | 2026-11-25. One bed for the whole Short (default: the mood of its first scene). |
| `Storyboard.music` | 2026-11-25. `{offset?: 0-4, sting?: 'after-hook', stingTagline?}`: the clock's phrase, the opt-in brand sting, the sting card's tagline in this file's language. |
| `StoryboardScene.showSources` | Show the sources card for this scene's `[src:id]` claims. Default: on when the narration cites a source, except quotes. |
| `Storyboard.ui` (`UiLabels`) | Localized UI labels (see above). |
| `Storyboard.translation` | `{status: 'machine' \| 'native-reviewed', reviewer?, date?}` of this file. |
| `TimelineWord.stressMs` | Onset of the word's primary-stress vowel; drives head accents. |
| `Timeline.mock` | true for `dev/mockTimeline.ts` output: silent, badged, never called lip-synced. |

The engine also reads the voice step's `Timeline.narration` (recorded in `scripts/voice/timeline-additions.ts`).

Internal interfaces added 2026-11-24 (review fixes; not contract fields): `SceneSpan.preroll`; `ChartPlan.rugFrames` / `rugHold`; `Direction.beats` and the `Beat` type; `TextSpec.phrase` / `FitSpec.phrase`; `SHORTS_BUTTONS`, `LOWER_THIRD_X` / `lowerThirdX`, `LOWER_THIRD_PAD` (specs.ts); `zooPlacement`, `isJumpCut` (faces.ts); `defaultTransition`, `silentEdges`, `transitionProgress`, `wipeStrips`, `SLIDE_PUSH` (timing.ts); `captionTrack` moved to `captions/pages.ts` (re-exported by `Captions.tsx`); `useLowerThird` (Overlays.tsx); `claimGateProblems` (node/claimGate.ts). Final check (2026-11-24): `RiseClip` `headroom`; `hasMarkAbove`, `ACCENT_GAP_EM`, `TITLE_HEADROOM_EM`, `titleLineTops` (layout/blocks.ts); `sourceSpans`, `sourceSpanAt`, `SourceCue`, `SourceSpan`, `SOURCE_LEAD`, `SOURCE_MIN_HOLD`, `SOURCE_AFTER_CLAIM`, `SOURCE_PAD_X`, `sourcesFitWidth`, `sourcesCardBox` (scenes/sources.ts).

## Layout notes (2026-11-24 review)

- Shorts: no text box reaches under the action-button column (x > 950 below y 960; `SHORTS_BUTTONS`, tested). The vertical chart panel ends at x 930 (its "Illustrative · fictional token" footer ends near x 894) and the localized chip sits above it, left-aligned.
- Landscape sources lines sit in the text column, a head-width clear of ZOO (talk: x 1010; CTA: x 1120; steps: x 96).
- Sources line timing (`scenes/sources.ts`, final check 2026-11-24): the line wipes in 6 f before the cited sentence and stays at least 4 s, or until 3 s after the claim. A later claim citing the source already on screen extends that line; a claim citing a different source swaps the text in place (no blank frame, no second wipe). Before the fix the demo's s02, which cites one study in three sentences, blanked the line for one frame and wiped it in again at each sentence (`scripts/qa`: one-frame-state at f 281 and f 455 of the es Episode).
- Sources line geometry (`scenes/sources.ts`, final check 2026-11-24): the card, padding included, stays inside the safe area. Its text is fitted to at most the safe width less the card's 2 x 16 px padding (only the full-width vertical box narrows, 972 -> 940 px), and a card that would cross a safe edge slides back inside. The landscape talk and CTA boxes end at the safe edge (x 1824), so a long line now slides left by up to 32 px and ends flush with the review badge; before, the padding pushed it past the edge (pt-br demo s02: the text 9 px into the margin, `scripts/qa` safe-area; es: the card 16 px). Lines that fit do not move.
- The lower third starts right of ZOO's hanging hand in talk and CTA (x 680); a plate that reaches into the text column keeps the text block above it.
- Quote uses the same ZOO and Badger placement as steps, so a steps -> quote cut does not jump; with Badger in the shot the quote card narrows to clear his head.
- Character line weights follow ART_GUIDE SL5 at every placement scale (`lineScaleFor`).

## Files

`compositions.tsx` (Episode, EpisodeShort) · `Episode.tsx` (fonts gate, sequences, transitions, narration, sound, sting, captions, badges; `StemsOnly` for measurement renders) · `load.ts` (storyboard registry, timeline, chart planning, the sound plan and its hash check) · `validate.ts` · `timing.ts` · `cues.ts` · `markup.ts` (port of the voice step's markup) · `scenes/` (seven templates, overlays, sources line timing and geometry, insert, direction and `sceneCast`) · `perf/` (ZOO, Badger) · `layout/` (specs, block geometry, faces) · `text/` (fit, measure, FitText, phrasing) · `captions/` · `i18n/` (fonts, UI labels) · `chart/plan.ts` · `audio/` (`constants.ts`, `moods.ts`, `levels.ts` + `bedLevels.json`, `plan.ts`, `hash.ts`, `cueSheet.ts`, `EpisodeAudio.tsx`) · `node/claimGate.ts`, `node/audioInputs.ts` (Node tools only) · `dev/` (mock timeline, fixtures, sample frames, `audioPlan.ts`) · `tools/` (`render.sh`, `audio_check.py`, `audio_sim.py`, `bed_levels.py`) · `tests/` (`engine.test.ts`, `fit.test.ts`, `review.test.ts`, `audio.test.ts`).

Internal interfaces added 2026-11-25 (sound; not contract fields): `sceneCast` (scenes/direction.ts: the cast every template passes to `useDirection`, so the planner sees the same reaction beats the scenes draw); `SpanOptions.forceCut` and `episodeSpans`'s options argument (timing.ts: the scene after the sting cuts); `ResolvedEpisode.audio`, `EpisodeProps.audioStems` / `audioPlanHash`, `chartPlans` (load.ts); `EN_STING_TAGLINE` (i18n/ui.ts); `ReviewBadges` `previewAudio` (scenes/Overlays.tsx).
