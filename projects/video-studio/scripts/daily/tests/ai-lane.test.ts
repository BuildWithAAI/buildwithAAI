/** The AI-security lane in the daily system: lanes read from the radar, the pick, brief.json, WRITER.md and the hidden Rekt Meter. */
import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, it} from 'node:test';
import {buildBrief, indexSources, kindOf, mustNotSayFor} from '../lib/brief.ts';
import {parseChannel} from '../lib/channel.ts';
import {runPrepare} from '../lib/prepare.ts';
import {readRadarFile} from '../lib/radar.ts';
import {selectCandidates} from '../lib/select.ts';
import type {DailyBrief, RadarIncident} from '../lib/types.ts';
import {isAiStory} from '../lib/types.ts';
import {renderWriterMd, skeleton} from '../lib/writer.ts';
import {renderResearchMd} from '../lib/research.ts';
import {DATE, fakeExec, fixtureSwap, incident, NOW, radarFile, seedRadarDay, STUDIO, tempRoot, writeJsonFile} from './helpers.ts';

const channel = () => parseChannel(JSON.parse(readFileSync(join(STUDIO, 'content', 'zoora-security', 'channel.json'), 'utf8')));

/** A fictional AI-security incident: a research post (tier A), an outlet (tier B), an incident-database listing (tier C), no loss figure. */
const fixtureAgent = (over: Partial<RadarIncident> = {}): RadarIncident =>
	incident({
		id: '2026-11-24-exampleagent',
		protocol: 'ExampleAgent',
		lane: 'ai',
		title: 'ExampleAgent: prompt injection',
		type: 'prompt-injection',
		evergreenTopic: 'ai-security',
		chains: [],
		reportedLosses: [],
		score: {total: 88, factors: {loss: {value: 0.6, weight: 25, points: 15, reason: 'AI security, harm instead of a dollar figure: a fix, advisory or takedown shipped (Example Security Lab, tier A)'}}},
		sources: [
			{id: 'examplelab-blog', url: 'https://lab.example.org/research/exampleagent', title: 'Hidden instructions on web pages hijacked ExampleAgent', excerpt: 'Example Security Lab found that hidden instructions on a web page could make the ExampleAgent coding agent read local secrets. The vendor shipped a fix.', publishedUtc: '2026-11-24T08:00:00Z', tier: 'A', publisher: 'Example Security Lab', kind: 'news', lane: 'ai'},
			{id: 'examplewire', url: 'https://news.example.com/exampleagent', title: 'ExampleAgent patches prompt injection flaw', excerpt: 'The vendor said it fixed the prompt injection issue in its coding agent.', publishedUtc: '2026-11-24T09:00:00Z', tier: 'B', publisher: 'Example Wire', kind: 'news', lane: 'ai'},
			{id: 'aiid', url: 'https://reports.example.net/exampleagent', title: 'ExampleAgent coding agent leaks secrets', excerpt: 'A report listed by the incident database.', publishedUtc: '2026-11-24T00:00:00Z', tier: 'C', publisher: 'AI Incident Database', kind: 'news', tracker: true, listedReport: true, trackerUrl: 'https://incidentdatabase.ai/cite/1#1', lane: 'ai'},
		],
		facts: [{text: 'Example Security Lab headline, 2026-11-24:', sourceId: 'examplelab-blog', url: 'https://lab.example.org/research/exampleagent', quote: 'Hidden instructions on web pages hijacked ExampleAgent', field: 'title'}],
		...over,
	});

const ctx = (over: Partial<Parameters<typeof selectCandidates>[1]> = {}) => ({date: DATE, previous: [], strongAnalysis: () => ({available: ['radar-30d'], why: []}), ...over});

const briefFor = (inc: RadarIncident): DailyBrief => {
	const sel = selectCandidates([inc], ctx({pick: inc.id}));
	return buildBrief({inc, date: DATE, dateSlug: sel.primary!.dateSlug, now: NOW.toISOString(), channel: channel(), radar: {file: radarFile([inc]) as never, path: 'content/zoora-security/radar/2026-11-24.json', sha256: 'x'}, selection: sel, opportunities: [], history: {radarFiles: 0, radarFrom: DATE, radarTo: DATE, trackerRows: 0, trackerFetchedUtc: null, previousEpisodes: [], notes: []}, otherProtocols: []});
};

