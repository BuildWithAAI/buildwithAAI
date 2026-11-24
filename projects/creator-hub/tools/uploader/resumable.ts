/**
 * The resumable upload protocol (contracts.ts: using_resumable_upload_protocol, updated 2026-11-12):
 * start a session (POST, metadata only, answer 200 + Location), PUT the file in chunks (multiples of 256 KiB; 308 +
 * Range after each chunk, 200/201 + the video resource after the last), and after a lost connection or a 5xx ask
 * where YouTube stands (PUT with Content-Range "bytes STAR/TOTAL") and continue from the byte after its Range.
 *
 * The session URI and the confirmed byte count are saved to the job state after every step, so a new process picks
 * up the same session (a session that expired, 404, is never silently restarted: see restartExpired).
 */
import {RETRY} from './contracts.ts';
import type {Api} from './api.ts';
import {backoffMs, type HttpResponse, isRetryable, NetworkError, parseApiError, parseRetryAfter} from './http.ts';
import {type RequestSpec, uploadChunk, uploadStatus} from './requests.ts';
import {fileStamp, type FileStamp, readRange, Refusal} from './util.ts';

export type UploadFile = {path: string; bytes: number; mimeType: string; stamp: FileStamp};

export type SessionState = {sessionUri: string | null; sessionStartedAt: string | null; sessions: number; confirmedBytes: number; stamp: FileStamp | null};

export type ResumableDeps = {
	api: Api;
	sleep: (ms: number) => Promise<void>;
	random: () => number;
	now: () => number;
	log: (line: string) => void;
	/** Saves the job state (called after every change to `session`). */
	persist: () => void;
};

export type ResumableOptions = {
	chunkBytes: number;
	/** Start a new session when the saved one expired (404). Off by default: see README "Resume". */
	restartExpired: boolean;
	maxRetries?: number;
	/** The request that starts a session (videos.insert with the video resource). */
	startRequest: RequestSpec;
	title: string;
};

type Status = {kind: 'complete'; response: HttpResponse} | {kind: 'incomplete'; next: number} | {kind: 'expired'};

/** "bytes=0-999999" -> 1000000; no Range header -> 0 (nothing stored yet). */
export const nextByteFromRange = (range: string | null): number => {
	if (!range) return 0;
	const m = /^bytes=0-(\d+)$/.exec(range.trim());
	if (!m) throw new Error(`YouTube sent an unexpected Range header: "${range}"`);
	return Number(m[1]) + 1;
};

/** Time allowed for one chunk: a minute plus the chunk at 64 KiB/s. */
const chunkTimeoutMs = (bytes: number): number => 60_000 + Math.ceil(bytes / 65_536) * 1000;

