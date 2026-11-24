/**
 * Gate receipts: render-requests/receipts/<id>.json (docs/RENDER_FARM.md, "Gate before push").
 *
 * The claim gate checks every script against the private names list (data/private/names.txt), which is gitignored and
 * must never reach the repository or CI. So on GitHub the plan job runs the gate with --no-names (every other rule
 * still applies) and REQUIRES this receipt instead: `farm.ts validate`, run on the owner's computer with the list,
 * writes it once every claim gate of the request passed with the names checked. The receipt binds that verdict to the
 * exact bytes: the request file's sha256 and, per gate target, a sha256 over every file of content/<channel>/<slug>/
 * (sorted relative paths plus each file's sha256). Any edit to the request or to one of its script folders makes it
 * stale, and the plan refuses the request until validate runs again.
 *
 * NO private data goes in: no names, no hash, size or line count of the names list (a hash of a short list can be
 * found by trying names), no gate report text (reports quote the script). Only the request id, the channel, slug and
 * language of each target, sha256s of files that are public in this repository anyway, the claim gate's last commit,
 * and the time. `digest` is a sha256 over the rest, so a hand edit or a half-merged receipt shows.
 *
 * A receipt is evidence, not a signature: whoever can push can write one. It stops the accidents (a request pushed
 * without validate, a script edited after it, a receipt edited by hand); a malicious pusher could as well change the
 * workflow. Files git ignores are left out of the content hash: they are never committed, so CI never has them.
 */
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join, relative, sep} from 'node:path';
import {FarmError} from './crypto.ts';
import {contentDir, targetKey, targetLabel, type GateTarget} from './gates.ts';
import {RECEIPTS_DIR} from './plan.ts';
import {ID_RE} from './request.ts';

export const RECEIPT_KIND = 'zoora-farm-gate-receipt';
export const RECEIPT_SCHEMA = 1;
/** The claim gate's code, whose last commit a receipt records (for the record only: CI re-runs the current gate). */
export const CLAIMS_DIR = 'scripts/claims';

/** One gate target: its claim gate passed with the private names checked, on content with this sha256. */
export type ReceiptTarget = {channel: string; slug: string; lang: string | null; claims: 'pass'; names: 'checked'; contentSha256: string};

/** The last commit that touched scripts/claims (null: git could not tell) and whether it had uncommitted changes. */
export type ClaimGateVersion = {commit: string | null; uncommitted: boolean};

export type ReceiptBody = {
	kind: typeof RECEIPT_KIND;
	schema: typeof RECEIPT_SCHEMA;
	request: string;
	requestSha256: string;
	validatedAt: string;
	claimGate: ClaimGateVersion;
	targets: ReceiptTarget[];
};

export type Receipt = ReceiptBody & {digest: string};

/** Where the receipt of request <id> lives, relative to the project. */
export const receiptPath = (id: string): string => `${RECEIPTS_DIR}/${id}.json`;

export const sha256Hex = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');

const HEX64 = /^[0-9a-f]{64}$/;
const COMMIT_RE = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const CHANNEL_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,95}$/;
const LANG_RE = /^[a-z]{2}(?:-[a-z]{2})?$/;
const MAX_TARGETS = 64;

const TOP_KEYS = ['kind', 'schema', 'request', 'requestSha256', 'validatedAt', 'claimGate', 'targets', 'digest'];
const GATE_KEYS = ['commit', 'uncommitted'];
const TARGET_KEYS = ['channel', 'slug', 'lang', 'claims', 'names', 'contentSha256'];

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const sameKeys = (o: Record<string, unknown>, keys: string[]): boolean => {
	const k = Object.keys(o);
	return k.length === keys.length && keys.every((x) => k.includes(x));
};

// ---------------------------------------------------------------------------------------------------------------
// Content hashes

