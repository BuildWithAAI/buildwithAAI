import assert from 'node:assert/strict';
import {beforeEach, describe, it} from 'node:test';
import {ApiError, createApi, parseIsoDuration, parseResultTable, retentionUrl, statsUrl, toCurve, toStats} from './api.ts';
import {createMockGoogle, type MockGoogle} from './mock-google.ts';
import {synthCurve} from './synth.ts';

const VIDEO = 'SYNapi00001';
const curve = synthCurve({videoId: VIDEO, channel: 'zoora-ai', slug: 'x', lang: 'en', format: 'long', views: 2000, seed: 5, scenes: [{id: 's01', type: 'hook', durationMs: 3000}, {id: 's02', type: 'talk', durationMs: 30_000}]});

let google: MockGoogle;
const tokens: boolean[] = [];
const api = () => createApi({endpoints: google.endpoints, fetch: google.fetch, sleep: async () => {}, token: async (force) => (tokens.push(force), force ? 'at-fresh' : 'at-old')});
beforeEach(() => {
	google = createMockGoogle();
	tokens.length = 0;
	google.videos.set(VIDEO, {curve, stats: {views: 2000, engagedViews: 1900, averageViewDuration: 21, averageViewPercentage: 63.6, contentType: 'VIDEO_ON_DEMAND'}, durationSec: 33, defaultAudioLanguage: 'en'});
});

describe('request contract (developers.google.com/youtube/analytics, read 2026-11-24)', () => {
	it('retention: channel==MINE, elapsedVideoTimeRatio, ONE video, optional audienceType', () => {
		const url = new URL(retentionUrl(createMockGoogle().endpoints, {videoId: VIDEO, startDate: '2026-10-01', endDate: '2026-11-24', audience: 'ORGANIC'}, ['audienceWatchRatio', 'relativeRetentionPerformance']));
		assert.equal(url.searchParams.get('ids'), 'channel==MINE');
		assert.equal(url.searchParams.get('dimensions'), 'elapsedVideoTimeRatio');
		assert.equal(url.searchParams.get('metrics'), 'audienceWatchRatio,relativeRetentionPerformance');
		assert.equal(url.searchParams.get('filters'), `video==${VIDEO};audienceType==ORGANIC`);
		assert.equal(url.searchParams.get('startDate'), '2026-10-01');
		const all = new URL(retentionUrl(createMockGoogle().endpoints, {videoId: VIDEO, startDate: '2026-10-01', endDate: '2026-11-24', audience: 'all'}, ['audienceWatchRatio']));
		assert.equal(all.searchParams.get('filters'), `video==${VIDEO}`);
	});
	it('stats: views, engaged views and averages by content type for one video', () => {
		const url = new URL(statsUrl(createMockGoogle().endpoints, {videoId: VIDEO, startDate: '2026-10-01', endDate: '2026-11-24'}, true));
		assert.equal(url.searchParams.get('metrics'), 'views,engagedViews,averageViewDuration,averageViewPercentage');
		assert.equal(url.searchParams.get('dimensions'), 'creatorContentType');
		const lean = new URL(statsUrl(createMockGoogle().endpoints, {videoId: VIDEO, startDate: '2026-10-01', endDate: '2026-11-24'}, false));
		assert.equal(lean.searchParams.get('dimensions'), null);
	});
});

describe('response parsing', () => {
	it('maps columns by name, whatever their order, and sorts by ratio', () => {
		const table = parseResultTable({
			kind: 'youtubeAnalytics#resultTable',
			columnHeaders: [{name: 'relativeRetentionPerformance'}, {name: 'elapsedVideoTimeRatio'}, {name: 'audienceWatchRatio'}],
			rows: [[0.6, 0.02, 0.9], [0.55, 0.01, '1.05']],
		});
		assert.deepEqual(toCurve(table), [
			{ratio: 0.01, watch: 1.05, relative: 0.55, started: null, stopped: null, impressions: null},
			{ratio: 0.02, watch: 0.9, relative: 0.6, started: null, stopped: null, impressions: null},
		]);
	});
	it('an omitted rows field means no data, not an error', () => {
		assert.deepEqual(parseResultTable({columnHeaders: [{name: 'elapsedVideoTimeRatio'}, {name: 'audienceWatchRatio'}]}).rows, []);
	});
	it('rejects malformed bodies', () => {
		assert.throws(() => parseResultTable({rows: []}), ApiError);
		assert.throws(() => parseResultTable({columnHeaders: [{name: 'x'}], rows: [1]}), ApiError);
		assert.throws(() => toCurve({columnHeaders: [{name: 'views'}], rows: []}), /lacks elapsedVideoTimeRatio/);
	});
	it('stats: sums views over content types, weights averages, picks the main type', () => {
		const s = toStats({
			columnHeaders: [{name: 'creatorContentType'}, {name: 'views'}, {name: 'engagedViews'}, {name: 'averageViewDuration'}, {name: 'averageViewPercentage'}],
			rows: [['SHORTS', 300, 250, 10, 80], ['VIDEO_ON_DEMAND', 100, 90, 30, 40]],
		});
		assert.equal(s.views, 400);
		assert.equal(s.engagedViews, 340);
		assert.equal(s.contentType, 'SHORTS');
		assert.equal(s.averageViewDurationSec, (10 * 300 + 30 * 100) / 400);
		assert.equal(s.averageViewPercentage, (80 * 300 + 40 * 100) / 400);
	});
	it('reads ISO 8601 durations', () => {
		assert.equal(parseIsoDuration('PT1M5S'), 65);
		assert.equal(parseIsoDuration('PT15M51S'), 951);
		assert.equal(parseIsoDuration('PT2H'), 7200);
		assert.equal(parseIsoDuration('P1DT1S'), 86_401);
		assert.equal(parseIsoDuration('PT59.5S'), 59.5);
		assert.equal(parseIsoDuration('PT'), null);
		assert.equal(parseIsoDuration('1:05'), null);
	});
});

