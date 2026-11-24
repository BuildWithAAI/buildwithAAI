import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {
	audienceValues,
	channelStats,
	extractTemplate,
	fillTemplate,
	fmtDuration,
	median,
	parseCsvRows,
	parseMetricsCsv,
	statValues,
	unguard,
	validateAudience,
} from '../lib/metrics.ts';

const FIX = join(import.meta.dirname, 'fixtures');
const rows = parseMetricsCsv(readFileSync(join(FIX, 'metrics.synthetic.csv'), 'utf8'));

test('reads the dashboard CSV: quotes, CRLF, empty means unknown, formula guard removed', () => {
	assert.equal(rows.length, 7);
	const b = rows.find((r) => r.videoId === 'fixture-short-2');
	assert.equal(b?.title, '=SYNTHETIC FIXTURE: short B (formula-guarded title)');
	const c = rows.find((r) => r.videoId === 'fixture-long-3');
	assert.equal(c?.ctr, null);
	assert.equal(c?.impressions, null);
	assert.deepEqual(parseCsvRows('"a ""q""",b\r\n1,"x,y"\n'), [
		['a "q"', 'b'],
		['1', 'x,y'],
	]);
	assert.equal(unguard("'=SUM(A1)"), '=SUM(A1)');
	assert.equal(unguard("'plain"), "'plain");
	assert.throws(() => parseMetricsCsv('"videoId","title"\r\n"x","y"\r\n'), /lacks column/);
	assert.throws(() => parseCsvRows('"open'), /unclosed/);
});

test('statistics are computed from known cells only (hand-checked values)', () => {
	const s = channelStats(rows, 'zoora-security', '2026-11-24', 90);
	assert.equal(s.videos, 6);
	assert.equal(s.longVideos, 4);
	assert.equal(s.shorts, 2);
	assert.equal(s.totalViews, 18280);
	assert.equal(s.medianViewsLong, 1600); // (1200 + 2000) / 2
	assert.equal(s.medianViewsShort, 6000);
	// views-weighted: (240*1200 + 300*3000 + 180*2000 + 200*80) / 6280
	assert.ok(Math.abs((s.avgViewDurationLongSec ?? 0) - 1564000 / 6280) < 1e-9);
	// median of 0.42 and 0.50 (floating point, so compare within a tolerance)
	assert.ok(Math.abs((s.medianPercentViewedLong ?? 0) - 0.46) < 1e-12);
	// CTR: long videos with 100+ views and a known CTR only (0.05, 0.075)
	assert.equal(s.medianCtrLong, 0.0625);
	assert.equal(s.subscribersGained, 173);
	assert.ok(Math.abs((s.hubClicksPer1kViews ?? 0) - (21 / 6280) * 1000) < 1e-9);
	assert.equal(s.recentVideos, 5);
	assert.equal(s.recentMedianViewsLong, 2000);
	assert.equal(s.firstPublished, '2026-08-02');
	assert.equal(s.lastPublished, '2026-11-15');
	const v = statValues(s);
	assert.equal(v['stats.medianViewsLong'], '1,600');
	assert.equal(v['stats.avgViewDurationLong'], '4:09');
	assert.equal(v['stats.medianPercentViewedLong'], '46%');
	assert.equal(v['stats.dataRange'], '2 August 2026 to 15 November 2026');
});

test('no data means no figure, never zero', () => {
	const s = channelStats([], 'zoora-security', '2026-11-24');
	const v = statValues(s);
	assert.equal(v['stats.medianViewsLong'], undefined);
	assert.equal(v['stats.totalViews'], undefined);
	assert.equal(v['stats.videos'], undefined);
	assert.equal(median([]), null);
	assert.equal(median([3, 1, 2]), 2);
	assert.equal(fmtDuration(3725), '1:02:05');
});

test('template filling: values, fallbacks and the missing list', () => {
	const {text, missing} = fillTemplate('A {{a}} B {{b|On request}} C {{ c }}', {a: '1'});
	assert.equal(text, 'A 1 B On request C not yet available');
	assert.deepEqual(missing.sort(), ['b', 'c']);
});

test('the template in docs/SPONSORS.md is found and parses as product content', async () => {
	const doc = readFileSync(join(import.meta.dirname, '..', '..', '..', 'docs', 'SPONSORS.md'), 'utf8');
	const t = extractTemplate(doc);
	assert.match(t, /^---\ntitle: \{\{kit\.channelName\}\}/);
	assert.ok(!t.includes('```'));
	const {parseDocument, structure} = await import('../lib/markdown.ts');
	const st = structure(parseDocument(fillTemplate(t, {}).text));
	assert.equal(st.sections.length, 1);
	assert.throws(() => extractTemplate('no markers'), /media-kit:start/);
});

test('audience file validation and formatting', () => {
	const a = JSON.parse(readFileSync(join(FIX, 'audience.synthetic.json'), 'utf8'));
	assert.deepEqual(validateAudience(a), []);
	const v = audienceValues(a);
	assert.equal(v['audience.subscribers'], '1,234');
	assert.equal(v['audience.topCountries'], 'United States 39%, United Kingdom 9.2%, Brazil 6.0%');
	assert.match(validateAudience({topCountries: [{country: 'A', pct: 70}, {country: 'B', pct: 40}]}).join(), /more than 100%/);
	assert.match(validateAudience({subscribers: -1}).join(), /whole number/);
	assert.match(validateAudience({asOf: '24/11/2026'}).join(), /YYYY-MM-DD/);
	assert.match(validateAudience({gender: [{label: '', pct: 5}]}).join(), /label is required/);
});
