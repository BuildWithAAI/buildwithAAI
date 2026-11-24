/**
 * Regression tests for the 2026-11-24 review of the episode engine: Badger's Shorts insert never covers a key beat;
 * nothing in a Short sits under the action-button column; transitions run in silence, land without a snap and carry
 * motion blur; caption pages and lines break by phrase and cut with their scene; landscape overlays stay off ZOO's head
 * and hands; steps -> quote is not a jump cut; the validator wants a SPOKEN disclosure, verified sources on real
 * channels and a timeline that matches the narration; the claim-gate check for Node tools.
 * Run with the other engine tests: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON src/episode/tests/run.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Lang, Storyboard, StoryboardScene, Timeline, TimelineScene, TimelineWord} from '../types.ts';
import {mockTimeline} from '../dev/mockTimeline.ts';
import {directScene, INSERT, placeInsert, type Beat} from '../scenes/direction.ts';
import {chartDataFor, planChart, type ChartPlan} from '../chart/plan.ts';
import {layoutChart} from '../../charts/chartLayout.ts';
import {
	BADGER_INSERT,
	CAPTIONS,
	FICTION_CARD,
	LAYOUTS,
	LOWER_THIRD,
	LOWER_THIRD_PAD,
	lowerThirdX,
	SAFE,
	SHORTS_BUTTONS,
	type Box,
	type Format,
	type TextSpec,
	type ZooPlace,
} from '../layout/specs.ts';
import {ACCENT_GAP_EM, hasMarkAbove, TITLE_HEADROOM_EM, titleLineTops} from '../layout/blocks.ts';
import {SOURCE_PAD_X, sourceSpanAt, sourceSpans, sourcesCardBox, sourcesFitWidth} from '../scenes/sources.ts';
import {isJumpCut, zooFace, zooPlacement} from '../layout/faces.ts';
import {
	blurSampleTimes,
	defaultTransition,
	episodeSpans,
	MOTION_BLUR,
	shortSpans,
	silentEdges,
	spansFrames,
	episodeFrames,
	transitionProgress,
	TRANSITION_FRAMES,
	SLIDE_PUSH,
	wipeStrips,
	type SceneSpan,
} from '../timing.ts';
import {msToFrame} from '../motion.ts';
import {buildPages} from '../captions/pages.ts';
import {fitText, type Measure} from '../text/fit.ts';
import {leansNext} from '../text/phrasing.ts';
import {validateStoryboard, validateTimeline} from '../validate.ts';
import {claimGateProblems, type ClaimGateFs} from '../node/claimGate.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const STUDIO = join(HERE, '..', '..', '..');
const FIX = join(HERE, '..', 'dev', 'fixtures');
const load = (slug: string, lang = 'en'): Storyboard => JSON.parse(readFileSync(join(FIX, slug, lang === 'en' ? 'storyboard.json' : `storyboard.${lang}.json`), 'utf8')) as Storyboard;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const errors = (issues: Array<{level: string; where: string; msg: string}>) => issues.filter((i) => i.level === 'error').map((i) => `${i.where}: ${i.msg}`);
const overlaps = (a: {from: number; to: number}, b: {from: number; to: number}) => a.from < b.to && b.from < a.to;
const boxesOverlap = (a: Box, b: Box, m = 0) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;

/** Every episode the tests can see: the dev fixture on mock timelines, plus the real engine demo when its voice output exists. */
type Case = {label: string; sb: Storyboard; tl: Timeline};
const cases = (): Case[] => {
	const out: Case[] = [];
	for (const lang of ['en', 'es', 'pt-br', 'hi', 'zh']) {
		const sb = load('engine-demo', lang);
		out.push({label: `engine-demo ${lang} (mock)`, sb, tl: mockTimeline(sb)});
	}
	for (const lang of ['en', 'es', 'pt-br']) {
		const sbPath = join(STUDIO, 'content', 'zoora-ai', '_engine-demo', lang === 'en' ? 'storyboard.json' : `storyboard.${lang}.json`);
		const tlPath = join(STUDIO, 'public', 'generated', 'zoora-ai', '_engine-demo', lang, 'timeline.json');
		if (existsSync(sbPath) && existsSync(tlPath)) out.push({label: `_engine-demo ${lang} (voiced)`, sb: JSON.parse(readFileSync(sbPath, 'utf8')), tl: JSON.parse(readFileSync(tlPath, 'utf8'))});
	}
	return out;
};

const chartPlanFor = (sc: StoryboardScene, t: TimelineScene, format: Format, lang: string): ChartPlan => {
	const box = LAYOUTS.chart[format].chart;
	return planChart(sc, t, chartDataFor(sc, box), box, 30, lang);
};