describe('calls (mocked Google)', () => {
	it('pulls the 100-point curve with all five retention metrics', async () => {
		const r = await api().retention({videoId: VIDEO, startDate: '2026-10-01', endDate: '2026-11-24', audience: 'all'});
		assert.equal(r.curve.length, 100);
		assert.deepEqual(r.metrics, ['audienceWatchRatio', 'relativeRetentionPerformance', 'startedWatching', 'stoppedWatching', 'totalSegmentImpressions']);
		assert.equal(r.curve[0]!.started, 2000);
		assert.equal(google.calls('/v2/reports')[0]!.authorization, 'Bearer at-old');
	});
	it('falls back to the two core metrics when YouTube refuses the segment metrics (400)', async () => {
		google.videos.get(VIDEO)!.rejectSegmentMetrics = true;
		const r = await api().retention({videoId: VIDEO, startDate: '2026-10-01', endDate: '2026-11-24', audience: 'all'});
		assert.deepEqual(r.metrics, ['audienceWatchRatio', 'relativeRetentionPerformance']);
		assert.equal(r.curve[0]!.started, null);
		assert.equal(google.calls('/v2/reports').length, 2);
	});
	it('an empty report (too few views, or data still processing) is an empty curve', async () => {
		google.videos.get(VIDEO)!.curve = [];
		const r = await api().retention({videoId: VIDEO, startDate: '2026-10-01', endDate: '2026-11-24', audience: 'all'});
		assert.deepEqual(r.curve, []);
	});
	it('stats fall back without the content-type dimension', async () => {
		google.videos.get(VIDEO)!.rejectStatsDimension = true;
		const s = await api().stats({videoId: VIDEO, startDate: '2026-10-01', endDate: '2026-11-24'});
		assert.equal(s.views, 2000);
		assert.equal(s.contentType, null);
	});
	it('refreshes the access token once after a 401', async () => {
		google.expiredAccessTokens.add('at-old');
		const r = await api().retention({videoId: VIDEO, startDate: '2026-10-01', endDate: '2026-11-24', audience: 'all'});
		assert.equal(r.curve.length, 100);
		assert.deepEqual(tokens, [false, true]);
	});
	it('retries a transient 503, then succeeds', async () => {
		google.failNext.push(503);
		const meta = await api().video(VIDEO);
		assert.equal(meta!.durationSec, 33);
		assert.equal(google.calls('/youtube/v3/videos').length, 2);
	});
	it('does not retry a quota error and explains it', async () => {
		google.failNext.push(403);
		await assert.rejects(api().video(VIDEO), (err: ApiError) => err.status === 403 && err.isQuota && /quotaExceeded/.test(err.message));
	});
	it('videos.list: null for a missing video; channel lookup for auth', async () => {
		google.videos.get(VIDEO)!.missing = true;
		assert.equal(await api().video(VIDEO), null);
		assert.deepEqual(await api().myChannel(), {id: google.channel.id, title: google.channel.title});
	});
	it('a network failure is an ApiError, not a crash', async () => {
		const broken = createApi({endpoints: google.endpoints, fetch: (async () => {
			throw new TypeError('getaddrinfo ENOTFOUND');
		}) as typeof fetch, token: async () => 'x', sleep: async () => {}});
		await assert.rejects(broken.video(VIDEO), (err: ApiError) => err.status === 0 && /could not be reached/.test(err.message));
	});
});
