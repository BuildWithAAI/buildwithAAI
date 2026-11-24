/**
 * One build or approve per episode at a time: an exclusive lock file holding the pid and start time. A lock whose
 * process is gone, or that is older than 2 hours, is stale and is taken over.
 */
import {mkdirSync, openSync, readFileSync, rmSync, writeSync, closeSync} from 'node:fs';
import {dirname} from 'node:path';

const STALE_MS = 2 * 3_600_000;

const alive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		return (err as NodeJS.ErrnoException).code === 'EPERM';
	}
};

export const acquireLock = (path: string, now: () => Date = () => new Date()): {ok: true; release: () => void} | {ok: false; reason: string} => {
	mkdirSync(dirname(path), {recursive: true});
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const fd = openSync(path, 'wx');
			writeSync(fd, JSON.stringify({pid: process.pid, startedAt: now().toISOString()}));
			closeSync(fd);
			return {ok: true, release: () => rmSync(path, {force: true})};
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== 'EEXIST') return {ok: false, reason: `Cannot create the lock ${path}: ${(err as Error).message}`};
			let info: {pid?: number; startedAt?: string} = {};
			try {
				info = JSON.parse(readFileSync(path, 'utf8')) as typeof info;
			} catch {
				// unreadable: treat as stale
			}
			const age = info.startedAt ? now().getTime() - Date.parse(info.startedAt) : Infinity;
			const running = typeof info.pid === 'number' && info.pid !== process.pid && alive(info.pid) && age < STALE_MS;
			if (running) return {ok: false, reason: `Another daily run (pid ${info.pid}, started ${info.startedAt}) is working on this episode. Wait for it, or delete ${path} if it crashed.`};
			rmSync(path, {force: true});
		}
	}
	return {ok: false, reason: `Could not take the lock ${path}.`};
};
