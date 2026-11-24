/**
 * Layout behaviour added in the 2026-11-24 design pass: cross-references with page numbers, the free edition's
 * explicit columns and copy-fit, cut-out cards, typography helpers, table frames and the spot crops.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseDocument, structure} from '../lib/markdown.ts';
import {asSentence, blockWeight, breakableUrl, cutCards, renderDocument, splitColumns, typeset, xrefLabel, type Product, type RenderOptions} from '../lib/render.ts';
import {fitPagesInPage, FIT_SAFETY_PX, type FitResult} from '../lib/pdf.ts';
import {contentBoxPx, PAGE_MARGIN_IN} from '../lib/styles.ts';
import {FREE_FIT} from '../build.ts';
import {SPOTS, spotById, ZOO_BUST} from '../spots/catalog.ts';
import type {SourceFile} from '../lib/sources.ts';

const product: Product = {
	id: 'p',
	title: 'Test Product',
	copyrightHolder: 'Holder Ltd',
	contact: null,
	fullEditionUrl: null,
	licence: {free: "Share it, don't sell it.", full: "Please don't share or resell it."},
};

const sources: SourceFile = {
	version: 1,
	checked: '2026-11-24',
	methods: {read: 'r', 'search-extract': 's'},
	sources: [
		{id: 'alpha', title: 'How to Enable a Whitelist?', publisher: "Pub's Help", date: '2025-02', url: 'https://www.a.test/docs/how-to-enable/AITradingBots.html', kind: 'research', method: 'read', supports: 'x'},
		{id: 'beta', title: "'Ice phishing' on the blockchain", publisher: 'Pub B', date: '2024-12-03', url: 'https://b.test/alert', kind: 'government', method: 'search-extract', supports: 'y'},
	],
};

const css = () => '/* css */';
const opts = (o: Partial<RenderOptions> = {}): RenderOptions => ({edition: 'full', product, sources, spots: {}, ...o});

const full = `---
title: Book
editionLabel: Full edition
version: 1.0
date: 2026-11-24
---

# Start {#start kind=front kicker="Start here" rows=roomy spot=quick-start}

> Lede.

- [ ] **First.** Cites alpha. [@alpha] [#one]
- [ ] **Second.** No tag here, see [#card] inline.

@toc

# One {#one kind=chapter}

> Lede cites beta. [@beta]

| Where | What |
| --- | --- |
| Here | There |

# Card {#card kind=appendix frame=cut copies=2 cols=2}

:::fill
Carrier line:
:::

:::steps Moves
1. Stop.
:::

# Sources {#sources kind=back}

@sources
`;

test('typography helpers: curly quotes, sentence endings, URL break points, cross-reference labels', () => {
	assert.equal(typeset("Don't <b>"), 'Don’t &lt;b&gt;');
	assert.equal(asSentence('Why?'), 'Why?');
	assert.equal(asSentence('Done.'), 'Done.');
	assert.equal(asSentence('The “quote.”'), 'The “quote.”');
	assert.equal(asSentence('Title'), 'Title.');
	assert.equal(breakableUrl('a.test/x-y/AITradingBots.html?q=1&r=2'), 'a<wbr>.test<wbr>/x<wbr>-y<wbr>/AITradingBots<wbr>.html<wbr>?q<wbr>=1<wbr>&amp;r<wbr>=2');
	const st = structure(parseDocument(full));
	assert.deepEqual(st.sections.map(xrefLabel), ['Start', 'Chapter 1', 'Appendix A', 'Sources']);
});

test('cross-references: "00" on the first pass, real pages on the second; a trailing one becomes a page tag', () => {
	const st = structure(parseDocument(full));
	const first = renderDocument(st, opts(), css);
	assert.match(first.html, /<li class="check has-ref">.*<a class="xref-tag" href="#one" title="Chapter 1"><span class="xt-sec">Ch\.&nbsp;1<\/span><span class="xt-page">p\.&nbsp;00<\/span><\/a><\/li>/s);
	assert.match(first.html, /see <a class="xref" href="#card">Appendix A, p\.&nbsp;00<\/a> inline/);
	const second = renderDocument(st, opts({tocPages: {one: 5, card: 7, sources: 8}}), css);
	assert.match(second.html, /<span class="xt-page">p\.&nbsp;5<\/span>/);
	assert.match(second.html, /Appendix A, p\.&nbsp;7<\/a>/);
	// the item that only mentions a section inline keeps the plain two-column row
	assert.equal((second.html.match(/class="check has-ref"/g) ?? []).length, 1);
	assert.throws(() => renderDocument(structure(parseDocument('# A {#a kind=front}\n\nSee [#nowhere].\n')), opts(), css), /cross-reference\(s\) to no section: nowhere/);
});

