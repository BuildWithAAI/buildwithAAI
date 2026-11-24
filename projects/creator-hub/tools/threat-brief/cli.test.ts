import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, beforeEach, describe, it} from 'node:test';
import {ledgerPath, main, type CliDeps} from './cli.ts';

const fixture = (name: string): string => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const HUB = fileURLToPath(new URL('../../', import.meta.url));
const sha = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

type Call = {url: string; init: RequestInit};

const run = async (argv: string[], over: Partial<CliDeps> & {env?: Record<string, string | undefined>} = {}) => {
	const out: string[] = [];
	const err: string[] = [];
	const calls: Call[] = [];
	const respond = over.fetch;
	const fetchMock: typeof fetch = async (input, init) => {
		calls.push({url: String(input), init: init ?? {}});
		return respond ? respond(input, init) : new Response(JSON.stringify({broadcast: {id: 777, subject: 'x', send_at: null, created_at: '2026-11-24T10:00:00Z'}}), {status: 201});
	};
	const code = await main(argv, {
		env: {},
		cwd: process.cwd(),
		now: () => new Date('2026-11-24T10:00:00Z'),
		print: (l) => out.push(l),
		printError: (l) => err.push(l),
		...over,
		fetch: fetchMock,
	});
	return {code, out: out.join('\n'), err: err.join('\n'), calls};
};

const brokenBody = (status: number): Response =>
	new Response(
		new ReadableStream({
			start(c) {
				c.error(new Error('ECONNRESET'));
			},
		}),
		{status},
	);

