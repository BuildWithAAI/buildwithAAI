import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, it} from 'node:test';
import {buildKit, type BuildOptions} from './kit.ts';
import {exampleEpisode, HUB, NOW, PROJECT, testRegistry} from './test-helpers.ts';
import type {Episode, OfferRegistry} from './types.ts';

const opts = (registry: OfferRegistry = testRegistry(), over: Partial<BuildOptions> = {}): BuildOptions => ({
	hub: HUB,
	registry,
	registryPath: 'scripts/publish-kit/fixtures/offers.test.json',
	registryIsExample: false,
	now: NOW,
	...over,
});
const failing = (e: Episode, o: BuildOptions = opts()) =>
	buildKit(e, o)
		.kit.checks.filter((c) => !c.ok)
		.map((c) => c.id);
const detail = (e: Episode, id: string, o: BuildOptions = opts()): string => buildKit(e, o).kit.checks.find((c) => c.id === id)?.detail ?? '';

/** Scenes as episode.json input (durations), to rebuild the example with changes. */
const sceneFiles = (e: Episode) => e.scenes.map((s) => ({id: s.id, ...(s.chapter ? {chapter: s.chapter} : {}), durationSec: s.endSec - s.startSec, ...(s.offers.length ? {offers: s.offers} : {})}));

const KIT_KEYS = ['version', 'channel', 'slug', 'youtubeVideoId', 'title', 'titleOptions', 'summary', 'chapters', 'sources', 'offers', 'disclosures', 'posts', 'captions', 'renders', 'settings', 'checks', 'generatedAt'];

