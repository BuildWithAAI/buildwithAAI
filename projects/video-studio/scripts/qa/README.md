# Automatic visual QA

Checks every rendered frame that matters for the six defects a reviewer would otherwise hunt for by eye, so the
owner's 5-minute review starts from a short list with thumbnails instead of a watch-through.

```bash
# any composition of any entry point, with its props
node scripts/qa/check.ts --entry src/index.ts --comp Preview10s
node scripts/qa/check.ts --entry src/charts/dev/index.ts --comp ChartShort
node scripts/qa/check.ts --entry src/episode/index.ts --comp EpisodeShort --props '{"channel":"_dev","slug":"engine-demo","lang":"en"}'
node scripts/qa/check.ts --entry src/episode/index.ts --comp Episode --props content/zoora-ai/<slug>/props.json

# options
--frames auto|<list>      auto (default) or e.g. 0,95-105,299
--every <N>               stride of the regular samples (default: one per second, widened on long videos)
--max-samples <n>         full-size frames budget (default 240)
--scout-step <k>          DOM scout every k-th frame (default 1 up to 3600 frames)
--shorts-zone organic|ads Shorts UI zones (default organic; "ads" makes Google's ads safe zone binding)
--fail-on error|warn      exit 1 on errors (default) or on warnings too
--keep-frames             keep the rendered PNGs in <out>/frames
--no-pixels               DOM checks only (fast)
--out <dir>               default out/qa/<comp>
```

