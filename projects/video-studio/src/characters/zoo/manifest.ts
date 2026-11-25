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
	POINT_FIST_SWING,
	POINT_HAND_CURL,
	POINT_HAND_FRAME,
	POINT_HAND_SWITCH,
	POINT_LEAD,
	POINT_LOOK,
	POINT_OVERLAP,
	SHOULDER_FOLLOW,
	TYPING_LOOK,
} from './rig';
import {ZOO_LINE} from './lines';
import {FORELOCK_TIP} from './parts/Hair';
import {BUTTON_Y} from './parts/Torso';
import {HAPPY_MOUTH, MOUTHS} from './mouth';
import {MOUSTACHE_HALF} from './parts/Beard';
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
		brand: ['nearBlack (outlines)', 'offWhite (sneaker uppers: ZOO_COLORS.sneaker is BRAND.offWhite, decision ZOO-C8)', 'teal (pin, via ZOO_COLORS.pin)', 'background (dev renders only)'],
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
			hands: 'repair round 3, both sheet hands row-mapped in hand-local units (wrist = cuff centre, 1 char = 1 u): the back of the hand is as wide as the cuff; fingers hang and curl in toward the thigh, four tip lobes stepping from the little finger (y ~70) to the index (y ~93) with ~3 u notches; thumb a slender inner lobe (tip y ~69) joined to the index by a closed crease from a dark web apex (y ~43-48) to y ~61, parted only below it (open from y ~65); separations ~15 / 23 / 31 u long, from the tip notches up to y ~56, along the fingers (lower-inner to upper-outer)',
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
			shoeLength: 146.2, // path, heel (-72.4) to toe (73.8); repair round 3 (round 2: 152)
			measuredFrom: 'zoo_turn_side.png: origin crop (150, 640); sheet offset x=880',
		},
		back: {
			totalHeight: 899,
			headTop: -899,
			napeBottom: -752.4,
			shoulderWidth: 214.8, // -105.4 .. 109.4 at the rounded shoulder points of the back panel (repair round 3; silhouette -113.6..115 at y -680)
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
		browL: p('browL', `expression, browLift (0..1 = up to ${BROW_LIFT.left} u)`),
		browR: p('browR', `expression, browLift (0..1 = up to ${BROW_LIFT.right} u)`),
		eyeL: p('eyeL', 'blink (upper lid), lookX/lookY (iris, +-4.2 u / +-1.8 u), expression (lids, iris scale)'),
		eyeR: p('eyeR', 'blink, lookX/lookY, expression'),
		nose: {x: -2, y: -790, parent: 'head', controls: 'rides on head'},
		moustache: {x: 0, y: -780, parent: 'head', controls: 'expression: the happy pose levels each half about the philtrum (moustacheLiftL / moustacheLiftR end rises on a linear profile, moustacheRaise, moustacheThin; ZOO-E6); spoken shapes keep the pose (ZOO-E7)'},
		beard: {x: 0, y: -740, parent: 'head', controls: 'mouth shape (lip patch drops by MOUTHS[shape].hole)'},
		jaw: p('jaw', 'mouth / expression; chin outline drops by MOUTHS[shape].jaw'),
		upperArmL: p('shoulderL', 'pose/poseAmount', 'torso'),
		overshirtShoulderL: {x: PIVOTS.shoulderL.x, y: PIVOTS.shoulderL.y, parent: 'torso', controls: `pose point: the screen-right shoulder region of the overshirt rotates with the left arm (x${SHOULDER_FOLLOW}, per-point weights; ZOO-P2)`},
		forearmL: p('elbowL', 'pose/poseAmount', 'upperArmL'),
		handL: p('wristL', `pose/poseAmount; hand shape relaxed -> loose fist once the forearm has swung >= ${POINT_FIST_SWING} deg from the hang (raise and lowering alike; always from poseAmount ${POINT_HAND_CURL}) -> point at >= ${POINT_HAND_SWITCH} (ZOO-P6)`, 'forearmL'),
		upperArmR: p('shoulderR', 'rest in v1', 'torso'),
		forearmR: p('elbowR', 'rest in v1', 'upperArmR'),
		handR: p('wristR', 'rest in v1', 'forearmR'),
	},
	expressions: Object.keys(EXPRESSIONS),
	mouthShapes: Object.keys(MOUTHS),
	poses: {
		stand: 'arms relaxed at the sides',
		point: `anatomical LEFT arm (screen right) pointing to screen right with an open elbow (~91 deg inside), forearm rising ~48 deg, index ~6 deg above horizontal, fingertip at h ~719 (ZOO-P4). Joint deltas at poseAmount 1: shoulder ${ARM_POINT.shoulder}, elbow ${ARM_POINT.elbow}, wrist ${ARM_POINT.wrist} deg; loose fist once the forearm swings ${POINT_FIST_SWING} deg out (kept on the way down until it is back near the hang), pointer from ${POINT_HAND_SWITCH}; pointing-hand frame ${POINT_HAND_FRAME} deg (upright-fist pointer traced from zoo_pose_point.png). Path: each joint follows a monotone cubic through ARM_POINT_MID (shoulder ${ARM_POINT_MID.shoulder}, elbow ${ARM_POINT_MID.elbow}, wrist ${ARM_POINT_MID.wrist}) at poseAmount 0.5, with overlapping action on the first half (POINT_OVERLAP: elbow lead ${POINT_OVERLAP.elbowLead}, shoulder lag ${POINT_OVERLAP.shoulderLag}, early elbow tuck ${POINT_OVERLAP.tuck} deg until ${POINT_OVERLAP.tuckUntil}, applied while the arm rises; pass pointTuck={0} while lowering it, ZOO-P5); the hand rises, then travels out, with no reversal. The upper arm LEADS (POINT_LEAD, ZOO-P6): once the forearm has swung ${POINT_LEAD.full} deg from the hang its abduction is at least ${POINT_LEAD.ratio} x that swing (eased in below), so it is ~25 deg out when the forearm is level and ~38.5 deg at poseAmount 0.5 (ARM_POINT_MID's 24 deg is lifted by the lead); the end pose is unchanged. The overshirt's shoulder follows the arm (x${SHOULDER_FOLLOW}) and the elbow rounds as it bends. Unless lookX/headTilt are passed, they default to ${POINT_LOOK.lookX}/${POINT_LOOK.headTilt} x poseAmount. Optional anticipation prop pointWindup 0..1 adds shoulder ${ARM_POINT_WINDUP.shoulder}, elbow ${ARM_POINT_WINDUP.elbow}, wrist ${ARM_POINT_WINDUP.wrist} deg.`,
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
			chosen: `Front-view heights: eye line ${FRONT.eyeLine}, moustache top -784 (the philtrum notch, ZOO-F5), mouth line ${FRONT.mouthLine} (ZOO-M2); shapes taken from the close-ups. v1 recorded moustache top -782.6 and mouth line -768.3; repair rounds 1-2 moved both to the sheet's gap under the moustache.`,
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
			chosen: 'Superseded in repair round 4 by ZOO-E3: shocked draws its own oval (SHOCKED_MOUTH) with the neutral modifier MOD0. Historical: v1 used the "ah" library shape at 70% opening and 82% width, repair round 1 (ZOO-E2) at 60% / 95%.',
			why: 'v1-round 3 kept the fixed six-shape mouth library; a scaled "ah" could not match the gasp\'s flat-topped oval (round 4 review).',
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
			chosen: 'Repair round 2 (supersedes round 1\'s point-mapped front palm drawing, which showed the front thumb hook from behind and in 3/4): every view draws its own hand with HandDrawing (parts/Hand.tsx): front = palm-side relaxed hand (round 2: an open thumb gap; round 3 closes it, ZOO-V8); back = the back of the hand with four tip lobes stepping toward the thigh and the thumb tucked out of view; 3/4 near = the back of the hand with four stepped fingertips and a shorter thumb lobe; 3/4 far = little-finger side with the fingers curled toward the body; profile = four fingers (round 2: parted by silhouette notches from y -366; round 3: fused with interior creases, ZOO-V8). One silhouette each with a near-black outline on the silhouette only, drawn over warm-brown separations. Pairs are mirrored only inside one view.',
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
			chosen: 'Mouth sizes kept (a review asked to shrink "oh" by 30% using absolute panel units, which ignores ZOO-M1); closed/mbp drawn as thin beardShadow lip lines (1.6 / 1.9 u), open rims 1.62 u; mouth line raised 1.3 u (jaw pivot -769.6) to the sheet gap under the moustache; moustache two-lobed with a philtrum notch and pointed tips (round 6 re-traced it with blunt ends, ZOO-F6).',
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
			chosen: "SUPERSEDED by ZOO-P4 (repair round 2) and ZOO-P5 (round 3); the shoulder follow and the rounded elbow disk remain. Round 1 (literal values of that round): end key shoulder -34 / elbow -117 / wrist 14 (upper arm 43 deg, forearm 57 deg, index ~22 deg up, tip h ~720 on the turnaround body); in-between 10/-146/38 on a quadratic arc (hand lifts in front of the chest, 38 deg wrist drag); loose fist 0.28..0.5, pointer from 0.5; the overshirt shoulder follows the arm; rounded elbow disk; head/eye bias toward the point unless animated by the caller. Clearance re-checked then on the joint chain and in proof frames f93-f96 / f186-f192: the hand stayed >= 18 u from Badger's head at the proof spacing (560 u).",
			why: 'Fixes the low hand, the shoulder notch, the limp chicken-wing in-between and the hand pop while keeping INT-P2 staging valid.',
		},
		{
			id: 'ZOO-P4',
			sheet: 'zoo_pose_point.png traced on a world grid: an OPEN elbow (~95 deg inside), forearm rising ~42 deg, index ~3 deg above horizontal with its tip at (358, h733), ~55 u above the cuff because the index rides on top of an upright fist (thumb and three curled fingers stacked under it); sleeves ~40-42 u wide.',
			chosen: `End key shoulder ${ARM_POINT.shoulder} / elbow ${ARM_POINT.elbow} / wrist ${ARM_POINT.wrist} (unchanged since): upper arm 49 deg from vertical, forearm rising 48 deg, elbow ~91 deg inside, index ~6-7 deg up, fingertip (378, h719). Pointer redrawn from the panel (upright fist, 0.92 x panel size = 13% larger than round 1). Round 2's in-between and timing (literal values; re-timed in round 3, ZOO-P5): mid key -20/-92/5 (upper arm abducted, elbow outside the overshirt, forearm 23 deg up, straight wrist); joints on monotone cubics through the keys with POINT_OVERLAP {elbowLead 0.65, shoulderLag 2.5, tuck 6 until 0.4}; loose fist from 0.08, pointer from 0.4. Round 2 proof check (Preview10s at 560 u spacing, rendered): hand path monotonic out and up, elbow x >= 101 throughout, closest approach to Badger's head 30.5 u (27 px) at f96 (an outward path without the tuck came within 6 u).`,
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
			chosen: 'Repair round 2: the S-lock, top-lock and left-lock edges are tapered ink lines in ZOO_COLORS.brow (the hair ink already used for the front crown hollow), up to ZOO_LINE.detail wide, clipped to the hair; one hair-shadow region = a thin crescent under the S-lock and the nape below a wavy edge; the isolated groove oval is gone. Round 3 (ZOO-K3): the nape edge follows four lock tips and the S lock swells to 1.3x.',
			why: 'From behind, the S-lock is the hair\'s identity; round 1\'s strands in the shadow tone were invisible and the flat lower band read as a two-tone helmet.',
		},
		{
			id: 'ZOO-T7',
			sheet: 'zoo_pose_typing.png: two soft hands whose fingers arc down and forward onto the keys with thin separations; the monitor back is a plain panel with square corners.',
			chosen: 'Repair round 2: each typing hand is ONE silhouette (back of the hand + four tip lobes on the keys, thumb in skin) with warm-brown separations along the finger arcs; taps move the tip lobes (round 3 lengthens the finger arcs ~4.5 u, ZOO-V8). The monitor panel and foot are straight-edged polygons with small fillets (path extent = its corners, y -275.4..-71.6). Chair wheel and leg outlines follow lineScale.',
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
			id: 'ZOO-V8',
			sheet: 'zoo_turn_front.png (both hands row-mapped at 1 u in hand-local units): the thumb and index are a CLOSED mid-tone crease from a dark web apex (y ~43-48) down to y ~61 and part only near the thumb tip (open from y ~64); two or three finger separations run ~22-31 u from y ~56 to the tips, and the four fingertips step in small lobes. zoo_turn_side.png: the profile fingers touch, parted by 2-3 u mid-tone creases from y ~-364 to the tips, with no dark slits. zoo_pose_typing.png: the fingers arc further over the keys.',
			chosen: 'Repair round 3. Front relaxed hand (parts/Hand.tsx RELAXED): the slot is closed into a seam (a tapered warm-brown crease at ZOO_LINE.detail under a 2.4 u near-black web teardrop), a small V below y ~61 (thin outline) opens the thumb tip from y ~65; four fingertip lobes with ~3 u notches; separations 15 / 23 / 31 u, tapered from full ZOO_LINE.detail at their notch. Profile hand (views/side/BodySide.tsx): fused fingers, notches only 3-6 u above the tips, three interior creases from y -364 (widest near-black run inside the hand above y -341: 3 u, round 2: 4-8 u). Typing hands: finger arcs ~4.5 u longer, shadow kept off the tip lobes, tapered separations at ZOO_LINE.detail. HandDrawing now draws the outline after the interior lines (their notch ends tuck under it) and can taper lines (taper) and draw near-black accents. The front hand also tucks its top corner inside the cuff (round 2 showed a 1-2 u skin tab at the cuff\'s inner edge).',
			why: 'Round 2\'s open slot made the thumb a separate prong (a mitten) and its 8-12 u fine-width separations barely read (1.2 px in the proof); the profile\'s silhouette V-notches filled with outline and read as a four-tine rake. Front and turnaround views control anatomy; the craft standard asks for readable fingers, not mittens, rakes or claws.',
		},
		{
			id: 'ZOO-P5',
			sheet: 'The R2 review evaluated the proof frame by frame: at f95-f98 the upper arm still hung (shoulder +2.9 / +4.2 / -0.3 / -7.3 deg) while the forearm swung up to level, so the elbow stayed pinned at the waist under a level forearm (a "tray-carry" in-between); on the way down the anticipation tuck played in reverse and pulled the elbow in (+3.5 / +4 deg at f188-f189).',
			chosen: `Repair round 3: POINT_OVERLAP {elbowLead ${POINT_OVERLAP.elbowLead}, shoulderLag ${POINT_OVERLAP.shoulderLag}, tuck ${POINT_OVERLAP.tuck} until ${POINT_OVERLAP.tuckUntil}} with ARM_POINT_MID ${ARM_POINT_MID.shoulder}/${ARM_POINT_MID.elbow}/${ARM_POINT_MID.wrist} (round 2: 0.65 / 2.5 / 6 until 0.4, mid -20/-92/5); ARM_POINT unchanged. armAnglesFor takes {tuck} (0..1) and ZooRig takes pointTuck (default 1): the tuck belongs to the raise, so compositions pass pointTuck={0} while lowering (it acts only below poseAmount ${POINT_OVERLAP.tuckUntil}, so switching it during the hold never pops). Measured on Preview10s\' own track: the forearm is level at f98 with the upper arm abducted 11.2 deg (round 2: 7.3 deg, and 0.3 deg at f97 with the forearm at -9 deg); the continuous crossing has ~10 deg. Lowering with pointTuck 0: the shoulder closes monotonically (13.7 / 9.0 / 5.9 / 3.1 deg at f186-f189), no inward pull. Fist clearance to Badger\'s head in rendered proof frames (560 u spacing): 23.3 u (20.5 px) at f96, 27.5 u at f188 with the tuck (24.1 u analytically with pointTuck 0); round 2: 30.5 u (27 px).`,
			why: 'A grid over shoulder lag, elbow lead, tuck size and extent and the mid key (scratch search, the Badger silhouette taken from the round-2 proof frames) found no timing that opens the upper arm >= 10 deg by the level-forearm moment and keeps the round-2 clearance: opening the arm earlier moves the fist out sooner, past the front of his head. This one keeps the most (~24 u). The integrator re-checks INT-P2 in the proof and may widen the spacing slightly.',
		},
		{
			id: 'ZOO-K3',
			sheet: 'Row scans (world units): zoo_turn_back.png shoulders -112..115 at y -680 and -121..122 at -640, sloping and rounding into the sleeves; the legs are not mirror images below the knee (right outer edge 77.9 at y -100, heel 89.3 at -30); the nape darkness follows 3-4 lock ends. zoo_turn_side.png sneaker front 59-61 / 72-73 / 75-76 at y -30 / -22 / -15 with a flat toe cap and a tall round toe. zoo_turn_front.png hem corner already in to ~81 at y -424.',
			chosen: 'Repair round 3. Back: smooth, sloping shoulder points on the back panel and sleeve caps 3-5 u further in (silhouette -113.6..115 at -680, -120.7..122.1 at -640); the arms mirror about x = 1 (the sheet\'s sleeve axis; the ears keep the head axis 2); the right leg is the mirror of the left leaned ~5 u in by the ankle and ~3.5 u slimmer on its outer edge from the knee down (78.7 at -100 measured 77.1; heel 92 at -30); the nape shadow edge has four pointed lock tips and the S lock line swells to 1.3x ZOO_LINE.detail. Side: the sneaker\'s instep falls to a flat toe cap and a round front at x ~74 (top and front within ~1 u of the sheet from x 30 to the sole). Front: the overshirt hem corner is a tighter round from y ~-434, and the trouser top-outer point became a corner (its spline bulged ~5 u past the sheet under the hem): silhouette 82 / 80 at y -424 / -420 against the sheet\'s 81 / 79.5 (round 2: 85.5).',
			why: 'The review measured the back ~10 u too wide at the shoulders and the right shin, the profile shoe 5-8 u long and low, the nape as a two-tone cap and the hem corner ~5 u too square; each change was measured on its own crop.',
		},
		{
			id: 'ZOO-C7',
			sheet: 'zoo_turn_front.png and the other views draw the sneakers\' midsole, toe-cap seam and laces as soft mid-grey lines (cores ~#99948F), not near-black.',
			chosen: `Repair round 4: palette addition ZOO_COLORS.sneakerLine ${ZOO_COLORS.sneakerLine}, a LINE colour in the sneaker's cool grey family (sneakerShadow stays the one shadow tone), used for every shoe's midsole, seams and laces in the front, back, 3/4, side and typing views; the shoe outline stays near-black.`,
			why: 'Round 3 drew the shoe lines near-black, which made the low-tops read as canvas high-tops (R3 review).',
		},
		{
			id: 'ZOO-S3',
			sheet: 'zoo_turn_front.png (both legs row-scanned and averaged; the screen-left leg sits ~4 u further out): straight legs tapering from ~73 u at the thigh to ~50 at the ankle, a soft break at ~-70, and a hem that drapes over the shoe (highest ~-56.6 over the instep, ~-41.6 at the inner ankle) so ~32 u of white upper shows on the inner side; low-top sneakers with a round toe (~103 u at -20, ~109 at -8) and three lace bars.',
			chosen: 'Repair round 4. Front (Legs.tsx): one averaged leg profile (within ~1 u of the sheet average at every row; round 3 was 4-9 u wide at the calf with a flat hem at -52..-56), the draped hem, flat trousers (round 3\'s under-hem band and inseam band read as a belt and a thick inner line) and re-traced shoes (outline centres within ~1 u). Back: legs tapered with heels and counters, a midsole and heel-counter seam. 3/4: draped near and far hems, the near toe lengthened, the far shoe re-shaped, lace dashes. Side: no shoe shadow, the sole line at -12.4..-11.8, midsole, four lace dashes and the toe-cap seam. Typing: seated hems draped like the 3/4. All shoe lines in sneakerLine (ZOO-C7). Read checked at 0.54, 0.88 and 1.4 px/u (ZooScales).',
			why: 'The R3 review measured high-top shoes, trousers 4-9 u too wide and flat hems in every view.',
		},
		{
			id: 'ZOO-K4',
			sheet: 'zoo_turn_front.png row/column scans: the black tee ends at ~-451 with a hem line; between the open overshirt panels the trousers show, with a soft fly seam, down to the overshirt hem; the crotch is high (~-394) with the leg gap opening at ~-382.',
			chosen: 'Repair round 4: the tee\'s hem corners at -451 (INT-Z2 had run it to the overshirt hem at -419), the trouser top at -460 under it, a FLY seam in trousersShadow from -451 to the crotch, the crotch at -394 and the leg gap from -382 (round 3: -368, so the inseam top rose ~14 u); no under-hem shadow band.',
			why: 'R3 review: the tee hung over the trousers to the overshirt hem and the inseam started too low.',
		},
		{
			id: 'ZOO-M3',
			sheet: 'zoo_mouth_ah.png: an oval with an arched top, narrowest at its top row and widest at 46-63% of its height, dark cavity and tongue; zoo_mouth_oh.png: an egg ~13 x 13 u, widest a little below the middle. Neither panel drops the chin.',
			chosen: 'Repair round 4: "ah" re-traced (arched top ~1.5 u under the moustache, widest at 42-70% of its height, near-black cavity behind the tongue, jaw drop 1 u); "oh" re-traced as an egg ~13.4 x 13 u (jaw drop 0.6). Mouth.tsx draws an optional cavity and lip band per shape; the six-shape library and its names are unchanged. Round 5 (ZOO-M4) narrows "ah", drops the near-black cavity for the maroon interior and re-traces "slightlyOpen".',
			why: 'R3 review: both shapes were flat D-shapes with the chin dropping; measured with a mouth-opening mask on the panels and the renders.',
		},
		{
			id: 'ZOO-E3',
			sheet: 'zoo_expr_shocked.png (0.699 u/px): a wide gasp, ~23.5 x 11 u, flat-topped and widest low (~68% of its height), well under the moustache.',
			chosen: 'Repair round 4: expressions carry an optional mouthSpec; shocked uses its own SHOCKED_MOUTH (23.5 x 10.5 u, widest at 62-81% of its height, jaw drop 0.6) with MOD0, used only when no explicit mouth is passed (lip-sync keeps the library). Supersedes the scaled "ah" of ZOO-E1/ZOO-E2.',
			why: 'A scaled library "ah" could not reach the gasp\'s proportions (R3 review).',
		},
		{
			id: 'ZOO-E4',
			sheet: 'zoo_expr_happy.png: a small asymmetric smirk: a wide U-smile under the moustache, the screen-right corner and moustache end lifted more, a cheek fold beside it, lower lids up.',
			chosen: 'SUPERSEDED by ZOO-E5 (repair round 5): the round-4 happy overshot into a squint and a broad grin. Round 4 (literal values of that round): its own closed mouth (HAPPY_MOUTH: a 40 u U-smile line with a skinShadow lower-lip band), corner lifts 4 / 9 u (L / R), moustache ends lifted 4 / 8 u, the beard\'s inner edge follows the smile, a soft tapered cheek crease on the screen-right cheek and lower lids at 3.8 (upper -0.8). On the review\'s metric (|dL*| > 40 in the mouth box of the 400 px bust, against neutral) it was ~2.7x round 3.',
			why: 'R3 review: the front smirk was illegible (the review asked for 3-4x its mouth-region difference).',
		},
		{
			id: 'ZOO-P6',
			sheet: 'Review of the proof in-betweens: at f95-f96 and f188-f189 the elbow stayed at the waist (abduction -1.7 / -0.9 deg) under a forearm swung 42-62 deg out, a tray-carry; on the lowering the open hand came back with the forearm still swung ~42 deg out (a presenting palm).',
			chosen: `Repair round 4: withUpperArmLead (applied inside armAnglesFor and again after the wind-up) keeps the upper arm's abduction >= ${POINT_LEAD.ratio} x the forearm's swing from the hang once that is >= ${POINT_LEAD.full} deg, eased in below with a floor whose slope stays <= 0.4 (no snap near the hang). pointHandFor closes the loose fist once the swing passes ${POINT_FIST_SWING} deg and opens it again only below that, on the raise and the lowering alike (POINT_HAND_CURL ${POINT_HAND_CURL} is now a poseAmount backstop). Preview10s (rig track): abduction 11.0 / 15.8 / 20.6 / 25.2 deg at f95-f98 with forearm swing 37 / 53 / 69 / 84 deg (ratio 0.30); lowering 25.4 / 20.1 / 15.2 / 11.0 / 7.6 / 4.9 / 2.4 deg at f186-f192, fist until f191 (swing 17 deg), relaxed from f192 (11 deg); end pose unchanged (shoulder -43.4, elbow -93 at f105).`,
			why: `Fixes the tray-carry and the presenting palm. Cost: the elbow is out sooner, so at PAIR_SPACING 570 the fist passes Badger's pale ear 1.0 px apart at f96 and 10.4 px at f187 (Zoo-only and Badger-only renders; round 3: 27.2 / 29.1 px). Shifting Badger's frames, ~600 u keeps every raise and lowering frame >= 24 px; the review allows a slightly wider spacing and the integrator re-checks INT-P2.`,
		},
		{
			id: 'ZOO-H4',
			sheet: 'zoo_turn_back.png hair classified at 1 u into base / shadow / ink: the locks are filled shapes (base on top, shadow underneath); the S lock is a broad dark band (shadow on both sides of an ink core, ~12 u deep); the nape starts under four rounded lock ends of unequal length: ~-824 at x -48, a long tip at (-5, -809), the S body\'s tip at (19.5, -811.5) and ~-825 at x 52.',
			chosen: 'Repair round 4: the nape shadow (HAIR_SHADOW) follows those four ROUNDED ends, measured on the render at -825.5, (-5, -809.5), (23, -811) and -826.5 (round 3: four pointed tips at -814.5, (-20, -806), (13.5, -800), -814.5); LOCK_SHADOWS add the S curl, the channel above and right of the S core and the top lock\'s underside wedge; the ink lines are the re-traced S core (1.4x detail), the far-left lock edge (now ending where the nape starts) and a short channel stretch.',
			why: 'R3 review: the nape tips were pointed and equal, and the S lock and its neighbours read as ink lines on a flat cap rather than filled locks.',
		},
		{
			id: 'ZOO-T8',
			sheet: 'zoo_pose_typing.png, both hands scanned column by column: a low heel pad on the keys (skin top ~-380 at the wrist), the back rising to the knuckles (~-403), a hollow under the palm and three visible fingertips on the keys (~-356) parted by narrow slots ~11-14 u deep; the far hand\'s knuckle peak at x 36-44 and front tip at ~78. The overshirt ends at the desk\'s front edge: under the desk only the lap shows.',
			chosen: `Repair round 4: one re-traced typing-hand shape (the near trace mapped into the wrist-local frame at 0.955 x so the heel sits in the cuff); render: near hand heel top -380.5, knuckles -401.5, tips -356..-357.5, front tip at x ~-1 (round 3: wrist top -400, tips -349..-356, front tip -20); far hand knuckles -401.5 at x 36-40, front tip ~77, tips -360..-362.5 (far wrist y -387 -> ${TYPING_LAYOUT.wristL.y}). The seated torso is cut at world y -326, inside the desk's front face (y ${DESK.frontTop}..${DESK.frontBottom}), with its own hem line, and the far thigh's top rises to ~-322 under the desk so the lap fills the space below it.`,
			why: 'R3 review: the typing hands were ~15-20 u short and tall, with hard notch accents, and the standing overshirt hem hung ~45 u below the desk.',
		},
		{
			id: 'ZOO-V9',
			sheet: 'zoo_turn_34.png far hand (rows scanned): the curled fingers end in separate rounded tips at the lower left (the middle finger diagonally to ~(65.5, -338), the index above it at ~(66, -350)) with the thumb\'s tip between them and the fold, tapered creases; zoo_turn_back.png: the hands from behind show three partings between four curled fingertips.',
			chosen: 'Repair round 4: the 3/4 far hand re-drawn with those two fingertip lobes, the thumb tip whose lower edge runs on up the fold crease, and tapered creases (detail x 1.15, taper 0.45); its rows match the sheet within ~1.5 u (e.g. -388: 72..98.5 vs 70.5..99.5; -340: 65.5..72 / 74..85 vs 66..71 / 76..85.5). Back hands: three tapered separations, one from each tip notch (~14-17 u), and a shorter fold line (round 3: two ticks, with the fold running into the middle notch).',
			why: 'R3 review: the far 3/4 hand read as a mitten and the back hands showed only two partings.',
		},
		{
			id: 'ZOO-V10',
			sheet: 'The 3/4 mouth is drawn at the front rig\'s jaw height (tqMouth uses PIVOTS.jaw.y).',
			chosen: `Repair round 4: PIVOTS_34.jaw.y reads PIVOTS.jaw.y (${PIVOTS.jaw.y}); the row said -768.3.`,
			why: 'The published pivot must be where the mouth is actually drawn (R3 review).',
		},
		{
			id: 'ZOO-E5',
			sheet: 'zoo_expr_happy.png against zoo_expr_neutral.png (0.699 u/px): the eyes stay open (eye-white area 94% / 81% of neutral per eye, the lower one the far eye foreshortened by the panel\'s head turn), the brows rise ~2-6 u, and the smile is a thin line ~33-35 u wide and 1.5-3 u deep, tucked right under a flattened moustache; no cheek crease.',
			chosen: `PARTLY SUPERSEDED by ZOO-E6 (round 6: the moustache pose, the smile line's height and the mod values; the eyes and brows stand). Repair round 5 (supersedes ZOO-E4): eyes lidTop ${EXPRESSIONS.happy.eyes.lidTop} / lidBottom ${EXPRESSIONS.happy.eyes.lidBottom} (round 4: -0.8 / 3.8, a squint); brows lift ${EXPRESSIONS.happy.browL.lift} (screen right) / ${EXPRESSIONS.happy.browR.lift} (screen left) u with soft arches; HAPPY_MOUTH is a thin 1.9 u line ~33 u wide whose middle sits 1.4 u above the closed line, with corner lifts 1.5 / 3 u (L / R) and moustache lifts 2 / 3 u on the old tip-weighted profile (no curl) (round 5 values), a thin lower-lip arc (<= 0.8 u) in place of round 4's filled crescent, lip-patch hole 0.3 and no cheek crease. Measured (scratchpad r5/zoo, tools eyes2.py, mouthline.py, facescales.py): eye-white area happy / neutral 0.93 / 0.94 / 0.95 on the front busts at 1.43 / 1.15 / 0.88 px/u (round 4: 0.40) and 0.90 / 0.95 / 0.88 on the 3/4 busts (round 4: 0.36); the smile line is 33.7 u long (6 px/u render) and its ends sit 1.8 u (screen left) and 2.7 u (screen right) above its lowest point, also at 0.88 px/u (1.7 / 2.6 u on a x4 supersampled render; round 4: a 41 u U, 6-7 u deep); the ends tuck under the lifted moustache edge (stroke centre 0.65 / 1.1 u below it).`,
			why: 'Prompt 1 locks "eyes open and alert, with visible irises" and a restrained "small asymmetric smirk"; the R4 review measured round 4 at 42% / 36% eye white with a broad, curled-moustache U-grin that read smug. The panel levels the moustache, which on this rig would take ~7 u of tip lift; the review caps it at 2-3 u, so the tips still droop past the smile ends (known gap).',
		},
		{
			id: 'ZOO-C8',
			sheet: 'zoo_turn_front.png and zoo_turn_side.png (row profiles, R5 review): the uppers are a warm off-white (L* ~92-96 against the sheet background\'s ~89) and the sole band under the midsole line is AS LIGHT as the upper (front rows 636-641: L* 84-100, median ~93, under a 92-96 upper; side rows 634-639: 90-97 under 91-94); only the midsole LINE between them is darker (L* 64-80). The band is ~7 u tall on the front shoes (world x 70-90) and ~8.6 u on the side shoe. Prompt 1 locks "off-white low-top sneakers"; the palette off-white is #F4F6F8. (Round 5 read the sole as darker, L* ~84-90; the R5 review measured otherwise.)',
			chosen: `Repair round 5: ZOO_COLORS.sneaker = BRAND.offWhite (${ZOO_COLORS.sneaker}, L* 96.8; was #E7E9EC, L* 92.3, 0.4 from the background #E6E8EB). Repair round 6 (corrects round 5's sole): sneakerSole = BRAND.offWhite too (${ZOO_COLORS.sneakerSole}; round 5: #D9DCE0, L* 87.6, a grey strip the sheet does not draw), so upper and sole are one off-white separated only by the sneakerLine midsole stroke (ZOO-C7); sneakerShadow stays ${ZOO_COLORS.sneakerShadow} (the off-white's one shadow tone, Badger's coatShadow), unused by the views for now. Every view reads these keys: front, back, side, 3/4 and the typing pose (its feet are the 3/4 shoes). Measured (scratchpad r5/zoo6, tools/soleband.py, dev views at 2.8 px/u): upper and sole L* 96.8 against the background's 91.9 (+4.9; target >= 3-4); sole band between the midsole stroke and the outline 6.8-7.1 u on the front shoes (round 5: 4.3) and 8.2-8.6 u on the side shoe (round 5: 6.4-7.1), see ZOO-S5.`,
			why: 'The R4 review found the uppers at the background\'s lightness (grey, hollow shoes next to Badger\'s white paws); the R5 review found round 5\'s grey sole band where the sheet draws all-white sneakers with a grey seam. INT-C1 cites the old "sneakers L* 0.4" contrast; that premise no longer holds (its contact shadow is unchanged).',
		},
		{
			id: 'ZOO-M4',
			sheet: 'R4 review, mouth masks at the panel framing (0.4116 u/px): zoo_mouth_ah.png 23.5 x 16.5 u, widest at 49-62% of its height, last row 26% of the widest; zoo_mouth_slightly_open.png a symmetric lens 25.5 x 4.9 u, widest at 55%; the open mouths\' cavities are dark maroon (~(44-71, 21-34, 19-29)), not near-black; zoo_expr_shocked.png: the gasp sits ~2.9 u under the moustache and the irises fill ~0.43-0.50 of the eye-white span.',
			chosen: 'Repair round 5: "ah" narrowed to 24.7 x 16.5 u with the rim at lineScale 1 (23.9 x 15.6 at MouthDemo\'s 0.5; round 4: 28.8 x 16.5), widest at 56-59%, its last row 33% of the widest (round 4: 40%); the near-black brow-ink cavity is gone from ah, oh and SHOCKED_MOUTH (the MouthSpec cavity field is removed), so the opening shows the maroon mouthInterior above the tongue; "slightlyOpen" re-traced as a symmetric lens, 25.9 x 4.9 u, widest at 45-64% (round 4: a D, 6.6 u tall, widest at 20-33%); SHOCKED_MOUTH 2 u lower (lip-patch hole 4 -> 6); EXPRESSIONS.shocked eyes.iris 0.72 -> 1, so the iris fills 0.50 of the eye-white span (round 4: 0.34) and the opened lids carry the shock. The rim stays near-black (LINE.color, ZOO_LINE.feature). The six-shape library, its names, the jaw anchor and amplitudeToMouth are unchanged.',
			why: 'R4 review (minor): ah read ~20% squatter than the panel, the cavities read as black holes, slightlyOpen was a D, and the gasp sat tight under the moustache with pin-point irises. No new palette colour: mouthInterior is the panel\'s maroon family.',
		},
		{
			id: 'ZOO-S4',
			sheet: 'zoo_turn_back.png: both heels of each shoe are rounded; zoo_turn_34.png: the screen-right (far, profile) shoe shows a lace panel along the instep (an eyestay edge ~5 u under the top line with four lace marks) and a toe-cap seam from the panel\'s front end down to the midsole; zoo_turn_front.png with the near-black trousers brightened: one soft fold above each hem, rising from the inner side (~40, -71) to a peak toward the outer side (~60, -79).',
			chosen: 'Repair round 5: back shoes: the inner bottom corner rounds over ~5 u like the outer heel (round 4: a square corner at (-23.6, -5) -> (-26, -1.75)). 3/4 far shoe: an eyestay line from the hem to the toe cap, four lace bars across the band and the toe-cap seam joined to the panel\'s front end (round 4: four dashes along the top edge); the R4 review calls it the "near" shoe, but it is the far (profile) shoe of Body34.tsx, also drawn in the typing pose. Front trousers: one tapered break crease per leg in trousersShadow (<= 2 u wide), authored on the left leg and mirrored with it (ZOO-S1).',
			why: 'R4 review (minor); each change was checked on zoomed renders against its crop and at 0.54 / 0.88 / 1.4 px/u.',
		},
		{
			id: 'ZOO-F6',
			sheet: 'zoo_expr_neutral.png at 0.699 u/px (moustache mask L* < 40.5, warm brown, rows filled; also zoo_turn_front.png and the six mouth panels): a flat two-lobed band ~48-50 u wide, ~9.8 u thick at the lobes and ~5.6 u at the centre, where a philtrum notch dents the top (~2 u) and the bottom (~2 u, upward); the top edge falls only ~5.6 u (screen left) / ~4.9-6.3 u (screen right) by 5% of the width from each end; blunt ends that droop to about the mouth line, the cheek beard rising to meet them. The mouth panels draw the same moustache at 45-49 u.',
			chosen: `Repair round 6: MOUSTACHE (parts/Beard.tsx) re-traced to that band: ${(2 * MOUSTACHE_HALF).toFixed(1)} u between its blunt ends, lobes top -785 / bottom -775.2, notches to -782.8 (top) and -777 (bottom), ends at (+-24.3, -771.3); BEARD_BASE's cheek edge now meets each end at ~(+-25.6, -772.4) (its lip patch is unchanged). Measured on the 400 px bust (tools/happy6.py): 48.9 u wide (sheet 49.6 by the same mask), top-edge drop 5.6 / 5.6 u at 5% / 95% (sheet 5.6 / 6.3), 5.6 u thick at the centre (sheet 5.6), its lowest point 11.9 u under the top centre (sheet 14.0). Rounds 1-5: a 54.5 u horseshoe crescent, drop 9.8 / 9.8 u, thin pointed tails 15.4 u under the top centre at (+-27.6, -767.4). The 3/4 head maps it with tqMustX (views/threeQuarter/tq.ts): the near half is not foreshortened (x1.0; the far half keeps tqX), so its blunt end sits at x ~4.4 where zoo_turn_34.png ends it at ~3 (through tqX it would stop at 7.8). The nose is drawn under the moustache in the front and 3/4 heads, so the moustache's top covers the under-tip shadow. Mouth library vs this moustache on the panel framing (tools/mouths.py): slightlyOpen 0.524 of its width (panel 0.521), ah 0.500 (0.514), oh 0.267 (0.272), ee teeth 0.56 (0.55); round 5's 53.5 u moustache made every mouth read ~8% small against it.`,
			why: 'R5 review (minor): the crescent drifted from every panel (+12% wide, a 9.8 u fall where the panels fall ~5-6 u, tails below the mouth line) and its shape was what kept happy from levelling. ZOO-M1 sizes the mouths relative to the moustache; with the re-traced moustache the existing sizes now match the panels without rescaling the library.',
		},
		{
			id: 'ZOO-E6',
			sheet: 'zoo_expr_happy.png against zoo_expr_neutral.png (0.699 u/px): the main happy cue is a LEVELLED moustache (top-edge drop 2.8 / 4.2 u at 5% / 95% of its width by the ZOO-F6 mask; R5 review: 2.1 / 3.5) about 1 u higher and thinner than neutral (its ends ~8 u under the top centre instead of ~14), with the smile line\'s upturned ends showing under it; the eyes stay open (eye white 87% of neutral on the 400 px crops). On the review\'s metric (|dL*| > 40 in the R4 mouth box x 150-290, y 185-240 of the 400 px bust) the sheet pair changes 1542 / 1007 / 582 px at 1.43 / 1.15 / 0.88 px/u (the panel also turns the head ~10-15 deg).',
			chosen: `Repair round 6 (on ZOO-E5): each moustache half is levelled on a LINEAR lift profile about the philtrum (moustachePts: no tip weighting and no outward shift, so the halves stay straight): the ends rise ${EXPRESSIONS.happy.mod.moustacheLiftL} u (screen left) / ${EXPRESSIONS.happy.mod.moustacheLiftR} u (screen right), the whole moustache rises ${EXPRESSIONS.happy.mod.moustacheRaise} u with the upper lip and its lower edge a further ${EXPRESSIONS.happy.mod.moustacheThin} u (moustacheThin: the band thins as the smile pulls the lip up, as on the panel). The smile line (HAPPY_MOUTH: key points ${(HAPPY_MOUTH.kind === 'line' ? Math.max(...HAPPY_MOUTH.line.map((q) => q[0])) - Math.min(...HAPPY_MOUTH.line.map((q) => q[0])) : 0).toFixed(1)} u apart, ~33.8 u long as drawn with the corner lifts) sits 2.5 u above the closed line, ~4.4 u under the moustache's lower edge as on the panel, with corner lifts ${EXPRESSIONS.happy.mod.cornerL} / ${EXPRESSIONS.happy.mod.cornerR} u (L / R); eyes and brows as ZOO-E5. The profile head lifts its visible (near) half by 0.55 x moustacheLiftL with the cheek beard rising to keep its end tucked in, and its lip line slopes up toward the cheek. Measured (scratchpad r5/zoo6/final, tools/happy6.py, mouthline.py, facescales.py): front mouth-box change 667 / 377 / 231 px at 1.43 / 1.15 / 0.88 px/u (43% / 37% / 40% of the sheet pair; target >= ~500 / 330 / 190; round 5: 298 / 134 / 90); 3/4 565 / 324 / 199 (round 5: 212 / 90 / 63); moustache top-edge drop 2.1 / 0.7 u at 5% / 95% (target <= 3.5, no upturned tip; round 5: 9.1 / 7.7); eye white happy / neutral 93% / 94% / 95% (3/4: 90% / 95% / 88%); smile 33.8 u long, its ends 1.47 u (screen left) and 2.92 u (screen right) above its lowest point (<= 3 u) at all three scales.`,
			why: 'R5 review (major): round 5\'s happy read as neutral (13-19% of the panel pair\'s mouth-region change) because the crescent kept its arch and its thin tails hid the smile ends; a tip-weighted lift of 2-3 u could not level it. The asymmetry stays on the screen-right side (anatomical left, the side of the deadpan brow raise, ZOO-E5), as the reviews specify; the panel\'s own turned-head drawing lifts its near (screen-left) corner a little more. No head yaw (ZOO-E2).',
		},
		{
			id: 'ZOO-E7',
			sheet: 'Engine behaviour, not a panel: the Episode and Show engines pass an explicit mouth on every frame, "closed" whenever Zoo is silent (src/episode/perf/zoo.ts zooAt, src/show/perf/plan.ts).',
			chosen: 'Repair round 6: every head (front, 3/4, profile) resolves its mouth through rig.ts mouthFor(expression, mouth). No mouth or "closed" is the REST mouth: the expression\'s own default mouth with its full modifiers and its own drawing (happy: HAPPY_MOUTH; shocked: SHOCKED_MOUTH, the gasp; worried: the downturned closed line; neutral: the flat closed line). Any other shape is lip-sync: the six-shape library with explicitMod, which softens the corners and the worried wave but keeps the moustache pose in full (round 5 scaled it by 0.6, which would make a happy moustache drop on every spoken frame and lift on every silent one). explicitMod moved from parts/Head.tsx to rig.ts (re-exported). Checked: renders with mouth "closed" are pixel-identical to the rest mouth for happy, shocked and worried; src/characters/zoo/tests/mouthRule.test.ts (node --test, 6 tests) asserts that a silent shocked frame draws SHOCKED_MOUTH and a silent happy frame HAPPY_MOUTH with their full modifiers, that spoken shapes stay the library, and the smirk\'s depth and open eyes.',
			why: 'R5 review (major): with "closed" on every silent frame the panel-matched expression mouths never reached Episode, EpisodeShort, ShowEpisode or ShowShort, so silent "shocked" was wide eyes over a flat line and the pilot\'s happy CTA (s07) read almost neutral. A known cost: while a shocked Zoo talks, the engines\' "closed" frames between words show the gasp, so his mouth alternates gasp / viseme instead of gasp / closed.',
		},
		{
			id: 'ZOO-M5',
			sheet: 'zoo_mouth_oh.png: an egg with a ROUND bottom (its last row ~10% of the widest), 0.27 of the moustache width; zoo_mouth_ee.png: a flat lozenge, teeth ~0.55 x 0.14 of the moustache, the upper and lower teeth parted by a thin LIGHT-GREY line. No profile mouth panels exist (the side turnaround shows the closed mouth only).',
			chosen: 'Repair round 6: "oh" re-traced to 13.2 x 12.8 u with the rim (0.267 of the moustache; round 4-5: 14.0 x 13.6) with a round bottom that narrows into its lowest point (last row 16% of the widest; round 4-5: 35%). "ee" flattened to ~31 x 9.8 u with the rim and 27.6 x 6.2 u of visible teeth (round 1-5: 35 x 11.7 u, teeth 31.3 x 9.1), lip-patch hole 2 -> 1.6 and jaw 1 -> 0.8; its teeth parting is a thin brand-silver line (#C9CED6; rounds 1-5: a heavy near-black stroke). Profile head: an open mouth\'s lip edges are stroked at the mouth-rim weight (ZOO_LINE.feature) and the silhouette stroke stops at the lip fronts, so slightlyOpen shows a ~1.5 u maroon gap (rounds 1-5: the 3.5 u silhouette stroke filled it, a thicker lip corner only); the profile ee draws a white teeth wedge over the front of the opening with a silver parting (rounds 1-5: ~6 px of white in a maroon wedge). The six shapes, their names, the jaw anchor and amplitudeToMouth are unchanged; MouthDemo shows the same six shapes.',
			why: 'R5 review (minor): oh read as a flat-bottomed U, the ee parting and size did not match the panel, and in profile slightlyOpen, ee, ah and oh were hard to tell apart. No new palette colour (brand silver is a palette token).',
		},
		{
			id: 'ZOO-S5',
			sheet: 'zoo_turn_front.png / zoo_turn_side.png: the sole band is ~7 u (front, world x 70-90) and ~8.6 u (side) between the midsole line and the outline; zoo_turn_side.png: the toe runs down into the sole as one convex curve.',
			chosen: 'Repair round 6: front midsole line 2.6 u higher (y ~-11.8; band 6.8-7.1 u, round 5: 4.3) with the vamp seam ends moved onto it; side midsole ~1.7 u higher (y ~-13.3; band 8.2-8.6 u, round 5: 6.4-7.1) with the toe-cap seam ended on it; the side toe is one convex curve that rounds into the flat bottom ~5 u behind the toe front (round 3-5: the spline\'s tangent at the toe-bottom corner overshot 2.8 u past the toe as a spur, R5 review). Extra key points along the flat bottoms of the front, 3/4 (both) and back shoes stop the same overshoot at their bottom corners (small hooks of up to ~2.4 u at the back heel).',
			why: 'R5 review (minor); checked on 12 px/u zooms (r5/zoo6/cmp/shoe_zooms_it9.png, shoe_bottoms_it10.png) and the sole-band row profiles.',
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
		'The point gesture timing (ease, hold, overshoot) lives in the compositions; the rig only provides the path, the loose-fist transition, the raise-only tuck (pointTuck) and POINT_LOOK. Preview10s settles at poseAmount 0.993 and lets the arm sink to 0.93 over the hold on one sine ease (INT-T2), ~7-8 px of hand travel at the proof scale.',
		'The upper-arm lead (ZOO-P6) costs fist clearance: at PAIR_SPACING 570 the fist passes Badger\'s pale ear 1.0 px apart at f96 and 10.4 px at f187 (Zoo-only and Badger-only renders; INT-P2 asks >= 24 px). About 600 u keeps every raise and lowering frame >= 24 px (Badger\'s frames shifted); stage.ts belongs to the integrator, who re-checks. Pass pointTuck={0} while lowering (Preview10s does).',
		'Happy (ZOO-E5 / ZOO-E6) stays restrained: open eyes, slightly raised brows, a levelled moustache and a thin smile line 1.5 / 2.9 u deep, with no head turn (the panel turns ~10-15 deg). Its mouth-box change against neutral is 43% / 37% / 40% of the sheet pair\'s at 1.43 / 1.15 / 0.88 px/u; the rest is the panel\'s head turn, which the front rig does not draw. The panel\'s turned drawing lifts its near (screen-left) corner a little more; the rig keeps the smirk on the screen-right side (ZOO-E6).',
		'Point end pose: the upper arm is ~6 deg more raised than on the pose panel (ZOO-P4) and the fingertip sits ~14 u lower (h ~719 vs 733); the shoulder line keeps a small corner where the raised sleeve meets it.',
		'Pose "typing" is authored only in 3/4 facing screen right (as on the sheet); the view prop is ignored for it (ZOO-T5). Its near forearm ends ~18 u short of the sheet\'s (cuff at x -100.6 vs ~-82), so the re-traced hands (ZOO-T8) are long from the cuff and the front tips sit ~28 u left of the sheet\'s.',
		'Only the anatomical-left arm can point; the right arm stays at rest.',
		'Arms in the 3/4, side and back views are static hangs (no joint rig yet); the typing arms are fixed except finger taps and breathing.',
		'Back view: expression, mouth, blink, look and brow lift have no visible effect (no face from behind); headTilt and breathing work.',
		'Side view: the smirk lifts the anatomical-left (far) mouth corner most, so "happy" reads in profile through the brows, the near moustache half\'s smaller lift (0.55 x moustacheLiftL, ZOO-E6) and the near lip line sloping up toward the cheek.',
		'headTilt rotates the head about the neck pivot in every view without deforming the neck; keep it within about +-8 deg.',
		`Brand colours used outside ZOO_COLORS: ${BRAND.nearBlack} (outline) and ${BRAND.silver} (the ee teeth parting, ZOO-M5). ZOO_COLORS.sneaker and sneakerSole are ${BRAND.offWhite} (offWhite); the sneaker's one shadow tone ${ZOO_COLORS.sneakerShadow} equals Badger's coatShadow and is unused by the views (ZOO-C8); the pin has no highlight (teal dome and tentacles cased in near-black). Props use PROP_COLORS (palette.ts).`,
		'The open mouths keep a near-black rim (LINE.color) at about twice the panels\' thin very dark red-brown rim, and their maroon interior (mouthInterior) is a little lighter than the panels\' cavity (ZOO-M4); no new palette colour was added.',
		'While a shocked Zoo talks, the engines\' "closed" frames between words draw the gasp (the rest-mouth rule, ZOO-E7), so his mouth alternates gasp / viseme; give a talking shocked line its own expression change if that reads wrong.',
	],
};
