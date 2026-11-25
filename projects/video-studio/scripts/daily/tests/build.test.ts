/** build: the step order, gate failures, missing tools, readiness, the approval packet and its escaping. All steps mocked. */
import {strict as assert} from 'node:assert';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, it} from 'node:test';
import {runBuild} from '../lib/build.ts';
import type {ExecRequest} from '../lib/exec.ts';
import {episodePaths} from '../lib/paths.ts';
import {runPrepare} from '../lib/prepare.ts';
import type {DailyBrief, PacketSummary} from '../lib/types.ts';
import {sha256File} from '../lib/util.ts';
import {fakeExec, goodStoryboard, type Handler, NOW, patternOf, seedRadarDay, SLUG, tempRoot, touch, writeJsonFile} from './helpers.ts';

type Opts = {tools?: Partial<Record<'news' | 'voice' | 'show' | 'thumbs' | 'kit' | 'claims', boolean>>; gateVerdict?: 'pass' | 'fail'; storyboard?: (sb: ReturnType<typeof goodStoryboard>) => void; voiceSec?: number};

/** A temp studio with a prepared brief, a storyboard, stub tool files and fake tools that write their outputs. */
const setup = (o: Opts = {}) => {
	const t = tempRoot();
	const {root} = t;
	seedRadarDay(root);
	const pr = runPrepare({root, radar: 'reuse', exec: fakeExec().exec, now: () => NOW});
	assert.equal(pr.exitCode, 0, pr.messages.join('\n'));
	const ep = episodePaths(root, SLUG);
	const brief = JSON.parse(readFileSync(ep.brief, 'utf8')) as DailyBrief;
	const detail = brief.analysisOpportunities.find((x) => x.id === 'tracker-30d')?.detail ?? 'missing';
	const sb = goodStoryboard(detail, undefined, patternOf(brief));
	o.storyboard?.(sb);
	writeJsonFile(ep.storyboard, sb);
	const tools = {news: true, voice: true, show: true, thumbs: true, kit: true, claims: false, ...o.tools};
	if (tools.news) touch(join(root, 'scripts', 'news', 'gate.ts'));
	if (tools.voice) touch(join(root, 'scripts', 'voice', 'build.py'));
	if (tools.show) touch(join(root, 'src', 'show', 'index.ts'));
	if (tools.thumbs) touch(join(root, 'scripts', 'thumbnails.ts'));
	if (tools.kit) touch(join(root, 'scripts', 'publish-kit', 'cli.ts'));
	if (tools.claims) touch(join(root, 'scripts', 'claims', 'check.ts'));
	const handlers: Record<string, Handler> = {
		'general-gate': () => ({status: 0}),
		'news-gate': () => {
			const verdict = o.gateVerdict ?? 'pass';
			writeJsonFile(ep.gateJson, {
				version: 1,
				gate: 'news-claim-gate',
				verdict,
				inputs: {storyboard: {path: 'x', sha256: sha256File(ep.storyboard)}},
				counts: {errors: verdict === 'pass' ? 0 : 1, warnings: 0, infos: 0, claims: 4, claimsOk: verdict === 'pass' ? 4 : 3},
				rules: [{rule: 'R1', title: 'facts', status: verdict === 'pass' ? 'pass' : 'fail', errors: verdict === 'pass' ? 0 : 1, warnings: 0}],
				findings: verdict === 'pass' ? [] : [{rule: 'R1', code: 'R1.number-not-in-excerpt', severity: 'error', where: {surface: 'narration', scene: 's02'}, message: 'The <b>$9M</b> figure is not in the excerpt', fix: 'Use the excerpt figure.'}],
				claims: [{scene: 's01', sentence: 0, text: 'Example Security Lab flagged outflows of about 1,400 ETH from FixtureSwap pools', sourceIds: ['examplelab'], factId: 'e4', ok: true, developing: false}],
				developing: {incidents: [], label: null, labelVia: null, spokenIn: null},
				analysis: [{id: 'a1', kind: 'comparison', basis: 'own-data', detail, sourceIds: ['defillama-30d'], presentedIn: ['s04']}],
				corrections: {applicable: [], pinnedComments: []},
			});
			return {status: verdict === 'pass' ? 0 : 1};
		},
		voice: () => writeJsonFile(ep.timeline, {version: 1, totalMs: (o.voiceSec ?? 52.3) * 1000, voice: 'im_nicola', scenes: [], mock: false}),
		render: (req: ExecRequest) => touch(req.args[4], 'fake mp4 bytes'),
		ffprobe: () => ({stdout: `${o.voiceSec ?? 52.3}\n`}),
		thumbnails: (req: ExecRequest) => {
			const out = req.args[req.args.indexOf('--out') + 1];
			for (const v of ['v0', 'v1', 'v2']) touch(join(out, 'en', `${v}.png`), `png ${v}`);
		},
		'publish-kit': (req: ExecRequest) => {
			const out = req.args[req.args.indexOf('--out') + 1];
			writeJsonFile(join(out, 'kit.json'), {checks: [{id: 'chapters', ok: false, detail: 'no chapters'}, {id: 'made-for-kids', ok: true, detail: 'ok'}]});
			touch(join(out, 'pinned-comment.txt'), 'The Zoo & Badger Show will never DM you first.');
			touch(join(out, 'youtube-description.txt'), 'Description <with> text');
			return {status: 1};
		},
	};
	const fx = fakeExec(handlers);
	return {...t, ep, brief, fx, handlers};
};

