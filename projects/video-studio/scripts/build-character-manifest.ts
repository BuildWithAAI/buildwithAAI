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
import {HEAD_GEOM} from '../src/characters/badger/parts/heads/headGeom';
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
import {BEATS, POINT, SWAP} from '../src/compositions/characters/Preview10s';
import {PROVISIONAL_CAPTION} from '../src/compositions/characters/captions';
import {POINT_PATH_LENGTH, pathForPoseAmount, pointPath} from '../src/compositions/characters/gesture';
import {FOOTPRINTS} from '../src/compositions/characters/contact';
import {BADGER_SHEET_BUSTS, closeLineScale, fullLineScale, GROUND_Y, FRAME, PAIR_LINE_SCALE, PAIR_SCALE, PAIR_SPACING} from '../src/compositions/characters/stage';

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

/**
 * Markings a head draws twice on purpose (decision INT-Q2): a look-up head brings its own look-up neck and SideBody draws
 * that neck's part above the collar again in front of the torso (BADGER-D51), so on the head's own rig the neck
 * markings are drawn twice, with the same path and transform (one marking, two draws). Derived from the generated
 * head geometry (neckUp.rig) and the rig's neck spot records, so it follows any regeneration.
 */
const neckIds = (spots: readonly BadgerSpot[]) => spots.filter((s) => s.part === 'neck').map((s) => s.id);
const redrawnByHead = Object.fromEntries(
	Object.entries(HEAD_GEOM).flatMap(([head, g]) => {
		const up = (g as {neckUp?: {rig?: string} | null}).neckUp;
		if (!up || (up.rig !== 'left' && up.rig !== 'right')) return [];
		return [[head, {view: up.rig, ids: neckIds(up.rig === 'left' ? LEFT_SPOTS : RIGHT_SPOTS), draws: 2}]];
	}),
);

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

/**
 * Integration corrections (round 5) to three recorded panel readings that the R4 review measured as wrong. The source
 * texts in src/characters/zoo/manifest.ts keep their wording; the manifest carries the corrected `sheet` reading and a
 * `correction` note that says what changed and why.
 */