describe('buildKit on the example with active offers', () => {
	const {kit, files} = buildKit(exampleEpisode(), opts());
	it('passes every check', () => {
		assert.deepEqual(
			kit.checks.filter((c) => !c.ok),
			[],
		);
		assert.deepEqual(kit.checks.map((c) => c.id), [
			'youtube-title',
			'youtube-description',
			'youtube-tags',
			'shorts-text',
			'tiktok-caption',
			'reels-caption',
			'instagram-caption',
			'x-post',
			'hashtags',
			'chapters',
			'short-durations',
			'x-video-length',
			'disclosures',
			'spoken-disclosure',
			'income-claims',
			'placeholders',
			'links-via-hub',
			'restricted-offers',
			'offers-live',
			'made-for-kids',
			'synthetic-media',
			'captions',
		]);
	});
	it('kit.json is exactly the PublishKit contract', () => {
		assert.deepEqual(Object.keys(kit), KIT_KEYS);
		assert.deepEqual(Object.keys(kit.posts), ['youtube', 'shorts', 'tiktok', 'reels', 'x', 'instagram']);
		for (const post of Object.values(kit.posts)) assert.deepEqual(Object.keys(post), ['text', 'charCount', 'limit', 'notes']);
		assert.deepEqual(Object.keys(kit.settings), ['madeForKids', 'containsSyntheticMedia', 'paidPromotion', 'reasons']);
		assert.deepEqual(Object.keys(kit.captions), ['srt', 'vtt']);
		for (const r of kit.renders) assert.deepEqual(Object.keys(r), ['id', 'kind', 'command', 'output']);
		assert.deepEqual(JSON.parse(files['kit.json']), kit);
	});
	it('fills the contract fields', () => {
		assert.equal(kit.version, 1);
		assert.equal(kit.youtubeVideoId, null);
		assert.deepEqual(kit.chapters[0], {start: '00:00', title: 'Cold open: a free airdrop'});
		assert.deepEqual(kit.offers, [{id: 'hardware-wallet', hubUrl: 'https://go.zoora.ai/go/hardware-wallet?v=_example&s=yt', disclosure: 'Affiliate link: I may earn a commission if you buy. It costs you nothing extra.'}]);
		assert.equal(kit.settings.paidPromotion, true);
		assert.equal(kit.settings.madeForKids, false);
		assert.equal(kit.settings.containsSyntheticMedia, false);
		assert.equal(kit.settings.reasons.length, 3);
		assert.match(kit.settings.reasons[2], /^paidPromotion=true: affiliate offer "hardware-wallet"/);
		assert.ok(kit.disclosures.includes('Affiliate link: I may earn a commission if you buy. It costs you nothing extra.'));
		assert.ok(kit.captions.srt?.startsWith('1\n00:00:00,400 --> '));
		assert.ok(kit.captions.vtt?.startsWith('WEBVTT\n\n'));
		assert.equal(kit.posts.youtube.limit, 5000);
		assert.equal(kit.posts.x.limit, 280);
		assert.equal(kit.generatedAt, NOW.toISOString());
	});
	it('writes every output file', () => {
		assert.deepEqual(Object.keys(files).sort(), [
			'captions.srt',
			'captions.vtt',
			'checklist.md',
			'instagram.txt',
			'kit.json',
			'pinned-comment.txt',
			'reels.txt',
			'render-plan.sh',
			'shorts-1.txt',
			'shorts-2.txt',
			'tiktok.txt',
			'x.txt',
			'youtube-description.txt',
		]);
		assert.match(files['checklist.md'], /tick\*\* "My video contains paid promotion/);
		assert.match(files['checklist.md'], /Say it out loud AND show it on screen in scene s06/);
		assert.match(files['checklist.md'], /Content disclosure setting: turn it on for clip 2/);
		assert.match(files['checklist.md'], /Paid partnership label: add it to clip 2/);
		assert.match(files['checklist.md'], /22 of 22 checks pass/);
		assert.match(files['tiktok.txt'], /^=== Clip 1 of 2: media\/short-1\.mp4 \(0:30\)/);
	});
});

describe('failing checks', () => {
	it('the placeholder example registry fails only offers-live', () => {
		const example = JSON.parse(readFileSync(join(PROJECT, '../creator-hub/config/offers.example.json'), 'utf8')) as OfferRegistry;
		const o = opts(example, {registryIsExample: true});
		assert.deepEqual(failing(exampleEpisode(), o), ['offers-live']);
		assert.match(detail(exampleEpisode(), 'offers-live', o), /inactive or expired.*placeholder offers\.example\.json/);
	});
	it('a region-restricted offer promoted in a scene fails, and posts never name it', () => {
		const base = exampleEpisode();
		const scenes = sceneFiles(base).map((s) => (s.id === 's06' ? {...s, offers: ['hardware-wallet', 'demo-exchange']} : s));
		const e = exampleEpisode({offers: ['hardware-wallet', 'demo-exchange'], scenes});
		const {kit, files} = buildKit(e, opts());
		assert.deepEqual(
			kit.checks.filter((c) => !c.ok).map((c) => c.id),
			['restricted-offers'],
		);
		assert.match(kit.checks.find((c) => c.id === 'restricted-offers')?.detail ?? '', /scene s06 promotes "demo-exchange", which is restricted by region \(US, GB\)/);
		for (const [name, text] of Object.entries(files)) if (name.endsWith('.txt')) assert.ok(!text.includes('Demo Exchange') && !text.includes('/go/demo-exchange'), name);
		assert.ok(kit.offers.some((o) => o.id === 'demo-exchange' && /Crypto assets are high risk/.test(o.disclosure)));
	});
	it('a restricted offer only reachable through the hub page passes', () => {
		assert.deepEqual(failing(exampleEpisode({offers: ['hardware-wallet', 'demo-exchange']})), []);
	});
	it('income claims anywhere fail', () => {
		const e = exampleEpisode({titleOptions: ['This airdrop is guaranteed to 100x'], title: 'This airdrop is guaranteed to 100x'});
		assert.deepEqual(failing(e), ['income-claims']);
		assert.match(detail(e, 'income-claims'), /titleOptions\[0\]: guaranteed/);
	});
	it('an offer missing from the registry is left out of every post and fails', () => {
		const e = exampleEpisode({offers: ['hardware-wallet', 'unknown-offer']});
		const {kit} = buildKit(e, opts());
		assert.deepEqual(kit.offers.map((o) => o.id), ['hardware-wallet']);
		assert.match(kit.checks.find((c) => c.id === 'offers-live')?.detail ?? '', /"unknown-offer" is not in the offer registry/);
		assert.equal(kit.settings.paidPromotion, true);
	});
	it('without offers nothing needs disclosing and paid promotion is off', () => {
		const e = exampleEpisode({offers: [], scenes: sceneFiles(exampleEpisode()).map(({offers: _o, ...s}) => (void _o, s))});
		const {kit, files} = buildKit(e, opts());
		assert.deepEqual(kit.checks.filter((c) => !c.ok), []);
		assert.equal(kit.settings.paidPromotion, false);
		assert.ok(!files['youtube-description.txt'].startsWith('Disclosure'));
		assert.match(files['checklist.md'], /Paid promotion: leave it unticked/);
	});
	it('an offer without captions cannot be verified as spoken', () => {
		const e = exampleEpisode({}, {captions: null});
		assert.deepEqual(failing(e), ['spoken-disclosure']);
		assert.match(detail(e, 'spoken-disclosure'), /confirm by ear that scenes s06 say/);
		assert.equal(buildKit(e, opts()).kit.captions.srt, null);
	});
	it('an offer with no scene marked as promoting it fails the spoken check', () => {
		const e = exampleEpisode({scenes: sceneFiles(exampleEpisode()).map(({offers: _o, ...s}) => (void _o, s))});
		assert.match(detail(e, 'spoken-disclosure'), /no scene is marked as promoting "hardware-wallet"/);
	});
	it('broken chapter rules empty the chapter list and fail', () => {
		const scenes = sceneFiles(exampleEpisode()).map((s) => (s.id === 's01' ? {id: 's01', durationSec: 14} : s));
		const e = exampleEpisode({scenes});
		const {kit, files} = buildKit(e, opts());
		assert.deepEqual(kit.chapters, []);
		assert.ok(!files['youtube-description.txt'].includes('Chapters:'));
		assert.deepEqual(failing(e), ['chapters']);
	});
	it('long clips fail the Shorts and X limits', () => {
		const scenes = sceneFiles(exampleEpisode()).map((s) => (s.id === 's06' ? {...s, durationSec: 160} : s));
		const e = exampleEpisode({scenes});
		assert.deepEqual(failing(e), ['short-durations', 'x-video-length']);
	});
});
