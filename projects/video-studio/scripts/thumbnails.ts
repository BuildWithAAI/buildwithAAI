// Render and check the 3 Test & Compare thumbnails of one episode, per language.
//
//   node scripts/thumbnails.ts <channel>/<slug> [--lang <lang>[,<lang>...] | --lang all] [--out <dir>]
//   e.g. node scripts/thumbnails.ts zoora-ai/pumpfun-top-caller --lang es
//        node scripts/thumbnails.ts _dev/thumb-demo --lang all        (dev fixture in src/thumbnails/dev/fixtures)
//   --lang defaults to en; "all" = every language that has a storyboard file. --out defaults to out/thumbnails/<slug>.
//
// Writes <out>/<lang>/v0.png, v1.png, v2.png (1280x720 PNG) plus <out>/<lang>/check/ (168x94 and 320x180 downscales,
// a contact sheet) and <out>/<lang>/report.json. Bundles src/episode/index.ts once and renders the "Thumbnail" still.
// Checks, each one failing the run (exit 1):
//   - the PNG is opaque, 1280x720 and under 2 MB (2,000,000 bytes; YouTube's mobile upload limit);
//   - WCAG contrast of the headline, measured on the rendered pixels, >= 4.5:1;
//   - at 320x180 and 168x94 (YouTube's small sizes, area downscale) the headline keeps >= 4.5:1 on its stroke cores
//     (95th percentile), and its letters stay >= 8 px (168x94) / 14 px (320x180) tall;
//   - the headline and its plate stay clear of every head box, and no headline or face sits under YouTube's duration
//     stamp (bottom right);
//   - nothing but the text colour, its background and their antialiased blends sits inside the headline block.
// Before rendering a real channel's language, the claim gate must have passed on the current text: out/claims/
// <slug>.<lang>.json exists, passed, and is newer than the storyboard and research.md (src/episode/node/claimGate.ts;
// thumbnail text is part of what the gate checks). Dev fixtures (_dev) are exempt.
// Node 22 strips the types; no build step. Exit code 1 on any failure, 2 on bad arguments.
import {mkdirSync, readFileSync, statSync, writeFileSync, existsSync, readdirSync} from 'node:fs';
import {join, relative, resolve} from 'node:path';
import {bundle} from '@remotion/bundler';
import {renderStill, selectComposition} from '@remotion/renderer';
import {LAYOUT_LOG_TAG, type Composed} from '../src/thumbnails/compose.ts';
import {contrastRgb, hexToRgb, MIN_TEXT_CONTRAST, type Rgb} from '../src/thumbnails/contrast.ts';
import {inflate, intersects, THUMB, YT_STAMP, type Rect} from '../src/thumbnails/layout.ts';
import {LANGS, VARIANTS, type ResolvedThumb, type ThumbVariant} from '../src/thumbnails/spec.ts';
import {blank, decodePng, downscale, encodePng, enlarge, paste, type Image} from '../src/thumbnails/node/png.ts';
import type {Lang} from '../src/episode/types.ts';
import {claimGateProblems} from '../src/episode/node/claimGate.ts';

const ROOT = resolve(import.meta.dirname, '..');
const MAX_BYTES = 2_000_000;
const SMALL = [
	{w: 320, h: 180, minCap: 14},
	{w: 168, h: 94, minCap: 8},
] as const;

const usage = (msg?: string): never => {
	if (msg) console.error(msg);
	console.error('usage: node scripts/thumbnails.ts <channel>/<slug> [--lang <lang>[,<lang>...] | --lang all] [--out <dir>]');
	process.exit(2);
};

/** Where the storyboards live (the same rule as src/thumbnails/load.ts). */
const storyboardDir = (channel: string, slug: string) =>
	channel === '_dev' ? join(ROOT, 'src', 'thumbnails', 'dev', 'fixtures', slug) : join(ROOT, 'content', channel, slug);