const ZOO_CORRECTIONS: Record<string, {sheet?: string; why?: string; correction: string}> = {
	'ZOO-E1': {
		why: 'v1-round 3 kept the fixed six-shape mouth library; a scaled "ah" could not match the gasp\'s proportions (~23.5 x 11 u, an arched top, widest low; round 4 review).',
		correction: "Round 5 (integration, R4 review): this entry called the gasp 'flat-topped'; the panel's opening is arched (ZOO-E3).",
	},
	'ZOO-E2': {
		sheet: 'zoo_expr_worried.png: inner brow ends rise 5-7.5 u with a sharp upturn, the screen-right arch inverts ~4 u, tails rise ~1.5-2 u. Shocked: brows ~8-11 u up and a wide gasp with an arched top (ZOO-E3). Happy: a small closed smile tucked under an almost level moustache with the eyes still open (eye-white area 72-98% of neutral\'s), head turned ~15 deg.',
		correction: "Round 5 (integration, R4 review): this entry read the happy panel as 'soft closed U-smile, lower lids up'. Measured, the panel keeps the eyes open (eye-white area 72-98% of neutral's; the far eye is foreshortened by the turn) and its smile is a thin line 1.5-3 u deep. The happy values under 'chosen' are rounds 1-2; ZOO-E4 (round 4) and then ZOO-E5 (round 5) replaced them.",
	},
	'ZOO-E3': {
		sheet: "zoo_expr_shocked.png (0.699 u/px): a wide gasp, ~23.5 x 11 u, with an arched top (the opening is ~10 px wide at its top row against ~32 px at its widest) and widest low (~68% of its height), ~2.9 u under the moustache.",
		correction: "Round 5 (integration, R4 review): this entry called the panel's opening 'flat-topped'; it is arched, as SHOCKED_MOUTH draws it. ZOO-M4 (round 5) moved SHOCKED_MOUTH 2 u lower and set the shocked iris to 1.",
	},
	'ZOO-E4': {
		sheet: "zoo_expr_happy.png: a small asymmetric smirk: a thin smile ~33-35 u wide and 1.5-3 u deep tucked under an almost level moustache, the screen-right corner lifted a little more; the eyes stay open (eye-white area 72-98% of neutral's) and there is no cheek fold.",
		correction: "Round 5 (integration, R4 review): this entry read the panel as 'a wide U-smile, a cheek fold beside it, lower lids up'; that misreading drove round 4's squint and grin. Superseded by ZOO-E5.",
	},
};
const zooDecisions = ZOO_MANIFEST.decisions.map((d) => ({character: 'zoo', ...d, ...(ZOO_CORRECTIONS[d.id] ?? {})}));
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
		chosen: `When Zoo points to screen right over Badger, the pair stands ${PAIR_SPACING} units apart and Badger is drawn in front of Zoo (depth), for the whole shot (no sliding). Scale and ground line stay the panel's. Integration rounds: 560 (round 1), 570 (round 3), ${PAIR_SPACING} (round 4; ${Math.round(PAIR_SPACING - SIZE_COMPARISON.spacingUnits)} units, ${Math.round((PAIR_SPACING - SIZE_COMPARISON.spacingUnits) * PAIR_SCALE)} px, wider than the panel).`,
		why: "Spacing is staging, not anatomy; relative scale is unchanged. Round 1: at the panel spacing the swinging hand overlaps Badger's pale ear (poseAmount ~0.2), so the pair moved to 560 units; round 3 moved to 570 for the earlier-opening arm of ZOO-P5. Round 4: the rig's upper-arm lead (ZOO-P6, the upper arm abducted at least 0.3 x the forearm's swing) opens the elbow sooner, and at 570 units the fist passed 1.0 px from the pale ear at f96 and 10.4 px at f187. At 608 units (ZOO_X 655, BADGER_X 1190 px), Zoo-only and Badger-only renders of all 300 frames give a closest pass of 30.0 px at f97 and 31.0 px at f96 on the raise and 36.2 px at f188 on the lowering, with no overlapping pixel; rendered at 1/10-frame steps through both passes, the hand's continuous path stays at least 26.9 px from his head (t 96.3, the front head's pale ear) and 30.5 px (t 187.5, the 3/4 head's ear tip). 600 units would give 23.4 px at f96 (the ground points are placed on whole pixels). Round 5 (BADGER-D55 drew the front head 10% and the 3/4 heads 5% smaller; INT-A2 re-tuned the swaps): on Zoo-only and Badger-only renders the closest passes are 38.6 px (f97), 40.5 px (f96), 40.6 px (f188) and 43.8 px (f187), with no overlapping pixel, and at 1/10-frame steps the continuous path stays at least 37.8 px (t 96.3) and 35.8 px (t 187.6) away; the spacing stays 608. Badger's eyes close as the fist passes on the raise (blink f94-99). Acting does not buy the gap: a 4 deg neck rise or head tilt on Badger gains about 3 px at f96 but loses 2-3 px at f97, an ear fold and holding the front head longer change nothing, and turning to the 3/4 head a frame earlier is worse (its ear sits nearer the path).",
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
		chosen: `The point is timed along the hand's arc, not in poseAmount: gesture.ts maps a path fraction to poseAmount through the rig's own pivots and angle function (upper-arm lead included), on a table built for the pointTuck the composition passes (pointPath; hand path ${Math.round(POINT_PATH_LENGTH)} units with the rig's default tuck, ${Math.round(pointPath(0).length)} with none). The swing eases the path fraction with bezier(0.38,0,0.4,1) over ${BEATS.swing[1] - BEATS.swing[0]} frames (f${BEATS.swing[0]}-${BEATS.swing[1]}), ends past the hold pose and settles back ~1-2 deg (poseAmount ${POINT.overshoot} -> ${POINT.settle}, f${BEATS.settle[0]}-${BEATS.settle[1]}), holds (decision INT-T2) and lowers along the tuck-free arc over ${BEATS.armDown[1] - BEATS.armDown[0]} frames (f${BEATS.armDown[0]}-${BEATS.armDown[1]}; round 3: 15, round 2: 16).`,
		why: `The rig's joint path moves the hand ${Math.round(pathForPoseAmount(0.5) * 100)}% of its travel in the first half of poseAmount, so easing poseAmount directly snaps the swing (v1: 123 px in one frame). Arc-length timing gives a minimum-jerk-like speed curve: measured on the joint chain in round 4 the hand peaks at 48.7 px/frame on the raise (f96) and 47.3 px/frame on the lowering (f188) at the proof scale; the lowering went back to 16 frames because the round-4 path is longer (round 3 measured 45.4 and 47.9). A table built for another tuck than the one passed puts up to ~60 px into one frame. Hand shapes: since repair round 4 the rig closes the fist by the forearm's swing (POINT_FIST_SWING 16 deg), so the relaxed hand shows only near the hang (to f93; again from f192), the loose fist f94-102 and f184-191, the pointer from f103 and to f183.`,
	},
	{
		character: 'zoo',
		id: 'INT-T3',
		sheet: 'zoo_pose_point.png shows only the end pose. The round-2 review found a 3-4 frame "tray-carry" in-between (the upper arm hanging with the elbow at the waist while the forearm swings level), on the way up and in reverse on the way down; repair round 3 re-timed the rig and added ZooRig pointTuck, and repair round 4 added the upper-arm lead (ZOO-P6: the upper arm is abducted at least 0.3 x the forearm swing whenever the swing is 20 deg or more).',
		chosen: `Preview10s passes the anticipation tuck only on the raise: pointTuck is 1 up to poseAmount ${POINT.tuckRelease[0]}, eased to 0 by ${POINT.tuckRelease[1]}, and 0 through the hold and the lowering, and each is timed on the arc table of that exact path. With the rig's round-4 upper-arm lead the tuck changes no joint angle on this raise (angles identical with pointTuck 1 and 0 on f88-104): the lead sets the upper arm on every frame, so the anticipation is carried by pointWindup (the hand draws ~9 px toward the hip and the wrist cocks; the lead clamps the wind-up's shoulder part to 0), the eyes leading and the counter-tilt. Raise and lowering both take 16 frames. Per frame on the joint chain (forearm angle from level / upper-arm abduction from rest, deg): raise f95 -52.1/11.0, f96 -36.2/15.8, f97 -20.0/20.6, f98 -4.9/25.2, f99 8.2/29.1; lowering f185 15.6/31.3, f186 0.7/26.9, f187 -15.7/22.0, f188 -31.5/17.2, f189 -45.7/12.9.`,
		why: "Every frame with the forearm within 30 deg of level now has the upper arm at least 20.6 deg out (the round-2 review asked for at least 10-12 deg at the level crossing; round 3 had 11.3 and 11.5 deg at f98 and f186, with f97 and f187 at 6-7 deg), and the elbow pivot leaves the waist (x 112 at rest) together with the forearm: x 127 at f94, 159-173 at the level frames. No frame of f94-99 or f185-190 reads as a tray carry. The cost is fist clearance to Badger's head, which the pair spacing restores (INT-P2).",
	},
	{
		character: 'zoo',
		id: 'INT-T2',
		sheet: 'zoo_pose_point.png shows only the end pose; Prompt 1 asks for restrained limited animation with purposeful gestures, and every hold must stay alive (the round-2 performance review: the hand moved 2 px or less over f106-181, so the gesture froze).',
		chosen: `A moving hold, f${BEATS.hold[0]}-${BEATS.hold[1]}: the raised arm sinks from poseAmount ${POINT.settle} to ${POINT.sunk} on one slow sine ease (round 4: shoulder 3.1 deg, wrist 3.7 deg, elbow 0.1 deg), so the hand drops 8.2 px at the proof scale on the joint chain, and the lowering starts from that pose (round 3 sank to 0.93; the upper-arm lead moved less of the drop into the shoulder, so round 4 sinks to 0.91). Part-way through, Zoo nods once toward the point: a ~1.7 deg head tilt down and back (f${BEATS.zooNod[0]}-${BEATS.zooNod[2]}) with a blink that starts with it (f${BEATS.zooBlinks[1]}). Badger answers after the nod with his small curious tilt (f${BEATS.badgerTilt[0]}-${BEATS.badgerTilt[3]}) and one blink (f${BEATS.badgerHoldBlink}), so the two moves do not overlap.`,
		why: 'The reviewer asked for ~0.05 poseAmount of drift (6-10 px at the hand) with a slow ease plus a 1-2 deg nod. Near the end key the shoulder and wrist carry the change; the breathing cycle lifts the arms ~1.6 px over the same frames, and a deeper sink would read as the arm tiring. The head tilt is the rig\'s only head control, so the nod is a small tilt toward the point; the blink sells it as a nod.',
	},
	{
		character: 'both',
		id: 'INT-C1',
		sheet: 'The approved sheets draw no contact shadows (the size panel has only a ground line). ART_GUIDE CV4a/LS4: Badger\'s off-white coat and, since ZOO-C8 (round 5), Zoo\'s off-white sneaker uppers (both #F4F6F8, L* 4.9 above the background; the round-4 uppers sat 0.4 above it) separate from #E6E8EB mostly by their outline, so every shot showing feet or paws gets one flat contact shadow in backgroundShadow. The round-2 Badger review asked for it in the proof and the sheet stills.',
		chosen: `BRAND.backgroundShadow ${BRAND.backgroundShadow} (ART_GUIDE CV2; the value the branding, episode and show themes already use) is added to palette.ts as the background colour's one flat shadow tone. Preview10s, ZooSheet and BadgerSheet draw one flat ellipse under each figure (src/compositions/characters/contact.tsx, FOOTPRINTS: measured sole, paw, wheel or leg extents + 10 units, e.g. Zoo front rx ${FOOTPRINTS.zooFront.rx}, Badger 'left' rx ${FOOTPRINTS.badgerLeft.rx}; ry 15-16 units). In the proof the shadows sit over the silver ground line (the line passes behind the feet); on the sheets the near-black baseline runs over them, so it stays unbroken. No blur, opacity or gradient.`,
		why: 'ART_GUIDE is the craft guide and PROJECT_INSTRUCTIONS allows one flat shadow tone per colour; the background stays plain #E6E8EB. ART_GUIDE asks for the owner\'s sign-off on the palette entry, so it is recorded here and is still pending.',
	},
	{
		character: 'both',
		id: 'INT-L1',
		sheet: 'The sheet keeps a near-constant screen line weight: close-up panels (zoo_expr_*, badger_expr_*) draw outlines at about half of LINE.width in world units (1.4-2.1 units at 0.699 units/px).',
		chosen: `Every composition passes lineScale to both rigs. Full-body framings use ART_GUIDE SL5 (outline clamp(3.5 x k, 3, 6) px, k = output px per unit): the proof pair at ${PAIR_SCALE} gives ${PAIR_LINE_SCALE.toFixed(2)}, the Zoo sheet row at 0.54 gives ${fullLineScale(0.54).toFixed(2)}, Badger's pose row at 0.5 gives ${fullLineScale(0.5).toFixed(2)}. Close-ups keep the sheet's close-up weight (half of LINE.width), floored at 3 px and capped at 6 px: MouthDemo bust ${closeLineScale(900 / 280).toFixed(2)}, sheet busts ${closeLineScale(322 / 279.6).toFixed(2)} (Zoo) and ${closeLineScale(BADGER_SHEET_BUSTS.scale).toFixed(2)} (Badger, drawn at ${BADGER_SHEET_BUSTS.scale} px/u since round 5: BADGER-D55 drew the front head and bust neck 10% smaller, so the row grew 1/0.90 to keep round 4's on-screen bust size).`,
		why: 'Fixed world-unit strokes were about twice the sheet weight in close-ups and under SL5\'s 3 px floor on the small sheet rows.',
	},
	{
		character: 'badger',
		id: 'INT-A2',
		sheet: 'Prompt 2: Badger looks toward the gesture with a small head turn, looks up at Zoo, then gives a restrained judging reaction. Prompt 1: emotion through brows, folded ears, head angle and tail; eyes open between natural blinks.',
		chosen: `Every head replacement in the proof happens with Badger's eyes closed, and the two big turns go through held in-betweens. The turn to the 3/4 head under a blink (f${BEATS.badgerTurn}) enters it low and nose-down (neck ${SWAP.threeQuarterRightIn.neck}, tilt ${SWAP.threeQuarterRightIn.tilt} deg; round 5), and the neck rises along the point to 5 deg by f112. The look-up: the eyes and neck lead (f${BEATS.badgerLookUp.eyes[0]}-${BEATS.badgerLookUp.eyes[1]}), then, eyes closed, a front-head breakdown held ${BEATS.badgerLookUp.toThreeQuarter - BEATS.badgerLookUp.toFront} frames (f${BEATS.badgerLookUp.toFront}-${BEATS.badgerLookUp.toThreeQuarter - 1}) rolling toward Zoo (neck ${SWAP.breakdown.neck.join(' -> ')}, tilt ${SWAP.breakdown.tilt.join(' -> ')}), then threeQuarterLeftScreen held ${BEATS.badgerLookUp.toUp - BEATS.badgerLookUp.toThreeQuarter} frames (f${BEATS.badgerLookUp.toThreeQuarter}-${BEATS.badgerLookUp.toUp - 1}) rising on its neck (${SWAP.lookUpThreeQuarter.neck.join(' -> ')}) as its tilt eases (${SWAP.lookUpThreeQuarter.tilt.join(' -> ')}; the head still lifts), then upLeftScreen (f${BEATS.badgerLookUp.toUp}, neck ${SWAP.upStart} easing up): a four-drawing turn (3/4 right, front, 3/4 left, profile up); the blink holds until that frame. The judging look: on the up head the neck eases down over ${BEATS.judge.neckDown[1] - BEATS.judge.neckDown[0]} frames (f${BEATS.judge.neckDown[0]}-${BEATS.judge.neckDown[1]}, to ${SWAP.upDown} deg) while a slow blink closes (f${BEATS.judge.blink}), then threeQuarterLeftScreen holds ${BEATS.judge.swap - BEATS.judge.toThreeQuarter} frames (f${BEATS.judge.toThreeQuarter}-${BEATS.judge.swap - 1}; neck ${SWAP.threeQuarterLeft.neck.join(' -> ')}, tilt ${SWAP.threeQuarterLeft.tilt.join(' -> ')}, its nose lifting toward the front head's), then the front head (f${BEATS.judge.swap}) at neck ${SWAP.front.neck} and total head rotation ${SWAP.front.total} deg; the eyes open on Zoo, the judge brows, ears 0.42 and the settle to neck ${SWAP.judge.neck} / total ${SWAP.judge.total} deg follow, with one slow push-in (1.00 -> 1.04, f${BEATS.pushIn[0]}-${BEATS.pushIn[1]}, ART_GUIDE MO13) anchored on his eyes. On the left rig a neckTurn of about 2.5-6.5 deg (and below -13) opens a 1-2 px seam at the neck's back corner by the collar (rigLeft.ts; reported by the round-5 Badger repair), so the front and 3/4-left heads never hold or cross that band in the proof. Round 5, measured on Badger-only renders (centroid of the skull's top 70 px of coat / of the head's top 120 px, then the crown top): f97 (-4.7, -7.2) / (-5.8, -5.5), crown -7 px; f190 (+0.4, +9.9) / (+3.2, +10.7), crown +11; f193 (+1.8, -0.9) / (-0.7, -1.0), crown -1; f195 (-4.0, -4.6) / (-1.2, -5.6), crown -4; f241 (+3.2, +4.2) / (-0.4, +4.0), crown +3; f244 (-0.3, -1.2) / (+2.2, -2.1), crown -1. Idle life in 0-3 s: one blink and one ear flick.`,
		why: 'The round-2 review found the judge swap popping in one frame from the profile pitched up at Zoo to a level frontal head (the nose moved half a head length and the ears changed from one hanging profile ear to two frontal ears), and the look-up going 3/4-right, front, up-left in three frames. Lowering the up head first and passing through held in-betweens turns both into readable head turns: in round 4 the skull stayed within 6 px at the replacements it measured (f190-f244) and the face features (the nose 38-69 px per replacement, the ears) moved around it under closed eyes, as in a drawn turn. The judging look stays on the front head because there the lids and brows read (on the pitched profile each cue moved only 2-7 px). Round 5: BADGER-D55 drew the front head 10% and the 3/4 heads 5% smaller, which opened the round-4 values to 12.4 px at f97 (a swap round 4 had not measured), 10.7 at f190, 8.8 at f195 and 6.7 at f241; re-tuned, f97 is 8.6 px, f195 6.1, f241 5.3 and f244 3.0. The two swaps with the 3/4-right head on the left body stay at 8.6 px (f97) and 11.2 px (f190): that head\'s mount (LEFT_HEAD_MOUNT.threeQuarterRightScreen dy 16 against the front head\'s 25) sets its skull ~10 px higher than the front head\'s at any neck and tilt, and neck and tilt move the skull mostly sideways (a grid of 396 neck/tilt renders puts the best reachable at ~8.5 and ~9 px), so only a mount change in the Badger rig, with its generated jaw and nape re-fitted (BADGER-D56), can close them. At f190 the drop reads as the dip of a turn through camera.',
	},
	{
		character: 'badger',
		id: 'INT-S1',
		sheet: 'BADGER-D23 (revised): sit and lie exist in both facings; round 3: the left-facing ones are PROVISIONAL pending the owner (BADGER_PROVISIONAL_POSES).',
		chosen: `BadgerSheet shows sit and lie in both facings (each pair faces each other so the left- and right-side markings sit side by side), plus walk and look-up, at scale 0.5. Each left-facing sit and lie carries a small, quiet caption below its ground line, centred on the drawing (not the root), "${PROVISIONAL_CAPTION}" (Inter 400, 17 px, slate; marked as an owner-only review badge for QA), drawn for every pose on BADGER_PROVISIONAL_POSES.`,
		why: 'The asset sheet should show every implemented pose body; the left-facing ones carry different markings (LEFT coat map) but reuse the right-facing silhouette mirrored, so the sheet must not present them as finished until the owner accepts D23.',
	},
	{
		character: 'badger',
		id: 'INT-Q1',
		sheet: 'BADGER-D23 is provisional: the left-facing sit and lie keep working, and tools should flag wherever a scene uses them. The R4 owner review asked that QA fail, not warn, when an episode uses them.',
		chosen: 'Visual QA (scripts/qa) reports model-provisional for any Badger instance whose drawn view and pose are on BADGER_PROVISIONAL_POSES (today view left with sit or lie). Integration round 5: it is an ERROR in the compositions that publish, Episode, EpisodeShort, ShowEpisode, ShowShort and Thumbnail (PRODUCTION_COMPOSITIONS in scripts/qa/lib/provisional.ts, exact ids), and stays a WARNING everywhere else (BadgerSheet, ZooSheet, Preview10s, MouthDemo, dev, probe and fixture compositions); report.json records the severity used. It reads the list the way the Badger index exports it (src/characters/badger/index.ts; Node follows its re-export to src/characters/badger/provisional.ts because the index also loads the React components), falls back to this manifest\'s provisional.badger, and reports nothing once the index stops exporting it. Unit tests: scripts/qa/tests/provisional.test.ts; end to end, a scratch EpisodeShort that draws the left sit fails (exit 1) while the same scene under a review id passes with one warning.',
		why: 'The sheets and the proof must keep showing the drawings for review, while no published render may ship one until the owner accepts BADGER-D23; an error makes the production QA run fail instead of leaving a warning to be overlooked.',
	},
	{
		character: 'badger',
		id: 'INT-Q2',
		sheet: 'BADGER-D51 (repair round 4): each look-up head brings its own look-up neck, and SideBody draws that neck\'s part above the collar again in front of the torso, neck markings included.',
		chosen: 'The manifest records those redraws (markings.badger.redrawn, derived from the generated head geometry and the rig\'s neck records: upLeftScreen on the left rig redraws L-NECK, upRightScreen on the right rig R-NECK, two draws each). Visual QA\'s marking check (model-spots) allows exactly that many copies of exactly those ids for that head on its own rig; any other repeated marking, a third copy, or the same copy on another head or rig is still an error. Unit tests: scripts/qa/tests/checks.test.ts.',
		why: 'The second draw is the same spot record with the same transform, clipped to the redrawn part (one marking, not a new one), but the probe counts data-spot elements, so without the record every look-up frame failed QA with "duplicated L-NECK" (round-4 integration, Preview10s f195-240).',
	},
];

