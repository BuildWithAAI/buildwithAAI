/**
 * Branding QA run: checks every rendered asset of assets.ts against YouTube's specs (spec.ts) and the house rules,
 * re-measures the character rigs and the wordmark against the constants the layouts rely on, probes the videos, and
 * writes display-size previews for the human look (out/brand/qa/previews/). Prints a report and writes
 * out/brand/qa/report.json. Exit code 1 if any error-level check fails.
 *
 *   node src/branding/qa/run.ts        (after node src/branding/render.ts)
 */
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assetById, ASSETS} from '../assets.ts';
import {BADGER_HEAD, ZOO_HEAD} from '../characterFrames.ts';
import {lightness} from '../color.ts';
import {AVATAR, BANNER, bannerCropRect, bannerSafeRect, BANNER_CROPS, MB, STING, WATERMARK, type BannerCrop} from '../spec.ts';
import {BADGE, WORDMARK_INK} from '../layout.ts';
import {
	bytesCheck,
	contrastAtSizeCheck,
	dimsCheck,
	insideCircleCheck,
	insideRectCheck,
	opaqueCheck,
	parseFfprobe,
	parseMaxVolume,
	silenceCheck,
	stingChecks,
	transparentCornersCheck,
	type Check,
} from './checks.ts';
import {alphaBBox, blank, circleCoverage, composite, crop, decodePng, encodePng, pixel, resize, type Image} from './png.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');
const QA_DIR = join(ROOT, 'out', 'brand', 'qa');
const PREVIEWS = join(QA_DIR, 'previews');

const checks: Check[] = [];
const add = (...c: Check[]) => checks.push(...c);
const path = (rel: string) => join(ROOT, rel);
const load = (rel: string): Image => decodePng(readFileSync(path(rel)));
const savePreview = (name: string, img: Image) => {
	mkdirSync(PREVIEWS, {recursive: true});
	writeFileSync(join(PREVIEWS, name), encodePng(img));
};
const missing = (id: string, rel: string): boolean => {
	if (existsSync(path(rel))) return false;
	add({id, ok: false, detail: `missing ${rel} (run node src/branding/render.ts)`});
	return true;
};

/** A probe image's opaque bbox relative to its ground point, in world units (probe scale 1). */
const probeBox = (img: Image, groundX: number, groundY: number) => {
	const b = alphaBBox(img, 8);
	if (!b) return null;
	return {x: b.x - groundX, y: b.y - groundY, w: b.w, h: b.h};
};

// ---------- the rigs and the wordmark still match the constants the layouts were built on ----------
const probes = () => {
	const tol = 4; // world units
	if (!missing('rig: Zoo head box', assetById('qa/probe-zoo').out)) {
		const b = probeBox(load(assetById('qa/probe-zoo').out), 400, 1100);
		const ok = !!b && Math.abs(b.y - ZOO_HEAD.y) <= tol;
		add({id: 'rig: Zoo head top', ok, detail: `measured top ${b?.y} vs ZOO_HEAD.y ${ZOO_HEAD.y} (tolerance ${tol})`});
	}
	if (!missing('rig: Badger head box', assetById('qa/probe-badger').out)) {
		const b = probeBox(load(assetById('qa/probe-badger').out), 1100, 1100);
		const ok = !!b && Math.abs(b.y - BADGER_HEAD.y) <= tol && Math.abs(b.x - BADGER_HEAD.x) <= tol && Math.abs(b.x + b.w - (BADGER_HEAD.x + BADGER_HEAD.w)) <= tol;
		add({id: 'rig: Badger head box', ok, detail: `measured x ${b?.x}..${b ? b.x + b.w : '?'} top ${b?.y} vs ${BADGER_HEAD.x}..${BADGER_HEAD.x + BADGER_HEAD.w} top ${BADGER_HEAD.y}`});
	}
	if (!missing('font: wordmark metrics', assetById('qa/text-probe').out)) {
		const b = alphaBBox(load(assetById('qa/text-probe').out), 10);
		const w = b ? b.w / 200 : 0;
		add({id: 'font: wordmark ink width', ok: Math.abs(w - WORDMARK_INK.width) <= 0.02, detail: `${w.toFixed(3)} em vs WORDMARK_INK.width ${WORDMARK_INK.width}`});
	}
};

