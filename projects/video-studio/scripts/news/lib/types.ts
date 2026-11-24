/**
 * News claim gate contracts, v1 (2026-11-24). Channel 2 ("zoora-security", The Zoo & Badger Show): crypto security
 * and AI security news (owner scope, 2026-11-24).
 *
 * NewsStoryboard is the episode engine's Storyboard (src/episode/types.ts, owned by the episode builder) plus two
 * OPTIONAL fields this gate adds. They live here, not in src/episode/types.ts, because that file belongs to another
 * workflow; the episode validator ignores unknown top-level fields, so a news storyboard still renders.
 *   - analysis: the "real analysis" the owner requires in every daily video (rule R7).
 *   - news: format and the persistent DEVELOPING label (rule R2).
 */
import type {Source, Storyboard, StoryboardScene} from '../../../src/episode/types.ts';

export type {Source, Storyboard, StoryboardScene};

export type AnalysisKind = 'fund-flow' | 'pattern' | 'comparison' | 'stat';
export type AnalysisBasis = 'own-data' | 'source';

/** One piece of real analysis (rule R7). The required shape is {kind, basis, detail, sourceIds}; the rest is optional. */
export type NewsAnalysis = {
	id?: string;
	kind: AnalysisKind;
	/** own-data: we computed it (from data we stored, e.g. tracker rows or RPC reads). source: a source states it. */
	basis: AnalysisBasis;
	/** What the analysis says, in one or two plain sentences (shown to the owner on the approval page). */
	detail: string;
	/** The sources the analysis rests on (ids from storyboard.sources / the brief). */
	sourceIds: string[];
	/** Optional: the scenes that present it. Without it the gate finds the scenes by wording. */
	sceneIds?: string[];
	/** Optional (recommended for own-data): how it was computed, so the owner can check it in the 5-minute review. */
	method?: string;
};

export type NewsFormat = 'daily-short' | 'what-we-know' | 'weekly-roundup' | 'explainer';

/** The developing-story label: true, a label string ("DEVELOPING"), or an object with the label and an as-of time. */
export type DevelopingLabel = boolean | string | {label?: string; asOf?: string; note?: string};

export type NewsMeta = {
	format?: NewsFormat;
	/** Persistent on-screen DEVELOPING badge (rule R2). The renderer must draw it; see README "Known gaps". */
	developing?: DevelopingLabel;
	/** Brief incident ids this video covers (optional; the gate also derives them from the cited facts). */
	incidentIds?: string[];
};

export type NewsStoryboard = Storyboard & {
	analysis?: NewsAnalysis[] | NewsAnalysis;
	news?: NewsMeta;
	/** Accepted alias of news.developing. */
	developing?: DevelopingLabel;
};

// ---------------------------------------------------------------------------------------------------------------
// brief.json: the facts the radar selected. The gate reads it leniently (see brief.ts) and normalises it to this.

export type SourceKind =
	| 'news'
	| 'security-firm'
	| 'post-mortem'
	| 'project'
	| 'tracker'
	| 'law-enforcement'
	| 'regulator'
	| 'court'
	| 'on-chain'
	| 'other';

export type BriefSource = {
	id: string;
	url: string;
	title: string;
	publisher: string;
	kind: SourceKind;
	publishedAt?: string;
	/** Stored excerpts of this source (each at most 280 characters by policy). */
	excerpts: string[];
	/**
	 * The radar's source tier: A (trackers, security firms, post-mortems, primary statements), B (established outlets),
	 * C (aggregators: never carry a claim or a figure alone). Undefined when the brief does not say.
	 */
	tier?: 'A' | 'B' | 'C';
	/** The hedge word the radar found in this source's title or lead ("suspected", "potential"), if any. */
	hedge?: string;
};

/** An analysis the daily brief proposes, with the figures it computed (the news gate checks own-data numbers). */
export type BriefOpportunity = {id: string; basis: string; available: boolean; numbers: number[]; detail?: string};

/** One "must not say" entry of the brief (rule ids: names, figures, hedge, legal, attribution, tier-c...). */
export type BriefMustNotSay = {rule: string; text: string};

export type BriefExcerpt = {sourceId: string | null; text: string};

