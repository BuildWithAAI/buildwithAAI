/**
 * YouTube calls for the retention tool. Read-only.
 *
 * Contracts, read 2026-11-24 directly from developers.google.com and the discovery documents:
 *  - Audience retention report (youtube/analytics/channel_reports#audience-retention-reports, updated 2026-11-12):
 *    GET https://youtubeanalytics.googleapis.com/v2/reports with ids=channel==MINE, startDate, endDate,
 *    dimensions=elapsedVideoTimeRatio (required), metrics = one or more of audienceWatchRatio,
 *    relativeRetentionPerformance, startedWatching, stoppedWatching, totalSegmentImpressions,
 *    filters=video==<ID> (required; ONE video id only: "Audience Retention reports (dimensions=elapsedVideoTimeRatio)
 *    only support filtering by a single video ID", reference/reports/query) plus optionally audienceType
 *    (ORGANIC | AD_INSTREAM | AD_INDISPLAY), subscribedStatus, youtubeProduct.
 *  - elapsedVideoTimeRatio (dimensions#elapsedVideoTimeRatio): "The API returns 100 data points for each video with
 *    ratio values ranging from 0.01 to 1.0 ... equally spaced ... The dimension's value denotes the exclusive end of the
 *    interval." audienceWatchRatio can exceed 1 (rewatches); relativeRetentionPerformance is 0..1 against videos of
 *    similar length, 0.5 = median (metrics#Audience_Retention_Metrics, updated 2026-11-16).
 *  - Basic stats for one video (channel_reports, "Basic user activity statistics"): metrics views, engagedViews,
 *    averageViewDuration, averageViewPercentage, filter video; creatorContentType (SHORTS, VIDEO_ON_DEMAND, ...) is an
 *    optional dimension of channel video reports (revision history 2022-12-15).
 *  - Response: {kind: "youtubeAnalytics#resultTable", columnHeaders[{name, columnType, dataType}], rows?}; rows is
 *    omitted when there is no data; columns are matched by name (data_model: "use the response's header row").
 *  - Data API videos.list (discovery rev 20261123): part=contentDetails,snippet; contentDetails.duration is ISO 8601
 *    (PT#M#S); scopes include youtube.readonly; 1 quota unit (youtube/data/determine_quota_cost, updated 2026-11-12).
 *  - Scopes: yt-analytics.readonly, and youtube.readonly, which reports.query "now require[s]" (reference/reports/
 *    query, "Important" note; revision history 2018-06-18). Both are read-only.
 *  - Freshness: 48-72 h latency (data_model#data-freshness-and-latency). Quota: each Analytics request is 1 unit.
 */
import {GOOGLE, type Endpoints as GoogleEndpoints} from '../comment-guard/youtube.ts';
import {REPORTS_URL} from '../dashboard/youtube-api.ts';
import type {Audience, CurvePoint, VideoMeta, VideoStats} from './types.ts';

export const ANALYTICS_SCOPE = 'https://www.googleapis.com/auth/yt-analytics.readonly';
export const YOUTUBE_READONLY_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
export const SCOPES = [ANALYTICS_SCOPE, YOUTUBE_READONLY_SCOPE] as const;

/** comment-guard's Google endpoints (auth, token, revoke, Data API) plus the Analytics reports URL. */
export type Endpoints = GoogleEndpoints & {analytics: string};
export const ENDPOINTS: Endpoints = {...GOOGLE, analytics: REPORTS_URL};

export const RETENTION_METRICS = ['audienceWatchRatio', 'relativeRetentionPerformance', 'startedWatching', 'stoppedWatching', 'totalSegmentImpressions'] as const;
export const CORE_RETENTION_METRICS = ['audienceWatchRatio', 'relativeRetentionPerformance'] as const;

export class ApiError extends Error {
	readonly status: number;
	readonly reason: string;
	constructor(status: number, reason: string, message: string) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
		this.reason = reason;
	}
	get isQuota(): boolean {
		return this.reason === 'quotaExceeded' || this.reason === 'dailyLimitExceeded' || this.reason === 'rateLimitExceeded';
	}
}

