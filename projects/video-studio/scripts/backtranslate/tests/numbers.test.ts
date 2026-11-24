import assert from 'node:assert/strict';
import {describe, test} from 'node:test';
import {describeNum, extractNumbers, matchNumbers, qualChange, readDigits, type NumLang} from '../lib/numbers.ts';

/** Compact view: "kind:description[qualifier](soft)". */
const nums = (text: string, lang: NumLang): string[] =>
	extractNumbers(text, lang).map((n) => `${n.kind}:${describeNum(n)}${n.qual !== 'exact' ? `[${n.qual}]` : ''}${n.soft ? '(soft)' : ''}`);

describe('English numbers', () => {
	test('digits, scales, currency, percent, crypto units', () => {
		assert.deepEqual(nums('The price hit $40,000 in 2026, up 68.67% in a week. Then 1.5M tokens cost 0.25 SOL.', 'en'), [
			'money:$40,000',
			'year:2026',
			'percent:68.67%',
			'duration:1 week',
			'crypto:1.5 million tokens',
			'crypto:0.25 SOL',
		]);
		assert.deepEqual(nums('US$ 4.2 million; $4.2M; 4.2 million dollars', 'en'), ['money:$4.2 million', 'money:$4.2 million', 'money:$4.2 million']);
	});
	test('number words, "and a half", "point", "a million"', () => {
		assert.deepEqual(nums('Ten thousand strangers; four point two million dollars; three and a half million dollars; a million tokens', 'en'), [
			'count:10,000',
			'money:$4.2 million',
			'money:$3.5 million',
			'crypto:1 million tokens',
		]);
		assert.deepEqual(nums('twenty-five days, one hundred and twenty minutes, half a million', 'en'), ['duration:25 days', 'duration:120 minutes', 'count:500,000']);
	});
	test('"one" is soft, and not a number in "no one", "someone", "the one"', () => {
		assert.deepEqual(nums('You post one chart. No one checks. Someone sells. Take the one.', 'en'), ['count:1(soft)']);
	});
	test('qualifiers: about, nearly, more than, within, only', () => {
		assert.deepEqual(nums('about $4M, nearly half of the funds, more than 1,500 wallets, within the hour, only 4.55%', 'en'), [
			'money:$4 million[approx]',
			'fraction:half[nearly]',
			'count:1,500[min]',
			'duration:1 hour[max]',
			'percent:4.55%[max]',
		]);
	});
	test('dates, times, multipliers, ordinals; tickers and addresses are not numbers', () => {
		assert.deepEqual(nums('On Nov 24, 2026 at 00:41 it went 10x. Day two. The second day. 0xabc123 $DEMO ERC-20', 'en'), [
			'date:Nov 24, 2026',
			'time:00:41',
			'multiplier:10x',
			'ordinal:day 2',
			'ordinal:day 2',
		]);
		assert.deepEqual(nums('on launch day', 'en'), ['ordinal:day 1(soft)']);
		assert.deepEqual(nums('10 m away', 'en'), ['count:10']);
	});
});

