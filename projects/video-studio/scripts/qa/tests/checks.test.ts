// Unit tests for the checks on synthetic probe facts and synthetic images. Run: node --test scripts/qa/tests/*.test.ts
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {applyTextTransform, type CharacterFact, type FrameFacts, type TextFact} from '../../../src/qa/protocol.ts';
import {bannedFindings, characterDomFindings, collisionFindings, decompose, faceFindings, oneFrameFindings, textFindings, zoneFindings} from '../lib/checks/dom.ts';
import {measureContrast} from '../lib/checks/contrast.ts';
import {modelPixelFindings, type ModelStats} from '../lib/checks/model.ts';
import {fitBlock, gradientFindings, isGradientBlock, prepareFrame, textureFindings} from '../lib/checks/banding.ts';
import {analyseScout, flickerFindings, type LumaFrame} from '../lib/checks/flicker.ts';
import {buildGeo, demoteInTransitions, demoteTransient, settledAt} from '../lib/motion.ts';
import {expectedBadgerBody, expectedEarCapSide, expectedPin, loadManifest} from '../lib/manifest.ts';
import {PROJECT_ROOT} from '../lib/bundle.ts';
import {blank, type Image} from '../lib/image.ts';
import {zonesFor} from '../lib/zones.ts';
import {blendReason, canonicalMatrix, parseArgs} from '../check.ts';

const manifest = loadManifest(PROJECT_ROOT);

const text = (o: Partial<TextFact> & {text: string; box: TextFact['box']}): TextFact => ({
	key: `k-${o.text}`,
	role: 'text',
	kind: 'html',
	rects: [o.box],
	lineBox: o.box,
	color: [11, 12, 15, 1],
	outlined: false,
	fontPx: 40,
	effPx: 40,
	weight: 800,
	family: 'Montserrat',
	opacity: 1,
	visibleFrac: 1,
	clippedBy: [],
	overflow: null,
	truncated: null,
	script: false,
	components: [],
	path: `div>${o.text}`,
	...o,
});

const char = (o: Partial<CharacterFact> & {kind: CharacterFact['kind']}): CharacterFact => ({
	key: `${o.kind}0`,
	view: o.kind === 'zoo' ? 'front' : 'left',
	pose: 'stand',
	head: o.kind === 'zoo' ? null : 'front',
	ctm: [1, 0, 0, 1, 600, 900],
	box: {x: 500, y: 100, w: 200, h: 800},
	headBox: {x: 540, y: 100, w: 140, h: 170},
	hands: [],
	pin: null,
	spots: [],
	effects: {filter: [], opacity: 1, blend: [], clip: [], cssTransform: false},
	props: {view: o.kind === 'zoo' ? 'front' : 'left'},
	droppedProps: [],
	localFrame: 0,
	frameSource: 'context',
	canonical: true,
	coveredBy: [],
	...o,
});

const frame = (o: Partial<FrameFacts> = {}): FrameFacts => ({v: 1, pass: 'scout', run: 'r', comp: 'C', frame: 0, width: 1920, height: 1080, settled: true, texts: [], chars: [], banned: [], ms: 1, errors: [], ...o});