export type FetchLike = typeof fetch;

/** Gives an access token; `force` asks for a fresh one after a 401. */
export type TokenSource = (force: boolean) => Promise<string>;

export type ApiOptions = {endpoints?: Endpoints; fetch?: FetchLike; token: TokenSource; sleep?: (ms: number) => Promise<void>};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const num = (value: unknown): number | null =>
	typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null;

const HINTS: Record<number, string> = {
	400: 'the request was refused as invalid',
	401: 'the access token is missing, expired or revoked: run "auth" again',
	403: 'the token lacks a scope (yt-analytics.readonly and youtube.readonly), the API is not enabled in the Google Cloud project, or the video is not on the authorised channel',
	404: 'not found',
	429: 'quota or rate limit reached; the daily quota resets at midnight Pacific Time',
};

const apiError = async (res: Response): Promise<ApiError> => {
	const body: unknown = await res.json().catch(() => null);
	const error = isRecord(body) && isRecord(body.error) ? body.error : null;
	const first = error && Array.isArray(error.errors) && isRecord(error.errors[0]) ? error.errors[0] : null;
	const reason = (first && typeof first.reason === 'string' ? first.reason : null) ?? (error && typeof error.status === 'string' ? error.status : `http_${res.status}`);
	const message = (error && typeof error.message === 'string' ? error.message.slice(0, 300) : null) ?? res.statusText;
	return new ApiError(res.status, reason, `YouTube returned ${res.status} (${reason}): ${message}${HINTS[res.status] ? `. Likely cause: ${HINTS[res.status]}` : ''}`);
};

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/** ISO 8601 duration (PT1M5S, P1DT2H, PT59.5S) to seconds; null when it cannot be read. */
export const parseIsoDuration = (value: unknown): number | null => {
	if (typeof value !== 'string') return null;
	const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value.trim());
	if (!m || value.trim() === 'P' || value.trim() === 'PT') return null;
	return Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
};

export type ResultTable = {columnHeaders: {name: string}[]; rows: unknown[][]};

/** Validates a resultTable body; rows is [] when YouTube omitted it (no data). */
export const parseResultTable = (body: unknown): ResultTable => {
	if (!isRecord(body) || !Array.isArray(body.columnHeaders) || !body.columnHeaders.every((h) => isRecord(h) && typeof h.name === 'string')) {
		throw new ApiError(200, 'malformed', 'YouTube Analytics returned a response without columnHeaders');
	}
	const rows = body.rows === undefined ? [] : body.rows;
	if (!Array.isArray(rows) || !rows.every(Array.isArray)) throw new ApiError(200, 'malformed', 'YouTube Analytics returned rows that are not arrays');
	return {columnHeaders: body.columnHeaders as {name: string}[], rows: rows as unknown[][]};
};

/** Maps retention rows to curve points by column NAME. Rows with an unreadable ratio or watch value are skipped. */
export const toCurve = (table: ResultTable): CurvePoint[] => {
	const at = (name: string) => table.columnHeaders.findIndex((h) => h.name === name);
	const col = {
		ratio: at('elapsedVideoTimeRatio'),
		watch: at('audienceWatchRatio'),
		relative: at('relativeRetentionPerformance'),
		started: at('startedWatching'),
		stopped: at('stoppedWatching'),
		impressions: at('totalSegmentImpressions'),
	};
	if (col.ratio === -1 || col.watch === -1) throw new ApiError(200, 'malformed', 'the retention report lacks elapsedVideoTimeRatio or audienceWatchRatio');
	const pick = (row: unknown[], index: number) => (index === -1 ? null : num(row[index]));
	const out: CurvePoint[] = [];
	for (const row of table.rows) {
		const ratio = num(row[col.ratio]);
		const watch = num(row[col.watch]);
		if (ratio === null || watch === null) continue;
		out.push({ratio, watch, relative: pick(row, col.relative), started: pick(row, col.started), stopped: pick(row, col.stopped), impressions: pick(row, col.impressions)});
	}
	return out.sort((a, b) => a.ratio - b.ratio);
};

