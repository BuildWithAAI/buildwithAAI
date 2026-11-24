/**
 * Gate receipts: render-requests/receipts/<id>.json (docs/RENDER_FARM.md, "Gate receipts").
 *
 * The claim gate checks every script against the private names list (data/private/names.txt), which is gitignored and
 * must never reach the repository or CI. So on GitHub the plan job runs the gate with --no-names (every other rule
 * still applies) and REQUIRES this receipt instead: `farm.ts validate`, run where the list exists (normally the owner's
 * computer), writes it once every claim gate of the request passed with the names checked and every file the receipt
 * binds was searched for the names. The receipt binds that verdict to what git commits:
 *   - requestBlob: the git blob id of the request file (`git hash-object`: what `git add` stores, so a checkout that
 *     turns LF into CRLF does not make it stale);
 *   - per gate target, contentSha256: a sha256 over every file of content/<channel>/<slug>/ that git does not ignore
 *     (sorted relative paths, each with its git blob id);
 *   - claimGate.codeSha256: the same over the claim gate's code (scripts/claims/check.ts and every file it imports), so
 *     a receipt written by a locally edited gate, or by a gate that changed since, does not match.
 * validate refuses while any of those files is untracked or has unstaged changes, so the receipt binds exactly what the
 * owner is about to commit, and the plan recomputes every hash on the pushed commit. Any later edit makes it stale.
 *
 * NO private data goes in: no names, no hash, size or line count of the names list (a hash of a short list can be
 * found by trying names), no gate report text (reports quote the script). Only the request id, the channel, slug and
 * language of each target, git blob ids of files that are committed with the request (public once pushed), the claim
 * gate's last commit, and the time. A receipt pushed while it is stale still publishes the blob ids of the files as
 * validate saw them, which can confirm a guess at text that was edited out before the commit: run `farm.ts check`
 * before every push. `digest` is a sha256 over the rest, so a hand edit or a half-merged receipt shows.
 *
 * A receipt is evidence, not a signature: whoever can push can write one. It stops the accidents (a request pushed
 * without validate, a script edited after it, a receipt edited by hand, a claim gate edited locally); a malicious
 * pusher could as well change the workflow. Files git ignores are left out of the content hash: they are never
 * committed, so CI never has them.
 */
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join, relative, resolve, sep} from 'node:path';
import {FarmError} from './crypto.ts';
import {CLAIM_GATE, contentDir, targetKey, targetLabel, type GateTarget} from './gates.ts';
import {RECEIPTS_DIR, REQUESTS_DIR} from './plan.ts';
import {ID_RE} from './request.ts';

export const RECEIPT_KIND = 'zoora-farm-gate-receipt';
export const RECEIPT_SCHEMA = 2;

/** One gate target: its claim gate passed with the private names checked, on content with this hash. */
export type ReceiptTarget = {channel: string; slug: string; lang: string | null; claims: 'pass'; names: 'checked'; contentSha256: string};

/**
 * The claim gate that wrote the receipt: codeSha256 binds its code (the plan refuses a receipt whose gate code differs
 * from the pushed commit's); commit is the last commit that touched that code, for the record (null: none).
 */
export type ClaimGateVersion = {commit: string | null; codeSha256: string};

export type ReceiptBody = {
	kind: typeof RECEIPT_KIND;
	schema: typeof RECEIPT_SCHEMA;
	request: string;
	requestBlob: string;
	validatedAt: string;
	claimGate: ClaimGateVersion;
	targets: ReceiptTarget[];
};

export type Receipt = ReceiptBody & {digest: string};

/** Where the receipt of request <id> lives, relative to the project. */
export const receiptPath = (id: string): string => `${RECEIPTS_DIR}/${id}.json`;

/** Where request <id> lives, relative to the project. */
export const requestRel = (id: string): string => `${REQUESTS_DIR}/${id}.json`;

export const sha256Hex = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');

const HEX64 = /^[0-9a-f]{64}$/;
/** A git object id: SHA-1 (40) or SHA-256 (64) repositories. */
const OID_RE = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const COMMIT_RE = OID_RE;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const CHANNEL_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,95}$/;
const LANG_RE = /^[a-z]{2}(?:-[a-z]{2})?$/;
const MAX_TARGETS = 64;

