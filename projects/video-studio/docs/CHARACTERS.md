# Characters: ZOO and Badger (baseline v1.0.0)

The reusable character assets. Build every scene from these components; never redraw the characters per scene and never put the model-sheet PNGs in a scene. Binding rules are in `docs/PROJECT_INSTRUCTIONS.md`. The machine-readable record is `src/characters/manifest.v1.json`: palette, scale, left/right conventions, pivots, Badger's spot IDs and every continuity decision.

## Quick start

```tsx
import {AbsoluteFill} from 'remotion';
import {Badger, BRAND, ZooRig} from '../characters';

export const Scene: React.FC = () => (
	<AbsoluteFill style={{backgroundColor: BRAND.background}}>
		<svg width={1920} height={1080} viewBox="0 0 1920 1080">
			<ZooRig x={677} y={918} scale={0.88} expression="neutral" />
			<Badger x={1170} y={918} scale={0.88} view="left" />
		</svg>
	</AbsoluteFill>
);
```

- `(x, y)` is the **ground contact point**: the centre of the footprint, in px. Put both characters on the same `y` to share a ground line.
- **World units:** ZOO is 900 units tall at `scale` 1, and Badger uses the same units. Give both the **same `scale`** and their relative size is exact (withers 312.6, head top 451.9, ear tips 455.6; withers/ZOO = 0.347).
- `<ZooRig>` and `<Badger>` render SVG `<g>` groups, so put them inside one `<svg>`. `<Zoo>` (without `embed`) and `<BadgerLayer width height>` wrap them in a full-frame `<svg>` that you can drop straight into an `AbsoluteFill`.
- Everything is exported from `src/characters/index.ts`.
- Idle breathing runs from `useCurrentFrame()`, and nothing else moves unless you animate a prop. Use `interpolate` with `Easing.bezier` (see `src/compositions/characters/Preview10s.tsx`).

## `<Zoo>` / `<ZooRig>`

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `x`, `y`, `scale` | number | 0, 0, 1 | Ground point; scale 1 = 900 px tall |
| `view` | `'front' \| 'threeQuarter' \| 'side' \| 'back'` | `'front'` | 3/4 and side face screen right |
| `pose` | `'stand' \| 'point' \| 'typing'` | `'stand'` | `point` works in the front view only; `typing` is the seated 3/4 pose and ignores `view` |
| `poseAmount` | 0..1 | 1 | Blend into the pose; animate it for the gesture |
| `expression` | `'neutral' \| 'happy' \| 'worried' \| 'shocked'` | `'neutral'` | Neutral = deadpan: flat mouth, anatomical-left brow slightly raised |
| `mouth` | `'closed' \| 'slightlyOpen' \| 'ah' \| 'ee' \| 'oh' \| 'mbp'` | expression's mouth | The fixed six-shape library |
| `blink` | 0..1 | 0 | 1 = closed |
| `browLift` | 0..1 | 0 | Small deadpan raise (up to 3.5 units) |
| `lookX`, `lookY` | -1..1 | 0 | Iris direction on screen (x: -1 = left; y: -1 = up) |
| `headTilt` | degrees | 0 | Clamped to ±12; keep within ±8 |
| `breathe` | boolean | true | Idle breathing |
| `pointWindup` | 0..1 | 0 | Anticipation before a point: ramp it up for about 5 frames before `poseAmount` starts, then back to 0 |
| `embed` | boolean | false | `<Zoo embed>` returns the bare group (same as `<ZooRig>`) |
| `typing`, `layer`, `between` | | | Typing pose: finger taps, and back/front layers around a desk (see `TYPING_LAYOUT`, `Chair`, `Desk`, `Monitor`, `Keyboard`) |
| `showPivots`, `breathFrame` | | | Dev aids |

The point gesture follows one arc. The elbow stays in, the forearm lifts with the hand trailing, then the arm opens and the index points to screen right at shoulder height. The pointing hand appears at `poseAmount` 0.75. Ease `poseAmount` 0 → 1 over about 12 frames.

For lip-sync, `amplitudeToMouth(amplitude, previousShape)` maps a **real** narration envelope to closed / slightlyOpen / oh / ah. Without an audio track, label the preview as silent and never call it lip-synced.