test('front pages with art get the chapter head; rows=roomy and kickers are content choices', () => {
	const r = renderDocument(structure(parseDocument(full)), opts(), css);
	assert.match(r.html, /<section class="front roomy" id="start"[^>]*><header class="chapter-head"><div class="chapter-titles"><div class="kicker"><span>Start here<\/span><\/div><h1>Start<\/h1><p class="lede">Lede\.<\/p><\/div><\/header>/);
	assert.throws(() => renderDocument(structure(parseDocument('# A {#a kind=front rows=tight}\n\nX.\n')), opts(), css), /rows must be "roomy"/);
});

test('tables sit in a clipping frame (no rounded corner cells), and source lists are typeset', () => {
	const r = renderDocument(structure(parseDocument(full)), opts(), css);
	assert.match(r.html, /<div class="table-frame keep"><table class="data"><thead>/);
	// a title that ends in "?" gets no extra period; quotes curl; the URL breaks at its punctuation
	assert.match(r.html, /<span class="src-title">How to Enable a Whitelist\?<\/span> Pub’s Help, February 2025\./);
	assert.match(r.html, /<span class="src-title">‘Ice phishing’ on the blockchain\.<\/span>/);
	assert.match(r.html, /a<wbr>\.test<wbr>\/docs<wbr>\/how<wbr>-to<wbr>-enable<wbr>\/AITradingBots<wbr>\.html/);
	assert.ok(!r.html.includes('?.<'), 'no doubled punctuation');
	assert.match(r.html, /Please don’t share or resell it\./);
});