const parseArgs = (argv: string[]) => {
	let target: string | null = null;
	let langArg = 'en';
	let out: string | null = null;
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		const take = (name: string): string => {
			if (a.startsWith(`${name}=`)) return a.slice(name.length + 1);
			const v = argv[++i];
			return v === undefined ? usage(`${name} needs a value`) : v;
		};
		if (a === '--lang' || a.startsWith('--lang=')) langArg = take('--lang');
		else if (a === '--out' || a.startsWith('--out=')) out = take('--out');
		else if (a === '-h' || a === '--help') usage();
		else if (!a.startsWith('-') && !target) target = a;
		else usage(`unknown argument ${a}`);
	}
	// slug: the episode engine's rule (src/episode/validate.ts SLUG), so "_engine-demo" style slugs work here too
	const m = target ? /^([a-z0-9_][a-z0-9_-]*)\/([A-Za-z0-9_][A-Za-z0-9_-]{0,80})$/.exec(target) : null;
	if (!m) return usage('first argument must be <channel>/<slug>');
	const [, channel, slug] = m;
	const dir = storyboardDir(channel, slug);
	if (!existsSync(join(dir, 'storyboard.json'))) return usage(`no storyboard at ${relative(ROOT, join(dir, 'storyboard.json'))}`);
	const langs: Lang[] =
		langArg === 'all'
			? LANGS.filter((l) => existsSync(join(dir, l === 'en' ? 'storyboard.json' : `storyboard.${l}.json`)))
			: langArg.split(',').map((l) => l.trim() as Lang);
	for (const l of langs) if (!LANGS.includes(l)) usage(`--lang: "${l}" is not one of ${LANGS.join(', ')}`);
	return {channel, slug, langs, out: resolve(out ?? join(ROOT, 'out', 'thumbnails', slug))};
};

/** Same browser choice as remotion.config.ts (the programmatic API does not read that file). */
const browserExecutable = (): string | null => {
	if (process.env.REMOTION_BROWSER_EXECUTABLE) return process.env.REMOTION_BROWSER_EXECUTABLE;
	const pw = '/opt/pw-browsers';
	if (!existsSync(pw)) return null;
	const dir = readdirSync(pw)
		.filter((d) => /^chromium_headless_shell-\d+$/.test(d))
		.sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))[0];
	const bin = dir ? join(pw, dir, 'chrome-headless-shell-linux64', 'chrome-headless-shell') : '';
	return bin && existsSync(bin) ? bin : null;
};

// ---- pixel checks ----

const clip = (r: Rect, w: number, h: number) => {
	const x0 = Math.max(0, Math.floor(r.x));
	const y0 = Math.max(0, Math.floor(r.y));
	const x1 = Math.min(w, Math.ceil(r.x + r.w));
	const y1 = Math.min(h, Math.ceil(r.y + r.h));
	return {x0, y0, x1, y1};
};

/** Position of each pixel on the background->text segment (t) and its distance from it, inside `r`. */
const segmentScan = (img: Image, r: Rect, bg: Rgb, fg: Rgb) => {
	const {x0, y0, x1, y1} = clip(r, img.width, img.height);
	const d = [fg[0] - bg[0], fg[1] - bg[1], fg[2] - bg[2]];
	const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
	const ts: number[] = [];
	let foreign = 0;
	const textPx: Rgb[] = [];
	const bgPx: Rgb[] = [];
	for (let y = y0; y < y1; y++)
		for (let x = x0; x < x1; x++) {
			const i = (y * img.width + x) * 3;
			const p: Rgb = [img.data[i], img.data[i + 1], img.data[i + 2]];
			const t = Math.max(0, Math.min(1, ((p[0] - bg[0]) * d[0] + (p[1] - bg[1]) * d[1] + (p[2] - bg[2]) * d[2]) / dd));
			const q = [bg[0] + t * d[0], bg[1] + t * d[1], bg[2] + t * d[2]];
			const dist = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
			ts.push(t);
			if (dist > 12) foreign++;
			else if (t >= 0.92) textPx.push(p);
			else if (t <= 0.08) bgPx.push(p);
		}
	return {ts, foreign, textPx, bgPx, total: ts.length};
};

const median = (px: Rgb[]): Rgb => {
	const ch = (k: 0 | 1 | 2) => {
		const v = px.map((p) => p[k]).sort((a, b) => a - b);
		return v[Math.floor(v.length / 2)];
	};
	return [ch(0), ch(1), ch(2)];
};