describe('text checks', () => {
	it('reports partial clipping as an error and full hiding as information', () => {
		const f = frame({texts: [text({text: 'Cut', box: {x: 100, y: 100, w: 300, h: 40}, visibleFrac: 0.6, clippedBy: ['overflow']}), text({text: 'Hidden', box: {x: 100, y: 200, w: 300, h: 40}, visibleFrac: 0, clippedBy: ['clip-path']})]});
		const out = textFindings(f);
		assert.equal(out.find((x) => x.subject === '"Cut"')?.severity, 'error');
		assert.equal(out.find((x) => x.subject === '"Hidden"')?.severity, 'info');
	});
	it('separates the frame edge from container clipping, and flags overflow and small text', () => {
		const out = textFindings(
			frame({
				texts: [
					text({text: 'Edge', box: {x: 1800, y: 100, w: 300, h: 40}, visibleFrac: 0.4, clippedBy: ['frame']}),
					text({text: 'Spill', box: {x: 100, y: 300, w: 400, h: 40}, overflow: {left: 0, right: 80, top: 0, bottom: 0, box: {x: 100, y: 300, w: 320, h: 40}, beyondPlate: 74}}),
					text({text: 'Rim', box: {x: 100, y: 600, w: 300, h: 40}, overflow: {left: 0, right: 0, top: 0, bottom: 5, box: {x: 90, y: 590, w: 320, h: 55}, beyondPlate: 0}}),
					text({text: 'Descender', box: {x: 100, y: 700, w: 300, h: 44}, blockOverflow: {left: 0, right: 0, top: 0, bottom: 6, box: {x: 100, y: 700, w: 300, h: 38}}}),
					text({text: 'Runaway', box: {x: 100, y: 800, w: 600, h: 40}, blockOverflow: {left: 0, right: 300, top: 0, bottom: 0, box: {x: 100, y: 800, w: 300, h: 40}}}),
					text({text: 'Tiny', box: {x: 100, y: 400, w: 100, h: 16}, effPx: 16}),
					text({text: '0', box: {x: 100, y: 500, w: 10, h: 14}, effPx: 14, script: true}),
				],
			}),
		);
		assert.ok(out.some((x) => x.check === 'text-offframe'));
		assert.equal(out.find((x) => x.check === 'text-overflow' && x.subject === '"Spill"')?.severity, 'error', 'letters past the edge of their plate');
		assert.equal(out.find((x) => x.check === 'text-overflow' && x.subject === '"Rim"')?.severity, 'warn', 'letters over the plate border');
		assert.ok(!out.some((x) => x.subject === '"Descender"'), 'a descender below a tight line box, with no plate, is not a defect');
		assert.equal(out.find((x) => x.subject === '"Runaway"')?.severity, 'info', 'layout box exceeded with no plate: information');
		assert.ok(out.some((x) => x.check === 'text-small' && x.subject === '"Tiny"'));
		assert.ok(!out.some((x) => x.check === 'text-small' && x.subject === '"0"'), 'subscripts are exempt');
	});
	it('flags two texts painted over each other, not adjacent words or a deliberate double draw', () => {
		const title = text({text: 'Bridge drained overnight', box: {x: 100, y: 100, w: 600, h: 50}, path: 'div>h1'});
		const source = text({text: 'Source: Example Wire', box: {x: 400, y: 120, w: 420, h: 36}, path: 'div>p'});
		const c = collisionFindings(frame({texts: [title, source]}));
		assert.equal(c[0]?.check, 'text-collision');
		assert.equal(c[0]?.severity, 'error');
		const w1 = text({text: 'One', box: {x: 100, y: 300, w: 90, h: 40}, path: 'span:1'});
		const w2 = text({text: 'leaked', box: {x: 188, y: 300, w: 150, h: 40}, path: 'span:2'});
		assert.equal(collisionFindings(frame({texts: [w1, w2]})).length, 0, 'caption words side by side');
		const outline = text({text: 'HEADLINE', box: {x: 100, y: 500, w: 400, h: 80}, path: 'div>span:1'});
		const fill = text({text: 'HEADLINE', box: {x: 101, y: 500, w: 400, h: 80}, path: 'div>span:2'});
		assert.equal(collisionFindings(frame({texts: [outline, fill]})).length, 0, 'an outline layer under its fill');
		assert.equal(collisionFindings(frame({texts: [title, {...source, role: 'badge'}]})).length, 0, 'review badges never count');
	});
	it('ignores review badges', () => {
		assert.equal(textFindings(frame({texts: [text({text: 'SILENT PREVIEW', box: {x: 0, y: 0, w: 10, h: 10}, visibleFrac: 0.2, clippedBy: ['frame'], role: 'badge'})]})).length, 0);
	});
	it('flags the host name in capitals, written or painted by CSS, and nothing else', () => {
		const box = {x: 200, y: 200, w: 300, h: 40};
		const names = (t: TextFact) => textFindings(frame({texts: [t]})).filter((x) => x.check === 'text-name');
		assert.equal(names(text({text: 'ZOO', box}))[0]?.severity, 'error');
		assert.equal(names(text({text: "ZOO'S ONE FIX", box})).length, 1);
		assert.match(names(text({text: '$ZOO / SOL', box}))[0]?.message ?? '', /fictional ticker/, 'banned as an example ticker too');
		const painted = names(text({text: 'Hosted by Zoo', box, transform: 'uppercase'}));
		assert.equal(painted.length, 1);
		assert.match(painted[0].message, /text-transform: uppercase/);
		assert.equal(painted[0].subject, '"HOSTED BY ZOO"');
		for (const ok of ['Zoo', 'ZOORA AI', 'The Zoo & Badger Show', 'zoo', 'KAZOO']) assert.equal(names(text({text: ok, box})).length, 0, ok);
		assert.equal(names(text({text: 'Zoo', box, transform: 'capitalize'})).length, 0);
		assert.equal(names(text({text: 'ZOO', box, visibleFrac: 0, clippedBy: ['clip-path']})).length, 0, 'not shown in this frame');
	});
	it('applies CSS text-transform the way the browser paints it', () => {
		assert.equal(applyTextTransform('Hosted by Zoo', 'uppercase'), 'HOSTED BY ZOO');
		assert.equal(applyTextTransform("don't stop the zoo", 'capitalize'), "Don't Stop The Zoo");
		assert.equal(applyTextTransform('ZOO', 'lowercase'), 'zoo');
		assert.equal(applyTextTransform('Zoo', undefined), 'Zoo');
	});
});

