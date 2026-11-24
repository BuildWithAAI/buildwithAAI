/**
 * Spot illustrations for the product PDFs (The Crypto Security Checklist), drawn by the approved character rigs in
 * src/characters (never redrawn here). Pure data: the Remotion entry (./Root.tsx) renders an entry, and the Node
 * build (../lib/spots.ts) lists the ids. Each spot is exported as a standalone vector SVG, so the PDF stays sharp at
 * any zoom and in print.
 *
 * Units: world units of the rigs (Zoo is 900 units tall at scale 1; Badger shares the units, so a pair keeps the
 * approved relative size). x is each character's ground point relative to the spot origin; the ground is y = 0.
 *
 * Line weight: every spot asks for the same printed outline weight (OUTLINE_PT), whatever its size. The composition
 * measures the art, works out points per world unit from `heightPt`, and sets the rigs' lineScale so one line
 * system runs through the whole document (ART_GUIDE SL4/SL5, adapted from output pixels to print points).
 */
import type {BadgerHead, BadgerPose, BadgerView, Expression, MouthShape, ZooPose, ZooView} from '../../../src/characters/types.ts';

/** Printed outline weight of every character silhouette, in points (1 pt = 1/72 in). */
export const OUTLINE_PT = 1.05;

/** The rigs' silhouette width at lineScale 1, in world units (src/characters/palette.ts LINE.width). */
export const RIG_OUTLINE_UNITS = 3.5;

/** Margin added around the measured art (world units at the spot's scale), so outlines are never clipped. */
export const ART_MARGIN_UNITS = 10;

export type ZooSpotProps = {
	view?: ZooView;
	pose?: ZooPose;
	expression?: Expression;
	mouth?: MouthShape;
	browLift?: number;
	lookX?: number;
	lookY?: number;
	headTilt?: number;
	blink?: number;
};

export type BadgerSpotProps = {
	view?: BadgerView;
	pose?: BadgerPose;
	head?: BadgerHead;
	expression?: Expression;
	judge?: number;
	earsBack?: number;
	headTilt?: number;
	lookX?: number;
	lookY?: number;
	tailWag?: number;
};

export type SpotCharacter = {kind: 'zoo'; x: number; props: ZooSpotProps} | {kind: 'badger'; x: number; props: BadgerSpotProps};

/**
 * Optional porthole frame: a flat rounded panel in the brand background colour that clips the art (a bust or a
 * three-quarter crop), with a near-black outline drawn last (ART_GUIDE SL4, LS3).
 */
export type SpotFrame = {
	/** Visible window in world units (relative to the spot origin; the ground is y = 0, up is negative). */
	x: number;
	y: number;
	w: number;
	h: number;
	/** Corner radius in world units. */
	radius: number;
};

export type SpotDef = {
	id: string;
	/** Alt text for the PDF (describes the picture, not the chapter). */
	alt: string;
	/** Printed height of the finished art (frame, or measured art plus margin), in points. */
	heightPt: number;
	characters: SpotCharacter[];
	frame?: SpotFrame;
	/** Draw a flat contact shadow under each standing character (ART_GUIDE LS4); default true without a frame. */
	contactShadows?: boolean;
};

/** Badger's footprint centre to the right of Zoo's ground point in the approved size comparison (world units). */
export const PAIR_SPACING = 483;

/**
 * A round head-and-shoulders crop of Zoo standing at x = 0 (world units). At a chapter spot's printed size a
 * full-length Zoo has a face about 15 pt tall, so his expressions all read alike; in this crop the face is about
 * 45 pt tall and the expression carries the picture. The head keeps its approved size: this is a crop, never an
 * enlarged head (ART_GUIDE CH2).
 */
export const ZOO_BUST: SpotFrame = {x: -185, y: -925, w: 370, h: 370, radius: 185};

