# The Zoo & Badger Show (Remotion format, channel 2 `zoora-security`)

A flat 2D talk-show / podcast set for Zoodger News (crypto + AI security): Zoo hosts at the desk with a podcast mic,
Badger (nonverbal) sits beside him on his own chair, and his reactions land after Zoo's lines as the punchlines.
Binding rules: `docs/PROJECT_INSTRUCTIONS.md`, `docs/ART_GUIDE.md`, CLAUDE.md "Channel 2". Built 2026-11-24.

Entry point: `src/show/index.ts` (not `src/Root.tsx`, not `src/episode/Root.tsx`). Compositions:

| Id | Size | What |
| --- | --- | --- |
| `ShowEpisode` | 1920x1080 | the weekly round-up (every scene of the storyboard) |
| `ShowShort` | 1080x1920 | a daily Short (the scenes in `storyboard.shorts[shortId]`, 45-60 s), burned-in captions |

## Commands (run from `projects/video-studio/`)

| What | Command |
| --- | --- |
| Voice (Zoo = im_nicola, binding) | `python3 scripts/voice/build.py content/zoora-security/<slug> --lang en --voice im_nicola` |
| Short | `npx remotion render src/show/index.ts ShowShort out/show/<slug>/en/short1.mp4 --props='{"channel":"zoora-security","slug":"<slug>","lang":"en","shortId":"short1"}'` |
| Episode | `npx remotion render src/show/index.ts ShowEpisode out/show/<slug>/en/episode.mp4 --props='{"channel":"zoora-security","slug":"<slug>","lang":"en"}'` |
| One frame | `npx remotion still src/show/index.ts ShowShort out/x.png --frame=300 --props=...` |
| Tests | `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON src/show/tests/run.ts` |
| Frames worth inspecting | `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON src/show/dev/sampleFrames.ts <storyboard.json> landscape\|vertical` |
| Contact sheet | `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON src/show/dev/contactSheet.ts --format vertical [--slug <slug> --channel zoora-security] [--out <dir>]` |
| Set probe (every camera, neutral cast) | `npx remotion still src/show/dev/probeIndex.ts ShowProbe out/p.png --props='{"format":"landscape","shot":"wide"}'` |

The defaults render the dev fixture `src/show/dev/fixtures/zoo-badger-demo` (channel `_dev`, fictional example
outlets, badged **DEV FIXTURE · not real news**). To voice it, the voice step needs the `<channel>/<slug>` folder
layout: copy `storyboard.json` to `<dir>/_dev/zoo-badger-demo/` and run `python3 scripts/voice/build.py
<dir>/_dev/zoo-badger-demo --lang en --voice im_nicola`; renders then use that timeline and its audio. Only `_dev` may fall back to the mock timeline (silent, badged
**SILENT PREVIEW**, never called lip-synced). A real channel render without `timeline.json` stops with the voice
command to run.

## Props

`{channel, slug, lang, shortId?, captions?, channelName?, timelineOverride?}`

- `channel`: `zoora-security` (or `_dev`). Other channels are refused: this format is for the security channel.
- `captions`: burned-in captions; default on for `ShowShort`, off for `ShowEpisode` (YouTube carries subtitles).
- `channelName`: the channel's name, "Zoodger News", on one line under the show logo (Montserrat 800, slate, 36 x logo
  scale). If omitted, zoora-security gets the channel's name; `null` hides it (the _dev default). It is a proper name
  and never translated.

## Storyboard contract (a news storyboard plus optional show fields)

A show storyboard is the episode `Storyboard` (`src/episode/types.ts`) that the voice step, the claim gate
(`scripts/news`), dubbing and the publish kit already read. The show adds only OPTIONAL fields (typed in `types.ts`):

