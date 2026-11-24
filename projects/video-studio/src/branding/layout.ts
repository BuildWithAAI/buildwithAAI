/**
 * Layout constants for every branding asset (pure data: no React, no fonts), shared by the components, the QA run
 * and the unit tests. Units are output px on each asset's canvas; character placements use world units x scale.
 */
import {BADGER_HEAD, placeBox, ZOO_HEAD} from './characterFrames.ts';
import {BOUNDS} from './marks/jellyfishGeometry.ts';
import {AVATAR, bannerSafeRect, END_SCREEN, type Rect} from './spec.ts';

const SAFE = bannerSafeRect();
const MID_Y = SAFE.y + SAFE.h / 2; // 720

// ---------- logo lockups (base sizes at scale 1) ----------
export const ZOORA_LOCKUP = {markHeight: 230, gap: 44, word: 124, wordTracking: -0.01, tag: 40, tagGap: 14, tagLine: 1.18} as const;
export const SHOW_LOGO = {the: 34, main: 92, show: 40, tracking: 0.2, padX: 40, padY: 26, radius: 16, gap: 6} as const;

/** Measured ink metrics of "Zoora AI" (Montserrat 900, tracking -0.01em), per em. Re-checked by qa/run.ts. */
export const WORDMARK_INK = {left: 0.03, width: 4.41, capTop: 0.12, capHeight: 0.71} as const;

// ---------- avatar ----------
const C = AVATAR.width / 2;
/** Framing per subject (px on the 800 canvas), tuned by looking at 160/98/48/36/24 px. */
export const AVATAR_FRAMING = {
	/** strokeBoostPx: the avatar is the mark's small-size cut, one notch bolder so the line keeps >= 1.5 px at 36 px. */
	mark: {height: 560, cy: C + 4, strokeBoostPx: 8},
	badger: {scale: 3.45, headCentre: {x: C, y: C - 22}},
	zoo: {scale: 2.75, headCentre: {x: C + 6, y: C - 40}},
} as const;

// ---------- banners ----------
export const ZOORA_BANNER = {
	lockup: {x: SAFE.x + 50, y: MID_Y, scale: 1.0},
	portal: {cx: 1790, cy: 800, r: 380, ring: 10},
	pair: {scale: 0.6, zooX: 1717, badgerX: 1897, groundY: 1071},
} as const;

/** Badger's sitting body with the front head, relative to his ground point (world units): measured. */
export const BADGER_SIT_HEAD: Rect = {x: -45, y: -434, w: 188, h: 126};

export const SHOW_BANNER = {
	logo: {x: SAFE.x + 30 + 380, y: 668, scale: 1.0},
	tagline: {x: SAFE.x + 30 + 380, y: 838, size: 36, gap: 8},
	scale: 0.8,
	zoo: {x: 1612, groundY: 1271},
	badger: {x: 1838, groundY: 1084},
	deskTop: 897,
	desk: {x: 1330, w: 820},
	monitor: {x: 1700, y: 566, w: 420, h: 306, r: 16},
	floorY: 1330,
	/** Hanging wall slats: they bleed off the top and stop above every head and the logo, so only TV shows them. */
	panels: {y: -40, h: 470, w: 150, gap: 110, count: 9, r: 16},
	emblem: {w: 300, h: 132, r: 16},
} as const;

export const zooraBannerHeads = (): Rect[] => {
	const p = ZOORA_BANNER.pair;
	return [placeBox(ZOO_HEAD, p.zooX, p.groundY, p.scale), placeBox(BADGER_HEAD, p.badgerX, p.groundY, p.scale)];
};

export const showBannerHeads = (): Rect[] => {
	const L = SHOW_BANNER;
	return [placeBox(ZOO_HEAD, L.zoo.x, L.zoo.groundY, L.scale), placeBox(BADGER_SIT_HEAD, L.badger.x, L.badger.groundY, L.scale)];
};

