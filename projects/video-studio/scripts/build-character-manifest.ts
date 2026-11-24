/**
 * Builds src/characters/manifest.v1.json, the one reusable character manifest (Zoo + Badger), from the source of
 * truth: the per-character TS manifests, rig pivot tables, spot records, palette and the approved sheets (sha256).
 * Run from projects/video-studio:
 *   npx esbuild scripts/build-character-manifest.ts --bundle --platform=node --format=cjs --jsx=automatic \
 *     --loader:.png=empty --loader:.woff2=empty --outfile=/tmp/build-character-manifest.cjs && node /tmp/build-character-manifest.cjs
 * Re-run after any change to src/characters (the JSON is generated; do not edit it by hand).
 */
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {BADGER_COLORS, BRAND, LINE, PROP_COLORS, ZOO_COLORS} from '../src/characters/palette';
import {SIZE_COMPARISON} from '../src/characters/relativeScale';
import {ZOO_MANIFEST} from '../src/characters/zoo/manifest';
import {FRONT} from '../src/characters/zoo/rig';
import {BADGER_MANIFEST} from '../src/characters/badger/manifest';
import {
	BACK_SPOTS,
	FRONT_NECK_SPOTS,
	FRONT_SPOTS,
	HEAD_MARKINGS,
	LEFT_SPOTS,
	LIE_LEFT_SPOTS,
	LIE_SPOTS,
	RIGHT_SPOTS,
	SIT_LEFT_SPOTS,
	SIT_SPOTS,
	THREE_QUARTER_SPOTS,
	type BadgerSpot,
} from '../src/characters/badger/spots';
import {ZOO_LINE} from '../src/characters/zoo/lines';
import {BEATS, POINT} from '../src/compositions/characters/Preview10s';
import {PROVISIONAL_CAPTION} from '../src/compositions/characters/captions';
import {POINT_PATH_LENGTH, pathForPoseAmount, pointPath} from '../src/compositions/characters/gesture';
import {FOOTPRINTS} from '../src/compositions/characters/contact';
import {closeLineScale, fullLineScale, GROUND_Y, FRAME, PAIR_LINE_SCALE, PAIR_SCALE, PAIR_SPACING} from '../src/compositions/characters/stage';

const ROOT = process.cwd();
const sha = (rel: string) => createHash('sha256').update(readFileSync(join(ROOT, rel))).digest('hex');
const r = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** Round every number in a JSON-able value (pivot tables carry long float tails). */
const roundAll = (v: unknown): unknown => {
	if (typeof v === 'number') return r(v, 2);
	if (Array.isArray(v)) return v.map(roundAll);
	if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, roundAll(x)]));
	return v;
};

const spotList = (spots: readonly BadgerSpot[]) =>
	spots.map((s) => ({id: s.id, side: s.side, part: s.part, ...(s.segment ? {segment: s.segment} : {}), ...(s.sameAs ? {sameAs: s.sameAs} : {})}));

const crops = [
	'reference/crops/badger_size_comparison.png',
	'reference/crops/badger_coat_left.png',
	'reference/crops/badger_coat_right.png',
	'reference/crops/badger_coat_top.png',
	'reference/crops/badger_turn_front.png',
	'reference/crops/badger_expr_neutral.png',
	'reference/crops/zoo_turn_front.png',
	'reference/crops/zoo_expr_neutral.png',
	'reference/crops/zoo_pose_point.png',
];

