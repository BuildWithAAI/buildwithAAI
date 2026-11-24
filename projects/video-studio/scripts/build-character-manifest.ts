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
import {BEATS} from '../src/compositions/characters/Preview10s';
import {POINT_PATH_LENGTH} from '../src/compositions/characters/gesture';
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
		chosen: `When Zoo points to screen right over Badger, the pair stands ${PAIR_SPACING} units apart and Badger is drawn in front of Zoo (depth), for the whole shot (no sliding). Scale and ground line stay the panel's.`,
		why: "Re-measured on the repaired point path (ZOO-P2) in integration round 1: at the panel spacing the swinging hand overlaps Badger's pale ear at poseAmount ~0.2 (front and 3/4 heads), which reads as touching him. At 560 units the closest approach is 24.5 px at the proof scale (poseAmount ~0.26). Spacing is staging, not anatomy; relative scale is unchanged.",
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
		chosen: `The point is timed along the hand's arc, not in poseAmount: gesture.ts maps a path fraction to poseAmount through the rig's own pivots and angle function (hand path ${Math.round(POINT_PATH_LENGTH)} units). The swing eases the path fraction with bezier(0.38,0,0.4,1) over 16 frames (f${BEATS.swing[0]}-${BEATS.swing[1]}), ends past the hold pose and settles back ~1-2 deg (poseAmount 1 -> 0.993), then holds with a slow ~2 deg forearm drift; the arm lowers along the same arc over 16 frames.`,
		why: "The rig's joint path moves the hand 71% of its travel in the first half of poseAmount, so easing poseAmount directly snapped the swing (v1: 123 px in one frame). Arc-length timing peaks at ~49 px/frame, like the lowering, and puts the loose-fist swap on the fastest frame.",
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
		chosen: `Every head replacement in the proof happens with Badger's eyes closed: the turn to the 3/4 head under a blink (f${BEATS.badgerTurn}), the look-up swaps (3/4 -> front breakdown -> upLeftScreen, f${BEATS.badgerLookUp.toFront}/${BEATS.badgerLookUp.toUp}) under a blink with the eyes and the neck leading, the neck values chosen so the cranium stays put across each swap. The judging look plays on the FRONT head (eyes kept on Zoo, judge brows, ears 0.42, ~8 deg tilt) after a slow blink covers the swap from the up head, with one slow push-in (1.00 -> 1.04, f${BEATS.pushIn[0]}-${BEATS.pushIn[1]}, ART_GUIDE MO13) anchored on his eyes. Idle life in 0-3 s: one blink and one ear flick.`,
		why: 'The v1 look-up swapped three silhouettes in three frames with no blink (a pop and head-bob), and the judge on the pitched profile head moved each cue by only 2-7 px. On the front head each cue moves 6-8 px and the brows and lids read.',
	},
	{
		character: 'badger',
		id: 'INT-S1',
		sheet: 'BADGER-D23 (revised): sit and lie exist in both facings.',
		chosen: 'BadgerSheet shows sit and lie in both facings (each pair faces each other so the left- and right-side markings sit side by side), plus walk and look-up, at scale 0.5.',
		why: 'The asset sheet should show every implemented pose body; the left-facing ones carry different markings (LEFT coat map).',
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
		pairShotStaging: {scale: PAIR_SCALE, groundYpx: GROUND_Y, spacingUnits: PAIR_SPACING, lineScale: r(PAIR_LINE_SCALE, 3), note: 'see decisions INT-P2 and INT-L1'},
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
			poses: "sit and lie exist in both facings: view 'left' gives the left-facing bodies (LEFT coat-map markings, head threeQuarterLeftScreen; their unmarked outline is the right-facing silhouette mirrored about the root, decision BADGER-D23), any other view the right-facing panels (right-side markings); walk and lookUp on both side rigs; no marking is ever mirrored",
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
	proof: {
		composition: 'Preview10s (src/compositions/characters/Preview10s.tsx), 1920x1080, 30 fps, 300 frames, silent',
		beats: BEATS,
		note: 'frame numbers at 30 fps; see decisions INT-T1, INT-A2 and docs/CHARACTERS.md',
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