// ---------- end screen (zones identical to src/episode/layout/specs.ts LAYOUTS.endscreen.landscape) ----------
export const END_ZONES = {
	slots: [
		{x: 1088, y: 150, w: 736, h: 414},
		{x: 1088, y: 594, w: 736, h: 414},
	],
	subscribe: {cx: 900, cy: 540, r: 120},
} as const;
export const END_SCREEN_FPS = 30;
export const END_SCREEN_FRAMES = END_SCREEN.maxSec * END_SCREEN_FPS; // 600
export const END_SCREEN_STILL_FRAME = 45;
export const END_LAYOUT = {
	'zoora-ai': {
		lockup: {x: 96, y: 150, scale: 0.56},
		portal: {cx: 400, cy: 640, r: 300},
		pair: {scale: 0.5, zooX: 340, badgerX: 490, groundY: 880},
	},
	'zoora-security': {
		logo: {x: 380, y: 196, scale: 0.78},
		pair: {scale: 0.72, zooX: 300, badgerX: 648, groundY: 990},
	},
} as const;
export const END_LABELS = {watchNext: 'Watch next', subscribe: 'Subscribe'} as const;

// ---------- thumbnail badges ----------
/** Proportions relative to the badge height (88 px on the 1280x720 thumbnail canvas). */
export const BADGE = {height: 88, padX: 0.3, icon: 0.62, gap: 0.2, text: 0.5, radius: 0.18, stripe: 0.09} as const;
export const BADGE_CANVAS = {width: 760, height: BADGE.height} as const;

// ---------- stings (frames at 30 fps) ----------
export const ZOORA_STING_BEATS = {
	bell: [6, 36],
	inner: [20, 40],
	traces: [30, 52],
	nodes: [46, 58],
	hit: 54,
	settle: [56, 72],
	word: [70, 86],
	tag: [78, 94],
	background: [28, 78],
	fadeFrames: 15,
} as const;

/** Final lockup geometry (px): computed from the measured wordmark so the whole lockup is optically centred. */
export const ZOORA_STING_LAYOUT = (() => {
	const markH = 200;
	const markW = (markH * BOUNDS.w) / BOUNDS.h;
	const word = 132;
	const gap = ZOORA_LOCKUP.gap * (markH / ZOORA_LOCKUP.markHeight);
	const inkW = WORDMARK_INK.width * word;
	const total = markW + gap + inkW;
	const left = 960 - total / 2;
	const y = 492;
	return {
		markStart: {cx: 960, cy: 520, h: 420},
		markEnd: {cx: left + markW / 2, cy: y, h: markH},
		word: {size: word, left: left + markW + gap - WORDMARK_INK.left * word, top: y - (WORDMARK_INK.capTop + WORDMARK_INK.capHeight / 2) * word},
		tag: {x: 960, y: y + 170, size: 40},
	};
})();

export const SHOW_STING_BEATS = {
	plate: [4, 18],
	the: [10, 22],
	main: [14, 30],
	show: [22, 34],
	hit1: 30,
	hit2: 58,
	zooDart: [30, 32],
	zooTurn: [30, 38],
	zooBrow: [31, 38],
	badgerDart: [58, 60],
	badgerJudge: [59, 67],
	topic: [34, 48],
} as const;

export const SHOW_STING_LAYOUT = {
	logo: {x: 650, y: 450, scale: 1.18},
	topic: {x: 650, y: 660, size: 40},
	scale: 0.8,
	groundY: 990,
	zooX: 1290,
	badgerX: 1620,
} as const;

/** Visual hits for the composer (frames at 30 fps; seconds = frame / 30). See stings/audio.tsx. */
export const STING_HITS = {
	'zoora-ai': [{frame: ZOORA_STING_BEATS.hit, what: 'nodes pop, teal accent lands (logo hit)'}],
	'zoora-security': [
		{frame: SHOW_STING_BEATS.hit1, what: 'ampersand turns teal, Zoo turns to camera'},
		{frame: SHOW_STING_BEATS.hit2, what: "Badger's judging look (the button)"},
	],
} as const;
