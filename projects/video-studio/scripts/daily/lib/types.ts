/**
 * Contracts of the daily orchestrator (channel 2, zoora-security), v1, 2026-11-24.
 *
 *   radar file (scripts/radar, read only)  ->  brief.json + WRITER.md (prepare)
 *   storyboard.json (the writer)           ->  gates, voice, render, thumbnails, publish kit, approval packet (build)
 *   the owner's APPROVE reply              ->  approval.json, announcer and Threat Brief drafts (approve)
 *
 * brief.json is also read by the news claim gate (scripts/news/lib/brief.ts, normalizeBrief): the fields it reads
 * (status, incidents, sources, facts, entities) follow its curated-brief shape. Everything else is extra and ignored
 * there.
 */

// ---------------------------------------------------------------------------------------------------------------
// The radar's daily file (schema "zoora-security/radar@1"): only the fields used here.

export type Tier = 'A' | 'B' | 'C';

export type RadarSource = {
	id: string; // the radar FEED id: two articles from one feed share it
	url: string;
	title: string;
	excerpt?: string | null;
	publishedUtc?: string | null;
	tier: Tier;
	publisher?: string;
	kind?: string; // structured | postmortem | blog | news
	eventDate?: string | null;
	hedge?: string; // the hedge word the radar found in this source ("suspected", "potential"...)
	redacted?: {names?: number; code?: number};
	referenceUrl?: string | null;
	referenceNote?: string;
};

export type RadarFact = {text: string; sourceId: string; url: string; quote: string; field: string};

export type RadarLoss = {amountUsd: number; by: string; url: string; quote: string; field: string; tier: string};

export type RadarIncident = {
	id: string;
	title: string;
	protocol: string;
	chains: string[];
	type: string;
	dateUtc: string;
	reportedLosses: RadarLoss[];
	status: 'confirmed' | 'developing';
	statusReason?: string;
	sources: RadarSource[];
	postMortemUrl?: string | null;
	evergreenTopic: string | null;
	notes?: string[];
	typeReason?: string;
	mechanismKnown?: boolean;
	facts: RadarFact[];
	score: {total: number; factors?: Record<string, {value: number; weight: number; points: number; reason: string}>};
	shortReady: {ready: boolean; missing: string[]};
};

export type RadarFile = {
	schema: string;
	runDate: string;
	generatedUtc: string;
	mode: string;
	userAgent?: string;
	top: RadarIncident[];
	alsoSeen: RadarIncident[];
	unclustered?: Array<{sourceId: string; tier: string; title: string; url: string; publishedUtc?: string | null; excerpt?: string; reason?: string}>;
	corrections?: unknown[];
	sources?: Array<{id: string; name?: string; tier?: string; status?: string; httpStatus?: number | null; fetchedUtc?: string | null; items?: number; warnings?: string[]}>;
	counts?: Record<string, number>;
};

// ---------------------------------------------------------------------------------------------------------------
// brief.json (content/zoora-security/<date>-<slug>/brief.json)

/** The news gate's source kinds (scripts/news/lib/types.ts SourceKind). */
export type SourceKind = 'news' | 'security-firm' | 'post-mortem' | 'project' | 'tracker' | 'law-enforcement' | 'regulator' | 'court' | 'on-chain' | 'other';

export type BriefSource = {
	id: string; // unique in the brief: the feed id, then <feed>-2, <feed>-3 for more articles from one feed
	feed: string; // the radar feed id, or "defillama-30d" for the tracker rows of the 30-day comparison
	url: string;
	title: string;
	publisher: string;
	kind: SourceKind;
	tier: Tier;
	publishedAt?: string | null;
	eventDate?: string | null;
	/** One stored excerpt (280 characters or fewer), or several (tracker rows). Feed text: untrusted, escape it. */
	excerpt?: string;
	excerpts?: string[];
	hedge?: string;
	redactedNames?: number;
	note?: string;
};

export type FactKind = 'radar-fact' | 'excerpt' | 'tracker-row';

export type BriefFact = {
	id: string; // f1.. radar facts · e1.. stored excerpts · t1.. tracker rows
	text: string;
	sourceIds: string[];
	excerpts: Array<{sourceId: string; text: string}>;
	incidentId: string;
	quote?: string; // the part of the excerpt that carries the fact (always a substring of it)
	kind: FactKind;
};

export type BriefIncident = {id: string; name: string; status: 'confirmed' | 'developing'; date: string; role: 'primary' | 'comparison'};

export type OpportunityKind = 'comparison' | 'pattern' | 'fund-flow' | 'stat';

/** An analysis the writer can present (rule R7: every daily video adds real analysis). */
export type Opportunity = {
	id: string;
	kind: OpportunityKind;
	basis: 'own-data' | 'source';
	/** strong: real analysis on its own. supporting: may sit next to a strong one, never alone. */
	strength: 'strong' | 'supporting';
	available: boolean;
	title: string;
	/** A proposed storyboard.analysis[].detail. The writer may reword it but keeps its numbers and meaning. */
	detail: string | null;
	method: string | null;
	sourceIds: string[];
	factIds: string[];
	numbers?: Record<string, number | string>;
	why: string;
	instructions?: string[];
};

export type MustNotSay = {rule: string; text: string};

