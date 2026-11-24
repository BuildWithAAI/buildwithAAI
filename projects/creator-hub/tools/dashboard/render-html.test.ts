import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {CONTRACT_COLUMNS, EXTRA_COLUMNS, renderMetricsCsv} from './metrics-csv.ts';
import type {DashboardVideo} from './model.ts';
import {buildReport} from './recommend.ts';
import {clock, compact, renderDashboard, type PageInput} from './render-html.ts';
import {parseCsv} from './csv.ts';

const video = (over: Partial<DashboardVideo>): DashboardVideo => ({
	videoId: 'abcdefghijk', title: 'A video', channel: 'zoora-ai', publishedAt: '2026-11-01', format: 'long', views: 10_000, impressions: 120_000, ctr: 0.052,
	avgViewDurationSec: 192, avgPercentViewed: 0.41, subscribersGained: 50, adRevenueUsd: 20, hubClicks: 30, conversions: 1, affiliateRevenueUsd: 10,
	tags: ['scams'], formatSource: 'catalog', engagedViews: 9000, subscribersNet: 45, hubClicksYoutube: 25, affiliateRevenueOther: [], adRevenueOther: null,
	revenueUsd: 30, inputs: ['studio'], ...over,
});

const page = (videos: DashboardVideo[], over: Partial<PageInput> = {}): string =>
	renderDashboard({
		brandName: 'Zoora AI',
		channel: 'zoora-ai',
		generatedAt: '2026-11-24T12:00:00.000Z',
		videos,
		offers: [{offerId: 'hardware-wallet', clicks: 30, conversions: 1, revenueUsd: 10, revenueOther: [], requests: 40, blocked: 10}],
		unattributed: {noVideoClicks: 2, unknownVideoClicks: new Map([['typo-slug', 3]]), noVideoPayouts: {conversions: 0, usd: 0, other: []}, unknownVideoPayouts: new Map()},
		report: buildReport(videos, [], {channel: 'zoora-ai', hubLoaded: true}),
		recommendations: null,
		nextMilestone: 10,
		inputs: ['YouTube Studio export data/youtube/Table data.csv: 2 video(s)'],
		issues: [{level: 'warning', where: 'x.csv:3', message: 'views "<b>lots</b>" is not readable'}],
		hubLoaded: true,
		payoutsLoaded: true,
		...over,
	});

