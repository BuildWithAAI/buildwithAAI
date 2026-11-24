/** CLI tests: end to end on the fixtures, the every-10-videos rule, --force, defaults from DATA_DIR, the API path (mocked) and usage errors. */
import assert from 'node:assert/strict';
import {copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {after, before, describe, it} from 'node:test';
import {insertClick, openDb} from '../../src/server/db.ts';
import {main, type CliDeps} from './cli.ts';
import {parseCsv} from './csv.ts';

const fixture = (name: string): string => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
type Run = {code: number; out: string; err: string};

describe('dashboard CLI', () => {
	let dir = '';
	before(() => {
		dir = mkdtempSync(join(tmpdir(), 'dashboard-cli-'));
	});
	after(() => rmSync(dir, {recursive: true, force: true}));

	const run = async (argv: string[], deps: Partial<CliDeps> = {}): Promise<Run> => {
		const out: string[] = [];
		const err: string[] = [];
		const code = await main(argv, {
			env: {DATA_DIR: join(dir, 'no-data')},
			cwd: dir,
			now: () => new Date('2026-11-24T12:00:00Z'),
			fetch: (() => assert.fail('no network call expected')) as typeof fetch,
			print: (line) => out.push(line),
			printError: (line) => err.push(line),
			...deps,
		});
		return {code, out: out.join('\n'), err: err.join('\n')};
	};
	const allInputs = (out: string): string[] => [
		'--studio', fixture('studio-content.csv'),
		'--catalog', fixture('videos.csv'),
		'--kits', fixture('kits'),
		'--hub-csv', fixture('hub-video-clicks.csv'),
		'--payouts-config', fixture('payouts.json'),
		'--payouts', `wallet-network=${fixture('payouts/wallet-network.csv')}`,
		'--payouts', `eu-tools=${fixture('payouts/eu-tools.csv')}`,
		'--out', out,
	];

	it('writes metrics.csv, index.html and, at 10+ videos, recommendations.md', async () => {
		const {code, out, err} = await run(allInputs('full'));
		assert.equal(code, 0, err);
		assert.match(out, /Dashboard for zoora-ai: 12 video\(s\) with YouTube data, 12 known\./);
		assert.match(out, /wrote full\/recommendations\.md \(milestone: 12 videos\)/);
		assert.match(out, /warning: .*wallet-network\.csv: offer names not mapped/);
		const metrics = parseCsv(readFileSync(join(dir, 'full', 'metrics.csv'), 'utf8'));
		assert.equal(metrics.rows.length, 12);
		assert.equal(metrics.header[0], 'videoId');
		const html = readFileSync(join(dir, 'full', 'index.html'), 'utf8');
		assert.match(html, /Which videos earn/);
		assert.match(html, /href="recommendations\.md"/);
		const md = readFileSync(join(dir, 'full', 'recommendations.md'), 'utf8');
		assert.match(md, /^# What to double down on: Zoora AI \(zoora-ai\)/);
		assert.ok(!/Sample too small/.test(md));
		const state = JSON.parse(readFileSync(join(dir, 'full', 'state.json'), 'utf8'));
		assert.equal(state.channels['zoora-ai'].videoCount, 12);
	});

	it('reads the offer registry for its region rules, and warns instead of failing on a broken one', async () => {
		const registry = fileURLToPath(new URL('../newsletter/fixtures/offers.json', import.meta.url));
		const ok = await run([...allInputs('with-offers'), '--offers', registry, '--force']);
		assert.equal(ok.code, 0, ok.err);
		assert.match(ok.out, /input: offer registry: .*offers\.json \(1 offer\(s\) restricted by region\)/);
		const broken = join(dir, 'broken-offers.json');
		writeFileSync(broken, JSON.stringify({version: 1, offers: [{id: 'x'}]}));
		const bad = await run([...allInputs('bad-offers'), '--offers', broken, '--force']);
		assert.equal(bad.code, 0, bad.err);
		assert.match(bad.out, /warning: .*broken-offers\.json: the offer registry has problems .*region rules are not applied/);
	});

	it('leaves recommendations.md alone until the next 10 videos, unless --force', async () => {
		const file = join(dir, 'full', 'recommendations.md');
		writeFileSync(file, 'kept\n');
		const again = await run(allInputs('full'));
		assert.equal(again.code, 0, again.err);
		assert.match(again.out, /recommendations\.md unchanged: next at 20 videos with data \(or run with --force\)/);
		assert.equal(readFileSync(file, 'utf8'), 'kept\n');
		const forced = await run([...allInputs('full'), '--force']);
		assert.equal(forced.code, 0, forced.err);
		assert.match(forced.out, /wrote full\/recommendations\.md \(--force\)/);
		assert.match(readFileSync(file, 'utf8'), /What to double down on/);
	});

	it('with fewer than 10 videos, --force writes a report that says the sample is too small', async () => {
		const lines = readFileSync(fixture('studio-content.csv'), 'utf8').split('\r\n');
		const small = join(dir, 'small.csv');
		writeFileSync(small, lines.slice(0, 7).join('\r\n'));
		const quiet = await run(['--studio', small, '--out', 'small']);
		assert.equal(quiet.code, 0, quiet.err);
		assert.ok(!existsSync(join(dir, 'small', 'recommendations.md')));
		assert.match(quiet.out, /next at 10 videos/);
		const forced = await run(['--studio', small, '--out', 'small', '--force']);
		assert.match(forced.out, /The sample is too small to conclude anything yet/);
		assert.match(readFileSync(join(dir, 'small', 'recommendations.md'), 'utf8'), /## Sample too small to conclude anything/);
		assert.match(readFileSync(join(dir, 'small', 'index.html'), 'utf8'), /sample is too small to conclude anything/);
	});

	it('finds inputs in DATA_DIR by default: Studio exports, hub.sqlite, videos.csv and payouts', async () => {
		const data = join(dir, 'data');
		mkdirSync(join(data, 'youtube'), {recursive: true});
		mkdirSync(join(data, 'payouts', 'wallet-network'), {recursive: true});
		copyFileSync(fixture('studio-content.csv'), join(data, 'youtube', 'Table data.csv'));
		copyFileSync(fixture('videos.csv'), join(data, 'videos.csv'));
		copyFileSync(fixture('payouts/wallet-network.csv'), join(data, 'payouts', 'wallet-network', 'nov.csv'));
		const db = openDb(data);
		insertClick(db, {ts: Date.UTC(2026, 10, 2, 10), offerId: 'hardware-wallet', videoId: 'fixture0001', source: 'yt', country: 'DE', visitorHash: 'abababababababab', isBot: false, outcome: 'redirected', referrerHost: null});
		db.close();
		const {code, out, err} = await run(['--payouts-config', fixture('payouts.json'), '--out', 'defaults'], {env: {DATA_DIR: data}});
		assert.equal(code, 0, err);
		assert.match(out, /input: YouTube Studio export data\/youtube\/Table data\.csv: 12 video\(s\)/);
		assert.match(out, /input: hub clicks: data\/hub\.sqlite \(hub database, counted with the hub rule\)/);
		assert.match(out, /input: videos\.csv data\/videos\.csv: 13 video\(s\)/);
		assert.match(out, /input: payouts wallet-network data\/payouts\/wallet-network\/nov\.csv: 8 row\(s\)/);
		const metrics = parseCsv(readFileSync(join(dir, 'defaults', 'metrics.csv'), 'utf8'));
		const hubClicks = metrics.header.indexOf('hubClicks');
		assert.equal(metrics.rows.find((r) => r.cells[0] === 'fixture0001')?.cells[hubClicks], '1');
	});

	it('reads the YouTube Analytics API with a mocked response and never prints the token', async () => {
		const body = readFileSync(fixture('api-report.json'), 'utf8');
		const urls: string[] = [];
		const fetchMock = (async (input: string | URL | Request) => {
			urls.push(String(input));
			return new Response(body, {status: 200, headers: {'Content-Type': 'application/json'}});
		}) as typeof fetch;
		const {code, out, err} = await run(['--api', '--api-revenue', '--from', '2026-10-01', '--to', '2026-11-23', '--out', 'api'], {
			env: {DATA_DIR: join(dir, 'no-data'), YT_ANALYTICS_ACCESS_TOKEN: 'secret-token-value'},
			fetch: fetchMock,
		});
		assert.equal(code, 0, err);
		assert.match(out, /input: YouTube Analytics API v2, 2026-10-01 to 2026-11-23: 3 video\(s\), with estimated revenue/);
		assert.equal(new URL(urls[0] ?? '').searchParams.get('startDate'), '2026-10-01');
		assert.ok(!out.includes('secret-token-value') && !err.includes('secret-token-value'));
		assert.ok(!readFileSync(join(dir, 'api', 'index.html'), 'utf8').includes('secret-token-value'));
	});

	it('stops with exit 1 and writes nothing when an input is broken', async () => {
		const missing = await run(['--studio', 'nope.csv', '--out', 'broken']);
		assert.equal(missing.code, 1);
		assert.match(missing.err, /The dashboard was not written: 1 input problem\(s\)\.\n {2}error: nope\.csv: cannot read/);
		assert.ok(!existsSync(join(dir, 'broken', 'index.html')));
		const noToken = await run(['--api', '--out', 'broken']);
		assert.equal(noToken.code, 1);
		assert.match(noToken.err, /--api needs YT_ANALYTICS_ACCESS_TOKEN/);
		const config = join(dir, 'bad-config.json');
		writeFileSync(config, JSON.stringify({version: 1, programmes: [{id: 'x', name: 'x', columns: {}}]}));
		const badConfig = await run(['--payouts-config', config, '--out', 'broken']);
		assert.equal(badConfig.code, 1);
		assert.match(badConfig.err, /columns.revenue is required/);
	});

	it('rejects bad options with exit 2 and the usage text', async () => {
		const cases: [string[], RegExp][] = [
			[['--hub-db', 'a', '--hub-csv', 'b'], /Use --hub-db or --hub-csv, not both/],
			[['--from', '2026-13-01'], /--from must be a date/],
			[['--from', '2026-11-02', '--to', '2026-11-01'], /--from must not be after --to/],
			[['--api-revenue'], /--api-revenue needs --api/],
			[['--channel', 'Zoora AI'], /--channel must be a slug/],
			[['--nope'], /Unknown option '--nope'/],
			[['--payouts-config', fixture('payouts.json'), '--payouts', 'missing=x.csv'], /no programme "missing"/],
			[['--payouts-config', fixture('payouts.json'), '--payouts', 'x.csv'], /takes <programme-id>=<file>/],
		];
		for (const [argv, pattern] of cases) {
			const {code, err} = await run(argv);
			assert.equal(code, 2, argv.join(' '));
			assert.match(err, pattern);
			assert.match(err, /Usage: npm run dashboard/);
		}
		const help = await run(['--help']);
		assert.equal(help.code, 0);
		assert.match(help.out, /--force/);
	});

	it('writes files whole (no .tmp files are left behind)', async () => {
		await run(allInputs('atomic'));
		for (const name of ['metrics.csv', 'index.html', 'state.json', 'recommendations.md']) {
			assert.ok(statSync(join(dir, 'atomic', name)).size > 0, name);
			assert.ok(!existsSync(join(dir, 'atomic', `${name}.tmp`)));
		}
	});
});
