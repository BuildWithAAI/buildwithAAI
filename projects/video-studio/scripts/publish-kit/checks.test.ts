import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {runChecks, type PostTexts} from './checks.ts';
import {resolveOffers} from './offers.ts';
import {bioCaption, instagramCaption, pinnedComment, shortDescription, xPost, youtubeDescription, type ClipText, type PostContext} from './posts.ts';
import {exampleEpisode, HUB, NOW, testRegistry} from './test-helpers.ts';
import {buildChapters} from './timing.ts';
import type {Short} from './types.ts';

const e = exampleEpisode();
const ctx: PostContext = {episode: e, offers: resolveOffers(e.offers, testRegistry(), NOW).resolved, hub: HUB, chapters: buildChapters(e.scenes, e.totalSec).chapters};
const clips = (make: (s: Short) => string): ClipText[] => e.shorts.map((short) => ({short, text: make(short)}));
const generated = (): PostTexts => ({
	youtube: youtubeDescription(ctx),
	pinned: pinnedComment(ctx),
	shorts: clips((s) => shortDescription(ctx, s)),
	tiktok: clips((s) => bioCaption(ctx, s, 5)),
	reels: clips((s) => bioCaption(ctx, s, 5)),
	x: clips((s) => xPost(ctx, s)),
	instagram: instagramCaption(ctx),
});
const disclosures = (texts: PostTexts): string =>
	runChecks({ctx, texts, missingOffers: [], registryIsExample: false, chapterProblems: [], destinationHosts: []}).find((c) => c.id === 'disclosures')?.detail ?? '';

describe('the disclosures check reads every caption (review 2026-11-24)', () => {
	it('passes on the generated texts', () => {
		assert.match(disclosures(generated()), /^disclosure first in the description/);
	});
	it('fails an Instagram caption without the bio-link disclosure', () => {
		assert.match(disclosures({...generated(), instagram: 'POV: You almost sign a wallet drainer\n\nLink in bio: go.zoora.ai'}), /instagram\.txt does not disclose that the bio links include/);
	});
	it('fails an Instagram caption that names an offer without its disclosure', () => {
		const texts = generated();
		assert.match(disclosures({...texts, instagram: `${texts.instagram}\nWe use the Test hardware wallet.`}), /instagram\.txt names "hardware-wallet" without its disclosure/);
	});
	it('fails a clip caption that names an offer its scenes do not promote', () => {
		const texts = generated();
		const tiktok = texts.tiktok.map((c) => (c.short.n === 1 ? {...c, text: `${c.text}\n#TestHardwareWallet`} : c));
		assert.match(disclosures({...texts, tiktok}), /a caption for Short 1 names "hardware-wallet" without its disclosure/);
	});
});