describe('safe zones', () => {
	it('flags text and faces outside the 16:9 title-safe box', () => {
		const out = zoneFindings(frame({texts: [text({text: 'Corner', box: {x: 20, y: 20, w: 200, h: 40}})], chars: [char({kind: 'zoo', headBox: {x: 30, y: 100, w: 140, h: 170}})]}), zonesFor(1920, 1080));
		assert.ok(out.some((x) => x.check === 'safe-area' && x.subject === '"Corner"' && x.severity === 'error'));
		assert.ok(out.some((x) => x.check === 'safe-area' && x.subject.includes('face')));
	});
	it('checks visible hands only, one issue per character and side', () => {
		const low = (x: number) => ({x, y: 1000, w: 60, h: 70});
		const behindDesk = zoneFindings(frame({chars: [char({kind: 'zoo', hands: [low(700), low(900)], handsVisible: [0, 0.1]})]}), zonesFor(1920, 1080));
		assert.equal(behindDesk.filter((x) => x.subject.includes('hand')).length, 0, 'hands hidden behind a desk are not on screen');
		const shown = zoneFindings(frame({chars: [char({kind: 'zoo', hands: [low(700), low(900)], handsVisible: [1, -1]})]}), zonesFor(1920, 1080));
		const hands = shown.filter((x) => x.check === 'safe-area' && x.subject.includes('hand'));
		assert.equal(hands.length, 2, 'visible (and unknown) hands are checked');
		assert.equal(new Set(hands.map((x) => x.key)).size, 1, 'both hands below the safe area are one issue');
	});
	it('flags captions under the Shorts bottom overlay and marks the ads zone as information', () => {
		const f = frame({width: 1080, height: 1920, texts: [text({text: 'Caption', role: 'caption', box: {x: 200, y: 1650, w: 600, h: 60}})]});
		const out = zoneFindings(f, zonesFor(1080, 1920));
		assert.ok(out.some((x) => x.check === 'shorts-ui' && x.severity === 'error'));
		assert.ok(out.some((x) => x.check === 'shorts-ads' && x.severity === 'info'));
	});
});

describe('faces', () => {
	it('flags a caption over a face and text in the clear zone', () => {
		const zoo = char({kind: 'zoo'});
		const out = faceFindings(
			frame({
				chars: [zoo],
				texts: [text({text: 'Over', role: 'caption', box: {x: 520, y: 150, w: 300, h: 50}}), text({text: 'Near', box: {x: 700, y: 120, w: 120, h: 40}})],
			}),
		);
		assert.ok(out.some((x) => x.check === 'caption-face' && x.severity === 'error'));
		assert.ok(out.some((x) => x.check === 'text-face-zone' && x.severity === 'info'));
	});
});