// ---------- banners ----------
const DISPLAY_W: Record<BannerCrop, number> = {tv: 1280, desktop: 1284, tablet: 800, phone: 390};
const banners = () => {
	for (const ch of ['zoora-ai', 'zoora-security'] as const) {
		const a = assetById(`${ch}/banner`);
		const k = assetById(ch === 'zoora-ai' ? 'qa/zoora-banner-key' : 'qa/security-banner-key');
		if (missing(`${ch} banner`, a.out) || missing(`${ch} banner key layer`, k.out)) continue;
		const img = load(a.out);
		add(
			dimsCheck(`${ch} banner: size`, img, BANNER.width, BANNER.height),
			bytesCheck(`${ch} banner: file size`, statSync(path(a.out)).size, BANNER.maxBytes),
			opaqueCheck(`${ch} banner: opaque`, img),
			insideRectCheck(`${ch} banner: key content inside the 1546x423 safe area (12 px margin)`, load(k.out), bannerSafeRect(), 12),
		);
		// previews: each device crop at a realistic display width, stacked
		const rows = (Object.keys(BANNER_CROPS) as BannerCrop[]).map((c) => {
			const r = bannerCropRect(c);
			const w = DISPLAY_W[c];
			return resize(crop(img, r.x, r.y, r.w, r.h), w, Math.round((r.h * w) / r.w));
		});
		const phone3x = (() => {
			const r = bannerCropRect('phone');
			return resize(crop(img, r.x, r.y, r.w, r.h), 1170, Math.round((r.h * 1170) / r.w));
		})();
		const all = [...rows, phone3x];
		let sheet = blank(1300, all.reduce((s, r) => s + r.height + 20, 20), [64, 64, 64, 255]);
		let y = 10;
		for (const r of all) {
			sheet = composite(sheet, r, 10, y);
			y += r.height + 20;
		}
		savePreview(`${ch}-banner-views.png`, sheet);
	}
};

// ---------- avatars ----------
const avatarSheet = (img: Image): Image => {
	const sizes = AVATAR.smallSizes;
	const w = sizes.reduce((s, x) => s + x + 20, 20);
	let sheet = blank(w, 2 * 190, [255, 255, 255, 255]);
	sheet = composite(sheet, blank(w, 190, [15, 15, 15, 255]), 0, 190);
	for (const [row, top] of [[0, 0], [1, 190]] as const) {
		void row;
		let x = 20;
		for (const s of sizes) {
			const small = resize(img, s, s);
			sheet = composite(sheet, small, x, top + 95 - s / 2, (tx, ty) => circleCoverage(tx, ty, s / 2, s / 2, s / 2));
			x += s + 20;
		}
	}
	return sheet;
};

/** Centroid of pixels matching `pred` inside a fractional region of the image (full resolution). */
const featureCentroid = (img: Image, pred: (l: number) => boolean, region: [number, number, number, number]) => {
	let sx = 0;
	let sy = 0;
	let n = 0;
	const [fx0, fy0, fx1, fy1] = region;
	for (let y = Math.floor(fy0 * img.height); y < fy1 * img.height; y++) {
		for (let x = Math.floor(fx0 * img.width); x < fx1 * img.width; x++) {
			const p = pixel(img, x, y);
			if (pred(lightness([p[0], p[1], p[2]]))) {
				sx += x;
				sy += y;
				n++;
			}
		}
	}
	return n ? {fx: sx / n / img.width, fy: sy / n / img.height, n} : null;
};

const avatars = () => {
	for (const ch of ['zoora-ai', 'zoora-security'] as const) {
		const a = assetById(`${ch}/avatar`);
		const k = assetById(ch === 'zoora-ai' ? 'qa/zoora-avatar-key' : 'qa/security-avatar-key');
		if (missing(`${ch} avatar`, a.out) || missing(`${ch} avatar key layer`, k.out)) continue;
		const img = load(a.out);
		const key = load(k.out);
		add(dimsCheck(`${ch} avatar: size`, img, AVATAR.width, AVATAR.height), bytesCheck(`${ch} avatar: file size`, statSync(path(a.out)).size, AVATAR.maxBytes), opaqueCheck(`${ch} avatar: opaque`, img));
		savePreview(`${ch}-avatar-sizes.png`, avatarSheet(img));
		if (ch === 'zoora-ai') {
			add(insideCircleCheck(`${ch} avatar: mark inside the circle crop`, key, 0.86));
			for (const s of [98, 48, 36]) add(contrastAtSizeCheck(`${ch} avatar: mark contrast at ${s} px`, img, key, s, s >= 48 ? 4.5 : 3));
		} else {
			// Badger's identity at 98 px: the dark LEFT-ear cap stays dark, the face stays light, and both separate from
			// the ground. Feature centres are found at full size, then sampled after downsampling to 98 px.
			const S = AVATAR.display;
			const small = resize(img, S, S);
			const L = (f: {fx: number; fy: number}) => {
				const p = pixel(small, f.fx * S, f.fy * S);
				return lightness([p[0], p[1], p[2]]);
			};
			const ear = featureCentroid(img, (l) => l < 16, [0.6, 0.1, 0.95, 0.5]);
			const face = featureCentroid(img, (l) => l > 95, [0.35, 0.2, 0.65, 0.5]);
			const ground = {fx: 0.5, fy: 0.035};
			const lg = L(ground);
			add({id: `${ch} avatar: dark ear cap found`, ok: !!ear && ear.n > 2000, detail: ear ? `${ear.n} px` : 'not found'});
			if (ear && face) {
				const le = L(ear);
				const lf = L(face);
				add(
					{id: `${ch} avatar: ear vs ground at 98 px`, ok: lg - le >= 40, detail: `L* ear ${le.toFixed(1)} vs ground ${lg.toFixed(1)} (need >= 40 apart)`},
					{id: `${ch} avatar: face vs ground at 98 px`, ok: lf - lg >= 8, detail: `L* face ${lf.toFixed(1)} vs ground ${lg.toFixed(1)} (need >= 8 apart; the outline does the rest)`},
				);
			}
			add(insideCircleCheck(`${ch} avatar: head inside the circle crop`, crop(key, 0, 0, key.width, key.height * 0.72), 0.95));
		}
	}
};

