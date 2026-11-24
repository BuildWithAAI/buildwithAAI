// node --test scripts/farm/tests/gates.test.ts   (needs git)
// The real gate runner (gates.ts spawnGateRunner) against a STUB claim gate, so the tests are the same on every machine
// (with or without a private names list): the argv for each names mode, the report read-back that proves the names
// were checked (and every way it must refuse), fail versus could-not-check, the private per-run report folder, and two
// validate processes running at the same time on one machine.
import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {generateKeyPairSync} from 'node:crypto';
import {cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {after, test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {gateArgs, spawnGateRunner, type GateTarget, type NamesMode} from '../gates.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL_PROJECT = join(HERE, '..', '..', '..');
const root = mkdtempSync(join(tmpdir(), 'farm-gates-'));
after(() => rmSync(root, {recursive: true, force: true}));

const put = (base: string, rel: string, data: string) => {
	mkdirSync(dirname(join(base, rel)), {recursive: true});
	writeFileSync(join(base, rel), data);
};

/** A claim gate stand-in: records its argv and its report folder's mode, writes the report(s) asked for, exits as asked. */
const STUB = `import {appendFileSync, statSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
const argv = process.argv.slice(2);
const out = argv[argv.indexOf('--out-dir') + 1];
if (process.env.STUB_ARGV) appendFileSync(process.env.STUB_ARGV, JSON.stringify({argv, mode: (statSync(out).mode & 0o777).toString(8)}) + '\\n');
const n = Number(process.env.STUB_REPORTS ?? '1');
for (let i = 0; i < n; i++) writeFileSync(join(out, 'r' + i + '.json'), process.env.STUB_REPORT ?? '{}');
if (process.env.STUB_SLEEP_MS) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.STUB_SLEEP_MS));
process.exitCode = Number(process.env.STUB_EXIT ?? '0');
`;

const project = join(root, 'project');
put(project, 'scripts/claims/check.ts', STUB);
put(project, 'scripts/claims/package.json', '{"type": "module"}\n');
const parent = join(root, 'gate-temp');
const argvLog = join(root, 'argv.jsonl');
const T: GateTarget = {channel: 'zoora-ai', slug: 'ep', lang: 'en'};
const good = {tool: 'claims/check', pass: true, channel: 'zoora-ai', slug: 'ep', lang: 'en', namesList: {path: 'data/private/names.txt', count: 2}};

const run = (mode: NamesMode, env: Record<string, string>, t: GateTarget = T) => {
	writeFileSync(argvLog, '');
	const r = spawnGateRunner(project, parent, {PATH: process.env.PATH, STUB_ARGV: argvLog, ...env})('claims', t, mode);
	const calls = readFileSync(argvLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as {argv: string[]; mode: string});
	assert.deepEqual(readdirSync(parent).filter((f) => f.startsWith('farm-gate-')), [], 'a report folder (it quotes the script) was left behind');
	return {...r, calls};
};

test('argv: validate passes the names list, CI passes --no-names, and the news gate gets its own arguments', () => {
	assert.deepEqual(gateArgs('/p', 'claims', T, 'check', '/d'), ['scripts/claims/check.ts', 'content/zoora-ai/ep', '--lang', 'en', '--names', '/p/data/private/names.txt', '--quiet', '--out-dir', '/d']);
	assert.deepEqual(gateArgs('/p', 'claims', {...T, lang: null}, 'skip', '/d'), ['scripts/claims/check.ts', 'content/zoora-ai/ep', '--no-names', '--quiet', '--out-dir', '/d']);
	assert.deepEqual(gateArgs('/p', 'news', {channel: 'zoora-security', slug: 's', lang: 'en'}, 'check', '/d'), ['scripts/news/gate.ts', 's', '--quiet', '--out', '/d', '--general-gate', 'off']);
	// and the real runner hands exactly those to the gate
	const check = run('check', {STUB_REPORT: JSON.stringify(good)});
	assert.deepEqual([check.status, check.names], ['pass', 'checked']);
	assert.equal(check.calls.length, 1);
	const a = check.calls[0].argv;
	assert.deepEqual(a.slice(0, 6), ['content/zoora-ai/ep', '--lang', 'en', '--names', join(project, 'data/private/names.txt'), '--quiet']);
	assert.ok(!a.includes('--no-names'));
	const skip = run('skip', {STUB_REPORT: JSON.stringify(good)});
	assert.deepEqual([skip.status, skip.names], ['pass', 'unchecked'], 'CI never claims a names check');
	assert.ok(skip.calls[0].argv.includes('--no-names') && !skip.calls[0].argv.includes('--names'), 'CI must run the gate with --no-names');
});

test('each run reports into its own private folder (0700, a unique name), deleted right after', () => {
	const r = run('check', {STUB_REPORT: JSON.stringify(good)});
	assert.equal(r.calls[0].mode, '700');
	const dir = r.calls[0].argv[r.calls[0].argv.indexOf('--out-dir') + 1];
	assert.equal(dirname(dir), parent);
	assert.match(dir, /farm-gate-[A-Za-z0-9]{6}$/);
	assert.ok(!existsSync(dir));
	const again = run('check', {STUB_REPORT: JSON.stringify(good)});
	assert.notEqual(again.calls[0].argv.at(-1), dir, 'a second run gets another folder');
});

test('the names proof: only a passing report for this very target whose list was read counts', () => {
	const rows: Array<[string, Record<string, string>, string, string]> = [
		['no report', {STUB_REPORTS: '0'}, 'pass', 'unchecked'],
		['two reports', {STUB_REPORTS: '2', STUB_REPORT: JSON.stringify(good)}, 'pass', 'unchecked'],
		['broken JSON', {STUB_REPORT: '{'}, 'pass', 'unchecked'],
		['another tool', {STUB_REPORT: JSON.stringify({...good, tool: 'news/gate'})}, 'pass', 'unchecked'],
		['a report that does not pass', {STUB_REPORT: JSON.stringify({...good, pass: false})}, 'pass', 'unchecked'],
		['another slug', {STUB_REPORT: JSON.stringify({...good, slug: 'other'})}, 'pass', 'unchecked'],
		['another channel', {STUB_REPORT: JSON.stringify({...good, channel: 'zoora-security'})}, 'pass', 'unchecked'],
		['another language', {STUB_REPORT: JSON.stringify({...good, lang: 'es'})}, 'pass', 'unchecked'],
		['--no-names', {STUB_REPORT: JSON.stringify({...good, namesList: {path: null, count: 0, skipped: true}})}, 'pass', 'unchecked'],
		['no list read', {STUB_REPORT: JSON.stringify({...good, namesList: {path: null, count: 0}})}, 'pass', 'unchecked'],
		['skipped with a path', {STUB_REPORT: JSON.stringify({...good, namesList: {path: 'x', count: 3, skipped: true}})}, 'pass', 'unchecked'],
		['an empty list', {STUB_REPORT: JSON.stringify({...good, namesList: {path: 'data/private/names.txt', count: 0}})}, 'pass', 'checked-empty'],
		['the good report', {STUB_REPORT: JSON.stringify(good)}, 'pass', 'checked'],
		// exit 1 FAILS only when the gate's own report says so for this target; anything else could not check it
		['a failing report', {STUB_EXIT: '1', STUB_REPORT: JSON.stringify({...good, pass: false})}, 'fail', 'unchecked'],
		['a crash (exit 1, no report)', {STUB_EXIT: '1', STUB_REPORTS: '0'}, 'error', 'unchecked'],
		['exit 1, a report for another target', {STUB_EXIT: '1', STUB_REPORT: JSON.stringify({...good, pass: false, slug: 'other'})}, 'error', 'unchecked'],
		['bad input (exit 2)', {STUB_EXIT: '2', STUB_REPORTS: '0'}, 'error', 'unchecked'],
	];
	for (const [what, env, status, names] of rows) {
		const r = run('check', env);
		assert.deepEqual([r.status, r.names], [status, names], what);
	}
	// the master-language target (lang null) accepts the storyboard's own language
	const own = run('check', {STUB_REPORT: JSON.stringify(good)}, {...T, lang: null});
	assert.deepEqual([own.status, own.names], ['pass', 'checked']);
	// no gate in the checkout
	assert.deepEqual(spawnGateRunner(join(root, 'nowhere'), parent, {})('claims', T, 'check'), {status: 'missing', names: 'unchecked'});
});

test('two validate processes at the same time on one machine (one temp folder) both pass and both keep their receipts', async () => {
	// A throwaway project that runs the farm's own CLI (copied, so its PROJECT is this folder) with the stub gate.
	const q = join(root, 'cli');
	cpSync(join(REAL_PROJECT, 'scripts/farm'), join(q, 'scripts/farm'), {recursive: true, filter: (src) => !src.includes(`${join('scripts', 'farm', 'tests')}`)});
	for (const f of ['names.ts', 'text.ts']) cpSync(join(REAL_PROJECT, 'scripts/claims/lib', f), join(q, 'scripts/claims/lib', f));
	put(q, 'scripts/claims/check.ts', STUB);
	put(q, 'scripts/claims/package.json', '{"type": "module"}\n');
	put(q, '.gitignore', 'data/\n');
	put(q, 'src/episode/index.ts', '');
	put(q, 'scripts/farm/keys/owner.pub.pem', generateKeyPairSync('rsa', {modulusLength: 3072}).publicKey.export({type: 'spki', format: 'pem'}) as string);
	put(q, 'data/private/names.txt', '# invented names only\nTesty McFakename\n');
	for (const slug of ['a', 'b']) {
		put(q, `content/zoora-ai/${slug}/storyboard.json`, '{"lang": "en"}\n');
		put(q, `render-requests/${slug}.json`, JSON.stringify({id: slug, entry: 'src/episode/index.ts', jobs: [{composition: 'Episode', kind: 'video', output: `out/${slug}.mp4`, props: {channel: 'zoora-ai', slug, lang: 'en'}}]}));
	}
	const gitEnv = {...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid'};
	const git = (...args: string[]) => execFileSync('git', args, {cwd: q, env: gitEnv, encoding: 'utf8'});
	git('init', '-q', '-b', 'main');
	git('add', '-A');
	git('commit', '-q', '-m', 'base');
	const shared = join(root, 'shared-tmp');
	mkdirSync(shared, {recursive: true});
	const env = {...process.env, TMPDIR: shared, STUB_SLEEP_MS: '400'};
	const validate = (slug: string, report: object) =>
		new Promise<{code: number | null; err: string}>((done) => {
			const c = spawn(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', 'scripts/farm/farm.ts', 'validate', `render-requests/${slug}.json`], {cwd: q, env: {...env, STUB_REPORT: JSON.stringify(report)}, stdio: ['ignore', 'pipe', 'pipe']});
			let err = '';
			c.stderr.on('data', (b) => (err += String(b)));
			c.on('close', (code) => done({code, err}));
		});
	const reportFor = (slug: string) => ({...good, slug});
	const [a, b] = await Promise.all([validate('a', reportFor('a')), validate('b', reportFor('b'))]);
	assert.equal(a.code, 0, a.err);
	assert.equal(b.code, 0, b.err);
	for (const slug of ['a', 'b']) assert.ok(existsSync(join(q, `render-requests/receipts/${slug}.json`)), `${slug}: its receipt`);
	assert.deepEqual(readdirSync(shared).filter((f) => f.startsWith('farm-gate-')), [], 'no report folder left behind');
});
