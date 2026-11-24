/**
 * ZOO character manifest, v1.0.0 (front core rig + 3/4, side and back views + seated typing pose).
 * The reusable baseline: reuse these assets unchanged across episodes. Identity source:
 * reference/model-sheets/zoo_model_sheet_v1.png and its crops in reference/crops/. Binding rules:
 * docs/PROJECT_INSTRUCTIONS.md.
 */
import {BRAND, LINE, PROP_COLORS, ZOO_COLORS} from '../palette';
import {ARM_POINT, ARM_POINT_MID, ARM_POINT_WINDUP, BREATH, EXPRESSIONS, FRONT, PIVOTS, POINT_HAND_FRAME, POINT_HAND_SWITCH} from './rig';
import {MOUTHS} from './mouth';
import {PIN_CENTER} from './parts/Pin';
import {PIVOTS_34, PIVOTS_BACK, PIVOTS_SIDE, PIVOTS_TYPING, type ViewPivot} from './views/pivots';
import {TYPING_LAYOUT} from './views/Typing';
import {DESK} from './props/Desk';
import {CHAIR} from './props/Chair';
import {KEYBOARD} from './props/Keyboard';

type PartPivot = {x: number; y: number; parent: string | null; controls: string};

export type ZooManifest = {
	id: 'zoo';
	version: '1.0.0';
	views: Record<'front' | 'threeQuarter' | 'side' | 'back', string>;
	units: string;
	palette: {keys: Record<string, string>; propKeys: Record<string, string>; brand: string[]; line: {color: string; width: number; detailWidth: number}};
	dimensions: typeof FRONT & {measuredFrom: Record<string, string>};
	viewDimensions: Record<'threeQuarter' | 'side' | 'back' | 'typing', Record<string, number | string>>;
	viewPivots: Record<'threeQuarter' | 'side' | 'back' | 'typing', Record<string, ViewPivot>>;
	typing: {layout: typeof TYPING_LAYOUT; props: Record<string, string>; usage: string};
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
		front: 'built: parts/ (core rig). Poses stand, point.',
		threeQuarter:
			'built: views/ThreeQuarter.tsx + views/threeQuarter/ (body turned to SCREEN RIGHT; near side = anatomical right). All expressions, blink, look, brow lift and the full mouth library (front drawings mapped by tq.ts, never mirrored). Pose stand.',
		side: 'built: views/Side.tsx + views/side/ (profile facing SCREEN RIGHT; the anatomical RIGHT side is visible). All expressions and all six mouths via a profile lip notch. Pose stand.',
		back: 'built: views/Back.tsx (anatomical LEFT = screen left). headTilt and breathing; no face controls are visible. Pose stand.',
	},
	units:
		'World units: 1 unit = 1 px at scale 1. ZOO is exactly 900 units from sole (y=0) to the top of the hair outline (y=-900). Origin = ground contact point between the feet; y grows downward.',
	palette: {
		keys: {...ZOO_COLORS},
		propKeys: {...PROP_COLORS},
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
	viewDimensions: {
		threeQuarter: {
			totalHeight: 898.2,
			headTop: -898.2,
			chin: -736.2,
			headHeight: 162,
			headsTall: 898.2 / 162,
			shoulderWidth: 211, // near sleeve outer edge (-123) to far shoulder (88) at shoulder height
			faceMidlineAtMouth: 29,
			measuredFrom: 'zoo_turn_34.png: origin crop (154, 640), 1 px = 900/630 u; same ground and scale as the front crop (sheet offset x=630)',
		},
		side: {
			totalHeight: 895.4,
			headTop: -895.4,
			chin: -738.2,
			headHeight: 157.2,
			headLength: 169.6, // back hair tuft (-87.6) to forelock tip (82)
			chestDepth: 136.6, // shirt back (-77) to placket front (59.6)
			shoeLength: 140,
			measuredFrom: 'zoo_turn_side.png: origin crop (150, 640); sheet offset x=880',
		},
		back: {
			totalHeight: 899,
			headTop: -899,
			napeBottom: -752.4,
			shoulderWidth: 225.2, // -110.6 .. 114.6 at the shoulder points
			hipWidth: 166,
			measuredFrom: 'zoo_turn_back.png: origin crop (154.5, 640); sheet offset x=1110',
		},
		typing: {
			headTop: -728.2,
			seatTop: TYPING_LAYOUT.chair.y + CHAIR.seatTop,
			deskTop: DESK.top,
			keyTop: TYPING_LAYOUT.keyboard.y + KEYBOARD.top,
			measuredFrom: 'zoo_pose_typing.png framed at 1.555 u/px, origin crop (252, 478) (decision ZOO-T1)',
		},
	},
	viewPivots: {threeQuarter: PIVOTS_34, side: PIVOTS_SIDE, back: PIVOTS_BACK, typing: PIVOTS_TYPING},
	typing: {
		layout: TYPING_LAYOUT,
		props: {
			Chair: 'props/Chair.tsx: origin = floor under the gas column; draw BEFORE <Zoo>',
			Desk: 'props/Desk.tsx: origin = centre of its footprint on the floor; top at DESK.top',
			Keyboard: 'props/Keyboard.tsx: origin = centre of its underside on the desk top',
			Monitor: 'props/Monitor.tsx: origin = centre of the stand base on the desk top',
		},
		usage:
			'<Chair x={L.chair.x} .../> then <Zoo pose="typing" typing between={<><Desk/><Monitor/><Keyboard/></>}/> with each prop at TYPING_LAYOUT (ZOO world space). Or split: <Zoo layer="back"/>, the desk set, then <Zoo layer="front"/> with the same placement. typing=true taps the fingers from the frame (fingerLift).',
	},
	conventions: {
		anatomical: 'Prop and part names ending in L/R are ANATOMICAL. In the front view anatomical LEFT is screen RIGHT (+x).',
		pin: `Teal jellyfish pin on the anatomical LEFT chest (screen right), above the chest pocket, centre (${PIN_CENTER.x}, ${PIN_CENTER.y}).`,
		pocket: 'Chest pocket on the anatomical-left panel (screen right), x 39..81, top -637, point -592.',
		buttons: 'Five small silver buttons on the anatomical-right panel (screen left) at x=-28.4, y -686/-625/-567/-509/-452. The overshirt is worn open over the tee.',
		brows: 'Anatomical-left brow (screen right) sits ~2 u higher with a soft arch at rest: the deadpan raised brow.',
		hair: 'Asymmetric: swept top, crown curl with a dark hollow right of centre, pointed forelock hanging left of centre to (-17.5,-841), wings on the screen-left. Never mirrored.',
		mirroring:
			'No view is ever made by flipping. Bilateral pairs without markings (ears, eyes, hands, sleeves, legs, shoes, collar leaves) are authored once and mirrored to the opposite side WITHIN a view (front, back). The 3/4 and side views reuse front FACE drawings only through non-mirroring maps (anatomical left stays anatomical left).',
		views:
			'threeQuarter and side face SCREEN RIGHT, so the near side is the anatomical RIGHT. The pin (anatomical left chest) shows on the far panel in 3/4, and is hidden in profile and from behind, as on the sheet. Buttons stay on the anatomical-right panel at the front-view heights; the pocket stays under the pin.',
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
		point: `anatomical LEFT arm (screen right) raised to shoulder height and extended to screen right, index extended. Joint deltas at poseAmount 1: shoulder ${ARM_POINT.shoulder}, elbow ${ARM_POINT.elbow}, wrist ${ARM_POINT.wrist} deg; hand swaps at ${POINT_HAND_SWITCH}; pointing-hand frame ${POINT_HAND_FRAME} deg. Path (INT-Z3): a quadratic joint-space arc through ARM_POINT_MID (shoulder ${ARM_POINT_MID.shoulder}, elbow ${ARM_POINT_MID.elbow}, wrist ${ARM_POINT_MID.wrist}) at poseAmount 0.5. Optional anticipation prop pointWindup 0..1 adds shoulder ${ARM_POINT_WINDUP.shoulder}, elbow ${ARM_POINT_WINDUP.elbow}, wrist ${ARM_POINT_WINDUP.wrist} deg.`,
		typing: `seated 3/4 pose facing screen right (views/Typing.tsx), any view value; upper body = 3/4 parts offset by (${TYPING_LAYOUT.upper.dx}, ${TYPING_LAYOUT.upper.dy}); hands on the keyboard; typing=true taps fingers from the frame; layer/between props place a desk between the body and the hands`,
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
		{
			id: 'ZOO-V1',
			sheet: 'In the 3/4 turnaround the forelock tip sits almost on the facial midline (x~31, between the brows); in the front it hangs ~17 u to the anatomical right of the midline. Both drawings put it on the anatomical-right side of the crown hollow.',
			chosen: 'The 3/4 hair follows the 3/4 sheet: forelock tip at (31,-841), crown hollow to its anatomical left (screen right), wings at the back of the head. The profile puts the forelock in front of the forehead; from behind the big wings are on the anatomical right (screen right).',
			why: 'Turnaround views control identity; the hair-feature order agrees in every view and nothing is mirrored.',
		},
		{
			id: 'ZOO-V2',
			sheet: 'The 3/4 turnaround draws the mouth and moustache nearly symmetric about x~29 at ~0.86 of the front width, while the near (anatomical right) cheek beard extends about 2x further toward the ear.',
			chosen: 'One piecewise map tqX (views/threeQuarter/tq.ts): linear x0.86 inside the moustache tips, x2.0 on the near cheek, x0.25 on the far cheek. The front beard, moustache, smirk and the whole mouth library are drawn through it.',
			why: 'Keeps a single mouth library anchored consistently to the face in both views; fits the 3/4 drawing within ~2 u at the beard edge, lip patch and moustache tips.',
		},
		{
			id: 'ZOO-V3',
			sheet: 'The 3/4 turnaround places the top button at y~-673; the front places it at -686. The other four buttons agree (-625, -567, -509, -452).',
			chosen: 'Front-view button heights in every view.',
			why: 'Same garment in every view; front controls anatomy and costume.',
		},
		{
			id: 'ZOO-V4',
			sheet: 'The 3/4 and profile turnaround brows are drawn ~4-5 u thick; the front rig brows are ~8 u thick (matched to the front close-ups).',
			chosen: 'The 3/4 and profile brows reuse the front brow shapes and expression poses, thinned about their mid-line (x0.7 in 3/4, x0.8 in profile).',
			why: 'Keeps the brow design and expression behaviour identical while matching the turned views of the sheet.',
		},
		{
			id: 'ZOO-V5',
			sheet: 'The side view shows the back of the near hand with four finger lobes and no separate thumb; the 3/4 hands match the front hand drawing.',
			chosen: 'A dedicated profile hand for the side view; the 3/4 and back views hang hand drawings authored for those views (3/4 reuses the front hand pair at the 3/4 wrists, scaled 0.88 tall).',
			why: 'Each view draws the hand as the sheet shows it from that angle; no mittens.',
		},
		{
			id: 'ZOO-V6',
			sheet: 'The pin shows on the far chest in 3/4 and is not drawn in the profile or back views. The far arm and far leg are hidden in the profile.',
			chosen: 'Same: pin on the far (anatomical left) panel in 3/4, hidden in side/back; profile draws only the near arm and near leg.',
			why: 'Anatomical placement: the anatomical-left chest faces away from the camera in both views.',
		},
		{
			id: 'ZOO-T1',
			sheet: 'The typing panel draws the head ~25% larger relative to the body than the turnaround (the point panel shows the same drift).',
			chosen: 'The typing pose uses the turnaround proportions (head 160 u). For comparison the panel is framed at 1.555 u/px, which makes its head 168 u and lines up desk, chair, knees and feet.',
			why: 'Reference priority: turnaround controls anatomy; pose drawings show performance.',
		},
		{
			id: 'ZOO-T2',
			sheet: 'Seated, the panel hides the overshirt hem behind the desk edge; the standing 3/4 torso would put the hem ~50 u over the thighs.',
			chosen: `The seated torso is the 3/4 torso scaled x${TYPING_LAYOUT.seatedTorso} vertically about its shoulder line, so the hem rests on the lap; pin, pocket and top buttons move by < 4 u.`,
			why: 'Reads as the shirt bunching when he sits; keeps every costume detail in place.',
		},
		{
			id: 'ZOO-T3',
			sheet: 'The panel draws a light-grey desk, a mid-grey office chair, a dark-grey monitor and a near-black keyboard; palette v1 had no prop colours.',
			chosen: 'PROP_COLORS in palette.ts (sampled; one shadow tone each, desk = brand silver).',
			why: 'Props must share the flat style without ad-hoc hex values.',
		},
		{
			id: 'ZOO-T4',
			sheet: 'The panel draws the forearms ~45% longer than the turnaround (elbow at the back of the torso, hands far forward on the keyboard).',
			chosen: 'Turnaround forearm length (~115 u elbow to cuff end) with the elbow under the shoulder; the keyboard sits nearer to him (TYPING_LAYOUT.keyboard). The far forearm emerges from behind the torso.',
			why: 'Reference priority (anatomy from the turnaround); the pose still reads as the panel: seated upright, forearms forward, both hands on the keys.',
		},
		{
			id: 'ZOO-T5',
			sheet: 'The only typing drawing is a 3/4 view facing screen right.',
			chosen: 'pose="typing" always draws that 3/4 pose; the view prop is ignored for it.',
			why: 'No reference exists for other typing angles; inventing one would risk drift.',
		},
		{
			id: 'INT-Z1',
			sheet: 'zoo_turn_front.png: the relaxed thumb joins the back of the hand at the top; the thumb/index notch starts about 40% down the hand, and the finger separations run about a third of the hand length.',
			chosen: 'Integration fix (2026-11-24): the thumb is filled without a full outline; only the tip and the lower notch are stroked (THUMB_EDGE). Finger separation lines lengthened from 7 to about 18 units.',
			why: 'The full thumb outline ran up to the cuff and read as a separate hook in the 10 s proof; front view controls anatomy.',
		},
		{
			id: 'INT-Z2',
			sheet: 'zoo_turn_front.png: the tee ends at the overshirt hem; no tee tail shows over the trousers.',
			chosen: "Integration fix: the tee's two hem key points are corners, so the closed Catmull-Rom spline no longer overshoots ~30 units below the hem.",
			why: 'The rounded tee tail was a spline artefact, not part of the design.',
		},
		{
			id: 'INT-Z3',
			sheet: 'zoo_pose_point.png shows only the end pose; the size-comparison panel puts Badger just beside ZOO\'s hand.',
			chosen: 'The point blend follows a quadratic joint-space arc through ARM_POINT_MID (elbow in, forearm lifts with the hand trailing, then the upper arm opens and the hand follows through); the pointing hand swaps in at poseAmount 0.75. End pose unchanged (ARM_POINT).',
			why: 'The old blend swung the hand through the head of a dog standing beside him (checked on the joint chain: it needed Badger 656 units away; this path clears him from 554). Overlapping action and follow-through also read as a more natural, restrained gesture.',
		},
	],
	knownGaps: [
		'Pose "point" exists only in the front view; threeQuarter/side/back draw the stand arms for it.',
		'Pose "typing" is authored only in 3/4 facing screen right (as on the sheet); the view prop is ignored for it (ZOO-T5).',
		'Only the anatomical-left arm can point; the right arm stays at rest.',
		'Arms in the 3/4, side and back views are static hangs (no joint rig yet); the typing arms are fixed except finger taps and breathing.',
		'Back view: expression, mouth, blink, look and brow lift have no visible effect (no face from behind); headTilt and breathing work.',
		'Side view: the smirk lifts the anatomical-left (far) mouth corner, so "happy" reads only through the squint and a slight near-corner lift in profile.',
		'headTilt rotates the head about the neck pivot in every view without deforming the neck; keep it within about +-8 deg.',
		`Brand colours used outside ZOO_COLORS: ${BRAND.nearBlack} (outline), ${BRAND.offWhite} (pin highlight). Props use PROP_COLORS (palette.ts).`,
	],
};
