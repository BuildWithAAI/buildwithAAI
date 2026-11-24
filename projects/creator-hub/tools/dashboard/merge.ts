/**
 * Merges every input into one row per video (DashboardVideo = VideoMetrics + a few columns).
 *
 * Ids: hub links carry ?v=<YouTube id> or ?v=<episode slug>; payouts carry the same value in the
 * sub-id. Publish kits (slug -> youtubeVideoId) and the aliases column of videos.csv map slugs to the
 * published video, so everything lands on one row. When an exact id is unknown, a case-insensitive
 * match is used if it is unambiguous (some networks lower-case sub-ids).
 *
 * Precedence: the API's numbers win over the Studio CSV for the fields both have; impressions and
 * CTR come only from the CSV. Missing data stays null, never 0 (except hubClicks, which the contract
 * defines as a count).
 */
import type {Source} from '../../src/types.ts';
import type {ApiVideo, CatalogEntry, DashboardVideo, FormatSource, HubClicks, Issue, KitInfo, Money, OfferSummary, PayoutRow, StudioVideo, Unattributed} from './model.ts';
import {addMoney, cents, type Rate} from './payouts.ts';

/** Videos up to this length (seconds) are taken to be Shorts when nothing else says so (Shorts can be 3 minutes). */
export const SHORT_MAX_SECONDS = 180;
/** Sources that count as clicks from YouTube viewers, for clicks per 1K YouTube views. */
export const YOUTUBE_SOURCES: readonly (Source | null)[] = ['yt', 'shorts', null];

export type MergeInput = {
	channel: string;
	studio: StudioVideo[][]; // one list per file, in the order given
	api: ApiVideo[] | null;
	catalog: CatalogEntry[] | null;
	kits: KitInfo[];
	hub: HubClicks | null;
	payouts: PayoutRow[] | null; // null when no payout file was imported
	/** Offer ids the imported programmes report on (config offerIds/defaultOfferId). Other offers get null, not 0. */
	coveredOffers?: Set<string>;
	rates: Record<string, Rate>;
};

export type MergeResult = {videos: DashboardVideo[]; offers: OfferSummary[]; unattributed: Unattributed; issues: Issue[]};

const round = (value: number | null, places: number): number | null => (value === null ? null : Math.round(value * 10 ** places) / 10 ** places);

type Money2 = {usd: number; other: Money[]; conversions: number};
const emptyMoney = (): Money2 => ({usd: 0, other: [], conversions: 0});

