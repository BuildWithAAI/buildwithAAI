/**
 * YouTube Data API client for the uploader: adds the access token, charges quota before every attempt (failed
 * requests cost quota too), refreshes the token once on 401, retries transient failures with full-jitter backoff,
 * and runs the privacy guard on every videos.insert and videos.update it sends.
 *
 * Calls that are not idempotent (captions.insert, playlistItems.insert) never blindly retry after an answer was lost:
 * a repeated caption answers 409 captionExists, and the playlist is checked (playlistItems.list, 1 unit) first.
 */
import {type Endpoints, QUOTA} from './contracts.ts';
import {ApiError, backoffMs, type HttpResponse, isRetryable, NetworkError, parseApiError, parseRetryAfter, type Transport} from './http.ts';
import type {TokenSource} from './oauth.ts';
import type {QuotaTracker} from './quota.ts';
import {
	addToPlaylist,
	assertPrivate,
	channelCheck,
	findInPlaylist,
	forcePrivate,
	type ForcePrivateStatus,
	insertCaption,
	listCategories,
	playlistCheck,
	processingStatus,
	recentUploads,
	type RequestSpec,
	setThumbnail,
} from './requests.ts';
import {isRecord, str} from './util.ts';

export type ApiDeps = {
	transport: Transport;
	endpoints: Endpoints;
	tokens: TokenSource;
	quota: QuotaTracker;
	sleep: (ms: number) => Promise<void>;
	random: () => number;
	now: () => number;
	log: (line: string) => void;
	/** Retries for ordinary API calls (the video upload itself uses contracts RETRY.maxRetries). */
	maxRetries?: number;
};

export type RecentUpload = {videoId: string; title: string; publishedAt: string | null; privacyStatus: string | null};

export type Api = {
	/** One authorized request: no quota, no retries. Throws NetworkError when no HTTP answer arrives. */
	raw(request: RequestSpec, timeoutMs: number): Promise<HttpResponse>;
	/** An API method call: quota per attempt, one token refresh on 401, retries when `retry` is set. */
	call(request: RequestSpec, opts: {retry: boolean; timeoutMs?: number}): Promise<HttpResponse>;
	refresh(): Promise<void>;
	myChannel(): Promise<{id: string; title: string; handle: string | null; uploadsPlaylistId: string | null}>;
	/** The channel's most recent uploads (newest first, up to 50), with their privacy as the playlist item reports it. */
	recentUploads(uploadsPlaylistId: string): Promise<RecentUpload[]>;
	playlist(playlistId: string): Promise<{channelId: string; title: string} | null>;
	setThumbnail(videoId: string, mimeType: string, content: Buffer): Promise<void>;
	insertCaption(videoId: string, language: string, name: string, content: Buffer): Promise<{captionId: string | null; existed: boolean}>;
	addToPlaylist(playlistId: string, videoId: string): Promise<{playlistItemId: string | null; existed: boolean}>;
	processingStatus(videoId: string): Promise<string | null>;
	forcePrivate(videoId: string, status: ForcePrivateStatus): Promise<string | null>;
	categories(regionCode: string): Promise<{id: string; title: string; assignable: boolean}[]>;
};

const json = (res: HttpResponse): unknown => {
	try {
		return res.text ? JSON.parse(res.text) : null;
	} catch {
		return null;
	}
};

const items = (body: unknown): Record<string, unknown>[] => (isRecord(body) && Array.isArray(body.items) ? body.items.filter(isRecord) : []);

