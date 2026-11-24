/**
 * Transparent rules that turn the merged numbers into "double down", "test" and "cut" calls for
 * formats, topics (the tags column of videos.csv) and offers. Every call carries the numbers that
 * triggered it. The rules describe past results only; they never predict or promise earnings.
 */
import {formatMoney} from './payouts.ts';
import {pooledPer1k, ratio} from './stats.ts';
import {UNMAPPED_OFFER, type DashboardVideo, type OfferSummary} from './model.ts';

export const RULES = {
	milestoneEvery: 10, // recommendations.md is rewritten at 10, 20, 30 ... videos with YouTube data
	minVideos: 10, // below this, no group is judged at all
	minGroupVideos: 3,
	minGroupViews: 1000,
	doubleDown: 1.25, // group rate at least 125% of the comparison rate
	cut: 0.5, // group rate at most 50% of the comparison rate
	offerMinClicks: 30,
	offerCutClicks: 100, // this many clicks and no conversion -> cut
	blockedShare: 0.3, // region-blocked share of an offer's requests worth a note
	blockedMinRequests: 20,
} as const;

export type Verdict = 'double-down' | 'test' | 'cut' | 'steady' | 'too-early';
export type Finding = {dimension: 'format' | 'topic' | 'offer'; group: string; verdict: Verdict; reason: string};

export type MetricKey = 'revenue' | 'clicks' | 'subscribers';
export type Metric = {key: MetricKey; label: string; format: (value: number) => string; amount: (v: DashboardVideo) => number | null};

