/**
 * Renders the product spot illustrations (scripts/product/spots) to standalone vector SVGs.
 * Bundles the separate Remotion entry once, then renders the `ProductSpot` still per catalog entry with the
 * preinstalled headless shell (as remotion.config.ts does; the programmatic API does not read that file). The SVG
 * arrives through the browser console (spots/protocol.ts); a PNG preview is kept next to it for the visual check.
 * Node only.
 */
import {existsSync, mkdirSync, readdirSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {bundle} from '@remotion/bundler';
import {openBrowser, renderStill, selectComposition, type HeadlessBrowser} from '@remotion/renderer';
import {SPOTS, validateCatalog} from '../spots/catalog.ts';
import {decodeSpotChunk, SpotAssembler} from '../spots/protocol.ts';
import {checkSpotSvg} from './svg-check.ts';

export const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..', '..');
export const SPOT_ENTRY = join(PROJECT_ROOT, 'scripts', 'product', 'spots', 'index.ts');

/** The same browser choice as remotion.config.ts: REMOTION_BROWSER_EXECUTABLE, else the newest Playwright headless shell. */
export const remotionBrowser = (): string | null => {
	if (process.env.REMOTION_BROWSER_EXECUTABLE) return process.env.REMOTION_BROWSER_EXECUTABLE;
	const pw = '/opt/pw-browsers';
	if (!existsSync(pw)) return null;
	const dir = readdirSync(pw)
		.filter((d) => /^chromium_headless_shell-\d+$/.test(d))
		.sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))[0];
	const bin = dir ? join(pw, dir, 'chrome-headless-shell-linux64', 'chrome-headless-shell') : '';
	return bin && existsSync(bin) ? bin : null;
};

export type SpotResult = {id: string; svgFile: string; pngFile: string; bytes: number; problems: string[]};

export const renderSpots = async (outDir: string, opts: {only?: string[]; log?: (s: string) => void} = {}): Promise<SpotResult[]> => {
	const log = opts.log ?? ((s: string) => console.log(s));
	const catalogErrors = validateCatalog(SPOTS);
	if (catalogErrors.length) throw new Error(`spot catalog: ${catalogErrors.join('; ')}`);
	const list = SPOTS.filter((s) => !opts.only?.length || opts.only.includes(s.id));
	mkdirSync(outDir, {recursive: true});
	log(`bundling ${SPOT_ENTRY.slice(PROJECT_ROOT.length + 1)}`);
	const serveUrl = await bundle({entryPoint: SPOT_ENTRY, rootDir: PROJECT_ROOT, publicDir: join(PROJECT_ROOT, 'public'), enableCaching: true, onProgress: () => undefined});
	const browser = (await openBrowser('chrome', {browserExecutable: remotionBrowser(), logLevel: 'error'} as never)) as HeadlessBrowser;
	const results: SpotResult[] = [];
	try {
		for (const spot of list) {
			const t0 = Date.now();
			const inputProps = {spotId: spot.id};
			const composition = await selectComposition({serveUrl, id: 'ProductSpot', inputProps, puppeteerInstance: browser, logLevel: 'error'});
			const asm = new SpotAssembler();
			let svg: string | null = null;
			const errors: string[] = [];
			const pngFile = join(outDir, `${spot.id}.preview.png`);
			await renderStill({
				composition,
				serveUrl,
				inputProps,
				output: pngFile,
				imageFormat: 'png',
				puppeteerInstance: browser,
				logLevel: 'error',
				timeoutInMilliseconds: 60_000,
				onBrowserLog: (l) => {
					const c = decodeSpotChunk(l.text);
					if (c) {
						if (c.id === spot.id) svg = asm.add(c) ?? svg;
					} else if (l.type === 'error') errors.push(l.text.slice(0, 300));
				},
			});
			if (svg === null) throw new Error(`spot ${spot.id}: the composition reported no SVG${errors.length ? ` (${errors.join(' | ')})` : ''}`);
			const text: string = svg;
			const svgFile = join(outDir, `${spot.id}.svg`);
			writeFileSync(svgFile, text);
			const problems = checkSpotSvg(text);
			results.push({id: spot.id, svgFile, pngFile, bytes: Buffer.byteLength(text), problems});
			log(`${problems.length ? 'WARN' : 'ok  '} spot ${spot.id} (${(Buffer.byteLength(text) / 1024).toFixed(0)} KB, ${((Date.now() - t0) / 1000).toFixed(1)} s)${problems.length ? `: ${problems.join('; ')}` : ''}`);
		}
	} finally {
		await browser.close({silent: true} as never);
	}
	return results;
};
