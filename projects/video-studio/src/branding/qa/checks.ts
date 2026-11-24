/**
 * Branding QA checks: pure functions over decoded images and probe output (no I/O), so every rule is unit-tested
 * with synthetic inputs (tests/qa.test.ts) and run for real on the rendered assets by qa/run.ts.
 */
import {contrast, lightness, type RGB} from '../color.ts';
import type {Rect} from '../spec.ts';
import {alphaBBox, resize, type Image} from './png.ts';

export type Check = {id: string; ok: boolean; detail: string; level?: 'error' | 'warn'};

export const dimsCheck = (id: string, img: Image, w: number, h: number): Check => ({
	id,
	ok: img.width === w && img.height === h,
	detail: `${img.width}x${img.height} (want ${w}x${h})`,
});

export const bytesCheck = (id: string, bytes: number, max: number, exclusive = false): Check => ({
	id,
	ok: exclusive ? bytes < max : bytes <= max,
	detail: `${(bytes / 1e6).toFixed(3)} MB (limit ${exclusive ? '<' : '<='} ${(max / 1e6).toFixed(0)} MB)`,
});

/** Every opaque pixel of a key-content layer lies inside `rect` shrunk by `margin`. */
export const insideRectCheck = (id: string, key: Image, rect: Rect, margin = 0): Check => {
	const b = alphaBBox(key, 8);
	if (!b) return {id, ok: false, detail: 'key layer is empty'};
	const r = {x: rect.x + margin, y: rect.y + margin, w: rect.w - 2 * margin, h: rect.h - 2 * margin};
	const over = {
		left: Math.max(0, r.x - b.x),
		top: Math.max(0, r.y - b.y),
		right: Math.max(0, b.x + b.w - (r.x + r.w)),
		bottom: Math.max(0, b.y + b.h - (r.y + r.h)),
	};
	const ok = over.left + over.top + over.right + over.bottom === 0;
	return {
		id,
		ok,
		detail: `key bbox x ${b.x}-${b.x + b.w} y ${b.y}-${b.y + b.h} vs safe x ${Math.round(r.x)}-${Math.round(r.x + r.w)} y ${Math.round(r.y)}-${Math.round(r.y + r.h)}${ok ? '' : ` overflow ${JSON.stringify(over)}`}`,
	};
};

/** Largest distance from (cx, cy) of any pixel with alpha > threshold (pixel centres). */
export const maxOpaqueRadius = (img: Image, cx: number, cy: number, threshold = 8): number => {
	let m = 0;
	for (let y = 0; y < img.height; y++) {
		for (let x = 0; x < img.width; x++) {
			if (img.data[(y * img.width + x) * 4 + 3] > threshold) m = Math.max(m, Math.hypot(x + 0.5 - cx, y + 0.5 - cy));
		}
	}
	return m;
};

/** Key content stays inside the avatar's circle crop with a margin (fraction of the radius). */
export const insideCircleCheck = (id: string, key: Image, maxFraction: number): Check => {
	const c = key.width / 2;
	const m = maxOpaqueRadius(key, c, key.height / 2);
	return {id, ok: m <= c * maxFraction, detail: `key content reaches ${(m / c * 100).toFixed(1)}% of the radius (limit ${(maxFraction * 100).toFixed(0)}%)`};
};

const rgbAt = (img: Image, i: number): RGB => [img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2]];
const meanRgb = (img: Image, idx: number[]): RGB => {
	const s = [0, 0, 0];
	for (const i of idx) {
		const p = rgbAt(img, i);
		s[0] += p[0];
		s[1] += p[1];
		s[2] += p[2];
	}
	return [s[0] / idx.length, s[1] / idx.length, s[2] / idx.length];
};

/**
 * Non-text contrast at display size: downsample the full asset and its key layer to `size`, then compare the mean
 * colour where the subject covers >= 50% against the mean colour of the uncovered pixels inside the inscribed circle.
 * WCAG 2.2 SC 1.4.11 asks 3:1 for graphical objects needed to understand content.
 */
export const contrastAtSize = (full: Image, key: Image, size: number): {ratio: number; subject: RGB; ground: RGB; subjectPx: number} => {
	const f = resize(full, size, size);
	const k = resize(key, size, size);
	const c = size / 2;
	const subj: number[] = [];
	const ground: number[] = [];
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			if (Math.hypot(x + 0.5 - c, y + 0.5 - c) > c) continue;
			const i = y * size + x;
			const a = k.data[i * 4 + 3];
			if (a >= 128) subj.push(i);
			else if (a <= 8) ground.push(i);
		}
	}
	if (!subj.length || !ground.length) return {ratio: 1, subject: [0, 0, 0], ground: [0, 0, 0], subjectPx: subj.length};
	const s = meanRgb(f, subj);
	const g = meanRgb(f, ground);
	return {ratio: contrast(s, g), subject: s, ground: g, subjectPx: subj.length};
};

