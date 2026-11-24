/**
 * Layout specs for every scene template in both formats (pure data, shared by the components and the Node fit test).
 * Units: output px. Landscape 1920x1080 keeps faces, hands, ears and text >= 96 px from the sides and >= 54 px from the
 * top and bottom (ART_GUIDE MO18). Vertical 1080x1920 is re-composed, never cropped: text and faces stay out of the top
 * 10% and bottom 20% (Shorts UI), >= 54 px from the sides, and clear of the caption band.
 * Character placements use ONE scale and ONE ground line per shot, so ZOO and Badger keep their relative size.
 */
import type {BadgerHead, BadgerPose, BadgerView, ZooView} from '../../characters/types';
import type {FontRole} from '../i18n/fonts';

export type Format = 'landscape' | 'vertical';
export const FRAME: Record<Format, {width: number; height: number}> = {
	landscape: {width: 1920, height: 1080},
	vertical: {width: 1080, height: 1920},
};

export type Box = {x: number; y: number; w: number; h: number};

export type TextSpec = {
	box: Box;
	role: FontRole;
	weight: number;
	maxSize: number;
	minSize: number; // the floor; never below 24 px (ART_GUIDE SL10)
	maxLines: number; // preferred lines while shrinking
	lineHeight: number;
	align: 'left' | 'center' | 'right';
	valign?: 'top' | 'center' | 'bottom';
	uppercase?: boolean;
	balance?: boolean;
	ellipsis?: boolean; // shorten with an ellipsis instead of failing (sources lines only)
};

const t = (box: Box, role: FontRole, weight: number, maxSize: number, minSize: number, maxLines: number, lineHeight: number, align: TextSpec['align'], extra: Partial<TextSpec> = {}): TextSpec => ({
	box,
	role,
	weight,
	maxSize,
	minSize,
	maxLines,
	lineHeight,
	align,
	...extra,
});

/** Safe areas. Vertical: the Shorts UI covers the top ~10% and the bottom ~20%, plus a button column on the right. */
export const SAFE: Record<Format, {left: number; right: number; top: number; bottom: number}> = {
	landscape: {left: 96, right: 1824, top: 54, bottom: 1026},
	vertical: {left: 54, right: 1026, top: 192, bottom: 1536},
};

/** Burned-in captions: one or two short lines on a plate, away from every face (checked by the layout test). */
export const CAPTIONS: Record<Format, TextSpec> = {
	landscape: t({x: 360, y: 900, w: 1200, h: 126}, 'heading', 900, 54, 40, 1, 1.15, 'center', {valign: 'bottom'}),
	// right edge 920: clear of the Shorts button column (x > ~950 in the lower half)
	vertical: t({x: 160, y: 1312, w: 760, h: 188}, 'heading', 900, 66, 46, 2, 1.12, 'center', {valign: 'center'}),
};
/** Plate padding around caption text. */
export const CAPTION_PAD = {x: 28, y: 14} as const;

export type ZooPlace = {x: number; y: number; scale: number; view?: ZooView};
export type BadgerPlace = {x: number; y: number; scale: number; view: BadgerView; pose?: BadgerPose; head?: BadgerHead; inFront?: boolean};

/** ZOO medium shot, landscape: scale 1.5 (outline 5.25 px), head top at y 130, frame bottom at mid-thigh. */
const ZOO_MED_Y = 1480;
const ZOO_MED_S = 1.5;

/** Vertical extent of a content block. Landscape blocks are centred in it; vertical (Shorts) blocks start at `top`. */
export type Column = {top: number; bottom: number};

