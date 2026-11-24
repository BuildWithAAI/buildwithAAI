/**
 * Visual QA protocol: the data the in-browser probe (src/qa/runtime) reports to the Node checker
 * (scripts/qa/check.ts) through console logs captured by Remotion's onBrowserLog.
 *
 * Pure TypeScript with no runtime imports, so both the webpack bundle and Node (type stripping) can load it.
 * Every coordinate is in composition pixels: origin at the top-left of the frame, x right, y down, unscaled
 * (CSS px of the composition, whatever device scale the renderer uses for screenshots).
 */

export const QA_PROTOCOL_VERSION = 1;

/** Prefix of every probe console line. One line = one chunk of one frame's JSON payload. */
export const QA_LOG_TAG = '[zoora-qa]';

/** Longest chunk the probe writes per console line (characters of JSON). */
export const QA_CHUNK_CHARS = 60_000;

/** The env variable keys the checker passes through renderFrames({envVariables}). */
export const QA_ENV = {
	pass: 'ZOORA_QA_PASS',
	run: 'ZOORA_QA_RUN',
} as const;

/**
 * Render passes:
 *  - scout: every (or every k-th) frame, DOM facts plus tiny screenshots for cut and flicker detection;
 *  - pixels: sampled frames at full size, DOM facts again (the exact DOM of the analysed pixels);
 *  - textoff: the same frames with every text fill, stroke and shadow made transparent (layout unchanged);
 *  - solo: the same frames with everything hidden except the characters (transparent background);
 *  - ref: the QaRef composition, one canonical character render per frame.
 */
export type QaPass = 'scout' | 'pixels' | 'textoff' | 'solo' | 'ref';
export const QA_PASSES: readonly QaPass[] = ['scout', 'pixels', 'textoff', 'solo', 'ref'];

/** Composition id of the canonical-reference composition registered next to `compId` in QA bundles. */
export const qaRefId = (compId: string): string => `QaRef-${compId}`;

