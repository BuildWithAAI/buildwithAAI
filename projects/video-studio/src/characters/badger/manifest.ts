/**
 * BADGER character manifest v1.0.0 (baseline 2026-11-24). Reuse this baseline in every episode; change it
 * only through a new version with a recorded decision. World units: ZOO = 900 units tall at scale 1;
 * origin (0,0) = ground contact point = centre of the footprint; y grows downward (SVG).
 */
import {BADGER_COLORS, LINE} from '../palette';
import type {BadgerHead} from '../types';
import {HEAD_GEOM} from './parts/heads/headGeom';
import {LEFT_RIG} from './parts/rigLeft';
import {LEFT_SPOT_COUNT, LEFT_SPOTS, HEAD_MARKINGS, FRONT_NECK_SPOTS} from './spots';

export type Pivot = {readonly x: number; readonly y: number; readonly parent: string; readonly space: string};

export type ContinuityDecision = {
	readonly id: string;
	readonly sheetShowed: string;
	readonly chosen: string;
	readonly why: string;
};

export type BadgerManifest = {
	readonly character: 'BADGER';
	readonly version: '1.0.0';
	readonly sources: readonly string[];
	readonly paletteKeysUsed: readonly (keyof typeof BADGER_COLORS)[];
	readonly paletteKeysUnused: readonly (keyof typeof BADGER_COLORS)[];
	readonly line: typeof LINE;
	readonly dimensions: {
		readonly measuredOn: string;
		readonly zooPx: number;
		readonly unitsPerPx: number;
		readonly binding: Record<string, {readonly px: number; readonly units: number; readonly ratioToZoo: number}>;
		readonly ratios: Record<string, number>;
		readonly rigCheck: Record<string, number>;
	};
	readonly anatomy: {readonly conventions: readonly string[]};
	readonly views: {readonly implemented: readonly string[]; readonly headViews: readonly BadgerHead[]; readonly poses: Record<string, string>};
	readonly pivots: Record<string, Pivot>;
	readonly headPivots: Record<string, Record<string, Pivot>>;
	readonly markings: {readonly leftBodySpotCount: number; readonly leftBodySpotIds: readonly string[]; readonly headIds: readonly string[]; readonly frontNeckIds: readonly string[]};
	readonly decisions: readonly ContinuityDecision[];
};

const R = LEFT_RIG;
const T = R.torso.pivot;
const M = R.mounts;

const legPivots = (name: string, mount: {x: number; y: number}, kind: 'front' | 'hind'): Record<string, Pivot> => {
	const g = kind === 'front' ? R.legFront : R.legHind;
	return {
		[`${name}.upper`]: {x: mount.x, y: mount.y, parent: 'torso', space: 'torso-local'},
		[`${name}.lower`]: {x: g.lowerPivot.x, y: g.lowerPivot.y, parent: `${name}.upper`, space: `${name}.upper-local`},
		[`${name}.paw`]: {x: g.pawPivot.x, y: g.pawPivot.y, parent: `${name}.lower`, space: `${name}.lower-local`},
	};
};

const headPivotsFor = (view: BadgerHead): Record<string, Pivot> => {
	const g = HEAD_GEOM[view];
	const out: Record<string, Pivot> = {head: {x: 0, y: 0, parent: 'neck (headMount + per-view offset, see Badger.tsx LEFT_HEAD_MOUNT)', space: 'head-local'}};
	for (const e of [...g.earsBehind, ...g.earsFront]) {
		out[`ear${e.side === 'L' ? 'Left' : 'Right'}`] = {x: e.pivot.x, y: e.pivot.y, parent: 'head', space: 'head-local'};
	}
	for (const e of g.eyes) {
		out[`eye${e.side === 'L' ? 'Left' : 'Right'}`] = {x: e.c.x, y: e.c.y, parent: 'head', space: 'head-local'};
	}
	return out;
};