/** Untracked files git ignores under `rel` (project-relative paths); null when git cannot tell (no repository or git). */
const gitIgnored = (project: string, rel: string): Set<string> | null => {
	const r = spawnSync('git', ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--', rel], {cwd: project, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024});
	if (r.status !== 0) return null;
	return new Set(r.stdout.split('\0').filter(Boolean));
};

/**
 * The files of a script folder that a commit carries: every file under it except untracked files git ignores (so the
 * owner's computer and the CI checkout hash the same set). Sorted relative paths with "/" separators. A symbolic link
 * or another special file is refused: a receipt binds file contents.
 */
export const contentFiles = (project: string, rel: string): string[] => {
	const root = join(project, rel);
	if (!existsSync(root)) return [];
	const ignored = gitIgnored(project, rel) ?? new Set<string>();
	const out: string[] = [];
	const walk = (dir: string) => {
		for (const d of readdirSync(dir, {withFileTypes: true})) {
			const p = join(dir, d.name);
			const r = relative(root, p).split(sep).join('/');
			if (ignored.has(`${rel}/${r}`)) continue;
			if (d.isSymbolicLink()) throw new FarmError(`${rel}/${r} is a symbolic link: a gate receipt binds file contents, so a script folder may not hold links`);
			if (d.isDirectory()) walk(p);
			else if (d.isFile()) out.push(r);
			else throw new FarmError(`${rel}/${r} is not a regular file`);
		}
	};
	walk(root);
	return out.sort();
};

/** sha256 over a script folder: for each file in order, "<relative path>\0<its sha256>\n". */
export const contentSha256 = (project: string, rel: string): string => {
	const h = createHash('sha256');
	h.update('zoora-farm-content-v1\n');
	for (const f of contentFiles(project, rel)) h.update(`${f}\0${sha256Hex(readFileSync(join(project, rel, f)))}\n`);
	return h.digest('hex');
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
	requestSha256: r.requestSha256,
	validatedAt: r.validatedAt,
	claimGate: r.claimGate,
	targets: r.targets,
});

export const receiptDigest = (r: ReceiptBody): string => sha256Hex(`${RECEIPT_KIND}\n${canonicalJson(bodyOf(r))}`);

/** Everything a receipt proves, without the time it was written. */
const bindingOf = (r: ReceiptBody): string => canonicalJson({...bodyOf(r), validatedAt: null});

/** The last commit of scripts/claims and whether it has uncommitted changes (git, run once per validate). */
export const claimGateVersion = (project: string): ClaimGateVersion => {
	const git = (args: string[]) => spawnSync('git', args, {cwd: project, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']});
	const log = git(['log', '-1', '--format=%H', '--', CLAIMS_DIR]);
	const sha = log.status === 0 ? log.stdout.trim() : '';
	const status = git(['status', '--porcelain', '--', CLAIMS_DIR]);
	return {commit: COMMIT_RE.test(sha) ? sha : null, uncommitted: status.status === 0 && status.stdout.trim() !== ''};
};

export type ReceiptInput = {
	project: string;
	id: string;
	/** The request file's bytes, exactly as they will be committed. */
	requestBytes: Uint8Array;
	/** Every gate target of the request (gates.ts gateTargets); each passed its claim gate with the names checked. */
	targets: GateTarget[];
	claimGate: ClaimGateVersion;
	now: Date;
};

export const buildReceipt = (i: ReceiptInput): Receipt => {
	const hashes = new Map<string, string>();
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
		requestSha256: sha256Hex(i.requestBytes),
		validatedAt: i.now.toISOString(),
		claimGate: {commit: i.claimGate.commit, uncommitted: i.claimGate.uncommitted},
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
	if (typeof x.requestSha256 !== 'string' || !HEX64.test(x.requestSha256)) return 'requestSha256';
	if (typeof x.validatedAt !== 'string' || !ISO_RE.test(x.validatedAt) || Number.isNaN(Date.parse(x.validatedAt))) return 'validatedAt';
	const g = x.claimGate;
	if (!isPlainObject(g) || !sameKeys(g, GATE_KEYS) || !(g.commit === null || (typeof g.commit === 'string' && COMMIT_RE.test(g.commit))) || typeof g.uncommitted !== 'boolean') return 'claimGate';
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

/** Removes request <id>'s receipt; true when there was one. */
export const removeReceipt = (project: string, id: string): boolean => {
	if (!ID_RE.test(id)) return false;
	const path = join(project, receiptPath(id));
	if (!existsSync(path)) return false;
	rmSync(path, {force: true});
	return true;
};

/**
 * The plan's check: the request's receipt exists, is one validate wrote (shape, digest), is for this request file
 * (its sha256), covers exactly the request's gate targets, records a passing claim gate with the names checked for
 * each, and every script folder still hashes to what it recorded. Returns the receipt, or the first problem as a short
 * phrase that names files and targets, never content.
 */
export const verifyReceipt = (project: string, id: string, requestBytes: Uint8Array, targets: GateTarget[]): {ok: true; receipt: Receipt} | {ok: false; problem: string} => {
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
	if (r.requestSha256 !== sha256Hex(requestBytes)) return fail(`the gate receipt ${rel} is stale: the request file changed after validate wrote it`);
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
			try {
				h = contentSha256(project, dir);
			} catch (e) {
				return fail(e instanceof FarmError ? e.message : `${dir} could not be read`);
			}
			hashes.set(dir, h);
		}
		if (have.get(targetKey(t))?.contentSha256 !== h) stale.add(dir);
	}
	if (stale.size) return fail(`the gate receipt ${rel} is stale: ${[...stale].join(', ')} changed after validate wrote it`);
	return {ok: true, receipt: r};
};
