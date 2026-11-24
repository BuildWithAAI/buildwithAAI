/**
 * Types for the publish kit. The creator-hub contracts (PublishKit, Offer, Platform, Source) are imported as TYPES
 * ONLY from creator-hub/src/types.ts, the shared contract file, so nothing from the hub runs here.
 */
import type {Offer, OfferRegistry, Platform, PublishKit, Relationship, Source} from '../../../creator-hub/src/types.ts';

export type {Offer, OfferRegistry, Platform, PublishKit, Relationship, Source};

/** A yes/no setting with the reason it was chosen (madeForKids, containsSyntheticMedia, paidPromotion). */
export type Decision = {value: boolean; reason: string};

/** content/<channel>/<slug>/episode.json, version 1. Documented field by field in README.md. */
export type EpisodeFile = {
	version: 1;
	channel: string;
	slug: string;
	lang?: string;
	titleOptions: string[];
	title?: string;
	summary: string;
	youtubeVideoId?: string | null;
	scenes: EpisodeSceneFile[];
	sources?: {title: string; url: string}[];
	offers?: string[];
	hashtags?: string[];
	tags?: string[];
	cta: string;
	disclosures?: string[];
	madeForKids?: Decision;
	containsSyntheticMedia?: Decision;
	paidPromotion?: Decision;
	shortCuts: ShortCutFile[];
	render?: RenderFile;
};

export type EpisodeSceneFile = {
	id: string;
	chapter?: string;
	durationSec?: number;
	start?: string | number;
	offers?: string[];
};

export type ShortCutFile = {id?: string; from: string; to: string; title: string; hook?: string};

/** Thumbnail text and art come from the storyboard (or the custom composition), not from episode.json. */
export type RenderFile = {entry?: string; composition?: string; shortComposition?: string; thumbnailComposition?: string; thumbnails?: number};

/** Remotion's Caption type (@remotion/captions 4.0.541), redeclared so this tool has no runtime dependency. */
export type Caption = {
	text: string;
	startMs: number;
	endMs: number;
	timestampMs: number | null;
	confidence: number | null;
	pageBreakAfter?: boolean;
};

/** The subset of the voice step's timeline.json (src/episode/types.ts, Timeline) the kit reads. */
export type TimelineInput = {totalMs: number; scenes: {id: string; startMs: number; durationMs: number}[]; mock?: boolean};

/** content/<channel>/channel.json: only the fields used here. */
export type ChannelInfo = {displayName: string; handle: string | null};

export type Scene = {id: string; chapter: string | null; offers: string[]; startSec: number; endSec: number};

export type Short = {
	n: number; // 1-based, used in file names (shorts-<n>.txt) and render ids (short-<n>)
	id: string; // shortId for an engine composition (defaults to "short-<n>")
	title: string;
	hook: string;
	sceneIds: string[];
	startSec: number;
	endSec: number;
	offers: string[]; // offer ids promoted in this Short's scenes
};

/** A validated episode with every default applied. */
export type Episode = {
	channel: string;
	slug: string;
	lang: string;
	title: string;
	titleOptions: string[];
	summary: string;
	youtubeVideoId: string | null;
	scenes: Scene[];
	totalSec: number;
	timing: 'timeline' | 'episode';
	sources: {title: string; url: string}[];
	offers: string[];
	hashtags: string[]; // without "#"
	tags: string[];
	cta: string;
	disclosures: string[];
	madeForKids: Decision & {defaulted: boolean};
	containsSyntheticMedia: Decision & {defaulted: boolean};
	paidPromotion: Decision | null;
	shorts: Short[];
	render: {entry: string; composition: string; shortComposition: string | null; thumbnailComposition: string; thumbnails: number};
	captions: Caption[] | null;
	channelInfo: ChannelInfo;
	notes: string[];
};

/** An episode offer looked up in the registry. */
export type ResolvedOffer = {
	id: string;
	offer: Offer;
	disclosure: string; // the registry disclosure, plus the risk line for exchanges that lack one
	restricted: boolean; // blocked or allow-listed countries, or unknownCountry "block"
	live: boolean; // active and not expired at generation time
};
