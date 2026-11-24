/**
 * Builds src/characters/manifest.v1.json, the one reusable character manifest (ZOO + Badger), from the source of
 * truth: the per-character TS manifests, rig pivot tables, spot records, palette and the approved sheets (sha256).
 * Run from projects/video-studio:
 *   npx esbuild scripts/build-character-manifest.ts --bundle --platform=node --format=cjs --jsx=automatic \
 *     --loader:.png=empty --outfile=/tmp/build-character-manifest.cjs && node /tmp/build-character-manifest.cjs
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
import {BACK_SPOTS, FRONT_NECK_SPOTS, FRONT_SPOTS, HEAD_MARKINGS, LEFT_SPOTS, LIE_SPOTS, RIGHT_SPOTS, SIT_SPOTS, THREE_QUARTER_SPOTS, type BadgerSpot} from '../src/characters/badger/spots';
import {GROUND_Y, FRAME, PAIR_SCALE, PAIR_SPACING} from '../src/compositions/characters/stage';

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
		sheet: 'badger_size_comparison.png: ZOO screen left, Badger (left side toward camera, face turned to camera) screen right, one ground line.',
		chosen: `Pair shots use one shared scale (both characters' world units are the same; ${PAIR_SCALE} in the 1920x1080 proof), ground contact at ${GROUND_Y} px (85% of ${FRAME.height}), Badger view 'left' with head 'front'.`,
		why: 'The size-comparison panel controls relative scale; same scale value = correct relative size.',
	},
	{
		character: 'both',
		id: 'INT-P2',
		sheet: `The panel stands the pair ${SIZE_COMPARISON.spacingUnits} units apart (ground point to ground point); Badger's head sits just beside ZOO's hanging hand.`,
		chosen: `When ZOO points to screen right over Badger, the pair stands ${PAIR_SPACING} units apart and Badger is drawn in front of ZOO (depth). Scale and ground line stay the panel's.`,
		why: "Any sideways arm lift passed through Badger's head at the panel spacing (the hand read as touching him); with the INT-Z3 path the arm clears his head from 554 units. Spacing is staging, not anatomy; relative scale is unchanged.",
	},
	{
		character: 'both',
		id: 'INT-A1',
		sheet: 'Prompt 2: proof is silent unless narration is supplied; mouth shapes are demonstrated separately.',
		chosen: 'Preview10s has no audio track; MouthDemo cycles the six shapes one per second with an on-screen note "Mouth library demo — silent, not lip-synced". Sheet stills render the rig with no labels copied from the model sheets.',
		why: 'PROJECT_INSTRUCTIONS: do not claim lip-sync without an audio track; never use the labelled model sheet in scene.',
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
		world: 'shared world units: at scale 1, 1 unit = 1 px; ZOO is exactly 900 units sole to top of hair (front view)',
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
		measuredOn: `${SIZE_COMPARISON.source}: ZOO ${SIZE_COMPARISON.zooHeightPx} px = 900 units (${r(SIZE_COMPARISON.unitsPerPx, 4)} units/px), ground y=498`,
		sizeComparison: {zooOriginPx: SIZE_COMPARISON.zooOriginPx, badgerOriginPx: SIZE_COMPARISON.badgerOriginPx, spacingUnits: SIZE_COMPARISON.spacingUnits},
		usage: 'give both characters the SAME scale value; relative size is then exact',
		pairShotStaging: {scale: PAIR_SCALE, groundYpx: GROUND_Y, spacingUnits: PAIR_SPACING, note: 'see decision INT-P2'},
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
			poses: "sit and lie exist only facing screen right (right-side markings); walk and lookUp on both side rigs; nothing is mirrored to make another view",
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
			},
			left: spotList(LEFT_SPOTS),
			right: spotList(RIGHT_SPOTS),
			front: spotList(FRONT_SPOTS),
			back: spotList(BACK_SPOTS),
			threeQuarter: spotList(THREE_QUARTER_SPOTS),
			sit: spotList(SIT_SPOTS),
			lie: spotList(LIE_SPOTS),
			frontNeck: spotList(FRONT_NECK_SPOTS),
			head: HEAD_MARKINGS.map((m) => ({id: m.id, side: m.side, part: 'head', views: Object.keys(m.paths).length ? Object.keys(m.paths) : 'ear fill (all head views)'})),
		},
		zoo: {
			pin: ZOO_MANIFEST.conventions.pin,
			pocket: ZOO_MANIFEST.conventions.pocket,
			buttons: ZOO_MANIFEST.conventions.buttons,
		},
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
