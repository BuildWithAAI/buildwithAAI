import assert from 'node:assert/strict';
import {describe, test} from 'node:test';
import {checkSegment, compareAll} from '../lib/compare.ts';
import {buildReport, renderMarkdown} from '../lib/report.ts';
import {back, check, codes, ctx, glossary, has, seg} from './helpers.ts';

describe('a faithful translation', () => {
	test('a literal back-translation of a correct translation raises nothing above low', () => {
		const r = check(
			'You post one chart. Ten thousand strangers buy your coin within the hour.',
			'Publicas un solo gráfico. Diez mil desconocidos compran tu moneda en menos de una hora.',
			'You publish a single chart. Ten thousand strangers buy your coin in less than an hour.',
		);
		assert.deepEqual(codes(r, 'medium'), []);
		assert.ok((r.similarity ?? 0) >= 0.9);
	});
});

describe('numbers', () => {
	test('a shifted number is high, confirmed by the translation itself', () => {
		const r = check('Ten thousand strangers bought.', 'Cien mil desconocidos compraron.', 'One hundred thousand strangers bought.');
		assert.ok(has(r, 'number-changed', 'high'));
		assert.match(r.findings[0].message, /10,000.*100,000/);
	});
	test('a number right in the Spanish but wrong in the back-translation is a medium "slip"', () => {
		const r = check('Ten thousand strangers bought.', 'Diez mil desconocidos compraron.', 'One hundred thousand strangers bought.');
		assert.ok(has(r, 'number-back-mismatch', 'medium'));
		assert.ok(!has(r, 'number-changed'));
	});
	test('the currency dropped is medium; "more than" flipped to "less than" is high', () => {
		assert.ok(has(check('Attackers took $4.2M.', 'Los atacantes se llevaron 4,2 millones.', 'The attackers took 4.2 million.'), 'number-unit-dropped', 'medium'));
		assert.ok(has(check('More than 10 wallets were hit.', 'Menos de 10 billeteras fueron afectadas.', 'Less than 10 wallets were affected.'), 'number-qualifier-flipped', 'high'));
	});
	test('"billón" for an English billion is caught and explained', () => {
		const r = check('Hackers stole $1 billion.', 'Los hackers robaron un billón de dólares.', 'The hackers stole one trillion dollars.');
		const f = r.findings.find((x) => x.code === 'number-changed');
		assert.equal(f?.severity, 'high');
		assert.match(f?.message ?? '', /billón.*mil millones/);
	});
	test('English digit style in Portuguese is high when a reader would misread it; "$" alone in Spanish is low', () => {
		assert.ok(has(check('Over 1,500 wallets', 'Mais de 1,500 carteiras', 'More than 1,500 wallets', 'pt-br'), 'number-format', 'high'));
		assert.ok(has(check('The price hit $40,000.', 'El precio llegó a $40.000.', 'The price reached $40,000.'), 'currency-symbol', 'low'));
	});
	test('"day two" and "the second day" are the same number', () => {
		assert.deepEqual(codes(check('Most coins never see day two.', 'La mayoría nunca llega al segundo día.', 'Most never reach the second day.'), 'medium'), []);
	});
});

describe('negation', () => {
	test('a lost negation is high', () => {
		const r = check('And never buy the candle everyone is screaming about.', 'Y compra la vela de la que todos gritan.', 'And buy the candle that everyone shouts about.');
		assert.ok(has(r, 'negation-lost', 'high'));
	});
	test('a negation the Spanish still has is a medium back-translation slip', () => {
		const r = check('Never share it.', 'Nunca la compartas.', 'Share it.');
		assert.ok(has(r, 'negation-lost', 'medium'));
	});
	test('"never" to "avoid" in an instruction is high; in a statement, "never" to "not" is medium', () => {
		assert.ok(has(check('Never buy the screaming candle.', 'Evite comprar o candle que todos gritam.', 'Avoid buying the candle that everyone shouts.', 'pt-br'), 'never-softened', 'high'));
		assert.ok(has(check('Real support never asks for it.', 'El soporte real no la pide.', 'The real support does not ask for it.'), 'never-softened', 'medium'));
	});
	test('"never" to "without" keeps the absolute sense: low', () => {
		const r = check('NEVER SEE DAY TWO', 'SIN SEGUNDO DÍA', 'WITHOUT A SECOND DAY', 'es', 'thumbnail');
		assert.deepEqual(codes(r, 'medium'), []);
		assert.ok(has(r, 'negation-rephrased', 'low'));
	});
	test('"so you don\'t have to" may come back as "for you"; "so you have to" is still an inversion', () => {
		assert.deepEqual(codes(check('Badger will keep judging the links, so you don\'t have to.', 'Badger seguirá juzgando los enlaces por ti.', 'Badger will keep judging the links for you.'), 'medium'), []);
		assert.ok(has(check('Badger judges the links so you don\'t have to.', 'Badger juzga los enlaces para que tengas que hacerlo.', 'Badger judges the links so that you have to do it.'), 'negation-lost', 'high'));
	});
	test('"hates" vs "doesn\'t like" is a rephrasing, not a lost negation', () => {
		const r = check('Badger already hates this.', 'A Badger ya no le gusta nada.', "Badger already doesn't like it at all.");
		assert.ok(has(r, 'negation-rephrased', 'low'));
		assert.ok(!has(r, 'negation-added'));
	});
});