export const createApi = (deps: ApiDeps): Api => {
	const ep = deps.endpoints;
	const maxRetries = deps.maxRetries ?? 5;

	const raw = async (request: RequestSpec, timeoutMs: number): Promise<HttpResponse> => {
		assertPrivate(request);
		const token = await deps.tokens.getAccessToken();
		try {
			return await deps.transport({method: request.method, url: request.url, headers: {...request.headers, authorization: `Bearer ${token}`}, body: request.body, timeoutMs});
		} catch (error) {
			throw new NetworkError(error);
		}
	};

	const refresh = async (): Promise<void> => {
		await deps.tokens.getAccessToken(true);
	};

	const call = async (request: RequestSpec, opts: {retry: boolean; timeoutMs?: number}): Promise<HttpResponse> => {
		const method = request.apiMethod;
		if (!(method in QUOTA)) throw new Error(`call() is for API methods, not ${method}`);
		let refreshed = false;
		for (let attempt = 1; ; attempt++) {
			deps.quota.spend(method as keyof typeof QUOTA);
			let res: HttpResponse;
			try {
				res = await raw(request, opts.timeoutMs ?? 60_000);
			} catch (error) {
				if (!(error instanceof NetworkError) || !opts.retry || attempt > maxRetries) throw error;
				const wait = backoffMs(attempt, deps.random, null);
				deps.log(`  ${method}: ${error.message}; retrying in ${Math.round(wait / 1000)} s`);
				await deps.sleep(wait);
				continue;
			}
			if (res.status >= 200 && res.status < 300) return res;
			const error = parseApiError(method, res);
			if (res.status === 401 && !refreshed) {
				refreshed = true;
				await refresh();
				continue;
			}
			if (opts.retry && isRetryable(error) && !error.isQuota && attempt <= maxRetries) {
				const wait = backoffMs(attempt, deps.random, parseRetryAfter(res.headers.get('retry-after'), deps.now()));
				deps.log(`  ${method}: HTTP ${res.status} ${error.reason}; retrying in ${Math.round(wait / 1000)} s`);
				await deps.sleep(wait);
				continue;
			}
			throw error;
		}
	};

	/** A non-idempotent call: retries only when `alreadyApplied` says the lost attempt did not take effect. */
	const callOnce = async <T>(request: RequestSpec, onOk: (res: HttpResponse) => T, onError: (error: ApiError) => T | null, alreadyApplied: () => Promise<T | null>): Promise<T> => {
		for (let attempt = 1; ; attempt++) {
			try {
				return onOk(await call(request, {retry: false}));
			} catch (error) {
				if (error instanceof ApiError) {
					const handled = onError(error);
					if (handled !== null) return handled;
					if (!isRetryable(error) || error.isQuota || attempt > maxRetries) throw error;
				} else if (!(error instanceof NetworkError) || attempt > maxRetries) {
					throw error;
				}
				await deps.sleep(backoffMs(attempt, deps.random, null));
				const existing = await alreadyApplied();
				if (existing !== null) return existing;
			}
		}
	};

	return {
		raw,
		call,
		refresh,

		async myChannel() {
			const item = items(json(await call(channelCheck(ep), {retry: true})))[0];
			const snippet = item && isRecord(item.snippet) ? item.snippet : null;
			if (!item || !str(item.id) || !snippet) throw new ApiError('channels.list', 404, 'noChannel', 'This Google account has no YouTube channel.');
			const related = isRecord(item.contentDetails) && isRecord(item.contentDetails.relatedPlaylists) ? item.contentDetails.relatedPlaylists : {};
			return {id: String(item.id), title: str(snippet.title) ?? '', handle: str(snippet.customUrl), uploadsPlaylistId: str(related.uploads)};
		},

		async recentUploads(uploadsPlaylistId) {
			return items(json(await call(recentUploads(ep, uploadsPlaylistId), {retry: true}))).flatMap((item) => {
				const snippet = isRecord(item.snippet) ? item.snippet : null;
				const resource = snippet && isRecord(snippet.resourceId) ? snippet.resourceId : null;
				const videoId = resource ? str(resource.videoId) : null;
				if (!snippet || !videoId) return [];
				const status = isRecord(item.status) ? item.status : {};
				return [{videoId, title: str(snippet.title) ?? '', publishedAt: str(snippet.publishedAt), privacyStatus: str(status.privacyStatus)}];
			});
		},

		async playlist(playlistId) {
			const item = items(json(await call(playlistCheck(ep, playlistId), {retry: true})))[0];
			const snippet = item && isRecord(item.snippet) ? item.snippet : null;
			return snippet && str(snippet.channelId) ? {channelId: String(snippet.channelId), title: str(snippet.title) ?? ''} : null;
		},

		async setThumbnail(videoId, mimeType, content) {
			// Setting the same image twice is harmless, so this one may retry freely.
			await call(setThumbnail(ep, videoId, mimeType, content), {retry: true, timeoutMs: 300_000});
		},

		async insertCaption(videoId, language, name, content) {
			return callOnce<{captionId: string | null; existed: boolean}>(
				insertCaption(ep, {videoId, language, name}, content),
				(res) => {
					const body = json(res);
					return {captionId: isRecord(body) ? str(body.id) : null, existed: false};
				},
				(error) => (error.status === 409 && error.reason === 'captionExists' ? {captionId: null, existed: true} : null),
				async () => null, // a repeat answers 409 captionExists, handled above
			);
		},

		async addToPlaylist(playlistId, videoId) {
			const lookup = async (): Promise<{playlistItemId: string | null; existed: boolean} | null> => {
				const found = items(json(await call(findInPlaylist(ep, playlistId, videoId), {retry: true})))[0];
				return found && str(found.id) ? {playlistItemId: String(found.id), existed: true} : null;
			};
			return callOnce<{playlistItemId: string | null; existed: boolean}>(
				addToPlaylist(ep, playlistId, videoId),
				(res) => {
					const body = json(res);
					return {playlistItemId: isRecord(body) ? str(body.id) : null, existed: false};
				},
				() => null,
				lookup,
			);
		},

		async processingStatus(videoId) {
			const item = items(json(await call(processingStatus(ep, videoId), {retry: true})))[0];
			const details = item && isRecord(item.processingDetails) ? item.processingDetails : null;
			return details ? str(details.processingStatus) : null;
		},

		async forcePrivate(videoId, status) {
			const body = json(await call(forcePrivate(ep, videoId, status), {retry: true}));
			return isRecord(body) && isRecord(body.status) ? str(body.status.privacyStatus) : null;
		},

		async categories(regionCode) {
			return items(json(await call(listCategories(ep, regionCode), {retry: true}))).map((item) => {
				const snippet = isRecord(item.snippet) ? item.snippet : {};
				return {id: str(item.id) ?? '', title: str(snippet.title) ?? '', assignable: snippet.assignable === true};
			});
		},
	};
};