const packetOf = (root: string): PacketSummary => JSON.parse(readFileSync(episodePaths(root, SLUG).packetJson, 'utf8')) as PacketSummary;

describe('build', () => {
	it('runs every step in order and writes a READY packet', async () => {
		const s = setup({tools: {claims: true}});
		try {
			const r = await runBuild({root: s.root, dateSlug: SLUG, exec: s.fx.exec, now: () => NOW, env: {}});
			assert.equal(r.exitCode, 0, JSON.stringify(r.packet?.blockers));
			assert.deepEqual(
				s.fx.calls.map((c) => c.tool),
				['general-gate', 'news-gate', 'voice', 'render', 'ffprobe', 'poster', 'thumbnails', 'publish-kit'],
			);
			const voice = s.fx.calls.find((c) => c.tool === 'voice') as ExecRequest;
			assert.equal(voice.args[1], `content/zoora-security/${SLUG}`);
			assert.ok(voice.args.includes('--voice') && voice.args[voice.args.indexOf('--voice') + 1] === 'im_nicola', 'Zoo is always im_nicola');
			const gate = s.fx.calls.find((c) => c.tool === 'news-gate') as ExecRequest;
			assert.ok(gate.args.includes('--general-gate') && gate.args[gate.args.indexOf('--general-gate') + 1] === 'off', 'the general gate runs once, as its own step');
			const general = s.fx.calls.find((c) => c.tool === 'general-gate') as ExecRequest;
			// the episode folder and the report folder are under --root (absolute), never this checkout
			assert.equal(general.args[1], join(s.root, 'content', 'zoora-security', SLUG));
			assert.equal(general.args[general.args.indexOf('--out-dir') + 1], join(s.root, 'out', 'claims'));
			assert.ok(general.args.includes('--no-names'), 'no private names list here: --no-names, explicitly');
			assert.equal(general.env?.NEWS_GATE_PARENT, '1');
			assert.match(packetOf(s.root).warnings.join(' '), /--no-names/, 'the packet says the names list was not checked');
			const render = s.fx.calls.find((c) => c.tool === 'render') as ExecRequest;
			assert.deepEqual(render.args.slice(0, 4), ['remotion', 'render', 'src/show/index.ts', 'ShowShort']);
			const props = JSON.parse(readFileSync(s.ep.renderProps, 'utf8'));
			assert.deepEqual(props, {channel: 'zoora-security', slug: SLUG, lang: 'en', shortId: 'short1', channelName: null});
			const p = packetOf(s.root);
			assert.equal(p.readyToApprove, true);
			assert.equal(p.versions.render.durationSec, 52.3);
			assert.equal(p.versions.thumbnails.length, 3);
			for (const f of ['approval.html', 'approval.md', 'packet.json', 'short.mp4', 'thumbs/v0.png']) assert.ok(existsSync(join(s.ep.approvalDir, f)), f);
			const kitStep = p.steps.find((x) => x.id === 'publish-kit');
			assert.equal(kitStep?.status, 'passed', 'chapters is not applicable to a Short');
			const episode = JSON.parse(readFileSync(s.ep.episodeJson, 'utf8'));
			assert.equal(episode.madeForKids.value, false);
			assert.equal(episode.paidPromotion.value, false);
			assert.equal(episode.shortCuts[0].from, 's01');
			assert.equal(episode.shortCuts[0].to, 's07');
			assert.ok(!s.fx.calls.some((c) => /youtube|upload/i.test([c.cmd, ...c.args].join(' '))), 'build never uploads');
		} finally {
			s.cleanup();
		}
	});

	it('stops before the voice when a gate fails, and still writes the packet with the fixes', async () => {
		const s = setup({gateVerdict: 'fail'});
		try {
			const r = await runBuild({root: s.root, dateSlug: SLUG, exec: s.fx.exec, now: () => NOW, env: {}});
			assert.equal(r.exitCode, 1);
			assert.ok(!s.fx.calls.some((c) => c.tool === 'voice' || c.tool === 'render'), 'nothing unverified is voiced or rendered');
			const p = packetOf(s.root);
			assert.equal(p.readyToApprove, false);
			assert.ok(p.blockers.some((b) => b.startsWith('News gate')));
			const html = readFileSync(s.ep.approvalHtml, 'utf8');
			assert.match(html, /NOT READY/);
			assert.match(html, /The &lt;b&gt;\$9M&lt;\/b&gt; figure/);
			assert.ok(!existsSync(s.ep.render));
		} finally {
			s.cleanup();
		}
	});

	it('reports missing tools instead of faking them', async () => {
		const s = setup({tools: {show: false, thumbs: false, kit: false, claims: false}});
		try {
			const r = await runBuild({root: s.root, dateSlug: SLUG, exec: s.fx.exec, now: () => NOW, env: {}});
			assert.equal(r.exitCode, 1);
			const p = packetOf(s.root);
			const st = Object.fromEntries(p.steps.map((x) => [x.id, x.status]));
			assert.deepEqual(st, {'general-gate': 'missing', 'news-gate': 'passed', voice: 'passed', render: 'missing', thumbnails: 'missing', 'publish-kit': 'missing'});
			assert.ok(p.blockers.some((b) => /ShowShort/.test(b)));
			assert.ok(!p.blockers.some((b) => /General claim gate/.test(b)), 'a missing general gate is a warning, not a blocker');
			assert.match(readFileSync(s.ep.approvalHtml, 'utf8'), /No preview/);
		} finally {
			s.cleanup();
		}
	});

	it('blocks leftover TODOs, an unlabelled developing story and a Short over 3 minutes', async () => {
		const s = setup({
			voiceSec: 200,
			storyboard: (sb) => {
				sb.scenes[5].narration = 'TODO the fix';
			},
		});
		try {
			const brief = JSON.parse(readFileSync(s.ep.brief, 'utf8'));
			brief.status = 'developing';
			writeJsonFile(s.ep.brief, brief);
			const r = await runBuild({root: s.root, dateSlug: SLUG, exec: s.fx.exec, now: () => NOW, env: {}});
			assert.equal(r.exitCode, 1);
			const p = packetOf(s.root);
			assert.ok(p.blockers.some((b) => /TODO/.test(b)));
			assert.ok(p.blockers.some((b) => /title must say "developing"/.test(b)));
			assert.ok(!s.fx.calls.some((c) => c.tool === 'voice'), 'pre-check blockers stop the voice too');
		} finally {
			s.cleanup();
		}
	});

	it('--only gates reuses a render made from the same storyboard, and drops a stale one', async () => {
		const s = setup();
		try {
			assert.equal((await runBuild({root: s.root, dateSlug: SLUG, exec: s.fx.exec, now: () => NOW, env: {}})).exitCode, 0);
			const again = await runBuild({root: s.root, dateSlug: SLUG, exec: s.fx.exec, now: () => NOW, env: {}, onlyGates: true});
			assert.equal(again.exitCode, 0);
			assert.equal(packetOf(s.root).steps.find((x) => x.id === 'render')?.note, 'Reused: rendered from this exact storyboard.');
			const sb = JSON.parse(readFileSync(s.ep.storyboard, 'utf8'));
			sb.title = 'DefiLlama lists FixtureSwap among November hacks, again';
			writeFileSync(s.ep.storyboard, JSON.stringify(sb));
			const stale = await runBuild({root: s.root, dateSlug: SLUG, exec: s.fx.exec, now: () => NOW, env: {}, onlyGates: true});
			assert.equal(stale.exitCode, 1);
			assert.ok(packetOf(s.root).blockers.some((b) => /no render matches this storyboard/.test(b)));
		} finally {
			s.cleanup();
		}
	});

	it('refuses to start without a storyboard, and while another build holds the lock', async () => {
		const s = setup();
		try {
			writeJsonFile(s.ep.lock, {pid: process.ppid, startedAt: NOW.toISOString()});
			const locked = await runBuild({root: s.root, dateSlug: SLUG, exec: s.fx.exec, now: () => NOW, env: {}});
			assert.equal(locked.exitCode, 1);
			assert.match(locked.error ?? '', /Another daily run/);
			const none = await runBuild({root: s.root, dateSlug: '2026-11-24-nothing', exec: s.fx.exec, now: () => NOW, env: {}});
			assert.match(none.error ?? '', /No storyboard yet/);
		} finally {
			s.cleanup();
		}
	});
});