/** Views per content type, summed; averages weighted by views; the content type with the most views. */
export const toStats = (table: ResultTable): VideoStats => {
	const at = (name: string) => table.columnHeaders.findIndex((h) => h.name === name);
	const col = {type: at('creatorContentType'), views: at('views'), engaged: at('engagedViews'), duration: at('averageViewDuration'), percent: at('averageViewPercentage')};
	let views: number | null = null;
	let engaged: number | null = null;
	let durationSum = 0;
	let percentSum = 0;
	let weight = 0;
	const byType = new Map<string, number>();
	for (const row of table.rows) {
		const v = col.views === -1 ? null : num(row[col.views]);
		if (v !== null) views = (views ?? 0) + v;
		const e = col.engaged === -1 ? null : num(row[col.engaged]);
		if (e !== null) engaged = (engaged ?? 0) + e;
		const d = col.duration === -1 ? null : num(row[col.duration]);
		const p = col.percent === -1 ? null : num(row[col.percent]);
		if (v !== null && v > 0 && d !== null && p !== null) {
			durationSum += d * v;
			percentSum += p * v;
			weight += v;
		}
		const type = col.type === -1 ? null : row[col.type];
		if (typeof type === 'string' && v !== null) byType.set(type, (byType.get(type) ?? 0) + v);
	}
	const top = [...byType].sort((a, b) => b[1] - a[1])[0];
	return {
		views,
		engagedViews: engaged,
		averageViewDurationSec: weight > 0 ? durationSum / weight : null,
		averageViewPercentage: weight > 0 ? percentSum / weight : null,
		contentType: top ? top[0] : null,
	};
};

export type RetentionQuery = {videoId: string; startDate: string; endDate: string; audience: Audience};

export const retentionUrl = (endpoints: Endpoints, q: RetentionQuery, metrics: readonly string[]): string => {
	const url = new URL(endpoints.analytics);
	url.searchParams.set('ids', 'channel==MINE');
	url.searchParams.set('startDate', q.startDate);
	url.searchParams.set('endDate', q.endDate);
	url.searchParams.set('dimensions', 'elapsedVideoTimeRatio');
	url.searchParams.set('metrics', metrics.join(','));
	url.searchParams.set('filters', `video==${q.videoId}${q.audience === 'all' ? '' : `;audienceType==${q.audience}`}`);
	return url.href;
};

export const statsUrl = (endpoints: Endpoints, q: Omit<RetentionQuery, 'audience'>, full: boolean): string => {
	const url = new URL(endpoints.analytics);
	url.searchParams.set('ids', 'channel==MINE');
	url.searchParams.set('startDate', q.startDate);
	url.searchParams.set('endDate', q.endDate);
	url.searchParams.set('metrics', full ? 'views,engagedViews,averageViewDuration,averageViewPercentage' : 'views,averageViewDuration,averageViewPercentage');
	if (full) url.searchParams.set('dimensions', 'creatorContentType');
	url.searchParams.set('filters', `video==${q.videoId}`);
	return url.href;
};

export type YouTubeApi = {
	/** The 100-point curve; falls back to the two core metrics when YouTube refuses the full set. */
	retention(q: RetentionQuery): Promise<{curve: CurvePoint[]; metrics: string[]}>;
	stats(q: Omit<RetentionQuery, 'audience'>): Promise<VideoStats>;
	/** Data API metadata; null when the video is not found (deleted, or not visible to this account). */
	video(videoId: string): Promise<Omit<VideoMeta, 'fetchedAt'> | null>;
	myChannel(): Promise<{id: string; title: string}>;
	/** Requests made, by API, for the quota note. */
	calls: {analytics: number; data: number};
};

