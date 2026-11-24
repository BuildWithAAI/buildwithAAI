// Unit tests for the thumbnail engine's pure modules (spec, fit, layout, compose, contrast, png).
// Run: node --test src/thumbnails/test/thumbnails.test.ts   (Node 22 strips the types)
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {checkMasterThumbnails, checkText, displayText, resolveThumb, textUnits, variantIndex, VARIANTS, type ThumbVariant} from '../spec.ts';
import {breakUnits, explicitLines, fitHeadline, lineSplits, type InkMeasure} from '../fit.ts';
import {badgerFaceBox, badgerHeadBox, inflate, intersects, layoutFor, RIG, textStyle, THUMB, YT_STAMP, zooBodyBox, zooFaceBox, zooHeadBox} from '../layout.ts';
import {compose} from '../compose.ts';
import {contrast, hexToRgb, lightness, MIN_TEXT_CONTRAST} from '../contrast.ts';
import {decodePng, downscale, encodePng, enlarge} from '../node/png.ts';
import {BADGER_COLORS} from '../../characters/palette.ts';
import type {Lang, Storyboard} from '../../episode/types.ts';

const errors = (text: string, lang: Lang = 'en') => checkText(text, lang, 't').filter((i) => i.level === 'error');
const warnings = (text: string, lang: Lang = 'en') => checkText(text, lang, 't').filter((i) => i.level === 'warning');

// ---- spec ----

test('word and character counts', () => {
	assert.deepEqual(textUnits('TOP CALLER?', 'en'), ['TOP', 'CALLER?']);
	assert.equal(textUnits('¿QUIÉN VENDIÓ PRIMERO?', 'es').length, 3);
	assert.equal(textUnits('THE — END', 'en').length, 2, 'a dash alone is not a word');
	assert.equal(textUnits('谁先卖的？', 'zh').length, 4);
	assert.equal(textUnits('AI交易员', 'zh').length, 4, 'a Latin run counts as one unit');
});

test('text rules: length, emoji, arrows, clickbait punctuation', () => {
	assert.deepEqual(errors('TOP CALLER?'), []);
	assert.deepEqual(errors('WHO SOLD FIRST'), []);
	assert.equal(errors('ONE TWO THREE FOUR FIVE').length, 1);
	assert.equal(errors('谁先卖的谁先卖的谁先卖', 'zh').length, 1, '11 characters');
	assert.deepEqual(errors('顶级\n喊单人？', 'zh'), [], 'an explicit break is allowed');
	assert.ok(errors('A\nB\nC\nD').length >= 1, '4 lines');
	assert.ok(errors('RUG PULL 🚀').length >= 1);
	assert.ok(errors('RUG → PULL').length >= 1);
	assert.ok(errors('RUG -> PULL').length >= 1);
	assert.ok(errors('WHAT?!').length >= 1);
	assert.ok(errors('NO WAY!!').length >= 1);
	assert.ok(errors('').length >= 1);
});

test('text rules: nothing that implies profit', () => {
	for (const bad of ['$40K IN A DAY', 'IT WENT 100X', '+500% OVERNIGHT', 'EASY PROFIT', 'TO THE MOON', 'PASSIVE INCOME', 'GUARANTEED', 'DON’T MISS THIS', '10× LIKE THAT']) {
		assert.ok(errors(bad).length >= 1, bad);
	}
	assert.ok(errors('GANANCIAS FÁCILES', 'es').length >= 1);
	assert.ok(errors('LUCRO GARANTIDO', 'pt-br').length >= 1);
	assert.ok(errors('稳赚不赔', 'zh').length >= 1);
	assert.ok(errors('गारंटी वाला मुनाफ़ा', 'hi').length >= 1);
	assert.deepEqual(errors('THE FLOOR VANISHED'), []);
	assert.deepEqual(errors('IS IT SAFE?'), [], '"safe" is a warning, not an error');
	assert.equal(warnings('IS IT SAFE?').length, 1);
});

test('display text: capitals for Latin scripts, explicit breaks kept', () => {
	assert.equal(displayText('¿quién vendió primero?', 'es'), '¿QUIÉN VENDIÓ PRIMERO?');
	assert.equal(displayText('o chão  sumiu', 'pt-br'), 'O CHÃO SUMIU');
	assert.equal(displayText('पहले किसने बेचा?', 'hi'), 'पहले किसने बेचा?');
	assert.equal(displayText('my bot\n did  what?', 'en'), 'MY BOT\nDID WHAT?');
});

