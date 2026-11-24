// Unit tests for the visual QA checker's pure modules: transport, PNG, colour, SSIM, raster helpers, frame
// selection, zones, issue grouping, fiber helpers. Run: node --test scripts/qa/tests/*.test.ts
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deflateSync} from 'node:zlib';
import {describe, it} from 'node:test';
import {ChunkAssembler, decodeChunk, encodeChunks, qaRefId} from '../../../src/qa/protocol.ts';
import {currentFiber, localFrameFrom, serialiseProps, type Fiber} from '../../../src/qa/runtime/fiber.ts';
import {decodePng, encodePng} from '../lib/png.ts';
import {contrastRgb, deltaE76, hexToRgb, lab, percentile, rgbToHex} from '../lib/color.ts';
import {ssim} from '../lib/ssim.ts';
import {blank, components, crop, dilate, erode, intersectRect, resize, strokeRect, unionRect} from '../lib/image.ts';
import {defaultEveryN, parseFrameList, planSamples, scenesFromBoundaries, scoutStep} from '../lib/frames.ts';
import {formatOf, outside, zonesFor} from '../lib/zones.ts';
import {frameRanges, groupFindings, timecode, type Finding} from '../lib/issues.ts';
import {writeErrorReport} from '../lib/report.ts';

describe('console transport', () => {
	it('round-trips a payload split into chunks, out of order, with duplicates and noise', () => {
		const json = JSON.stringify({frame: 7, texts: Array.from({length: 50}, (_, i) => ({t: `text ${i} — “quoted” ünïcode`}))});
		const lines = encodeChunks('run1', 'pixels', 7, json, 100);
		assert.ok(lines.length > 5);
		const asm = new ChunkAssembler();
		let out: string | null = null;
		const shuffled = [...lines].reverse();
		shuffled.splice(2, 0, shuffled[0]); // duplicate
		for (const l of shuffled) {
			const c = decodeChunk(`Tab 0, console.log: ${l}`);
			assert.ok(c);
			out = asm.add(c) ?? out;
		}
		assert.equal(out, json);
		assert.deepEqual(asm.pending(), []);
	});
	it('ignores lines that are not probe chunks', () => {
		assert.equal(decodeChunk('hello'), null);
		assert.equal(decodeChunk('[zoora-qa] run pixels 3 2/1 {}'), null);
		assert.equal(decodeChunk('[zoora-qa] run bogus 3 1/1 {}'), null);
	});
	it('names the reference composition', () => assert.equal(qaRefId('ChartShort'), 'QaRef-ChartShort'));
});

