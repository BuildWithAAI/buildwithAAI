/**
 * Thumbnail layouts (pure data + geometry; shared by the component, the Node tests and scripts/thumbnails.ts).
 * 1280x720 px. Three variants for YouTube Test & Compare that differ in composition, background and text treatment:
 *   v0 "light-right": flat light grey, Zoo's face on the right, plain near-black headline on the left, teal bar under it.
 *   v1 "dark-left":   brand slate, Zoo in a light-grey window on the left, off-white headline on the right, teal bar above.
 *   v2 "plate-tight": flat light grey, tighter crop with a small head tilt, headline in a slate plate that bleeds off
 *                     the left edge with a teal side bar (the show's lower-third language).
 * The storyboard decides each variant's expression, text and Badger, so the three also differ in emotion.
 *
 * Character rules (docs/ART_GUIDE.md):
 *  - CH2: Zoo is the shared rig scaled as a whole (a close-up crop); his head is never enlarged on its own.
 *  - One scale for both characters when Badger is present, so their relative size is exact. Badger's head sits in
 *    front of Zoo's chest: Zoo's slate overshirt (L* 23.7) and black tee are the dark shape behind Badger's off-white
 *    head (CV4a: at least 15 L* darker than the coat), and Zoo's torso is always on light grey (CV4b: L* >= 60).
 *  - YouTube covers the bottom-right corner with the duration stamp: no face or text goes there.
 */
import {BRAND} from '../characters/palette.ts';
import type {Lang} from '../episode/types.ts';
import type {ThumbVariant} from './spec.ts';

export const THUMB = {width: 1280, height: 720} as const;

export type Rect = {x: number; y: number; w: number; h: number};

/**
 * World-unit boxes at scale 1, origin = ground contact point (measured with src/thumbnails/dev/probe, getBBox of the
 * rigs v1.0.0, strokes excluded). Re-run the probe after a rig change.
 */
export const RIG = {
	zooHead: {x0: -85.2, y0: -898.1, x1: 74.1, y1: -710.9}, // hair, ears, face, beard and the top of the neck
	/** Features: brows, eyes, nose and mouth in all four expressions (rig PIVOTS eyes +-23.2 at -816.5, brows -834, mouth -768). */
	zooFace: {x0: -40, y0: -850, x1: 40, y1: -748},
	zooChin: -740, // bottom of the beard (rig FRONT.chin)
	zooEyeLine: -816.5,
	zooHalfWidth: 143, // arms included
	zooShoulder: -672,
	badgerHead: {x0: -94.5, y0: -443.4, x1: 88.3, y1: -315.6}, // front view, ears included
	/** Features: eyes, brows, nose and mouth of the front head (HEAD_GEOM.front, head-local y offset -333.5 from the probe). */
	badgerFace: {x0: -42, y0: -411, x1: 42, y1: -324},
	/** Where Badger's ear tips sit, in Zoo's world y: just under the beard, over the collar. */
	badgerTopInZoo: -722,
} as const;

const zooHeadCx = (RIG.zooHead.x0 + RIG.zooHead.x1) / 2;
const badgerHeadCx = (RIG.badgerHead.x0 + RIG.badgerHead.x1) / 2;

export type ZooPlace = {x: number; y: number; scale: number; lookX: number; lookY: number; headTilt: number};
export type BadgerPlace = {x: number; y: number; scale: number};

/** Place Zoo by the centre x and top y (px) of his head box. */
export const placeZoo = (headCx: number, headTop: number, scale: number, look: {lookX?: number; lookY?: number; headTilt?: number} = {}): ZooPlace => ({
	x: headCx - zooHeadCx * scale,
	y: headTop - RIG.zooHead.y0 * scale,
	scale,
	lookX: look.lookX ?? 0,
	lookY: look.lookY ?? 0,
	headTilt: look.headTilt ?? 0,
});

/** Place Badger (front view) by the centre x of his head box; his ear tips go to RIG.badgerTopInZoo in Zoo's frame. */
export const placeBadger = (zoo: ZooPlace, headCx: number): BadgerPlace => {
	const top = zoo.y + RIG.badgerTopInZoo * zoo.scale;
	return {x: headCx - badgerHeadCx * zoo.scale, y: top - RIG.badgerHead.y0 * zoo.scale, scale: zoo.scale};
};

