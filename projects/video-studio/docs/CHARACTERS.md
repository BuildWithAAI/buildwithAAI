# Characters: Zoo and Badger (baseline v1.0.0)

The reusable character assets. Build every scene from these components; never redraw the characters per scene and never put the model-sheet PNGs in a scene. Binding rules are in `docs/PROJECT_INSTRUCTIONS.md`. The machine-readable record is `src/characters/manifest.v1.json`: palette, scale, line weights, left/right conventions, pivots, Badger's spot IDs, provisional drawings, the proof's beat timings and every continuity decision.

Repair rounds 1-3 (2026-11-24) changed both rigs and the proof compositions. The manifest records each change as a decision (`ZOO-*`, `BADGER-*`, `INT-*`). Round 2 added flat contact shadows (`INT-C1`) and a moving hold for the point (`INT-T2`). Round 3 repaired the hands, the profile shoe, the back view and the point timing in the Zoo rig (`ZOO-V8`, `ZOO-K3`, `ZOO-P5`, with the new `pointTuck` prop), and Badger's ear/crown joins, shocked and happy mouths, eyes, look-up lip, far hock and view contours (`BADGER-D40` to `D46`). Integration round 3 re-timed the proof: a raise-only tuck (`INT-T3`), held in-betweens for both big head turns (`INT-A2`) and a pair spacing of 570 units (`INT-P2`). It also marked the left-facing sit and lie as provisional on the sheet (`INT-S1`) and in visual QA (`INT-Q1`).

## Quick start

```tsx
import {AbsoluteFill} from 'remotion';
import {Badger, BRAND, lineScaleFor, ZooRig} from '../characters';
import {ContactShadow, FOOTPRINTS} from '../compositions/characters/contact';

const SCALE = 0.88;
const LINES = lineScaleFor(SCALE); // ART_GUIDE SL5; give both characters the same value

export const Scene: React.FC = () => (
	<AbsoluteFill style={{backgroundColor: BRAND.background}}>
		<svg width={1920} height={1080} viewBox="0 0 1920 1080">
			{/* Flat contact shadows first (decision INT-C1), then the characters. */}
			<ContactShadow x={672} y={918} scale={SCALE} print={FOOTPRINTS.zooFront} />
			<ContactShadow x={1174} y={918} scale={SCALE} print={FOOTPRINTS.badgerLeft} />
			<ZooRig x={672} y={918} scale={SCALE} lineScale={LINES} expression="neutral" />
			<Badger x={1174} y={918} scale={SCALE} lineScale={LINES} view="left" />
		</svg>
	</AbsoluteFill>
);
```

- `(x, y)` is the **ground contact point**: the centre of the footprint, in px. Put both characters on the same `y` to share a ground line.
- **World units:** Zoo is 900 units tall at `scale` 1, and Badger uses the same units. Give both the **same `scale`** and their relative size is exact (withers 312.6, head top 451.9, ear tips 455.6; withers/Zoo = 0.347).
- `<ZooRig>` and `<Badger>` render SVG `<g>` groups, so put them inside one `<svg>`. `<Zoo>` (without `embed`) and `<BadgerLayer width height>` wrap them in a full-frame `<svg>` that you can drop straight into an `AbsoluteFill`.
- Everything is exported from `src/characters/index.ts`. The provisional-pose list (`BADGER_PROVISIONAL_POSES`, `isProvisionalBadgerPose`) is exported from the Badger index, `src/characters/badger/index.ts`.
- Idle breathing runs from `useCurrentFrame()`, and nothing else moves unless you animate a prop. Use `interpolate` with `Easing.bezier` (see `src/compositions/characters/Preview10s.tsx`).
- **Contact shadows (decision INT-C1).** Every shot that shows feet or paws gets one flat ellipse in `BRAND.backgroundShadow` (`#CFD3D8`) under each figure: `<ContactShadow x y scale print={FOOTPRINTS.<figure>} />` from `src/compositions/characters/contact.tsx`. `FOOTPRINTS` holds measured extents for every view and pose (Zoo front, 3/4, side, back and typing; Badger left, right, front, 3/4, back, sit, lie, walk and look-up). Draw it before the figure. No blur, no opacity. The palette entry still needs the owner's sign-off.

