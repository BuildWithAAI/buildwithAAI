import assert from 'node:assert/strict';
import {test} from 'node:test';
import {blockTexts, ContentError, parseAttrs, parseDocument, splitAttrs, structure, walkBlocks, type Block} from '../lib/markdown.ts';

const doc = `---
title: T
edition: full
---

@cover

# How to use {#how kind=front}

> The lede.

Intro paragraph
continues here.

1. First rule.
2. Second rule.

@toc

# Seed phrases {#seed kind=chapter spot=seed-phrases toc="Short 'summary'."}

> Chapter lede. [@src-a]

## Do today {priority=today}

- [ ] **Do this.** Because. [@src-a]
  More detail on the next line.
- [x] **Done already.**

| A | B |
| --- | --- |
| one | two \\| three |

:::redflag
Never share it.
:::

:::fix
One fix.
:::

# Second {#second kind=chapter}

Body.

# Card {#card kind=appendix frame=cut}

:::fill
Label one:
Label two:
:::

# Sources {#sources kind=back}

@sources

# About {#about kind=back continue=true}

Text.
`;

test('parses front matter, directives, headings with attributes and lists', () => {
	const d = parseDocument(doc);
	assert.deepEqual(d.meta, {title: 'T', edition: 'full'});
	assert.equal(d.blocks[0].type, 'directive');
	const h = d.blocks.find((b) => b.type === 'heading' && b.text === 'Seed phrases') as Extract<Block, {type: 'heading'}>;
	assert.equal(h.attrs.id, 'seed');
	assert.equal(h.attrs.values.spot, 'seed-phrases');
	assert.equal(h.attrs.values.toc, "Short 'summary'.");
	const check = d.blocks.find((b) => b.type === 'checklist') as Extract<Block, {type: 'checklist'}>;
	assert.equal(check.items.length, 2);
	assert.equal(check.items[0].text, '**Do this.** Because. [@src-a] More detail on the next line.');
	assert.equal(check.items[1].checked, true);
	const table = d.blocks.find((b) => b.type === 'table') as Extract<Block, {type: 'table'}>;
	assert.deepEqual(table.rows[0], ['one', 'two | three']);
	const para = d.blocks.find((b) => b.type === 'paragraph') as Extract<Block, {type: 'paragraph'}>;
	assert.equal(para.text, 'Intro paragraph continues here.');
});

test('structure numbers chapters and appendices, takes ledes and keeps attributes', () => {
	const s = structure(parseDocument(doc));
	assert.deepEqual(
		s.sections.map((x) => [x.id, x.kind, x.number]),
		[
			['how', 'front', ''],
			['seed', 'chapter', '01'],
			['second', 'chapter', '02'],
			['card', 'appendix', 'A'],
			['sources', 'back', ''],
			['about', 'back', ''],
		],
	);
	const seed = s.sections[1];
	assert.equal(seed.lede, 'Chapter lede. [@src-a]');
	assert.equal(seed.spot, 'seed-phrases');
	assert.equal(s.sections[3].values.frame, 'cut');
	assert.equal(s.sections[5].values.continue, 'true');
	assert.equal(s.preamble.length, 1);
	const fences = [...walkBlocks(seed.blocks)].filter((b) => b.type === 'fence').map((b) => (b as {kind: string}).kind);
	assert.deepEqual(fences, ['redflag', 'fix']);
	const fill = s.sections[3].blocks[0] as Extract<Block, {type: 'fence'}>;
	assert.deepEqual(fill.raw, ['Label one:', 'Label two:']);
	assert.deepEqual(
		blockTexts(fill).map((t) => t.text),
		['Label one:', 'Label two:'],
	);
});

test('errors carry the line number', () => {
	const bad = (src: string, re: RegExp) => {
		assert.throws(
			() => structure(parseDocument(src)),
			(e: unknown) => e instanceof ContentError && re.test(e.message) && e.line > 0,
		);
	};
	bad('# No id\n', /needs an id/);
	bad('# A {#a}\n# B {#a}\n', /duplicate section id/);
	bad(':::nope\nx\n:::\n', /unknown fence kind/);
	bad(':::note\nnever closed\n', /never closed/);
	bad(':::note\n:::fix\n:::\n', /nested/);
	bad('@nonsense\n', /unknown directive/);
	bad('| a | b |\n| a | b |\n', /separator/);
	bad('| a | b |\n| --- | --- |\n| 1 |\n', /cells/);
	bad('#### deep\n', /levels 1-3/);
	bad('---\ntitle: x\n', /not closed/);
	bad('a\tb\n', /tab/);
	bad('# A {#a kind=weird}\n', /unknown section kind/);
	bad('- one\n1. two\n', /switch type/);
});

test('attribute parsing', () => {
	assert.deepEqual(parseAttrs('#x .y k=v q="a b"', 1), {id: 'x', classes: ['y'], values: {k: 'v', q: 'a b'}});
	assert.throws(() => parseAttrs('#a #b', 1), /two ids/);
	assert.deepEqual(splitAttrs('Title {#t}', 1), {text: 'Title', attrs: {id: 't', classes: [], values: {}}});
	assert.deepEqual(splitAttrs('No attrs', 1).text, 'No attrs');
});
