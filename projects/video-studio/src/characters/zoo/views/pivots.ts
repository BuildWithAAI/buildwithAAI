/**
 * Rig pivots for the extra views and the typing pose. Coordinates are world units in each view's
 * root space at rest (origin = ground contact point = centre of the footprint; y down). Every part is
 * authored in its view's root space, so a part's own space equals the view's root space at rest and
 * these pivots are valid in both. Names ending in L / R are ANATOMICAL.
 */
import {HEAD34_PIVOT} from './threeQuarter/Head34';
import {PIN34, WRIST34} from './threeQuarter/Body34';
import {TQ_EYES, TQ_MID_X} from './threeQuarter/tq';
import {EYE_C, HEAD_SIDE_PIVOT, SIDE_MOUTH} from './side/HeadSide';
import {SHOULDER_SIDE, WRIST_SIDE} from './side/BodySide';
import {BACK_BODY} from './Back';
import {TYPING_LAYOUT} from './Typing';
import {TQ_BODY} from './ThreeQuarter';
import {SIDE_BODY} from './Side';

export type ViewPivot = {x: number; y: number; parent: string | null; controls: string};
type Table = Record<string, ViewPivot>;

const P = (x: number, y: number, parent: string | null, controls: string): ViewPivot => ({x, y, parent, controls});

export const PIVOTS_34: Table = {
	root: P(0, 0, null, 'x, y, scale; origin = centre of the footprint (crop x=154 of zoo_turn_34.png)'),
	legs: P(-30, -420, 'root', 'static (near leg = anatomical right in front of the far leg)'),
	torso: P(-10, TQ_BODY.hem, 'root', 'breathe: scaleY about the hem'),
	pin: P(PIN34.x, PIN34.y, 'torso', 'rides on torso; anatomical LEFT chest = far panel (screen right)'),
	neck: P(-6, -712, 'torso', 'breathe (translate)'),
	head: P(HEAD34_PIVOT.x, HEAD34_PIVOT.y, 'neck', 'headTilt (deg)'),
	jaw: P(TQ_MID_X, -768.3, 'head', 'mouth anchor; mouth library mapped by tqX (views/threeQuarter/tq.ts)'),
	eyeR: P(TQ_EYES.near.x, TQ_EYES.near.y, 'head', 'near eye: blink, lookX/lookY, expression'),
	eyeL: P(TQ_EYES.far.x, TQ_EYES.far.y, 'head', 'far eye (x0.55 width): blink, lookX/lookY, expression'),
	browR: P(8, -830, 'head', 'near brow: expression, browLift'),
	browL: P(46, -831, 'head', 'far brow: expression, browLift (raised at rest, ZOO-F3)'),
	shoulderR: P(-110, TQ_BODY.shoulder, 'torso', 'near arm; static hang in v1'),
	elbowR: P(-133, -540, 'shoulderR', 'static in v1'),
	wristR: P(WRIST34.near.x, WRIST34.near.y, 'elbowR', 'near hand hangs here'),
	shoulderL: P(82, -688, 'torso', 'far arm (behind the torso); static hang in v1'),
	elbowL: P(98, -540, 'shoulderL', 'static in v1'),
	wristL: P(WRIST34.far.x, WRIST34.far.y, 'elbowL', 'far hand hangs here'),
};

export const PIVOTS_SIDE: Table = {
	root: P(0, 0, null, 'x, y, scale; origin = centre of the footprint (crop x=150 of zoo_turn_side.png)'),
	legs: P(-10, -420, 'root', 'static; far leg hidden behind the near leg'),
	torso: P(-10, SIDE_BODY.hem, 'root', 'breathe: scaleY about the hem'),
	neck: P(-5, -716, 'torso', 'breathe (translate)'),
	head: P(HEAD_SIDE_PIVOT.x, HEAD_SIDE_PIVOT.y, 'neck', 'headTilt (deg)'),
	jaw: P(SIDE_MOUTH.x, SIDE_MOUTH.y, 'head', 'lip contact point; the profile mouth notch opens from here'),
	eyeR: P(EYE_C.x, EYE_C.y, 'head', 'the visible (anatomical right) eye: blink, lookX/lookY, expression (7 u of nasal bridge in front, ZOO-V7)'),
	browR: P(47, -829, 'head', 'expression, browLift'),
	shoulderR: P(SHOULDER_SIDE.x, SHOULDER_SIDE.y, 'torso', 'near arm; static hang in v1'),
	wristR: P(WRIST_SIDE.x, WRIST_SIDE.y, 'shoulderR', 'near hand (drawn for the profile)'),
};

