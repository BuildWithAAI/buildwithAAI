// node --test scripts/farm/tests/receipt.test.ts   (needs git; the last tests run the real claim gate)
// Gate receipts (receipt.ts). The claim gate needs the private names list, which never reaches CI: local `validate`
// runs it WITH the list and writes render-requests/receipts/<id>.json; the plan job runs it with --no-names and
// requires that receipt to match the request file, every script folder and the claim gate's code exactly. First a
// throwaway git project with a fake gate runner (validate, plan from a real push, stale, partial, tampered and missing
// receipts, every refusal validate makes before and after the gates, `check`), then a repository laid out like the
// real one with a CRLF owner checkout and a clean CI clone, then the real claim gate on its own test fixture with an
// invented names list.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {generateKeyPairSync} from 'node:crypto';
import {cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {after, test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {HANDOFF_ENV} from '../crypto.ts';
import {cmdCheck, cmdPlan, cmdValidate, NAMES_EMPTY, NAMES_MISSING, receiptFix, type Ctx} from '../farm.ts';
import {gateTargets, type GateRunner, type GateTarget, type NamesResult} from '../gates.ts';
import {
	buildReceipt,
	claimGateCode,
	claimGateFingerprint,
	claimGateVersion,
	contentFiles,
	contentSha256,
	receiptDigest,
	receiptPath,
	requestBlobOf,
	serializeReceipt,
	sha256Hex,
	verifyReceipt,
	type Receipt,
} from '../receipt.ts';
import {parseRequest} from '../request.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL_PROJECT = join(HERE, '..', '..', '..');
const KEY = 'h4ndoff-For-Tests-Only-0123456789-abcdefghij+/=';
const OWNER_PEM = generateKeyPairSync('rsa', {modulusLength: 3072}).publicKey.export({type: 'spki', format: 'pem'}) as string;
/** An invented private names list (never real people). Nothing of it may reach a receipt or a message. */
const NAMES = '# invented names only\nTesty McFakename\n@fakehandle123\n';
const NARRATION = 'SCRIPT-TEXT: Zoo follows the money';
const RECEIPT = receiptPath('ep');
const TOP_KEYS = ['claimGate', 'digest', 'kind', 'request', 'requestBlob', 'schema', 'targets', 'validatedAt'];
const TARGET_KEYS = ['channel', 'claims', 'contentSha256', 'lang', 'names', 'slug'];
const FIX = receiptFix('ep').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const root = mkdtempSync(join(tmpdir(), 'farm-receipt-'));
after(() => rmSync(root, {recursive: true, force: true}));
const p = join(root, 'project');
const gateTemp = join(root, 'gate-temp');

const gitEnv = {...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid'};
const gitIn = (cwd: string, ...args: string[]) => execFileSync('git', args, {cwd, encoding: 'utf8', env: gitEnv}).trim();
const git = (...args: string[]) => gitIn(p, ...args);
const put = (project: string, rel: string, data: string | Buffer | object) => {
	mkdirSync(dirname(join(project, rel)), {recursive: true});
	writeFileSync(join(project, rel), typeof data === 'string' || Buffer.isBuffer(data) ? data : `${JSON.stringify(data, null, 2)}\n`);
};

/** The claim gates as these tests see them: every target passes unless listed in `failing` ("gate/channel/slug/lang"). */
const calls: string[] = [];
let failing = new Set<string>();
let namesVerdict: NamesResult | null = null; // what a passing claim run in check mode proves (default: checked)
let gateHook: ((gate: string, t: GateTarget) => void) | null = null; // runs after each gate: a write while validate runs
const fakeGates: GateRunner = (gate, t: GateTarget, names) => {
	const key = `${t.channel}/${t.slug}/${t.lang ?? '*'}`;
	calls.push(`${gate}:${key}:${names}`);
	const status = failing.has(`${gate}/${key}`) ? 'fail' : 'pass';
	gateHook?.(gate, t);
	return {status, names: gate === 'claims' && status === 'pass' && names === 'check' ? (namesVerdict ?? 'checked') : 'unchecked'};
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
		gateTemp,
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

const validate = (project: string, files: string[], env: Record<string, string> = {}, runGate: GateRunner | null = fakeGates) => {
	const h = harness(project, env, runGate);
	return {...h, ...step(() => cmdValidate(h.ctx, files))};
};
const check = (project: string, files: string[]) => {
	const h = harness(project);
	return {...h, ...step(() => cmdCheck(h.ctx, files))};
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
put(p, 'src/show/index.ts', '');
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

// The owner, before the push: write the request, git add it, validate it (the receipt appears), commit both.
put(p, 'render-requests/ep.json', request);
git('add', 'render-requests/ep.json');
calls.length = 0;
const first = harness(p);
cmdValidate(first.ctx, [join(p, 'render-requests/ep.json')]);
const validateCalls = [...calls];
git('add', '-A');
git('commit', '-q', '-m', 'request ep with its gate receipt');
const head = git('rev-parse', 'HEAD');

/** Puts the project back to the last commit: working tree, index and untracked files (data/ is ignored, so kept). */
const reset = (to = 'HEAD') => {
	git('reset', '-q', '--hard', to);
	git('clean', '-fdq');
	put(p, 'data/private/names.txt', NAMES);
};
const requestBytes = () => readFileSync(join(p, 'render-requests/ep.json'));
const targetsOf = (): GateTarget[] => {
	const v = parseRequest(requestBytes().toString('utf8'), 'ep');
	assert.ok(v.ok);
	return gateTargets(v.request).targets;
};
const readReceiptJson = (): Receipt => JSON.parse(readFileSync(join(p, RECEIPT), 'utf8'));
const gate = () => claimGateVersion(p);

/** Replaces a file for the length of fn (null removes it), staged when asked, then puts the last commit back. */
const withFile = (rel: string, content: string | Buffer | object | null, fn: () => void, stage = false) => {
	if (content === null) rmSync(join(p, rel), {force: true});
	else put(p, rel, content);
	if (stage) git('add', '-A', '--', rel);
	try {
		fn();
	} finally {
		reset();
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
const plan = (before = base, after = head, id = 'ep', env: Record<string, string> = {}) => {
	const h = harness(p, {FARM_EVENT: 'push', FARM_BEFORE: before, FARM_HEAD: after, [HANDOFF_ENV]: KEY, ...env});
	const r = step(() => cmdPlan(h.ctx));
	const lines = h.summary().split('\n').filter((l) => l.startsWith(`- render-requests/${id}.json:`));
	return {...h, ...r, lines};
};
/** The plan must refuse ep, with exactly one line for it that names the fix. */
const refused = (re: RegExp) => {
	const r = plan();
	assert.ok(r.threw, 'the plan accepted the request');
	assert.equal(r.lines.length, 1, r.summary());
	assert.match(r.lines[0], re);
	assert.match(r.lines[0], new RegExp(`\\. ${FIX}$`));
	assert.deepEqual(r.outputs(), {}, 'nothing may render');
	for (const text of [r.summary(), r.err]) assert.ok(!text.includes('SCRIPT-TEXT') && !text.includes('Testy'), 'gate output or private data reached the log');
	return r;
};
/** No output may carry an invented name or script text. */
const clean = (...texts: string[]) => {
	for (const t of texts) for (const s of ['Testy', 'McFakename', 'fakehandle123', 'SCRIPT-TEXT']) assert.ok(!t.includes(s), `a message holds ${s}`);
};

// ---- validate (local) ----------------------------------------------------------------------------------------------

test('validate writes the receipt: the request and every script folder by git blob id, the claim gate by its code, each target passed with names checked, nothing private', () => {
	assert.ok(validateCalls.length > 0 && validateCalls.every((c) => c.endsWith(':check')), 'validate runs the claim gate WITH the names list');
	assert.match(
		first.logs.join('\n'),
		/ep\.json: ok \(2 job\(s\), 2 voice incl\. 1 dub\(s\), encrypted to "owner", kept 7 days; 3 gate check\(s\) pass, private names checked\); gate receipt render-requests\/receipts\/ep\.json written: git add it and commit it together with the request and content\/zoora-ai\/ep, then run farm\.ts check before the push/,
	);
	const text = readFileSync(join(p, RECEIPT), 'utf8');
	const r: Receipt = JSON.parse(text);
	assert.deepEqual(Object.keys(r).sort(), TOP_KEYS);
	assert.deepEqual([r.kind, r.schema, r.request], ['zoora-farm-gate-receipt', 2, 'ep']);
	assert.equal(r.requestBlob, git('rev-parse', 'HEAD:render-requests/ep.json'), 'the request as committed');
	assert.match(r.validatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
	assert.deepEqual(r.claimGate, {commit: null, codeSha256: claimGateFingerprint(p).codeSha256}, 'no claim gate in this project: no commit');
	// the content hash is over the committed blobs: recompute it from the commit alone
	const committed = git('ls-tree', '-r', 'HEAD', '--', 'content/zoora-ai/ep')
		.split('\n')
		.map((l) => /^\d+ blob ([0-9a-f]+)\tcontent\/zoora-ai\/ep\/(.+)$/.exec(l))
		.filter((m): m is RegExpExecArray => m !== null)
		.map((m) => `${m[2]}\0${m[1]}\n`)
		.sort();
	const fromCommit = sha256Hex(`zoora-farm-content-v2\n${committed.join('')}`);
	assert.equal(contentSha256(p, 'content/zoora-ai/ep'), fromCommit);
	assert.deepEqual(
		r.targets.map((t) => [t.channel, t.slug, t.lang, t.claims, t.names, t.contentSha256]),
		[null, 'en', 'es'].map((lang) => ['zoora-ai', 'ep', lang, 'pass', 'checked', fromCommit]),
		'every gate target (the thumbnail checks the master language), sorted',
	);
	for (const t of r.targets) assert.deepEqual(Object.keys(t).sort(), TARGET_KEYS);
	assert.equal(r.digest, receiptDigest(r));
	for (const secret of ['Testy', 'McFakename', 'fakehandle123', 'names.txt', sha256Hex(NAMES), NARRATION, 'SCRIPT-TEXT']) assert.ok(!text.includes(secret), `the receipt holds ${secret}`);
	assert.equal(git('ls-files', 'data'), '', 'the names list is never committed');
	assert.equal(git('show', '--name-only', '--format=', 'HEAD'), 'render-requests/ep.json\nrender-requests/receipts/ep.json');
});

test('content hash: sorted relative paths and git blob ids, files git ignores left out (CI never has them), git required', () => {
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
		reset();
	}
	assert.equal(contentSha256(p, 'content/zoora-ai/ep'), before);
	// line endings: with core.autocrlf, a file re-saved with CRLF hashes as git stores it
	git('config', 'core.autocrlf', 'true');
	try {
		const sb = readFileSync(join(p, 'content/zoora-ai/ep/storyboard.json'), 'utf8');
		writeFileSync(join(p, 'content/zoora-ai/ep/storyboard.json'), sb.replace(/\n/g, '\r\n'));
		assert.equal(contentSha256(p, 'content/zoora-ai/ep'), before, 'CRLF on disk, LF in git: the same hash');
	} finally {
		git('config', '--unset', 'core.autocrlf');
		reset();
	}
	// git is required: without it nothing is hashed (never every file on disk, ignored ones included)
	const path = process.env.PATH;
	process.env.PATH = join(root, 'no-git-here');
	try {
		assert.throws(() => contentSha256(p, 'content/zoora-ai/ep'), /git could not list the files of content\/zoora-ai\/ep \(git must be on PATH/);
	} finally {
		process.env.PATH = path;
	}
});

test('validate again leaves a matching receipt byte for byte (no diff to commit) and rewrites it when a staged script changes', () => {
	const bytes = readFileSync(join(p, RECEIPT));
	const again = validate(p, [join(p, 'render-requests/ep.json')]);
	assert.equal(again.threw, null, again.err);
	assert.match(again.logs.join('\n'), /gate receipt render-requests\/receipts\/ep\.json unchanged/);
	assert.deepEqual(readFileSync(join(p, RECEIPT)), bytes);
	withFile(
		'content/zoora-ai/ep/storyboard.es.json',
		oneByte('content/zoora-ai/ep/storyboard.es.json'),
		() => {
			const edited = validate(p, [join(p, 'render-requests/ep.json')]);
			assert.equal(edited.threw, null, edited.err);
			assert.match(edited.logs.join('\n'), /gate receipt render-requests\/receipts\/ep\.json written/);
			assert.notEqual(readReceiptJson().targets[0].contentSha256, JSON.parse(bytes.toString('utf8')).targets[0].contentSha256);
		},
		true,
	);
	assert.deepEqual(readFileSync(join(p, RECEIPT)), bytes);
});

test('validate binds only what git will commit: untracked files and unstaged edits are refused, staged ones pass, ignored ones do not count', () => {
	const bytes = readFileSync(join(p, RECEIPT));
	// an untracked note (it would be hashed but never committed, or committed unchecked): refused, named, receipt removed
	withFile('content/zoora-ai/ep/notes.md', 'my notes', () => {
		const r = validate(p, [join(p, 'render-requests/ep.json')]);
		assert.ok(r.threw);
		assert.match(r.err, /- not added to git: content\/zoora-ai\/ep\/notes\.md\. A gate receipt binds every file of the request and its script folders that git does not ignore/);
		assert.match(r.err, /removed render-requests\/receipts\/ep\.json/);
		assert.ok(!r.err.includes('my notes'));
	});
	// once it is added to git it is bound (and public with the commit)
	withFile(
		'content/zoora-ai/ep/notes.md',
		'my notes',
		() => {
			const r = validate(p, [join(p, 'render-requests/ep.json')]);
			assert.equal(r.threw, null, r.err);
			assert.match(r.logs.join('\n'), /gate receipt render-requests\/receipts\/ep\.json written/);
		},
		true,
	);
	// an edit git has not staged: what would be committed is not what was checked
	withFile('content/zoora-ai/ep/storyboard.json', oneByte('content/zoora-ai/ep/storyboard.json'), () => {
		const r = validate(p, [join(p, 'render-requests/ep.json')]);
		assert.ok(r.threw);
		assert.match(r.err, /- changed since git add: content\/zoora-ai\/ep\/storyboard\.json\. git add the changes \(or undo them\) and validate again/);
	});
	// a new request that was never added to git
	withFile('render-requests/fresh.json', {...request, id: 'fresh'}, () => {
		const r = validate(p, [join(p, 'render-requests/fresh.json')]);
		assert.ok(r.threw);
		assert.match(r.err, /- not added to git: render-requests\/fresh\.json\./);
		assert.ok(!existsSync(join(p, receiptPath('fresh'))));
	});
	// a file git ignores is never committed: it changes nothing
	withFile('content/zoora-ai/ep/scratch.tmp', 'local only', () => {
		const r = validate(p, [join(p, 'render-requests/ep.json')]);
		assert.equal(r.threw, null, r.err);
		assert.match(r.logs.join('\n'), /gate receipt render-requests\/receipts\/ep\.json unchanged/);
	});
	// no git: nothing can be bound; not a verdict on the request, so the receipt stays
	const path = process.env.PATH;
	process.env.PATH = join(root, 'no-git-here');
	try {
		const r = validate(p, [join(p, 'render-requests/ep.json')]);
		assert.ok(r.threw);
		assert.match(r.err, /git could not find the repository \(git must be on PATH, and the project must be a git checkout: validate inside the repository\); receipts were left as they are/);
		assert.deepEqual(readFileSync(join(p, RECEIPT)), bytes);
	} finally {
		process.env.PATH = path;
	}
	assert.deepEqual(readFileSync(join(p, RECEIPT)), bytes);
});

test('validate: a request that fails loses its receipt, and says when the old one is still in git; a computer without the names list changes no receipt', () => {
	const bytes = readFileSync(join(p, RECEIPT));
	try {
		// no names list here: refused before any gate runs, and the receipt stays as it was
		withFile('data/private/names.txt', null, () => {
			calls.length = 0;
			const r = validate(p, [join(p, 'render-requests/ep.json')]);
			assert.match(String(r.threw), /1 request file\(s\) did not pass: do not push them/);
			assert.match(r.err, /data\/private\/names\.txt is not on this computer: validate checks every script against the private names list before it writes the gate receipt CI requires\. .*receipts were left as they are/);
			assert.ok(r.err.includes(NAMES_MISSING));
			assert.match(r.err, /never create an empty or placeholder list/);
			assert.deepEqual(calls, []);
			assert.deepEqual(readFileSync(join(p, RECEIPT)), bytes);
		});
		// a failing script: the receipt is removed from the working tree; it is still committed, and validate says so
		failing = new Set(['claims/zoora-ai/ep/es']);
		const r = validate(p, [join(p, 'render-requests/ep.json')]);
		assert.ok(r.threw);
		assert.match(r.err, /zoora-ai\/ep \(es\): the claim gate FAILS/);
		assert.match(r.err, /removed render-requests\/receipts\/ep\.json: this request no longer passes; do not push it until validate passes again/);
		assert.match(r.err, /render-requests\/receipts\/ep\.json is still in git \(staged, or in a commit\): git rm --cached it, or amend the commit that holds it, before any push; a push would still carry the old pass, and the plan would accept it/);
		assert.ok(!existsSync(join(p, RECEIPT)));
	} finally {
		failing = new Set();
		reset();
	}
	assert.deepEqual(readFileSync(join(p, RECEIPT)), bytes);
});

test('validate: only a computer that can check names removes a receipt', () => {
	const bytes = readFileSync(join(p, RECEIPT));
	const pem = 'scripts/farm/keys/owner.pub.pem';
	// no names list and no owner key: the request fails, but this computer cannot make the receipt again, so it stays
	rmSync(join(p, 'data/private/names.txt'));
	rmSync(join(p, pem));
	try {
		const r = validate(p, [join(p, 'render-requests/ep.json')]);
		assert.ok(r.threw);
		assert.match(r.err, /recipient "owner": scripts\/farm\/keys\/owner\.pub\.pem is not in this commit/);
		assert.match(r.err, /- data\/private\/names\.txt is not on this computer, so render-requests\/receipts\/ep\.json was left as it is/);
		assert.ok(!r.err.includes('removed'));
		assert.deepEqual(readFileSync(join(p, RECEIPT)), bytes);
	} finally {
		reset();
	}
	// with the list, the same failure removes it (a pass from before must not be pushed)
	rmSync(join(p, pem));
	try {
		const r = validate(p, [join(p, 'render-requests/ep.json')]);
		assert.ok(r.threw);
		assert.match(r.err, /removed render-requests\/receipts\/ep\.json/);
	} finally {
		reset();
	}
});

test('validate refuses an empty names list (it compares nothing): no gate runs, no receipt is written or removed', () => {
	const bytes = readFileSync(join(p, RECEIPT));
	try {
		for (const list of ['# no entries yet\n', '', 'JD\n@ab\n']) {
			put(p, 'data/private/names.txt', list);
			calls.length = 0;
			const r = validate(p, [join(p, 'render-requests/ep.json')]);
			assert.ok(r.threw, JSON.stringify(list));
			assert.ok(r.err.includes(NAMES_EMPTY), r.err);
			assert.deepEqual(calls, [], 'no gate ran');
			assert.ok(!r.logs.join('\n').includes('private names checked'));
			assert.deepEqual(readFileSync(join(p, RECEIPT)), bytes);
		}
		// the gate's own report says the list it read was empty: the same refusal
		put(p, 'data/private/names.txt', NAMES);
		namesVerdict = 'checked-empty';
		const r = validate(p, [join(p, 'render-requests/ep.json')]);
		assert.ok(r.threw);
		assert.ok(r.err.includes(NAMES_EMPTY));
		assert.deepEqual(readFileSync(join(p, RECEIPT)), bytes);
	} finally {
		namesVerdict = null;
		reset();
	}
});

test('validate refuses a passing claim gate that does not prove it checked the names, and removes the receipt', () => {
	namesVerdict = 'unchecked';
	try {
		const r = validate(p, [join(p, 'render-requests/ep.json')]);
		assert.ok(r.threw);
		assert.match(r.err, /zoora-ai\/ep \(en\): the claim gate passed without reporting that it checked data\/private\/names\.txt, so no receipt was written/);
		assert.match(r.err, /removed render-requests\/receipts\/ep\.json/);
	} finally {
		namesVerdict = null;
		reset();
	}
});

test('validate searches every file a receipt binds and the request itself for the private names, and never prints them', () => {
	const cases: Array<[string, string, string | object, RegExp]> = [
		['research.md (the claim gate reads only its Must-not-say list)', 'content/zoora-ai/ep/research.md', '# Research\n\nWho: Testy McFakename\n', /- content\/zoora-ai\/ep\/research\.md holds private name #1: a gate receipt binds every file of the script folder/],
		['a note', 'content/zoora-ai/ep/notes.md', 'ask @fakehandle123 later', /- content\/zoora-ai\/ep\/notes\.md holds private name #2/],
		['a storyboard the request does not render', 'content/zoora-ai/ep/storyboard.hi.json', {lang: 'hi', title: 'Testy McFakename'}, /- content\/zoora-ai\/ep\/storyboard\.hi\.json holds private name #1/],
		['a file name', 'content/zoora-ai/ep/Testy McFakename.md', 'x', /- a file name in content\/zoora-ai\/ep holds private name #1: the commit publishes file names too/],
		['the request props', 'render-requests/ep.json', {...request, jobs: [{...request.jobs[0], props: {...request.jobs[0].props, channelName: 'by Testy McFakename'}}, request.jobs[1]]}, /- render-requests\/ep\.json at jobs\[0\]\.props\.channelName holds private name #1: the request file is public once pushed/],
		['a key of the request', 'render-requests/ep.json', {...request, jobs: [{...request.jobs[0], props: {...request.jobs[0].props, timelineOverride: {'@fakehandle123': 1}}}, request.jobs[1]]}, /- render-requests\/ep\.json at jobs\[0\]\.props\.timelineOverride\[a key\] \(its key\) holds private name #2/],
	];
	for (const [what, rel, content, re] of cases) {
		withFile(
			rel,
			typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`,
			() => {
				calls.length = 0;
				const r = validate(p, [join(p, 'render-requests/ep.json')]);
				assert.ok(r.threw, what);
				assert.match(r.err, re, what);
				assert.deepEqual(calls, [], `${what}: refused before any gate runs`);
				clean(r.err, r.logs.join('\n'));
				assert.ok(!existsSync(join(p, RECEIPT)), `${what}: the old receipt was removed`);
			},
			true,
		);
	}
});

test('validate refuses when a script changes while the gates run: the receipt never binds what no gate read', () => {
	gateHook = (gate, t) => {
		// an editor autosave, a dub import or another agent, after the en gate read the master storyboard
		if (gate === 'claims' && t.lang === 'en') {
			const f = join(p, 'content/zoora-ai/ep/storyboard.json');
			writeFileSync(f, readFileSync(f, 'utf8').replace('follows the money', 'follows Testy McFakename'));
		}
	};
	try {
		const r = validate(p, [join(p, 'render-requests/ep.json')]);
		assert.ok(r.threw);
		assert.match(r.err, /- content\/zoora-ai\/ep changed while validate ran \(after the claim gate read it\), so no gate receipt was written: validate again once nothing is writing to it/);
		assert.ok(!existsSync(join(p, RECEIPT)), 'the old receipt is removed and no new one written');
		clean(r.err);
		gateHook = null;
		// and CI then refuses: no receipt
		const ci = plan();
		assert.ok(ci.threw);
		assert.match(ci.lines[0], /no gate receipt/);
	} finally {
		gateHook = null;
		reset();
	}
});

test('a script folder that holds storyboard.en.json is refused by validate and by the plan (English renders from storyboard.json)', () => {
	withFile(
		'content/zoora-ai/ep/storyboard.en.json',
		{version: 1, channel: 'zoora-ai', slug: 'ep', lang: 'en', narration: 'a clean copy'},
		() => {
			calls.length = 0;
			const r = validate(p, [join(p, 'render-requests/ep.json')]);
			assert.ok(r.threw);
			assert.match(r.err, /content\/zoora-ai\/ep holds storyboard\.en\.json, but English lives in storyboard\.json: the renderers always read storyboard\.json for en/);
			assert.ok(!calls.some((c) => c.startsWith('claims:zoora-ai/ep/')), 'no gate runs on a shadowed folder');
		},
		true,
	);
	withFile('content/zoora-ai/ep/storyboard.en.json', '{}', () => {
		calls.length = 0;
		const r = plan();
		assert.ok(r.threw);
		assert.equal(r.lines.length, 1, r.summary());
		assert.match(r.lines[0], /^- render-requests\/ep\.json: content\/zoora-ai\/ep holds storyboard\.en\.json, but English lives in storyboard\.json/);
		assert.deepEqual(calls, [], 'CI runs no gate on it either');
		assert.deepEqual(r.outputs(), {});
	});
});

test('validate refuses to run in GitHub Actions (the names list never goes there); a draft outside render-requests/ gets no receipt', () => {
	const h = harness(p, {GITHUB_ACTIONS: 'true'});
	assert.throws(() => cmdValidate(h.ctx, [join(p, 'render-requests/ep.json')]), /validate runs on your own computer before the push/);
	const bytes = readFileSync(join(p, RECEIPT));
	const draft = join(root, 'drafts', 'ep.json');
	mkdirSync(dirname(draft), {recursive: true});
	writeFileSync(draft, requestBytes());
	const d = validate(p, [draft]);
	assert.equal(d.threw, null, d.err);
	assert.match(d.logs.join('\n'), /no gate receipt \(only render-requests\/<id>\.json gets one\): copy the file there, git add it with its script folders and validate it there/);
	assert.ok(!existsSync(join(root, 'drafts', 'receipts')));
	assert.deepEqual(readFileSync(join(p, RECEIPT)), bytes);
});

test('validate refuses a script folder that holds a symbolic link (a receipt binds contents), and the plan does too', () => {
	const link = join(p, 'content/zoora-ai/ep/linked.json');
	symlinkSync(join(p, 'content/zoora-ai/ep/storyboard.json'), link);
	try {
		assert.throws(() => contentFiles(p, 'content/zoora-ai/ep'), /content\/zoora-ai\/ep\/linked\.json is a symbolic link/);
		refused(/^- render-requests\/ep\.json: content\/zoora-ai\/ep\/linked\.json is a symbolic link: a gate receipt binds file contents/);
		const r = validate(p, [join(p, 'render-requests/ep.json')]);
		assert.ok(r.threw);
		assert.match(r.err, /linked\.json is a symbolic link/);
	} finally {
		reset();
	}
});

// ---- the claim gate's code -------------------------------------------------------------------------------------------

test('the claim gate code a receipt binds: check.ts and everything it imports at run time; a local edit refuses, a committed change makes old receipts stale', () => {
	const g = join(root, 'gate-project');
	mkdirSync(g, {recursive: true});
	const gg = (...args: string[]) => gitIn(g, ...args);
	gg('init', '-q', '-b', 'main');
	put(g, '.gitignore', 'data/\n');
	put(g, 'src/episode/index.ts', '');
	put(g, 'scripts/farm/keys/owner.pub.pem', OWNER_PEM);
	put(g, 'content/zoora-ai/ep/storyboard.json', {lang: 'en'});
	put(g, 'data/private/names.txt', NAMES);
	put(g, 'scripts/claims/package.json', '{"type": "module"}\n');
	put(g, 'scripts/claims/check.ts', "import type {Lang} from '../../src/episode/types.ts';\nimport {rules} from './lib/rules.ts';\nconst {main} = await import('./lib/cli.ts');\nexport {rules, main};\n");
	put(g, 'scripts/claims/lib/cli.ts', "export {markup} from '../../../src/episode/markup.ts';\nexport const main = () => 0;\n");
	put(g, 'scripts/claims/lib/rules.ts', 'export const rules = 1;\n');
	put(g, 'scripts/claims/lib/unused.ts', 'export const unused = 1;\n');
	put(g, 'src/episode/markup.ts', 'export const markup = 1;\n');
	put(g, 'src/episode/types.ts', 'export type Lang = string;\n');
	gg('add', '-A');
	gg('commit', '-q', '-m', 'base');
	assert.deepEqual(claimGateCode(g), ['scripts/claims/check.ts', 'scripts/claims/lib/cli.ts', 'scripts/claims/lib/rules.ts', 'scripts/claims/package.json', 'src/episode/markup.ts'], 'type-only and unused files are not the gate');
	put(g, 'render-requests/ep.json', {id: 'ep', entry: 'src/episode/index.ts', jobs: [{composition: 'Episode', kind: 'video', output: 'out/ep.mp4', props: {channel: 'zoora-ai', slug: 'ep', lang: 'en'}}]});
	gg('add', '-A');
	const req = join(g, 'render-requests/ep.json');
	const v1 = validate(g, [req]);
	assert.equal(v1.threw, null, v1.err);
	const r1: Receipt = JSON.parse(readFileSync(join(g, receiptPath('ep')), 'utf8'));
	assert.deepEqual(r1.claimGate, {commit: gg('log', '-1', '--format=%H', '--', ...claimGateCode(g)), codeSha256: claimGateFingerprint(g).codeSha256});
	gg('add', '-A');
	gg('commit', '-q', '-m', 'request');
	// a commit that does not touch the gate leaves the receipt as it is
	put(g, 'notes.txt', 'unrelated');
	gg('add', '-A');
	gg('commit', '-q', '-m', 'unrelated');
	assert.match(validate(g, [req]).logs.join('\n'), /gate receipt render-requests\/receipts\/ep\.json unchanged/);
	// an uncommitted edit to a file the gate imports (outside scripts/claims): no receipt, and the old one stays
	const before = readFileSync(join(g, receiptPath('ep')));
	put(g, 'src/episode/markup.ts', 'export const markup = 2; // work in progress\n');
	const dirty = validate(g, [req]);
	assert.ok(dirty.threw);
	assert.match(dirty.err, /the claim gate's code has uncommitted changes \(src\/episode\/markup\.ts\): a receipt must come from committed gate code, so no gate receipt was written\. Commit or stash those changes and validate again; receipts were left as they are/);
	assert.deepEqual(readFileSync(join(g, receiptPath('ep'))), before);
	// committed: the old receipt no longer matches the gate's code, in the plan and in check
	gg('add', '-A');
	gg('commit', '-q', '-m', 'gate change');
	const ci = harness(g, {FARM_EVENT: 'workflow_dispatch', FARM_DISPATCH_REQUEST: 'ep'});
	const stalePlan = step(() => cmdPlan(ci.ctx));
	assert.ok(stalePlan.threw);
	assert.match(ci.summary(), /- render-requests\/ep\.json: the gate receipt render-requests\/receipts\/ep\.json was written by claim gate code that differs from this commit's/);
	const staleCheck = check(g, [req]);
	assert.ok(staleCheck.threw);
	assert.match(staleCheck.err, /was written by claim gate code that differs from this commit's/);
	// validate again: a new receipt for the new gate code and its commit, which the plan accepts
	const v2 = validate(g, [req]);
	assert.equal(v2.threw, null, v2.err);
	assert.match(v2.logs.join('\n'), /gate receipt render-requests\/receipts\/ep\.json written/);
	const r2: Receipt = JSON.parse(readFileSync(join(g, receiptPath('ep')), 'utf8'));
	assert.notEqual(r2.claimGate.codeSha256, r1.claimGate.codeSha256);
	assert.equal(r2.claimGate.commit, gg('rev-parse', 'HEAD'));
	gg('add', '-A');
	gg('commit', '-q', '-m', 'receipt for the new gate');
	const ok = harness(g, {FARM_EVENT: 'workflow_dispatch', FARM_DISPATCH_REQUEST: 'ep'});
	assert.equal(step(() => cmdPlan(ok.ctx)).threw, null, ok.summary());
	assert.equal(check(g, [req]).threw, null);
	// a hand-edited gate record shows
	const edited = {...r2, claimGate: {...r2.claimGate, commit: 'abc'}};
	assert.equal(verifyReceipt(g, 'ep', readFileSync(req), [{channel: 'zoora-ai', slug: 'ep', lang: 'en'}]).ok, true);
	writeFileSync(join(g, receiptPath('ep')), JSON.stringify({...edited, digest: receiptDigest(edited)}));
	const shape = verifyReceipt(g, 'ep', readFileSync(req), [{channel: 'zoora-ai', slug: 'ep', lang: 'en'}]);
	assert.ok(!shape.ok && /is not one validate writes \(claimGate\)/.test(shape.problem));
});

// ---- plan (CI) -------------------------------------------------------------------------------------------------------

test('CI accepts a matching receipt: every claim gate runs with --no-names, and the summary says what a receipt records, not where', () => {
	calls.length = 0;
	const r = plan();
	assert.equal(r.threw, null, r.err);
	assert.ok(calls.length > 0 && calls.every((c) => c.endsWith(':skip')), 'CI runs every claim gate with --no-names');
	assert.equal(r.outputs().render_count, '2');
	assert.match(
		r.summary(),
		/Gate receipts match \(each records that validate passed the claim gate with the private names list on exactly this request and these scripts; CI cannot check the names itself, and a receipt is evidence, not a signature\): ep \(3 script\(s\), validated \d{4}-/,
	);
	assert.ok(!r.summary().includes("owner's computer"));
	// a JSON formatter cannot break a receipt: key order and whitespace are not part of its digest
	const rec = readReceiptJson();
	const reordered = Object.fromEntries(Object.entries(rec).reverse());
	writeFileSync(join(p, RECEIPT), `${JSON.stringify(reordered, null, 4)}\n`);
	try {
		assert.equal(plan().threw, null);
	} finally {
		reset();
	}
});

test('CI refuses a request with no receipt, in one line whose fix changes the request too (a receipt alone starts no run)', () => {
	withFile(RECEIPT, null, () => {
		const r = refused(/^- render-requests\/ep\.json: no gate receipt \(render-requests\/receipts\/ep\.json\)\. CI checks/);
		assert.match(r.err, /farm: render-requests\/ep\.json: no gate receipt/);
		assert.match(r.lines[0], /change the request \(for example retentionDays\), git add it and its script folders, run "node scripts\/farm\/farm\.ts validate render-requests\/ep\.json", then commit the request, its receipt and those folders together \(a push of receipts or content\/ alone starts no run\)$/);
	});
});

test('CI refuses a stale receipt: one byte changed in storyboard.json, research.md, a dub file, or the request itself', () => {
	for (const rel of ['content/zoora-ai/ep/storyboard.json', 'content/zoora-ai/ep/research.md', 'content/zoora-ai/ep/dub/sheet.es.json']) {
		withFile(rel, oneByte(rel), () =>
			refused(/^- render-requests\/ep\.json: the gate receipt render-requests\/receipts\/ep\.json is stale: content\/zoora-ai\/ep changed after validate wrote it, or holds a file never committed \(validate binds every file git does not ignore\)\./),
		);
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
	const partial = buildReceipt({project: p, id: 'ep', requestBytes: requestBytes(), targets: targetsOf().filter((t) => t.lang !== 'es'), claimGate: gate(), now: new Date()});
	withFile(RECEIPT, serializeReceipt(partial), () => refused(/^- render-requests\/ep\.json: the gate receipt render-requests\/receipts\/ep\.json does not cover zoora-ai\/ep \(es\)\./));
	const wider = buildReceipt({project: p, id: 'ep', requestBytes: requestBytes(), targets: [...targetsOf(), {channel: 'zoora-ai', slug: 'ep', lang: 'pt-br'}], claimGate: gate(), now: new Date()});
	withFile(RECEIPT, serializeReceipt(wider), () => refused(/lists scripts this request does not gate \(zoora-ai\/ep \(pt-br\)\)/));
});

test('CI refuses tampered receipts: hand edits, forged hashes, unknown fields, another request, another gate, old schemas, broken JSON', () => {
	const good = readReceiptJson();
	const edit = (fn: (r: Receipt & Record<string, unknown>) => void, redigest: boolean): string => {
		const r = structuredClone(good) as Receipt & Record<string, unknown>;
		fn(r);
		if (redigest) r.digest = receiptDigest(r);
		return `${JSON.stringify(r, null, 2)}\n`;
	};
	const v1 = edit((r) => {
		const o = r as unknown as Record<string, unknown>;
		o.schema = 1;
		o.requestSha256 = sha256Hex(requestBytes());
		delete o.requestBlob;
	}, true);
	const cases: Array<[string, string, RegExp]> = [
		['a hash edited by hand', edit((r) => (r.targets[0].contentSha256 = r.targets[0].contentSha256.replace(/^./, (c) => (c === '0' ? '1' : '0'))), false), /was changed after validate wrote it \(its digest does not match\)/],
		['validatedAt edited by hand', edit((r) => (r.validatedAt = '2030-01-01T00:00:00.000Z'), false), /its digest does not match/],
		['a forged content hash with a recomputed digest', edit((r) => (r.targets[1].contentSha256 = sha256Hex('forged')), true), /is stale: content\/zoora-ai\/ep changed after validate wrote it/],
		['a forged request blob', edit((r) => (r.requestBlob = '0'.repeat(40)), true), /is stale: the request file changed after validate wrote it/],
		['names not checked', edit((r) => ((r.targets[0] as unknown as Record<string, unknown>).names = 'skipped'), true), /is not one validate writes \(targets\[0\]\.names\)/],
		['a failed claim gate', edit((r) => ((r.targets[2] as unknown as Record<string, unknown>).claims = 'fail'), true), /is not one validate writes \(targets\[2\]\.claims\)/],
		['an extra field', edit((r) => (r.namesCount = 2), true), /is not one validate writes \(its fields must be exactly kind, schema, request, requestBlob, validatedAt, claimGate, targets, digest\)/],
		['a repeated target', edit((r) => (r.targets = [r.targets[0], r.targets[0], r.targets[2]]), true), /is not one validate writes \(targets\[1\] \(a repeated target\)\)/],
		['another request', edit((r) => (r.request = 'other'), true), /the gate receipt render-requests\/receipts\/ep\.json is for another request/],
		['another claim gate', edit((r) => (r.claimGate = {...r.claimGate, codeSha256: sha256Hex('another gate')}), true), /was written by claim gate code that differs from this commit's \(scripts\/claims or a file it imports changed since, or had uncommitted changes then\)/],
		['a gate record that is not one', edit((r) => (r.claimGate = {...r.claimGate, commit: 'abc'}), true), /is not one validate writes \(claimGate\)/],
		['a newer schema', edit((r) => ((r as unknown as Record<string, unknown>).schema = 3), true), /is not one validate writes \(schema \(this farm reads schema 2\)\)/],
		['a schema 1 receipt', v1, /is not one validate writes \(its fields must be exactly/],
		['broken JSON (a half-resolved merge)', '<<<<<<< ours\n{}\n=======\n{}\n>>>>>>> theirs\n', /the gate receipt render-requests\/receipts\/ep\.json is not valid JSON/],
	];
	for (const [what, text, re] of cases) {
		withFile(RECEIPT, text, () => {
			const r = refused(re);
			assert.ok(r.lines[0].length < 600, `${what}: one short line (${r.lines[0].length})`);
		});
	}
	assert.equal(plan().threw, null);
});

test('plan: a push that changes only a receipt renders nothing, and says which request it did not render', () => {
	const later = buildReceipt({project: p, id: 'ep', requestBytes: requestBytes(), targets: targetsOf(), claimGate: gate(), now: new Date('2026-11-25T00:00:00Z')});
	writeFileSync(join(p, RECEIPT), serializeReceipt(later));
	git('add', '-A');
	git('commit', '-q', '-m', 'receipt only');
	const receiptOnly = git('rev-parse', 'HEAD');
	try {
		calls.length = 0;
		const r = plan(head, receiptOnly);
		assert.equal(r.threw, null, r.err);
		assert.deepEqual(calls, [], 'no request, so no gate ran');
		assert.equal(r.outputs().render_count, '0');
		assert.match(r.summary(), /Gate receipts changed: 1 \(a receipt is not a request: it never starts a render\)/);
		assert.match(r.summary(), /\*\*Warning:\*\* render-requests\/ep\.json was NOT rendered: this run saw only its gate receipt change\. To render it, push a change to the request \(validated again\) in one commit with its receipt, or run the workflow by hand with request=ep once the workflow is on the default branch\./);
		assert.match(r.err, /farm: warning: render-requests\/ep\.json was NOT rendered/);
		assert.match(r.summary(), /No added or modified request files: nothing to render/);
		assert.equal(verifyReceipt(p, 'ep', requestBytes(), targetsOf()).ok, true, 'the newer receipt still proves the same content');
		// in GitHub Actions the warning is an annotation
		const h = harness(p, {FARM_EVENT: 'push', FARM_BEFORE: head, FARM_HEAD: receiptOnly, GITHUB_ACTIONS: 'true'});
		const out: string[] = [];
		const log = console.log;
		console.log = (m: unknown) => out.push(String(m));
		try {
			cmdPlan(h.ctx);
		} finally {
			console.log = log;
		}
		assert.ok(out.some((l) => l.startsWith('::warning title=render farm::render-requests/ep.json was NOT rendered')));
	} finally {
		reset(head);
	}
});

test('plan: a new branch whose last commit holds only the receipt (the request came a commit earlier) warns instead of ending green and silent', () => {
	put(p, 'render-requests/nb.json', {...request, id: 'nb'});
	git('add', 'render-requests/nb.json');
	const v = validate(p, [join(p, 'render-requests/nb.json')]);
	assert.equal(v.threw, null, v.err);
	git('commit', '-q', '-m', 'request nb', '--', 'render-requests/nb.json');
	git('add', receiptPath('nb'));
	git('commit', '-q', '-m', 'its receipt');
	const last = git('rev-parse', 'HEAD');
	try {
		const r = plan('0'.repeat(40), last, 'nb');
		assert.equal(r.threw, null, r.err);
		assert.equal(r.outputs().render_count, '0');
		assert.match(r.summary(), /\*\*Warning:\*\* render-requests\/nb\.json was NOT rendered: this run saw only its gate receipt change \(a new branch: only its last commit is read\)\./);
		assert.match(r.summary(), /No added or modified request files in the head commit \(a new branch: earlier commits of this push were not read\): nothing to render\./);
	} finally {
		reset(head);
	}
});

test('plan: a tag run renders nothing (the trigger names branches only; the plan refuses tags too)', () => {
	const r = plan(base, head, 'ep', {FARM_REF: 'refs/tags/v1'});
	assert.ok(r.threw);
	assert.match(String(r.threw), /a tag push renders nothing/);
	assert.match(r.summary(), /The plan failed; nothing was rendered/);
	assert.deepEqual(r.outputs(), {});
	assert.equal(plan(base, head, 'ep', {FARM_REF: 'refs/heads/main'}).threw, null);
});

// ---- check (local, after the commit, before the push) ----------------------------------------------------------------

test('check: the committed request, receipt and folders must match; an uncommitted file or a commit made after validate stops the push', () => {
	const ok = check(p, [join(p, 'render-requests/ep.json')]);
	assert.equal(ok.threw, null, ok.err);
	assert.match(ok.logs.join('\n'), /ep\.json: ok \(the committed request, its receipt and its script folders match: the plan will accept the receipt\)/);
	withFile('content/zoora-ai/ep/storyboard.json', oneByte('content/zoora-ai/ep/storyboard.json'), () => {
		const r = check(p, [join(p, 'render-requests/ep.json')]);
		assert.ok(r.threw);
		assert.match(r.err, /- not committed: content\/zoora-ai\/ep\/storyboard\.json\. Commit the request, its receipt, its script folders and any claim gate change/);
		assert.match(String(r.threw), /would be refused by the plan or are not committed: do not push/);
	});
	// a name taken out after validate and committed: the receipt still binds the old text, so it must not be pushed
	put(p, 'content/zoora-ai/ep/research.md', '# Research\n\n## Must not say\n\n- [named person] by name, edited\n');
	git('commit', '-q', '-am', 'edit after validate');
	try {
		const r = check(p, []);
		assert.ok(r.threw);
		assert.match(r.err, /ep\.json:\n {2}- the gate receipt render-requests\/receipts\/ep\.json is stale: content\/zoora-ai\/ep changed after validate wrote it/);
		assert.match(r.err, /Validate again, commit, then check again/);
	} finally {
		reset(head);
	}
});

// ---- several script folders, one target, news --------------------------------------------------------------------------

test('every script folder is bound on its own: two folders, two channels with one slug, either job order', () => {
	const sb = (channel: string, slug: string) => ({lang: 'en', channel, slug, narration: `${channel} ${slug}`});
	for (const [c, s] of [['zoora-ai', 'a'], ['zoora-ai', 'b'], ['zoora-ai', 'x'], ['zoora-test', 'x']]) put(p, `content/${c}/${s}/storyboard.json`, sb(c, s));
	git('add', '-A');
	git('commit', '-q', '-m', 'four folders');
	const job = (channel: string, slug: string) => ({composition: 'Episode', kind: 'video', output: `out/${channel}/${slug}.mp4`, props: {channel, slug, lang: 'en'}});
	const reqs: Array<[string, Array<[string, string]>]> = [
		['pair', [['zoora-ai', 'a'], ['zoora-ai', 'b']]],
		['shared', [['zoora-ai', 'x'], ['zoora-test', 'x']]],
		['pair-rev', [['zoora-ai', 'b'], ['zoora-ai', 'a']]],
	];
	const commits: Record<string, [string, string]> = {};
	for (const [id, folders] of reqs) {
		const from = git('rev-parse', 'HEAD');
		put(p, `render-requests/${id}.json`, {id, entry: 'src/episode/index.ts', jobs: folders.map(([c, s]) => job(c, s))});
		git('add', '-A');
		const v = validate(p, [join(p, `render-requests/${id}.json`)]);
		assert.equal(v.threw, null, v.err);
		const r: Receipt = JSON.parse(readFileSync(join(p, receiptPath(id)), 'utf8'));
		for (const t of r.targets) assert.equal(t.contentSha256, contentSha256(p, `content/${t.channel}/${t.slug}`), `${id}: ${t.channel}/${t.slug} carries its own folder's hash`);
		git('add', '-A');
		git('commit', '-q', '-m', id);
		commits[id] = [from, git('rev-parse', 'HEAD')];
	}
	try {
		for (const id of ['pair', 'shared', 'pair-rev']) assert.equal(plan(...commits[id], id).threw, null, id);
		for (const [id, dir] of [['pair', 'content/zoora-ai/b'], ['pair-rev', 'content/zoora-ai/b'], ['shared', 'content/zoora-test/x']]) {
			const f = join(p, dir, 'storyboard.json');
			const old = readFileSync(f);
			writeFileSync(f, old.toString('utf8').replace('"en"', '"EN"'));
			try {
				const r = plan(...commits[id], id);
				assert.ok(r.threw, `${id}: ${dir} changed after validate`);
				assert.match(r.lines[0], new RegExp(`is stale: ${dir.replace(/\//g, '\\/')} changed after validate wrote it`));
			} finally {
				writeFileSync(f, old);
			}
		}
	} finally {
		reset(head);
	}
});

test('a single-target show request (a zoora-security news item): claims and news gates run, the receipt covers its one script, and CI requires it', () => {
	const dir = 'content/zoora-security/2026-11-24-x';
	put(p, `${dir}/storyboard.json`, {lang: 'en', segments: []});
	put(p, `${dir}/research.md`, '# Research\n');
	put(p, `${dir}/brief.json`, {slug: '2026-11-24-x'});
	git('add', '-A');
	git('commit', '-q', '-m', 'news item');
	const from = git('rev-parse', 'HEAD');
	put(p, 'render-requests/n.json', {id: 'n', entry: 'src/show/index.ts', jobs: [{composition: 'ShowShort', kind: 'video', output: 'out/n.mp4', props: {channel: 'zoora-security', slug: '2026-11-24-x', lang: 'en'}}]});
	git('add', '-A');
	try {
		calls.length = 0;
		const v = validate(p, [join(p, 'render-requests/n.json')]);
		assert.equal(v.threw, null, v.err);
		assert.deepEqual(calls, ['claims:zoora-security/2026-11-24-x/en:check', 'news:zoora-security/2026-11-24-x/en:check']);
		const r: Receipt = JSON.parse(readFileSync(join(p, receiptPath('n')), 'utf8'));
		assert.equal(r.targets.length, 1);
		git('add', '-A');
		git('commit', '-q', '-m', 'request n');
		const withReceipt = git('rev-parse', 'HEAD');
		const ok = plan(from, withReceipt, 'n');
		assert.equal(ok.threw, null, ok.err);
		assert.equal(ok.outputs().render_count, '1');
		// one target is still a target: no receipt, no render
		git('rm', '-q', receiptPath('n'));
		const missing = plan(from, withReceipt, 'n');
		assert.ok(missing.threw);
		assert.match(missing.lines[0], /^- render-requests\/n\.json: no gate receipt \(render-requests\/receipts\/n\.json\)\. /);
		reset();
		// a failing news gate refuses the request and removes its receipt
		failing = new Set(['news/zoora-security/2026-11-24-x/en']);
		const bad = validate(p, [join(p, 'render-requests/n.json')]);
		assert.ok(bad.threw);
		assert.match(bad.err, /zoora-security\/2026-11-24-x: the news gate FAILS/);
		assert.match(bad.err, /removed render-requests\/receipts\/n\.json/);
	} finally {
		failing = new Set();
		reset(head);
	}
});

// ---- a repository laid out like the real one: the owner on Windows line endings, CI on a clean clone -------------------

test('real layout: the owner validates in a CRLF checkout (core.autocrlf) inside projects/video-studio, CI plans a clean clone, and they agree', () => {
	const w = join(root, 'layout');
	mkdirSync(w, {recursive: true});
	const seed = join(w, 'seed');
	mkdirSync(seed);
	gitIn(seed, 'init', '-q', '-b', 'main');
	const sp = join(seed, 'projects/video-studio');
	put(seed, '.gitignore', 'data/\n');
	put(sp, '.gitignore', '*.tmp\n');
	put(sp, 'src/episode/index.ts', '');
	put(sp, 'scripts/farm/keys/owner.pub.pem', OWNER_PEM);
	put(sp, 'content/zoora-ai/ep/storyboard.json', {version: 1, lang: 'en', narration: 'line one\nline two'});
	put(sp, 'content/zoora-ai/ep/research.md', '# Research\n\n- [named person]\n');
	gitIn(seed, 'add', '-A');
	gitIn(seed, 'commit', '-q', '-m', 'base');
	const seedHead = gitIn(seed, 'rev-parse', 'HEAD');
	gitIn(w, 'clone', '-q', '--bare', seed, 'origin.git');
	gitIn(w, 'clone', '-q', '-c', 'core.autocrlf=true', 'origin.git', 'owner');
	const op = join(w, 'owner/projects/video-studio');
	assert.ok(readFileSync(join(op, 'content/zoora-ai/ep/research.md'), 'utf8').includes('\r\n'), 'the owner checkout has CRLF');
	put(op, 'data/private/names.txt', NAMES);
	// the owner edits with CRLF too, writes the request with CRLF, and adds both before validate
	put(op, 'content/zoora-ai/ep/research.md', '# Research\r\n\r\n- [named person], checked again\r\n');
	put(op, 'render-requests/ep.json', `${JSON.stringify({id: 'ep', entry: 'src/episode/index.ts', jobs: [{composition: 'Episode', kind: 'video', output: 'out/ep.mp4', props: {channel: 'zoora-ai', slug: 'ep', lang: 'en'}}]}, null, 2).replace(/\n/g, '\r\n')}\r\n`);
	gitIn(op, 'add', 'render-requests/ep.json', 'content/zoora-ai/ep');
	// a Finder file nobody ignores: refused by name (it would be bound but never committed, or committed unchecked)
	put(op, 'content/zoora-ai/ep/.DS_Store', Buffer.from([0, 0, 0, 1, 66, 117, 100, 49]));
	const ds = validate(op, [join(op, 'render-requests/ep.json')]);
	assert.ok(ds.threw);
	assert.match(ds.err, /- not added to git: content\/zoora-ai\/ep\/\.DS_Store\./);
	rmSync(join(op, 'content/zoora-ai/ep/.DS_Store'));
	put(op, 'content/zoora-ai/ep/draft.tmp', 'ignored by the project .gitignore');
	const v = validate(op, [join(op, 'render-requests/ep.json')]);
	assert.equal(v.threw, null, v.err);
	gitIn(op, 'add', receiptPath('ep'));
	execFileSync('git', ['commit', '-q', '-m', 'Render ep'], {cwd: op, env: gitEnv});
	const c = check(op, [join(op, 'render-requests/ep.json')]);
	assert.equal(c.threw, null, c.err);
	gitIn(op, 'push', '-q', 'origin', 'main');
	const pushed = gitIn(op, 'rev-parse', 'HEAD');
	// CI: a clean clone (LF), its own project folder, no names list, the pushed commit
	gitIn(w, 'clone', '-q', 'origin.git', 'ci');
	const cp = join(w, 'ci/projects/video-studio');
	assert.ok(!readFileSync(join(cp, 'content/zoora-ai/ep/research.md'), 'utf8').includes('\r'), 'CI has LF');
	assert.ok(!existsSync(join(cp, 'data')));
	const h = harness(cp, {FARM_EVENT: 'push', FARM_BEFORE: seedHead, FARM_HEAD: pushed});
	const r = step(() => cmdPlan(h.ctx));
	assert.equal(r.threw, null, `${r.err}\n${h.summary()}`);
	assert.equal(h.outputs().render_count, '1');
	assert.match(h.summary(), /Gate receipts match/);
});

// ---- the real claim gate ---------------------------------------------------------------------------------------------

test('real claim gate, invented names list: the receipt holds no name, no list hash or count, no report text; CI accepts it without the list; names slipped in are stopped', () => {
	// A git project with a COPY of the claim gate's code (so its own default names list would be this project's, which
	// CI never has), its own test fixture and the gate's invented names list.
	const q = join(root, 'real');
	for (const f of claimGateCode(REAL_PROJECT)) cpSync(join(REAL_PROJECT, f), join(q, f));
	const fixture = join(REAL_PROJECT, 'scripts/claims/tests/fixtures');
	put(q, '.gitignore', 'data/\n');
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
	const qg = (...args: string[]) => gitIn(q, ...args);
	qg('init', '-q', '-b', 'main');
	qg('add', '-A');
	qg('commit', '-q', '-m', 'base with the request staged and committed');
	const sb = join(q, 'content/zoora-test/good-episode/storyboard.json');
	const story = JSON.parse(readFileSync(sb, 'utf8')) as {scenes: Array<{narration: string}>};
	const req = join(q, 'render-requests/real.json');
	const realValidate = () => validate(q, [req], {}, null);

	const ok = realValidate();
	assert.equal(ok.threw, null, ok.err);
	assert.match(ok.logs.join('\n'), /real\.json: ok \(2 job\(s\), 0 voice, encrypted to "owner", kept 7 days; 2 gate check\(s\) pass, private names checked\); gate receipt render-requests\/receipts\/real\.json written/);
	const text = readFileSync(join(q, receiptPath('real')), 'utf8');
	const r: Receipt = JSON.parse(text);
	assert.deepEqual(Object.keys(r).sort(), TOP_KEYS);
	for (const t of r.targets) assert.deepEqual(Object.keys(t).sort(), TARGET_KEYS);
	assert.deepEqual(r.targets.map((t) => [t.lang, t.claims, t.names]), [['en', 'pass', 'checked'], ['es', 'pass', 'checked']]);
	assert.equal(r.claimGate.commit, qg('rev-parse', 'HEAD'), 'the claim gate code was committed in the base commit');
	const forbidden = [...names, ...names.map((x) => x.replace(/^@/, '')), ...names.flatMap((x) => x.split(/\s+/)), sha256Hex(namesText), sha256Hex(readFileSync(join(q, 'data/private/names.txt'))), 'names.txt', story.scenes[0].narration.slice(0, 40)];
	for (const s of forbidden) assert.ok(!text.toLowerCase().includes(s.toLowerCase()), `the receipt holds private or script text: ${s}`);
	assert.deepEqual(readdirSync(gateTemp).filter((f) => f.startsWith('farm-gate-')), [], 'every gate report (it quotes the script) was deleted after it was read');
	qg('add', '-A');
	qg('commit', '-q', '-m', 'its receipt');

	// CI: the real gate with --no-names, on a checkout WITHOUT the names list, and the receipt matches
	const ci = () => {
		renameSync(join(q, 'data'), join(root, 'real-data-away'));
		try {
			const h = harness(q, {FARM_EVENT: 'workflow_dispatch', FARM_DISPATCH_REQUEST: 'real'}, null);
			return {...h, ...step(() => cmdPlan(h.ctx))};
		} finally {
			renameSync(join(root, 'real-data-away'), join(q, 'data'));
		}
	};
	const accepted = ci();
	assert.equal(accepted.threw, null, `${accepted.err}\n${accepted.summary()}`);
	assert.equal(accepted.outputs().render_count, '2');

	// An invented private name slipped into the script AFTER validate. CI's gate cannot see it (--no-names passes), so
	// only the receipt stops it: stale first; then validate (with the list) fails and removes the receipt.
	const original = readFileSync(sb);
	story.scenes[0].narration += ` ${names[0]} watches.`;
	writeFileSync(sb, JSON.stringify(story, null, 2));
	try {
		const stale = ci();
		assert.ok(stale.threw);
		assert.match(stale.summary(), /- render-requests\/real\.json: the gate receipt render-requests\/receipts\/real\.json is stale: content\/zoora-test\/good-episode changed after validate wrote it/);
		qg('add', '-A');
		const local = realValidate();
		assert.ok(local.threw);
		assert.match(local.err, /- content\/zoora-test\/good-episode\/storyboard\.json holds private name #\d/);
		assert.match(local.err, /removed render-requests\/receipts\/real\.json/);
		const missing = ci();
		assert.ok(missing.threw);
		assert.match(missing.summary(), /- render-requests\/real\.json: no gate receipt \(render-requests\/receipts\/real\.json\)\. CI checks scripts without the private names list/);
		for (const text2 of [stale.summary(), stale.err, local.err, missing.summary(), missing.err]) assert.ok(!text2.includes(names[0]) && !text2.includes('watches'), 'a name or script text reached the output');
	} finally {
		writeFileSync(sb, original);
		qg('checkout', '-q', 'HEAD', '--', '.');
	}

	// A name in research.md, which the claim gate reads only for its Must-not-say list: the gate passes, validate does not
	const research = join(q, 'content/zoora-test/good-episode/research.md');
	const researchText = readFileSync(research);
	writeFileSync(research, `${researchText.toString('utf8')}\nNote: ${names[1]}\n`);
	qg('add', '-A');
	try {
		const scan = realValidate();
		assert.ok(scan.threw);
		assert.match(scan.err, /- content\/zoora-test\/good-episode\/research\.md holds private name #2/);
		assert.ok(!scan.err.includes(names[1].replace(/^@/, '')));
	} finally {
		writeFileSync(research, researchText);
		qg('checkout', '-q', 'HEAD', '--', '.');
		qg('reset', '-q');
	}

	// An empty names list compares nothing: refused, and the receipt (restored here) is left as it is
	qg('checkout', '-q', 'HEAD', '--', receiptPath('real'));
	writeFileSync(join(q, 'data/private/names.txt'), '# the owner has not added the names yet\n');
	const kept = readFileSync(join(q, receiptPath('real')));
	try {
		const empty = realValidate();
		assert.ok(empty.threw);
		assert.ok(empty.err.includes(NAMES_EMPTY));
		assert.deepEqual(readFileSync(join(q, receiptPath('real'))), kept);
	} finally {
		writeFileSync(join(q, 'data/private/names.txt'), namesText);
	}

	// fixed: validate passes again and binds the same content as the first time; CI accepts it
	const again = realValidate();
	assert.equal(again.threw, null, again.err);
	const rewritten: Receipt = JSON.parse(readFileSync(join(q, receiptPath('real')), 'utf8'));
	assert.deepEqual(rewritten.targets, r.targets);
	assert.equal(ci().threw, null, 'CI accepts the receipt');
	assert.equal(requestBlobOf(q, 'real', readFileSync(req)), r.requestBlob);
});