/** For dynamic blocks, a TextSpec's box gives x, width and the MAXIMUM height; y is computed by the template. */
export type HookLayout = {zoo: ZooPlace; badger: BadgerPlace; column: Column; kicker: TextSpec; title: TextSpec; subtitle: TextSpec | null; sources: TextSpec};
export type TalkLayout = {
	zoo: ZooPlace;
	badger: BadgerPlace;
	column: Column;
	title: TextSpec;
	list: {x: number; w: number};
	item: TextSpec;
	itemPad: {x: number; y: number};
	marker: number;
	gap: number;
	sources: TextSpec;
};
export type ChartLayout = {
	chart: Box;
	solo: {zoo: ZooPlace};
	pair: {zoo: ZooPlace; badger: BadgerPlace} | null; // null: Badger reacts in an insert shot instead
	chip: TextSpec; // illustrative label outside the chart panel (right-aligned)
	sources: TextSpec;
};
export type StepsLayout = {zoo: ZooPlace; badger: BadgerPlace; column: Column; title: TextSpec; list: {x: number; w: number}; item: TextSpec; badge: number; gap: number; sources: TextSpec};
export type QuoteLayout = {
	zoo: ZooPlace;
	badger: BadgerPlace;
	column: Column;
	card: {x: number; w: number};
	pad: number;
	markSize: number;
	quote: TextSpec;
	attribution: TextSpec;
	source: TextSpec;
};
export type CtaLayout = {
	zoo: ZooPlace;
	badger: BadgerPlace;
	column: Column;
	card: {x: number; w: number} | null;
	pad: number;
	title: TextSpec;
	button: {w: number; h: number};
	buttonLabel: TextSpec;
	disclosure: TextSpec;
	sources: TextSpec;
};
export type EndLayout = {
	zoo: ZooPlace;
	badger: BadgerPlace;
	outro: TextSpec;
	slots: Box[]; // empty 16:9 safe zones for YouTube end-screen video/playlist elements
	subscribe: {cx: number; cy: number; r: number} | null; // empty circle zone for the subscribe element
	slotLabel: TextSpec | null;
	subscribeLabel: TextSpec | null;
};

/** Badger insert shot: the reaction cut, Badger alone at the largest scale whose outline stays <= 6 px (1.7). */
export const BADGER_INSERT: Record<Format, BadgerPlace> = {
	landscape: {x: 1150, y: 1450, scale: 1.7, view: 'left', head: 'front'},
	vertical: {x: 640, y: 1690, scale: 1.7, view: 'left', head: 'front'},
};

/** The small sources line: one line, ellipsized if a long title does not fit (the full source is in the description). */
const src = (box: Box, align: TextSpec['align']): TextSpec => t(box, 'body', 600, 26, 24, 1, 1.0, align, {valign: 'center', ellipsis: true});
const SRC_V = src({x: 426, y: 1242, w: 600, h: 40}, 'right'); // above the caption band, right of any face

