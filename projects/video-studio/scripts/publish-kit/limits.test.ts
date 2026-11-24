import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {countHashtags, LIMITS, utf8Bytes, xWeightedLength, youtubeTagsLength} from './limits.ts';

describe('youtubeTagsLength', () => {
	it('counts quotes around tags with spaces and the commas between tags (API reference example)', () => {
		assert.equal(youtubeTagsLength(['Foo-Baz']), 7);
		assert.equal(youtubeTagsLength(['Foo Baz']), 9);
		assert.equal(youtubeTagsLength(['Foo-Baz', 'Foo Baz']), 7 + 9 + 1);
		assert.equal(youtubeTagsLength([]), 0);
	});
});

describe('utf8Bytes', () => {
	it('counts bytes, not characters', () => {
		assert.equal(utf8Bytes('abc'), 3);
		assert.equal(utf8Bytes('é'), 2);
		assert.equal(utf8Bytes('🐶'), 4);
	});
});

describe('countHashtags', () => {
	it('finds hashtags but not URL fragments or HTML entities', () => {
		assert.equal(countHashtags('#One #Two\n#Three'), 3);
		assert.equal(countHashtags('see https://a.test/#frag and &#39;'), 0);
		assert.equal(countHashtags('word#notatag'), 0);
		assert.equal(countHashtags('Watch go.zoora.ai/#x'), 0);
	});
	it('counts hashtags glued to punctuation and full-width "＃" (as twitter-text 3.1.0 does)', () => {
		assert.equal(countHashtags('Two scams:#airdrop,#drainer and how to spot them.'), 2);
		assert.equal(countHashtags('(#crypto) "#web3" ＃全角 #tag_1 #1a #_a'), 6);
	});
	it('needs a letter: "#1" and the "#\uFE0F\u20E3" keycap are not hashtags', () => {
		assert.equal(countHashtags('The #1 mistake people make with seed phrases.'), 0);
		assert.equal(countHashtags('#\uFE0F\u20E3 keycap and #2024'), 0);
	});
});

describe('xWeightedLength (twitter-text v3)', () => {
	it('counts ASCII as 1 and every URL as 23', () => {
		assert.equal(xWeightedLength('hello'), 5);
		assert.equal(xWeightedLength('https://go.zoora.ai/go/hardware-wallet?v=_example&s=x'), LIMITS.xUrlWeight);
		assert.equal(xWeightedLength('a https://youtu.be/x b'), 2 + 2 + 23);
	});
	it('keeps trailing punctuation out of the URL', () => {
		assert.equal(xWeightedLength('Watch https://youtu.be/abc.'), 6 + 23 + 1);
	});
	it('counts emoji (also ZWJ sequences) and CJK as 2', () => {
		assert.equal(xWeightedLength('🐶'), 2);
		assert.equal(xWeightedLength('👨‍👩‍👧'), 2);
		assert.equal(xWeightedLength('安全'), 4);
		assert.equal(xWeightedLength('é'), 1);
	});
	it('counts bare domains X would link as at least 23', () => {
		assert.equal(xWeightedLength('go.zoora.ai'), 23);
	});
});

/**
 * twitter-text 3.1.0 (X's open-source counter) weighted lengths, recorded with parseTweet() on 2026-11-24 in a scratch
 * folder (the package is not a dependency). The kit must never count less than X, or an over-long post would pass
 * the x-post check; it may count more where it cannot tell (an unknown TLD, a Unicode TLD, keycaps).
 */
const ORACLE: readonly [text: string, x: number, exact: boolean][] = [
	// shapes the kit writes, and ordinary text: exact
	['The airdrop is free. The signature is not.\nTest hardware wallet: https://go.zoora.ai/go/hardware-wallet?v=_example&s=x\nAffiliate link: I may earn a commission if you buy. It costs you nothing extra.\nFull episode: https://youtu.be/AbCdEfGh123\n#CryptoSecurity #WalletDrainer', 237, true],
	['Links and disclosures: https://go.zoora.ai/?v=_example&s=x', 46, true],
	['Full episode: https://www.youtube.com/@ZooraTechnologies', 37, true],
	['see https://go.zoora.ai/go/hardware-wallet?v=_example&s=x.', 28, true],
	['(see https://go.zoora.ai/go/hardware-wallet?v=_example&s=x)', 29, true],
	['HTTPS://GO.ZOORA.AI/GO/X', 23, true],
	['https://youtu.be/abc?t=42', 23, true],
	['go.zoora.ai/go/bybit?v=a&s=x', 23, true],
	['x.com/ZooraAI', 23, true],
	['support@zoora.ai is not a link', 30, true],
	['e.g. this, i.e. that, U.S. rules', 32, true],
	['安全なウォレット', 16, true],
	['👨\u200D👩\u200D👧 👍🏽 🇬🇧', 8, true],
	['é à ü ñ ç ß ø', 13, true],
	['— – … ‘ ’ “ ”', 14, true],
	// counted lower than X before the 2026-11-24 fix: bare domains with other TLDs, characters glued to a URL
	['Revoke old approvals at revoke.cash before a drainer does', 69, true],
	['youtu.be/dQw4w9WgXcQ', 23, true],
	['binance.us is a different company', 46, true],
	['chain.link oracles', 31, true],
	['https://go.zoora.ai/go/hardware-wallet?v=_example&s=x👇', 25, true],
	['https://go.zoora.ai/go/hardware-wallet?v=_example&s=x…', 25, true],
	['https://go.zoora.ai/go/hardware-wallet?v=_example&s=x。次', 27, true],
	['https://go.zoora.ai/go/hardware-wallet?v=_example&s=x»', 24, true],
	['https://go.zoora.ai👇', 25, true],
	['https://example.comé', 24, true],
	['example.coé', 24, true],
	['a×b.com', 25, true],
	['日本example.com', 27, true],
	['my_sub.example.com', 26, true],
	['wallet.travel.test', 28, true],
	['https://wallet.travel.test/x', 30, true],
	['https://привет.com/x', 23, true],
	['bücher.de', 23, true],
	// the kit counts more than X here (safe): it cannot know every TLD, nor every emoji sequence
	['x.test?b.com', 30, false],
	['example.中国', 23, false],
	['Node.js and README.md are not links', 49, false],
	['https://localhost/x', 19, false],
	['https://shop.wallet.test/x', 26, false],
	['https://en.wikipedia.org/wiki/Bitcoin_(disambiguation)', 23, false],
	['1\uFE0F\u20E3 2\uFE0F\u20E3 #\uFE0F\u20E3', 8, false],
];

describe('xWeightedLength against twitter-text 3.1.0', () => {
	it('never counts less than X does', () => {
		const under = ORACLE.filter(([text, x]) => xWeightedLength(text) < x).map(([text, x]) => `${JSON.stringify(text)}: kit ${xWeightedLength(text)}, X ${x}`);
		assert.deepEqual(under, []);
	});
	it('matches X exactly on the kit\'s own post shapes, ordinary text and the cases fixed on 2026-11-24', () => {
		for (const [text, x, exact] of ORACLE) if (exact) assert.equal(xWeightedLength(text), x, JSON.stringify(text));
	});
});