const zooFront = ZOO_MANIFEST.pivots;
const manifest = {
	manifest: 'zoora-characters',
	version: '1.0.0',
	date: '2026-11-25',
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
		pairShotStaging: {scale: PAIR_SCALE, groundYpx: GROUND_Y, spacingUnits: PAIR_SPACING, lineScale: r(PAIR_LINE_SCALE, 3), note: 'see decisions INT-P2, INT-L1 and INT-C1'},
		contactShadows: {
			colour: BRAND.backgroundShadow,
			rule: 'decision INT-C1: one flat ellipse per figure, centred on its ground point + cx (world units, times scale), radii rx/ry; component ContactShadow in src/compositions/characters/contact.tsx',
			footprints: FOOTPRINTS,
		},
		lineWeights: {
			rule: 'decision INT-L1: both rigs take lineScale (multiplier on every stroke). Full body: ART_GUIDE SL5, outline clamp(3.5 x k, 3, 6) px with k = output px per unit (fullLineScale). Close-ups: half of LINE.width in world units, clamped to 3..6 px (closeLineScale). Same value for both characters in a two-shot.',
			zooLine: ZOO_LINE,
			examples: {proofPair: r(PAIR_LINE_SCALE, 3), zooSheetRow: r(fullLineScale(0.54), 3), badgerPoseRow: r(fullLineScale(0.5), 3), mouthDemoBust: r(closeLineScale(900 / 280), 3), zooSheetBust: r(closeLineScale(322 / 279.6), 3), badgerSheetBust: r(closeLineScale(BADGER_SHEET_BUSTS.scale), 3)},
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
			poses: "sit and lie exist in both facings: view 'left' gives the left-facing bodies (LEFT coat-map markings, head threeQuarterLeftScreen; their unmarked outline is the right-facing silhouette mirrored about the root, decision BADGER-D23, PROVISIONAL until the owner accepts it: see provisional.badger), any other view the right-facing panels (right-side markings); walk and lookUp on both side rigs; no marking is ever mirrored",
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
			redrawn: {
				rule: "decision INT-Q2: with these heads on their own side rig, the listed neck markings are drawn twice (the look-up neck's part above the collar is drawn again in front of the torso, BADGER-D51): same path, same place, one marking. Visual QA allows exactly `draws` copies of each listed id there and nowhere else.",
				heads: redrawnByHead,
			},
			head: HEAD_MARKINGS.map((m) => ({id: m.id, side: m.side, part: 'head', views: Object.keys(m.paths).length ? Object.keys(m.paths) : 'ear fill (all head views)'})),
		},
		zoo: {
			pin: ZOO_MANIFEST.conventions.pin,
			pocket: ZOO_MANIFEST.conventions.pocket,
			buttons: ZOO_MANIFEST.conventions.buttons,
		},
	},
	provisional: {
		badger: {
			...BADGER_MANIFEST.provisional,
			source: 'BADGER_PROVISIONAL_POSES (src/characters/badger/provisional.ts, exported by src/characters/badger/index.ts)',
			tools: 'visual QA reports model-provisional for these drawings: an error in Episode, EpisodeShort, ShowEpisode, ShowShort and Thumbnail, a warning elsewhere (decision INT-Q1); BadgerSheet captions them (INT-S1)',
		},
	},
	proof: {
		composition: 'Preview10s (src/compositions/characters/Preview10s.tsx), 1920x1080, 30 fps, 300 frames, silent',
		beats: BEATS,
		note: 'frame numbers at 30 fps; see decisions INT-T1, INT-T2, INT-T3, INT-A2, INT-C1 and docs/CHARACTERS.md',
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