// ---------- watermarks ----------
const watermarks = () => {
	for (const ch of ['zoora-ai', 'zoora-security'] as const) {
		const a = assetById(`${ch}/watermark`);
		if (missing(`${ch} watermark`, a.out)) continue;
		const img = load(a.out);
		add(
			dimsCheck(`${ch} watermark: size`, img, WATERMARK.width, WATERMARK.height),
			bytesCheck(`${ch} watermark: file size`, statSync(path(a.out)).size, WATERMARK.maxBytesExclusive, true),
			transparentCornersCheck(`${ch} watermark: transparent corners`, img),
		);
		const frameAsset = assetById(`${ch}/endscreen-frame`);
		if (!existsSync(path(frameAsset.out))) continue;
		let frame = resize(load(frameAsset.out), 960, 540);
		for (const [i, s] of [48, 64].entries()) frame = composite(frame, resize(img, s, s), 960 - 20 - s - i * 90, 540 - 20 - s);
		savePreview(`${ch}-watermark-on-video.png`, frame);
	}
};

// ---------- end-screen frames and badges ----------
const framesAndBadges = () => {
	for (const ch of ['zoora-ai', 'zoora-security'] as const) {
		const a = assetById(`${ch}/endscreen-frame`);
		if (!missing(`${ch} end-screen frame`, a.out)) {
			const img = load(a.out);
			add(dimsCheck(`${ch} end-screen frame: size`, img, 1920, 1080), opaqueCheck(`${ch} end-screen frame: opaque`, img));
		}
	}
	for (const a of ASSETS.filter((x) => x.role === 'badge')) {
		if (missing(a.id, a.out)) continue;
		const img = load(a.out);
		add(
			{id: `${a.id}: height`, ok: img.height === BADGE.height, detail: `${img.width}x${img.height} (height must be ${BADGE.height})`},
			transparentCornersCheck(`${a.id}: transparent corners`, img),
			{id: `${a.id}: width`, ok: img.width >= 2 * BADGE.height && img.width <= 760, detail: `${img.width} px wide`},
		);
	}
};

// ---------- videos ----------
const videos = () => {
	for (const a of ASSETS.filter((x) => x.kind === 'video')) {
		if (missing(a.id, a.out)) continue;
		const probe = spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path(a.out)], {encoding: 'utf8'});
		if (probe.status !== 0) {
			add({id: `${a.id}: ffprobe`, ok: false, detail: probe.stderr.trim()});
			continue;
		}
		const facts = parseFfprobe(probe.stdout);
		const [min, max] = a.role === 'sting' ? [STING.minSec, STING.maxSec] : [5, 20];
		add(...stingChecks(a.id, facts, min, max));
		const vol = spawnSync('ffmpeg', ['-v', 'info', '-nostats', '-i', path(a.out), '-af', 'volumedetect', '-vn', '-f', 'null', '-'], {encoding: 'utf8'});
		add(silenceCheck(`${a.id}: silent`, parseMaxVolume(vol.stderr)));
	}
};

const main = () => {
	probes();
	banners();
	avatars();
	watermarks();
	framesAndBadges();
	videos();
	const failed = checks.filter((c) => !c.ok && c.level !== 'warn');
	for (const c of checks) console.log(`${c.ok ? 'PASS' : c.level === 'warn' ? 'WARN' : 'FAIL'}  ${c.id}  ${c.detail}`);
	mkdirSync(QA_DIR, {recursive: true});
	writeFileSync(join(QA_DIR, 'report.json'), JSON.stringify({at: new Date().toISOString(), mb: MB, checks}, null, '\t'));
	console.log(`\n${checks.length - failed.length}/${checks.length} checks passed. Previews: ${PREVIEWS}`);
	return failed.length ? 1 : 0;
};

process.exit(main());
