/**
 * Back-translation check: shared types (pure).
 *
 * Three texts meet here for every on-screen or spoken string of an episode:
 *   source       the English original (storyboard.json),
 *   translation  the Spanish or Brazilian Portuguese storyboard (storyboard.es.json / storyboard.pt-br.json),
 *   back         an English back-translation of `translation`, made by a Claude session or a person who did NOT
 *                read `source` (never by an external API).
 * The checks compare source with back (meaning), and source with translation directly where that is reliable
 * (digits, names, [src:id] tags, negation and hedge words).
 */

export type TargetLang = 'es' | 'pt-br';
export const TARGET_LANGS: readonly TargetLang[] = ['es', 'pt-br'];
export const LANG_NAMES: Record<TargetLang, string> = {es: 'Spanish', 'pt-br': 'Brazilian Portuguese'};
export const isTargetLang = (x: unknown): x is TargetLang => typeof x === 'string' && (TARGET_LANGS as readonly string[]).includes(x);

export type SegmentKind = 'title' | 'narration' | 'onScreen' | 'shortTitle' | 'thumbnail' | 'ui' | 'showUi' | 'news' | 'copy';

/** One `{display|spoken}` pair from narration markup. */
export type MarkupPair = {display: string; spoken: string};

export type Segment = {
	/** Stable id, e.g. "s02.narration", "s02.onScreen.bullets.1", "thumbnails.a.text", "ui.sources", "copy.description.p3". */
	id: string;
	kind: SegmentKind;
	/** What the string is, for the worksheet and the report. Never contains source text. */
	context: string;
	sceneId?: string;
	sceneType?: string;
	/** Raw strings as stored (narration keeps its markup). null = absent on that side. */
	sourceRaw: string | null;
	translationRaw: string | null;
	/** Comparable text: display side of the markup, [src:id] tags kept in place. */
	source: string | null;
	translation: string | null;
	/** Narration only. */
	sourcePairs?: MarkupPair[];
	translationPairs?: MarkupPair[];
	sourceTags?: string[];
	translationTags?: string[];
	/** The English side is a built-in default label (src/episode/i18n/ui.ts or src/show/ui.ts), not storyboard text. */
	sourceIsDefault?: boolean;
	/** sha256 of the translation string (first 16 hex chars); the back-translation is valid only for this text. */
	hash: string | null;
	order: number;
};

export type Severity = 'high' | 'medium' | 'low' | 'info';
export const SEVERITY_ORDER: readonly Severity[] = ['high', 'medium', 'low', 'info'];

export type Finding = {
	code: string;
	severity: Severity;
	message: string;
	/** 1-based sentence numbers in the English source, when the finding is about specific sentences. */
	sentences?: number[];
	/** Short excerpts that show the problem. */
	evidence?: {source?: string; translation?: string; back?: string};
};

/** Per-segment metadata of a back-translation (several people or sessions may each do part of an episode). */
export type BackSegment = {
	hash: string;
	text: string;
	method: BackMethod;
	by: string;
	/** true = the back-translator did not read the English source. */
	blind: boolean;
	date: string;
};

/** Who back-translated. Never an external translation API. */
export type BackMethod = 'claude-session' | 'human';
export const BACK_METHODS: readonly BackMethod[] = ['claude-session', 'human'];

export type BackTranslation = {
	kind: 'backtranslation';
	version: 1;
	channel: string;
	slug: string;
	lang: TargetLang;
	segments: Record<string, BackSegment>;
};

export type WorksheetItem = {id: string; hash: string; context: string; text: string; bt: string};

export type Worksheet = {
	kind: 'backtranslation-worksheet';
	version: 1;
	channel: string;
	slug: string;
	lang: TargetLang;
	langName: string;
	createdAt: string;
	instructions: string[];
	items: WorksheetItem[];
};

export type SegmentResult = {
	id: string;
	kind: SegmentKind;
	context: string;
	order: number;
	status: 'checked' | 'missing-translation' | 'extra-translation' | 'no-back-translation' | 'stale-back-translation';
	source: string | null;
	translation: string | null;
	back: string | null;
	similarity: number | null;
	overlap: number | null;
	keyScore: number | null;
	risk: number;
	findings: Finding[];
	/** Content words of the English source that the back-translation does not have, and the reverse. */
	lostWords: string[];
	addedWords: string[];
	sentenceCounts?: {source: number; translation: number; back: number};
	back_meta?: {method: BackMethod; by: string; blind: boolean; date: string};
};

export type Report = {
	kind: 'backtranslation-report';
	version: 1;
	channel: string;
	slug: string;
	lang: TargetLang;
	langName: string;
	generatedAt: string;
	/** FIX: high-risk findings · REVIEW: medium findings for the native reviewer · CLEAR: low/info only · INCOMPLETE: unchecked segments. */
	verdict: 'FIX' | 'REVIEW' | 'CLEAR' | 'INCOMPLETE';
	counts: Record<Severity, number> & {segments: number; checked: number; flagged: number; clean: number; unchecked: number};
	translationStatus: string;
	backTranslators: Array<{method: BackMethod; by: string; blind: boolean; segments: number}>;
	glossary: string[];
	segments: SegmentResult[];
	notes: string[];
};
