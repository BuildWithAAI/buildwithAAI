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
			"In view 'left' the near legs are the anatomical LEFT legs (legFrontNear, legHindNear); the far legs are the RIGHT legs, drawn behind in coatShadow with no visible markings.",
			"view 'right': the dog faces SCREEN RIGHT and its ANATOMICAL RIGHT side faces the camera (badger_coat_right.png). Near legs are the anatomical RIGHT legs; the far (LEFT) legs are drawn behind in coatShadow. The near ear is the PALE right ear.",
			"view 'front': anatomical LEFT = SCREEN RIGHT (dark ear on screen right). view 'back': anatomical LEFT = SCREEN LEFT (dark ear on screen left). view 'threeQuarter': the dog's right flank faces the camera, the head turned to screen right (badger_turn_34.png).",
			"Every view and pose body is its own trace with its own marking records. Two drawings reuse an UNMARKED, bilaterally symmetric outline mirrored about the root: the far skull outline of the screen-left 3/4 head, and the silhouette of the left-facing sit and lie bodies (decision BADGER-D23). Their markings are authored for their own side; no marking, ear colour or spot path is ever flipped.",
			"Front head: anatomical left = screen right. The DARK-capped ear is the anatomical LEFT ear in every head view (screen right in 'front'; the near ear in left-facing views; the far ear in right-facing views).",
			'The pale anatomical RIGHT ear carries the small spot H-EAR-R-SPOT.',
			'No view is produced by horizontally flipping the character or any marking (see decisions D-08, D-09, D-23). The right profile head is traced on coat_right, not mirrored (D-09, revised).',
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
			sit: "threeQuarterRightScreen (view 'left': threeQuarterLeftScreen, dark ear near)",
			lie: "threeQuarterRightScreen (view 'left': threeQuarterLeftScreen, dark ear near)",
			walk: 'profileLeftScreen / profileRightScreen (facing)',
			lookUp: 'upLeftScreen / upRightScreen (facing)',
		},
		poses: {
			stand: 'all five views',
			lookUp: "side views: head 'upLeftScreen' / 'upRightScreen' + raised neck (the sheet faces right; front/back/3/4 requests render the right view)",
			walk: 'side views, both facings: 4-beat lateral-sequence gait from walkPhase, IK legs, planted stance paws (front/back/3/4 requests render the right view)',
			sit: "traced pose body (badger_pose_sitting.png), screen-right facing with right-side markings; view 'left' faces screen left with the LEFT markings on the unmarked mirrored silhouette (decision BADGER-D23)",
			lie: "traced pose body (badger_pose_lying.png), screen-right facing with right-side markings; view 'left' faces screen left with the LEFT markings on the unmarked mirrored silhouette (decision BADGER-D23)",
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
			'Numerically checked with src/characters/badger/dev/walkCheck.ts (esbuild + node; 3 cycles x 400 = 1201 samples per facing, all four legs, root moving WALK.stride per cycle), measured on the DRAWN paw and pastern curves: the traced sole never goes below the ground line (max 0.000 units, both facings; the outline reaches LINE.width / 2 below it exactly as in the stand), a planted paw keeps a fixed contact (drift 0.000), paws are planted 60.3% of the time (duty 0.6), swing clearance up to 28.4 units, and a swinging paw pitches toes-down at most 28 deg.',
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
			chosen:
				'REVISED in round-1 repair: profileRightScreen is traced directly on coat_right (skull, stop, nose, eye, lip line, ear outline, fold line, pink inner band at the fold from turn_side, spot H-EAR-R-SPOT). v1.0.0 built it by mirroring the left profile; that is removed. Look-up heads are the profiles pitched 40 deg and joined to the rig necks (D27).',
			why: 'Opposite views carry their own drawing and markings; the reviewers measured the old right ear as an exact mirror of the left one.',
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
			chosen:
				'REVISED in round-1 repair (2026-11-24): right-facing level views (right stand, right walk, right look-up) show the right lobe implied by the top map, a wedge at the front of the withers about 78 x 24 units (RIGHT_SPOTS L-WITHERS), deepest just behind the collar and tapering to the top line; the elevated 3/4 and the sit and lie bodies show the dorsal patch traced from their panels (about 50 x 36, 24 x 75 and 48 x 28 units). Authored per view, never mirrored from the left record. OWNER CONFIRMATION REQUESTED: the alternatives are coat_right\'s thin edge (v1.0.0) or the turnaround side\'s full patch.',
			why: 'The top coat map, a binding coat map, puts the front of the patch across the spine, so it must show from the right; projecting its right lobe onto a rounded back gives about 15-27 units of depth at the front. This keeps the signature marking visible in every right-facing shot without inventing a second patch, and stays closer to coat_right than the pose panels do.',
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
				'The sitting, lying, walking and looking-up panels all face screen right. Episodes stage Badger to the right of Zoo facing left, so a sit or lie beat must be able to face left.',
			chosen:
				'REVISED in round-1 repair: sit and lie exist in both facings. view right (or front/back/3/4) uses the traced right-facing bodies with right-side markings. view left uses the same UNMARKED silhouette mirrored about the root (outline, collar and tag are bilaterally symmetric, the same approach as the 3/4-left skull) carrying the LEFT coat map\'s own markings authored for it (L-WITHERS as the full patch, L-01..L-09, L-NECK, R-08 on the far forearm edge, M-CHEST) and head threeQuarterLeftScreen (dark ear near). walk and lookUp are built on both side rigs as before.',
			why: 'v1.0.0 silently rendered the right-facing body for view left, turning Badger away from Zoo and swapping his visible markings mid-scene. Only symmetric anatomy is reused; no marking is flipped.',
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
			chosen:
				'REVISED in round-1 repair: 4-beat lateral-sequence gait (duty 0.6, 358.3 units per cycle, stance sweep 215 units), lateral pairs close together so walkPhase 0 is the sheet frame (far fore landing, far hind just planted, near hind at toe-off, near fore in late stance). Paws are solved on their DRAWN outline: the end-of-stance roll is heel-up about the toe point that is lowest at full roll, a ground clamp keeps the traced sole on the ground line in stance and above it in swing, the swinging fore leg raises its scapula (the rig has no elbow joint), and the paw pitches toes-down at most 28 deg. Neck +2 deg, tail +34 deg while walking. Verified by dev/walkCheck.ts (see walk.verification).',
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
			chosen:
				'Revised in round-1 repair (gen_heads.py fix_three_quarter): one far contour from the far temple, pulled in at the far cheek below the far eye, round the far side of the muzzle and the nose and on round the chin (the chin is now outlined); the near cheek stops at the jaw (it curled into the lip and read as a grin); the neutral / worried lip line ends under the nose; the far ear shows its outer side only (solid dark cap); the nose sits 3 units further toward the far side; irises 15% larger; the front head\'s lower-lip detail is dropped. The screen-left turn reuses the far outline of the unmarked symmetric skull as before; no marking is mirrored.',
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
			why: 'Expression drawings show how the same character performs; the reviewers found happy indistinguishable from neutral and shocked twice the panel\'s size with the jaw open.',
		},
		{
			id: 'BADGER-D31-mouth-open',
			sheetShowed:
				'No panel; CLAUDE.md records the owner\'s request that Badger\'s mouth and ears animate from real-dog sound clips through a mouth-open control, with no redesign.',
			chosen:
				'Optional prop mouthOpen (0..1) on <Badger/>: each head view\'s own open-mouth drawing (the shocked mouth) grows down from the upper lip with the amount, the jaw line stays, and the ears lift slightly. Below 0.06 the expression\'s own mouth is shown. Nothing renamed.',
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
				'With expression happy the side views carry the tail at least 32 deg above the stand (the wag stays restrained). Breathing scales the chest by 1.5% (was 0.6%), about 2 px at the proof scale.',
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
	],
};