## `<Badger>`

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `x`, `y`, `scale` | number | 0, 0, 1 | Same units as ZOO |
| `view` | `'left' \| 'right' \| 'front' \| 'back' \| 'threeQuarter'` | `'left'` | `left` faces screen left and shows his LEFT side (the size-panel view) |
| `pose` | `'stand' \| 'sit' \| 'lie' \| 'walk' \| 'lookUp'` | `'stand'` | `sit` and `lie` always face screen right; `walk` and `lookUp` use the side views |
| `head` | `'front' \| 'threeQuarterLeftScreen' \| 'threeQuarterRightScreen' \| 'profileLeftScreen' \| 'profileRightScreen' \| 'upLeftScreen' \| 'upRightScreen'` | per view (`left`: `front`) | Replacement heads for limited-animation head turns |
| `expression` | `'neutral' \| 'happy' \| 'worried' \| 'shocked'` | `'neutral'` | Restrained: brows, ears, eyes |
| `judge` | 0..1 | 0 | Quietly judging look: lowered lids and a flat dark brow line |
| `blink` | 0..1 | 0 | |
| `earsBack` | 0..1 | by expression | Worried 0.7, shocked 0.15, otherwise 0 |
| `headTilt` | degrees | 0 | Small |
| `tailWag` | turns | 0 | 0 = still; animate it for a restrained happy wag |
| `walkPhase` | cycles | 0 | With `pose="walk"`, move the root by `badgerWalkDistance(walkPhase) * scale` so the paws don't slide |
| `breathe` | boolean | true | |
| `lookX`, `lookY` | -1..1 | 0 | Iris direction |
| `neckTurn` | degrees | 0 | Extra neck raise (+ = up). Ease a head swap with it |

Head turns are replacements. Cover a big swap with a blink or a 1-2 frame breakdown through `front` (as `Preview10s` does at f198-199). Use `pose="lookUp"` (or `head="upLeftScreen"`) to look up at ZOO.

## Views and poses

| | Front | 3/4 | Side | Back | Poses |
| --- | --- | --- | --- | --- | --- |
| ZOO | yes | yes (faces screen right) | yes (faces screen right) | yes | stand, point (front), typing (seated 3/4) |
| Badger | yes | yes (right flank) | `left` and `right`, separate traces | yes | stand, sit, lie, walk, lookUp; 7 head views |

## Do / don't

- **Do** use one `scale` for both characters and one ground line `y`.
- **Do** stand them 560 units apart and draw Badger after ZOO when ZOO points to screen right over Badger (decision INT-P2). Otherwise the panel spacing is 482.9 units (`SIZE_COMPARISON.spacingUnits`).
- **Do** keep faces, hands, ears and captions clear of the frame edges, and use natural 5-6 frame blinks with the eyes open between them.
- **Do** use the flat background `BRAND.background` (#E6E8EB) and only colours from `src/characters/palette.ts`.
- **Don't** flip a character or any part (`scale(-1, 1)`) to make another facing. Every facing is its own drawing, and Badger's markings differ by side (dark cap on the anatomical LEFT ear; the large patch at the LEFT withers).
- **Don't** add, remove or move spots. `spots.ts` and the Badger rigs are generated: change the tracers in `src/characters/badger/dev/trace/`, then run `build.sh`.
- **Don't** add gradients, filters, opacity shading, glow or texture. Each colour has at most one flat shadow tone.
- **Don't** claim lip-sync without audio, and don't publish the model sheets in a scene.

## Compositions and renders

| ID | What | Render |
| --- | --- | --- |
| `Preview10s` | 10 s silent proof, 1920x1080, 30 fps | `npx remotion render Preview10s out/preview/zoo-badger-preview-10s.mp4 --crf=16` |
| `MouthDemo` | Six mouth shapes, one per second, silent | `npx remotion render MouthDemo out/preview/mouth-demo.mp4 --crf=16` |
| `ZooSheet`, `BadgerSheet` | Asset sheet stills rendered from the rigs | `npx remotion still ZooSheet out/preview/zoo-sheet.png` |

Dev compositions for each character live in `src/characters/<zoo|badger>/dev/index.ts` and render with `npx remotion still src/characters/zoo/dev/index.ts ZooFront out/chars/zoo_front.png`. After any character change, regenerate the manifest:

```bash
npx esbuild scripts/build-character-manifest.ts --bundle --platform=node --format=cjs --jsx=automatic \
  --loader:.png=empty --loader:.woff2=empty --outfile=/tmp/bcm.cjs && node /tmp/bcm.cjs
```

## Known limits (v1.0.0)

- ZOO: only the front view can point. Arms in the 3/4, side and back views are fixed hangs. Typing exists only as the sheet's seated 3/4 pose.
- Badger: the 3/4 heads are constructed from the front head (decisions D08 and INT-B1). `sit` and `lie` face screen right only. The look-up heads are pitched profiles.
- The proof is silent. No narration asset was supplied.