describe('index.html', () => {
	it('is a static page: no script, a CSP that forbids scripts, light and dark themes, phone layout', () => {
		const html = page([video({})]);
		assert.ok(html.startsWith('<!doctype html>'));
		assert.ok(!/<script/i.test(html), 'no JavaScript');
		assert.match(html, /Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'/);
		assert.match(html, /@media \(prefers-color-scheme:dark\)/);
		assert.match(html, /@media \(max-width:40rem\)/);
		assert.match(html, /@media \(prefers-reduced-motion:reduce\)/);
		assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
		assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(html.replace(/<a [^>]*>/g, '')), 'no external resources');
	});

	it('escapes every value that comes from the inputs', () => {
		const html = page([video({title: '<img src=x onerror=alert(1)> & "quotes"', videoId: 'abcdefghijk'})]);
		assert.ok(!html.includes('<img src=x'));
		assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt; &amp; &quot;quotes&quot;/);
		assert.match(html, /views &quot;&lt;b&gt;lots&lt;\/b&gt;&quot; is not readable/);
		assert.match(html, /typo-slug \(3\)/);
	});

	it('draws the three charts with labelled bars, a median reference and table views', () => {
		const videos = [
			video({videoId: 'aaaaaaaaaaa', title: 'Top', revenueUsd: 60, hubClicksYoutube: 50, ctr: 0.07}),
			video({videoId: 'bbbbbbbbbbb', title: 'Middle', revenueUsd: 30, ctr: 0.05}),
			video({videoId: 'ccccccccccc', title: 'Low', revenueUsd: 3, hubClicksYoutube: 1, ctr: 0.03}),
			video({videoId: 'ddddddddddd', title: 'A Short', format: 'short', views: 50_000, ctr: null, revenueUsd: 2}),
		];
		const html = page(videos);
		assert.match(html, /<h2 id="rev">Revenue per 1,000 views<\/h2>/);
		assert.match(html, /<h2 id="clk">Hub clicks per 1,000 views<\/h2>/);
		assert.match(html, /<h2 id="ctr">Click-through rate vs the channel median<\/h2>/);
		assert.match(html, /Median long video: \$3\.00/, 'median of $6.00, $3.00 and $0.30 per 1K');
		assert.match(html, /Channel median: 5\.0%/);
		assert.match(html, /<span class="bar-value">\$6\.00<\/span>/);
		assert.match(html, /<rect class="mark" x="0" y="4" width="100\.00%" height="8" rx="4"\/>/, 'the top bar fills its group');
		assert.match(html, /<rect class="ref" x="50\.00%"/, 'the median line sits at $3.00 of $6.00');
		assert.match(html, /Top<small>120,000 impressions · 2\.0 pts above the median<\/small>/);
		assert.ok(!/A Short<small>[^<]*impressions/.test(html), 'Shorts are not in the CTR chart');
		assert.equal((html.match(/<details><summary>Show as a table<\/summary>/g) ?? []).length, 3);
		assert.match(html, /<th scope="row">Top<\/th><td>Long<\/td><td class="num">10,000<\/td><td class="num">\$60\.00<\/td><td class="num">\$6\.00<\/td>/, 'table view of the revenue chart');
	});

	it('shows the retention table against the median of the same format', () => {
		const videos = [video({videoId: 'aaaaaaaaaaa', title: 'Long A', avgPercentViewed: 0.5}), video({videoId: 'bbbbbbbbbbb', title: 'Long B', avgPercentViewed: 0.3})];
		const html = page(videos);
		assert.match(html, /<th scope="row">Long A<\/th><td>Long<\/td><td class="num">3:12<\/td><td class="num">50\.0%<\/td><td class="num">\+10\.0 pts<\/td>/);
		assert.match(html, /<th scope="row">Long B<\/th>.*?−10\.0 pts/s);
	});

	it('says plainly when the sample is too small or data is missing', () => {
		const empty = page([], {hubLoaded: false, payoutsLoaded: false, report: buildReport([], [], {channel: 'zoora-ai', hubLoaded: false})});
		assert.match(empty, /No YouTube data loaded yet/);
		assert.match(empty, /No hub data loaded/);
		assert.match(empty, /the sample is too small to conclude anything/);
		assert.match(empty, /not a forecast of future earnings/);
	});

	it('links recommendations.md when it exists', () => {
		const html = page([video({})], {recommendations: {videoCount: 10, generatedAt: '2026-11-20T00:00:00Z', file: 'recommendations.md'}, nextMilestone: 20});
		assert.match(html, /last written at 10 videos \(2026-11-20\): <a href="recommendations\.md">/);
		assert.match(html, /next update comes at 20 videos/);
	});

	it('formats numbers for people', () => {
		assert.equal(compact(1284), '1,284');
		assert.equal(compact(12_900), '12.9K');
		assert.equal(compact(184_000), '184K');
		assert.equal(compact(4_200_000), '4.2M');
		assert.equal(clock(192), '3:12');
		assert.equal(clock(3723), '1:02:03');
		assert.equal(clock(null), '–');
	});
});

describe('metrics.csv', () => {
	it('starts with the VideoMetrics columns in contract order, then the dashboard columns', () => {
		const csv = renderMetricsCsv([video({title: '=cmd|"/c calc"!A1', affiliateRevenueOther: [{currency: 'EUR', amount: 12.5}], tags: ['scams', 'ai agents']})]);
		const table = parseCsv(csv);
		assert.deepEqual(table.header, [...CONTRACT_COLUMNS, ...EXTRA_COLUMNS]);
		assert.deepEqual(table.header.slice(0, 15), [
			'videoId', 'title', 'channel', 'publishedAt', 'format', 'views', 'impressions', 'ctr', 'avgViewDurationSec', 'avgPercentViewed',
			'subscribersGained', 'adRevenueUsd', 'hubClicks', 'conversions', 'affiliateRevenueUsd',
		]);
		const row = Object.fromEntries(table.header.map((h, i) => [h, table.rows[0]?.cells[i]]));
		assert.equal(row.title, `'=cmd|"/c calc"!A1`, 'formula neutralised');
		assert.equal(row.ctr, '0.052');
		assert.equal(row.revenuePer1kViews, '3');
		assert.equal(row.hubClicksPer1kViews, '2.5');
		assert.equal(row.affiliateRevenueOther, 'EUR 12.50');
		assert.equal(row.tags, 'scams; ai agents');
		const empty = parseCsv(renderMetricsCsv([video({views: null, adRevenueUsd: null, revenueUsd: null, conversions: null})])).rows[0]?.cells;
		assert.equal(empty?.[5], '', 'unknown is an empty cell, not 0');
		assert.equal(empty?.[table.header.indexOf('revenuePer1kViews')], '');
	});
});
