/**
 * Claim gate tests (node:test). Run from projects/video-studio:
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/claims/tests/claims.test.ts
 * Fixtures: tests/fixtures/zoora-test/<case>/ (one good episode in en + es, and deliberately broken ones),
 * tests/fixtures/names.txt (invented names only) and tests/fixtures/offers.json.
 */
import test, {describe} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkEpisode, type CheckInput} from '../lib/check.ts';
import {factualSignals} from '../lib/factual.ts';
import {incomeHits} from '../lib/income.ts';
import {findPhrase, matchTokens, parseMustNotSay, scanMustNotSay} from '../lib/mustnotsay.ts';
import {findNames, loadNames, redactNames} from '../lib/names.ts';
import {splitSentences} from '../lib/narration.ts';
import {findWallets, redactWallets} from '../lib/wallets.ts';
import {regionalFindings} from '../lib/regional.ts';
import type {ClaimReport} from '../lib/types.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const FIX = join(HERE, 'fixtures');
const CASES = join(FIX, 'zoora-test');
const STUDIO = join(HERE, '..', '..', '..');
const NAMES = join(FIX, 'names.txt');
const OFFERS = join(FIX, 'offers.json');
const TODAY = '2026-11-24';

const run = (slug: string, extra: Partial<CheckInput> = {}): ClaimReport =>
	checkEpisode({dir: join(CASES, slug), today: TODAY, namesPath: NAMES, offersPath: OFFERS, now: '2026-11-24T12:00:00Z', ...extra});
const errs = (r: ClaimReport) => r.findings.filter((f) => f.level === 'error');
const has = (r: ClaimReport, rule: string, where?: string) => errs(r).some((f) => f.rule === rule && (!where || f.where.startsWith(where)));

describe('sentences and tags', () => {
	test('a tag backs the sentence it closes, before or after the period', () => {
		const s = splitSentences('Claim one [src:a]. Claim two. [src:b] Story line. Last claim {$40,000|forty thousand dollars} [src:c,d]', 'en');
		assert.deepEqual(
			s.map((x) => x.ids),
			[['a'], ['b'], [], ['c', 'd']],
		);
		assert.equal(s[3].display, 'Last claim $40,000');
		assert.equal(s[3].spoken, 'Last claim forty thousand dollars');
	});
	test('decimals, abbreviations and domains do not split sentences', () => {
		const s = splitSentences('In the U.S. regulators watched 68.67% of tokens on Pump.fun closely. Then, e.g. today, nothing.', 'en');
		assert.equal(s.length, 2);
	});
	test('CJK and Devanagari sentence ends', () => {
		assert.equal(splitSentences('第一句。第二句！第三句', 'zh').length, 3);
		assert.equal(splitSentences('पहला वाक्य। दूसरा वाक्य।', 'hi').length, 2);
	});
	test('malformed markup throws', () => {
		assert.throws(() => splitSentences('Broken {markup without a bar}', 'en'));
	});
});

describe('factual signals', () => {
	const kinds = (t: string, lang: Parameters<typeof factualSignals>[2] = 'en') => factualSignals(t, t, lang).map((s) => s.kind);
	test('digits, money, percent, dates, scale words, orgs', () => {
		assert.ok(kinds('Fees were 1.25% of $40,000.').includes('number'));
		assert.ok(kinds('Fees were 1.25% of $40,000.').includes('percent'));
		assert.ok(kinds('Fees were 1.25% of $40,000.').includes('currency'));
		assert.ok(kinds('It launched in January.').includes('date'));
		assert.ok(kinds('Ten thousand wallets.').includes('scale'));
		assert.ok(kinds('Chainalysis tracked it.').includes('org'));
	});
	test('superlatives in context, not discourse words', () => {
		assert.ok(kinds('It is the largest launchpad.').includes('superlative'));
		assert.ok(kinds('Most wallet drains start with one click.').includes('superlative'));
		assert.ok(kinds('It was the first app to do it.').includes('superlative'));
		assert.deepEqual(kinds('First, you buy early and quietly.'), []);
		assert.deepEqual(kinds('The only thing that matters is the wallet.'), []);
		assert.deepEqual(kinds('Be the first to know.'), []);
		assert.deepEqual(kinds('You may lose money. Web3 is weird.'), []);
	});
	test('attributions are never waivable', () => {
		const s = factualSignals('According to analysts, it happened.', 'According to analysts, it happened.', 'en');
		assert.ok(s.some((x) => x.kind === 'attribution' && !x.waivable));
	});
	test('other languages', () => {
		assert.ok(kinds('Según Bubblemaps, la mayoría de los tokens mueren.', 'es').includes('attribution'));
		assert.ok(kinds('A maioria dos tokens morre no primeiro dia.', 'pt-br').includes('superlative'));
		assert.ok(kinds('La maggior parte dei token muore.', 'it').includes('superlative'));
		assert.ok(kinds('ज़्यादातर टोकन मर जाते हैं।', 'hi').includes('superlative'));
		assert.ok(kinds('超过4万个钱包。', 'zh').includes('number'));
		assert.deepEqual(kinds('最后，看看钱包。', 'zh'), []);
	});
});