describe('AI lane', () => {
	it('reads the lane from the radar file, and an older file without lanes as crypto', () => {
		const {root, cleanup} = tempRoot();
		try {
			const path = join(root, 'content', 'zoora-security', 'radar', `${DATE}.json`);
			const old = fixtureSwap();
			delete (old as {lane?: string}).lane;
			writeJsonFile(path, radarFile([fixtureAgent(), old]));
			const r = readRadarFile(path, DATE, 'live');
			assert.ok(r.ok);
			if (!r.ok) return;
			assert.deepEqual(r.file.top.map((i) => i.lane), ['ai', 'crypto']);
		} finally {
			cleanup();
		}
	});

	it('lets an AI story compete on the same rules, and says its lane', () => {
		const s = selectCandidates([fixtureAgent(), fixtureSwap()], ctx());
		assert.equal(s.primary?.incidentId, '2026-11-24-exampleagent');
		assert.equal(s.primary?.lane, 'ai');
		assert.equal(s.considered.find((c) => c.incidentId === '2026-11-23-fixtureswap')?.lane, 'crypto');
		const developing = selectCandidates([fixtureAgent({status: 'developing', shortReady: {ready: false, missing: ['not confirmed']}})], ctx());
		assert.equal(developing.decision, 'no-video', 'a developing AI story is never picked automatically');
		assert.ok(selectCandidates([fixtureAgent({status: 'developing'})], ctx({pick: '2026-11-24-exampleagent'})).primary, 'the owner can pick it by hand');
	});

	it('builds an AI brief: lane, AI how-to rule, listings are discovery only', () => {
		const inc = fixtureAgent();
		assert.ok(isAiStory(inc));
		assert.ok(!isAiStory(fixtureSwap()));
		assert.ok(!isAiStory({type: 'prompt-injection', lane: 'crypto'}));
		const brief = briefFor(inc);
		assert.equal(brief.incident.lane, 'ai');
		assert.equal(brief.evergreenTopic, 'ai-security');
		assert.equal(brief.evergreen?.title, 'AI agents, prompt injection and malicious plugins');
		const rules = brief.mustNotSay.map((m) => m.rule);
		assert.ok(rules.includes('ai-how-to'));
		assert.ok(rules.includes('listed-report'));
		assert.ok(rules.includes('tier-c'));
		assert.deepEqual(brief.reportedLosses, []);
		const listed = brief.sources.find((s) => s.feed === 'aiid');
		assert.equal(listed?.kind, 'tracker');
		assert.equal(listed?.listedReport, true);
		assert.equal(kindOf(inc.sources[0]), 'security-firm', 'a tier-A research blog');
		assert.match(renderResearchMd(brief), /AI story: any prompt, injected instruction/);
		const crypto = mustNotSayFor(fixtureSwap(), indexSources(fixtureSwap()), false).map((m) => m.rule);
		assert.ok(!crypto.includes('ai-how-to') && !crypto.includes('listed-report'), 'crypto briefs are unchanged');
	});

	it('writes AI guidance in WRITER.md and hides the Rekt Meter when no source states a loss', () => {
		const brief = briefFor(fixtureAgent());
		const md = renderWriterMd(brief, channel());
		assert.match(md, /## AI security story \(read this first\)/);
		assert.match(md, /safe, non-operational level/);
		assert.match(md, /Attribute every claim/);
		assert.match(md, /Zoo's One Fix for users/);
		assert.match(md, /the Rekt Meter is hidden/i);
		assert.ok(md.indexOf('## AI security story') < md.indexOf('## The story'));
		const sk = skeleton(brief, channel()) as {scenes: Array<Record<string, unknown> & {onScreen?: Record<string, unknown>}>};
		const s02 = sk.scenes.find((s) => s.id === 's02')!;
		assert.equal(s02.rekt, undefined, 'no rekt: never $0');
		assert.equal(s02.onScreen?.loss, undefined, 'no loss on screen');
		assert.ok(!JSON.stringify(sk).includes('"usd":0'));
		const s03 = sk.scenes.find((s) => s.id === 's03') as {diagram: {nodes: string[]}};
		assert.deepEqual(s03.diagram.nodes, ['site', 'agent', 'key']);
		assert.match(String(sk.scenes.find((s) => s.id === 's06')?.narration), /Suggested: Update the AI tool/);
	});

	it('marks a developing AI story DEVELOPING first', () => {
		const brief = briefFor(fixtureAgent({status: 'developing', shortReady: {ready: false, missing: ['not confirmed']}}));
		const md = renderWriterMd(brief, channel());
		assert.match(md, /\*\*DEVELOPING\.\*\* This story is not confirmed/);
		assert.ok(brief.mustNotSay.some((m) => m.rule === 'developing'));
	});

	it('keeps the crypto skeleton: a reported figure still fills the Rekt Meter', () => {
		const sel = selectCandidates([fixtureSwap()], ctx({pick: '2026-11-23-fixtureswap'}));
		const brief = buildBrief({inc: fixtureSwap(), date: DATE, dateSlug: sel.primary!.dateSlug, now: NOW.toISOString(), channel: channel(), radar: {file: radarFile([fixtureSwap()]) as never, path: 'x', sha256: 'x'}, selection: sel, opportunities: [], history: {radarFiles: 0, radarFrom: DATE, radarTo: DATE, trackerRows: 0, trackerFetchedUtc: null, previousEpisodes: [], notes: []}, otherProtocols: []});
		const sk = skeleton(brief, channel()) as {scenes: Array<{id: string; rekt?: {usd: number}; onScreen?: Record<string, unknown>}>};
		const s02 = sk.scenes.find((s) => s.id === 's02')!;
		assert.equal(s02.rekt?.usd, 4200000);
		assert.equal(s02.onScreen?.loss, '$4,200,000');
		assert.doesNotMatch(renderWriterMd(brief, channel()), /AI security story/);
	});

	it('prepares an AI story end to end (prepare --pick), with the lane in prepare.md', () => {
		const {root, cleanup} = tempRoot();
		try {
			seedRadarDay(root, [fixtureSwap(), fixtureAgent({status: 'developing', shortReady: {ready: false, missing: ['not confirmed']}})]);
			const {exec} = fakeExec();
			const r = runPrepare({root, date: DATE, radar: 'reuse', pick: '2026-11-24-exampleagent', exec, now: () => NOW, env: {}});
			assert.equal(r.exitCode, 0, r.messages.join('\n'));
			assert.equal(r.dateSlug, '2026-11-24-exampleagent');
			const dir = join(root, 'content', 'zoora-security', '2026-11-24-exampleagent');
			const brief = JSON.parse(readFileSync(join(dir, 'brief.json'), 'utf8')) as DailyBrief;
			assert.equal(brief.incident.lane, 'ai');
			assert.equal(brief.status, 'developing');
			assert.match(readFileSync(join(dir, 'WRITER.md'), 'utf8'), /AI security story/);
			const prep = readFileSync(join(root, 'out', 'daily', DATE, 'prepare.md'), 'utf8');
			assert.match(prep, /\| Lane \|/);
			assert.match(prep, /\| ExampleAgent: prompt injection \| ai \|/);
		} finally {
			cleanup();
		}
	});
});
