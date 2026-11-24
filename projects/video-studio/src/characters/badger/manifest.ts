/**
 * BADGER character manifest v1.0.0 (baseline 2026-11-24). Reuse this baseline in every episode; change it
 * only through a new version with a recorded decision. World units: ZOO = 900 units tall at scale 1;
 * origin (0,0) = ground contact point = centre of the footprint; y grows downward (SVG).
 */
import {BADGER_COLORS, LINE} from '../palette';
import type {BadgerHead} from '../types';
import {HEAD_GEOM} from './parts/heads/headGeom';
import {LEFT_RIG} from './parts/rigLeft';
import {RIGHT_RIG} from './parts/rigRight';
import {VIEW_RIGS} from './parts/viewRigs';
import {POSE_RIGS} from './parts/poseRigs';
import {WALK} from './parts/gait';
import {
	LEFT_SPOT_COUNT,
	LEFT_SPOTS,
	HEAD_MARKINGS,
	FRONT_NECK_SPOTS,
	RIGHT_SPOTS,
	FRONT_SPOTS,
	BACK_SPOTS,
	THREE_QUARTER_SPOTS,
	SIT_SPOTS,
	LIE_SPOTS,
} from './spots';

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
	readonly views: {
		readonly implemented: readonly string[];
		readonly headViews: readonly BadgerHead[];
		readonly defaultHeads: Record<string, string>;
		readonly poses: Record<string, string>;
	};
	readonly pivots: Record<string, Pivot>;
	readonly pivotsRight: Record<string, Pivot>;
	readonly viewPivots: Record<string, Record<string, Pivot>>;
	readonly posePivots: Record<string, Record<string, Pivot>>;
	readonly headPivots: Record<string, Record<string, Pivot>>;
	readonly walk: {
		readonly gait: string;
		readonly cycleUnits: number;
		readonly duty: number;
		readonly phaseOffsets: Record<string, number>;
		readonly rootMotion: string;
		readonly verification: string;
	};
	readonly markings: {
		readonly leftBodySpotCount: number;
		readonly leftBodySpotIds: readonly string[];
		readonly rightBodySpotIds: readonly string[];
		readonly frontViewIds: readonly string[];
		readonly backViewIds: readonly string[];
		readonly threeQuarterViewIds: readonly string[];
		readonly sitIds: readonly string[];
		readonly lieIds: readonly string[];
		readonly topMapLinks: Record<string, string>;
		readonly headIds: readonly string[];
		readonly frontNeckIds: readonly string[];
	};
	readonly decisions: readonly ContinuityDecision[];
};

const R = LEFT_RIG;
const T = R.torso.pivot;
const M = R.mounts;

type LegRig = {readonly legFront: {readonly lowerPivot: {x: number; y: number}; readonly pawPivot: {x: number; y: number}}; readonly legHind: {readonly lowerPivot: {x: number; y: number}; readonly pawPivot: {x: number; y: number}}};

