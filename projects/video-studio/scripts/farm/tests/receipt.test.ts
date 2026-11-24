// node --test scripts/farm/tests/receipt.test.ts   (needs git; the last test runs the real claim gate)
// Gate receipts (receipt.ts). The claim gate needs the private names list, which never reaches CI: local `validate`
// runs it WITH the list and writes render-requests/receipts/<id>.json; the plan job runs it with --no-names and
// requires that receipt to match the request file and every script folder exactly. First a throwaway git project with
// a fake gate runner (validate, plan from a real push, stale, partial, tampered and missing receipts), then the real
// claim gate on its own test fixture with an invented names list.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {generateKeyPairSync} from 'node:crypto';
import {cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {after, test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {HANDOFF_ENV} from '../crypto.ts';
import {cmdPlan, cmdValidate, type Ctx} from '../farm.ts';
import {gateTargets, type GateRunner, type GateTarget} from '../gates.ts';
import {buildReceipt, contentFiles, contentSha256, receiptDigest, receiptPath, serializeReceipt, sha256Hex, verifyReceipt, type Receipt} from '../receipt.ts';
import {parseRequest} from '../request.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL_PROJECT = join(HERE, '..', '..', '..');
const KEY = 'h4ndoff-For-Tests-Only-0123456789-abcdefghij+/=';
const OWNER_PEM = generateKeyPairSync('rsa', {modulusLength: 3072}).publicKey.export({type: 'spki', format: 'pem'}) as string;
/** An invented private names list (never real people). Nothing of it may reach a receipt. */
const NAMES = '# invented names only\nTesty McFakename\n@fakehandle123\n';
const NARRATION = 'SCRIPT-TEXT: Zoo follows the money';
const RECEIPT = receiptPath('ep');
const TOP_KEYS = ['claimGate', 'digest', 'kind', 'request', 'requestSha256', 'schema', 'targets', 'validatedAt'];
const TARGET_KEYS = ['channel', 'claims', 'contentSha256', 'lang', 'names', 'slug'];

const root = mkdtempSync(join(tmpdir(), 'farm-receipt-'));
after(() => rmSync(root, {recursive: true, force: true}));
const p = join(root, 'project');

const gitEnv = {...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid'};
const git = (...args: string[]) => execFileSync('git', args, {cwd: p, encoding: 'utf8', env: gitEnv}).trim();
const put = (project: string, rel: string, data: string | Buffer | object) => {
	mkdirSync(dirname(join(project, rel)), {recursive: true});
	writeFileSync(join(project, rel), typeof data === 'string' || Buffer.isBuffer(data) ? data : `${JSON.stringify(data, null, 2)}\n`);
};

/** The claim gates as these tests see them: every target passes unless listed in `failing` ("channel/slug/lang"). */
const calls: string[] = [];
let failing = new Set<string>();
const fakeGates: GateRunner = (gate, t: GateTarget, names) => {
	const key = `${t.channel}/${t.slug}/${t.lang ?? '*'}`;
	calls.push(`${gate}:${key}:${names}`);
	const status = failing.has(key) ? 'fail' : 'pass';
	return {status, names: gate === 'claims' && status === 'pass' && names === 'check' ? 'checked' : 'unchecked'};
};

let n = 0;
const harness = (project: string, env: Record<string, string> = {}, runGate: GateRunner | null = fakeGates) => {
	const dir = join(root, `job-${n++}`);
	mkdirSync(dir, {recursive: true});
	const out = join(dir, 'github_output');
	const sum = join(dir, 'step_summary');
	writeFileSync(out, '');
	writeFileSync(sum, '');
	const logs: string[] = [];
	const ctx: Ctx = {
		project,
		env: {PATH: process.env.PATH, HOME: process.env.HOME, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: sum, ...env},
		temp: join(dir, 'farm'),
		log: (m) => logs.push(m),
		...(runGate ? {runGate} : {}),
	};
	return {
		ctx,
		logs,
		outputs: (): Record<string, string> => Object.fromEntries(readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])),
		summary: () => readFileSync(sum, 'utf8'),
	};
};

/** Runs a command step with the console silenced; returns what it printed to stderr and what it threw. */
const step = (fn: () => void): {threw: Error | null; err: string} => {
	const errs: string[] = [];
	const [log, error] = [console.log, console.error];
	console.log = () => {};
	console.error = (m: unknown) => errs.push(String(m));
	try {
		fn();
		return {threw: null, err: errs.join('\n')};
	} catch (e) {
		return {threw: e as Error, err: errs.join('\n')};
	} finally {
		console.log = log;
		console.error = error;
	}
};

// ---- the project: a request with an English master, a Spanish dub, a Spanish video and a thumbnail ------------------

const request = {
	id: 'ep',
	entry: 'src/episode/index.ts',
	retentionDays: 7,
	voice: [
		{channel: 'zoora-ai', slug: 'ep', lang: 'en', voice: 'im_nicola'},
		{channel: 'zoora-ai', slug: 'ep', lang: 'es', voice: 'im_nicola', fitTo: 'en'},
	],
	jobs: [
		{composition: 'Episode', kind: 'video', output: 'out/ep/es.mp4', props: {channel: 'zoora-ai', slug: 'ep', lang: 'es'}},
		{composition: 'Thumbnail', kind: 'still', output: 'out/ep/thumb.png', props: {channel: 'zoora-ai', slug: 'ep'}},
	],
};

mkdirSync(p, {recursive: true});
git('init', '-q', '-b', 'main');
put(p, '.gitignore', 'data/\n*.tmp\n');
put(p, 'src/episode/index.ts', '');
put(p, 'scripts/voice/setup.sh', readFileSync(join(REAL_PROJECT, 'scripts/voice/setup.sh'), 'utf8'));
put(p, 'scripts/farm/keys/owner.pub.pem', OWNER_PEM);
put(p, 'content/zoora-ai/ep/storyboard.json', {version: 1, channel: 'zoora-ai', slug: 'ep', lang: 'en', narration: NARRATION});
put(p, 'content/zoora-ai/ep/storyboard.es.json', {version: 1, channel: 'zoora-ai', slug: 'ep', lang: 'es', narration: 'TEXTO: Zoo sigue el dinero'});
put(p, 'content/zoora-ai/ep/research.md', '# Research\n\n## Must not say\n\n- [named person] by name\n');
put(p, 'content/zoora-ai/ep/dub/sheet.es.json', {lang: 'es'});
put(p, 'data/private/names.txt', NAMES);
git('add', '-A');
git('commit', '-q', '-m', 'base');
const base = git('rev-parse', 'HEAD');

// The owner, before the push: write the request, validate it (the receipt appears), commit both.
put(p, 'render-requests/ep.json', request);
calls.length = 0;
const first = harness(p);
cmdValidate(first.ctx, [join(p, 'render-requests/ep.json')]);
const validateCalls = [...calls];
git('add', '-A');
git('commit', '-q', '-m', 'request ep with its gate receipt');
const head = git('rev-parse', 'HEAD');

const requestBytes = () => readFileSync(join(p, 'render-requests/ep.json'));
const targetsOf = (): GateTarget[] => {
	const v = parseRequest(requestBytes().toString('utf8'), 'ep');
	assert.ok(v.ok);
	return gateTargets(v.request).targets;
};
const readReceiptJson = (): Receipt => JSON.parse(readFileSync(join(p, RECEIPT), 'utf8'));
const writeReceiptJson = (r: unknown, text?: string) => writeFileSync(join(p, RECEIPT), text ?? `${JSON.stringify(r, null, 2)}\n`);

/** Replaces a file for the length of fn (null removes it), then puts the original back. */
const withFile = (rel: string, content: string | Buffer | null, fn: () => void) => {
	const path = join(p, rel);
	const old = existsSync(path) ? readFileSync(path) : null;
	if (content === null) rmSync(path, {force: true});
	else put(p, rel, content);
	try {
		fn();
	} finally {
		if (old === null) rmSync(path, {force: true});
		else writeFileSync(path, old);
	}
};
/** The same bytes with one byte changed (the first "e" becomes "E"). */
const oneByte = (rel: string): Buffer => {
	const b = Buffer.from(readFileSync(join(p, rel)));
	const i = b.indexOf(0x65);
	assert.ok(i >= 0, rel);
	b[i] = 0x45;
	return b;
};

/** The plan job for the push base..head (CI: GITHUB_ACTIONS is not set, so problems go to stderr and the summary). */
const plan = (before = base, after = head) => {
	const h = harness(p, {FARM_EVENT: 'push', FARM_BEFORE: before, FARM_HEAD: after, [HANDOFF_ENV]: KEY});
	const r = step(() => cmdPlan(h.ctx));
	const lines = h.summary().split('\n').filter((l) => l.startsWith('- render-requests/ep.json:'));
	return {...h, ...r, lines};
};
/** The plan must refuse ep, with exactly one line for it that names the fix. */
const refused = (re: RegExp) => {
	const r = plan();
	assert.ok(r.threw, 'the plan accepted the request');
	assert.equal(r.lines.length, 1, r.summary());
	assert.match(r.lines[0], re);
	assert.match(
		r.lines[0],
		/\. CI checks scripts without the private names list, so run "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts\/farm\/farm\.ts validate render-requests\/ep\.json" on your computer \(it needs data\/private\/names\.txt\) and commit the render-requests\/receipts\/ep\.json it writes with the request$/,
	);
	assert.deepEqual(r.outputs(), {}, 'nothing may render');
	for (const text of [r.summary(), r.err]) assert.ok(!text.includes('SCRIPT-TEXT') && !text.includes('Testy'), 'gate output or private data reached the log');
	return r;
};

// ---- validate (local) ----------------------------------------------------------------------------------------------

test('validate writes the receipt: the request and every script folder by sha256, each target passed with names checked, nothing private', () => {
	assert.ok(validateCalls.length > 0 && validateCalls.every((c) => c.endsWith(':check')), 'validate runs the claim gate WITH the names list');
	assert.match(first.logs.join('\n'), /ep\.json: ok \(2 job\(s\), 2 voice incl\. 1 dub\(s\), encrypted to "owner", kept 7 days; 3 gate check\(s\) pass, private names checked\); gate receipt render-requests\/receipts\/ep\.json written: commit it with the request/);
	const text = readFileSync(join(p, RECEIPT), 'utf8');
	const r: Receipt = JSON.parse(text);
	assert.deepEqual(Object.keys(r).sort(), TOP_KEYS);
	assert.deepEqual([r.kind, r.schema, r.request], ['zoora-farm-gate-receipt', 1, 'ep']);
	assert.equal(r.requestSha256, sha256Hex(requestBytes()));
	assert.match(r.validatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
	assert.deepEqual(Object.keys(r.claimGate).sort(), ['commit', 'uncommitted']);
	assert.ok(r.claimGate.commit === null || /^[0-9a-f]{40}$/.test(r.claimGate.commit));
	const content = contentSha256(p, 'content/zoora-ai/ep');
	assert.deepEqual(
		r.targets.map((t) => [t.channel, t.slug, t.lang, t.claims, t.names, t.contentSha256]),
		[null, 'en', 'es'].map((lang) => ['zoora-ai', 'ep', lang, 'pass', 'checked', content]),
		'every gate target (the thumbnail checks the master language), sorted',
	);
	for (const t of r.targets) assert.deepEqual(Object.keys(t).sort(), TARGET_KEYS);
	assert.equal(r.digest, receiptDigest(r));
	for (const secret of ['Testy', 'McFakename', 'fakehandle123', 'names.txt', sha256Hex(NAMES), NARRATION, 'SCRIPT-TEXT']) assert.ok(!text.includes(secret), `the receipt holds ${secret}`);
	assert.equal(git('ls-files', 'data'), '', 'the names list is never committed');
	assert.equal(git('show', '--name-only', '--format=', 'HEAD'), 'render-requests/ep.json\nrender-requests/receipts/ep.json');
});

test('content hash: sorted relative paths and per-file sha256, without the files git ignores (CI never has them)', () => {
	assert.deepEqual(contentFiles(p, 'content/zoora-ai/ep'), ['dub/sheet.es.json', 'research.md', 'storyboard.es.json', 'storyboard.json']);
	const before = contentSha256(p, 'content/zoora-ai/ep');
	withFile('content/zoora-ai/ep/draft.tmp', 'ignored scratch', () => {
		assert.ok(!contentFiles(p, 'content/zoora-ai/ep').includes('draft.tmp'));
		assert.equal(contentSha256(p, 'content/zoora-ai/ep'), before);
	});
	withFile('content/zoora-ai/ep/notes.md', 'a new file', () => assert.notEqual(contentSha256(p, 'content/zoora-ai/ep'), before));
	// renaming a file changes the hash even when the bytes stay the same
	renameSync(join(p, 'content/zoora-ai/ep/research.md'), join(p, 'content/zoora-ai/ep/research2.md'));
	try {
		assert.notEqual(contentSha256(p, 'content/zoora-ai/ep'), before);
	} finally {
		renameSync(join(p, 'content/zoora-ai/ep/research2.md'), join(p, 'content/zoora-ai/ep/research.md'));
	}
	assert.equal(contentSha256(p, 'content/zoora-ai/ep'), before);
});

test('validate again leaves a matching receipt byte for byte (no diff to commit) and rewrites it when a script changes', () => {
	const bytes = readFileSync(join(p, RECEIPT));
	const again = harness(p);
	cmdValidate(again.ctx, [join(p, 'render-requests/ep.json')]);
	assert.match(again.logs.join('\n'), /gate receipt render-requests\/receipts\/ep\.json unchanged/);
	assert.deepEqual(readFileSync(join(p, RECEIPT)), bytes);
	withFile('content/zoora-ai/ep/storyboard.es.json', oneByte('content/zoora-ai/ep/storyboard.es.json'), () => {
		const edited = harness(p);
		cmdValidate(edited.ctx, [join(p, 'render-requests/ep.json')]);
		assert.match(edited.logs.join('\n'), /gate receipt render-requests\/receipts\/ep\.json written/);
		assert.notEqual(readReceiptJson().targets[0].contentSha256, JSON.parse(bytes.toString('utf8')).targets[0].contentSha256);
	});
	writeFileSync(join(p, RECEIPT), bytes);
});

test('validate: a request that fails loses its receipt; a computer without the names list fails and changes no receipt', () => {
	const bytes = readFileSync(join(p, RECEIPT));
	try {
		// no names list here: refused before any gate runs, and the receipt stays as it was
		withFile('data/private/names.txt', null, () => {
			calls.length = 0;
			const r = step(() => cmdValidate(harness(p).ctx, [join(p, 'render-requests/ep.json')]));
			assert.match(String(r.threw), /1 request file\(s\) did not pass: do not push them/);
			assert.match(r.err, /data\/private\/names\.txt is not on this computer: validate checks every script against the private names list before it writes the gate receipt CI requires\. .*receipts were left as they are/);
			assert.deepEqual(calls, []);
			assert.deepEqual(readFileSync(join(p, RECEIPT)), bytes);
		});
		// a failing script: the receipt is removed, so the old pass cannot be pushed
		failing = new Set(['zoora-ai/ep/es']);
		const r = step(() => cmdValidate(harness(p).ctx, [join(p, 'render-requests/ep.json')]));
		assert.ok(r.threw);
		assert.match(r.err, /zoora-ai\/ep \(es\): the claim gate FAILS/);
		assert.match(r.err, /removed render-requests\/receipts\/ep\.json: this request no longer passes; do not push it until validate passes again/);
		assert.ok(!existsSync(join(p, RECEIPT)));
	} finally {
		failing = new Set();
		writeFileSync(join(p, RECEIPT), bytes);
	}
});

test('validate refuses to run in GitHub Actions (the names list never goes there); a draft outside render-requests/ gets no receipt', () => {
	const h = harness(p, {GITHUB_ACTIONS: 'true'});
	assert.throws(() => cmdValidate(h.ctx, [join(p, 'render-requests/ep.json')]), /validate runs on your own computer before the push/);
	const bytes = readFileSync(join(p, RECEIPT));
	const draft = join(root, 'drafts', 'ep.json');
	mkdirSync(dirname(draft), {recursive: true});
	writeFileSync(draft, requestBytes());
	const d = harness(p);
	cmdValidate(d.ctx, [draft]);
	assert.match(d.logs.join('\n'), /no gate receipt \(only render-requests\/<id>\.json gets one\): copy the file there and validate it there/);
	assert.ok(!existsSync(join(root, 'drafts', 'receipts')));
	assert.deepEqual(readFileSync(join(p, RECEIPT)), bytes);
});

test('validate refuses a script folder that holds a symbolic link (a receipt binds contents), and the plan does too', () => {
	const bytes = readFileSync(join(p, RECEIPT));
	const link = join(p, 'content/zoora-ai/ep/linked.json');
	symlinkSync(join(p, 'content/zoora-ai/ep/storyboard.json'), link);
	try {
		assert.throws(() => contentFiles(p, 'content/zoora-ai/ep'), /content\/zoora-ai\/ep\/linked\.json is a symbolic link/);
		refused(/^- render-requests\/ep\.json: content\/zoora-ai\/ep\/linked\.json is a symbolic link: a gate receipt binds file contents/);
		const r = step(() => cmdValidate(harness(p).ctx, [join(p, 'render-requests/ep.json')]));
		assert.ok(r.threw);
		assert.match(r.err, /linked\.json is a symbolic link/);
	} finally {
		rmSync(link, {force: true});
		writeFileSync(join(p, RECEIPT), bytes);
	}
});

// ---- plan (CI) -------------------------------------------------------------------------------------------------------

test('CI accepts a matching receipt: every claim gate runs with --no-names, and the summary says where names were checked', () => {
	calls.length = 0;
	const r = plan();
	assert.equal(r.threw, null, r.err);
	assert.ok(calls.length > 0 && calls.every((c) => c.endsWith(':skip')), 'CI runs every claim gate with --no-names');
	assert.equal(r.outputs().render_count, '2');
	assert.match(r.summary(), /Private names were checked on the owner's computer before the push \(gate receipts match\): ep \(3 script\(s\), validated \d{4}-/);
	// a JSON formatter cannot break a receipt: key order and whitespace are not part of its digest
	const bytes = readFileSync(join(p, RECEIPT));
	const rec = readReceiptJson();
	const reordered = Object.fromEntries(Object.entries(rec).reverse());
	writeReceiptJson(null, `${JSON.stringify(reordered, null, 4)}\n`);
	try {
		assert.equal(plan().threw, null);
	} finally {
		writeFileSync(join(p, RECEIPT), bytes);
	}
});

test('CI refuses a request with no receipt, in one line that says to validate locally and commit the receipt', () => {
	withFile(RECEIPT, null, () => {
		const r = refused(/^- render-requests\/ep\.json: no gate receipt \(render-requests\/receipts\/ep\.json\)\. CI checks/);
		assert.match(r.err, /farm: render-requests\/ep\.json: no gate receipt/);
	});
});

test('CI refuses a stale receipt: one byte changed in storyboard.json, research.md, a dub file, or the request itself', () => {
	for (const rel of ['content/zoora-ai/ep/storyboard.json', 'content/zoora-ai/ep/research.md', 'content/zoora-ai/ep/dub/sheet.es.json']) {
		withFile(rel, oneByte(rel), () => refused(/^- render-requests\/ep\.json: the gate receipt render-requests\/receipts\/ep\.json is stale: content\/zoora-ai\/ep changed after validate wrote it\./));
	}
	withFile('content/zoora-ai/ep/new-scene.md', 'added after validate', () => refused(/is stale: content\/zoora-ai\/ep changed after validate wrote it/));
	withFile('content/zoora-ai/ep/storyboard.es.json', null, () => refused(/is stale: content\/zoora-ai\/ep changed/));
	// one byte of the request, still a valid request (retentionDays 7 -> 8)
	const req = requestBytes().toString('utf8');
	assert.ok(req.includes('"retentionDays": 7,'));
	withFile('render-requests/ep.json', req.replace('"retentionDays": 7,', '"retentionDays": 8,'), () => refused(/the gate receipt render-requests\/receipts\/ep\.json is stale: the request file changed after validate wrote it/));
	// a file git ignores is never committed, so CI never has it: it does not make the receipt stale
	withFile('content/zoora-ai/ep/scratch.tmp', 'local only', () => assert.equal(plan().threw, null));
	assert.equal(plan().threw, null, 'restored: the receipt matches again');
});

test('CI refuses a receipt that does not cover every gate target of the request', () => {
	const partial = buildReceipt({project: p, id: 'ep', requestBytes: requestBytes(), targets: targetsOf().filter((t) => t.lang !== 'es'), claimGate: {commit: null, uncommitted: false}, now: new Date()});
	withFile(RECEIPT, serializeReceipt(partial), () => refused(/^- render-requests\/ep\.json: the gate receipt render-requests\/receipts\/ep\.json does not cover zoora-ai\/ep \(es\)\./));
	const wider = buildReceipt({project: p, id: 'ep', requestBytes: requestBytes(), targets: [...targetsOf(), {channel: 'zoora-ai', slug: 'ep', lang: 'pt-br'}], claimGate: {commit: null, uncommitted: false}, now: new Date()});
	withFile(RECEIPT, serializeReceipt(wider), () => refused(/lists scripts this request does not gate \(zoora-ai\/ep \(pt-br\)\)/));
});

test('CI refuses tampered receipts: hand edits, forged hashes, unknown fields, another request, broken JSON', () => {
	const good = readReceiptJson();
	const edit = (fn: (r: Receipt & Record<string, unknown>) => void, redigest: boolean): string => {
		const r = structuredClone(good) as Receipt & Record<string, unknown>;
		fn(r);
		if (redigest) r.digest = receiptDigest(r);
		return `${JSON.stringify(r, null, 2)}\n`;
	};
	const cases: Array<[string, string, RegExp]> = [
		['a hash edited by hand', edit((r) => (r.targets[0].contentSha256 = contentSha256(p, 'content/zoora-ai/ep').replace(/^./, '0')), false), /was changed after validate wrote it \(its digest does not match\)/],
		['validatedAt edited by hand', edit((r) => (r.validatedAt = '2030-01-01T00:00:00.000Z'), false), /its digest does not match/],
		['a forged content hash with a recomputed digest', edit((r) => (r.targets[1].contentSha256 = sha256Hex('forged')), true), /is stale: content\/zoora-ai\/ep changed after validate wrote it/],
		['names not checked', edit((r) => ((r.targets[0] as unknown as Record<string, unknown>).names = 'skipped'), true), /is not one validate writes \(targets\[0\]\.names\)/],
		['a failed claim gate', edit((r) => ((r.targets[2] as unknown as Record<string, unknown>).claims = 'fail'), true), /is not one validate writes \(targets\[2\]\.claims\)/],
		['an extra field', edit((r) => (r.namesCount = 2), true), /is not one validate writes \(its fields must be exactly kind, schema, request, requestSha256, validatedAt, claimGate, targets, digest\)/],
		['a repeated target', edit((r) => (r.targets = [r.targets[0], r.targets[0], r.targets[2]]), true), /is not one validate writes \(targets\[1\] \(a repeated target\)\)/],
		['another request', edit((r) => (r.request = 'other'), true), /the gate receipt render-requests\/receipts\/ep\.json is for another request/],
		['a newer schema', edit((r) => ((r as unknown as Record<string, unknown>).schema = 2), true), /is not one validate writes \(schema \(this farm reads schema 1\)\)/],
		['broken JSON (a half-resolved merge)', '<<<<<<< ours\n{}\n=======\n{}\n>>>>>>> theirs\n', /the gate receipt render-requests\/receipts\/ep\.json is not valid JSON/],
	];
	for (const [what, text, re] of cases) {
		withFile(RECEIPT, text, () => {
			const r = refused(re);
			assert.ok(r.lines[0].length < 600, `${what}: one short line`);
		});
	}
	assert.equal(plan().threw, null);
});

test('plan ignores the receipt path: a push that changes only a receipt renders nothing', () => {
	const later = buildReceipt({project: p, id: 'ep', requestBytes: requestBytes(), targets: targetsOf(), claimGate: {commit: null, uncommitted: false}, now: new Date('2026-11-25T00:00:00Z')});
	writeFileSync(join(p, RECEIPT), serializeReceipt(later));
	git('add', '-A');
	git('commit', '-q', '-m', 'receipt only');
	const receiptOnly = git('rev-parse', 'HEAD');
	calls.length = 0;
	const r = plan(head, receiptOnly);
	assert.equal(r.threw, null, r.err);
	assert.deepEqual(calls, [], 'no request, so no gate ran');
	assert.equal(r.outputs().render_count, '0');
	assert.match(r.summary(), /Gate receipts changed: 1 \(a receipt is not a request: it never starts a render\)/);
	assert.match(r.summary(), /No added or modified request files: nothing to render/);
	assert.equal(verifyReceipt(p, 'ep', requestBytes(), targetsOf()).ok, true, 'the newer receipt still proves the same content');
});

// ---- the real claim gate ---------------------------------------------------------------------------------------------

test('real claim gate, invented names list: the receipt holds no name, no list hash or count, no report text; CI accepts it; a name slipped into the script is stopped', () => {
	// A project that runs the real scripts/claims (linked) on its own test fixture, with the gate's invented names list.
	const q = join(root, 'real');
	const fixture = join(REAL_PROJECT, 'scripts/claims/tests/fixtures');
	mkdirSync(join(q, 'scripts'), {recursive: true});
	symlinkSync(join(REAL_PROJECT, 'scripts/claims'), join(q, 'scripts/claims'));
	put(q, 'scripts/farm/keys/owner.pub.pem', OWNER_PEM);
	put(q, 'src/episode/index.ts', '');
	cpSync(join(fixture, 'zoora-test/good-episode'), join(q, 'content/zoora-test/good-episode'), {recursive: true});
	const namesText = readFileSync(join(fixture, 'names.txt'), 'utf8');
	put(q, 'data/private/names.txt', namesText);
	const names = namesText.split('\n').map((l) => l.replace(/#.*$/, '').trim()).filter((l) => l.replace(/^@/, '').length >= 3);
	assert.ok(names.length >= 2, 'the fixture lists invented names');
	put(q, 'render-requests/real.json', {
		id: 'real',
		entry: 'src/episode/index.ts',
		jobs: ['en', 'es'].map((lang) => ({composition: 'Episode', kind: 'video', output: `out/real/${lang}.mp4`, props: {channel: 'zoora-test', slug: 'good-episode', lang}})),
	});
	const sb = join(q, 'content/zoora-test/good-episode/storyboard.json');
	const story = JSON.parse(readFileSync(sb, 'utf8')) as {scenes: Array<{narration: string}>};

	const v = harness(q, {}, null);
	const ok = step(() => cmdValidate(v.ctx, [join(q, 'render-requests/real.json')]));
	assert.equal(ok.threw, null, ok.err);
	assert.match(v.logs.join('\n'), /real\.json: ok \(2 job\(s\), 0 voice, encrypted to "owner", kept 7 days; 2 gate check\(s\) pass, private names checked\); gate receipt render-requests\/receipts\/real\.json written/);
	const text = readFileSync(join(q, receiptPath('real')), 'utf8');
	const r: Receipt = JSON.parse(text);
	assert.deepEqual(Object.keys(r).sort(), TOP_KEYS);
	for (const t of r.targets) assert.deepEqual(Object.keys(t).sort(), TARGET_KEYS);
	assert.deepEqual(r.targets.map((t) => [t.lang, t.claims, t.names]), [['en', 'pass', 'checked'], ['es', 'pass', 'checked']]);
	const forbidden = [...names, ...names.map((x) => x.replace(/^@/, '')), ...names.flatMap((x) => x.split(/\s+/)), sha256Hex(namesText), sha256Hex(readFileSync(join(q, 'data/private/names.txt'))), 'names.txt', story.scenes[0].narration.slice(0, 40)];
	for (const s of forbidden) assert.ok(!text.toLowerCase().includes(s.toLowerCase()), `the receipt holds private or script text: ${s}`);
	assert.deepEqual(readdirSync(join(v.ctx.temp, 'gates')), [], 'every gate report (it quotes the script) was deleted after it was read');

	// CI: the real gate with --no-names, and the receipt matches (workflow_dispatch: no git needed)
	const ci = () => {
		const h = harness(q, {FARM_EVENT: 'workflow_dispatch', FARM_DISPATCH_REQUEST: 'real'}, null);
		return {...h, ...step(() => cmdPlan(h.ctx))};
	};
	const accepted = ci();
	assert.equal(accepted.threw, null, accepted.err);
	assert.equal(accepted.outputs().render_count, '2');

	// An invented private name slipped into the script AFTER validate. CI's gate cannot see it (--no-names passes), so
	// only the receipt stops it: stale first; then validate (with the list) fails and removes the receipt.
	const original = readFileSync(sb);
	story.scenes[0].narration += ` ${names[0]} watches.`;
	writeFileSync(sb, JSON.stringify(story, null, 2));
	try {
		const stale = ci();
		assert.ok(stale.threw);
		assert.match(stale.summary(), /- render-requests\/real\.json: the gate receipt render-requests\/receipts\/real\.json is stale: content\/zoora-test\/good-episode changed after validate wrote it\./);
		const local = step(() => cmdValidate(harness(q, {}, null).ctx, [join(q, 'render-requests/real.json')]));
		assert.ok(local.threw);
		assert.match(local.err, /zoora-test\/good-episode \(en\): the claim gate FAILS/);
		assert.match(local.err, /removed render-requests\/receipts\/real\.json/);
		const missing = ci();
		assert.ok(missing.threw);
		assert.match(missing.summary(), /- render-requests\/real\.json: no gate receipt \(render-requests\/receipts\/real\.json\)\. CI checks scripts without the private names list/);
		for (const text2 of [stale.summary(), stale.err, local.err, missing.summary(), missing.err]) assert.ok(!text2.includes(names[0]) && !text2.includes('watches'), 'a name or script text reached the output');
	} finally {
		writeFileSync(sb, original);
	}
	// fixed: validate passes again and writes a receipt that binds the same content as the first
	const again = step(() => cmdValidate(harness(q, {}, null).ctx, [join(q, 'render-requests/real.json')]));
	assert.equal(again.threw, null, again.err);
	const rewritten: Receipt = JSON.parse(readFileSync(join(q, receiptPath('real')), 'utf8'));
	assert.deepEqual(rewritten.targets, r.targets);
	assert.equal(accepted.threw, null);
	assert.equal(ci().threw, null, 'CI accepts the new receipt');
});
