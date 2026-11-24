import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseDocument, structure} from '../lib/markdown.ts';
import {compareRows, renderDocument, splitLeadStrong, type Product, type RenderOptions} from '../lib/render.ts';
import {parseInline} from '../lib/inline.ts';
import type {SourceFile} from '../lib/sources.ts';

const product: Product = {
	id: 'p',
	title: 'Test Product',
	copyrightHolder: 'Holder Ltd',
	contact: null,
	fullEditionUrl: null,
	licence: {free: 'Share it unchanged.', full: 'Personal use only.'},
};

const sources: SourceFile = {
	version: 1,
	checked: '2026-11-24',
	methods: {read: 'r', 'search-extract': 's'},
	sources: [
		{id: 'alpha', title: 'Alpha report', publisher: 'Pub A', date: '2025-02', url: 'https://a.test/report', kind: 'research', method: 'read', supports: 'x'},
		{id: 'beta', title: 'Beta alert', publisher: 'Pub B', date: '2024-12-03', url: 'https://www.b.test/alert', kind: 'government', method: 'search-extract', supports: 'y'},
	],
};

const css = () => '/* css */';

const full = `---
title: Book
editionLabel: Full edition
version: 1.0
date: 2026-11-24
---

@cover

# Start {#start kind=front}

Intro.

@toc

# One {#one kind=chapter toc="First summary."}

> Lede cites beta. [@beta]

## Do today {priority=today}

- [ ] **Act.** Cites alpha then beta. [@alpha; @beta]

:::redflag
Danger <b>tag</b>.
:::

:::fix
Do the fix.
:::

:::compare Same ends
Yours: 0x1111aaaa2222
Fake: 0x1111bbbb2222
:::

:::ladder Strength
- [best] **Key.** Strong.
- [weak] **SMS.** Weak.
:::

:::cards {.stats}
- **1,600.** Median views
:::

# Card {#card kind=appendix frame=cut}

:::fill
Carrier line:
:::

# Sources {#sources kind=back}

@sources

# About {#about kind=back continue=true}

Bye.
`;

const opts = (o: Partial<RenderOptions> = {}): RenderOptions => ({edition: 'full', product, sources, spots: {}, ...o});

test('full edition: citations numbered in reading order and listed once', () => {
	const r = renderDocument(structure(parseDocument(full)), opts(), css);
	const order = r.registry.cited().map((c) => c.source.id);
	assert.deepEqual(order, ['beta', 'alpha']);
	assert.match(r.html, /<sup class="cite"><a href="#src-alpha">2<\/a><span class="cite-sep">,<\/span><a href="#src-beta">1<\/a><\/sup>|<sup class="cite"><a href="#src-beta">1<\/a><span class="cite-sep">,<\/span><a href="#src-alpha">2<\/a><\/sup>/);
	assert.match(r.html, /<li class="src" id="src-beta"><span class="src-n">1<\/span>/);
	assert.match(r.html, /\(search extract\)/);
	assert.match(r.html, /b\.test\/alert/);
});

test('full edition: structure, pairing, escaping, components', () => {
	const r = renderDocument(structure(parseDocument(full)), opts(), css);
	assert.match(r.html, /<section class="cover"/);
	// the default box titles get the house typography (curly apostrophes), like every other line of text
	assert.match(r.html, /<div class="pair"><aside class="callout redflag">.*Badger’s Red Flag.*<\/aside><aside class="callout fix">.*Zoo’s One Fix/s);
	assert.ok(!/Badger's|Zoo's/.test(r.html), 'no straight apostrophes in the default titles');
	assert.ok(!r.html.includes('<b>tag</b>'), 'content HTML is escaped');
	assert.match(r.html, /<span class="chunk same">1111<\/span><span class="chunk">aaaa<\/span><span class="chunk same">2222<\/span>/);
	assert.match(r.html, /<div class="bars" aria-hidden="true"><i class="on"><\/i><i class="on"><\/i><i class="on"><\/i><i class="on"><\/i><\/div><div class="level">Best/);
	assert.match(r.html, /<div class="cards stats"/);
	assert.match(r.html, /<div class="cutout">/);
	assert.match(r.html, /class="fill-line"/);
	assert.match(r.html, /class="back continue"/);
	assert.match(r.html, /<p class="colophon">.*Holder Ltd\. Personal use only\./s);
	// no spots were passed in, so the cover reports its missing illustration instead of inventing one
	assert.deepEqual(r.warnings.map((w) => /spot "([^"]+)"/.exec(w)?.[1]), ['cover-pair']);
});

