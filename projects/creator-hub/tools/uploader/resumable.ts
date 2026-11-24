/**
 * The resumable upload protocol (contracts.ts: using_resumable_upload_protocol, updated 2026-11-12): start a session
 * (POST, metadata only, answer 200 + Location), PUT the file in chunks (multiples of 256 KiB; 308 + Range after each
 * chunk, 200/201 + the video resource after the last), and after a lost connection or a 5xx ask where YouTube stands
 * (PUT with Content-Range "bytes STAR/TOTAL") and continue from the byte after its Range.
 *
 * The session URI and the confirmed byte count are saved to the job state after every step, so a new process picks
 * up the same session (a session that expired, 404, is never silently restarted: see restartExpired).
 *
 * What it guards:
 * - The session URI must be on the upload endpoint's origin (https://www.googleapis.com), both when YouTube hands it
 *   out (Location) and when a run resumes it from the job file: the access token and the video never go anywhere else.
 * - The bytes actually sent: a SHA-256 runs over every chunk as it is read (re-reading the confirmed prefix when a
 *   run resumes or YouTube kept less than was sent). Before the LAST chunk goes out, that digest must equal the
 *   approved SHA-256, or nothing more is sent: YouTube only creates the video when it has every byte. The caller
 *   uploads from a private staged copy (apply.ts), so a render rewritten on disk mid-upload cannot reach YouTube.
 */
import {createHash, type Hash} from 'node:crypto';
import {closeSync, openSync, readSync} from 'node:fs';
import {RETRY} from './contracts.ts';
import type {Api} from './api.ts';
import {backoffMs, type HttpResponse, isRetryable, NetworkError, parseApiError, parseRetryAfter} from './http.ts';
import {type RequestSpec, uploadChunk, uploadStatus} from './requests.ts';
import {fileStamp, type FileStamp, readRange, redactSessionUri, Refusal} from './util.ts';

/** `sha256` is the APPROVED hash: the bytes sent must hash to it before the last chunk goes out. */
export type UploadFile = {path: string; bytes: number; mimeType: string; stamp: FileStamp; sha256: string};

export type SessionState = {
	sessionUri: string | null;
	sessionStartedAt: string | null;
	sessions: number;
	confirmedBytes: number;
	stamp: FileStamp | null;
	/** SHA-256 of the bytes sent, checked against the approval just before the last chunk (null until then). */
	sentSha256: string | null;
};

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
	/** The only origin a session URI may have: the upload endpoint's (contracts.ts GOOGLE.upload). */
	uploadOrigin: string;
	/** Runs just before a NEW session starts (never when an existing one is resumed): the duplicate check. */
	beforeNewSession?: () => Promise<void>;
};

type Status = {kind: 'complete'; response: HttpResponse} | {kind: 'incomplete'; next: number} | {kind: 'expired'};

/** "bytes=0-999999" -> 1000000; no Range header -> 0 (nothing stored yet). */
export const nextByteFromRange = (range: string | null): number => {
	if (!range) return 0;
	const m = /^bytes=0-(\d+)$/.exec(range.trim());
	if (!m) throw new Error(`YouTube sent an unexpected Range header: "${range}"`);
	return Number(m[1]) + 1;
};

/** Why a session URI may not be used (null = it may): it must be an https URL on the upload endpoint's origin. */
export const sessionUriProblem = (uri: string, uploadOrigin: string): string | null => {
	let url: URL;
	try {
		url = new URL(uri);
	} catch {
		return 'it is not a URL';
	}
	if (url.protocol !== 'https:') return `it is not https (${url.protocol})`;
	if (url.origin !== uploadOrigin) return `its origin is ${url.origin}, not ${uploadOrigin}`;
	if (url.username || url.password) return 'it carries a user name or password';
	return null;
};

/** Time allowed for one chunk: a minute plus the chunk at 64 KiB/s. */
const chunkTimeoutMs = (bytes: number): number => 60_000 + Math.ceil(bytes / 65_536) * 1000;

/** Feeds bytes start..end-1 of a file into a hash, 1 MiB at a time. */
const hashRange = (hash: Hash, path: string, start: number, end: number): void => {
	const fd = openSync(path, 'r');
	try {
		const buffer = Buffer.alloc(1 << 20);
		for (let at = start; at < end; ) {
			const read = readSync(fd, buffer, 0, Math.min(buffer.length, end - at), at);
			if (read === 0) throw new Refusal({code: 'file-changed', message: `${path} ended at byte ${at}, before byte ${end}: it changed during the upload. Nothing more is sent.`});
			hash.update(buffer.subarray(0, read));
			at += read;
		}
	} finally {
		closeSync(fd);
	}
};