// ---------- Badger's insert in Shorts ----------
const insertOk = (ins: {from: number; to: number}, frames: number, beats: Beat[], what: string) => {
	for (const b of beats) assert.ok(!overlaps(ins, b), `${what}: the insert [${ins.from}, ${ins.to}) covers "${b.what}" [${b.from}, ${b.to})`);
	if (ins.to < frames) {
		assert.ok(ins.to - ins.from <= INSERT.len, `${what}: insert of ${ins.to - ins.from} f is longer than ${INSERT.len} f`);
		assert.ok(frames - ins.to >= INSERT.backMin || beats.some((b) => b.from === ins.to), `${what}: cuts back for only ${frames - ins.to} f`);
	} else assert.ok(frames - ins.from <= INSERT.len + INSERT.backMin, `${what}: holds ${frames - ins.from} f to the end`);
	assert.ok(Math.min(ins.to, frames) - ins.from >= INSERT.minLen, `${what}: insert shorter than ${INSERT.minLen} f`);
};

test('Shorts insert: never over the rug [rugDone - RUG, rugDone + HOLD], ZOO\'s turn, or the button press [press - 6, press + 12]', () => {
	let checked = 0;
	for (const {label, sb, tl} of cases()) {
		const lang = sb.lang;
		const short = (sb.shorts ?? [])[0];
		const spans = shortSpans(sb, tl, short.id, 30);
		for (const span of spans) {
			const sc = sb.scenes[span.index];
			if (!sc.badger?.present || (sc.type !== 'chart' && sc.type !== 'cta')) continue;
			const t = tl.scenes[span.index];
			const frames = span.durationInFrames;
			const chart = sc.type === 'chart' ? chartPlanFor(sc, t, 'vertical', lang) : undefined;
			const zooView = sc.type === 'chart' ? (LAYOUTS.chart.vertical.solo.zoo.view ?? 'front') : 'front';
			const d = directScene({sc, tl: t, format: 'vertical', lang, fps: 30, frames, seed: 'r', zooView, badgerPlace: BADGER_INSERT.vertical, badgerInsert: true, chart});
			assert.ok(d.insert, `${label} ${sc.id}: there is room for Badger's insert after the key beats`);
			const beats: Beat[] = [];
			if (chart && chart.rugDone !== null) {
				beats.push({from: chart.rugDone - (chart.rugFrames as number), to: chart.rugDone + (chart.rugHold as number), what: 'rug'});
				const turn = Math.min(frames - 20, chart.rugDone + 16);
				// ZOO's turn is kept clear whenever a readable insert still fits after it
				if (frames - (turn + 10) >= INSERT.minLen) beats.push({from: turn - 2, to: turn + 10, what: 'turn'});
			}
			if (sc.type === 'cta') beats.push({from: (d.press as number) - 6, to: (d.press as number) + 12, what: 'press'});
			insertOk(d.insert as {from: number; to: number}, frames, beats, `${label} ${sc.id}`);
			assert.equal(d.reactionAt, (d.insert as {from: number}).from + INSERT.lead, 'Badger reacts inside his insert');
			checked++;
			// the same scene cut shorter, frame by frame: an insert either fits after the beats or is dropped, never early
			for (let cut = frames; cut > frames - 80 && cut > 40; cut -= 3) {
				const e = directScene({sc, tl: t, format: 'vertical', lang, fps: 30, frames: cut, seed: 'r', zooView, badgerPlace: BADGER_INSERT.vertical, badgerInsert: true, chart});
				if (!e.insert) continue;
				const turn = chart && chart.rugDone !== null ? Math.min(cut - 20, chart.rugDone + 16) : null;
				const b2 = beats.filter((b) => b.what !== 'turn');
				if (turn !== null && cut - (turn + 10) >= INSERT.minLen) b2.push({from: turn - 2, to: turn + 10, what: 'turn'});
				for (const b of b2) assert.ok(!overlaps(e.insert, b), `${label} ${sc.id} at ${cut} f: insert covers "${b.what}"`);
			}
		}
	}
	assert.ok(checked >= 10, `checked ${checked} chart/CTA inserts`);
});

test('Shorts insert: placement rules (after the beats, ~1.5 s, back to the main shot for >= 1 s or hold to the cut)', () => {
	const beats: Beat[] = [{from: 100, to: 130, what: 'k'}];
	assert.deepEqual(placeInsert(90, 300, beats), {from: 130, to: 130 + INSERT.len});
	assert.deepEqual(placeInsert(140, 300, beats), {from: 140, to: 185});
	assert.deepEqual(placeInsert(130, 190, beats), {from: 130, to: 1190}, 'less than 1 s left after 45 f: hold to the end');
	assert.equal(placeInsert(130, 150, beats), null, 'no room for a readable reaction');
	assert.deepEqual(placeInsert(0, 300, [{from: 60, to: 70, what: 'a'}]), {from: 0, to: 45});
	assert.deepEqual(placeInsert(40, 300, [{from: 60, to: 70, what: 'a'}]), {from: 70, to: 115}, 'too close to a beat: after it');
	assert.deepEqual(placeInsert(30, 300, [{from: 60, to: 70, what: 'a'}]), {from: 30, to: 60}, 'an insert never runs into a later beat');
	assert.deepEqual(placeInsert(0, 300, [{from: 30, to: 40, what: 'a'}]), {from: 0, to: 30}, 'it ends where the next beat starts');
	// a soft beat (ZOO's turn) is skipped only when nothing readable fits after it
	const soft: Beat[] = [{from: 100, to: 118, what: 'rug'}, {from: 114, to: 126, what: 'turn', soft: true}];
	assert.deepEqual(placeInsert(118, 300, soft), {from: 126, to: 171});
	assert.deepEqual(placeInsert(118, 145, soft), {from: 118, to: 1145}, 'no room after the turn: right after the rug hold');
});

