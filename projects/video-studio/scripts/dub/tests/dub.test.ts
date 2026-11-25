/**
 * Dubbing tools tests (node:test). Run from projects/video-studio:
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/dub/tests/dub.test.ts
 * Fixtures: tests/fixtures/zoora-test/dub-demo/ (an English master and a good Spanish translation made with
 * prepare -> translate -> import) and tests/fixtures/broken-es/*.json (the same translation with one planted defect each).
 */
import test, {describe} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Lang, Storyboard} from '../../../src/episode/types.ts';
import {validateStoryboard} from '../../../src/episode/validate.ts';
import {FICTION_CARD, LAYOUTS, LOWER_THIRD} from '../../../src/episode/layout/specs.ts';
import {EMPTY_NAMES} from '../../claims/lib/names.ts';
import {applySheet} from '../lib/apply.ts';
import {checkFit, FIELD_SPECS, type FitBox} from '../lib/budgets.ts';
import {buildGlossary, termsIn} from '../lib/glossary.ts';
import {compareQuantities, extractQuantities, parseCjkNumeral, parseNum} from '../lib/numbers.ts';
import {allTexts, buildSheet, seedFromTarget} from '../lib/sheet.ts';
import {EN_ONES, ES_UNITS, HI_0_99, IT_UNITS, PT_UNITS, wordQuantities} from '../lib/numwords.ts';
import {parseMustNotSay} from '../../claims/lib/mustnotsay.ts';
import {validateDub, type EngineCheck} from '../lib/validate.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const FIX = join(HERE, 'fixtures');
const DEMO = join(FIX, 'zoora-test', 'dub-demo');
const BROKEN = join(FIX, 'broken-es');
const STUDIO = join(HERE, '..', '..', '..');
const read = (p: string): Storyboard => JSON.parse(readFileSync(p, 'utf8')) as Storyboard;
const master = read(join(DEMO, 'storyboard.json'));
const goodEs = read(join(DEMO, 'storyboard.es.json'));
const engine: EngineCheck = (sb, short, shortId) => validateStoryboard(sb, {channel: sb.channel, slug: sb.slug, lang: sb.lang, short, shortId});
const check = (tgt: Storyboard, lang: Lang = 'es') => validateDub({src: master, tgt, lang, names: EMPTY_NAMES, sourceFile: 'storyboard.json', targetFile: `storyboard.${lang}.json`, engine, now: '2026-11-24T12:00:00Z'});
const errorRules = (r: ReturnType<typeof check>) => r.findings.filter((f) => f.level === 'error').map((f) => f.rule);

describe('numbers (read the way the voice step reads them)', () => {
	test('parseNum mirrors scripts/voice/voicelib/normalize/common.py parse_num', () => {
		assert.deepEqual(parseNum('40,000', '.'), ['40000', null]);
		assert.deepEqual(parseNum('40,000', ','), ['40000', null]); // English-style in a comma-decimal language
		assert.deepEqual(parseNum('40.000', ','), ['40000', null]);
		assert.deepEqual(parseNum('1,234', ','), ['1', '234']); // 1.234 in es/it/pt-br
		assert.deepEqual(parseNum('1,234', '.'), ['1234', null]);
		assert.deepEqual(parseNum('68.67', ','), ['68', '67']);
		assert.deepEqual(parseNum('0,25', '.'), ['0', '25']);
		assert.deepEqual(parseNum('1,00,000', '.'), ['100000', null]); // Indian grouping
		assert.deepEqual(parseNum('1.234,56', ','), ['1234', '56']);
		assert.equal(parseNum('1.2.3', '.'), null);
	});
	const values = (t: string, lang: Lang) => extractQuantities(t, lang).map((q) => `${q.value}${q.pct ? '%' : ''}`).sort();
	const sorted = (xs: string[]) => [...xs].sort();
	test('scales, percent words, Devanagari digits, CJK numerals', () => {
		assert.deepEqual(values('$1.5 million and $2B and 68.67%', 'en'), sorted(['1500000', '2000000000', '68.67%']));
		assert.deepEqual(values('1.000 millones y el 68,67 % y 1,5 M', 'es'), sorted(['1000000000', '68.67%', '1500000']));
		assert.deepEqual(values('1,5 milhão e 61 por cento', 'pt-br'), sorted(['1500000', '61%']));
		assert.deepEqual(values('१,२३४ वॉलेट और 40 लाख और 5 प्रतिशत', 'hi'), sorted(['1234', '4000000', '5%']));
		assert.deepEqual(values('四万个钱包，百分之六十一，10亿美元，4万', 'zh'), sorted(['40000', '61%', '1000000000', '40000']));
		assert.deepEqual(values('千万别买，十分危险，第一天', 'zh'), []);
		assert.equal(parseCjkNumeral('四万五千'), 45000);
		assert.equal(parseCjkNumeral('三点五'), 3.5);
		assert.deepEqual(values('Web3, x402 and a bare 5m', 'en'), ['5']);
	});
	test('compare: missing is an error, extra a warning, a month is not extra', () => {
		const d = compareQuantities(extractQuantities('Nov 6, 2026: $40,000', 'en'), extractQuantities('2026年11月6日：4万美元', 'zh'));
		assert.deepEqual(d.missing, []);
		assert.deepEqual(d.extra, []);
		const m = compareQuantities(extractQuantities('1,234 wallets', 'en'), extractQuantities('1,234 billeteras', 'es'));
		assert.equal(m.missing.length, 1);
	});
});