/** A PNG whose rows use filter types 0-4, to exercise every unfilter path. */
const filteredPng = (w: number, h: number, rgba: Uint8Array): Buffer => {
	const stride = w * 4;
	const raw = Buffer.alloc(h * (stride + 1));
	const paeth = (a: number, b: number, c: number) => {
		const p = a + b - c;
		const pa = Math.abs(p - a);
		const pb = Math.abs(p - b);
		const pc = Math.abs(p - c);
		return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
	};
	for (let y = 0; y < h; y++) {
		const f = y % 5;
		raw[y * (stride + 1)] = f;
		for (let x = 0; x < stride; x++) {
			const v = rgba[y * stride + x];
			const a = x >= 4 ? rgba[y * stride + x - 4] : 0;
			const b = y > 0 ? rgba[(y - 1) * stride + x] : 0;
			const c = y > 0 && x >= 4 ? rgba[(y - 1) * stride + x - 4] : 0;
			const pred = [0, a, b, (a + b) >> 1, paeth(a, b, c)][f];
			raw[y * (stride + 1) + 1 + x] = (v - pred) & 255;
		}
	}
	const chunk = (type: string, body: Buffer) => {
		const len = Buffer.alloc(4);
		len.writeUInt32BE(body.length);
		return Buffer.concat([len, Buffer.from(type), body, Buffer.alloc(4)]); // CRC is not checked by the decoder
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(w, 0);
	ihdr.writeUInt32BE(h, 4);
	ihdr[8] = 8;
	ihdr[9] = 6;
	return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
};

describe('PNG codec', () => {
	it('round-trips RGBA through encodePng/decodePng', () => {
		const img = blank(7, 5, [10, 20, 30, 255]);
		img.data[(2 * 7 + 3) * 4] = 250;
		const back = decodePng(encodePng(img));
		assert.equal(back.width, 7);
		assert.equal(back.height, 5);
		assert.deepEqual(Array.from(back.data), Array.from(img.data));
	});
	it('decodes rows filtered with Sub, Up, Average and Paeth', () => {
		const w = 9;
		const h = 10;
		const px = new Uint8Array(w * h * 4);
		for (let i = 0; i < px.length; i++) px[i] = (i * 37 + (i >> 3) * 11) & 255;
		assert.deepEqual(Array.from(decodePng(filteredPng(w, h, px)).data), Array.from(px));
	});
	it('rejects non-PNG data', () => assert.throws(() => decodePng(new Uint8Array([1, 2, 3])), /not a PNG/));
});

describe('colour maths', () => {
	it('computes WCAG contrast ratios', () => {
		assert.equal(Math.round(contrastRgb([0, 0, 0], [255, 255, 255]) * 100) / 100, 21);
		assert.equal(contrastRgb([120, 120, 120], [120, 120, 120]), 1);
		// #767676 on white is the classic 4.54:1 grey
		assert.ok(Math.abs(contrastRgb(hexToRgb('#767676'), [255, 255, 255]) - 4.54) < 0.01);
	});
	it('converts to L*a*b* and measures ΔE', () => {
		const [L, a, b] = lab(255, 255, 255);
		assert.ok(Math.abs(L - 100) < 0.01 && Math.abs(a) < 0.01 && Math.abs(b) < 0.01);
		assert.equal(deltaE76([12, 34, 56], [12, 34, 56]), 0);
		assert.ok(deltaE76(hexToRgb('#29B8AD'), hexToRgb('#1F8E86')) > 10);
	});
	it('formats hex and percentiles', () => {
		assert.equal(rgbToHex([41, 184, 173]), '#29B8AD');
		assert.equal(percentile([1, 2, 3, 4, 5], 50), 3);
		assert.equal(percentile([10, 20], 0), 10);
		assert.ok(Number.isNaN(percentile([], 50)));
	});
});

describe('SSIM', () => {
	const W = 32;
	const H = 32;
	const img = (f: (x: number, y: number) => number) => Float32Array.from({length: W * H}, (_, i) => f(i % W, Math.floor(i / W)));
	it('is 1 for identical images', () => {
		const a = img((x, y) => (x * 7 + y * 3) % 255);
		assert.equal(ssim(a, a, W, H).mean, 1);
	});
	it('drops for a structural change and respects the mask', () => {
		const a = img((x) => (x < 16 ? 30 : 220));
		const b = img((x) => (x < 16 ? 220 : 30));
		const r = ssim(a, b, W, H);
		assert.ok(r.mean < 0.5);
		const mask = new Uint8Array(W * H);
		const none = ssim(a, b, W, H, mask);
		assert.equal(none.count, 0);
		assert.ok(Number.isNaN(none.mean));
	});
});

describe('raster helpers', () => {
	it('dilates, erodes and labels components', () => {
		const w = 10;
		const h = 6;
		const m = new Uint8Array(w * h);
		m[2 * w + 2] = 1;
		m[2 * w + 7] = 1;
		const d = dilate(m, w, h, 1);
		assert.equal(d.reduce((a, v) => a + v, 0), 18);
		assert.equal(erode(d, w, h, 1).reduce((a, v) => a + v, 0), 2);
		const {comps} = components(d, w, h);
		assert.equal(comps.length, 2);
		assert.deepEqual([comps[0].x0, comps[0].y0, comps[0].x1, comps[0].y1], [1, 1, 4, 4]);
	});
	it('crops, resizes by area and outlines', () => {
		const img = blank(4, 4, [0, 0, 0, 255]);
		img.data.set([255, 255, 255, 255], 0);
		const r = resize(img, 2, 2);
		assert.equal(r.data[0], 64); // one white pixel in a 2x2 block
		const c = crop(img, {x: -5, y: -5, w: 6, h: 6});
		assert.equal(c.width, 1);
		strokeRect(img, {x: 0, y: 0, w: 4, h: 4}, [255, 0, 0, 255], 1);
		assert.deepEqual(Array.from(img.data.subarray(4, 8)), [255, 0, 0, 255]);
	});
	it('intersects and unites rects', () => {
		assert.deepEqual(intersectRect({x: 0, y: 0, w: 10, h: 10}, {x: 5, y: 5, w: 10, h: 10}), {x: 5, y: 5, w: 5, h: 5});
		assert.equal(intersectRect({x: 0, y: 0, w: 1, h: 1}, {x: 2, y: 2, w: 1, h: 1}), null);
		assert.deepEqual(unionRect([{x: 0, y: 0, w: 1, h: 1}, {x: 4, y: 5, w: 1, h: 1}]), {x: 0, y: 0, w: 5, h: 6});
	});
});

describe('frame selection', () => {
	it('parses frame lists', () => {
		assert.deepEqual(parseFrameList('5, 1-3,3', 10), [1, 2, 3, 5]);
		assert.throws(() => parseFrameList('1-x', 10), /bad frame list/);
		assert.throws(() => parseFrameList('9-12', 10), /out of range/);
		assert.throws(() => parseFrameList('4-2', 10), /end before start/);
	});
	it('builds scenes from cuts and transitions', () => {
		// a hard cut at 100, a transition 200-206 (new scene from 206)
		assert.deepEqual(scenesFromBoundaries([[100, 100], [200, 206]], 300), [[0, 100], [100, 200], [206, 300]]);
		assert.deepEqual(scenesFromBoundaries([], 50), [[0, 50]]);
	});
	it('plans scene edges, mid-scene triplets, issues and the stride', () => {
		const p = planSamples({duration: 300, fps: 30, boundaries: [[150, 150]], issueFrames: [77], popCandidates: [200], everyN: 60});
		for (const f of [0, 149, 150, 299, 73, 74, 75, 223, 224, 225, 77, 199, 200, 201, 60, 120, 180, 240]) assert.ok(p.frames.includes(f), `frame ${f}`);
		assert.ok(p.reasons.get(150)?.has('scene-start'));
		assert.ok(p.reasons.get(77)?.has('issue'));
	});
	it('keeps stride frames out of transitions and respects the budget', () => {
		const p = planSamples({duration: 120, fps: 30, boundaries: [[58, 64]], issueFrames: [], popCandidates: [], everyN: 30});
		assert.ok(!p.frames.includes(60));
		assert.ok(p.frames.includes(64));
		const big = planSamples({duration: 20000, fps: 30, boundaries: [], issueFrames: Array.from({length: 10}, (_, i) => i * 1000), popCandidates: [], maxSamples: 60});
		assert.ok(big.frames.length <= 60);
		for (let i = 0; i < 10; i++) assert.ok(big.frames.includes(i * 1000));
	});
	it('scales the stride and the scout step with duration', () => {
		assert.equal(defaultEveryN(300, 30, 240), 30);
		assert.ok(defaultEveryN(18000, 30, 240) > 200);
		assert.equal(scoutStep(3600), 1);
		assert.equal(scoutStep(18000), 5);
	});
});

describe('zones', () => {
	it('detects the format', () => {
		assert.equal(formatOf(1920, 1080), 'landscape');
		assert.equal(formatOf(1080, 1920), 'vertical');
		assert.equal(formatOf(1080, 1080), 'square');
	});
	it('uses the title-safe box for 16:9 and the Shorts zones for 9:16', () => {
		assert.deepEqual(zonesFor(1920, 1080).safe, {x: 96, y: 54, w: 1728, h: 972});
		const v = zonesFor(1080, 1920);
		assert.equal(v.ui.length, 3);
		assert.deepEqual(v.adsSafe, {x: 48, y: 288, w: 840, h: 960});
		const small = zonesFor(720, 1280);
		assert.ok(Math.abs((small.adsSafe as {x: number}).x - 32) < 1e-9);
		assert.equal(zonesFor(1080, 1920, 'ads').ui.length, 0);
	});
	it('measures how far a box sticks out', () => {
		const o = outside({x: 50, y: 60, w: 100, h: 10}, {x: 96, y: 54, w: 1728, h: 972});
		assert.equal(o.left, 46);
		assert.equal(o.max, 46);
	});
});

describe('issues', () => {
	it('formats frame ranges and timecodes', () => {
		assert.equal(frameRanges([5, 1, 2, 3, 9, 10]), '1-3, 5, 9-10');
		assert.equal(timecode(95, 30), '0:03.05');
	});
	it('groups findings by check and key, keeping the worst', () => {
		const f = (frame: number, severity: Finding['severity'], score: number): Finding => ({check: 'contrast', severity, frame, box: {x: 0, y: 0, w: 1, h: 1}, subject: 's', key: 'k', message: `m${frame}`, measured: {}, score});
		const issues = groupFindings([f(3, 'warn', 1), f(1, 'error', 2), f(2, 'error', 5), {...f(9, 'info', 0), key: 'other'}]);
		assert.equal(issues.length, 2);
		assert.equal(issues[0].severity, 'error');
		assert.equal(issues[0].worst.frame, 2);
		assert.equal(issues[0].ranges, '1-3');
		assert.equal(issues[1].severity, 'info');
	});
});

describe('report', () => {
	it('writes an ERROR report with the reason when a run cannot finish', () => {
		const dir = mkdtempSync(join(tmpdir(), 'qa-report-'));
		try {
			const {md, json} = writeErrorReport(dir, {tool: 't', date: 'd', entry: 'src/x.ts', comp: 'X', props: {a: 1}}, 'Error: scene s03: price pane too small | x\n    at resolveEpisode');
			const text = readFileSync(md, 'utf8');
			assert.match(text, /\*\*ERROR\*\*: the visual check could not run/);
			assert.match(text, /Reason: Error: scene s03: price pane too small \\\| x$/m, 'first line only, table-safe');
			const data = JSON.parse(readFileSync(json, 'utf8'));
			assert.equal(data.verdict, 'ERROR');
			assert.match(data.error, /at resolveEpisode/, 'the full stack stays in the JSON');
			assert.deepEqual(data.issues, []);
		} finally {
			rmSync(dir, {recursive: true, force: true});
		}
	});
});

describe('fiber helpers', () => {
	const fiber = (tag: number, extra: Partial<Fiber> = {}): Fiber & {alternate: unknown; stateNode: unknown} => ({tag, type: null, memoizedProps: null, return: null, child: null, sibling: null, alternate: null, stateNode: null, ...extra}) as Fiber & {alternate: unknown; stateNode: unknown};
	it('serialises JSON-safe props and reports the dropped ones', () => {
		const r = serialiseProps({x: 1, view: 'front', nested: {a: [1, 2]}, fn: () => 1, between: {$$typeof: Symbol('react.element')}, bad: NaN, u: undefined});
		assert.deepEqual(r.props, {x: 1, view: 'front', nested: {a: [1, 2]}});
		assert.deepEqual(r.dropped.sort(), ['bad', 'between', 'fn']);
	});
	it('recomputes useCurrentFrame from the timeline and sequence context values', () => {
		assert.equal(localFrameFrom({frame: {C: 120}}, {cumulatedFrom: 30, relativeFrom: 10, playbackRate: 1}, 'C', 300, 0), 80);
		assert.equal(localFrameFrom({frame: {}}, null, 'C', 300, 42), 42); // a tab's first frame
		assert.equal(localFrameFrom({frame: {C: 999}}, null, 'C', 300, 0), 299); // clamped
		assert.equal(localFrameFrom({frame: {C: 100}}, {cumulatedFrom: 0, relativeFrom: 0, playbackRate: 2}, 'C', 300, 0), 200);
		assert.equal(localFrameFrom(null, null, 'C', 300, 0), null);
	});
	it('picks the committed copy of a fiber', () => {
		const root = fiber(3);
		const rootAlt = fiber(3);
		root.alternate = rootAlt;
		rootAlt.alternate = root;
		root.stateNode = {current: root};
		rootAlt.stateNode = root.stateNode;
		const cur = fiber(0, {return: root});
		const old = fiber(0, {return: rootAlt});
		cur.alternate = old;
		old.alternate = cur;
		root.child = cur;
		rootAlt.child = old;
		assert.equal(currentFiber(old), cur);
		assert.equal(currentFiber(cur), cur);
		const solo = fiber(5);
		assert.equal(currentFiber(solo), solo);
	});
});