describe('income and advice framings', () => {
	const ids = (t: string, lang: Parameters<typeof incomeHits>[1] = 'en') => incomeHits(t, lang).filter((h) => !h.negated).map((h) => h.rule.id);
	test('flags promises, keeps negations', () => {
		assert.deepEqual(ids('Guaranteed returns, they said.'), ['guaranteed']);
		assert.deepEqual(ids('This is not financial advice.'), []);
		assert.deepEqual(ids('None of this is financial advice.'), []);
		assert.deepEqual(ids("There's no risk-free trade."), []);
		assert.deepEqual(ids('It is risk-free!'), ['risk-free']);
		assert.deepEqual(ids("You can't lose."), ['cant-lose']);
		assert.deepEqual(ids('Nothing here is a sure thing.'), []);
		assert.deepEqual(ids('Avoid get-rich-quick schemes.'), []);
		assert.ok(ids('This coin will 100x.').length > 0);
		assert.deepEqual(ids('It is 2x faster.'), []);
		assert.deepEqual(ids('Passive income while you sleep!'), ['passive-income']);
	});
	test('translated lexicons: es, pt-br, it, hi, zh', () => {
		assert.deepEqual(ids('No es asesoría financiera.', 'es'), []);
		assert.deepEqual(ids('Ganancias garantizadas y sin riesgo.', 'es'), ['guaranteed', 'risk-free']);
		assert.deepEqual(ids('Isso não é conselho financeiro.', 'pt-br'), []);
		assert.deepEqual(ids('Renda passiva todo mês!', 'pt-br'), ['passive-income']);
		assert.deepEqual(ids('Non è un consiglio finanziario.', 'it'), []);
		assert.deepEqual(ids('Rendimento garantito.', 'it'), ['guaranteed']);
		assert.deepEqual(ids('यह वित्तीय सलाह नहीं है।', 'hi'), []);
		assert.ok(ids('पक्का मुनाफ़ा, गारंटी के साथ।', 'hi').includes('guaranteed'));
		assert.deepEqual(ids('不构成投资建议。', 'zh'), []);
		assert.deepEqual(ids('稳赚不赔！', 'zh'), ['cant-lose']);
		assert.deepEqual(ids('这个币会涨十倍。', 'zh'), ['multiplier']);
	});
});

describe('research.md "Must not say"', () => {
	const md = readFileSync(join(CASES, 'good-episode', 'research.md'), 'utf8');
	const list = parseMustNotSay(md);
	const banned = (t: string) => scanMustNotSay(t, list).filter((h) => h.pattern.level === 'error').map((h) => h.rule.id);
	test('finds the section and every bullet', () => {
		assert.ok(list.found);
		assert.equal(list.rules.length, 7);
	});
	test('quoted phrases, " / " alternatives, placeholders, ellipses', () => {
		assert.deepEqual(banned('Honestly, Pump.fun is a rigged casino.'), ['mns-2']);
		assert.deepEqual(banned('A judge found Pump.fun liable.'), ['mns-2']);
		assert.deepEqual(banned('Bubblemaps caught them.'), ['mns-3']);
		assert.deepEqual(banned('Top callers make six figures.'), ['mns-5']);
		assert.deepEqual(banned("You'll earn it back."), ['mns-5']);
	});
	test('figure lists and composites', () => {
		assert.deepEqual(banned('Their hit rate was 73%.'), ['mns-1']);
		assert.deepEqual(banned('The wallet started with 9q8ztQx.'), ['mns-1']);
		assert.deepEqual(banned('Graduated means safe.'), ['mns-4']);
		assert.deepEqual(banned('LP burned means safe.'), ['mns-4']);
	});
	test('instructions are not bans', () => {
		// "(say 'alleged' or 'estimated')" and "Use about 15% and about $100K."
		assert.deepEqual(banned('Bubblemaps estimated it; the platform alleged nothing.'), []);
		assert.deepEqual(banned('The token fell about 15%, roughly $100K.'), []);
		assert.deepEqual(banned('Graduated tokens can still collapse.'), []);
	});
	test('unquoted figures in a prohibition are warnings', () => {
		const hits = scanMustNotSay('It fell 20% in a day.', list);
		assert.ok(hits.some((h) => h.rule.id === 'mns-6' && h.pattern.level === 'warning'));
	});
	test('rules without patterns are listed for a human read', () => {
		assert.ok(list.rules.some((r) => r.coverage === 'manual' && /fee percentages/.test(r.text)));
	});
	test('token matching: contractions, hyphens, currency, ranges', () => {
		assert.deepEqual(matchTokens("Can't rug-pull $10k–$100k"), ['can', 'not', 'rug', 'pull', '10k', '100k']);
		assert.equal(findPhrase(['someone', 'stole', '100m'], ['stole', '100m']), 1);
		assert.equal(findPhrase(['the', 'x', 'y', 'hid', 'wallets'], ['the', null, 'hid', 'wallets']), 0);
	});
	test('a missing section is reported', () => {
		assert.equal(parseMustNotSay('# Research\n\n## Facts\n- a\n').found, false);
	});
});