test('cut-out cards: copies and two-column layout, rendered once and repeated', () => {
	const r = renderDocument(structure(parseDocument(full)), opts(), css);
	assert.equal((r.html.match(/<div class="cutout two-col">/g) ?? []).length, 2);
	assert.match(r.html, /Cut along the dashed lines\. Keep one card at home/);
	assert.equal(cutCards({values: {}, line: 1}, 'X').match(/class="cutout"/g)?.length, 1);
	assert.throws(() => cutCards({values: {copies: '4'}, line: 3}, 'X'), /copies must be 1, 2 or 3/);
	assert.throws(() => cutCards({values: {cols: '3'}, line: 3}, 'X'), /cols must be 1 or 2/);
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

@columnbreak

## Group two {#g2}

- [ ] **Other.** Text.

@pagebreak

:::steps If it goes wrong
1. Stop.
:::

:::upsell The full edition
More.
:::

@sources
`;

test('free edition: framed pages, explicit or balanced columns, header first and sources last', () => {
	const r = renderDocument(structure(parseDocument(free)), opts({edition: 'free'}), css);
	const pages = r.html.split('<section class="free-page').slice(1);
	assert.equal(pages.length, 2);
	assert.ok(pages.every((p) => /^[^>]*data-fit-page>/.test(p)), 'every page is a fit frame');
	assert.match(pages[0], /<header class="free-head">/);
	assert.ok(!pages[1].includes('free-head'));
	// page 1: the @columnbreak puts one group in each column
	assert.match(pages[0], /<div class="free-col"><section class="group" id="g1">.*<\/section><\/div><div class="free-col"><section class="group" id="g2">/s);
	// page 2 has no @columnbreak, so its two boxes are balanced into the two columns
	assert.match(pages[1], /<div class="free-col"><div class="free-box"><div class="steps">.*<\/div><\/div><div class="free-col"><div class="free-box"><div class="upsell">/s);
	assert.match(pages[1], /<section class="free-sources"><h3>Sources<\/h3><div class="sources-cols"><ol class="sources-list">/);
	assert.match(pages[1], /<p class="free-legal">.*Share it, don’t sell it\./s);
	assert.throws(() => renderDocument(structure(parseDocument(free.replace('@columnbreak', '@columnbreak\n\n@columnbreak'))), opts({edition: 'free'}), css), /one @columnbreak per page/);
	assert.throws(() => renderDocument(structure(parseDocument('# A {#a kind=front}\n\n@columnbreak\n')), opts(), css), /@columnbreak belongs to the free edition/);
});

test('column balancing keeps reading order and splits at the most even point', () => {
	assert.deepEqual(splitColumns([], (x: number) => x), [[], []]);
	assert.deepEqual(splitColumns([5], (x) => x), [[5], []]);
	assert.deepEqual(splitColumns([3, 3, 3, 3], (x) => x), [[3, 3], [3, 3]]);
	assert.deepEqual(splitColumns([8, 1, 1, 1, 1, 1], (x) => x), [[8], [1, 1, 1, 1, 1]]);
	assert.deepEqual(splitColumns([1, 1, 1, 9], (x) => x), [[1, 1, 1], [9]]);
	const st = structure(parseDocument('## A\n\n- [ ] One.\n\n## B\n\n- [ ] One.\n- [ ] Two, a much longer item that wraps onto a second line of the column.\n'));
	assert.ok(blockWeight(st.preamble.slice(2, 4)) > blockWeight(st.preamble.slice(0, 2)));
});

/** A stand-in for the browser: frames whose height grows with --fit, as the real columns do. */
const fakeDom = (heightAt: ((fit: number) => number)[]) => {
	const props: Record<string, string> = {};
	const frames = heightAt.map((h) => ({style: {height: ''} as {height: string}, getBoundingClientRect: () => ({height: h(Number(props['--fit'] ?? 1))})}));
	const body = {style: {width: ''}};
	(globalThis as Record<string, unknown>).document = {
		querySelectorAll: () => frames,
		documentElement: {style: {setProperty: (k: string, v: string) => (props[k] = v)}},
		body,
	};
	return {frames, body, props};
};

test('copy-fit: the largest type scale at which the fullest page still fits, then frames pinned to the page', () => {
	const box = {widthPx: 672, heightPx: 907.2, min: 0.92, max: 1.3};
	const limit = box.heightPx - FIT_SAFETY_PX;
	try {
		// page 1 grows faster than page 2, so it decides the scale
		const {frames, body, props} = fakeDom([(s) => 700 * s, (s) => 600 * s]);
		const r = fitPagesInPage({...box, safetyPx: FIT_SAFETY_PX}) as FitResult;
		assert.ok(r.fits);
		assert.ok(Math.abs(r.scale - Math.floor((limit / 700) * 1000) / 1000) < 0.0015, String(r.scale));
		assert.ok(700 * r.scale <= limit);
		assert.equal(props['--fit'], String(r.scale));
		assert.deepEqual(frames.map((f) => f.style.height), [`${limit}px`, `${limit}px`]);
		assert.equal(body.style.width, '', 'the measuring width is removed before printing');
		// content too long even at the smallest scale: report it and leave the frames alone
		const tooLong = fakeDom([(s) => 2000 * s]);
		const r2 = fitPagesInPage({...box, safetyPx: FIT_SAFETY_PX}) as FitResult;
		assert.equal(r2.fits, false);
		assert.equal(r2.scale, box.min);
		assert.equal(tooLong.frames[0].style.height, 'auto');
		// short content: capped at the maximum scale
		fakeDom([(s) => 100 * s]);
		assert.equal((fitPagesInPage({...box, safetyPx: FIT_SAFETY_PX}) as FitResult).scale, box.max);
		// a document without frames (the full edition) is left untouched
		fakeDom([]);
		assert.equal(fitPagesInPage({...box, safetyPx: FIT_SAFETY_PX}), null);
	} finally {
		delete (globalThis as Record<string, unknown>).document;
	}
});

test('page boxes and fit range', () => {
	assert.deepEqual(contentBoxPx('letter'), {widthPx: 672, heightPx: (11 - PAGE_MARGIN_IN.top - PAGE_MARGIN_IN.bottom) * 96});
	assert.ok(Math.abs(contentBoxPx('a4').widthPx - 6.77 * 96) < 1e-9);
	assert.ok(FREE_FIT.min < 1 && FREE_FIT.max > 1);
});

test('spot crops: the bust is a circle at the approved scale, and every expression spot uses it', () => {
	assert.equal(ZOO_BUST.w, ZOO_BUST.h);
	assert.equal(ZOO_BUST.radius, ZOO_BUST.w / 2);
	// the crop spans about two head heights (one head is about 170 of Zoo's 900 units, ART_GUIDE CH2): a crop, not an enlarged head
	assert.ok(ZOO_BUST.h > 2 * 170 && ZOO_BUST.h < 3 * 170);
	for (const id of ['approvals', 'address-poisoning', 'fake-jobs', 'exchanges']) assert.equal(spotById(id)?.frame, ZOO_BUST, id);
	const quick = spotById('quick-start');
	assert.deepEqual(quick?.characters.map((c) => c.kind), ['zoo', 'badger']);
	assert.ok(SPOTS.every((s) => !s.frame || s.characters.every((c) => c.kind === 'zoo')), 'only Zoo is cropped');
});