const n0 = (value: number): string => Math.round(value).toLocaleString('en-US');
const usd = (value: number): string => `$${value.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
const one = (value: number): string => value.toLocaleString('en-US', {minimumFractionDigits: 1, maximumFractionDigits: 1});
const times = (value: number): string => `${value.toFixed(2)}x`;

export const METRICS: Record<MetricKey, Metric> = {
	revenue: {key: 'revenue', label: 'revenue per 1,000 views (USD, YouTube + affiliate)', format: usd, amount: (v) => v.revenueUsd},
	clicks: {key: 'clicks', label: 'hub clicks from YouTube per 1,000 views', format: one, amount: (v) => v.hubClicksYoutube},
	subscribers: {key: 'subscribers', label: 'subscribers per 1,000 views', format: one, amount: (v) => v.subscribersGained ?? v.subscribersNet},
};

const hasViews = (v: DashboardVideo): boolean => v.views !== null && v.views > 0;

/** Revenue when any revenue is known, else hub clicks when hub data was loaded, else subscribers. */
export const chooseMetric = (videos: DashboardVideo[], hubLoaded: boolean): Metric | null => {
	const withViews = videos.filter(hasViews);
	if (withViews.some((v) => (v.revenueUsd ?? 0) > 0)) return METRICS.revenue;
	if (hubLoaded && withViews.some((v) => v.hubClicksYoutube > 0)) return METRICS.clicks;
	if (withViews.some((v) => (v.subscribersGained ?? v.subscribersNet) !== null)) return METRICS.subscribers;
	return null;
};

export type Report = {
	channel: string;
	videosWithData: number;
	sampleTooSmall: boolean;
	metric: Metric | null;
	channelRate: number | null;
	formatRates: {long: number | null; short: number | null};
	findings: Finding[];
	offers: (OfferSummary & {verdict: Verdict; reason: string})[];
	notes: string[];
};

const pooled = (videos: DashboardVideo[], metric: Metric) => pooledPer1k(videos.map((v) => ({amount: metric.amount(v), views: v.views})));

const judge = (rate: number | null, expected: number | null, videos: number, views: number, tooSmall: boolean): {verdict: Verdict; rule: string} => {
	const r = ratio(rate, expected);
	if (tooSmall) return {verdict: 'too-early', rule: `the channel has fewer than ${RULES.minVideos} videos with data`};
	if (r === null) return {verdict: 'too-early', rule: 'no comparison rate yet'};
	const enough = videos >= RULES.minGroupVideos && views >= RULES.minGroupViews;
	if (!enough) {
		return r >= RULES.doubleDown
			? {verdict: 'test', rule: `${times(r)} but only ${videos} video(s) and ${n0(views)} views: make ${Math.max(1, RULES.minGroupVideos - videos)} more to confirm`}
			: {verdict: 'too-early', rule: `needs ${RULES.minGroupVideos}+ videos and ${n0(RULES.minGroupViews)}+ views`};
	}
	if (r >= RULES.doubleDown) return {verdict: 'double-down', rule: `${times(r)}, at least ${RULES.doubleDown}x`};
	if (r <= RULES.cut) return {verdict: 'cut', rule: `${times(r)}, at most ${RULES.cut}x`};
	return {verdict: 'steady', rule: `${times(r)}, between ${RULES.cut}x and ${RULES.doubleDown}x`};
};

const mix = (videos: DashboardVideo[]): string => {
	const long = videos.filter((v) => v.format === 'long').length;
	const short = videos.length - long;
	return [long && `${long} long`, short && `${short} short`].filter(Boolean).join(', ');
};

export type ReportOptions = {
	channel: string;
	hubLoaded: boolean;
	/**
	 * Offer ids restricted by region in the offer registry (country lists or unknownCountry "block"), or
	 * null/undefined when no registry was read. Restricted offers are never promoted in videos, posts or
	 * emails, so they never get a "double down" call.
	 */
	restrictedOffers?: ReadonlySet<string> | null;
};

const HUB_ONLY = 'It is restricted by region, so keep it on the hub page only: do not name it in videos, posts or emails.';

export const buildReport = (videos: DashboardVideo[], offers: OfferSummary[], options: ReportOptions): Report => {
	const withViews = videos.filter(hasViews);
	const tooSmall = withViews.length < RULES.minVideos;
	const metric = chooseMetric(videos, options.hubLoaded);
	const findings: Finding[] = [];
	const notes: string[] = [];
	let channelRate: number | null = null;
	const formatRates: Report['formatRates'] = {long: null, short: null};

	if (metric) {
		channelRate = pooled(withViews, metric).rate;
		for (const format of ['long', 'short'] as const) formatRates[format] = pooled(withViews.filter((v) => v.format === format), metric).rate;

		for (const format of ['long', 'short'] as const) {
			const group = withViews.filter((v) => v.format === format);
			if (group.length === 0) continue;
			const p = pooled(group, metric);
			const {verdict, rule} = judge(p.rate, channelRate, p.n, p.views, tooSmall);
			const label = format === 'long' ? 'Long videos' : 'Shorts';
			// Context from the other metrics, so a format is never judged on one number alone.
			const context = (Object.values(METRICS) as Metric[])
				.filter((m) => m.key !== metric.key && (m.key !== 'clicks' || options.hubLoaded))
				.map((m) => ({m, group: pooled(group, m).rate, all: pooled(withViews, m).rate}))
				.filter((c) => c.group !== null && c.all !== null)
				.map((c) => `${c.m.format(c.group!)} ${c.m.label.replace(/ \(.*\)$/, '')} (channel ${c.m.format(c.all!)})`);
			findings.push({
				dimension: 'format',
				group: label,
				verdict,
				reason: `${p.rate === null ? 'no data' : metric.format(p.rate)} per 1K views over ${p.n} video(s) and ${n0(p.views)} views, vs ${channelRate === null ? 'n/a' : metric.format(channelRate)} for the whole channel. ${rule}.${context.length > 0 ? ` For context: ${context.join('; ')}.` : ''}`,
			});
		}

		const tags = [...new Set(withViews.flatMap((v) => v.tags))].sort();
		for (const tag of tags) {
			const group = withViews.filter((v) => v.tags.includes(tag) && metric.amount(v) !== null);
			if (group.length === 0) continue;
			const p = pooled(group, metric);
			// What the channel would earn per 1K views with this group's mix of long videos and Shorts.
			let expectedAmount = 0;
			let expectedViews = 0;
			for (const v of group) {
				const rate = formatRates[v.format] ?? channelRate;
				if (rate === null || v.views === null) continue;
				expectedAmount += (rate * v.views) / 1000;
				expectedViews += v.views;
			}
			const expected = expectedViews > 0 ? (expectedAmount / expectedViews) * 1000 : null;
			const {verdict, rule} = judge(p.rate, expected, p.n, p.views, tooSmall);
			findings.push({
				dimension: 'topic',
				group: tag,
				verdict,
				reason: `${p.rate === null ? 'no data' : metric.format(p.rate)} per 1K views over ${p.n} video(s) (${mix(group)}) and ${n0(p.views)} views, vs ${expected === null ? 'n/a' : metric.format(expected)} expected at channel rates for that mix of formats. ${rule}.`,
			});
		}
		const untagged = withViews.filter((v) => v.tags.length === 0).length;
		if (untagged > 0) notes.push(`${untagged} video(s) have no topic tags, so they are not in the topic comparison. Add tags in videos.csv.`);
	} else {
		notes.push('No revenue, hub clicks or subscriber numbers yet, so nothing can be compared.');
	}

	// Offers: earnings per click when payouts were imported, else conversion counts only.
	const judged = offers.filter((o) => o.offerId !== UNMAPPED_OFFER);
	const covered = judged.filter((o) => o.conversions !== null && o.clicks > 0);
	const totalClicks = covered.reduce((n, o) => n + o.clicks, 0);
	const totalUsd = covered.reduce((n, o) => n + (o.revenueUsd ?? 0), 0);
	const totalConversions = covered.reduce((n, o) => n + (o.conversions ?? 0), 0);
	const useRevenue = totalUsd > 0;
	const base = totalClicks > 0 ? (useRevenue ? totalUsd : totalConversions) / totalClicks : null;
	const offerRows = judged.map((o) => {
		let verdict: Verdict = 'too-early';
		let reason: string;
		if (o.conversions === null) reason = 'no payout file covers this offer yet';
		else if (tooSmall) reason = `the channel has fewer than ${RULES.minVideos} videos with data`;
		else {
			const value = o.clicks > 0 ? (useRevenue ? (o.revenueUsd ?? 0) : o.conversions) / o.clicks : null;
			const r = ratio(value, base);
			const what = useRevenue ? `${usd(value ?? 0)} per click vs ${usd(base ?? 0)} across offers` : `${((value ?? 0) * 100).toFixed(1)}% of clicks converted vs ${((base ?? 0) * 100).toFixed(1)}% across offers`;
			if (o.clicks >= RULES.offerCutClicks && o.conversions <= 0) {
				verdict = 'cut';
				reason = `${n0(o.clicks)} clicks and no conversion (rule: ${RULES.offerCutClicks}+ clicks, 0 conversions). Check the link, its region rules and whether it fits the audience.`;
			} else if (o.clicks < RULES.offerMinClicks) {
				verdict = o.conversions > 0 && r !== null && r >= RULES.doubleDown && !options.restrictedOffers?.has(o.offerId) ? 'test' : 'too-early';
				reason = `${n0(o.clicks)} clicks (needs ${RULES.offerMinClicks}+)${o.conversions > 0 ? `; ${what}` : ''}.${options.restrictedOffers?.has(o.offerId) ? ` ${HUB_ONLY}` : ''}`;
			} else if (r !== null && r >= RULES.doubleDown && options.restrictedOffers?.has(o.offerId)) {
				verdict = 'steady';
				reason = `${what}: ${times(r)}. ${HUB_ONLY}`;
			} else if (r !== null && r >= RULES.doubleDown) {
				verdict = 'double-down';
				reason = `${what}: ${times(r)} (rule: at least ${RULES.doubleDown}x with ${RULES.offerMinClicks}+ clicks). Mention it where it genuinely fits the topic, with its disclosure.${
					options.restrictedOffers ? '' : ' If the offer registry restricts it by region, keep it on the hub page only.'
				}`;
			} else if (r !== null && r <= RULES.cut) {
				verdict = 'cut';
				reason = `${what}: ${times(r)} (rule: at most ${RULES.cut}x with ${RULES.offerMinClicks}+ clicks).`;
			} else {
				verdict = 'steady';
				reason = r === null ? 'no comparison rate yet.' : `${what}: ${times(r)}.`;
			}
		}
		return {...o, verdict, reason};
	});
	for (const o of judged) {
		if (o.requests !== null && o.blocked !== null && o.requests >= RULES.blockedMinRequests && o.blocked / o.requests >= RULES.blockedShare) {
			notes.push(
				`Offer ${o.offerId}: ${Math.round((o.blocked / o.requests) * 100)}% of ${n0(o.requests)} human requests were blocked by region rules. Make sure it has alternatives set, and keep it on the hub page only: never name a region-restricted offer in videos, posts or emails.`,
			);
		}
	}
	const otherMoney = offers.flatMap((o) => o.revenueOther);
	if (otherMoney.length > 0) notes.push(`Payouts in currencies without a rate are not in the USD figures: ${formatMoney(otherMoney)}. Add a rate under "rates" in the payout config to include them.`);

	return {channel: options.channel, videosWithData: withViews.length, sampleTooSmall: tooSmall, metric, channelRate, formatRates, findings, offers: offerRows, notes};
};

// ---------------------------------------------------------------------------------------------
// Milestones: recommendations.md is rewritten every 10 videos, or on --force.

export type MilestoneState = {version: 1; channels: Record<string, {videoCount: number; generatedAt: string}>};

export const milestoneDue = (videoCount: number, lastCount: number | null, every: number = RULES.milestoneEvery): boolean =>
	videoCount >= every && Math.floor(videoCount / every) > Math.floor((lastCount ?? 0) / every);

export const nextMilestone = (videoCount: number, every: number = RULES.milestoneEvery): number => (Math.floor(videoCount / every) + 1) * every;

export const parseState = (input: unknown): MilestoneState => {
	const empty: MilestoneState = {version: 1, channels: {}};
	if (typeof input !== 'object' || input === null || (input as {version?: unknown}).version !== 1) return empty;
	const channels = (input as {channels?: unknown}).channels;
	if (typeof channels !== 'object' || channels === null) return empty;
	const out: MilestoneState = {version: 1, channels: {}};
	for (const [key, value] of Object.entries(channels)) {
		const v = value as {videoCount?: unknown; generatedAt?: unknown};
		if (typeof v?.videoCount === 'number' && Number.isInteger(v.videoCount) && v.videoCount >= 0 && typeof v.generatedAt === 'string') out.channels[key] = {videoCount: v.videoCount, generatedAt: v.generatedAt};
	}
	return out;
};

// ---------------------------------------------------------------------------------------------
// Markdown

/** Backslash-escapes characters that Markdown would treat as formatting in titles and tags. */
export const mdEscape = (text: string): string => text.replace(/[\r\n]+/g, ' ').replace(/([\\`*_{}[\]()#+!|<>~])/g, '\\$1');