const zooDecisions = ZOO_MANIFEST.decisions.map((d) => ({character: 'zoo', ...d}));
const badgerDecisions = BADGER_MANIFEST.decisions.map((d) => ({character: 'badger', id: d.id, sheet: d.sheetShowed, chosen: d.chosen, why: d.why}));
const integrationDecisions = [
	{
		character: 'both',
		id: 'INT-P1',
		sheet: 'badger_size_comparison.png: Zoo screen left, Badger (left side toward camera, face turned to camera with a slight lean toward Zoo) screen right, one ground line.',
		chosen: `Pair shots use one shared scale (both characters' world units are the same; ${PAIR_SCALE} in the 1920x1080 proof), ground contact at ${GROUND_Y} px (85% of ${FRAME.height}), Badger view 'left' with head 'front'. The proof opens with a +3 deg head tilt (muzzle toward Zoo) for the panel's lean; the 3/4-left head turns too far for it.`,
		why: 'The size-comparison panel controls relative scale; same scale value = correct relative size.',
	},
	{
		character: 'both',
		id: 'INT-P2',
		sheet: `The panel stands the pair ${SIZE_COMPARISON.spacingUnits} units apart (ground point to ground point); Badger's head sits just beside Zoo's hanging hand.`,
		chosen: `When Zoo points to screen right over Badger, the pair stands ${PAIR_SPACING} units apart and Badger is drawn in front of Zoo (depth), for the whole shot (no sliding). Scale and ground line stay the panel's. Integration round 3: 560 -> ${PAIR_SPACING}.`,
		why: "Spacing is staging, not anatomy; relative scale is unchanged. Round 1: at the panel spacing the swinging hand overlaps Badger's pale ear (poseAmount ~0.2), so the pair moved to 560 units (closest pass 24.5 px at the proof scale). Round 2 measured 26.9 px (f96) and 30.9 px (f188). Round 3: the repaired arm opens earlier (ZOO-P5), and at 560 the fist passed 20.5 px from the pale ear at f96 (23.7 px at f188). At 570 units, with the raise timing of INT-T3, Zoo-only and Badger-only renders of all 300 frames give a closest pass of 27.2 px at f96 (raise) and 29.1 px at f187 (lowering); every other frame is >= 32 px. Between rendered frames the hand's continuous path stays >= 27.2 px on the raise and dips to 23.3 px between f187 and f188 on the lowering (probe renders at poseAmount steps of 0.0075), so the margin holds at this frame rate. Badger's eyes close as it passes (blinks f94-99 and f188-198). A neck dip, head tilt or ear fold on Badger does not widen the gap: measured in round 3 at 560 units, an ear fold of 0.4 brings his head 5 px closer at f95 and a 4 deg neck dip 8 px closer, because the neck pivots the head toward the hand; only spacing does.",
	},
	{
		character: 'both',
		id: 'INT-A1',
		sheet: 'Prompt 2: proof is silent unless narration is supplied; mouth shapes are demonstrated separately.',
		chosen: 'Preview10s has no audio track; MouthDemo cycles the six shapes one per second with an on-screen note "Mouth library demo — silent, not lip-synced". Sheet stills render the rig with no labels copied from the model sheets. On-screen text says "Zoo" (owner amendment 2026-11-24).',
		why: 'PROJECT_INSTRUCTIONS: do not claim lip-sync without an audio track; never use the labelled model sheet in scene.',
	},
	{
		character: 'zoo',
		id: 'INT-T1',
		sheet: 'zoo_pose_point.png shows the end pose only; Prompt 1 asks for restrained, purposeful gestures.',
		chosen: `The point is timed along the hand's arc, not in poseAmount: gesture.ts maps a path fraction to poseAmount through the rig's own pivots and angle function, on a table built for the pointTuck the composition passes (pointPath; hand path ${Math.round(POINT_PATH_LENGTH)} units with the rig's default tuck, ${Math.round(pointPath(0).length)} with none). The swing eases the path fraction with bezier(0.38,0,0.4,1) over ${BEATS.swing[1] - BEATS.swing[0]} frames (f${BEATS.swing[0]}-${BEATS.swing[1]}), ends past the hold pose and settles back ~1-2 deg (poseAmount ${POINT.overshoot} -> ${POINT.settle}, f${BEATS.settle[0]}-${BEATS.settle[1]}), holds (decision INT-T2) and lowers along the tuck-free arc over ${BEATS.armDown[1] - BEATS.armDown[0]} frames (f${BEATS.armDown[0]}-${BEATS.armDown[1]}; 16 in round 2, see INT-T3).`,
		why: `The rig's joint path (monotone cubics through ARM_POINT_MID with POINT_OVERLAP timing) moves the hand ${Math.round(pathForPoseAmount(0.5) * 100)}% of its travel in the first half of poseAmount, so easing poseAmount directly snaps the swing (v1: 123 px in one frame). Arc-length timing peaks at ~45 px/frame at the proof scale (round 3, measured on the joint chain: 45.4 px/frame on the raise, 47.9 on the lowering). A table built for another tuck than the one passed puts up to ~60 px into one frame. The hand-shape swaps (fist at 0.08, pointer at 0.4) land on fast frames (f95, f100 on the raise; f186, f190 on the lowering).`,
	},
	{
		character: 'zoo',
		id: 'INT-T3',
		sheet: 'zoo_pose_point.png shows only the end pose. The round-2 review found a 3-4 frame "tray-carry" in-between (the upper arm hanging with the elbow at the waist while the forearm swings level), on the way up and in reverse on the way down; repair round 3 re-timed the rig (ZOO-P5: upper arm ~10 deg out when the forearm is level) and added ZooRig pointTuck so a composition can keep the anticipation tuck off the lowering.',
		chosen: `Preview10s uses the tuck only on the raise and only while the fist passes Badger's head: pointTuck is a function of poseAmount, 1 up to ${POINT.tuckRelease[0]} and eased to 0 by ${POINT.tuckRelease[1]} (frames f90-96 carry it; it is gone at f97), and 0 through the hold and the lowering. Both are timed on the arc table of that exact path. The lowering takes ${BEATS.armDown[1] - BEATS.armDown[0]} frames (round 2: 16) so the frame nearest the forearm's level crossing is sampled after the upper arm has opened. Per frame on the joint chain (forearm angle from level / upper-arm abduction from rest): raise f95 -44.9/-1.7, f96 -26.8/-0.9, f97 -12.7/6.8, f98 2.4/11.3, f99 15.1/17.0; lowering f185 18.6/19.1, f186 2.8/11.5, f187 -14.9/6.3, f188 -31.9/3.1, f189 -47.0/1.4.`,
		why: "At full strength the tuck holds the elbow in until poseAmount ~0.29: with it, f96-f97 were tray-carry frames (abduction -1.0 and 4.6 deg with the forearm at -27 and -11 deg). Without it the fist passes Badger's pale ear 8 px closer (continuous closest pass 19.2 px instead of 27.2 px at 570 units), so it is kept exactly while the fist passes the ear and released before the forearm comes within ~15 deg of level. With the reviewer's standard (upper arm out >= 10-12 deg where the forearm is level), the level frames have 11.3 and 11.5 deg; the frames just before level (f97, f187) have the forearm 13-15 deg below level with the elbow 15-17 units out (elbow pivot x 127-128, at the edge of the round-2 review's 'pinned at the waist' range x 101-129), and f96 still has the elbow tucked (the tuck is at full strength there) with the forearm 27 deg below level. The rig's tuck-free path itself has only ~7 deg of abduction at -12 deg and 10 deg at level (ZOO-P5), and pointTuck and pointWindup can only close the arm, so a wider opening needs a rig change (ZOO-P5's shoulderLag), not timing.",
	},
	{
		character: 'zoo',
		id: 'INT-T2',
		sheet: 'zoo_pose_point.png shows only the end pose; Prompt 1 asks for restrained limited animation with purposeful gestures, and every hold must stay alive (the round-2 performance review: the hand moved 2 px or less over f106-181, so the gesture froze).',
		chosen: `A moving hold, f${BEATS.hold[0]}-${BEATS.hold[1]}: the raised arm sinks from poseAmount ${POINT.settle} to ${POINT.sunk} on one slow sine ease (shoulder 3.2 deg, wrist 2.8 deg; the elbow is unchanged near the end key), so the hand drops 9.2 px at the proof scale, 7.6 px with breathing included (measured on the rendered frames, ~0.15 px/frame mid-hold), and the lowering starts from that pose. Part-way through, Zoo nods once toward the point: a ~1.7 deg head tilt down and back (f${BEATS.zooNod[0]}-${BEATS.zooNod[2]}) with a blink that starts with it (f${BEATS.zooBlinks[1]}). Badger answers after the nod with his small curious tilt (f${BEATS.badgerTilt[0]}-${BEATS.badgerTilt[3]}, was f132-180) and one blink (f${BEATS.badgerHoldBlink}), so the two moves do not overlap.`,
		why: 'The reviewer asked for ~0.05 poseAmount of drift (6-10 px at the hand) with a slow ease plus a 1-2 deg nod. On the round-2 arc the end key is carried by the shoulder, and the breathing cycle lifts the arms ~1.6 px over the same frames, so 0.063 gives a net 7.6 px; a deeper sink would read as the arm tiring. The head tilt is the rig\'s only head control, so the nod is a small tilt toward the point; the blink sells it as a nod.',
	},
	{
		character: 'both',
		id: 'INT-C1',
		sheet: 'The approved sheets draw no contact shadows (the size panel has only a ground line). ART_GUIDE CV4a/LS4: Badger\'s off-white coat (L* 4.9 from the background) and Zoo\'s sneakers (L* 0.4) separate from #E6E8EB only by their outline, so every shot showing feet or paws gets one flat contact shadow in backgroundShadow. The round-2 Badger review asked for it in the proof and the sheet stills.',
		chosen: `BRAND.backgroundShadow ${BRAND.backgroundShadow} (ART_GUIDE CV2; the value the branding, episode and show themes already use) is added to palette.ts as the background colour's one flat shadow tone. Preview10s, ZooSheet and BadgerSheet draw one flat ellipse under each figure (src/compositions/characters/contact.tsx, FOOTPRINTS: measured sole, paw, wheel or leg extents + 10 units, e.g. Zoo front rx ${FOOTPRINTS.zooFront.rx}, Badger 'left' rx ${FOOTPRINTS.badgerLeft.rx}; ry 15-16 units). In the proof the shadows sit over the silver ground line (the line passes behind the feet); on the sheets the near-black baseline runs over them, so it stays unbroken. No blur, opacity or gradient.`,
		why: 'ART_GUIDE is the craft guide and PROJECT_INSTRUCTIONS allows one flat shadow tone per colour; the background stays plain #E6E8EB. ART_GUIDE asks for the owner\'s sign-off on the palette entry, so it is recorded here and is still pending.',
	},
	{
		character: 'both',
		id: 'INT-L1',
		sheet: 'The sheet keeps a near-constant screen line weight: close-up panels (zoo_expr_*, badger_expr_*) draw outlines at about half of LINE.width in world units (1.4-2.1 units at 0.699 units/px).',
		chosen: `Every composition passes lineScale to both rigs. Full-body framings use ART_GUIDE SL5 (outline clamp(3.5 x k, 3, 6) px, k = output px per unit): the proof pair at ${PAIR_SCALE} gives ${PAIR_LINE_SCALE.toFixed(2)}, the Zoo sheet row at 0.54 gives ${fullLineScale(0.54).toFixed(2)}, Badger's pose row at 0.5 gives ${fullLineScale(0.5).toFixed(2)}. Close-ups keep the sheet's close-up weight (half of LINE.width), floored at 3 px and capped at 6 px: MouthDemo bust ${closeLineScale(900 / 280).toFixed(2)}, sheet busts ${closeLineScale(322 / 279.6).toFixed(2)} (Zoo) and ${closeLineScale(1.42).toFixed(2)} (Badger).`,
		why: 'Fixed world-unit strokes were about twice the sheet weight in close-ups and under SL5\'s 3 px floor on the small sheet rows.',
	},
	{
		character: 'badger',
		id: 'INT-A2',
		sheet: 'Prompt 2: Badger looks toward the gesture with a small head turn, looks up at Zoo, then gives a restrained judging reaction. Prompt 1: emotion through brows, folded ears, head angle and tail; eyes open between natural blinks.',
		chosen: `Every head replacement in the proof happens with Badger's eyes closed, and the two big turns go through held in-betweens (integration round 3). The turn to the 3/4 head under a blink (f${BEATS.badgerTurn}). The look-up: the eyes and neck lead (f${BEATS.badgerLookUp.eyes[0]}-${BEATS.badgerLookUp.eyes[1]}), then, eyes closed, a front-head breakdown held ${BEATS.badgerLookUp.toUp - BEATS.badgerLookUp.toFront} frames (f${BEATS.badgerLookUp.toFront}-${BEATS.badgerLookUp.toUp - 1}; round 2: 2) that keeps rising and rolls toward the up head's pitch, then upLeftScreen (f${BEATS.badgerLookUp.toUp}); the blink holds until that frame. The judging look: on the up head the neck eases down over ${BEATS.judge.neckDown[1] - BEATS.judge.neckDown[0]} frames (f${BEATS.judge.neckDown[0]}-${BEATS.judge.neckDown[1]}) while a slow blink closes (f${BEATS.judge.blink}), then threeQuarterLeftScreen holds ${BEATS.judge.swap - BEATS.judge.toThreeQuarter} frames (f${BEATS.judge.toThreeQuarter}-${BEATS.judge.swap - 1}, a slight upward roll), then the front head (f${BEATS.judge.swap}); the eyes open on Zoo, the judge brows, ears 0.42 and the ~8 deg tilt follow, with one slow push-in (1.00 -> 1.04, f${BEATS.pushIn[0]}-${BEATS.pushIn[1]}, ART_GUIDE MO13) anchored on his eyes. Neck and tilt at each swap keep the skull where the old head left it, measured on Badger-only renders (centroid of the skull's top 70 px): +6.0 px down at f${BEATS.badgerLookUp.toFront} (the turn dips as it starts), 3.5 px at f${BEATS.badgerLookUp.toUp}, 4.2 px sideways at f${BEATS.judge.toThreeQuarter} and 4.5 px up at f${BEATS.judge.swap}. Idle life in 0-3 s: one blink and one ear flick.`,
		why: 'The round-2 review found the judge swap popping in one frame from the profile pitched up at Zoo to a level frontal head (the nose moved half a head length and the ears changed from one hanging profile ear to two frontal ears), and the look-up going 3/4-right, front, up-left in three frames. Lowering the up head first and passing through the 3/4-left head turns both into readable head turns; the judging look stays on the front head because there the lids and brows read (on the pitched profile each cue moved only 2-7 px).',
	},
	{
		character: 'badger',
		id: 'INT-S1',
		sheet: 'BADGER-D23 (revised): sit and lie exist in both facings; round 3: the left-facing ones are PROVISIONAL pending the owner (BADGER_PROVISIONAL_POSES).',
		chosen: `BadgerSheet shows sit and lie in both facings (each pair faces each other so the left- and right-side markings sit side by side), plus walk and look-up, at scale 0.5. Each left-facing sit and lie carries a small, quiet caption below its ground line, centred on the drawing (not the root), "${PROVISIONAL_CAPTION}" (Inter 400, 17 px, slate; marked as an owner-only review badge for QA), drawn for every pose on BADGER_PROVISIONAL_POSES.`,
		why: 'The asset sheet should show every implemented pose body; the left-facing ones carry different markings (LEFT coat map) but reuse the right-facing silhouette mirrored, so the sheet must not present them as finished until the owner accepts D23.',
	},
	{
		character: 'badger',
		id: 'INT-Q1',
		sheet: 'BADGER-D23 is provisional: the left-facing sit and lie keep working, and tools should warn wherever a scene uses them.',
		chosen: 'Visual QA (scripts/qa) reports model-provisional, always a WARNING and never an error, for any Badger instance whose drawn view and pose are on BADGER_PROVISIONAL_POSES (today view left with sit or lie). It reads the list the way the Badger index exports it (src/characters/badger/index.ts; Node follows its re-export to src/characters/badger/provisional.ts because the index also loads the React components), falls back to this manifest\'s provisional.badger, and reports nothing once the index stops exporting it. Unit tests: scripts/qa/tests/provisional.test.ts.',
		why: 'A warning keeps the poses usable for reviews and sheets while making every episode use visible in the QA report until the owner decides.',
	},
];

