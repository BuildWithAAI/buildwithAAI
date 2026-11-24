/** prepare: radar step (mocked), selection, brief.json, WRITER.md, research.md, and the "no video today" decision. */
import {strict as assert} from 'node:assert';
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, it} from 'node:test';
import {buildBrief, buildFacts, indexSources, mustNotSayFor} from '../lib/brief.ts';
import {parseChannel} from '../lib/channel.ts';
import {runPrepare} from '../lib/prepare.ts';
import {renderResearchMd} from '../lib/research.ts';
import {selectCandidates} from '../lib/select.ts';
import type {DailyBrief, RadarIncident} from '../lib/types.ts';
import {cell, rektFor, renderWriterMd, skeleton} from '../lib/writer.ts';
import {argAfter, DATE, fakeExec, fixtureBridge, fixtureLend, fixturePhish, fixtureSwap, NOW, radarFile, seedRadarDay, STUDIO, tempRoot, touch, writeJsonFile} from './helpers.ts';

const channel = () => parseChannel(JSON.parse(readFileSync(join(STUDIO, 'content', 'zoora-security', 'channel.json'), 'utf8')));

describe('channel.json', () => {
	it('enforces the owner decisions', () => {
		const ch = channel();
		assert.equal(ch.voice, 'im_nicola');
		assert.equal(ch.timezone, 'America/Chicago');
		assert.deepEqual(ch.offers, []);
		assert.equal(ch.madeForKids.value, false);
		assert.ok(ch.displayNameTbd);
		assert.deepEqual(ch.lengthSec, [45, 60]);
		const raw = JSON.parse(readFileSync(join(STUDIO, 'content', 'zoora-security', 'channel.json'), 'utf8'));
		assert.throws(() => parseChannel({...raw, zooVoice: {...raw.zooVoice, default: 'am_michael'}}), /im_nicola/);
		assert.throws(() => parseChannel({...raw, publish: {...raw.publish, madeForKids: {value: true, reason: 'no'}}}), /madeForKids/);
	});
});

const ctx = (over: Partial<Parameters<typeof selectCandidates>[1]> = {}) => ({
	date: DATE,
	previous: [],
	strongAnalysis: (inc: RadarIncident) => (inc.sources.some((s) => s.id === 'defillama-hacks') ? {available: ['tracker-30d'], why: []} : {available: [], why: ['tracker-30d: not in DefiLlama']}),
	...over,
});

describe('selection', () => {
	const all = () => [fixtureLend(), fixturePhish(), fixtureSwap(), fixtureBridge()].sort((a, b) => b.score.total - a.score.total);
	it('picks the best eligible story and two alternates; developing stories are never auto-picked', () => {
		const s = selectCandidates(all(), ctx());
		assert.equal(s.decision, 'video');
		assert.equal(s.primary?.incidentId, '2026-11-23-fixtureswap');
		assert.deepEqual(s.alternates.map((a) => a.incidentId), ['2026-11-22-fixturebridge']);
		const lend = s.considered.find((c) => c.incidentId === '2026-11-24-fixturelend');
		assert.ok(lend && !lend.eligible && lend.reasons.some((r) => r.startsWith('developing')));
		const phish = s.considered.find((c) => c.incidentId === '2026-11-23-fixturephish');
		assert.ok(phish && phish.reasons.some((r) => r.includes('no strong analysis')));
		assert.equal(s.primary?.dateSlug, '2026-11-24-fixtureswap');
	});
	it('publishes nothing when nothing is confirmed', () => {
		const s = selectCandidates([fixtureLend()], ctx());
		assert.equal(s.decision, 'no-video');
		assert.match(s.decisionReason, /Nothing is confirmed today/);
	});
	it('publishes nothing when confirmed stories lack real analysis', () => {
		const s = selectCandidates([fixturePhish()], ctx());
		assert.equal(s.decision, 'no-video');
		assert.match(s.decisionReason, /real analysis/);
	});
	it('skips a story we covered in the last 14 days, and stops after one approved video a day', () => {
		const covered = selectCandidates(all(), ctx({previous: [{slug: '2026-11-20-fixtureswap', date: '2026-11-20', incidentId: '2026-11-23-fixtureswap', approved: true}]}));
		assert.equal(covered.primary?.incidentId, '2026-11-22-fixturebridge');
		const today = selectCandidates(all(), ctx({previous: [{slug: '2026-11-24-other', date: DATE, incidentId: 'x', approved: true}]}));
		assert.equal(today.decision, 'no-video');
		assert.match(today.decisionReason, /already approved/);
	});
	it('takes a hand pick, and says why it would not have been chosen', () => {
		const p = selectCandidates(all(), ctx({pick: '2026-11-24-fixturelend'}));
		assert.equal(p.primary?.incidentId, '2026-11-24-fixturelend');
		assert.match(p.decisionReason, /Picked by hand .* although/);
		const bad = selectCandidates(all(), ctx({pick: 'nope'}));
		assert.equal(bad.decision, 'no-video');
	});
});

