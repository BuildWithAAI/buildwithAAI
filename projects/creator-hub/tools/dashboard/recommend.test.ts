import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import type {DashboardVideo, OfferSummary} from './model.ts';
import {buildReport, chooseMetric, mdEscape, milestoneDue, nextMilestone, parseState, renderRecommendations, RULES, type Report} from './recommend.ts';

let counter = 0;
const video = (over: Partial<DashboardVideo>): DashboardVideo => ({
	videoId: `vid${String(++counter).padStart(8, '0')}`,
	title: `Video ${counter}`,
	channel: 'zoora-ai',
	publishedAt: '2026-11-01',
	format: 'long',
	views: 10_000,
	impressions: null,
	ctr: null,
	avgViewDurationSec: null,
	avgPercentViewed: null,
	subscribersGained: null,
	adRevenueUsd: null,
	hubClicks: 0,
	conversions: null,
	affiliateRevenueUsd: null,
	tags: [],
	formatSource: 'catalog',
	engagedViews: null,
	subscribersNet: null,
	hubClicksYoutube: 0,
	affiliateRevenueOther: [],
	adRevenueOther: null,
	revenueUsd: null,
	inputs: [],
	...over,
});
const many = (n: number, over: Partial<DashboardVideo>): DashboardVideo[] => Array.from({length: n}, () => video(over));
const finding = (report: Report, group: string) => report.findings.find((f) => f.group === group);