export type CandidateSummary = {
	rank: number; // 1 = the radar's best score
	incidentId: string;
	dateSlug: string;
	title: string;
	protocol: string;
	status: 'confirmed' | 'developing';
	type: string;
	evergreenTopic: string | null;
	score: number;
	shortReady: boolean;
	missing: string[];
	eligible: boolean;
	reasons: string[];
	strongAnalysis: string[];
	chains: string[];
};

export type Selection = {
	policy: string[];
	primary: CandidateSummary | null;
	alternates: CandidateSummary[];
	considered: CandidateSummary[];
	decision: 'video' | 'no-video';
	decisionReason: string;
	picked?: string; // --pick <incident id>
};

export type DailyBrief = {
	version: 1;
	schema: 'zoora-security/daily-brief@1';
	channel: 'zoora-security';
	slug: string;
	date: string;
	generatedAt: string;
	/** The story's status. "developing" makes the news gate treat every fact in this brief as developing (fail closed). */
	status: 'confirmed' | 'developing';
	format: 'daily-short' | 'what-we-know';
	incident: {
		id: string;
		title: string;
		protocol: string;
		type: string;
		dateUtc: string;
		chains: string[];
		status: 'confirmed' | 'developing';
		statusReason: string | null;
		typeReason: string | null;
		mechanismKnown: boolean;
		score: number;
		scoreReasons: Record<string, string>;
		shortReady: {ready: boolean; missing: string[]};
		postMortemUrl: string | null;
		notes: string[];
	};
	evergreenTopic: string | null;
	evergreen: {topic: string; title: string; url: string | null; status: string} | null;
	incidents: BriefIncident[];
	sources: BriefSource[];
	facts: BriefFact[];
	reportedLosses: Array<{sourceId: string; publisher: string; amountUsd: number; quote: string; tier: string}>;
	entities: Array<{name: string; kind: 'org' | 'protocol' | 'place' | 'other'}>;
	analysisOpportunities: Opportunity[];
	mustNotSay: MustNotSay[];
	alternates: CandidateSummary[];
	selection: {policy: string[]; primary: CandidateSummary; considered: CandidateSummary[]; picked?: string};
	radar: {path: string; sha256: string; runDate: string; generatedUtc: string; mode: string};
	history: {
		radarFiles: number;
		radarFrom: string;
		radarTo: string;
		trackerRows: number;
		trackerFetchedUtc: string | null;
		previousEpisodes: Array<{slug: string; incidentId: string | null; approved: boolean}>;
		notes: string[];
	};
	rules: string[];
	notes: string[];
};

// ---------------------------------------------------------------------------------------------------------------
// Build steps and the approval packet

export type StepStatus = 'passed' | 'failed' | 'missing' | 'skipped' | 'warning';

export type StepResult = {
	id: 'general-gate' | 'news-gate' | 'voice' | 'render' | 'thumbnails' | 'publish-kit' | 'post-approval-preview';
	title: string;
	status: StepStatus;
	/** Does this status block approval? */
	blocking: boolean;
	note: string;
	command?: string[];
	exitCode?: number | null;
	durationMs?: number;
	outputTail?: string;
	artifacts?: Record<string, string>;
};

/** out/approval/<date-slug>/packet.json: what the owner reviewed. approve checks the hashes against the files. */
export type PacketSummary = {
	version: 1;
	schema: 'zoora-security/approval-packet@1';
	slug: string;
	builtAt: string;
	readyToApprove: boolean;
	blockers: string[];
	warnings: string[];
	developing: boolean;
	title: string;
	versions: {
		storyboard: {path: string; sha256: string | null};
		brief: {path: string; sha256: string | null};
		render: {path: string; sha256: string | null; bytes: number | null; durationSec: number | null};
		thumbnails: Array<{path: string; sha256: string | null}>;
		newsGate: {path: string; sha256: string | null; verdict: 'pass' | 'fail' | null};
		publishKit: {path: string; sha256: string | null};
	};
	steps: StepResult[];
	pinnedComment: string;
	files: {html: string; md: string};
};

/**
 * content/zoora-security/<date-slug>/approval.json: the owner's CONTENT approval of exactly the storyboard and render
 * he reviewed. It is not an upload authorization: its kind is "daily-content-approval", which the creator-hub
 * uploader (kind "youtube-upload-approval") refuses by design. Uploads stay manual in YouTube Studio.
 */
export type ApprovalRecord = {
	version: 1;
	schema: 'zoora-security/approval@1';
	kind: 'daily-content-approval';
	channel: 'zoora-security';
	slug: string;
	decision: 'approved';
	approvedBy: string;
	approvedAt: string;
	approvedAtLocal: string;
	via: string;
	reply: string;
	versionHash: string; // sha256 of "storyboard:<sha>\nrender:<sha>\n"
	versions: PacketSummary['versions'] & {packet: {path: string; sha256: string | null}};
	developing: boolean;
	title: string;
	upload: {method: 'manual: YouTube Studio'; automated: false; youtubeVideoId: string | null; recordedAt: string | null; note: string};
	postApproval: PostApprovalResult[];
	history: Array<{at: string; event: string}>;
};

export type PostApprovalResult = {
	id: 'announcer' | 'threat-brief';
	mode: 'local-draft' | 'hub-dry-run' | 'hub-live';
	status: 'written' | 'failed';
	note: string;
	files: string[];
	command?: string[];
	exitCode?: number | null;
};