const zooFront = ZOO_MANIFEST.pivots;
const manifest = {
	manifest: 'zoora-characters',
	version: '1.0.0',
	date: '2026-11-24',
	binding: 'docs/PROJECT_INSTRUCTIONS.md (reference priority, locked designs, style); human guide: docs/CHARACTERS.md',
	sources: {
		sheets: {
			zoo: {path: 'reference/model-sheets/zoo_model_sheet_v1.png', sha256: sha('reference/model-sheets/zoo_model_sheet_v1.png')},
			badger: {path: 'reference/model-sheets/badger_model_sheet_v1.png', sha256: sha('reference/model-sheets/badger_model_sheet_v1.png')},
		},
		bindingCrops: Object.fromEntries(crops.map((c) => [c, sha(c)])),
		code: {
			zoo: 'src/characters/zoo (Zoo.tsx, rig.ts, manifest.ts, views/pivots.ts)',
			badger: 'src/characters/badger (Badger.tsx, manifest.ts, spots.ts; rigs and heads GENERATED by dev/trace/build.sh)',
			index: 'src/characters/index.ts',
		},
	},
	units: {
		world: 'shared world units: at scale 1, 1 unit = 1 px; Zoo is exactly 900 units sole to top of hair (front view)',
		origin: 'each character origin (0,0) = ground contact point = centre of the footprint; y grows downward (SVG)',
		names: 'part and prop names ending in L/R (or Left/Right) are ANATOMICAL unless suffixed "Screen"',
	},
	palette: {
		rule: 'solid fills only; at most ONE flat shadow tone per colour; no gradients, filters, patterns, soft masks, texture, halftone or glow',
		brand: BRAND,
		line: LINE,
		zoo: ZOO_COLORS,
		badger: BADGER_COLORS,
		badgerKeysUnused: BADGER_MANIFEST.paletteKeysUnused,
		props: PROP_COLORS,
	},
	scale: {
		zoo: {
			height: FRONT.totalHeight,
			headHeight: FRONT.headHeight,
			headsTall: r(FRONT.headsTall),
			shoulderWidth: FRONT.shoulderWidth,
			hipWidth: FRONT.hipWidth,
			legLength: FRONT.legLength,
			eyeSpacing: FRONT.eyeSpacing,
			eyeLine: FRONT.eyeLine,
			mouthLine: FRONT.mouthLine,
		},
		badger: {
			heightAtWithers: BADGER_MANIFEST.dimensions.binding.heightAtWithers.units,
			headTop: BADGER_MANIFEST.dimensions.binding.headTop.units,
			earTop: BADGER_MANIFEST.dimensions.binding.earTop.units,
			bodyLength: BADGER_MANIFEST.dimensions.binding.bodyLength.units,
			chestBottom: BADGER_MANIFEST.dimensions.binding.chestBottom.units,
			skullWidth: BADGER_MANIFEST.dimensions.binding.skullWidth.units,
		},
		ratios: {
			badgerWithersToZoo: BADGER_MANIFEST.dimensions.ratios.withersToZoo,
			badgerHeadTopToZoo: BADGER_MANIFEST.dimensions.ratios.headTopToZoo,
			badgerBodyLengthToWithers: BADGER_MANIFEST.dimensions.ratios.bodyLengthToWithers,
		},
		measuredOn: `${SIZE_COMPARISON.source}: Zoo ${SIZE_COMPARISON.zooHeightPx} px = 900 units (${r(SIZE_COMPARISON.unitsPerPx, 4)} units/px), ground y=498`,
		sizeComparison: {zooOriginPx: SIZE_COMPARISON.zooOriginPx, badgerOriginPx: SIZE_COMPARISON.badgerOriginPx, spacingUnits: SIZE_COMPARISON.spacingUnits},
		usage: 'give both characters the SAME scale value; relative size is then exact',
		pairShotStaging: {scale: PAIR_SCALE, groundYpx: GROUND_Y, spacingUnits: PAIR_SPACING, lineScale: r(PAIR_LINE_SCALE, 3), note: 'see decisions INT-P2, INT-L1 and INT-C1'},
		contactShadows: {
			colour: BRAND.backgroundShadow,
			rule: 'decision INT-C1: one flat ellipse per figure, centred on its ground point + cx (world units, times scale), radii rx/ry; component ContactShadow in src/compositions/characters/contact.tsx',
			footprints: FOOTPRINTS,
		},
		lineWeights: {
			rule: 'decision INT-L1: both rigs take lineScale (multiplier on every stroke). Full body: ART_GUIDE SL5, outline clamp(3.5 x k, 3, 6) px with k = output px per unit (fullLineScale). Close-ups: half of LINE.width in world units, clamped to 3..6 px (closeLineScale). Same value for both characters in a two-shot.',
			zooLine: ZOO_LINE,
			examples: {proofPair: r(PAIR_LINE_SCALE, 3), zooSheetRow: r(fullLineScale(0.54), 3), badgerPoseRow: r(fullLineScale(0.5), 3), mouthDemoBust: r(closeLineScale(900 / 280), 3), zooSheetBust: r(closeLineScale(322 / 279.6), 3), badgerSheetBust: r(closeLineScale(1.42), 3)},
		},
	},
	conventions: {
		zoo: {
			front: "anatomical LEFT = screen RIGHT: pin (teal jellyfish) + chest pocket on screen right, five silver buttons on the screen-left panel; the anatomical-left brow sits slightly higher at rest; pose 'point' raises the anatomical-left arm to screen right",
			threeQuarter: 'body turned to screen right; near side = anatomical RIGHT; pin on the far (anatomical left) panel above the pocket',
			side: 'profile facing screen right; anatomical RIGHT side visible; pin, far arm and far leg hidden',
			back: 'anatomical LEFT = screen LEFT; pin, pocket and buttons hidden; big hair wings on screen right',
			typing: "seated 3/4 facing screen right (the sheet's only typing drawing); ignores view",
			mirroring: ZOO_MANIFEST.conventions.mirroring,
		},
		badger: {
			left: 'faces screen LEFT; anatomical LEFT side toward camera (coat_left markings L-*); default head front; the dark-capped ear is the anatomical LEFT ear',
			right: 'faces screen RIGHT; anatomical RIGHT side toward camera (coat_right markings R-*); default head profileRightScreen (pale right ear near)',
			front: 'anatomical LEFT = screen RIGHT: dark ear on screen right',
			back: 'anatomical LEFT = screen LEFT: dark ear on screen left; top-map markings T-* projected onto the back',
			threeQuarter: 'right flank toward camera, head threeQuarterRightScreen',
			heads: 'replaceable head views: front, threeQuarterLeftScreen, threeQuarterRightScreen, profileLeftScreen, profileRightScreen, upLeftScreen, upRightScreen; dark cap always on the anatomical LEFT ear, small spot on the pale RIGHT ear',
			poses: "sit and lie exist in both facings: view 'left' gives the left-facing bodies (LEFT coat-map markings, head threeQuarterLeftScreen; their unmarked outline is the right-facing silhouette mirrored about the root, decision BADGER-D23, PROVISIONAL until the owner accepts it: see provisional.badger), any other view the right-facing panels (right-side markings); walk and lookUp on both side rigs; no marking is ever mirrored",
		},
	},
	pivots: roundAll({
		zoo: {
			front: zooFront,
			threeQuarter: ZOO_MANIFEST.viewPivots.threeQuarter,
			side: ZOO_MANIFEST.viewPivots.side,
			back: ZOO_MANIFEST.viewPivots.back,
			typing: ZOO_MANIFEST.viewPivots.typing,
			space: ZOO_MANIFEST.conventions.coordinateSpaces,
		},
		badger: {
			left: BADGER_MANIFEST.pivots,
			right: BADGER_MANIFEST.pivotsRight,
			front: BADGER_MANIFEST.viewPivots.front,
			back: BADGER_MANIFEST.viewPivots.back,
			threeQuarter: BADGER_MANIFEST.viewPivots.threeQuarter,
			sit: BADGER_MANIFEST.posePivots.sit,
			lie: BADGER_MANIFEST.posePivots.lie,
			sitLeft: BADGER_MANIFEST.posePivots.sitLeft,
			lieLeft: BADGER_MANIFEST.posePivots.lieLeft,
			heads: BADGER_MANIFEST.headPivots,
		},
	}),
	markings: {
		badger: {
			rule: 'frozen coat pattern: every marking has a stable id and is bound to its part (paths in src/characters/badger/spots.ts, part-local units); no randomness; never mirrored',
			counts: {
				left: LEFT_SPOTS.length,
				right: RIGHT_SPOTS.length,
				front: FRONT_SPOTS.length,
				back: BACK_SPOTS.length,
				threeQuarter: THREE_QUARTER_SPOTS.length,
				sit: SIT_SPOTS.length,
				lie: LIE_SPOTS.length,
				sitLeft: SIT_LEFT_SPOTS.length,
				lieLeft: LIE_LEFT_SPOTS.length,
			},
			left: spotList(LEFT_SPOTS),
			right: spotList(RIGHT_SPOTS),
			front: spotList(FRONT_SPOTS),
			back: spotList(BACK_SPOTS),
			threeQuarter: spotList(THREE_QUARTER_SPOTS),
			sit: spotList(SIT_SPOTS),
			lie: spotList(LIE_SPOTS),
			sitLeft: spotList(SIT_LEFT_SPOTS),
			lieLeft: spotList(LIE_LEFT_SPOTS),
			frontNeck: spotList(FRONT_NECK_SPOTS),
			head: HEAD_MARKINGS.map((m) => ({id: m.id, side: m.side, part: 'head', views: Object.keys(m.paths).length ? Object.keys(m.paths) : 'ear fill (all head views)'})),
		},
		zoo: {
			pin: ZOO_MANIFEST.conventions.pin,
			pocket: ZOO_MANIFEST.conventions.pocket,
			buttons: ZOO_MANIFEST.conventions.buttons,
		},
	},
	provisional: {
		badger: {
			...BADGER_MANIFEST.provisional,
			source: 'BADGER_PROVISIONAL_POSES (src/characters/badger/provisional.ts, exported by src/characters/badger/index.ts)',
			tools: 'visual QA warns model-provisional for these drawings (decision INT-Q1); BadgerSheet captions them (INT-S1)',
		},
	},
	proof: {
		composition: 'Preview10s (src/compositions/characters/Preview10s.tsx), 1920x1080, 30 fps, 300 frames, silent',
		beats: BEATS,
		note: 'frame numbers at 30 fps; see decisions INT-T1, INT-T2, INT-T3, INT-A2, INT-C1 and docs/CHARACTERS.md',
	},
	decisions: [...zooDecisions, ...badgerDecisions, ...integrationDecisions],
};

/** JSON with nested objects indented, but leaf records (only primitives or arrays of primitives) on one line. */
const isLeaf = (v: unknown) =>
	v !== null &&
	typeof v === 'object' &&
	Object.values(v as object).every((x) => x === null || typeof x !== 'object' || (Array.isArray(x) && x.every((y) => typeof y !== 'object')));
const fmt = (v: unknown, ind: string): string => {
	if (v === null || typeof v !== 'object') return JSON.stringify(v);
	if (isLeaf(v) && JSON.stringify(v).length <= 160) return JSON.stringify(v).replace(/":/g, '": ').replace(/,"/g, ', "');
	const next = ind + '  ';
	if (Array.isArray(v)) return `[\n${v.map((x) => next + fmt(x, next)).join(',\n')}\n${ind}]`;
	return `{\n${Object.entries(v).map(([k, x]) => `${next}${JSON.stringify(k)}: ${fmt(x, next)}`).join(',\n')}\n${ind}}`;
};

const out = join(ROOT, 'src/characters/manifest.v1.json');
writeFileSync(out, fmt(manifest, '') + '\n');
console.log('wrote', out, 'decisions:', manifest.decisions.length, 'left spots:', LEFT_SPOTS.length, 'right spots:', RIGHT_SPOTS.length);