export const PIVOTS_BACK: Table = {
	root: P(0, 0, null, 'x, y, scale; origin = centre of the footprint (crop x=154.5 of zoo_turn_back.png)'),
	legs: P(3, -420, 'root', 'static; pair mirrored about x=3 inside this view'),
	torso: P(2, BACK_BODY.hem, 'root', 'breathe: scaleY about the hem'),
	neck: P(4, -730, 'torso', 'breathe (translate)'),
	head: P(BACK_BODY.headPivot.x, BACK_BODY.headPivot.y, 'neck', 'headTilt (deg); no face controls are visible from behind'),
	shoulderL: P(-108, -686, 'torso', 'anatomical LEFT = screen left from behind; static hang'),
	wristL: P(-110, -410.4, 'shoulderL', 'cuff bottom centre (repair round 2: forearms hang ~7 u further in, as on zoo_turn_back.png)'),
	shoulderR: P(112, -686, 'torso', 'anatomical RIGHT = screen right; pair mirrored about x=2 inside this view'),
	wristR: P(114, -410.4, 'shoulderR', ''),
};

const U = TYPING_LAYOUT.upper;
export const PIVOTS_TYPING: Table = {
	root: P(0, 0, null, 'x, y, scale; origin = centre of the footprint (the feet stay where the standing 3/4 feet are)'),
	upperBody: P(U.dx, U.dy, 'root', '3/4 head, neck, collar and torso translated by this offset'),
	torso: P(-160, -250, 'root', `3/4 torso scaled ${TYPING_LAYOUT.seatedTorso} vertically about its shoulder line (3/4 y=${TYPING_LAYOUT.shoulderY34})`),
	head: P(HEAD34_PIVOT.x + U.dx, HEAD34_PIVOT.y + U.dy, 'upperBody', 'headTilt (deg)'),
	hip: P(-200, -268, 'root', 'static seated legs'),
	kneeR: P(25, -250, 'hip', 'near (anatomical right) knee; shin slants back to the near shoe'),
	kneeL: P(55, -270, 'hip', 'far knee; shin vertical'),
	shoulderR: P(-258, -515, 'torso', 'near arm (upper arm + forearm drawn as one sleeve)'),
	elbowR: P(-250, -380, 'shoulderR', ''),
	wristR: P(TYPING_LAYOUT.wristR.x, TYPING_LAYOUT.wristR.y, 'elbowR', 'near typing hand'),
	wristL: P(TYPING_LAYOUT.wristL.x, TYPING_LAYOUT.wristL.y, 'torso', 'far typing hand; far forearm emerges from behind the torso'),
	fingers: P(38, -9, 'wrist', 'finger knuckles at wrist-local x 38..43 (see KNUCKLES in views/Typing.tsx); typing=true rotates each about its knuckle'),
	chair: P(TYPING_LAYOUT.chair.x, TYPING_LAYOUT.chair.y, 'root', '<Chair/> origin'),
	desk: P(TYPING_LAYOUT.desk.x, TYPING_LAYOUT.desk.y, 'root', '<Desk/> origin'),
	keyboard: P(TYPING_LAYOUT.keyboard.x, TYPING_LAYOUT.keyboard.y, 'root', '<Keyboard/> origin (on the desk top)'),
	monitor: P(TYPING_LAYOUT.monitor.x, TYPING_LAYOUT.monitor.y, 'root', '<Monitor/> origin (on the desk top)'),
};