export const mergeInputs = (input: MergeInput): MergeResult => {
	const issues: Issue[] = [];
	const note = (message: string): void => void issues.push({level: 'note', where: 'merge', message});
	const warn = (message: string): void => void issues.push({level: 'warning', where: 'merge', message});

	const catalog = (input.catalog ?? []).filter((entry) => !entry.channel || entry.channel === input.channel);
	const otherChannel = (input.catalog ?? []).length - catalog.length;
	if (otherChannel > 0) note(`${otherChannel} videos.csv row(s) belong to another channel and were left out (this run: ${input.channel})`);
	const kits = input.kits.filter((kit) => kit.channel === input.channel);
	if (kits.length < input.kits.length) note(`${input.kits.length - kits.length} publish kit(s) belong to another channel and were left out`);

	// Aliases: slug -> YouTube id (kits), alias -> video_id (videos.csv).
	const alias = new Map<string, string>();
	const link = (from: string, to: string, where: string): void => {
		if (from === to) return;
		const existing = alias.get(from);
		if (existing && existing !== to) warn(`${where}: "${from}" already points to ${existing}; keeping that`);
		else alias.set(from, to);
	};
	for (const kit of kits) if (kit.youtubeVideoId) link(kit.slug, kit.youtubeVideoId, kit.file);
	for (const entry of catalog) for (const a of entry.aliases) link(a, entry.videoId, 'videos.csv');
	const canon = (id: string): string => {
		let current = id;
		for (let hop = 0; hop < 4; hop++) {
			const next = alias.get(current);
			if (!next || next === id) break;
			current = next;
		}
		return current;
	};

	// Studio rows: a later file replaces an earlier one for the same video.
	const studio = new Map<string, StudioVideo>();
	let replaced = 0;
	for (const file of input.studio) {
		for (const video of file) {
			if (studio.has(video.videoId)) replaced++;
			studio.set(video.videoId, video);
		}
	}
	if (replaced > 0) note(`${replaced} video(s) appear in more than one Studio export; the later file was used`);
	const api = new Map((input.api ?? []).map((v) => [v.videoId, v]));
	const catalogById = new Map<string, CatalogEntry>();
	for (const entry of catalog) {
		const id = canon(entry.videoId);
		if (catalogById.has(id)) warn(`videos.csv lists ${id} more than once (directly or through an alias); the first row is used`);
		else catalogById.set(id, entry);
	}
	const kitById = new Map<string, KitInfo>();
	for (const kit of kits) kitById.set(canon(kit.slug), kit);

	const known = new Set<string>([...studio.keys(), ...api.keys(), ...catalogById.keys(), ...kitById.keys()]);
	const lowerIndex = new Map<string, string | null>();
	for (const id of known) {
		const key = id.toLowerCase();
		lowerIndex.set(key, lowerIndex.has(key) && lowerIndex.get(key) !== id ? null : id);
	}
	const caseMatched = new Set<string>();
	const resolve = (raw: string): string | null => {
		const id = canon(raw);
		if (known.has(id)) return id;
		const loose = lowerIndex.get(raw.toLowerCase()) ?? lowerIndex.get(id.toLowerCase());
		if (loose) {
			caseMatched.add(raw);
			return loose;
		}
		return null;
	};

	const unattributed: Unattributed = {
		noVideoClicks: 0,
		unknownVideoClicks: new Map(),
		noVideoPayouts: {conversions: 0, usd: 0, other: []},
		unknownVideoPayouts: new Map(),
	};
	const covered = new Set([...(input.coveredOffers ?? []), ...(input.payouts ?? []).map((row) => row.offerId ?? '(no offer id)')]);
	const offers = new Map<string, OfferSummary>();
	const offer = (id: string): OfferSummary => {
		let summary = offers.get(id);
		if (!summary) {
			const reported = input.payouts !== null && covered.has(id);
			summary = {offerId: id, clicks: 0, conversions: reported ? 0 : null, revenueUsd: reported ? 0 : null, revenueOther: [], requests: null, blocked: null};
			offers.set(id, summary);
		}
		return summary;
	};

	// Hub clicks.
	const clicks = new Map<string, {all: number; youtube: number}>();
	for (const click of input.hub?.clicks ?? []) {
		offer(click.offerId).clicks += click.clicks;
		if (click.videoId === null) {
			unattributed.noVideoClicks += click.clicks;
			continue;
		}
		const id = resolve(click.videoId);
		if (id === null) {
			unattributed.unknownVideoClicks.set(click.videoId, (unattributed.unknownVideoClicks.get(click.videoId) ?? 0) + click.clicks);
			continue;
		}
		const counts = clicks.get(id) ?? {all: 0, youtube: 0};
		counts.all += click.clicks;
		if (YOUTUBE_SOURCES.includes(click.source)) counts.youtube += click.clicks;
		clicks.set(id, counts);
	}
	for (const outcome of input.hub?.outcomes ?? []) {
		const summary = offer(outcome.offerId);
		summary.requests = (summary.requests ?? 0) + outcome.requests;
		if (outcome.outcome === 'blocked_region' || outcome.outcome === 'blocked_unknown_region') summary.blocked = (summary.blocked ?? 0) + outcome.requests;
		else summary.blocked ??= 0;
	}

	// Payouts.
	const payouts = new Map<string, Money2>();
	for (const row of input.payouts ?? []) {
		const summary = offer(row.offerId ?? '(no offer id)');
		summary.conversions = (summary.conversions ?? 0) + row.conversions;
		const offerMoney = {usd: summary.revenueUsd ?? 0, other: summary.revenueOther};
		addMoney(offerMoney, row.amount, row.currency, input.rates);
		summary.revenueUsd = offerMoney.usd;
		let target: Money2 | {conversions: number; usd: number; other: Money[]};
		if (row.videoId === null) target = unattributed.noVideoPayouts;
		else {
			const id = resolve(row.videoId);
			if (id === null) {
				target = unattributed.unknownVideoPayouts.get(row.videoId) ?? emptyMoney();
				unattributed.unknownVideoPayouts.set(row.videoId, target);
			} else {
				target = payouts.get(id) ?? emptyMoney();
				payouts.set(id, target);
			}
		}
		target.conversions += row.conversions;
		addMoney(target, row.amount, row.currency, input.rates);
	}
	if (caseMatched.size > 0) note(`ids matched without regard to upper/lower case: ${[...caseMatched].slice(0, 10).join(', ')}`);

	// One row per known video.
	const videos: DashboardVideo[] = [];
	for (const id of known) {
		const s = studio.get(id);
		const a = api.get(id);
		const c = catalogById.get(id);
		const k = kitById.get(id);
		let format: 'long' | 'short' = 'long';
		let formatSource: FormatSource = 'default';
		if (c?.format) [format, formatSource] = [c.format, 'catalog'];
		else if (a?.format) [format, formatSource] = [a.format, 'api'];
		else if (s?.contentType) [format, formatSource] = [s.contentType, 'studio'];
		else if (k?.format) [format, formatSource] = [k.format, 'kit'];
		else if (s?.durationSec !== null && s?.durationSec !== undefined) [format, formatSource] = [s.durationSec <= SHORT_MAX_SECONDS ? 'short' : 'long', 'duration'];

		let adRevenueUsd: number | null = a?.revenueUsd ?? null;
		let adRevenueOther: Money | null = null;
		if (adRevenueUsd === null && s?.revenue) {
			const money = {usd: 0, other: [] as Money[]};
			addMoney(money, s.revenue.amount, s.revenue.currency, input.rates);
			if (money.other.length > 0) adRevenueOther = money.other[0]!;
			else adRevenueUsd = money.usd;
		}
		const paid = payouts.get(id);
		const affiliateRevenueUsd = input.payouts === null ? null : cents(paid?.usd ?? 0);
		const subscribersNet =
			a && a.subscribersGained !== null && a.subscribersLost !== null
				? a.subscribersGained - a.subscribersLost
				: (s?.subscribersNet ?? (s && s.subscribersGained !== null && s.subscribersLost !== null ? s.subscribersGained - s.subscribersLost : null));
		const hub = clicks.get(id);
		const inputsUsed = [
			s && 'studio',
			a && 'api',
			c && 'videos.csv',
			k && 'kit',
			hub && 'hub',
			paid && 'payouts',
		].filter((x): x is string => typeof x === 'string');
		adRevenueUsd = adRevenueUsd === null ? null : cents(adRevenueUsd);
		videos.push({
			videoId: id,
			title: c?.title ?? s?.title ?? k?.title ?? id,
			channel: input.channel,
			publishedAt: s?.publishedAt ?? c?.publishedAt ?? null,
			format,
			views: a?.views ?? s?.views ?? null,
			impressions: s?.impressions ?? null,
			ctr: round(s?.ctr ?? null, 4),
			avgViewDurationSec: round(a?.avgViewDurationSec ?? s?.avgViewDurationSec ?? null, 1),
			avgPercentViewed: round(a?.avgPercentViewed ?? s?.avgPercentViewed ?? null, 4),
			subscribersGained: a?.subscribersGained ?? s?.subscribersGained ?? null,
			adRevenueUsd,
			hubClicks: hub?.all ?? 0,
			conversions: input.payouts === null ? null : (paid?.conversions ?? 0),
			affiliateRevenueUsd,
			tags: c?.tags ?? [],
			formatSource,
			engagedViews: s?.engagedViews ?? null,
			subscribersNet,
			hubClicksYoutube: hub?.youtube ?? 0,
			affiliateRevenueOther: paid?.other.filter((m) => cents(m.amount) !== 0) ?? [],
			adRevenueOther,
			revenueUsd: adRevenueUsd === null && affiliateRevenueUsd === null ? null : cents((adRevenueUsd ?? 0) + (affiliateRevenueUsd ?? 0)),
			inputs: inputsUsed,
		});
	}
	videos.sort((x, y) => (y.publishedAt ?? '').localeCompare(x.publishedAt ?? '') || (y.views ?? -1) - (x.views ?? -1) || x.videoId.localeCompare(y.videoId));

	const guessed = videos.filter((v) => v.formatSource === 'duration' || v.formatSource === 'default');
	if (guessed.length > 0) {
		note(`format guessed for ${guessed.length} video(s) (${guessed.slice(0, 5).map((v) => v.videoId).join(', ')}${guessed.length > 5 ? ', ...' : ''}): set "format" in videos.csv`);
	}
	const offerList = [...offers.values()]
		.map((o) => ({...o, revenueUsd: o.revenueUsd === null ? null : cents(o.revenueUsd), revenueOther: o.revenueOther.filter((m) => cents(m.amount) !== 0)}))
		.sort((x, y) => y.clicks - x.clicks || x.offerId.localeCompare(y.offerId));
	return {videos, offers: offerList, unattributed, issues};
};