export const LAYOUTS = {
	hook: {
		landscape: {
			zoo: {x: 1250, y: ZOO_MED_Y, scale: ZOO_MED_S},
			badger: {x: 1880, y: ZOO_MED_Y, scale: ZOO_MED_S, view: 'left', head: 'front', inFront: true},
			column: {top: 120, bottom: 960},
			kicker: t({x: 96, y: 0, w: 760, h: 64}, 'heading', 800, 38, 28, 1, 1.0, 'left'),
			title: t({x: 96, y: 0, w: 860, h: 560}, 'display', 400, 150, 72, 3, 1.02, 'left', {uppercase: true, balance: true, valign: 'top'}),
			subtitle: t({x: 96, y: 0, w: 800, h: 150}, 'body', 600, 44, 30, 2, 1.3, 'left', {balance: true}),
			sources: src({x: 96, y: 978, w: 900, h: 40}, 'left'),
		},
		vertical: {
			zoo: {x: 540, y: 2160, scale: 1.4},
			badger: BADGER_INSERT.vertical,
			column: {top: 290, bottom: 790},
			kicker: t({x: 54, y: 0, w: 972, h: 60}, 'heading', 800, 36, 26, 1, 1.0, 'center'),
			title: t({x: 54, y: 0, w: 972, h: 400}, 'display', 400, 150, 70, 3, 1.02, 'center', {uppercase: true, balance: true, valign: 'top'}),
			subtitle: null,
			sources: SRC_V,
		},
	} satisfies Record<Format, HookLayout>,
	talk: {
		landscape: {
			zoo: {x: 440, y: ZOO_MED_Y, scale: ZOO_MED_S},
			badger: {x: 1080, y: ZOO_MED_Y, scale: ZOO_MED_S, view: 'left', head: 'front', inFront: true},
			column: {top: 110, bottom: 990},
			title: t({x: 1010, y: 0, w: 814, h: 140}, 'heading', 900, 62, 40, 2, 1.1, 'left', {balance: true}),
			list: {x: 1010, w: 814},
			item: t({x: 0, y: 0, w: 814 - 2 * 28 - 40, h: 160}, 'heading', 800, 50, 32, 2, 1.18, 'left', {balance: true}),
			itemPad: {x: 28, y: 24},
			marker: 40,
			gap: 22,
			sources: src({x: 96, y: 60, w: 860, h: 40}, 'left'),
		},
		vertical: {
			zoo: {x: 540, y: 2160, scale: 1.3},
			badger: BADGER_INSERT.vertical,
			column: {top: 290, bottom: 860},
			title: t({x: 54, y: 0, w: 972, h: 130}, 'heading', 900, 56, 36, 2, 1.1, 'center', {balance: true}),
			list: {x: 54, w: 972},
			item: t({x: 0, y: 0, w: 972 - 2 * 24 - 36, h: 110}, 'heading', 800, 44, 30, 2, 1.16, 'left', {balance: true}),
			itemPad: {x: 24, y: 16},
			marker: 36,
			gap: 14,
			sources: SRC_V,
		},
	} satisfies Record<Format, TalkLayout>,
	chart: {
		landscape: {
			chart: {x: 880, y: 96, w: 944, h: 840},
			solo: {zoo: {x: 420, y: ZOO_MED_Y, scale: ZOO_MED_S, view: 'threeQuarter'}},
			pair: {zoo: {x: 250, y: 1000, scale: 0.84, view: 'threeQuarter'}, badger: {x: 610, y: 1000, scale: 0.84, view: 'right', pose: 'sit', inFront: true}},
			chip: t({x: 880, y: 956, w: 944, h: 56}, 'body', 700, 30, 24, 1, 1.0, 'right'),
			sources: src({x: 880, y: 964, w: 520, h: 40}, 'left'),
		},
		vertical: {
			chart: {x: 54, y: 290, w: 972, h: 740},
			solo: {zoo: {x: 330, y: 2060, scale: 1.1, view: 'threeQuarter'}},
			pair: null,
			chip: t({x: 54, y: 1046, w: 972, h: 50}, 'body', 700, 28, 24, 1, 1.0, 'right'),
			sources: {...SRC_V, box: {x: 476, y: 1110, w: 550, h: 40}},
		},
	} satisfies Record<Format, ChartLayout>,
	steps: {
		landscape: {
			zoo: {x: 1500, y: ZOO_MED_Y, scale: ZOO_MED_S},
			badger: {x: 885, y: ZOO_MED_Y, scale: ZOO_MED_S, view: 'right', head: 'front', inFront: true},
			column: {top: 110, bottom: 990},
			title: t({x: 96, y: 0, w: 900, h: 140}, 'heading', 900, 62, 40, 2, 1.1, 'left', {balance: true}),
			list: {x: 96, w: 900},
			item: t({x: 0, y: 0, w: 900 - 72 - 26, h: 140}, 'heading', 800, 48, 30, 2, 1.18, 'left', {balance: true}),
			badge: 72,
			gap: 28,
			sources: src({x: 1000, y: 60, w: 824, h: 40}, 'right'),
		},
		vertical: {
			zoo: {x: 540, y: 2170, scale: 1.3},
			badger: BADGER_INSERT.vertical,
			column: {top: 290, bottom: 860},
			title: t({x: 54, y: 0, w: 972, h: 130}, 'heading', 900, 56, 36, 2, 1.1, 'center', {balance: true}),
			list: {x: 54, w: 972},
			item: t({x: 0, y: 0, w: 972 - 60 - 22, h: 100}, 'heading', 800, 42, 28, 2, 1.16, 'left', {balance: true}),
			badge: 60,
			gap: 16,
			sources: SRC_V,
		},
	} satisfies Record<Format, StepsLayout>,
	quote: {
		landscape: {
			zoo: {x: 1620, y: ZOO_MED_Y, scale: ZOO_MED_S},
			badger: {x: 985, y: ZOO_MED_Y, scale: ZOO_MED_S, view: 'right', head: 'front', inFront: true},
			column: {top: 110, bottom: 970},
			card: {x: 96, w: 1000},
			pad: 56,
			markSize: 150,
			quote: t({x: 152, y: 0, w: 888, h: 420}, 'heading', 800, 66, 34, 5, 1.18, 'left', {balance: true}),
			attribution: t({x: 152, y: 0, w: 888, h: 92}, 'body', 700, 36, 26, 2, 1.2, 'left'),
			source: t({x: 152, y: 0, w: 888, h: 80}, 'body', 600, 28, 24, 2, 1.3, 'left'),
		},
		vertical: {
			zoo: {x: 540, y: 2160, scale: 1.25},
			badger: BADGER_INSERT.vertical,
			column: {top: 290, bottom: 900},
			card: {x: 54, w: 972},
			pad: 44,
			markSize: 110,
			quote: t({x: 98, y: 0, w: 884, h: 300}, 'heading', 800, 54, 30, 5, 1.18, 'left', {balance: true}),
			attribution: t({x: 98, y: 0, w: 884, h: 84}, 'body', 700, 34, 26, 2, 1.2, 'left'),
			source: t({x: 98, y: 0, w: 884, h: 72}, 'body', 600, 26, 24, 2, 1.3, 'left'),
		},
	} satisfies Record<Format, QuoteLayout>,
	cta: {
		landscape: {
			zoo: {x: 440, y: ZOO_MED_Y, scale: ZOO_MED_S},
			badger: {x: 1080, y: ZOO_MED_Y, scale: ZOO_MED_S, view: 'left', head: 'front', inFront: true},
			column: {top: 110, bottom: 970},
			card: {x: 1120, w: 704},
			pad: 52,
			title: t({x: 1168, y: 0, w: 608, h: 300}, 'heading', 900, 68, 40, 4, 1.1, 'center', {balance: true}),
			button: {w: 568, h: 112},
			buttonLabel: t({x: 0, y: 0, w: 568, h: 112}, 'heading', 900, 48, 30, 1, 1.0, 'center', {valign: 'center', uppercase: true}),
			disclosure: t({x: 1168, y: 0, w: 608, h: 200}, 'body', 700, 34, 26, 4, 1.25, 'center', {balance: true}),
			sources: src({x: 96, y: 60, w: 860, h: 40}, 'left'),
		},
		vertical: {
			zoo: {x: 540, y: 2170, scale: 1.3},
			badger: BADGER_INSERT.vertical,
			column: {top: 290, bottom: 860},
			card: null,
			pad: 24,
			title: t({x: 54, y: 0, w: 972, h: 220}, 'heading', 900, 64, 40, 3, 1.1, 'center', {balance: true}),
			button: {w: 700, h: 110},
			buttonLabel: t({x: 0, y: 0, w: 700, h: 110}, 'heading', 900, 48, 30, 1, 1.0, 'center', {valign: 'center', uppercase: true}),
			disclosure: t({x: 80, y: 0, w: 920, h: 150}, 'body', 700, 32, 26, 4, 1.25, 'center', {balance: true}), // inside a 54..1026 plate
			sources: SRC_V,
		},
	} satisfies Record<Format, CtaLayout>,
	endscreen: {
		landscape: {
			zoo: {x: 300, y: 990, scale: 0.72},
			badger: {x: 648, y: 990, scale: 0.72, view: 'left', head: 'front', inFront: true},
			outro: t({x: 96, y: 96, w: 900, h: 250}, 'heading', 900, 72, 44, 3, 1.1, 'left', {valign: 'top', balance: true}),
			// two stacked 16:9 zones (736x414) for video/playlist elements, and one circle for the subscribe element
			slots: [
				{x: 1088, y: 150, w: 736, h: 414},
				{x: 1088, y: 594, w: 736, h: 414},
			],
			subscribe: {cx: 900, cy: 540, r: 120},
			slotLabel: t({x: 1088, y: 90, w: 736, h: 48}, 'heading', 800, 36, 28, 1, 1.0, 'left', {valign: 'bottom'}),
			subscribeLabel: t({x: 760, y: 676, w: 280, h: 44}, 'heading', 800, 30, 24, 1, 1.0, 'center'),
		},
		vertical: {
			zoo: {x: 540, y: 2160, scale: 1.4},
			badger: BADGER_INSERT.vertical,
			outro: t({x: 54, y: 330, w: 972, h: 420}, 'heading', 900, 80, 48, 4, 1.1, 'center', {valign: 'center', balance: true}),
			slots: [],
			subscribe: null,
			slotLabel: null,
			subscribeLabel: null,
		},
	} satisfies Record<Format, EndLayout>,
} as const;

/** Overlays. */
export const LOWER_THIRD: Record<Format, {box: Box; name: TextSpec; role: TextSpec} | null> = {
	landscape: {
		box: {x: 96, y: 862, w: 640, h: 124},
		name: t({x: 136, y: 878, w: 580, h: 52}, 'heading', 900, 44, 30, 1, 1.0, 'left'),
		role: t({x: 136, y: 934, w: 580, h: 38}, 'body', 600, 28, 24, 1, 1.0, 'left'),
	},
	vertical: null, // Shorts carry no lower third: the top and bottom of the frame belong to the Shorts UI
};
export const FICTION_CARD: Record<Format, TextSpec> = {
	landscape: t({x: 96, y: 56, w: 1100, h: 56}, 'body', 700, 28, 24, 1, 1.0, 'left', {valign: 'center'}),
	vertical: t({x: 54, y: 200, w: 760, h: 76}, 'body', 700, 26, 24, 2, 1.15, 'left', {valign: 'center'}),
};
/** Dev / review badges (English by design: they are markers for the owner, never viewer copy). */
export const BADGE_AREA: Record<Format, {right: number; y: number}> = {
	landscape: {right: 1824, y: 6},
	vertical: {right: 1026, y: 140},
};
