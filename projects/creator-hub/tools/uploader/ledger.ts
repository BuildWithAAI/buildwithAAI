/**
 * Idempotency: the ledger (ledger.json in the gitignored state folder) records every render the uploader has started
 * or finished, keyed by channel + the file's SHA-256. The same file is never uploaded twice to a channel, and a second
 * file for an episode's same render id needs --allow-second-upload. A lock file stops two runs of the same job.
 */
import {existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {UploadPlan} from './plan.ts';
import {isRecord, type Reason, Refusal, writeJsonAtomic} from './util.ts';

export type LedgerStatus = 'uploading' | 'uploaded' | 'complete';

export type LedgerEntry = {
	channel: string;
	slug: string;
	renderId: string;
	sha256: string;
	bytes: number;
	status: LedgerStatus;
	videoId: string | null;
	planSha256: string;
	approvalSha256: string;
	startedAt: string;
	updatedAt: string;
	completedAt: string | null;
};

export type Ledger = {
	readonly path: string;
	entries(): LedgerEntry[];
	find(channel: string, sha256: string): LedgerEntry | null;
	upsert(entry: LedgerEntry): void;
};

const isEntry = (value: unknown): value is LedgerEntry =>
	isRecord(value) &&
	typeof value.channel === 'string' &&
	typeof value.slug === 'string' &&
	typeof value.renderId === 'string' &&
	typeof value.sha256 === 'string' &&
	['uploading', 'uploaded', 'complete'].includes(String(value.status));

export const openLedger = (path: string): Ledger => {
	let entries: LedgerEntry[] = [];
	if (existsSync(path)) {
		const data: unknown = JSON.parse(readFileSync(path, 'utf8'));
		if (!isRecord(data) || data.version !== 1 || !Array.isArray(data.entries)) throw new Error(`${path} is not an uploader ledger (version 1). Do not edit it by hand.`);
		entries = data.entries.filter(isEntry);
	}
	return {
		path,
		entries: () => entries.map((e) => ({...e})),
		find: (channel, sha256) => entries.find((e) => e.channel === channel && e.sha256 === sha256) ?? null,
		upsert(entry) {
			entries = [...entries.filter((e) => !(e.channel === entry.channel && e.sha256 === entry.sha256)), entry];
			writeJsonAtomic(path, {version: 1, note: 'Uploads started or finished by tools/uploader. Keeps the same render from being uploaded twice.', entries});
		},
	};
};

/** Reasons this plan must not be uploaded again (empty = new, or an unfinished upload of the same plan to resume). */
export const ledgerRefusals = (ledger: Ledger, plan: UploadPlan, opts: {allowSecondUpload: boolean}): Reason[] => {
	const reasons: Reason[] = [];
	const same = ledger.find(plan.channel, plan.video.sha256);
	if (same && same.status === 'complete') {
		reasons.push({code: 'already-uploaded', message: `This exact file was already uploaded to ${plan.channel} as https://youtu.be/${same.videoId} (${same.completedAt ?? same.updatedAt}). The ledger prevents a double upload.`});
	} else if (same && same.status === 'uploaded' && same.planSha256 !== plan.digest.sha256) {
		reasons.push({code: 'uploaded-under-other-approval', message: `This file is already on YouTube as https://youtu.be/${same.videoId}, uploaded under an earlier approval with different metadata. Finish that upload with its own approval, and make metadata changes in Studio.`});
	}
	if (!opts.allowSecondUpload) {
		const others = ledger.entries().filter((e) => e.channel === plan.channel && e.slug === plan.slug && e.renderId === plan.renderId && e.sha256 !== plan.video.sha256 && e.status !== 'uploading');
		for (const other of others) {
			reasons.push({
				code: 'episode-already-uploaded',
				message: `${plan.slug} "${plan.renderId}" was already uploaded as https://youtu.be/${other.videoId} (a different file, ${other.updatedAt}). A second upload duplicates the episode on the channel; if that is intended (a corrected re-cut), pass --allow-second-upload.`,
			});
		}
	}
	return reasons;
};

/* ------------------------------------------------------------------ lock */

const alive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === 'EPERM';
	}
};

/** Creates <dir>/<name>.lock exclusively; a lock left by a process that no longer runs is taken over. Returns release(). */
export const acquireLock = (dir: string, name: string, nowIso: string): (() => void) => {
	mkdirSync(dir, {recursive: true, mode: 0o700});
	const path = join(dir, `${name}.lock`);
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			writeFileSync(path, JSON.stringify({pid: process.pid, startedAt: nowIso}), {flag: 'wx', mode: 0o600});
			return () => {
				try {
					unlinkSync(path);
				} catch {
					// already gone
				}
			};
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
			let holder: unknown = null;
			try {
				holder = JSON.parse(readFileSync(path, 'utf8'));
			} catch {
				holder = null;
			}
			const pid = isRecord(holder) && typeof holder.pid === 'number' ? holder.pid : null;
			if (pid !== null && alive(pid)) {
				throw new Refusal({code: 'locked', message: `Another upload of this file is running (process ${pid}, lock ${path}). Wait for it to finish.`});
			}
			try {
				unlinkSync(path); // stale: its process is gone
			} catch {
				// someone else removed it
			}
		}
	}
	throw new Refusal({code: 'locked', message: `Could not take the lock ${path}.`});
};