const TOP_KEYS = ['kind', 'schema', 'request', 'requestBlob', 'validatedAt', 'claimGate', 'targets', 'digest'];
const GATE_KEYS = ['commit', 'codeSha256'];
const TARGET_KEYS = ['channel', 'slug', 'lang', 'claims', 'names', 'contentSha256'];

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const sameKeys = (o: Record<string, unknown>, keys: string[]): boolean => {
	const k = Object.keys(o);
	return k.length === keys.length && keys.every((x) => k.includes(x));
};

// ---------------------------------------------------------------------------------------------------------------
// git (every hash is git's view of the files, so the owner's checkout and CI's agree)

/** Runs git in the project (pathspecs taken literally; never through a shell). */
const git = (project: string, args: string[], input?: string | Uint8Array): {ok: boolean; stdout: string} => {
	const r = spawnSync('git', ['--literal-pathspecs', ...args], {
		cwd: project,
		input,
		encoding: 'utf8',
		stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
		maxBuffer: 64 * 1024 * 1024,
	});
	return {ok: !r.error && r.status === 0, stdout: r.stdout ?? ''};
};

/** git's answer, or a FarmError: a hash must never fall back to a guess (the files on disk, ignored ones included). */
const gitOr = (project: string, args: string[], what: string, input?: string | Uint8Array): string => {
	const r = git(project, args, input);
	if (!r.ok) throw new FarmError(`git could not ${what} (git must be on PATH, and the project must be a git checkout: validate inside the repository)`);
	return r.stdout;
};

/** The project's path inside its repository ("projects/video-studio/"; "" at the top). */
const gitPrefix = (project: string): string => gitOr(project, ['rev-parse', '--show-prefix'], 'find the repository').replace(/\n$/, '');

/** Throws a FarmError when git cannot answer for the project (git missing, not a checkout, a refused safe.directory). */
export const requireGit = (project: string): void => {
	gitPrefix(project);
};

/**
 * The git blob id of each file (project-relative paths), as `git add` would store it: line-ending conversion and
 * other clean filters apply, so a CRLF checkout of an LF commit hashes the same as the commit.
 */
export const blobIds = (project: string, rels: string[]): string[] => {
	if (!rels.length) return [];
	if (rels.some((r) => /[\r\n]/.test(r))) throw new FarmError('a file name holds a line break: a gate receipt cannot bind it');
	const prefix = gitPrefix(project);
	const out = gitOr(project, ['hash-object', '--stdin-paths'], 'hash the files', `${rels.map((r) => `${prefix}${r}`).join('\n')}\n`)
		.split('\n')
		.filter(Boolean);
	if (out.length !== rels.length || !out.every((x) => OID_RE.test(x))) throw new FarmError('git hash-object gave an unexpected answer');
	return out;
};

/** The git blob id the request file's bytes get when it is committed at render-requests/<id>.json. */
export const requestBlobOf = (project: string, id: string, bytes: Uint8Array): string => {
	const oid = gitOr(project, ['hash-object', '--stdin', `--path=${requestRel(id)}`], `hash ${requestRel(id)}`, bytes).trim();
	if (!OID_RE.test(oid)) throw new FarmError('git hash-object gave an unexpected answer');
	return oid;
};

/** How a path stands against git: not added, changed but not staged, staged but not committed, or mid-merge. */
export type PathState = {path: string; state: 'untracked' | 'unstaged' | 'staged' | 'unmerged'};

/**
 * Every path under `paths` (project-relative) whose working tree, index and HEAD do not all agree: untracked files git
 * does not ignore, unstaged edits or deletions, staged changes, unmerged entries. Paths come back project-relative.
 */
