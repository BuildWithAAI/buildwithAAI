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
import {BADGER_PROVISIONAL_DECISION, BADGER_PROVISIONAL_POSES, type BadgerViewPose} from './provisional';
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
	SIT_LEFT_SPOTS,
	LIE_LEFT_SPOTS,
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
	/** Drawings that still need the owner's explicit OK; tools should warn when a scene uses them. */
	readonly provisional: {readonly decision: string; readonly status: string; readonly poses: readonly BadgerViewPose[]};
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
		readonly sitLeftIds: readonly string[];
		readonly lieLeftIds: readonly string[];
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
		'round-1 repair (2026-11-24): badger_turn_back.png (back markings), badger_turn_side.png (right-profile ear, withers patch), badger_pose_looking_up.png (look-up heads), badger_expr_happy.png / badger_expr_shocked.png (mouths)',
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
			// skull top y=258 (head turned to camera, as in the panel). Round 5 (D55): the rig draws the front head x0.90 to the
			// turnaround's head:body proportion, so its skull and ear tips sit about 11 units below these two panel values
			// (rigCheck.earTop); the body numbers stay binding.
			headTop: b(240),
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
			// measured on the v1.0.0 render (dev BadgerLeft, head 'front', scale 1). Round 5 re-measured the head after the D55
			// rescale (front head x0.90 about its pivot): ear tips 455.6 -> 444.0 (outline included), skull 98 x 122 -> 90.6 x
			// 110.5 units (fill bounding box, crown to lower jaw contour); the body values are unchanged.
			heightAtWithersOuter: 314.4,
			earTop: 444.0,
			chestFrontX: -182.5,
			rumpRearX: 165.6,
			bodyLength: 348.1,
			footprintMinX: -185.6,
			footprintMaxX: 185.0,
			frontHeadSkullWidth: 90.6,
			frontHeadHeight: 110.5,
			lineWidth: LINE.width,
			// RIGHT view (rigRight.ts, stand): withers outer edge, torso outline length, footprint (far front paw placed by IK)
			// round-1 repair: the far front leg now stands behind the near one (D15), so the right footprint ends at the near
			// front paw; the root origin is kept where v1.0.0 put it so existing shots do not move
			rightWithersOuter: 311,
			rightTorsoLength: 352.0,
			rightFootprintMinX: -191,
			rightFootprintMaxX: 162,
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
			"In view 'left' the near legs are the anatomical LEFT legs (legFrontNear, legHindNear); the far legs are the RIGHT legs, drawn behind in coatShadow. Their only marking is an EDGE record (round 4): R-08 where the far forearm's spot wraps round the leg's back contour, as badger_pose_walking.png draws it.",
			"view 'right': the dog faces SCREEN RIGHT and its ANATOMICAL RIGHT side faces the camera (badger_coat_right.png). Near legs are the anatomical RIGHT legs; the far (LEFT) legs are drawn behind in coatShadow, the far forearm carrying the EDGE record L-09 (round 4). The near ear is the PALE right ear.",
			"view 'front': anatomical LEFT = SCREEN RIGHT (dark ear on screen right). view 'back': anatomical LEFT = SCREEN LEFT (dark ear on screen left). view 'threeQuarter': the dog's right flank faces the camera, the head turned to screen right (badger_turn_34.png).",
			"Every view and pose body is its own trace with its own marking records. Two drawings reuse UNMARKED geometry mirrored about their origin: the skull outline, nose, mouths and lower-face shadows of the screen-left 3/4 head (decision BADGER-D36; bilaterally symmetric features; its ears, eyes and markings are its own), and the outline, collar and tag of the left-facing sit and lie bodies (decision BADGER-D23). That sit / lie silhouette is itself asymmetric (head and neck turn, folded haunch, tail curl), so both left-facing poses are PROVISIONAL until the owner explicitly accepts D23 (BADGER_PROVISIONAL_POSES; tools warn, sheets label them). Every marking is authored for its own side from its own coat map: no marking or ear colour is flipped, and no spot path is the x-mirror of another record except a midline M- mark in the two facings of one pose (round 3 removed the one exception, SIT_LEFT_SPOTS R-08, which was L-09 mirrored; src/characters/badger/tests/spotsNoMirror.test.ts enforces it). Round 4: every forearm record (the left sit / lie L-09, the side rigs' far-forearm edge records) is placed from its OWN coat map's measured place on the forearm (dev/trace/coatmaps.py), and the test also fails on NEAR mirrors (within 1 unit in place, or after centring and scaling, for records of the same pose family and part near each other's mirror place) unless the pair is on its explicit coat-map-symmetric allow-list with the evidence (BADGER-D49).",
			"Front head: anatomical left = screen right. The DARK-capped ear is the anatomical LEFT ear in every head view (screen right in 'front'; the near ear in left-facing views; the far ear in right-facing views).",
			'The pale anatomical RIGHT ear carries the small spot H-EAR-R-SPOT.',
			'No view is produced by horizontally flipping the character or any marking (see decisions D-08, D-09). The one mirrored silhouette, the left-facing sit and lie (D-23), is PROVISIONAL pending the owner. The right profile head is traced on coat_right, not mirrored (D-09, revised).',
		],
	},
	provisional: {
		decision: BADGER_PROVISIONAL_DECISION,
		status: "PROVISIONAL, pending the owner's explicit OK (asked by the coordinator after repair round 3; still pending after round 4): the left-facing sit and lie keep working, but their silhouette is the right-facing pose outline mirrored about the root. Keep view 'left' with sit or lie out of episodes until the owner accepts BADGER-D23.",
		poses: BADGER_PROVISIONAL_POSES,
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
			sit: "threeQuarterRightScreen (view 'left': threeQuarterLeftScreen, dark ear near)",
			lie: "threeQuarterRightScreen (view 'left': threeQuarterLeftScreen, dark ear near)",
			walk: 'profileLeftScreen / profileRightScreen (facing)',
			lookUp: 'upLeftScreen / upRightScreen (facing)',
		},
		poses: {
			stand: 'all five views',
			lookUp: "side views: head 'upLeftScreen' / 'upRightScreen' + raised neck (the sheet faces right; front/back/3/4 requests render the right view)",
			walk: 'side views, both facings: 4-beat lateral-sequence gait from walkPhase, IK legs, planted stance paws (front/back/3/4 requests render the right view)',
			sit: "traced pose body (badger_pose_sitting.png), screen-right facing with right-side markings; view 'left' faces screen left with the LEFT markings on the unmarked mirrored silhouette (decision BADGER-D23, PROVISIONAL pending the owner)",
			lie: "traced pose body (badger_pose_lying.png), screen-right facing with right-side markings; view 'left' faces screen left with the LEFT markings on the unmarked mirrored silhouette (decision BADGER-D23, PROVISIONAL pending the owner)",
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
		sitLeft: groupPivots(POSE_RIGS.sitLeft.pivots, 'left-facing sit pose'),
		lieLeft: groupPivots(POSE_RIGS.lieLeft.pivots, 'left-facing lie pose'),
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
			'Numerically checked with src/characters/badger/dev/walkCheck.ts (esbuild + node; 3 cycles x 400 = 1201 samples per facing, all four legs, root moving WALK.stride per cycle), measured on the DRAWN paw and pastern curves: the traced sole never goes below the ground line (max 0.000 units, both facings; the outline reaches LINE.width / 2 below it exactly as in the stand), a planted paw keeps a fixed contact (drift 0.000), paws are planted 60.3% of the time (duty 0.6), swing clearance up to 28.4 units, and a swinging paw pitches toes-down at most 28 deg. Re-run after the round-2 stride change (cycle 375 units): both facings pass with the same numbers.',
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
		sitLeftIds: ids(SIT_LEFT_SPOTS),
		lieLeftIds: ids(LIE_LEFT_SPOTS),
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
				'badger_coat_left.png draws the large withers patch on the left side; badger_coat_right.png draws only a thickened top line at the withers; badger_coat_top.png draws the patch straddling the spine (its front half reaches 0.84 of the half-width on the right and 0.86 on the left); the turnaround side, 3/4, walking, looking-up, sitting and lying panels (all right-facing) draw it large on the visible side.',
			chosen:
				'One marking, L-WITHERS: high on the back at the LEFT withers, its front half wrapping over the spine onto the right side. From the left it is the full patch (coat_left); from the right it is that right lobe (D16); from behind it is the crescent under the collar (D20).',
			why: 'The three labelled coat maps control body markings and agree only if the patch straddles the spine; PROJECT_INSTRUCTIONS place it near the LEFT withers.',
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
			sheetShowed:
				'badger_coat_right.png: right profile with the pale right ear (a rose flap with a small dark spot) as the near ear; badger_turn_side.png shows the ear\'s pink inner at the fold.',
			chosen: 'REVISED in round-1 repair and corrected in round 2: profileRightScreen\'s skull outline, stop, nose, muzzle underside and the pale ear (outline, fold line, pink band at the fold from turn_side, spot H-EAR-R-SPOT) are traced on coat_right; its eye, brow and the four expression mouth paths are the left profile\'s, mirrored about the head and re-fitted to coat_right (these are unmarked, symmetric features; nothing marked is mirrored). v1.0.0 mirrored the whole left profile, ear included; that is removed. Look-up heads are the profiles pitched 40 deg and joined to the rig necks (D27, D39).',
			why: 'Opposite views carry their own drawing and markings; the reviewers measured the old right ear as an exact mirror of the left one. The round-2 review found the round-1 text overstated what was retraced; this wording is what gen_heads.py does.',
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
			chosen:
				'REVISED in round-1 repair: the default stays one outline weight in world units (LINE.width 3.5, details LINE.detailWidth). The optional prop lineScale (default 1) multiplies every outline and detail width (legs, collar, tag, face lines included), the same contract as ZooRig lineScale (decision ZOO-L1); badgerLineScaleFor(pxPerUnit) gives the ART_GUIDE SL5 value (outline 3-6 px at output), e.g. 1.53 at 0.56 px/unit and 0.54 at 3.2 px/unit. In a two-shot pass the same value to both characters.',
			why: 'Consistent near-black outlines across shots and scales (PROJECT_INSTRUCTIONS style rule); below 0.857 px/unit the fixed width fell under SL5 (the pose row at 0.56 drew 1.96 px outlines). The scale is explicit, not derived from `scale`, because the output px per unit also depends on the parent viewBox, and Zoo uses the same explicit prop.',
		},
		{
			id: 'BADGER-D13-tag',
			sheetShowed: 'One round teal tag; edge-on (oval) in side views.',
			chosen:
				"One tag: round disc in the front bust, edge-on oval in the left view, hanging plumb from the collar ring. Round 4 (gen_right.py TAG_RX): the right view's tag was an elongated oval (teal width / height 0.55 in the right stand, walk and look-up, against 0.63-0.82 on turn_side, coat_right, walking and looking_up); it is widened to 7.7 x 9.6 coat_right px, same height, and reads 0.71 in all three. The left view keeps its edge-on oval (0.42-0.43; coat_left 0.45).",
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
			sheetShowed:
				'badger_coat_right.png and badger_turn_side.png show ONE front leg (row scans give a single pair of edges from the elbow to the paw); the far hind paw stands about 26 px ahead of the near one.',
			chosen:
				'REVISED in round-1 repair: the far (left) front leg stands exactly behind the near one and is hidden; the far hind leg mounts 26 px forward. The v1.0.0 text (far front paw 30 px ahead) misread the map; a forward offset showed a grey extra leg and doubled the near leg\'s front outline. The right-view root origin stays where v1.0.0 put it so existing shots do not shift.',
			why: 'Matches the coat map and the turnaround side.',
		},
		{
			id: 'BADGER-D16-withers-patch-right-facing',
			sheetShowed:
				'Six of the seven right-facing drawings (turnaround side, 3/4, walking, looking-up, sitting, lying) draw the large patch on the visible right side; coat_right shows only its top-line edge; the top map shows the front of the patch straddling the spine.',
			chosen: 'REVISED in round 2 (2026-11-24): right-facing level views (right stand, right walk, right look-up) show the right lobe of L-WITHERS as badger_turn_side.png draws it: a rounded irregular lens about 82 x 38 units hanging from the top line, its front about 22 sheet px behind the collar, traced on turn_side and mapped into coat_right space by the collar\'s back edge on the top line (dev/trace/gen_right.py). The round-1 pointed wedge (a compromise no drawing shows) is removed. The 3/4, sit and lie bodies keep the dorsal patch traced from their own panels. Same id, side left, authored per view, never mirrored. OWNER CONFIRMATION STILL REQUESTED: the alternative is coat_right\'s thin top-line edge (v1.0.0).',
			why: 'The three labelled coat maps disagree here (coat_right: a thickened top line; coat_top: the front half of the patch straddles the spine and covers 0.84 of the right half-width, which a level side camera sees as a deep lobe). The turnaround, which controls identity and anatomy, breaks the tie, and the walking and looking-up panels agree with it: seven of the eight right-facing drawings show the lens. The reviewers rejected both coat_right\'s edge (round 1) and the wedge (round 2).',
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
				'badger_turn_back.png: dark ear on SCREEN LEFT; a domed crescent under the collar (about 85 x 23 units); two large ovals on the upper rump; a spot on the back of the left thigh; one spot above each hock. The top map shows more spots on the dorsal surface.',
			chosen:
				'REVISED in round-1 repair: the back view shows exactly what the turnaround back shows, traced at its size: T-PATCH (= L-WITHERS) as the crescent, T-05 (= R-01) and T-08 (= L-02) as the two ovals (by height they are the croup spots, 254 / 256 units, not the mid-back pair at 283 / 290), plus L-07, L-08, R-07. The other top-map spots (T-01, T-02, T-03 = R-04, T-04 = R-02, T-06 = L-03, T-07 = L-01) lie on the receding dorsal surface and are hidden at eye level. No mark is smaller than 13 units.',
			why: 'The top coat map keeps the identities (sameAs); the turnaround controls what an eye-level camera behind the dog sees. The v1.0.0 projection shrank spots to specks below the outline width, which read as freckles.',
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
				'badger_turn_34.png: right flank toward camera; the withers patch drawn large on top of the back; a spot behind it; R-05 / R-06 omitted.',
			chosen:
				'REVISED in round-1 repair: L-WITHERS is the dorsal patch traced from the turnaround 3/4 (about 50 x 36 units on top of the withers; the elevated camera sees the surface where the patch straddles the spine, D16). R-02 moves just behind it (foreshortened). Other markings follow coat_right as before (R-01..R-08, R-NECK, L-09 far forearm, L-03 far shoulder, M-CHEST).',
			why: 'Coat maps control markings; the 3/4 drawing shows how much of the dorsal surface is visible.',
		},
		{
			id: 'BADGER-D23-pose-facing',
			sheetShowed:
				'The sitting, lying, walking and looking-up panels all face screen right. Episodes stage Badger to the right of Zoo facing left, so a sit or lie beat must be able to face left. The sheet has no left-facing sit or lie panel.',
			chosen:
				"PROVISIONAL, pending the owner's explicit OK (status recorded in round 3; the coordinator asks the owner). Sit and lie exist in both facings: view right (or front/back/3/4) uses the traced right-facing bodies with right-side markings; view left uses the right-facing pose's UNMARKED outline, collar and tag mirrored about the root, carrying the LEFT coat map's own markings authored for it (L-WITHERS as the full patch, L-01..L-09, L-NECK, M-CHEST, and R-08 on the far forearm's edge) and head threeQuarterLeftScreen (dark ear near). Round 3: R-08 used to be the right-facing sit's L-09 record x-mirrored (to 0.1 unit), a flipped marking; it is now authored from badger_coat_right.png's own R-08 (35.2% down the forearm, coat_right's own size and tilt, on the far leg's front edge) and src/characters/badger/tests/spotsNoMirror.test.ts fails on any record that is the x-mirror of another (midline M- marks in the two facings of one pose excepted). Both poses keep working; BADGER_PROVISIONAL_POSES (src/characters/badger/provisional.ts, exported from the badger index) lists them so tools can warn, and the sheets should label them provisional until the owner accepts. walk and lookUp are built on both side rigs as before. Round 4: the left sit / lie L-09 (near forearm) are placed from coat_left's OWN forearm numbers (37.2% down from the elbow tip, 38.5% across from the front contour, coat_left's size and tilt; dev/trace/coatmaps.py), no longer at the right poses' R-08 centres (0.6 / 0.8 units from an x-mirror), and the test also catches moved or rescaled mirrors (BADGER-D49). The silhouette question is unchanged: still PROVISIONAL until the owner answers.",
			why: "v1.0.0 silently rendered the right-facing body for view left, turning Badger away from Zoo and swapping his visible markings mid-scene. A dedicated left trace would be an invented drawing (no panel exists). The mirrored silhouette is not symmetric anatomy: the head and neck turn, the folded haunch and the tail curl are asymmetric, so under the binding rule 'never horizontally flip an asymmetric character' it needs the owner's acceptance before it is final. The markings are never flipped (round-3 test).",
		},
		{
			id: 'BADGER-D24-pose-scale-and-markings',
			sheetShowed:
				'The pose panels are drawn at different scales; their spot layouts are looser than the coat maps.',
			chosen:
				'Sit and lie are scaled so their heads match the shared 3/4 head (eye spacing 46.4 units); check: the sit front leg (elbow to ground) is 179 units against 180 in the 3/4 view. Right-facing bodies carry the coat_right records placed on the posed parts (R-06, R-07 on the folded haunch; R-08 on the forearm) plus M-CHEST and L-09; the withers patch is traced from each panel (D16). Left-facing bodies carry the coat_left records placed at the matching anatomy, each a little further back along the body than its right-side neighbour, as coat_left draws them.',
			why: 'Size panel controls scale; coat maps control markings; pose drawings show the performance.',
		},
		{
			id: 'BADGER-D25-walk',
			sheetShowed:
				'badger_pose_walking.png: one walking frame, far front paw landing well ahead of the chest, near hind leg extended back at toe-off, near fore planted under the chest, head carried up and forward, tail swept back.',
			chosen: 'REVISED in round 2: 4-beat lateral-sequence gait (duty 0.6, 375 units per cycle, stance sweep 225 units: fore lands 128 ahead and lifts 97 behind its shoulder, hind lands 96 ahead and lifts 129 behind its hip; shoulder glide capped at 26), lateral pairs close together so walkPhase 0 is the sheet frame (far fore landing, far hind just planted, near hind at toe-off, near fore in late stance). The round-1 stride (358.3, sweep 215) left the phase-0 paw spread about 10% short of the panel; the far fore of the right rig cannot reach further than 128 without the paw sliding, so the extra spread comes mostly from the hind. Paws are solved on their DRAWN outline: heel-up roll about the lowest toe point, a ground clamp keeps the traced sole on the ground line in stance and above it in swing, the swinging fore leg raises its scapula, the paw pitches toes-down at most 28 deg. Neck +2 deg, tail +34 deg while walking. Verified by dev/walkCheck.ts (see walk.verification).',
			why: 'v1.0.0 rolled the paw heel-down and pivoted on control points, pushing paws up to 22 units into the floor; its stride was short and the head low against the sheet frame.',
		},
		{
			id: 'BADGER-D26-joints',
			sheetShowed:
				'Legs are single outlined shapes with no visible joint seams.',
			chosen:
				'REVISED in round-1 repair: stroke-under-fill. Every exterior leg stroke (and the ring of any bent joint) is drawn at twice LINE.width first; the joint disks and segment fills go on top and hide every interior seam; interior creases (elbow lines) and toe details go last. The traced leg fills and strokes are inset by LINE.width / 2 (dev/trace/erode.py: only exterior edges move, cut corners slide along the cut), so the visible outline still covers the traced edge +- LINE.width / 2. The v1.0.0 occlusion masks are gone.',
			why: 'The masks left crumbs, spikes and stepped outlines at wrists and hocks in walk frames; this construction gives one continuous silhouette at any joint angle.',
		},
		{
			id: 'BADGER-D27-look-up-right',
			sheetShowed:
				'badger_pose_looking_up.png: right-facing, neck upright, head raised toward Zoo, pale near ear hanging back with its pink inner showing, one continuous throat line from the lip to the collar.',
			chosen:
				'REVISED in round-1 repair: both look-up heads are their profiles pitched 40 deg (was 34) and joined to the rig necks in head-local space: the lip line ends at the commissure and ONE throat stroke lands on the neck\'s throat line (the lowest landing whose stroke passes in front of the old upper throat line, which a 6-unit coat band hides); the skull\'s back contour is stroked down past where it crosses the neck\'s back line (no nape gap). The hanging ear shows its inner at the fold (pale ear: front half; dark ear: a band). Right look-up mount: neck -12 deg (was -2), dx -7, dy +1.',
			why: 'Matches the panel\'s head carriage; removes the nape gaps, forked stubs and floating jaw the reviewers found.',
		},
		{
			id: 'BADGER-INT-B1-three-quarter-heads',
			sheetShowed:
				'badger_turn_34.png: the far contour runs OUTSIDE the far eye, the muzzle projects past the far cheek with the nose at its tip, the mouth is a long gently curved line under the nose, the far dark ear is solid, the chin is closed.',
			chosen: 'Superseded in round 2 by BADGER-D36 (the lower face, far contour and far ear of both 3/4 heads are re-authored from badger_turn_34.png). Round-1 text: one far contour from the far temple, pulled in at the far cheek, round the muzzle and the chin; near cheek stops at the jaw; far ear solid; irises 15% larger; lower-lip detail dropped.',
			why: 'Turnaround views control identity; the reviewers found the open chin and grin-like mouth on screen for 100 frames of the proof.',
		},
		{
			id: 'BADGER-D28-left-withers-patch',
			sheetShowed:
				'badger_coat_left.png: the patch spans 88 x 36 px below the top line, deepest in the middle, starting about 24 px behind the collar along the top line; the size panel (the default left view) shows it about 79 x 34 units with a clear gap behind the collar. coat_left\'s own top line over the patch lies about 5 px lower than the rig\'s, which is pinned to the binding withers height (312.6).',
			chosen:
				'L-WITHERS (left) retraced: lower edge 5 px higher than the raw trace so its depth below the rig\'s top line matches coat_left (aspect about 2.3), front tip 7 px further back so the default left view keeps the size panel\'s gap behind the collar. Same id, same part.',
			why: 'Coat maps control the marking; the size panel controls the default view. The rendered v1.0.0 patch read as a deep half-disc touching the collar.',
		},
		{
			id: 'BADGER-D29-profile-heads',
			sheetShowed:
				'coat_left / coat_right profiles: a nose about 20 x 21 px (outer) set into the muzzle tip, a clear stop at the eye, a small dark almond eye, rose ears hanging from the top of the skull, one lip line running into the jaw.',
			chosen:
				'Profile heads retraced (gen_heads.py): smaller rounded-wedge nose continuing the muzzle line, deeper stop, muzzle underside matched to each map, a profile eye drawn as a dark almond (iris colour, no white), a short commissure mark instead of a second lip stroke. The left (dark) ear outline already matched coat_left within about 1 px and is kept.',
			why: 'The reviewers measured the old profile nose 1.4x the sheet\'s and the eye about 2x; the doubled lip stroke read as a hook at the throat.',
		},
		{
			id: 'BADGER-D30-expressions',
			sheetShowed:
				'badger_expr_happy.png: a wide smile inside the face with raised corners, a notch at the philtrum and a lower-lip arc. badger_expr_shocked.png: a small open mouth (about nose width, 0.45 of the nose height) under a kept philtrum, jaw intact. badger_expr_worried.png: ear flaps lower and splayed. Eye lines are level on all four panels (measured tilt 0.0-0.6 deg).',
			chosen:
				'Happy and shocked retraced from their panels (front and 3/4); shocked in profile and look-up heads is a closed, outlined open-mouth wedge inside the head silhouette. Worried / earsBack swings each front ear about 20 deg down and out without narrowing it. Judge lowers the lids at most to 0.86 open and folds the ears back slightly (eyes stay open between blinks); a closed eye is a nearly flat lid line. No default head tilt for happy or worried: the panels\' eye lines are level, so tilt stays a composition choice.',
			why: 'Expression drawings show how the same character performs; the reviewers found happy indistinguishable from neutral and shocked twice the panel\'s size with the jaw open. Round-2 note on head angle: the happy, worried and shocked panels also turn the head about 15 deg to screen right; the front bust stays frontal and the turn is a staging choice made with the replacement heads (threeQuarterRightScreen carries all four expressions) plus headTilt, so one bust never mixes two head views.',
		},
		{
			id: 'BADGER-D31-mouth-open',
			sheetShowed:
				'No panel; CLAUDE.md records the owner\'s request that Badger\'s mouth and ears animate from real-dog sound clips through a mouth-open control, with no redesign.',
			chosen:
				'Optional prop mouthOpen (0..1) on <Badger/>: each head view\'s own open-mouth drawing (the shocked mouth) grows down from the upper lip with the amount, the jaw line stays, and the ears lift slightly. Below 0.06 the expression\'s own mouth is shown. Nothing renamed. Round 4: the profile and look-up heads drop the jaw instead (BADGER-D54).',
			why: 'Owner request; reuses the approved shapes only.',
		},
		{
			id: 'BADGER-C1-collar-colour',
			sheetShowed:
				'PROJECT_INSTRUCTIONS call the collar plain slate (brand slate #161A21); the approved drawing renders it #393F45 (sampled), clearly lighter than the near-black outline.',
			chosen:
				'BADGER_COLORS.collar = #393F45 with one shadow tone #2B3035 (palette.ts).',
			why: 'The drawing defines the asset (same reasoning as ZOO-C1 for the overshirt): #161A21 would merge with the near-black outline and lose the collar band at small scales.',
		},
		{
			id: 'BADGER-D32-tag-ring-front-strip',
			sheetShowed:
				'The sheet draws a light silver split ring above the teal tag, and the front view\'s hind-leg strip between the front legs in coat white.',
			chosen:
				'The tag ring is a closed loop filled BRAND.silver with a detail-width outline in every view; the front view\'s hind strip uses coat white.',
			why: 'The open U stroke read as two black ticks; the grey strip read as a shadow the turnaround does not draw.',
		},
		{
			id: 'BADGER-D33-happy-tail-and-breath',
			sheetShowed:
				'The happy panel\'s inset carries the tail high in an upward curve; the art guide asks for breathing of a few px at proof scale.',
			chosen:
				'REVISED in round 4 (R3 review: at 32 deg the tail still hung 25 deg BELOW horizontal, root to tip): with expression happy the side views carry the tail 85 deg above the stand plus a 10 deg curl toward the tip (SidePose.tailCurl), an upward sickle whose root-to-tip chord is 37 deg (left rig) / 39 deg (right rig) ABOVE horizontal with the tip turned up, as the inset draws it; the restrained wag (tailWag) rides on top. Breathing scales the chest by 1.5% (was 0.6%), about 2 px at the proof scale.',
			why: 'Pose and expression drawings show the performance; the old breathing was sub-pixel.',
		},
		{
			id: 'BADGER-D34-contour-repairs',
			sheetShowed:
				'badger_turn_front.png runs the forearm contours straight past the forearm spots and the hind strip\'s line into the inner contour of the leg in front of it; badger_pose_sitting.png and badger_pose_lying.png draw the back-of-neck line from under the ear to the collar (the cheek line branches off it), one neck-front line from the chin through the collar into the chest, the collar ending at the neck-front line, and (lying) one belly underline running to the foot of the elbow.',
			chosen:
				'Traces repaired, nothing redrawn: front R-08 / L-09 contours straight past the spots (the spots stay inside the leg clip); the front hind strip line ends in the leg contour (no U-hook); sit / lie back-of-neck lines extended up under the ear with the neck fill closing the nape; lie throat joined to the chest line; sit chest line starts under the collar; collar front ends seated on the neck-front line (sit trimmed 4.5 px, lie extended 6.5 px, panel px); lie belly underline joined to the elbow line. The left-facing sit / lie reuse the same unmarked silhouette, so they carry the same repairs.',
			why: 'The reviewers found V-notches with spots bulging outside the front legs, a stepped hind strip, orphan neck strokes and open contours in the pose bodies.',
		},
		{
			id: 'BADGER-D35-closed-outlines',
			sheetShowed:
				'badger_pose_walking.png and badger_turn_side.png outline every edge a moving part uncovers: the tail\'s underside down to the rump, the buttock behind a raised tail, the thigh\'s top and front when the leg swings, and soft concave curves on the inside of a bent hock or wrist.',
			chosen:
				'Round 2 (gen_left.py, gen_right.py, erode.py, parts/Leg.tsx, parts/SideBody.tsx): the tail is one closed, fully stroked shape whose root stays inside the torso; the torso\'s rump runs on as a stroked buttock and flank fold where the thigh hides it at rest; the near thigh\'s top and back edges are stroked in an \'underlay\' pass drawn under the torso, so only what a swing pushes outside the body shows; a bent wrist, hock or pastern gets a fillet tangent to both edges where they cross (radius 9 units); every leg fill carries a fill-coloured halo (0.3 x LINE.width) with the under-strokes widened to match, closing the anti-aliasing seams that showed as hairline ticks at the paws; short straight tracing nubs at segment cuts are no longer eroded as edges (they left ears outside the outline).',
			why: 'The round-2 review found unoutlined tail roots and rump / thigh wedges in every walk frame and the happy side views, a sharp kink at the far hock and hairline ticks at the front paws.',
		},
		{
			id: 'BADGER-D36-three-quarter-heads',
			sheetShowed:
				'badger_turn_34.png (eyes aligned, 50 crop px = 46.4 units): the nose sits about 7 units beyond the far eye and 32 below the eye line, the far silhouette runs from under the far ear straight to the nose, a bridge line runs from below the far eye to the nose, the mouth rises to the far lip corner under the nose, the chin line is outlined about 15 units higher than the front head\'s, the far upper lip is shaded left of the philtrum, the far cheek spot is hidden by the muzzle, and the far dark ear is one solid shape.',
			chosen:
				'Round 2 (gen_heads.py rebuild_three_quarter): the screen-right 3/4 head\'s skull outline, nose, bridge line, philtrum, four mouths, jaw and lip shadows and near cheek spot are re-authored on those measurements; the skull outline is one stroke over the top, round a rounded far-top corner behind the far ear, round the muzzle behind the nose and along the chin line; the far ear is one silhouette with one outline (the front-view inner and fold fills and strokes are gone). The screen-left head uses the same unmarked outline, nose and mouth geometry with x -> -x (as INT-B1 did); its ears, eyes and markings keep their own construction (pale far ear with its spot H-EAR-R-SPOT; near cheek spot H-CHEEK-L; far cheek spot hidden). Round 3: the screen-left head\'s near cheek spot H-CHEEK-L is placed by the front view\'s own left-cheek position relative to the right one (1.1 units higher), no longer the right cheek\'s 3/4 position mirrored (src/characters/badger/tests/spotsNoMirror.test.ts had measured that pair 0.32 units from an x-mirror).',
			why: 'Turnaround views control identity. The reviewers found the nose under the far eye and 9 units low, a short muzzle, a white crescent in the far dark ear and a black needle and white nick at the far pale ear\'s root.',
		},
		{
			id: 'BADGER-D37-nape-for-turned-heads',
			sheetShowed:
				'No panel shows a head turned back over the shoulder; on the left-facing body the 3/4-right head\'s far contour ran straight into the neck\'s back line beside the nose, so head and neck read as fused.',
			chosen:
				'Round 2 (Badger.tsx LEFT_NAPE_34R / RIGHT_NAPE_34L, SideBody HeadMount.nape): when a side body carries the 3/4 head turned toward its back, the crest of the neck runs from behind the far ear past the muzzle (about 8-12 units clear) into the original back line above the collar, over a coat fill that hides the old line. Other head mounts are unchanged, so the proof\'s swaps keep their cranium positions.',
			why: 'The reviewers measured this as the proof\'s main Badger beat (about 3 s, f97-189).',
		},
		{
			id: 'BADGER-D38-front-head',
			sheetShowed:
				'badger_expr_neutral.png: the skull outline is continuous where the ears attach; the pale ear\'s pink band reaches its fold and bottom; the mouth is closed (gull-wing upper lip with the lower lip joined at the corners, about 33 sheet px either side of the philtrum); two nostril curls; no chin outline. badger_expr_worried.png: the flaps splay out and down (pale tip about 10 units out and 10 down, dark tip about 14 down at the worried amount).',
			chosen:
				'Round 2 (gen_heads.py, parts/heads/Head.tsx): rounded skull corners under the ears and ONE skull outline from jaw to jaw, so folding an ear never opens it; the pale ear is one closed flap outline plus the band\'s free edge (no interior tick, no shelf stub, no white sliver); the dark ear\'s pale inner runs under the cap\'s hollow edge; the neutral mouth is the sheet\'s closed mouth; two nostril curls in line colour (no highlight tone); earsBack combines a smaller swing (pale -11.5, dark +20 deg at full) with a lengthwise stretch along the root-to-tip axis (pale 1.36, dark 1.21 at full; ear props stretch / axis).',
			why: 'Expression drawings show how the same character performs; the reviewers found an outline gap at the folded pale ear on the worried bust and the judge hold, a dangling jaw stub, a floating lower lip and worried ears that drooped instead of splaying.',
		},
		{
			id: 'BADGER-D39-look-up-heads',
			sheetShowed:
				'badger_pose_looking_up.png: a long lip line inside the muzzle from just under the nose back over about 60% of the muzzle, parallel to the jaw\'s lower contour; a short diagonal cheek mark below the ear; one smooth throat line from the jaw angle to the collar.',
			chosen:
				'Round 2 (gen_heads.py build_up; the lip line was moved in round 3, see BADGER-D44): each look-up head draws the lip line 4.5 units inside the pitched jaw contour from 7% to 62% of its length (happy curls its end up, worried down; shocked keeps its open wedge), no commissure hook, a cheek mark placed from the eye as on the panel, and a throat that leaves the jaw along its chord and lands tangent to the neck\'s throat line (no S-curve). The throat still bows slightly forward where it meets the neck: the side rigs\' neck front line sits forward of the raised jaw, so a fully concave throat needs a dedicated look-up neck pose. Round 4: done, see BADGER-D51 (dedicated look-up neck, one nape line, one concave throat).',
			why: 'The reviewers found no lip line, a cheek dash that read as a smile on the throat, a commissure hook and an S-shaped throat with a bump.',
		},
		{
			id: 'BADGER-D40-ear-crown-junction',
			sheetShowed:
				'badger_coat_right.png and badger_turn_side.png: the forehead line runs over the crown straight into the pale ear\'s top edge; badger_turn_34.png: the skull top runs on under the near pale ear.',
			chosen:
				"Round 3 (gen_heads.py): every crown stroke STARTS UNDER ITS EAR and lies on the skull fill's own edge, so the ear (drawn later, earsFront) covers the overlap and the crown emerges from under the ear's outline. Profiles: _crown_under_ear takes the fill's top cubic from x 470 (right, CR px) / 152 (left, CL px) back to the visible crown; the right fill's crown control moved 1 px (514 36 -> 514 35) so the top is tangent-continuous at (500, 35). 3/4 heads: TQ_CROWN_UNDER_EAR continues the dome backward on its own osculating circle (G1 at (-29.4, -102.2), to (-39.1, -98.1)) and the fill's top-left corner follows it (its flat shoulder under the ear is gone); the screen-left head uses the same unmarked outline with x -> -x (D36). Look-up heads inherit the profile crowns; their back contour starts exactly where the crown passes (no step). Checked at 6-16x: right stand, walk 0, look-up right, 3/4, sit and lie right, every head view with earsBack 1, judge 1 and mouthOpen 1.",
			why: 'The R2 review found a white notch where the pale ear meets the crown on the right profile and 3/4-right heads (on screen for the proof\'s whole 3 s turn beat, f97-189) and a jog at the same junction on the look-up heads.',
		},
		{
			id: 'BADGER-D41-shocked-mouth',
			sheetShowed:
				'badger_expr_shocked.png (column scans, mapped by the nose: k 0.92): a gasp. The top edge arches from the corners to an apex under the philtrum, the corners are pointed, the bottom is shallow, and a thin pink tongue lens sits low in the opening. Width 0.89 of the nose, height 0.43 of the nose height; drawn slightly off-centre (that head is tilted).',
			chosen:
				"Round 3 (gen_heads.py SHOCKED MOUTH): one template in apex-relative NF px (least-squares cubic per half on the scanned drops), apex 8.8 units above the corners, bottom 1.7 units below them, width 25.3 units, height 10.5 units, tongue lens 15.3 x 3.6 units; centred on the philtrum (the rig's front head is symmetric). The 3/4 heads map the same template foreshortened (near half 0.86, far 0.59, height 0.76 for their smaller nose) with the apex at the end of the philtrum. mouthOpen grows this shape down from its apex, so 0.3 / 0.6 / 1.0 read as a slightly open mouth, a bark and a gasp (dev BadgerMouthOpen). The review's '4.5 units above the corners' did not match the panel (measured 8.8) and would not reach 0.45 of the nose height with a shallow bottom; the panel was followed.",
			why: 'The R2 review found the shocked mouth upside down (flat top over a deep bowl) so it read as a grin, and every sound-clip mouthOpen inherited it.',
		},
		{
			id: 'BADGER-D42-front-eyes',
			sheetShowed:
				'badger_expr_neutral.png: the irises fill most of the eye and tuck under the upper lid (iris about 0.24-0.25 of the eye spacing, eye width 0.45 of it); badger_expr_shocked.png: big round irises in a rounder, taller opening.',
			chosen:
				'Round 3: front-head iris r 10.6 -> 12.2 NF px and eye half-width 21 -> 22.5 (iris 0.237, eye 0.437 of the spacing); shocked keeps the full iris (EYE_SCALE.shocked iris 0.8 -> 1) and opens the lids instead (up 1.95, low 1.6, w 1.04: height about 0.76 of the width). The 3/4 heads keep the eye width and iris they were fitted to on badger_turn_34.png (factors compensated in gen_heads.py); profiles are unchanged.',
			why: 'The R2 review measured the irises 18% (neutral) and 25% (shocked) smaller than the sheet, so too much white showed and shocked read as pin-pupilled.',
		},
		{
			id: 'BADGER-D43-happy-mouth',
			sheetShowed:
				'badger_expr_happy.png: one interior smile line about 0.75 of the face width with only a small upturn at each end, a notch at the philtrum, the jaw line leaving the cheek and stopping short outside the smile, and a lower-lip arc about 19 px under the smile\'s low points (0.19 of the eye spacing).',
			chosen:
				"Round 3 (gen_heads.py FRONT['mouth']['happy']): the smile ends 19 px inside the face edge (153 / 263 NF px) with 3.5-unit end curls (were 6 units), the jaw pieces are short stubs from the cheek (they ran parallel to the smile and doubled the cheek line), and the lower lip keeps the panel's distance (0.16 of the eye spacing; the review's suggested 3 units under the smile would not match the panel).",
			why: 'The R2 review found a broad double smile: jaw pieces parallel to the smile on each cheek, long dimple hooks and an open lower face.',
		},
		{
			id: 'BADGER-D44-look-up-lip',
			sheetShowed: 'badger_pose_looking_up.png: a thin lip line clearly apart from the muzzle contour, starting a little behind the nose.',
			chosen:
				'Round 3 (gen_heads.py build_up): the lip line runs 8.5 units inside the pitched jaw contour (was 4.5), from 6 units behind the nose tip, at detail weight (LINE.detailWidth); the happy / worried curls follow it. The throat is unchanged: a single concave throat still needs a look-up neck front line (the side rigs\' neck front sits forward of the raised jaw), so it still bows slightly where it meets the neck. Round 4: superseded for the throat and nape by BADGER-D51.',
			why: 'At the proof scale the old lip line merged with the contour into one thick doubled muzzle outline.',
		},
		{
			id: 'BADGER-D45-far-hock',
			sheetShowed: 'badger_pose_walking.png: the far hind leg passes behind the near one without a window of background at its hock.',
			chosen:
				"Round 3: parts/Leg.tsx fillets edges that meet without crossing (a vertex or a gap under 3 units) on the inside of a bend, and a far leg's fillet grows past 40 deg of bend (radius 9 -> 24, cut back 15 -> 34 units); parts/gait.ts keeps the swinging FAR hind leg's reach at 0.95 of its length at mid-swing (WALK.swingReachHindFar; the hip slides inside the body, maxSlide 36), so its hock folds 36 deg instead of 56-65 at left-walk phase 0.125-0.15. dev/walkCheck.ts still passes both facings (no paw below the ground, no stance drift).",
			why: 'The R2 review found a 20-30 unit triangle of background enclosed by the far gaskin, the far cannon and the near leg at left walk phase 1/8; it is now a sliver of about 4 units at that phase.',
		},
		{
			id: 'BADGER-D46-view-contour-refits',
			sheetShowed:
				'badger_turn_front.png: straight, smooth inner fore-leg columns and a smooth far-hind strip; badger_turn_back.png: heels only on the hind paws (no toe splits) and smooth concave curves from the skull sides into the neck.',
			chosen:
				'Round 3 (gen_views.py): the inner contours of both forelegs and the far-hind strip of the front view are least-squares refitted (x = cubic(y), resampled; the ends that meet other contours keep their traced positions); the back view loses its hind-paw toe lines and its skull sides stop where the neck lines take over along the same tangent (the traced hook at (95..99, 105..107) and the corner at (175, 108) are gone).',
			why: 'The R2 review found tracing wobbles, notches and a foot hook on the front legs and hooked jogs at the back view\'s neck.',
		},
		{
			id: 'BADGER-D47-left-nape',
			sheetShowed:
				"badger_coat_left.png: the neck's back line leaves the dark ear at the ear's lower-back corner and runs to the collar; the occiput stays under the ear; the jaw line runs on from under the nose.",
			chosen:
				"Round 4 (gen_left.py NAPE_J / NAPE_BACK, gen_heads.py NAPE_L_J / PL_OCCIPUT / PL_BACK_STROKE): the left rig's neck back stroke starts about 12 px up INSIDE the dark ear and leaves it at NAPE_J (187, 76) coat_left px, the ear's lower-back corner; the neck fill's back edge is that stroke's centre line. profileLeftScreen's skull fill comes down from the occiput into the same point and tucks inside the neck line, and the head strokes its back edge from under the crown to there, so the ear (drawn later) hides every join and a folded ear (worried, judge, earsBack 1) uncovers an outlined occiput, not an open edge. Same pass on the left profile and up-left heads: the jaw line now starts inside the nose, tangent into the chin curve (it began 2-3 units below the nose, a bare gap), and the skull fill's chin follows the jaw stroke (it bulged up to 1.5 px past it, a pale sliver). Seal check (coat touching background with no outline between, 1.9 px/u): 0 px on the left stand with profileLeftScreen and on all 8 left walk phases.",
			why: "The R3 review (major) found no outline pixel at rows 385-388 of the left profile's nape (3.2 px/u) and coat poking up to 3 units outside the line, in every frame of a left walk, the facing Badger walks toward Zoo in.",
		},
		{
			id: 'BADGER-D48-forearm-spots-from-own-maps',
			sheetShowed:
				"badger_pose_walking.png shows the far forearm's spot where it wraps round the leg's back contour. badger_coat_left.png puts L-09 37.2% down its forearm (elbow tip to wrist cut) and 38.5% across from the front contour (7.6 x 12.2 px, tilted 1.8 deg back); badger_coat_right.png puts R-08 35.7% down and 41.0% across (8.0 x 12.2 px, 1.6 deg).",
			chosen:
				"Round 4 (dev/trace/coatmaps.py, gen_left.py, gen_right.py, gen_poses.py, parts/Leg.tsx, parts/SideBody.tsx): every forearm record is placed from its OWN coat map's measured place, size and tilt. The side rigs' far forelegs carry ONE edge record each: R-08 on the left rig's far (right) forearm, L-09 on the right rig's far (left) forearm, where the mark wraps round the leg's back contour (centre 2.3 units inside it, across-axis foreshortened to 0.70); far legs accept edge records only (LEFT_SPOTS now includes R-08, RIGHT_SPOTS L-09). The left sit and lie place L-09 by coat_left's fractions on their own forearms.",
			why: "The R3 review found the side stand and walk far forelegs plain where the walking panel draws the edge spot, and SIT_LEFT / LIE_LEFT L-09 sharing the right poses' R-08 centres (0.6 / 0.8 units from an x-mirror).",
		},
		{
			id: 'BADGER-D49-near-mirror-test',
			sheetShowed:
				"No panel: the binding rule is that no marking is horizontally flipped to make another view.",
			chosen:
				"Round 4 (tests/spotsNoMirror.test.ts): besides exact in-place x-mirrors (0.25 units), the test fails on NEAR mirrors: two records of the same pose family and matching part (legFrontLeft <-> Right and so on) whose centres sit within 20 units of each other's mirror place and whose paths come within 1.0 unit of an x-mirror, in place or after centring and scaling (size ratio up to 1.3), unless the pair is on COAT_MAP_SYMMETRIC with the coat-map evidence. Two pairs are listed: SIT_LEFT L-01 / SIT R-02 (0.14 units; the mid-back spot both maps draw alike) and SIT_LEFT L-09 / SIT R-08 (0.65 units; both placed from their own maps' forearm fractions). A stale allow-list entry fails too, and fixtures re-create the round-3 copies (SIT_LEFT L-09 / SIT R-08, LIE_LEFT L-09 / LIE R-08, SIT_LEFT L-04 / SIT R-03), which must be caught. node --test: 6 / 6 pass.",
			why: "The R3 review showed the round-3 guard only caught exact copies: a flipped record moved by more than 0.25 units or slightly rescaled passed.",
		},
		{
			id: 'BADGER-D50-pose-spots-whole',
			sheetShowed:
				"badger_pose_sitting.png, badger_pose_lying.png and badger_coat_left.png draw every spot whole.",
			chosen:
				"Round 4 (gen_poses.py): no pose spot is cut by a later part's unstroked edge. Occlusion check before / after: sit R-01 10% under the haunch -> 0, sit L-09 30% under the torso -> 0, lie R-01 3% -> 0, sitLeft L-02 12% / L-04 62% / R-08 22% -> 0, lieLeft L-02 9% / L-04 36% -> 0; lieLeft L-06 no longer straddles the thigh line. The right sit's sliced croup spot is R-01 (the review called it R-03; R-03 was never covered): it moves to where the sitting panel draws it. The left sit's L-02 / L-04 and the left lie's L-04 sit fully on the torso and L-06 inside the thigh, as coat_left places them, each with coat_left's own size and tilt turned by the pose's turn of that body region. The right sit's torso corner over the far foreleg rises from (240, 282) to (241, 266) panel px so the far forearm's edge mark is no longer cut along it.",
			why: "The R3 review found spots sliced along unstroked part edges in both sits and the left lie, reading as half-moons.",
		},
		{
			id: 'BADGER-D51-look-up-neck',
			sheetShowed:
				"badger_pose_looking_up.png: one smooth nape line from under the hanging ear to the collar and one concave throat line from the jaw angle to the collar.",
			chosen:
				"Round 4 (gen_heads.py _neck_up, Head.tsx neckUp, SideBody): each look-up head carries a dedicated look-up neck for its own rig. Nape: ONE cubic from the point where the skull's back contour is still 3.5 units under the hanging ear (the join hidden by the ear) to where the neck's back line goes under the collar, leaving along the contour and arriving along the neck line; the wedge between it and the skull's lower back edge is neck fill (a fillet into the old neck line, tried first, read as an occiput knob over a dent). Throat: one concave cubic from the jaw angle to where the rig's throat line enters the collar. SideBody draws this neck instead of the rig's, and draws its part above the collar's centre line again after the torso (strokes stopping 2.5 units under the collar), so the torso's back-stroke start, which the 20 deg left look-up neck turn exposed above the collar as a stray tick in every frame, stays behind the neck. Seal check: 0 px on both look-ups. An up head on the OTHER rig (cross-facing) keeps the rig neck.",
			why: "The R3 review found a round-capped stub and Z step at the nape (47 frames of the proof's look-up beat) and a throat that kinked at the jaw and bowed convex.",
		},
		{
			id: 'BADGER-D52-front-mouths',
			sheetShowed:
				"badger_expr_worried.png: a closed lens mouth narrower than a bar, drooping corners, the lower lip close under the upper, the cheek lines running into the corners. badger_expr_happy.png: a smooth face contour running on into the neck, single-line smile curls.",
			chosen:
				"Round 4 (gen_heads.py FRONT mouth): worried is the neutral construction with the corners 2.5 units lower and 4 px further in each side (59 NF px wide against the old bar's 91), the lower lip 7 px under the corners, the cheek contours running into the corners, no floating frown. Happy loses the jaw stubs and the separate end curls: each curl is the smile stroke itself, continued 9.5 px up along its own curvature (tangent-continuous). Where the front head sits on a SIDE rig (the default left view) its jaw edge meets the background, not the front neck, so the happy mouth carries sideStrokes, one stroke from each cheek's end down the neutral jaw line, along the lower-lip arc and up the other side, drawn only when Head is mounted (prop mounted, set by SideBody); the bust and the front view keep the panel's open lower face. Seal check, happy on the side rigs: 400-500 px of open jaw edge -> 29-35 px (the same small jaw / neck junction that neutral and worried have).",
			why: "The R3 review found the worried mouth a box-jaw bar with a floating frown, and happy's jaw stubs and knob curls; dropping the stubs alone opened the side-mounted happy face (found by this round's seal check).",
		},
		{
			id: 'BADGER-D53-three-quarter-far-eye',
			sheetShowed:
				"badger_turn_34.png: the far eye is a full almond with white between it and the far contour; the bridge is a thin line; the near cheek contour comes out from under the near ear.",
			chosen:
				"Round 4 (gen_heads.py rebuild_three_quarter, TQ_FAR_EYE_IN, TQ_BRIDGE, TQ_NEAR_CHEEK, Head.tsx): both 3/4 heads move the far eye and brow 2.5 units inward so white shows past the iris, draw the bridge at detail weight (LINE.detailWidth) and shorten it at the far eye, and start the near cheek stroke under the near ear (its cap is hidden by the ear); the fill's near edge follows the cheek and ear so no background wedge shows between the pale ear and the face.",
			why: "The R3 review found the far eye fused into the far contour, a full-weight bridge boxing it in, and a round-cap tick at the near ear's corner.",
		},
		{
			id: 'BADGER-D54-profile-jaw-drop',
			sheetShowed:
				"No panel; the owner asked for Badger's mouth to animate from real-dog sound clips (mouthOpen), and the side views carry many of them.",
			chosen:
				"Round 4 (gen_heads.py _jaw, Head.tsx jawDrop): profile and look-up heads drop the jaw for mouthOpen. The lower jaw is the lens between the mouth line (one cubic from the commissure to the lip front under the nose) and the jaw's underside (the skull's own lower stroke); it rotates about the commissure by 14 deg x lerp(0.3, 1, amount), front down (7.1 / 10.1 / 14 deg at 0.3 / 0.6 / 1). The gap between the fixed mouth line and the rotated one is the open mouth (mouth colour, the tongue riding on the jaw, outlined, its front edge bowing in); the rotated jaw is filled and its underside stroked. The shocked expression keeps its own wedge. Front and 3/4 heads keep growing their own open mouth (D31).",
			why: "The R3 review found the profile and up heads' sound-clip mouth a thin wedge inside an unchanged muzzle: at mouthOpen 1 it read as a thick lip line, not a bark.",
		},
		{
			id: 'BADGER-D55-head-scale',
			sheetShowed:
				"At one body scale the turnaround side head measures 181 px ear-back to nose against 162 for the rig's profile head (coat_right itself draws its head 7% shorter than turn_side); the front head's eye spacing is 57.2 units against 49.4 on badger_turn_front.png but within about 5% of the size panel; crown-to-eye is 45.0 units on the front head and 30.4 on the profile (ratio 0.68, turnaround 0.83). Round 5 re-measured every view against its own turnaround panel at the views' trace scale (S = 312.6 / 329 units per crop px), with a similarity fit of the head ink (uniform scale about the face centroid plus shift, symmetric chamfer cost, ears in, collar out) and landmarks: front vs badger_turn_front.png best scale 0.900-0.925 (cost 2.58 -> 1.14; eye spacing 57.2 vs 49.4-51.3 units, crown to lower lip 115.8 vs 101.7, cheek width 101 vs 92: big in height as much as in width); 3/4 vs badger_turn_34.png 0.970-0.975 (cost nearly flat to 1.0; eye to nose 63.3 vs 62.5); right profile vs badger_turn_side.png (eye-aligned) 1.030-1.035 with the cost flat within 0.5% of 1.0: its top and underside contours lie within 1-3 units of the panel's from 20 units behind the eye to the nose, eye to nose 66.0 vs 67.1, and the neck's back line within 1-2 units. The ear-back-to-nose gap is the EAR: turn_side hangs the flap 17-24 units further back from the eye than coat_right, which the profiles were traced on.",
			chosen:
				"APPLIED in round 5 (gen_heads.py HEAD SCALE): the turnaround controls head size relative to the body, the size panel only the overall scale (D01). The front head is scaled uniformly by 0.90 and the 3/4 heads by 0.95 about the head pivot (so on a side rig the jaw / neck junction stays and the crown comes down), not 0.86 in width only: the front head was as much too tall as too wide. The profiles keep x1.00 (the look-up heads follow them): a uniform x1.10 would make their face 10% too big against turn_side while closing only half of the ear gap. After the rescale the fits read front 0.995 and 3/4 1.005 (each within 0.5% of its panel). The bust neck (FRONT_NECK_GEOM) scales with the front head about the head's origin, so every expression bust is a uniformly scaled copy of the round-4 bust (ink XOR after scaling back: shapes identical, the lines relatively 11% heavier) and still matches badger_expr_*.png; the expressions' brow offsets scale with the head (HeadViewGeom.scale). The turned-mount napes and jaws (D56) and the front head's side-mount jaws (D57) are generated from the scaled heads.",
			why: "The R4 review found the front head about 16% wide against the turnaround (eye spacing / figure height 0.1245 vs 0.1023) and the head changing size at every proof swap; a uniform x0.86 width scale alone would have left the face too long, and the profile x1.10 recorded in round 4 is contradicted by the panel-by-panel fit (its face already matches turn_side). Open: the profile's ear placement (17-24 units nearer the eye than on turn_side) and the proof's swap neck values (Preview10s SWAP), which were tuned for the round-4 head sizes and are the integrator's to re-measure.",
		},
		{
			id: 'BADGER-D56-turned-mount-jaw-nape',
			sheetShowed:
				"badger_turn_34.png runs the near contour of a 3/4 head as one line from under the ear down the cheek into the neck; no panel shows the head turned back over the shoulder (the proof's 3-second beat on the left body).",
			chosen:
				"Round 5 (gen_heads.py TURNED 3/4 MOUNTS, Head.tsx mountJaws, SideBody turned.nape): the 3/4-right head on the left rig and the 3/4-left head on the right rig carry generated mount geometry for their own rig. Jaw (head-local, drawn only on that rig): one cubic from the near cheek stroke's end along its tangent onto the rig's throat line 4 units below where it leaves the skull, then 7 units down the throat (over the neck's own line, so a head tilt of a few degrees never opens the join), plus a coat fill from the line back inside the skull and neck fills. Nape (neck-local, replaces the hand-written LEFT_NAPE_34R / RIGHT_NAPE_34L of D37): the crest from 4 units inside the far ear's fill to the end of the neck's back line under the collar, and a fill bounded by it, the old back line (2.8 units past it) and, hidden under the head, the skull's far contour and the far ear (4 and 8 units inside them), so the neck reaches up into the far ear's root. Seal check at 3.2 px/u: 383 -> 0 px (left rig; also 0 with every expression, ears back, judge, mouthOpen, head tilt -3..3, neck 5..8) and 389 -> 0 (right rig); Badger-only Preview10s f97-f189 at 0.88 px/u: 31-33 -> 0 px in every frame.",
			why: "The R4 review (major, filed under integration) found 28-32 px of open jaw on every frame of the proof's turn beat (322 px at 3.2 px/u) and a 61 px leak at the far ear's root.",
		},
		{
			id: 'BADGER-D57-front-head-side-jaw',
			sheetShowed:
				"badger_expr_*.png draw the front face's lower contour running on into the neck; on a side rig the front head's chin edge meets the background on the throat side.",
			chosen:
				"Round 5 (gen_heads.py FRONT_SKULL_FILL, FRONT_MOUNTS, Head.tsx): the front skull fill now runs along the outline's centre line from jaw corner to jaw corner over the crown (it sat 2.8 units inside it, leaving a 1-unit background sliver inside the cheek contour on the side rigs, worst with the shocked jaw) and below the corners along the outer jaw contour (the shocked mouth's jaw line). Each side rig gets a generated jaw closure on the throat side, from the outline's end down that edge into the rig's throat line and 7 units down it, drawn for every mouth except the shocked gasp (MouthGeom.fullJaw), whose own jaw line is that contour; the expression's jaw line then reads as the lip line inside it. Seal check at 3.2 px/u: left 79 / right 82 px -> 0 (also happy, worried, shocked 242 -> 0, ears back, judge, mouthOpen, tilt -8..13, neck 10); the bust and the front view are unchanged (the neck lies behind the chin).",
			why: "The R4 review found the jaw / neck junction open on the default left view (79 px; 3-7 px per proof frame) and a light sliver inside the cheek with the shocked expression (242 px).",
		},
		{
			id: 'BADGER-D58-profile-right-back-contour',
			sheetShowed:
				"badger_coat_right.png and badger_turn_side.png outline the back of the skull and the nape down from under the pale ear.",
			chosen:
				"Round 5 (gen_heads.py _profile_r_back): as the left profile does since round 4, the right profile strokes its own back contour, from where its crown stroke starts under the pale ear, over the occiput and down the skull fill's edge to its crossing with the right rig's neck back line, then 4 units down that line (a plain corner, the nape notch). The right rig's neck fill now follows its own strokes exactly at their ends (gen_right.py: the closed fill spline used to bulge up to 1.9 units past the throat stroke near the jaw). Seal check at 3.2 px/u: right profile 67 -> 0 px (worried 98, judge 83, earsBack 98 -> 0), right walk 54-62 -> 0 in every phase, the right rig's 3/4 heads 10 -> 0. The left profile's own back stroke now starts at x 150, under the start of its crown stroke (it started at x 180, t 0.7 of the crown's back cubic): a vocalisation lifts the ear 8.4 deg, its back half swings down and bared that crown edge (left profile with mouthOpen 1: 18 -> 0 px; the rest pose renders pixel-identical).",
			why: "The R4 review found 18 px at the pale ear's root and 49 px at the throat on the right profile, in every right walk phase as well.",
		},
		{
			id: 'BADGER-D59-view-and-pose-seals',
			sheetShowed:
				"The turnaround and pose panels outline every edge where the coat meets the background.",
			chosen:
				"Round 5: (1) every view and pose part's fill now takes the stroke's own end tangent where a stroke ends on a fill point (dev/trace/sealends.py; the closed fill spline used to bulge past the line there); (2) front view: the torso's outer lines start inside the collar band's ends, the fill's top corners under it; (3) back view: the groin between the hind legs is outlined; (4) 3/4 view: the near hind leg's front line starts where the belly line starts; (5) sit (and its mirrored left sit, D23 unchanged): the back line starts under the collar, the haunch's line follows its fill past the corner to the tail, the tail's line runs on up under the haunch, the torso fill's lower rear corner lies on the haunch's line (it poked out below it into the background between tail, haunch and hind paw and hid the top of the tail's front line), and the far front leg's fill no longer crosses itself (it left a pocket of background between the paws); (6) bust (FRONT_NECK_GEOM): the fill's shoulder edges follow the shoulder strokes from under the collar's ends (they ran up to 1 px outside them, a coat sliver below each collar end). Seal check at 3.2 px/u: front view 204 -> 0, back 80 -> 0, 3/4 41 -> 0, right / left sit 300 / 301 -> 0 / 0 (every expression), right lie 2 -> 0; on the rendered BadgerSheet every full figure 0 (round 4: 52) and the busts 90 -> 0 above their flat bottom cut, which stays open by design.",
			why: "The R4 review listed the collar ends of the front view, the back view between the hind legs, a 3/4 belly / leg corner and three spots on the sit.",
		},
	],
};