type WorldBox = {x0: number; y0: number; x1: number; y1: number};
/** Zoo's head turns about this pivot (rig PIVOTS.head) when headTilt is set. */
const ZOO_HEAD_PIVOT = {x: 0, y: -748} as const;

/** A world box placed in frame px; with `tilt` (degrees) its corners turn about `pivot` first (axis-aligned result). */
const toPx = (p: {x: number; y: number; scale: number}, b: WorldBox, tilt = 0, pivot = ZOO_HEAD_PIVOT): Rect => {
	const a = (tilt * Math.PI) / 180;
	const pts = [
		[b.x0, b.y0],
		[b.x1, b.y0],
		[b.x0, b.y1],
		[b.x1, b.y1],
	].map(([x, y]) => {
		const dx = x - pivot.x;
		const dy = y - pivot.y;
		return [p.x + (pivot.x + dx * Math.cos(a) - dy * Math.sin(a)) * p.scale, p.y + (pivot.y + dx * Math.sin(a) + dy * Math.cos(a)) * p.scale];
	});
	const xs = pts.map((q) => q[0]);
	const ys = pts.map((q) => q[1]);
	return {x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys)};
};

/** Head boxes (hair and ears included): text keeps clear of these. */
export const zooHeadBox = (z: ZooPlace): Rect => toPx(z, RIG.zooHead, z.headTilt);
export const badgerHeadBox = (b: BadgerPlace): Rect => toPx(b, RIG.badgerHead);
/** Face boxes (eyes, brows, nose, mouth): these must stay out of YouTube's duration stamp. */
export const zooFaceBox = (z: ZooPlace): Rect => toPx(z, RIG.zooFace, z.headTilt);
export const badgerFaceBox = (b: BadgerPlace): Rect => toPx(b, RIG.badgerFace);

/** Zoo's torso box (arms included) from the shoulder line down to the frame bottom. */
export const zooBodyBox = (z: ZooPlace): Rect => {
	const top = z.y + RIG.zooShoulder * z.scale;
	return {x: z.x - RIG.zooHalfWidth * z.scale, y: top, w: 2 * RIG.zooHalfWidth * z.scale, h: Math.max(0, THUMB.height - top)};
};

/**
 * YouTube's duration stamp, in 1280x720 px: always drawn over the bottom-right corner of a thumbnail. The badge keeps its
 * pixel size while the thumbnail shrinks, so the worst case is the 168x94 "Up next" list: a ~36x18 px badge 4 px from the
 * corner covers about the last 310 x 175 px of the 1280x720 image. No headline and no face features go there. (The
 * desktop hover icons at the top right only show while the pointer is on the thumbnail; not enforced.)
 */
export const YT_STAMP: Rect = {x: THUMB.width - 310, y: THUMB.height - 175, w: 310, h: 175};

/** Text safe area: >= 56 px from the left and right edges, >= 40 px from the top and bottom. */
export const SAFE = {left: 56, right: THUMB.width - 56, top: 40, bottom: THUMB.height - 40} as const;

export type TextStyle = {
	maxSize: number;
	/** Legibility floor: at 168x94 the ink of a line must stay >= ~9 px tall (checked on the render by the script). */
	minSize: number;
	maxLines: number;
	gap: number; // ink gap between lines, multiple of the size
	unspaced: boolean;
};

/**
 * Per-script headline sizes. maxSize keeps one or two short words from swamping the face (cap height <= ~22% of the
 * frame); minSize is the legibility floor (Anton capitals at 96 px are ~11 px tall at 168x94).
 */
export const textStyle = (lang: Lang): TextStyle => {
	if (lang === 'zh' || lang === 'ja') return {maxSize: 180, minSize: 104, maxLines: 3, gap: 0.16, unspaced: true};
	if (lang === 'hi') return {maxSize: 170, minSize: 96, maxLines: 3, gap: 0.1, unspaced: false};
	return {maxSize: 180, minSize: 96, maxLines: 3, gap: 0.14, unspaced: false};
};

export type Panel = {x: number; y: number; w: number; h: number; r: number; color: string; clip?: boolean};

export type Accent =
	| {kind: 'under'; w: number; h: number; gap: number} // a bar under the last line, aligned like the text
	| {kind: 'over'; w: number; h: number; gap: number} // a bar above the first line
	| {kind: 'side'; w: number; gap: number}; // a vertical bar left of the text, as tall as the ink block

