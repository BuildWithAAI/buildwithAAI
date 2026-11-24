/**
 * Test support only: a fetch-compatible fake of Google's OAuth token endpoint, the YouTube Analytics reports
 * endpoint and the Data API (videos.list, channels.list), answering in the recorded response shapes documented in
 * api.ts. Tests pass `mock.fetch` and `mock.endpoints`, so no test ever reaches Google.
 */
import type {Endpoints} from './api.ts';
import type {CurvePoint} from './types.ts';

export type MockVideo = {
	curve?: CurvePoint[];
	/** Answer 400 when the 2024 segment metrics are requested (forces the core-metric fallback). */
	rejectSegmentMetrics?: boolean;
	stats?: {views: number; engagedViews?: number; averageViewDuration?: number; averageViewPercentage?: number; contentType?: string};
	/** Answer 400 to the stats query that carries the creatorContentType dimension. */
	rejectStatsDimension?: boolean;
	durationSec?: number;
	publishedAt?: string;
	defaultAudioLanguage?: string;
	/** videos.list finds nothing (deleted). */
	missing?: boolean;
};

export type MockRequest = {method: string; url: URL; form: URLSearchParams; authorization: string | null};

export type MockGoogle = {
	fetch: typeof fetch;
	endpoints: Endpoints;
	videos: Map<string, MockVideo>;
	channel: {id: string; title: string};
	/** The scope string the token endpoint reports as granted. */
	grantedScope: string;
	revokedRefreshTokens: Set<string>;
	expiredAccessTokens: Set<string>;
	/** Status codes to answer to the next API calls, in order (e.g. [503] for one transient error). */
	failNext: number[];
	/** Data API answers 403 (a token without youtube.readonly). */
	dataApiForbidden: boolean;
	requests: MockRequest[];
	calls: (path: string) => MockRequest[];
};

const BASE = 'https://mock.google.test';
export const FULL_SCOPE = 'https://www.googleapis.com/auth/yt-analytics.readonly https://www.googleapis.com/auth/youtube.readonly';

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json; charset=UTF-8'}});
const googleError = (status: number, reason: string, message: string): Response => json(status, {error: {code: status, message, errors: [{reason, message}], status: 'ERROR'}});

const FIELD: Record<string, keyof CurvePoint> = {
	audienceWatchRatio: 'watch',
	relativeRetentionPerformance: 'relative',
	startedWatching: 'started',
	stoppedWatching: 'stopped',
	totalSegmentImpressions: 'impressions',
};

const isoDuration = (sec: number): string => {
	const s = Math.round(sec);
	return `PT${Math.floor(s / 3600) ? `${Math.floor(s / 3600)}H` : ''}${Math.floor((s % 3600) / 60) ? `${Math.floor((s % 3600) / 60)}M` : ''}${s % 60 || s === 0 ? `${s % 60}S` : ''}`;
};