## Line weights (decision INT-L1)

Both rigs take `lineScale`, a multiplier on every stroke (default 1 = `LINE` widths in world units). Choose it from the framing, where `k` is output px per world unit (placement scale times any parent viewBox magnification):

| Framing | Rule | Helper | Examples |
| --- | --- | --- | --- |
| Full body | ART_GUIDE SL5: outline = clamp(3.5 × k, 3, 6) px | `lineScaleFor(k)` (= `badgerLineScaleFor`; `fullLineScale` in `stage.ts`) | proof pair at 0.88 → 1.00; sheet row at 0.54 → 1.59; pose row at 0.5 → 1.71 |
| Close-up (head-and-shoulders and closer) | The sheet's close-up weight, half of `LINE.width` in world units, clamped to 3–6 px | `closeLineScale(k)` in `src/compositions/characters/stage.ts` | MouthDemo bust (3.21 px/u) → 0.50; ZooSheet bust (1.15 px/u) → 0.74; BadgerSheet bust (1.42) → 0.60 |

Give both characters the same value in a two-shot. Lines scale with a camera push-in; don't re-scale them per frame.

## `<Zoo>` / `<ZooRig>`

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `x`, `y`, `scale` | number | 0, 0, 1 | Ground point; scale 1 = 900 px tall |
| `view` | `'front' \| 'threeQuarter' \| 'side' \| 'back'` | `'front'` | 3/4 and side face screen right |
| `pose` | `'stand' \| 'point' \| 'typing'` | `'stand'` | `point` works in the front view only; `typing` is the seated 3/4 pose and ignores `view` |
| `poseAmount` | 0..1 | 1 | Blend into the pose; animate it for the gesture (see "Point gesture") |
| `expression` | `'neutral' \| 'happy' \| 'worried' \| 'shocked'` | `'neutral'` | Neutral = deadpan: flat mouth, anatomical-left brow slightly raised |
| `mouth` | `'closed' \| 'slightlyOpen' \| 'ah' \| 'ee' \| 'oh' \| 'mbp'` | expression's mouth | The fixed six-shape library |
| `blink` | 0..1 | 0 | 1 = closed |
| `browLift` | 0..1 | 0 | One-sided deadpan raise: anatomical-left brow up to 4.5 units, the other 1.6 (decision ZOO-B1). Raised brows draw over the front hair; the forelock lifts if a brow would reach it |
| `lookX`, `lookY` | -1..1 | 0, or the pose's default | Iris direction on screen (x: -1 = left; y: -1 = up). With `pose="point"` (front) and no value passed, the eyes lean toward the point (`POINT_LOOK`, scaled by `poseAmount`); with `pose="typing"`, toward the screen (`TYPING_LOOK`) |
| `headTilt` | degrees | 0, or the pose's default | Clamped to ±12; keep within ±8. Same pose defaults as `lookX` |
| `breathe` | boolean | true | Idle breathing: shoulders rise 3 units every 3.5 s; in the front view the arms follow 3 frames late |
| `lineScale` | number | 1 | Stroke multiplier (see "Line weights") |
| `pointWindup` | 0..1 | 0 | Anticipation before a point: ramp it up for about 5 frames before `poseAmount` starts, then back to 0 |
| `pointTuck` | 0..1 | 1 | How much of the rig's anticipation tuck to use (the elbow gathering in while the arm rises, `POINT_OVERLAP`; decision ZOO-P5). It belongs to the **raise**: pass 0 while lowering, or the elbow pulls in at the end of the lowering (the tuck played in reverse). It acts only below poseAmount 0.32, so switching it during the hold never pops. Time the gesture on the arc table of the same tuck (`pointPath`, below) |
| `embed` | boolean | false | `<Zoo embed>` returns the bare group (same as `<ZooRig>`) |
| `typing`, `layer`, `between` | | | Typing pose: finger taps, and back/front layers around a desk (see `TYPING_LAYOUT`, `Chair`, `Desk`, `Monitor`, `Keyboard`) |
| `showPivots`, `breathFrame` | | | Dev aids |