describe('approval packet (escaping and layout)', () => {
	it('escapes hostile feed text and runs no scripts', async () => {
		const s = setup();
		try {
			const brief = JSON.parse(readFileSync(s.ep.brief, 'utf8')) as DailyBrief;
			const lab = brief.sources.find((x) => x.id === 'examplelab');
			if (lab) {
				lab.excerpt = 'Example Security Lab flagged outflows of about 1,400 ETH from FixtureSwap pools. <script>alert(1)</script><img src=x onerror=alert(2)>';
				lab.url = 'javascript:alert(3)';
				lab.publisher = 'Lab "><svg onload=alert(4)>';
			}
			const e4 = brief.facts.find((f) => f.id === 'e4');
			if (e4 && lab?.excerpt) e4.excerpts = [{sourceId: 'examplelab', text: lab.excerpt}];
			writeJsonFile(s.ep.brief, brief);
			await runBuild({root: s.root, dateSlug: SLUG, exec: s.fx.exec, now: () => NOW, env: {}});
			const html = readFileSync(s.ep.approvalHtml, 'utf8');
			assert.ok(!/<script/i.test(html), 'no script element at all');
			assert.ok(!html.includes('<img src=x'), 'feed HTML is escaped');
			assert.ok(!html.includes('href="javascript:'), 'only http(s) links');
			assert.ok(!html.includes('<svg onload'), 'attribute breakouts are escaped');
			assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
			assert.match(html, /script-src 'none'/);
			assert.match(html, /<meta name="viewport" content="width=device-width,initial-scale=1">/);
			assert.match(html, /<video controls playsinline preload="metadata" src="short\.mp4"><\/video>/);
			assert.match(html, /Reply <code>APPROVE 2026-11-24-fixtureswap<\/code> \(or your edits\) in the Claude app\./);
			assert.match(html, /Made for kids:<\/b> No, not made for kids/);
			assert.match(html, /Paid promotion:<\/b> No: this video has no offers/);
			assert.match(html, /Pinned comment \(copy exactly\)/);
			const md = readFileSync(s.ep.approvalMd, 'utf8');
			assert.ok(!md.includes('<script>'), 'Markdown escapes HTML too');
		} finally {
			s.cleanup();
		}
	});
});

describe('build: the publish kit', () => {
	it("never reads an earlier build's kit.json as this build's (a CLI that exits 0 having written nothing)", async () => {
		const s = setup();
		try {
			await runBuild({root: s.root, dateSlug: SLUG, exec: s.fx.exec, now: () => NOW, env: {}});
			assert.equal(packetOf(s.root).steps.find((x) => x.id === 'publish-kit')?.status, 'passed');
			assert.ok(existsSync(join(s.ep.publishOut, 'kit.json')));
			// the second build's publish kit exits 0 and writes nothing: the old kit.json must not pass for it
			const again = fakeExec({...s.handlers, 'publish-kit': () => ({status: 0})});
			await runBuild({root: s.root, dateSlug: SLUG, exec: again.exec, now: () => NOW, env: {}});
			assert.notEqual(packetOf(s.root).steps.find((x) => x.id === 'publish-kit')?.status, 'passed');
			assert.equal(existsSync(join(s.ep.publishOut, 'kit.json')), false);
		} finally {
			s.cleanup();
		}
	});
});
