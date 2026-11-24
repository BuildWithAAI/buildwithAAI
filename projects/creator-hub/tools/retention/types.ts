/**
 * Retention tool contracts (v1, 2026-11-24).
 *
 * The input shapes below mirror the parts of video-studio's episode contracts this tool reads
 * (projects/video-studio/src/episode/types.ts: Timeline, Storyboard). They are copied, not imported: the two
 * projects have separate TypeScript configs and video-studio's types pull in React-based character types.
 * Only erasable TypeScript is used (Node runs these files with type stripping).
 */

/** Format of one upload. Shorts and long-form are never pooled: their curves have different shapes (loops). */
export type Format = 'long' | 'short';

/** Languages video-studio renders (src/episode/types.ts `Lang`). */
export const LANGS = ['en', 'es', 'pt-br', 'hi', 'it', 'zh', 'ja'] as const;
export type Lang = (typeof LANGS)[number];

/** Episode-engine template types (src/episode/types.ts `SceneType`). Other strings are kept as they are. */
export const SCENE_TYPES = ['hook', 'talk', 'chart', 'steps', 'quote', 'cta', 'endscreen'] as const;

/* ------------------------------------------------------------------ inputs from video-studio */

/** The Timeline fields this tool reads (written by scripts/voice/build.py to public/generated/<channel>/<slug>/<lang>/timeline.json). */
export type TimelineInput = {
	version: number;
	slug: string;
	lang: string;
	mode?: string;
	fps: number;
	totalMs: number;
	mock?: boolean;
	scenes: {id: string; startMs: number; durationMs: number; speechMs?: number}[];
};

export type StoryboardSceneInput = {
	id: string;
	type: string;
	onScreen?: Record<string, unknown>;
	badger?: {present?: boolean; reaction?: string};
	/** Show segment (The Zoo & Badger Show), when the storyboard names it. See segments.ts for the accepted shapes. */
	segment?: unknown;
	show?: unknown;
};

export type StoryboardInput = {
	version: number;
	channel?: string;
	slug?: string;
	lang?: string;
	sourceLang?: string;
	title?: string;
	scenes: StoryboardSceneInput[];
	shorts?: {id: string; sceneIds: string[]; title?: string}[];
};

/* ------------------------------------------------------------------ YouTube data (API values, unchanged) */

/**
 * One row of the audience retention report. `ratio` is elapsedVideoTimeRatio: the EXCLUSIVE END of a bucket that is
 * 1/100 of the video long (0.01 = the first 1%). The metric values are YouTube's, copied as returned.
 */
export type CurvePoint = {
	ratio: number;
	watch: number; // audienceWatchRatio: times this part was watched / views (can exceed 1 after rewinds or loops)
	relative: number | null; // relativeRetentionPerformance: 0..1 against YouTube videos of similar length (0.5 = median)
	started: number | null; // startedWatching
	stopped: number | null; // stoppedWatching
	impressions: number | null; // totalSegmentImpressions
};

export type Audience = 'all' | 'ORGANIC' | 'AD_INSTREAM' | 'AD_INDISPLAY';

export type VideoStats = {
	views: number | null;
	engagedViews: number | null;
	averageViewDurationSec: number | null;
	averageViewPercentage: number | null; // 0..100 as returned
	/** creatorContentType with the most views (SHORTS, VIDEO_ON_DEMAND, ...), or null when the API gave none. */
	contentType: string | null;
};

/** YouTube Data API metadata. Developer Policies III.E.4.c: refresh or delete within 30 days. */
export type VideoMeta = {
	durationSec: number | null;
	publishedAt: string | null;
	defaultAudioLanguage: string | null;
	fetchedAt: string;
};

/* ------------------------------------------------------------------ join snapshot (our timeline at pull time) */

export type SegmentSource = 'explicit' | 'default' | 'inferred';

export type SceneSnapshot = {
	id: string;
	index: number; // position in THIS upload
	type: string; // template type from the storyboard; 'unknown' when the storyboard has no scene with this id
	segment: string | null; // canonical show segment (ColdOpen, BadgerRedFlag, ...) or null
	segmentSource: SegmentSource | null;
	badger: boolean | null; // storyboard badger.present; null when unknown
	title: string | null; // onScreen.title, source language when available (for the report only)
	startMs: number; // in THIS upload (a Short is retimed from 0)
	durationMs: number;
	speechMs: number | null;
};

export type JoinIssueCode =
	| 'mock-timeline'
	| 'scene-not-in-storyboard'
	| 'storyboard-scene-missing'
	| 'short-scene-missing'
	| 'gap'
	| 'overlap'
	| 'scene-past-end'
	| 'uncovered-tail'
	| 'empty-scene'
	| 'storyboard-fallback'
	| 'no-storyboard';

export type JoinIssue = {code: JoinIssueCode; detail: string};

export type JoinSnapshot = {
	format: Format;
	shortId: string | null;
	/** The composition that rendered the upload: episode engine (src/episode) or the show (src/show). */
	renderer: 'episode' | 'show';
	totalMs: number; // expected length of the uploaded video
	fps: number;
	scenes: SceneSnapshot[];
	timeline: {path: string; sha256: string; mode: string | null; mock: boolean; lang: string};
	storyboard: {path: string | null; sha256: string | null};
	issues: JoinIssue[];
};