### Point gesture (decisions INT-T1, INT-T3)

The arm follows one arc (decisions ZOO-P4, ZOO-P5): the forearm lifts first while the upper arm opens out from the side; the hand closes to a loose fist from `poseAmount` 0.08, becomes the pointer from 0.4, and ends with the index about 6 degrees above horizontal at about shoulder height. `poseAmount` is not uniform on screen: about 80% of the hand's travel happens in its first half. **Time the gesture along the arc**, on the table of the tuck you pass:

```ts
import {pointPath} from '../compositions/characters/gesture';
// Preview10s: the tuck only while the fist passes Badger's head (poseAmount < 0.165), released by 0.205; none on the way down.
const raiseTuck = (pa: number) => 1 - smoothstep((pa - 0.165) / 0.04);
const RAISE = pointPath(raiseTuck); // build once, at module level
const LOWER = pointPath(0);
const u = swingEase((frame - start) / 16);        // bezier(0.38, 0, 0.4, 1) over ~16 frames
const poseAmount = RAISE.poseAmountForPath(u);    // the hand moves at the ease's speed (~45 px/frame at scale 0.88)
const pointTuck = RAISE.tuckAt(poseAmount);       // pass both to <ZooRig pose="point">
```

`poseAmountForPath(u, tuck)` and `pathForPoseAmount(pa, tuck)` remain for a constant tuck (default 1). A table built for a different tuck than the one you pass puts up to ~60 px into one frame.

Then settle 1–2 degrees (`poseAmount` 1 → 0.993 over ~7 frames) and keep the hold moving (decision INT-T2): let the arm sink about 0.06 `poseAmount` over the hold on one slow sine ease (the hand drops 7–8 px at scale 0.88), and give one small beat part-way, such as a 1–2 degree head tilt toward the point with a blink. Lower the arm along the tuck-free arc from wherever the hold left it (`LOWER.pathForPoseAmount(sunk)` gives the starting fraction), with `pointTuck={0}`.

**Check the in-betweens frame by frame (decision INT-T3).** The rig opens the upper arm about 10 degrees by the time the forearm is level, and only ~7 degrees when the forearm is 12 degrees below level. Choose the timing so the frame nearest the forearm's level crossing has the upper arm at least 10 degrees out; otherwise one frame reads as a "tray carry" (elbow at the waist under a level forearm). In `Preview10s` the level frames are f98 (11.3 degrees) and f186 (11.5 degrees); the lowering takes 15 frames for that reason. `pointTuck` and `pointWindup` can only close the arm, so a wider opening needs a rig change (ZOO-P5).

For lip-sync, `amplitudeToMouth(amplitude, previousShape)` maps a **real** narration envelope to closed / slightlyOpen / oh / ah. Without an audio track, label the preview as silent and never call it lip-synced.