describe('modality', () => {
	test('"may change" to "are going to change" is high', () => {
		assert.ok(has(check('The figures may change.', 'Las cifras van a cambiar.', 'The figures are going to change.'), 'modality-hardened', 'high'));
	});
	test('"may" dropped is high', () => {
		assert.ok(has(check('The funds may be frozen.', 'Los fondos están congelados.', 'The funds are frozen.'), 'possibility-lost', 'high'));
	});
	test('"must" to "can" is high; "must" to "should" is medium', () => {
		assert.ok(has(check('You must revoke the approval.', 'Puedes revocar la aprobación.', 'You can revoke the approval.'), 'warning-softened', 'high'));
		assert.ok(has(check('You must revoke the approval.', 'Deberías revocar la aprobación.', 'You should revoke the approval.'), 'warning-softened', 'medium'));
	});
	test('an instruction made optional is medium (high when it is a warning)', () => {
		assert.ok(has(check('Check who bought before the post.', 'Podrías revisar quién compró antes.', 'You could check who bought before.'), 'instruction-softened', 'medium'));
		assert.ok(has(check("Don't share your recovery phrase.", 'Quizás no compartas tu frase de recuperación.', "Maybe don't share your recovery phrase."), 'instruction-softened', 'high'));
	});
	test('"guaranteed" added is medium', () => {
		assert.ok(has(check('The fix works.', 'La solución funciona, garantizado.', 'The solution works, guaranteed.'), 'certainty-added', 'medium'));
	});
});

describe('hedges and attribution', () => {
	test('"allegedly" lost is high', () => {
		const r = check('The founder allegedly sold first.', 'El fundador vendió primero.', 'The founder sold first.');
		assert.ok(has(r, 'hedge-lost', 'high'));
		assert.match(r.findings.find((f) => f.code === 'hedge-lost')?.message ?? '', /allegedly/);
	});
	test('"according to" lost is high; the Spanish still saying "según" makes it a medium slip', () => {
		assert.ok(has(check('According to FixtureSwap, the key leaked.', 'La clave se filtró.', 'The key leaked.'), 'attribution-lost', 'high'));
		assert.ok(has(check('According to FixtureSwap, the key leaked.', 'Según FixtureSwap, la clave se filtró.', 'FixtureSwap: the key leaked.'), 'attribution-lost', 'medium'));
	});
	test('"preliminary" lost is high; a hedge added is low', () => {
		assert.ok(has(check('A preliminary review found a leaked key.', 'Una revisión encontró una clave filtrada.', 'A review found a leaked key.'), 'hedge-lost', 'high'));
		assert.ok(has(check('A review found a leaked key.', 'Una revisión preliminar encontró una clave filtrada.', 'A preliminary review found a leaked key.'), 'hedge-added', 'low'));
	});
});

describe('names, tags, voice and sentences', () => {
	test('a swapped organisation is high; a dropped one medium; an added one medium', () => {
		assert.ok(has(check('CoinGecko tracked them.', 'CoinMarketCap las rastreó.', 'CoinMarketCap tracked them.'), 'entity-swapped', 'high'));
		assert.ok(has(check('CoinGecko tracked them.', 'Una empresa las rastreó.', 'A company tracked them.'), 'entity-missing', 'medium'));
		assert.ok(has(check('A firm tracked them.', 'Binance las rastreó.', 'Binance tracked them.'), 'entity-added', 'medium'));
	});
	test('[src] tags: missing is high, extra medium, moved medium', () => {
		assert.ok(has(check('They sell. [src:a]', 'Venden.', 'They sell.'), 'claim-tag-missing', 'high'));
		assert.ok(has(check('They sell.', 'Venden. [src:a]', 'They sell. [src:a]'), 'claim-tag-extra', 'medium'));
		assert.ok(has(check('One claim [src:a]. Another claim.', 'Una afirmación. Otra afirmación [src:a].', 'One claim. Another claim [src:a].'), 'claim-tag-moved', 'medium'));
	});
	test('the voice must say the English spoken number; rounding the English does on purpose is fine', () => {
		const ok = check('CoinGecko tracked {18.67 million|nearly nineteen million} of them.', '{CoinGecko|Coin Guecko} rastreó {18,67 millones|casi diecinueve millones} de ellas.', 'CoinGecko tracked 18.67 million of them.');
		assert.deepEqual(codes(ok, 'medium'), []);
		assert.ok(has(ok, 'voice-respelling', 'info'));
		const bad = check('They took {$4.2M|four point two million dollars}.', 'Se llevaron {US$ 4,2 millones|cuarenta y dos millones de dólares}.', 'They took US$ 4.2 million.');
		assert.ok(has(bad, 'spoken-number-changed', 'high'));
	});
	test('a dropped sentence is high, an added one medium', () => {
		assert.ok(
			has(
				check('Do three things. Check who bought. Check how fast they sold. Never chase.', 'Haz tres cosas. Revisa quién compró. Nunca persigas.', 'Do three things. Check who bought. Never chase.'),
				'sentence-missing',
				'high',
			),
		);
		assert.ok(has(check('Subscribe.', 'Suscríbete. Badger también vende cursos.', 'Subscribe. Badger also sells courses.'), 'sentence-added', 'medium'));
	});
	test('a back-translation left in Spanish is refused as a check', () => {
		const r = check('You post one chart today.', 'Publicas un solo gráfico hoy.', 'Publicas un solo gráfico hoy, de la mejor manera.');
		assert.ok(has(r, 'back-not-english', 'high'));
	});
	test('an unrelated back-translation scores low', () => {
		const r = check('Check who bought before the post and how fast they sold.', 'Revisa quién compró.', 'The weather is lovely in the mountains this spring.');
		assert.ok(has(r, 'low-similarity', 'high'));
	});
});

