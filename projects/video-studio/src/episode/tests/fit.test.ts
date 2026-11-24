/**
 * Text fitting. The core proof: Spanish and Brazilian Portuguese strings that are at least 35% longer than the English
 * ones fit every template's text boxes, in both formats, measured with the real bundled fonts (Anton, Montserrat,
 * Inter advance widths), using the exact fit and block-layout code the components run.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {fitGroup, fitText, prepText, wrapText, FEWER_LINES_TOLERANCE, type FitResult, type FitSpec, type Measure} from '../text/fit.ts';
import {CAPTION_PAD, CAPTIONS, FICTION_CARD, LAYOUTS, LOWER_THIRD, type Format, type TextSpec} from '../layout/specs.ts';
import {ctaBlock, hookBlock, placeBlock, quoteBlock, stackCards, stackRows, titleLineTops} from '../layout/blocks.ts';
import {buildPages} from '../captions/pages.ts';
import {latinFontFile, measureFromFont} from './fontMetrics.ts';

const fitSpec = (spec: TextSpec, box = spec.box): FitSpec => ({maxWidth: box.w, maxHeight: box.h, maxSize: spec.maxSize, minSize: spec.minSize, maxLines: spec.maxLines, lineHeight: spec.lineHeight, balance: spec.balance, ellipsis: spec.ellipsis});
/** The list fit the Talk and Steps components run (one shared size, shrunk until the block fits). */
const groupWith = (texts: string[], spec: TextSpec, lang: string, blockFits: (rs: FitResult[]) => boolean): FitResult[] =>
	fitGroup(
		texts.map((t) => prepText(t, spec, lang)),
		fitSpec(spec),
		measureFromFont(latinFontFile(spec.role, spec.weight)),
		blockFits,
	);
const fitWith = (text: string, spec: TextSpec, lang: string, box = spec.box): FitResult => {
	const m = measureFromFont(latinFontFile(spec.role, spec.weight));
	return fitText(
		prepText(text, spec, lang),
		{maxWidth: box.w, maxHeight: box.h, maxSize: spec.maxSize, minSize: spec.minSize, maxLines: spec.maxLines, lineHeight: spec.lineHeight, balance: spec.balance, ellipsis: spec.ellipsis},
		m,
	);
};

