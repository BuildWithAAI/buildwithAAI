/** File helpers for the news gate: JSON reads with hashes, and atomic writes (temp file + rename). */
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {dirname} from 'node:path';

export type JsonRead = {ok: true; data: unknown; sha256: string} | {ok: false; missing: boolean; error: string; sha256: string | null};

export const sha256 = (buf: Buffer | string): string => createHash('sha256').update(buf).digest('hex');

export const readJson = (path: string): JsonRead => {
	if (!existsSync(path)) return {ok: false, missing: true, error: `not found: ${path}`, sha256: null};
	let buf: Buffer;
	try {
		buf = readFileSync(path);
	} catch (err) {
		return {ok: false, missing: false, error: `cannot read ${path}: ${err instanceof Error ? err.message : String(err)}`, sha256: null};
	}
	const hash = sha256(buf);
	try {
		return {ok: true, data: JSON.parse(buf.toString('utf8').replace(/^﻿/, '')), sha256: hash};
	} catch (err) {
		return {ok: false, missing: false, error: `invalid JSON in ${path}: ${err instanceof Error ? err.message : String(err)}`, sha256: hash};
	}
};

/** Write via a temp file in the same folder, then rename, so a reader never sees half a file. (*.tmp is gitignored.) */
export const writeAtomic = (path: string, content: string): void => {
	mkdirSync(dirname(path), {recursive: true});
	const tmp = `${path}.${process.pid}.tmp`;
	writeFileSync(tmp, content);
	renameSync(tmp, path);
};
