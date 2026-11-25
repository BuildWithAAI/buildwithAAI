/**
 * The AI-lane review, round 2 (2026-11-25): a crypto pick keeps its name allowlisted even when the radar read the name
 * from a headline's shape (only AI and both-lane names lose that), so its own news gate passes; the approval packet
 * lists every quote at the top for the owner's own check (an AI story's quote is an organisation's statement, never a
 * payload).
 */
import {strict as assert} from 'node:assert';
import {existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {describe, it} from 'node:test';
import {runRules} from '../../news/lib/rules.ts';
import {loadChannel} from '../lib/channel.ts';
import {renderHtml} from '../lib/html.ts';
import {readStoryboard} from '../lib/kit-adapter.ts';
import {renderMd} from '../lib/md.ts';
import {loadSplitter} from '../lib/narration.ts';
import {buildModel} from '../lib/packet.ts';
import {episodePaths} from '../lib/paths.ts';
import {realExec} from '../lib/exec.ts';
import {runPostApproval, type PostInput} from '../lib/postapproval.ts';
import {runPrepare} from '../lib/prepare.ts';
import {subjectKnown} from '../lib/radar.ts';
import type {DailyBrief} from '../lib/types.ts';
import {AI_STORY} from '../lib/writer.ts';
import {DATE, fakeExec, fixtureBridge, fixtureLend, fixturePhish, fixtureSwap, goodStoryboard, incident, NOW, seedRadarDay, SLUG, STUDIO, tempRoot, touch} from './helpers.ts';

const NEWS_GOOD = join(STUDIO, 'scripts', 'news', 'fixtures', 'zoora-security', 'good-fixtureswap-drain');

describe('a crypto name read from a headline shape stays allowlisted (daily-crypto-namknown-false)', () => {
	const moldy = () => incident({id: '2026-11-24-moldy-roost', protocol: 'Moldy Roost', lane: 'crypto', subjectKnown: false, score: {total: 20}});
	const intel = () => incident({id: '2026-11-24-intelbroker', protocol: 'IntelBroker', lane: 'ai', type: 'ai-data-exposure', subjectKnown: false, score: {total: 19}});
	const both = () => incident({id: '2026-11-24-kiro', protocol: 'Kiro', lane: 'both', type: 'ai-phishing', subjectKnown: false, score: {total: 18}});

	it('subjectKnown: crypto always, AI and both lanes only when the radar knows the name', () => {
		assert.equal(subjectKnown(moldy()), true, 'a crypto name the radar read from a headline shape');
		assert.equal(subjectKnown({...moldy(), lane: undefined}), true, 'no lane is crypto');
		assert.equal(subjectKnown(intel()), false);
		assert.equal(subjectKnown(both()), false);
		assert.equal(subjectKnown({...intel(), subjectKnown: undefined}), false, 'an older file: AI names are unknown');
		assert.equal(subjectKnown({...intel(), subjectKnown: true}), true);
	});

	it('prepare: the crypto pick gets no nameKnown:false, crypto alternates stay entities, AI ones do not', () => {
		const {root, cleanup} = tempRoot();
		try {
			seedRadarDay(root, [{...fixtureSwap(), subjectKnown: false}, fixtureBridge(), fixtureLend(), fixturePhish(), moldy(), intel(), both()]);
			const r = runPrepare({root, radar: 'reuse', exec: fakeExec().exec, now: () => NOW});
			assert.equal(r.exitCode, 0, r.messages.join('\n'));
			const brief = JSON.parse(readFileSync(episodePaths(root, SLUG).brief, 'utf8')) as DailyBrief;
			const primary = brief.incidents.find((i) => i.role === 'primary');
			assert.equal(primary?.name, 'FixtureSwap');
			assert.equal(primary?.nameKnown, undefined, JSON.stringify(primary));
			const entities = brief.entities.map((e) => e.name);
			assert.ok(entities.includes('Moldy Roost'), entities.join(', '));
			assert.ok(!entities.includes('IntelBroker') && !entities.includes('Kiro'), entities.join(', '));

			// the daily's own incident record drives the news gate: the pick's name must pass R4 there. The good fixture's
			// post-mortem publisher is renamed, so the name is known only through the incident (as for a news-only pick).
			const sb = JSON.parse(readFileSync(join(NEWS_GOOD, 'storyboard.json'), 'utf8'));
			const gateBrief = JSON.parse(readFileSync(join(NEWS_GOOD, 'brief.json'), 'utf8'));
			for (const s of gateBrief.sources) if (s.publisher === 'FixtureSwap') s.publisher = 'Example Post';
			gateBrief.incidents[0] = {...gateBrief.incidents[0], ...(primary?.nameKnown === undefined ? {} : {nameKnown: primary.nameKnown})};
			const allow = JSON.parse(readFileSync(join(STUDIO, 'scripts', 'news', 'allowlist.json'), 'utf8'));
			const errors = runRules({storyboard: sb, brief: gateBrief, corrections: null, allowlist: allow, slug: sb.slug}).findings.filter((f) => f.severity === 'error');
			assert.deepEqual(errors.map((f) => `${f.code}: ${f.message}`), []);
		} finally {
			cleanup();
		}
	});

	it('prepare: an AI pick read from a headline shape still gets nameKnown:false', () => {
		const {root, cleanup} = tempRoot();
		try {
			const ai = {...fixtureSwap(), lane: 'ai' as const, type: 'ai-data-exposure', subjectKnown: false};
			seedRadarDay(root, [ai, fixtureBridge(), fixtureLend(), fixturePhish()]);
			const r = runPrepare({root, radar: 'reuse', exec: fakeExec().exec, now: () => NOW, pick: ai.id});
			const brief = r.brief;
			assert.ok(brief, r.messages.join('\n'));
			assert.equal(brief?.incidents.find((i) => i.role === 'primary')?.nameKnown, false);
		} finally {
			cleanup();
		}
	});
});

describe('the approval packet lists every quote at the top (ai-howto-not-enforced)', () => {
	const model = async (lane: 'ai' | 'crypto') => {
		const {split} = await loadSplitter();
		const raw = goodStoryboard('x') as {scenes: Array<{id: string; narration: string; onScreen?: Record<string, unknown>}>};
		const s05 = raw.scenes.find((sc) => sc.id === 's05') ?? raw.scenes[raw.scenes.length - 1]!;
		s05.narration = `${s05.narration} Example Security Lab said "the flaw let any <b>web page</b> steer the agent".`;
		const s02 = raw.scenes[1]!;
		s02.onScreen = {...(s02.onScreen ?? {}), quote: 'we shipped a fix the same day'};
		const {sb} = readStoryboard(raw);
		assert.ok(sb);
		const ch = loadChannel(join(STUDIO, 'content', 'zoora-security', 'channel.json'));
		const brief = {incident: {id: 'i', protocol: 'ExampleAgent', type: lane === 'ai' ? 'prompt-injection' : 'key-compromise', status: 'confirmed', dateUtc: DATE, lane}, sources: [], facts: [], evergreen: null, format: 'daily-short'} as unknown as DailyBrief;
		const post: PostInput = {slug: SLUG, date: DATE, title: sb!.title, shortTitle: sb!.title, developing: false, summary: 'S.', whatWeKnow: [], analysis: [], oneFix: null, sources: [], corrections: [], youtubeId: null, alsoOnRadar: [], showName: ch.showName, displayName: ch.displayName};
		return buildModel({slug: SLUG, date: DATE, builtAt: NOW.toISOString(), builtAtLocal: 'x', sb: sb!, brief, gate: null, steps: [], channel: ch, split, splitter: 'x', preChecks: {blockers: [], warnings: []}, developing: false, preview: {rel: null, bytes: null, durationSec: null, sha256: null, note: 'n'}, thumbnails: [], kit: null, post, versions: {storyboard: {path: 'x', sha256: null}, brief: {path: 'x', sha256: null}, render: {path: 'x', sha256: null, bytes: null, durationSec: null}, thumbnails: [], newsGate: {path: 'x', sha256: null, verdict: 'fail'}, publishKit: {path: 'x', sha256: null}}});
	};

	it('an AI story: every quote, with where it is, before anything else is read', async () => {
		const m = await model('ai');
		assert.equal(m.aiStory, true);
		const texts = m.quotes.map((q) => `${q.where}: ${q.text}`);
		assert.ok(texts.some((t) => /^s0\d narration: the flaw let any <b>web page<\/b> steer the agent$/.test(t)), texts.join('\n'));
		assert.ok(texts.includes(`${'s02'} onScreen.quote: we shipped a fix the same day`) || texts.some((t) => t.endsWith('onScreen.quote: we shipped a fix the same day')), texts.join('\n'));
		const html = renderHtml(m);
		assert.ok(html.indexOf('Quotes to check') > 0 && html.indexOf('Quotes to check') < html.indexOf('At a glance'), 'the list comes first');
		assert.match(html, /AI story: each quote must be an organisation&#39;s own statement|AI story: each quote must be an organisation's own statement/);
		assert.ok(!html.includes('<b>web page</b>'), 'quotes are escaped');
		const md = renderMd(m);
		assert.match(md, /## Quotes to check: \d+/);
		assert.ok(md.indexOf('## Quotes to check') < md.indexOf('## At a glance'));
	});

	it('a crypto story lists them too, with the plain rule', async () => {
		const m = await model('crypto');
		assert.equal(m.aiStory, false);
		assert.ok(m.quotes.length >= 2);
		assert.match(renderMd(m), /Each quote must be word for word from the source it is attributed to/);
	});
});

describe('the AI how-to rules never block a defensive One Fix (ai-howto-not-enforced)', () => {
	const allow = JSON.parse(readFileSync(join(STUDIO, 'scripts', 'news', 'allowlist.json'), 'utf8'));
	const fixes = [...Object.values(AI_STORY).map((s) => s.fix), 'Never let Copilot run commands from files you did not write.'];
	// a quoted setting label is not an AI how-to (R5); R1 asks every quote for a source, as before
	const labelled = 'Turn on "ask before running commands" in your coding agent\'s settings.';
	it(labelled, () => {
		const sb = JSON.parse(readFileSync(join(NEWS_GOOD, 'storyboard.json'), 'utf8'));
		const brief = JSON.parse(readFileSync(join(NEWS_GOOD, 'brief.json'), 'utf8'));
		brief.incident = {id: 'inc-fixtureswap', lane: 'ai', type: 'prompt-injection'};
		sb.scenes.find((s: {id: string}) => s.id === 's05').narration = `Zoo's one fix: ${labelled}`;
		const r5 = runRules({storyboard: sb, brief, corrections: null, allowlist: allow, slug: sb.slug}).findings.filter((f) => f.severity === 'error' && f.rule === 'R5');
		assert.deepEqual(r5.map((f) => f.code), []);
	});
	for (const fix of fixes) {
		it(fix.slice(0, 60), () => {
			const sb = JSON.parse(readFileSync(join(NEWS_GOOD, 'storyboard.json'), 'utf8'));
			const brief = JSON.parse(readFileSync(join(NEWS_GOOD, 'brief.json'), 'utf8'));
			// an AI story, as the daily's brief.json marks it
			brief.incident = {id: 'inc-fixtureswap', lane: 'ai', type: 'prompt-injection'};
			brief.mustNotSay = [{rule: 'ai-how-to', text: 'AI story: ...'}];
			sb.scenes.find((s: {id: string}) => s.id === 's05').narration = `Zoo's one fix: ${fix}`;
			const errors = runRules({storyboard: sb, brief, corrections: null, allowlist: allow, slug: sb.slug}).findings.filter((f) => f.severity === 'error');
			assert.deepEqual(errors.map((f) => `${f.code}: ${f.message}`), []);
		});
	}
});

describe('the hub CLIs the daily launches run by their real path (silent-noop-written)', () => {
	const HUB = resolve(STUDIO, '..', 'creator-hub');
	it("the owner's override command launches its script by the real path", () => {
		const {root, cleanup} = tempRoot();
		try {
			touch(join(root, 'real-hub', 'tools', 'announcer', 'cli.ts'));
			symlinkSync(join(root, 'real-hub'), join(root, 'hub'));
			const fx = fakeExec({announcer: () => ({stdout: '  wrote x'})});
			const cmd = JSON.stringify([process.execPath, join(root, 'hub', 'tools', 'announcer', 'cli.ts'), '--input', '{input}', '--out', '{out}', '{dryRun}']);
			runPostApproval({tool: 'announcer', outDir: join(root, 'out'), hubRoot: join(root, 'hub'), root, files: {}, input: {}, credentialEnv: [], videoKnown: false, exec: fx.exec, env: {DAILY_ANNOUNCER_CMD: cmd}});
			assert.equal(fx.calls[0]!.args[0], realpathSync(join(root, 'real-hub', 'tools', 'announcer', 'cli.ts')));
			assert.ok(fx.calls[0]!.args.includes('--dry-run'));
		} finally {
			cleanup();
		}
	});
	it('the real announcer runs through a symlinked hub path (it used to exit 0 having done nothing)', () => {
		const tmp = mkdtempSync(join(tmpdir(), 'daily-ann-link-'));
		try {
			const link = join(tmp, 'hub');
			symlinkSync(HUB, link);
			const input = JSON.parse(readFileSync(join(HUB, 'tools', 'threat-brief', 'fixtures', 'daily-input.json'), 'utf8'));
			const cmd = JSON.stringify([process.execPath, join(link, 'tools', 'announcer', 'cli.ts'), '--input', '{input}', '--out', '{out}', '{dryRun}']);
			const r = runPostApproval({tool: 'announcer', outDir: join(tmp, 'out'), hubRoot: link, root: STUDIO, files: {'announce.md': 'local draft'}, input, credentialEnv: {telegram: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID']}, videoKnown: false, exec: realExec, env: {PATH: process.env.PATH ?? '', DAILY_ANNOUNCER_CMD: cmd}});
			assert.equal(r.command?.[1], realpathSync(join(link, 'tools', 'announcer', 'cli.ts')), 'the override ran by the real path');
			assert.equal(r.mode, 'hub-dry-run', r.note);
			assert.equal(r.status, 'written');
			assert.ok(existsSync(join(tmp, 'out', 'announcer', 'announce-plan.json')), 'the announcer wrote its plan');
		} finally {
			rmSync(tmp, {recursive: true, force: true});
		}
	});
});