/** The text as painted under a CSS text-transform value (uppercase, lowercase, capitalize; anything else unchanged). */
export const applyTextTransform = (text: string, transform: string | undefined): string =>
	transform === 'uppercase' ? text.toUpperCase() : transform === 'lowercase' ? text.toLowerCase() : transform === 'capitalize' ? text.replace(/(^|[^\p{L}\p{N}'’])(\p{L})/gu, (_m, pre: string, c: string) => pre + c.toUpperCase()) : text;

export type Rect = {x: number; y: number; w: number; h: number};
/** SVG/DOM affine matrix [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f. */
export type Matrix = [number, number, number, number, number, number];

export type TextRole = 'caption' | 'badge' | 'text';

export type TextFact = {
	/** Stable within a frame; built from the DOM path and text index. */
	key: string;
	/** The DOM text (before CSS text-transform). */
	text: string;
	/** The computed CSS text-transform when it is not 'none' (what is painted is applyTextTransform(text, transform)). */
	transform?: string;
	role: TextRole;
	kind: 'html' | 'svg';
	/**
	 * Ink boxes of the text node, one per line, frame px: the Range line boxes narrowed vertically to the glyphs'
	 * actual ascent and descent (canvas TextMetrics), so a tight line-height does not count as overflow.
	 */
	rects: Rect[];
	/** Union of `rects`. */
	box: Rect;
	/** Union of the raw line boxes (font content area). */
	lineBox: Rect;
	/** Computed text colour (CSS colour or SVG fill) as [r, g, b, a] (a 0..1); null when not a plain colour. */
	color: [number, number, number, number] | null;
	/** Has an outline (-webkit-text-stroke or SVG stroke) or a text shadow. */
	outlined: boolean;
	fontPx: number; // computed font-size
	effPx: number; // font-size times the element's on-screen scale
	weight: number;
	family: string;
	/** Product of ancestor opacities (1 = fully opaque). */
	opacity: number;
	/** Visible part of `box` after ancestor clipping and the frame, as a fraction of its area (0..1). */
	visibleFrac: number;
	/** What clips the text, when visibleFrac < 1. */
	clippedBy: Array<'frame' | 'overflow' | 'svg-viewport' | 'clip-path'>;
	/**
	 * Ink outside the padding box of the text's plate (the nearest ancestor that paints a background or a border,
	 * not a full-frame fill), px per side, and how far it hangs past the plate's outer edge; null when it fits or
	 * the text sits directly on the scene. This is the visible defect: letters on or off the edge of their card.
	 */
	overflow: {left: number; right: number; top: number; bottom: number; box: Rect; beyondPlate: number} | null;
	/** Ink outside the nearest block box (layout only: a tight line-height leaves descenders outside it). */
	blockOverflow?: {left: number; right: number; top: number; bottom: number; box: Rect} | null;
	/** Truncated on purpose (text-overflow: ellipsis or -webkit-line-clamp) and actually cut. */
	truncated: 'ellipsis' | 'line-clamp' | null;
	/** True when an ancestor or the element is a sub/superscript (a smaller tspan or <sub>/<sup>). */
	script: boolean;
	/** Component names from the React tree, innermost first (at most 4), for the report. */
	components: string[];
	/** Short DOM path for the report. */
	path: string;
};

export type CharacterKind = 'zoo' | 'badger';

export type CharacterFact = {
	key: string; // kind + index in document order
	kind: CharacterKind;
	/** Rendered view, pose and (Badger) head view, from the data attributes. */
	view: string | null;
	pose: string | null;
	head: string | null;
	/** Screen matrix of the character's root group: character units (900 = Zoo's height) to frame px. */
	ctm: Matrix | null;
	box: Rect;
	headBox: Rect | null;
	hands: Rect[];
	/**
	 * Per hand (same order): the share of hit-test points on the hand that nothing painted covers, 0..1; -1 when
	 * unknown (no point landed on it, or not measured). A hand behind a desk is near 0.
	 */
	handsVisible?: number[];
	pin: Rect | null; // Zoo's pin group (front view only carries the marker)
	spots: string[]; // Badger: data-spot ids in document order
	/** Ancestor effects that change how the character looks. */
	effects: {filter: string[]; opacity: number; blend: string[]; clip: string[]; cssTransform: boolean};
	/** Props as React received them (JSON-safe subset), or null when the React tree could not be read. */
	props: Record<string, unknown> | null;
	/** Prop keys dropped because they could not be serialised (functions, React nodes). */
	droppedProps: string[];
	/** The local frame the character's own useCurrentFrame() saw, and how it was found. */
	localFrame: number;
	frameSource: 'context' | 'assumed';
	/** Rendered by the canonical component from src/characters (false = a copy or a fork). */
	canonical: boolean | null;
	/** Characters painted after this one (document order), i.e. possibly in front of it: indexes into `chars`. */
	coveredBy: number[];
};

export type BannedFact = {
	kind:
		| 'css-gradient'
		| 'box-shadow'
		| 'text-shadow-blur'
		| 'css-filter'
		| 'backdrop-filter'
		| 'blend-mode'
		| 'mask'
		| 'svg-gradient'
		| 'svg-pattern'
		| 'svg-filter';
	detail: string;
	box: Rect;
	path: string;
};

export type FrameFacts = {
	v: number;
	pass: QaPass;
	run: string;
	comp: string;
	frame: number;
	width: number;
	height: number;
	/** The probe waited for every other delayRender handle and for fonts before measuring. */
	settled: boolean;
	texts: TextFact[];
	chars: CharacterFact[];
	banned: BannedFact[];
	/** Milliseconds the measurement took in the page. */
	ms: number;
	errors: string[];
};

/** A canonical reference render request: one character instance per frame of the QaRef composition. */
export type RefItem = {
	kind: CharacterKind;
	props: Record<string, unknown>;
	localFrame: number;
	/** Uniform-scale placement [s, 0, 0, s, e, f] that matches the in-scene origin and size. */
	matrix: Matrix;
};

export type RefProps = {
	items: RefItem[];
	width: number;
	height: number;
	fps: number;
	durationInFrames: number;
};

// ---- chunked console transport ----

/** Split one payload into console lines: `${QA_LOG_TAG} ${run} ${pass} ${frame} ${i}/${n} ${chunk}`. */
export const encodeChunks = (run: string, pass: QaPass, frame: number, json: string, max = QA_CHUNK_CHARS): string[] => {
	const n = Math.max(1, Math.ceil(json.length / max));
	const out: string[] = [];
	for (let i = 0; i < n; i++) out.push(`${QA_LOG_TAG} ${run} ${pass} ${frame} ${i + 1}/${n} ${json.slice(i * max, (i + 1) * max)}`);
	return out;
};

export type Chunk = {run: string; pass: QaPass; frame: number; index: number; count: number; data: string};

const CHUNK_RE = /^\[zoora-qa\] (\S+) (scout|pixels|textoff|solo|ref) (-?\d+) (\d+)\/(\d+) ([\s\S]*)$/;

/** Parse one console line; null when it is not a probe line. Tolerates text before the tag. */
export const decodeChunk = (line: string): Chunk | null => {
	const at = line.indexOf(QA_LOG_TAG);
	if (at < 0) return null;
	const m = CHUNK_RE.exec(line.slice(at));
	if (!m) return null;
	const index = Number(m[4]);
	const count = Number(m[5]);
	if (!(index >= 1 && index <= count)) return null;
	return {run: m[1], pass: m[2] as QaPass, frame: Number(m[3]), index, count, data: m[6]};
};

/** Collects chunks (any order, duplicates ignored) and yields complete payloads. */
export class ChunkAssembler {
	private parts = new Map<string, {count: number; got: Map<number, string>}>();

	/** Returns the complete JSON string when this chunk completes a payload, else null. */
	add(c: Chunk): string | null {
		const id = `${c.run} ${c.pass} ${c.frame}`;
		let p = this.parts.get(id);
		if (!p || p.count !== c.count) {
			p = {count: c.count, got: new Map()};
			this.parts.set(id, p);
		}
		p.got.set(c.index, c.data);
		if (p.got.size < p.count) return null;
		this.parts.delete(id);
		let s = '';
		for (let i = 1; i <= p.count; i++) s += p.got.get(i) ?? '';
		return s;
	}

	/** Payloads that never completed (for diagnostics). */
	pending(): string[] {
		return [...this.parts.keys()];
	}
}
