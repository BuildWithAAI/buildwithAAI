import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {buildIndex, findKnown, validateAllowlist} from '../lib/allowlist.ts';
import {findAttributions} from '../lib/attribution.ts';
import {splitNarration} from '../lib/claims.ts';
import {scanNames} from '../lib/names.ts';
import {tokenize} from '../lib/text.ts';

const ALLOW = JSON.parse(readFileSync(join(fileURLToPath(import.meta.url), '..', '..', 'allowlist.json'), 'utf8'));

describe('sentences and claims', () => {
	test('a tag backs the text before it; trailing text joins the last claim', () => {
		const [s] = splitNarration('X lost $5M [src:a], and Y lost $2M [src:b], the largest this year.');
		assert.deepEqual(
			s.claims.map((c) => [c.display, c.srcIds]),
			[
				['X lost $5M', ['a']],
				['and Y lost $2M, the largest this year.', ['b']],
			],
		);
	});
	test('a tag after the full stop backs the sentence before it; several tags share a claim', () => {
		const s = splitNarration('Bybit was hacked. [src:a] [src:b] Then more.');
		assert.equal(s.length, 2);
		assert.deepEqual(s[0].claims, [{display: 'Bybit was hacked.', spoken: 'Bybit was hacked.', srcIds: ['a', 'b']}]);
		assert.deepEqual(s[1].claims, []);
	});
	test('{display|spoken} keeps both sides; decimals and abbreviations do not split', () => {
		const s = splitNarration('About {$1.5M|one point five million dollars} moved on Nov. 23 in the U.S. per the firm [src:x]. Done.');
		assert.equal(s.length, 2);
		assert.equal(s[0].display, 'About $1.5M moved on Nov. 23 in the U.S. per the firm.');
		assert.equal(s[0].spoken, 'About one point five million dollars moved on Nov. 23 in the U.S. per the firm.');
		assert.deepEqual(s[0].pairs, [{display: '$1.5M', spoken: 'one point five million dollars'}]);
	});
	test('malformed markup throws', () => assert.throws(() => splitNarration('broken {display only [src:x].')));
	test('zh and hi full stops end sentences without a space', () => {
		assert.equal(splitNarration('攻击者盗走了资金[src:a]。这是第二次。').length, 2);
		assert.equal(splitNarration('यह एक खबर है।दूसरी लाइन।').length, 2);
	});
});

describe('known names (allowlist)', () => {
	const {file, problems} = validateAllowlist(ALLOW);
	test('the shipped allowlist is valid and lists no officials by default', () => {
		assert.deepEqual(problems, []);
		assert.ok(file);
		assert.deepEqual(file?.officials, []);
	});
	const idx = buildIndex(file!);
	const known = (t: string) => findKnown(tokenize(t), idx, t).map((k) => `${k.text}:${k.entry.category}`);
	test('longest match, multi-word agencies with "and"', () =>
		assert.deepEqual(known('The Securities and Exchange Commission and the FBI said'), ['Securities and Exchange Commission:agency', 'FBI:agency']));
	test('lower-case entries match only as spelled; capitalised entries only when capitalised', () => {
		assert.deepEqual(known('according to crypto.news, stETH moved'), ['crypto.news:publisher', 'stETH:term']);
		assert.deepEqual(known('a safe base layer'), []);
		assert.deepEqual(known('Funds moved to Base'), ['Base:chain']);
	});
	test('blocked handles are flagged even in capitals; short ones need exact case', () => {
		assert.deepEqual(known('ZachXBT and CZ'), ['ZachXBT:blocked', 'CZ:blocked']);
		assert.deepEqual(known('Cz'), []);
	});
	test('the allowlist validator rejects a name that is both blocked and allowed, and incomplete officials', () => {
		const bad = {...ALLOW, organisations: [...ALLOW.organisations, 'ZachXBT'], officials: [{name: 'Solo'}]};
		const v = validateAllowlist(bad);
		assert.equal(v.file, null);
		assert.ok(v.problems.some((p) => p.msg.includes('both blocked and allowed')));
		assert.ok(v.problems.some((p) => p.msg.includes('officials[0]')));
	});
});

