/**
 * Small helpers shared by the uploader: hashing, canonical JSON, atomic writes, file reads and image sniffing.
 * Erasable TypeScript only (Node runs these files directly with type stripping).
 */
import {createHash} from 'node:crypto';
import {closeSync, createReadStream, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync} from 'node:fs';
import {basename, dirname, extname, join} from 'node:path';

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
export const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
export const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** A refusal or input problem, each with a stable code (tests and other tools match on it) and a plain message. */
export type Reason = {code: string; message: string};

/** Bad input: unreadable files, invalid JSON, a wrong flag. CLI exit code 2. */
export class UsageError extends Error {
	readonly reasons: Reason[];
	constructor(reasons: Reason[] | string) {
		const list = typeof reasons === 'string' ? [{code: 'usage', message: reasons}] : reasons;
		super(list.map((r) => r.message).join('\n'));
		this.name = 'UsageError';
		this.reasons = list;
	}
}

/** The uploader will not do this: no or stale approval, hash mismatch, already uploaded, quota, wrong channel. Exit code 3. */
export class Refusal extends Error {
	readonly reasons: Reason[];
	constructor(reasons: Reason[] | Reason) {
		const list = Array.isArray(reasons) ? reasons : [reasons];
		super(list.map((r) => r.message).join('\n'));
		this.name = 'Refusal';
		this.reasons = list;
	}
}

export const sha256Hex = (data: Uint8Array | string): string => createHash('sha256').update(data).digest('hex');

/** Streams a file through SHA-256 (renders can be gigabytes). */
export const hashFile = (path: string): Promise<{sha256: string; bytes: number}> =>
	new Promise((resolve, reject) => {
		const hash = createHash('sha256');
		let bytes = 0;
		const stream = createReadStream(path, {highWaterMark: 1 << 20});
		stream.on('data', (chunk) => {
			const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
			hash.update(buffer);
			bytes += buffer.length;
		});
		stream.on('error', reject);
		stream.on('end', () => resolve({sha256: hash.digest('hex'), bytes}));
	});

const sortKeys = (value: unknown): unknown => {
	if (Array.isArray(value)) return value.map(sortKeys);
	if (isRecord(value)) {
		return Object.fromEntries(
			Object.keys(value)
				.filter((key) => value[key] !== undefined)
				.sort()
				.map((key) => [key, sortKeys(value[key])]),
		);
	}
	return value;
};

/** JSON with object keys sorted at every level, so equal content always hashes the same. */
export const canonicalJson = (value: unknown): string => JSON.stringify(sortKeys(value));

/** Writes through a temporary file in the same folder, then renames: a crash never leaves half a state file. */
export const writeFileAtomic = (path: string, content: string | Uint8Array, mode = 0o600): void => {
	mkdirSync(dirname(path), {recursive: true, mode: 0o700});
	const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
	writeFileSync(tmp, content, {mode});
	renameSync(tmp, path);
};

export const writeJsonAtomic = (path: string, data: unknown, mode = 0o600): void => writeFileAtomic(path, `${JSON.stringify(data, null, 2)}\n`, mode);

/** Reads and parses a JSON file; a missing or broken file is a UsageError that names `what`. */
export const readJson = (path: string, what: string): unknown => {
	let text: string;
	try {
		text = readFileSync(path, 'utf8');
	} catch {
		throw new UsageError([{code: 'file-missing', message: `${what} not found: ${path}`}]);
	}
	try {
		return JSON.parse(text);
	} catch (error) {
		throw new UsageError([{code: 'bad-json', message: `${what} is not valid JSON: ${path} (${(error as Error).message})`}]);
	}
};

/** Reads bytes start..end (inclusive) of a file. */
export const readRange = (path: string, start: number, end: number): Buffer => {
	const length = end - start + 1;
	const buffer = Buffer.alloc(length);
	const fd = openSync(path, 'r');
	try {
		let offset = 0;
		while (offset < length) {
			const read = readSync(fd, buffer, offset, length - offset, start + offset);
			if (read === 0) throw new Error(`${path} ended at byte ${start + offset}, before byte ${end}: the file changed`);
			offset += read;
		}
	} finally {
		closeSync(fd);
	}
	return buffer;
};

/** Size and modification time: checked before every chunk so a file that changes mid-upload is caught. */
export type FileStamp = {bytes: number; mtimeMs: number};
export const fileStamp = (path: string): FileStamp => {
	const stat = statSync(path);
	return {bytes: stat.size, mtimeMs: Math.floor(stat.mtimeMs)};
};

export type ImageInfo = {mimeType: 'image/png' | 'image/jpeg'; width: number; height: number};

/** PNG or JPEG type and pixel size from the file's own header (never from its extension). */
export const sniffImage = (data: Uint8Array): ImageInfo | null => {
	const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
	const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
	if (buf.length >= 24 && png.every((byte, i) => buf[i] === byte)) {
		if (buf.toString('latin1', 12, 16) !== 'IHDR') return null;
		return {mimeType: 'image/png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20)};
	}
	if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
		let i = 2;
		while (i + 9 < buf.length) {
			if (buf[i] !== 0xff) return null;
			const marker = buf[i + 1];
			if (marker === 0xff) {
				i++; // fill byte
				continue;
			}
			if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
				i += 2; // markers without a length
				continue;
			}
			if (marker === 0xd9 || marker === 0xda) return null; // end of image or start of scan before any frame header
			const length = buf.readUInt16BE(i + 2);
			const frame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
			if (frame) return {mimeType: 'image/jpeg', height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7)};
			i += 2 + length;
		}
	}
	return null;
};

const VIDEO_TYPES: Record<string, string> = {
	'.mp4': 'video/mp4',
	'.m4v': 'video/x-m4v',
	'.mov': 'video/quicktime',
	'.webm': 'video/webm',
	'.mkv': 'video/x-matroska',
};

/** The X-Upload-Content-Type for a render; YouTube accepts any video/* type or application/octet-stream. */
export const videoMimeType = (path: string): string => VIDEO_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';

export const utf8Bytes = (text: string): number => Buffer.byteLength(text, 'utf8');

/** YouTube's tag budget (video resource, snippet.tags[]): lengths + 2 quotes per tag with a space + the commas. */
export const youtubeTagsLength = (tags: readonly string[]): number =>
	tags.reduce((sum, tag) => sum + tag.length + (/\s/.test(tag) ? 2 : 0), 0) + Math.max(0, tags.length - 1);

/** Human-readable byte size. */
export const formatBytes = (bytes: number): string => {
	if (bytes < 1024) return `${bytes} B`;
	const units = ['KiB', 'MiB', 'GiB', 'TiB'];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
};

/** Hides the upload_id of a resumable session URI (it lets anyone holding the access token continue the upload). */
export const redactSessionUri = (uri: string): string => uri.replace(/(upload_id=)([^&]{4})[^&]*/, '$1$2…');

/** Converts the pipeline's language code (en, pt-br, zh) or any BCP-47 tag to YouTube's form; null if malformed. */
export const bcp47 = (code: string, map: Record<string, string>): string | null => {
	const mapped = map[code.toLowerCase()];
	if (mapped) return mapped;
	const match = /^([a-zA-Z]{2,3})(?:-([a-zA-Z]{4}))?(?:-([a-zA-Z]{2}|\d{3}))?$/.exec(code);
	if (!match) return null;
	const [, language, script, region] = match;
	return [language.toLowerCase(), script ? script[0].toUpperCase() + script.slice(1).toLowerCase() : null, region ? region.toUpperCase() : null].filter(Boolean).join('-');
};
