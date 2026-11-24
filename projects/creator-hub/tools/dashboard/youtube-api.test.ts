/** YouTube Analytics API v2 client against recorded/mocked responses. No live call is made. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {describe, it} from 'node:test';
import {buildReportUrl, fetchVideoReport, mapReportRows, PAGE_SIZE, REPORTS_URL, resolveAccessToken, TOKEN_URL, YouTubeApiError, type FetchLike} from './youtube-api.ts';

const FIXTURE = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/api-report.json', import.meta.url)), 'utf8'));
const TOKEN = 'test-access-token-not-real';

type Call = {url: string; init: RequestInit | undefined};
const mockFetch = (responses: (() => Response)[]): {fetch: FetchLike; calls: Call[]} => {
	const calls: Call[] = [];
	const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
		calls.push({url: String(input), init});
		const next = responses.shift();
		assert.ok(next, `unexpected request to ${String(input)}`);
		return next();
	}) as FetchLike;
	return {fetch: fetchImpl, calls};
};
const json = (status: number, body: unknown): (() => Response) => () => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});

describe('reports.query request', () => {
	it('asks for the top-videos report with the documented parameters', () => {
		const url = new URL(buildReportUrl({startDate: '2026-10-01', endDate: '2026-11-23', includeRevenue: false}));
		assert.equal(`${url.origin}${url.pathname}`, REPORTS_URL);
		assert.equal(url.searchParams.get('ids'), 'channel==MINE');
		assert.equal(url.searchParams.get('startDate'), '2026-10-01');
		assert.equal(url.searchParams.get('endDate'), '2026-11-23');
		assert.equal(url.searchParams.get('metrics'), 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost');
		assert.equal(url.searchParams.get('dimensions'), 'video,creatorContentType');
		assert.equal(url.searchParams.get('sort'), '-views');
		assert.equal(url.searchParams.get('maxResults'), '200');
		assert.equal(url.searchParams.get('startIndex'), '1');
		assert.equal(url.searchParams.has('currency'), false);
		const revenue = new URL(buildReportUrl({startDate: '2026-10-01', endDate: '2026-11-23', includeRevenue: true, startIndex: 201}));
		assert.match(revenue.searchParams.get('metrics') ?? '', /,estimatedRevenue$/);
		assert.equal(revenue.searchParams.get('currency'), 'USD');
		assert.equal(revenue.searchParams.get('startIndex'), '201');
		assert.ok(!/impressions/i.test(revenue.href), 'the API has no thumbnail impressions metric, so none is requested');
	});
});

describe('reports.query response', () => {
	it('maps rows by column name and merges content types of one video', () => {
		const videos = mapReportRows(FIXTURE);
		assert.deepEqual(videos.map((v) => v.videoId), ['fixture0009', 'fixture0002', 'fixtureLive'], 'the row with an invalid id is skipped');
		const short = videos[0];
		assert.deepEqual(
			[short?.format, short?.views, short?.estimatedMinutesWatched, short?.avgViewDurationSec, short?.avgPercentViewed, short?.subscribersGained, short?.subscribersLost, short?.revenueUsd],
			['short', 42100, 18900, 27, 0.799, 318, 22, 3.25],
		);
		const live = videos[2];
		assert.equal(live?.views, 5000);
		assert.equal(live?.format, 'long', 'VIDEO_ON_DEMAND has more views than LIVE_STREAM; both are long-form');
		assert.equal(live?.avgViewDurationSec, (1500 * 1200 + 360 * 3800) / 5000);
		assert.ok(Math.abs((live?.avgPercentViewed ?? 0) - 0.276) < 1e-12);
		assert.deepEqual([live?.subscribersGained, live?.subscribersLost, live?.revenueUsd], [40, 3, 11]);
	});

	it('handles a response without rows and without optional columns', () => {
		assert.deepEqual(mapReportRows({columnHeaders: [{name: 'video'}, {name: 'views'}], rows: []}), []);
		const [v] = mapReportRows({columnHeaders: [{name: 'views'}, {name: 'video'}], rows: [[7, 'abcdefghijk']]});
		assert.deepEqual([v?.views, v?.format, v?.revenueUsd, v?.avgViewDurationSec], [7, null, null, null]);
		assert.throws(() => mapReportRows({columnHeaders: [{name: 'day'}], rows: []}), YouTubeApiError);
	});

	it('sends the token only in the Authorization header and pages through 200 rows at a time', async () => {
		const page1 = {...FIXTURE, rows: Array.from({length: PAGE_SIZE}, (_, i) => [`p1${String(i).padStart(9, '0')}`, 'VIDEO_ON_DEMAND', 10, 1, 60, 50, 0, 0, 0])};
		const page2 = {...FIXTURE, rows: FIXTURE.rows.slice(0, 2)};
		const {fetch, calls} = mockFetch([json(200, page1), json(200, page2)]);
		const videos = await fetchVideoReport(fetch, TOKEN, {startDate: '2026-10-01', endDate: '2026-11-23', includeRevenue: true});
		assert.equal(videos.length, PAGE_SIZE + 2);
		assert.deepEqual(calls.map((c) => new URL(c.url).searchParams.get('startIndex')), ['1', '201']);
		for (const call of calls) {
			assert.equal((call.init?.headers as Record<string, string>).Authorization, `Bearer ${TOKEN}`);
			assert.ok(!call.url.includes(TOKEN));
		}
	});

	it('stops after a page with no rows (the API omits "rows")', async () => {
		const {fetch, calls} = mockFetch([json(200, {kind: 'youtubeAnalytics#resultTable', columnHeaders: FIXTURE.columnHeaders})]);
		assert.deepEqual(await fetchVideoReport(fetch, TOKEN, {startDate: '2026-10-01', endDate: '2026-11-23', includeRevenue: false}), []);
		assert.equal(calls.length, 1);
	});

	it('turns API errors into readable messages without the token', async () => {
		const forbidden = mockFetch([json(403, {error: {code: 403, message: 'Forbidden', status: 'PERMISSION_DENIED'}})]);
		await assert.rejects(fetchVideoReport(forbidden.fetch, TOKEN, {startDate: '2026-10-01', endDate: '2026-11-23', includeRevenue: true}), (err: unknown) => {
			assert.ok(err instanceof YouTubeApiError);
			assert.equal(err.status, 403);
			assert.match(err.message, /returned 403: Forbidden \(the token lacks the scope/);
			assert.ok(!err.message.includes(TOKEN));
			return true;
		});
		const html = mockFetch([() => new Response('<html>', {status: 200})]);
		await assert.rejects(fetchVideoReport(html.fetch, TOKEN, {startDate: '2026-10-01', endDate: '2026-11-23', includeRevenue: false}), /not JSON/);
		const offline = {fetch: (async () => {
			throw new TypeError('getaddrinfo ENOTFOUND youtubeanalytics.googleapis.com');
		}) as FetchLike};
		await assert.rejects(fetchVideoReport(offline.fetch, TOKEN, {startDate: '2026-10-01', endDate: '2026-11-23', includeRevenue: false}), /not reachable: getaddrinfo ENOTFOUND/);
		const shape = mockFetch([json(200, {kind: 'x'})]);
		await assert.rejects(fetchVideoReport(shape.fetch, TOKEN, {startDate: '2026-10-01', endDate: '2026-11-23', includeRevenue: false}), /no columnHeaders/);
	});
});

describe('access token', () => {
	it('uses YT_ANALYTICS_ACCESS_TOKEN as is', async () => {
		const {fetch, calls} = mockFetch([]);
		assert.equal(await resolveAccessToken({YT_ANALYTICS_ACCESS_TOKEN: ` ${TOKEN} `}, fetch), TOKEN);
		assert.equal(calls.length, 0);
	});

	it('exchanges the refresh token at the documented endpoint', async () => {
		const {fetch, calls} = mockFetch([json(200, {access_token: 'fresh-token', expires_in: 3599, scope: 'https://www.googleapis.com/auth/yt-analytics.readonly', token_type: 'Bearer'})]);
		const token = await resolveAccessToken({YT_ANALYTICS_CLIENT_ID: 'client-id', YT_ANALYTICS_CLIENT_SECRET: 'client-secret', YT_ANALYTICS_REFRESH_TOKEN: 'refresh-token'}, fetch);
		assert.equal(token, 'fresh-token');
		assert.equal(calls[0]?.url, TOKEN_URL);
		assert.equal(calls[0]?.init?.method, 'POST');
		const form = new URLSearchParams(String(calls[0]?.init?.body));
		assert.deepEqual(Object.fromEntries(form), {client_id: 'client-id', grant_type: 'refresh_token', refresh_token: 'refresh-token', client_secret: 'client-secret'});
	});

	it('explains what is missing or what the token endpoint said', async () => {
		await assert.rejects(resolveAccessToken({}, mockFetch([]).fetch), /needs YT_ANALYTICS_ACCESS_TOKEN, or YT_ANALYTICS_CLIENT_ID and YT_ANALYTICS_REFRESH_TOKEN/);
		const denied = mockFetch([json(400, {error: 'invalid_grant', error_description: 'Token has been expired or revoked.'})]);
		await assert.rejects(resolveAccessToken({YT_ANALYTICS_CLIENT_ID: 'c', YT_ANALYTICS_REFRESH_TOKEN: 'r'}, denied.fetch), /returned 400: Token has been expired or revoked\./);
		const empty = mockFetch([json(200, {token_type: 'Bearer'})]);
		await assert.rejects(resolveAccessToken({YT_ANALYTICS_CLIENT_ID: 'c', YT_ANALYTICS_REFRESH_TOKEN: 'r'}, empty.fetch), /no access_token/);
	});
});