describe('names and wallets', () => {
	const names = loadNames(NAMES);
	test('names list: comments and short entries ignored, handles matched with or without @', () => {
		assert.equal(names.count, 2);
		assert.deepEqual(findNames('ask testy mcfakename', names), [1]);
		assert.deepEqual(findNames('follow fakehandle123 now', names), [2]);
		assert.deepEqual(findNames('Testy McFakenameson', names), []);
		assert.equal(redactNames('Testy McFakename said so', names), '[private name #1] said so');
	});
	test('wallet-like strings', () => {
		const evm = `0x${'ab'.repeat(20)}`;
		assert.equal(findWallets(`send to ${evm} now`)[0]?.kind, 'evm-address');
		assert.equal(findWallets(`tx 0x${'cd'.repeat(32)}`)[0]?.kind, 'evm-hash');
		assert.equal(findWallets(`the Zx${'k9'.repeat(20)} wallet`)[0]?.kind, 'base58');
		assert.equal(findWallets('wallet 7xKX…gAsU sold')[0]?.kind, 'short-address');
		assert.deepEqual(findWallets('Pump.fun, $DEMO / SOL, 40,000 wallets, Web3 and GPT-4'), []);
		assert.equal(redactWallets(`to ${evm}.`), 'to [wallet-like string].');
	});
});