const master = (thumbnails: unknown[]): Storyboard =>
	({version: 1, channel: 'c', slug: 's', lang: 'en', sourceLang: 'en', title: 'T', fiction: true, scenes: [], sources: [], thumbnails}) as unknown as Storyboard;
const THREE = [
	{id: 'a', text: 'TOP CALLER?', expression: 'neutral', badger: true},
	{id: 'b', text: 'THE FLOOR VANISHED', expression: 'worried', badger: true},
	{id: 'c', text: 'WHO SOLD FIRST', expression: 'shocked', badger: false, badgerReaction: 'happy'},
];

test('master set: 3 variants, valid fields', () => {
	assert.deepEqual(checkMasterThumbnails(master(THREE), 'x').filter((i) => i.level === 'error'), []);
	assert.equal(checkMasterThumbnails(master(THREE.slice(0, 2)), 'x').filter((i) => i.level === 'warning').length, 1);
	assert.ok(checkMasterThumbnails(master([...THREE, {...THREE[0], id: 'd'}]), 'x').some((i) => i.level === 'error'));
	assert.ok(checkMasterThumbnails(master([{...THREE[0], expression: 'angry'}, THREE[1], THREE[2]]), 'x').some((i) => i.level === 'error'));
	assert.ok(checkMasterThumbnails(master([THREE[0], {...THREE[1], id: 'a'}, THREE[2]]), 'x').some((i) => /duplicate/.test(i.msg)));
	assert.ok(checkMasterThumbnails(master([]), 'x').some((i) => i.level === 'error'));
});

test('resolve: text from the translation, design from the master, machine flag', () => {
	const m = master(THREE);
	const es = {...m, lang: 'es', translation: {status: 'machine'}, thumbnails: [{id: 'b', text: 'EL PISO DESAPARECIÓ'}]} as unknown as Storyboard;
	const r = resolveThumb({channel: 'c', slug: 's', lang: 'es', variant: 1}, m, es);
	assert.equal(r.text, 'EL PISO DESAPARECIÓ');
	assert.equal(r.expression, 'worried');
	assert.equal(r.badger, true);
	assert.equal(r.badgerReaction, 'worried', 'derived from the expression');
	assert.equal(r.machine, true);
	const reviewed = {...es, translation: {status: 'native-reviewed', reviewer: 'x', date: '2026-11-24'}} as unknown as Storyboard;
	assert.equal(resolveThumb({channel: 'c', slug: 's', lang: 'es', variant: 1}, m, reviewed).machine, false);
	assert.equal(resolveThumb({channel: 'c', slug: 's', lang: 'en', variant: 0}, m, null).badgerReaction, 'judge');
	assert.equal(resolveThumb({channel: 'c', slug: 's', lang: 'en', variant: 2}, m, null).badgerReaction, 'happy', 'explicit reaction wins');
	assert.throws(() => resolveThumb({channel: 'c', slug: 's', lang: 'es', variant: 0}, m, es), /no entry with id "a"/);
	assert.throws(() => resolveThumb({channel: 'c', slug: 's', lang: 'pt-br', variant: 0}, m, null), /storyboard\.pt-br\.json/);
	const bad = {...es, thumbnails: [{id: 'b', text: 'GANANCIAS 100X'}]} as unknown as Storyboard;
	assert.throws(() => resolveThumb({channel: 'c', slug: 's', lang: 'es', variant: 1}, m, bad), /profit/);
});

test('variant: position 0|1|2, or the entry id the publish kit passes', () => {
	const list = THREE;
	assert.equal(variantIndex(0, list), 0);
	assert.equal(variantIndex(2, list), 2);
	assert.equal(variantIndex('1', list), 1);
	assert.equal(variantIndex('c', list), 2);
	assert.equal(variantIndex(3, list), -1);
	assert.equal(variantIndex('z', list), -1);
	assert.equal(variantIndex(null, list), -1);
	const m = master(THREE);
	assert.equal(resolveThumb({channel: 'c', slug: 's', lang: 'en', variant: 'b'}, m, null).variant, 1);
	assert.throws(() => resolveThumb({channel: 'c', slug: 's', lang: 'en', variant: 'z'}, m, null), /must be 0, 1, 2 or the id/);
});

test('every dev fixture resolves in every language it has', () => {
	const root = join(import.meta.dirname, '..', 'dev', 'fixtures');
	let n = 0;
	for (const slug of readdirSync(root)) {
		const dir = join(root, slug);
		const read = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Storyboard;
		const m = read('storyboard.json');
		for (const f of readdirSync(dir).filter((x) => /^storyboard(\.[a-z-]+)?\.json$/.test(x))) {
			const lang = (f === 'storyboard.json' ? 'en' : f.slice('storyboard.'.length, -'.json'.length)) as Lang;
			for (const variant of VARIANTS) {
				const r = resolveThumb({channel: '_dev', slug, lang, variant}, m, lang === 'en' ? null : read(f));
				assert.equal(r.machine, lang !== 'en');
				n++;
			}
		}
	}
	assert.ok(n >= 18);
});