// ---------- the Shorts action-button column ----------
/** Every TextSpec in a layout object (with the column it is placed in, if any). */
const specsIn = (o: unknown, column: {top: number; bottom: number} | null, path: string, out: Array<{path: string; spec: TextSpec; column: {top: number; bottom: number} | null}>) => {
	if (!o || typeof o !== 'object') return;
	const r = o as Record<string, unknown>;
	if (r.box && r.role && typeof r.maxSize === 'number') {
		out.push({path, spec: r as unknown as TextSpec, column});
		return;
	}
	const col = (r.column as {top: number; bottom: number} | undefined) ?? column;
	for (const [k, v] of Object.entries(r)) if (k !== 'column') specsIn(v, col, `${path}.${k}`, out);
};

test('Shorts: no text box reaches under the action-button column (x > 950 below y 960), the chart panel included', () => {
	const all: Array<{path: string; spec: TextSpec; column: {top: number; bottom: number} | null}> = [];
	for (const [type, l] of Object.entries(LAYOUTS)) specsIn((l as Record<Format, unknown>).vertical, null, `LAYOUTS.${type}.vertical`, all);
	all.push({path: 'CAPTIONS.vertical', spec: CAPTIONS.vertical, column: null}, {path: 'FICTION_CARD.vertical', spec: FICTION_CARD.vertical, column: null});
	assert.ok(all.length >= 20, `found ${all.length} vertical text boxes`);
	for (const {path, spec, column} of all) {
		// a box with y 0 is placed by its template inside the column: it can reach the column's bottom
		const bottom = spec.box.y === 0 && column ? column.bottom : spec.box.y + spec.box.h;
		if (bottom > SHORTS_BUTTONS.top) assert.ok(spec.box.x + spec.box.w <= SHORTS_BUTTONS.left, `${path}: box ${JSON.stringify(spec.box)} reaches under the Shorts buttons`);
	}
	// the chart draws its own header, axis, callout and "Illustrative · fictional token" footer inside its panel
	const panel = LAYOUTS.chart.vertical.chart;
	assert.ok(panel.y + panel.h <= SHORTS_BUTTONS.top || panel.x + panel.w <= SHORTS_BUTTONS.left - 20, `the vertical chart panel ${JSON.stringify(panel)} reaches under the Shorts buttons`);
	for (const {sb, tl} of cases()) {
		const i = sb.scenes.findIndex((s) => s.type === 'chart');
		const plan = chartPlanFor(sb.scenes[i], tl.scenes[i], 'vertical', sb.lang);
		const m = layoutChart({data: plan.data, box: plan.box, surface: 'dark', callout: plan.callout, reveal: null, calloutVisible: true}, 10_000);
		assert.ok(m.footerLabel.x <= SHORTS_BUTTONS.left || m.footerLabel.y <= SHORTS_BUTTONS.top, `footer label ends at x ${m.footerLabel.x}, baseline ${m.footerLabel.y}`);
	}
	// the chip is the box the dub budget assumes (scripts/dub/lib/budgets.ts: 928 + 44) and sits left
	assert.equal(LAYOUTS.chart.vertical.chip.align, 'left');
});

// ---------- transitions: in silence, no snap, motion blur ----------
const voiced = (s: TimelineScene, frames: number) => {
	const e = silentEdges(s, frames);
	return {first: e.lead, lastSilentTail: e.tail};
};

