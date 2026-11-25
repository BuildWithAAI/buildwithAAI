# Automatic visual QA

Checks every rendered frame that matters for the six defects a reviewer would otherwise hunt for by eye, so the
owner's 5-minute review starts from a short list with thumbnails instead of a watch-through.

```bash
# any composition of any entry point, with its props
node scripts/qa/check.ts --entry src/index.ts --comp Preview10s
node scripts/qa/check.ts --entry src/charts/dev/index.ts --comp ChartShort
node scripts/qa/check.ts --entry src/episode/index.ts --comp EpisodeShort --props '{"channel":"_dev","slug":"engine-demo","lang":"en"}'
node scripts/qa/check.ts --entry src/episode/index.ts --comp Episode --props content/zoora-ai/<slug>/props.json
node scripts/qa/check.ts --entry src/show/index.ts --comp ShowShort --props '{"channel":"_dev","slug":"zoo-badger-demo","lang":"en"}'
node scripts/qa/check.ts --entry src/show/index.ts --comp ShowEpisode --props '{"channel":"zoora-security","slug":"<slug>","lang":"en"}'

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

Tests: `node --test scripts/qa/tests/*.test.ts` (80 unit tests) and `node scripts/qa/selftest.ts` (16 fixtures rendered
end to end: 14 planted defects, a clean control and a motion control that must stay clean; 3-5 minutes).

## The six check areas

| Area | Checks | How |
| --- | --- | --- |
| 1. Text: overflow, clipping, collisions, size, host name | `text-clipped`, `text-offframe`, `text-overflow`, `text-collision`, `text-truncated`, `text-small`, `text-name` | DOM: every text node's glyph boxes (Range line boxes narrowed to the glyph ink with canvas `TextMetrics`), intersected with the frame, every `overflow` container, SVG viewport and clip path (CSS `inset()`/`polygon()`/`circle()`/`ellipse()` parsed). Overflow is judged against the text's **plate**, the nearest ancestor that paints a background or a border (not a full-frame fill): letters running into its border are a warning, letters hanging past its edge an error. Text with no plate that exceeds its layout box (a tight line-height leaves descenders outside it) is information only. A collision is two different texts whose ink overlaps by >= 15% of the smaller one (adjacent caption words and a text drawn twice on purpose, outline under fill, are not). Text under 24 px on screen (ART_GUIDE SL10). The painted text (after CSS `text-transform`) must not spell the host's name in capitals, "ZOO", "ZOO'S" or "$ZOO" (owner rule in CLAUDE.md: "Zoo", never "ZOO"; an uppercased title counts, "ZOORA" does not). |
| 2. Safe zones | `safe-area`, `shorts-ui`, `shorts-ads` | DOM boxes of text, captions, faces (head groups incl. Badger's ears) and hands against the zones below. Hands are hit-tested (`document.elementsFromPoint` on a 3x3 grid; a point is covered when something that paints sits above the hand there): a hand hidden behind a desk is not on screen and is not checked. One issue per character and side, however the hands move. |
| 3. Captions and faces | `caption-face`, `text-face`, `text-face-zone`, `face-occluded` | Head boxes from the characters' own `data-part="head"` / `data-head` groups (exact, every view and transform). Clear zone per ART_GUIDE CV4c (information only). Faces painted over: scene frame vs the characters-only frame. |
| 4. Contrast | `contrast` | Pixels: each frame is rendered as is and with every text paint transparent (same layout). Their difference is exactly the text's pixels, whatever is behind. WCAG ratio of glyph cores vs the pixels behind them and vs the 2-3 px ring around them (outlines count), per 1.5-em strip, worst strip reported. Minimum 4.5:1 (symbol-only text such as a decorative quote mark is information). |
| 5. Off-model | `model-transform`, `model-effect`, `model-component`, `model-view`, `model-ssim`, `model-palette`, `model-pin`, `model-earcap`, `model-spots`, `model-provisional` | See below. |
| 6. Banding, blotches, flicker | `banned`, `gradient`, `texture`, `flicker`, `flash`, `one-frame-state` | DOM: gradients, patterns, blur/glow/noise filters, shadows, blend modes, masks. Pixels: per-32-px-block plane fit (slope with a dither-sized residual and no edge steps = gradient; tolerant of Chrome's gradient dithering); non-flat, non-edge 16-px blocks outside text and characters = texture; one-frame pops between consecutive frames, motion-compensated (below); mean-brightness A-B-A = flash; DOM entities that exist for exactly one frame. |

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
  against the frozen per-view lists in `src/characters/manifest.v1.json` (the left-facing sit and lie against their own
  LEFT coat-map lists `sitLeft` / `lieLeft`, not the right-facing poses' lists). Each marking may be drawn once, except
  the redraws the manifest records in `markings.badger.redrawn` (decision INT-Q2): a look-up head on its own side rig
  draws its neck part again above the collar in front of the torso (BADGER-D51), so `upLeftScreen` on the left rig may
  carry `L-NECK` twice and `upRightScreen` on the right rig `R-NECK` twice. A third copy, any other repeated id, or the
  same repeat on another head or rig is still an error (`lib/manifest.ts` `allowedMarkingDraws`, unit tests in
  `tests/checks.test.ts`).
- **Provisional drawings (`model-provisional`: an error in a production composition, a warning elsewhere):** a Badger
  instance whose drawn view and pose (`data-view` / `data-pose`, else its props) is on `BADGER_PROVISIONAL_POSES`: today
  the left-facing sit and lie (decision BADGER-D23, awaiting the owner's OK: their silhouette is the right-facing pose
  mirrored). In the compositions that publish, `Episode`, `EpisodeShort`, `ShowEpisode`, `ShowShort` and `Thumbnail`
  (`PRODUCTION_COMPOSITIONS` in `lib/provisional.ts`, exact ids), it is an **error**, so a run fails until the scene
  uses an approved drawing (view `right` for sit and lie) or the owner accepts D23. Everywhere else (`BadgerSheet`,
  `ZooSheet`, `Preview10s`, `MouthDemo`, dev, probe and fixture compositions) it stays a **warning**: those show the
  drawings for review (decision INT-Q1, revised in integration round 5). The list is read the way the Badger
  index exports it (`src/characters/badger/index.ts`, which Node cannot load because it pulls in the React components,
  so `lib/provisional.ts` follows its re-export, named or `export *`, to `src/characters/badger/provisional.ts`). If the
  index stops exporting it, nothing is provisional; if that module cannot be loaded, or the index defines the list
  itself, the copy in `manifest.v1.json` (`provisional.badger`) is used. `report.json` records the list, where it
  was read and the severity used for that composition (`provisional`: `source`, `poses`, `severity`, `production`).
- **Heuristics on S, checked against R and the manifest conventions:** Zoo's teal pin (present, within 12 units of
  its canonical position, on the screen-right side in front/3/4 views, absent in side/back); Badger's dark ear cap
  (a cap-sized `#19191C` blob in the top of the head, same side as R, screen right for the front head and screen
  left for the back view; skipped when the head is cut by the frame); the number of dark coat spots vs R; interior
  colours vs the approved palette (ΔE76 <= 6). One pin finding per frame, the most specific one (missing, shown
  in a view that hides it, wrong side, moved). The palette check catches recolouring (a hue filter); a plain
  darkening of dark artwork can land on other approved colours, and the SSIM check catches that instead.

### Flicker versus motion

A pop is a patch of frame t that differs from both neighbours while they agree with each other. Fast motion makes
the same pattern: a card that drops in 200 px per frame over a wall of its own colour leaves its text where both
neighbours show plain wall. So a pop region counts only when its content is in neither neighbour
(`scripts/qa/lib/motionmatch.ts`):

1. Fragments within 8 px join into one region (glyph pieces into words and lines); a region where the neighbours
   differ all around it (an arm swing) is motion, as before; so is a region on a head or hand that the probe saw
   move across the three frames (a fast, turning hand is somewhere else on every frame).
2. Each region's changed pixels plus 6 px of context are searched for in each neighbour: a luma pyramid, an
   exhaustive search at the finest level that fits about 8M pixel comparisons, a +-1 refinement per level, an
   exact search of small moves (<= 16 px), then a full-resolution test that tolerates sub-pixel motion (a pixel
   matches inside the other frame's 3x3 min-max envelope, +-12 levels). Found = 80% of the region and 80% of its
   changed pixels match. Repeated content (identical rows) matches at several places: the nearest one is the motion.
3. Displacements known from elsewhere are tested first and need only 65%, because moving content often passes under
   a static overlay (a segment tag, a badge): every text and character box the probe saw move between the frames,
   and the motion of all the frame's popped content taken together (a card's text and edges move as one).
4. Found in neither neighbour: a one-frame state (error). Found in both at the same displacement of >= 3 px while
   the neighbours agree around it: the element jumps away for one frame and returns (error, with the jump size).
   Anything else is motion.

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
  pixels   sampled frames at full size, as PNG (lossless), with DOM facts again (and hands hit-tested)
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
information, except `model-provisional`, which is about the asset, not the frame (it keeps its error or warning). A sheet that shows several
instances of one character (`BadgerSheet`) therefore counts as a transition: its other findings are information. Text fully hidden by a clip (0% visible) is not "cut" and is information.

**Roles.** A text is a caption when it is inside `data-part="caption"`, `data-caption`, `data-qa-role="caption"`, a
class containing `caption`/`subtitle`, or a component whose name contains `Caption`/`Subtitle` (the episode's
`Captions`, the show's `ShowCaptions`). Owner-only review badges (`ReviewBadges`, "SILENT PREVIEW",
"MACHINE TRANSLATION", or `data-qa-ignore` / `data-qa-role="badge"`) are listed but never counted.

## Verification

Final runs on 2026-11-24, on the final checker code and that afternoon's compositions. The work resumed after a
worker reset, and the characters (R2 rigs), the episode engine and the Show changed during the day, so every
composition was re-run; every finding was checked by eye on its thumbnail.

### Clean compositions (the false-positive control)

| Composition | Frames (scouted / full-size) | Result | Margins |
| --- | --- | --- | --- |
| Preview10s (camera push-in) | 300 / 17 | PASS, 0 issues | canonical SSIM >= 0.9996, <= 0.09% changed pixels |
| ChartShort | 30 / 5 | 1 warning, real: `Illustrative · fictional token · seed 51` 10% under the Shorts action buttons | contrast >= 5.21:1 |
| EpisodeShort, en (dev fixture) | 540 / 55 | PASS, 0 issues | contrast >= 5.21:1; SSIM >= 0.99999 |
| EpisodeShort, es (dev fixture) | 786 / 71 | PASS, 0 issues | contrast >= 6.83:1; SSIM 1.0000 |
| ShowShort (dev fixture) | 1538 / 123 | 1 error, real: the diagram's "Simplified concept" note sits 22% under the Shorts action buttons (0:18-0:30) | contrast >= 7.11:1; SSIM >= 0.9997 |
| Episode, en (dev fixture) | 1878 / 117 | 4 errors + 1 warning, all real (below) | lowest contrast 2.27:1 is the decorative quote mark (information); SSIM >= 0.9990 |
| Episode, es (dev fixture) | 2484 / 134 | 4 errors + 1 warning, the same real defects in the Spanish cut | SSIM >= 0.9993 |
| ShowEpisode (dev fixture) | 2790 / 184 | 1 error, real: the logo's "Show" line ends 11 px inside the bottom title-safe margin (0:02-0:06) | contrast >= 7.11:1; SSIM >= 0.9998 |

Totals: 10,346 frames scouted, 706 rendered at full size, about 82,000 text boxes, 4,071 contrast measurements and
897 canonical comparisons; 13 issues reported, all real, no false positive.

The Episode findings are defects of the engine output, not checker noise: the lower third (`ZOO` /
`Host · Zoora AI`, in Spanish `Presentador · Zoora AI`) sits on Badger's face (two "text over a face" errors and the
"face covered" warning) and spells the host `ZOO` (`lowerThird` in the engine-demo storyboards), which the owner
rule forbids; and in the hook Badger's head sits low in the corner, 14 px (es: 15 px) past the bottom title-safe
margin (ART_GUIDE MO18), since the engine moved his insert that afternoon.

### False positives found on the Show and fixed

The Show was new to the checker. Its first run reported 5 errors and 6 warnings on ShowShort and 5 errors and
14 warnings on ShowEpisode; all but the two real findings above were false, in three classes:

| Class | Cause | Fix |
| --- | --- | --- |
| One-frame flicker (8 errors) | cards dropping in up to 200 px per frame over a wall of the same colour: the text passes over pixels that are plain wall in both neighbours | motion-compensated matching (see "Flicker versus motion"); a guard fixture (`QaFxMotion`) |
| Text spills out of its box (9 warnings) | descenders below a tight line box, well inside their dark plates | overflow judged against the plate |
| Hand outside the safe area (11 warnings) | Zoo's hands hidden behind the desk; the same two hands split into an issue per position | hands hit-tested; one issue per character and side |

On the episode, the stricter flicker grouping briefly flagged Zoo's hand passing Badger's ear mid-swing (frame 1129,
a fast, turning hand is somewhere else on every frame); a pop on a moving head or hand now counts as animation.

### Planted defects

Fixtures (`src/qa/fixtures`, `node scripts/qa/selftest.ts`): 16 fixtures, 31 of 31 planted checks caught, 0
unexpected warnings or errors, the clean control and the motion control pass. New today: a label running off its
card and a title colliding with its source line (`QaFxText`), a label that jumps 14 px for one frame (`QaFxJump`,
reported as "displaced about 14 px for one frame"), and the motion control (`QaFxMotion`: a fast card drop over a
wall of its own colour, Zoo's hands behind a desk and 33 px past the safe margin; it must stay clean).

Planted copies of today's compositions (scratch, never committed; Preview10s and ChartShort regenerated from their
current source with exact-string plants that fail loudly if the source moves, Episode and ShowShort as wrappers of
the real views): 26 planted defects, 26 caught.

| Copy | Planted | Reported |
| --- | --- | --- |
| Preview10s | Badger mirrored (30-59), brightness filter on Zoo (120-149), caption over Zoo's face (200-229), one-frame white flash (260), pale label (270+) | 10 errors + 2 warnings, each traceable to a plant: transform, SSIM, ear cap and spots; effect, SSIM, pin and the filter; caption-face and face covered; flash; contrast 1.29:1 |
| ChartShort | price panel pushed 140 px off the edge, radial-gradient background, pale "Not financial advice", one-frame "PUMP INCOMING" header (frame 15) | 16 errors: frame cut and 10 unsafe labels; banned gradient and pixel gradient; contrast 1.18:1; one-frame state and flicker |
| ShowShort | one coat marking hidden (60-119), label off its plate (130-179), whole shot flipped (300-359), caption over Zoo's face (400-459), title over its source line (470-529), pale note (600-699), hue grade on Badger's close-up (1000-1059), vignette (1200-1259), black flash (1300), label under the action buttons (1400-1459), "Hosted by Zoo" in CSS capitals (1460-1519) | all 11: spots 4 vs 5 and SSIM 0.992; "hangs 333 px off the edge of its plate"; both mirrored, SSIM, pin, ear cap; caption-face and face covered; collision 67% shared ink; contrast 1.29:1; effect, SSIM, palette 2.7% off, filter; banned gradient and pixel gradient; flash; Shorts UI and safe area; host name. Knock-on effects reported too, as a reviewer would want: the vignette drops the "as of" line to 3.89:1, the label under the buttons also lands on Badger's face |
| Episode | whole shot flipped (200-259), caption over Zoo's face (300-359), pale label (470-539), greyscale grade (700-759), vignette (1100-1199), one-frame black flash (1500) | all six (mirror on both characters, SSIM, pin on the wrong side, ear cap, spots; caption-face; contrast 1.19:1; effect, SSIM, pin missing, filter; banned gradient and pixel gradient; flash), plus the real Episode findings above |

## Limits (honest)

- Pixel checks (contrast, off-model, gradient, texture, flicker) run on sampled frames only; DOM checks run on every
  scouted frame. A one-frame pixel glitch between samples is caught only if the scout's 1/8-size pop detector or
  the DOM one-frame check sees it.
- The flicker test treats a pop on a head or hand that moves across the three frames as animation, so a one-frame
  glitch drawn on a swinging hand is not reported by it (the canonical comparison still checks the hand on sampled
  frames). Motion matching assumes translation; content that scales or turns fast is recognised through the
  probe's own boxes (texts, heads, hands) rather than by pixels.
- Overlaps between a plate and set dressing that is not text (the Show's cold-open kicker bar over the ON AIR sign,
  fixed by the Show workflow on 2026-11-24) are not detected: the checker knows texts, plates, faces and hands, not
  which props matter.
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
- Run time on this machine (4 cores, concurrency 3, shared with other renders, load average 12-17): 10 s
  composition about 1 min, 18-26 s Short 1.5 min, 51 s Show Short 2.5 min, 63-83 s episode 3 min, 93 s Show episode
  4 min. The probe itself spends a median 3-9 ms per frame, 63 ms at worst (`probeMs` in report.json).
