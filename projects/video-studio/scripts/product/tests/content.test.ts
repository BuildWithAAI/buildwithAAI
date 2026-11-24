/**
 * The shipped content itself: both editions parse and lint clean, every citation resolves, the sources file is
 * valid, the marketing copy matches the product (counts of checks and chapters), and the spot catalog is sound.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {loadProduct, validateProduct} from '../build.ts';
import {parseDocument, structure, walkBlocks} from '../lib/markdown.ts';
import {lintCopy} from '../lib/lint.ts';
import {CitationRegistry, formatDate, validateSources, type SourceFile} from '../lib/sources.ts';
import {checkSpotSvg} from '../lib/svg-check.ts';
import {lineScaleForPrint, OUTLINE_PT, RIG_OUTLINE_UNITS, SPOTS, validateCatalog} from '../spots/catalog.ts';
import {decodeSpotChunk, encodeSpotChunks, SpotAssembler} from '../spots/protocol.ts';

const DIR = join(import.meta.dirname, '..', '..', '..', 'content', 'products', 'crypto-security-checklist');
const read = (f: string) => readFileSync(join(DIR, f), 'utf8');

test('both editions and the copy load with zero lint errors and zero warnings', () => {
	const {findings} = loadProduct('crypto-security-checklist', ['free', 'full']);
	const all = findings.flatMap((f) => f.findings.map((x) => `${f.file}:${x.line} [${x.rule}] ${x.message}`));
	assert.deepEqual(all, []);
});

test('sources.json is valid and every source is cited somewhere', () => {
	const s = JSON.parse(read('sources.json')) as SourceFile;
	assert.deepEqual(validateSources(s), []);
	const used = new Set([...read('free.md').matchAll(/@([a-z0-9-]+)/g), ...read('full.md').matchAll(/@([a-z0-9-]+)/g)].map((m) => m[1]));
	assert.deepEqual(
		s.sources.map((x) => x.id).filter((id) => !used.has(id)),
		[],
	);
});

test('free edition: two pages of checks; the landing page counts them correctly', () => {
	const st = structure(parseDocument(read('free.md')));
	const checks = st.preamble.filter((b) => b.type === 'checklist').reduce((n, b) => n + (b as {items: unknown[]}).items.length, 0);
	assert.equal(checks, 18);
	assert.match(read('landing.md'), /Eighteen checks/);
	const redflags = st.preamble.find((b) => b.type === 'fence' && b.kind === 'redflag');
	assert.ok(redflags);
	const phrases = [...walkBlocks([redflags])].find((b) => b.type === 'bullets') as {items: unknown[]};
	assert.equal(phrases.items.length, 6);
	assert.match(read('landing.md'), /six phrases/);
});

test('full edition: twelve chapters, each closing with a red flag and a fix; the copy agrees', () => {
	const st = structure(parseDocument(read('full.md')));
	const chapters = st.sections.filter((s) => s.kind === 'chapter');
	assert.equal(chapters.length, 12);
	for (const c of chapters) {
		const fences = c.blocks.filter((b) => b.type === 'fence').map((b) => (b as {kind: string}).kind);
		assert.deepEqual(fences.slice(-2), ['redflag', 'fix'], c.title);
		assert.ok(c.spot, `${c.title} has a spot illustration`);
		assert.ok(c.values.toc, `${c.title} has a contents summary`);
	}
	assert.equal(st.sections.filter((s) => s.kind === 'appendix').length, 3);
	assert.match(read('landing.md'), /Twelve chapters/);
	assert.match(read('kit-flow.md'), /twelve chapters/);
	// the host is "Zoo", never "ZOO", anywhere in the product folder
	for (const f of ['free.md', 'full.md', 'landing.md', 'kit-flow.md', 'product.json', 'sources.json']) assert.ok(!/\bZOO\b/.test(read(f)), f);
});

test('marketing copy promises nothing and cites its figures', () => {
	const knownIds = new Set((JSON.parse(read('sources.json')) as SourceFile).sources.map((s) => s.id));
	assert.deepEqual(lintCopy(read('landing.md'), {knownIds}), []);
	assert.deepEqual(lintCopy(read('kit-flow.md'), {knownIds}), []);
	// the safety line appears on the signup page and in every email template
	assert.match(read('landing.md'), /never ask for your seed phrase/);
	assert.ok((read('kit-flow.md').match(/never ask for your seed phrase/g) ?? []).length >= 3);
	// the paid edition is disclosed as our own product
	assert.match(read('landing.md'), /This is our own product, and we earn money when you buy it/);
	assert.match(read('kit-flow.md'), /This is our own product, and we earn money if you buy it/);
});

test('citation registry numbers by first use', () => {
	const s = JSON.parse(read('sources.json')) as SourceFile;
	const r = new CitationRegistry(s.sources);
	assert.equal(r.number('ftc-crypto-scams'), 1);
	assert.equal(r.number('cisa-mfa-2022'), 2);
	assert.equal(r.number('ftc-crypto-scams'), 1);
	r.number('nope');
	assert.deepEqual([...r.missing], ['nope']);
	assert.deepEqual(
		r.cited().map((c) => c.n),
		[1, 2],
	);
	assert.equal(formatDate('2024-12-03'), '3 December 2024');
	assert.equal(formatDate('2025-07'), 'July 2025');
	assert.equal(formatDate('n.d.'), 'undated');
	assert.match(validateSources({version: 1, checked: 'x', sources: [{id: 'Bad Id', url: 'http://x'}]}).join('\n'), /checked must be|lowercase slug|https/);
});

test('spot catalog, print line weights and the console protocol', () => {
	assert.deepEqual(validateCatalog(SPOTS), []);
	assert.match(validateCatalog([{id: 'Bad', alt: 'ZOO waves', heightPt: 0, characters: []}]).join('\n'), /slug.*heightPt.*no characters.*ZOO/s);
	// every spot gets the same printed outline: 3.5 units x lineScale x pt-per-unit = OUTLINE_PT
	for (const k of [0.1, 0.18, 0.4]) assert.ok(Math.abs(RIG_OUTLINE_UNITS * lineScaleForPrint(k) * k - OUTLINE_PT) < 1e-12);
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10" height="10"><title>t</title>${'x'.repeat(120_000)}</svg>`;
	const lines = encodeSpotChunks('cover-pair', svg);
	assert.equal(lines.length, 3);
	const asm = new SpotAssembler();
	let got: string | null = null;
	for (const l of [lines[2], `noise ${lines[0]}`, lines[1]]) got = asm.add(decodeSpotChunk(l) as never) ?? got;
	assert.equal(got, svg);
	assert.equal(decodeSpotChunk('[other] x 1/1 y'), null);
	assert.equal(decodeSpotChunk('[product-spot] x 3/2 y'), null);
});

test('spot SVG static checks catch the banned constructs', () => {
	const ok = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -2 30 40" width="30" height="40" role="img"><title>Zoo</title><path d="M0 0"/></svg>';
	assert.deepEqual(checkSpotSvg(ok), []);
	const bad = ok.replace('<path d="M0 0"/>', '<linearGradient/><path filter="url(#f)" fill-opacity="0.5" fill="rgba(0,0,0,0.3)"/><image href="x.png"/>');
	const problems = checkSpotSvg(bad).join('\n');
	for (const re of [/gradient/, /filter/, /opacity tint/, /raster image/]) assert.match(problems, re);
	assert.match(checkSpotSvg('<svg viewBox="0 0 1 1"></svg>').join('\n'), /namespace.*width\/height.*title/s);
});

test('product.json: the owner-edited fields are checked before anything is printed', () => {
	const p = JSON.parse(read('product.json'));
	assert.deepEqual(validateProduct(p), []);
	assert.deepEqual(validateProduct({...p, contact: 'corrections@zoora.example.org', fullEditionUrl: 'https://go.zoora.ai/go/checklist?s=pdf'}), []);
	assert.match(validateProduct({...p, contact: 'not an email'}).join(), /contact must be/);
	assert.match(validateProduct({...p, contact: 'a@b.co"><script>'}).join(), /contact must be/);
	for (const bad of ['http://go.zoora.ai/go/checklist', 'javascript:alert(1)', 'go.zoora.ai/go/checklist', 42]) {
		assert.match(validateProduct({...p, fullEditionUrl: bad}).join(), /fullEditionUrl must be/, String(bad));
	}
	assert.match(validateProduct({...p, editions: {...p.editions, full: {...p.editions.full, maxPages: 3}}}).join(), /editions\.full/);
});
