/** CLI end to end: policy gate, auth, pull (mocked Google + the fixture video-studio tree), status, report, refresh, forget, revoke. */
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {after, before, describe, it} from 'node:test';
import {durationCheck, formatCheck, main, sameLanguage, type CliDeps} from './cli.ts';
import {approveInBrowser, createMockGoogle, type MockGoogle} from './mock-google.ts';
import {synthCurve} from './synth.ts';
import type {JoinSnapshot, PullRecord} from './types.ts';

const VS = fileURLToPath(new URL('./fixtures/video-studio/', import.meta.url));
const NOW = new Date('2026-11-24T12:00:00Z');

type Run = {code: number; out: string; err: string};

describe('retention CLI', () => {
	let dir = '';
	let google: MockGoogle;
	before(() => {
		dir = mkdtempSync(join(tmpdir(), 'retention-cli-'));
		writeFileSync(join(dir, 'client.json'), JSON.stringify({installed: {client_id: 'cid.apps.googleusercontent.com', client_secret: 'csecret'}}));
		google = createMockGoogle();
		const story = (id: string, durationSec: number, lang: string, views = 3000, format: 'long' | 'short' = 'long') =>
			google.videos.set(id, {
				curve: synthCurve({videoId: id, channel: 'zoora-ai', slug: 'fixture-ret-story', lang, format, views, seed: id.length * 7 + durationSec, scenes: [{id: 'a', type: 'hook', durationMs: 3000}, {id: 'b', type: 'talk', durationMs: durationSec * 1000 - 3000}]}),
				stats: {views, engagedViews: views, averageViewDuration: 30, averageViewPercentage: 55, contentType: format === 'short' ? 'SHORTS' : 'VIDEO_ON_DEMAND'},
				durationSec,
				defaultAudioLanguage: lang === 'pt-br' ? 'pt-BR' : lang,
			});
		story('SYNcliEN001', 55, 'en');
		story('SYNcliES001', 58, 'es');
		story('SYNcliSH001', 22, 'en', 5000, 'short');
		story('SYNcliCUT01', 70, 'en'); // another cut than the timeline (55 s)
		google.videos.set('SYNcliGONE1', {missing: true});
	});
	after(() => rmSync(dir, {recursive: true, force: true}));

	const run = async (argv: string[], deps: Partial<CliDeps> = {}): Promise<Run> => {
		const out: string[] = [];
		const err: string[] = [];
		const code = await main([...argv, '--data', join(dir, 'data')], {
			env: {},
			cwd: dir,
			fetch: google.fetch,
			endpoints: google.endpoints,
			now: () => NOW,
			print: (line) => out.push(line),
			printError: (line) => err.push(line),
			openUrl: (url) => approveInBrowser(url),
			sleep: async () => {},
			...deps,
		});
		return {code, out: out.join('\n'), err: err.join('\n')};
	};
	const pull = (video: string, ...extra: string[]) => run(['pull', '--video', video, '--slug', 'zoora-ai/fixture-ret-story', '--lang', 'en', '--video-studio', VS, ...extra]);
	const stored = (id: string): PullRecord => JSON.parse(readFileSync(join(dir, 'data', 'retention', 'videos', `${id}.json`), 'utf8'));

	it('refuses to pull before the owner records a decision on the derived-metrics policy (exit 4)', async () => {
		const r = await pull('SYNcliEN001');
		assert.equal(r.code, 4);
		assert.match(r.err, /III\.E\.4\.h/);
		assert.match(r.err, /derived-metrics-policy/);
		assert.match(r.err, /Analytics & Reporting/);
		assert.equal(google.requests.length, 0, 'no API call before the decision');
	});

	it('records the decision', async () => {
		assert.equal((await run(['policy', '--derived-metrics', 'maybe', '--date', '2026-11-24'])).code, 2);
		const r = await run(['policy', '--derived-metrics', 'accepted', '--date', '2026-11-24', '--note', 'form submitted']);
		assert.equal(r.code, 0, r.err);
		assert.match((await run(['policy'])).out, /Recorded: derived metrics "accepted" on 2026-11-24 \(form submitted\)/);
	});

	it('says how to authorize when no tokens are saved (exit 3)', async () => {
		const r = await pull('SYNcliEN001');
		assert.equal(r.code, 3);
		assert.match(r.err, /auth --client-secrets/);
	});

	it('auth: loopback consent, then the channel is looked up and the tokens saved (mode 600)', async () => {
		assert.equal((await run(['auth'])).code, 2, 'the first auth needs the client secrets');
		const r = await run(['auth', '--client-secrets', 'client.json']);
		assert.equal(r.code, 0, r.err);
		assert.match(r.out, /Authorized read-only access to "Synthetic test channel" \(UCsyntheticRETENTION0001\)/);
		assert.match(r.out, /"Testing", this authorization expires in 7 days/);
		const file = JSON.parse(readFileSync(join(dir, 'data', 'retention', 'oauth.json'), 'utf8'));
		assert.equal(file.accounts.default.tokens.refreshToken, 'rt-initial');
		assert.doesNotMatch(r.out, /rt-initial|at-initial|csecret/, 'never prints secrets');
	});

	it('pull: joins the curve with the timeline and checks duration, language and format', async () => {
		const r = await pull('SYNcliEN001');
		assert.equal(r.code, 0, r.err);
		assert.match(r.out, /Pulled SYNcliEN001 \(zoora-ai\/fixture-ret-story en long\): 100 of 100 points/);
		assert.match(r.out, /duration matches the timeline/);
		const rec = stored('SYNcliEN001');
		assert.equal(rec.join.totalMs, 55_000);
		assert.deepEqual(rec.checks, {durationMatch: true, durationDeltaMs: 0, langMatch: true, formatMatch: true});
		assert.deepEqual(rec.window, {startDate: '2026-10-01', endDate: '2026-11-24'}, 'from the publish date to today');
		assert.equal(rec.metrics.length, 5);
		assert.equal(rec.join.timeline.path, 'video-studio/public/generated/zoora-ai/fixture-ret-story/en/timeline.json');
		const reports = google.calls('/v2/reports');
		assert.ok(reports.every((q) => /^video==SYNcliEN001(;|$)/.test(q.url.searchParams.get('filters')!)));
	});

	it('pull: a dubbed version and a Short', async () => {
		assert.equal((await run(['pull', '--video', 'SYNcliES001', '--slug', 'zoora-ai/fixture-ret-story', '--lang', 'es', '--video-studio', VS])).code, 0);
		assert.equal(stored('SYNcliES001').join.totalMs, 58_100);
		const short = await pull('SYNcliSH001', '--short', 'short1', '--audience', 'organic');
		assert.equal(short.code, 0, short.err);
		const rec = stored('SYNcliSH001');
		assert.equal(rec.format, 'short');
		assert.equal(rec.audience, 'ORGANIC');
		assert.equal(rec.checks.formatMatch, true);
		assert.ok(google.calls('/v2/reports').some((q) => q.url.searchParams.get('filters') === 'video==SYNcliSH001;audienceType==ORGANIC'));
	});

	it('pull: another cut than the timeline is saved but flagged, and excluded from the report later', async () => {
		const r = await pull('SYNcliCUT01');
		assert.equal(r.code, 0);
		assert.match(r.out, /DIFFERS from the timeline by 15000 ms/);
		assert.equal(stored('SYNcliCUT01').checks.durationMatch, false);
	});

	it('pull: a video that is not on the channel fails cleanly', async () => {
		const r = await pull('SYNcliGONE1');
		assert.equal(r.code, 1);
		assert.match(r.err, /has no video SYNcliGONE1/);
	});

	it('pull: usage errors (exit 2)', async () => {
		assert.equal((await pull('short')).code, 2);
		assert.equal((await run(['pull', '--video', 'SYNcliEN001', '--video', 'SYNcliES001', '--slug', 'zoora-ai/fixture-ret-story', '--lang', 'en'])).code, 2, 'one video per retention query');
		assert.equal((await run(['pull', '--video', 'SYNcliEN001', '--slug', 'fixture-ret-story', '--lang', 'en'])).code, 2);
		assert.equal((await run(['pull', '--video', 'SYNcliEN001', '--slug', 'zoora-ai/x', '--lang', 'fr'])).code, 2, 'French is not a pipeline language');
		assert.equal((await run(['pull', '--video', 'SYNcliEN001', '--slug', 'zoora-ai/x', '--lang', 'en', '--start', '2026-13-01'])).code, 2);
		assert.equal((await run(['frobnicate'])).code, 2);
		assert.equal((await run(['status', '--bogus'])).code, 2);
	});

	it('pull: a missing timeline explains the voice step (exit 1)', async () => {
		const r = await run(['pull', '--video', 'SYNcliEN001', '--slug', 'zoora-ai/fixture-ret-story', '--lang', 'hi', '--video-studio', VS]);
		assert.equal(r.code, 1);
		assert.match(r.err, /run the voice step/);
	});

	it('status lists pulls, the authorization (never the tokens) and the policy decision', async () => {
		const r = await run(['status']);
		assert.equal(r.code, 0);
		assert.match(r.out, /Stored pulls in data: 4/);
		assert.match(r.out, /SYNcliEN001 {2}zoora-ai\/fixture-ret-story en long {2}pulled 0 day\(s\) ago/);
		assert.match(r.out, /default = "Synthetic test channel"/);
		assert.match(r.out, /Derived-metrics policy decision: accepted \(2026-11-24\)/);
		assert.doesNotMatch(r.out, /rt-initial|at-/);
	});

	it('report writes report.md and report.json from the stored pulls', async () => {
		const out = join(dir, 'out');
		const r = await run(['report', '--out', 'out']);
		assert.equal(r.code, 0, r.err);
		assert.match(r.out, /4 upload\(s\), 3 usable; 0 recommendation\(s\)/);
		const md = readFileSync(join(out, 'report.md'), 'utf8');
		assert.match(md, /None yet/);
		assert.match(md, /SYNcliCUT01.*duration-mismatch/);
		assert.doesNotMatch(md, /Synthetic data\./, 'API pulls are not fixtures');
		const json = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'));
		assert.equal(json.synthetic, 'none');
		assert.deepEqual(json.policy, {derivedMetrics: 'accepted', date: '2026-11-24'});
	});

	it('refresh re-pulls stale records and deletes the record of a deleted video (Developer Policies III.E.4)', async () => {
		const later = () => new Date('2027-01-10T12:00:00Z');
		google.videos.get('SYNcliES001')!.missing = true;
		const r = await run(['refresh'], {now: later});
		assert.equal(r.code, 0, r.err);
		assert.match(r.out, /Refreshed 3 stored pull\(s\)\. Deleted 1 whose video no longer exists on the channel: SYNcliES001/);
		assert.equal(existsSync(join(dir, 'data', 'retention', 'videos', 'SYNcliES001.json')), false);
		assert.equal(stored('SYNcliEN001').pulledAt, '2027-01-10T12:00:00.000Z');
		assert.equal(stored('SYNcliEN001').window.startDate, '2026-10-01', 'keeps the original window start');
		assert.match((await run(['refresh'], {now: later})).out, /Nothing to refresh/);
	});

	it('forget deletes only this tool’s copies, and says so', async () => {
		const r = await run(['forget', '--video', 'SYNcliCUT01']);
		assert.equal(r.code, 0);
		assert.match(r.out, /Deleted 1 stored pull\(s\)\. This only deletes this tool's copies; nothing on YouTube changes\./);
		assert.equal((await run(['forget'])).code, 2);
	});

	it('revoke revokes at Google, deletes the account and the pulls made with it', async () => {
		const r = await run(['revoke']);
		assert.equal(r.code, 0, r.err);
		assert.match(r.out, /Revoked "default" at Google and deleted it, with 2 stored pull\(s\)/);
		assert.equal(google.calls('/revoke')[0]!.form.get('token'), 'rt-initial');
		assert.deepEqual(JSON.parse(readFileSync(join(dir, 'data', 'retention', 'oauth.json'), 'utf8')).accounts, {});
	});

	it('YT_ANALYTICS_* variables (CI secrets) take precedence over the token file', async () => {
		const r = await run(['pull', '--video', 'SYNcliEN001', '--slug', 'zoora-ai/fixture-ret-story', '--lang', 'en', '--video-studio', VS], {env: {YT_ANALYTICS_ACCESS_TOKEN: 'at-from-ci', RETENTION_DERIVED_METRICS: 'accepted', RETENTION_POLICY_DATE: '2026-11-24'}});
		assert.equal(r.code, 0, r.err);
		assert.equal(google.calls('/v2/reports').slice(-1)[0]!.authorization, 'Bearer at-from-ci');
		assert.equal(stored('SYNcliEN001').account, null);
	});

	it('demo writes a synthetic report without any YouTube call', async () => {
		const before = google.requests.length;
		const r = await run(['demo', '--out', 'demo']);
		assert.equal(r.code, 0, r.err);
		assert.match(r.out, /SYNTHETIC demo: 50 upload\(s\), 47 usable; 3 recommendation\(s\)/);
		assert.match(readFileSync(join(dir, 'demo', 'report.md'), 'utf8'), /\*\*Synthetic data\.\*\*/);
		assert.equal(google.requests.length, before);
	});
});

describe('checks', () => {
	const join_ = (totalMs: number, format: 'long' | 'short' = 'long') => ({totalMs, format}) as JoinSnapshot;
	it('duration: within max(1.5 s, 2%) of the timeline', () => {
		assert.deepEqual(durationCheck(join_(55_000), 55), {durationMatch: true, durationDeltaMs: 0});
		assert.equal(durationCheck(join_(55_400), 54).durationMatch, true);
		assert.equal(durationCheck(join_(55_000), 57).durationMatch, false);
		assert.equal(durationCheck(join_(600_000), 611).durationMatch, true, '2% of 10 minutes is 12 s');
		assert.deepEqual(durationCheck(join_(55_000), null), {durationMatch: null, durationDeltaMs: null});
	});
	it('language: primary subtag', () => {
		assert.equal(sameLanguage('pt-BR', 'pt-br'), true);
		assert.equal(sameLanguage('es-419', 'es'), true);
		assert.equal(sameLanguage('zh-Hans', 'zh'), true);
		assert.equal(sameLanguage('en-US', 'es'), false);
	});
	it('format: SHORTS is a Short, video on demand is long-form', () => {
		assert.equal(formatCheck('short', 'SHORTS'), true);
		assert.equal(formatCheck('long', 'SHORTS'), false);
		assert.equal(formatCheck('long', 'VIDEO_ON_DEMAND'), true);
		assert.equal(formatCheck('long', null), null);
	});
});