describe('threat-brief CLI', () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'threat-brief-'));
	});
	afterEach(() => rmSync(dir, {recursive: true, force: true}));

	const draftArgs = (...extra: string[]): string[] => [
		'draft',
		'--radar',
		fixture('radar.json'),
		'--show',
		fixture('kit.json'),
		'--allowlist',
		fixture('allowlist.json'),
		'--out',
		join(dir, 'out'),
		'--ledger',
		join(dir, 'ledger.json'),
		...extra,
	];
	const ledgerState = (): string => JSON.parse(readFileSync(join(dir, 'ledger.json'), 'utf8')).entries['threat-brief/2026-11-24#kit-draft'].state;

	it('draft writes <date>.md and <date>.html and sends nothing', async () => {
		const r = await run(draftArgs('--youtube-id', 'Zb7xq2Ph0aA'));
		assert.equal(r.code, 0, r.err);
		assert.ok(existsSync(join(dir, 'out', '2026-11-24.md')));
		assert.ok(existsSync(join(dir, 'out', '2026-11-24.html')));
		assert.match(r.out, /incidents: FixtureSwap \(CONFIRMED\), Mock Bridge \(DEVELOPING\), Sample Wallet \(CONFIRMED\)/);
		assert.match(r.out, /Nothing was sent/);
		assert.equal(r.calls.length, 0);
		assert.match(readFileSync(join(dir, 'out', '2026-11-24.md'), 'utf8'), /https:\/\/youtu\.be\/Zb7xq2Ph0aA/);
	});

	it('writes nothing when the lint fails', async () => {
		const r = await run(draftArgs('--fix', 'Buy the dip now and get rich before it moons.'));
		assert.equal(r.code, 1);
		assert.match(r.err, /No files were written/);
		assert.ok(!existsSync(join(dir, 'out', '2026-11-24.md')));
	});

	it('rejects bad usage with exit code 2', async () => {
		assert.equal((await run(['draft'])).code, 2);
		assert.equal((await run(draftArgs('--count', '9'))).code, 2);
		assert.equal((await run(draftArgs('--youtube-id', 'short'))).code, 2);
		assert.equal((await run(draftArgs('--all-subscribers'))).code, 2, '--all-subscribers needs --kit-draft');
		assert.equal((await run(['frobnicate'])).code, 2);
		assert.equal((await run([])).code, 2);
		assert.match((await run(['--help'])).out, /Usage:/);
	});

	it('reports a broken radar file without writing', async () => {
		const bad = join(dir, 'bad.json');
		writeFileSync(bad, '{"schema":"x"}');
		const r = await run(['draft', '--radar', bad, '--allowlist', fixture('allowlist.json'), '--out', join(dir, 'out')]);
		assert.equal(r.code, 1);
		assert.match(r.err, /schema/);
	});

	it('THREAT_BRIEF_LEDGER is relative to the hub, so the daily call (from video-studio) and a manual run share one ledger', () => {
		assert.equal(ledgerPath(undefined, {THREAT_BRIEF_LEDGER: 'data/threat-brief/shared.json'}, '/somewhere/video-studio'), resolve(HUB, 'data/threat-brief/shared.json'));
		assert.equal(ledgerPath(undefined, {THREAT_BRIEF_LEDGER: '/abs/l.json'}, '/x'), '/abs/l.json');
		assert.equal(ledgerPath('mine.json', {THREAT_BRIEF_LEDGER: 'data/x.json'}, '/work'), '/work/mine.json', '--ledger is relative to where you run it');
		assert.equal(ledgerPath(undefined, {}, '/x'), resolve(HUB, 'data/threat-brief/ledger.json'));
	});

	describe('--kit-draft', () => {
		it('needs a recipient choice, then creates one DRAFT (send_at null) and records it', async () => {
			const env = {KIT_API_KEY: 'kit_test_key'};
			const noFilter = await run(draftArgs('--youtube-id', 'Zb7xq2Ph0aA', '--kit-draft'), {env});
			assert.equal(noFilter.code, 1);
			assert.match(noFilter.err, /choose who it is for/);
			assert.equal(noFilter.calls.length, 0);

			const r = await run(draftArgs('--youtube-id', 'Zb7xq2Ph0aA', '--kit-draft'), {env: {...env, THREAT_BRIEF_KIT_FILTER: 'tag:42'}});
			assert.equal(r.code, 0, r.err);
			assert.equal(r.calls.length, 1);
			assert.equal(r.calls[0]?.url, 'https://api.kit.com/v4/broadcasts');
			const body = JSON.parse(String(r.calls[0]?.init.body));
			assert.equal(body.send_at, null);
			assert.equal(body.public, false);
			assert.deepEqual(body.subscriber_filter, [{all: [{type: 'tag', ids: [42]}]}]);
			assert.match(body.subject, /^Threat Brief, Nov 24/);
			assert.doesNotMatch(body.content, /<html|<script/);
			assert.match(r.out, /created Kit broadcast draft 777/);
			const ledger = JSON.parse(readFileSync(join(dir, 'ledger.json'), 'utf8'));
			assert.equal(ledger.entries['threat-brief/2026-11-24#kit-draft'].state, 'posted');
			assert.equal(ledger.entries['threat-brief/2026-11-24#kit-draft'].remoteId, '777');

			const again = await run(draftArgs('--youtube-id', 'Zb7xq2Ph0aA', '--kit-draft'), {env: {...env, THREAT_BRIEF_KIT_FILTER: 'tag:42'}});
			assert.equal(again.code, 1);
			assert.match(again.err, /already created/);
			assert.equal(again.calls.length, 0);
			const forced = await run(draftArgs('--youtube-id', 'Zb7xq2Ph0aA', '--kit-draft', '--new-draft'), {env: {...env, THREAT_BRIEF_KIT_FILTER: 'tag:42'}});
			assert.equal(forced.code, 0, forced.err);
			assert.equal(forced.calls.length, 1);
		});

		it('refuses a brief whose show link is still pending', async () => {
			const r = await run(draftArgs('--kit-draft', '--all-subscribers'), {env: {KIT_API_KEY: 'kit_test_key'}});
			assert.equal(r.code, 1);
			assert.match(r.err, /show-link-pending/);
			assert.equal(r.calls.length, 0);
		});

		it('records a refused request as failed and a lost answer as pending', async () => {
			const env = {KIT_API_KEY: 'kit_test_key', THREAT_BRIEF_KIT_FILTER: 'segment:7'};
			const refused = await run(draftArgs('--youtube-id', 'Zb7xq2Ph0aA', '--kit-draft'), {env, fetch: async () => new Response('{"errors":["nope"]}', {status: 422})});
			assert.equal(refused.code, 1);
			assert.match(refused.err, /Kit answered 422/);
			assert.equal(ledgerState(), 'failed');
			const lost = await run(draftArgs('--youtube-id', 'Zb7xq2Ph0aA', '--kit-draft'), {env, fetch: async () => Promise.reject(new TypeError('socket hang up'))});
			assert.equal(lost.code, 1);
			assert.equal(ledgerState(), 'pending');
		});

		// A 2xx means Kit may have made the draft: only a confirmed id is "posted", only a 3xx/4xx refusal is "failed"
		const undecided: [string, () => Response][] = [
			['a 2xx with no broadcast id', () => new Response('{"broadcast":{}}', {status: 201})],
			['a 2xx Kit reports as scheduled', () => new Response(JSON.stringify({broadcast: {id: 9, send_at: '2026-11-25T10:00:00Z'}}), {status: 201})],
			['a 2xx whose body breaks off', () => brokenBody(201)],
			['a 5xx', () => new Response('upstream', {status: 503})],
		];
		for (const [name, respond] of undecided) {
			it(`records ${name} as pending, says a draft may exist, and blocks a second draft`, async () => {
				const env = {KIT_API_KEY: 'kit_test_key', THREAT_BRIEF_KIT_FILTER: 'tag:42'};
				const first = await run(draftArgs('--youtube-id', 'Zb7xq2Ph0aA', '--kit-draft'), {env, fetch: async () => respond()});
				assert.equal(first.code, 1);
				assert.equal(ledgerState(), 'pending');
				assert.match(first.err, /NOT CONFIRMED: .*A draft may exist/s);
				const second = await run(draftArgs('--youtube-id', 'Zb7xq2Ph0aA', '--kit-draft'), {env});
				assert.equal(second.calls.length, 0, 'no second draft while one may exist');
				assert.equal(second.code, 1);
				assert.match(second.err, /may have been posted|already created/);
			});
		}

		it('never records a request that was never sent', async () => {
			const r = await run(draftArgs('--youtube-id', 'Zb7xq2Ph0aA', '--kit-draft'), {env: {KIT_API_KEY: 'bad key', THREAT_BRIEF_KIT_FILTER: 'tag:42'}});
			assert.equal(r.code, 1);
			assert.match(r.err, /KIT_API_KEY contains spaces/);
			assert.equal(r.calls.length, 0);
			assert.ok(!existsSync(join(dir, 'ledger.json')));
		});
	});

	describe('lint', () => {
		it('passes a written draft and fails an edited one', async () => {
			await run(draftArgs('--youtube-id', 'Zb7xq2Ph0aA'));
			const md = join(dir, 'out', '2026-11-24.md');
			const ok = await run(['lint', md, '--allowlist', fixture('allowlist.json')]);
			assert.equal(ok.code, 0, ok.err);
			assert.match(ok.out, /Lint passed/);
			writeFileSync(md, readFileSync(md, 'utf8').replace('Keep long-term funds', 'Probably keep long-term funds'));
			const bad = await run(['lint', md, '--allowlist', fixture('allowlist.json')]);
			assert.equal(bad.code, 1);
			assert.match(bad.err, /speculation\/hedge/);
			assert.equal((await run(['lint', join(dir, 'x.txt')])).code, 2);
		});
	});

	describe('daily pipeline call (--input --out [--dry-run]): the approved input only', () => {
		const base = JSON.parse(readFileSync(fixture('daily-input.json'), 'utf8'));
		/** What the daily writes after APPROVE once the video id is recorded: facts, analysis, fix, corrections, radar mentions. */
		const approved = {
			...base,
			youtubeId: 'Zb7xq2Ph0aA',
			whatWeKnow: [
				{text: 'According to Fixture DB, FixtureSwap lost $4,200,000 on November 23.', sources: [{publisher: 'Fixture DB', url: 'https://db.fixture.test/hacks#FixtureSwap@2026-11-23'}]},
				{text: 'Fixture Firm lists the attack method as a private key leak.', sources: [{publisher: 'Fixture Firm', url: 'https://firm.fixture.test/#FixtureSwap@2026-11-23'}]},
			],
			alsoOnRadar: [{name: 'Quiet DAO', status: 'developing', coverage: [{publisher: 'Example Wire', url: 'https://wire.example.test/news/quiet-dao'}]}],
		};
		const studioRoot = (): string => join(dir, 'studio');
		const writeInput = (input: unknown, name = 'input.json'): string => {
			const file = join(dir, name);
			writeFileSync(file, JSON.stringify(input, null, 2));
			return file;
		};
		/** The owner's daily content approval (video-studio scripts/daily/lib/approve.ts) for the approved input. */
		const approve = (over: Record<string, unknown> = {}): string => {
			const sbPath = `content/zoora-security/${base.slug}/storyboard.json`;
			mkdirSync(dirname(join(studioRoot(), sbPath)), {recursive: true});
			if (!existsSync(join(studioRoot(), sbPath))) writeFileSync(join(studioRoot(), sbPath), '{"version": 1}\n');
			const sbSha = sha(readFileSync(join(studioRoot(), sbPath)));
			const renderSha = 'c'.repeat(64);
			const record = {
				version: 1,
				schema: 'zoora-security/approval@1',
				kind: 'daily-content-approval',
				channel: 'zoora-security',
				slug: base.slug,
				decision: 'approved',
				approvedBy: 'owner',
				approvedAt: '2026-11-24T09:30:00Z',
				versionHash: sha(`storyboard:${sbSha}\nrender:${renderSha}\n`),
				versions: {storyboard: {path: sbPath, sha256: sbSha}, render: {path: 'out/approval/x/short.mp4', sha256: renderSha}, publishKit: {path: 'k', sha256: null}},
				developing: false,
				title: base.title,
				upload: {method: 'manual: YouTube Studio', automated: false, youtubeVideoId: 'Zb7xq2Ph0aA', recordedAt: '2026-11-24T09:50:00Z', note: ''},
				...over,
			};
			const file = join(studioRoot(), 'content', 'zoora-security', base.slug, 'approval.json');
			writeFileSync(file, JSON.stringify(record, null, 2));
			return file;
		};
		const daily = (input: string, ...extra: string[]): string[] => ['--input', input, '--out', join(dir, 'post'), '--allowlist', fixture('allowlist.json'), '--ledger', join(dir, 'ledger.json'), '--studio-root', studioRoot(), ...extra];
		const KIT_ENV = {KIT_API_KEY: 'kit_test_key', THREAT_BRIEF_KIT_FILTER: 'tag:42'};

		it('builds the email from the approved input only: the radar is never read, even when one is present', async () => {
			const radarDir = join(dir, 'content', 'zoora-security', 'radar');
			mkdirSync(radarDir, {recursive: true});
			copyFileSync(fixture('radar.json'), join(radarDir, '2026-11-24.json'));
			const r = await run(daily(writeInput(approved), '--dry-run'), {cwd: dir});
			assert.equal(r.code, 0, r.err);
			assert.match(r.out, /built only from the approved input .* the radar is not read/);
			assert.match(r.out, /Dry run: no Kit draft/);
			assert.equal(r.calls.length, 0);
			const md = readFileSync(join(dir, 'post', '2026-11-24.md'), 'utf8');
			assert.match(md, /^## What we know$/m);
			assert.match(md, /- According to Fixture DB, FixtureSwap lost \$4,200,000 on November 23\. \(\[Fixture DB\]\(https:\/\/db\.fixture\.test\/hacks#FixtureSwap@2026-11-23\)\)/);
			assert.match(md, /^## Our analysis\n\nSecond key-compromise drain on the fixture tracker this week\.$/m);
			assert.match(md, /## Zoo's One Fix\n\nKeep long-term funds on a hardware wallet and never type its recovery phrase into a website\./, "the show's One Fix");
			assert.match(md, /Correction \(2026-11-24\): Example Wire now gives the figure as \$4\.8 million/);
			assert.match(md, /- Quiet DAO \(developing\): \[Example Wire\]\(https:\/\/wire\.example\.test\/news\/quiet-dao\)/);
			assert.match(md, /\[Watch the Short\]\(https:\/\/youtu\.be\/Zb7xq2Ph0aA\)/);
			// nothing the owner did not approve: no radar incidents, statuses, figures or explanations
			assert.doesNotMatch(md, /Today's incidents|How it worked|Mock Bridge|Sample Wallet|Old Farm|\$4,800,000|\$5M|In plain terms|classifies it as/);
			const html = readFileSync(join(dir, 'post', '2026-11-24.html'), 'utf8');
			assert.doesNotMatch(html, /<script|<style|<img|\son[a-z]+=/i);
			assert.ok([...html.matchAll(/href="([^"]+)"/g)].every((m) => m[1]?.startsWith('https://')));
		});

		it('without --dry-run it skips Kit when no key is set, and never sends', async () => {
			const r = await run(daily(writeInput(approved)), {cwd: dir});
			assert.equal(r.code, 0, r.err);
			assert.match(r.out, /Kit draft skipped: KIT_API_KEY is not set/);
			assert.equal(r.calls.length, 0);
		});

		it("creates the Kit draft only under the owner's daily approval for this exact episode", async () => {
			const input = writeInput(approved);
			const none = await run(daily(input), {cwd: dir, env: KIT_ENV});
			assert.equal(none.code, 1);
			assert.match(none.err, /Kit draft not created: the owner's approval does not cover this email: no approval record/);
			assert.equal(none.calls.length, 0);

			const refusedFor = async (over: Record<string, unknown>, reason: RegExp): Promise<void> => {
				approve(over);
				const r = await run(daily(input), {cwd: dir, env: KIT_ENV});
				assert.equal(r.code, 1, `${reason}`);
				assert.match(r.err, reason);
				assert.equal(r.calls.length, 0);
			};
			await refusedFor({title: 'Another episode title'}, /approves the title "Another episode title"/);
			await refusedFor({slug: '2026-11-24-other'}, /approves zoora-security\/2026-11-24-other/);
			await refusedFor({upload: {youtubeVideoId: 'AAAAAAAAAAA'}}, /records the video AAAAAAAAAAA, not Zb7xq2Ph0aA/);
			await refusedFor({developing: true}, /approves a DEVELOPING story/);
			await refusedFor({versionHash: 'f'.repeat(64)}, /versionHash does not match/);
			await refusedFor({kind: 'youtube-upload-approval'}, /needs the owner's "daily-content-approval" record/);

			approve();
			const ok = await run(daily(input), {cwd: dir, env: KIT_ENV});
			assert.equal(ok.code, 0, ok.err);
			assert.equal(ok.calls.length, 1);
			assert.match(ok.out, /approval: daily-content-approval [0-9a-f]{12} OK/);
			const body = JSON.parse(String(ok.calls[0]?.init.body));
			assert.equal(body.send_at, null);
			assert.match(body.content, /According to Fixture DB, FixtureSwap lost \$4,200,000 on November 23\./);
			assert.doesNotMatch(body.content, /Mock Bridge|Sample Wallet|How it worked/);
			assert.match(body.description, /built only from the approved daily input \(approval [0-9a-f]{12}\)/);
			const entry = JSON.parse(readFileSync(join(dir, 'ledger.json'), 'utf8')).entries['threat-brief/2026-11-24#kit-draft'];
			assert.equal(entry.state, 'posted');
			assert.equal(entry.textSha256, sha(body.content), 'the ledger records exactly what went to Kit');
			assert.match(entry.history.at(-1).event, /daily 2026-11-24-fixtureswap, approval [0-9a-f]{12}, input [0-9a-f]{12}/);

			// the storyboard changes after approval: the approval no longer covers it
			writeFileSync(join(studioRoot(), `content/zoora-security/${base.slug}/storyboard.json`), '{"version": 2}\n');
			const stale = await run(daily(input, '--ledger', join(dir, 'ledger2.json')), {cwd: dir, env: KIT_ENV});
			assert.equal(stale.code, 1);
			assert.match(stale.err, /the storyboard changed after approval/);
		});

		it('refuses a Kit draft with no approved facts or with the video link still pending', async () => {
			approve();
			const noFacts = await run(daily(writeInput({...approved, whatWeKnow: []})), {cwd: dir, env: KIT_ENV});
			assert.equal(noFacts.code, 1);
			assert.match(noFacts.err, /structure\/no-facts/);
			assert.equal(noFacts.calls.length, 0);
			const pending = await run(daily(writeInput({...approved, youtubeId: null})), {cwd: dir, env: KIT_ENV});
			assert.equal(pending.code, 1);
			assert.match(pending.err, /show-link-pending/);
			assert.equal(pending.calls.length, 0);
			const dry = await run(daily(writeInput({...approved, whatWeKnow: [], youtubeId: null}), '--dry-run'), {cwd: dir});
			assert.equal(dry.code, 0, `${dry.err}: a dry run still writes the files for review`);
			assert.match(dry.out, /warning: what we know: \[structure\/no-facts\]/);
		});

		it('labels a developing story in the subject and the body', async () => {
			const r = await run(daily(writeInput({...approved, developing: true, email: null}), '--dry-run'), {cwd: dir});
			assert.equal(r.code, 0, r.err);
			const md = readFileSync(join(dir, 'post', '2026-11-24.md'), 'utf8');
			assert.match(md, /^subject: "Threat Brief, Nov 24: DEVELOPING: FixtureSwap lost its keys"$/m);
			assert.match(md, /^# DEVELOPING: FixtureSwap lost its keys$/m);
			assert.match(md, /\*\*DEVELOPING STORY: details may change\. Corrections will be pinned under the video\.\*\*/);
			assert.match(readFileSync(join(dir, 'post', '2026-11-24.html'), 'utf8'), />DEVELOPING<\/span>/);
			const unlabelled = await run(daily(writeInput({...approved, developing: true, email: {subject: 'Threat Brief, Nov 24', preview: 'x'}}), '--dry-run'), {cwd: dir});
			assert.equal(unlabelled.code, 1);
			assert.match(unlabelled.err, /developing\/label/);
		});

		it('blocks an approved line that breaks a rule, and never quotes an unsafe headline', async () => {
			const unsafe = await run(daily(writeInput({...approved, analysis: ['The founder Jane probably moved the funds.']}), '--dry-run'), {cwd: dir});
			assert.equal(unsafe.code, 1);
			assert.match(unsafe.err, /names\/title-or-role/);
			assert.match(unsafe.err, /speculation\/hedge/);
			assert.match(unsafe.err, /No files were written and no Kit draft was made/);
			assert.ok(!existsSync(join(dir, 'post', '2026-11-24.md')));
			const unattributed = await run(daily(writeInput({...approved, whatWeKnow: [{text: 'The protocol lost $4,200,000.', sources: [{publisher: 'Fixture DB', url: 'https://db.fixture.test/x'}]}]}), '--dry-run'), {cwd: dir});
			assert.equal(unattributed.code, 1);
			assert.match(unattributed.err, /attribution\/loss-unattributed/);
		});

		it('escapes a hostile input: HTML, scripts and Kit template braces never reach the email', async () => {
			const hostile = {
				...approved,
				sources: [
					{publisher: 'Example Wire', title: 'FixtureSwap confirms hack <script src=//evil.test/x.js></script> {{ subscriber.email }} {% raw %} <a href=javascript:void(0)>x</a>', url: 'https://wire.example.test/a?q=%22%3E%3Csvg+onload%3Dx%3E'},
					{publisher: 'Fixture DB', title: 'Fixture DB hacks: FixtureSwap (2026-11-23)', url: 'https://db.fixture.test/hacks#FixtureSwap@2026-11-23'},
				],
				alsoOnRadar: [
					{name: 'John Smith', status: 'confirmed', coverage: [{publisher: 'Example Wire', url: 'https://wire.example.test/b'}]},
					{name: 'Quiet DAO', status: 'rumoured', coverage: [{publisher: 'Example Wire', url: 'https://wire.example.test/c'}, {publisher: 'Evil', url: 'javascript:alert(1)'}]},
				],
			};
			const r = await run(daily(writeInput(hostile), '--dry-run'), {cwd: dir});
			assert.equal(r.code, 0, r.err);
			assert.match(r.out, /"John Smith" breaks a safety rule .* and is left out/);
			assert.match(r.out, /unknown status "rumoured": shown as developing/);
			const html = readFileSync(join(dir, 'post', '2026-11-24.html'), 'utf8');
			const md = readFileSync(join(dir, 'post', '2026-11-24.md'), 'utf8');
			for (const text of [html, md]) assert.doesNotMatch(text, /<script|evil\.test|\{\{|\{%|javascript:|John Smith/);
			assert.match(md, /Quiet DAO \(developing\)/);
			assert.match(html, /Quiet DAO <em>\(developing\)<\/em>/);
			assert.match(md, /- \[Example Wire\]\(https:\/\/wire\.example\.test\/a\?q=%22%3E%3Csvg\+onload%3Dx%3E\)/, 'the unsafe headline is replaced by its publisher');
			assert.match(md, /- \[Fixture DB hacks: FixtureSwap \(2026-11-23\)\]/);
			assert.ok([...html.matchAll(/href="([^"]+)"/g)].every((m) => m[1]?.startsWith('https://')));
		});

		it('rejects an input that is not the daily PostInput', async () => {
			const bad = await run(daily(writeInput({...approved, date: '2026-13-40', whatWeKnow: [{text: 'A fact.', sources: []}]})), {cwd: dir});
			assert.equal(bad.code, 1);
			assert.match(bad.err, /"date" must be a YYYY-MM-DD date/);
			assert.match(bad.err, /names no source: every fact is attributed/);
			assert.equal((await run(['--input', writeInput(approved), '--out', join(dir, 'p'), '--radar', 'x.json'])).code, 2, 'the daily call no longer takes a radar');
		});
	});
});