/** Text generated here, made safe for a table cell: only pipes and line breaks matter. */
const mdCell = (text: string): string => text.replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|');

const SECTIONS: {verdict: Verdict; title: string; intro: string}[] = [
	{verdict: 'double-down', title: 'Double down', intro: 'Clearly above the comparison rate, with enough videos and views to take seriously.'},
	{verdict: 'test', title: 'Test', intro: 'Promising, but too few videos or views to be sure. Make a few more before deciding.'},
	{verdict: 'cut', title: 'Cut or rework', intro: 'Clearly below the comparison rate with enough data. Rework the angle or drop it.'},
	{verdict: 'steady', title: 'Steady', intro: 'Within the normal range. No change needed.'},
	{verdict: 'too-early', title: 'Too early to call', intro: 'Not enough data for any call.'},
];

export const renderRecommendations = (report: Report, options: {generatedAt: string; brandName: string}): string => {
	const lines: string[] = [];
	const push = (...more: string[]): void => void lines.push(...more);
	push(`# What to double down on: ${mdEscape(options.brandName)} (${mdEscape(report.channel)})`, '');
	push(`Generated ${options.generatedAt} from ${report.videosWithData} video(s) with YouTube data. Every call below shows the numbers that triggered it; the rules are listed at the end.`, '');
	push('> These are patterns in past results, not predictions. Nothing here promises future views or earnings, and estimated revenue can still change when YouTube and the affiliate networks finalise it.', '');
	if (report.sampleTooSmall) {
		push(
			'## Sample too small to conclude anything',
			'',
			`Only ${report.videosWithData} video(s) have YouTube data. The rules need at least ${RULES.minVideos}, and each group needs ${RULES.minGroupVideos} videos and ${RULES.minGroupViews.toLocaleString('en-US')} views. The numbers below are for reference only; no call is made.`,
			'',
		);
	}
	if (report.metric) {
		const m = report.metric;
		const rate = (value: number | null): string => (value === null ? 'n/a' : m.format(value));
		push(`## Compared on ${m.label}`, '', `Whole channel: ${rate(report.channelRate)}. Long videos: ${rate(report.formatRates.long)}. Shorts: ${rate(report.formatRates.short)}.`, '');
		if (m.key !== 'revenue') push(`No revenue figures yet, so groups are compared on ${m.label} instead.`, '');
	}
	for (const section of SECTIONS) {
		const items = report.findings.filter((f) => f.verdict === section.verdict);
		if (items.length === 0) continue;
		push(`## ${section.title}`, '', section.intro, '');
		for (const f of items) push(`- **${f.dimension === 'format' ? 'Format' : 'Topic'}: ${mdEscape(f.group)}.** ${f.reason}`);
		push('');
	}
	if (report.offers.length > 0) {
		push('## Offers', '', 'Clicks are human, counted once per visitor, offer and day. Revenue is what the imported payout files report.', '');
		push('| Offer | Clicks | Conversions | Revenue (USD) | Call | Why |', '| --- | ---: | ---: | ---: | --- | --- |');
		for (const o of report.offers) {
			const other = formatMoney(o.revenueOther);
			push(
				`| ${mdEscape(o.offerId)} | ${o.clicks.toLocaleString('en-US')} | ${o.conversions ?? 'n/a'} | ${o.revenueUsd === null ? 'n/a' : usd(o.revenueUsd)}${other ? ` + ${other}` : ''} | ${SECTIONS.find((s) => s.verdict === o.verdict)?.title ?? o.verdict} | ${mdCell(o.reason)} |`,
			);
		}
		push('', 'Keep every affiliate or referral link next to its disclosure, and never present an offer as a way to make money.', '');
	}
	if (report.notes.length > 0) {
		push('## Notes', '');
		for (const note of report.notes) push(`- ${note}`);
		push('');
	}
	push(
		'## Rules used',
		'',
		`- Rates are pooled: the group's total divided by its total views, times 1,000.`,
		`- Formats are compared with the whole channel. Topics are compared with what the channel would get for the same mix of long videos and Shorts.`,
		`- Double down: at least ${RULES.doubleDown}x the comparison rate, with ${RULES.minGroupVideos}+ videos and ${RULES.minGroupViews.toLocaleString('en-US')}+ views.`,
		`- Test: at least ${RULES.doubleDown}x, but fewer videos or views than that.`,
		`- Cut or rework: at most ${RULES.cut}x, with ${RULES.minGroupVideos}+ videos and ${RULES.minGroupViews.toLocaleString('en-US')}+ views.`,
		`- Offers: judged on revenue per click (or conversion rate before any revenue) after ${RULES.offerMinClicks}+ clicks; ${RULES.offerCutClicks}+ clicks with no conversion is a cut.`,
		`- Nothing is judged before the channel has ${RULES.minVideos} videos with data. This file is rewritten every ${RULES.milestoneEvery} videos (or with --force).`,
		'',
	);
	return lines.join('\n');
};