// ---- fit ----

/** Fake font: every character 0.5 em wide, capitals 0.73 em tall, no descenders. */
const fake: InkMeasure = (text, size) => ({w: Array.from(text).length * 0.5 * size, a: 0.73 * size, d: 0, l: 0});

test('break units and line splits', () => {
	assert.deepEqual(breakUnits('WHO SOLD FIRST', false), ['WHO', 'SOLD', 'FIRST']);
	assert.deepEqual(breakUnits('谁先卖的？', true), ['谁', '先', '卖', '的？']);
	assert.deepEqual(breakUnits('「顶级」喊单', true), ['「顶', '级」', '喊', '单']);
	assert.deepEqual(breakUnits('AI交易', true), ['AI', '交', '易']);
	assert.equal(lineSplits(['A', 'B', 'C'], 3, false).length, 4);
	assert.deepEqual(lineSplits(['A', 'B'], 1, false), [['A B']]);
	assert.deepEqual(explicitLines('MY BOT\nDID WHAT?'), ['MY BOT', 'DID WHAT?']);
	assert.equal(explicitLines('ONE LINE'), null);
});

test('fit: biggest legible type inside the box', () => {
	const spec = {w: 560, h: 470, maxSize: 180, minSize: 96, maxLines: 3, gap: 0.14, unspaced: false};
	const f = fitHeadline('WHO SOLD FIRST', spec, fake);
	assert.ok(f);
	assert.deepEqual(f.lines.map((l) => l.text), ['WHO', 'SOLD', 'FIRST']);
	assert.ok(f.width <= spec.w && f.height <= spec.h && f.size <= spec.maxSize && f.size >= spec.minSize);
	const wide = fitHeadline('TOP CALLER?', {...spec, w: 2000, h: 200}, fake);
	assert.ok(wide);
	assert.equal(wide.lines.length, 1, 'a wide, short box keeps one line');
	const forced = fitHeadline('MY BOT\nDID WHAT?', spec, fake);
	assert.ok(forced);
	assert.deepEqual(forced.lines.map((l) => l.text), ['MY BOT', 'DID WHAT?']);
	assert.equal(fitHeadline('UNREADABLYLONGSINGLEWORD', spec, fake), null, 'below the legibility floor: null');
	// uniform pitch: baseline to baseline = ascent + descent + gap
	assert.ok(Math.abs(f.pitch - (f.ascent + f.descent + spec.gap * f.size)) < 1e-9);
});

// ---- layout ----

const CASES = VARIANTS.flatMap((v) => [false, true].map((badger) => ({v, badger})));

test('layouts: text clear of faces, frame and duration stamp; contrast', () => {
	for (const {v, badger} of CASES) {
		const L = layoutFor(v, badger);
		const name = `v${v}${badger ? '+badger' : ''}`;
		const box = L.text.box;
		assert.ok(box.x >= 56 && box.x + box.w <= THUMB.width - 56 && box.y >= 40 && box.y + box.h <= THUMB.height - 40, `${name}: text box in the safe area`);
		assert.ok(box.w >= 400, `${name}: text column at least 400 px`);
		const heads = [zooHeadBox(L.zoo), ...(L.badger ? [badgerHeadBox(L.badger)] : [])];
		for (const h of heads) assert.ok(!intersects(inflate(box, 60), h), `${name}: text box keeps >= 60 px from a head`);
		assert.ok(!intersects(box, YT_STAMP), `${name}: text clear of the duration stamp`);
		const faces = [zooFaceBox(L.zoo), ...(L.badger ? [badgerFaceBox(L.badger)] : [])];
		for (const f of faces) {
			assert.ok(!intersects(f, YT_STAMP), `${name}: eyes and mouth clear of the duration stamp`);
			assert.ok(f.x >= 0 && f.x + f.w <= THUMB.width && f.y >= 0 && f.y + f.h <= THUMB.height, `${name}: face inside the frame`);
		}
		if (L.badger) assert.ok(badgerHeadBox(L.badger).y + badgerHeadBox(L.badger).h <= THUMB.height - 4, `${name}: Badger's chin inside the frame`);
		const zh = zooHeadBox(L.zoo);
		assert.ok(zh.y >= 0 && zh.x >= 0 && zh.x + zh.w <= THUMB.width, `${name}: Zoo's hair is not cut by the frame`);
		assert.ok(contrast(L.text.color, L.text.behind) >= MIN_TEXT_CONTRAST, `${name}: text contrast`);
	}
});