const briefFor = (inc: RadarIncident): DailyBrief => {
	const sel = selectCandidates([inc], {...ctx(), pick: inc.id});
	return buildBrief({
		inc,
		date: DATE,
		dateSlug: `${DATE}-${inc.protocol.toLowerCase()}`,
		now: NOW.toISOString(),
		channel: channel(),
		radar: {file: radarFile([inc]), path: `content/zoora-security/radar/${DATE}.json`, sha256: 'x'.repeat(64)},
		selection: sel,
		opportunities: [],
		history: {radarFiles: 1, radarFrom: '2026-10-26', radarTo: DATE, trackerRows: 0, trackerFetchedUtc: null, previousEpisodes: [], notes: []},
		otherProtocols: ['OtherProto', inc.protocol],
	});
};

describe('brief.json', () => {
	it('gives every article a unique source id and keeps only facts whose quote is stored', () => {
		const inc = fixtureSwap();
		const idx = indexSources(inc);
		assert.deepEqual(idx.sources.map((s) => s.id), ['defillama-hacks', 'examplewire', 'examplewire-2', 'examplelab']);
		const {facts, dropped} = buildFacts(inc, idx);
		assert.equal(dropped.length, 1);
		for (const f of facts) {
			assert.equal(f.sourceIds.length, 1);
			assert.ok(f.excerpts[0].text.includes(f.quote ?? ''), `${f.id}: quote not in excerpt`);
			assert.ok(f.excerpts[0].text.length <= 280);
		}
		assert.ok(facts.some((f) => f.text === 'Example Wire headline, 2026-11-23: "FixtureSwap says attackers drained $4.5 million"'));
	});
	it('carries status, evergreen topic and a must-not-say list built from the sources', () => {
		const b = briefFor(fixtureSwap());
		assert.equal(b.status, 'confirmed');
		assert.equal(b.format, 'daily-short');
		assert.equal(b.evergreenTopic, 'key-management');
		assert.equal(b.evergreen?.url, null);
		const rules = b.mustNotSay.map((m) => m.rule);
		for (const r of ['names', 'figures', 'hedge', 'how-to', 'price', 'speculation', 'others-material']) assert.ok(rules.includes(r), r);
		assert.match(b.mustNotSay.find((m) => m.rule === 'names')?.text ?? '', /redacted 1 name/);
		assert.match(b.mustNotSay.find((m) => m.rule === 'hedge')?.text ?? '', /suspected/);
		assert.ok(b.entities.some((e) => e.name === 'OtherProto'));
		assert.ok(!b.entities.some((e) => e.name === 'FixtureSwap'));
	});
	it('marks a developing story so the news gate treats every fact as developing', () => {
		const b = briefFor(fixtureLend());
		assert.equal(b.status, 'developing');
		assert.equal(b.format, 'what-we-know');
		assert.ok(b.mustNotSay.some((m) => m.rule === 'developing'));
	});
	it('names state-actor attributions and legal items', () => {
		const inc = fixtureSwap();
		inc.sources[3].excerpt = 'Example Security Lab tied the theft to North Korea; prosecutors filed a forfeiture complaint.';
		const rules = mustNotSayFor(inc, indexSources(inc), false).map((m) => m.rule);
		assert.ok(rules.includes('attribution') && rules.includes('legal'));
	});
	it('is read by the news gate without problems', async () => {
		const {normalizeBrief} = (await import('../../news/lib/brief.ts')) as {normalizeBrief: (raw: unknown) => {brief: unknown; problems: unknown[]}};
		const r = normalizeBrief(JSON.parse(JSON.stringify(briefFor(fixtureSwap()))));
		assert.deepEqual(r.problems, []);
		assert.ok(r.brief);
	});
});