test('transitions run in silence: done by the first voiced frame of the incoming scene, after the outgoing scene stops talking', () => {
	let seen = 0;
	for (const {label, sb, tl} of cases()) {
		const sets: Array<[string, SceneSpan[]]> = [['episode', episodeSpans(sb, tl, 30)], ['short', shortSpans(sb, tl, (sb.shorts ?? [])[0].id, 30)]];
		for (const [kind, spans] of sets) {
			assert.equal(spansFrames(spans), kind === 'episode' ? episodeFrames(tl, 30) : spansFrames(spans), 'length unchanged');
			spans.forEach((s, k) => {
				if (s.transition === 'cut') return assert.equal(s.transitionFrames + s.preroll, 0);
				seen++;
				const prev = spans[k - 1];
				const inV = voiced(tl.scenes[s.index], s.durationInFrames);
				const outV = voiced(tl.scenes[prev.index], prev.durationInFrames);
				assert.ok(s.transitionFrames - s.preroll <= inV.first, `${label} ${kind} ${s.id}: the ${s.transition} runs ${s.transitionFrames - s.preroll} f into the scene; ZOO speaks at f${inV.first}`);
				assert.ok(s.preroll <= outV.lastSilentTail, `${label} ${kind} ${s.id}: the pre-roll (${s.preroll} f) starts before ${prev.id} stops talking`);
				assert.equal(prev.tail, s.transitionFrames - s.preroll, 'the outgoing scene renders exactly the in-scene part');
				assert.ok(s.transitionFrames <= TRANSITION_FRAMES[s.transition]);
			});
		}
	}
	assert.ok(seen >= 10, `checked ${seen} transitions`);
	// a scene that talks to its last frame, then one that talks from frame 1: no silence, so a hard cut
	const sb = load('engine-demo');
	const tl = clone(mockTimeline(sb));
	tl.scenes[1].mouth = tl.scenes[1].mouth.map(() => 'ah');
	tl.scenes[2].mouth = tl.scenes[2].mouth.map((m, i) => (i >= 1 ? 'ee' : m));
	const spans = episodeSpans(sb, tl, 30);
	assert.equal(spans[2].transition, 'cut', 'no silence: the fade becomes a cut');
	assert.equal(spans[1].tail, 0);
});

test('transitions: progress is monotonic, never repeats a frame, and lands on rest without a snap', () => {
	for (const kind of ['fade', 'slide', 'wipe'] as const) {
		const T = TRANSITION_FRAMES[kind];
		const ps = Array.from({length: T}, (_, f) => transitionProgress(kind, f + 1, T));
		for (let f = 1; f < T; f++) assert.ok(ps[f] > ps[f - 1], `${kind}: frame ${f} does not advance`);
		assert.ok(ps[0] > 0 && ps[T - 1] < 1, `${kind}: every transition frame is an in-between`);
		assert.equal(transitionProgress(kind, T + 1, T), 1, `${kind}: exactly at rest after the last frame`);
		if (kind !== 'fade') {
			const px = ps.map((p) => (1 - p) * 1920);
			const lastStep = px[T - 1]; // to rest (0) on the next frame
			assert.ok(lastStep <= px[T - 2] - px[T - 1] + 1e-6, `${kind}: the last step (${lastStep.toFixed(1)} px) is bigger than the one before`);
			assert.ok(lastStep < 6, `${kind}: ${lastStep.toFixed(1)} px from rest on its last frame (the review measured an 11 px snap)`);
		}
	}
});

test('transitions: the slide is a short push under a fade (no strobing); the wipe edge is motion-blurred with single-blend strips', () => {
	const T = TRANSITION_FRAMES.slide;
	let worst = 0;
	for (let f = 0; f < T; f++) {
		const x0 = (1 - transitionProgress('slide', f, T)) * SLIDE_PUSH * 1920;
		const x1 = (1 - transitionProgress('slide', f + 1, T)) * SLIDE_PUSH * 1920;
		const step = x0 - x1;
		assert.ok(step <= 40, `slide frame ${f}: the layer moves ${step.toFixed(1)} px (the review measured up to 298)`);
		worst = Math.max(worst, step * transitionProgress('fade', f + 1, T)); // movement weighted by how visible the layer is
	}
	assert.ok(worst < 12, `slide: visible movement ${worst.toFixed(1)} px/frame`);
	// wipe: strips tile [left edge, width) without overlap; each strip's opacity is the share of the exposure it was revealed
	for (let f = 0; f < TRANSITION_FRAMES.wipe; f++) {
		const strips = wipeStrips(f + 1, TRANSITION_FRAMES.wipe, 1920);
		const sorted = [...strips].sort((a, b) => a.from - b.from);
		for (let i = 1; i < sorted.length; i++) assert.equal(sorted[i].from, sorted[i - 1].to, `wipe frame ${f}: strips overlap or leave a gap`);
		assert.equal(sorted[sorted.length - 1].to, 1920);
		assert.equal(sorted[sorted.length - 1].alpha, 1, 'fully revealed by every sample: opaque');
		for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i].alpha > sorted[i - 1].alpha, 'opacity grows toward the revealed side');
		const times = blurSampleTimes(f + 1);
		for (const st of sorted) {
			const x = (st.from + st.to) / 2;
			const revealed = times.filter((t) => Math.round((1 - transitionProgress('wipe', t, TRANSITION_FRAMES.wipe)) * 1920) <= x).length;
			assert.ok(Math.abs(st.alpha - revealed / MOTION_BLUR.samples) < 1e-9, `wipe frame ${f}: strip at ${x} has alpha ${st.alpha}, revealed by ${revealed}`);
		}
	}
});

