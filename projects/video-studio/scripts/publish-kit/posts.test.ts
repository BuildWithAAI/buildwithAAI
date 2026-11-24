import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {LIMITS, xWeightedLength} from './limits.ts';
import {resolveOffers} from './offers.ts';
import {bioCaption, bioDisclosure, clipOffers, instagramCaption, pinnedComment, shortDescription, topDisclosure, xPost, youtubeDescription, type PostContext} from './posts.ts';
import {buildChapters} from './timing.ts';
import {exampleEpisode, HUB, NOW, testRegistry} from './test-helpers.ts';
import type {Episode} from './types.ts';

const context = (e: Episode, ids = e.offers): PostContext => {
	const {resolved} = resolveOffers(ids, testRegistry(), NOW);
	return {episode: e, offers: resolved, hub: HUB, chapters: buildChapters(e.scenes, e.totalSec).chapters};
};

describe('topDisclosure', () => {
	const of = (ids: string[]) => topDisclosure(resolveOffers(ids, testRegistry(), NOW).resolved);
	it('names the kinds of relationship present', () => {
		assert.equal(of([]), null);
		assert.equal(of(['hardware-wallet']), 'Disclosure: some links for this video are affiliate links. If you use them, I may earn money. Each one is labelled next to the link.');
		assert.match(of(['hardware-wallet', 'demo-exchange']) ?? '', /are affiliate or referral links/);
		assert.match(of(['own-course']) ?? '', /some links for this video go to my own products/);
		assert.match(of(['hardware-wallet', 'own-course']) ?? '', /affiliate links, and some go to my own products/);
	});
});

describe('YouTube description and pinned comment', () => {
	const e = exampleEpisode({offers: ['hardware-wallet', 'demo-exchange']});
	const ctx = context(e);
	const text = youtubeDescription(ctx);
	const lines = text.split('\n');
	it('opens with the disclosure and puts each disclosure right after its link', () => {
		assert.equal(lines[0], topDisclosure(ctx.offers));
		const at = lines.findIndex((l) => l.startsWith('Test hardware wallet: https://go.zoora.ai/go/hardware-wallet?v=_example&s=yt'));
		assert.ok(at > 0);
		assert.equal(lines[at + 1], 'Affiliate link: I may earn a commission if you buy. It costs you nothing extra.');
	});
	it('never names a region-restricted offer and points to the region-filtered page instead', () => {
		assert.ok(!text.includes('Demo Exchange'));
		assert.ok(!text.includes('/go/demo-exchange'));
		assert.ok(text.includes('only where they are available in your country: https://go.zoora.ai/?v=_example&s=yt'));
	});
	it('includes chapters, sources, the safety line and at most 3 hashtags', () => {
		assert.ok(text.includes('Chapters:\n00:00 Cold open: a free airdrop\n00:30 How the fake claim page works'));
		assert.ok(text.includes('Sources:\nFTC: What to know about cryptocurrency and scams: https://consumer.ftc.gov/'));
		assert.ok(text.includes('Zoora AI will never DM you first'));
		assert.equal(lines[lines.length - 1], '#CryptoSecurity #WalletDrainer #ScamAwareness');
	});
	it('the pinned comment carries the disclosure, the links and the safety line', () => {
		const pinned = pinnedComment(ctx);
		assert.ok(pinned.startsWith(topDisclosure(ctx.offers) ?? 'x'));
		assert.ok(pinned.includes('https://go.zoora.ai/go/hardware-wallet?v=_example&s=yt\nAffiliate link:'));
		assert.match(pinned, /Replies that do are impersonators/);
		const plain = pinnedComment(context(exampleEpisode({offers: [], scenes: exampleEpisode().scenes.map(({id, chapter, endSec, startSec}) => ({id, ...(chapter ? {chapter} : {}), durationSec: endSec - startSec}))})));
		assert.ok(plain.startsWith('Safety:'));
	});
});