describe('WRITER.md and research.md', () => {
	it('gives the writer the rules, ids, segments and a show-format skeleton', () => {
		const b = briefFor(fixtureSwap());
		const md = renderWriterMd(b, channel());
		for (const h of ['## Facts you may use, and nothing else', '## Reported losses (never average them)', '## The analysis this video adds (required)', '## Must not say', '## Segment order and timing', '## Badger (nonverbal)', '## Tone', '## Claim tags and markup', '## Storyboard skeleton', '## Before you hand over'])
			assert.ok(md.includes(h), h);
		assert.match(md, /45–60 seconds/);
		assert.match(md, /claimWaivers/);
		const json = /```json\n([\s\S]*?)\n```/.exec(md)?.[1] ?? '';
		const sk = JSON.parse(json);
		assert.equal(sk.slug, b.slug);
		assert.equal(sk.fiction, false);
		assert.deepEqual(sk.scenes.map((s: {segment?: string}) => s.segment), ['coldOpen', 'headline', 'howItWorked', 'desk', 'badgerRedFlag', 'zooOneFix', undefined]);
		assert.equal(sk.scenes[0].onScreen.kicker, 'Threat Brief');
		assert.deepEqual(sk, skeleton(b, channel()));
	});
	it('prefills the Rekt Meter from the brief: a tier-A figure and a different outlet beside it', () => {
		const r = rektFor(briefFor(fixtureSwap()));
		assert.deepEqual(r, {loss: '$4,200,000', usd: 4200000, source: 'defillama-hacks', alt: {loss: '$4.5 million', usd: 4500000, source: 'examplewire'}});
	});
	it('keeps feed text inert in tables', () => {
		assert.equal(cell('a | b [x](y) `c`\nd'), 'a \\| b \\[x\\](y) \\`c\\` d');
	});
	it('writes a must-not-say list the general claim gate can parse, with no feed text in quotes', () => {
		const b = briefFor(fixtureSwap());
		const r = renderResearchMd(b);
		assert.match(r, /^## Must not say$/m);
		assert.ok(!r.includes('"FixtureSwap says'), 'a headline must never become a quoted ban');
		assert.ok(!/according to/.test(r.split('## Must not say')[1]), 'never ban the attribution phrase');
	});
});

describe('prepare (end to end, radar mocked)', () => {
	it('runs the radar, writes brief.json, WRITER.md, research.md and the day report', () => {
		const {root, cleanup} = tempRoot();
		try {
			touch(join(root, 'scripts', 'radar', 'radar.py'));
			const {exec, calls} = fakeExec({
				radar: (req) => {
					assert.equal(argAfter(req, '--date'), DATE);
					seedRadarDay(root);
				},
			});
			const r = runPrepare({root, radar: 'live', exec, now: () => NOW, env: {}});
			assert.equal(r.exitCode, 0, r.messages.join('\n'));
			assert.equal(r.dateSlug, '2026-11-24-fixtureswap');
			assert.equal(calls.length, 1);
			assert.ok(!calls[0].args.includes('--user-agent'), 'the radar keeps its generic User-Agent unless the owner opts in');
			const dir = join(root, 'content', 'zoora-security', '2026-11-24-fixtureswap');
			for (const f of ['brief.json', 'WRITER.md', 'research.md']) assert.ok(existsSync(join(dir, f)), f);
			const b = JSON.parse(readFileSync(join(dir, 'brief.json'), 'utf8')) as DailyBrief;
			assert.equal(b.schema, 'zoora-security/daily-brief@1');
			const t = b.analysisOpportunities.find((o) => o.id === 'tracker-30d');
			assert.ok(t?.available, JSON.stringify(t));
			assert.deepEqual(b.alternates.map((a) => a.incidentId), ['2026-11-22-fixturebridge']);
			assert.ok(existsSync(join(root, 'out', 'daily', DATE, 'prepare.md')));
		} finally {
			cleanup();
		}
	});
	it('decides "no video today" (exit 3) when nothing qualifies', () => {
		const {root, cleanup} = tempRoot();
		try {
			seedRadarDay(root, [fixtureLend(), fixturePhish()]);
			const r = runPrepare({root, radar: 'reuse', exec: fakeExec().exec, now: () => NOW});
			assert.equal(r.exitCode, 3);
			assert.equal(r.dateSlug, null);
			const day = JSON.parse(readFileSync(join(root, 'out', 'daily', DATE, 'prepare.json'), 'utf8'));
			assert.equal(day.decision, 'no-video');
		} finally {
			cleanup();
		}
	});
	it('fails when the radar fails and no file exists, and keeps a written storyboard\'s brief', () => {
		const {root, cleanup} = tempRoot();
		try {
			touch(join(root, 'scripts', 'radar', 'radar.py'));
			const failing = fakeExec({radar: () => ({status: 1})});
			assert.equal(runPrepare({root, radar: 'live', exec: failing.exec, now: () => NOW}).exitCode, 1);
			seedRadarDay(root);
			assert.equal(runPrepare({root, radar: 'live', exec: failing.exec, now: () => NOW}).exitCode, 0, 'an earlier file for the date is used');
			writeJsonFile(join(root, 'content', 'zoora-security', '2026-11-24-fixtureswap', 'storyboard.json'), {});
			const again = runPrepare({root, radar: 'reuse', exec: fakeExec().exec, now: () => NOW});
			assert.equal(again.exitCode, 1);
			assert.match(again.messages.join(' '), /--force/);
			assert.equal(runPrepare({root, radar: 'reuse', exec: fakeExec().exec, now: () => NOW, force: true}).exitCode, 0);
		} finally {
			cleanup();
		}
	});
	it('refuses a radar file for another date or schema', () => {
		const {root, cleanup} = tempRoot();
		try {
			writeJsonFile(join(root, 'content', 'zoora-security', 'radar', `${DATE}.json`), {...radarFile([fixtureSwap()]), runDate: '2026-11-23'});
			const r = runPrepare({root, radar: 'reuse', exec: fakeExec().exec, now: () => NOW});
			assert.equal(r.exitCode, 1);
			assert.match(r.messages.join(' '), /not 2026-11-24/);
		} finally {
			cleanup();
		}
	});
});