describe('character transforms and identity', () => {
	it('decomposes matrices', () => {
		assert.equal(decompose([-1, 0, 0, 1, 0, 0]).mirrored, true);
		const s = decompose([1.3, 0, 0, 1, 0, 0]);
		assert.ok(Math.abs(s.sx - 1.3) < 1e-9 && Math.abs(s.sy - 1) < 1e-9);
		const r = decompose([Math.cos(0.1), Math.sin(0.1), -Math.sin(0.1), Math.cos(0.1), 0, 0]);
		assert.ok(Math.abs(r.rotationDeg - (0.1 * 180) / Math.PI) < 1e-9 && Math.abs(r.skewDeg) < 1e-9);
	});
	it('flags mirroring, stretching, filters, forks and view fallbacks', () => {
		const out = characterDomFindings(
			frame({
				chars: [
					char({kind: 'zoo', ctm: [-0.88, 0, 0, 0.88, 600, 900]}),
					char({kind: 'zoo', key: 'zoo1', ctm: [1.2, 0, 0, 0.9, 600, 900], effects: {filter: ['g: blur(4px)'], opacity: 1, blend: [], clip: [], cssTransform: false}}),
					char({kind: 'badger', canonical: false, spots: manifest.badgerBody.left}),
					char({kind: 'badger', key: 'b2', props: {view: 'side'}, view: 'left', spots: manifest.badgerBody.left}),
				],
			}),
			manifest,
		);
		const kinds = out.map((x) => `${x.check}:${x.key.split('|')[1]}`);
		assert.ok(kinds.includes('model-transform:mirror'));
		assert.ok(kinds.includes('model-transform:stretch'));
		assert.ok(out.some((x) => x.check === 'model-effect'));
		assert.ok(out.some((x) => x.check === 'model-component'));
		assert.ok(out.some((x) => x.check === 'model-view'));
	});
	it("checks Badger's markings against the frozen manifest", () => {
		const left = manifest.badgerBody.left;
		assert.equal(characterDomFindings(frame({chars: [char({kind: 'badger', spots: [...left, 'H-CHEEK-R']})]}), manifest).length, 0);
		const bad = characterDomFindings(frame({chars: [char({kind: 'badger', spots: [...left.slice(1), 'R-99']})]}), manifest);
		assert.equal(bad[0]?.check, 'model-spots');
		assert.match(bad[0].message, /missing L-WITHERS/);
		assert.match(bad[0].message, /extra R-99/);
	});
	it('knows the manifest conventions', () => {
		assert.equal(expectedBadgerBody(manifest, 'right', 'sit'), manifest.badgerBody.sit);
		assert.equal(expectedEarCapSide('front', 'left'), 'right');
		assert.equal(expectedEarCapSide('front', 'back'), 'left');
		assert.equal(expectedPin('front', 'stand'), 'right');
		assert.equal(expectedPin('back', 'stand'), 'hidden');
		assert.ok(manifest.palette.length > 40);
	});
	it('builds the canonical placement: same origin and size, never mirrored or stretched', () => {
		assert.deepEqual(canonicalMatrix([-0.88, 0, 0, 0.88, 600, 900]), [0.88, 0, -0, 0.88, 600, 900]);
		const m = canonicalMatrix([1.2, 0, 0, 0.8, 10, 20]);
		assert.ok(Math.abs(m[0] - Math.sqrt(0.96)) < 1e-6 && m[4] === 10 && m[5] === 20);
	});
});

