import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseDocument, structure} from '../lib/markdown.ts';
import {formatFindings, lintCopy, lintStructured, stripQuoted, unusedSources} from '../lib/lint.ts';

const knownIds = new Set(['src-a', 'src-b']);
const spotIds = new Set(['seed-phrases']);

const lint = (body: string, opts: {requireChapterCallouts?: boolean} = {}) =>
	lintStructured(structure(parseDocument(body)), {knownIds, spotIds, ...opts});

const rules = (fs: {rule: string; level: string}[]) => fs.filter((f) => f.level === 'error').map((f) => f.rule);

test('a figure needs a citation in the same item', () => {
	assert.deepEqual(rules(lint('- [ ] Thieves stole $68 million in May.\n')), ['uncited-statistic']);
	assert.deepEqual(rules(lint('- [ ] Thieves stole $68 million in May. [@src-a]\n')), []);
	assert.deepEqual(rules(lint('Up 1,400% on the year.\n')), ['uncited-statistic']);
	assert.deepEqual(rules(lint('1,611 complaints in 2021.\n')), ['uncited-statistic']);
	// an address is not a statistic
	assert.deepEqual(rules(lint(':::compare\nYours: 0x7a3f52b1\nLookalike: 0x7a3f0d9e\n:::\n')), []);
	// a quoted scam line is not our claim
	assert.deepEqual(rules(lint('They promise "guaranteed 2% a day" and it is a scam.\n')), []);
	// each table row needs its own citation for its own figures
	assert.deepEqual(rules(lint('| Said | Means |\n| --- | --- |\n| Lost $5 million | A theft [@src-b] |\n| Lost $9 million | A theft |\n')), ['uncited-statistic']);
});

test('names brands only with a citation (categories, not products)', () => {
	assert.deepEqual(rules(lint('Buy a Ledger today.\n')), ['brand']);
	assert.deepEqual(rules(lint('In May 2025 Coinbase disclosed a breach. [@src-a]\n')), []);
	// whole words only
	assert.deepEqual(rules(lint('The ledger of your accounts.\n')), []);
});

test('house rules: Zoo casing, placeholders, links, unknown sources, promises', () => {
	assert.deepEqual(rules(lint('Ask ZOO about it.\n')), ['zoo-casing']);
	assert.deepEqual(rules(lint('TODO: finish.\n')), ['placeholder']);
	assert.deepEqual(rules(lint('See [here](http://insecure.test).\n')), ['link']);
	assert.deepEqual(rules(lint('Fact. [@nope]\n')), ['unknown-source']);
	// "100%" is also an uncited figure; the promise is what matters here
	assert.deepEqual(rules(lint('This keeps you 100% safe.\n')), ['promise', 'uncited-statistic']);
	assert.deepEqual(rules(lint('This keeps you completely safe.\n')), ['promise']);
	assert.deepEqual(rules(lint('A risk-free way to store coins.\n')), ['promise']);
	assert.deepEqual(rules(lint('Safer, not safe: keep the habit.\n')), []);
	assert.deepEqual(rules(lint('It is unhackable.\n')), ['promise']);
	assert.deepEqual(rules(lint('They say "you will never get hacked" to sell it.\n')), []);
	assert.deepEqual(rules(lint('Bad **markup\n')), ['markup']);
});

test('spots must exist and chapters should close with the two boxes', () => {
	assert.deepEqual(rules(lint('# A {#a kind=chapter spot=missing}\n\nText.\n')), ['spot']);
	const w = lint('# A {#a kind=chapter spot=seed-phrases}\n\nText.\n', {requireChapterCallouts: true});
	assert.deepEqual(
		w.filter((f) => f.level === 'warning').map((f) => f.rule),
		['callouts'],
	);
	const ok = lint('# A {#a kind=chapter}\n\n:::redflag\nx\n:::\n\n:::fix\ny\n:::\n', {requireChapterCallouts: true});
	assert.equal(ok.length, 0);
});

test('copy lint accepts an inline source link as a citation, and placeholders', () => {
	assert.deepEqual(rules(lintCopy('The FBI logged $68 million in losses.\n', {knownIds})), ['uncited-statistic']);
	assert.deepEqual(rules(lintCopy('The FBI logged $68 million in losses ([FBI](https://www.ic3.gov/x)).\n', {knownIds})), []);
	assert.deepEqual(rules(lintCopy('Price: {{owner: price}} for 1,000 readers.\n', {knownIds})), []);
	assert.deepEqual(rules(lintCopy('<!-- 1,000 in a comment -->\n', {knownIds})), []);
});

test('helpers', () => {
	assert.equal(stripQuoted('a "b" c “d” e'), 'a   c   e');
	assert.deepEqual(unusedSources(['a', 'b', 'c'], ['b']), ['a', 'c']);
	assert.match(formatFindings([{level: 'error', line: 3, rule: 'r', message: 'm'}], 'f.md'), /^ERROR f\.md:3 \[r\] m$/);
});

test('cross-references must point at a section, and only documents with sections may use them', () => {
	const doc = '# One {#one kind=chapter}\n\nSee [#two] and [#missing].\n\n# Two {#two kind=chapter}\n\nText.\n';
	const fs = lint(doc).filter((f) => f.rule === 'xref');
	assert.equal(fs.length, 1);
	assert.match(fs[0].message, /\[#missing\] points at no section/);
	// the free edition has no sections: nothing for a cross-reference to point at
	assert.match(lint('## Group\n\n- [ ] **Act.** See [#one].\n').map((f) => f.message).join('\n'), /needs a document with sections/);
	// nor does the marketing copy
	assert.deepEqual(
		lintCopy('Read the incident plan [#incident-response].', {knownIds}).map((f) => f.rule),
		['xref'],
	);
});
