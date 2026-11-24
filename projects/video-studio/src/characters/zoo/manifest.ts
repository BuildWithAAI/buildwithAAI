/**
 * ZOO character manifest, v1.0.0 (front core rig + 3/4, side and back views + seated typing pose).
 * The reusable baseline: reuse these assets unchanged across episodes. Identity source:
 * reference/model-sheets/zoo_model_sheet_v1.png and its crops in reference/crops/. Binding rules:
 * docs/PROJECT_INSTRUCTIONS.md.
 */
import {BRAND, LINE, PROP_COLORS, ZOO_COLORS} from '../palette';
import {
	ARM_POINT,
	ARM_POINT_MID,
	ARM_POINT_WINDUP,
	BREATH,
	BROW_LIFT,
	EXPRESSIONS,
	FRONT,
	PIVOTS,
	POINT_HAND_CURL,
	POINT_HAND_FRAME,
	POINT_HAND_SWITCH,
	POINT_LOOK,
	POINT_OVERLAP,
	SHOULDER_FOLLOW,
	TYPING_LOOK,
} from './rig';
import {ZOO_LINE} from './lines';
import {FORELOCK_TIP} from './parts/Hair';
import {BUTTON_Y} from './parts/Torso';
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
	palette: {keys: Record<string, string>; propKeys: Record<string, string>; brand: string[]; line: {color: string; width: number; detailWidth: number}; zooLine: Record<string, number | string>};
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
		zooLine: {
			...ZOO_LINE,
			note: 'ZOO stroke widths in world units at lineScale 1, all derived from LINE (lines.ts, decision ZOO-L1). ZooRig lineScale multiplies every width; lineScaleFor(pxPerUnit) gives the ART_GUIDE SL5 value for a framing.',
		},
	},
	dimensions: {
		...FRONT,
		measuredFrom: {
			scale: 'zoo_turn_front.png: figure 630 px tall (hair top y=10, sole y=640) = 900 u, so 1 px = 1.4286 u; body axis at x=150',
			head: 'hair top y=10 to beard chin y=122: 112 px = 160 u; 900/160 = 5.63 heads tall (sheet: 5-6 heads). Repair round 1: re-measured 5.44-5.63 depending on whether the chin outline is counted; kept (within 3%).',
			shoulders: 'outer silhouette at the deltoids x=66..232 px incl. outline = 237 u; rig 246 u incl. sleeve outline',
			hips: 'trouser band x=96..200 px at y=420 = 149 u between outline centres; rig 160 u outer edges',
			legs: 'crotch y=365 px (-392 u) to sole: 392 u; inseam gap 0 at the crotch to 50 u at the hem; outseam +-80 to +-86 u',
			hands: 'repair round 2, skin rows traced in hand-local units (wrist = cuff centre): the back of the hand is as wide as the cuff; fingers hang and curl in toward the thigh, tips stepping from the little finger (y ~69) to the index (y ~93); thumb a slender inner lobe (tip y ~68) parted from the fingers by an OPEN gap ~6 u wide below a dark apex at y ~43; finger separations run along the fingers (lower-inner to upper-outer)',
			torso: 'repair round 2, row scan at the same world scale: overshirt sides +-87..88 from y -490 down (sheet +-87..89); 4-7 u of background between each cuff and the hem from y -480 (sheet 4-7); hem 172 u (sheet 172-178); cuff 39 u; sleeve 46-48 u at y -480; shoulders 239-246 u at y -640..-660 (sheet 243-249)',
			face: 'zoo_expr_neutral.png at 0.699 u/px (hair top y=22, chin y=251): face 116 px = 81 u at the cheeks, eye shapes ~24 x 10 u, iris r ~5 u (near-black brown), iris centres -21.5 / +21 (42.5 u apart; rig 42 u: eye pivots +-22.2, iris offset 1.2 inward)',
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
		pin: `Teal jellyfish pin on the anatomical LEFT chest (screen right), above the chest pocket, centre (${PIN_CENTER.x}, ${PIN_CENTER.y}); a compact badge: dome ~18 x 12 u and three short tentacles (~9.5 u) that stay inside the dome's width, each cased in near-black; every stroke follows lineScale (repair round 2, ZOO-D2).`,
		pocket: 'Chest pocket on the anatomical-left panel (screen right), x 39..81, top -637, point -592.',
		buttons: `Five small silver buttons on the anatomical-right panel (screen left) at x=-28.4, y ${BUTTON_Y.join('/')} (every view; ZOO-V3). The overshirt is worn open over the tee.`,
		brows: `Anatomical-left brow (screen right) sits ~2 u higher with a soft arch at rest: the deadpan raised brow. browLift raises it ${BROW_LIFT.left} u and the other brow ${BROW_LIFT.right} u (one-sided deadpan raise). Brows draw OVER the front hair in every view.`,
		hair: `Asymmetric: a top lock sweeps from the top-left tuft over the crown and rolls over a near-black arch-shaped hollow right of centre; a middle lock turns down into a curved forelock horn tipped at (${FORELOCK_TIP.x},${FORELOCK_TIP.y}), left of centre; lower-left wing and side lock end at the ear top (no hair below the ears). Strands are hair-shadow lines. Never mirrored. The forelock lifts when a raised brow would reach it.`,
		mirroring:
			'No view is ever made by flipping. Bilateral pairs without markings (ears, eyes, hands, sleeves, legs, shoes, collar leaves) are authored once and mirrored to the opposite side WITHIN one view (front, back). Every view draws its own hands (front palm-side relaxed hands, back-of-hand drawings from behind and in 3/4, a four-finger profile hand, typing hands); no view maps or mirrors another view\'s hand drawing (repair round 2, ZOO-V5). The 3/4 and side views reuse front FACE drawings only through non-mirroring maps (anatomical left stays anatomical left).',
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
		forelock: {x: FORELOCK_TIP.x, y: FORELOCK_TIP.y, parent: 'hairFront', controls: 'tip lifts (up to the brow clearance) when a raised brow would reach it (ZOO-H2)'},
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
		overshirtShoulderL: {x: PIVOTS.shoulderL.x, y: PIVOTS.shoulderL.y, parent: 'torso', controls: `pose point: the screen-right shoulder region of the overshirt rotates with the left arm (x${SHOULDER_FOLLOW}, per-point weights; ZOO-P2)`},
		forearmL: p('elbowL', 'pose/poseAmount', 'upperArmL'),
		handL: p('wristL', `pose/poseAmount; hand shape relaxed -> loose fist at poseAmount >= ${POINT_HAND_CURL} -> point at >= ${POINT_HAND_SWITCH}`, 'forearmL'),
		upperArmR: p('shoulderR', 'rest in v1', 'torso'),
		forearmR: p('elbowR', 'rest in v1', 'upperArmR'),
		handR: p('wristR', 'rest in v1', 'forearmR'),
	},
	expressions: Object.keys(EXPRESSIONS),
	mouthShapes: Object.keys(MOUTHS),
	poses: {
		stand: 'arms relaxed at the sides',
		point: `anatomical LEFT arm (screen right) pointing to screen right with an open elbow (~91 deg inside), forearm rising ~48 deg, index ~6 deg above horizontal, fingertip at h ~719 (ZOO-P4). Joint deltas at poseAmount 1: shoulder ${ARM_POINT.shoulder}, elbow ${ARM_POINT.elbow}, wrist ${ARM_POINT.wrist} deg; loose fist from ${POINT_HAND_CURL}, pointer from ${POINT_HAND_SWITCH}; pointing-hand frame ${POINT_HAND_FRAME} deg (upright-fist pointer traced from zoo_pose_point.png). Path: each joint follows a monotone cubic through ARM_POINT_MID (shoulder ${ARM_POINT_MID.shoulder}, elbow ${ARM_POINT_MID.elbow}, wrist ${ARM_POINT_MID.wrist}) at poseAmount 0.5, with overlapping action on the first half (POINT_OVERLAP: elbow lead ${POINT_OVERLAP.elbowLead}, shoulder lag ${POINT_OVERLAP.shoulderLag}, early elbow tuck ${POINT_OVERLAP.tuck} deg until ${POINT_OVERLAP.tuckUntil}); the hand rises, then travels out, with no reversal. The overshirt's shoulder follows the arm (x${SHOULDER_FOLLOW}) and the elbow rounds as it bends. Unless lookX/headTilt are passed, they default to ${POINT_LOOK.lookX}/${POINT_LOOK.headTilt} x poseAmount. Optional anticipation prop pointWindup 0..1 adds shoulder ${ARM_POINT_WINDUP.shoulder}, elbow ${ARM_POINT_WINDUP.elbow}, wrist ${ARM_POINT_WINDUP.wrist} deg.`,
		typing: `seated 3/4 pose facing screen right (views/Typing.tsx), any view value; upper body = 3/4 parts offset by (${TYPING_LAYOUT.upper.dx}, ${TYPING_LAYOUT.upper.dy}) (leaning toward the screen); full-size hands side by side on a ${186} u keyboard, the near hand over the far cuff; unless passed, lookX/lookY/headTilt default to ${TYPING_LOOK.lookX}/${TYPING_LOOK.lookY}/${TYPING_LOOK.headTilt}; typing=true taps fingers from the frame; layer/between props place a desk between the body and the hands`,
	},
	animation: {
		breathAmplitudeUnits: BREATH.amplitude,
		breathPeriodSeconds: BREATH.periodSeconds,
		breathArmLagFrames: 3,
		lineScale: 'ZooRig lineScale (default 1) multiplies every stroke; use lineScaleFor(pxPerUnit) from lines.ts for close-ups (e.g. ~0.53 for a 1080p bust at 3.2 px/u).',
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
			chosen: 'Superseded by ZOO-P2 (repair round 1). v1: upper arm 46 deg, forearm ~50 deg, index ~15 deg up, tip at h ~691.',
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
			sheet: 'Re-measured in repair round 1: the front turnaround puts the buttons at -672/-622/-565/-508/-452, the same top-button height as the 3/4 (-673). (v1 recorded -686 for the front, which was a mis-measure.)',
			chosen: 'Buttons at -672/-622/-565/-508/-452 in every view (front, 3/4, side, typing via the 3/4 torso).',
			why: 'Same garment in every view; front controls anatomy and costume, and the two drawings agree.',
		},
		{
			id: 'ZOO-V4',
			sheet: 'The 3/4 and profile turnaround brows are drawn ~4-5 u thick; the front rig brows are ~8 u thick (matched to the front close-ups).',
			chosen: 'The 3/4 and profile brows reuse the front brow shapes and expression poses, thinned about their mid-line (x0.7 in 3/4, x0.8 in profile).',
			why: 'Keeps the brow design and expression behaviour identical while matching the turned views of the sheet.',
		},
		{
			id: 'ZOO-V5',
			sheet: 'The side view shows the back of the near hand with four separate fingers and no separate thumb; the 3/4 and back hands are the front relaxed hand seen from those angles (row scans: 3/4 near ~47 u wide, far ~27 u, back ~31 u).',
			chosen: 'Repair round 2 (supersedes round 1\'s point-mapped front palm drawing, which showed the front thumb hook from behind and in 3/4): every view draws its own hand with HandDrawing (parts/Hand.tsx): front = palm-side relaxed hand with an open thumb gap; back = the back of the hand with four tip lobes stepping toward the thigh and the thumb tucked out of view; 3/4 near = the back of the hand with four stepped fingertips and a shorter thumb lobe; 3/4 far = little-finger side with the fingers curled toward the body; profile = four fingers parting from y -366 (~36% of the hand; round 1 ~24%). One silhouette each with a centred near-black outline on the silhouette only and thin warm-brown separations. Pairs are mirrored only inside one view.',
			why: 'Front and turnaround views control anatomy; at the asset sheet\'s lineScale (1.59) round 1\'s full-weight thumb hook and 18-24 u near-black finger lines read as black talons.',
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
			id: 'ZOO-H1',
			sheet: 'zoo_expr_neutral.png (contrast-enhanced) and zoo_turn_front.png: the forelock is a curved horn out of the middle lock with its tip at (-17,-842); a near-black arch-shaped hollow (median #2A201A) sits under the rolling top lock; the sides end at the ear tops.',
			chosen: 'Repair round 1: front hair re-traced (lobe tips at (-83,-843), (-72.4,-868.6), (-49.2,-886.8); flick (68,-840.8)); concave forelock edges with no corner at the wedge; hollow filled with the brow near-black brown as an ink accent; strands in hairShadow at the fine width; back hair kept inside the ears and face (nothing shows around or under the ears).',
			why: 'Front and bust drawings agree within ~4 u; the hollow is an ink accent, not a third hair tone (one shadow tone per colour).',
		},
		{
			id: 'ZOO-H2',
			sheet: 'The shocked and worried panels raise the brows 6-13 u while both brows stay fully visible below the forelock tip.',
			chosen: 'Brows draw after the front hair in every view; when a raised brow would come within 1.6 u of the forelock tip, the forelock lower part lifts by the difference (forelockLiftFor in parts/Hair.tsx; FORELOCK34_TIP in the 3/4 head).',
			why: 'Blocker fix: v1 drew the brows under the hair, so raised brows slid behind the forelock.',
		},
		{
			id: 'ZOO-B1',
			sheet: 'Prompt 1 defines the deadpan as a "subtly raised brow" (one brow); the sheet raises the anatomical-left brow.',
			chosen: `browLift 0..1 raises the anatomical-left brow ${BROW_LIFT.left} u and the right ${BROW_LIFT.right} u (v1 raised both 3.5 u).`,
			why: 'A one-sided raise reads as unimpressed rather than surprised.',
		},
		{
			id: 'ZOO-C3/C4/C5/C6',
			sheet: 'Pixel medians: moustache #634732/#684A33 (darker than chin #845D40); hair #584033/#574134; irises #292422/#261F1C; brows #241F19; nose bridge #906C55; lip line core #5C3D2C.',
			chosen: 'palette.ts: moustache #664933 (flat, new key), hair #584134 (was #5E4637), eyeIris #2C221D (was #5A3E2B), brow #221C18 (was #3A2A20), noseLine #8E6A54 (new line colour for the nose bridge and ear fold); the closed lip line uses beardShadow.',
			why: 'Matches the approved sheet; all are ZOO-only keys and keep one shadow tone per colour (moustache and noseLine have none).',
		},
		{
			id: 'ZOO-L1',
			sheet: 'The sheet keeps a near-constant screen line weight (~3 u at full body, ~1.6 u at bust framing); interior face lines are thin and soft.',
			chosen: 'lines.ts ZOO_LINE (outline 3.5, detail 2.25, fine 1.4, lid 2.45, feature 1.62, all from LINE) replaces scattered literals; ZooRig lineScale multiplies every stroke and lineScaleFor(pxPerUnit) implements ART_GUIDE SL5. Lids and nostrils are tapered filled shapes; no outer-corner lash flick.',
			why: 'Close-ups no longer read as a thick-lined sticker; one line system for every view.',
		},
		{
			id: 'ZOO-M2',
			sheet: 'The mouth panels draw the lower face ~19% narrower; measured RELATIVE TO THE MOUSTACHE the library sizes match (oh 17 x 15.5 u vs 16.7 x 14.9; ah 28 x 19 vs 25 x 19.6). Lip lines and rims are thin and dark brown.',
			chosen: 'Mouth sizes kept (a review asked to shrink "oh" by 30% using absolute panel units, which ignores ZOO-M1); closed/mbp drawn as thin beardShadow lip lines (1.6 / 1.9 u), open rims 1.62 u; mouth line raised 1.3 u (jaw pivot -769.6) to the sheet gap under the moustache; moustache two-lobed with a philtrum notch and pointed tips.',
			why: 'ZOO-M1 anchors the mouth library to the moustache; the line styling follows every mouth panel.',
		},
		{
			id: 'ZOO-E2',
			sheet: 'zoo_expr_worried.png: inner brow ends rise 5-7.5 u with a sharp upturn, the screen-right arch inverts ~4 u, tails rise ~1.5-2 u. Shocked: brows ~8-11 u up, wide horizontal oval mouth. Happy: soft closed U-smile, lower lids up, head turned ~15 deg.',
			chosen: 'Brow pose gains `curl` (inner-end upturn); worried/happy/shocked presets re-measured (worried inner-to-tail drop >= 11 u; happy cornerL 3.2 / cornerR 6.4, lidBottom 2.4; shocked brows +7.6/+8.2 with arch 3, mouth ah x0.95 wide x0.6 open). The front head does NOT yaw for happy.',
			why: 'Restrained adult acting that reads at video scale; a yaw on the front head would slide features over a static skull, so the turned-head happy is left to view="threeQuarter" (known gap). Repair round 2: both corners lift more (cornerL 3.2 -> 4.5, moustacheLiftR 3.6 -> 4) so the smile reads at bust size without the turn.',
		},
		{
			id: 'ZOO-P2',
			sheet: 'zoo_pose_point.png: upper arm ~42 deg out from vertical, forearm rising ~52 deg, index ~25 deg up and ~45 u above the shoulder; the sleeve flows out of the shoulder; the relaxed hand never shows as a flat open hand.',
			chosen: `SUPERSEDED by ZOO-P4 (repair round 2); the shoulder follow and the rounded elbow disk remain. Round 1: end key shoulder ${ARM_POINT.shoulder} / elbow ${ARM_POINT.elbow} / wrist ${ARM_POINT.wrist} (upper arm 43 deg, forearm 57 deg, index ~22 deg up, tip h ~720 on the turnaround body); in-between ${ARM_POINT_MID.shoulder}/${ARM_POINT_MID.elbow}/${ARM_POINT_MID.wrist} (hand lifts in front of the chest, 38 deg wrist drag); loose fist ${POINT_HAND_CURL}..${POINT_HAND_SWITCH}, pointer from ${POINT_HAND_SWITCH}; the overshirt shoulder follows the arm; rounded elbow disk; head/eye bias toward the point unless animated by the caller. Clearance re-checked on the joint chain and in proof frames f93-f96 / f186-f192: the hand stays >= 18 u from Badger's head at the proof spacing (560 u).`,
			why: 'Fixes the low hand, the shoulder notch, the limp chicken-wing in-between and the hand pop while keeping INT-P2 staging valid.',
		},
		{
			id: 'ZOO-P4',
			sheet: 'zoo_pose_point.png traced on a world grid: an OPEN elbow (~95 deg inside), forearm rising ~42 deg, index ~3 deg above horizontal with its tip at (358, h733), ~55 u above the cuff because the index rides on top of an upright fist (thumb and three curled fingers stacked under it); sleeves ~40-42 u wide.',
			chosen: `End key shoulder ${ARM_POINT.shoulder} / elbow ${ARM_POINT.elbow} / wrist ${ARM_POINT.wrist}: upper arm 49 deg from vertical, forearm rising 48 deg, elbow ~91 deg inside, index ~6-7 deg up, fingertip (378, h719). Pointer redrawn from the panel (upright fist, 0.92 x panel size = 13% larger than round 1). Mid key ${ARM_POINT_MID.shoulder}/${ARM_POINT_MID.elbow}/${ARM_POINT_MID.wrist} (upper arm abducted, elbow outside the overshirt, forearm 23 deg up, straight wrist). Joints follow monotone cubics through the keys with POINT_OVERLAP (elbow leads, shoulder lags and first tucks the elbow 6 deg); loose fist from ${POINT_HAND_CURL}, pointer from ${POINT_HAND_SWITCH}. Proof check (Preview10s at 560 u spacing, rendered): hand path monotonic out and up, elbow x >= 101 throughout, closest approach to Badger's head 30.5 u (27 px) at f96 (an outward path without the tuck came within 6 u).`,
			why: 'Fixes the acute V, the 26-deg upward jab, the thin sleeve and the waist-level chicken wing. The turnaround arm is longer than the panel\'s, so the panel\'s own angles put the fingertip ~30 u too low; the upper arm is raised 6 deg more than the panel\'s (49 vs ~43) to keep the tip at the round-1 height (h ~719 vs the panel\'s 733). Turnaround controls anatomy; the pose panel shows performance.',
		},
		{
			id: 'ZOO-P3',
			sheet: 'The point panel stands in a slight contrapposto with the torso turned toward the point.',
			chosen: 'Not adopted in v1 repair: the front legs are a static pair and a leg swap mid-shot would slide the feet; the point uses the turnaround stance with the shoulder follow and the head/eye bias.',
			why: 'Turnaround controls anatomy; pose panels show performance. Revisit with a proper leg rig.',
		},
		{
			id: 'ZOO-K1',
			sheet: 'zoo_turn_front.png / zoo_turn_34.png: crewneck at -703.6, shoulder line -714/-707/-699 at |x| 60/80/100, flat spread collar leaves pointing to ~(+-55,-693); ~30 u of neck shows.',
			chosen: 'Tee, collar stand, panels and leaves lowered 7-12 u (front) / ~7 u (3/4, typing), leaves flattened to crisp points, collar shadow reduced to a thin crescent, neck extended; panel shadows narrowed to a band under each arm.',
			why: 'v1 sat the collar ~10 u high, shortening the neck and reading as a shrug in every bust.',
		},
		{
			id: 'ZOO-A2',
			sheet: 'Row scans of zoo_turn_front.png: cuff centre ~4 u further in than v1, sleeve outer edge 2.5-4 u in; the relaxed hand tapers and curls toward the thigh with a separate thumb lobe; sneakers narrow at the ankle with a convex toe box; trouser hem drapes over the tongue.',
			chosen: 'Forearm/cuff and wrist pivots moved in 2.2 u, upper-arm outer edge in 2.5-4 u; relaxed hand redrawn (PALM/THUMB/FINGER_LINES); shoes reshaped (outer edge ~82 at the ankle to ~109 at the sole), three lace bars, terminator shadow; hem lowered to a break at -44.6.',
			why: 'Front view controls anatomy; v1 hands read as paddles and the shoes as boats.',
		},
		{
			id: 'ZOO-T6',
			sheet: 'zoo_pose_typing.png: two full-size hands side by side over a ~185 u keyboard; the monitor seen from behind (plain back panel, lit left edge, neck in front, flat foot); he leans toward the screen.',
			chosen: `Typing hands x${TYPING_LAYOUT.handScale.near}/${TYPING_LAYOUT.handScale.far} at wrists (${TYPING_LAYOUT.wristR.x},${TYPING_LAYOUT.wristR.y}) / (${TYPING_LAYOUT.wristL.x},${TYPING_LAYOUT.wristL.y}), near hand over the far cuff; keyboard 186 u at x ${TYPING_LAYOUT.keyboard.x}; monitor redrawn from behind; upper body offset +6/+10 toward the screen and down with the near shoulder following (eyes within ~4 u of the panel); default look/tilt toward the screen (TYPING_LOOK).`,
			why: 'Fixes the undersized claw hands and the screen-out monitor while keeping the turnaround proportions (ZOO-T1, ZOO-T4).',
		},
		{
			id: 'ZOO-V7',
			sheet: 'zoo_turn_34.png / zoo_turn_side.png / zoo_turn_back.png: 3/4 nose bridge x 36 -> 44 with the nostril at ~33; 3/4 forelock a rounded lock end at (32,-840); profile forelock a C-curl hanging to (72,-839) with ~7 u of nasal bridge in front of the eye; back crown one S-shaped lock; wave strands are curved and brown.',
			chosen: 'Repair round 1: 3/4 nose +8 u with the front nose construction; 3/4 forelock rounded and liftable; profile eye moved back 3 u (front corner 5 u), nasal bridge 2-3 u forward, C-curl forelock; profile mouth interior ends at the lip fronts with a thin lip line; back crown S-curve; long crown seams replaced by short curved hair-shadow strands in every view; one ear fold line in the nose-line brown.',
			why: 'Turnaround views control identity; each change was measured on its own panel.',
		},
		{
			id: 'ZOO-A3',
			sheet: 'zoo_turn_front.png row scan at the same world scale: below the chest the overshirt narrows to +-87..89 and the sleeves (46-48 u, cuff ~39 u) hang free with 4-7 u of background between each cuff and the hem from y -480; hem 172-178 u.',
			chosen: 'Repair round 2: each front panel follows the shoulder line to the shoulder point, turns down an armhole seam and runs down the body side at +-86..89; sleeves widened (inner edge ~94, cuff 97.8..129.4); elbow pivots +-111.5 (sleeve centre), wrist pivots +-113.8 (cuff centre); panel shadow kept to a ~5 u band inside the side edge. Measured: sides +-87..88, gap 4-7 u, hem 172 u, cuff 39 u.',
			why: 'Front view controls anatomy; round 1 kept the panels at +-101..103 to the hem and hid ~13 u of each sleeve, so Zoo read stockier than the lean sheet figure.',
		},
		{
			id: 'ZOO-D2',
			sheet: 'zoo_expr_neutral.png teal rows at 0.699 u/px: dome ~17.5 x 11.2 u; three tentacles ~9.8 u long inside the dome width (~14 u spread), each cased in near-black.',
			chosen: 'Repair round 2: dome half-width 7.8, tentacles end at +8.2 (x1 within +-5.2), near-black casing under each teal tentacle, teal width and casing both scaled by lineScale (PIN_SHAPE in parts/Pin.tsx); size 1.15, centre (58,-660).',
			why: 'Locked design: "one tiny teal jellyfish pin: small dome with three short tentacles"; round 1\'s 15 u splayed legs read as a squid.',
		},
		{
			id: 'ZOO-F4',
			sheet: 'Front busts and zoo_turn_front.png: each ear is a rounded C whose lobe tucks into the face at ~-785.',
			chosen: 'Repair round 2: the ear spline closes INSIDE the face edge (lobe ... (41,-782.4), (38.2,-786), (37.6,-792)), so no pointed lobe hangs over the jaw line.',
			why: 'Round 1 ended the closed spline outside the face and drew an elf tip.',
		},
		{
			id: 'ZOO-H3',
			sheet: 'zoo_turn_back.png: the crown carries a dark S-shaped lock plus the top-lock and left-lock edges; the nape is shaded under wavy lock ends.',
			chosen: 'Repair round 2: the S-lock, top-lock and left-lock edges are tapered ink lines in ZOO_COLORS.brow (the hair ink already used for the front crown hollow), up to ZOO_LINE.detail wide, clipped to the hair; one hair-shadow region = a thin crescent under the S-lock and the nape below a wavy edge; the isolated groove oval is gone.',
			why: 'From behind, the S-lock is the hair\'s identity; round 1\'s strands in the shadow tone were invisible and the flat lower band read as a two-tone helmet.',
		},
		{
			id: 'ZOO-T7',
			sheet: 'zoo_pose_typing.png: two soft hands whose fingers arc down and forward onto the keys with thin separations; the monitor back is a plain panel with square corners.',
			chosen: 'Repair round 2: each typing hand is ONE silhouette (back of the hand + four tip lobes landing 5-8 u ahead of the knuckle line on the keys, thumb in skin) with thin warm-brown separations along the finger arcs; taps move the tip lobes. The monitor panel and foot are straight-edged polygons with small fillets (path extent = its corners, y -275.4..-71.6). Chair wheel and leg outlines follow lineScale.',
			why: 'Round 1\'s separately outlined hooked fingers stacked into black knots; the monitor spline overshot 11.4 u past each corner.',
		},
		{
			id: 'ZOO-L2',
			sheet: 'The sheet\'s close-up nostrils are ~1.7 u dark commas and the bust lid lines stay heavy, while outlines thin to ~1.6 u.',
			chosen: 'featureScale(ls, min) in lines.ts: the nose bridge and nostrils keep their drawn size below lineScale 1 (and thicken above it); the upper-lid line floors at 0.85. Applied in the front, 3/4 and profile heads.',
			why: 'Facial feature shapes are part of the face design, not outlines; at ls ~0.5 round 1 shrank the nostrils to ~0.9 u hairlines.',
		},
		{
			id: 'ZOO-K2',
			sheet: 'The expression and mouth panels draw the torso ~6 u higher than the turnaround: 28.7 u of neck and the pin centroid at ~-669.8 against the turnaround\'s 34.3 u and -659.4.',
			chosen: 'The turnaround neck, collar, tee and pin heights are used in every framing; the bust panels are performance references for the face only.',
			why: 'Reference priority: front and turnaround views control anatomy; recorded so reviews do not re-flag the busts as long-necked.',
		},
		{
			id: 'ZOO-F5',
			sheet: 'zoo_expr_neutral.png, zoo_turn_side.png, zoo_turn_34.png: shallow philtrum dip (moustache ~9.5 u thick at x=0); forelock ~12 u wide at y -850; profile eye a mostly dark almond (~25-30% white); profile moustache merging into the cheek beard; throat skin right under the 3/4 jaw; only a soft shadow tight under the jaw.',
			chosen: 'Repair round 2: moustache notch at -784 with a 0.6 u dip; forelock 11.6 u at -850 (concave right edge ~2.5 u further right, left edge ~1 u left, tip unchanged); profile eye back corner -4.5, iris rx 0.8r, highlight 0.6x; profile moustache ends blunt ~2 u inside the beard; 3/4 throat top tucked 0.5-1.5 u above the jaw line; jaw shadows in front, 3/4, typing and profile reduced to <= 6 u crescents under the jaw.',
			why: 'Each change measured on its own panel; turnaround views control identity.',
		},
		{
			id: 'ZOO-S2',
			sheet: 'zoo_turn_side.png / zoo_turn_34.png / zoo_turn_front.png: chunky low-tops whose toe box keeps its height (~31 u) to a round nose; the 3/4 near toe reaches x ~-22 over the far heel; front shoes flare slightly on the inner side too; ~55 u of shoe shows below the front hem.',
			chosen: 'Repair round 2: side and 3/4-far toe boxes hold their top to ~8 u from the tip, then round down; 3/4 near shoe extended to a round toe at x ~-22; front inner edge flares from ~30 (y -40) to ~25 at the sole; front hem break raised 8 u (-44.6 -> -52.6), ~52 u of shoe shows.',
			why: 'Round 1 tapered the toes into pointed slippers, cut the near 3/4 shoe into a clog and showed too little shoe in front.',
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
			chosen: 'The point blend follows a quadratic joint-space arc through ARM_POINT_MID (elbow in, forearm lifts with the hand trailing, then the upper arm opens and the hand follows through). Revised in repair round 1 as ZOO-P2 (new end key, 38 deg wrist drag instead of 75, loose-fist transition, pointer from 0.5).',
			why: 'The old blend swung the hand through the head of a dog standing beside him (checked on the joint chain: it needed Badger 656 units away; this path clears him from 554). Overlapping action and follow-through also read as a more natural, restrained gesture.',
		},
	],
	knownGaps: [
		'Pose "point" exists only in the front view; threeQuarter/side/back draw the stand arms for it. The point keeps the turnaround stance (ZOO-P3).',
		'Happy has no head yaw in the front view (ZOO-E2); use view="threeQuarter" for the turned-head smile.',
		'The point gesture timing (ease, hold, overshoot) lives in the compositions; the rig only provides the path, the loose-fist transition and POINT_LOOK. Preview10s holds at poseAmount 0.993 with a 0.008 drift, which moves the hand < 2 px over f113-181; a drift of ~0.05 (composition) gives ~1.5-2 deg of shoulder and 6-10 px of hand travel on this path.',
		'Point end pose: the upper arm is ~6 deg more raised than on the pose panel (ZOO-P4) and the fingertip sits ~14 u lower (h ~719 vs 733); the shoulder line keeps a small corner where the raised sleeve meets it.',
		'Pose "typing" is authored only in 3/4 facing screen right (as on the sheet); the view prop is ignored for it (ZOO-T5).',
		'Only the anatomical-left arm can point; the right arm stays at rest.',
		'Arms in the 3/4, side and back views are static hangs (no joint rig yet); the typing arms are fixed except finger taps and breathing.',
		'Back view: expression, mouth, blink, look and brow lift have no visible effect (no face from behind); headTilt and breathing work.',
		'Side view: the smirk lifts the anatomical-left (far) mouth corner, so "happy" reads only through the squint and a slight near-corner lift in profile.',
		'headTilt rotates the head about the neck pivot in every view without deforming the neck; keep it within about +-8 deg.',
		`Brand colours used outside ZOO_COLORS: ${BRAND.nearBlack} (outline), ${BRAND.offWhite} (pin highlight). Props use PROP_COLORS (palette.ts).`,
	],
};