export const uncommittedPaths = (project: string, paths: string[]): PathState[] => {
	if (!paths.length) return [];
	const prefix = gitPrefix(project);
	const out = gitOr(project, ['--no-optional-locks', 'status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all', '--', ...paths], 'tell which files are committed');
	const states: PathState[] = [];
	for (const entry of out.split('\0').filter(Boolean)) {
		const xy = entry.slice(0, 2);
		const full = entry.slice(3);
		const path = full.startsWith(prefix) ? full.slice(prefix.length) : full;
		const [x, y] = [xy[0], xy[1]];
		const state: PathState['state'] =
			xy === '??' ? 'untracked' : x === 'U' || y === 'U' || xy === 'AA' || xy === 'DD' ? 'unmerged' : y !== ' ' ? 'unstaged' : 'staged';
		states.push({path, state});
	}
	return states;
};

/** True when git's index holds the path (staged or committed): deleting the file alone does not take it out of a commit. */
export const inGitIndex = (project: string, rel: string): boolean => {
	const r = git(project, ['ls-files', '-z', '--', rel]);
	return r.ok && r.stdout.split('\0').includes(rel);
};

// ---------------------------------------------------------------------------------------------------------------
// Content hashes

/**
 * The files of a script folder that a receipt binds: every file under it that git tracks or would add, except files
 * git ignores (they are never committed, so CI never has them). Sorted relative paths with "/" separators. A symbolic
 * link or another special file is refused: a receipt binds file contents. When git cannot answer, this throws: a hash
 * never falls back to every file on disk.
 */