describe('clips: Shorts, TikTok, Reels and X', () => {
	const e = exampleEpisode();
	const ctx = context(e);
	const [first, second] = e.shorts;
	it('Shorts and bio captions have no URLs; a clip that promotes an offer carries its disclosure', () => {
		for (const text of [shortDescription(ctx, first), shortDescription(ctx, second), bioCaption(ctx, first, 5), bioCaption(ctx, second, 5)]) {
			assert.ok(!/https?:\/\//.test(text), text);
		}
		assert.ok(bioCaption(ctx, second, 5).includes('Mentioned: Test hardware wallet. Affiliate link: I may earn a commission'));
		assert.ok(!bioCaption(ctx, first, 5).includes('Mentioned:'));
		assert.ok(bioCaption(ctx, first, 5).includes('Link in bio: go.zoora.ai'));
		assert.ok(shortDescription(ctx, first).includes('tap the related video link'));
	});
	it('X posts fit 280 weighted characters and link offers through the hub with s=x', () => {
		const post = xPost(ctx, second);
		assert.ok(xWeightedLength(post) <= LIMITS.xWeighted);
		assert.ok(post.includes('Test hardware wallet: https://go.zoora.ai/go/hardware-wallet?v=_example&s=x\nAffiliate link:'));
		assert.ok(post.includes('Full episode: https://www.youtube.com/@ZooraTechnologies'));
	});
	it('X drops hashtags before anything else, never the disclosure, and links the video once known', () => {
		const post = xPost(context({...e, youtubeVideoId: 'AbCdEfGh123'}), {...second, hook: 'A'.repeat(120)});
		assert.ok(!post.includes('#'));
		assert.ok(post.includes('/go/hardware-wallet?v=_example&s=x\nAffiliate link: I may earn a commission'));
		assert.ok(post.includes('Full episode: https://youtu.be/AbCdEfGh123'));
		assert.ok(xWeightedLength(post) > LIMITS.xWeighted, 'too long: the x-post check reports it');
	});
	it('the Instagram feed caption uses the bio link and at most 5 hashtags', () => {
		const caption = instagramCaption(ctx);
		assert.ok(caption.includes('Link in bio: go.zoora.ai'));
		assert.equal((caption.match(/#\w+/g) ?? []).length, 5);
	});
	it('the Instagram caption opens with a disclosure of the bio links when the episode has offers (review 2026-11-24)', () => {
		const lines = instagramCaption(ctx).split('\n');
		assert.equal(lines[1], bioDisclosure(ctx.offers));
		assert.equal(lines[1], 'Disclosure: some links in my bio are affiliate links. If you use them, I may earn money.');
		const noOffers = instagramCaption(context(exampleEpisode({offers: [], scenes: exampleEpisode().scenes.map(({id, chapter, endSec, startSec}) => ({id, ...(chapter ? {chapter} : {}), durationSec: endSec - startSec}))})));
		assert.ok(!noOffers.includes('Disclosure'));
	});
	it('the Instagram caption adds the disclosure of an offer its summary names', () => {
		const named = exampleEpisode({summary: 'We test the Test hardware wallet against a fake airdrop drainer and show why it helps.'});
		const caption = instagramCaption(context(named));
		assert.ok(caption.includes('Mentioned: Test hardware wallet. Affiliate link: I may earn a commission if you buy. It costs you nothing extra.'), caption);
		assert.ok(caption.indexOf('Mentioned:') < caption.indexOf('We test the'), 'disclosures come before the "more" fold');
	});
	it('a clip whose hook names an offer carries its disclosure even when its scenes do not promote it', () => {
		const clip = {...first, hook: 'Why the Test hardware wallet asks you to confirm on its screen.'};
		assert.deepEqual(clipOffers(ctx, clip).map((o) => o.id), ['hardware-wallet']);
		for (const text of [shortDescription(ctx, clip), bioCaption(ctx, clip, 5)]) assert.ok(text.includes('Mentioned: Test hardware wallet. Affiliate link:'), text);
		assert.ok(xPost(ctx, clip).includes('/go/hardware-wallet?v=_example&s=x\nAffiliate link:'));
	});
	it('a restricted offer is never added to a clip, even when the hook names it', () => {
		const e2 = exampleEpisode({offers: ['hardware-wallet', 'demo-exchange']});
		const clip = {...e2.shorts[0], hook: 'Demo Exchange sign-ups explained'};
		assert.deepEqual(clipOffers(context(e2), clip), []);
		assert.ok(!bioCaption(context(e2), clip, 5).includes('Mentioned:'));
	});
});