/** Every slot: English, and es / pt-br versions at least 35% longer (asserted below). */
const S = {
	kicker: {en: 'Case file 01', es: 'Expediente número 01', pt: 'Arquivo do caso nº 01'},
	hookTitle: {en: 'You become a top caller', es: 'Te conviertes en un caller famoso', pt: 'Você se torna um caller muito famoso'},
	subtitle: {
		en: 'A fictional story about a very real pattern.',
		es: 'Una historia completamente ficticia sobre un patrón muy, muy real.',
		pt: 'Uma história totalmente fictícia sobre um padrão muito, muito real.',
	},
	talkTitle: {en: 'How the call works', es: 'Cómo funciona de verdad la señal', pt: 'Como a call funciona de verdade'},
	bullets: {
		en: ['Buy early, quietly', 'Post the call', 'Followers buy the jump', 'You sell into them'],
		es: ['Compra temprano y en silencio', 'Publica la señal en tu canal', 'Tus seguidores compran el salto', 'Tú les vendes mientras compran'],
		pt: ['Compre cedo e em silêncio total', 'Poste a call no seu canal', 'Os seus seguidores compram a alta', 'Você vende enquanto eles compram'],
	},
	stepsTitle: {en: 'Before you follow a caller', es: 'Antes de seguir a cualquier caller famoso', pt: 'Antes de seguir qualquer caller famoso'},
	steps: {
		en: ['Check who bought before the post', 'Check how fast they sold', 'Never buy the screaming candle', 'Read the contract first', 'Size your position small'],
		es: [
			'Revisa quién compró justo antes de la publicación',
			'Revisa con qué rapidez vendieron todo',
			'Nunca compres la vela por la que todos gritan',
			'Lee primero el contrato completo',
			'Usa siempre una posición muy pequeña',
		],
		pt: [
			'Veja quem comprou logo antes da sua publicação',
			'Veja com que rapidez eles venderam tudo',
			'Nunca compre o candle que todo mundo grita',
			'Leia o contrato inteiro primeiro',
			'Use sempre uma posição bem pequena',
		],
	},
	quote: {
		en: 'Nobody checks the wallet. Everybody checks the chart.',
		es: 'Nadie se fija nunca en la billetera. Todo el mundo se fija en el gráfico.',
		pt: 'Ninguém nunca confere a carteira. Todo mundo só fica olhando para o gráfico.',
	},
	attribution: {en: 'a top caller (fictional composite)', es: 'un caller famoso (personaje ficticio compuesto)', pt: 'um caller famoso (personagem fictício composto)'},
	source: {en: 'Fictional dialogue · composite character', es: 'Diálogo ficticio · personaje compuesto a partir de varios', pt: 'Diálogo fictício · personagem composto a partir de vários'},
	ctaTitle: {en: 'One bad trade avoided is worth it', es: 'Evitar una sola mala operación ya vale la pena', pt: 'Evitar um único trade ruim já vale muito a pena'},
	button: {en: 'Subscribe', es: 'Suscríbete ahora', pt: 'Inscreva-se agora'},
	disclosure: {
		en: 'I built this checklist and it is my own product.',
		es: 'Aviso: yo creé esta lista de verificación y es mi propio producto.',
		pt: 'Aviso: eu criei esta lista de verificação e ela é o meu próprio produto.',
	},
	outro: {en: 'Next: you build an AI trading agent', es: 'Próximo: construyes tu propio agente de trading con IA', pt: 'Próximo: você cria o seu próprio agente de trading com IA'},
	fiction: {
		en: 'Fictional story · composite characters · not financial advice',
		es: 'Historia ficticia · personajes compuestos · esto no es asesoría financiera de ningún tipo',
		pt: 'História fictícia · personagens compostos · isto não é conselho financeiro de nenhum tipo',
	},
	chip: {en: 'Illustrative · fictional token', es: 'Ilustrativo · token completamente ficticio', pt: 'Ilustrativo · um token totalmente fictício'},
	role: {en: 'Host · Zoora AI', es: 'Presentador del canal · Zoora AI', pt: 'Apresentador do canal · Zoora AI'},
};
type Slot = {en: string | string[]; es: string | string[]; pt: string | string[]};
const LANGS = [
	['es', 'es'],
	['pt-br', 'pt'],
] as const;
const FORMATS: Format[] = ['landscape', 'vertical'];

test('every es / pt-br test string is at least 35% longer than its English source', () => {
	for (const [name, slot] of Object.entries(S) as Array<[string, Slot]>) {
		const en = ([] as string[]).concat(slot.en);
		for (const k of ['es', 'pt'] as const) {
			const tr = ([] as string[]).concat(slot[k]);
			en.forEach((e, i) => assert.ok(tr[i].length >= 1.35 * e.length, `${name}[${i}] ${k}: ${tr[i].length} chars vs ${e.length} (${(tr[i].length / e.length).toFixed(2)}x)`));
		}
	}
});

const ok = (r: FitResult, what: string, spec: TextSpec) => {
	assert.ok(!r.overflow, `${what}: overflows (${r.lines.length} lines at ${r.fontSize}px, ${Math.round(r.height)}px tall)`);
	assert.ok(r.fontSize >= spec.minSize && r.fontSize >= 24, `${what}: ${r.fontSize}px is under the floor`);
	assert.ok(!r.brokeWord, `${what}: a word had to be split`);
};