// ---------- captions ----------
const timed = (text: string, step = 300) => text.split(' ').map((t, i) => ({text: t, startMs: i * step, endMs: i * step + step - 40}));

test('captions: pages break by phrase, with no one-word page and no page ending on a word that leans on the next', () => {
	const en = buildPages(timed('Most new memecoins on Pump.fun never see day two.'), {lang: 'en'});
	assert.deepEqual(
		en.map((p) => p.text),
		['Most new memecoins', 'on Pump.fun', 'never see day two.'],
	);
	const samples: Array<[string, string]> = [
		['en', "Here's day one, on a made-up coin. A launch, a burst of buying, then one big sell-off, and a slow bleed. If you'd rather read the data than chase the hype, subscribe."],
		['es', 'Aquí está el día uno, en una moneda inventada. Un lanzamiento, una ráfaga de compras, luego una gran venta masiva y una lenta agonía.'],
		['pt-br', 'Aqui está o dia um, numa moeda inventada. Um lançamento, uma onda de compras, depois uma grande venda em massa e uma lenta agonia.'],
	];
	for (const [lang, text] of samples) {
		const pages = buildPages(timed(text), {lang});
		for (const p of pages) {
			assert.ok(p.words.length >= 2, `${lang}: one-word page "${p.text}"`);
			assert.ok(p.words.length <= 4 && p.text.length <= 24, `${lang}: "${p.text}" over the limits`);
			assert.ok(!leansNext(p.words[p.words.length - 1].text, lang), `${lang}: page ends on a leaning word: "${p.text}"`);
		}
	}
	// a sentence of one word stays a one-word page; nothing crosses a sentence
	const one = buildPages(timed('Subscribe. Now you know.'), {lang: 'en'});
	assert.deepEqual(
		one.map((p) => p.text),
		['Subscribe.', 'Now you know.'],
	);
});

test('captions: two-line pages are balanced and never end a line on a leaning word', () => {
	const mono: Measure = (s, size) => s.length * size * 0.6;
	const spec = {maxWidth: 420, maxHeight: 400, maxSize: 40, minSize: 40, maxLines: 2, lineHeight: 1.1, balance: true, phrase: true, lang: 'es'};
	const r = fitText('una ráfaga de compras,', spec, mono);
	assert.equal(r.lines.length, 2);
	assert.ok(!leansNext(r.lines[0].split(' ').at(-1) as string, 'es'), JSON.stringify(r.lines));
	assert.ok(r.lines.every((l) => l.split(' ').length >= 2), `a one-word line: ${JSON.stringify(r.lines)}`);
	const off = fitText('una ráfaga de compras,', {...spec, phrase: false, balance: false}, mono);
	assert.deepEqual(off.lines, ['una ráfaga de', 'compras,'], 'without the rules: the greedy break the review found');
});

test('captions: a scene\'s last page is clipped to its scene and never runs over the next shot', async () => {
	const {captionTrack} = await import('../captions/pages.ts');
	const a = timed('and a slow bleed.');
	const track = captionTrack(
		[
			{fromMs: 0, toMs: 1250, words: a, faces: []},
			{fromMs: 1250, toMs: 5000, words: timed('If you would rather'), faces: []},
		],
		'en',
	);
	for (const p of track.filter((x) => x.startMs < 1250)) assert.ok(p.endMs <= 1250, `"${p.text}" ends at ${p.endMs} ms, after its scene`);
});

// ---------- landscape layout ----------
/** ZOO's hanging hands (front view), world units from his ground point; measured on renders at scale 1.5 (x 440). */
const handBoxes = (p: ZooPlace): Box[] =>
	[-1, 1].map((side) => {
		const x0 = side < 0 ? -140 : 75;
		return {x: p.x + x0 * p.scale, y: p.y - 430 * p.scale, w: 65 * p.scale, h: 110 * p.scale};
	});

test('landscape: the lower third clears ZOO\'s hands, and the sources line keeps a head-width off his head (CV4c)', () => {
	const lt = LOWER_THIRD.landscape as NonNullable<typeof LOWER_THIRD.landscape>;
	const maxW = Math.max(lt.name.box.w, lt.role.box.w) + LOWER_THIRD_PAD.left + LOWER_THIRD_PAD.right;
	for (const type of ['talk', 'cta'] as const) {
		const zoo = LAYOUTS[type].landscape.zoo;
		const plate: Box = {x: lowerThirdX(type), y: lt.box.y, w: maxW, h: lt.box.h};
		for (const h of handBoxes(zoo)) assert.ok(!boxesOverlap(plate, h, 16), `${type}: the lower third ${JSON.stringify(plate)} covers ZOO's hand ${JSON.stringify(h)}`);
	}
	for (const type of ['hook', 'talk', 'steps', 'cta'] as const) {
		const L = LAYOUTS[type].landscape;
		const face = zooFace(L.zoo);
		const clear: Box = {x: face.x - face.w, y: face.y - face.w, w: 3 * face.w, h: face.h + 2 * face.w};
		assert.ok(!boxesOverlap(L.sources.box, clear), `${type}: the sources line ${JSON.stringify(L.sources.box)} is within a head-width of ZOO's head ${JSON.stringify(face)}`);
	}
	const chart = LAYOUTS.chart.landscape;
	for (const z of [chart.solo.zoo, chart.pair.zoo]) {
		const face = zooFace(z);
		assert.ok(!boxesOverlap(chart.sources.box, {x: face.x - face.w, y: face.y - face.w, w: 3 * face.w, h: face.h + 2 * face.w}));
	}
});