describe('off-model pixels: Zoo\'s pin', () => {
	// a flat body (on the approved palette) with the teal pin at the given position; the canonical pin is at (240, 200)
	const body = (pin: [number, number] | null): Image => {
		const img = blank(400, 600);
		const fill = (x0: number, y0: number, x1: number, y1: number, rgb: readonly [number, number, number]) => {
			for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) img.data.set([rgb[0], rgb[1], rgb[2], 255], (y * 400 + x) * 4);
		};
		fill(100, 50, 300, 550, [0x16, 0x1a, 0x21]);
		if (pin) fill(pin[0], pin[1], pin[0] + 12, pin[1] + 12, manifest.colours.pin);
		return img;
	};
	const pins = (scene: [number, number] | null) => {
		const zoo = char({kind: 'zoo', ctm: [1, 0, 0, 1, 200, 550], box: {x: 100, y: 50, w: 200, h: 500}, headBox: null});
		const f = frame({width: 400, height: 600, chars: [zoo]});
		const stats: ModelStats = {compared: 0, skipped: [], worstSsim: 1, maxChangedFrac: 0};
		const S = body(scene);
		return modelPixelFindings(f, S, S, [{img: body([240, 200]), facts: null}], manifest, stats, new Map()).filter((x) => x.check === 'model-pin');
	};
	it('passes the canonical pin', () => assert.equal(pins([240, 200]).length, 0));
	it('reports a mirrored pin once, as the wrong side (not also as moved)', () => {
		const out = pins([148, 200]);
		assert.equal(out.length, 1);
		assert.match(out[0].message, /wrong side.*92 units from its canonical position/);
	});
	it('reports a moved and a missing pin', () => {
		assert.match(pins([240, 300])[0]?.message ?? '', /^pin moved: 100 units/);
		assert.match(pins(null)[0]?.message ?? '', /^pin missing/);
	});
});

describe('banned techniques and one-frame states', () => {
	it('grades banned techniques', () => {
		const out = bannedFindings(
			frame({
				banned: [
					{kind: 'css-gradient', detail: 'linear-gradient(...)', box: {x: 0, y: 0, w: 10, h: 10}, path: 'div'},
					{kind: 'css-filter', detail: 'grayscale(1)', box: {x: 0, y: 0, w: 10, h: 10}, path: 'div'},
					{kind: 'css-filter', detail: 'blur(3px)', box: {x: 0, y: 0, w: 10, h: 10}, path: 'div:2'},
				],
			}),
		);
		assert.deepEqual(out.map((x) => x.severity), ['error', 'warn', 'error']);
	});
	it('finds things shown or hidden for exactly one frame', () => {
		const facts = new Map<number, FrameFacts>();
		for (let f = 0; f < 5; f++) facts.set(f, frame({frame: f, texts: f === 2 ? [text({text: 'GLITCH', box: {x: 0, y: 0, w: 10, h: 10}})] : f === 4 ? [] : [text({text: 'Title', box: {x: 0, y: 50, w: 10, h: 10}})]}));
		const out = oneFrameFindings(facts);
		assert.ok(out.some((x) => x.key.startsWith('appear|') && x.frame === 2));
		assert.ok(out.some((x) => x.key.startsWith('vanish|') && x.frame === 2));
	});
});

describe('frames that blend two scenes', () => {
	it('skips scout transitions, the tail of a cross-fade and doubled characters, not a settled scene', () => {
		const zoo = (o: Partial<CharacterFact> = {}) => char({kind: 'zoo', ...o});
		const badger = (o: Partial<CharacterFact> = {}) => char({kind: 'badger', key: 'badger1', ...o});
		const op = (opacity: number) => ({effects: {filter: [], opacity, blend: [], clip: [], cssTransform: false}});
		assert.match(blendReason(5, frame({chars: [zoo()]}), new Set([5])) ?? '', /transition/);
		// the last frame of an eased fade: the incoming scene at 0.985 over the outgoing one
		assert.match(blendReason(152, frame({chars: [badger(), zoo(op(0.985))]}), new Set()) ?? '', /cross-fade/);
		assert.match(blendReason(7, frame({chars: [zoo(), zoo({key: 'zoo1'})]}), new Set()) ?? '', /same character twice/);
		assert.equal(blendReason(153, frame({chars: [zoo(), badger()]}), new Set()), null);
		assert.equal(blendReason(153, frame({chars: [zoo(op(0))]}), new Set()), null, 'fully transparent is simply not shown');
	});
});

