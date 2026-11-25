/**
 * The AI-lane review (2026-11-25): the Threat Brief draft is "written" only when its files exist and are fresh (and
 * the real CLI runs through a symlinked hub); a hub tool that exits 0 having produced nothing is a failure; a crypto
 * story and an AI story that share a name are never one incident (corrections, coverage); listings are leads, never
 * facts; a subject read from a headline's shape is never allowlisted; the suggested AI One Fix texts pass the news
 * gate; withheld links and hidden characters never reach the outputs.
 */
import {strict as assert} from 'node:assert';
import {existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {describe, it} from 'node:test';
import {mkdtempSync} from 'node:fs';
import {runRules} from '../../news/lib/rules.ts';
import {buildFacts, indexSources} from '../lib/brief.ts';
import {radarMatch} from '../lib/corrections.ts';
import {realExec} from '../lib/exec.ts';
import {kitSources} from '../lib/kit-adapter.ts';
import {lanesCompatible, sameIncident} from '../lib/match.ts';
import {runPostApproval} from '../lib/postapproval.ts';
import {readRadarFile, subjectKnown} from '../lib/radar.ts';
import {summarize} from '../lib/select.ts';
import type {DailyBrief, RadarIncident} from '../lib/types.ts';
import {AI_STORY} from '../lib/writer.ts';
import {DATE, fakeExec, fixtureSwap, incident, NOW, radarFile, seedRadarDay, SLUG, STUDIO, tempRoot, touch, writeJsonFile} from './helpers.ts';
import {episodePaths} from '../lib/paths.ts';
import {runPrepare, threatBriefDraft} from '../lib/prepare.ts';

const HUB = resolve(STUDIO, '..', 'creator-hub');
const NEWS_GOOD = join(STUDIO, 'scripts', 'news', 'fixtures', 'zoora-security', 'good-fixtureswap-drain');

describe('the Threat Brief draft is written only when its files exist', () => {
	const hub = (root: string): string => {
		const h = join(root, 'hub');
		touch(join(h, 'tools', 'threat-brief', 'cli.ts'));
		return h;
	};
	it('a tool that exits 0 but writes nothing is a failure, and an old draft is removed first', () => {
		const {root, cleanup} = tempRoot();
		try {
			const outDir = join(root, 'out', 'daily', DATE, 'threat-brief');
			mkdirSync(outDir, {recursive: true});
			writeFileSync(join(outDir, `${DATE}.md`), 'yesterday');
			writeFileSync(join(outDir, `${DATE}.html`), 'yesterday');
			const fx = fakeExec(); // exits 0, prints and writes nothing (the symlinked-path bug)
			const tb = threatBriefDraft({root, hubRoot: hub(root), radarPath: join(root, 'r.json'), outDir, exec: fx.exec, env: {}, date: DATE, allowlist: join(root, 'allow.json')});
			assert.equal(tb.status, 'failed');
			assert.match(tb.note, /exited 0 but wrote no draft/);
			assert.equal(existsSync(join(outDir, `${DATE}.md`)), false, "yesterday's draft is never passed off as today's");
			const args = fx.calls[0]!.args;
			assert.equal(args[args.indexOf('--allowlist') + 1], join(root, 'allow.json'), 'the news allowlist is passed explicitly');
		} finally {
			cleanup();
		}
	});
	it('the real CLI writes its draft through a symlinked hub path', () => {
		const tmp = mkdtempSync(join(tmpdir(), 'daily-tb-link-'));
		try {
			const link = join(tmp, 'hub');
			symlinkSync(HUB, link);
			const outDir = join(tmp, 'out');
			const radarPath = join(HUB, 'tools', 'threat-brief', 'fixtures', 'radar.json');
			const tb = threatBriefDraft({root: STUDIO, hubRoot: link, radarPath, outDir, exec: realExec, env: {PATH: process.env.PATH ?? ''}, date: '2026-11-24', allowlist: join(HUB, 'tools', 'threat-brief', 'fixtures', 'allowlist.json')});
			assert.equal(tb.status, 'written', tb.note);
			assert.ok(existsSync(join(outDir, '2026-11-24.md')) && existsSync(join(outDir, '2026-11-24.html')));
			assert.equal(tb.command?.[1], realpathSync(join(link, 'tools', 'threat-brief', 'cli.ts')), 'the CLI is launched by its real path');
		} finally {
			rmSync(tmp, {recursive: true, force: true});
		}
	});
});

describe('a hub tool that exits 0 must have produced something', () => {
	const call = (root: string, hubRoot: string, stdout: string) =>
		runPostApproval({tool: 'threat-brief', outDir: join(root, 'out'), hubRoot, root, files: {'threat-brief.md': 'x'}, input: {a: 1}, credentialEnv: ['KIT_API_KEY'], videoKnown: false, exec: fakeExec({'threat-brief': () => ({stdout})}).exec, env: {}});
	it('records hub-failed, never "ran as a dry run"', () => {
		const {root, cleanup} = tempRoot();
		try {
			touch(join(root, 'hub', 'tools', 'threat-brief', 'cli.ts'));
			const silent = call(root, join(root, 'hub'), '');
			assert.equal(silent.mode, 'hub-failed');
			assert.equal(silent.status, 'failed');
			assert.match(silent.note, /exited 0 but produced nothing/);
			const ran = call(root, join(root, 'hub'), '  wrote out/brief.md');
			assert.equal(ran.mode, 'hub-dry-run');
		} finally {
			cleanup();
		}
	});
	it('launches the hub CLI by its real path', () => {
		const {root, cleanup} = tempRoot();
		try {
			touch(join(root, 'real-hub', 'tools', 'threat-brief', 'cli.ts'));
			symlinkSync(join(root, 'real-hub'), join(root, 'hub'));
			const fx = fakeExec({'threat-brief': () => ({stdout: '  wrote x'})});
			runPostApproval({tool: 'threat-brief', outDir: join(root, 'out'), hubRoot: join(root, 'hub'), root, files: {}, input: {}, credentialEnv: [], videoKnown: false, exec: fx.exec, env: {}});
			assert.equal(fx.calls[0]!.args[0], realpathSync(join(root, 'real-hub', 'tools', 'threat-brief', 'cli.ts')));
		} finally {
			cleanup();
		}
	});
});

describe('a crypto story and an AI story that share a name are two incidents', () => {
	const ncsc = (): RadarIncident => incident({id: '2026-11-24-national-cyber-security-centre', protocol: 'National Cyber Security Centre', lane: 'ai', type: 'ai-assisted-attack', dateUtc: '', firstSeenUtc: '2026-11-24'});
	const cyber = (): RadarIncident => incident({id: '2026-11-22-cyber-bridge', protocol: 'Cyber Bridge', lane: 'crypto', type: 'bridge', dateUtc: '2026-11-21'});
	const episode = {id: '2026-11-21-cyber-bridge', protocol: 'Cyber Bridge', type: 'bridge', dateUtc: '2026-11-21', lane: 'crypto'} as unknown as DailyBrief['incident'];

	it('lanes and type families', () => {
		assert.equal(lanesCompatible('crypto', 'ai'), false);
		assert.equal(lanesCompatible(undefined, 'ai'), false, 'no lane is crypto');
		assert.ok(lanesCompatible('both', 'ai') && lanesCompatible('both', 'crypto'));
		assert.equal(sameIncident({protocol: 'Cyber Bridge', date: '2026-11-21', lane: 'crypto'}, {protocol: 'National Cyber Security Centre', date: '2026-11-22', lane: 'ai'}), false);
		assert.equal(sameIncident({protocol: 'DeepSeek', date: '2026-11-23', lane: 'both', type: 'rug'}, {protocol: 'DeepSeek', date: '2026-11-23', lane: 'ai', type: 'ai-data-exposure'}), false);
		assert.equal(sameIncident({protocol: 'Gemini', date: '2026-11-23', lane: 'both'}, {protocol: 'Gemini', date: '2026-11-23', lane: 'crypto'}), true);
	});
	it('corrections compare an episode only with its own incident', () => {
		assert.equal(radarMatch(episode, [ncsc()]), null, 'an AI incident ranked above is not the crypto episode');
		assert.equal(radarMatch(episode, [ncsc(), cyber()])?.id, '2026-11-22-cyber-bridge');
		const exact = incident({id: '2026-11-21-cyber-bridge', protocol: 'Cyber Bridge', lane: 'crypto', type: 'bridge', dateUtc: '2026-11-21'});
		assert.equal(radarMatch(episode, [cyber(), exact])?.id, '2026-11-21-cyber-bridge', 'the same id wins');
	});
	it('an approved AI episode never marks a crypto incident covered', () => {
		const s = summarize(cyber(), 1, {
			date: DATE,
			previous: [{slug: '2026-11-23-ncsc', date: '2026-11-23', incidentId: 'x', approved: true, protocol: 'National Cyber Security Centre', lane: 'ai', type: 'ai-assisted-attack'}],
			strongAnalysis: () => ({available: ['radar-30d'], why: []}),
		});
		assert.ok(!s.reasons.some((r) => r.startsWith('already covered')), s.reasons.join('; '));
	});
});

describe('listings, subjects, links and hidden characters', () => {
	const listed = (): RadarIncident =>
		incident({
			id: '2026-11-23-exampleagent',
			protocol: 'ExampleAgent',
			lane: 'ai',
			type: 'ai-data-exposure',
			sources: [
				{id: 'examplewire', url: 'https://news.example.com/agent', title: 'Agent flaw exposed secrets', excerpt: 'The vendor fixed the flaw.', publishedUtc: '2026-11-23T05:00:00Z', tier: 'B', publisher: 'Example Wire', kind: 'news'},
				{id: 'aiid', url: 'https://outlet.example.org/agent-secrets', title: 'Agent secrets on GitHub', excerpt: 'Researchers found 31,088 secrets.', publishedUtc: null, tier: 'C', publisher: 'AI Incident Database', kind: 'news', listedReport: true},
			],
		});
	it('a listing is never a fact the script may use', () => {
		const idx = indexSources(listed());
		const {facts} = buildFacts(listed(), idx);
		assert.ok(facts.every((f) => !f.sourceIds.includes('aiid')), JSON.stringify(facts.map((f) => f.sourceIds)));
		assert.ok(facts.some((f) => f.sourceIds.includes('examplewire')));
	});
	it('subjectKnown: older crypto files yes, AI subjects only when the radar says so', () => {
		assert.equal(subjectKnown(fixtureSwap()), true);
		assert.equal(subjectKnown(listed()), false);
		assert.equal(subjectKnown({...listed(), subjectKnown: true}), true);
	});
	it('a withheld link and the redaction placeholder are cited in words', () => {
		const out = kitSources([{id: 'a', title: 'Crypto trader [named person] says his wallet was hacked', url: 'https://www.coindesk.com/'}]);
		assert.equal(out[0]?.url, 'https://www.coindesk.com/');
		assert.match(out[0]?.title ?? '', /^Crypto trader \(name withheld\) says his wallet was hacked \(www\.coindesk\.com home page: the article's own link names a person\)$/);
	});
	it('the radar reader strips hidden characters and passes on the radar run warnings', () => {
		const {root, cleanup} = tempRoot();
		try {
			const tag = String.fromCodePoint(0xe0069);
			const inc = fixtureSwap();
			inc.sources[0]!.title = `${inc.sources[0]!.title}${tag}‮`;
			const path = join(root, 'r.json');
			writeJsonFile(path, {...radarFile([inc]), warnings: ['scripts/news/allowlist.json is missing: AI subjects are known products only']});
			const read = readRadarFile(path, DATE, 'reuse');
			assert.ok(read.ok);
			if (!read.ok) return;
			assert.equal(read.file.top[0]!.sources[0]!.title, fixtureSwap().sources[0]!.title);
			assert.ok(read.problems.some((p) => p.startsWith('radar: scripts/news/allowlist.json is missing')));
		} finally {
			cleanup();
		}
	});
	it('WRITER.md lists listings as leads, never as facts', () => {
		const {root, cleanup} = tempRoot();
		try {
			const swap = fixtureSwap();
			swap.sources.push({id: 'aiid', url: 'https://outlet.example.org/fixtureswap-secrets', title: 'FixtureSwap deploy scripts leak secrets', excerpt: 'Researchers found 31,088 secrets.', publishedUtc: null, tier: 'C', publisher: 'AI Incident Database', kind: 'news', listedReport: true});
			seedRadarDay(root, [swap]);
			const r = runPrepare({root, radar: 'reuse', exec: fakeExec().exec, now: () => NOW});
			assert.equal(r.exitCode, 0, r.messages.join('\n'));
			const ep = episodePaths(root, SLUG);
			const md = readFileSync(ep.writer, 'utf8');
			assert.match(md, /## Leads only \(never cite\)/);
			assert.match(md, /AI Incident Database lists: FixtureSwap deploy scripts leak secrets/);
			const brief = JSON.parse(readFileSync(ep.brief, 'utf8')) as DailyBrief;
			assert.ok(brief.facts.every((f) => !f.sourceIds.includes('aiid')));
			assert.ok(brief.mustNotSay.some((m) => m.rule === 'listed-report' && /even next to another source/.test(m.text)));
		} finally {
			cleanup();
		}
	});
});

describe('the suggested AI One Fix texts pass the news gate', () => {
	const allow = JSON.parse(readFileSync(join(STUDIO, 'scripts', 'news', 'allowlist.json'), 'utf8'));
	for (const [type, story] of Object.entries(AI_STORY)) {
		for (const narration of [`Zoo's one fix: ${story.fix}`, story.fix]) {
			it(`${type}: ${narration.slice(0, 40)}`, () => {
				const sb = JSON.parse(readFileSync(join(NEWS_GOOD, 'storyboard.json'), 'utf8'));
				const brief = JSON.parse(readFileSync(join(NEWS_GOOD, 'brief.json'), 'utf8'));
				sb.scenes.find((s: {id: string}) => s.id === 's05').narration = narration;
				const errors = runRules({storyboard: sb, brief, corrections: null, allowlist: allow, slug: sb.slug}).findings.filter((f) => f.severity === 'error');
				assert.deepEqual(errors.map((f) => `${f.code}: ${f.message}`), []);
			});
		}
	}
});
