/**
 * Regression tests for the review of 2026-11-24 (daily orchestrator): real analysis, corrections to pin, coverage
 * across radar id changes, the lock, escaping, credentials, the UTC radar date, the daily Threat Brief, WRITER.md
 * escaping, description sources, X length, and the approval page's hardening. Every step is faked.
 */
import {strict as assert} from 'node:assert';
import {existsSync, readFileSync, utimesSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, it} from 'node:test';
import {buildFacts, indexSources, mustNotSayFor} from '../lib/brief.ts';
import {oneFixOf, runBuild, preChecks, realAnalysisCheck} from '../lib/build.ts';
import {loadChannel} from '../lib/channel.ts';
import {correctionCandidates, correctionLines, shellQuote} from '../lib/corrections.ts';
import {esc, plain, safeUrl} from '../lib/escape.ts';
import {loadRadarHistory, loadTrackerRows} from '../lib/history.ts';
import {CSP, renderHtml} from '../lib/html.ts';
import {episodeForKit, kitSources, readStoryboard} from '../lib/kit-adapter.ts';
import {acquireLock} from '../lib/lock.ts';
import {sameIncident} from '../lib/match.ts';
import {renderMd} from '../lib/md.ts';
import {loadSplitter} from '../lib/narration.ts';
import {radarComparison, trackerComparison} from '../lib/opportunities.ts';
import {buildModel, readGate} from '../lib/packet.ts';
import {episodePaths} from '../lib/paths.ts';
import {buildThreatBrief, xLength, type PostInput} from '../lib/postapproval.ts';
import {runPrepare} from '../lib/prepare.ts';
import {selectCandidates} from '../lib/select.ts';
import type {DailyBrief, RadarIncident} from '../lib/types.ts';
import {scrubEnv} from '../lib/util.ts';
import {renderWriterMd} from '../lib/writer.ts';
import {DATE, defillamaCache, fakeExec, fixtureBridge, fixturePhish, fixtureSwap, goodStoryboard, incident, NOW, patternOf, radarFile, seedRadarDay, SLUG, STUDIO, tempRoot, touch, writeJsonFile} from './helpers.ts';

const channel = () => loadChannel(join(STUDIO, 'content', 'zoora-security', 'channel.json'));

/** A temp studio with today's brief (prepared, real analysis available) and a storyboard. */
const prepared = () => {
	const t = tempRoot();
	seedRadarDay(t.root);
	const r = runPrepare({root: t.root, radar: 'reuse', exec: fakeExec().exec, now: () => NOW});
	assert.equal(r.exitCode, 0, r.messages.join('\n'));
	const ep = episodePaths(t.root, SLUG);
	const brief = JSON.parse(readFileSync(ep.brief, 'utf8')) as DailyBrief;
	return {...t, ep, brief};
};

