/**
 * Optional YouTube Analytics API v2 client: reports.query, the "Top videos" channel report.
 *
 * Contract (read 2026-11-24 from developers.google.com/youtube/analytics: reference/reports/query,
 * channel_reports, metrics; discovery document revision 20261122):
 *   GET https://youtubeanalytics.googleapis.com/v2/reports
 *     ids=channel==MINE, startDate, endDate (YYYY-MM-DD), metrics, dimensions=video[,creatorContentType],
 *     sort (required for this report, e.g. -views), maxResults (200 or less), startIndex (1-based).
 *   Authorization: Bearer <OAuth 2.0 access token>; scope yt-analytics.readonly, plus
 *   yt-analytics-monetary.readonly for estimatedRevenue.
 *   Response: {kind: "youtubeAnalytics#resultTable", columnHeaders: [{name, columnType, dataType}], rows?: [[...]]}
 *   (rows is omitted when there is no data).
 *
 * The API has NO thumbnail-impression or impressions click-through-rate metric: its "impressions"
 * metrics are ad, card and annotation impressions. Since 2026-01-15 thumbnail impressions and CTR are
 * only in the bulk YouTube Reporting API (channel_reach_basic_a1). For this dashboard the Studio CSV
 * export stays the source of impressions and CTR.
 *
 * Token refresh (developers.google.com/identity/protocols/oauth2/web-server, "Refreshing an access
 * token"): POST https://oauth2.googleapis.com/token with client_id, client_secret (optional),
 * grant_type=refresh_token and refresh_token; the response carries access_token.
 *
 * Nothing here has been run against the live API from this machine; tests use recorded fixtures.
 */
import type {ApiVideo} from './model.ts';

export const REPORTS_URL = 'https://youtubeanalytics.googleapis.com/v2/reports';
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const PAGE_SIZE = 200; // the top-videos report allows at most 200 rows per request
const MAX_PAGES = 25;

export const BASE_METRICS = ['views', 'estimatedMinutesWatched', 'averageViewDuration', 'averageViewPercentage', 'subscribersGained', 'subscribersLost'];
export const REVENUE_METRICS = ['estimatedRevenue'];

export class YouTubeApiError extends Error {
	readonly status: number;
	constructor(message: string, status: number) {
		super(message);
		this.status = status;
	}
}

export type ReportQuery = {startDate: string; endDate: string; includeRevenue: boolean; startIndex?: number};