test('contents: placeholders first, real page numbers on the second pass', () => {
	const st = structure(parseDocument(full));
	const first = renderDocument(st, opts(), css);
	assert.deepEqual(first.tocTargets, ['one', 'card', 'sources', 'about']);
	assert.match(first.html, /href="#one".*<small>First summary\.<\/small>.*<span class="toc-page">00<\/span>/s);
	const second = renderDocument(st, opts({tocPages: {one: 4, card: 7, sources: 8, about: 9}}), css);
	assert.match(second.html, /href="#one".*<span class="toc-page">4<\/span>/s);
	// the "continue" section shares the previous section's named page (no forced break)
	assert.deepEqual(
		second.pages.map((p) => p.name),
		['p-start', 'p-one', 'p-card', 'p-sources'],
	);
	assert.equal(second.pages[1].label, '01 · One');
});

test('colophon can be switched off; unknown sources fail loudly', () => {
	const r = renderDocument(structure(parseDocument(full)), opts({colophon: false}), css);
	assert.ok(!r.html.includes('class="colophon"'));
	assert.throws(() => renderDocument(structure(parseDocument('# A {#a kind=front}\n\nX. [@missing]\n')), opts(), css), /unknown source id\(s\): missing/);
});

test('missing spot illustrations are reported, not invented', () => {
	const r = renderDocument(structure(parseDocument('# A {#a kind=chapter spot=seed-phrases}\n\nText.\n')), opts(), css);
	assert.match(r.warnings.join('\n'), /spot "seed-phrases" is not rendered yet/);
	assert.ok(!r.html.includes('<img'));
	const withSpot = renderDocument(structure(parseDocument('# A {#a kind=chapter spot=seed-phrases}\n\nText.\n')), opts({spots: {'seed-phrases': {id: 'seed-phrases', src: 'spots/seed-phrases.svg', widthPx: 100, heightPx: 80, alt: 'Badger "lies" down'}}}), css);
	assert.match(withSpot.html, /<img src="spots\/seed-phrases\.svg" width="100" height="80" alt="Badger &quot;lies&quot; down">/);
});

const free = `---
title: Free
editionLabel: Free edition
version: 1.0
date: 2026-11-24
---

@cover

## Group one {#g1}

- [ ] **Check.** Text. [@alpha]

@pagebreak

## Group two {#g2}

- [ ] **Other.** Text.

:::steps If it goes wrong
1. Stop.
2. Report.
:::

:::upsell The full edition
More.
:::

@sources
`;

test('free edition: pages split at @pagebreak, compact sources, legal line', () => {
	const r = renderDocument(structure(parseDocument(free)), opts({edition: 'free', product: {...product, fullEditionUrl: 'https://go.test/checklist'}}), css);
	assert.match(r.html, /<header class="free-head">/);
	assert.equal((r.html.match(/class="free-page/g) ?? []).length, 2);
	assert.match(r.html, /class="free-page next"/);
	assert.match(r.html, /<li class="src" id="src-alpha"><span class="src-n">1<\/span><span>Pub A: <a href="https:\/\/a\.test\/report">Alpha report<\/a>/);
	assert.match(r.html, /<strong>Get it:<\/strong> <a href="https:\/\/go\.test\/checklist">go\.test\/checklist<\/a>/);
	assert.match(r.html, /Share it unchanged\. © 2026 Holder Ltd\./);
	assert.throws(() => renderDocument(structure(parseDocument('## G\n\nNot a list.\n')), opts({edition: 'free'}), css), /followed by a checklist/);
});

test('component helpers', () => {
	const {title, rest} = splitLeadStrong(parseInline('**Vault.** Most of it.'));
	assert.deepEqual(title, [{t: 'text', v: 'Vault'}]);
	assert.deepEqual(rest, [{t: 'text', v: 'Most of it.'}]);
	assert.throws(() => compareRows(['Only: 0x12'], 1), /multiple of four|at least two/);
	assert.throws(() => compareRows(['A: 0x1234', 'B: 0x12345678'], 1), /same length/);
	assert.throws(() => compareRows(['A: nothex', 'B: 0x1234'], 1), /Label: 0x/);
});

test('the cover states independence only when the content says so', () => {
	const without = renderDocument(structure(parseDocument(full)), opts(), css);
	assert.ok(!/sponsor/i.test(without.html.split('</section>')[0]), 'no claim the content did not make');
	const withClaim = renderDocument(structure(parseDocument(full.replace('version: 1.0', 'version: 1.0\nindependence: No sponsors, no affiliate links'))), opts(), css);
	assert.match(withClaim.html.split('</section>')[0], /<span><svg[^>]*>.*<\/svg>No sponsors, no affiliate links<\/span><\/div>/s);
	const freeWith = renderDocument(structure(parseDocument(free.replace('version: 1.0', 'version: 1.0\nindependence: No sponsors, no affiliate links'))), opts({edition: 'free'}), css);
	assert.match(freeWith.html, /tax advice\. No sponsors, no affiliate links\. Share it unchanged\./);
});