export const SPOTS: readonly SpotDef[] = [
	{
		id: 'cover-pair',
		alt: 'Zoo, a bearded man in a slate overshirt, stands beside his spotted dog Badger, who sits and looks at the reader.',
		heightPt: 300,
		characters: [
			{kind: 'zoo', x: 0, props: {view: 'front', expression: 'neutral', browLift: 0.35}},
			{kind: 'badger', x: 420, props: {view: 'right', pose: 'sit', expression: 'neutral', judge: 0.5}},
		],
	},
	{
		id: 'free-pair',
		alt: 'Zoo stands with a deadpan look while Badger sits beside him.',
		heightPt: 150,
		characters: [
			{kind: 'zoo', x: 0, props: {view: 'threeQuarter', expression: 'neutral', browLift: 0.3}},
			{kind: 'badger', x: 400, props: {view: 'right', pose: 'sit', expression: 'neutral', judge: 0.6}},
		],
	},
	{
		id: 'quick-start',
		alt: 'Zoo stands ready while Badger sits beside him and looks up at him.',
		heightPt: 150,
		characters: [
			{kind: 'zoo', x: 0, props: {view: 'threeQuarter', expression: 'neutral', browLift: 0.3, lookX: 0.4, lookY: 0.6}},
			{kind: 'badger', x: 390, props: {view: 'left', pose: 'sit', head: 'upLeftScreen', expression: 'neutral'}},
		],
	},
	{
		id: 'seed-phrases',
		alt: 'Badger lies down, calm and watchful, like a guard dog on duty.',
		heightPt: 84,
		characters: [{kind: 'badger', x: 0, props: {view: 'right', pose: 'lie', expression: 'neutral', judge: 0.4}}],
	},
	{
		id: 'hardware-wallets',
		alt: 'Zoo sits at his desk, typing.',
		heightPt: 128,
		characters: [{kind: 'zoo', x: 0, props: {pose: 'typing', expression: 'neutral'}}],
	},
	{
		id: 'approvals',
		alt: 'Zoo, in a round close-up, gives the page a deadpan side-eye with one brow raised: unimpressed.',
		heightPt: 104,
		characters: [{kind: 'zoo', x: 0, props: {view: 'threeQuarter', expression: 'neutral', browLift: 0.9, lookX: -0.85}}],
		frame: ZOO_BUST,
	},
	{
		id: 'phishing',
		alt: 'Badger stands facing the reader with a quietly judging look.',
		heightPt: 128,
		characters: [{kind: 'badger', x: 0, props: {view: 'front', pose: 'stand', expression: 'neutral', judge: 1}}],
	},
	{
		id: 'address-poisoning',
		alt: 'Zoo, in a round close-up, looks worried.',
		heightPt: 104,
		characters: [{kind: 'zoo', x: 0, props: {view: 'front', expression: 'worried'}}],
		frame: ZOO_BUST,
	},
	{
		id: 'fake-jobs',
		alt: 'Zoo, in a round close-up, looks shocked.',
		heightPt: 104,
		characters: [{kind: 'zoo', x: 0, props: {view: 'front', expression: 'shocked'}}],
		frame: ZOO_BUST,
	},
	{
		id: 'sim-2fa',
		alt: 'Zoo points to the side.',
		heightPt: 138,
		characters: [{kind: 'zoo', x: 0, props: {view: 'front', pose: 'point', expression: 'neutral', browLift: 0.4}}],
	},
	{
		id: 'exchanges',
		alt: 'Zoo, in a round close-up, gives a small satisfied smirk.',
		heightPt: 104,
		characters: [{kind: 'zoo', x: 0, props: {view: 'front', expression: 'happy', browLift: 0.25}}],
		frame: ZOO_BUST,
	},
	{
		id: 'social-engineering',
		alt: 'Badger stands side-on with his ears folded back, worried.',
		heightPt: 100,
		characters: [{kind: 'badger', x: 0, props: {view: 'left', pose: 'stand', expression: 'worried'}}],
	},
	{
		id: 'ai-threats',
		alt: 'Badger looks up, alert.',
		heightPt: 106,
		characters: [{kind: 'badger', x: 0, props: {view: 'right', pose: 'lookUp', expression: 'neutral'}}],
	},
	{
		id: 'incident-response',
		alt: 'Zoo points the way while Badger stands ready beside him.',
		heightPt: 138,
		characters: [
			{kind: 'zoo', x: 0, props: {view: 'front', pose: 'point', expression: 'neutral'}},
			{kind: 'badger', x: 560, props: {view: 'right', pose: 'stand', expression: 'neutral'}},
		],
	},
	{
		id: 'record-keeping',
		alt: 'Badger sits upright and looks at the reader.',
		heightPt: 104,
		characters: [{kind: 'badger', x: 0, props: {view: 'left', pose: 'sit', expression: 'happy'}}],
	},
	{
		id: 'about-pair',
		alt: 'Zoo and Badger, the hosts of The Zoo & Badger Show.',
		heightPt: 120,
		characters: [
			{kind: 'zoo', x: 0, props: {view: 'front', expression: 'happy'}},
			{kind: 'badger', x: PAIR_SPACING, props: {view: 'left', pose: 'stand', expression: 'happy'}},
		],
	},
];

export const spotById = (id: string): SpotDef | undefined => SPOTS.find((s) => s.id === id);

/** Points per world unit for a spot whose finished art is `artHeightUnits` tall. */
export const ptPerUnit = (spot: Pick<SpotDef, 'heightPt'>, artHeightUnits: number): number => spot.heightPt / Math.max(1, artHeightUnits);

/** The rigs' lineScale that gives OUTLINE_PT at a given points-per-unit. */
export const lineScaleForPrint = (pointsPerUnit: number): number => OUTLINE_PT / (RIG_OUTLINE_UNITS * Math.max(1e-6, pointsPerUnit));

/** Checks a catalog: unique slug ids, positive sizes, at least one character, frames with positive extent. */
export const validateCatalog = (spots: readonly SpotDef[]): string[] => {
	const errors: string[] = [];
	const seen = new Set<string>();
	for (const s of spots) {
		if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s.id)) errors.push(`${s.id}: id must be a lowercase slug`);
		if (seen.has(s.id)) errors.push(`${s.id}: duplicate id`);
		seen.add(s.id);
		if (!(s.heightPt > 0)) errors.push(`${s.id}: heightPt must be positive`);
		if (!s.characters.length) errors.push(`${s.id}: no characters`);
		if (!s.alt.trim()) errors.push(`${s.id}: alt text is empty`);
		if (/\bZOO\b/.test(s.alt)) errors.push(`${s.id}: write "Zoo", never "ZOO"`);
		if (s.frame && !(s.frame.w > 0 && s.frame.h > 0 && s.frame.radius >= 0)) errors.push(`${s.id}: frame needs a positive size`);
	}
	return errors;
};
