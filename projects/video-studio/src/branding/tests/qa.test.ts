/**
 * Branding QA tooling tests: the PNG codec and raster helpers, and every check function, on synthetic images.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {crc32, deflateSync} from 'node:zlib';
import {alphaBBox, blank, circleCoverage, composite, crop, decodePng, encodePng, pixel, resize, trimTransparent, type Image} from '../qa/png.ts';
import {
	bytesCheck,
	contrastAtSize,
	dimsCheck,
	insideCircleCheck,
	insideRectCheck,
	lightnessAtSize,
	maxOpaqueRadius,
	opaqueCheck,
	parseFfprobe,
	parseMaxVolume,
	silenceCheck,
	stingChecks,
	transparentCornersCheck,
} from '../qa/checks.ts';

/** Paint an axis-aligned rectangle into an image (test helper). */
const fillRect = (img: Image, x: number, y: number, w: number, h: number, rgba: [number, number, number, number]) => {
	for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) img.data.set(rgba, (yy * img.width + xx) * 4);
	return img;
};
/** Paint a filled ring (r0..r1) centred in the image. */
const ring = (img: Image, r0: number, r1: number, rgba: [number, number, number, number]) => {
	const c = img.width / 2;
	for (let y = 0; y < img.height; y++)
		for (let x = 0; x < img.width; x++) {
			const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
			if (d >= r0 && d <= r1) img.data.set(rgba, (y * img.width + x) * 4);
		}
	return img;
};

// ---------- PNG codec ----------
test('png: RGBA encode/decode round-trips exactly, including alpha', () => {
	const img = blank(7, 5, [10, 20, 30, 255]);
	fillRect(img, 2, 1, 3, 2, [200, 100, 50, 128]);
	img.data.set([1, 2, 3, 0], 0);
	const back = decodePng(encodePng(img));
	assert.equal(back.width, 7);
	assert.equal(back.height, 5);
	assert.deepEqual(Array.from(back.data), Array.from(img.data));
});

test('png: decodes RGB (type 2) with every filter type, and rejects bad input', () => {
	// hand-build a 3x5 RGB image whose rows use filters 0..4
	const w = 3;
	const rows = [
		[0, [10, 20, 30, 40, 50, 60, 70, 80, 90]],
		[1, [11, 21, 31, 1, 1, 1, 1, 1, 1]], // Sub
		[2, [1, 1, 1, 1, 1, 1, 1, 1, 1]], // Up
		[3, [5, 5, 5, 5, 5, 5, 5, 5, 5]], // Average
		[4, [2, 2, 2, 2, 2, 2, 2, 2, 2]], // Paeth
	] as const;
	const raw = Buffer.concat(rows.map(([f, px]) => Buffer.from([f, ...px])));
	const u32 = (n: number) => {
		const b = Buffer.alloc(4);
		b.writeUInt32BE(n);
		return b;
	};
	const chunk = (t: string, body: Buffer) => Buffer.concat([u32(body.length), Buffer.from(t), body, u32(crc32(Buffer.concat([Buffer.from(t), body])) >>> 0)]);
	const ihdr = Buffer.concat([u32(w), u32(rows.length), Buffer.from([8, 2, 0, 0, 0])]);
	const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
	const img = decodePng(png);
	// row 0 as given; row 1: Sub -> [11,21,31, 12,22,32, 13,23,33]
	assert.deepEqual(pixel(img, 0, 0).slice(0, 3), [10, 20, 30]);
	assert.deepEqual(pixel(img, 2, 1).slice(0, 3), [13, 23, 33]);
	// row 2: Up adds 1 to row 1
	assert.deepEqual(pixel(img, 2, 2).slice(0, 3), [14, 24, 34]);
	// row 3, pixel 0: Average of left (0) and up (12,22,32 at x=0 -> 12) -> 5 + floor(12/2) = 11
	assert.deepEqual(pixel(img, 0, 3).slice(0, 3), [11, 16, 21]);
	assert.equal(pixel(img, 1, 4)[3], 255);
	assert.throws(() => decodePng(Buffer.from('not a png')), /not a PNG/);
});

test('png: resize is an area average (no ringing); crop, trim, bbox and composite', () => {
	const img = blank(4, 4, [0, 0, 0, 255]);
	fillRect(img, 0, 0, 2, 4, [255, 255, 255, 255]);
	const half = resize(img, 2, 2);
	assert.deepEqual(pixel(half, 0, 0), [255, 255, 255, 255]);
	assert.deepEqual(pixel(half, 1, 1), [0, 0, 0, 255]);
	const one = resize(img, 1, 1);
	assert.ok(Math.abs(pixel(one, 0, 0)[0] - 128) <= 1, 'mean of half white, half black');
	const t = blank(10, 6);
	fillRect(t, 3, 2, 4, 2, [9, 9, 9, 255]);
	assert.deepEqual(alphaBBox(t), {x: 3, y: 2, w: 4, h: 2});
	assert.deepEqual([trimTransparent(t).width, trimTransparent(t).height], [4, 2]);
	assert.equal(alphaBBox(blank(3, 3)), null);
	assert.deepEqual([crop(t, 8, 4, 10, 10).width, crop(t, 8, 4, 10, 10).height], [2, 2], 'crop clamps to the image');
	const base = blank(4, 4, [0, 0, 0, 255]);
	const top = blank(2, 2, [255, 0, 0, 255]);
	const c = composite(base, top, 1, 1, () => 0.5);
	assert.deepEqual(pixel(c, 1, 1).slice(0, 3), [128, 0, 0]);
	assert.deepEqual(pixel(c, 0, 0).slice(0, 3), [0, 0, 0]);
	assert.equal(circleCoverage(5, 5, 5.5, 5.5, 3), 1);
	assert.equal(circleCoverage(0, 0, 50, 50, 3), 0);
});

