/**
 * Small helpers shared by the weekly batch: JSON files (atomic writes), SHA-256 of buffers and of large files
 * (streamed, so a long render never sits in memory), and plain-object checks. No dependencies.
 */
import {createHash} from 'node:crypto';
import {createReadStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync} from 'node:fs';
import {dirname, isAbsolute, join, relative} from 'node:path';

/** Bad command-line input or an unreadable input file: exit code 2. Every reason is listed. */
export class UsageError extends Error {
	readonly reasons: string[];
	constructor(reasons: string | string[]) {
		const list = Array.isArray(reasons) ? reasons : [reasons];
		super(list.join('\n'));
		this.name = 'UsageError';
		this.reasons = list;
	}
}

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

export const sha256 = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');

/** SHA-256 and size of a file, streamed. null when the file does not exist. */
export const hashFile = async (path: string): Promise<{sha256: string; bytes: number} | null> => {
	if (!existsSync(path) || !statSync(path).isFile()) return null;
	const hash = createHash('sha256');
	let bytes = 0;
	await new Promise<void>((resolveHash, reject) => {
		const stream = createReadStream(path);
		stream.on('data', (chunk) => {
			const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
			bytes += buf.length;
			hash.update(buf);
		});
		stream.on('error', reject);
		stream.on('end', () => resolveHash());
	});
	return {sha256: hash.digest('hex'), bytes};
};

export type JsonRead<T> = {ok: true; data: T; sha256: string} | {ok: false; missing: boolean; error: string};

/** Reads and parses a JSON file; never throws. */
export const readJson = <T = unknown>(path: string): JsonRead<T> => {
	if (!existsSync(path)) return {ok: false, missing: true, error: `${path} does not exist`};
	let text: string;
	try {
		text = readFileSync(path, 'utf8');
	} catch (err) {
		return {ok: false, missing: false, error: `${path} cannot be read (${(err as Error).message})`};
	}
	try {
		return {ok: true, data: JSON.parse(text) as T, sha256: sha256(text)};
	} catch (err) {
		return {ok: false, missing: false, error: `${path} is not valid JSON (${(err as Error).message})`};
	}
};

/** Writes text through a temporary file and a rename, so a reader never sees half a file. */
export const writeTextAtomic = (path: string, text: string): void => {
	mkdirSync(dirname(path), {recursive: true});
	const tmp = `${path}.${process.pid}.tmp`;
	writeFileSync(tmp, text);
	renameSync(tmp, path);
};

export const writeJsonAtomic = (path: string, data: unknown): void => writeTextAtomic(path, `${JSON.stringify(data, null, 2)}\n`);

/** A path for records and pages: relative to `root` with forward slashes when inside it, else absolute. */
export const rel = (root: string, path: string): string => {
	const r = relative(root, path);
	return r && !r.startsWith('..') && !isAbsolute(r) ? r.split('\\').join('/') : path;
};

/** Absolute path for a path written relative to `root`. */
export const fromRoot = (root: string, path: string): string => (isAbsolute(path) ? path : join(root, path));

export const mtimeMs = (path: string): number | null => {
	try {
		return statSync(path).mtimeMs;
	} catch {
		return null;
	}
};

export const unique = <T>(xs: T[]): T[] => [...new Set(xs)];

/** "1.2 MB" style sizes for people. */
export const formatBytes = (bytes: number): string => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : bytes >= 1e3 ? `${(bytes / 1e3).toFixed(0)} kB` : `${bytes} B`);