describe('episode-level behaviour', () => {
	test('statuses: no back-translation, stale back-translation, missing translation', () => {
		const s = seg('They sell.', 'Venden.');
		assert.equal(checkSegment(s, null, ctx()).status, 'no-back-translation');
		assert.equal(checkSegment(s, {...back(s, 'They sell.'), hash: '0000000000000000'}, ctx()).status, 'stale-back-translation');
		const missing = {...seg('TOP CALLER?', ''), translationRaw: null, translation: null, hash: null, kind: 'thumbnail' as const};
		const r = checkSegment(missing, null, ctx());
		assert.equal(r.status, 'missing-translation');
		assert.equal(r.findings[0].severity, 'medium');
	});
	test('direct checks still run without a back-translation (a shifted number is visible before anyone back-translates)', () => {
		const s = seg('Ten thousand strangers bought.', 'Cien mil desconocidos compraron.');
		assert.ok(has(checkSegment(s, null, ctx()), 'number-changed', 'high'));
	});
	test('verdicts and ranking: FIX first, the report lists the riskiest segment first and has the rubric', () => {
		const a = seg('They sell.', 'Venden.', {id: 'a.narration'});
		const b = seg('Ten thousand strangers bought.', 'Cien mil desconocidos compraron.', {id: 'b.narration'});
		const record = {kind: 'backtranslation' as const, version: 1 as const, channel: 't', slug: 't', lang: 'es' as const, segments: {[a.id]: back(a, 'They sell.'), [b.id]: back(b, 'One hundred thousand strangers bought.')}};
		const {results, notes} = compareAll([a, b], record, 'es', glossary);
		const report = buildReport({channel: 't', slug: 't', lang: 'es', generatedAt: 'now', results, notes, translationStatus: 'machine', glossaryFiles: []});
		assert.equal(report.verdict, 'FIX');
		assert.equal(report.segments[0].id, 'b.narration');
		const md = renderMarkdown(report);
		assert.match(md, /Verdict: FIX/);
		assert.match(md, /Rubric for the native reviewer/);
		assert.match(md, /\| 1 \| `b\.narration` \|/);
		const clear = compareAll([a], {...record, segments: {[a.id]: back(a, 'They sell.')}}, 'es', glossary);
		assert.equal(buildReport({channel: 't', slug: 't', lang: 'es', generatedAt: 'now', results: clear.results, notes: [], translationStatus: 'machine', glossaryFiles: []}).verdict, 'CLEAR');
		const none = compareAll([a], null, 'es', glossary);
		assert.equal(buildReport({channel: 't', slug: 't', lang: 'es', generatedAt: 'now', results: none.results, notes: [], translationStatus: 'machine', glossaryFiles: []}).verdict, 'INCOMPLETE');
	});
	test('a back-translation that copies the English word for word in most lines gets a note', () => {
		const lines = ['The first long sentence is right here today.', 'The second long sentence is right here today.', 'The third long sentence is right here today.'];
		const segs = lines.map((l, i) => seg(l, `Frase número ${i} bastante larga aquí hoy.`, {id: `s${i}.narration`}));
		const record = {kind: 'backtranslation' as const, version: 1 as const, channel: 't', slug: 't', lang: 'es' as const, segments: Object.fromEntries(segs.map((s, i) => [s.id, back(s, lines[i])]))};
		assert.match(compareAll(segs, record, 'es', glossary).notes.join(' '), /repeat the English word for word/);
	});
});
