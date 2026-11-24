import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {aggregate} from './aggregate.ts';
import {analyzeRecords} from './analyze.ts';
import {recommend} from './recommend.ts';
import {buildReportJson, DISCLOSURE, renderReportMarkdown, SOURCES, type ReportInput} from './report.ts';
import {RULES} from './rules.ts';
import {demoUploads, nullUploads, synthRecord} from './synth.ts';
import type {PullRecord} from './types.ts';

const NOW = new Date('2026-11-24T12:00:00Z');
const OPTIONS = {minViews: RULES.minViews, includeStale: false, allowUnverifiedDuration: false};
const build = (records: PullRecord[]): ReportInput => {
	const {analyses, models} = analyzeRecords(records, {now: NOW});
	const aggregates = aggregate(analyses, models);
	return {generatedAt: NOW, analyses, aggregates, recommendations: recommend(aggregates.comparisons), options: OPTIONS, policy: null};
};

describe('recommendations', () => {
	const input = build(demoUploads().map(synthRecord));
	it('one per supported effect, the hook slope folded into the hook recommendation', () => {
		assert.deepEqual(input.recommendations.map((r) => r.comparisonId).sort(), ['hook-short:<3s:long', 'segment:BadgerRedFlag:zoora-security:long', 'type:chart:zoora-ai:long']);
		const hook = input.recommendations.find((r) => r.comparisonId.startsWith('hook-short'))!;
		assert.match(hook.evidence, /Across all opening lengths, each extra second went with -\d/);
	});
	it('every recommendation carries the numbers that triggered it', () => {
		for (const r of input.recommendations) {
			assert.match(r.evidence, /95% CI/);
			assert.match(r.evidence, /q = 0\.\d{3}/);
			assert.match(r.evidence, /\d+ (long-form )?episodes|\d+ vs \d+ episodes/);
			assert.ok(Number.isFinite(r.numbers.estimate) && r.numbers.ci95.length === 2 && r.numbers.q <= RULES.fdr);
		}
	});
	it('a concrete template change and a machine-readable rule that needs the owner OK', () => {
		const flag = input.recommendations.find((r) => r.comparisonId.includes('BadgerRedFlag'))!;
		assert.match(flag.title, /BadgerRedFlag segments lose viewers faster/);
		assert.match(flag.action, /after that line, never over it/, 'Badger reacts after Zoo, never over his speech');
		assert.equal(flag.suggestedRule!.kind, 'scene-length-cap');
		assert.equal(flag.suggestedRule!.appliesTo.segment, 'BadgerRedFlag');
		const hook = input.recommendations.find((r) => r.comparisonId.startsWith('hook-short'))!;
		assert.deepEqual(hook.suggestedRule, {kind: 'hook-length-cap', appliesTo: {format: 'long', type: 'hook'}, maxSec: 3, note: 'opening scene at most this long'});
	});
	it('never promises views or income', () => {
		const text = input.recommendations.map((r) => `${r.title} ${r.action} ${r.evidence}`).join(' ');
		assert.doesNotMatch(text, /\b(guarantee|will (get|earn|grow)|revenue|income|\$)/i);
	});
});

describe('report.md', () => {
	const md = renderReportMarkdown(build(demoUploads().map(synthRecord)));
	it('starts with the synthetic-data banner and the derived-metrics disclosure (Developer Policies III.E.4.h)', () => {
		assert.match(md, /^# Retention report/);
		assert.match(md, /\*\*Synthetic data\.\*\*/);
		assert.ok(md.includes(DISCLOSURE));
		assert.match(md, /not from YouTube and is not a YouTube metric/);
	});
	it('shows each upload in its context of time (pull date and data window)', () => {
		assert.match(md, /Pulled 2026-11-24 \(YouTube data 2026-10-01 to 2026-11-24, all audiences views\)/);
	});
	it('names where viewers left, scene by scene', () => {
		assert.match(md, /\| s04 · BadgerRedFlag · talk "Badger's Red Flag" \| \d:\d{2}\.\d-\d:\d{2}\.\d \| \d+\.\d% → \d+\.\d% \|/);
	});
	it('has per-channel template tables, the Badger line, opening and language sections', () => {
		assert.match(md, /## Templates: zoora-ai \(long-form\)/);
		assert.match(md, /## Templates: zoora-security \(long-form\)/);
		assert.match(md, /\| Show segment \| Scenes \|/);
		assert.match(md, /Badger on screen vs not, among scenes of the same template/);
		assert.match(md, /## Opening scene \(long-form\)/);
		assert.match(md, /## Languages \(long-form\)/);
		assert.match(md, /auto-dub/);
		assert.match(md, /worth watching \(tied to its moment\)/);
	});
	it('lists excluded uploads with reasons, the method, thresholds and sources', () => {
		assert.match(md, /\| .*SYNlowviews.* \| low-views: 40 playbacks \(need 100\) \|/);
		assert.match(md, /## Method/);
		assert.match(md, /Benjamini-Hochberg q of 0\.1 or less/);
		for (const s of SOURCES) assert.ok(md.includes(s.url), s.url);
	});
	it('says "None yet" when nothing passes every gate', () => {
		const none = renderReportMarkdown(build(nullUploads(1)));
		assert.match(none, /## Recommendations\n\nNone yet\./);
	});
});

describe('report.json', () => {
	const json = buildReportJson(build(demoUploads().map(synthRecord)));
	it('has a stable shape for the dashboard and the storyboard writer', () => {
		assert.equal(json.version, 1);
		assert.equal(json.kind, 'retention-report');
		assert.equal(json.synthetic, 'all');
		assert.equal(json.disclosure, DISCLOSURE);
		assert.equal(json.summary.uploads, 50);
		assert.equal(json.summary.usable, 47);
		assert.equal(json.summary.recommendations, 3);
		assert.deepEqual(json.summary.formats.map((f) => f.format), ['long', 'short']);
		assert.equal(json.rules.minEpisodes, RULES.minEpisodes);
		assert.ok(json.uploads.every((u) => typeof u.videoId === 'string' && Array.isArray(u.scenes)));
		assert.ok(json.comparisons.every((c) => ['insufficient-data', 'no-clear-difference', 'suggestive', 'supported'].includes(c.status)));
	});
	it('round-trips through JSON', () => {
		assert.deepEqual(JSON.parse(JSON.stringify(json)).summary, json.summary);
	});
});