test('landscape: steps -> quote keeps ZOO in place, and a default cut never becomes a jump cut', () => {
	assert.deepEqual(LAYOUTS.quote.landscape.zoo, LAYOUTS.steps.landscape.zoo);
	assert.deepEqual(LAYOUTS.quote.landscape.badger, LAYOUTS.steps.landscape.badger);
	const types = ['hook', 'talk', 'chart', 'steps', 'quote', 'cta', 'endscreen'] as const;
	for (const a of types)
		for (const b of types)
			for (const badger of [false, true]) {
				const prev = {id: 'a', type: a, narration: '', badger: {present: badger}} as StoryboardScene;
				const sc = {id: 'b', type: b, narration: '', badger: {present: badger}} as StoryboardScene;
				const jump = isJumpCut(zooPlacement(prev, 'landscape'), zooPlacement(sc, 'landscape'), 'landscape');
				const t = defaultTransition(prev, sc, 'landscape');
				if (jump) assert.notEqual(t, 'cut', `${a} -> ${b}: a default hard cut would be a jump cut`);
				assert.equal(defaultTransition(prev, {...sc, transitionIn: 'cut'}, 'landscape'), 'cut', 'an explicit cut is kept');
			}
	assert.equal(isJumpCut(LAYOUTS.steps.landscape.zoo, LAYOUTS.quote.landscape.zoo, 'landscape'), false);
	assert.equal(isJumpCut({x: 1500, y: 1480, scale: 1.5}, {x: 1620, y: 1480, scale: 1.5}, 'landscape'), true, 'the review case');
	assert.equal(isJumpCut({x: 440, y: 1480, scale: 1.5}, {x: 1500, y: 1480, scale: 1.5}, 'landscape'), false, 'a side switch is a reframe');
});

test('landscape quote with Badger: the card stops before his head', () => {
	const L = LAYOUTS.quote.landscape;
	const faces = [zooFace(L.zoo)];
	const badgerFaceX = L.badger.x + 60 * L.badger.scale; // view right: BADGER_FACE_LEFT mirrored (layout/faces.ts)
	assert.ok(L.card.x + L.card.w > badgerFaceX - 16, 'the full card would reach his head (so Quote.tsx narrows it)');
	for (const f of faces) assert.ok(!boxesOverlap({x: L.card.x, y: L.column.top, w: L.card.w, h: L.column.bottom - L.column.top}, f), 'the card clears ZOO');
});

// ---------- validator ----------
test('validator: an offer disclosure must be SAID; display-only {text|} markup is not', () => {
	const sb = clone(load('engine-demo-offer'));
	const ctx = {channel: '_dev', slug: 'engine-demo-offer', lang: 'en' as const, short: false};
	assert.deepEqual(errors(validateStoryboard(sb, ctx)), []);
	const cta = sb.scenes.find((s) => s.type === 'cta') as StoryboardScene;
	const d = String(cta.onScreen?.disclosure);
	cta.narration = `{${d}|} I made a free crypto security checklist. Grab it at the link.`;
	assert.ok(errors(validateStoryboard(sb, ctx)).some((e) => /must SAY the disclosure/.test(e)), 'display-only disclosure accepted');
	cta.narration = `{|${d}} I made a free crypto security checklist. Grab it at the link.`;
	assert.deepEqual(errors(validateStoryboard(sb, ctx)), [], 'a spoken-only side counts as said');
});

test('validator: real channels cite only verified https sources with an accessed date; dev fixtures are exempt', () => {
	const sb = clone(load('engine-demo'));
	const cited = sb.scenes.flatMap((s) => [...s.narration.matchAll(/\[src:([^\]]+)\]/g)].flatMap((m) => m[1].split(',').map((x) => x.trim())));
	assert.ok(cited.length > 0);
	const real = {channel: 'zoora-ai', slug: 'engine-demo', lang: 'en' as const, short: false};
	const asReal = {...sb, channel: 'zoora-ai'};
	for (const s of asReal.sources) if (cited.includes(s.id)) Object.assign(s, {status: 'verified', url: 'https://example.com/a', accessed: '2026-11-20'});
	assert.deepEqual(errors(validateStoryboard(asReal, real)), []);
	const bad = clone(asReal);
	const src = bad.sources.find((s) => cited.includes(s.id)) as Storyboard['sources'][number];
	src.status = 'unverified';
	src.url = 'http://example.com/a';
	src.accessed = '';
	const errs = errors(validateStoryboard(bad, real));
	assert.ok(errs.some((e) => /status is "unverified"/.test(e)) && errs.some((e) => /not https/.test(e)) && errs.some((e) => /accessed date/.test(e)), errs.join(' | '));
	const dev = clone(bad);
	dev.channel = '_dev';
	assert.ok(!errors(validateStoryboard(dev, {...real, channel: '_dev'})).some((e) => /sources\[/.test(e)), 'dev fixtures are exempt');
});