// ---------- checks ----------
test('checks: size, bytes, opacity and transparent corners', () => {
	assert.ok(dimsCheck('x', blank(2560, 1, [0, 0, 0, 255]), 2560, 1).ok);
	assert.ok(!dimsCheck('x', blank(2559, 1), 2560, 1).ok);
	assert.ok(bytesCheck('x', 6_000_000, 6_000_000).ok);
	assert.ok(!bytesCheck('x', 1_000_000, 1_000_000, true).ok, 'watermark must be LESS than 1 MB');
	assert.ok(opaqueCheck('x', blank(3, 3, [1, 1, 1, 255])).ok);
	assert.ok(!opaqueCheck('x', blank(3, 3, [1, 1, 1, 254])).ok);
	const wm = blank(10, 10);
	fillRect(wm, 2, 2, 6, 6, [1, 1, 1, 255]);
	assert.ok(transparentCornersCheck('x', wm).ok);
	assert.ok(!transparentCornersCheck('x', blank(10, 10, [0, 0, 0, 255])).ok);
});

test('checks: key content inside the safe rect, with margin and overflow reported', () => {
	const key = blank(100, 50);
	fillRect(key, 20, 10, 30, 20, [255, 0, 255, 255]);
	assert.ok(insideRectCheck('x', key, {x: 10, y: 5, w: 80, h: 40}).ok);
	assert.ok(!insideRectCheck('x', key, {x: 10, y: 5, w: 80, h: 40}, 12).ok, '12 px margin pushes the left edge past x=20');
	const bad = insideRectCheck('x', key, {x: 25, y: 5, w: 80, h: 40});
	assert.ok(!bad.ok && bad.detail.includes('"left":5'));
	assert.ok(!insideRectCheck('x', blank(10, 10), {x: 0, y: 0, w: 10, h: 10}).ok, 'an empty key layer fails');
});

test('checks: circle containment and contrast at display size', () => {
	const key = ring(blank(200, 200), 40, 60, [255, 255, 255, 255]);
	assert.ok(Math.abs(maxOpaqueRadius(key, 100, 100) - 60) < 1);
	assert.ok(insideCircleCheck('x', key, 0.65).ok);
	assert.ok(!insideCircleCheck('x', key, 0.55).ok);
	// a silver ring on black reads strongly at 98 px; a dark-grey ring does not
	const full = (rgb: [number, number, number]) => ring(blank(200, 200, [11, 12, 15, 255]), 40, 60, [...rgb, 255]);
	const strong = contrastAtSize(full([201, 206, 214]), key, 98);
	const weak = contrastAtSize(full([40, 40, 44]), key, 98);
	assert.ok(strong.ratio > 7, `silver ${strong.ratio.toFixed(2)}`);
	assert.ok(weak.ratio < 2, `grey ${weak.ratio.toFixed(2)}`);
	// a hairline subject vanishes when downsampled: almost no pixel keeps >= 50% coverage
	const hair = ring(blank(800, 800), 200, 201, [255, 255, 255, 255]);
	assert.ok(contrastAtSize(ring(blank(800, 800, [0, 0, 0, 255]), 200, 201, [255, 255, 255, 255]), hair, 98).subjectPx < 5);
	assert.ok(lightnessAtSize(blank(10, 10, [255, 255, 255, 255]), 5, 0.5, 0.5) > 99);
});

test('checks: ffprobe facts, sting rules and silence', () => {
	const json = JSON.stringify({
		streams: [
			{codec_type: 'video', codec_name: 'h264', profile: 'High', width: 1920, height: 1080, r_frame_rate: '30/1', pix_fmt: 'yuv420p', color_space: 'bt709'},
			{codec_type: 'audio', codec_name: 'aac'},
		],
		format: {duration: '4.011000'},
	});
	const f = parseFfprobe(json);
	assert.equal(f.fps, 30);
	assert.ok(stingChecks('s', f, 3, 5).every((c) => c.ok));
	const long = stingChecks('s', {...f, durationSec: 5.2}, 3, 5);
	assert.ok(!long.find((c) => c.id.endsWith('duration'))!.ok);
	const noAudio = stingChecks('s', {...f, hasAudio: false}, 3, 5);
	assert.ok(!noAudio.find((c) => c.id.endsWith('audio track'))!.ok);
	assert.throws(() => parseFfprobe(JSON.stringify({streams: []})), /no video/);
	assert.equal(parseMaxVolume('[Parsed_volumedetect_0 @ 0x1] max_volume: -91.0 dB'), -91);
	assert.equal(parseMaxVolume('max_volume: -inf dB'), -Infinity);
	assert.equal(parseMaxVolume('nothing'), null);
	assert.ok(silenceCheck('s', -91).ok);
	assert.ok(!silenceCheck('s', -12.5).ok);
	assert.ok(!silenceCheck('s', null).ok);
});
