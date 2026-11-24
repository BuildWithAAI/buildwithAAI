/**
 * HTML -> PDF with the preinstalled Playwright Chromium, plus the poppler tools that read the result back
 * (pdfinfo for page counts and named destinations, pdffonts for embedding, pdfimages for raster images,
 * pdftoppm for page previews). Node only.
 *
 * Playwright is not a project dependency: it is resolved from PLAYWRIGHT_MODULE, NODE_PATH or the global npm
 * root (this machine has playwright 1.63 globally with browsers in PLAYWRIGHT_BROWSERS_PATH).
 */
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

/** The small part of Playwright's API this build uses (typed locally: playwright is not in package.json). */
type PwPage = {
	goto: (url: string, o?: {waitUntil?: 'load' | 'networkidle'}) => Promise<unknown>;
	evaluate: <T, A = undefined>(fn: (arg: A) => T | Promise<T>, arg?: A) => Promise<T>;
	emulateMedia: (o: {media: 'print' | 'screen'}) => Promise<void>;
	pdf: (o: {path: string; preferCSSPageSize?: boolean; printBackground?: boolean; outline?: boolean; tagged?: boolean}) => Promise<unknown>;
	on: (ev: 'console' | 'pageerror' | 'requestfailed', cb: (x: {text?: () => string; message?: string; url?: () => string}) => void) => void;
	setViewportSize: (s: {width: number; height: number}) => Promise<void>;
	screenshot: (o: {path: string; fullPage?: boolean}) => Promise<unknown>;
};
type PwBrowser = {newPage: (o?: {deviceScaleFactor?: number}) => Promise<PwPage>; close: () => Promise<void>};
type Playwright = {chromium: {launch: (o?: {headless?: boolean}) => Promise<PwBrowser>}};