| Field | Meaning |
| --- | --- |
| `scene.segment` | which segment renders the scene. Default from `type`: hook -> `coldOpen`, endscreen -> `outroEndScreen`, others -> `desk`. `chart` is refused (no price talk). |
| `scene.rekt` | `{usd, source, alt?: {usd, source}}`: the reported loss and the source id that reports it |
| `scene.diagram` | `{nodes: DiagramKind[]}`: the icon of each HowItWorked node |
| `scene.badgerBeats` | `[{reaction, after?, hold?}]`: Badger's reactions after Zoo's lines |
| `source.publisher`, `source.publishedAt` | outlet name and date for the Sources card (else the gate's host table / `accessed`) |
| `news.developing` | the claim gate's `DevelopingLabel`: draws the persistent **DEVELOPING** badge (with "as of") on every frame |
| `showUi` | localized show labels; English defaults in `ui.ts`; any other language must carry every label it shows |

All on-screen copy is in `onScreen` (so the claim gate checks it against the stored excerpts):

| Segment | Required | Optional | Screen |
| --- | --- | --- | --- |
| `coldOpen` | | `kicker` | wide two-shot, ON AIR lights; Zoo's dry one-liner; Badger's slow blink after it. In a Short the kicker slate sits above the ON AIR sign and the wall logo, all three clear of each other at rest and pushed in (`layout/checks.ts`) |
| `headline` | `title` | `developing`, `loss` (+ `rekt`), `lossAlt` (+ `rekt.alt`) | incident card + **Rekt Meter**: log dial $100K-$10B, the figure as reported, "reported by <outlet>"; a different second report is shown beside it, never averaged. With no reported loss (no `rekt`, most AI-security stories) the card is the title alone, with no meter and no "Rekt Meter" tag: never $0 or a guess |
| `howItWorked` | `nodes[]` (+ `diagram.nodes`) | `links[]`, `cues[]`, `title` | concept diagram (wallet, contract, bridge, mixer, key, site, message, approval, agent, plugin, phone, exchange, funds, attacker = an unknown address, never a person); nodes land on the words that name them; Zoo points at it (landscape) |
| `badgerRedFlag` | `flag` | `title` | Badger's close-up; he judges as the card lands |
| `zooOneFix` | `fix` | `detail`, `title` | one actionable tip; Zoo gestures to it |
| `scamOfTheWeek` | `title` | `how`, `tell`, `fix` | the week's scam pattern as a case file |
| `correction` | `correct`, `date` | `wrong`, `ref` | the pinned correction card: what we said (struck through) and what is correct |
| `sources` | | `title` | every cited outlet with its date and title (paged if long) |
| `outroEndScreen` | `explainer` | `title` | landscape: end-screen guide zones (explainer slot, latest slot, subscribe circle); Short: "Explainer: ... Linked below". The card is at its final layout from the cut (no slide-in across the header row). Must be the last scene; hold it 5-20 s (`minDurationSec`) for YouTube's end screen |
| `beat` | | | the punchline's reaction shot (see below) |
| `desk` | | `title`, `bullets[]`, `steps[]`, `quote`, `attribution` | plain desk talk; any news storyboard renders |

### Comic timing (Badger's beats)

- The show never inserts time: every scene is exactly its timeline window, so chapters, subtitles and multi-track
  dubs stay in sync with the publish kit and the voice step.
- **Punchlines** are authored as a silent `beat` scene: `{"segment": "beat", "narration": "", "minDurationSec": 1.2-1.5,
  "badgerBeats": [{"reaction": "judge"}]}`. The voice step makes it real, silent timeline time; the show hard-cuts to
  Badger's close-up and he reacts 6 frames after the cut.
- **In-scene reactions** (`badgerBeats` with `after`: `'end'`, a line index, or a cue word) start 8 frames after
  Zoo's line ends, in whatever shot holds Badger. `badger.reaction` maps the episode enum (worried -> earsBack,
  neutral -> slowBlink). `badger.present: false` switches Badger's reactions off for a scene.
- Reactions: `judge`, `lookUp` (3/4 head to Zoo), `earsBack`, `slowBlink`, `happy`, `shocked`. Restrained, adult,
  dry: one action, a hold, a release. Expression and head swaps land on a fully closed blink (ART_GUIDE CH5). Two
  beats closer than 40 frames keep the authored one.
