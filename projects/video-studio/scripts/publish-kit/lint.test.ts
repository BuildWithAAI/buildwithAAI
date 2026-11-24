import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {checkLinks, findRules, findUrls, INCOME_CLAIMS, PLACEHOLDERS, type LinkContext} from './lint.ts';

const claims = (text: string): string[] => findRules(INCOME_CLAIMS, text, 't').map((h) => h.label);

describe('income-claim lint', () => {
	it('flags income, return, guarantee, price and buy-call wording', () => {
		for (const text of [
			'Guaranteed returns every week',
			'This coin could 100x',
			'Earn passive income while you sleep',
			'A risk-free trade',
			'Going to the moon',
			'My price target is set',
			'It will hit $10 soon',
			'Buy now before it pumps',
			'I made $5,000 last month',
			'Double your money',
			'Get rich with this bot',
		]) {
			assert.ok(claims(text).length > 0, text);
		}
	});
	it('leaves disclosures, risk warnings and ordinary numbers alone', () => {
		for (const text of [
			'Affiliate link: I may earn a commission if you buy. It costs you nothing extra.',
			'Crypto assets are high risk and you could lose all the money you put in. Not financial advice.',
			'Render at 1920x1080, play at 2x speed.',
			'The airdrop is free. The signature is not.',
			'Real airdrops do not need permission to move your tokens.',
		]) {
			assert.deepEqual(claims(text), [], text);
		}
	});
	it('flags placeholders', () => {
		assert.equal(findRules(PLACEHOLDERS, 'TODO: write this', 't').length, 1);
		assert.equal(findRules(PLACEHOLDERS, 'See https://example.com/x', 't').length, 1);
		assert.equal(findRules(PLACEHOLDERS, 'Ask [YOUR NAME] first', 't').length, 1);
		assert.equal(findRules(PLACEHOLDERS, 'Replace the battery', 't').length, 0);
	});
});

describe('checkLinks', () => {
	const ctx: LinkContext = {
		hubOrigin: 'https://go.zoora.ai',
		offerIds: ['hardware-wallet'],
		slug: 'ep-1',
		sourceUrls: ['https://consumer.ftc.gov/articles/x', 'https://exchange.test/help/security'],
		destinationHosts: ['shop.wallet.test', 'exchange.test', 'go.zoora.ai'],
	};
	it('accepts hub, YouTube and source links', () => {
		const text = [
			'Wallet: https://go.zoora.ai/go/hardware-wallet?v=ep-1&s=yt',
			'More: https://go.zoora.ai/?v=ep-1&s=x',
			'Watch: https://youtu.be/AbCdEfGh123 and https://www.youtube.com/@ZooraTechnologies',
			'Source: https://consumer.ftc.gov/articles/x and https://exchange.test/help/security.',
			'Link in bio: go.zoora.ai',
		].join('\n');
		assert.deepEqual(checkLinks(text, 'post', ctx), []);
	});
	it('flags raw affiliate URLs, bare destination hosts and other links', () => {
		const raw = checkLinks('Sign up: https://exchange.test/invite?ref=abc', 'post', ctx).join('\n');
		assert.match(raw, /raw destination "exchange\.test"/);
		assert.match(raw, /does not go through the hub/);
		assert.match(checkLinks('Visit shop.wallet.test today', 'post', ctx).join('\n'), /raw destination "shop\.wallet\.test"/);
		assert.match(checkLinks('See https://elsewhere.test/page', 'post', ctx).join('\n'), /does not go through the hub/);
	});
	it('flags hub links for other offers or without the episode attribution', () => {
		assert.match(checkLinks('https://go.zoora.ai/go/other-offer?v=ep-1&s=yt', 'post', ctx).join('\n'), /not one of this episode's offers/);
		assert.match(checkLinks('https://go.zoora.ai/go/hardware-wallet?v=ep-2&s=yt', 'post', ctx).join('\n'), /must carry v=ep-1/);
		assert.match(checkLinks('https://go.zoora.ai/admin', 'post', ctx).join('\n'), /unexpected hub path/);
	});
	it('findUrls drops trailing punctuation', () => {
		assert.deepEqual(findUrls('Go (https://youtu.be/x).'), ['https://youtu.be/x']);
	});
});