export const createMockGoogle = (): MockGoogle => {
	let refreshCount = 0;
	const mock: MockGoogle = {
		endpoints: {
			auth: `${BASE}/o/oauth2/v2/auth`,
			token: `${BASE}/token`,
			revoke: `${BASE}/revoke`,
			api: `${BASE}/youtube/v3`,
			analytics: `${BASE}/v2/reports`,
		},
		videos: new Map(),
		channel: {id: 'UCsyntheticRETENTION0001', title: 'Synthetic test channel'},
		grantedScope: FULL_SCOPE,
		revokedRefreshTokens: new Set(),
		expiredAccessTokens: new Set(),
		failNext: [],
		dataApiForbidden: false,
		requests: [],
		calls: (path) => mock.requests.filter((r) => r.url.pathname === path),
		fetch: (async (input: string | URL | Request, init?: RequestInit) => {
			const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
			const method = init?.method ?? 'GET';
			const form = new URLSearchParams(typeof init?.body === 'string' ? init.body : '');
			const headers = new Headers(init?.headers);
			const authorization = headers.get('authorization');
			mock.requests.push({method, url, form, authorization});
			if (url.origin !== BASE) throw new TypeError(`mock: unexpected host ${url.origin}`);

			if (url.pathname === '/token' && method === 'POST') {
				if (form.get('grant_type') === 'authorization_code') {
					if (form.get('code') !== 'test-code' || !form.get('code_verifier') || !form.get('client_secret') || !form.get('redirect_uri')) return json(400, {error: 'invalid_grant'});
					return json(200, {access_token: 'at-initial', expires_in: 3599, refresh_token: 'rt-initial', scope: mock.grantedScope, token_type: 'Bearer'});
				}
				if (form.get('grant_type') === 'refresh_token') {
					if (mock.revokedRefreshTokens.has(form.get('refresh_token') ?? '')) return json(400, {error: 'invalid_grant', error_description: 'Token has been expired or revoked.'});
					refreshCount++;
					return json(200, {access_token: `at-refreshed-${refreshCount}`, expires_in: 3599, scope: mock.grantedScope, token_type: 'Bearer'});
				}
				return json(400, {error: 'unsupported_grant_type'});
			}
			if (url.pathname === '/revoke' && method === 'POST') return json(200, {});

			const token = (authorization ?? '').replace(/^Bearer /, '');
			if (!token || mock.expiredAccessTokens.has(token)) return googleError(401, 'authError', 'Request had invalid authentication credentials.');
			const fail = mock.failNext.shift();
			if (fail) return googleError(fail, fail === 403 ? 'quotaExceeded' : 'backendError', 'synthetic failure');

			if (url.pathname === '/v2/reports') {
				if (url.searchParams.get('ids') !== 'channel==MINE') return googleError(400, 'badRequest', 'ids must be channel==MINE in this mock');
				const filters = url.searchParams.get('filters') ?? '';
				const videoId = /(?:^|;)video==([^;,]+)(?:;|$)/.exec(filters)?.[1];
				if (!videoId || /video==[^;]*,/.test(filters)) return googleError(400, 'badRequest', 'one video id per query');
				const video = mock.videos.get(videoId);
				const metrics = (url.searchParams.get('metrics') ?? '').split(',').filter(Boolean);
				const dimensions = url.searchParams.get('dimensions');
				if (dimensions === 'elapsedVideoTimeRatio') {
					if (video?.rejectSegmentMetrics && metrics.some((m) => m === 'startedWatching' || m === 'stoppedWatching' || m === 'totalSegmentImpressions')) {
						return googleError(400, 'badRequest', 'Unknown identifier (startedWatching) given in field parameters.metrics.');
					}
					const headers = [{name: 'elapsedVideoTimeRatio', columnType: 'DIMENSION', dataType: 'FLOAT'}, ...metrics.map((name) => ({name, columnType: 'METRIC', dataType: 'FLOAT'}))];
					const rows = (video?.curve ?? []).map((p) => [p.ratio, ...metrics.map((m) => p[FIELD[m]!] ?? 0)]);
					return json(200, rows.length ? {kind: 'youtubeAnalytics#resultTable', columnHeaders: headers, rows} : {kind: 'youtubeAnalytics#resultTable', columnHeaders: headers});
				}
				if (dimensions === 'creatorContentType' && video?.rejectStatsDimension) return googleError(400, 'badRequest', 'The query is not supported.');
				const headers = [...(dimensions ? [{name: dimensions, columnType: 'DIMENSION', dataType: 'STRING'}] : []), ...metrics.map((name) => ({name, columnType: 'METRIC', dataType: 'INTEGER'}))];
				const s = video?.stats;
				if (!s) return json(200, {kind: 'youtubeAnalytics#resultTable', columnHeaders: headers});
				const value: Record<string, number> = {views: s.views, engagedViews: s.engagedViews ?? s.views, averageViewDuration: s.averageViewDuration ?? 0, averageViewPercentage: s.averageViewPercentage ?? 0};
				const row = [...(dimensions ? [s.contentType ?? 'VIDEO_ON_DEMAND'] : []), ...metrics.map((m) => value[m] ?? 0)];
				return json(200, {kind: 'youtubeAnalytics#resultTable', columnHeaders: headers, rows: [row]});
			}
			if (url.pathname === '/youtube/v3/videos') {
				if (mock.dataApiForbidden) return googleError(403, 'insufficientPermissions', 'Request had insufficient authentication scopes.');
				const id = url.searchParams.get('id') ?? '';
				const video = mock.videos.get(id);
				if (!video || video.missing) return json(200, {kind: 'youtube#videoListResponse', items: []});
				return json(200, {
					kind: 'youtube#videoListResponse',
					items: [{kind: 'youtube#video', id, contentDetails: {duration: isoDuration(video.durationSec ?? 0)}, snippet: {publishedAt: video.publishedAt ?? '2026-10-01T15:00:00Z', ...(video.defaultAudioLanguage ? {defaultAudioLanguage: video.defaultAudioLanguage} : {})}}],
				});
			}
			if (url.pathname === '/youtube/v3/channels') {
				if (url.searchParams.get('mine') !== 'true') return googleError(400, 'badRequest', 'mine=true expected');
				return json(200, {items: [{id: mock.channel.id, snippet: {title: mock.channel.title}}]});
			}
			return googleError(404, 'notFound', `mock: no route ${url.pathname}`);
		}) as typeof fetch,
	};
	return mock;
};

/** Plays the owner's browser: follows the consent URL's redirect_uri with a code (or an error, or a wrong state). */
export const approveInBrowser = async (consentUrl: string, outcome: 'approve' | 'deny' | 'wrong-state' = 'approve'): Promise<void> => {
	const u = new URL(consentUrl);
	const redirect = new URL(u.searchParams.get('redirect_uri')!);
	const state = outcome === 'wrong-state' ? 'not-the-state' : u.searchParams.get('state')!;
	if (outcome === 'deny') redirect.search = new URLSearchParams({error: 'access_denied', state}).toString();
	else redirect.search = new URLSearchParams({code: 'test-code', state}).toString();
	await globalThis.fetch(redirect).then((r) => r.text());
};