describe('animation filter', () => {
	it('demotes geometry findings on elements that move, keeps settled ones', () => {
		const moving = (f: number) => frame({frame: f, texts: [text({text: 'Slide', box: {x: f * 20, y: 10, w: 100, h: 20}, visibleFrac: 0.5, clippedBy: ['overflow']})]});
		const still = (f: number) => frame({frame: f, texts: [text({text: 'Slide', box: {x: 0, y: 10, w: 100, h: 20}, visibleFrac: 0.5, clippedBy: ['overflow']})]});
		for (const make of [moving, still]) {
			const facts = [0, 1, 2].map(make);
			const geo = buildGeo(facts);
			const fs = textFindings(facts[1]);
			demoteTransient(fs, geo);
			const sev = fs.find((x) => x.check === 'text-clipped')?.severity;
			assert.equal(sev, make === moving ? 'info' : 'error');
			assert.equal(settledAt(geo, 'div>Slide|Slide', 1), make === still);
		}
	});
	it('demotes findings inside transitions except one-frame states', () => {
		const fs = textFindings(frame({frame: 5, texts: [text({text: 'Cut', box: {x: 0, y: 0, w: 10, h: 10}, visibleFrac: 0.5, clippedBy: ['overflow']})]}));
		demoteInTransitions(fs, new Set([5]));
		assert.equal(fs[0].severity, 'info');
	});
});

/** Text "glyphs" as filled bars, rendered once with and once without the text. */
const textImages = (w: number, h: number, bg: [number, number, number], fg: [number, number, number], bars: Array<[number, number, number, number]>, bg2?: {x: number; color: [number, number, number]}) => {
	const T = blank(w, h, [...bg, 255]);
	if (bg2) for (let y = 0; y < h; y++) for (let x = bg2.x; x < w; x++) T.data.set([...bg2.color, 255], (y * w + x) * 4);
	const P: Image = {width: w, height: h, data: T.data.slice()};
	for (const [x0, y0, x1, y1] of bars) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) P.data.set([...fg, 255], (y * w + x) * 4);
	return {P, T};
};

describe('contrast from pixels', () => {
	const bars: Array<[number, number, number, number]> = Array.from({length: 10}, (_, i) => [20 + i * 26, 20, 32 + i * 26, 60]);
	const t = text({text: 'Bars', box: {x: 16, y: 16, w: 270, h: 48}, color: [11, 12, 15, 1]});
	it('measures dark on light as high contrast', () => {
		const {P, T} = textImages(300, 80, [244, 246, 248], [11, 12, 15], bars);
		assert.ok((measureContrast(P, T, t)?.contrast ?? 0) > 15);
	});
	it('measures silver on the background as low contrast', () => {
		const {P, T} = textImages(300, 80, [230, 232, 235], [201, 206, 214], bars);
		const m = measureContrast(P, T, {...t, color: [201, 206, 214, 1]});
		assert.ok(m && m.contrast < 1.5, `got ${m?.contrast}`);
	});
	it('fails text that is readable over one part of its background only', () => {
		// light text: unreadable over the light left half, readable over the dark right half
		const {P, T} = textImages(300, 80, [230, 232, 235], [201, 206, 214], bars, {x: 150, color: [20, 20, 22]});
		const m = measureContrast(P, T, {...t, color: [201, 206, 214, 1]});
		assert.ok(m && m.contrast < 2, `got ${m?.contrast}`);
	});
	it('returns null when the text has no pixels (covered or invisible)', () => {
		const {T} = textImages(300, 80, [230, 232, 235], [0, 0, 0], []);
		assert.equal(measureContrast(T, T, t), null);
	});
});

describe('banding', () => {
	const W = 256;
	const H = 128;
	const img = (f: (x: number, y: number) => number): Image => {
		const im = blank(W, H, [0, 0, 0, 255]);
		for (let y = 0; y < H; y++)
			for (let x = 0; x < W; x++) {
				const v = Math.max(0, Math.min(255, Math.round(f(x, y))));
				im.data.set([v, v, v, 255], (y * W + x) * 4);
			}
		return im;
	};
	it('fits blocks: a dithered ramp is a gradient, flat fills and edges are not', () => {
		const ramp = prepareFrame(img((x, y) => 20 + x * 0.08 + ((x + y) % 2 ? 0.45 : -0.45)));
		assert.ok(ramp.grad.reduce((a, v) => a + v, 0) >= 16);
		assert.equal(prepareFrame(img(() => 200)).grad.reduce((a, v) => a + v, 0), 0);
		assert.equal(prepareFrame(img((x) => (x < 100 ? 30 : 37))).grad.reduce((a, v) => a + v, 0), 0);
		const fit = fitBlock(Float32Array.from({length: 32 * 32}, (_, i) => (i % 32) * 0.1), 32, 0, 0, 32, 32);
		assert.ok(Math.abs(fit.change - 3.2) < 0.01 && fit.residual < 1e-6 && isGradientBlock(fit));
	});
	it('reports a dark gradient as an error and texture as a warning', () => {
		const g = gradientFindings(frame({width: W, height: H}), img((x) => 15 + x * 0.1));
		assert.equal(g[0]?.check, 'gradient');
		assert.equal(g[0]?.severity, 'error');
		let seed = 7;
		const rnd = () => {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff;
			return seed / 0x7fffffff;
		};
		const noise = img(() => 128 + (rnd() - 0.5) * 30);
		const tx = textureFindings(frame({width: W, height: H}), noise);
		assert.equal(tx[0]?.check, 'texture');
		assert.equal(textureFindings(frame({width: W, height: H}), img(() => 90)).length, 0);
	});
});