export type Plate = {color: string; padX: number; padY: number; bleedLeft: boolean; r: number};

export type ThumbLayout = {
	name: 'light-right' | 'dark-left' | 'plate-tight';
	bg: string;
	/** Flat shapes drawn behind the characters; a panel with clip=true also clips the characters (a window). */
	panels: Panel[];
	zoo: ZooPlace;
	badger: BadgerPlace | null;
	/** Text box for the fit; the fitted ink block is aligned inside it. */
	text: {box: Rect; align: 'left' | 'right'; valign: 'center'; color: string; behind: string};
	plate: Plate | null;
	accent: Accent;
};

const TEXT_GAP = 72; // min px between the text box and a head box (hair and ears included)
/**
 * Badger's head sits a little to screen right of Zoo's: his pale (anatomical right) ear then lies over Zoo's overshirt
 * instead of the light background (CV4a), and his dark-capped ear, which reads on any background, takes the outside.
 */
const BADGER_OFFSET = 44;

/**
 * The layout of one variant. `badger` switches to the two-character framing (one shared scale, Badger's head in front
 * of Zoo's chest).
 */
export const layoutFor = (variant: ThumbVariant, badger: boolean): ThumbLayout => {
	if (variant === 0) {
		// with Badger the pair moves left so his features stay clear of the duration stamp
		const zoo = badger ? placeZoo(820, 26, 2.2, {lookX: -0.3}) : placeZoo(905, 44, 2.5, {lookX: -0.3});
		const b = badger ? placeBadger(zoo, 820 + BADGER_OFFSET) : null;
		const right = Math.min(zooHeadBox(zoo).x, b ? badgerHeadBox(b).x : Infinity) - TEXT_GAP;
		return {
			name: 'light-right',
			bg: BRAND.background,
			panels: [],
			zoo,
			badger: b,
			text: {box: {x: SAFE.left + 8, y: 72, w: right - (SAFE.left + 8), h: 470}, align: 'left', valign: 'center', color: BRAND.nearBlack, behind: BRAND.background},
			plate: null,
			accent: {kind: 'under', w: 132, h: 16, gap: 0.2},
		};
	}
	if (variant === 1) {
		// the window bleeds off the bottom edge, so no edge crosses a face
		const win: Panel = {x: 40, y: 40, w: 600, h: THUMB.height, r: 16, color: BRAND.background, clip: true};
		const cx = win.x + win.w / 2;
		const zoo = badger ? placeZoo(cx, 50, 2.15, {lookX: 0.3}) : placeZoo(cx, 70, 2.4, {lookX: 0.3});
		const b = badger ? placeBadger(zoo, cx + BADGER_OFFSET) : null;
		const left = win.x + win.w + TEXT_GAP;
		return {
			name: 'dark-left',
			bg: BRAND.slate,
			panels: [win],
			zoo,
			badger: b,
			text: {box: {x: left, y: 80, w: SAFE.right - left, h: 455}, align: 'left', valign: 'center', color: BRAND.offWhite, behind: BRAND.slate},
			plate: null,
			accent: {kind: 'over', w: 132, h: 16, gap: 0.24},
		};
	}
	// solo: scale 3.1 keeps the whole jellyfish pin below the frame instead of cutting it at the edge
	const zoo = badger ? placeZoo(825, 26, 2.2, {headTilt: -3}) : placeZoo(900, 24, 3.1, {headTilt: -3});
	const b = badger ? placeBadger(zoo, 825 + BADGER_OFFSET) : null;
	const plate: Plate = {color: BRAND.slate, padX: 44, padY: 40, bleedLeft: true, r: 16};
	const sideBar = 14 + 30; // teal bar + gap, inside the plate
	const right = Math.min(zooHeadBox(zoo).x, b ? badgerHeadBox(b).x : Infinity) - TEXT_GAP - plate.padX;
	const x = SAFE.left + sideBar;
	return {
		name: 'plate-tight',
		bg: BRAND.background,
		panels: [],
		zoo,
		badger: b,
		text: {box: {x, y: 100, w: right - x, h: 440}, align: 'left', valign: 'center', color: BRAND.offWhite, behind: BRAND.slate},
		plate,
		accent: {kind: 'side', w: 14, gap: 30},
	};
};

/** Rect helpers for the layout checks. */
export const intersects = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
export const inflate = (r: Rect, d: number): Rect => ({x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d});
