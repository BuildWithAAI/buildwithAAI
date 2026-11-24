/** Claim gate result types (pure). */
import type {Lang} from '../../../src/episode/types.ts';

export type Level = 'error' | 'warning';

export type Finding = {
	level: Level;
	/** Stable rule id, e.g. "unsourced-claim", "must-not-say", "income-claim", "private-name", "source-unverified". */
	rule: string;
	/** Where: "s02 · narration", "s04 · onScreen.steps[1]", "title", "thumbnails[a]", "sources[x]", "research.md". */
	where: string;
	/** Scene id, when the finding is in a scene. */
	scene?: string;
	/** The sentence or text, with private names and wallet-like strings redacted. */
	text?: string;
	message: string;
	/** How to fix it. */
	fix: string;
};

/** One narration sentence that cites sources (the claim map in the report). */
export type ClaimRow = {scene: string; sentence: string; ids: string[]; signals: string[]};

export type WaiverRow = {scene: string; rule: 'factual' | 'income'; match: string; reason: string; used: boolean};

export type SourceRow = {id: string; title: string; url: string; accessed: string; status: string; citedBy: string[]};

export type MnsSummary = {
	file: string | null;
	found: boolean;
	rules: number;
	patterns: number;
	manual: Array<{id: string; line: number; coverage: 'partial' | 'manual'; text: string}>;
	/** Translations (added 2026-11-24): the language the research phrases are in, and the "Must not say (<lang>)" rules. */
	language?: Lang;
	localRules?: number;
	localPatterns?: number;
};

export type ClaimReport = {
	tool: 'claims/check';
	version: 1;
	channel: string;
	slug: string;
	lang: Lang;
	file: string;
	checkedAt: string;
	pass: boolean;
	errors: number;
	warnings: number;
	findings: Finding[];
	claims: ClaimRow[];
	waivers: WaiverRow[];
	sources: SourceRow[];
	mustNotSay: MnsSummary;
	/** `skipped`: --no-names (a warning); no path and not skipped: the list is missing (an error). */
	namesList: {path: string | null; count: number; skipped?: boolean};
	/** Translations (added 2026-11-24): the record as the dub validator reads it; `badge` = the render shows MACHINE TRANSLATION. */
	translation?: {status: string; method: string | null; reviewed: boolean; badge: boolean};
	notes: string[];
};