test('layouts: Badger shares Zoo scale and sits on his dark overshirt (ART_GUIDE CV4a, CV4b)', () => {
	const coat = lightness(hexToRgb(BADGER_COLORS.coat));
	for (const v of VARIANTS) {
		const L = layoutFor(v, true);
		assert.ok(L.badger);
		assert.equal(L.badger.scale, L.zoo.scale, 'one scale for both characters');
		const face = badgerFaceBox(L.badger);
		const body = zooBodyBox(L.zoo);
		assert.ok(face.x >= body.x && face.x + face.w <= body.x + body.w, `v${v}: Badger's face is inside Zoo's torso width`);
		assert.ok(face.y >= L.zoo.y + RIG.zooChin * L.zoo.scale, `v${v}: Badger's face starts below Zoo's chin (the beard stays visible)`);
		assert.ok(coat - lightness(hexToRgb('#37383F')) >= 15, 'overshirt is >= 15 L* darker than the coat');
		// Zoo's torso is on light grey (L* >= 60) in every layout, the dark one included (its window)
		assert.ok(lightness(hexToRgb(L.panels.find((p) => p.clip)?.color ?? L.bg)) >= 60, `v${v}: light behind Zoo`);
	}
});

test('the three variants differ in composition', () => {
	const sig = VARIANTS.map((v) => {
		const L = layoutFor(v, false);
		return `${L.bg}|${L.zoo.x < THUMB.width / 2 ? 'face-left' : 'face-right'}|${L.plate ? 'plate' : 'plain'}|${L.zoo.scale}`;
	});
	assert.equal(new Set(sig).size, 3);
	assert.notEqual(layoutFor(0, false).bg, layoutFor(1, false).bg, 'light vs dark');
});

// ---- compose ----

test('compose: ink centred in the box, accent outside the ink, plate around it', () => {
	for (const v of VARIANTS) {
		const L = layoutFor(v as ThumbVariant, false);
		const fit = fitHeadline('WHO SOLD FIRST', {w: L.text.box.w, h: L.text.box.h, ...textStyle('en')}, fake);
		assert.ok(fit);
		const c = compose(L, fit);
		const midBox = L.text.box.y + L.text.box.h / 2;
		assert.ok(Math.abs(c.ink.y + c.ink.h / 2 - midBox) < 0.01, `v${v}: centred`);
		assert.ok(!intersects(c.accent, c.ink), `v${v}: accent outside the ink`);
		assert.ok(Math.abs(c.lines[0].baseline - c.ink.y - fit.ascent) < 1e-9, `v${v}: first baseline one ascent below the ink top`);
		if (L.plate) {
			assert.ok(c.plate);
			assert.ok(c.plate.x < 0, 'the plate bleeds off the left edge');
			assert.ok(c.plate.x <= c.accent.x && c.plate.x + c.plate.w >= c.ink.x + c.ink.w && c.plate.y < c.ink.y && c.plate.y + c.plate.h > c.ink.y + c.ink.h);
		} else assert.equal(c.plate, null);
	}
});

// ---- contrast ----

test('WCAG contrast', () => {
	assert.ok(Math.abs(contrast('#FFFFFF', '#000000') - 21) < 1e-9);
	assert.ok(Math.abs(contrast('#777777', '#777777') - 1) < 1e-9);
	assert.ok(contrast('#0B0C0F', '#E6E8EB') > 15);
	assert.ok(contrast('#F4F6F8', '#161A21') > 15);
	assert.ok(contrast('#29B8AD', '#E6E8EB') < 3, 'teal is decoration on light grey, never text');
});

// ---- png ----

test('png: encode, decode, downscale, enlarge', () => {
	const img = {width: 2, height: 2, data: new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 0])};
	const back = decodePng(encodePng(img));
	assert.deepEqual([back.width, back.height], [2, 2]);
	assert.deepEqual(Array.from(back.data), Array.from(img.data));
	assert.deepEqual(Array.from(downscale(img, 1, 1).data), [128, 128, 128]);
	const big = enlarge(img, 3);
	assert.deepEqual([big.width, big.height], [6, 6]);
	assert.deepEqual(Array.from(big.data.slice(0, 3)), [0, 0, 0]);
	assert.throws(() => decodePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])), /not a PNG/);
});