## `<Badger>`

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `x`, `y`, `scale` | number | 0, 0, 1 | Same units as Zoo |
| `view` | `'left' \| 'right' \| 'front' \| 'back' \| 'threeQuarter'` | `'left'` | `left` faces screen left and shows his LEFT side (the size-panel view) |
| `pose` | `'stand' \| 'sit' \| 'lie' \| 'walk' \| 'lookUp'` | `'stand'` | `sit` and `lie`: `view="left"` gives the left-facing bodies with the LEFT coat-map markings (**PROVISIONAL**, see below); any other view gives the right-facing panels. `walk` and `lookUp` use the side views (a front, back or 3/4 view faces right) |
| `head` | `'front' \| 'threeQuarterLeftScreen' \| 'threeQuarterRightScreen' \| 'profileLeftScreen' \| 'profileRightScreen' \| 'upLeftScreen' \| 'upRightScreen'` | per view and pose | Replacement heads for limited-animation head turns |
| `expression` | `'neutral' \| 'happy' \| 'worried' \| 'shocked'` | `'neutral'` | Restrained: brows, ears, eyes. Happy carries the tail at least 32 degrees up |
| `judge` | 0..1 | 0 | Quietly judging look: flat dark brows, lids stay at least 0.86 open, ears fold a little |
| `blink` | 0..1 | 0 | |
| `earsBack` | 0..1 | by expression | Worried 0.7, shocked 0.15, otherwise 0. Worried swings the flaps down and out |
| `headTilt` | degrees | 0 | Small. On the left-facing body + tips the nose up |
| `tailWag` | turns | 0 | 0 = still; animate it for a restrained happy wag |
| `walkPhase` | cycles | 0 | With `pose="walk"`, move the root by `badgerWalkDistance(walkPhase) * scale` so the paws don't slide (`BADGER_WALK.stride` = 375 units per cycle, decision BADGER-D25) |
| `breathe` | boolean | true | |
| `lookX`, `lookY` | -1..1 | 0 | Iris direction |
| `neckTurn` | degrees | 0 | Extra neck raise (+ = up). The head rides on the neck, so this also rotates the head: counter-rotate with `headTilt` to keep it level |
| `mouthOpen` | 0..1 | 0 | For Badger's real-dog sound clips: drive it from the clip's amplitude. Each head opens its own mouth from the upper lip and the ears lift slightly; below 0.06 the expression's mouth shows. The shocked/open mouth is a gasp, never a grin (BADGER-D41) |
| `lineScale` | number | 1 | Stroke multiplier (see "Line weights") |

**Provisional poses (decision BADGER-D23).** The left-facing sit and lie (`view="left"` with `pose="sit"` or `"lie"`) are PROVISIONAL until the owner explicitly accepts D23: their unmarked outline, collar and tag are the right-facing pose silhouette mirrored about the root (the head and neck turn, folded haunch and tail curl are asymmetric), while every marking is Badger's own LEFT coat-map marking, authored for that side. They keep working for reviews; keep them out of published episodes until the owner decides. `BADGER_PROVISIONAL_POSES` and `isProvisionalBadgerPose(view, pose)` (from the Badger index) list them, `BadgerSheet` captions them "provisional: awaiting owner OK" (INT-S1), and visual QA reports a `model-provisional` warning wherever a composition uses one (INT-Q1).

**Head turns are replacements. Swap heads only while Badger's eyes are closed.** Lead with the eyes (`lookX`/`lookY` toward the new target a few frames early) and the neck (`neckTurn`), close the eyes, swap, and open them on the new head. Never show a head for a single frame (visual QA reports it as a one-frame state). For a big turn, hold an in-between under the same blink: a turn through camera holds a `front` breakdown 3–4 frames; a turn from the pitched `upLeftScreen` head back to the `front` head first eases the neck down 4–6 frames, then holds `threeQuarterLeftScreen` 2–3 frames. Choose `neckTurn` (and a small `headTilt`) at each swap so the skull stays where the old head left it; `Preview10s` keeps every swap within 6 px (decision INT-A2). Use `pose="lookUp"` (or `head="upLeftScreen"`) to look up at Zoo.

## Views and poses

| | Front | 3/4 | Side | Back | Poses |
| --- | --- | --- | --- | --- | --- |
| Zoo | yes | yes (faces screen right) | yes (faces screen right) | yes | stand, point (front), typing (seated 3/4) |
| Badger | yes | yes (right flank) | `left` and `right`, separate traces | yes | stand, sit and lie (right-facing; left-facing PROVISIONAL, BADGER-D23), walk, lookUp; 7 head views |

## The 10 s proof (`Preview10s`)

Silent, 1920×1080, 30 fps, 300 frames, on `#E6E8EB`, with a flat contact shadow under each character. The exact frames are in `BEATS` (exported, and copied to `manifest.v1.json` → `proof.beats`); `zooTrack(frame)` and `badgerTrack(frame)` give every frame's character props.

