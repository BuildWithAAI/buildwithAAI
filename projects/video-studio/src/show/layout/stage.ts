/**
 * The set, in STAGE UNITS (pure data). Stage units are the characters' world units (1 unit = 1 px at scale 1, Zoo is
 * 900 units tall) with Zoo's ground contact point at (0, 0) and y growing downward, so a shot is just one transform
 * (scale S, offset tx, ty) applied to the whole stage, and Zoo and Badger always share one scale: their relative size
 * is the approved size-comparison panel's (src/characters/relativeScale.ts; manifest "usage": same scale value).
 *
 * Staging (not anatomy): Zoo sits behind the desk. The desk top is at his lower chest (y -545, just above his elbows),
 * so his pin, pocket and collar stay visible and his hands are below the desk, as when seated. Badger sits beside him
 * on his own chair, raised so the desk top meets his chest (his ground point is 340 units above the floor, hidden by
 * the desk); the size panel's spacing (482.9 units) is used as is in landscape and tightened for the narrow vertical
 * frame. Badger's chair back is the darker shape behind his white head (ART_GUIDE CV4a); Zoo's is silver, so his
 * dark clothes keep a light shape behind them (CV4b).
 */
import type {Format} from '../types.ts';
import {SHOW_LOGO} from '../../branding/layout.ts';

export type Rect = {x: number; y: number; w: number; h: number};

export type MicSpec = {x: number; base: number; height: number; tilt: number; size: number};

export type StageSpec = {
	badger: {x: number; y: number};
	deskTop: number; // y of the desk's top surface
	deskSlab: number; // thickness of the slate top
	desk: {x0: number; x1: number};
	zooChair: Rect & {r: number};
	badgerChair: Rect & {r: number};
	zooMic: MicSpec;
	badgerMic: MicSpec;
	onAir: {x: number; y: number; h: number}; // centre x, top y, height (width follows the text)
	logo: {x: number; y: number; scale: number}; // centre of the show logo plate on the desk front
	panels: Array<Rect & {tone: 'light' | 'silver'}>;
	/** Name plates hanging on the desk front under each host (landscape only: in a Short the captions cover them). */
	nameplates: {zoo: Rect; badger: Rect} | null;
	floor: number; // y of the studio floor (bottom of the desk)
};

const DESK_TOP = -545;
/** Badger's ground point: the desk top meets him at his chest (205 units above his paws). */
const BADGER_Y = DESK_TOP + 205;

export const STAGE: Record<Format, StageSpec> = {
	landscape: {
		badger: {x: 483, y: BADGER_Y},
		deskTop: DESK_TOP,
		deskSlab: 34,
		desk: {x0: -1700, x1: 2300},
		zooChair: {x: -175, y: -770, w: 350, h: 260, r: 48},
		badgerChair: {x: 483 - 150, y: -900, w: 300, h: 390, r: 70},
		zooMic: {x: -178, base: DESK_TOP, height: 150, tilt: 22, size: 1},
		badgerMic: {x: 483 + 160, base: DESK_TOP, height: 104, tilt: -20, size: 0.82},
		// above Badger's chair, below the header row: one head width clear of Zoo's face (ART_GUIDE CV4c)
		onAir: {x: 640, y: -1000, h: 66},
		logo: {x: 240, y: -318, scale: 0.62},
		panels: [
			{x: -330, y: -1400, w: 660, h: 900, tone: 'light'},
			{x: -1110, y: -1400, w: 330, h: 900, tone: 'silver'},
			{x: -1780, y: -1400, w: 620, h: 900, tone: 'light'},
			{x: 880, y: -1400, w: 330, h: 900, tone: 'silver'},
			{x: 1260, y: -1400, w: 620, h: 900, tone: 'light'},
			{x: 1930, y: -1400, w: 330, h: 900, tone: 'silver'},
		],
		nameplates: {zoo: {x: -92, y: -496, w: 184, h: 58}, badger: {x: 483 - 122, y: -496, w: 244, h: 58}},
		floor: 0,
	},
	vertical: {
		badger: {x: 380, y: BADGER_Y},
		deskTop: DESK_TOP,
		deskSlab: 34,
		desk: {x0: -1200, x1: 1600},
		zooChair: {x: -175, y: -770, w: 350, h: 260, r: 48},
		badgerChair: {x: 380 - 150, y: -900, w: 300, h: 390, r: 70},
		zooMic: {x: -178, base: DESK_TOP, height: 150, tilt: 22, size: 1},
		badgerMic: {x: 380 + 158, base: DESK_TOP, height: 104, tilt: -20, size: 0.82},
		// between the cold-open kicker card above and the wall logo below, clear of both with the push-in (checks.ts)
		onAir: {x: 190, y: -1338, h: 62},
		// vertical: the desk front sits under the captions and the Shorts UI, so the logo hangs on the wall above them
		logo: {x: 190, y: -1160, scale: 0.86},
		panels: [
			{x: -300, y: -1500, w: 600, h: 1000, tone: 'light'},
			{x: -960, y: -1500, w: 610, h: 1000, tone: 'silver'},
			{x: 640, y: -1500, w: 300, h: 1000, tone: 'silver'},
			{x: 990, y: -1500, w: 600, h: 1000, tone: 'light'},
		],
		nameplates: null,
		floor: 0,
	},
};

/**
 * Head boxes (stage units, at scale 1) relative to each character's ground point, measured on the real rigs by the
 * branding workflow (src/branding/characterFrames.ts: ZOO_HEAD, BADGER_HEAD; front views, neutral). Copied here so
 * the show's pure layout checks run without loading React; a test compares them with the branding values.
 */
export const ZOO_HEAD: Rect = {x: -88, y: -901, w: 158, h: 162};
export const BADGER_HEAD: Rect = {x: -98, y: -447, w: 188, h: 127};
/** Zoo's eyes (front view eye line) and Badger's eyes-and-nose centroid (front view), stage units from the ground. */
export const ZOO_EYES = {x: 0, y: -816.5};
export const BADGER_EYES = {x: 1.3, y: -382.1};

/** The ON AIR sign's plate (stage units), as set/props.tsx draws it: lamp, gap and "ON AIR" at half the plate height. */
/** The show logo plate's rect in stage units (its size follows the branding kit's SHOW_LOGO; the plate is about 600 wide). */
export const logoRect = (format: Format): Rect => {
	const {x, y, scale} = STAGE[format].logo;
	const h = (2 * SHOW_LOGO.padY + SHOW_LOGO.the + SHOW_LOGO.main * 1.02 + SHOW_LOGO.show + 2 * SHOW_LOGO.gap) * scale;
	const w = 700 * scale;
	return {x: x - w / 2, y: y - h / 2, w, h};
};

export const onAirRect = (format: Format): Rect => {
	const {x, y, h} = STAGE[format].onAir;
	const w = h * 0.38 * 2 + h * 0.2 * 2 + h * 0.3 + h * 0.5 * 4.05;
	return {x: x - w / 2, y, w, h};
};

/** Head boxes of both characters in stage units. */
export const stageHeads = (format: Format): {zoo: Rect; badger: Rect} => {
	const st = STAGE[format];
	return {zoo: ZOO_HEAD, badger: {...BADGER_HEAD, x: BADGER_HEAD.x + st.badger.x, y: BADGER_HEAD.y + st.badger.y}};
};
