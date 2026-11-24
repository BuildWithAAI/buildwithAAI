/**
 * Comparisons on synthetic data with KNOWN effects (synth.ts): what was injected must be found, nothing else may be
 * recommended, small samples must say "insufficient data", and a template that always sits in the same place must
 * not become a recommendation.
 */
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {aggregate, type Comparison} from './aggregate.ts';
import {analyzeRecords} from './analyze.ts';
import {recommend} from './recommend.ts';
import {demoUploads, nullUploads, synthRecord, type SynthUpload} from './synth.ts';

const NOW = new Date('2026-11-24T12:00:00Z');
const run = (uploads: SynthUpload[]) => {
	const {analyses, models} = analyzeRecords(uploads.map(synthRecord), {now: NOW});
	const aggregates = aggregate(analyses, models);
	return {analyses, models, aggregates, byId: new Map<string, Comparison>(aggregates.comparisons.map((c) => [c.id, c]))};
};

describe('injected effects are found (demo set)', () => {
	const {byId, aggregates, analyses} = run(demoUploads());
	it("Badger's Red Flag loses viewers faster (injected +7%/10 s)", () => {
		const c = byId.get('segment:BadgerRedFlag:zoora-security:long')!;
		assert.equal(c.status, 'supported');
		assert.ok(c.estimate! > 4 && c.estimate! < 9, `estimate ${c.estimate}`);
		assert.ok(c.ci95![0] > 0);
		assert.equal(c.n.episodes, 10);
	});
	it('chart scenes hold better (injected -2.5%/10 s)', () => {
		const c = byId.get('type:chart:zoora-ai:long')!;
		assert.equal(c.status, 'supported');
		assert.ok(c.estimate! < -1 && c.estimate! > -4, `estimate ${c.estimate}`);
	});
	it('openings under 3 s hold better at 0:30 (injected during the hook)', () => {
		const c = byId.get('hook-short:<3s:long')!;
		assert.equal(c.status, 'supported');
		assert.ok(c.estimate! > 2);
		assert.ok((c.relative ?? 0) > 0);
	});
	it('nothing that was not injected is supported', () => {
		const supported = aggregates.comparisons.filter((c) => c.status === 'supported').map((c) => c.id).sort();
		assert.deepEqual(supported, ['hook-short:<3s:long', 'hook-slope:length:long', 'segment:BadgerRedFlag:zoora-security:long', 'type:chart:zoora-ai:long']);
	});
	it('Badger (not injected) shows no clear difference in either channel', () => {
		for (const id of ['badger:badger:zoora-ai:long', 'badger:badger:zoora-security:long']) assert.equal(byId.get(id)!.status, 'no-clear-difference', id);
	});
	it('a small language penalty (5%) stays below the practical size', () => {
		const c = byId.get('language-average:es:long')!;
		assert.ok(c.estimate! < 0);
		assert.equal(c.status, 'no-clear-difference');
		assert.match(c.reason, /below the practical size/);
	});
	it('broken uploads are excluded with their reasons', () => {
		const excluded = Object.fromEntries(analyses.filter((a) => !a.usable).map((a) => [a.videoId, a.exclusions.map((e) => e.code)]));
		assert.deepEqual(excluded, {SYNlowviews: ['low-views'], SYNwrongcut: ['duration-mismatch'], SYNholes001: ['incomplete-curve']});
	});
	it('the 4 s Short is usable but has no 0:05 outcome', () => {
		const tiny = analyses.find((a) => a.videoId === 'SYNtiny0001')!;
		assert.equal(tiny.usable, true);
		assert.equal(tiny.hook.outcome.value, null);
	});
});

describe('Shorts and long-form are never pooled', () => {
	const {byId, aggregates} = run(demoUploads());
	it('each format has its own comparisons and episode counts', () => {
		const short = aggregates.formats.find((f) => f.format === 'short')!;
		const long = aggregates.formats.find((f) => f.format === 'long')!;
		assert.equal(short.usableUploads, 9);
		assert.equal(long.usableUploads, 38);
		assert.equal(short.hookAtSec, 5);
		assert.equal(long.hookAtSec, 30);
		assert.ok(byId.has('type:chart:zoora-ai:short'));
	});
	it('a template that is always in the same place is capped at "worth watching" with the reason', () => {
		// in every synthetic Short the chart comes right before the steps scene
		const c = byId.get('type:chart:zoora-ai:short')!;
		assert.equal(c.status, 'suggestive', 'its interval excludes 0, but it is never recommended');
		assert.equal(c.momentConfounded, true);
		assert.match(c.reason, /always comes in the same place in the episode/);
		assert.match(c.reason, /Change its order in a few episodes/);
		assert.equal(byId.get('badger:badger:zoora-ai:short')!.status, 'insufficient-data', 'Badger is on every chart and never on a steps scene');
	});
});

describe('false discoveries under a null (no effect injected anywhere)', () => {
	it('recommends nothing in ten different null datasets', () => {
		for (let seed = 1; seed <= 10; seed++) {
			const {analyses, models} = analyzeRecords(nullUploads(seed), {now: NOW});
			const aggregates = aggregate(analyses, models);
			const supported = aggregates.comparisons.filter((c) => c.status === 'supported').map((c) => c.id);
			assert.deepEqual(supported, [], `seed ${seed}`);
			assert.deepEqual(recommend(aggregates.comparisons), []);
		}
	});
});

describe('insufficient data', () => {
	it('three episodes: no scene model, every comparison says insufficient data with the reason', () => {
		const few = demoUploads().filter((u) => u.channel === 'zoora-ai' && u.format === 'long' && u.lang === 'en').slice(0, 3);
		const {aggregates, models} = run(few);
		assert.equal(models.length, 0);
		assert.ok(aggregates.comparisons.length > 0);
		for (const c of aggregates.comparisons) {
			assert.equal(c.status, 'insufficient-data', c.id);
			assert.match(c.reason, /insufficient data/);
		}
		assert.deepEqual(recommend(aggregates.comparisons), []);
	});
	it('a template seen in fewer than 5 episodes is never judged', () => {
		const ups = demoUploads().filter((u) => u.channel === 'zoora-security');
		ups.slice(0, 7).forEach((u) => (u.scenes = u.scenes.map((s) => (s.segment === 'Headline' ? {...s, segment: 'Correction'} : s))));
		const {byId} = run(ups);
		const c = byId.get('segment:Headline:zoora-security:long')!;
		assert.equal(c.n.episodes, 3);
		assert.equal(c.status, 'insufficient-data');
	});
});

describe('language versions', () => {
	it('a large dubbing penalty is found, paired by episode against English', () => {
		const ups = demoUploads().map((u) => (u.lang === 'es' ? {...u, quality: (u.quality ?? 1) * 1.6} : u));
		const {byId} = run(ups);
		const c = byId.get('language-average:es:long')!;
		assert.equal(c.n.episodes, 7, 'seven episodes have both an English and a Spanish upload');
		assert.ok(c.estimate! < -2);
		assert.equal(c.status, 'supported');
	});
	it('uploads with extra dubbed audio tracks (blended curves) are left out of language pairs', () => {
		const ups = demoUploads().map((u) => (u.lang === 'es' ? {...u, multiLanguageAudio: true} : u));
		const {byId} = run(ups);
		assert.equal(byId.get('language-average:es:long'), undefined);
	});
});