export const buildReportUrl = (query: ReportQuery): string => {
	const url = new URL(REPORTS_URL);
	url.searchParams.set('ids', 'channel==MINE');
	url.searchParams.set('startDate', query.startDate);
	url.searchParams.set('endDate', query.endDate);
	url.searchParams.set('metrics', [...BASE_METRICS, ...(query.includeRevenue ? REVENUE_METRICS : [])].join(','));
	url.searchParams.set('dimensions', 'video,creatorContentType');
	url.searchParams.set('sort', '-views');
	url.searchParams.set('maxResults', String(PAGE_SIZE));
	url.searchParams.set('startIndex', String(query.startIndex ?? 1));
	if (query.includeRevenue) url.searchParams.set('currency', 'USD');
	return url.href;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Google's JSON error body: {"error": {"code", "message", "status"}}. Only the message is shown. */
const errorMessage = async (res: Response): Promise<string> => {
	try {
		const body: unknown = await res.json();
		if (isRecord(body) && isRecord(body.error) && typeof body.error.message === 'string') return body.error.message.slice(0, 300);
		if (isRecord(body) && typeof body.error_description === 'string') return body.error_description.slice(0, 300);
		if (isRecord(body) && typeof body.error === 'string') return body.error.slice(0, 300);
	} catch {
		// not JSON
	}
	return res.statusText || 'no details';
};

const HINTS: Record<number, string> = {
	401: 'the access token is missing, expired or revoked',
	403: 'the token lacks the scope (yt-analytics.readonly; yt-analytics-monetary.readonly for --api-revenue), the API is not enabled for the Google Cloud project, or the channel is not monetized',
	429: 'quota or rate limit reached; try again later',
};

export type FetchLike = typeof fetch;

/** One page of the report, as returned (columnHeaders + rows). */
export type ResultTable = {columnHeaders: {name: string}[]; rows: unknown[][]};

const fetchPage = async (fetchImpl: FetchLike, accessToken: string, query: ReportQuery): Promise<ResultTable> => {
	let res: Response;
	try {
		res = await fetchImpl(buildReportUrl(query), {headers: {Authorization: `Bearer ${accessToken}`, Accept: 'application/json'}, signal: AbortSignal.timeout(30_000)});
	} catch (err) {
		throw new YouTubeApiError(`YouTube Analytics API not reachable: ${(err as Error).message}`, 0);
	}
	if (!res.ok) {
		const hint = HINTS[res.status] ? ` (${HINTS[res.status]})` : '';
		throw new YouTubeApiError(`YouTube Analytics API returned ${res.status}: ${await errorMessage(res)}${hint}`, res.status);
	}
	let body: unknown;
	try {
		body = await res.json();
	} catch {
		throw new YouTubeApiError('YouTube Analytics API returned a body that is not JSON', res.status);
	}
	if (!isRecord(body) || !Array.isArray(body.columnHeaders) || !body.columnHeaders.every((h) => isRecord(h) && typeof h.name === 'string')) {
		throw new YouTubeApiError('YouTube Analytics API response has no columnHeaders', res.status);
	}
	const rows = body.rows === undefined ? [] : body.rows;
	if (!Array.isArray(rows) || !rows.every(Array.isArray)) throw new YouTubeApiError('YouTube Analytics API response rows are not arrays', res.status);
	return {columnHeaders: body.columnHeaders as {name: string}[], rows: rows as unknown[][]};
};

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null);

const FORMATS: Record<string, 'long' | 'short'> = {SHORTS: 'short', VIDEO_ON_DEMAND: 'long', LIVE_STREAM: 'long'};

/**
 * Maps result rows to one ApiVideo per video. Columns are found by name, not position. A video can
 * have rows for several content types (a live stream later watched on demand): counts are added up,
 * averages weighted by views, and the format is the content type with the most views.
 */
export const mapReportRows = (table: ResultTable): ApiVideo[] => {
	const at = (name: string): number => table.columnHeaders.findIndex((h) => h.name === name);
	const col = {
		video: at('video'),
		type: at('creatorContentType'),
		views: at('views'),
		minutes: at('estimatedMinutesWatched'),
		duration: at('averageViewDuration'),
		percent: at('averageViewPercentage'),
		gained: at('subscribersGained'),
		lost: at('subscribersLost'),
		revenue: at('estimatedRevenue'),
	};
	if (col.video === -1 || col.views === -1) throw new YouTubeApiError('YouTube Analytics API response lacks the video or views column', 200);
	type Acc = ApiVideo & {weighted: {duration: number; percent: number; durationViews: number; percentViews: number}; typeViews: Map<string, number>};
	const byId = new Map<string, Acc>();
	for (const row of table.rows) {
		const videoId = row[col.video];
		const views = num(row[col.views]);
		if (typeof videoId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(videoId) || views === null || views < 0) continue;
		const pick = (index: number): number | null => (index === -1 ? null : num(row[index]));
		let acc = byId.get(videoId);
		if (!acc) {
			acc = {
				videoId, format: null, views: 0, estimatedMinutesWatched: null, avgViewDurationSec: null, avgPercentViewed: null,
				subscribersGained: null, subscribersLost: null, revenueUsd: null,
				weighted: {duration: 0, percent: 0, durationViews: 0, percentViews: 0}, typeViews: new Map(),
			};
			byId.set(videoId, acc);
		}
		const add = (current: number | null, value: number | null): number | null => (value === null ? current : (current ?? 0) + value);
		acc.views += views;
		acc.estimatedMinutesWatched = add(acc.estimatedMinutesWatched, pick(col.minutes));
		acc.subscribersGained = add(acc.subscribersGained, pick(col.gained));
		acc.subscribersLost = add(acc.subscribersLost, pick(col.lost));
		acc.revenueUsd = add(acc.revenueUsd, pick(col.revenue));
		const duration = pick(col.duration);
		if (duration !== null) {
			acc.weighted.duration += duration * views;
			acc.weighted.durationViews += views;
		}
		const percent = pick(col.percent);
		if (percent !== null) {
			acc.weighted.percent += percent * views;
			acc.weighted.percentViews += views;
		}
		const type = col.type === -1 ? null : row[col.type];
		if (typeof type === 'string') acc.typeViews.set(type, (acc.typeViews.get(type) ?? 0) + views);
	}
	return [...byId.values()].map(({weighted, typeViews, ...video}) => {
		const topType = [...typeViews].sort((a, b) => b[1] - a[1])[0]?.[0];
		return {
			...video,
			format: topType ? (FORMATS[topType] ?? null) : null,
			avgViewDurationSec: weighted.durationViews > 0 ? weighted.duration / weighted.durationViews : null,
			avgPercentViewed: weighted.percentViews > 0 ? weighted.percent / weighted.percentViews / 100 : null,
		};
	});
};