export const contentFiles = (project: string, rel: string): string[] => {
	try {
		if (lstatSync(join(project, rel)).isSymbolicLink()) throw new FarmError(`${rel} is a symbolic link: a gate receipt binds file contents, so a script folder may not be a link`);
	} catch (e) {
		if (e instanceof FarmError) throw e;
	}
	const listed = gitOr(project, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', rel], `list the files of ${rel}`);
	const files = new Set<string>();
	for (const p of listed.split('\0').filter(Boolean)) {
		if (!p.startsWith(`${rel}/`)) continue;
		if (p.endsWith('/')) throw new FarmError(`${p.slice(0, -1)} is a nested repository: a script folder may hold only files`);
		let st;
		try {
			st = lstatSync(join(project, p));
		} catch {
			continue; // tracked but deleted on disk: nothing there to hash (validate refuses unstaged deletions)
		}
		if (st.isSymbolicLink()) throw new FarmError(`${p} is a symbolic link: a gate receipt binds file contents, so a script folder may not hold links`);
		if (!st.isFile()) throw new FarmError(`${p} is not a regular file`);
		files.add(p.slice(rel.length + 1));
	}
	return [...files].sort();
};

/** A sha256 over a list of files: for each, in order, "<relative path>\0<its git blob id>\n". */
const listingSha256 = (tag: string, files: string[], ids: string[]): string => {
	const h = createHash('sha256');
	h.update(`${tag}\n`);
	files.forEach((f, i) => h.update(`${f}\0${ids[i]}\n`));
	return h.digest('hex');
};

/** The hash a receipt records for a script folder. */
export const contentSha256 = (project: string, rel: string): string => {
	const files = contentFiles(project, rel);
	return listingSha256('zoora-farm-content-v2', files, blobIds(project, files.map((f) => `${rel}/${f}`)));
};

// ---------------------------------------------------------------------------------------------------------------
// The claim gate's code

const IMPORT_RE = /(?:^|[\n;])[ \t]*(?:import|export)[ \t]+(type[ \t]+)?(?:[^'";]*?[ \t\n]from[ \t\n]*)?['"]([^'"\n]+)['"]/g;
const DYNAMIC_IMPORT_RE = /\bimport\(\s*['"]([^'"\n]+)['"]\s*\)/g;

/**
 * The claim gate's code: scripts/claims/check.ts, every file it imports at run time (relative imports, followed
 * through every file; `import type` is erased by Node and left out), and the package.json below the project root that
 * tells Node how each of those modules loads. Project-relative paths, sorted; [] when the gate is not in this checkout.
 * Walking the imports keeps the list from drifting: the names rule depends on src/episode/markup.ts and
 * scripts/dub/lib as much as on scripts/claims.
 */
export const claimGateCode = (project: string): string[] => {
	if (!existsSync(join(project, CLAIM_GATE))) return [];
	const seen = new Set<string>();
	const todo = [CLAIM_GATE];
	while (todo.length) {
		const rel = todo.pop() as string;
		if (seen.has(rel)) continue;
		const abs = join(project, rel);
		if (!existsSync(abs)) continue; // not a file this checkout has: the gate cannot load it either
		seen.add(rel);
		const text = readFileSync(abs, 'utf8');
		const specs = [...[...text.matchAll(IMPORT_RE)].filter((m) => !m[1]).map((m) => m[2]), ...[...text.matchAll(DYNAMIC_IMPORT_RE)].map((m) => m[1])];
		for (const s of specs) {
			if (!s.startsWith('./') && !s.startsWith('../')) continue; // node: built-ins and packages are not the gate's code
			const r = relative(project, resolve(dirname(abs), s)).split(sep).join('/');
			if (r.startsWith('../') || r === '..') continue;
			todo.push(r);
		}
	}
	for (const f of [...seen]) {
		for (let d = dirname(f); d !== '.' && d !== ''; d = dirname(d)) {
			if (existsSync(join(project, d, 'package.json'))) {
				seen.add(`${d}/package.json`);
				break;
			}
		}
	}
	return [...seen].sort();
};

/** The claim gate's code hash (see claimGateCode). */
export const claimGateFingerprint = (project: string): {files: string[]; codeSha256: string} => {
	const files = claimGateCode(project);
	return {files, codeSha256: listingSha256('zoora-farm-claim-gate-v1', files, blobIds(project, files))};
};

/** The claim gate's code hash and its last commit (git, run once per request in validate). */
export const claimGateVersion = (project: string): ClaimGateVersion => {
	const {files, codeSha256} = claimGateFingerprint(project);
	let commit: string | null = null;
	if (files.length) {
		const log = git(project, ['log', '-1', '--format=%H', '--', ...files]);
		const sha = log.ok ? log.stdout.trim() : '';
		commit = COMMIT_RE.test(sha) ? sha : null;
	}
	return {commit, codeSha256};
};

// ---------------------------------------------------------------------------------------------------------------
// The receipt

/** JSON with object keys sorted at every level: the digest does not depend on key order or whitespace. */
export const canonicalJson = (v: unknown): string => {
	if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
	if (v !== null && typeof v === 'object') {
		const o = v as Record<string, unknown>;
		return `{${Object.keys(o)
			.sort()
			.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
			.join(',')}}`;
	}
	return JSON.stringify(v) ?? 'null';
};

const bodyOf = (r: ReceiptBody): ReceiptBody => ({
	kind: r.kind,
	schema: r.schema,
	request: r.request,
	requestBlob: r.requestBlob,
	validatedAt: r.validatedAt,
	claimGate: r.claimGate,
	targets: r.targets,
});

export const receiptDigest = (r: ReceiptBody): string => sha256Hex(`${RECEIPT_KIND}\n${canonicalJson(bodyOf(r))}`);

/** Everything a receipt proves, without the time it was written. */
const bindingOf = (r: ReceiptBody): string => canonicalJson({...bodyOf(r), validatedAt: null});

export type ReceiptInput = {
	project: string;
	id: string;
	/** The request file's bytes, as validate read and checked them (bound by the blob id git gives them). */
	requestBytes: Uint8Array;
	/** The blob id of those bytes, when the caller already has it (validate: taken before the gates ran). */
	requestBlob?: string;
	/** Every gate target of the request (gates.ts gateTargets); each passed its claim gate with the names checked. */
	targets: GateTarget[];
	claimGate: ClaimGateVersion;
	now: Date;
	/** Script folder hashes taken before the gates ran (validate), by folder; any folder missing here is hashed now. */
	hashes?: ReadonlyMap<string, string>;
};

export const buildReceipt = (i: ReceiptInput): Receipt => {
	const hashes = new Map<string, string>(i.hashes ?? []);
	const hashOf = (t: GateTarget): string => {
		const dir = contentDir(t);
		const known = hashes.get(dir);
		if (known) return known;
		const h = contentSha256(i.project, dir);
		hashes.set(dir, h);
		return h;
	};
	const targets = [...i.targets]
		.sort((a, b) => (targetKey(a) < targetKey(b) ? -1 : targetKey(a) > targetKey(b) ? 1 : 0))
		.map((t): ReceiptTarget => ({channel: t.channel, slug: t.slug, lang: t.lang, claims: 'pass', names: 'checked', contentSha256: hashOf(t)}));
	const body: ReceiptBody = {
		kind: RECEIPT_KIND,
		schema: RECEIPT_SCHEMA,
		request: i.id,
		requestBlob: i.requestBlob ?? requestBlobOf(i.project, i.id, i.requestBytes),
		validatedAt: i.now.toISOString(),
		claimGate: {commit: i.claimGate.commit, codeSha256: i.claimGate.codeSha256},
		targets,
	};
	return {...body, digest: receiptDigest(body)};
};

export const serializeReceipt = (r: Receipt): string => `${JSON.stringify({...bodyOf(r), digest: r.digest}, null, 2)}\n`;

/** The first way a parsed file differs from a receipt validate writes, by field name (never by value); null if none. */
export const receiptShapeProblem = (x: unknown): string | null => {
	if (!isPlainObject(x)) return 'not a JSON object';
	if (!sameKeys(x, TOP_KEYS)) return `its fields must be exactly ${TOP_KEYS.join(', ')}`;
	if (x.kind !== RECEIPT_KIND) return 'kind';
	if (x.schema !== RECEIPT_SCHEMA) return `schema (this farm reads schema ${RECEIPT_SCHEMA})`;
	if (typeof x.request !== 'string' || !ID_RE.test(x.request)) return 'request';
	if (typeof x.requestBlob !== 'string' || !OID_RE.test(x.requestBlob)) return 'requestBlob';
	if (typeof x.validatedAt !== 'string' || !ISO_RE.test(x.validatedAt) || Number.isNaN(Date.parse(x.validatedAt))) return 'validatedAt';
	const g = x.claimGate;
	if (!isPlainObject(g) || !sameKeys(g, GATE_KEYS) || !(g.commit === null || (typeof g.commit === 'string' && COMMIT_RE.test(g.commit))) || typeof g.codeSha256 !== 'string' || !HEX64.test(g.codeSha256)) return 'claimGate';
	if (!Array.isArray(x.targets) || x.targets.length === 0 || x.targets.length > MAX_TARGETS) return 'targets';
	const seen = new Set<string>();
	for (let i = 0; i < x.targets.length; i++) {
		const t: unknown = x.targets[i];
		const at = `targets[${i}]`;
		if (!isPlainObject(t) || !sameKeys(t, TARGET_KEYS)) return at;
		if (typeof t.channel !== 'string' || !CHANNEL_RE.test(t.channel)) return `${at}.channel`;
		if (typeof t.slug !== 'string' || !SLUG_RE.test(t.slug)) return `${at}.slug`;
		if (!(t.lang === null || (typeof t.lang === 'string' && LANG_RE.test(t.lang)))) return `${at}.lang`;
		if (t.claims !== 'pass') return `${at}.claims`;
		if (t.names !== 'checked') return `${at}.names`;
		if (typeof t.contentSha256 !== 'string' || !HEX64.test(t.contentSha256)) return `${at}.contentSha256`;
		const key = targetKey(t as ReceiptTarget);
		if (seen.has(key)) return `${at} (a repeated target)`;
		seen.add(key);
	}
	if (typeof x.digest !== 'string' || !HEX64.test(x.digest)) return 'digest';
	return null;
};

/** A receipt file that validate wrote and nobody changed since (shape and digest), or null. */
const readReceipt = (path: string): Receipt | null => {
	try {
		const x: unknown = JSON.parse(readFileSync(path, 'utf8'));
		if (receiptShapeProblem(x)) return null;
		const r = x as Receipt;
		return r.digest === receiptDigest(r) ? r : null;
	} catch {
		return null;
	}
};

/**
 * Writes the receipt, unless the file already holds one that proves the same thing (only validatedAt differs): so
 * validating unchanged requests again leaves no diff to commit.
 */
export const writeReceipt = (project: string, r: Receipt): 'written' | 'unchanged' => {
	const path = join(project, receiptPath(r.request));
	const old = existsSync(path) ? readReceipt(path) : null;
	if (old && bindingOf(old) === bindingOf(r)) return 'unchanged';
	mkdirSync(dirname(path), {recursive: true});
	const tmp = `${path}.${process.pid}.tmp`;
	writeFileSync(tmp, serializeReceipt(r));
	renameSync(tmp, path);
	return 'written';
};

/** Removes request <id>'s receipt from the working tree; true when there was one. git's index is not touched. */
export const removeReceipt = (project: string, id: string): boolean => {
	if (!ID_RE.test(id)) return false;
	const path = join(project, receiptPath(id));
	if (!existsSync(path)) return false;
	rmSync(path, {force: true});
	return true;
};

/**
 * The plan's check: the request's receipt exists, is one validate wrote (shape, digest), is for this request file (its
 * blob id), covers exactly the request's gate targets, records a passing claim gate with the names checked for each,
 * every script folder still hashes to what it recorded, and the claim gate's code is the code that wrote it. Returns
 * the receipt, or the first problem as a short phrase that names files and targets, never content. `gateCode` is the
 * checkout's claimGateFingerprint (computed here when not given).
 */
export const verifyReceipt = (
	project: string,
	id: string,
	requestBytes: Uint8Array,
	targets: GateTarget[],
	gateCode?: string,
): {ok: true; receipt: Receipt} | {ok: false; problem: string} => {
	const rel = receiptPath(id);
	const path = join(project, rel);
	const fail = (problem: string) => ({ok: false as const, problem});
	if (!existsSync(path)) return fail(`no gate receipt (${rel})`);
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(path, 'utf8'));
	} catch {
		return fail(`the gate receipt ${rel} is not valid JSON`);
	}
	const shape = receiptShapeProblem(raw);
	if (shape) return fail(`the gate receipt ${rel} is not one validate writes (${shape})`);
	const r = raw as Receipt;
	if (r.digest !== receiptDigest(r)) return fail(`the gate receipt ${rel} was changed after validate wrote it (its digest does not match)`);
	if (r.request !== id) return fail(`the gate receipt ${rel} is for another request`);
	try {
		if (r.requestBlob !== requestBlobOf(project, id, requestBytes)) return fail(`the gate receipt ${rel} is stale: the request file changed after validate wrote it`);
		const have = new Map(r.targets.map((t) => [targetKey(t), t]));
		const want = new Set(targets.map(targetKey));
		const missing = targets.filter((t) => !have.has(targetKey(t)));
		if (missing.length) return fail(`the gate receipt ${rel} does not cover ${missing.map(targetLabel).join(', ')}`);
		const extra = r.targets.filter((t) => !want.has(targetKey(t)));
		if (extra.length) return fail(`the gate receipt ${rel} lists scripts this request does not gate (${extra.map(targetLabel).join(', ')})`);
		const hashes = new Map<string, string>();
		const stale = new Set<string>();
		for (const t of targets) {
			const dir = contentDir(t);
			let h = hashes.get(dir);
			if (h === undefined) {
				h = contentSha256(project, dir);
				hashes.set(dir, h);
			}
			if (have.get(targetKey(t))?.contentSha256 !== h) stale.add(dir);
		}
		if (stale.size) {
			return fail(`the gate receipt ${rel} is stale: ${[...stale].join(', ')} changed after validate wrote it, or holds a file that was never committed (validate hashes every file there that git does not ignore)`);
		}
		const code = gateCode ?? claimGateFingerprint(project).codeSha256;
		if (r.claimGate.codeSha256 !== code) return fail(`the gate receipt ${rel} was written by claim gate code that differs from this commit's (scripts/claims or a file it imports changed since, or had uncommitted changes then)`);
	} catch (e) {
		if (e instanceof FarmError) return fail(e.message);
		throw e;
	}
	return {ok: true, receipt: r};
};
