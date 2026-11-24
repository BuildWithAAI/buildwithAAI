/** approve: the reply check, stale files, the approval record, post-approval drafts, and that nothing is uploaded. */
import {strict as assert} from 'node:assert';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, it} from 'node:test';
import {replyMatches, runApprove, versionHash} from '../lib/approve.ts';
import {runBuild} from '../lib/build.ts';
import {main} from '../lib/cli.ts';
import {episodePaths} from '../lib/paths.ts';
import {buildAnnouncements, buildThreatBrief, PLACEHOLDER_LINK, xLength, type PostInput} from '../lib/postapproval.ts';
import {runPrepare} from '../lib/prepare.ts';
import type {ApprovalRecord, DailyBrief, PacketSummary} from '../lib/types.ts';
import {sha256File} from '../lib/util.ts';
import {fakeExec, goodStoryboard, NOW, seedRadarDay, SLUG, tempRoot, touch, writeJsonFile} from './helpers.ts';

/** A built, READY packet in a temp studio (every tool faked). */
const ready = async () => {
	const t = tempRoot();
	const {root} = t;
	seedRadarDay(root);
	runPrepare({root, radar: 'reuse', exec: fakeExec().exec, now: () => NOW});
	const ep = episodePaths(root, SLUG);
	const brief = JSON.parse(readFileSync(ep.brief, 'utf8')) as DailyBrief;
	const detail = brief.analysisOpportunities.find((x) => x.id === 'tracker-30d')?.detail ?? '';
	writeJsonFile(ep.storyboard, goodStoryboard(detail));
	for (const f of ['scripts/news/gate.ts', 'scripts/voice/build.py', 'src/show/index.ts']) touch(join(root, f));
	const fx = fakeExec({
		'news-gate': () => {
			writeJsonFile(ep.gateJson, {version: 1, gate: 'news-claim-gate', verdict: 'pass', inputs: {storyboard: {path: 'x', sha256: sha256File(ep.storyboard)}}, counts: {errors: 0, warnings: 0, claims: 4, claimsOk: 4}, rules: [], findings: [], claims: [], developing: {incidents: [], label: null, labelVia: null, spokenIn: null}, analysis: [{id: 'a1', kind: 'comparison', basis: 'own-data', detail, sourceIds: ['defillama-30d'], presentedIn: ['s04']}], corrections: {applicable: [], pinnedComments: []}});
		},
		voice: () => writeJsonFile(ep.timeline, {version: 1, totalMs: 52000, voice: 'im_nicola', scenes: []}),
		render: (req) => touch(req.args[4], 'fake mp4'),
		ffprobe: () => ({stdout: '52.0'}),
	});
	const b = await runBuild({root, dateSlug: SLUG, exec: fx.exec, now: () => NOW, env: {}});
	assert.equal(b.exitCode, 0, JSON.stringify(b.packet?.blockers ?? b.error));
	return {...t, ep};
};

const APPROVE = `APPROVE ${SLUG}`;