/* ------------------------------------------------------------------ stored pull */

export type PullChecks = {
	/** true / false when the Data API duration was compared with the timeline; null when it could not be checked. */
	durationMatch: boolean | null;
	durationDeltaMs: number | null;
	langMatch: boolean | null; // snippet.defaultAudioLanguage vs --lang (null when YouTube has none)
	formatMatch: boolean | null; // creatorContentType vs --short (null when unknown)
};

export type PullRecord = {
	version: 1;
	kind: 'retention-pull';
	/** Synthetic data for tests and the demo. Never from the API. */
	fixture?: boolean;
	videoId: string;
	account: string | null;
	channel: string;
	slug: string;
	lang: string;
	format: Format;
	shortId: string | null;
	/** The upload carries extra dubbed audio tracks, so its curve blends several languages. */
	multiLanguageAudio: boolean;
	pulledAt: string;
	window: {startDate: string; endDate: string};
	audience: Audience;
	metrics: string[]; // retention metrics the API returned
	curve: CurvePoint[];
	stats: VideoStats | null;
	video: VideoMeta | null;
	join: JoinSnapshot;
	checks: PullChecks;
	warnings: string[];
};

/* ------------------------------------------------------------------ analysis (our calculations) */

/** The channel's typical curve over the scene (absolute time, other episodes): retention LEVEL, not loss. */
export type TypicalAtScene = {
	entry: number;
	exit: number;
	levelPp: number; // mean (this upload - typical) over the scene, percentage points of views
	episodes: number; // how many other episodes reach this point
};

/**
 * The scene's loss rate against what the scene model (scenemodel.ts) expects of a typical template at that moment of
 * this upload. Rates are "% of the viewers still watching, lost per 10 s" (continuous: -1000 * ln(exit / entry) / s).
 */
export type SceneModel = {
	expectedRate: number; // this upload's level + the channel's drop-off at this moment + the median template
	excessRate: number; // lossRate - expectedRate; > 0 = loses more than expected
	excessPpPer10s: number; // the same in percentage points of the video's views per 10 s
};

export type SceneMetrics = {
	id: string;
	index: number;
	type: string;
	segment: string | null;
	segmentSource: SegmentSource | null;
	badger: boolean | null;
	title: string | null;
	startMs: number;
	endMs: number;
	durationMs: number;
	startRatio: number;
	endRatio: number;
	/** The scene spans at least RULES.minBucketsPerScene curve buckets, so its own drop is measurable. */
	resolved: boolean;
	entry: number; // audienceWatchRatio interpolated at the scene start (YouTube value, interpolated)
	exit: number;
	dropPp: number; // (entry - exit) * 100; negative = retention rose (rewatches, loops)
	dropPer10sPp: number;
	lostShare: number | null; // 1 - exit / entry
	rrpMean: number | null;
	rrpDelta: number | null;
	stopShare: number | null; // share of playbacks whose last watched segment is in this scene
	/** % of the viewers still watching that left per 10 s; null when retention is near 0 at either end. */
	lossRate: number | null;
	/** Enters scene-level comparisons: measurable, not the opening scene, not the end screen, known type. */
	eligible: boolean;
	model: SceneModel | null;
	typical: TypicalAtScene | null;
};

export type HookMetrics = {
	r0: number | null; // first bucket
	r5: number | null; // retention at 0:05
	r30: number | null; // retention at 0:30
	lost5Pp: number | null;
	lost30Pp: number | null;
	vsTypical5Pp: number | null;
	vsTypical30Pp: number | null;
	opening: {id: string; type: string; segment: string | null; lengthMs: number; exit: number} | null;
	/** The hook outcome used in comparisons: 0:30 for long-form, 0:05 for Shorts. */
	outcome: {atSec: number; value: number | null};
	scenesIn5s: string[];
	scenesIn30s: string[];
};

export type Exclusion =
	| 'no-curve'
	| 'incomplete-curve'
	| 'low-views'
	| 'sample-unknown'
	| 'mock-timeline'
	| 'duration-mismatch'
	| 'duration-unverified'
	| 'format-mismatch'
	| 'no-scenes'
	| 'stale';

export type VideoAnalysis = {
	videoId: string;
	fixture: boolean;
	channel: string;
	slug: string;
	lang: string;
	format: Format;
	shortId: string | null;
	episodeKey: string; // channel/slug/format[/shortId]: all language versions of one piece of content
	multiLanguageAudio: boolean;
	pulledAt: string;
	ageDays: number;
	window: {startDate: string; endDate: string};
	audience: Audience;
	totalMs: number;
	bucketMs: number;
	usable: boolean;
	exclusions: {code: Exclusion; detail: string}[];
	sample: {playbacks: number | null; views: number | null; used: number | null};
	averageRetention: number | null; // mean of the 100 buckets
	presentBuckets: number;
	baselineEpisodes: number; // 0 = no typical curve
	/** This upload's scenes entered the scene model of its format (enough data to compare templates). */
	inSceneModel: boolean;
	scenes: SceneMetrics[];
	hook: HookMetrics;
	warnings: string[];
};