| Time | Zoo | Badger |
| --- | --- | --- |
| 0–3 s | Stands as in the size panel; blinks (f38); one-sided brow lift (f60–82) | Front head with the panel's slight lean toward Zoo; blinks (f22); ear flick during the brow lift (f68–76) |
| 3–6 s | Eyes lead (f84); wind-up (f85–90); swing along the arc f90–106 with the tuck kept only while the fist passes Badger's head (INT-T3); settle; moving hold to f181: the arm sinks ~8 px and he nods once toward the point with a blink (f124–142) | Eyes follow the hand and close as the fist passes over his head; under that blink the head turns to 3/4 right (f97); the neck and gaze rise along the point; after Zoo's nod, a small curious tilt (f140–180) and one blink (f158) |
| 6–10 s | Lowers the arm f181–196 (no tuck) back to deadpan; one blink (f186) and one after Badger's look (f264) | Looks up at Zoo: eyes and neck lead (f183–188); with the eyes closed (f190–194) the head turns through a front breakdown held 4 frames (f190–193) to `upLeftScreen` (f194). After a beat the judging look: the neck eases down on the up head (f234–240) as a slow blink closes, `threeQuarterLeftScreen` holds f241–243, the front head arrives at f244 with the eyes still closed; the eyes open on Zoo, the brows flatten, the ears fold and the head tilts about 8 degrees (f245–263). One slow push-in 1.00→1.04 (f196–299) anchored on his eyes |

## Do / don't

