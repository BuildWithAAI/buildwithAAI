import assert from 'node:assert/strict';
import {describe, test} from 'node:test';
import {hedges, isImperative, modality, polarity, sentenceCues} from '../lib/lexicon.ts';

describe('negation', () => {
	test('explicit, "never" and implicit negatives are counted apart', () => {
		// "don't ever" is a "never"; it counts once
		const p = polarity("And don't ever buy it. Nobody checks the wallet, so you don't have to.");
		assert.equal(p.explicit, 3);
		assert.equal(p.never, 1);
		assert.deepEqual(polarity('Real support never asks for it.').never, 1);
		assert.equal(polarity('Badger already hates this.').implicit, 1);
		assert.equal(polarity('Avoid buying the candle.').explicit, 0);
	});
	test('"not only", "no doubt" and "no matter" are not negations; "no one" is one', () => {
		assert.equal(polarity('It is not only fast, no doubt, no matter what.').explicit, 0);
		assert.equal(polarity('No one checks.').explicit, 1);
	});
	test('a back-translator\'s alternatives count once, and in either reading', () => {
		assert.equal(polarity('He did/didn\'t sell').explicit, 1);
	});
});

describe('modality', () => {
	test('the classes', () => {
		const m = modality('You must check, you should wait, prices may drop, you can sell, it will change, guaranteed, always');
		assert.deepEqual([m.oblig, m.advice, m.possib, m.ability, m.future, m.sure, m.always], [1, 1, 1, 1, 1, 1, 1]);
	});
	test('"May 5" is a date, not a modal', () => assert.equal(modality('On May 5 the exploit began.').possib, 0));
});

describe('hedges and attribution', () => {
	test('allegation, attribution and uncertainty', () => {
		const h = hedges('According to FixtureSwap, the hacker allegedly used a preliminary exploit, per Example Lab.');
		assert.equal(h.alleged, 1);
		assert.equal(h.attrib, 2);
		assert.equal(h.uncert, 1);
		assert.deepEqual(h.byClass.attrib, ['according to', 'per ']);
	});
	test('"developing an app" and "the United States" are not hedges; "IN DEVELOPMENT/DEVELOPING" is', () => {
		assert.equal(hedges('You are developing a trading bot in the United States.').uncert + hedges('in the United States').attrib, 0);
		assert.equal(hedges('This story is developing.').uncert, 1);
		assert.equal(hedges('IN DEVELOPMENT/DEVELOPING').uncert, 1);
		assert.equal(hedges('As one caller put it: nobody checks.').attrib, 1);
	});
});

describe('imperatives', () => {
	test('instructions to the viewer, in any clause', () => {
		assert.equal(isImperative('Check who bought before the post.'), true);
		assert.equal(isImperative('So before you follow any caller, do three things.'), true);
		assert.equal(isImperative("Don't share it."), true);
		assert.equal(isImperative('Never buy the screaming candle.'), true);
		assert.equal(isImperative('Review/check how fast they sold.'), true);
		assert.equal(isImperative('So, before following any caller, you can do three things.'), false);
		assert.equal(isImperative('Most new coins never see day two.'), false);
		assert.equal(isImperative('Do you know who sold?'), false);
	});
});

describe('Spanish and Portuguese cues', () => {
	test('negation (concord counts once), "never", attribution', () => {
		assert.deepEqual(sentenceCues('Y nunca compres la vela.', 'es'), {negated: true, never: true, hedges: 0});
		assert.deepEqual(sentenceCues('A Badger ya no le gusta nada.', 'es'), {negated: true, never: true, hedges: 0});
		assert.equal(sentenceCues('Según FixtureSwap, los atacantes drenaron 4,2 millones.', 'es').hedges, 1);
		assert.equal(sentenceCues('Los analistas de Bubblemaps advirtieron: las billeteras...', 'es').hedges, 1);
		assert.equal(sentenceCues('Os analistas da Bubblemaps alertaram: as carteiras...', 'pt-br').hedges, 1);
		assert.deepEqual(sentenceCues('O suporte real nunca pede isso.', 'pt-br'), {negated: true, never: true, hedges: 0});
		assert.equal(sentenceCues('Cuentas que se hacen pasar por soporte.', 'es').hedges, 0);
	});
});