describe('personal names (R4 scanner)', () => {
	const idx = buildIndex(validateAllowlist(ALLOW).file!, [{name: 'FixtureSwap', category: 'incident'}, {name: 'Example Wire', category: 'source'}]);
	const persons = (t: string, extra: Partial<Parameters<typeof scanNames>[1]> = {}) =>
		scanNames(t, {idx, briefText: 'fixtureswap example wire', ...extra}).persons.map((p) => `${p.text}:${p.reason}:${p.severity}`);
	test('two capitalised words that are not a known organisation or place', () => {
		assert.deepEqual(persons('Thanks to viewer Jordan Sample for the tip.'), ['Jordan Sample:two-word-name:error']);
		assert.deepEqual(persons('The Do Kwon case'), ['Do Kwon:two-word-name:error']);
	});
	test('roles, titles, apposition, ages, handles, given names', () => {
		assert.deepEqual(persons('The exchange CEO Smith said so.'), ['Smith:title-or-role:error']);
		assert.deepEqual(persons('Later, Smith, the founder, said so.'), ['Smith:apposition:error']);
		assert.deepEqual(persons('Mr. Smith said so.'), ['Smith:title-or-role:error']);
		assert.deepEqual(persons('ask @fixturefan'), ['@fixturefan:handle:error']);
		assert.deepEqual(persons('later Vitalik said'), ['Vitalik:first-name:error']);
		assert.deepEqual(persons('a 22-year-old was arrested'), ['22-year-old:identifying-detail:error']);
	});
	test("the radar's [named person] placeholder", () => assert.deepEqual(persons('[named person] approved it.'), ['[named person]:placeholder:error']));
	test('organisations, places, show names and sentence starts are not people', () => {
		assert.deepEqual(persons('Example Wire says FixtureSwap, Example Security Group and North Carolina are fine.'), []);
		assert.deepEqual(persons("Zoo's One Fix: Badger's Red Flag on the Rekt Meter."), []);
		assert.deepEqual(persons('Meanwhile attackers moved the funds.'), []);
	});
	test('a lone surname that is part of a personal name in the sources', () =>
		assert.deepEqual(persons('later Kwon said', {sourcePersonTokens: new Set(['kwon'])}), ['Kwon:source-person:error']));
	test('unknown words fail closed: an error mid-sentence even when a source uses the word (a surname or pseudonym the radar missed)', () => {
		assert.deepEqual(persons('funds went to Zorblax yesterday'), ['Zorblax:unknown-name:error']);
		assert.deepEqual(persons('funds went to Zorblax yesterday', {briefText: 'zorblax'}), ['Zorblax:unknown-name-in-sources:error']);
		// at a sentence start an unknown word may be an ordinary word: a warning, unless the sources use it as a name
		assert.deepEqual(persons('Zorblax went quiet.'), ['Zorblax:unknown-name:warning']);
		assert.deepEqual(persons('Zorblax went quiet.', {briefText: 'zorblax'}), ['Zorblax:unknown-name-in-sources:error']);
	});
	test('speakers, lower-case names and handles are people', () => {
		assert.deepEqual(persons('Teng said the exchange will cover the losses.'), ['Teng:speaker-name:error']);
		assert.deepEqual(persons('According to The Block, Saylor says the dots are not done.'), ['Saylor:speaker-name:error']);
		assert.deepEqual(persons('Investigator zachxbt traced part of the funds.'), ['zachxbt:blocked:error'], 'a blocked handle matches in lower case');
		assert.deepEqual(persons('Researcher fixturesleuth traced part of the funds.'), ['fixturesleuth:role-handle:error']);
		assert.deepEqual(persons('the engineer, richard teng, opened the file.'), ['richard teng:role-handle:error'], 'an apposition after a role');
		assert.deepEqual(persons('thanks to richard teng for the tip.'), ['richard teng:lowercase-name:error']);
		assert.deepEqual(persons('the engineer opened the file and the attacker drained the wallet.'), []);
	});
	test('headlines in Title Case or ALL CAPS drop their common words', () => {
		assert.deepEqual(scanNames('DEVELOPING: FixtureSwap Reports $4.2M Drain', {idx, short: true}).persons, []);
		assert.deepEqual(persons('KWON ARRESTED', {short: true}), ['KWON:unknown-word-headline:error']);
	});
});

describe('attribution phrases', () => {
	const names = (t: string) => findAttributions(t).map((a) => a.name || `(${a.generic})`);
	test('according to, says, possessive documents, by, per, headline', () => {
		assert.deepEqual(names("According to FixtureSwap's preliminary review, a key leaked."), ['FixtureSwap']);
		assert.deepEqual(names('Example Security Lab says about 1,400 ETH left.'), ['Example Security Lab']);
		assert.deepEqual(names('The FBI said on Friday that funds moved.'), ['FBI']);
		assert.deepEqual(names('FixtureLend lost $3.1M, as listed by Example Hack Tracker.'), ['Example Hack Tracker']);
		assert.deepEqual(names('Per Example Wire, it happened.'), ['Example Wire']);
		assert.deepEqual(names('FixtureSwap: pools paused'), ['FixtureSwap']);
		assert.deepEqual(names('According to The Defiant, parts are unconfirmed.'), ['Defiant']);
	});
	test('pronouns and generic referents', () => {
		assert.deepEqual(names('It says the investigation is ongoing.'), ['(it)']);
		assert.deepEqual(names('The firm says the funds moved.'), ['(firm)']);
		assert.deepEqual(names('We think it was bad.'), []);
	});
});