/** All videos with views in the range, paging 200 at a time (at most 25 pages). */
export const fetchVideoReport = async (fetchImpl: FetchLike, accessToken: string, query: Omit<ReportQuery, 'startIndex'>): Promise<ApiVideo[]> => {
	const tables: ResultTable[] = [];
	for (let page = 0; page < MAX_PAGES; page++) {
		const table = await fetchPage(fetchImpl, accessToken, {...query, startIndex: page * PAGE_SIZE + 1});
		tables.push(table);
		if (table.rows.length < PAGE_SIZE) break;
	}
	const first = tables[0];
	return first ? mapReportRows({columnHeaders: first.columnHeaders, rows: tables.flatMap((t) => t.rows)}) : [];
};

export type TokenEnv = {
	YT_ANALYTICS_ACCESS_TOKEN?: string;
	YT_ANALYTICS_CLIENT_ID?: string;
	YT_ANALYTICS_CLIENT_SECRET?: string;
	YT_ANALYTICS_REFRESH_TOKEN?: string;
};

/** An access token from the environment, or one exchanged for the refresh token. Tokens are never printed. */
export const resolveAccessToken = async (env: TokenEnv, fetchImpl: FetchLike): Promise<string> => {
	const direct = env.YT_ANALYTICS_ACCESS_TOKEN?.trim();
	if (direct) return direct;
	const clientId = env.YT_ANALYTICS_CLIENT_ID?.trim();
	const refreshToken = env.YT_ANALYTICS_REFRESH_TOKEN?.trim();
	if (!clientId || !refreshToken) {
		throw new YouTubeApiError('--api needs YT_ANALYTICS_ACCESS_TOKEN, or YT_ANALYTICS_CLIENT_ID and YT_ANALYTICS_REFRESH_TOKEN (plus YT_ANALYTICS_CLIENT_SECRET for most clients)', 0);
	}
	const form = new URLSearchParams({client_id: clientId, grant_type: 'refresh_token', refresh_token: refreshToken});
	const secret = env.YT_ANALYTICS_CLIENT_SECRET?.trim();
	if (secret) form.set('client_secret', secret);
	let res: Response;
	try {
		res = await fetchImpl(TOKEN_URL, {
			method: 'POST',
			headers: {'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json'},
			body: form.toString(),
			signal: AbortSignal.timeout(30_000),
		});
	} catch (err) {
		throw new YouTubeApiError(`Google token endpoint not reachable: ${(err as Error).message}`, 0);
	}
	if (!res.ok) throw new YouTubeApiError(`Google token endpoint returned ${res.status}: ${await errorMessage(res)}`, res.status);
	const body: unknown = await res.json().catch(() => null);
	if (!isRecord(body) || typeof body.access_token !== 'string' || !body.access_token) throw new YouTubeApiError('Google token endpoint returned no access_token', res.status);
	return body.access_token;
};
