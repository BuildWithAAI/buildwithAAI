/**
 * One build or approve per episode at a time: an exclusive lock file holding the pid, the start time and a random
 * token.
 *   - The lock appears with its content in one step: the JSON is written to a private temp file, which is then
 *     hard-linked to the lock path (link fails if the lock exists). Nobody can see an empty lock.
 *   - A lock that cannot be read (written by an older version, or a disk fault) is busy while it is younger than 30 s
 *     by mtime, and stale after that.
 *   - A lock whose process is gone, or that is older than 2 hours, is stale. Taking it over is atomic: it is renamed
 *     to a name only this run uses, and the run checks it moved the very lock it judged stale (else it puts it back).
 *   - release() removes the lock only while it still carries this run's token.
 */
import {randomBytes} from 'node:crypto';
import {linkSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {dirname} from 'node:path';

const STALE_MS = 2 * 3_600_000;
const UNREADABLE_GRACE_MS = 30_000;

const alive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		return (err as NodeJS.ErrnoException).code === 'EPERM';
	}
};

type LockInfo = {pid?: number; startedAt?: string; token?: string};

const readLock = (path: string): {raw: string; info: LockInfo | null; mtimeMs: number} | null => {
	let raw: string;
	let mtimeMs: number;
	try {
		raw = readFileSync(path, 'utf8');
		mtimeMs = statSync(path).mtimeMs;
	} catch {
		return null; // gone in the meantime
	}
	try {
		const v = JSON.parse(raw) as unknown;
		return {raw, info: v && typeof v === 'object' && !Array.isArray(v) ? (v as LockInfo) : null, mtimeMs};
	} catch {
		return {raw, info: null, mtimeMs};
	}
};

export const acquireLock = (path: string, now: () => Date = () => new Date()): {ok: true; release: () => void; token: string} | {ok: false; reason: string} => {
	mkdirSync(dirname(path), {recursive: true});
	const token = randomBytes(12).toString('hex');
	const body = JSON.stringify({pid: process.pid, startedAt: now().toISOString(), token});
	const tmp = `${path}.${token}.tmp`;
	const release = () => {
		const cur = readLock(path);
		if (cur?.info?.token === token) rmSync(path, {force: true});
	};
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			writeFileSync(tmp, body, {flag: 'wx'});
			try {
				linkSync(tmp, path);
				return {ok: true, release, token};
			} catch (err) {
				const code = (err as NodeJS.ErrnoException).code;
				if (code !== 'EPERM' && code !== 'ENOTSUP' && code !== 'EOPNOTSUPP' && code !== 'ENOSYS') throw err;
				// no hard links on this filesystem: exclusive create, then write (an empty lock reads as busy, below)
				writeFileSync(path, body, {flag: 'wx'});
				return {ok: true, release, token};
			} finally {
				rmSync(tmp, {force: true});
			}
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== 'EEXIST') return {ok: false, reason: `Cannot create the lock ${path}: ${(err as Error).message}`};
		}
		const cur = readLock(path);
		if (!cur) continue; // released in the meantime: try again
		const t = now().getTime();
		if (!cur.info) {
			// the file's own clock (mtime) against the real clock: a holder may be between create and write
			if (Date.now() - cur.mtimeMs < UNREADABLE_GRACE_MS) return {ok: false, reason: `Another daily run is creating the lock ${path}. Wait a moment and run again.`};
		} else {
			const age = cur.info.startedAt ? t - Date.parse(cur.info.startedAt) : Infinity;
			const running = typeof cur.info.pid === 'number' && cur.info.pid !== process.pid && alive(cur.info.pid) && age < STALE_MS;
			if (running) return {ok: false, reason: `Another daily run (pid ${cur.info.pid}, started ${cur.info.startedAt}) is working on this episode. Wait for it, or delete ${path} if it crashed.`};
		}
		// stale: move it aside under a name only this run uses, then check it is the lock that was judged stale
		const grave = `${path}.stale-${token}`;
		try {
			renameSync(path, grave);
		} catch {
			continue; // someone else moved it first
		}
		let moved = '';
		try {
			moved = readFileSync(grave, 'utf8');
		} catch {
			// unreadable: treat as the one judged
			moved = cur.raw;
		}
		if (moved !== cur.raw) {
			// a fresh lock replaced the stale one between the read and the rename: put it back and report busy
			try {
				linkSync(grave, path);
			} catch {
				// the path is taken again; the fresh holder keeps it
			}
			rmSync(grave, {force: true});
			return {ok: false, reason: `Another daily run took the lock ${path} just now. Wait for it.`};
		}
		rmSync(grave, {force: true});
	}
	return {ok: false, reason: `Could not take the lock ${path}.`};
};
