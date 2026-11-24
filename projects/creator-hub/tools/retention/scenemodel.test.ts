import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {fitSceneModel, MODEL_MIN_EPISODES, type SceneRow} from './scenemodel.ts';
import {normalDraw, seededRandom} from './stats.ts';

/** Rows from a known model: upload level + early drop-off + template effect (+ Badger) + noise. */
const rows = (opts: {episodes: number; effects: Record<string, number>; badgerEffect?: number; order?: (e: number) => string[]; seed?: number; noise?: number}): SceneRow[] => {
	const random = seededRandom(opts.seed ?? 1);
	const out: SceneRow[] = [];
	for (let e = 0; e < opts.episodes; e++) {
		const level = 3 + random() * 2;
		const order = opts.order ? opts.order(e) : Object.keys(opts.effects);
		let t = 4;
		order.forEach((category, i) => {
			const length = 8 + ((e + i) % 3) * 2;
			const mid = t + length / 2;
			const badger = (e + i) % 2 === 0;
			out.push({
				upload: `u${e}`,
				episode: `ep${e}`,
				channel: 'c',
				sceneId: `s${i}`,
				t: mid,
				y: level + 12 * Math.exp(-mid / 8) + (opts.effects[category] ?? 0) + (badger ? (opts.badgerEffect ?? 0) : 0) + (opts.noise ?? 0.3) * normalDraw(random),
				category,
				categoryKind: 'type',
				badger,
				lengthSec: length,
			});
			t += length;
		});
	}
	return out;
};

const rotate = (list: string[]) => (e: number) => list.map((_, i) => list[(i + e) % list.length]!);

describe('scene model', () => {
	it('needs enough episodes and scenes', () => {
		assert.equal(fitSceneModel(rows({episodes: MODEL_MIN_EPISODES - 1, effects: {talk: 0, chart: 0, steps: 0}}), 'c', 'long'), null);
		assert.notEqual(fitSceneModel(rows({episodes: MODEL_MIN_EPISODES, effects: {talk: 0, chart: 0, steps: 0}}), 'c', 'long'), null);
	});
	it('measures each template against the median template, so one bad template does not flatter the others', () => {
		const model = fitSceneModel(rows({episodes: 12, effects: {talk: 0, chart: 0, steps: 0, quote: 6}, order: rotate(['talk', 'chart', 'steps', 'quote'])}), 'c', 'long')!;
		const effect = (c: string) => model.categories.find((x) => x.category === c)!;
		assert.ok(Math.abs(effect('quote').result!.estimate - 6) < 1, `quote ${effect('quote').result!.estimate}`);
		for (const c of ['talk', 'chart', 'steps']) {
			const r = effect(c).result;
			assert.ok(r === null || Math.abs(r.estimate) < 0.6, `${c} ${r?.estimate}`);
		}
		assert.equal(effect('quote').orderVaries, true);
		assert.equal(effect('quote').momentConfounded, false);
	});
	it('flags a template whose order never changes as tied to its moment', () => {
		const model = fitSceneModel(rows({episodes: 12, effects: {talk: 0, chart: 0, steps: 0, quote: 6}}), 'c', 'long')!; // always talk, chart, steps, quote
		const quote = model.categories.find((x) => x.category === 'quote')!;
		assert.equal(quote.orderVaries, false);
		assert.equal(quote.momentConfounded, true);
	});
	it('leaves out a template that never shares an upload with another template, with a note', () => {
		const base = rows({episodes: 8, effects: {talk: 0, chart: 0, steps: 0}, order: rotate(['talk', 'chart', 'steps'])});
		const lonely: SceneRow[] = [0, 1].map((i) => ({upload: 'u-lonely', episode: 'ep-lonely', channel: 'c', sceneId: `q${i}`, t: 10 + i * 10, y: 4, category: 'quote', categoryKind: 'type', badger: false, lengthSec: 9}));
		const model = fitSceneModel([...base, ...lonely], 'c', 'long')!;
		assert.ok(!model.categories.some((c) => c.category === 'quote'));
		assert.match(model.notes.join(' '), /quote never shared an upload with another template/);
	});
	it('estimates Badger within templates, and finds an injected Badger effect', () => {
		const model = fitSceneModel(rows({episodes: 12, effects: {talk: 0, chart: 0, steps: 0}, badgerEffect: -2, order: rotate(['talk', 'chart', 'steps'])}), 'c', 'long')!;
		assert.ok(model.badger);
		assert.ok(Math.abs(model.badger.result!.estimate + 2) < 0.5, `badger ${model.badger.result!.estimate}`);
		assert.ok(model.badger.result!.ci95[1] < 0);
		assert.equal(model.badger.categories, 3);
	});
	it('gives the expected loss of a typical template at every modelled scene', () => {
		const data = rows({episodes: 8, effects: {talk: 0, chart: 0, steps: 0}, order: rotate(['talk', 'chart', 'steps'])});
		const model = fitSceneModel(data, 'c', 'long')!;
		assert.equal(model.expected.size, data.length);
		const residuals = data.map((r) => r.y - model.expected.get(`${r.upload}|${r.sceneId}`)!);
		assert.ok(Math.abs(residuals.reduce((a, b) => a + b, 0) / residuals.length) < 0.5);
		assert.ok([2, 4, 8, 16, 32, 64].includes(model.tauSec));
	});
});
