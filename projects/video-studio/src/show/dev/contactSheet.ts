/**
 * Contact sheet of a show render (dev tool): bundles src/show/index.ts once, picks the frames worth inspecting
 * (sampleFrames.ts: every scene's start, middle and end, Badger's beats at their peak, the Rekt Meter after its sweep,
 * the diagram after its last node), renders them as PNG stills with one browser, and tiles them into labelled sheets.
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON src/show/dev/contactSheet.ts --format landscape|vertical \
 *     [--channel _dev] [--slug zoo-badger-demo] [--lang en] [--short short1] [--out <dir>] [--bundle <dir>] [--cols 4] \
 *     [--frames 10,200] [--channel-name "Name"]
 * --channel-name sets the line under the show logo; omitted, the sheet shows what a render without the prop shows
 * (src/show/channel.ts: "Zoodger News" for zoora-security, none for _dev); --channel-name "" hides it.
 * Writes <out>/<format>/f<frame>.png and <out>/<format>-sheet-<n>.png. Needs ffmpeg and the preinstalled browser.
 */
import {existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {bundle} from '@remotion/bundler';
import {openBrowser, renderStill, selectComposition} from '@remotion/renderer';
import type {Format, ShowStoryboard, Timeline} from '../types.ts';
import {showMockTimeline} from './mockTimeline.ts';
import {sampleFrames, type Sample} from './sampleFrames.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');

const arg = (name: string, def?: string): string | undefined => {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? process.argv[i + 1] : def;
};

const browserPath = (): string | null => {
	if (process.env.REMOTION_BROWSER_EXECUTABLE) return process.env.REMOTION_BROWSER_EXECUTABLE;
	const root = '/opt/pw-browsers';
	if (!existsSync(root)) return null;
	const dir = readdirSync(root)
		.filter((d) => /^chromium_headless_shell-\d+$/.test(d))
		.sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))[0];
	const bin = dir ? join(root, dir, 'chrome-headless-shell-linux64', 'chrome-headless-shell') : '';
	return bin && existsSync(bin) ? bin : null;
};

const main = async () => {
	const format = (arg('format', 'landscape') as Format) ?? 'landscape';
	const channel = arg('channel', '_dev') as string;
	const slug = arg('slug', 'zoo-badger-demo') as string;
	const lang = arg('lang', 'en') as string;
	const shortId = arg('short');
	const out = resolve(arg('out', join(ROOT, 'out', 'show', 'contact', slug)) as string);
	const cols = Number(arg('cols', format === 'landscape' ? '4' : '6'));
	const channelName = arg('channel-name'); // undefined: the render's own default (channel.ts); "" hides the line
	const sbFile = channel === '_dev' ? join(ROOT, 'src', 'show', 'dev', 'fixtures', slug, lang === 'en' ? 'storyboard.json' : `storyboard.${lang}.json`) : join(ROOT, 'content', channel, slug, lang === 'en' ? 'storyboard.json' : `storyboard.${lang}.json`);
	const sb = JSON.parse(readFileSync(sbFile, 'utf8')) as ShowStoryboard;
	const tlFile = join(ROOT, 'public', 'generated', channel, slug, lang, 'timeline.json');
	const tl: Timeline = existsSync(tlFile) ? JSON.parse(readFileSync(tlFile, 'utf8')) : showMockTimeline(sb);
	const only = arg('frames');
	const picked = sampleFrames(sb, format, tl, shortId);
	const samples: Sample[] = only ? only.split(',').map((f) => ({frame: Number(f), label: `frame ${f}`})) : picked.samples;
	const dir = join(out, format);
	mkdirSync(dir, {recursive: true});
	const bundleDir = arg('bundle');
	const serveUrl = bundleDir && existsSync(join(bundleDir, 'index.html')) ? bundleDir : await bundle({entryPoint: join(ROOT, 'src', 'show', 'index.ts'), outDir: bundleDir});
	const id = format === 'vertical' ? 'ShowShort' : 'ShowEpisode';
	const inputProps = {channel, slug, lang, ...(shortId ? {shortId} : {}), ...(channelName !== undefined ? {channelName} : {})};
	const browserExecutable = browserPath();
	const browser = await openBrowser('chrome', {browserExecutable});
	const composition = await selectComposition({serveUrl, id, inputProps, browserExecutable, puppeteerInstance: browser});
	const files: Array<{file: string; label: string}> = [];
	for (const s of samples) {
		const file = join(dir, `f${String(s.frame).padStart(5, '0')}.png`);
		await renderStill({composition, serveUrl, output: file, frame: s.frame, inputProps: composition.props, imageFormat: 'png', puppeteerInstance: browser, browserExecutable, overwrite: true});
		files.push({file, label: `${s.frame}  ${s.label}`});
		process.stdout.write('.');
	}
	await browser.close({silent: true});
	process.stdout.write('\n');
	// tile: scale each still, label it, stack `cols` per row, at most 4 rows per sheet
	const tw = format === 'landscape' ? 640 : 300;
	const th = format === 'landscape' ? 360 : 534;
	const font = ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'].find(existsSync);
	const perSheet = cols * 4;
	const sheets: string[] = [];
	for (let k = 0; k * perSheet < files.length; k++) {
		const batch = files.slice(k * perSheet, (k + 1) * perSheet);
		const inputs = batch.flatMap((f) => ['-i', f.file]);
		const label = (i: number) => batch[i].label.replace(/[:\\']/g, ' ');
		const parts = batch.map((_, i) => `[${i}:v]scale=${tw}:${th}${font ? `,drawbox=x=0:y=ih-34:w=iw:h=34:color=0x0B0C0F:t=fill,drawtext=fontfile=${font}:text='${label(i)}':x=8:y=h-26:fontsize=18:fontcolor=0xF4F6F8` : ''}[t${i}]`);
		const rows = Math.ceil(batch.length / cols);
		const layout = batch.map((_, i) => `${(i % cols) * tw}_${Math.floor(i / cols) * th}`).join('|');
		const pad = batch.length === 1 ? `[t0]pad=${tw * cols}:${th * rows}[out]` : `${batch.map((_, i) => `[t${i}]`).join('')}xstack=inputs=${batch.length}:layout=${layout}:fill=0xE6E8EB[out]`;
		const sheet = join(out, `${format}-sheet-${k + 1}.png`);
		execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', `${parts.join(';')};${pad}`, '-map', '[out]', '-frames:v', '1', sheet]);
		sheets.push(sheet);
	}
	writeFileSync(join(out, `${format}-samples.json`), JSON.stringify({frames: picked.frames, scenes: picked.scenes, samples}, null, 1));
	console.log(sheets.join('\n'));
};

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
