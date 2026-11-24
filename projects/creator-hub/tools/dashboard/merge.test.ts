import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {describe, it} from 'node:test';
import {readCatalog, readKits} from './catalog.ts';
import {readHubCsv} from './hub-clicks.ts';
import {mergeInputs, type MergeInput} from './merge.ts';
import type {DashboardVideo, StudioVideo} from './model.ts';
import {checkPayoutConfig, readPayoutCsv} from './payouts.ts';
import {readStudioCsv} from './studio-csv.ts';
import {mapReportRows} from './youtube-api.ts';

const fixture = (name: string): string => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

/** Every fixture input, as the CLI would load it. */
const loadAll = (): MergeInput => {
	const config = checkPayoutConfig(JSON.parse(readFileSync(fixture('payouts.json'), 'utf8'))).config;
	assert.ok(config);
	const [wallet, eu] = config.programmes;
	return {
		channel: 'zoora-ai',
		studio: [readStudioCsv(fixture('studio-content.csv')).videos],
		api: null,
		catalog: readCatalog(fixture('videos.csv')).entries,
		kits: readKits(fixture('kits')).kits,
		hub: readHubCsv(fixture('hub-video-clicks.csv')).hub,
		payouts: [...readPayoutCsv(fixture('payouts/wallet-network.csv'), wallet!).rows, ...readPayoutCsv(fixture('payouts/eu-tools.csv'), eu!).rows],
		coveredOffers: new Set(['hardware-wallet', 'password-manager']),
		rates: config.rates,
	};
};

const byId = (videos: DashboardVideo[], id: string): DashboardVideo => {
	const video = videos.find((v) => v.videoId === id);
	assert.ok(video, `no row for ${id}`);
	return video;
};