describe('glossary and budgets', () => {
	test('the glossary lists names, orgs, tickers and URLs found in the source', () => {
		const g = buildGlossary(allTexts(master)).map((t) => t.term);
		for (const t of ['Zoo', 'Badger', 'Pump.fun', 'Bubblemaps', '$DEMO', 'SOL', 'go.zoora.ai/check']) assert.ok(g.includes(t), t);
		assert.ok(!g.includes('ZOO'), 'only terms that occur');
		assert.deepEqual(termsIn(buildGlossary(['Badger看着图表']), 'Badger看着图表').map((t) => t.term), ['Badger'], 'Latin terms inside CJK text');
		assert.deepEqual(buildGlossary(['Subscribe to Zoodger News.']).map((t) => t.term), ['Zoodger News'], 'the channel 2 name; "Zoo" never fires inside "Zoodger"');
	});
	test('the budget table matches the engine layout (src/episode/layout/specs.ts)', () => {
		const same = (key: string, f: 'landscape' | 'vertical', spec: {box: {w: number; h: number}; minSize: number; lineHeight: number} | null | undefined, wPad = 0) => {
			const b = FIELD_SPECS[key][f] as FitBox | undefined;
			if (!spec) return assert.equal(b, undefined, `${key} ${f}: the engine has no box`);
			assert.ok(b, `${key} ${f}: missing`);
			assert.deepEqual([b.w, b.h, b.min, b.lh], [spec.box.w - wPad, spec.box.h, spec.minSize, spec.lineHeight], `${key} ${f}: update scripts/dub/lib/budgets.ts`);
		};
		for (const f of ['landscape', 'vertical'] as const) {
			same('hook.kicker', f, LAYOUTS.hook[f].kicker);
			same('hook.title', f, LAYOUTS.hook[f].title);
			same('hook.subtitle', f, LAYOUTS.hook[f].subtitle);
			same('talk.title', f, LAYOUTS.talk[f].title);
			same('talk.bullets', f, LAYOUTS.talk[f].item);
			same('steps.title', f, LAYOUTS.steps[f].title);
			same('steps.steps', f, LAYOUTS.steps[f].item);
			same('quote.quote', f, LAYOUTS.quote[f].quote);
			same('quote.attribution', f, LAYOUTS.quote[f].attribution);
			same('quote.source', f, LAYOUTS.quote[f].source);
			same('cta.title', f, LAYOUTS.cta[f].title);
			same('cta.button', f, LAYOUTS.cta[f].buttonLabel);
			same('cta.disclosure', f, LAYOUTS.cta[f].disclosure);
			same('endscreen.title', f, LAYOUTS.endscreen[f].outro);
			same('chart.label', f, LAYOUTS.chart[f].chip, 44);
			same('ui.fictionDisclaimer', f, FICTION_CARD[f]);
		}
		same('lowerThird.0', 'landscape', LOWER_THIRD.landscape?.name);
		same('lowerThird.1', 'landscape', LOWER_THIRD.landscape?.role);
		same('ui.watchNext', 'landscape', LAYOUTS.endscreen.landscape.slotLabel);
		same('ui.subscribeSlot', 'landscape', LAYOUTS.endscreen.landscape.subscribeLabel);
	});
	test('fit estimate: a normal bullet fits, an essay does not; CJK counts wider', () => {
		const spec = FIELD_SPECS['talk.bullets'];
		assert.ok(checkFit('Tus seguidores compran el salto', spec, 'es', true).every((f) => f.fits));
		assert.ok(!checkFit('x '.repeat(200), spec, 'es', false)[0].fits);
		const cjk = checkFit('你'.repeat(40), spec, 'zh', false)[0];
		const latin = checkFit('a'.repeat(40), spec, 'es', false)[0];
		assert.ok(cjk.usedEm > latin.usedEm);
	});
});

