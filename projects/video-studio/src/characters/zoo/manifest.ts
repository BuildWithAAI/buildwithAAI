/**
 * ZOO character manifest, v1.0.0 (front-view core rig). The reusable baseline: reuse these assets
 * unchanged across episodes. Identity source: reference/model-sheets/zoo_model_sheet_v1.png and
 * its crops in reference/crops/. Binding rules: docs/PROJECT_INSTRUCTIONS.md.
 */
import {BRAND, LINE, ZOO_COLORS} from '../palette';
import {ARM_POINT, BREATH, EXPRESSIONS, FRONT, PIVOTS, POINT_HAND_FRAME, POINT_HAND_SWITCH} from './rig';
import {MOUTHS} from './mouth';
import {PIN_CENTER} from './parts/Pin';

type PartPivot = {x: number; y: number; parent: string | null; controls: string};

export type ZooManifest = {
	id: 'zoo';
	version: '1.0.0';
	views: Record<'front' | 'threeQuarter' | 'side' | 'back', string>;
	units: string;
	palette: {keys: Record<string, string>; brand: string[]; line: {color: string; width: number; detailWidth: number}};
	dimensions: typeof FRONT & {measuredFrom: Record<string, string>};
	conventions: Record<string, string>;
	pivots: Record<string, PartPivot>;
	expressions: string[];
	mouthShapes: string[];
	poses: Record<string, string>;
	animation: Record<string, string | number>;
	decisions: {id: string; sheet: string; chosen: string; why: string}[];
	knownGaps: string[];
};

const p = (k: keyof typeof PIVOTS, controls: string, parent?: string): PartPivot => ({
	x: PIVOTS[k].x,
	y: PIVOTS[k].y,
	parent: parent ?? PIVOTS[k].parent,
	controls,
});

