/**
 * Does a sentence look factual? (pure). Universal signals: digits (not glued to a letter, so "Web3" is not a number),
 * percent and currency signs, named organisations. Language signals come from lexicon.ts (numbers in words, percent
 * and currency words, dates, superlatives, attributions). Attributions ("according to") can never be waived.
 */
import type {Lang} from '../../../src/episode/types.ts';
import {FACTUAL, ORG_RE} from './lexicon.ts';
import {allMatches, clean} from './text.ts';

export type SignalKind = 'number' | 'percent' | 'currency' | 'scale' | 'date' | 'superlative' | 'attribution' | 'org';
export type Signal = {kind: SignalKind; text: string; waivable: boolean};

const DIGITS = /(?<![\p{Script=Latin}])\p{Nd}(?:[\p{Nd}]|[.,:/](?=\p{Nd}))*/gu;
const PERCENT_SIGN = /[%％٪]/gu;
const CURRENCY_SIGN = /R\$|US\$|[$€£¥₹₩₿]/gu;

const KIND_LABEL: Record<SignalKind, string> = {
	number: 'a number',
	percent: 'a percentage',
	currency: 'a money amount',
	scale: 'a quantity in words',
	date: 'a date',
	superlative: 'a superlative',
	attribution: 'an attribution',
	org: 'a named organisation',
};
export const signalLabel = (s: Signal): string => `${KIND_LABEL[s.kind]} ("${s.text}")`;

const scan = (text: string, lang: Lang, out: Map<string, Signal>): void => {
	const t = clean(text);
	if (!t) return;
	const add = (kind: SignalKind, found: string) => {
		const key = `${kind}:${found.toLowerCase()}`;
		if (!out.has(key)) out.set(key, {kind, text: found.trim(), waivable: kind !== 'attribution'});
	};
	for (const m of allMatches(DIGITS, t)) add('number', m[0]);
	for (const m of allMatches(PERCENT_SIGN, t)) add('percent', m[0]);
	for (const m of allMatches(CURRENCY_SIGN, t)) add('currency', m[0]);
	for (const m of allMatches(ORG_RE, t)) add('org', m[0]);
	const lex = FACTUAL[lang];
	for (const re of lex.attribution) for (const m of allMatches(re, t)) add('attribution', m[0]);
	for (const re of lex.superlative) for (const m of allMatches(re, t)) add('superlative', m[0]);
	for (const re of lex.scale) for (const m of allMatches(re, t)) add('scale', m[0]);
	for (const re of lex.percent) for (const m of allMatches(re, t)) add('percent', m[0]);
	for (const re of lex.currency) for (const m of allMatches(re, t)) add('currency', m[0]);
	for (const re of lex.date) for (const m of allMatches(re, t)) add('date', m[0]);
};

/** Signals in a sentence: its display text and its spoken text (a number may be written only on one side). */
export const factualSignals = (display: string, spoken: string, lang: Lang): Signal[] => {
	const out = new Map<string, Signal>();
	scan(display, lang, out);
	if (spoken && spoken !== display) scan(spoken, lang, out);
	return [...out.values()];
};
