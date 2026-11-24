/**
 * Types for the asset multiplier. The episode contracts (Storyboard, Timeline) and the creator-hub contracts
 * (PublishKit, Offer) are imported as TYPES ONLY, so nothing from those workflows runs here.
 */
import type {Lang, Source, Storyboard, StoryboardScene, Timeline, TimelineScene, TimelineWord} from '../../../src/episode/types.ts';
import type {Offer, OfferRegistry, PublishKit} from '../../../../creator-hub/src/types.ts';

export type {Lang, Source, Storyboard, StoryboardScene, Timeline, TimelineScene, TimelineWord, Offer, OfferRegistry, PublishKit};

/** Optional fields other workflows add to a storyboard (scripts/news/lib/types.ts: NewsStoryboard). Read leniently. */
export type DevelopingLabel = boolean | string | {label?: string; asOf?: string; note?: string};
export type NewsFormat = 'daily-short' | 'what-we-know' | 'weekly-roundup' | 'explainer';
export type EpisodeStoryboard = Storyboard & {news?: {format?: NewsFormat; developing?: DevelopingLabel}; developing?: DevelopingLabel};

/** The voice step's optional additions (scripts/voice/timeline-additions.ts). */
export type EpisodeTimeline = Timeline & {narration?: string};

/** content/<channel>/corrections.json (contract: scripts/news/lib/types.ts, CorrectionsFile). Only the fields used here. */
export type Correction = {
	id: string;
	slug: string;
	date: string;
	correct: string;
	sourceIds: string[];
	wrong?: string;
	timestamp?: string;
	status: 'pending' | 'pinned';
	sources?: Array<{id: string; url: string; title?: string; publisher?: string}>;
};

/**
 * Optional per-episode sidecar, owned by the asset tools: content/<channel>/<slug>/assets.json (all languages) and
 * assets.<lang>.json (one language, wins over assets.json). Every field is optional. Documented in docs/ASSETS.md.
 */
export type AssetsSidecar = {
	summary?: string;
	takeaways?: string[];
	youtubeVideoId?: string;
	publishedAt?: string; // YYYY-MM-DD or ISO timestamp: the video's publish time (JSON-LD uploadDate, podcast pubDate)
	podcast?: {skip?: boolean; season?: number; episode?: number; title?: string};
	social?: {hook?: string; hashtags?: string[]};
};

export type AssetStatus = 'ok' | 'draft' | 'blocked' | 'skipped' | 'pending' | 'error';

export type CheckLevel = 'error' | 'warning' | 'info';

export type Check = {id: string; ok: boolean; level: CheckLevel; detail: string};

export type AssetFile = {path: string; bytes: number; sha256: string};

export type AssetRecord = {
	id: string; // article | podcast | social-x | social-telegram | social-linkedin | newsletter
	kind: 'article' | 'podcast' | 'social' | 'newsletter';
	status: AssetStatus;
	summary: string;
	files: AssetFile[];
	checks: Check[];
	chars?: Record<string, number>;
	extra?: Record<string, unknown>;
};

export type Manifest = {
	version: 1;
	tool: 'video-studio/scripts/assets';
	channel: string;
	slug: string;
	lang: Lang;
	generatedAt: string;
	inputs: Record<string, {path: string; sha256: string | null}>;
	status: AssetStatus; // the worst asset status (error > blocked > pending > draft > ok > skipped)
	assets: AssetRecord[];
	lint: {errors: number; warnings: number};
	ownerActions: string[];
};