describe('sheet and import', () => {
	const opts = {targetLang: 'es' as Lang, sourceFile: 'storyboard.json', sourceSha256: 'x', preparedAt: '2026-11-24T00:00:00Z', method: 'machine' as const};
	test('the sheet carries context, budgets, claim tags, numbers, glossary terms and fixed fields', () => {
		const sheet = buildSheet(master, opts);
		const by = new Map(sheet.items.map((i) => [i.key, i]));
		assert.deepEqual(by.get('scenes.s02.narration')?.claimTags, ['[src:launch-data]', '[src:bm-thread]']);
		assert.deepEqual(by.get('scenes.s02.narration')?.numbers, ['2024', '68.67%', '1234']);
		assert.ok(by.get('scenes.s06.narration')?.glossary?.includes('Badger'));
		assert.equal(by.get('scenes.s02.onScreen.cues.1')?.kind, 'cue');
		assert.equal(by.get('scenes.s01.claimWaivers.0.match')?.kind, 'waiver');
		assert.ok((by.get('scenes.s02.onScreen.bullets.0')?.budget.hardMaxChars ?? 0) > 20);
		assert.deepEqual(sheet.fixed, [{key: 'scenes.s03.onScreen.pair', value: '$DEMO / SOL', reason: sheet.fixed[0].reason}]);
		for (const k of ['fictionDisclaimer', 'sources', 'illustrative', 'subscribe', 'watchNext', 'subscribeSlot']) assert.ok(by.has(`ui.${k}`), k);
		assert.ok(sheet.mustNotSay.length >= 8, 'the Spanish income lexicon is listed for the translator');
		assert.ok(sheet.items.every((i) => i.translation === ''));
	});
	test('import rebuilds the reviewed-format translation exactly; a gap is refused', () => {
		const sheet = buildSheet(master, opts);
		assert.equal(seedFromTarget(sheet, goodEs), sheet.items.length);
		const res = applySheet(master, sheet, 'es');
		assert.deepEqual(res.problems, []);
		assert.deepEqual(res.storyboard, goodEs);
		sheet.items[3].translation = '  ';
		const bad = applySheet(master, sheet, 'es');
		assert.equal(bad.storyboard, null);
		assert.match(bad.problems.join('\n'), /no translation/);
	});
	test('import refuses a source that changed under the sheet', () => {
		const sheet = buildSheet(master, opts);
		seedFromTarget(sheet, goodEs);
		const changed = JSON.parse(JSON.stringify(master)) as Storyboard;
		changed.scenes[0].narration = 'Something else entirely.';
		assert.match(applySheet(changed, sheet, 'es').problems.join('\n'), /source text changed/);
	});
});