describe('recommendation rules', () => {
	it('says the sample is too small below 10 videos and makes no call', () => {
		const videos = many(6, {revenueUsd: 30, tags: ['scams']});
		const report = buildReport(videos, [], {channel: 'zoora-ai', hubLoaded: false});
		assert.equal(report.sampleTooSmall, true);
		assert.ok(report.findings.length > 0);
		assert.ok(report.findings.every((f) => f.verdict === 'too-early'));
		const md = renderRecommendations(report, {generatedAt: '2026-11-24', brandName: 'Zoora AI'});
		assert.match(md, /## Sample too small to conclude anything/);
		assert.match(md, /Only 6 video\(s\) have YouTube data\. The rules need at least 10/);
	});

	it('double down, cut, steady and test, each with the numbers that triggered it', () => {
		const videos = [
			...many(4, {revenueUsd: 40, tags: ['scams']}), // $4.00 per 1K
			...many(4, {revenueUsd: 8, tags: ['memecoins']}), // $0.80 per 1K
			...many(3, {revenueUsd: 20, tags: ['ai']}), // $2.00 per 1K
			video({views: 2000, revenueUsd: 12, tags: ['wallets']}), // $6.00 per 1K, one video only
		];
		const report = buildReport(videos, [], {channel: 'zoora-ai', hubLoaded: false});
		assert.equal(report.metric?.key, 'revenue');
		assert.equal(report.channelRate?.toFixed(4), ((264 / 112_000) * 1000).toFixed(4));
		assert.equal(finding(report, 'scams')?.verdict, 'double-down');
		assert.match(finding(report, 'scams')?.reason ?? '', /^\$4\.00 per 1K views over 4 video\(s\) \(4 long\) and 40,000 views, vs \$2\.36 expected .*1\.70x, at least 1\.25x/);
		assert.equal(finding(report, 'memecoins')?.verdict, 'cut');
		assert.match(finding(report, 'memecoins')?.reason ?? '', /\$0\.80 per 1K.*0\.34x, at most 0\.5x/);
		assert.equal(finding(report, 'ai')?.verdict, 'steady');
		assert.equal(finding(report, 'wallets')?.verdict, 'test');
		assert.match(finding(report, 'wallets')?.reason ?? '', /2\.55x but only 1 video\(s\) and 2,000 views: make 2 more to confirm/);
		const md = renderRecommendations(report, {generatedAt: '2026-11-24', brandName: 'Zoora AI'});
		for (const heading of ['## Double down', '## Test', '## Cut or rework', '## Steady', '## Rules used']) assert.ok(md.includes(heading), heading);
		assert.ok(!md.includes('Sample too small'));
		assert.match(md, /not predictions\. Nothing here promises future views or earnings/);
	});

	it('compares topics with the same mix of formats, so Shorts-heavy topics are not cut for being Shorts', () => {
		const videos = [
			...many(6, {revenueUsd: 30, tags: ['explainers']}), // long, $3.00 per 1K
			...many(6, {format: 'short', views: 50_000, revenueUsd: 5, tags: ['shorts-heavy']}), // $0.10 per 1K
		];
		const report = buildReport(videos, [], {channel: 'zoora-ai', hubLoaded: false});
		assert.equal(finding(report, 'shorts-heavy')?.verdict, 'steady');
		assert.match(finding(report, 'shorts-heavy')?.reason ?? '', /vs \$0\.10 expected at channel rates for that mix of formats/);
		assert.equal(finding(report, 'Long videos')?.verdict, 'double-down');
		assert.equal(finding(report, 'Shorts')?.verdict, 'cut');
		assert.match(finding(report, 'Shorts')?.reason ?? '', /\$0\.10 per 1K views over 6 video\(s\) and 300,000 views, vs \$0\.58 for the whole channel/);
	});

	it('falls back to hub clicks, then subscribers, when there is no revenue', () => {
		const clicks = many(10, {hubClicksYoutube: 12});
		assert.equal(chooseMetric(clicks, true)?.key, 'clicks');
		assert.equal(chooseMetric(clicks, false), null, 'clicks are not used when no hub data was loaded');
		assert.equal(chooseMetric(many(10, {subscribersNet: 4}), false)?.key, 'subscribers');
		const none = buildReport(many(10, {}), [], {channel: 'zoora-ai', hubLoaded: false});
		assert.equal(none.metric, null);
		assert.match(none.notes.join(' '), /nothing can be compared/);
		assert.match(renderRecommendations(buildReport(clicks, [], {channel: 'zoora-ai', hubLoaded: true}), {generatedAt: 'x', brandName: 'Z'}), /compared on hub clicks from YouTube per 1,000 views instead/);
	});

	it('judges offers on revenue per click, with click minimums and a region-block note', () => {
		const offer = (offerId: string, clicks: number, conversions: number | null, revenueUsd: number | null, extra: Partial<OfferSummary> = {}): OfferSummary => ({
			offerId, clicks, conversions, revenueUsd, revenueOther: [], requests: null, blocked: null, ...extra,
		});
		const offers = [
			offer('no-sales', 200, 0, 0),
			offer('weak', 100, 3, 12),
			offer('strong', 60, 4, 60),
			offer('tiny', 10, 1, 30),
			offer('steady-one', 80, 4, 26, {requests: 50, blocked: 20}),
			offer('uncovered', 70, null, null),
			offer('(no offer id)', 0, 1, 9),
		];
		const report = buildReport(many(10, {revenueUsd: 10}), offers, {channel: 'zoora-ai', hubLoaded: true});
		const verdict = (id: string) => report.offers.find((o) => o.offerId === id);
		assert.equal(verdict('no-sales')?.verdict, 'cut');
		assert.match(verdict('no-sales')?.reason ?? '', /200 clicks and no conversion/);
		assert.equal(verdict('weak')?.verdict, 'cut');
		assert.match(verdict('weak')?.reason ?? '', /\$0\.12 per click vs \$0\.28 across offers: 0\.42x/);
		assert.equal(verdict('strong')?.verdict, 'double-down');
		assert.equal(verdict('tiny')?.verdict, 'test');
		assert.equal(verdict('steady-one')?.verdict, 'steady');
		assert.equal(verdict('uncovered')?.verdict, 'too-early');
		assert.match(verdict('uncovered')?.reason ?? '', /no payout file covers this offer/);
		assert.equal(verdict('(no offer id)'), undefined);
		assert.ok(report.notes.some((n) => /Offer steady-one: 40% of 50 human requests were blocked by region rules/.test(n)));
		const md = renderRecommendations(report, {generatedAt: '2026-11-24', brandName: 'Zoora AI'});
		assert.match(md, /\| strong \| 60 \| 4 \| \$60\.00 \| Double down \|/);
		assert.match(md, /disclosure, and never present an offer as a way to make money/);
	});

	it('mentions unconverted currencies instead of adding them', () => {
		const offers: OfferSummary[] = [{offerId: 'eu', clicks: 5, conversions: 1, revenueUsd: 0, revenueOther: [{currency: 'EUR', amount: 19.75}], requests: null, blocked: null}];
		const report = buildReport(many(10, {revenueUsd: 1}), offers, {channel: 'zoora-ai', hubLoaded: true});
		assert.ok(report.notes.some((n) => /EUR 19\.75/.test(n)));
	});
});

describe('milestones', () => {
	it('is due at every 10 videos with data, once per milestone', () => {
		assert.equal(RULES.milestoneEvery, 10);
		assert.equal(milestoneDue(9, null), false);
		assert.equal(milestoneDue(10, null), true);
		assert.equal(milestoneDue(10, 10), false);
		assert.equal(milestoneDue(19, 10), false);
		assert.equal(milestoneDue(20, 10), true);
		assert.equal(milestoneDue(25, 10), true, 'a skipped milestone is caught up');
		assert.equal(milestoneDue(25, 20), false);
		assert.equal(milestoneDue(31, 25), true);
		assert.equal(nextMilestone(0), 10);
		assert.equal(nextMilestone(12), 20);
		assert.equal(nextMilestone(20), 30);
	});

	it('reads the state file defensively', () => {
		assert.deepEqual(parseState(null), {version: 1, channels: {}});
		assert.deepEqual(parseState({version: 2}), {version: 1, channels: {}});
		assert.deepEqual(parseState({version: 1, channels: {a: {videoCount: 10, generatedAt: 'x'}, b: {videoCount: -1, generatedAt: 'x'}, c: 'bad'}}), {
			version: 1,
			channels: {a: {videoCount: 10, generatedAt: 'x'}},
		});
	});
});

describe('markdown escaping', () => {
	it('escapes link and emphasis syntax in names that come from CSV files', () => {
		assert.equal(mdEscape('[x](javascript:alert(1)) *b* <i>'), '\\[x\\]\\(javascript:alert\\(1\\)\\) \\*b\\* \\<i\\>');
		assert.equal(mdEscape('two\nlines'), 'two lines');
	});
});