export const contrastAtSizeCheck = (id: string, full: Image, key: Image, size: number, min = 3): Check => {
	const r = contrastAtSize(full, key, size);
	return {id, ok: r.ratio >= min, detail: `${r.ratio.toFixed(2)}:1 at ${size} px (min ${min}:1; ${r.subjectPx} subject px)`};
};

/** CIE L* at a point after downsampling the image to `size` (for "does this feature survive at 98 px" checks). */
export const lightnessAtSize = (img: Image, size: number, fx: number, fy: number): number => {
	const s = resize(img, size, Math.round((img.height / img.width) * size));
	const x = Math.min(s.width - 1, Math.max(0, Math.floor(fx * s.width)));
	const y = Math.min(s.height - 1, Math.max(0, Math.floor(fy * s.height)));
	return lightness(rgbAt(s, y * s.width + x));
};

export const transparentCornersCheck = (id: string, img: Image): Check => {
	const corners = [0, img.width - 1, (img.height - 1) * img.width, img.height * img.width - 1];
	const alphas = corners.map((i) => img.data[i * 4 + 3]);
	return {id, ok: alphas.every((a) => a === 0), detail: `corner alpha ${alphas.join('/')}`};
};

export const opaqueCheck = (id: string, img: Image): Check => {
	let min = 255;
	for (let i = 3; i < img.data.length; i += 4) min = Math.min(min, img.data[i]);
	return {id, ok: min === 255, detail: `minimum alpha ${min} (an avatar or banner must be fully opaque)`};
};

/** Parsed ffprobe facts for one video file. */
export type ProbeFacts = {
	vcodec: string;
	profile?: string;
	width: number;
	height: number;
	fps: number;
	pixFmt: string;
	colorSpace?: string;
	durationSec: number;
	hasAudio: boolean;
};

export const parseFfprobe = (json: string): ProbeFacts => {
	const j = JSON.parse(json) as {streams?: Array<Record<string, string | number>>; format?: Record<string, string>};
	const v = (j.streams ?? []).find((s) => s.codec_type === 'video');
	if (!v) throw new Error('no video stream');
	const [n, d] = String(v.r_frame_rate ?? '0/1').split('/').map(Number);
	return {
		vcodec: String(v.codec_name),
		profile: v.profile === undefined ? undefined : String(v.profile),
		width: Number(v.width),
		height: Number(v.height),
		fps: d ? n / d : 0,
		pixFmt: String(v.pix_fmt),
		colorSpace: v.color_space === undefined ? undefined : String(v.color_space),
		durationSec: Number(j.format?.duration ?? v.duration ?? 0),
		hasAudio: (j.streams ?? []).some((s) => s.codec_type === 'audio'),
	};
};

export const stingChecks = (id: string, p: ProbeFacts, minSec: number, maxSec: number): Check[] => [
	{id: `${id}: codec`, ok: p.vcodec === 'h264', detail: `${p.vcodec} ${p.profile ?? ''}`.trim()},
	{id: `${id}: size`, ok: p.width === 1920 && p.height === 1080, detail: `${p.width}x${p.height}`},
	{id: `${id}: fps`, ok: Math.abs(p.fps - 30) < 1e-6, detail: `${p.fps} fps`},
	{id: `${id}: pixel format`, ok: p.pixFmt === 'yuv420p', detail: p.pixFmt},
	{id: `${id}: colour space`, ok: p.colorSpace === 'bt709', detail: String(p.colorSpace)},
	// container duration can exceed the video by one AAC frame (21 ms)
	{id: `${id}: duration`, ok: p.durationSec >= minSec - 0.05 && p.durationSec <= maxSec + 0.05, detail: `${p.durationSec.toFixed(3)} s (want ${minSec}-${maxSec} s)`},
	{id: `${id}: audio track`, ok: p.hasAudio, detail: p.hasAudio ? 'present (for clean concatenation)' : 'missing'},
];

/** Parse ffmpeg volumedetect output; returns max_volume in dB (-Infinity for digital silence) or null if absent. */
export const parseMaxVolume = (stderr: string): number | null => {
	const m = /max_volume:\s*(-?inf|-?\d+(?:\.\d+)?)\s*dB/.exec(stderr);
	if (!m) return null;
	return m[1].endsWith('inf') ? -Infinity : Number(m[1]);
};

export const silenceCheck = (id: string, maxVolumeDb: number | null): Check => ({
	id,
	ok: maxVolumeDb !== null && maxVolumeDb <= -80,
	detail: maxVolumeDb === null ? 'no volume reading' : `max volume ${maxVolumeDb} dB (the sting ships silent; the jingle comes from the audio workflow)`,
});