for (const format of FORMATS) {
	for (const [lang, k] of LANGS) {
		test(`${format} ${lang}: hook title block fits`, () => {
			const L = LAYOUTS.hook[format];
			const kf = fitWith(S.kicker[k], L.kicker, lang);
			const tf = fitWith(S.hookTitle[k], L.title, lang);
			ok(kf, 'kicker', L.kicker);
			ok(tf, 'title', L.title);
			const sf = L.subtitle ? fitWith(S.subtitle[k], L.subtitle, lang) : null;
			if (sf && L.subtitle) ok(sf, 'subtitle', L.subtitle);
			const title = titleLineTops(tf.lines, tf.fontSize, tf.fontSize * tf.lineHeight).height; // the render's height (accent room)
			const g = hookBlock(L.column, {kicker: L.kicker.box.h, title, subtitle: sf ? sf.height : 0});
			assert.ok(g.fits, `hook block ${g.height}px > column ${L.column.bottom - L.column.top}px`);
		});
		test(`${format} ${lang}: talk title + 4 bullets fit`, () => {
			const L = LAYOUTS.talk[format];
			const tf = fitWith(S.talkTitle[k], L.title, lang);
			ok(tf, 'title', L.title);
			const total = (rs: FitResult[]) =>
				stackCards(
					rs.map((r) => r.height),
					L.itemPad.y,
					L.gap,
				).total;
			const fits = groupWith(S.bullets[k], L.item, lang, (rs) => placeBlock(L.column, tf.height, total(rs)).fits);
			fits.forEach((r, i) => ok(r, `bullet ${i}`, L.item));
			assert.equal(new Set(fits.map((r) => r.fontSize)).size, 1, 'bullets share one size');
			const g = placeBlock(L.column, tf.height, total(fits));
			assert.ok(g.fits, `talk block ${g.height}px > column ${L.column.bottom - L.column.top}px`);
		});
		test(`${format} ${lang}: steps title + 5 steps fit`, () => {
			const L = LAYOUTS.steps[format];
			const tf = fitWith(S.stepsTitle[k], L.title, lang);
			ok(tf, 'title', L.title);
			const total = (rs: FitResult[]) =>
				stackRows(
					rs.map((r) => r.height),
					L.badge,
					L.gap,
				).total;
			const fits = groupWith(S.steps[k], L.item, lang, (rs) => placeBlock(L.column, tf.height, total(rs)).fits);
			fits.forEach((r, i) => ok(r, `step ${i}`, L.item));
			assert.equal(new Set(fits.map((r) => r.fontSize)).size, 1, 'steps share one size');
			const g = placeBlock(L.column, tf.height, total(fits));
			assert.ok(g.fits, `steps block ${g.height}px > column ${L.column.bottom - L.column.top}px`);
		});
		test(`${format} ${lang}: quote card fits`, () => {
			const L = LAYOUTS.quote[format];
			const q = fitWith(S.quote[k], L.quote, lang);
			const a = fitWith(`— ${S.attribution[k]}`, L.attribution, lang);
			const s = fitWith(S.source[k], L.source, lang);
			ok(q, 'quote', L.quote);
			ok(a, 'attribution', L.attribution);
			ok(s, 'source', L.source);
			const g = quoteBlock(L, {quote: q.height, attribution: a.height, source: s.height});
			assert.ok(g.fits, `quote card ${g.cardH}px > column ${L.column.bottom - L.column.top}px`);
		});
		test(`${format} ${lang}: CTA with an offer disclosure fits`, () => {
			const L = LAYOUTS.cta[format];
			const t = fitWith(S.ctaTitle[k], L.title, lang);
			const b = fitWith(S.button[k], L.buttonLabel, lang);
			const d = fitWith(S.disclosure[k], L.disclosure, lang);
			ok(t, 'title', L.title);
			ok(b, 'button', L.buttonLabel);
			ok(d, 'disclosure', L.disclosure);
			const g = ctaBlock(L, {title: t.height, disclosure: d.height});
			assert.ok(g.fits, `CTA block ${g.height}px > column ${L.column.bottom - L.column.top}px`);
		});
		test(`${format} ${lang}: end screen, fiction card, chart chip, lower third and captions fit`, () => {
			ok(fitWith(S.outro[k], LAYOUTS.endscreen[format].outro, lang), 'outro', LAYOUTS.endscreen[format].outro);
			ok(fitWith(S.fiction[k], FICTION_CARD[format], lang), 'fiction card', FICTION_CARD[format]);
			ok(fitWith(S.chip[k], LAYOUTS.chart[format].chip, lang), 'chart chip', LAYOUTS.chart[format].chip);
			const lt = LOWER_THIRD[format];
			if (lt) ok(fitWith(S.role[k], lt.role, lang), 'lower third role', lt.role);
			// captions: pages built from a long narration, each fitted to the caption plate
			const text = `${S.subtitle[k]} ${S.quote[k]} ${S.disclosure[k]}`;
			let t = 0;
			const words = text.split(' ').map((w) => {
				const out = {text: w, startMs: t, endMs: t + 300};
				t += 340;
				return out;
			});
			const spec = CAPTIONS[format];
			for (const p of buildPages(words, {lang})) {
				const r = fitWith(p.text, spec, lang, {...spec.box, w: spec.box.w - 2 * CAPTION_PAD.x});
				ok(r, `caption "${p.text}"`, spec);
			}
		});
	}
}