- A default or `badger.reaction` beat that would be on screen for less than 20 frames (0.7 s) before a cut to a shot
  without Badger cannot be seen, so it is dropped. Scene tails are short (the voice step pads 350 ms): a reaction to a
  scene's last line belongs in a `beat` scene.

### Performance

- Zoo's mouth is the timeline's per-frame mouth track (the voice step's visemes; 1-frame lead, LP3), through the
  episode engine's scheduler (`src/episode/perf/zoo.ts`): seeded blinks, head accents on stressed words, 2-frame eye
  darts to graphics and to Badger, point gestures toward a right-hand graphic. No Zoo blink inside a Badger beat (MO17).
  His expression changes only on cuts.
- One performance plan per render (`perf/plan.ts`), in composition frames, so blinks and reactions run on through cuts.

## The set and cameras

`layout/stage.ts` (stage units = the characters' world units; Zoo and Badger always share one scale, so their
relative size is the approved size panel's) and `layout/shots.ts` (cameras; outline 3-6 px including push-ins):

- Landscape: `wide`, `zooR` (graphics left), `zooL` (graphics right; Zoo points at them), `badgerR`, `badgerC`
  (beats), `wideL` (outro), `none` (full-frame graphic).
- Vertical: `two`, `zoo`, `badger`, `none`. Graphics above the heads, captions over the desk, nothing but the desk in
  the Shorts UI (bottom 20%), faces left of the action buttons.
- Set dressing: silver chair for Zoo (light behind his dark clothes, CV4b), Badger's taller grey chair (the darker
  shape behind his white head, CV4a), slate desk with the branding kit's show logo (`src/branding/marks/Lockups.tsx`
  via `set/LogoPlate.tsx`), name plates (landscape), podcast mics, ON AIR sign (teal lamp), flat acoustic panels.
- Header row (segment tag + DEVELOPING badge) sits on the graphics side, one head width clear of Zoo's face (CV4c).
  `layout/checks.ts` encodes these rules; the tests run them over every shot and segment.

## What the renderer refuses (`validate.ts`; the claim gate remains the full fact check)

Fiction; unknown or unverified cited sources; a Rekt Meter figure that disagrees with its display text (5%) or has
no source; a second report from the same outlet; diagrams outside 2-5 nodes or with code, addresses, links or
numbered steps (also any other on-screen code or address); missing segment copy; the outro anywhere but last; a
silent beat shorter than 0.8 s; a dubbed storyboard missing a UI label it shows; a timeline that does not match the
storyboard, is mock outside `_dev`, or is not voiced with im_nicola.

## Proof renders (2026-11-24, dev fixture voiced with Kokoro im_nicola)

- `ShowShort` (short1): 51.3 s, H.264 High, yuv420p, BT.709 tv range, 1080x1920, 30 fps, AAC 48 kHz stereo,
  -14.3 LUFS integrated, -4.2 dBFS peak; rendered in 1 min 45 s. Frames checked from the encoded file.
- Contact sheets of every segment in both formats: `src/show/dev/contactSheet.ts`.

## Decisions and known gaps

- **Red flag in near-black, not red:** ART_GUIDE CV5 reserves red/green for price direction. One line in
  `graphics/glyphs.tsx` switches the flag to the chart red if the owner wants it.
- **"ON AIR"** is set dressing and stays English in dubs; everything else on screen is localized.
- **Contract additions** live in `src/show/types.ts` (the episode types belong to another workflow). The claim gate's
  R2 warning "news.developing is not drawn" does not apply to show renders: the show draws it on every frame.
- **Badger's real dog sounds** (owner request): not wired yet. They need the owner's clips and a mouth-open control in
  the rig (`src/characters`, another workflow). The beat engine already places reactions where a clip would go.
- **Mid-scene reaction inserts** are deliberately not supported (a cut away from a graphic mid-sentence flickers);
  use a `beat` scene after the line.
- Landscape `none` shots (Scam of the Week, Sources) show no characters by design; vertical HowItWorked is full-frame.
- The diagram footnote says "Simplified concept"; the meter notes "each step = x10" (log scale).