describe('validate', () => {
	test('the good Spanish translation passes (engine validator included)', () => {
		const r = check(goodEs);
		assert.deepEqual(r.findings.filter((f) => f.level === 'error'), []);
		assert.equal(r.translation.badge, true, 'machine translation: the render is badged');
		assert.ok(r.rows.length > 40, 'a review row per string');
	});
	const expected: Record<string, string> = {
		'tags-dropped': 'claim-tags',
		'number-changed': 'numbers',
		'number-misread': 'numbers',
		'glossary-translated': 'glossary',
		'url-changed': 'url',
		'too-long': 'budget',
		'income-added': 'must-not-say',
		'cue-missing': 'cue',
		'structure-changed': 'structure',
		'no-record': 'translation-record',
		'reviewed-inconsistent': 'translation-record',
		'fiction-card': 'fiction-card',
		'ui-missing': 'ui-missing',
	};
	for (const [name, rule] of Object.entries(expected)) {
		test(`broken-es/${name}.json fails with "${rule}"`, () => {
			const r = check(read(join(BROKEN, `${name}.json`)));
			assert.equal(r.pass, false);
			assert.ok(errorRules(r).includes(rule), `${name}: got ${errorRules(r).join(', ')}`);
		});
	}
	test('French is refused; Japanese warns; the source language is refused', () => {
		const fr = check({...goodEs, lang: 'fr' as Lang}, 'fr' as Lang);
		assert.ok(fr.findings.some((f) => f.rule === 'language' && /French is excluded/.test(f.message)));
		const ja = check({...goodEs, lang: 'ja'}, 'ja');
		assert.ok(ja.findings.some((f) => f.rule === 'language' && f.level === 'warning'));
		assert.ok(errorRules(check({...goodEs, lang: 'en'}, 'en')).includes('language'));
	});
	test('a native-reviewed record needs reviewer and date', () => {
		const r = check({...goodEs, translation: {status: 'native-reviewed', method: 'machine', reviewed: true}});
		assert.ok(r.findings.some((f) => f.rule === 'translation-record' && /reviewer/.test(f.message)));
		const ok = check({...goodEs, translation: {status: 'native-reviewed', method: 'machine', reviewed: true, reviewer: 'ES-1', date: '2026-11-25'}});
		assert.deepEqual(errorRules(ok), []);
		assert.equal(ok.translation.badge, false);
		const legacy = check({...goodEs, translation: {status: 'native-reviewed', reviewer: 'ES-1', date: '2026-11-25'}});
		assert.deepEqual(errorRules(legacy), [], '`reviewed` is optional: older files carry only the status');
	});
});