describe('Spanish and Portuguese numbers', () => {
	test('locale digits and scale words', () => {
		assert.deepEqual(nums('El precio llegó a US$ 40.000 en 2026, un 68,67 % más en una semana.', 'es'), ['money:$40,000', 'year:2026', 'percent:68.67%', 'duration:1 week']);
		assert.deepEqual(nums('4,2 millones de dólares; 1,5 M de tokens; 0,25 SOL', 'es'), ['money:$4.2 million', 'crypto:1.5 million tokens', 'crypto:0.25 SOL']);
		assert.deepEqual(nums('US$ 4,2 milhões; 4,2 mi de tokens; 2,5 bilhões', 'pt-br'), ['money:$4.2 million', 'crypto:4.2 million tokens', 'count:2.5 billion']);
	});
	test('number words with connectors, decimals and halves', () => {
		assert.deepEqual(nums('Diez mil desconocidos; cuatro coma dos millones de dólares; un millón y medio de tokens; treinta y uno', 'es'), [
			'count:10,000',
			'money:$4.2 million',
			'crypto:1.5 million tokens',
			'count:31',
		]);
		assert.deepEqual(nums('Dez mil desconhecidos; quatro vírgula dois milhões de dólares; três milhões e meio de dólares; vinte e um', 'pt-br'), [
			'count:10,000',
			'money:$4.2 million',
			'money:$3.5 million',
			'count:21',
		]);
	});
	test('the traps: "billón" is 10^12, "mil millones" is 10^9, "mil" is a thousand', () => {
		assert.deepEqual(nums('mil millones de dólares; un billón de dólares; 4,2 mil dólares', 'es'), ['money:$1 billion', 'money:$1000 billion', 'money:$4,200']);
		assert.deepEqual(nums('um bilhão de dólares', 'pt-br'), ['money:$1 billion']);
	});
	test('articles are numbers only as "un solo", "um único" or with a unit', () => {
		assert.deepEqual(nums('Publicas un solo gráfico; una mala operación; en menos de una hora', 'es'), ['count:1(soft)', 'duration:1 hour[max]']);
		assert.deepEqual(nums('Você posta um único gráfico em menos de uma hora', 'pt-br'), ['count:1(soft)', 'duration:1 hour[max]']);
	});
	test('qualifiers with articles: "casi el", "más del", "solo el", "só"', () => {
		assert.deepEqual(nums('Casi el sesenta y nueve por ciento; más del 4,55%; solo el 4,55%', 'es'), ['percent:69%[nearly]', 'percent:4.55%[min]', 'percent:4.55%[max]']);
		assert.deepEqual(nums('quase sessenta e nove por cento; só 4,55%; mais de 10 dias', 'pt-br'), ['percent:69%[nearly]', 'percent:4.55%[max]', 'duration:10 days[min]']);
	});
	test('dates and ordinals', () => {
		assert.deepEqual(nums('24 de noviembre de 2026, a las 00:41; el primer día; día dos', 'es'), ['date:Nov 24, 2026', 'time:00:41', 'ordinal:day 1', 'ordinal:day 2']);
		assert.deepEqual(nums('no segundo dia; dia dois; 24 de novembro de 2026', 'pt-br'), ['ordinal:day 2', 'ordinal:day 2', 'date:Nov 24, 2026']);
		assert.deepEqual(nums('un segundo; segunda-feira', 'pt-br'), []);
	});
	test('a "$" alone is flagged as possibly pesos', () => {
		const [n] = extractNumbers('$40.000', 'es');
		assert.equal(n.bareDollar, true);
		assert.equal(extractNumbers('US$ 40.000', 'es')[0].bareDollar, undefined);
	});
});

describe('digit styles', () => {
	test('readDigits per locale, with the English reading kept as an alternative', () => {
		assert.deepEqual(readDigits('1.500,25', 'es'), {value: 1500.25, format: 'locale'});
		assert.deepEqual(readDigits('68,67', 'pt-br'), {value: 68.67, format: 'locale'});
		assert.deepEqual(readDigits('1,500', 'pt-br'), {value: 1.5, alt: 1500, format: 'ambiguous'});
		assert.deepEqual(readDigits('4.200', 'es'), {value: 4200, alt: 4.2, format: 'locale'});
		assert.deepEqual(readDigits('4.2', 'es'), {value: 4.2, format: 'en'});
		assert.deepEqual(readDigits('10,000,000', 'es'), {value: 10000000, format: 'en'});
		assert.deepEqual(readDigits('1,500.5', 'en'), {value: 1500.5, format: 'locale'});
	});
});

describe('matching', () => {
	test('same value in another notation pairs up; a shifted value, a changed unit and extras are reported', () => {
		const m = matchNumbers(extractNumbers('$4.2M lost, 10,000 users, 68.67%', 'en'), extractNumbers('42 millones de dólares, 10.000 usuarios, 68,67 por ciento y 5 días', 'es'));
		assert.equal(m.pairs.length, 2);
		assert.deepEqual(
			m.changed.map((c) => `${c.why}:${describeNum(c.a)}->${describeNum(c.b)}`),
			['value:$4.2 million->$42 million'],
		);
		assert.deepEqual(m.added.map(describeNum), ['5 days']);
	});
	test('a bare number where the source had money is "unit-dropped"', () => {
		const m = matchNumbers(extractNumbers('$4.2M', 'en'), extractNumbers('4,2 millones', 'es'));
		assert.equal(m.changed[0].why, 'unit-dropped');
	});
	test('a soft "one" pairs with a changed count only after the firm numbers', () => {
		const m = matchNumbers(extractNumbers('One key, ten thousand users', 'en'), extractNumbers('two keys, one hundred thousand users', 'en'));
		assert.deepEqual(m.changed.map((c) => `${c.a.value}->${c.b.value}`), ['10000->100000', '1->2']);
	});
	test('qualifier changes: min vs max is major, exact vs about is minor, nearly vs max is fine', () => {
		assert.equal(qualChange('min', 'max'), 'major');
		assert.equal(qualChange('exact', 'approx'), 'minor');
		assert.equal(qualChange('nearly', 'max'), 'none');
	});
});
