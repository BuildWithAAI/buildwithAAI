/**
 * Contracts of the weekly batch (v1, 2026-11-24): the channel backlogs, the batch settings, the week plan and the
 * review snapshot the approve step checks against. Erasable TypeScript only (Node strips the types).
 */
import type {Weekday} from './week.ts';

/** Dub languages Zoo can speak (Kokoro im_nicola). fr is excluded (no male voice); ja is blocked until a real G2P works. */
export const DUB_LANGS = ['es', 'pt-br', 'hi', 'it', 'zh'] as const;
export type DubLang = (typeof DUB_LANGS)[number];

/** Where a fact the script needs stands. Only `fact-bank` facts are reusable as is; the rest need research first. */
export type FactStatus = 'fact-bank' | 'researched' | 'research needed';

export type FactNeed = {
	/** The claim the script needs, in plain words (no figures from unchecked sources). */
	need: string;
	/** Fact-bank id once the fact is verified and stored there; null until then. */
	factId: string | null;
	status: FactStatus;
	/** Where the evidence is so far (a research file and its verdict), for the researcher. */
	lead?: string;
};

export type IdeaStatus = 'idea' | 'published' | 'dropped';

export type Languages = {master: 'en'; dubs: DubLang[]};

export type Idea = {
	id: string;
	/** content/<channel>/<slug>/ (default: the id). Unique across both channels: claim reports are keyed by slug. */
	slug: string;
	title: string;
	format: string;
	status: IdeaStatus;
	/** 1 is planned first. Ties keep the file order. */
	priority: number;
	/** Pinned to an ISO week ("2026-W49") once planned; null = the planner may place it. */
	week: string | null;
	role: string | null;
	angle: string;
	evergreenTopic: string;
	relatedTopics: string[];
	/** Tags to look up in the fact bank (content/facts/facts.jsonl) for facts already verified for this idea. */
	factTags: string[];
	/** The research file with fact-check verdicts and the binding "Must not say" list, when it exists. */
	research: string | null;
	facts: FactNeed[];
	risks: string[];
	languages: Languages;
	/** Suggested angles for the Shorts cut from this episode, in order. */
	shortIdeas: string[];
	notes: string | null;
};

export type Backlog = {
	version: 1;
	channel: string;
	updated: string;
	status: string;
	rules: string[];
	ideas: Idea[];
	/** Where it was read from (relative to projects/video-studio) and its hash. */
	path: string;
	sha256: string;
};

export type SlotSpec = {day: Weekday; time: string; formats: string[]};

export type FormatSpec = {
	label: string;
	/** Proposed running time, e.g. "8-12 min" (an owner decision). */
	length: string;
	entry: string;
	composition: string;
	shortComposition: string | null;
	fiction: boolean;
	notes: string[];
};

/** A weekly slot the calendar keeps free for work made outside the batch (the security channel's news round-up). */
export type ReservedSlot = {label: string; day: Weekday | null; time: string | null; note: string};

export type ChannelBatchConfig = {
	channel: string;
	name: string;
	/** Item id prefix, e.g. "ai" -> ai1, ai1-s1. */
	prefix: string;
	backlog: string;
	long: SlotSpec[];
	shorts: {days: Weekday[]; time: string; length: string} | null;
	formats: Record<string, FormatSpec>;
	/** Shown in every week of the calendar, never planned by the batch. */
	reserved?: ReservedSlot[];
};

export type BatchConfig = {
	version: 1;
	status: string;
	timeZone: string;
	startWeek: string;
	channels: ChannelBatchConfig[];
	approval: {validDays: number};
	factBank: {path: string | null};
	/** Dates the calendar flags for the owner (holidays): "2026-12-25": "Christmas Day". */
	dateNotes: Record<string, string>;
	/** creator-hub, relative to projects/video-studio. */
	hub: string;
	path: string;
	sha256: string;
};

export type Slot = {
	day: Weekday;
	date: string;
	time: string;
	timeZone: string;
	/** UTC ISO 8601: what YouTube's status.publishAt receives. */
	publishAt: string;
	/** "2026-11-30 11:00 CST". */
	local: string;
};

export type ItemPaths = {
	content: string;
	storyboard: string;
	episodeJson: string;
	research: string;
	kitDir: string;
	kit: string;
	render: string;
	/** Long-form only: the folder of the English thumbnails v0-v2. */
	thumbnails: string | null;
	/** Shorts only: the publish kit's shorts-<n>.txt (title and description). */
	shortText: string | null;
	/** The writer packet: the episode's own; a Short points to its episode's packet (it is written in that storyboard). */
	writer: string;
};

export type PlanItem = {
	id: string;
	channel: string;
	channelName: string;
	kind: 'long' | 'short';
	ideaId: string;
	slug: string;
	title: string;
	format: string;
	formatLabel: string;
	/** The publish kit's render id, which the uploader's approval binds: "long" or "short-<n>". */
	renderId: string;
	parentId: string | null;
	shortIndex: number | null;
	/** Long-form only: how many Shorts this week cuts from it. */
	shortIds: string[];
	slot: Slot;
	languages: Languages;
	research: {file: string | null; ready: boolean};
	paths: ItemPaths;
};

export type WeekPlan = {
	version: 1;
	kind: 'zoora-weekly-batch-plan';
	week: string;
	weekStart: string;
	weekEnd: string;
	timeZone: string;
	status: string;
	generatedAt: string;
	inputs: {config: {path: string; sha256: string}; backlogs: Array<{channel: string; path: string; sha256: string}>};
	items: PlanItem[];
	/** Ideas the plan pinned to this week in the backlogs (written unless --dry-run). */
	pinned: Array<{channel: string; ideaId: string}>;
	warnings: string[];
};
