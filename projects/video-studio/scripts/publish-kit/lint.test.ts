import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, it} from 'node:test';
import {checkLinks, findRules, findUrls, INCOME_CLAIMS, negatedBefore, PLACEHOLDERS, type LinkContext} from './lint.ts';
import {EXAMPLE_DIR} from './test-helpers.ts';

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
	it('flags crypto return, price, no-lose, safety and bonus pitches (review 2026-11-24)', () => {
		const cases: [string, string][] = [
			['Earn 20% monthly returns on your USDT', 'a percentage return'],
			['Get 1% daily yield, paid out every day', 'a percentage return'],
			['Stake and earn 300% APY', 'a percentage return'],
			['Pays 5% a week', 'a percentage return'],
			['SOL could hit $500 this year', 'a price prediction'],
			['It could easily reach $10', 'a price prediction'],
			['BTC to $250k by December', 'a price prediction'],
			['This coin is heading to $1', 'a price prediction'],
			['You literally cannot lose', 'a no-lose promise'],
			['It is a no-brainer, you can’t lose', 'a no-lose promise'],
			['Turn $100 into $10,000', 'a turn-X-into-Y promise'],
			['turned 1 ETH into 50 ETH', 'a turn-X-into-Y promise'],
			['Earn £300 a week', 'an earnings figure'],
			['Make €1,000 every month', 'an earnings figure'],
			['I earned 5 ETH in a week', 'an earnings figure'],
			['Your money is 100% safe with this exchange', 'a safety promise'],
			['A safe investment for beginners', 'a safety promise'],
			['Profit every single day', 'a regular-income promise'],
			['weekly payouts', 'a regular-income promise'],
			['Demo Exchange sign-up bonus explained', 'a sign-up or deposit bonus'],
			['Get a $50 bonus when you deposit', 'a sign-up or deposit bonus'],
			['This could 1,000x', 'a 100x-style multiplier'],
		];
		for (const [text, label] of cases) assert.ok(claims(text).includes(label), `${text}: ${claims(text).join(', ') || 'no hit'}`);
	});
	it('leaves security advice, news facts and negated safety lines alone', () => {
		for (const text of [
			'No wallet is 100% safe.',
			'Nothing in crypto is 100% safe.',
			"You can't lose your seed phrase if it is stamped in metal.",
			'If you lose it, you could lose everything.',
			'Bonus tip: turn on 2FA.',
			'turn 2FA into a habit',
			'Scams rose 20% a year in 2025.',
			'Bitcoin is up 20% this month.',
			'The hacker moved $250k to a mixer.',
			'Attackers made off with $1.5 billion.',
			'Prices fell from $3 to $1.',
			'It will cost you $50 in fees.',
			'Keep your savings safe on a separate wallet.',
			'A free airdrop that needs your signature is a red flag.',
			'Referral link: I earn a share of fees if you sign up and trade. Crypto trading is high risk. Not financial advice.',
			'My own product: I built this course and earn money from it.',
		]) {
			assert.deepEqual(claims(text), [], text);
		}
	});
	it('the example narration is clean', () => {
		const words = JSON.parse(readFileSync(join(EXAMPLE_DIR, 'captions.json'), 'utf8')) as {text: string}[];
		assert.deepEqual(claims(words.map((w) => w.text).join('')), []);
	});
	it('negatedBefore looks a few words back within the clause', () => {
		const at = (text: string, word: string) => negatedBefore(text, text.indexOf(word));
		assert.equal(at('This is not an affiliate link', 'affiliate'), true);
		assert.equal(at("There isn't a sponsor", 'sponsor'), true);
		assert.equal(at('No sponsor here. But this is an affiliate link', 'affiliate'), false);
		assert.equal(at('I am not paid, but this is an affiliate link', 'affiliate'), false);
		assert.equal(at('Full disclosure: the link is an affiliate link', 'affiliate'), false);
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
