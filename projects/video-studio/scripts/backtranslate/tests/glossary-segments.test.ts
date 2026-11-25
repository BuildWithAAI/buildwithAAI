import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, test} from 'node:test';
import {glossaryFindings, GlossaryError, loadGlossary, parseGlossary} from '../lib/glossary.ts';
import {copyBlocks, InputError, loadStoryboards, resolveTarget} from '../lib/load.ts';
import {copySegments, narrationView, storyboardSegments} from '../lib/segments.ts';

const g = loadGlossary();
const codes = (src: string, tr: string, lang: 'es' | 'pt-br' = 'es') => glossaryFindings(g, lang, src, tr).map((f) => `${f.severity}:${f.code}`);

describe('glossary', () => {
	test('a name translated as a common noun is high; a dropped name is medium', () => {
		assert.deepEqual(codes('Badger watches the charts.', 'El tejón vigila los gráficos.'), ['high:glossary-wrong-rendering']);
		assert.deepEqual(codes('Badger watches the charts.', 'O texugo vigia os gráficos.', 'pt-br'), ['high:glossary-wrong-rendering']);
		assert.deepEqual(codes('Bubblemaps warned.', 'Los mapas de burbujas advirtieron.'), ['medium:glossary-name-changed']);
		assert.deepEqual(codes('Badger watches the charts.', 'Badger vigila los gráficos.'), []);
	});
	test('accepted renderings are gender, number and accent tolerant', () => {
		assert.deepEqual(codes('Fictional story · composite characters · not financial advice', 'Historia ficticia · personajes compuestos · no es asesoría financiera'), []);
		assert.deepEqual(codes('Never type your recovery phrase.', 'Nunca escribas tu frase semilla.'), []);
		assert.deepEqual(codes('An AI trading agent', 'Un agente de trading con IA'), []);
	});
	test('a proposed term missing is low; an approved one is medium', () => {
		assert.deepEqual(codes('Scam of the Week', 'El fraude semanal'), ['low:glossary-term-missing']);
		assert.deepEqual(codes('A fictional story', 'Una historia real'), ['medium:glossary-term-missing']);
	});
	test('the owner\'s naming rule: "ZOO" is flagged, also when the English has it', () => {
		const f = glossaryFindings(g, 'es', 'ZOO', 'ZOO');
		assert.equal(f[0].code, 'glossary-forbidden-spelling');
		assert.match(f[0].message, /fix the source first/);
		assert.deepEqual(codes('Zoo', 'Zoo'), []);
	});
	test('the channel 2 name stays as written; "Zoo" does not fire inside "Zoodger"', () => {
		assert.deepEqual(codes('Subscribe to Zoodger News.', 'Suscríbete a Zoodger News.'), []);
		assert.deepEqual(codes('Subscribe to Zoodger News.', 'Suscríbete a Noticias Zoodger.'), ['high:glossary-wrong-rendering']);
		assert.deepEqual(codes('Subscribe to Zoodger News.', 'Inscreva-se no Notícias Zoodger.', 'pt-br'), ['high:glossary-wrong-rendering']);
	});
	test('a bad glossary file is refused with its position', () => {
		assert.throws(() => parseGlossary({terms: [{id: 'x', en: 'y', status: 'approved'}]}, 'g.json'), /terms\[0\] \(x\): give dnt/);
		assert.throws(() => parseGlossary({terms: [{id: 'x', en: 'y', dnt: true, status: 'maybe'}]}, 'g.json'), GlossaryError);
		assert.throws(() => parseGlossary({nope: 1}, 'g.json'), /expected \{"terms"/);
	});
	test('an extra glossary file adds and overrides terms by id', () => {
		const dir = mkdtempSync(join(tmpdir(), 'bt-gloss-'));
		const f = join(dir, 'extra.json');
		writeFileSync(f, JSON.stringify({terms: [{id: 'badger', en: 'Badger', dnt: true, status: 'approved'}, {id: 'rekt', en: 'rekt', es: ['rekt'], status: 'approved'}]}));
		const gg = loadGlossary([f]);
		assert.equal(gg.terms.filter((t) => t.id === 'badger').length, 1);
		assert.ok(gg.terms.some((t) => t.id === 'rekt'));
		assert.equal(gg.files.length, 2);
	});
});

describe('segments', () => {
	test('narrationView keeps the display side and the tags, and lists the pairs', () => {
		const v = narrationView('One leaked key. {$4.2M|Four point two million dollars} gone, according to FixtureSwap [src:src-wire]. Good morning.');
		assert.equal(v.display, 'One leaked key. $4.2M gone, according to FixtureSwap[src:src-wire]. Good morning.'.replace('FixtureSwap[', 'FixtureSwap ['));
		assert.deepEqual(v.tags, ['src-wire']);
		assert.deepEqual(v.pairs, [{display: '$4.2M', spoken: 'Four point two million dollars'}]);
		assert.equal(narrationView('Claim. [src:a,b]').display, 'Claim. [src:a,b]');
		assert.ok(narrationView('broken {markup').error);
	});
	test('the engine demo: every narration and on-screen string, cues excluded, missing thumbnails kept as gaps', async () => {
		const t = resolveTarget('_dev/engine-demo', 'es');
		assert.equal(t.kind, 'storyboard');
		if (t.kind !== 'storyboard') return;
		const {source, translation} = loadStoryboards(t, 'es');
		const {segments} = await storyboardSegments(source, translation, 'es');
		const ids = segments.map((s) => s.id);
		assert.ok(ids.includes('s02.onScreen.bullets.3'));
		assert.ok(ids.includes('s02.onScreen.lowerThird.1'));
		assert.ok(ids.includes('ui.fictionDisclaimer'));
		assert.ok(!ids.some((id) => id.includes('.cues')));
		const thumb = segments.find((s) => s.id === 'thumbnails.a.text');
		assert.equal(thumb?.translationRaw, null);
		assert.equal(thumb?.hash, null);
		const ui = segments.find((s) => s.id === 'ui.sources');
		assert.deepEqual([ui?.source, ui?.sourceIsDefault], ['Source', true]);
		assert.equal(new Set(segments.map((s) => s.hash).filter(Boolean)).size, segments.filter((s) => s.hash).length);
	});
	test('show storyboards: the DEVELOPING label and diagram labels are segments', async () => {
		const t = resolveTarget('scripts/backtranslate/proof/show-excerpt', 'es');
		if (t.kind !== 'storyboard') throw new Error('not a storyboard');
		const {source, translation} = loadStoryboards(t, 'es');
		const {segments} = await storyboardSegments(source, translation, 'es');
		const ids = segments.map((s) => s.id);
		assert.ok(ids.includes('news.developing'));
		assert.ok(ids.includes('s03.onScreen.nodes.3'));
		assert.ok(ids.includes('s02.onScreen.developing'));
	});
	test('channel copy: blocks with an <id>-<lang> twin, split into paragraphs', () => {
		const dir = mkdtempSync(join(tmpdir(), 'bt-copy-'));
		const f = join(dir, 'channel-copy.md');
		writeFileSync(f, '# Copy\n\n```text id=description\nFirst para.\n\nSecond para.\n```\n\n```text id=keywords\na, b\n```\n\n```text id=description-es\nPrimer párrafo.\n\nSegundo párrafo.\n```\n');
		assert.deepEqual([...copyBlocks('```text id=x\nA\n```').entries()], [['x', 'A']]);
		const t = resolveTarget(f, 'es');
		if (t.kind !== 'copy') throw new Error('not copy');
		const {segments, notes} = copySegments(t, 'es');
		assert.deepEqual(segments.map((s) => [s.id, s.translation]), [
			['copy.description.p1', 'Primer párrafo.'],
			['copy.description.p2', 'Segundo párrafo.'],
		]);
		assert.match(notes[0], /keywords.*no es translation/);
	});
	test('bad targets and languages are input errors', () => {
		assert.throws(() => resolveTarget('nope/nothing', 'es'), InputError);
		const t = resolveTarget('_dev/engine-demo', 'es');
		if (t.kind !== 'storyboard') return;
		assert.throws(() => loadStoryboards({...t, translationPath: join(t.dir, 'storyboard.xx.json')}, 'es'), /no .*storyboard\.xx\.json.*this episode has: es, pt-br/);
	});
});