describe('flicker', () => {
	const W = 256;
	const H = 256;
	const square = (x0: number, v = 0): Image => {
		const im = blank(W, H, [200, 200, 200, 255]);
		for (let y = 20; y < 40; y++) for (let x = x0; x < x0 + 20; x++) im.data.set([v, v, v, 255], (y * W + x) * 4);
		return im;
	};
	it('reports a one-frame element, not motion, and folds a flash into one finding', () => {
		const empty = blank(W, H, [200, 200, 200, 255]);
		assert.equal(flickerFindings(5, empty, square(20), empty, undefined)[0]?.check, 'flicker');
		assert.equal(flickerFindings(5, square(0), square(22), square(44), undefined).length, 0, 'a moving square is motion');
		assert.equal(flickerFindings(5, square(20), square(20), square(20), undefined).length, 0, 'a still frame');
		const flash = flickerFindings(5, empty, blank(W, H, [255, 255, 255, 255]), empty, undefined);
		assert.deepEqual(flash.map((x) => x.check), ['flash']);
	});
	// A card the colour of the wall it slides over, with a dark border and "text" bars: the 3-frame test alone
	// sees one-frame states where the text passes over wall-coloured pixels in both neighbours.
	const CW = 400;
	const CH = 600;
	const WALL = 244;
	const card = (top: number | null, left = 60, extra?: (im: Image) => void): Image => {
		const im = blank(CW, CH, [WALL, WALL, WALL, 255]);
		for (let y = 0; y < CH; y++) for (const x of [30, 31, 370, 371]) im.data.set([20, 20, 20, 255], (y * CW + x) * 4); // panel seams
		if (top !== null) {
			const px = (x: number, y: number, v: number) => {
				if (y >= 0 && y < CH && x >= 0 && x < CW) im.data.set([v, v, v, 255], (y * CW + x) * 4);
			};
			for (let y = top; y < top + 220; y++)
				for (let x = left; x < left + 280; x++) {
					const edge = y < top + 3 || y >= top + 217 || x < left + 3 || x >= left + 277;
					px(x, y, edge ? 15 : WALL);
				}
			// three lines of "text": dark bars with gaps, like words
			for (let line = 0; line < 3; line++)
				for (let y = top + 40 + line * 50; y < top + 70 + line * 50; y++)
					for (let x = left + 30; x < left + 250; x++) if (Math.floor((x - left) / 37) % 3 !== 2 && (x + y) % 7 !== 0) px(x, y, 18);
		}
		extra?.(im);
		return im;
	};
	it('keeps a card that drops in fast over a wall of its own colour (motion, not flicker)', () => {
		assert.equal(flickerFindings(5, card(null), card(40), card(95), undefined).length, 0, 'enters: found in the next frame, displaced');
		assert.equal(flickerFindings(5, card(20), card(75), card(110), undefined).length, 0, 'mid-drop: found in both, along a path');
		assert.equal(flickerFindings(5, card(80, 20), card(80, 70), card(80, 140), undefined).length, 0, 'a fast horizontal slide');
	});
	it('treats a pop on a swinging hand as animation, but not on a still one', () => {
		const W2 = 300;
		const H2 = 200;
		const scene = (handX: number | null) => {
			const im = blank(W2, H2, [230, 232, 235, 255]);
			if (handX !== null) for (let y = 80; y < 140; y++) for (let x = handX; x < handX + 50; x++) im.data.set([243, 190, 155, 255], (y * W2 + x) * 4);
			return im;
		};
		const facts = (f: number, handX: number) => frame({frame: f, width: W2, height: H2, chars: [char({kind: 'zoo', box: {x: 0, y: 0, w: 300, h: 200}, headBox: {x: 10, y: 10, w: 40, h: 40}, hands: [{x: handX, y: 80, w: 50, h: 60}]})]});
		// the hand is far away in both neighbours (a fast swing): only the probe knows it moved
		const swing = flickerFindings(5, scene(null), scene(120), scene(null), facts(5, 120), {prev: facts(4, 10), next: facts(6, 240)});
		assert.equal(swing.length, 0, 'a fast, turning hand is somewhere else on every frame');
		const still = flickerFindings(5, scene(null), scene(120), scene(null), facts(5, 120), {prev: facts(4, 120), next: facts(6, 120)});
		assert.equal(still[0]?.check, 'flicker', 'a hand that does not move but shows for one frame');
	});
	it('still reports content found in neither neighbour, and an element that jumps away and back', () => {
		const label = (im: Image) => {
			for (let y = 400; y < 440; y++) for (let x = 90; x < 330; x++) if ((x >> 3) % 2 === 0) im.data.set([20, 20, 20, 255], (y * CW + x) * 4);
		};
		const f = flickerFindings(5, card(80), card(80, 60, label), card(80), undefined);
		assert.equal(f[0]?.check, 'flicker', 'a one-frame label on a still card');
		const g = flickerFindings(5, card(20), card(75, 60, label), card(110), undefined);
		assert.equal(g[0]?.check, 'flicker', 'a one-frame label on a moving card');
		const j = flickerFindings(5, card(80), card(92), card(80), undefined);
		assert.equal(j[0]?.check, 'flicker', 'the card jumps 12 px for one frame and returns');
		assert.ok(Math.abs(Number(j[0]?.measured.jumpPx) - 12) <= 2, `jump of about 12 px, measured ${j[0]?.measured.jumpPx}`);
	});
	it('finds cuts, transition spans and pop candidates in scout frames', () => {
		const frames = new Map<number, LumaFrame>();
		const mk = (v: number, pop = false): LumaFrame => {
			const y = new Uint8Array(40 * 20).fill(v);
			if (pop) y.fill(255, 100, 106);
			return {w: 40, h: 20, y};
		};
		for (let f = 0; f < 30; f++) frames.set(f, mk(f < 10 ? 50 : f < 20 ? 200 : 120 + Math.min(f - 20, 5) * 0, f === 5));
		// frames 20-25: a slide (moderate change each frame)
		for (let f = 20; f < 26; f++) {
			const y = new Uint8Array(40 * 20).fill(120);
			for (let i = 0; i < 40 * 20 * 0.1; i++) y[(i * 7 + f * 13) % y.length] = 10;
			frames.set(f, {w: 40, h: 20, y});
		}
		const sa = analyseScout(frames);
		assert.ok(sa.boundaries.some(([a, b]) => a === 10 && b === 10), 'hard cut at 10');
		assert.ok(sa.boundaries.some(([a, b]) => a <= 20 && b >= 26), 'transition span');
		assert.ok(sa.popCandidates.includes(5));
	});
});

describe('arguments', () => {
	it('parses the CLI', () => {
		const a = parseArgs(['--entry', 'src/index.ts', '--comp', 'X', '--props', '{"a":1}', '--frames', '0-3', '--shorts-zone=ads', '--no-pixels']);
		assert.equal(a.comp, 'X');
		assert.deepEqual(a.props, {a: 1});
		assert.equal(a.shortsZone, 'ads');
		assert.equal(a.pixels, false);
		assert.throws(() => parseArgs(['--comp', 'X']), /--entry is required/);
		assert.throws(() => parseArgs(['--entry', 'e', '--comp', 'X', '--props', '[1]']), /JSON object/);
		assert.throws(() => parseArgs(['--entry', 'e', '--comp', 'X', '--bogus']), /unknown argument/);
		assert.throws(() => parseArgs(['--entry', 'e', '--comp', '../../src']), /not a composition id/, 'the id names the output folder');
	});
});