describe('VCD review (2026-11-24): spoken numbers, disclosures, fiction card, numbers in words', () => {
	const edit = (fn: (sb: Storyboard) => void): Storyboard => {
		const sb = JSON.parse(JSON.stringify(goodEs)) as Storyboard;
		fn(sb);
		return sb;
	};
	const s01 = (sb: Storyboard) => sb.scenes.find((x) => x.id === 's01')!;
	test('a changed SPOKEN number fails while the display number stays right', () => {
		const r = check(edit((sb) => (s01(sb).narration = s01(sb).narration.replace('cuarenta mil dólares', 'noventa mil dólares'))));
		assert.ok(errorRules(r).includes('spoken-numbers'), errorRules(r).join(', '));
		const display = check(edit((sb) => (s01(sb).narration = s01(sb).narration.replace('{40.000 $|', '{90.000 $|'))));
		assert.ok(errorRules(display).includes('numbers'));
		assert.ok(errorRules(display).includes('spoken-numbers'), 'the screen and the voice disagree');
	});
	test('a flipped disclosure fails: the translation must name the same relationship, unnegated', () => {
		const withOffer = (sb: Storyboard, line: string) => {
			sb.offers = ['hardware-wallet'];
			const cta = sb.scenes.find((x) => x.id === 's06')!;
			cta.narration = line;
		};
		const src = JSON.parse(JSON.stringify(master)) as Storyboard;
		withOffer(src, 'Affiliate link: I may earn a commission if you buy. Subscribe.');
		const tgt = edit((sb) => withOffer(sb, 'Este video no está patrocinado y no recibo ninguna comisión. Suscríbete.'));
		const r = validateDub({src, tgt, lang: 'es', names: EMPTY_NAMES, sourceFile: 's', targetFile: 't', engine: null, now: '2026-11-24T12:00:00Z'});
		assert.ok(r.findings.some((f) => f.rule === 'disclosure-relationship' && f.level === 'error'), JSON.stringify(r.findings.map((f) => f.rule)));
		const ok = edit((sb) => withOffer(sb, 'Enlace de afiliado: puedo ganar una comisión si compras. Suscríbete.'));
		const r2 = validateDub({src, tgt: ok, lang: 'es', names: EMPTY_NAMES, sourceFile: 's', targetFile: 't', engine: null, now: '2026-11-24T12:00:00Z'});
		assert.ok(!r2.findings.some((f) => f.rule === 'disclosure-relationship'));
	});
	test('a negated fiction card fails', () => {
		const r = check(edit((sb) => (sb.ui = {...sb.ui, fictionDisclaimer: 'Historia no ficticia · basada en hechos reales'})));
		assert.ok(errorRules(r).includes('fiction-card'));
	});
	test('the back-translation is scanned with the English must-not-say list', () => {
		const md = readFileSync(join(DEMO, 'research.md'), 'utf8');
		const record = {path: 'x', items: [{id: 's01.narration', text: goodEs.scenes[0].narration, bt: 'You copy a caller on Pump.fun. Honestly, Pump.fun is a rigged casino.'}]};
		const r = validateDub({src: master, tgt: goodEs, lang: 'es', names: EMPTY_NAMES, sourceFile: 's', targetFile: 't', engine: null, backtranslation: {record, mustNotSay: parseMustNotSay(md)}});
		assert.ok(r.findings.some((f) => f.where === 'backtranslation.s01.narration' && f.level === 'error'), JSON.stringify(r.findings.map((f) => [f.rule, f.where])));
	});
	test('a banned phrase from research.md "Must not say (es)" fails dub validate, not only the claim gate', () => {
		const md = ['# Research', '', '## Must not say', '', "- 'Pump.fun is a rigged casino'", '', '## Must not say (es)', '', "- 'Pump.fun es un casino amañado'", ''].join('\n');
		const tgt = edit((sb) => (sb.scenes[0].narration = `${sb.scenes[0].narration} Pump.fun es un casino amañado.`));
		const run = (mns: ReturnType<typeof parseMustNotSay> | null) => validateDub({src: master, tgt, lang: 'es', names: EMPTY_NAMES, sourceFile: 's', targetFile: 't', engine: null, now: '2026-11-24T12:00:00Z', mustNotSay: mns});
		const r = run(parseMustNotSay(md, 'es'));
		assert.ok(r.findings.some((f) => f.rule === 'must-not-say' && f.level === 'error' && f.where === `scenes.${tgt.scenes[0].id}.narration`), JSON.stringify(r.findings.map((f) => [f.rule, f.where])));
		const none = run(null);
		assert.ok(!none.findings.some((f) => f.rule === 'must-not-say'));
		assert.ok(none.notes.some((n) => n.includes('Must not say (es)')), 'a missing language section is reported');
		// the English section never matches the Spanish text: only the tagged section does
		assert.ok(!run(parseMustNotSay(md)).findings.some((f) => f.rule === 'must-not-say'));
	});
	test('numbers in words, as the voice speaks them', () => {
		const v = (t: string, l: Lang) => wordQuantities(t, l).map((q) => `${q.value}${q.pct ? '%' : ''}`);
		assert.deepEqual(v('nearly nineteen million', 'en'), ['19000000']);
		assert.deepEqual(v('four and a half percent', 'en'), ['4.5%']);
		assert.deepEqual(v('casi diecinueve millones', 'es'), ['19000000']);
		assert.deepEqual(v('Casi el sesenta y nueve por ciento', 'es'), ['69%']);
		assert.deepEqual(v('el cuatro y medio por ciento', 'es'), ['4.5%']);
		assert.deepEqual(v('quase dezenove milhões', 'pt-br'), ['19000000']);
		assert.deepEqual(v('dois mil e vinte e seis', 'pt-br'), ['2026']);
		assert.deepEqual(v('dois e três', 'pt-br'), ['2', '3']);
		assert.deepEqual(v('sessantanove per cento', 'it'), ['69%']);
		assert.deepEqual(v('साढ़े चार प्रतिशत', 'hi'), ['4.5%']);
		assert.deepEqual(v('百分之六十九', 'zh'), ['69%']);
	});
	test('the word tables match the voice step\'s normalizers (scripts/voice/voicelib/normalize)', () => {
		const py = (f: string) => readFileSync(join(STUDIO, 'scripts', 'voice', 'voicelib', 'normalize', f), 'utf8');
		const list = (src: string, name: string) => [...(new RegExp(`^${name} = \\[([\\s\\S]*?)\\]`, 'm').exec(src)?.[1] ?? '').matchAll(/"([^"]+)"/g)].map((m) => m[1]);
		assert.deepEqual(list(py('en.py'), 'ONES'), EN_ONES);
		assert.deepEqual(list(py('es.py'), 'UNITS'), ES_UNITS);
		assert.deepEqual(list(py('pt_br.py'), 'UNITS'), PT_UNITS);
		assert.deepEqual(list(py('it.py'), 'UNITS'), IT_UNITS);
		assert.deepEqual(list(py('hi.py'), 'HI_0_99'), HI_0_99);
	});
	test('the sheet translates source titles and lists the spoken respellings', () => {
		const sheet = buildSheet(master, {targetLang: 'es', sourceFile: 's', sourceSha256: 'x', preparedAt: '', method: 'machine'});
		assert.ok(sheet.items.some((i) => i.kind === 'source-title' && i.key === 'sources.launch-data.title'));
		assert.ok(sheet.spokenRespellings?.some((r) => r.term === 'on-chain' && r.spoken === 'onchéin'));
		const tgt = edit((sb) => (sb.sources[0].title = 'Título traducido'));
		assert.ok(!errorRules(check(tgt)).includes('structure'), 'a translated source title is not a structure change');
		const url = edit((sb) => (sb.sources[0].url = 'https://example.com/other'));
		assert.ok(errorRules(check(url)).includes('structure'), 'its URL still is');
	});
});

