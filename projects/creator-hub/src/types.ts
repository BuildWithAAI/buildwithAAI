/**
 * Shared contracts for every creator-hub module (v1, 2026-11-24).
 * Runtime: Node >= 22.18 runs these .ts files directly (type stripping), so use only
 * erasable TypeScript: no enums, namespaces or parameter properties.
 */

/** ISO 3166-1 alpha-2 country code, upper case ("US", "GB"). */
export type CountryCode = string;

export type OfferCategory = 'security' | 'tools' | 'exchange' | 'education' | 'own-product' | 'other';
export type Relationship = 'affiliate' | 'referral' | 'own-product' | 'sponsor';

/** One promotable destination. Served at /go/<id>. */
export type Offer = {
	id: string; // slug [a-z0-9-]{2,40}, used in /go/<id>
	name: string; // display name
	url: string; // destination https URL (affiliate/referral link); never shown before region checks
	category: OfferCategory;
	relationship: Relationship;
	/** Short FTC-style disclosure used in descriptions and on /disclosures, e.g. "Affiliate link: I earn a commission if you sign up." */
	disclosure: string;
	/** Countries where this offer must NOT be shown or redirected (e.g. exchange not licensed there). */
	blockedCountries: CountryCode[];
	/** If set and non-empty, ONLY these countries may be redirected. */
	allowedCountries?: CountryCode[];
	/** What to do when the visitor's country cannot be determined. Restricted/financial offers MUST use 'block'. */
	unknownCountry: 'allow' | 'block';
	/**
	 * Added 2026-11-24 (optional): true for any offer that promotes a financial product (staking, yield, lending,
	 * trading, signals, savings), whatever its category. Such offers, like category 'exchange', must use
	 * unknownCountry 'block' and list blockedCountries or allowedCountries (in the UK a crypto financial
	 * promotion is restricted by law). Omitted means false.
	 */
	financialPromotion?: boolean;
	active: boolean;
	expires?: string; // ISO date; after it the offer behaves as inactive
	termsUrl?: string; // programme terms to re-check before each campaign
	restrictedReason?: string; // plain-language reason shown on the "not available in your region" page
	alternatives?: string[]; // offer ids to suggest when this one is blocked
	/**
	 * If the programme supports sub-IDs, the destination query parameter that carries our attribution
	 * (e.g. "subid"). The hub appends `${subIdParam}=<videoId>.<source>` so payouts can be tied to a video.
	 */
	subIdParam?: string;
	notes?: string;
};

export type OfferRegistry = { version: 1; offers: Offer[] };

/** Traffic source, passed as ?s= on hub links. */
export type Source = 'yt' | 'shorts' | 'tiktok' | 'reels' | 'x' | 'email' | 'bio' | 'site' | 'other';

export type ClickOutcome = 'redirected' | 'blocked_region' | 'blocked_unknown_region' | 'inactive' | 'not_found';

/** One row of the clicks table (no raw IP or cookies are ever stored). */
export type ClickEvent = {
	ts: number; // unix ms
	offerId: string;
	videoId: string | null; // ?v= (YouTube video id or internal episode slug)
	source: Source | null;
	country: CountryCode | null;
	visitorHash: string; // HMAC-SHA256(dailySalt, ip + ua), truncated; for de-duplication only
	isBot: boolean;
	outcome: ClickOutcome;
	referrerHost: string | null;
};

/** Video-service order request from the /studio page. */
export type OrderRequest = {
	id: string; // uuid
	ts: number;
	name: string;
	email: string;
	company: string | null;
	projectUrl: string | null;
	packageId: string;
	budget: string | null;
	deadline: string | null;
	message: string;
	consent: boolean; // agreed to be contacted + to the terms
	status: 'new' | 'contacted' | 'won' | 'lost' | 'spam';
};

/** One video's combined metrics row (metrics.csv, the dashboard's unit). */
export type VideoMetrics = {
	videoId: string;
	title: string;
	channel: string;
	publishedAt: string | null; // ISO date
	format: 'long' | 'short';
	views: number | null;
	impressions: number | null;
	ctr: number | null; // 0..1 impressions click-through rate
	avgViewDurationSec: number | null;
	avgPercentViewed: number | null; // 0..1
	subscribersGained: number | null;
	adRevenueUsd: number | null;
	hubClicks: number; // human, de-duplicated, redirected clicks attributed to this video
	conversions: number | null; // from affiliate payout imports
	affiliateRevenueUsd: number | null;
};

/** A platform the publish kit writes post text for. */
export type Platform = 'youtube' | 'shorts' | 'tiktok' | 'reels' | 'x' | 'instagram';

/**
 * Publish kit manifest: written by video-studio/scripts/publish-kit to
 * video-studio/out/publish/<channel>/<slug>/kit.json and read by tools/newsletter and tools/dashboard.
 */
export type PublishKit = {
	version: 1;
	channel: string; // e.g. "zoora-ai"
	slug: string; // episode slug, also used as videoId until a YouTube id exists
	youtubeVideoId: string | null;
	title: string; // chosen title (the owner picks from titleOptions)
	titleOptions: string[];
	summary: string; // 1-3 sentence plain summary (newsletter teaser)
	chapters: {start: string; title: string}[]; // "00:00" format, YouTube chapter rules applied
	sources: {title: string; url: string}[];
	offers: {id: string; hubUrl: string; disclosure: string}[];
	disclosures: string[]; // every disclosure line that must appear (description, pinned comment, on-screen, spoken)
	posts: Record<Platform, {text: string; charCount: number; limit: number; notes: string[]}>;
	captions: {srt: string | null; vtt: string | null};
	renders: {id: string; kind: 'long' | 'short' | 'thumbnail'; command: string; output: string}[];
	settings: {madeForKids: boolean; containsSyntheticMedia: boolean; paidPromotion: boolean; reasons: string[]};
	checks: {id: string; ok: boolean; detail: string}[];
	generatedAt: string; // ISO timestamp
};