Output: `out/qa/<comp>/report.md` (verdict, then the issues worth reviewing, each with a thumbnail),
`report.json` (everything: issues with frames and timecodes, measurements, thresholds, sampled frames and why,
skipped measurements, per-frame motion) and `issues/NN-<check>-f<frame>.png`.
Exit code 0 = no errors, 1 = errors (or warnings with `--fail-on warn`), 2 = bad arguments or a tool failure.
A run that cannot finish (the composition's own metadata step throws, the browser dies) still writes `report.md`
and `report.json` with the verdict **ERROR** and the reason, so an older report is never mistaken for this run.

Tests: `node --test scripts/qa/tests/*.test.ts` (58 unit tests) and `node scripts/qa/selftest.ts` (14 planted-defect
fixtures rendered end to end, about 2 minutes).

## The six check areas

| Area | Checks | How |
| --- | --- | --- |
| 1. Text: overflow, clipping, size, host name | `text-clipped`, `text-offframe`, `text-overflow`, `text-truncated`, `text-small`, `text-name` | DOM: every text node's glyph boxes (Range line boxes narrowed to the glyph ink with canvas `TextMetrics`), intersected with the frame, every `overflow` container, SVG viewport and clip path (CSS `inset()`/`polygon()`/`circle()`/`ellipse()` parsed). Overflow = ink outside the nearest block's padding box. Text under 24 px on screen (ART_GUIDE SL10). The painted text (after CSS `text-transform`) must not spell the host's name in capitals, "ZOO", "ZOO'S" or "$ZOO" (owner rule in CLAUDE.md: "Zoo", never "ZOO"; an uppercased title counts, "ZOORA" does not). |
| 2. Safe zones | `safe-area`, `shorts-ui`, `shorts-ads` | DOM boxes of text, captions, faces (head groups incl. Badger's ears) and hands against the zones below. |
| 3. Captions and faces | `caption-face`, `text-face`, `text-face-zone`, `face-occluded` | Head boxes from the characters' own `data-part="head"` / `data-head` groups (exact, every view and transform). Clear zone per ART_GUIDE CV4c (information only). Faces painted over: scene frame vs the characters-only frame. |
| 4. Contrast | `contrast` | Pixels: each frame is rendered as is and with every text paint transparent (same layout). Their difference is exactly the text's pixels, whatever is behind. WCAG ratio of glyph cores vs the pixels behind them and vs the 2-3 px ring around them (outlines count), per 1.5-em strip, worst strip reported. Minimum 4.5:1 (symbol-only text such as a decorative quote mark is information). |
| 5. Off-model | `model-transform`, `model-effect`, `model-component`, `model-view`, `model-ssim`, `model-palette`, `model-pin`, `model-earcap`, `model-spots` | See below. |
| 6. Banding, blotches, flicker | `banned`, `gradient`, `texture`, `flicker`, `flash`, `one-frame-state` | DOM: gradients, patterns, blur/glow/noise filters, shadows, blend modes, masks. Pixels: per-32-px-block plane fit (slope with a dither-sized residual and no edge steps = gradient; tolerant of Chrome's gradient dithering); non-flat, non-edge 16-px blocks outside text and characters = texture; one-frame pops between consecutive frames with a motion test (an arm swing is not flicker); mean-brightness A-B-A = flash; DOM entities that exist for exactly one frame. |

### Off-model detection

For every character instance in a sampled frame the probe reads, from React itself, the props the canonical
component received and the frame its own `useCurrentFrame()` saw (`src/qa/runtime/fiber.ts`, which resolves the
committed fiber copy the way React's `findCurrentFiberUsingSlowPath` does). Then:

- **Solo pass (S):** the same frame with everything hidden except the characters. The character is exactly as the
  scene composed it (ancestor transforms, filters, opacity, clips) with nothing in front of it.
- **Canonical reference (R):** composition `QaRef-<id>` draws the canonical `ZooRig` / `Badger` from
  `src/characters` with the same props and local frame (`<Freeze>`), placed with a pure translate + uniform scale
  (+ rotation) at the same origin and size, transparent background.
- **Comparison:** SSIM (8 px windows) and changed-pixel share over the character's own pixels, excluding pixels
  another character covers. On clean scenes S and R match within anti-aliasing: SSIM >= 0.9992 and at most
  0.09% changed pixels on every run of the three clean compositions with characters. Thresholds: SSIM < 0.97
  or > 1% changed = error, < 0.995 or > 0.2% = warning.
- **DOM facts:** the screen matrix gives mirroring (det < 0), stretching (> 2% anisotropy), skew and whole-body
  rotation; ancestor CSS/SVG filters and blend modes; whether the `data-character` group was rendered by the
  canonical component (a scene-drawn stand-in is caught); requested vs rendered view; Badger's `data-spot` ids
  against the frozen per-view lists in `src/characters/manifest.v1.json`.
- **Heuristics on S, checked against R and the manifest conventions:** Zoo's teal pin (present, within 12 units of
  its canonical position, on the screen-right side in front/3/4 views, absent in side/back); Badger's dark ear cap
  (a cap-sized `#19191C` blob in the top of the head, same side as R, screen right for the front head and screen
  left for the back view; skipped when the head is cut by the frame); the number of dark coat spots vs R; interior
  colours vs the approved palette (ΔE76 <= 6). One pin finding per frame, the most specific one (missing, shown
  in a view that hides it, wrong side, moved). The palette check catches recolouring (a hue filter); a plain
  darkening of dark artwork can land on other approved colours, and the SSIM check catches that instead.

## Safe zones (verified 2026-11-24)

| Format | Zone | Source |
| --- | --- | --- |
| 16:9 | Text, faces, hands, dog ears >= 96 px from the sides, >= 54 px from top/bottom | `docs/ART_GUIDE.md` MO18 (90% title-safe); same box as `SAFE.landscape` in `src/episode/layout/specs.ts` |
| 9:16 | Margins >= 54 px left/right, >= 96 px top/bottom | ART_GUIDE MO18 |
| 9:16 | Shorts player UI: top 192 px, bottom 384 px, action column x > 950 below y 960 | Project layout decision (`src/episode/layout/specs.ts` SAFE.vertical and CAPTIONS). **YouTube publishes no pixel spec for organic Shorts** (YouTube Help searched 2026-11-24). |
| 9:16 | Google "Universal safe zones for video ads on YouTube", vertical 1080x1920: keep out of top 288, bottom 672, left 48, right 192 px | support.google.com/google-ads/answer/13547298 ("About video ad specs"), read 2026-11-24; figure: storage.googleapis.com/support-kms-prod/jbb4hOyc2nGdunbKddqpFAEQpHOQvy582jIR. Ads are not overlaid on organic Shorts, so it is information unless `--shorts-zone ads`. |

Zones scale with the frame size (e.g. 720x1280).

## How it works

```
check.ts ─ bundle the target entry unchanged; webpack swaps `import ... from 'remotion'` in project code for
           src/qa/runtime/shim.tsx, whose <Composition>/<Still> wrap the component with <QaProbe/> and register
           QaRef-<id> next to it (src/qa/runtime/QaCharacterRef.tsx, loaded lazily: a composition without
           characters never imports src/characters). No project file is edited.
  scout    every frame (every k-th on long videos) at 1/8 size: the probe's DOM facts (texts, characters, banned
           techniques) plus tiny frames for cut, transition and pop detection
  plan     scene starts/ends, mid-scene flicker triplets, every Nth frame, the first frame of every DOM finding,
           the 12 strongest pop candidates (capped at --max-samples)
  pixels   sampled frames at full size, as PNG (lossless), with DOM facts again
  textoff  same frames, every text paint transparent
  solo     same frames, characters only, transparent background
  ref      one canonical render per character instance
  report   findings grouped per defect across frames, thumbnails, report.md/json
```

The probe (`src/qa/runtime/QaProbe.tsx`) holds each frame with `delayRender` until every other handle has
cleared and fonts are loaded, measures, prints its JSON in chunks on the console (captured with `onBrowserLog`),
then releases the frame. It is inert unless the render passes `ZOORA_QA_PASS` in `envVariables`.

**Animation awareness.** Geometry findings on an element whose box, clip or opacity differs from the previous or
next scouted frame (a slide-in, a wipe, a fade) are information ("while animating"); settled frames keep their
severity. Scene transitions are found from the scout frames (a run of frames with >= 30% of pixels changing, or
>= 5% for 4+ frames with hysteresis, i.e. slides over flat backgrounds) and from two instances of the same
character in one frame (both scenes mounted); pixel checks skip those frames and DOM findings there are
information. Text fully hidden by a clip (0% visible) is not "cut" and is information.

**Roles.** A text is a caption when it is inside `data-part="caption"`, `data-caption`, `data-qa-role="caption"`, a
class containing `caption`/`subtitle`, or a component whose name contains `Caption`/`Subtitle` (the episode's
`Captions`, the show's `ShowCaptions`). Owner-only review badges (`ReviewBadges`, "SILENT PREVIEW",
"MACHINE TRANSLATION", or `data-qa-ignore` / `data-qa-role="badge"`) are listed but never counted.

## Verification

Clean compositions (the false-positive control), final run on 2026-11-24. Other workflows were editing the episode
engine and the characters the same day, so the compositions changed between runs; every finding below was checked
by eye on its thumbnail.

| Composition | Frames (scouted / full-size) | Result | Margins |
| --- | --- | --- | --- |
| Preview10s (camera push-in) | 300 / 17 | PASS, 0 issues | canonical SSIM >= 0.9995, <= 0.09% changed pixels |
| ChartShort | 30 / 5 | 1 warning: `Illustrative · fictional token · seed 51` 10% under the Shorts action buttons | contrast >= 5.21:1 |
| EpisodeShort (dev fixture) | 540 / 57 | PASS, 0 issues | contrast >= 5.21:1; SSIM >= 0.99999, 0 changed pixels |
| Episode (dev fixture) | 1878 / 115 | FAIL, 3 errors + 1 warning, all real (below) | lowest contrast 2.27:1 is the decorative teal quote mark (information); SSIM >= 0.9993 |

The Episode findings are real defects of the current engine output, not checker noise: the lower third
(`ZOO` / `Host · Zoora AI`) sits on Badger's face from 0:05.16 to 0:09.26 (two "text over a face" errors and the
"face covered" warning), and it spells the host `ZOO` (`lowerThird` in the engine-demo storyboards, en, pt-br, hi
and zh), which the owner rule forbids. Earlier the same day EpisodeShort failed on its chart chip
(`Illustrative · fictional token`, 13% under the Shorts action buttons, since fixed by the engine work) and the
Episode passed; the Badger insert moved under the lower third after that. Two runs met a composition that could
not load at all (EpisodeShort's own metadata check, "price pane 298px < 55% of the inner height", and a
half-edited character module); both wrote an ERROR report with the reason.

One false positive was found and fixed in these runs: on the last frame of an eased cross-fade the incoming layer
is at 0.985 opacity and the outgoing Badger shows through at 1.5%, which read as "face covered". A character below
full opacity now marks the frame as a cross-fade (only the flicker test runs there).

Planted defects (`src/qa/fixtures`, `node scripts/qa/selftest.ts`): 14 fixtures, 28 of 28 planted checks caught,
0 unexpected warnings or errors, clean control passes. The filter fixture also surfaced a real side effect:
Chrome re-rasterised the hue-filtered Zoo differently on one frame (a genuine one-frame flicker), one more reason
ART_GUIDE bans filters.

Planted copies of the real compositions (scratch, not committed), 15 planted defects, 15 caught:

| Copy | Planted | Reported |
| --- | --- | --- |
| Preview10s | Badger mirrored (frames 30-59), brightness filter on Zoo (120-149), caption over Zoo's face (200-229), one-frame white flash (260), pale label (270+) | 10 errors + 2 warnings, every one traceable to a planted defect: transform, SSIM, ear cap and spots for the mirror; effect, SSIM, pin and banned filter for the filter; caption-face and face covered; flash; contrast 1.29:1 |
| ChartShort | price panel pushed 140 px off the edge, radial-gradient background, pale "Not financial advice", one-frame "PUMP INCOMING" header (frame 15) | 16 errors: 12 for the cut and unsafe panel labels, contrast 1.18:1, banned gradient and pixel gradient, one-frame state and flicker |
| Episode | whole shot flipped (200-259), caption over Zoo's face (300-359), pale label (470-539), greyscale grade (700-759), vignette (1100-1199), one-frame black flash (1500) | all six caught (mirror on both characters, SSIM, pin on the wrong side, ear cap, spots; caption-face; contrast 1.19:1; effect, SSIM, pin missing, banned filter; banned gradient and pixel gradient; flash), plus the four real Episode findings above |

## Limits (honest)

- Pixel checks (contrast, off-model, gradient, texture, flicker) run on sampled frames only; DOM checks run on every
  scouted frame. A one-frame pixel glitch between samples is caught only if the scout's 1/8-size pop detector or
  the DOM one-frame check sees it.
- The canonical reference is rendered by the current character code, so drift *inside* `src/characters` is caught
  through the frozen manifest facts (spot ids, pin and ear-cap conventions, palette), not by SSIM.
- Characters with non-serialisable visual props (`between`, e.g. a desk drawn inside Zoo's typing pose) skip the
  pixel comparison (listed in the report); their DOM checks still run.
- Captions and badges are recognised by markers and component names; a new caption component should carry
  `data-part="caption"` or have `Caption` in its name.
- The organic Shorts zones are a project rule, not a YouTube specification (none is published).
- The naming check knows one rule, the host's name in capitals. Other house spellings (the show name, tickers
  other than "$ZOO") are left to the claim and copy gates.
- Contrast is measured on settled, opaque text only (fades and moving text are skipped and listed).
- Run time on this machine (4 cores, concurrency 3): 10 s composition 30-40 s, 18 s Short 60-90 s, 63 s episode
  about 3 min; two to three times that while other renders share the machine.
