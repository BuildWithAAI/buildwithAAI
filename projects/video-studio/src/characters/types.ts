/**
 * Shared character API contract, v1. All characters use the same WORLD UNITS:
 * at scale 1, 1 unit = 1 px. ZOO is exactly 900 units tall (sole to top of hair) in the front view.
 * BADGER's dimensions use the same units, derived from the size-comparison panel, so the
 * relative scale is fixed. Each component's local origin (0,0) is its ground contact point
 * (the centre of the footprint); y grows downward as in SVG, so the body sits at negative y.
 * "Left"/"right" in prop names are ANATOMICAL unless suffixed with "Screen".
 */
export type Expression = 'neutral' | 'happy' | 'worried' | 'shocked';
export type MouthShape = 'closed' | 'slightlyOpen' | 'ah' | 'ee' | 'oh' | 'mbp';

export type Placement = {
	x?: number; // screen position of the ground contact point
	y?: number;
	scale?: number; // 1 = canonical size (ZOO 900 px tall)
};

export type ZooView = 'front' | 'threeQuarter' | 'side' | 'back';
export type ZooPose = 'stand' | 'point' | 'typing';

export type ZooProps = Placement & {
	view?: ZooView;
	pose?: ZooPose;
	/** 0..1 blend from the rest arm position into the pose (lets gestures animate smoothly). */
	poseAmount?: number;
	expression?: Expression;
	/** Explicit mouth shape. If omitted, the expression's default mouth is used. */
	mouth?: MouthShape;
	blink?: number; // 0 open .. 1 closed
	browLift?: number; // 0..1, a small deadpan brow raise
	lookX?: number; // -1 (screen left) .. 1 (screen right)
	lookY?: number; // -1 up .. 1 down
	headTilt?: number; // degrees, small (-8..8)
	breathe?: boolean; // subtle idle breathing driven by the frame (default true)
};

export type BadgerView = 'left' | 'right' | 'front' | 'back' | 'threeQuarter';
export type BadgerPose = 'stand' | 'sit' | 'lie' | 'walk' | 'lookUp';
export type BadgerHead = 'front' | 'threeQuarterLeftScreen' | 'threeQuarterRightScreen' | 'profileLeftScreen' | 'profileRightScreen' | 'upLeftScreen' | 'upRightScreen';

export type BadgerProps = Placement & {
	view?: BadgerView;
	pose?: BadgerPose;
	/** Head replacement view, independent of the body view (limited-animation head turns). */
	head?: BadgerHead;
	headTilt?: number; // degrees, small
	expression?: Expression;
	blink?: number; // 0 open .. 1 closed
	earsBack?: number; // 0 natural outward fold .. 1 folded back (worried)
	judge?: number; // 0..1 subtle brow line for the quietly judging look
	tailWag?: number; // phase in turns; 0 = still
	walkPhase?: number; // 0..1 gait cycle when pose = 'walk'
	breathe?: boolean;
};