const HEAD_VIEWS: BadgerHead[] = [
	'front',
	'threeQuarterLeftScreen',
	'threeQuarterRightScreen',
	'profileLeftScreen',
	'profileRightScreen',
	'upLeftScreen',
	'upRightScreen',
];

const ZOO_PX = 478; // badger_size_comparison.png (2x crop): ZOO sole 498 .. top of hair 20
const UPP = 900 / ZOO_PX; // 1.8828 world units per crop px
const b = (px: number) => ({px, units: Math.round(px * UPP * 10) / 10, ratioToZoo: Math.round((px / ZOO_PX) * 1000) / 1000});

export const BADGER_MANIFEST: BadgerManifest = {
	character: 'BADGER',
	version: '1.0.0',
	sources: [
		'reference/model-sheets/badger_model_sheet_v1.png',
		'reference/crops/badger_size_comparison.png (scale)',
		'reference/crops/badger_coat_left.png (left body + markings, left profile head)',
		'reference/crops/badger_coat_right.png (right profile head + pale-ear spot)',
		'reference/crops/badger_expr_neutral|happy|worried|shocked.png (front head + expressions)',
		'reference/crops/badger_turn_34.png (3/4 calibration), badger_pose_looking_up.png (look-up check)',
	],
	paletteKeysUsed: [
		'coat',
		'coatShadow',
		'spot',
		'earCap',
		'earPaleInner',
		'nose',
		'eyeIris',
		'eyeWhite',
		'pupil',
		'mouth',
		'tongue',
		'brow',
		'collar',
		'collarShadow',
		'tag',
		'tagShadow',
	],
	paletteKeysUnused: ['earPale'],
	line: LINE,
	dimensions: {
		measuredOn: 'reference/crops/badger_size_comparison.png (2x crop of the approved sheet; ground line y=498)',
		zooPx: ZOO_PX,
		unitsPerPx: Math.round(UPP * 10000) / 10000,
		binding: {
			zooHeight: b(478),
			heightAtWithers: b(166), // back line outer edge y=332
			headTop: b(240), // skull top y=258 (head turned to camera, as in the panel)
			earTop: b(242), // ear tips y=256
			bodyLength: b(185), // chest front x=288 .. rump rear x=473
			chestBottom: b(91), // brisket underline y=407
			waistUnderline: b(112), // tuck-up y=386
			skullWidth: b(54), // at eye level, slight 3/4 turn
		},
		ratios: {
			withersToZoo: 0.347,
			headTopToZoo: 0.502,
			bodyLengthToWithers: 1.114,
			chestDepthToWithers: 0.45,
			headTopToWithers: 1.446,
			headsTallAtHeadTop: Math.round((451.9 / 123) * 100) / 100, // front head skull top to chin = 123 units
		},
		rigCheck: {
			// measured on the v1.0.0 render (dev BadgerLeft, head 'front', scale 1)
			heightAtWithersOuter: 314.4,
			earTop: 455.6,
			chestFrontX: -182.5,
			rumpRearX: 165.6,
			bodyLength: 348.1,
			footprintMinX: -185.6,
			footprintMaxX: 185.0,
			frontHeadSkullWidth: 98,
			frontHeadHeight: 123,
			lineWidth: LINE.width,
		},
	},
	anatomy: {
		conventions: [
			"Prop and part names are ANATOMICAL unless suffixed 'Screen'.",
			"view 'left': the dog faces SCREEN LEFT and its ANATOMICAL LEFT side faces the camera (badger_coat_left.png).",
			"In view 'left' the near legs are the anatomical LEFT legs (legFrontNear, legHindNear); the far legs are the RIGHT legs, drawn behind in coatShadow with no visible markings.",
			"Front head: anatomical left = screen right. The DARK-capped ear is the anatomical LEFT ear in every head view (screen right in 'front'; the near ear in left-facing views; the far ear in right-facing views).",
			'The pale anatomical RIGHT ear carries the small spot H-EAR-R-SPOT.',
			'No view is produced by horizontally flipping the character or any marking (see decisions D-08, D-09).',
		],
	},
	views: {
		implemented: ['left'],
		headViews: HEAD_VIEWS,
		poses: {
			stand: 'implemented (left)',
			lookUp: "implemented as head 'upLeftScreen' + raised neck (left)",
			sit: 'not built in v1: falls back to stand',
			lie: 'not built in v1: falls back to stand',
			walk: 'not built in v1: falls back to stand (leg pivots are ready)',
		},
	},
	pivots: {
		root: {x: 0, y: 0, parent: 'none', space: 'world (ground contact, centre of footprint)'},
		torso: {x: T.x, y: T.y, parent: 'root', space: 'world'},
		neck: {x: M.neck.x, y: M.neck.y, parent: 'torso', space: 'torso-local'},
		headMount: {x: R.neck.headMount.x, y: R.neck.headMount.y, parent: 'neck', space: 'neck-local'},
		tagAnchor: {x: R.neck.tagAnchor.x, y: R.neck.tagAnchor.y, parent: 'neck', space: 'neck-local (tag counter-rotates to hang plumb)'},
		tail: {x: M.tail.x, y: M.tail.y, parent: 'torso', space: 'torso-local (curve driven by tailWag)'},
		...legPivots('legFrontNear', M.legFrontNear, 'front'),
		...legPivots('legFrontFar', M.legFrontFar, 'front'),
		...legPivots('legHindNear', M.legHindNear, 'hind'),
		...legPivots('legHindFar', M.legHindFar, 'hind'),
	},
	headPivots: Object.fromEntries(HEAD_VIEWS.map((v) => [v, headPivotsFor(v)])),
	markings: {
		leftBodySpotCount: LEFT_SPOT_COUNT,
		leftBodySpotIds: LEFT_SPOTS.map((s) => s.id),
		headIds: HEAD_MARKINGS.map((m) => m.id),
		frontNeckIds: FRONT_NECK_SPOTS.map((s) => s.id),
	},
	decisions: [
		{
			id: 'BADGER-D01-scale',
			sheetShowed:
				'Size panel: withers 312.6, head top 451.9, ear top 455.6, body length 348 units (body:withers 1.11). The left coat map draws a longer body (1.23 at the same withers height).',
			chosen: 'Size-panel numbers are binding. The coat-map trace is mapped with ky 1.0455 / kx 0.9398 so withers and body length hit the panel exactly.',
			why: 'Reference priority: the size-comparison panel controls relative scale. The coat map still controls where every marking sits on each part.',
		},
		{
			id: 'BADGER-D02-stance',
			sheetShowed: 'Coat map: far front leg hidden behind the near leg. Size panel: both far legs placed forward and visible.',
			chosen: "view 'left' stand uses the size-panel stance: far front leg 38 sheet px forward of the near leg, far hind leg 33 px forward, both in coatShadow.",
			why: 'The standing view is the one shown next to ZOO and must match that panel. The stance does not change any marking (leg spots ride on their segments).',
		},
		{
			id: 'BADGER-D03-dark-ear-top-map',
			sheetShowed: 'badger_coat_top.png draws the dark ear on the side that is the dog’s anatomical RIGHT in a top view.',
			chosen: 'The dark cap is on the anatomical LEFT ear in every view.',
			why: 'Reference priority: the front head controls which ear is dark (dark ear on viewer’s right in the front view).',
		},
		{
			id: 'BADGER-D04-withers-patch-side',
			sheetShowed:
				'badger_turn_side.png (dog facing right, i.e. showing its right side) draws the large withers patch; badger_coat_right.png shows only a sliver of it at the top line.',
			chosen: 'The large patch L-WITHERS belongs to the LEFT side (it may show as a sliver over the top line from the right).',
			why: 'Labeled coat maps control body markings; PROJECT_INSTRUCTIONS places the patch near the LEFT withers.',
		},
		{
			id: 'BADGER-D05-cheek-spots',
			sheetShowed: 'Front/expression heads show one cheek spot on each side; every profile drawing (coat maps, turnaround side, looking-up) shows none.',
			chosen: 'H-CHEEK-L / H-CHEEK-R are drawn in front and 3/4 heads and hidden in profile and look-up heads.',
			why: 'The front head controls facial markings and these spots sit on the front plane of the cheek beside the muzzle; the profiles on the sheet consistently omit them.',
		},
		{
			id: 'BADGER-D06-forearm-spot',
			sheetShowed: 'Coat map shows a spot on the near forearm; the small size panel omits it.',
			chosen: 'Spot L-09 is kept on legFrontNear.upper.',
			why: 'Coat maps control body markings; the size panel only controls scale.',
		},
		{
			id: 'BADGER-D07-default-head',
			sheetShowed: 'In the size panel the body faces left and the face is turned to camera with only a slight lean to screen left.',
			chosen: "Default head for view 'left' is 'front' (threeQuarterLeftScreen is a true 3/4).",
			why: 'Measured: the panel nose sits ~16 units left of the skull centre, far closer to the front head than to the turnaround 3/4 (nose at the far contour).',
		},
		{
			id: 'BADGER-D08-three-quarter-heads',
			sheetShowed: 'Only one 3/4 head (facing screen right) on the turnaround.',
			chosen:
				'Both 3/4 heads are built from the front head by a depth-field turn of 36 deg calibrated to badger_turn_34.png proportions (near eye 0.43, nose 0.88 of head width). Each ear keeps its own front-view shape, colour and marking; the far ear goes behind the skull.',
			why: 'Gives symmetric, consistent 3/4 angles without horizontally flipping any asymmetric marking.',
		},
		{
			id: 'BADGER-D09-right-profile',
			sheetShowed: 'badger_coat_right.png: right profile with the pale ear (small spot) as the near ear.',
			chosen:
				'Right-profile skull and ear OUTLINES follow coat_right (anatomically symmetric to the left profile); the near ear is coloured pale with its own fold and spot H-EAR-R-SPOT; no left-side marking appears. Look-up heads are the profiles pitched 34 deg with the ear hanging.',
			why: 'Opposite views carry their own anatomical markings; only symmetric anatomy is shared.',
		},
		{
			id: 'BADGER-D10-pale-ear-tone',
			sheetShowed: 'The pale ear flap is drawn in the same white as the head; its inner surface is pinkish grey.',
			chosen: 'Flap uses coat; inner uses earPaleInner. Palette key earPale (#E9E4E0) is left unused.',
			why: 'A second near-white would read as a dirty patch and act as a second shadow tone of the coat (one-shadow-tone rule).',
		},
		{
			id: 'BADGER-D11-brows',
			sheetShowed: 'Neutral face: soft grey brows. Happy/worried/shocked: thin near-black brows.',
			chosen: "Added BADGER_COLORS.brow '#8E9299' for the soft brow; expressive and 'judge' brows add a near-black line (LINE.color).",
			why: 'Matches the sheet; brow is a line colour, not a shadow tone.',
		},
		{
			id: 'BADGER-D12-line-weight',
			sheetShowed: 'The sheet uses a constant pixel line width, so its enlarged expression heads have relatively thinner lines.',
			chosen: 'One outline weight in world units (LINE.width 3.5) across the whole character; close-ups therefore read slightly heavier than the expression sheet.',
			why: 'Consistent near-black outlines across shots and scales (PROJECT_INSTRUCTIONS style rule).',
		},
		{
			id: 'BADGER-D13-tag',
			sheetShowed: 'One round teal tag; edge-on (oval) in side views.',
			chosen: 'One tag: round disc in the front bust, edge-on oval in the left view, hanging plumb from the collar ring.',
			why: 'Single tag per the locked design; orientation follows the view.',
		},
	],
};
