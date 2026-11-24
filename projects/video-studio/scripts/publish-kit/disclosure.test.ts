import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {disclosureWordingProblems, names, saysDisclosure} from './disclosure.ts';
import {resolveOffers} from './offers.ts';
import {NOW, testRegistry} from './test-helpers.ts';
import type {ResolvedOffer} from './types.ts';

const offer = (id: string): ResolvedOffer => {
	const found = resolveOffers([id], testRegistry(), NOW).resolved[0];
	assert.ok(found, id);
	return found;
};

describe('saysDisclosure', () => {
	const wallet = offer('hardware-wallet'); // affiliate
	const course = offer('own-course'); // own product
	it('accepts a spoken statement of the relationship, or the registry sentence read out', () => {
		for (const said of [
			'Full disclosure: the hardware wallet link in the description is an affiliate link, so I may earn a commission if you buy through it.',
			'The link below is an affiliate link and I earn a commission.',
			'I may get a small commission if you buy.',
			'Using my link earns me a commission.',
			'This video is sponsored by the wallet maker.',
			"It's an ad.",
			'No sponsor here. But this is an affiliate link.',
			'Affiliate link: I may earn a commission if you buy. It costs you nothing extra.',
		]) {
			assert.equal(saysDisclosure(said, wallet), true, said);
		}
	});
	it('refuses negations and words that disclose nothing (review 2026-11-24)', () => {
		for (const said of [
			'This is not sponsored, but I really like this wallet.',
			'No affiliate deal here, just a wallet I use.',
			'Our partner at the exchange told me this.',
			'I hold no tokens.',
			'This video is not sponsored and there is no affiliate deal. Buy now before it sells out.',
			"I don't earn a commission on this.",
			'This is not an affiliate link.',
			'A hardware wallet makes you confirm each signature on its own screen.',
		]) {
			assert.equal(saysDisclosure(said, wallet), false, said);
		}
	});
	it('an own product needs ownership, not just money', () => {
		assert.equal(saysDisclosure('I built this course. It is my own product.', course), true);
		assert.equal(saysDisclosure("That's my own course, and I earn money from it.", course), true);
		assert.equal(saysDisclosure('I may earn a commission if you buy.', course), false);
		assert.equal(saysDisclosure("I didn't build this course.", course), false);
	});
});

describe('disclosureWordingProblems', () => {
	it('accepts disclosures that name the relationship and the benefit', () => {
		for (const o of testRegistry().offers) assert.deepEqual(disclosureWordingProblems(o.disclosure, o.relationship), [], o.id);
		assert.deepEqual(disclosureWordingProblems('Sponsored by Example Wallet.', 'sponsor'), []);
		assert.deepEqual(disclosureWordingProblems('Paid partnership: they paid me to make this video.', 'sponsor'), []);
	});
	it('refuses a "disclosure" that discloses nothing, or the wrong kind of relationship', () => {
		assert.match(disclosureWordingProblems('Great wallet, I use it every day. Get 20% off today only!', 'affiliate').join(), /must name the relationship .* and must say that you benefit/);
		assert.match(disclosureWordingProblems('Affiliate link.', 'affiliate').join(), /must say that you benefit/);
		assert.match(disclosureWordingProblems('Affiliate link: I may earn a commission.', 'own-product').join(), /must say it is your own product/);
	});
});

describe('names', () => {
	it('matches an offer name on word boundaries, whatever the case or the separators', () => {
		for (const text of ['Demo Exchange sign-up', 'try demo-exchange', '#DemoExchange', 'DEMO_EXCHANGE', 'demo.exchange']) assert.equal(names(text, 'Demo Exchange'), true, text);
		for (const text of ['Demo Exchanges', 'a demo of the exchange', 'MyDemo Exchange']) assert.equal(names(text, 'Demo Exchange'), false, text);
		assert.equal(names('anything', '!!!'), false);
	});
});