export const loadPlaywright = (): Playwright => {
	const req = createRequire(import.meta.url);
	const candidates = [process.env.PLAYWRIGHT_MODULE, 'playwright', 'playwright-core'].filter(Boolean) as string[];
	const globalRoot = spawnSync('npm', ['root', '-g'], {encoding: 'utf8'}).stdout?.trim();
	const errors: string[] = [];
	for (const c of candidates) {
		for (const paths of [undefined, globalRoot ? [globalRoot] : undefined]) {
			try {
				const resolved = paths ? req.resolve(c, {paths}) : req.resolve(c);
				return req(resolved) as Playwright;
			} catch (e) {
				errors.push(`${c}${paths ? ` in ${paths[0]}` : ''}: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
			}
		}
	}
	throw new Error(`Playwright is not installed. Install it (npm i -g playwright && npx playwright install chromium) or set PLAYWRIGHT_MODULE.\n${errors.join('\n')}`);
};

/** The page content box to copy-fit frames into (CSS px), and the allowed range of the --fit type scale. */
export type FitBox = {widthPx: number; heightPx: number; min: number; max: number};

/** What the copy-fit did: the scale it chose, and how much room each frame had left at that scale (CSS px). */
export type FitResult = {scale: number; fits: boolean; slackPx: number[]};

/** Keeps the fitted frames this far inside the page box (CSS px), against sub-pixel differences between passes. */
export const FIT_SAFETY_PX = 3;

/**
 * Runs inside the page (serialized by Playwright, so it must be self-contained): finds the largest --fit at which
 * every [data-fit-page] frame fits the page height, laid out at the exact page content width, then pins each frame
 * to that height so its columns can stretch to the page foot. Returns null when the page has no frames.
 */
export const fitPagesInPage = (o: FitBox & {safetyPx: number}): FitResult | null => {
	const frames = Array.from(document.querySelectorAll('[data-fit-page]')) as HTMLElement[];
	if (!frames.length) return null;
	const root = document.documentElement;
	const limit = o.heightPx - o.safetyPx;
	document.body.style.width = `${o.widthPx}px`;
	for (const f of frames) f.style.height = 'auto';
	const tallest = (s: number): number => {
		root.style.setProperty('--fit', String(s));
		return Math.max(...frames.map((f) => f.getBoundingClientRect().height));
	};
	let lo = o.min;
	let hi = o.max;
	let fits = true;
	if (tallest(lo) > limit) fits = false;
	else if (tallest(hi) <= limit) lo = hi;
	else {
		for (let k = 0; k < 18; k++) {
			const mid = (lo + hi) / 2;
			if (tallest(mid) <= limit) lo = mid;
			else hi = mid;
		}
	}
	const scale = Math.floor(lo * 1000) / 1000;
	root.style.setProperty('--fit', String(scale));
	const slackPx = frames.map((f) => Math.round((limit - f.getBoundingClientRect().height) * 10) / 10);
	if (fits) for (const f of frames) f.style.height = `${limit}px`;
	document.body.style.width = '';
	return {scale, fits, slackPx};
};

export type PrintResult = {consoleErrors: string[]; failedRequests: string[]; fit: FitResult | null};

/**
 * Prints an HTML file to PDF with CSS page sizes, backgrounds, a tagged structure and the document outline. With
 * `fit`, frames marked data-fit-page are copy-fitted to the page content box first (the free edition).
 */
export const printPdf = async (htmlFile: string, pdfFile: string, opts: {fit?: FitBox} = {}): Promise<PrintResult> => {
	const pw = loadPlaywright();
	const browser = await pw.chromium.launch({headless: true});
	const consoleErrors: string[] = [];
	const failedRequests: string[] = [];
	let fit: FitResult | null = null;
	try {
		const page = await browser.newPage();
		page.on('pageerror', (e) => consoleErrors.push(String(e.message ?? e)));
		page.on('console', (m) => {
			const t = m.text?.() ?? '';
			if (/error/i.test(t)) consoleErrors.push(t);
		});
		page.on('requestfailed', (r) => failedRequests.push(r.url?.() ?? '?'));
		await page.goto(pathToFileURL(htmlFile).href, {waitUntil: 'load'});
		// Fonts and SVG images must be ready before printing, or Chromium prints fallbacks.
		const notReady = await page.evaluate(async () => {
			// load every declared face explicitly (faces load lazily, only when some text uses them)
			const faces: FontFace[] = [];
			document.fonts.forEach((f) => faces.push(f));
			await Promise.all(faces.map((f) => f.load().catch(() => null)));
			await document.fonts.ready;
			const imgs = Array.from(document.images);
			await Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => i.addEventListener('load', r, {once: true})))));
			const broken = imgs.filter((i) => !i.naturalWidth).map((i) => i.getAttribute('src') ?? '?');
			const families = faces.filter((f) => f.status !== 'loaded').map((f) => `${f.family} ${f.weight} ${f.style}`);
			return [...broken.map((b) => `image did not load: ${b}`), ...families.map((f) => `font not loaded: ${f}`)];
		});
		consoleErrors.push(...notReady);
		if (opts.fit) {
			// measure with the print stylesheet, at the exact content width the PDF will have
			await page.emulateMedia({media: 'print'});
			fit = await page.evaluate(fitPagesInPage, {...opts.fit, safetyPx: FIT_SAFETY_PX});
		}
		await page.pdf({path: pdfFile, preferCSSPageSize: true, printBackground: true, outline: true, tagged: true});
	} finally {
		await browser.close();
	}
	return {consoleErrors, failedRequests, fit};
};

// ------------------------------------------------------------------------------------------ poppler

const run = (cmd: string, args: string[]): string => {
	const r = spawnSync(cmd, args, {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
	if (r.error) throw new Error(`${cmd} is not available (${r.error.message}). Install poppler-utils.`);
	if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${r.stderr}`);
	return r.stdout;
};

export const pdfPageCount = (pdf: string): number => {
	const m = /^Pages:\s+(\d+)/m.exec(run('pdfinfo', [pdf]));
	if (!m) throw new Error(`pdfinfo did not report a page count for ${pdf}`);
	return Number(m[1]);
};

export const pdfInfo = (pdf: string): Record<string, string> => {
	const out: Record<string, string> = {};
	for (const l of run('pdfinfo', [pdf]).split('\n')) {
		const m = /^([^:]+):\s*(.*)$/.exec(l);
		if (m) out[m[1].trim()] = m[2].trim();
	}
	return out;
};

/** Parses `pdfinfo -dests` output: destination name -> page number. */
export const parseDests = (text: string): Record<string, number> => {
	const out: Record<string, number> = {};
	for (const l of text.split('\n')) {
		const m = /^\s*(\d+)\s+\[[^\]]*\]\s+"(.*)"\s*$/.exec(l);
		if (m) out[m[2]] = Number(m[1]);
	}
	return out;
};

export const namedDestinations = (pdf: string): Record<string, number> => parseDests(run('pdfinfo', ['-dests', pdf]));

export type FontRow = {name: string; type: string; embedded: boolean; subset: boolean};

/** Parses `pdffonts` output. */
export const parseFonts = (text: string): FontRow[] => {
	const lines = text.split('\n');
	const sep = lines.findIndex((l) => /^-{5,}/.test(l));
	if (sep < 0) return [];
	return lines
		.slice(sep + 1)
		.filter((l) => l.trim())
		.map((l) => {
			const cols = l.trim().split(/\s+/);
			// name type [type2] encoding emb sub uni object ID
			const n = cols.length;
			return {name: cols[0], type: cols.slice(1, n - 6).join(' '), embedded: cols[n - 5] === 'yes', subset: cols[n - 4] === 'yes'};
		});
};

export const pdfFonts = (pdf: string): FontRow[] => parseFonts(run('pdffonts', [pdf]));

/** Number of raster images in the PDF (the spot art and icons are vector, so this should be 0). */
export const pdfRasterImageCount = (pdf: string): number => {
	const lines = run('pdfimages', ['-list', pdf]).split('\n');
	const sep = lines.findIndex((l) => /^-{5,}/.test(l));
	return sep < 0 ? 0 : lines.slice(sep + 1).filter((l) => l.trim()).length;
};

/** Renders every page to PNG (prefix-N.png) for the visual check; returns the files written. */
export const rasterize = (pdf: string, outPrefix: string, dpi = 72): string[] => {
	run('pdftoppm', ['-png', '-r', String(dpi), pdf, outPrefix]);
	const pages = pdfPageCount(pdf);
	const files: string[] = [];
	for (let i = 1; i <= pages; i++) {
		for (const w of [String(i), String(i).padStart(2, '0'), String(i).padStart(3, '0')]) {
			const f = `${outPrefix}-${w}.png`;
			if (existsSync(f)) {
				files.push(f);
				break;
			}
		}
	}
	return files;
};

export const popplerAvailable = (): boolean => !spawnSync('pdfinfo', ['-v']).error;

export {join};
