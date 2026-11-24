/**
 * Types shared inside the dashboard. The unit is VideoMetrics from src/types.ts; DashboardVideo adds
 * a few columns the dashboard needs (recorded in README.md as additions to metrics.csv).
 */
import type {Source, VideoMetrics} from '../../src/types.ts';

export type Issue = {level: 'error' | 'warning' | 'note'; where: string; message: string};

/** An amount in a currency that has no USD rate in the payout config, kept as reported. */
export type Money = {currency: string; amount: number};

/** One video from a YouTube Studio "Content" export (Advanced mode -> Export current view). */
export type StudioVideo = {
	videoId: string;
	title: string | null;
	publishedAt: string | null; // YYYY-MM-DD
	durationSec: number | null;
	contentType: 'long' | 'short' | null; // only when the export has a content-type column
	views: number | null;
	engagedViews: number | null;
	watchTimeHours: number | null;
	impressions: number | null;
	ctr: number | null; // 0..1
	avgViewDurationSec: number | null;
	avgPercentViewed: number | null; // 0..1, can be above 1 when viewers rewatch
	subscribersNet: number | null; // Studio's "Subscribers" column is gained minus lost
	subscribersGained: number | null;
	subscribersLost: number | null;
	revenue: Money | null; // "Estimated revenue (USD)": the currency comes from the header
};

/** One video from the YouTube Analytics API v2 (reports.query, dimensions=video,creatorContentType). */
export type ApiVideo = {
	videoId: string;
	format: 'long' | 'short' | null;
	views: number;
	estimatedMinutesWatched: number | null;
	avgViewDurationSec: number | null;
	avgPercentViewed: number | null; // 0..1
	subscribersGained: number | null;
	subscribersLost: number | null;
	revenueUsd: number | null; // estimatedRevenue, requested in USD; null unless --api-revenue
};

/** Human, de-duplicated redirects (the hub's rule) for one video, offer and source. */
export type ClickCount = {videoId: string | null; offerId: string; source: Source | null; clicks: number};

/** Human requests to /go per offer and outcome (not de-duplicated). Only the DB and the raw log have these. */
export type OutcomeCount = {offerId: string; outcome: string; requests: number};

export type HubClicks = {
	origin: string; // where the numbers came from, for the data notes
	clicks: ClickCount[];
	outcomes: OutcomeCount[] | null;
};

/** One affiliate payout row after the programme's column mapping. */
export type PayoutRow = {
	programme: string;
	file: string;
	line: number;
	date: string | null; // YYYY-MM-DD
	offerId: string | null;
	videoId: string | null; // from the sub-id "<videoId>.<source>"; null when the row has none
	source: Source | null;
	conversions: number;
	amount: number;
	currency: string;
};

/** Owner-maintained facts about a video (videos.csv): its format, topic tags and other ids. */
export type CatalogEntry = {
	videoId: string;
	aliases: string[];
	title: string | null;
	channel: string | null;
	format: 'long' | 'short' | null;
	tags: string[];
	publishedAt: string | null;
};

/** The part of a publish kit (kit.json) the dashboard reads: the slug -> YouTube id link. */
export type KitInfo = {channel: string; slug: string; youtubeVideoId: string | null; title: string; format: 'long' | 'short' | null; file: string};

export type FormatSource = 'catalog' | 'api' | 'studio' | 'kit' | 'duration' | 'default';

/** metrics.csv row: VideoMetrics plus the dashboard's own columns. */
export type DashboardVideo = VideoMetrics & {
	tags: string[];
	formatSource: FormatSource;
	engagedViews: number | null;
	subscribersNet: number | null;
	/** Clicks from YouTube surfaces (s=yt, s=shorts) or with no source: the numerator of clicks per 1K views. */
	hubClicksYoutube: number;
	/** Payout amounts in currencies without a configured USD rate, not included in affiliateRevenueUsd. */
	affiliateRevenueOther: Money[];
	/** YouTube revenue in a currency other than USD (Studio set to another currency), not converted. */
	adRevenueOther: Money | null;
	/** adRevenueUsd + affiliateRevenueUsd when at least one is known. */
	revenueUsd: number | null;
	inputs: string[]; // which inputs had data for this video
};

/** Clicks and payouts the dashboard could not tie to a known video. */
export type Unattributed = {
	noVideoClicks: number; // links without ?v=
	unknownVideoClicks: Map<string, number>; // ?v= values that match no known video
	noVideoPayouts: {conversions: number; usd: number; other: Money[]};
	unknownVideoPayouts: Map<string, {conversions: number; usd: number; other: Money[]}>;
};

export type OfferSummary = {
	offerId: string;
	clicks: number; // de-duplicated human redirects, every source and video
	conversions: number | null; // null when no payout file was imported
	revenueUsd: number | null;
	revenueOther: Money[];
	requests: number | null; // human requests to /go, any outcome (DB or raw log only)
	blocked: number | null; // of those, blocked by region or unknown region
};
