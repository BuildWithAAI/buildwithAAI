import assert from 'node:assert/strict';
import {describe, test} from 'node:test';
import {extractNumbers, matchNum, speechMismatch, wordNumbers, type Num} from '../lib/numbers.ts';

const one = (s: string, words: 'none' | 'display' | 'spoken' = 'display'): Num => {
	const ns = extractNumbers(s, {words});
	assert.equal(ns.length, 1, `expected one number in ${JSON.stringify(s)}, got ${ns.map((n) => n.raw).join(' | ')}`);
	return ns[0];
};
const values = (s: string, words: 'none' | 'display' | 'spoken' = 'display') => extractNumbers(s, {words}).map((n) => [n.kind, n.value]);

describe('number normalisation', () => {
	test('$1.5M = 1,500,000 = 1.5 million = one point five million dollars', () => {
		const forms = ['$1.5M', '1,500,000', '1.5 million', '$1.5 million', 'US$1.5m', '1.5 million dollars'];
		for (const f of forms) assert.equal(one(f).value, 1_500_000, f);
		assert.equal(one('one point five million dollars', 'spoken').value, 1_500_000);
		assert.equal(one('one and a half million', 'spoken').value, 1_500_000);
		const pool = extractNumbers('the exchange lost 1,500,000');
		for (const f of forms) assert.ok(matchNum(one(f), pool).ok, `${f} should match 1,500,000`);
	});

	test('currency, crypto units and percentages are kept apart', () => {
		assert.deepEqual(values('$4.2M and 1,400 ETH and 61% and 61 percent'), [
			['money', 4_200_000],
			['crypto', 1400],
			['percent', 61],
			['percent', 61],
		]);
		const pct = one('61%');
		assert.equal(matchNum(pct, extractNumbers('61 wallets')).ok, false, 'a percentage never matches a count');
		assert.equal(matchNum(one('1,400 ETH'), extractNumbers('1,400 BTC')).ok, false, 'ETH is not BTC');
		assert.equal(matchNum(one('1,400 ETH'), extractNumbers('about 1,400 ether')).ok, true, 'ether is ETH');
	});

	test('scales: k, M, B, bn, thousand, billion', () => {
		assert.equal(one('$400k').value, 400_000);
		assert.equal(one('$1.46B').value, 1_460_000_000);
		assert.equal(one('2.5bn').value, 2_500_000_000);
		assert.equal(one('7 thousand').value, 7000);
		assert.equal(one('5 minutes').value, 5, '"m" in minutes is not a million');
	});

	test('dates, years, times, ranges', () => {
		const d = one('on Nov. 23, 2026');
		assert.equal(d.kind, 'date');
		assert.deepEqual([d.month, d.day, d.year], [11, 23, 2026]);
		assert.equal(one('2026-10-02').kind, 'date');
		assert.equal(one('in 2026').kind, 'year');
		assert.equal(one('at 10:30 UTC').kind, 'time');
		assert.deepEqual(values('$4-5M'), [['money', 4_000_000], ['money', 5_000_000]]);
		assert.equal(extractNumbers('I may 5 times').filter((n) => n.kind === 'date').length, 0, 'the verb "may" is not a month');
	});

	test('identifiers are not numbers: ERC-20, EIP-7702, Web3, hex, ratings', () => {
		assert.deepEqual(values('ERC-20 EIP-7702 Web3 L2 0xdeadbeef12345678 a 7/10 rating, 24/7'), []);
	});

	test('number words: claims skip "one" and "first", the spoken side reads everything', () => {
		assert.deepEqual(values('five wallets, one fix, the first hack'), [['plain', 5]]);
		assert.deepEqual(
			wordNumbers('fourteen hundred, twenty twenty-six, sixty-one percent, half a billion', 'spoken').map((n) => [n.kind, n.value]),
			[
				['plain', 1400],
				['year', 2026],
				['percent', 61],
				['plain', 500_000_000],
			],
		);
		const date = wordNumbers('on October second', 'spoken')[0];
		assert.deepEqual([date.kind, date.month, date.day], ['date', 10, 2]);
	});
});

describe('matching a claim number against the excerpt', () => {
	const pool = extractNumbers('Bybit said hackers stole about $1.46 billion; another firm put it at more than $1.4 billion.');
	test('exact', () => assert.equal(matchNum(one('$1.46B'), pool).how, 'exact'));
	test('a qualifier allows honest rounding', () => {
		assert.equal(matchNum(one('about $1.5B'), pool).how, 'rounded');
		assert.equal(matchNum(one('nearly $1.5 billion'), pool).how, 'rounded');
		assert.equal(matchNum(one('more than $1.4B'), pool).ok, true);
	});
	test('an unqualified rounding fails, and the closest figure is reported', () => {
		const m = matchNum(one('$1.5B'), pool);
		assert.equal(m.ok, false);
		assert.equal(m.closest?.raw, '$1.46 billion');
	});
	test('an averaged figure fails (it is in no excerpt)', () => assert.equal(matchNum(one('$1.43B'), pool).ok, false));
	test('dropping the source qualifier is flagged', () => assert.equal(matchNum(one('$1.46B'), pool).droppedQualifier, true));
	test('dates match the excerpt or the source date', () => {
		assert.equal(matchNum(one('October 2'), extractNumbers('FixtureLend | 2026-10-02 | $3.1M')).ok, true);
		assert.equal(matchNum(one('October 3'), extractNumbers('FixtureLend | 2026-10-02 | $3.1M')).ok, false);
		assert.equal(matchNum(one('in 2026'), [], [{year: 2026, month: 11, day: 23}]).how, 'date-meta');
	});
});

describe('shown vs spoken numbers', () => {
	test('consistent pairs pass', () => {
		for (const [d, s] of [
			['$4.2M', 'four point two million dollars'],
			['1,400 ETH', 'fourteen hundred E T H'],
			['61%', 'sixty-one percent'],
			['October 2, 2026', 'October second, twenty twenty-six'],
		])
			assert.deepEqual(speechMismatch(d, s), {shownNotSaid: [], saidNotShown: []}, `${d} | ${s}`);
	});
	test('a different spoken number is caught both ways', () => {
		const mm = speechMismatch('$4.2M', 'four point five million dollars');
		assert.equal(mm.shownNotSaid[0].value, 4_200_000);
		assert.equal(mm.saidNotShown[0].value, 4_500_000);
		assert.equal(speechMismatch('', 'five million dollars').saidNotShown.length, 1, 'spoken-only numbers count');
	});
});