const percentile = (v: number[], p: number) => {
	const s = [...v].sort((a, b) => a - b);
	return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

const scaleRect = (r: Rect, k: number): Rect => ({x: r.x * k, y: r.y * k, w: r.w * k, h: r.h * k});
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;

type SizeCheck = {size: string; contrast: number; capPx: number; faceWidthPx: number; ok: boolean};
type VariantReport = {
	variant: ThumbVariant;
	file: string;
	bytes: number;
	layout: string;
	text: string;
	lines: string[];
	fontSize: number;
	expression: string;
	badger: boolean;
	contrast: number;
	small: SizeCheck[];
	errors: string[];
	warnings: string[];
};

type Logged = Composed & {layout: string; measured: {zooHead: Rect | null; badgerHead: Rect | null} | null};

/** How far the drawn head box reaches outside the predicted one, as a fraction of the predicted size (0 = inside). */
const overflow = (a: Rect, b: Rect) =>
	Math.max(0, a.x - b.x, b.x + b.w - (a.x + a.w)) / a.w + Math.max(0, a.y - b.y, b.y + b.h - (a.y + a.h)) / a.h;

const union = (a: Rect, b: Rect | null | undefined): Rect => {
	if (!b) return a;
	const x = Math.min(a.x, b.x);
	const y = Math.min(a.y, b.y);
	return {x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y};
};

const checkVariant = (file: string, c: Logged, r: ResolvedThumb, layout: string): VariantReport => {
	const errors: string[] = [];
	const warnings = [...r.warnings];
	// the layout predicts the head boxes from layout.ts RIG; the render reports the drawn ones
	for (const [who, predicted, drawn] of [
		['Zoo', c.zooHead, c.measured?.zooHead],
		['Badger', c.badgerHead, c.measured?.badgerHead],
	] as const) {
		const out = predicted && drawn ? overflow(predicted, drawn) : 0;
		if (out > 0.03)
			warnings.push(`${who}'s drawn head reaches ${(out * 100).toFixed(0)}% past the box in layout.ts RIG: the rig changed; re-run src/thumbnails/dev/probe and update RIG`);
	}
	c = {...c, zooHead: union(c.zooHead, c.measured?.zooHead), badgerHead: c.badgerHead ? union(c.badgerHead, c.measured?.badgerHead) : null};
	const bytes = statSync(file).size;
	if (bytes >= MAX_BYTES) errors.push(`file is ${bytes} bytes; YouTube's mobile limit is 2 MB (keep it under ${MAX_BYTES})`);
	let img: Image;
	try {
		img = decodePng(readFileSync(file));
	} catch (err) {
		errors.push(`PNG: ${err instanceof Error ? err.message : String(err)}`);
		return {variant: r.variant, file, bytes, layout, text: r.text, lines: c.lines.map((l) => l.text), fontSize: c.size, expression: r.expression, badger: r.badger, contrast: 0, small: [], errors, warnings};
	}
	if (img.width !== THUMB.width || img.height !== THUMB.height) errors.push(`size ${img.width}x${img.height}, expected ${THUMB.width}x${THUMB.height}`);

	// geometry: headline and plate clear of faces and of YouTube's overlays
	const faces = [c.zooHead, ...(c.badgerHead ? [c.badgerHead] : [])];
	for (const [name, box] of [['headline', inflate(c.ink, 8)], ...(c.plate ? [['plate', c.plate] as const] : [])] as const) {
		faces.forEach((f, i) => {
			if (intersects(box, f)) errors.push(`${name} overlaps ${i === 0 ? "Zoo's" : "Badger's"} head`);
		});
		if (intersects(box, YT_STAMP)) errors.push(`${name} sits under YouTube's duration stamp (bottom right)`);
	}
	if (intersects(c.zooFace, YT_STAMP)) errors.push("Zoo's eyes or mouth sit under YouTube's duration stamp (bottom right)");
	if (c.badgerFace && intersects(c.badgerFace, YT_STAMP)) warnings.push("Badger's face reaches the corner YouTube covers with the duration stamp at small sizes");

	// full size: measured colours of the glyph cores and of the background inside the headline block
	const fg = hexToRgb(c.textColor);
	const bg = hexToRgb(c.behind);
	const full = segmentScan(img, inflate(c.ink, 2), bg, fg);
	let measured = 0;
	if (full.textPx.length < full.total * 0.05 || full.bgPx.length < full.total * 0.05) errors.push('could not find the headline on the rendered pixels');
	else {
		measured = contrastRgb(median(full.textPx), median(full.bgPx));
		if (measured < MIN_TEXT_CONTRAST) errors.push(`headline contrast ${measured.toFixed(2)}:1 < ${MIN_TEXT_CONTRAST}:1`);
	}
	if (full.foreign > full.total * 0.002) errors.push(`${full.foreign} px of another colour inside the headline block (something overlaps the text)`);

	// small sizes: effective contrast of the stroke cores, letter height, face width
	const minAscent = Math.min(...c.lines.map((l) => l.ascent));
	const small = SMALL.map((s) => {
		const k = s.w / THUMB.width;
		const im = downscale(img, s.w, s.h);
		const scan = segmentScan(im, scaleRect(c.ink, k), bg, fg);
		const t95 = percentile(scan.ts, 95);
		const eff: Rgb = [bg[0] + t95 * (fg[0] - bg[0]), bg[1] + t95 * (fg[1] - bg[1]), bg[2] + t95 * (fg[2] - bg[2])];
		const contrast = contrastRgb(bg, eff);
		const capPx = minAscent * k;
		const ok = contrast >= MIN_TEXT_CONTRAST && capPx >= s.minCap;
		if (contrast < MIN_TEXT_CONTRAST) errors.push(`at ${s.w}x${s.h} the headline strokes reach only ${contrast.toFixed(2)}:1`);
		if (capPx < s.minCap) errors.push(`at ${s.w}x${s.h} the letters are ${capPx.toFixed(1)} px tall (< ${s.minCap} px)`);
		return {size: `${s.w}x${s.h}`, contrast, capPx, faceWidthPx: c.zooHead.w * k, ok, image: im};
	});
	return {
		variant: r.variant,
		file,
		bytes,
		layout,
		text: r.text,
		lines: c.lines.map((l) => l.text),
		fontSize: c.size,
		expression: r.expression,
		badger: r.badger,
		contrast: measured,
		small: small.map(({image: _i, ...rest}) => rest),
		errors,
		warnings,
	};
};

/** Contact sheet: one row per variant: 640x360 | 320x180 | 168x94 (1:1) | 168x94 enlarged x3. */
const contactSheet = (files: string[]): Image => {
	const pad = 16;
	const rowH = 360 + pad;
	const sheet = blank(pad + 640 + pad + 320 + pad + 168 + pad + 504 + pad, pad + files.length * rowH, [255, 255, 255]);
	files.forEach((f, i) => {
		const img = decodePng(readFileSync(f));
		const y = pad + i * rowH;
		let x = pad;
		paste(sheet, downscale(img, 640, 360), x, y);
		x += 640 + pad;
		paste(sheet, downscale(img, 320, 180), x, y);
		x += 320 + pad;
		const s = downscale(img, 168, 94);
		paste(sheet, s, x, y);
		x += 168 + pad;
		paste(sheet, enlarge(s, 3), x, y);
	});
	return sheet;
};

type LangResult = {lang: Lang; reports: VariantReport[]; machine: boolean; dir: string; fatal: string | null};

const renderLang = async (serveUrl: string, browser: string | null, channel: string, slug: string, lang: Lang, outDir: string): Promise<LangResult> => {
	const checkDir = join(outDir, 'check');
	mkdirSync(checkDir, {recursive: true});
	const reports: VariantReport[] = [];
	const files: string[] = [];
	let machine = false;
	for (const variant of VARIANTS) {
		const inputProps = {channel, slug, lang, variant};
		let composition;
		try {
			composition = await selectComposition({serveUrl, id: 'Thumbnail', inputProps, browserExecutable: browser, logLevel: 'error'});
		} catch (err) {
			return {lang, reports, machine, dir: outDir, fatal: err instanceof Error ? err.message : String(err)};
		}
		const resolved = (composition.props as {resolved?: ResolvedThumb}).resolved;
		if (!resolved) return {lang, reports, machine, dir: outDir, fatal: 'calculateMetadata returned no resolved thumbnail'};
		machine ||= resolved.machine;
		const file = join(outDir, `v${variant}.png`);
		let logged: Logged | null = null;
		try {
			await renderStill({
				composition,
				serveUrl,
				output: file,
				inputProps: composition.props,
				imageFormat: 'png',
				browserExecutable: browser,
				overwrite: true,
				logLevel: 'error',
				onBrowserLog: (log) => {
					const at = log.text.indexOf(LAYOUT_LOG_TAG);
					if (at >= 0) logged = JSON.parse(log.text.slice(at + LAYOUT_LOG_TAG.length));
				},
			});
		} catch (err) {
			return {lang, reports, machine, dir: outDir, fatal: `v${variant}: ${err instanceof Error ? err.message : String(err)}`};
		}
		if (!logged) return {lang, reports, machine, dir: outDir, fatal: `v${variant}: the render did not report its layout (${LAYOUT_LOG_TAG})`};
		const c = logged as Logged;
		reports.push(checkVariant(file, c, resolved, c.layout));
		files.push(file);
		const img = decodePng(readFileSync(file));
		for (const s of SMALL) writeFileSync(join(checkDir, `v${variant}-${s.w}x${s.h}.png`), encodePng(downscale(img, s.w, s.h)));
	}
	writeFileSync(join(checkDir, 'sheet.png'), encodePng(contactSheet(files)));
	writeFileSync(join(outDir, 'report.json'), JSON.stringify({channel, slug, lang, machineTranslation: machine, renderedAt: new Date().toISOString(), maxBytes: MAX_BYTES, variants: reports}, null, 2) + '\n');
	return {lang, reports, machine, dir: outDir, fatal: null};
};

const main = async () => {
	const args = parseArgs(process.argv.slice(2));
	const browser = browserExecutable();
	const rel = (p: string) => relative(process.cwd(), p) || '.';
	let failed = 0;
	// the claim gate first: a language whose text has not passed it is not rendered at all
	const langs: Lang[] = [];
	for (const lang of args.langs) {
		const gate = claimGateProblems({studio: ROOT, channel: args.channel, slug: args.slug, lang});
		if (!gate.length) {
			langs.push(lang);
			continue;
		}
		failed++;
		console.log(`\nThumbnails ${args.channel}/${args.slug} (${lang}): NOT RENDERED, the claim gate has not passed on the current text`);
		for (const g of gate) console.log(`  FAIL: ${g}`);
	}
	if (!langs.length) {
		console.error(`\n${failed} language(s) blocked by the claim gate; nothing rendered.`);
		process.exit(1);
	}
	const t0 = Date.now();
	process.stdout.write('Bundling src/episode/index.ts ... ');
	const serveUrl = await bundle({entryPoint: join(ROOT, 'src/episode/index.ts'), rootDir: ROOT});
	console.log(`${((Date.now() - t0) / 1000).toFixed(1)} s`);
	for (const lang of langs) {
		const res = await renderLang(serveUrl, browser, args.channel, args.slug, lang, join(args.out, lang));
		console.log(`\nThumbnails ${args.channel}/${args.slug} (${lang}) -> ${rel(res.dir)}/`);
		if (res.fatal) {
			failed++;
			console.log(`  FAIL: ${res.fatal}`);
			continue;
		}
		for (const r of res.reports) {
			const small = r.small.map((s) => `${s.size}: ${s.contrast.toFixed(1)}:1, letters ${s.capPx.toFixed(1)} px, face ${s.faceWidthPx.toFixed(0)} px`).join(' | ');
			if (r.errors.length) failed++;
			console.log(
				`  v${r.variant} ${(r.errors.length ? 'FAIL' : 'ok').padEnd(4)} ${kb(r.bytes).padStart(9)} (< 2 MB: ${r.bytes < MAX_BYTES ? 'yes' : 'NO'})  ${r.layout.padEnd(11)} ${JSON.stringify(r.lines.join(' / '))} ${r.fontSize}px, ${r.expression}${r.badger ? ' + Badger' : ''}`,
			);
			console.log(`       contrast ${r.contrast.toFixed(1)}:1 | ${small}`);
			for (const e of r.errors) console.log(`       error: ${e}`);
			for (const w of r.warnings) console.log(`       warning: ${w}`);
		}
		console.log(`  check images: ${rel(join(res.dir, 'check'))}/ (sheet.png, v*-320x180.png, v*-168x94.png); report: ${rel(join(res.dir, 'report.json'))}`);
		if (lang !== 'en')
			console.log(
				`  Upload: localized thumbnails are a manual Studio step for long-form videos (Languages > ${lang} > Thumbnail > Add). Add them after the Test & Compare run on the default thumbnail ends: changing a thumbnail during a test stops it (docs/research/dubbing-and-regions-2026-11-24.md 1.7, 1.10).`,
			);
		if (res.machine)
			console.log(
				`  NOTE: storyboard.${lang}.json is a machine translation: needs native review. The images carry an owner-facing badge; do not upload them until a native speaker has checked the text and the storyboard says translation.status "native-reviewed".`,
			);
	}
	if (failed) {
		console.error(`\n${failed} thumbnail check(s) failed.`);
		process.exit(1);
	}
};

main().catch((err) => {
	console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
	process.exit(1);
});