describe('approve', () => {
	it('accepts only the exact reply for this date-slug', () => {
		assert.ok(replyMatches(APPROVE, SLUG));
		assert.ok(replyMatches(`  approve ${SLUG}.  `, SLUG));
		assert.ok(!replyMatches('APPROVE', SLUG));
		assert.ok(!replyMatches(`APPROVE ${SLUG} but change the title`, SLUG));
		assert.ok(!replyMatches('APPROVE 2026-11-24-other', SLUG));
		assert.ok(!replyMatches(`I APPROVE ${SLUG}`, SLUG));
	});

	it('records who, when and the version hash, writes drafts, and never uploads', async () => {
		const s = await ready();
		try {
			const fx = fakeExec();
			const r = await runApprove({root: s.root, dateSlug: SLUG, reply: APPROVE, by: 'owner', exec: fx.exec, now: () => new Date('2026-11-24T12:05:00Z'), env: {}});
			assert.equal(r.exitCode, 0, r.reasons.join('\n'));
			assert.equal(fx.calls.length, 0, 'no hub tools exist here, so nothing runs at all (and nothing ever uploads)');
			const rec = JSON.parse(readFileSync(s.ep.approvalJson, 'utf8')) as ApprovalRecord;
			assert.equal(rec.kind, 'daily-content-approval');
			assert.equal(rec.approvedBy, 'owner');
			assert.equal(rec.approvedAt, '2026-11-24T12:05:00.000Z');
			assert.equal(rec.approvedAtLocal, '2026-11-24 06:05 CST');
			assert.equal(rec.reply, APPROVE);
			assert.equal(rec.versionHash, versionHash(sha256File(s.ep.storyboard) as string, sha256File(s.ep.render) as string));
			assert.equal(rec.upload.automated, false);
			assert.equal(rec.upload.youtubeVideoId, null);
			assert.deepEqual(rec.postApproval.map((p) => [p.id, p.mode, p.status]), [['announcer', 'local-draft', 'written'], ['threat-brief', 'local-draft', 'written']]);
			const dir = s.ep.postApproval;
			for (const f of ['announcer/x.txt', 'announcer/telegram.txt', 'announcer/youtube-community.txt', 'threat-brief/threat-brief.html', 'threat-brief/threat-brief.md', 'threat-brief/threat-brief.txt']) assert.ok(existsSync(join(dir, f)), f);
			const x = readFileSync(join(dir, 'announcer/x.txt'), 'utf8');
			assert.ok(x.includes(PLACEHOLDER_LINK), 'no link until the manual upload');
			const html = readFileSync(join(dir, 'threat-brief/threat-brief.html'), 'utf8');
			assert.ok(!/<script|<img|<link /i.test(html), 'email-safe: no scripts, images or external styles');
		} finally {
			s.cleanup();
		}
	});

	it('refuses a wrong reply, a packet that is not ready, and files that changed after the packet', async () => {
		const s = await ready();
		try {
			const ex = fakeExec().exec;
			const wrong = await runApprove({root: s.root, dateSlug: SLUG, reply: 'looks good', by: 'owner', exec: ex, now: () => NOW, env: {}});
			assert.equal(wrong.exitCode, 1);
			assert.match(wrong.reasons[0], /must be exactly "APPROVE 2026-11-24-fixtureswap"/);
			const sb = JSON.parse(readFileSync(s.ep.storyboard, 'utf8'));
			sb.title = 'A different title';
			writeFileSync(s.ep.storyboard, JSON.stringify(sb));
			const stale = await runApprove({root: s.root, dateSlug: SLUG, reply: APPROVE, by: 'owner', exec: ex, now: () => NOW, env: {}});
			assert.equal(stale.exitCode, 1);
			assert.ok(stale.reasons.some((x) => /storyboard changed after the packet was built/.test(x)));
			const p = JSON.parse(readFileSync(s.ep.packetJson, 'utf8')) as PacketSummary;
			writeJsonFile(s.ep.packetJson, {...p, readyToApprove: false, blockers: ['Render (ShowShort): missing']});
			const notReady = await runApprove({root: s.root, dateSlug: SLUG, reply: APPROVE, by: 'owner', exec: ex, now: () => NOW, env: {}});
			assert.match(notReady.reasons[0], /NOT READY/);
			assert.ok(!existsSync(s.ep.approvalJson));
		} finally {
			s.cleanup();
		}
	});

	it('records the manual upload id later and puts the link in the drafts', async () => {
		const s = await ready();
		try {
			const ex = fakeExec().exec;
			const early = await runApprove({root: s.root, dateSlug: SLUG, by: 'owner', youtubeId: 'abcDEF12345', exec: ex, now: () => NOW, env: {}});
			assert.equal(early.exitCode, 1, 'an id needs an approval first');
			assert.equal((await runApprove({root: s.root, dateSlug: SLUG, reply: APPROVE, by: 'owner', exec: ex, now: () => NOW, env: {}})).exitCode, 0);
			const r = await runApprove({root: s.root, dateSlug: SLUG, by: 'owner', youtubeId: 'abcDEF12345', exec: ex, now: () => NOW, env: {}});
			assert.equal(r.exitCode, 0);
			const rec = JSON.parse(readFileSync(s.ep.approvalJson, 'utf8')) as ApprovalRecord;
			assert.equal(rec.upload.youtubeVideoId, 'abcDEF12345');
			assert.ok(rec.history.some((h) => /youtube id recorded/.test(h.event)));
			assert.match(readFileSync(join(s.ep.postApproval, 'announcer/x.txt'), 'utf8'), /https:\/\/youtu\.be\/abcDEF12345/);
		} finally {
			s.cleanup();
		}
	});

	it('calls the hub tools when they exist: dry-run without credentials, live with credentials and a video id', async () => {
		const s = await ready();
		try {
			const hub = episodePaths(s.root, SLUG).hubRoot;
			touch(join(hub, 'tools', 'announcer', 'cli.ts'));
			touch(join(hub, 'tools', 'threat-brief', 'cli.ts'));
			const dry = fakeExec();
			await runApprove({root: s.root, dateSlug: SLUG, reply: APPROVE, by: 'owner', exec: dry.exec, now: () => NOW, env: {}});
			assert.deepEqual(dry.calls.map((c) => c.tool), ['announcer', 'threat-brief']);
			assert.ok(dry.calls.every((c) => c.args.includes('--dry-run')));
			const live = fakeExec();
			await runApprove({root: s.root, dateSlug: SLUG, by: 'owner', youtubeId: 'abcDEF12345', exec: live.exec, now: () => NOW, env: {ANNOUNCER_X_TOKEN: 't', ANNOUNCER_TELEGRAM_TOKEN: 't', KIT_API_KEY: 'k'}});
			assert.ok(live.calls.every((c) => !c.args.includes('--dry-run')));
			const rec = JSON.parse(readFileSync(s.ep.approvalJson, 'utf8')) as ApprovalRecord;
			assert.deepEqual(rec.postApproval.map((p) => p.mode), ['hub-live', 'hub-live']);
		} finally {
			s.cleanup();
		}
	});
});