describe('merge', () => {
	it('puts every input for a video on one row, following slugs and aliases to the YouTube id', () => {
		const {videos, issues} = mergeInputs(loadAll());
		assert.equal(videos.length, 12, 'the channel-2 row in videos.csv is left out');
		assert.ok(issues.some((i) => /1 videos.csv row\(s\) belong to another channel/.test(i.message)));
		const v = byId(videos, 'fixture0002');
		assert.equal(v.title, 'POV: "Support" DMs you first, then your wallet is gone (fixture)');
		assert.equal(v.format, 'long');
		assert.equal(v.formatSource, 'catalog');
		assert.equal(v.views, 18900);
		assert.equal(v.ctr, 0.074);
		assert.equal(v.hubClicks, 88 + 12 + 5, 'yt clicks plus the slug clicks from the email and X');
		assert.equal(v.hubClicksYoutube, 88, 'only s=yt counts against YouTube views');
		assert.equal(v.conversions, 2, 'sub-ids fixture0002.yt and fake-support-dm.email');
		assert.equal(v.affiliateRevenueUsd, 36);
		assert.equal(v.adRevenueUsd, 52.4);
		assert.equal(v.revenueUsd, 88.4);
		assert.deepEqual(v.tags, ['scams', 'wallet security']);
		assert.deepEqual(v.inputs, ['studio', 'videos.csv', 'kit', 'hub', 'payouts']);
	});

	it('matches ids without regard to case only when the exact id is unknown, and says so', () => {
		const {videos, issues} = mergeInputs(loadAll());
		const v = byId(videos, 'FixtureCase');
		assert.equal(v.hubClicks, 22, 'alias drainer-links');
		assert.equal(v.affiliateRevenueUsd, 1005.5, 'sub-id fixturecase.yt, lower-cased by the network');
		assert.ok(issues.some((i) => /without regard to upper\/lower case: fixturecase/.test(i.message)));
	});

	it('nets reversals, keeps unconverted currencies apart and counts no-source clicks as YouTube', () => {
		const {videos} = mergeInputs(loadAll());
		assert.deepEqual([byId(videos, 'fixture0005').conversions, byId(videos, 'fixture0005').affiliateRevenueUsd], [1, 18]);
		const eur = byId(videos, 'fixture0007');
		assert.equal(eur.affiliateRevenueUsd, 0);
		assert.deepEqual(eur.affiliateRevenueOther, [{currency: 'EUR', amount: 19.75}]);
		assert.equal(eur.revenueUsd, 27.5, 'only the USD part is in revenueUsd');
		assert.equal(byId(videos, 'fixture0010').hubClicksYoutube, 4);
		assert.equal(byId(videos, '-fixture011').hubClicks, 9);
		assert.equal(byId(videos, 'fixture0008').adRevenueUsd, null, 'empty revenue cell stays unknown');
		assert.equal(byId(videos, 'fixture0008').revenueUsd, 0, 'affiliate payouts were imported, so revenue is known to be 0');
		assert.equal(byId(videos, 'fixture0012').conversions, 0);
	});

	it('converts other currencies when the config has a rate', () => {
		const input = loadAll();
		const {videos} = mergeInputs({...input, rates: {EUR: {usdPerUnit: 1.1, asOf: '2026-11-01', source: null}}});
		const eur = byId(videos, 'fixture0007');
		assert.equal(eur.affiliateRevenueUsd, 21.73);
		assert.deepEqual(eur.affiliateRevenueOther, []);
	});

	it('reports what it could not tie to a video', () => {
		const {unattributed} = mergeInputs(loadAll());
		assert.equal(unattributed.noVideoClicks, 17);
		assert.deepEqual([...unattributed.unknownVideoClicks], [['unknown-slug', 3]]);
		assert.equal(unattributed.noVideoPayouts.conversions, 2, 'none.bio and the unreadable sub-id');
		assert.equal(unattributed.noVideoPayouts.usd, 36);
	});

	it('summarises offers, with null where no payout file covers the offer', () => {
		const {offers} = mergeInputs(loadAll());
		const get = (id: string) => offers.find((o) => o.offerId === id);
		assert.deepEqual([get('hardware-wallet')?.clicks, get('hardware-wallet')?.conversions, get('hardware-wallet')?.revenueUsd], [277, 5, 90]);
		assert.deepEqual([get('password-manager')?.clicks, get('password-manager')?.conversions, get('password-manager')?.revenueUsd], [52, 4, 1005.5]);
		assert.deepEqual(get('password-manager')?.revenueOther, [{currency: 'EUR', amount: 1019.75}]);
		assert.deepEqual([get('exchange-demo')?.clicks, get('exchange-demo')?.conversions, get('exchange-demo')?.revenueUsd], [40, null, null]);
		assert.deepEqual([get('(offer not mapped)')?.conversions, get('(offer not mapped)')?.revenueUsd], [1, 9]);
		assert.equal(offers[0]?.offerId, 'hardware-wallet', 'sorted by clicks');
	});

	it('leaves payout fields null and clicks 0 when those inputs are missing', () => {
		const input = loadAll();
		const {videos, offers} = mergeInputs({...input, hub: null, payouts: null, coveredOffers: new Set()});
		const v = byId(videos, 'fixture0002');
		assert.deepEqual([v.hubClicks, v.conversions, v.affiliateRevenueUsd, v.revenueUsd], [0, null, null, 52.4]);
		assert.equal(offers.length, 0);
	});

	it('guesses the format from the duration when nothing else says it, and notes it', () => {
		const input = loadAll();
		const {videos, issues} = mergeInputs({...input, catalog: null, kits: []});
		assert.deepEqual([byId(videos, 'fixture0009').format, byId(videos, 'fixture0009').formatSource], ['short', 'duration']);
		assert.deepEqual([byId(videos, 'fixture0001').format, byId(videos, 'fixture0001').formatSource], ['long', 'duration']);
		assert.ok(issues.some((i) => /format guessed for 12 video\(s\)/.test(i.message)));
	});

	it('lets a later Studio file replace an earlier one, and keeps non-USD Studio revenue apart', () => {
		const base: StudioVideo = {
			videoId: 'abcdefghijk', title: 'Old', publishedAt: null, durationSec: 600, contentType: null, views: 10, engagedViews: null, watchTimeHours: null,
			impressions: null, ctr: null, avgViewDurationSec: null, avgPercentViewed: null, subscribersNet: null, subscribersGained: null, subscribersLost: null,
			revenue: {currency: 'EUR', amount: 5},
		};
		const input: MergeInput = {channel: 'zoora-ai', studio: [[base], [{...base, title: 'New', views: 20}]], api: null, catalog: null, kits: [], hub: null, payouts: null, rates: {}};
		const {videos, issues} = mergeInputs(input);
		assert.deepEqual([videos[0]?.title, videos[0]?.views, videos[0]?.adRevenueUsd], ['New', 20, null]);
		assert.deepEqual(videos[0]?.adRevenueOther, {currency: 'EUR', amount: 5});
		assert.ok(issues.some((i) => /appear in more than one Studio export/.test(i.message)));
		const converted = mergeInputs({...input, rates: {EUR: {usdPerUnit: 2, asOf: '2026-11-01', source: null}}}).videos[0];
		assert.deepEqual([converted?.adRevenueUsd, converted?.adRevenueOther], [10, null]);
	});

	it('takes views, retention and revenue from the API first, and impressions and CTR from Studio', () => {
		const report = JSON.parse(readFileSync(fixture('api-report.json'), 'utf8'));
		const api = mapReportRows(report);
		const {videos} = mergeInputs({...loadAll(), api});
		assert.equal(videos.length, 13, 'the live stream exists only in the API');
		const v = byId(videos, 'fixture0002');
		assert.deepEqual([v.views, v.avgViewDurationSec, v.avgPercentViewed, v.subscribersGained, v.adRevenueUsd], [19350, 297, 0.432, 240, 53.8]);
		assert.deepEqual([v.impressions, v.ctr], [201100, 0.074]);
		assert.equal(v.subscribersNet, 225);
		const live = byId(videos, 'fixtureLive');
		assert.deepEqual([live.format, live.formatSource, live.views], ['long', 'api', 5000]);
	});
});