describe('CLI', () => {
	const cli = (args: string[]) => spawnSync(process.execPath, [join(STUDIO, 'scripts', 'dub', 'cli.ts'), ...args], {encoding: 'utf8', cwd: STUDIO});
	const copy = () => {
		const root = mkdtempSync(join(tmpdir(), 'dub-'));
		const dir = join(root, 'zoora-test', 'dub-demo');
		cpSync(DEMO, dir, {recursive: true});
		return {dir, out: join(root, 'out')};
	};
	test('prepare -> import -> validate round trip (seeded from the existing translation)', () => {
		const {dir, out} = copy();
		const p = cli(['prepare', dir, '--lang', 'es']);
		assert.equal(p.status, 0, p.stderr);
		assert.ok(existsSync(join(dir, 'dub', 'sheet.es.json')));
		assert.match(p.stdout, /seeded 48 translations/); // 46 strings + the 2 source titles (translatable since 2026-11-24)
		const i = cli(['import', dir, '--lang', 'es', '--no-names', '--out-dir', out]);
		assert.equal(i.status, 0, i.stdout + i.stderr);
		assert.deepEqual(read(join(dir, 'storyboard.es.json')), goodEs);
		assert.match(readFileSync(join(out, 'dub-demo.es.md'), 'utf8'), /Native review sheet/);
		assert.ok(!(p.stderr + i.stderr).includes('MODULE_TYPELESS_PACKAGE_JSON'));
	});
	test('import refuses a stale sheet and a native-reviewed target', () => {
		const {dir} = copy();
		assert.equal(cli(['prepare', dir, '--lang', 'es']).status, 0);
		const sbPath = join(dir, 'storyboard.json');
		writeFileSync(sbPath, readFileSync(sbPath, 'utf8').replace('Here is the catch.', 'Here is the trap.'));
		const stale = cli(['import', dir, '--lang', 'es', '--no-names']);
		assert.equal(stale.status, 1);
		assert.match(stale.stderr, /changed since the sheet was prepared/);
		const {dir: d2} = copy();
		const es = JSON.parse(readFileSync(join(d2, 'storyboard.es.json'), 'utf8'));
		es.translation = {status: 'native-reviewed', method: 'machine', reviewed: true, reviewer: 'ES-1', date: '2026-11-25'};
		writeFileSync(join(d2, 'storyboard.es.json'), JSON.stringify(es));
		assert.equal(cli(['prepare', d2, '--lang', 'es']).status, 0);
		const r = cli(['import', d2, '--lang', 'es', '--no-names']);
		assert.equal(r.status, 1);
		assert.match(r.stderr, /native-reviewed/);
	});
	test('validate: exit 1 on a broken translation, 2 for French', () => {
		const {dir, out} = copy();
		cpSync(join(BROKEN, 'tags-dropped.json'), join(dir, 'storyboard.es.json'));
		const v = cli(['validate', dir, '--lang', 'es', '--no-names', '--out-dir', out]);
		assert.equal(v.status, 1);
		assert.match(v.stdout, /ERROR claim-tags \[scenes\.s02\.narration\]/);
		const fr = cli(['prepare', dir, '--lang', 'fr']);
		assert.equal(fr.status, 2);
		assert.match(fr.stderr, /French is excluded/);
	});
});