test('validator: a voiced timeline must say the storyboard\'s narration (edits after the voice step fail)', () => {
	const sb = load('engine-demo');
	const tl = clone(mockTimeline(sb));
	tl.mock = false;
	assert.deepEqual(errors(validateTimeline(tl, sb, 30, {short: false})), []);
	const edited = clone(sb);
	edited.scenes[1].narration = `${edited.scenes[1].narration} Guaranteed returns.`;
	assert.ok(errors(validateTimeline(tl, edited, 30, {short: false})).some((e) => /differ from the storyboard narration/.test(e)));
	tl.mock = true;
	assert.ok(!errors(validateTimeline(tl, edited, 30, {short: false})).some((e) => /differ from the storyboard narration/.test(e)), 'mock timelines are exempt');
});

// ---------- claim gate check (Node tools) ----------
test('claim gate check: missing, failing, foreign or stale reports block a real channel; a fresh pass does not', () => {
	const files = new Map<string, {text: string; mtime: number}>();
	const fs: ClaimGateFs = {
		exists: (p) => files.has(p),
		read: (p) => (files.get(p) as {text: string}).text,
		mtimeMs: (p) => (files.get(p) as {mtime: number}).mtime,
	};
	const studio = '/s';
	const base = {studio, channel: 'zoora-ai', slug: 'ep', lang: 'es' as Lang, fs};
	const report = join(studio, 'out', 'claims', 'ep.es.json');
	const dir = join(studio, 'content', 'zoora-ai', 'ep');
	files.set(join(dir, 'storyboard.json'), {text: '', mtime: Date.parse('2026-11-24T08:00:00Z')});
	files.set(join(dir, 'storyboard.es.json'), {text: '', mtime: Date.parse('2026-11-24T08:10:00Z')});
	files.set(join(dir, 'research.md'), {text: '', mtime: Date.parse('2026-11-24T07:00:00Z')});
	assert.match(claimGateProblems(base).join(), /no claim-gate report/);
	const put = (r: object) => files.set(report, {text: JSON.stringify(r), mtime: Date.parse('2026-11-24T09:00:00Z')});
	put({channel: 'zoora-ai', slug: 'ep', lang: 'es', pass: true, errors: 0, checkedAt: '2026-11-24T08:30:00Z'});
	assert.deepEqual(claimGateProblems(base), []);
	put({channel: 'zoora-ai', slug: 'ep', lang: 'es', pass: false, errors: 2, checkedAt: '2026-11-24T08:30:00Z'});
	assert.match(claimGateProblems(base).join(), /FAILED/);
	put({channel: 'zoora-ai', slug: 'ep', lang: 'en', pass: true, errors: 0, checkedAt: '2026-11-24T08:30:00Z'});
	assert.match(claimGateProblems(base).join(), /not zoora-ai\/ep \(es\)/);
	put({channel: 'zoora-ai', slug: 'ep', lang: 'es', pass: true, errors: 0, checkedAt: '2026-11-24T08:05:00Z'});
	assert.match(claimGateProblems(base).join(), /storyboard\.es\.json changed after the claim gate ran/);
	files.set(report, {text: '{', mtime: 0});
	assert.match(claimGateProblems(base).join(), /not valid JSON/);
	assert.deepEqual(claimGateProblems({...base, channel: '_dev'}), [], 'dev fixtures are exempt');
	assert.ok(msToFrame(1000, 30) === 30);
	void (null as unknown as TimelineWord);
});