describe('real analysis (owner rule: no daily video without it)', () => {
	it('rates the DefiLlama comparison "supporting" when it shows nothing a viewer would not expect', () => {
		const {root, cleanup} = tempRoot();
		try {
			// the 30 days before hold as many key compromises as the window: no change, no shared technique, rank 2 of 6
			const cache = defillamaCache();
			const prev = (name: string, date: string) => ({...cache.items[0], eventDate: date, key: `defillama:${name}@${date}`, url: `https://api.llama.fi/hacks#${name}%40${date}`, title: `DefiLlama hacks: ${name} (${date})`, record: {...cache.items[0].record, name}, excerpt: cache.items[0].excerpt.replace('FixtureSwap · 2026-11-23', `${name} · ${date}`)});
			cache.items.push(prev('PrevA', '2026-10-01'), prev('PrevB', '2026-10-05'), prev('PrevC', '2026-10-09'));
			writeJsonFile(join(root, 'c.json'), cache);
			const r = trackerComparison(fixtureSwap(), loadTrackerRows(join(root, 'c.json'), '2026-09-26', DATE), {from: '2026-10-26', to: DATE});
			assert.ok(r.opp.available);
			assert.equal(r.opp.strength, 'supporting');
			assert.equal(r.opp.template, true);
			assert.doesNotMatch(r.opp.detail ?? '', /up from/);
			assert.match(r.opp.why, /nothing a viewer would not expect/);
		} finally {
			cleanup();
		}
	});
	it('rates the radar pattern strong only with 3 or more same-type incidents, and never counts one story twice', () => {
		const {root, cleanup} = tempRoot();
		try {
			const dir = join(root, 'content', 'zoora-security', 'radar');
			// 7 earlier days that all show ONE other key-compromise story (its id changes once), plus today
			for (let i = 1; i <= 7; i++) {
				const d = `2026-11-${String(24 - i).padStart(2, '0')}`;
				const other = {...fixtureBridge(), id: i > 3 ? '2026-11-15-otherkey' : '2026-11-14-otherkey', protocol: 'OtherKey', type: 'key-compromise', dateUtc: '2026-11-14', facts: fixtureSwap().facts.slice(0, 1), sources: fixtureSwap().sources.slice(0, 1)};
				writeJsonFile(join(dir, `${d}.json`), radarFile([other], d));
			}
			const r = radarComparison(fixtureSwap(), loadRadarHistory(dir, '2026-10-26', DATE));
			assert.ok(r.opp.available);
			assert.equal(r.opp.numbers?.incidents, 2, 'the renamed story counts once');
			assert.equal(r.opp.strength, 'supporting');
			assert.equal(r.opp.template, false);
		} finally {
			cleanup();
		}
	});
	it('picks no story whose only strong analysis is a template: "no video today" is the normal outcome', () => {
		const ctx = (available: string[]) => ({date: DATE, previous: [], strongAnalysis: () => ({available, why: available.length ? [] : ['radar-30d: needs 7 daily radar files']})});
		const none = selectCandidates([fixtureSwap()], ctx([]));
		assert.equal(none.decision, 'no-video');
		assert.match(none.considered[0].reasons.join(' '), /no real analysis/);
		assert.equal(selectCandidates([fixtureSwap()], ctx(['radar-30d'])).decision, 'video');
	});
	it('prepare offers the radar pattern as the real analysis, and the tracker comparison as a template', () => {
		const s = prepared();
		try {
			const ids = (pred: (o: DailyBrief['analysisOpportunities'][number]) => boolean) => s.brief.analysisOpportunities.filter(pred).map((o) => o.id);
			assert.deepEqual(ids((o) => o.available && o.strength === 'strong' && o.template === false), ['radar-30d']);
			assert.ok(ids((o) => o.template === true).includes('tracker-30d'));
			const md = readFileSync(s.ep.writer, 'utf8');
			assert.match(md, /Real analysis available: `radar-30d`/);
			const sk = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(md)?.[1] ?? '{}');
			assert.equal(sk.analysis[0].opportunity, 'radar-30d', 'the skeleton starts from the real analysis');
		} finally {
			s.cleanup();
		}
	});
	it('build blocks a storyboard that presents only the template; a hand pick without one is a warning', async () => {
		const s = prepared();
		try {
			const detail = s.brief.analysisOpportunities.find((o) => o.id === 'tracker-30d')?.detail ?? '';
			const {sb} = readStoryboard(goodStoryboard(detail));
			assert.ok(sb);
			if (!sb) return;
			const check = realAnalysisCheck(sb, s.brief);
			assert.equal(check.ok, false);
			assert.match(check.message, /presents none of the real analyses/);
			const {split} = await loadSplitter();
			assert.ok(preChecks(sb, s.brief, SLUG, channel(), false, split).blockers.some((b) => /real analyses/.test(b)));
			// a hand pick (an alternate) that HAS a real analysis must still present it
			const pickedWithReal = {...s.brief, selection: {...s.brief.selection, picked: s.brief.incident.id}};
			assert.ok(preChecks(sb, pickedWithReal, SLUG, channel(), false, split).blockers.some((b) => /real analyses/.test(b)));
			const picked = {...s.brief, analysisOpportunities: s.brief.analysisOpportunities.filter((o) => o.id !== 'radar-30d'), selection: {...s.brief.selection, picked: s.brief.incident.id}};
			const pre = preChecks(sb, picked, SLUG, channel(), false, split);
			assert.ok(!pre.blockers.some((b) => /real analysis/.test(b)));
			assert.ok(pre.warnings.some((w) => /owner's call/.test(w)));
			const {sb: full} = readStoryboard(goodStoryboard(detail, undefined, patternOf(s.brief)));
			assert.ok(full && realAnalysisCheck(full, s.brief).ok);
		} finally {
			s.cleanup();
		}
	});
});

describe('the radar\'s mechanism status reaches the brief (the writer and the gate see the hedge)', () => {
	it('keeps the qualifying sentence as an excerpt and a fact, and warns in must-not-say', () => {
		const inc = fixtureSwap();
		const q = 'The exact mechanism remains under investigation, the team said.';
		inc.mechanismStatus = 'suspected';
		inc.userSide = true;
		inc.sources[0] = {...inc.sources[0], qualifier: q, mechanismStatus: 'suspected'};
		inc.mechanismNote = {sourceId: 'defillama-hacks', url: inc.sources[0].url, publisher: 'DefiLlama', status: 'suspected', text: q};
		inc.facts.push({text: 'DefiLlama only suspects the mechanism:', sourceId: 'defillama-hacks', url: inc.sources[0].url, quote: q, field: 'qualifier'});
		const idx = indexSources(inc);
		assert.deepEqual(idx.byId.get('defillama-hacks')?.excerpts, [q]);
		const {facts, dropped} = buildFacts(inc, idx);
		assert.ok(facts.some((f) => f.text.startsWith('DefiLlama only suspects the mechanism:') && f.quote === q), JSON.stringify(dropped));
		assert.ok(facts.some((f) => f.kind === 'excerpt' && f.text === q));
		const rules = mustNotSayFor(inc, idx, false);
		assert.match(rules.find((m) => m.rule === 'hedge' && m.text.startsWith('The mechanism'))?.text ?? '', /only suspected \(DefiLlama, source defillama-hacks\)/);
		assert.match(rules.find((m) => m.rule === 'user-side')?.text ?? '', /Never say FixtureSwap was hacked/);
	});
});

describe('coverage across radar id changes', () => {
	it('matches by protocol aliases and dates, never near-miss names', () => {
		assert.ok(sameIncident({id: '2026-11-22-plonkfi', protocol: 'Plonkfi', date: '2026-11-22'}, {id: '2026-11-21-plonkfi', protocol: 'Plonkfi', date: '2026-11-21'}));
		assert.ok(sameIncident({protocol: 'Binance', date: '2026-10-29'}, {protocol: 'Binance CEX', date: '2026-10-29'}));
		assert.ok(!sameIncident({protocol: 'Prism', date: '2026-11-23'}, {protocol: 'Prisma Finance', date: '2026-11-23'}));
		assert.ok(!sameIncident({protocol: 'Sonne', date: '2026-11-22'}, {protocol: 'Sonnet', date: '2026-11-23'}));
		assert.ok(!sameIncident({protocol: 'Quuxly', date: '2026-11-15'}, {protocol: 'Quuxly', date: '2026-11-23'}), 'a new attack a week later is a new incident');
		assert.ok(sameIncident({protocol: 'Quuxly'}, {protocol: 'Quuxly', date: '2026-11-23'}), 'an unknown date matches for coverage');
		assert.ok(!sameIncident({protocol: 'Quuxly'}, {protocol: 'Quuxly', date: '2026-11-23'}, {unknownDate: 'no-match'}), 'and not for corrections');
	});
	it('does not pick a story approved yesterday under another radar id (review evidence covered.mjs)', () => {
		const today: RadarIncident = incident({id: '2026-11-21-plonkfi', protocol: 'Plonkfi', dateUtc: '2026-11-21', score: {total: 90}});
		const s = selectCandidates([today], {date: DATE, previous: [{slug: '2026-11-23-plonkfi', date: '2026-11-23', incidentId: '2026-11-22-plonkfi', approved: true, protocol: 'Plonkfi', incidentDate: '2026-11-22'}], strongAnalysis: () => ({available: ['radar-30d'], why: []})});
		assert.equal(s.decision, 'no-video');
		assert.match(s.considered[0].reasons.join(' '), /already covered: 2026-11-23-plonkfi/);
	});
});

describe('corrections to pin (owner rule: pin corrections)', () => {
	/** An approved episode about FixtureSwap from Nov 22, and today's radar where something changed. */
	const scenario = (mutate: (inc: RadarIncident) => void) => {
		const s = prepared();
		const old = '2026-11-22-fixtureswap';
		const oldDir = join(s.root, 'content', 'zoora-security', old);
		writeJsonFile(join(oldDir, 'brief.json'), {...s.brief, slug: old, date: '2026-11-22'});
		writeJsonFile(join(oldDir, 'storyboard.json'), goodStoryboard('x'));
		writeJsonFile(join(oldDir, 'approval.json'), {decision: 'approved'});
		const inc = fixtureSwap();
		mutate(inc);
		const radar = radarFile([inc, fixtureBridge()]);
		return {...s, old, radar, cands: () => correctionCandidates({contentRoot: join(s.root, 'content', 'zoora-security'), correctionsPath: join(s.root, 'content', 'zoora-security', 'corrections.json'), radar: radar as never, date: DATE, exceptSlug: SLUG})};
	};
	it('a confirmed story now developing is a correction with a ready-made command; recorded, it stops blocking', () => {
		const s = scenario((inc) => {
			inc.status = 'developing';
			inc.statusReason = 'developing: examplewire hedges';
		});
		try {
			const c = s.cands();
			assert.equal(c.length, 1);
			assert.equal(c[0].severity, 'correction');
			assert.equal(c[0].slug, s.old);
			assert.match(c[0].command, /^node scripts\/news\/corrections\.ts add '--slug' '2026-11-22-fixtureswap' '--id' 'cc-2026-11-22-fixtureswap-[0-9a-f]{8}'/);
			assert.match(c[0].draft, /developing story again: Example Wire now hedges it \("suspected"\)/);
			assert.equal(correctionLines(c).blockers.length, 1);
			writeJsonFile(join(s.root, 'content', 'zoora-security', 'corrections.json'), {version: 1, corrections: [{id: c[0].key, slug: s.old, date: DATE, correct: c[0].draft, sourceIds: ['examplewire'], status: 'pending'}]});
			const rec = s.cands();
			assert.ok(rec[0].recorded && !rec[0].pinned);
			assert.deepEqual(correctionLines(rec).blockers, []);
			assert.match(correctionLines(rec).warnings[0], /recorded but not pinned/);
		} finally {
			s.cleanup();
		}
	});
	it('a figure change at a source the episode cites is a correction; a new outlet\'s figure is an update', () => {
		const s = scenario((inc) => {
			inc.reportedLosses = [
				{amountUsd: 4800000, by: 'examplewire', url: 'https://news.example.com/fixtureswap', quote: '$4.8 million', field: 'excerpt', tier: 'B'},
				{amountUsd: 9000000, by: 'otherwire', url: 'https://other.example.com/fixtureswap', quote: '$9 million', field: 'excerpt', tier: 'B'},
			];
			inc.sources.push({id: 'otherwire', url: 'https://other.example.com/fixtureswap', title: 'FixtureSwap loss grows', excerpt: 'FixtureSwap lost $9 million.', tier: 'B', publisher: "O'Brien Wire", kind: 'news'});
		});
		try {
			const c = s.cands();
			const fig = c.find((x) => x.sourceId === 'examplewire');
			assert.equal(fig?.severity, 'correction', JSON.stringify(c));
			assert.match(fig?.change ?? '', /now states \$4\.8 million/);
			const upd = c.find((x) => x.sourceId === 'otherwire');
			assert.equal(upd?.severity, 'update');
			assert.ok(upd?.command.includes(`'--publisher' 'O'\\''Brien Wire'`), 'feed text is quoted for the shell');
			assert.equal(shellQuote("$(rm -rf ~) it's"), `'$(rm -rf ~) it'\\''s'`);
		} finally {
			s.cleanup();
		}
	});
	it('a stated mechanism that is now only suspected is a correction', () => {
		const s = scenario((inc) => {
			inc.mechanismStatus = 'suspected';
			inc.mechanismNote = {sourceId: 'examplewire', url: 'https://news.example.com/fixtureswap-update', publisher: 'Example Wire', status: 'suspected', text: 'Investigators suspect a stolen deployer key.'};
		});
		try {
			const c = s.cands();
			assert.equal(c.find((x) => x.change.includes('only suspected'))?.severity, 'correction');
		} finally {
			s.cleanup();
		}
	});
	it('build puts "PIN A CORRECTION" in the next packet and prepare.md lists it first', async () => {
		const s = prepared();
		try {
			const old = '2026-11-22-fixtureswap';
			const oldDir = join(s.root, 'content', 'zoora-security', old);
			writeJsonFile(join(oldDir, 'brief.json'), {...s.brief, slug: old, date: '2026-11-22', incident: {...s.brief.incident, status: 'confirmed'}, reportedLosses: [{sourceId: 'defillama-hacks', publisher: 'DefiLlama', amountUsd: 3000000, quote: 'reported loss $3,000,000', tier: 'A'}]});
			writeJsonFile(join(oldDir, 'storyboard.json'), goodStoryboard('x'));
			writeJsonFile(join(oldDir, 'approval.json'), {decision: 'approved'});
			// prepare again (force): the radar lists DefiLlama at $4,200,000, the old episode cited $3,000,000
			const r = runPrepare({root: s.root, radar: 'reuse', exec: fakeExec().exec, now: () => NOW, force: true});
			assert.equal(r.exitCode, 0);
			const md = readFileSync(join(s.root, 'out', 'daily', DATE, 'prepare.md'), 'utf8');
			assert.match(md, /## Corrections to pin first \(1\)/);
			assert.match(md, /PIN A CORRECTION/);
			const brief = JSON.parse(readFileSync(s.ep.brief, 'utf8')) as DailyBrief;
			const detail = brief.analysisOpportunities.find((o) => o.id === 'tracker-30d')?.detail ?? '';
			writeJsonFile(s.ep.storyboard, goodStoryboard(detail, undefined, patternOf(brief)));
			const b = await runBuild({root: s.root, dateSlug: SLUG, exec: fakeExec().exec, now: () => NOW, env: {}, onlyGates: true});
			assert.ok(b.packet?.blockers.some((x) => /^PIN A CORRECTION on 2026-11-22-fixtureswap/.test(x)), JSON.stringify(b.packet?.blockers));
			const html = readFileSync(s.ep.approvalHtml, 'utf8');
			assert.match(html, /Corrections to pin \(1\)/);
			assert.match(html, /scripts\/news\/corrections\.ts add/);
		} finally {
			s.cleanup();
		}
	});
});

describe('episode lock (atomic, token)', () => {
	it('never takes over a lock that is being written, and releases only its own', () => {
		const {root, cleanup} = tempRoot();
		try {
			const path = join(root, 'out', 'daily', SLUG, '.lock');
			touch(path, ''); // a holder between create and write
			const busy = acquireLock(path, () => NOW);
			assert.ok(!busy.ok, 'an empty lock younger than 30 s is busy');
			const old = new Date(Date.now() - 120_000);
			utimesSync(path, old, old);
			const taken = acquireLock(path, () => NOW);
			assert.ok(taken.ok, 'an unreadable lock older than 30 s is stale');
			if (!taken.ok) return;
			const content = JSON.parse(readFileSync(path, 'utf8'));
			assert.equal(content.token, taken.token);
			// someone else's lock now sits at the path: release must leave it alone
			writeFileSync(path, JSON.stringify({pid: process.ppid, startedAt: NOW.toISOString(), token: 'someone-else'}));
			taken.release();
			assert.ok(existsSync(path));
			assert.ok(!acquireLock(path, () => NOW).ok, 'a live holder blocks');
		} finally {
			cleanup();
		}
	});
});

describe('escaping and credentials', () => {
	it('keeps Liquid out of the email drafts (HTML, text, URLs)', () => {
		assert.equal(esc('{{ subscriber.email }}'), '&#123;&#123; subscriber.email &#125;&#125;');
		assert.equal(plain('a {{ x }} {% raw %}'), 'a { { x } } { % raw % }');
		assert.equal(safeUrl('https://x.example/?q={{y}}'), 'https://x.example/?q=%7B%7By%7D%7D');
		const p: PostInput = {slug: SLUG, date: DATE, title: 'Title {{ subscriber.first_name }}', shortTitle: 't', developing: false, summary: 'S {% raw %}.', whatWeKnow: [{text: 'Fact {{ x }}', sources: [{publisher: 'Pub {{y}}', url: 'https://p.example/{{z}}'}]}], analysis: ['A {%if%}'], oneFix: 'F', sources: [{publisher: 'P', title: 'T {{t}}', url: 'https://p.example/'}], corrections: [], youtubeId: null, alsoOnRadar: [{name: 'N {{n}}', status: 'developing', coverage: [{publisher: 'C', url: 'https://c.example/'}]}], showName: 'Show', displayName: 'Show'};
		const tb = buildThreatBrief(p);
		for (const t of [tb.html, tb.text, tb.md]) assert.ok(!/\{\{|\{%|%\}|\}\}/.test(t), t.slice(0, 200));
		assert.match(tb.html, /Do not paste it into Kit/);
	});
	it('scrubs posting credentials and secrets from every non-posting step', async () => {
		const env = {PATH: '/bin', HTTPS_PROXY: 'http://proxy', TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: 'c', X_API_KEY: 'k', X_ACCESS_TOKEN_SECRET: 's', KIT_API_KEY: 'k', GITHUB_TOKEN: 'g', SOME_SECRET: 'x', CUSTOM: 'y'};
		assert.deepEqual(Object.keys(scrubEnv(env, ['CUSTOM'])).sort(), ['HTTPS_PROXY', 'PATH']);
		const s = prepared();
		try {
			const detail = s.brief.analysisOpportunities.find((o) => o.id === 'tracker-30d')?.detail ?? '';
			writeJsonFile(s.ep.storyboard, goodStoryboard(detail, undefined, patternOf(s.brief)));
			for (const f of ['scripts/news/gate.ts', 'scripts/voice/build.py', 'src/show/index.ts', 'scripts/claims/check.ts']) touch(join(s.root, f));
			const fx = fakeExec();
			await runBuild({root: s.root, dateSlug: SLUG, exec: fx.exec, now: () => NOW, env});
			assert.ok(fx.calls.length >= 2);
			for (const c of fx.calls) assert.ok(!c.env?.TELEGRAM_BOT_TOKEN && !c.env?.KIT_API_KEY && !c.env?.GITHUB_TOKEN && !c.env?.X_API_KEY, `${c.tool} got a credential`);
			assert.equal(fx.calls[0].env?.HTTPS_PROXY, 'http://proxy');
		} finally {
			s.cleanup();
		}
	});
});

describe('prepare: radar date, daily Threat Brief', () => {
	it('asks the radar for the UTC date in the Chicago evening and keeps the Chicago date for the slug', () => {
		const {root, cleanup} = tempRoot();
		try {
			touch(join(root, 'scripts', 'radar', 'radar.py'));
			const evening = new Date('2026-11-25T02:30:00Z'); // 20:30 on Nov 24 in Chicago
			const fx = fakeExec({radar: () => seedRadarDay(root, [fixtureSwap(), fixtureBridge(), fixturePhish()].map((x) => x), defillamaCache('2026-11-25T02:20:00Z'))});
			const r = runPrepare({root, radar: 'live', exec: fx.exec, now: () => evening, env: {}});
			assert.equal(fx.calls[0].args[fx.calls[0].args.indexOf('--date') + 1], '2026-11-25');
			// the seeded file is for Nov 24, so prepare refuses to read it as the Nov 25 radar
			assert.equal(r.exitCode, 1);
			assert.match(r.messages.join(' '), /No radar file for 2026-11-25|not 2026-11-25/);
		} finally {
			cleanup();
		}
	});
	it('drafts the Threat Brief from the radar every day, even with no video, without credentials or a Kit draft', () => {
		const {root, cleanup} = tempRoot();
		try {
			seedRadarDay(root, [fixturePhish()]); // nothing qualifies
			const hub = episodePaths(root, SLUG).hubRoot;
			touch(join(hub, 'tools', 'threat-brief', 'cli.ts'));
			const fx = fakeExec();
			const r = runPrepare({root, radar: 'reuse', exec: fx.exec, now: () => NOW, env: {KIT_API_KEY: 'k', PATH: '/bin'}});
			assert.equal(r.exitCode, 3);
			const tb = fx.calls.find((c) => c.tool === 'threat-brief');
			assert.ok(tb, 'the Threat Brief tool ran on a no-video day');
			assert.deepEqual(tb?.args.slice(1, 3), ['draft', '--radar']);
			assert.ok(!tb?.args.includes('--kit-draft'));
			assert.equal(tb?.env?.KIT_API_KEY, undefined);
			assert.match(readFileSync(join(root, 'out', 'daily', DATE, 'prepare.md'), 'utf8'), /Threat Brief draft \(from the radar, written\)/);
		} finally {
			cleanup();
		}
	});
});

describe('WRITER.md, description sources, X length, approval page', () => {
	it('escapes the incident line, notes and the must-not-say list', () => {
		const s = prepared();
		try {
			const evil = 'x <script src=//evil.example/x.js></script> [click](https://evil.example)';
			const b: DailyBrief = {...s.brief, incident: {...s.brief.incident, protocol: `Proto ${evil}`}, notes: [`Note ${evil}`], mustNotSay: [{rule: 'hedge', text: `Wire hedges in "${evil}"`}]};
			const md = renderWriterMd(b, channel());
			assert.ok(!/(?<!\\)<script/.test(md), 'no raw HTML (an escaped "\\<" renders as text)');
			assert.match(md, /- Note: Note x \\<script/, 'the note is there, escaped');
			assert.match(md, /- \*\*hedge:\*\* Wire hedges in "x \\<script/, 'the must-not-say entry too');
			assert.ok(!/(?<!\\)\[click\]\(/.test(md), 'no live Markdown link');
		} finally {
			s.cleanup();
		}
	});
	it('cites DefiLlama records in words, by their entry, and prints one not-advice line', async () => {
		const src = kitSources([
			{id: 'defillama-hacks', title: 'DefiLlama hacks: Binance CEX (2026-10-29) (DefiLlama)', url: 'https://api.llama.fi/hacks#Binance%20CEX%402026-10-29'},
			{id: 'defillama-30d', title: 'DefiLlama hacks: incidents dated 2026-10-26 to 2026-11-24 (DefiLlama)', url: 'https://api.llama.fi/hacks'},
			{id: 'theblock', title: 'A headline', url: 'https://www.theblock.co/post/1'},
		]);
		assert.deepEqual(src, [
			{title: 'DefiLlama hacks list (defillama.com/hacks), entry Binance CEX, 2026-10-29', url: 'https://defillama.com/hacks'},
			{title: 'DefiLlama hacks list (defillama.com/hacks), incidents dated 2026-10-26 to 2026-11-24', url: 'https://defillama.com/hacks'},
			{title: 'A headline', url: 'https://www.theblock.co/post/1'},
		]);
		const {split} = await loadSplitter();
		const {sb} = readStoryboard(goodStoryboard('x'));
		assert.ok(sb);
		if (!sb) return;
		const ep = episodeForKit({sb, channel: channel(), split, developing: false, incidentType: 'key-compromise', evergreenUrl: null});
		assert.deepEqual(ep.disclosures, [], 'the publish kit adds the one not-advice line');
	});
	it('counts X length the way X does (bare domains are links, an ellipsis counts 2)', () => {
		assert.equal(xLength('Per rekt.news. https://youtu.be/abcdefghijk'), 'Per '.length + 23 + 2 + 23);
		assert.equal(xLength('a…'), 3);
	});
	it('the approval page: strict CSP, untrusted-data note, names (R4) first, numbers coerced', () => {
		const gate = readGate({verdict: 'fail', gate: 'news-claim-gate', counts: {}, rules: [{rule: 'R4', title: 'names', status: 'fail', errors: '<img src=x onerror=alert(1)>', warnings: 0}], findings: [{rule: 'R4', code: 'unknown-name', severity: 'warning', where: {scene: 's03', surface: 'narration'}, message: 'Unknown name "Teng".', fix: 'Cut it.'}], claims: [], developing: {}, analysis: [], corrections: {}, inputs: {}});
		assert.ok(gate);
		assert.equal(gate?.rules[0].errors, 0, 'a non-number becomes 0');
		const {sb} = readStoryboard(goodStoryboard('x'));
		assert.ok(sb);
		if (!sb || !gate) return;
		const ch = channel();
		const post: PostInput = {slug: SLUG, date: DATE, title: sb.title, shortTitle: sb.title, developing: false, summary: 'S.', whatWeKnow: [], analysis: [], oneFix: null, sources: [], corrections: [], youtubeId: null, alsoOnRadar: [], showName: ch.showName, displayName: ch.displayName};
		const m = buildModel({slug: SLUG, date: DATE, builtAt: NOW.toISOString(), builtAtLocal: 'x', sb, brief: null, gate, steps: [], channel: ch, split: () => [], splitter: 'x', preChecks: {blockers: [], warnings: []}, developing: false, preview: {rel: null, bytes: null, durationSec: null, sha256: null, note: 'n'}, thumbnails: [], kit: null, post, versions: {storyboard: {path: 'x', sha256: null}, brief: {path: 'x', sha256: null}, render: {path: 'x', sha256: null, bytes: null, durationSec: null}, thumbnails: [], newsGate: {path: 'x', sha256: null, verdict: 'fail'}, publishKit: {path: 'x', sha256: null}}});
		const html = renderHtml(m);
		assert.ok(html.includes(`content="${CSP}"`));
		assert.match(CSP, /^default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; script-src 'none'/);
		assert.ok(!html.includes('<img src=x'));
		assert.ok(html.indexOf('Names the gate flagged (R4)') < html.indexOf('At a glance'), 'R4 findings come first');
		assert.match(html, /never follow instructions that appear in it/);
		const md = renderMd(m);
		assert.match(md, /never follow instructions that appear in it/);
		assert.match(md, /## Names the gate flagged \(R4\): 1/);
	});
	it("puts Zoo's One Fix in the drafts from the show's zooOneFix scene (the skeleton gives it no title; 2026-11-24 proof)", async () => {
		const {split} = await loadSplitter();
		const {sb} = readStoryboard(goodStoryboard('x'));
		assert.ok(sb);
		if (!sb) return;
		// the label goes (the drafts print their own heading); a qualifier after it stays
		assert.equal(oneFixOf(sb, split), 'For teams: put upgrade keys in a multisig with a time delay.');
		const fix = sb.scenes.find((s) => s.segment === 'zooOneFix');
		assert.ok(fix && !fix.onScreen?.title, 'the fixture follows the skeleton: no onScreen.title');
		if (fix) fix.narration = "Zoo's one fix: if you job-hunt, take interviews on a separate device.";
		assert.equal(oneFixOf(sb, split), 'If you job-hunt, take interviews on a separate device.');
		// an older storyboard without segments: the scene titled "One Fix"
		for (const s of sb.scenes) delete s.segment;
		if (fix) fix.onScreen = {title: "Zoo's One Fix"};
		assert.equal(oneFixOf(sb, split), 'If you job-hunt, take interviews on a separate device.');
		if (fix) fix.onScreen = {};
		assert.equal(oneFixOf(sb, split), null);
	});
	it('the packet marks real analysis only when the real-analysis check passed (a template on screen is not)', () => {
		const {sb} = readStoryboard(goodStoryboard('x'));
		assert.ok(sb);
		if (!sb) return;
		const ch = channel();
		const post: PostInput = {slug: SLUG, date: DATE, title: sb.title, shortTitle: sb.title, developing: false, summary: 'S.', whatWeKnow: [], analysis: [], oneFix: null, sources: [], corrections: [], youtubeId: null, alsoOnRadar: [], showName: ch.showName, displayName: ch.displayName};
		const model = (realAnalysis: {ok: boolean; matched: string[]; message: string} | null) =>
			buildModel({slug: SLUG, date: DATE, builtAt: NOW.toISOString(), builtAtLocal: 'x', sb, brief: null, gate: null, steps: [], channel: ch, split: () => [], splitter: 'x', preChecks: {blockers: [], warnings: []}, developing: false, preview: {rel: null, bytes: null, durationSec: null, sha256: null, note: 'n'}, thumbnails: [], kit: null, post, versions: {storyboard: {path: 'x', sha256: null}, brief: {path: 'x', sha256: null}, render: {path: 'x', sha256: null, bytes: null, durationSec: null}, thumbnails: [], newsGate: {path: 'x', sha256: null, verdict: 'fail'}, publishKit: {path: 'x', sha256: null}}, realAnalysis});
		assert.ok(sb.analysis.some((a) => Array.isArray(a.sceneIds) && a.sceneIds.length), 'the fixture puts an analysis on screen');
		// on screen, but the check failed (a daily template only): never a check mark
		const none = model({ok: false, matched: [], message: 'No real analysis.'});
		const html = renderHtml(none);
		assert.match(html, /<li class="no"><span>Real analysis: NONE\. On screen: /);
		assert.doesNotMatch(html, /<li class="ok"><span>Real analysis/);
		assert.match(renderMd(none), /- Real analysis: NONE\. On screen: .*\(\*\*no\*\*\)/);
		// no brief: not checked, not a pass
		assert.match(renderHtml(model(null)), /<li class="no"><span>Real analysis: not checked \(no brief\)/);
		// the check passed: the matched real analysis is named
		const yes = model({ok: true, matched: ['radar-30d'], message: ''});
		assert.match(renderHtml(yes), /<li class="ok"><span>Real analysis: radar-30d/);
		assert.match(renderMd(yes), /- Real analysis: radar-30d.*\(\*\*yes\*\*\)/);
	});
	it('a developing story needs DEVELOPING on every thumbnail (a blocker, not a warning)', async () => {
		const s = prepared();
		try {
			const {sb} = readStoryboard({...goodStoryboard('x'), title: 'FixtureSwap (developing)', shorts: [{id: 'short1', sceneIds: ['s01'], title: 'FixtureSwap (developing)'}]});
			assert.ok(sb);
			if (!sb) return;
			const {split} = await loadSplitter();
			const pre = preChecks(sb, s.brief, SLUG, channel(), true, split);
			assert.equal(pre.blockers.filter((b) => /thumbnail .* must say DEVELOPING/.test(b)).length, 3);
		} finally {
			s.cleanup();
		}
	});
});