/** SHA-256 over the bytes handed to the network, in file order. */
class SentDigest {
	private hash: Hash = createHash('sha256');
	private upTo = 0;
	private readonly path: string;
	constructor(path: string) {
		this.path = path;
	}

	/** Lines the digest up with `offset`: re-reads a confirmed prefix it has not seen, restarts when YouTube kept less. */
	private align(offset: number): void {
		if (offset < this.upTo) {
			this.hash = createHash('sha256');
			this.upTo = 0;
		}
		if (offset > this.upTo) {
			hashRange(this.hash, this.path, this.upTo, offset);
			this.upTo = offset;
		}
	}

	/** The digest the file would have if `body` (at `offset`) were the last bytes sent. */
	digestWith(offset: number, body: Buffer): string {
		this.align(offset);
		return this.hash.copy().update(body).digest('hex');
	}

	/** Records that `body` was handed to the network at `offset`. */
	sent(offset: number, body: Buffer): void {
		this.align(offset);
		this.hash.update(body);
		this.upTo = offset + body.length;
	}
}

export const runResumableUpload = async (deps: ResumableDeps, session: SessionState, file: UploadFile, opts: ResumableOptions): Promise<unknown> => {
	const maxRetries = opts.maxRetries ?? RETRY.maxRetries;
	if (opts.chunkBytes <= 0 || opts.chunkBytes % 262_144 !== 0) throw new Error('The chunk size must be a positive multiple of 256 KiB.');
	let failures = 0;
	const digest = new SentDigest(file.path);

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
		await opts.beforeNewSession?.();
		const res = await deps.api.call(opts.startRequest, {retry: true});
		const location = res.headers.get('location');
		if (!location) throw new Error(`YouTube accepted the upload request (HTTP ${res.status}) but sent no session URI.`);
		const problem = sessionUriProblem(location, opts.uploadOrigin);
		if (problem) {
			throw new Refusal({
				code: 'session-invalid',
				message: `YouTube's answer named an upload address that is not on ${opts.uploadOrigin} (${problem}). Nothing was sent to it; check that the uploader talks to Google directly (no proxy rewriting answers), then run again.`,
			});
		}
		session.sessionUri = location;
		session.sessionStartedAt = new Date(deps.now()).toISOString();
		session.sessions++;
		session.confirmedBytes = 0;
		session.stamp = file.stamp;
		session.sentSha256 = null;
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

	/** The file read for this upload must not change while it is read (size and modification time, before every chunk). */
	const checkStamp = () => {
		const now = fileStamp(file.path);
		if (now.bytes !== file.stamp.bytes || now.mtimeMs !== file.stamp.mtimeMs) {
			throw new Refusal({code: 'file-changed', message: `${file.path} changed during the upload (size or modification time differs). Nothing more is sent; run the same command again: the copy is checked against the approval first.`});
		}
	};

	let uri = session.sessionUri;
	let offset = 0;
	if (uri) {
		const problem = sessionUriProblem(uri, opts.uploadOrigin);
		if (problem && !opts.restartExpired) {
			throw new Refusal({
				code: 'session-invalid',
				message: `The upload session saved in the job file (${redactSessionUri(uri)}) is not a YouTube upload address: ${problem}. Nothing was sent to it, and the access token was not used. The job file was changed outside the uploader: check YouTube Studio for the video, then run again with --restart-upload.`,
			});
		}
		if (problem) {
			deps.log(`  the saved session URI is not a YouTube upload address (${problem}); starting a new session (--restart-upload)`);
			uri = null;
		} else {
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
		if (end === file.bytes - 1) {
			// the last chunk makes the video: the bytes sent must be exactly the approved ones
			const sent = digest.digestWith(offset, body);
			if (sent !== file.sha256) {
				throw new Refusal({
					code: 'render-hash-mismatch',
					message: `The bytes read for this upload hash to ${sent}, not the approved ${file.sha256}. The last chunk was not sent, so YouTube has not created the video. Approve the render again.`,
				});
			}
			session.sentSha256 = sent;
			deps.persist();
		}
		digest.sent(offset, body);
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