export type BriefFact = {
	id: string;
	text: string;
	sourceIds: string[];
	/** sourceId is null when the brief gave plain strings that cannot be tied to one source. */
	excerpts: BriefExcerpt[];
	incidentId?: string;
	developing: boolean;
};

export type BriefIncident = {
	id: string;
	name: string;
	aliases: string[];
	developing: boolean;
	date?: string;
};

export type BriefEntity = {name: string; kind: 'org' | 'protocol' | 'person' | 'official' | 'place' | 'other'};

export type Brief = {
	slug?: string;
	generatedAt?: string;
	developing: boolean; // the whole brief is marked developing
	incidents: BriefIncident[];
	facts: BriefFact[];
	sources: BriefSource[];
	entities: BriefEntity[];
	/** The daily brief's analysis opportunities (scripts/daily), with their computed numbers. */
	opportunities: BriefOpportunity[];
	mustNotSay: BriefMustNotSay[];
};

// ---------------------------------------------------------------------------------------------------------------
// corrections.json (content/zoora-security/corrections.json)

export type CorrectionStatus = 'pending' | 'pinned';

export type Correction = {
	id: string;
	slug: string; // the episode the correction applies to
	date: string; // YYYY-MM-DD, the date of the correction
	correct: string; // the corrected statement (attributed)
	sourceIds: string[]; // sources that support the correction
	wrong?: string; // what we said (omitted from the pinned comment if it fails the text rules)
	timestamp?: string; // where in the video, mm:ss or h:mm:ss
	incidentId?: string;
	status: CorrectionStatus;
	pinnedAt?: string;
	/** Inline source records, used when the slug's storyboard/brief is not at hand. */
	sources?: Array<{id: string; url: string; title?: string; publisher?: string}>;
	note?: string;
};

export type CorrectionsFile = {version: 1; corrections: Correction[]};

// ---------------------------------------------------------------------------------------------------------------
// Findings and the result

export type RuleId = 'INPUT' | 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7' | 'R8' | 'R9' | 'R10' | 'GEN';
export type Severity = 'error' | 'warning' | 'info';

export type Where = {
	/** narration | narration (spoken) | onScreen.<key> | title | shorts[<id>].title | thumbnails[<id>].text | analysis[<i>] | brief | storyboard | corrections | general-gate */
	surface: string;
	scene?: string;
	text?: string;
};

export type Finding = {
	rule: RuleId;
	code: string; // e.g. "R1.number-not-in-excerpt"
	severity: Severity;
	where: Where;
	message: string;
	fix: string;
	evidence?: string;
};

export type ClaimRecord = {
	scene: string;
	sentence: number;
	text: string;
	sourceIds: string[];
	factId: string | null;
	numbers: string[];
	entities: string[];
	attribution: string | null;
	developing: boolean;
	ok: boolean;
};

export type GeneralGateStatus = 'passed' | 'failed' | 'not-found' | 'skipped' | 'error';

export type GeneralGateResult = {
	status: GeneralGateStatus;
	command?: string[];
	exitCode?: number | null;
	durationMs?: number;
	outputTail?: string;
	note: string;
	looked?: string[];
};

export type RuleSummary = {rule: RuleId; title: string; status: 'pass' | 'fail' | 'warn'; errors: number; warnings: number};

export type GateResult = {
	version: 1;
	gate: 'news-claim-gate';
	gateVersion: string;
	channel: string;
	slug: string;
	checkedAt: string;
	verdict: 'pass' | 'fail';
	inputs: Record<string, {path: string; sha256: string | null}>;
	counts: {errors: number; warnings: number; infos: number; claims: number; claimsOk: number};
	rules: RuleSummary[];
	findings: Finding[];
	claims: ClaimRecord[];
	developing: {incidents: string[]; label: string | null; labelVia: string | null; spokenIn: string | null};
	analysis: Array<{id: string; kind: string; basis: string; detail: string; sourceIds: string[]; presentedIn: string[]}>;
	corrections: {applicable: string[]; pinnedComments: Array<{id: string; status: CorrectionStatus; text: string}>};
	generalGate: GeneralGateResult;
};