export const createApi = (options: ApiOptions): YouTubeApi => {
	const endpoints = options.endpoints ?? ENDPOINTS;
	const fetchImpl = options.fetch ?? fetch;
	const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
	const calls = {analytics: 0, data: 0};

	const get = async (url: string, kind: 'analytics' | 'data'): Promise<unknown> => {
		let forced = false;
		for (let attempt = 0; ; attempt++) {
			const token = await options.token(forced);
			calls[kind]++;
			let res: Response;
			try {
				res = await fetchImpl(url, {headers: {authorization: `Bearer ${token}`, accept: 'application/json'}, signal: AbortSignal.timeout(30_000)});
			} catch (err) {
				throw new ApiError(0, 'network', `YouTube could not be reached: ${(err as Error).message}`);
			}
			if (res.ok) return res.json().catch(() => {
				throw new ApiError(res.status, 'malformed', 'YouTube returned a body that is not JSON');
			});
			const error = await apiError(res);
			if (res.status === 401 && !forced) {
				forced = true; // expired or revoked early: refresh once and retry
				continue;
			}
			if (RETRYABLE.has(res.status) && !error.isQuota && attempt < 2) {
				await sleep(1000 * 2 ** attempt);
				continue;
			}
			throw error;
		}
	};

	return {
		calls,
		async retention(q) {
			try {
				const table = parseResultTable(await get(retentionUrl(endpoints, q, RETENTION_METRICS), 'analytics'));
				return {curve: toCurve(table), metrics: table.columnHeaders.map((h) => h.name).filter((n) => n !== 'elapsedVideoTimeRatio')};
			} catch (err) {
				if (!(err instanceof ApiError) || err.status !== 400) throw err;
			}
			// some videos or accounts refuse the 2024 segment metrics: fall back to the two original ones
			const table = parseResultTable(await get(retentionUrl(endpoints, q, CORE_RETENTION_METRICS), 'analytics'));
			return {curve: toCurve(table), metrics: table.columnHeaders.map((h) => h.name).filter((n) => n !== 'elapsedVideoTimeRatio')};
		},
		async stats(q) {
			try {
				return toStats(parseResultTable(await get(statsUrl(endpoints, q, true), 'analytics')));
			} catch (err) {
				if (!(err instanceof ApiError) || err.status !== 400) throw err;
			}
			return toStats(parseResultTable(await get(statsUrl(endpoints, q, false), 'analytics')));
		},
		async video(videoId) {
			const url = new URL(`${endpoints.api}/videos`);
			url.searchParams.set('part', 'contentDetails,snippet');
			url.searchParams.set('id', videoId);
			const body = await get(url.href, 'data');
			const item = isRecord(body) && Array.isArray(body.items) && isRecord(body.items[0]) ? body.items[0] : null;
			if (!item) return null;
			const details = isRecord(item.contentDetails) ? item.contentDetails : {};
			const snippet = isRecord(item.snippet) ? item.snippet : {};
			return {
				durationSec: parseIsoDuration(details.duration),
				publishedAt: typeof snippet.publishedAt === 'string' ? snippet.publishedAt : null,
				defaultAudioLanguage: typeof snippet.defaultAudioLanguage === 'string' ? snippet.defaultAudioLanguage : null,
			};
		},
		async myChannel() {
			const url = new URL(`${endpoints.api}/channels`);
			url.searchParams.set('part', 'snippet');
			url.searchParams.set('mine', 'true');
			const body = await get(url.href, 'data');
			const item = isRecord(body) && Array.isArray(body.items) && isRecord(body.items[0]) ? body.items[0] : null;
			if (!item || typeof item.id !== 'string') throw new ApiError(404, 'noChannel', 'This Google account has no YouTube channel.');
			const snippet = isRecord(item.snippet) ? item.snippet : {};
			return {id: item.id, title: typeof snippet.title === 'string' ? snippet.title : ''};
		},
	};
};