export const runResumableUpload = async (deps: ResumableDeps, session: SessionState, file: UploadFile, opts: ResumableOptions): Promise<unknown> => {
	const maxRetries = opts.maxRetries ?? RETRY.maxRetries;
	if (opts.chunkBytes <= 0 || opts.chunkBytes % 262_144 !== 0) throw new Error('The chunk size must be a positive multiple of 256 KiB.');
	let failures = 0;

	const fail = async (what: string, retryAfter: string | null): Promise<void> => {
		failures++;
		if (failures > maxRetries) throw new Error(`The upload failed ${failures} times in a row (${what}). The session is saved: run the same command again to resume.`);
		const wait = backoffMs(failures, deps.random, parseRetryAfter(retryAfter, deps.now()));
		deps.log(`  upload: ${what}; retry ${failures}/${maxRetries} in ${Math.round(wait / 1000)} s`);
		await deps.sleep(wait);
	};

	const parse = (res: HttpResponse): unknown => {
		try {
			return JSON.parse(res.text);
		} catch {
			throw new Error(`YouTube finished the upload (HTTP ${res.status}) but its answer was not JSON.`);
		}
	};

	const query = async (uri: string): Promise<Status> => {
		let refreshed = false;
		for (;;) {
			let res: HttpResponse;
			try {
				res = await deps.api.raw(uploadStatus(uri, file.bytes), 60_000);
			} catch (error) {
				if (!(error instanceof NetworkError)) throw error;
				await fail(`status check: ${error.message}`, null);
				continue;
			}
			if (res.status === 200 || res.status === 201) return {kind: 'complete', response: res};
			if (res.status === 308) return {kind: 'incomplete', next: nextByteFromRange(res.headers.get('range'))};
			if (res.status === 404 || res.status === 410) return {kind: 'expired'};
			if (res.status === 401 && !refreshed) {
				refreshed = true;
				await deps.api.refresh();
				continue;
			}
			const error = parseApiError('videos.insert', res);
			if (!isRetryable(error)) throw error;
			await fail(`status check: HTTP ${res.status}`, res.headers.get('retry-after'));
		}
	};

	const start = async (): Promise<string> => {
		const res = await deps.api.call(opts.startRequest, {retry: true});
		const location = res.headers.get('location');
		if (!location || !/^https:\/\//.test(location)) throw new Error(`YouTube accepted the upload request (HTTP ${res.status}) but sent no session URI.`);
		session.sessionUri = location;
		session.sessionStartedAt = new Date(deps.now()).toISOString();
		session.sessions++;
		session.confirmedBytes = 0;
		session.stamp = file.stamp;
		deps.persist();
		deps.log(`  upload session ${session.sessions} started`);
		return location;
	};

	const expired = (): Refusal =>
		new Refusal({
			code: 'session-expired',
			message:
				`The saved upload session expired before YouTube confirmed the upload. Check YouTube Studio > Content for a private video titled "${opts.title}"` +
				`${session.sessionStartedAt ? ` uploaded around ${session.sessionStartedAt}` : ''}. If there is none, run again with --restart-upload; if there is one, do not upload again.`,
		});

	const checkStamp = () => {
		const now = fileStamp(file.path);
		if (now.bytes !== file.stamp.bytes || now.mtimeMs !== file.stamp.mtimeMs || (session.stamp && (session.stamp.bytes !== now.bytes || session.stamp.mtimeMs !== now.mtimeMs))) {
			throw new Refusal({code: 'file-changed', message: `${file.path} changed after it was hashed for the approval (size or modification time differs). Nothing more is sent; approve the new render again.`});
		}
	};

	let uri = session.sessionUri;
	let offset = 0;
	if (uri) {
		const status = await query(uri);
		if (status.kind === 'complete') return parse(status.response);
		if (status.kind === 'incomplete') {
			offset = status.next;
			deps.log(`  resuming at byte ${offset} of ${file.bytes}`);
		} else {
			if (!opts.restartExpired) throw expired();
			uri = null;
		}
	}
	if (!uri) uri = await start();

	for (;;) {
		if (offset >= file.bytes) {
			// YouTube holds every byte but has not answered with the video: ask once more
			const status = await query(uri);
			if (status.kind === 'complete') return parse(status.response);
			if (status.kind === 'expired') throw expired();
			if (status.next >= file.bytes) {
				await fail('all bytes sent, waiting for YouTube to finish', null);
				continue;
			}
			offset = status.next;
		}
		checkStamp();
		const end = Math.min(offset + opts.chunkBytes, file.bytes) - 1;
		const body = readRange(file.path, offset, end);
		let res: HttpResponse;
		try {
			res = await deps.api.raw(uploadChunk(uri, file.mimeType, offset, end, file.bytes, body), chunkTimeoutMs(body.length));
		} catch (error) {
			if (!(error instanceof NetworkError)) throw error;
			await fail(error.message, null);
			const status = await query(uri);
			if (status.kind === 'complete') return parse(status.response);
			if (status.kind === 'expired') throw expired();
			offset = status.next;
			continue;
		}
		if (res.status === 200 || res.status === 201) return parse(res);
		if (res.status === 308) {
			const sentFrom = offset;
			offset = nextByteFromRange(res.headers.get('range'));
			session.confirmedBytes = offset;
			deps.persist();
			if (offset <= sentFrom) {
				await fail(`YouTube confirmed no new bytes (still at ${offset})`, res.headers.get('retry-after'));
				continue;
			}
			failures = 0;
			deps.log(`  ${offset} of ${file.bytes} bytes confirmed`);
			continue;
		}
		if (res.status === 404 || res.status === 410) throw expired();
		const error = parseApiError('videos.insert', res);
		if (res.status === 401) {
			await deps.api.refresh();
			await fail('access token expired', null);
		} else if (isRetryable(error)) {
			await fail(`HTTP ${res.status} ${error.reason}`, res.headers.get('retry-after'));
		} else {
			throw error;
		}
		const status = await query(uri);
		if (status.kind === 'complete') return parse(status.response);
		if (status.kind === 'expired') throw expired();
		offset = status.next;
	}
};
