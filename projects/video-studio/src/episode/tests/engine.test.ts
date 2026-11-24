/**
 * Episode engine tests (pure modules; no browser). Run: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON src/episode/tests/run.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Storyboard, Timeline} from '../types.ts';
import {displayText, displayWords, joinTokens, parseMarkup, sourceIds, sourceOffsets, spokenText} from '../markup.ts';
import {findCueMs, revealTimes, wordIndexAtOffset} from '../cues.ts';
import {buildPages} from '../captions/pages.ts';
import {mockTimeline} from '../dev/mockTimeline.ts';
import {assertNoErrors, validateProps, validateStoryboard, validateTimeline, END_SCREEN_MS} from '../validate.ts';
import {episodeFrames, episodeSpans, shortSpans, spansFrames, TRANSITION_FRAMES} from '../timing.ts';
import {msToFrame, rand} from '../motion.ts';
import {scheduleZoo, zooAt} from '../perf/zoo.ts';
import {badgerAt, scheduleBadger} from '../perf/badger.ts';
import {directScene} from '../scenes/direction.ts';
import {BADGER_INSERT, CAPTIONS, LAYOUTS, SAFE, type Box, type Format} from '../layout/specs.ts';
import {placeCaption, sceneFaces} from '../layout/faces.ts';
import {loadTable, latinFontFile} from './fontMetrics.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, '..', 'dev', 'fixtures');
const load = (slug: string, lang = 'en'): Storyboard => JSON.parse(readFileSync(join(FIX, slug, lang === 'en' ? 'storyboard.json' : `storyboard.${lang}.json`), 'utf8')) as Storyboard;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const errors = (issues: Array<{level: string; where: string; msg: string}>) => issues.filter((i) => i.level === 'error').map((i) => `${i.where}: ${i.msg}`);
const DEMO_LANGS = ['en', 'es', 'pt-br', 'hi', 'zh'] as const;

// ---------- markup (mirrors scripts/voice/voicelib/markup.py) ----------
test('markup: display vs spoken text, source tags removed and punctuation repaired', () => {
	const n = 'It hit {$40,000|forty thousand dollars} in a day [src:a]. Then it fell [src:b,c] and stayed down.';
	assert.equal(displayText(n), 'It hit $40,000 in a day. Then it fell and stayed down.');
	assert.equal(spokenText(n), 'It hit forty thousand dollars in a day. Then it fell and stayed down.');
	assert.deepEqual(sourceIds(n), ['a', 'b', 'c']);
	const offs = sourceOffsets(n);
	assert.equal(displayText(n).slice(0, offs[0].offset), 'It hit $40,000 in a day');
	assert.throws(() => parseMarkup('broken {a|b'), /unclosed/);
	assert.throws(() => parseMarkup('two {a|b|c} pipes'), /exactly one/);
	assert.deepEqual(displayWords('没人看钱包，人人都看图。', 'zh').join(''), '没人看钱包，人人都看图。');
	assert.equal(joinTokens(['Example', 'source', '交易'], 'zh'), 'Example source交易');
	assert.equal(joinTokens(['un', 'caller'], 'es'), 'un caller');
	assert.equal(displayText('Hindi ends with a danda। Next [src:a]।'), 'Hindi ends with a danda। Next।');
});

// ---------- cues ----------
const words = (text: string, step = 300) => text.split(' ').map((t, i) => ({text: t, startMs: i * step, endMs: i * step + step - 40}));

test('cues: items appear on their cue words, in order, at least 500 ms apart', () => {
	const w = words('First you buy early. Then you post the call. They buy and you sell.');
	const t = revealTimes(['Buy early', 'Post the call', 'They buy', 'You sell'], w, ['buy', 'post', 'they', 'sell'], {lang: 'en', speechMs: 5000});
	assert.equal(t[0], w[2].startMs - 100);
	assert.equal(t[1], w[6].startMs - 100);
	for (let i = 1; i < t.length; i++) assert.ok(t[i] - t[i - 1] >= 500);
	// unmatched items are spread between matched neighbours
	const u = revealTimes(['zzz', 'Post the call', 'qqq'], w, undefined, {lang: 'en', speechMs: 5000});
	assert.ok(u[0] < u[1] && u[1] < u[2]);
	assert.equal(findCueMs(w, 'nothing', 0, 'en'), null);
	assert.equal(wordIndexAtOffset(w, w.map((x) => x.text).join(' '), 'First you buy early.'.length), 3);
});

// ---------- captions ----------
test('captions: 2-4 words per page, never across a sentence, timed in order', () => {
	const w = words('You post one chart. Ten thousand strangers buy your coin within the hour. Then the floor disappears.');
	const pages = buildPages(w, {lang: 'en'});
	for (const p of pages) {
		assert.ok(p.words.length >= 1 && p.words.length <= 4, p.text);
		assert.ok(p.text.length <= 24, p.text);
		assert.ok(!/[.!?]\s\S/.test(p.text), `page crosses a sentence: ${p.text}`);
	}
	assert.ok(pages.filter((p) => p.words.length >= 2).length >= pages.length - 1);
	for (let i = 1; i < pages.length; i++) assert.ok(pages[i].startMs >= pages[i - 1].endMs - 1, 'pages overlap');
	const zh = buildPages(
		Array.from('没人看钱包人人都看图表然后底部消失了').map((c, i) => ({text: c, startMs: i * 200, endMs: i * 200 + 180})),
		{lang: 'zh'},
	);
	for (const p of zh) assert.ok(p.text.length <= 10 && !p.text.includes(' '));
});

// ---------- mock timeline + validator on every fixture ----------
for (const lang of DEMO_LANGS) {
	test(`fixture engine-demo (${lang}): storyboard and mock timeline validate, for the episode and the Short`, () => {
		const sb = load('engine-demo', lang);
		const tl = mockTimeline(sb, {fps: 30});
		assert.deepEqual(errors(validateStoryboard(sb, {channel: '_dev', slug: 'engine-demo', lang: sb.lang, short: false})), []);
		assert.deepEqual(errors(validateTimeline(tl, sb, 30, {short: false})), []);
		assert.deepEqual(errors(validateStoryboard(sb, {channel: '_dev', slug: 'engine-demo', lang: sb.lang, short: true, shortId: 'short1'})), []);
		assert.deepEqual(errors(validateTimeline(tl, sb, 30, {short: true, shortId: 'short1'})), []);
		assert.equal(tl.mock, true);
		for (const s of tl.scenes) {
			assert.equal(s.durationMs % 100, 0, 'durations sit on the 100 ms grid (whole frames)');
			assert.equal(s.mouth.length, msToFrame(s.durationMs, 30));
		}
		assert.ok(tl.scenes[tl.scenes.length - 1].durationMs >= END_SCREEN_MS);
	});
}
test('fixture engine-demo-offer: the disclosure is shown and said', () => {
	const sb = load('engine-demo-offer');
	assert.deepEqual(errors(validateStoryboard(sb, {channel: '_dev', slug: 'engine-demo-offer', lang: 'en', short: false})), []);
});

test('validator: rejects the broken storyboards and timelines it must reject', () => {
	const base = load('engine-demo');
	const ctx = {channel: '_dev', slug: 'engine-demo', lang: 'en' as const, short: false};
	const expectErr = (sb: Storyboard, re: RegExp, c = ctx) => assert.ok(errors(validateStoryboard(sb, c)).some((e) => re.test(e)), `expected ${re}: ${errors(validateStoryboard(sb, c)).join(' | ')}`);
	let sb = clone(base);
	sb.scenes.forEach((s) => (s.badger = {present: false}));
	expectErr(sb, /Badger must appear/);
	sb = clone(base);
	sb.offers = ['x'];
	expectErr(sb, /needs onScreen.disclosure/);
	sb.scenes[5].onScreen = {...sb.scenes[5].onScreen, disclosure: 'I built this.'};
	expectErr(sb, /must SAY the disclosure/);
	sb = clone(base);
	sb.scenes[1].narration += ' [src:nope]';
	expectErr(sb, /not in storyboard.sources/);
	sb = clone(base);
	[sb.scenes[5], sb.scenes[6]] = [sb.scenes[6], sb.scenes[5]];
	expectErr(sb, /end screen must be the last scene/);
	sb = clone(base);
	sb.scenes[2].chart = {seed: 51, illustrative: false};
	expectErr(sb, /must be marked illustrative/);
	sb = clone(base);
	sb.scenes[1].onScreen = {...sb.scenes[1].onScreen, bullets: ['a', 'b', 'c', 'd', 'e']};
	expectErr(sb, /at most 4 bullets/);
	const es = clone(load('engine-demo', 'es'));
	delete es.ui?.fictionDisclaimer;
	expectErr(es, /"fictionDisclaimer" is required in a es storyboard/, {...ctx, lang: 'es'} as never);
	assert.ok(errors(validateProps({channel: 'zoora-ai', slug: 'x', lang: 'fr'}, false)).some((e) => /French is excluded/.test(e)));
	// timeline: wrong scene order and a short end screen
	const tl = mockTimeline(base);
	const bad: Timeline = clone(tl);
	[bad.scenes[0].id, bad.scenes[1].id] = [bad.scenes[1].id, bad.scenes[0].id];
	assert.ok(errors(validateTimeline(bad, base, 30, {short: false})).some((e) => /does not match storyboard scene/.test(e)));
	const short: Timeline = clone(tl);
	const last = short.scenes[short.scenes.length - 1];
	short.totalMs -= last.durationMs - 5000;
	last.durationMs = 5000;
	last.mouth = last.mouth.slice(0, 150);
	assert.ok(errors(validateTimeline(short, base, 30, {short: false})).some((e) => /must hold 20 s/.test(e)));
	assert.throws(() => assertNoErrors([{level: 'error', where: 'x', msg: 'y'}], 'label'), /label: 1 problem/);
});

// ---------- timing: transitions overlap visuals only; audio never moves ----------
test('timing: every scene starts on its own audio frame; transitions only add a pre-roll and tails', () => {
	const sb = load('engine-demo');
	const tl = mockTimeline(sb);
	const spans = episodeSpans(sb, tl, 30);
	spans.forEach((s, i) => {
		assert.equal(s.from, msToFrame(tl.scenes[i].startMs, 30), `${s.id} moved off its audio`);
		assert.equal(s.srcFrom, s.from);
		if (i + 1 < spans.length) {
			assert.equal(s.from + s.durationInFrames, spans[i + 1].from, 'contiguous');
			// the outgoing scene renders past its end only for the part of the transition after the cut (timing.ts)
			assert.equal(s.tail, spans[i + 1].transitionFrames - spans[i + 1].preroll);
			assert.ok(spans[i + 1].preroll <= spans[i + 1].transitionFrames && spans[i + 1].preroll < s.durationInFrames);
		}
	});
	assert.equal(spans[0].transition, 'cut');
	assert.equal(spans[2].transition, 'fade');
	assert.equal(spans[2].transitionFrames, TRANSITION_FRAMES.fade);
	assert.equal(spansFrames(spans), episodeFrames(tl, 30), 'transitions do not shorten the episode');
	// the Short: only its scenes, retimed from 0, each playing its own audio window
	const ss = shortSpans(sb, tl, 'short1', 30);
	assert.deepEqual(
		ss.map((s) => s.id),
		['s01', 's03', 's06'],
	);
	assert.equal(ss[0].from, 0);
	ss.forEach((s, i) => {
		if (i) assert.equal(s.from, ss[i - 1].from + ss[i - 1].durationInFrames);
		assert.equal(s.srcFrom, spans[s.index].from, 'audio trim = the scene frame in the full episode');
	});
});

// ---------- performance ----------
test('ZOO: seeded blinks every 2-6 s, swaps land on closed eyes, accents never under a blink', () => {
	const sb = load('engine-demo');
	const tl = mockTimeline(sb);
	const sc = tl.scenes[1];
	const frames = msToFrame(sc.durationMs, 30);
	const plan = {fps: 30, frames, seed: 'demo:s02', words: sc.words, mouth: sc.mouth, expression: 'neutral' as const, view: 'front' as const, changes: [{frame: 100, expression: 'worried' as const}], gestures: [{frame: 60, hold: 40}]};
	const s = scheduleZoo(plan);
	const s2 = scheduleZoo(plan);
	assert.deepEqual(s.blinks, s2.blinks, 'deterministic (seeded, not random)');
	assert.ok(s.blinks.length >= frames / 180 - 1);
	assert.equal(zooAt(s, 100).blink, 1, 'expression swap on a fully closed blink frame (CH5)');
	assert.equal(zooAt(s, 99).expression, 'neutral');
	assert.equal(zooAt(s, 100).expression, 'worried');
	for (const a of s.accents) {
		const z = zooAt(s, a.apex);
		assert.ok(z.blink === 0 || plan.changes.some((c) => Math.abs(c.frame - a.apex) < 8), `blink on an accent apex at ${a.apex}`);
		assert.ok(Math.abs(a.amp) >= 1.2 && Math.abs(a.amp) <= 2.0);
	}
	assert.equal(zooAt(s, 60).poseAmount, 1, 'the hand arrives on the reveal frame');
	assert.equal(zooAt(s, 5).mouth, sc.mouth[5]);
	assert.equal(zooAt(s, frames + 10).mouth, 'closed');
	assert.notDeepEqual(scheduleZoo({...plan, seed: 'other'}).blinks, s.blinks);
	assert.equal(scheduleZoo({...plan, view: 'threeQuarter'}).gestures.length, 0, 'no point outside the front view');
});

test('Badger: reactions are restrained and swaps are hidden in blinks', () => {
	const place = LAYOUTS.talk.landscape.badger;
	for (const reaction of ['judge', 'lookUp', 'happy', 'worried', 'shocked', 'neutral'] as const) {
		const s = scheduleBadger({fps: 30, frames: 300, seed: `b:${reaction}`, reaction, at: 150, place});
		const before = badgerAt(s, 140);
		const after = badgerAt(s, 200);
		assert.equal(before.expression, 'neutral');
		if (reaction === 'worried' || reaction === 'happy') {
			assert.equal(after.expression, reaction);
			assert.equal(badgerAt(s, 150).blink, 1, `${reaction}: swap under a closed blink`);
		}
		if (reaction === 'lookUp') assert.equal(after.head, 'upLeftScreen');
		if (reaction === 'judge') assert.ok(after.judge > 0.99 && Math.abs(after.headTilt) <= 4);
		if (reaction === 'happy') assert.ok(Math.abs(badgerAt(s, 150).tailWag) < 1e-9 && after.tailWag > 0);
		assert.ok(after.earsBack <= 0.7 && Math.abs(after.headTilt) <= 4);
	}
});

// ---------- faces vs captions and safe areas ----------
const inside = (b: Box, r: {left: number; right: number; top: number; bottom: number}) => b.x >= r.left && b.x + b.w <= r.right && b.y >= r.top && b.y + b.h <= r.bottom;
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('faces: every face of every template sits inside the safe area of its format', () => {
	for (const format of ['landscape', 'vertical'] as Format[]) {
		for (const type of ['hook', 'talk', 'chart', 'steps', 'quote', 'cta', 'endscreen'] as const) {
			for (const present of [false, true]) {
				for (const f of sceneFaces({type, badger: {present}}, format)) {
					const safe = format === 'vertical' ? SAFE.vertical : {left: SAFE.landscape.left, right: SAFE.landscape.right, top: SAFE.landscape.top, bottom: 1080};
					assert.ok(inside(f, safe), `${format} ${type} badger=${present}: face ${JSON.stringify(f)} outside the safe area`);
				}
			}
		}
	}
});

test('captions: a clear position exists for every shot; Shorts captions avoid the Shorts UI', () => {
	for (const format of ['landscape', 'vertical'] as Format[]) {
		const spec = CAPTIONS[format];
		for (const type of ['hook', 'talk', 'chart', 'steps', 'quote', 'cta', 'endscreen'] as const) {
			for (const present of [false, true]) {
				const faces = sceneFaces({type, badger: {present}}, format);
				for (const w of [300, 560, spec.box.w]) {
					const h = format === 'vertical' ? 2 * 66 * 1.12 + 28 : 2 * 54 * 1.15 + 28; // the tallest plate: two lines
					const p = placeCaption(format, w, h, faces);
					assert.ok(p.clear, `${format} ${type} badger=${present} w=${w}: no caption position clear of faces`);
					const box = {x: p.x, y: p.y, w, h};
					for (const f of faces) assert.ok(!overlaps(box, f), 'caption over a face');
					if (format === 'vertical') {
						assert.ok(box.y >= 0.1 * 1920 && box.y + box.h <= 0.8 * 1920, 'inside the top 10% / bottom 20% UI margins');
						assert.ok(box.x >= 54 && box.x + box.w <= 920, 'clear of the Shorts button column');
					} else assert.ok(box.y >= 54 && box.y + box.h <= 1026 && box.x >= 96 && box.x + box.w <= 1824);
				}
			}
		}
	}
	// the vertical insert shot keeps Badger's face above the caption band
	const ins = sceneFaces({type: 'talk', badger: {present: true}}, 'vertical').at(-1) as Box;
	assert.ok(ins.y + ins.h < CAPTIONS.vertical.box.y, 'insert face above the captions');
	assert.ok(BADGER_INSERT.vertical.scale * 3.5 <= 6, 'insert outline stays <= 6 px (ART_GUIDE SL5)');
});

// ---------- glyph coverage: no tofu in the dubbed fixtures ----------
test('fonts: Noto Sans Devanagari / SC and the brand fonts cover every character of the hi and zh fixtures', () => {
	const noto = {hi: 'node_modules/@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-700-normal.woff', zh: 'node_modules/@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-700-normal.woff'};
	const brand = loadTable(latinFontFile('heading', 800));
	for (const lang of ['hi', 'zh'] as const) {
		const sb = load('engine-demo', lang);
		const script = loadTable(noto[lang]);
		const texts = sb.scenes.flatMap((s) => [displayText(s.narration), ...Object.values(s.onScreen ?? {}).flat()]).concat(Object.values(sb.ui ?? {}));
		const missing = new Set<string>();
		for (const ch of texts.join('')) {
			const cp = ch.codePointAt(0) as number;
			if (cp <= 0x20 || cp === 0x200c || cp === 0x200d) continue;
			if (!brand.has(cp) && !script.has(cp)) missing.add(`${ch} U+${cp.toString(16)}`);
		}
		assert.deepEqual([...missing], [], `${lang}: characters with no glyph`);
	}
});

// ---------- chart scene: the rug completes on (or just before) its cue word; the whole shot lays out ----------
test('chart: every language and format: the rug lands on or just before its word, and every frame lays out with no 1-frame states', async () => {
	const {chartDataFor, planChart, checkChartPlan} = await import('../chart/plan.ts');
	for (const lang of DEMO_LANGS) {
		const sb = load('engine-demo', lang);
		const tl = mockTimeline(sb);
		const idx = sb.scenes.findIndex((x) => x.type === 'chart');
		const sc = sb.scenes[idx];
		const t = tl.scenes[idx];
		for (const format of ['landscape', 'vertical'] as Format[]) {
			const spans = format === 'vertical' ? shortSpans(sb, tl, 'short1', 30) : episodeSpans(sb, tl, 30);
			const span = spans.find((x) => x.index === idx);
			assert.ok(span, 'the chart scene is in the shot list');
			const box = LAYOUTS.chart[format].chart;
			const data = chartDataFor(sc, box);
			assert.ok(data.illustrative && data.source.kind === 'synthetic');
			const plan = planChart(sc, t, data, box, 30, lang);
			const cueWord = (sc.onScreen?.cues as string[])[1];
			const cue = findCueMs(t.words, cueWord, 0, lang);
			assert.ok(cue !== null, `${lang}: the rug cue "${cueWord}" is in the narration`);
			const cueF = msToFrame(cue, 30);
			assert.ok((plan.rugDone as number) <= cueF + 1 && (plan.rugDone as number) >= cueF - 45, `${lang} ${format}: rug done ${plan.rugDone} vs cue ${cueF}`);
			assert.ok(plan.revealEnd <= span.durationInFrames - 12, `${lang} ${format}: the reveal must end with a hold inside the scene`);
			checkChartPlan(plan, span.durationInFrames + span.tail, 'dark');
			const view = LAYOUTS.chart[format].solo.zoo.view ?? 'front';
			const dir = directScene({sc, tl: t, format, lang, fps: 30, frames: span.durationInFrames, seed: 'x', zooView: view, badgerPlace: null, badgerInsert: false, chart: plan});
			assert.ok(dir.reactionAt > (plan.rugDone as number), 'the reaction beat follows the rug');
			// he watches the chart until the turn, then looks into the lens for the deadpan beat
			const turnF = Math.min(span.durationInFrames - 20, (plan.rugDone as number) + 16);
			assert.notEqual(zooAt(dir.zoo as never, turnF - 10).lookX + zooAt(dir.zoo as never, turnF - 10).lookY, 0, 'eyes on the chart before the turn');
			assert.equal(zooAt(dir.zoo as never, turnF + 8).lookY, 0, 'eyes to camera after the turn');
			if (format === 'landscape') {
				// the point lands on the chart callout: the hand arrives as the pump completes (front view only)
				assert.equal(view, 'front');
				assert.equal(dir.zoo?.gestures[0]?.frame, plan.pumpDone);
				assert.equal(zooAt(dir.zoo as never, plan.pumpDone as number).poseAmount, 1);
			}
		}
	}
	assert.ok(rand('a') !== rand('b'));
});