// ---------- unit behaviour of the fitter ----------
const mono: Measure = (s, size) => s.length * size * 0.6; // a monospace stand-in

test('fit: shrinks before wrapping, and wraps only at the floor', () => {
	const spec = {maxWidth: 600, maxHeight: 400, maxSize: 60, minSize: 30, maxLines: 1, lineHeight: 1.2};
	const r = fitText('twenty-two characters!', spec, mono); // 22 chars: 22*0.6*45 = 594 <= 600
	assert.equal(r.lines.length, 1);
	assert.equal(r.fontSize, 45);
	const long = fitText('this sentence is far too long for one line at thirty px', spec, mono);
	assert.equal(long.fontSize, 30);
	assert.ok(long.lines.length > 1 && long.wrappedPastPreferred && !long.overflow);
});

test('fit: prefers fewer lines when they cost little size', () => {
	const spec = {maxWidth: 600, maxHeight: 400, maxSize: 48, minSize: 24, maxLines: 2, lineHeight: 1.2};
	// 22 chars: one line needs <= 45 px (0.94 of 48), so one line at 45 wins over two lines at 48
	const r = fitText('twenty-two characters!', spec, mono);
	assert.equal(r.lines.length, 1);
	assert.ok(r.fontSize >= 48 * FEWER_LINES_TOLERANCE);
});

test('fit: balanced lines avoid a one-word last line', () => {
	const spec = {maxWidth: 400, maxHeight: 400, maxSize: 30, minSize: 30, maxLines: 3, lineHeight: 1.2, balance: true};
	const r = fitText('Check who bought before the post', spec, mono);
	assert.equal(r.lines.length, 2);
	assert.ok(r.lines.every((l) => l.split(' ').length >= 2), JSON.stringify(r.lines));
});

test('fit: overflow is reported, never hidden; ellipsis only when asked', () => {
	const spec = {maxWidth: 200, maxHeight: 40, maxSize: 30, minSize: 30, maxLines: 1, lineHeight: 1.2};
	const text = 'a source title that is much too long for its box';
	assert.ok(fitText(text, spec, mono).overflow);
	const e = fitText(text, {...spec, ellipsis: true}, mono);
	assert.ok(!e.overflow && e.truncated && e.lines.length === 1 && e.lines[0].endsWith('…'));
	assert.ok(mono(e.lines[0], 30) <= 200);
});

test('fit: unspaced (CJK) text breaks between characters, never before closing punctuation', () => {
	const w = wrapText('没人看钱包，人人都看图。', 5 * 30, 30, (s, size) => Array.from(s).length * size, true);
	assert.ok(w.lines.length >= 2);
	for (const l of w.lines.slice(1)) assert.ok(!/^[，。、]/.test(l), `line starts with punctuation: ${l}`);
});

test('fit: unspaced text keeps the real spaces of embedded Latin words and breaks between dictionary words', () => {
	const w = wrapText('来源: Example source (dev fixture) · example.com', 5000, 30, mono, true, 'zh');
	assert.equal(w.lines.join(''), '来源: Example source (dev fixture) · example.com');
	const narrow = wrapText('如果这帮你躲过了一次糟糕的交易，请订阅。', 9 * 30 * 0.6, 30, mono, true, 'zh');
	assert.ok(narrow.lines.length > 1);
	for (const l of narrow.lines) assert.ok(!/^[，。]/.test(l), l);
	assert.ok(!narrow.lines.some((l, i) => i > 0 && l.startsWith('易')), 'does not split 交易');
});

test('fit: zero-width spaces mark the only CJK break points (for compounds the dictionary does not know)', () => {
	const w = wrapText('你成了​顶级喊单人', 5 * 30, 30, (s, size) => Array.from(s).length * size, true, 'zh');
	assert.deepEqual(w.lines, ['你成了', '顶级喊单人']);
	assert.ok(!w.lines.join('').includes('​'));
});
