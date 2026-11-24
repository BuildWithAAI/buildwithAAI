import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {describe, it} from 'node:test';
import {parseStudioCsv, readStudioCsv, STUDIO_ROW_LIMIT} from './studio-csv.ts';

const FIXTURE = fileURLToPath(new URL('./fixtures/studio-content.csv', import.meta.url));

describe('YouTube Studio Content export', () => {
	it('reads the fixture: Total row skipped, values typed, current "Thumbnail impressions" headers', () => {
		const {videos, totalViews, issues} = readStudioCsv(FIXTURE);
		assert.equal(videos.length, 12);
		assert.equal(totalViews, 183600);
		assert.deepEqual(issues.filter((i) => i.level !== 'note'), []);
		const v = videos.find((x) => x.videoId === 'fixture0002');
		assert.ok(v);
		assert.equal(v.title, 'POV: "Support" DMs you first, then your wallet is gone (fixture)');
		assert.equal(v.publishedAt, '2026-10-09');
		assert.equal(v.durationSec, 688);
		assert.equal(v.views, 18900, 'quoted "18,900" with a thousands separator');
		assert.equal(v.engagedViews, 16900);
		assert.equal(v.avgViewDurationSec, 298);
		assert.equal(v.avgPercentViewed, 0.434);
		assert.equal(v.impressions, 201100);
		assert.equal(v.ctr, 0.074);
		assert.equal(v.subscribersNet, 218);
		assert.equal(v.subscribersGained, 233);
		assert.equal(v.subscribersLost, 15);
		assert.deepEqual(v.revenue, {currency: 'USD', amount: 52.4});
		assert.equal(videos.find((x) => x.videoId === 'fixture0008')?.revenue, null, 'an empty revenue cell stays unknown');
		assert.equal(videos.find((x) => x.videoId === '-fixture011')?.avgViewDurationSec, 26);
	});

	it('accepts the older header names, soft hyphens, a BOM and M:SS durations', () => {
		const csv = [
			'﻿Content,Video title,Video publish time,Duration,Views,Watch time (hours),Subscribers,Estimated revenue (USD),Impres­sions,Impressions click-through rate (%),Average view duration',
			'Total,,,,1500,10,5,1.5,9000,4.1,0:45',
			'abcdefghijk,Old export,2026-11-02,0:45,1500,10,5,1.5,9000,4.1,0:45',
		].join('\n');
		const {videos, issues} = parseStudioCsv(csv, 'old.csv');
		assert.deepEqual(issues, []);
		assert.equal(videos[0]?.impressions, 9000);
		assert.equal(videos[0]?.ctr, 0.041);
		assert.equal(videos[0]?.durationSec, 45);
		assert.equal(videos[0]?.avgViewDurationSec, 45);
		assert.equal(videos[0]?.publishedAt, '2026-11-02');
	});

	it('keeps the revenue currency from the header and never assumes USD', () => {
		const {videos} = parseStudioCsv('Content,Views,Your estimated revenue (EUR)\nabcdefghijk,100,"1,234.50"\n', 'eur.csv');
		assert.deepEqual(videos[0]?.revenue, {currency: 'EUR', amount: 1234.5});
	});

	it('warns about unreadable cells and duplicates, and leaves them empty', () => {
		const {videos, issues} = parseStudioCsv('Content,Views,Impressions click-through rate (%)\nabcdefghijk,lots,140\nabcdefghijk,5,1\nPost-123,4,1\n', 'bad.csv');
		assert.equal(videos.length, 1);
		assert.equal(videos[0]?.views, null);
		assert.equal(videos[0]?.ctr, null, 'a CTR above 100% is not a CTR');
		assert.ok(issues.some((i) => i.level === 'warning' && i.where === 'bad.csv:2' && /views "lots"/.test(i.message)));
		assert.ok(issues.some((i) => /appears twice/.test(i.message)));
		assert.ok(issues.some((i) => i.level === 'note' && /1 row\(s\) without an 11-character video id/.test(i.message)));
	});

	it('notes when the Total row does not match the rows, and warns at the 500-row export limit', () => {
		const rows = Array.from({length: STUDIO_ROW_LIMIT}, (_, i) => `v${String(i).padStart(10, '0')},1`);
		const {issues} = parseStudioCsv(['Content,Views', 'Total,999', ...rows].join('\n'), 'big.csv');
		assert.ok(issues.some((i) => /stop at 500 rows/.test(i.message)));
		assert.ok(issues.some((i) => /Total row says 999 views but the video rows add up to 500/.test(i.message)));
	});

	it('refuses a file re-saved with decimal commas instead of reading "31,200" (31.20) as 31,200', () => {
		const header = 'Content,Video title,Video publish time,Duration,Average view duration,Average percentage viewed (%),Subscribers gained,Views,Watch time (hours),Estimated revenue (USD),Thumbnail impressions,Thumbnail impressions click-through rate (%)';
		const csv = [
			header,
			'Total,,,,0:03:02,"48,2",1533,183600,"7280,1","211,600",1131800,"4,9"',
			'dQw4w9WgXcQ,A title,2026-10-06,754,0:05:12,"41,3",140,12400,"1074,7","31,200",150200,"6,1"',
			'aaaaaaaaaaa,Plain title,2026-10-09,688,0:04:58,"43,4",233,171200,"1564,5","180,400",981600,"7,4"',
		].join('\n');
		const {videos, issues} = parseStudioCsv(csv, 'Table data (de).csv');
		assert.deepEqual(videos, []);
		assert.equal(issues.length, 1);
		assert.equal(issues[0]?.level, 'error');
		assert.match(issues[0]?.message ?? '', /^line 2: "7280,1" in "Watch time \(hours\)" has a decimal comma.*Export again with YouTube Studio set to English/);
		// the same report with "." decimals is read normally
		const english = csv.replace(/"(\d+),(\d)"/g, '$1.$2').replace(/"(\d+),(\d{3})"/g, '$1.$2');
		const ok = parseStudioCsv(english, 'Table data.csv');
		assert.deepEqual(ok.videos.map((v) => v.revenue?.amount), [31.2, 180.4]);
	});

	it('warns when revenue per 1,000 views is implausibly high', () => {
		const csv = 'Content,Views,Estimated revenue (USD)\ndQw4w9WgXcQ,"20,000","31,200"\naaaaaaaaaaa,"20,000",31.200\n';
		const {videos, issues} = parseStudioCsv(csv, 'x.csv');
		assert.equal(videos.length, 2);
		const warnings = issues.filter((i) => i.level === 'warning').map((i) => i.message);
		assert.equal(warnings.length, 1);
		assert.match(warnings[0] ?? '', /video dQw4w9WgXcQ earned 1560\.00 USD per 1,000 views, which is unusually high/);
	});

	it('rejects files that are not a Content export', () => {
		assert.match(parseStudioCsv('Date,Views\n2026-11-01,5\n', 'daily.csv').issues[0]?.message ?? '', /no "Content" column/);
		assert.match(parseStudioCsv('Content,Video title\nabcdefghijk,x\n', 'nometrics.csv').issues[0]?.message ?? '', /no metric columns/);
		assert.equal(parseStudioCsv('Content,Views\n"open', 'broken.csv').issues[0]?.level, 'error');
		assert.equal(readStudioCsv('/nonexistent/Table data.csv').issues[0]?.level, 'error');
	});

	it('reads a content-type column when the export has one', () => {
		const {videos} = parseStudioCsv('Content,Content type,Views\nabcdefghijk,Shorts,5\nbbcdefghijk,Videos,6\n', 'types.csv');
		assert.deepEqual(videos.map((v) => v.contentType), ['short', 'long']);
	});

	it('the fixture file is plain UTF-8 with CRLF line endings, like a Studio download', () => {
		assert.match(readFileSync(FIXTURE, 'utf8'), /\r\n/);
	});
});