const post = (over: Partial<PostInput> = {}): PostInput => ({
	slug: SLUG,
	date: '2026-11-24',
	title: 'DefiLlama lists FixtureSwap among November hacks',
	shortTitle: 'DefiLlama lists FixtureSwap among November hacks',
	developing: false,
	summary: 'Example Security Lab flagged outflows of about 1,400 ETH from FixtureSwap pools. DefiLlama lists the loss at $4,200,000.',
	whatWeKnow: [{text: 'DefiLlama lists the loss at $4,200,000.', sources: [{publisher: 'DefiLlama', url: 'https://api.llama.fi/hacks#x'}]}],
	analysis: ['DefiLlama lists 7 incidents in the 30 days from Oct 26 to Nov 24.'],
	oneFix: 'Put upgrade keys in a multisig with a time delay.',
	sources: [{publisher: 'DefiLlama', title: 'DefiLlama hacks <b>', url: 'javascript:alert(1)'}],
	corrections: [],
	youtubeId: null,
	alsoOnRadar: [{name: 'Other <i>Proto</i>', status: 'developing', coverage: [{publisher: 'Example Wire', url: 'https://news.example.com/x'}]}],
	showName: 'The Zoo & Badger Show',
	displayName: 'The Zoo & Badger Show',
	...over,
});

describe('announcer and Threat Brief drafts', () => {
	it('keeps the X post under 280 weighted characters and labels developing stories', () => {
		const a = buildAnnouncements(post({developing: true, youtubeId: 'abcDEF12345', summary: `${'Long sentence. '.repeat(40)}`}));
		assert.ok(xLength(a.x) <= 280, String(xLength(a.x)));
		assert.match(a.x, /^DEVELOPING: /);
		assert.match(a.telegram, /developing story/);
	});
	it('escapes everything in the email and links only http(s)', () => {
		const tb = buildThreatBrief(post());
		assert.ok(tb.subject.length <= 100);
		assert.match(tb.subject, /^Threat Brief, Nov 24: /);
		assert.ok(!tb.html.includes('<b>') && !tb.html.includes('<i>Proto'));
		assert.ok(!tb.html.includes('javascript:'));
		assert.match(tb.html, /Also on the radar/);
		assert.match(tb.text, /\[video link: added after the manual upload\]/);
		assert.match(tb.md, /^---\nsubject: /);
	});
});

describe('cli', () => {
	const run = async (argv: string[]) => {
		const out: string[] = [];
		const err: string[] = [];
		const orig = process.stderr.write.bind(process.stderr);
		process.stderr.write = ((s: string) => (err.push(String(s)), true)) as typeof process.stderr.write;
		try {
			const code = await main(argv, {out: (s) => out.push(s), exec: fakeExec().exec, now: () => NOW});
			return {code, out: out.join('\n'), err: err.join('')};
		} finally {
			process.stderr.write = orig;
		}
	};
	it('prints help and rejects bad input with exit 2', async () => {
		assert.equal((await run(['--help'])).code, 0);
		assert.equal((await run([])).code, 2);
		assert.equal((await run(['bogus'])).code, 2);
		assert.equal((await run(['build'])).code, 2);
		assert.equal((await run(['build', 'not-a-date-slug'])).code, 2);
		assert.equal((await run(['prepare', '--date', '2026-02-30'])).code, 2);
		assert.equal((await run(['prepare', '--radar', 'sometimes'])).code, 2);
		assert.equal((await run(['approve', SLUG])).code, 2, 'approve needs --reply or --youtube-id');
		assert.equal((await run(['approve', SLUG, '--reply', APPROVE, '--by', 'Jane Doe'])).code, 2, 'no personal names in the public repo');
		assert.equal((await run(['approve', SLUG, '--youtube-id', 'short'])).code, 2);
		assert.equal((await run(['build', SLUG, '--skip', 'everything'])).code, 2);
	});
	it('runs prepare and status against a root', async () => {
		const t = tempRoot();
		try {
			seedRadarDay(t.root);
			const p = await run(['prepare', '--date', '2026-11-24', '--radar', 'reuse', '--root', t.root, '--json']);
			assert.equal(p.code, 0);
			assert.equal(JSON.parse(p.out).dateSlug, SLUG);
			const st = await run(['status', SLUG, '--root', t.root]);
			assert.match(st.out, /No storyboard yet/);
		} finally {
			t.cleanup();
		}
	});
});
