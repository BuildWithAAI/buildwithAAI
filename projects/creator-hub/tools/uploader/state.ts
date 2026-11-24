/**
 * Job state: one file per upload in <state>/jobs/, rewritten atomically after every step, so an interrupted run
 * (network loss, crash, closed laptop, out of quota) resumes where it stopped: the resumable session URI and the bytes
 * YouTube confirmed, then which of thumbnail, captions and playlist are done.
 */
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {UploadPlan} from './plan.ts';
import {type FileStamp, isRecord, writeJsonAtomic} from './util.ts';

/** What YouTube answered when the upload finished (the parts the uploader checks). */
export type InsertResult = {
	videoId: string;
	privacyStatus: string | null;
	publishAt: string | null;
	selfDeclaredMadeForKids: boolean | null;
	containsSyntheticMedia: boolean | null;
	defaultLanguage: string | null;
	defaultAudioLanguage: string | null;
	localizations: string[];
	uploadStatus: string | null;
	failureReason: string | null;
	rejectionReason: string | null;
};

export type JobState = {
	version: 1;
	channel: string;
	slug: string;
	renderId: string;
	sha256: string;
	planSha256: string;
	approvalSha256: string;
	/** The approval record's single-use nonce (approval.ts), carried into the ledger and the receipt. */
	approvalNonce: string | null;
	createdAt: string;
	updatedAt: string;
	insert: {
		status: 'pending' | 'session' | 'done';
		sessionUri: string | null;
		sessionStartedAt: string | null;
		sessions: number;
		confirmedBytes: number;
		/** Size and mtime of the staged copy when the session started (for the record; each run re-hashes the copy). */
		stamp: FileStamp | null;
		/** SHA-256 of the bytes actually sent, checked against the approval just before the last chunk. */
		sentSha256: string | null;
		/** The private copy the upload reads (apply.ts stageRender); removed once YouTube has the video. */
		staged: {path: string; sha256: string; bytes: number; verifiedAt: string; removed: boolean} | null;
		result: InsertResult | null;
	};
	privacy: {status: 'pending' | 'ok' | 'forced'; detail: string | null};
	thumbnail: {status: 'pending' | 'done' | 'skipped' | 'manual'; detail: string | null};
	captions: {language: string; name: string; status: 'pending' | 'done' | 'exists'; captionId: string | null}[];
	playlist: {status: 'pending' | 'done' | 'skipped'; playlistItemId: string | null};
	notes: string[];
	completedAt: string | null;
};

export const jobPath = (stateDir: string, plan: UploadPlan): string => join(stateDir, 'jobs', `${plan.channel}__${plan.slug}__${plan.renderId}__${plan.video.sha256.slice(0, 16)}.json`);

export const newJob = (plan: UploadPlan, approvalSha256: string, approvalNonce: string | null, nowIso: string): JobState => ({
	version: 1,
	channel: plan.channel,
	slug: plan.slug,
	renderId: plan.renderId,
	sha256: plan.video.sha256,
	planSha256: plan.digest.sha256,
	approvalSha256,
	approvalNonce,
	createdAt: nowIso,
	updatedAt: nowIso,
	insert: {status: 'pending', sessionUri: null, sessionStartedAt: null, sessions: 0, confirmedBytes: 0, stamp: null, sentSha256: null, staged: null, result: null},
	privacy: {status: 'pending', detail: null},
	thumbnail: {status: plan.thumbnail ? 'pending' : 'skipped', detail: null},
	captions: plan.captions.map((c) => ({language: c.language, name: c.name, status: 'pending', captionId: null})),
	playlist: {status: plan.playlistId ? 'pending' : 'skipped', playlistItemId: null},
	notes: [],
	completedAt: null,
});

export const loadJob = (path: string): JobState | null => {
	if (!existsSync(path)) return null;
	const data: unknown = JSON.parse(readFileSync(path, 'utf8'));
	if (!isRecord(data) || data.version !== 1 || !isRecord(data.insert)) throw new Error(`${path} is not an uploader job file (version 1). Do not edit it by hand.`);
	const job = data as JobState;
	// fields added after the first release default to "not recorded"
	job.approvalNonce ??= null;
	job.insert.sentSha256 ??= null;
	job.insert.staged ??= null;
	return job;
};

export const saveJob = (path: string, job: JobState, nowIso: string): void => {
	job.updatedAt = nowIso;
	writeJsonAtomic(path, job);
};
