import assert from 'node:assert/strict';
import {describe, test} from 'node:test';
import {clean, expandEnglish, fold, looksNotEnglish, sentenceTexts, stripNotes, stripTags, tokens} from '../lib/text.ts';
import {lemma, porter, stem} from '../lib/stem.ts';

describe('sentences', () => {
	test('English, Spanish and Portuguese sentence ends', () => {
		assert.deepEqual(sentenceTexts('You post one chart. Ten thousand strangers buy your coin within the hour.'), ['You post one chart.', 'Ten thousand strangers buy your coin within the hour.']);
		assert.deepEqual(sentenceTexts('La próxima vez: construyes un agente. ¿Qué podría salir mal?'), ['La próxima vez: construyes un agente.', '¿Qué podría salir mal?']);
		assert.deepEqual(sentenceTexts('Antes de mexer, pergunte: quem detém a oferta? O que mais o criador lançou?'), ['Antes de mexer, pergunte: quem detém a oferta?', 'O que mais o criador lançou?']);
	});
	test('colons, decimals, abbreviations and lower-case continuations do not split', () => {
		assert.deepEqual(sentenceTexts('As one caller put it: Nobody checks the wallet.'), ['As one caller put it: Nobody checks the wallet.']);
		assert.deepEqual(sentenceTexts('It hit $4.2M on Nov. 24 in the U.S. and kept going.'), ['It hit $4.2M on Nov. 24 in the U.S. and kept going.']);
		assert.deepEqual(sentenceTexts('Wait... then it dropped.'), ['Wait... then it dropped.']);
	});
	test('a [src:id] tag after the full stop stays with its sentence', () => {
		assert.deepEqual(sentenceTexts('They buy, and you sell. [src:demo-pattern] Next one.'), ['They buy, and you sell. [src:demo-pattern]', 'Next one.']);
		assert.deepEqual(sentenceTexts('Drained $4.2M [src:a]. The company says more [src:b].'), ['Drained $4.2M [src:a].', 'The company says more [src:b].']);
		assert.deepEqual(sentenceTexts('Ninety days later, only 4.55% were trading. [src:a,b] 68.67% made it.'), ['Ninety days later, only 4.55% were trading. [src:a,b]', '68.67% made it.']);
	});
	test('a sentence may start with a digit, a quote or an inverted mark; a blank line splits', () => {
		assert.equal(sentenceTexts('One. 68,67% hicieron. "Quote" here. ¡Vamos!').length, 4);
		assert.deepEqual(sentenceTexts('First paragraph\n\nSecond paragraph'), ['First paragraph', 'Second paragraph']);
	});
});

describe('normalization', () => {
	test('clean() straightens quotes, unifies dashes and removes zero-width characters', () => {
		assert.equal(clean('“Don’t” — now​'), '"Don\'t" - now');
		assert.equal(clean('68,67 %'), '68,67 %');
	});
	test('English contractions expand and possessives drop', () => {
		assert.equal(expandEnglish("Don't, can't, won't, it's Zoo's and the followers' turn"), "Do not, can not, will not, it is Zoo and the followers turn");
		assert.equal(expandEnglish("Let's go"), 'let us go');
	});
	test('tags and back-translator notes are removed for comparison', () => {
		assert.equal(stripTags('Claim one [src:a]. Claim two [src:b,c].'), 'Claim one. Claim two.');
		assert.equal(stripNotes('A trade [note: could be "operation"] went bad.'), 'A trade went bad.');
	});
	test('fold() is accent- and case-insensitive', () => assert.equal(fold('  Asesoría   FINANCIERA '), 'asesoria financiera'));
	test('tokens keep hyphenated and apostrophe words whole', () => assert.deepEqual(tokens('Sell-off isn\'t ERC-20').map((t) => t.word), ['sell-off', "isn't", 'erc-20']));
});

describe('language guess', () => {
	test('Spanish or Portuguese left in a back-translation is caught; English, names and short labels are not', () => {
		assert.equal(looksNotEnglish('La mayoría de las memecoins nuevas nunca llegan al segundo día.'), true);
		assert.equal(looksNotEnglish('A maioria das memecoins novas na Pump.fun nunca chega ao segundo dia.'), true);
		assert.equal(looksNotEnglish('Most of the new memecoins on Pump.fun never reach the second day.'), false);
		assert.equal(looksNotEnglish('No trading signals, no price predictions.'), false);
		assert.equal(looksNotEnglish('POV'), false);
		assert.equal(looksNotEnglish('$DEMO / SOL'), false);
	});
});

describe('stemming', () => {
	test('Porter stems and irregular verbs', () => {
		assert.equal(porter('caresses'), 'caress');
		assert.equal(porter('ponies'), 'poni');
		assert.equal(porter('relational'), 'relat');
		assert.equal(porter('checking'), 'check');
		assert.equal(porter('followers'), 'follow');
		assert.equal(lemma('sold'), 'sell');
		assert.equal(stem('bought'), stem('buy'));
		assert.equal(stem('Checks'), stem('check'));
	});
});