test('final check: an accented capital in the display title is neither cut off nor run into the line above', () => {
	// es demo hook "MUERTAS EL / PRIMER DÍA": the reveal mask cut 0.17 em off the top of the Í accent (scripts/qa:
	// text-clipped, 16% of the line), and with the mask opened the accent ran into the E of the line above
	assert.ok(['PRIMER DÍA', 'AÑO', 'NÃO', 'VOCÊ', 'ÉXITO', 'ÜBER'].every(hasMarkAbove));
	assert.ok(!['MUERTAS EL', 'DEAD ON DAY ONE', 'ÇA', 'POR QUE ELAS MORREM?'].some(hasMarkAbove), 'a cedilla sits below');
	const size = 150;
	const lineH = size * 1.02;
	const plain = titleLineTops(['DEAD ON', 'DAY ONE'], size, lineH);
	assert.deepEqual(plain.tops, [0, Math.round(lineH)]);
	assert.equal(plain.height, 2 * lineH, 'titles without accents keep their height');
	const es = titleLineTops(['MUERTAS EL', 'PRIMER DÍA'], size, lineH);
	assert.equal(es.tops[1] - Math.round(lineH), Math.ceil(ACCENT_GAP_EM * size), 'room above the accented line');
	assert.equal(es.height, 2 * lineH + Math.ceil(ACCENT_GAP_EM * size));
	const first = titleLineTops(['ÚLTIMO DÍA'], size, lineH);
	assert.equal(first.tops[0], Math.ceil(ACCENT_GAP_EM * size), 'a first line with an accent moves down too (the kicker is above it)');
	assert.ok(TITLE_HEADROOM_EM * size >= 2 * 0.17 * size - 1, 'the reveal mask opens at least twice the measured overshoot');
});

test('final check: the sources line stays up across sentences that cite the same source (no one-frame blank)', () => {
	// es demo s02: three sentences, each [src:cg-cryptonews,cg-cryptobriefing]; the card blanked for one frame and wiped
	// in again at frames 281 and 455 (scripts/qa: one-frame-state, flicker)
	const cues = [100, 230, 380].flatMap((from) => [
		{id: 'a', from, claimEnd: from + 60},
		{id: 'b', from, claimEnd: from + 60},
	]);
	const spans = sourceSpans(cues, 600);
	assert.equal(spans.length, 1, JSON.stringify(spans));
	assert.deepEqual(spans[0], {id: 'b', from: 94, to: 530, enter: true, exit: true});
	for (let f = 94; f < 530; f++) assert.ok(sourceSpanAt(spans, f), `frame ${f}: no card`);
	// a different source swaps the text in place: no exit fade before it, no wipe-in, no gap
	const swap = sourceSpans([{id: 'a', from: 100, claimEnd: 150}, {id: 'c', from: 200, claimEnd: 260}], 600);
	assert.deepEqual(swap.map((s) => [s.id, s.from, s.to, s.enter, s.exit]), [['a', 94, 194, true, false], ['c', 194, 350, false, true]]);
	for (let f = 94; f < 350; f++) assert.ok(sourceSpanAt(swap, f), `frame ${f}: no card`);
	// a claim long after the card ended gets a new card with its own wipe
	const apart = sourceSpans([{id: 'a', from: 10, claimEnd: 20}, {id: 'a', from: 400, claimEnd: 420}], 600);
	assert.deepEqual(apart.map((s) => [s.from, s.to, s.enter]), [[4, 130, true], [394, 520, true]]);
	assert.equal(sourceSpanAt(apart, 200), null);
});

test('final check: the sources card, padding included, never leaves the safe area', () => {
	// pt-br demo s02 (landscape talk, box x 1010-1824): "Fonte: Estudo de sobrevivência da CoinGecko ·
	// cryptobriefing.com" filled the box, and the card's padding pushed the text 9 px past x 1824 (scripts/qa safe-area)
	const talk = LAYOUTS.talk.landscape.sources;
	const card = sourcesCardBox(talk.box, talk.align, 810, SAFE.landscape);
	assert.equal(card.x + card.w, SAFE.landscape.right, 'a long line slides left to the safe edge');
	assert.ok(card.x + SOURCE_PAD_X + 810 <= SAFE.landscape.right);
	assert.deepEqual(sourcesCardBox(talk.box, talk.align, 690, SAFE.landscape), {x: talk.box.x, w: 690 + 2 * SOURCE_PAD_X}, 'a line that fits does not move');
	// every template and format, every text width the fit can return
	for (const format of ['landscape', 'vertical'] as Format[]) {
		const safe = SAFE[format];
		for (const [type, layouts] of Object.entries(LAYOUTS)) {
			const spec = (layouts as Record<Format, {sources?: TextSpec}>)[format]?.sources;
			if (!spec) continue;
			const maxText = sourcesFitWidth(spec.box, safe);
			assert.ok(maxText <= spec.box.w);
			for (let tw = 0; tw <= maxText; tw += 7) {
				const c = sourcesCardBox(spec.box, spec.align, tw, safe);
				assert.ok(c.x >= safe.left && c.x + c.w <= safe.right, `${format} ${type}: card ${c.x}-${c.x + c.w} for a ${tw} px line`);
				if (spec.align === 'left' && spec.box.x + c.w <= safe.right) assert.equal(c.x, spec.box.x, `${format} ${type}: a ${tw} px line moved`);
			}
		}
	}
	assert.equal(sourcesFitWidth(LAYOUTS.talk.vertical.sources.box, SAFE.vertical), 972 - 2 * SOURCE_PAD_X, 'the full-width vertical line is fitted inside the padding');
});