export const ZOO_MANIFEST: ZooManifest = {
	id: 'zoo',
	version: '1.0.0',
	views: {
		front: 'built (src/characters/zoo, this rig)',
		threeQuarter: 'not built yet; <Zoo view="threeQuarter"> currently draws the front view',
		side: 'not built yet; falls back to the front view',
		back: 'not built yet; falls back to the front view',
	},
	units:
		'World units: 1 unit = 1 px at scale 1. ZOO is exactly 900 units from sole (y=0) to the top of the hair outline (y=-900). Origin = ground contact point between the feet; y grows downward.',
	palette: {
		keys: {...ZOO_COLORS},
		brand: ['nearBlack (outlines)', 'offWhite (pin highlight)', 'teal (pin, via ZOO_COLORS.pin)', 'background (dev renders only)'],
		line: {color: LINE.color, width: LINE.width, detailWidth: LINE.detailWidth},
	},
	dimensions: {
		...FRONT,
		measuredFrom: {
			scale: 'zoo_turn_front.png: figure 630 px tall (hair top y=10, sole y=640) = 900 u, so 1 px = 1.4286 u; body axis at x=150',
			head: 'hair top y=10 to beard chin y=122: 112 px = 160 u; 900/160 = 5.63 heads tall (sheet: 5-6 heads)',
			shoulders: 'outer silhouette at the deltoids x=66..232 px incl. outline = 237 u; rig 246 u incl. sleeve outline',
			hips: 'trouser band x=96..200 px at y=420 = 149 u between outline centres; rig 160 u outer edges',
			legs: 'crotch y=365 px (-392 u) to sole: 392 u; inseam gap 0 at the crotch to 50 u at the hem; outseam +-80 to +-86 u',
			hands: 'cuff bottom y=346 to fingertips y=414 px: 96 u long; thumb-to-little-finger 34 px = 48 u',
			face: 'zoo_expr_neutral.png at 0.699 u/px (hair top y=22, chin y=251): face 116 px = 81 u at the cheeks, eyes 31x14 px = 22x10 u, iris 14 px = 10 u, eye centres 61 px = 43 u apart',
			features:
				'front view heights (identity control): brow bottoms -827, eye line -816, nose bottom -786, moustache top -780, chin -740 (see ZOO-F2)',
		},
	},
	conventions: {
		anatomical: 'Prop and part names ending in L/R are ANATOMICAL. In the front view anatomical LEFT is screen RIGHT (+x).',
		pin: `Teal jellyfish pin on the anatomical LEFT chest (screen right), above the chest pocket, centre (${PIN_CENTER.x}, ${PIN_CENTER.y}).`,
		pocket: 'Chest pocket on the anatomical-left panel (screen right), x 39..81, top -637, point -592.',
		buttons: 'Five small silver buttons on the anatomical-right panel (screen left) at x=-28.4, y -686/-625/-567/-509/-452. The overshirt is worn open over the tee.',
		brows: 'Anatomical-left brow (screen right) sits ~2 u higher with a soft arch at rest: the deadpan raised brow.',
		hair: 'Asymmetric: swept top, crown curl with a dark hollow right of centre, pointed forelock hanging left of centre to (-17.5,-841), wings on the screen-left. Never mirrored.',
		mirroring:
			'No view is ever made by flipping. Bilateral pairs without markings (ears, eyes, hands, sleeves, legs, shoes, collar leaves) are authored once and mirrored to the opposite side WITHIN the front view.',
		layering:
			'back to front: legs+shoes, arms (behind the overshirt panels), collar stand, neck, tee, overshirt panels, collar leaves, pocket, buttons, pin, head (back hair, ears, face, mouth, beard, moustache, jaw outline, nose, eyes, brows, front hair).',
		coordinateSpaces:
			'Every part is authored in root space at its rest position, so a part space equals root space at rest; pivots below are valid in both. A child rotates inside its parent group.',
	},
	pivots: {
		root: p('root', 'x, y, scale'),
		legs: p('legs', 'static'),
		shoeL: {x: 70, y: -2, parent: 'legs', controls: 'static'},
		shoeR: {x: -70, y: -2, parent: 'legs', controls: 'static'},
		torso: p('torso', 'breathe (scaleY about the hem)'),
		collarBack: {x: 0, y: -740, parent: 'torso', controls: 'rides on torso'},
		pin: {x: PIN_CENTER.x, y: PIN_CENTER.y, parent: 'torso', controls: 'rides on torso'},
		neck: p('neck', 'breathe (translate)'),
		head: p('head', 'headTilt (deg), rotates every head part', 'neck'),
		hairBack: {x: 0, y: -748, parent: 'head', controls: 'rides on head'},
		hairFront: {x: 0, y: -748, parent: 'head', controls: 'rides on head'},
		earL: {x: 40, y: -800, parent: 'head', controls: 'rides on head'},
		earR: {x: -40, y: -800, parent: 'head', controls: 'rides on head'},
		browL: p('browL', 'expression, browLift (0..1 = up to 3.5 u)'),
		browR: p('browR', 'expression, browLift'),
		eyeL: p('eyeL', 'blink (upper lid), lookX/lookY (iris, +-4.2 u / +-1.8 u), expression (lids, iris scale)'),
		eyeR: p('eyeR', 'blink, lookX/lookY, expression'),
		nose: {x: -2, y: -790, parent: 'head', controls: 'rides on head'},
		moustache: {x: 0, y: -776, parent: 'head', controls: 'expression (smirk lifts the screen-right half)'},
		beard: {x: 0, y: -740, parent: 'head', controls: 'mouth shape (lip patch drops by MOUTHS[shape].hole)'},
		jaw: p('jaw', 'mouth / expression; chin outline drops by MOUTHS[shape].jaw'),
		upperArmL: p('shoulderL', 'pose/poseAmount', 'torso'),
		forearmL: p('elbowL', 'pose/poseAmount', 'upperArmL'),
		handL: p('wristL', 'pose/poseAmount; hand shape relaxed -> point at poseAmount >= 0.35', 'forearmL'),
		upperArmR: p('shoulderR', 'rest in v1', 'torso'),
		forearmR: p('elbowR', 'rest in v1', 'upperArmR'),
		handR: p('wristR', 'rest in v1', 'forearmR'),
	},
	expressions: Object.keys(EXPRESSIONS),
	mouthShapes: Object.keys(MOUTHS),
	poses: {
		stand: 'arms relaxed at the sides',
		point: `anatomical LEFT arm (screen right) raised to shoulder height and extended to screen right, index extended. Joint deltas at poseAmount 1: shoulder ${ARM_POINT.shoulder}, elbow ${ARM_POINT.elbow}, wrist ${ARM_POINT.wrist} deg; hand swaps at ${POINT_HAND_SWITCH}; pointing-hand frame ${POINT_HAND_FRAME} deg.`,
		typing: 'not built in the front rig (seated 3/4 pose); falls back to stand',
	},
	animation: {
		breathAmplitudeUnits: BREATH.amplitude,
		breathPeriodSeconds: BREATH.periodSeconds,
		blink: 'blink 0..1 slides the upper lid down; keep eyes open between natural blinks',
		lipSync: 'amplitudeToMouth(amplitude, prevShape) -> closed | slightlyOpen | oh | ah, with hysteresis. Use only with a real audio envelope.',
	},
	decisions: [
		{
			id: 'ZOO-C1',
			sheet: 'Prompt 1 calls the overshirt "slate"; the drawing renders it #37383F, lighter than the near-black tee.',
			chosen: 'Overshirt #37383F with one shadow tone (recorded in palette.ts).',
			why: 'The approved drawing defines garments; brand slate stays for props.',
		},
		{
			id: 'ZOO-C2',
			sheet: 'The beard is drawn lighter and warmer than the hair (medians #845D40 chin, #77563F cheek vs hair #594235); palette v1 had beard = hair.',
			chosen: 'beard #7A5940, beardShadow #5E4535 (palette.ts, ZOO keys only).',
			why: 'Front and expression panels agree; matching them keeps the face recognisable.',
		},
		{
			id: 'ZOO-F1',
			sheet: 'In the front turnaround the face sits ~5 u right of the body axis (eye centre +5.5, jaw centre +1.5).',
			chosen: 'Face centred on the body axis; the hair keeps its measured asymmetry relative to the face (from zoo_expr_neutral.png).',
			why: 'The offset is inconsistent within the drawing itself (drawing jitter); the hair-to-face relationship is the identity-bearing feature.',
		},
		{
			id: 'ZOO-F2',
			sheet: 'The front turnaround places brows, eyes, nose and moustache ~3 u lower than the neutral close-up (same hair top and chin).',
			chosen: 'Front-view heights: eye line -816.5, moustache top -782.6, mouth line -768.3; shapes taken from the close-ups.',
			why: 'Reference priority: front and turnaround views control anatomy; expression drawings show performance.',
		},
		{
			id: 'ZOO-F3',
			sheet: 'The front turnaround shows level brows; the Neutral (deadpan) panel shows the anatomical-left brow ~3 u higher with an arch.',
			chosen: 'Neutral keeps the subtly raised anatomical-left brow.',
			why: 'Prompt 1 defines neutral acting as "flat straight mouth and subtly raised brow"; browLift and the other expressions animate from there.',
		},
		{
			id: 'ZOO-M1',
			sheet: 'The mouth panels draw the lower face ~15% narrower than the turnaround.',
			chosen: 'Face width from the turnaround; mouth shapes matched in size and placement relative to the moustache.',
			why: 'Reference priority (front view controls anatomy).',
		},
		{
			id: 'ZOO-E1',
			sheet: 'The Shocked panel shows a medium open oval mouth (about 17 x 11 u), between "oh" and "ah".',
			chosen: 'Shocked defaults to the "ah" library shape at 70% opening and 82% width instead of adding a seventh shape.',
			why: 'Keeps the fixed six-shape mouth library while matching the panel.',
		},
		{
			id: 'ZOO-P1',
			sheet: 'The pointing panel draws the shoulders ~35 u higher than the turnaround; its upper arm is ~30 deg from vertical.',
			chosen: 'On the turnaround body the upper arm swings 46 deg so the hand reaches shoulder height, forearm ~50 deg above horizontal, index ~15 deg above horizontal.',
			why: 'Matching the panel angles on the turnaround body left the hand at chest height; Prompt 2 and the panel both put the point at shoulder height.',
		},
		{
			id: 'ZOO-A1',
			sheet: 'In the front view each sleeve\'s inner contour coincides with the overshirt side contour.',
			chosen: 'Arms are layered behind the overshirt panels.',
			why: 'Identical at rest, and a raised arm emerges from under the shoulder seam instead of cutting a line across the chest.',
		},
		{
			id: 'ZOO-S1',
			sheet: 'Ears, eyes, hands, sleeves, legs, shoes and collar leaves are drawn as symmetric pairs; hair, brow raise, smirk, buttons, pocket and pin are one-sided.',
			chosen: 'Unmarked pairs are authored once and mirrored to the other side inside the same view; one-sided items are drawn per side and never mirrored.',
			why: 'Project rule: never flip an asymmetric character or its markings to make another view.',
		},
	],
	knownGaps: [
		'3/4, side and back views are not built in v1.0.0; any view prop renders the front view.',
		'Pose "typing" is not built; it renders "stand".',
		'Only the anatomical-left arm can point; the right arm stays at rest.',
		`Brand colours used outside ZOO_COLORS: ${BRAND.nearBlack} (outline), ${BRAND.offWhite} (pin highlight).`,
	],
};