- **Do** use one `scale` and one `lineScale` for both characters, and one ground line `y`.
- **Do** put a flat contact shadow under feet and paws (`ContactShadow`, decision INT-C1).
- **Do** stand them 570 units apart (`PAIR_SPACING`) and draw Badger after Zoo when Zoo points to screen right over Badger (decision INT-P2: measured on Zoo-only and Badger-only renders of every proof frame, the fist passes 27.2 px from his pale ear at f96 and 29.1 px at f187 at scale 0.88; close his eyes as it passes). A neck dip, head tilt or ear fold on Badger brings his head closer, not further. Otherwise the panel spacing is 482.9 units (`SIZE_COMPARISON.spacingUnits`).
- **Do** keep faces, hands, ears and captions clear of the frame edges, and use natural 5–6 frame blinks with the eyes open between them.
- **Do** swap Badger's heads only under closed eyes, hold the in-betweens of big turns, and time Zoo's point along its arc with the tuck you pass.
- **Do** use the flat background `BRAND.background` (#E6E8EB) and only colours from `src/characters/palette.ts`.
- **Don't** flip a character or any part (`scale(-1, 1)`) to make another facing. Every facing is its own drawing, and Badger's markings differ by side (dark cap on the anatomical LEFT ear; the large patch at the LEFT withers). `node --test src/characters/badger/tests/spotsNoMirror.test.ts` fails if any marking record is the x-mirror of another (only same-id midline `M-*` marks in the two facings of one pose are allowed); round 3 removed the last mirrored record (SIT_LEFT_SPOTS R-08, BADGER-D23).
- **Don't** use the left-facing sit or lie in a published episode until the owner accepts BADGER-D23.
- **Don't** add, remove or move spots. `spots.ts` and the Badger rigs are generated: change the tracers in `src/characters/badger/dev/trace/`, then run `build.sh`.
- **Don't** add gradients, filters, opacity shading, glow or texture. Each colour has at most one flat shadow tone.
- **Don't** claim lip-sync without audio, and don't publish the model sheets in a scene.

## Compositions and renders

Run from `projects/video-studio/`. `remotion.config.ts` sets PNG frames, CRF 12, preset slow, yuv420p and BT.709 (ART_GUIDE EN1–EN3). The round-3 deliverables were rendered with `--crf=16`, as below; without the flag the config's CRF 12 applies.

| ID | What | Render |
| --- | --- | --- |
| `Preview10s` | 10 s silent proof, 1920x1080, 30 fps | `npx remotion render src/index.ts Preview10s out/preview/zoo-badger-preview-10s.mp4 --crf=16` |
| `MouthDemo` | Six mouth shapes, one per second, silent | `npx remotion render src/index.ts MouthDemo out/preview/mouth-demo.mp4 --crf=16` |
| `ZooSheet`, `BadgerSheet` | Asset sheet stills rendered from the rigs | `npx remotion still src/index.ts ZooSheet out/preview/zoo-sheet.png` (same for `BadgerSheet` → `badger-sheet.png`) |

Check a render with `ffprobe`: H.264 High, yuv420p, BT.709, 1920×1080, 30/1 fps, no audio stream, 10.000 s for the proof.

Visual QA: `node scripts/qa/check.ts --entry src/index.ts --comp Preview10s` (round 3: PASS, no warnings). On `BadgerSheet` it reports two `model-provisional` warnings, the left-facing sit and lie, by design.

Dev compositions for each character live in `src/characters/<zoo|badger>/dev/index.ts` and render with `npx remotion still src/characters/zoo/dev/index.ts ZooFront out/chars/zoo_front.png`. Badger's walk has a numeric check (paws never below the ground, no stance drift): `npx esbuild src/characters/badger/dev/walkCheck.ts --bundle --platform=node --format=cjs --outfile=/tmp/walkCheck.cjs && node -e "console.log(require('/tmp/walkCheck.cjs').runWalkCheck())"`.

After any character or proof change, regenerate the manifest:

```bash
npx esbuild scripts/build-character-manifest.ts --bundle --platform=node --format=cjs --jsx=automatic \
  --loader:.png=empty --loader:.woff2=empty --outfile=/tmp/bcm.cjs && node /tmp/bcm.cjs
```

## Known limits (v1.0.0, after repair round 3)

- **Owner decisions pending:**
  - BADGER-D23: the left-facing sit and lie reuse the right-facing pose outline, mirrored about the root, with their own LEFT markings and head. PROVISIONAL: captioned on the sheet and warned by QA until the owner accepts or rejects it. BADGER-D36 reuses the unmarked outline, nose and mouths of the 3/4-right head for the 3/4-left head in the same way (bilaterally symmetric features).
  - BADGER-D16: in level right-facing views (right stand, walk, look-up) the withers patch shows the turnaround's rounded right lobe (about 82 x 38 units). The alternative is coat_right's thin edge.
  - INT-C1: the palette entry `BRAND.backgroundShadow` (`#CFD3D8`) for contact shadows.
- Zoo:
  - Only the front view can point.
  - Arms in the 3/4, side and back views are fixed hangs.
  - Typing exists only as the sheet's seated 3/4 pose.
  - The point has no contrapposto or torso turn (ZOO-P3), and its upper arm is ~6 degrees higher than the panel's.
  - The point's in-betweens: the forearm reaches level with the upper arm ~10–11 degrees out (ZOO-P5). In the proof the frames just before level (f97, f187) have the forearm 13–15 degrees below level with the elbow 15–17 units out of its rest position, and f96 has the elbow tucked (the anticipation tuck) with the forearm 27 degrees below level (INT-T3). A wider opening needs a rig change.
  - Hand shapes along the point (relaxed, loose fist, pointer) are instant replacements.
  - The front "happy" has no head yaw (ZOO-E2).
- Badger:
  - The look-up heads are pitched profiles; the look-up throat still bows slightly forward where it meets the neck.
  - The far forelegs in the side walk and stand views carry no edge spots (the sit, lie and 3/4 bodies do).
  - In the left walk around phase 0.125 a sliver of background (about 4 units) remains at the far hock (BADGER-D45).
  - Head yaw for the front expressions is left to staging (the 3/4 heads plus `headTilt`, BADGER-D30).
  - The walk's paw spread is about 5% shorter than the walking panel's.
- Proof: head replacements keep the skull within 6 px at every swap, always with the eyes closed: the turn's front breakdown dips 6 px at f190 (INT-A2). The pair stands 570 units apart, 87 wider than the size panel, so frame 0 shows Badger ~77 px further right than the panel (INT-P2).
- The proof is silent. No narration asset was supplied.