const legPivots = (name: string, mount: {x: number; y: number}, kind: 'front' | 'hind', rig: LegRig = R): Record<string, Pivot> => {
	const g = kind === 'front' ? rig.legFront : rig.legHind;
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

const RR = RIGHT_RIG;
const RM = RR.mounts;

const groupPivots = (pv: Readonly<Record<string, {readonly x: number; readonly y: number}>>, what: string): Record<string, Pivot> =>
	Object.fromEntries(
		Object.entries(pv).map(([k, v]) => [
			k,
			{
				x: v.x,
				y: v.y,
				parent: 'root',
				space: `${what} root (world units, origin = ground contact point)${k === 'headCentroid' ? '; the head is mounted so its eyes+nose centroid lands here (Badger.tsx headLandmark)' : ''}`,
			},
		]),
	);

const ids = (xs: readonly {readonly id: string}[]) => xs.map((x) => x.id);

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
		'reference/crops/badger_coat_right.png (RIGHT body rig + R- markings, traced; v1.0.0 extra views)',
		'reference/crops/badger_turn_front.png, badger_turn_back.png, badger_turn_34.png (front / back / three-quarter bodies, traced)',
		'reference/crops/badger_coat_top.png (back-view markings T-, projected)',
		'reference/crops/badger_pose_sitting.png, badger_pose_lying.png (sit / lie bodies, traced), badger_pose_walking.png (walk phase 0)',
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
			// RIGHT view (rigRight.ts, stand): withers outer edge, torso outline length, footprint (far front paw placed by IK)
			rightWithersOuter: 312.3,
			rightTorsoLength: 352.0,
			rightFootprintMinX: -191.2,
			rightFootprintMaxX: 190.6,
			// turnaround views share one scale: 0.950 units per crop px (side-view withers 329 px = 312.6, decision V-SCALE)
			frontViewWidth: 134.7,
			frontHeadSkullWidthOnSheet: 97.9,
			backViewHeight: 436.6,
			threeQuarterBodyWidth: 293.2,
			// pose bodies: scale from the head (eye spacing 46.4 units), decision P-SCALE
			sitHeadCentroidHeight: 369.3,
			lieLength: 541.3,
			lieHeadCentroidHeight: 233.7,
		},
	},
	anatomy: {
		conventions: [
			"Prop and part names are ANATOMICAL unless suffixed 'Screen'.",
			"view 'left': the dog faces SCREEN LEFT and its ANATOMICAL LEFT side faces the camera (badger_coat_left.png).",
			"In view 'left' the near legs are the anatomical LEFT legs (legFrontNear, legHindNear); the far legs are the RIGHT legs, drawn behind in coatShadow with no visible markings.",
			"view 'right': the dog faces SCREEN RIGHT and its ANATOMICAL RIGHT side faces the camera (badger_coat_right.png). Near legs are the anatomical RIGHT legs; the far (LEFT) legs are drawn behind in coatShadow. The near ear is the PALE right ear.",
			"view 'front': anatomical LEFT = SCREEN RIGHT (dark ear on screen right). view 'back': anatomical LEFT = SCREEN LEFT (dark ear on screen left). view 'threeQuarter': the dog's right flank faces the camera, the head turned to screen right (badger_turn_34.png).",
			"Every view and pose body is its own trace with its own marking records; no view or pose is produced by mirroring another.",
			"Front head: anatomical left = screen right. The DARK-capped ear is the anatomical LEFT ear in every head view (screen right in 'front'; the near ear in left-facing views; the far ear in right-facing views).",
			'The pale anatomical RIGHT ear carries the small spot H-EAR-R-SPOT.',
			'No view is produced by horizontally flipping the character or any marking (see decisions D-08, D-09).',
		],
	},
	views: {
		implemented: ['left', 'right', 'front', 'back', 'threeQuarter'],
		headViews: HEAD_VIEWS,
		defaultHeads: {
			left: 'front',
			right: 'profileRightScreen',
			front: 'front',
			threeQuarter: 'threeQuarterRightScreen',
			back: 'none: the back of the head is part of the traced back view (head prop ignored)',
			sit: 'threeQuarterRightScreen',
			lie: 'threeQuarterRightScreen',
			walk: 'profileLeftScreen / profileRightScreen (facing)',
			lookUp: 'upLeftScreen / upRightScreen (facing)',
		},
		poses: {
			stand: 'all five views',
			lookUp: "side views: head 'upLeftScreen' / 'upRightScreen' + raised neck (the sheet faces right; front/back/3/4 requests render the right view)",
			walk: 'side views, both facings: 4-beat lateral-sequence gait from walkPhase, IK legs, planted stance paws (front/back/3/4 requests render the right view)',
			sit: 'traced pose body (badger_pose_sitting.png), screen-right facing only, right-side markings (decision P-FACING)',
			lie: 'traced pose body (badger_pose_lying.png), screen-right facing only, right-side markings (decision P-FACING)',
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
	pivotsRight: {
		root: {x: 0, y: 0, parent: 'none', space: 'world (ground contact, centre of footprint)'},
		torso: {x: RR.torso.pivot.x, y: RR.torso.pivot.y, parent: 'root', space: 'world'},
		neck: {x: RM.neck.x, y: RM.neck.y, parent: 'torso', space: 'torso-local'},
		headMount: {x: RR.neck.headMount.x, y: RR.neck.headMount.y, parent: 'neck', space: 'neck-local (+ RIGHT_HEAD_MOUNT per head view)'},
		tagAnchor: {x: RR.neck.tagAnchor.x, y: RR.neck.tagAnchor.y, parent: 'neck', space: 'neck-local (tag counter-rotates to hang plumb)'},
		tail: {x: RM.tail.x, y: RM.tail.y, parent: 'torso', space: 'torso-local (curve driven by tailWag)'},
		...legPivots('legFrontNear', RM.legFrontNear, 'front', RR),
		...legPivots('legFrontFar', RM.legFrontFar, 'front', RR),
		...legPivots('legHindNear', RM.legHindNear, 'hind', RR),
		...legPivots('legHindFar', RM.legHindFar, 'hind', RR),
	},
	viewPivots: {
		front: groupPivots(VIEW_RIGS.front.pivots, 'front view'),
		back: groupPivots(VIEW_RIGS.back.pivots, 'back view'),
		threeQuarter: groupPivots(VIEW_RIGS.threeQuarter.pivots, 'three-quarter view'),
	},
	posePivots: {
		sit: groupPivots(POSE_RIGS.sit.pivots, 'sit pose'),
		lie: groupPivots(POSE_RIGS.lie.pivots, 'lie pose'),
	},
	headPivots: Object.fromEntries(HEAD_VIEWS.map((v) => [v, headPivotsFor(v)])),
	walk: {
		gait: 'lateral-sequence 4-beat walk: left hind, left front, right hind, right front, a quarter cycle apart (parts/gait.ts WALK.offsets)',
		cycleUnits: Math.round(WALK.stride * 10) / 10,
		duty: WALK.duty,
		phaseOffsets: {...WALK.offsets},
		rootMotion:
			'walkPhase is in gait cycles. Move the root by WALK.stride * scale per cycle along the facing (badgerWalkDistance(cycles) in parts/gait.ts) and planted paws stay fixed on the ground.',
		verification:
			'Numerically checked (esbuild + node, 3 cycles, 1200 samples, both facings, all four legs): every stance toe stays fixed in world space (max drift 0.000 units in x and y).',
	},
	markings: {
		leftBodySpotCount: LEFT_SPOT_COUNT,
		leftBodySpotIds: ids(LEFT_SPOTS),
		rightBodySpotIds: ids(RIGHT_SPOTS),
		frontViewIds: ids(FRONT_SPOTS),
		backViewIds: ids(BACK_SPOTS),
		threeQuarterViewIds: ids(THREE_QUARTER_SPOTS),
		sitIds: ids(SIT_SPOTS),
		lieIds: ids(LIE_SPOTS),
		topMapLinks: Object.fromEntries(BACK_SPOTS.filter((s) => s.sameAs).map((s) => [s.id, s.sameAs as string])),
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
		{
			id: 'BADGER-D14-right-body',
			sheetShowed: 'badger_coat_right.png: the right side with its own spot pattern (9 marks) and only a sliver of the left withers patch at the top line.',
			chosen:
				"view 'right' is its own trace of coat_right (rigRight.ts, gen_right.py), mapped with kx 0.9734 / ky 1.0283 so withers (312.3) and body length match the binding size panel (D01). Its markings are separate records R-01..R-08 and R-NECK; the patch edge keeps the id L-WITHERS (side left). Near ear: the pale right ear (profileRightScreen head).",
			why: 'The labelled coat maps control body markings; opposite views carry their own anatomical markings and nothing is flipped.',
		},
		{
			id: 'BADGER-D15-right-stance',
			sheetShowed: 'coat_right draws the far (left) front paw about 30 sheet px ahead of the near one and the far hind paw 26 px ahead.',
			chosen:
				'The far hind leg mounts 26 px forward; the far front leg keeps the near shoulder and is rotated by IK so its paw lands 29.2 units ahead, so its top never pokes out in front of the chest.',
			why: 'Matches the coat map stance without inventing anatomy; a shifted shoulder showed the leg top outside the chest.',
		},
		{
			id: 'BADGER-D16-withers-patch-right-facing',
			sheetShowed:
				'The turnaround side view, the walking, looking-up, sitting and lying panels (all facing screen right) draw the large withers patch on the visible right side; coat_right shows only its top-line edge.',
			chosen: 'In every screen-right-facing view and pose the patch shows only as its top-line edge (L-WITHERS, side left). Extends D04.',
			why: 'Coat maps control body markings and the locked design puts the large patch near the LEFT withers.',
		},
		{
			id: 'BADGER-D17-turnaround-scale',
			sheetShowed: 'The turnaround draws all four views at one scale; its side-view withers stand 329 crop px above the ground line (y=484).',
			chosen:
				'Front, back and 3/4 bodies are traced at 0.950 units per crop px (312.6 / 329), so their withers match the binding size panel. The replaceable heads keep their size: the turnaround front skull measures 97.9 units against 99.5 for the shared front head.',
			why: 'Size panel controls scale; the turnaround controls anatomy. One head size in every view avoids a head that changes size on a view switch.',
		},
		{
			id: 'BADGER-D18-front-view',
			sheetShowed:
				'badger_turn_front.png: dark ear on screen right; spots on both shoulders, both forearms, one on the midline chest under the tag; neck spots on both sides; only a narrow strip of a hind leg between the front legs.',
			chosen:
				"view 'front' traces the turnaround body, neck, collar and tag; head 'front' is mounted on the sheet's face centroid. Markings reuse the coat-map ids as seen from the front (R-04 / L-03 shoulders, R-08 / L-09 forearms, R-NECK / L-NECK) plus M-CHEST.",
			why: 'Front views control anatomy and the front head controls which ear is dark.',
		},
		{
			id: 'BADGER-D19-midline-chest-spot',
			sheetShowed: 'A spot on the midline of the chest below the tag (front, 3/4 and sitting drawings). No coat map can show the chest midline.',
			chosen: 'Kept as M-CHEST (side midline) on the front, 3/4 and sit bodies; it never appears in side views.',
			why: 'The turnaround front controls anatomy where no coat map covers the area; the side maps are not contradicted.',
		},
		{
			id: 'BADGER-D20-back-view',
			sheetShowed:
				'badger_turn_back.png: the dark ear on SCREEN LEFT; a crescent patch under the collar; shoulder and hip spots that do not match the top map exactly.',
			chosen:
				"view 'back' traces the turnaround back (head, ears, collar, body, legs, tail). Dark ear = anatomical LEFT = screen left. Back markings are the top coat map (T-PATCH, T-01..T-08) projected onto the rounded back; leg spots seen from behind keep their side-map ids (L-07, L-08, R-07). T- records name the side marking they continue (sameAs).",
			why: 'The top coat map controls back markings (reference priority); the anatomical left ear is dark in every view (D03).',
		},
		{
			id: 'BADGER-D21-top-map-orientation',
			sheetShowed: 'badger_coat_top.png is a dorsal view with the head at screen left.',
			chosen:
				'Image TOP = anatomical RIGHT (a dog facing screen left, seen from above, has its right side at the top). Seen from behind, anatomical right = screen right, so T- spots from the image top land on screen right of the back view.',
			why: 'Keeps every marking on its anatomical side; consistent with D03 (top-map ear colour read the same way).',
		},
		{
			id: 'BADGER-D22-three-quarter-view',
			sheetShowed:
				'badger_turn_34.png: right flank toward camera; it draws the left withers patch large on top, a spot at the back of the thigh that is not on coat_right, and omits R-05 / R-06.',
			chosen:
				"view 'threeQuarter' traces the turnaround body; markings follow coat_right (R-01..R-08, R-NECK) plus the far forearm L-09, the far shoulder L-03 at the chest edge, M-CHEST and the L-WITHERS edge. The extra thigh spot is omitted.",
			why: 'Coat maps control body markings; the 3/4 drawing controls the silhouette.',
		},
		{
			id: 'BADGER-D23-pose-facing',
			sheetShowed: 'The sitting, lying, walking and looking-up panels all face screen right.',
			chosen:
				"sit and lie are traced pose bodies that exist only in the sheet's facing (screen right, right-side markings); requesting them with view 'left' renders the right-facing body. walk and lookUp are built on both side rigs: right-facing uses the right markings, left-facing the left markings.",
			why: 'Sit and lie cannot be produced for the other facing without mirroring asymmetric markings, which is forbidden; walk and look-up are poses of the traced side rigs, which exist for both sides.',
		},
		{
			id: 'BADGER-D24-pose-scale-and-markings',
			sheetShowed: 'The pose panels are drawn at different scales; their spot layouts are looser than the coat maps.',
			chosen:
				"Sit and lie are scaled so their heads match the shared 3/4 head (eye spacing 46.4 units); check: the sit front leg (elbow to ground) is 179 units against 180 in the 3/4 view. Their spots are the coat_right records placed on the posed parts (R-06, R-07 on the folded haunch; R-08 on the forearm), plus M-CHEST and L-09 on the sit's turned chest and far leg.",
			why: 'Size panel controls scale; coat maps control markings; pose drawings show the performance.',
		},
		{
			id: 'BADGER-D25-walk',
			sheetShowed: 'badger_pose_walking.png: one walking frame, far front leg reaching forward, near hind leg extended back, head carried forward.',
			chosen:
				'A 4-beat lateral-sequence gait (duty 0.6, 291.7 units per cycle) solved with two-bone IK per leg. Stance toes are fixed in world space (toe roll about the planted toe at the end of stance; shoulder / hip slide inside the body keeps the legs within reach). walkPhase 0 approximates the sheet frame; the neck lowers 17 deg and the tail lifts 26 deg while walking.',
			why: 'Pose drawings show how the same character performs; no foot sliding was required.',
		},
		{
			id: 'BADGER-D26-joints',
			sheetShowed: 'Legs are single outlined shapes with no visible joint seams.',
			chosen:
				'Legs use round cut-out joints: segments meet on a flat cut through the pivot and a disk of the joint radius fills the bend. Each segment outline is drawn through a hard-edged occlusion mask of the other segment fills, so no interior seam shows when a joint bends. The masks are binary (black/white), never soft, and are not used for shading. The left rig joint pivots moved to the centre of each cut (FRONT_PAW, HIND_HOCK, HIND_PAW); the standing drawing is unchanged except for antialiasing at the joints.',
			why: 'Clean flat outlines in every walk frame; consistent near-black outline weight.',
		},
		{
			id: 'BADGER-D27-look-up-right',
			sheetShowed: 'badger_pose_looking_up.png: right-facing, head raised toward ZOO, pale near ear hanging.',
			chosen: "Right look-up uses head 'upRightScreen' on the right neck (RIGHT_HEAD_MOUNT: neck -2 deg, offset -7 / +1) and the right-side markings.",
			why: 'Matches the panel facing and keeps right-side markings in a right-facing pose.',
		},
		{
			id: 'BADGER-INT-B1-three-quarter-heads',
			sheetShowed:
				'badger_turn_34.png: the far contour runs OUTSIDE the far eye into the top of the nose; the nose sits at the tip of a muzzle with a short upper-lip line below it; the mouth is a long, nearly flat line starting below the near cheek spot; the far eye is narrower than the near one.',
			chosen:
				'Integration fix (2026-11-24, gen_heads.py fix_three_quarter): both 3/4 heads get a far outline and muzzle authored in the depth-turned space (the muzzle now wraps the turned nose and chin), a far upper-lip line instead of the snout line that crossed the far eye, a near jaw line continuing the cheek, lip lines starting low on the near cheek (the front W-line began at the cheek and read as a grin), shocked without the cheek dashes, and the far eye and brow at 0.72 of the near eye. Markings, ears, eyes and every other head view are unchanged (the head-markings output is byte-identical).',
			why: 'Turnaround views control identity. The screen-left turn reuses the far outline of the unmarked, symmetric skull (x -> 416 - x, as the original fill34 pair did); no marking is mirrored.',
		},
	],
};
