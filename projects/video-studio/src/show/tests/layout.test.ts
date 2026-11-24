/** Layout rules over every shot and segment in both formats, the diagram layout and the dial geometry. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {checkSegment, checkShot, faces, overlap} from '../layout/checks.ts';
import {FRAME, outlinePx, shotFor, shotNames} from '../layout/shots.ts';
import {BADGER_HEAD, STAGE, ZOO_HEAD} from '../layout/stage.ts';
import {CAPTION_BAND, END_ZONES, SEGMENT_BOXES} from '../layout/boxes.ts';
import {BASE_SHOT} from '../perf/plan.ts';
import {layoutDiagram, overlaps, type Box} from '../diagram/layout.ts';
import {angleOf, dialPoint, needlePath} from '../graphics/meterGeometry.ts';
import {ZOO_HEAD as BRAND_ZOO_HEAD, BADGER_HEAD as BRAND_BADGER_HEAD} from '../../branding/characterFrames.ts';
import {SIZE_COMPARISON} from '../../characters/relativeScale.ts';
import {SHOW_SEGMENTS, type Format} from '../types.ts';

const FORMATS: Format[] = ['landscape', 'vertical'];

test('shots: outlines 3-6 px; faces inside the safe area, above the captions, clear of the Shorts buttons', () => {
	for (const f of FORMATS) for (const name of shotNames(f)) assert.deepEqual(checkShot(f, name), [], `${f}/${name}`);
	// both characters always share one scale (the approved relative size)
	for (const f of FORMATS) for (const name of shotNames(f)) if (name !== 'none') assert.ok(outlinePx(shotFor(f, name)).min >= 3);
	assert.ok(STAGE.landscape.badger.x > 0.9 * SIZE_COMPARISON.spacingUnits, 'landscape keeps about the size panel spacing');
});

test('segments: text never covers a face and keeps one head width clear of Zoo\'s', () => {
	for (const f of FORMATS)
		for (const seg of SHOW_SEGMENTS) {
			// a landscape desk scene with copy is Zoo's single + card; without copy, the wide shot and no card
			const cases: Array<[string, boolean]> = seg === 'desk' && f === 'landscape' ? [['zooR', true], ['wide', false]] : [[BASE_SHOT[f][seg], true]];
			for (const [shot, card] of cases) assert.deepEqual(checkSegment(f, seg, shot as never, card), [], `${f}/${seg}/${shot}`);
		}
});

test('segments: the end-screen zones sit inside the outro card and the frame', () => {
	const card = SEGMENT_BOXES.landscape.outroEndScreen.card as Box;
	for (const z of END_ZONES.slots) {
		assert.ok(z.x >= card.x && z.y >= card.y && z.x + z.w <= card.x + card.w && z.y + z.h <= card.y + card.h, JSON.stringify(z));
		assert.ok(Math.abs(z.w / z.h - 16 / 9) < 0.01, '16:9 video zones');
	}
	const s = END_ZONES.subscribe;
	assert.ok(s.cx - s.r >= card.x && s.cx + s.r <= card.x + card.w && s.cy + s.r <= card.y + card.h);
	assert.ok(!overlap(END_ZONES.slots[1], {x: s.cx - s.r, y: s.cy - s.r, w: 2 * s.r, h: 2 * s.r}));
	// the outro's two-shot stays left of the zones
	for (const face of faces('landscape', shotFor('landscape', 'wideL'))) assert.ok(face.box.x + face.box.w < card.x);
});

test('captions: the band sits inside the safe area of each format', () => {
	assert.ok(CAPTION_BAND.vertical.x + CAPTION_BAND.vertical.w <= 950, 'left of the Shorts buttons');
	assert.ok(CAPTION_BAND.vertical.y >= 192 && CAPTION_BAND.vertical.y + CAPTION_BAND.vertical.h <= 1536);
	assert.ok(CAPTION_BAND.landscape.y + CAPTION_BAND.landscape.h <= FRAME.landscape.height - 54);
});

test('head boxes: the show uses the branding workflow\'s measured boxes', () => {
	assert.deepEqual(ZOO_HEAD, BRAND_ZOO_HEAD);
	assert.deepEqual(BADGER_HEAD, BRAND_BADGER_HEAD);
});

test('diagram: icons, labels and arrow labels never collide, for 2-5 nodes in rows and columns', () => {
	const boxes: Array<[Box, 'row' | 'column']> = [
		[{x: 1044, y: 178, w: 736, h: 668}, 'row'],
		[{x: 1044, y: 178, w: 736, h: 668}, 'column'],
		[{x: 102, y: 340, w: 876, h: 816}, 'column'],
	];
	for (const [box, o] of boxes)
		for (let n = 2; n <= 5; n++) {
			if (o === 'row' && n > 3) continue;
			const L = layoutDiagram(n, box, o);
			const all: Array<[string, Box]> = [...L.nodes.flatMap((nd, i) => [[`icon${i}`, nd.icon], [`label${i}`, nd.label]] as Array<[string, Box]>), ...L.arrows.map((a, i) => [`arrow${i}`, a.label] as [string, Box])];
			for (let i = 0; i < all.length; i++) {
				const [na, a] = all[i];
				assert.ok(a.x >= box.x - 1 && a.y >= box.y - 1 && a.x + a.w <= box.x + box.w + 1 && a.y + a.h <= box.y + box.h + 1, `${o}/${n}: ${na} leaves the box`);
				for (let j = i + 1; j < all.length; j++) assert.ok(!overlaps(a, all[j][1]), `${o}/${n}: ${na} overlaps ${all[j][0]}`);
			}
			for (const a of L.arrows) assert.ok(Math.hypot(a.x2 - a.x1, a.y2 - a.y1) >= 20, `${o}/${n}: arrows long enough to read`);
		}
});

test('meter geometry: the needle points left at 0, up at 0.5, right at 1', () => {
	assert.equal(angleOf(0), Math.PI);
	assert.equal(angleOf(1), 0);
	const up = dialPoint(0, 0, 100, 0.5);
	assert.ok(Math.abs(up.x) < 1e-9 && Math.abs(up.y + 100) < 1e-9);
	const left = dialPoint(0, 0, 100, 0);
	assert.ok(Math.abs(left.x + 100) < 1e-9 && Math.abs(left.y) < 1e-9);
	assert.match(needlePath(0, 0, 90, 0.5, 9, 3), /^M -?9 0 L -?3 -90 L -?3 -90/);
});
