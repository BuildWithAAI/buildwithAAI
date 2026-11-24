import assert from 'node:assert/strict';
import {describe, test} from 'node:test';
import {alignSentences} from '../lib/align.ts';
import {extractEntities} from '../lib/entities.ts';
import {contentTokens, textOverlap} from '../lib/similarity.ts';
import {sentenceTexts} from '../lib/text.ts';

describe('similarity', () => {
	test('synonym families score as the same word', () => {
		assert.equal(textOverlap('Check how fast they sold.', 'Review how quickly they sold.').score, 1);
		assert.equal(textOverlap('Then you post the call to your followers.', 'Then you publish the call for your followers.').score, 1);
	});
	test('near synonyms earn partial credit; a different word is reported lost and added', () => {
		const o = textOverlap('You become a top caller', 'You become a famous caller');
		assert.deepEqual([o.lost, o.added], [['top'], ['famous']]);
		assert.ok(o.score > 0.6 && o.score < 0.7);
		assert.ok(textOverlap('Followers buy the jump', 'The followers buy the rise').score > 0.8);
	});
	test('numbers, negations, modals and hedges are not content words (they have their own checks)', () => {
		assert.deepEqual(
			contentTokens('According to them, you must never buy ten thousand coins').map((t) => t.surface),
			['buy', 'coins'],
		);
	});
	test('"trade/operation" alternatives count once and match either reading', () => {
		const toks = contentTokens('a bad trade/operation');
		assert.equal(toks.length, 2);
		assert.equal(textOverlap('One bad trade avoided', 'Avoiding a single bad trade/operation').lost.length, 0);
	});
	test('idioms are rewritten first', () => {
		assert.equal(textOverlap('Badger watches the charts.', 'Badger keeps an eye on the charts.').score, 1);
		// "hype" / "euphoria" are near synonyms (partial credit), so nothing is lost but the score is below 1
		const o = textOverlap("If you'd rather read the data than chase the hype", 'If you prefer to read the data instead of running after the euphoria');
		assert.deepEqual(o.lost, []);
		assert.ok(o.score > 0.9 && o.score < 1);
	});
});

describe('sentence alignment', () => {
	test('equal counts pair one to one', () => {
		const al = alignSentences(['A slow launch.', 'Then the floor disappears.'], ['A slow launch.', 'Then the floor vanishes.']);
		assert.deepEqual(al.map((p) => [p.src, p.back]), [[[0], [0]], [[1], [1]]]);
	});
	test('a dropped sentence is an omission, not glued to its neighbour', () => {
		const S = sentenceTexts('Do three things. Check who bought before the post. Check how fast they sold. And never buy the candle.');
		const B = sentenceTexts('Do three things. See/check who bought before the post. And never buy the candle.');
		const al = alignSentences(S, B);
		assert.deepEqual(al.find((p) => !p.back.length)?.src, [2]);
	});
	test('a real merge (two sentences rendered as one) is a 2-1 pair', () => {
		const al = alignSentences(['They buy.', 'The price jumps.'], ['They buy and the price jumps.']);
		assert.deepEqual(al.map((p) => [p.src, p.back]), [[[0, 1], [0]]]);
	});
	test('an added sentence is a 0-1 pair', () => {
		const al = alignSentences(['Subscribe.'], ['Subscribe.', 'Badger also sells courses.']);
		assert.deepEqual(al.map((p) => [p.src, p.back]), [[[0], [0]], [[], [1]]]);
	});
});

describe('entities', () => {
	test('names, organisations, tickers, handles; not sentence-start words or months', () => {
		assert.deepEqual(extractEntities('FixtureSwap says attackers drained $4.2M. Example Security Lab says the funds moved on Monday.'), ['FixtureSwap', 'Example Security Lab']);
		assert.deepEqual(extractEntities('The Zoo & Badger Show is on YouTube and Telegram via @ZooraTechnologies'), ['@ZooraTechnologies', 'Zoo & Badger Show', 'YouTube', 'Telegram']);
		assert.deepEqual(extractEntities('Host · Zoora AI'), ['Zoora AI']);
		assert.deepEqual(extractEntities('$DEMO / SOL'), ['$DEMO', 'SOL']);
		assert.deepEqual(extractEntities('TOP CALLER?'), []);
		assert.deepEqual(extractEntities('US$ 4,2 millones'), []);
	});
});