describe('fixtures', () => {
	test('the good episode passes in en and es', () => {
		for (const lang of ['en', 'es'] as const) {
			const r = run('good-episode', {lang});
			assert.deepEqual(errs(r), [], `${lang}: ${JSON.stringify(errs(r), null, 1)}`);
			assert.equal(r.pass, true);
			assert.ok(r.waivers.every((w) => w.used), 'every waiver is used');
			assert.ok(r.claims.some((c) => c.ids.includes('callout-terms')));
		}
	});
	test('unsourced claims, unknown ids, attributions that a waiver cannot cover, unsourced quotes', () => {
		const r = run('unsourced');
		assert.equal(r.pass, false);
		assert.ok(has(r, 'unsourced-claim', 's01'));
		assert.ok(has(r, 'unsourced-claim', 's02'), 'an attribution stays an error even with a waiver');
		assert.ok(has(r, 'unknown-source', 's03'));
		assert.ok(has(r, 'quote-unsourced', 's04'));
		const f = errs(r).find((x) => x.rule === 'unsourced-claim' && x.scene === 's01');
		assert.equal(f?.text, 'Pump.fun launched in January 2024.');
		assert.match(f?.fix ?? '', /\[src:/);
	});
	test('bad sources', () => {
		const r = run('bad-sources');
		for (const rule of ['source-unverified', 'source-not-https', 'source-no-accessed', 'source-accessed-future', 'source-status']) assert.ok(has(r, rule), rule);
		assert.ok(r.findings.some((f) => f.rule === 'source-unused' && f.level === 'warning'));
	});
	test('must-not-say: research phrases, income claims, private names, wallets, invite links', () => {
		const r = run('must-not-say');
		for (const rule of ['must-not-say', 'income-claim', 'private-name', 'wallet-address', 'referral-link']) assert.ok(has(r, rule), rule);
		assert.ok(has(r, 'income-claim', 'title'));
		assert.ok(has(r, 'income-claim', 'thumbnails[a]'));
		const text = JSON.stringify(r);
		assert.ok(!/McFakename|fakehandle123/i.test(text), 'private names are never echoed');
		assert.ok(!text.includes('ab'.repeat(20)), 'wallet strings are never echoed');
	});
	test('fiction without a disclaimer (en card without "fictional"; es without ui.fictionDisclaimer)', () => {
		assert.ok(has(run('fiction'), 'no-fiction-disclaimer'));
		assert.ok(has(run('fiction', {lang: 'es'}), 'no-fiction-disclaimer'));
	});
	test('offers: a disclosure shown but not said', () => {
		const r = run('offers');
		assert.ok(has(r, 'disclosure-not-spoken', 's02'));
		assert.ok(has(r, 'no-spoken-disclosure'));
	});
	test('no research.md', () => {
		assert.ok(has(run('no-research'), 'no-research'));
	});
});

// ---------------------------------------------------------------------------------------------------------------------
// The 2026-11-24 review (VCD fix): every case it found passing must fail
// ---------------------------------------------------------------------------------------------------------------------

type Sb = Record<string, any>;
/** A scratch copy of a fixture episode (content/<channel>/<slug> shape), edited by `edit`. */
const scratch = (from: string, edit: (files: Record<string, Sb>, dir: string) => void, extra: Record<string, string> = {}): string => {
	const root = mkdtempSync(join(tmpdir(), 'claims-vcd-'));
	const dir = join(root, 'zoora-test', from);
	cpSync(join(CASES, from), dir, {recursive: true});
	const files: Record<string, Sb> = {};
	for (const f of ['storyboard.json', 'storyboard.es.json']) {
		try {
			files[f] = JSON.parse(readFileSync(join(dir, f), 'utf8'));
		} catch {
			// not every fixture has a translation
		}
	}
	edit(files, dir);
	for (const [f, sb] of Object.entries(files)) writeFileSync(join(dir, f), JSON.stringify(sb, null, 1));
	for (const [f, text] of Object.entries(extra)) {
		mkdirSync(join(dir, f, '..'), {recursive: true});
		writeFileSync(join(dir, f), text);
	}
	return dir;
};
const check = (dir: string, extra: Partial<CheckInput> = {}): ClaimReport => checkEpisode({dir, today: TODAY, namesPath: NAMES, offersPath: OFFERS, now: '2026-11-24T12:00:00Z', ...extra});
const rules = (r: ClaimReport) => errs(r).map((f) => f.rule);
const scene = (sb: Sb, id: string) => sb.scenes.find((x: Sb) => x.id === id);
/** The es translation with one scene's narration replaced (claim tags kept). */
const esLine = (id: string, narration: string) => scratch('good-episode', (f) => (scene(f['storyboard.es.json'], id).narration = narration));
const enLine = (id: string, narration: string) => scratch('good-episode', (f) => (scene(f['storyboard.json'], id).narration = narration));

describe('VCD review: private names', () => {
	test('a missing names list fails the gate; --no-names is a recorded, visible skip', () => {
		const r = run('good-episode', {namesPath: join(FIX, 'does-not-exist.txt')});
		assert.equal(r.pass, false);
		assert.ok(has(r, 'no-names-list'));
		const skip = run('good-episode', {namesPath: null});
		assert.equal(skip.pass, true);
		assert.ok(skip.findings.some((f) => f.rule === 'names-not-checked' && f.level === 'warning'));
		assert.equal(skip.namesList.skipped, true);
	});
	test('the PASS line says when names were not checked', () => {
		const cli = (args: string[]) => spawnSync(process.execPath, [join(STUDIO, 'scripts', 'claims', 'check.ts'), ...args], {encoding: 'utf8', cwd: STUDIO});
		const r = cli([join(CASES, 'good-episode'), '--no-names', '--offers', OFFERS, '--today', TODAY, '--out-dir', mkdtempSync(join(tmpdir(), 'claims-')), '-q']);
		assert.equal(r.status, 0, r.stdout + r.stderr);
		assert.match(r.stdout, /PASS: 0 errors, \d+ warnings · names NOT checked \(--no-names\)/);
	});
	test('accents do not hide a name; the reviewer field and dub sheets are scanned', () => {
		assert.deepEqual(findNames('pregúntale a Testy McFakenáme', loadNames(NAMES)), [1]);
		const dir = scratch('good-episode', (f) => {
			f['storyboard.es.json'].translation = {status: 'machine', method: 'machine', reviewed: false, reviewer: 'Testy McFakename'};
		}, {'dub/sheet.es.json': JSON.stringify({translator: 'Testy McFakename', items: []})});
		const r = check(dir, {lang: 'es'});
		assert.ok(errs(r).some((f) => f.rule === 'private-name' && f.where === 'translation.reviewer'));
		assert.ok(errs(r).some((f) => f.rule === 'private-name' && f.where.startsWith('dub/sheet.es.json')));
		assert.ok(!/McFakename/i.test(JSON.stringify(r)));
	});
});

describe('VCD review: must-not-say in a translation', () => {
	const RESEARCH_ES = '\n## Must not say (es)\n\n- \'Pump.fun es una estafa\'\n- \'Bubblemaps demostró\' / \'demostraron\'\n- \'los mejores callers ganan cifras de seis dígitos\'\n';
	const withEs = (narration: string) =>
		scratch('good-episode', (f, dir) => {
			scene(f['storyboard.es.json'], 's03').narration = narration;
			writeFileSync(join(dir, 'research.md'), readFileSync(join(dir, 'research.md'), 'utf8') + RESEARCH_ES);
		});
	test('the "(es)" section bans Spanish phrases; the English rules are listed for a human read', () => {
		const r = check(withEs('Porque los analistas de Bubblemaps demostraron que Pump.fun es una estafa.'), {lang: 'es'});
		assert.ok(rules(r).includes('must-not-say'), JSON.stringify(errs(r)));
		assert.ok(r.findings.some((f) => f.rule === 'must-not-say-language'));
		assert.ok(r.mustNotSay.manual.length >= 7, 'every English rule is listed as manual');
		assert.ok(r.mustNotSay.manual.every((m) => m.coverage === 'manual'));
	});
	test('the English back-translation is scanned with the English list', () => {
		const dir = scratch('good-episode', () => undefined, {
			'dub/backtranslation.es.json': JSON.stringify({lang: 'es', items: {'s05.onScreen.quote': {text: 'Nadie revisa la billetera.', bt: 'Top callers make six figures.'}}}),
		});
		const r = check(dir, {lang: 'es'});
		assert.ok(errs(r).some((f) => f.where === 'backtranslation · s05.onScreen.quote'), JSON.stringify(errs(r)));
	});
});

describe('VCD review: negation is clause-bounded', () => {
	for (const [lang, line] of [
		['en', 'Not financial advice, buy now.'],
		['es', 'No es consejo financiero, compra ahora.'],
		['es', 'Nadie pierde aquí, ganancias garantizadas.'],
	] as const)
		test(`${lang}: "${line}" fails`, () => {
			const r = check(lang === 'en' ? enLine('s03', line) : esLine('s03', line), lang === 'en' ? {} : {lang});
			assert.ok(rules(r).includes('income-claim'), JSON.stringify(errs(r)));
		});
	test('pt-br: "Ninguém perde aqui, lucro garantido." fails; negated hits are listed', () => {
		const ids = (t: string) => incomeHits(t, 'pt-br').filter((h) => !h.negated).map((h) => h.rule.id);
		assert.ok(ids('Ninguém perde aqui, lucro garantido.').length >= 1);
		const r = check(enLine('s06', 'This is not financial advice. If it saved you one bad trade, subscribe.'));
		assert.ok(r.findings.some((f) => f.rule === 'income-negated' && f.level === 'warning'));
	});
});

describe('VCD review: disclosures and fiction say what they say', () => {
	const offers = (cta: string, lang: 'en' | 'es' = 'en') =>
		scratch('good-episode', (f) => {
			const sb = f[lang === 'en' ? 'storyboard.json' : 'storyboard.es.json'];
			for (const x of [f['storyboard.json'], f['storyboard.es.json']]) x.offers = ['security-checklist'];
			scene(f['storyboard.json'], 's06').narration = 'I built this checklist; it is my own product. If it saved you one bad trade, subscribe.';
			scene(f['storyboard.json'], 's06').onScreen.disclosure = 'I built this checklist; it is my own product.';
			scene(f['storyboard.es.json'], 's06').onScreen.disclosure = 'Yo creé esta lista; es mi propio producto.';
			scene(f['storyboard.es.json'], 's06').narration = 'Yo creé esta lista; es mi propio producto. Si te ahorró una mala operación, suscríbete.';
			scene(sb, 's06').narration = `${cta} Si te ahorró una mala operación, suscríbete.`;
			scene(sb, 's06').onScreen.disclosure = cta;
		});
	test('"not sponsored, no commission" is not a disclosure (en)', () => {
		const r = check(offers('This video is not sponsored and I get no commission.'));
		assert.ok(rules(r).includes('disclosure-negated') || rules(r).includes('no-spoken-disclosure'), JSON.stringify(errs(r)));
	});
	test('a translation must disclose the same relationship (es)', () => {
		const r = check(offers('Este video no está patrocinado y no recibo ninguna comisión.', 'es'), {lang: 'es'});
		assert.equal(r.pass, false);
		assert.ok(rules(r).includes('disclosure-relationship') || rules(r).includes('no-spoken-disclosure'), JSON.stringify(rules(r)));
	});
	test('a negated fiction card, or a fiction word only in scene 3, does not count', () => {
		const neg = scratch('good-episode', (f) => (f['storyboard.es.json'].ui.fictionDisclaimer = 'Historia no ficticia · basada en hechos reales'));
		assert.ok(rules(check(neg, {lang: 'es'})).includes('no-fiction-disclaimer'));
		// no card; the only fiction words are in scene 3 and in a later quote: the opening never says it
		const late = scratch('good-episode', (f) => {
			const es = f['storyboard.es.json'];
			delete es.ui.fictionDisclaimer;
			scene(es, 's03').narration = 'En el gráfico de una moneda inventada, la subida parece orgánica. Luego el suelo desaparece.';
		});
		assert.ok(rules(check(late, {lang: 'es'})).includes('no-fiction-disclaimer'));
	});
});

describe('VCD review: statistics, on-screen figures, titles', () => {
	for (const [lang, line] of [
		['en', 'Seven in ten new buyers never check.'],
		['en', 'Four out of five new buyers never check.'],
		['es', 'Siete de cada diez compradores nunca revisan.'],
		['es', 'Cuatro de cada cinco compradores nunca revisan.'],
	] as const)
		test(`${lang}: "${line}" is an unsourced statistic`, () => {
			const r = check(lang === 'en' ? enLine('s03', line) : esLine('s03', line), lang === 'en' ? {} : {lang});
			assert.ok(rules(r).includes('unsourced-claim'), JSON.stringify(errs(r)));
		});
	test('pt-br "Sete em cada dez" is a statistic', () => {
		assert.ok(factualSignals('Sete em cada dez compradores nunca verificam.', 'Sete em cada dez compradores nunca verificam.', 'pt-br').some((s) => s.kind === 'scale'));
	});
	test('an on-screen figure in a scene that cites nothing is an error', () => {
		const dir = scratch('good-episode', (f) => (scene(f['storyboard.json'], 's04').onScreen.steps[0] = '73% of buyers skip these checks'));
		assert.ok(errs(check(dir)).some((f) => f.rule === 'onscreen-unsourced' && f.scene === 's04'));
	});
	test('in a citing scene, every on-screen figure is in a cited sentence', () => {
		const dir = scratch('good-episode', (f) => (scene(f['storyboard.json'], 's02').onScreen.bullets[0] = '92% of callers are paid to post'));
		assert.ok(rules(check(dir)).includes('onscreen-figure-uncited'));
	});
	test('titles, Short titles and thumbnails make claims too', () => {
		const t = scratch('good-episode', (f) => (f['storyboard.json'].title = '73% of new memecoins are rug pulls'));
		assert.ok(rules(check(t)).includes('title-unsourced'));
		const es = scratch('good-episode', (f) => {
			f['storyboard.es.json'].title = 'El 73% de las memecoins nuevas son estafas';
			f['storyboard.es.json'].shorts[0].title = 'Nueve de cada diez memecoins son estafas';
		});
		const r = check(es, {lang: 'es'});
		assert.ok(errs(r).some((f) => f.rule === 'title-unsourced' && f.where === 'title'));
		assert.ok(errs(r).some((f) => f.rule === 'title-unsourced' && f.where.startsWith('shorts[')));
	});
});

describe('VCD review: the translation record and numbers reach the claim report', () => {
	test('native-reviewed with reviewed false and no reviewer fails; the status is on the summary', () => {
		const dir = scratch('good-episode', (f) => (f['storyboard.es.json'].translation = {status: 'native-reviewed', method: 'machine', reviewed: false}));
		const r = check(dir, {lang: 'es'});
		assert.ok(rules(r).includes('dub-translation-record'), JSON.stringify(rules(r)));
		assert.equal(r.translation?.status, 'native-reviewed');
		assert.equal(check(join(CASES, 'good-episode'), {lang: 'es'}).translation?.badge, true);
	});
	test('a dub without its own "illustrative" chart label fails the claim gate (the viewer would read English)', () => {
		const dir = scratch('good-episode', (f) => delete (f['storyboard.es.json'].ui as Record<string, unknown>).illustrative);
		const r = check(dir, {lang: 'es'});
		assert.ok(errs(r).some((f) => f.rule === 'dub-ui-missing' && f.where === 'dub · ui.illustrative'), JSON.stringify(rules(r)));
		assert.ok(!rules(check(join(CASES, 'good-episode'), {lang: 'es'})).includes('dub-ui-missing'));
	});
	test('a changed number in the translation fails the claim gate', () => {
		const dir = scratch('good-episode', (f) => (scene(f['storyboard.es.json'], 's01').narration = 'Encuentras a un caller con 90.000 seguidores. Cada llamada sube. Nadie pregunta por qué.'));
		assert.ok(rules(check(dir, {lang: 'es'})).includes('dub-numbers'));
	});
});

describe('VCD review: offers in dubs, MiCA, ASCI', () => {
	const offersIn = (lang: 'es', offer: string, waiver?: Sb) =>
		scratch('good-episode', (f) => {
			for (const x of [f['storyboard.json'], f['storyboard.es.json']]) x.offers = [offer];
			scene(f['storyboard.json'], 's06').narration = 'Affiliate link: I may earn a commission. If it saved you one bad trade, subscribe.';
			scene(f['storyboard.json'], 's06').onScreen.disclosure = 'Affiliate link: I may earn a commission.';
			scene(f['storyboard.es.json'], 's06').narration = 'Enlace de afiliado: puedo ganar una comisión. Si te ahorró una mala operación, suscríbete.';
			scene(f['storyboard.es.json'], 's06').onScreen.disclosure = 'Enlace de afiliado: puedo ganar una comisión.';
			if (waiver) f['storyboard.es.json'].dubOffersWaiver = waiver;
			void lang;
		});
	const REG = (o: Sb) => {
		const p = join(mkdtempSync(join(tmpdir(), 'offers-')), 'offers.json');
		writeFileSync(p, JSON.stringify({version: 1, offers: [o]}));
		return p;
	};
	const wallet = REG({id: 'hardware-wallet', relationship: 'affiliate', category: 'security', disclosure: 'Affiliate link: I may earn a commission.'});
	const exchange = REG({id: 'bybit', relationship: 'referral', category: 'exchange', disclosure: 'Referral link: I may earn a commission.'});
	test('an affiliate offer in a dub fails unless the owner recorded the geo-routing decision', () => {
		assert.ok(rules(check(offersIn('es', 'hardware-wallet'), {lang: 'es', offersPath: wallet})).includes('dub-offers'));
		const waived = check(offersIn('es', 'hardware-wallet', {reason: 'hub routes es viewers to an EU-licensed shop', approvedBy: 'owner', date: '2026-11-24'}), {lang: 'es', offersPath: wallet});
		assert.ok(!rules(waived).includes('dub-offers'), JSON.stringify(rules(waived)));
	});
	test('an exchange offer in a dub always fails, waiver or not', () => {
		const r = check(offersIn('es', 'bybit', {reason: 'owner decision recorded here', approvedBy: 'owner', date: '2026-11-24'}), {lang: 'es', offersPath: exchange});
		assert.ok(rules(r).includes('dub-offers'));
	});
	test('a token promotion in es needs the MiCA Art. 7 statement', () => {
		const findings = regionalFindings({sb: {...JSON.parse(readFileSync(join(CASES, 'good-episode', 'storyboard.es.json'), 'utf8')), sourceLang: 'es', tokenPromotion: true}, lang: 'es', isTranslation: false, offerIds: [], registry: null});
		assert.ok(findings.some((f) => f.rule === 'mica-statement'));
	});
	test('hi: an exchange promotion needs the ASCI disclaimer, the AI-persona line, no banned words, FIU-IND', () => {
		const sb = JSON.parse(readFileSync(join(CASES, 'good-episode', 'storyboard.json'), 'utf8'));
		sb.lang = 'hi';
		sb.offers = ['bybit'];
		sb.scenes[5].narration = 'रेफ़रल लिंक: मुझे कमीशन मिल सकता है। यह करेंसी का भविष्य है।';
		const reg = new Map([['bybit', {id: 'bybit', relationship: 'referral', disclosure: '', category: 'exchange'}]]);
		const f = regionalFindings({sb, lang: 'hi', isTranslation: true, offerIds: ['bybit'], registry: reg}).map((x) => x.rule);
		for (const rule of ['dub-offers', 'asci-disclaimer', 'asci-ai-persona', 'asci-banned-word', 'asci-fiu-ind']) assert.ok(f.includes(rule), `${rule}: ${f.join(', ')}`);
	});
});

describe('VCD review: persona, holdings, Spanish and Portuguese promises', () => {
	for (const [lang, line] of [
		['en', 'As your financial adviser, I can tell you this coin is undervalued.'],
		['es', 'Como tu asesor financiero, te digo que esta moneda está infravalorada.'],
	] as const)
		test(`${lang}: Zoo as a financial adviser fails`, () => {
			const r = check(lang === 'en' ? enLine('s03', line) : esLine('s03', line), lang === 'en' ? {} : {lang});
			assert.ok(rules(r).includes('persona'), JSON.stringify(rules(r)));
		});
	test('pt-br persona, and "I\'m not a financial adviser" passes', () => {
		assert.ok(incomeHits('Como seu consultor financeiro, digo que essa moeda está subvalorizada.', 'pt-br').some((h) => h.rule.id === 'persona' && !h.negated));
		assert.ok(incomeHits("I'm not a financial adviser.", 'en').every((h) => h.negated));
	});
	test('holding a token, or an opinion on one, needs a spoken holdings disclosure', () => {
		assert.ok(rules(check(enLine('s03', 'I hold a bag of this coin and I think it is still cheap.'))).includes('holdings-disclosure'));
		assert.ok(!rules(check(enLine('s03', "I hold a bag of this coin. Disclosure: I hold some, and it is not advice."))).includes('holdings-disclosure'));
	});
	for (const [lang, line] of [
		['es', 'Con este método vas a ganar dinero seguro cada semana.'],
		['es', 'Multiplica tu dinero por diez.'],
		['es', 'No hay forma de perder con estas monedas.'],
		['es', 'Esta moneda se va a disparar la próxima semana.'],
		['es', 'Los mejores callers ganan cifras de seis dígitos.'],
		['pt-br', 'Com esse método você vai ganhar uma renda extra todo mês.'],
	] as const)
		test(`${lang}: "${line}" is an income or price promise`, () => {
			assert.ok(incomeHits(line, lang).some((h) => !h.negated && h.rule.level === 'error'), line);
		});
	test('"ganaron hasta" fails even inside a cited sentence', () => {
		const r = check(esLine('s02', 'Pump.fun paga a los callers recompensas en USDC cada día, y ganaron hasta quinientos dólares al día. [src:callout-terms] Primero, revisas qué billeteras compraron antes de cada llamada y qué tan rápido vendieron.'), {lang: 'es'});
		assert.ok(rules(r).includes('income-claim'), JSON.stringify(rules(r)));
	});
});

describe('CLI', () => {
	const cli = (args: string[]) => spawnSync(process.execPath, [join(STUDIO, 'scripts', 'claims', 'check.ts'), ...args], {encoding: 'utf8', cwd: STUDIO});
	const out = () => mkdtempSync(join(tmpdir(), 'claims-'));
	const common = ['--names', NAMES, '--offers', OFFERS, '--today', TODAY];
	test('exit 0 and a report for a good episode', () => {
		const dir = out();
		const r = cli([join(CASES, 'good-episode'), ...common, '--out-dir', dir]);
		assert.equal(r.status, 0, r.stdout + r.stderr);
		assert.match(readFileSync(join(dir, 'good-episode.en.md'), 'utf8'), /— PASS/);
		assert.ok(!r.stderr.includes('MODULE_TYPELESS_PACKAGE_JSON'));
	});
	test('exit 1 with scene, sentence and fix for each failure', () => {
		const dir = out();
		const r = cli([join(CASES, 'unsourced'), ...common, '--out-dir', dir]);
		assert.equal(r.status, 1);
		const md = readFileSync(join(dir, 'unsourced.en.md'), 'utf8');
		assert.match(md, /`s01 · narration`/);
		assert.match(md, /Sentence: “Pump\.fun launched in January 2024\.”/);
		assert.match(md, /Fix: /);
		assert.match(r.stdout, /ERROR unsourced-claim \[s01 · narration\]/);
	});
	test('private names never reach stdout or the report', () => {
		const dir = out();
		const r = cli([join(CASES, 'must-not-say'), ...common, '--out-dir', dir]);
		assert.equal(r.status, 1);
		assert.ok(!/McFakename|fakehandle123/i.test(r.stdout + readFileSync(join(dir, 'must-not-say.en.md'), 'utf8')));
	});
	test('exit 2: French, unknown language, missing folder', () => {
		const fr = cli([join(CASES, 'good-episode'), '--lang', 'fr']);
		assert.equal(fr.status, 2);
		assert.match(fr.stderr, /French is excluded/);
		assert.equal(cli([join(CASES, 'good-episode'), '--lang', 'de']).status, 2);
		assert.equal(cli([join(CASES, 'does-not-exist')]).status, 2);
		assert.equal(cli([join(CASES, 'good-episode'), '--lang', 'it', '--today', TODAY]).status, 2, 'no storyboard.it.json');
	});
});
