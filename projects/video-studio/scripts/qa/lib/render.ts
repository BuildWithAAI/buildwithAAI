/**
 * Render passes for the checker: one browser, one bundle, the probe's facts collected from the console and
 * the frames either kept as small luma frames (scout) or written as lossless PNGs (full-size passes).
 */
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {renderFrames, selectComposition, type HeadlessBrowser} from '@remotion/renderer';
import {ChunkAssembler, decodeChunk, QA_ENV, type FrameFacts, type QaPass} from '../../../src/qa/protocol.ts';
import {lumaFrame, type LumaFrame} from './checks/flicker.ts';
import {decodePng} from './png.ts';
import {resize} from './image.ts';

type Composition = Awaited<ReturnType<typeof selectComposition>>;

export type PassResult = {
	facts: Map<number, FrameFacts>;
	/** Full-size passes: PNG path per frame. */
	files: Map<number, string>;
	/** Scout pass: small luma frames. */
	luma: Map<number, LumaFrame>;
	/** Browser console errors and probe errors. */
	errors: string[];
	ms: number;
};

export type RendererOptions = {
	serveUrl: string;
	browser: HeadlessBrowser;
	concurrency: number;
	run: string;
	workDir: string;
	log: (msg: string) => void;
};

const envFor = (pass: QaPass, run: string) => ({[QA_ENV.pass]: pass, [QA_ENV.run]: run});

/** Smallest scale (1/8, 1/6, 1/5, 1/4, 1/2, 1) that keeps both frame dimensions integral. */
export const scoutScale = (w: number, h: number): number => {
	for (const d of [8, 6, 5, 4, 2]) if (w % d === 0 && h % d === 0) return 1 / d;
	return 1;
};

export class QaRenderer {
	private readonly o: RendererOptions;
	constructor(o: RendererOptions) {
		this.o = o;
	}

	async select(id: string, inputProps: Record<string, unknown>, pass: QaPass): Promise<Composition> {
		return selectComposition({
			serveUrl: this.o.serveUrl,
			id,
			inputProps,
			puppeteerInstance: this.o.browser,
			envVariables: envFor(pass, this.o.run),
			logLevel: 'error',
			timeoutInMilliseconds: 120_000,
		});
	}

	async pass(pass: QaPass, composition: Composition, inputProps: Record<string, unknown>, frames: number[], opts: {scale?: number; label?: string} = {}): Promise<PassResult> {
		const t0 = Date.now();
		const res: PassResult = {facts: new Map(), files: new Map(), luma: new Map(), errors: [], ms: 0};
		if (!frames.length) return res;
		const dir = join(this.o.workDir, pass);
		if (pass !== 'scout') mkdirSync(dir, {recursive: true});
		const asm = new ChunkAssembler();
		const scale = opts.scale ?? 1;
		let done = 0;
		let lastLog = Date.now();
		await renderFrames({
			composition,
			serveUrl: this.o.serveUrl,
			inputProps,
			frames,
			imageFormat: 'png',
			scale,
			outputDir: null,
			onStart: () => undefined,
			onFrameUpdate: () => {
				done++;
				if (Date.now() - lastLog > 5000) {
					lastLog = Date.now();
					this.o.log(`  ${opts.label ?? pass}: ${done}/${frames.length} frames`);
				}
			},
			onFrameBuffer: (buf, frame) => {
				if (pass === 'scout') {
					const img = decodePng(buf);
					// keep at most 160 px wide: enough for cuts and coarse pops
					const small = img.width > 160 ? resize(img, 160, Math.max(1, Math.round((img.height * 160) / img.width))) : img;
					res.luma.set(frame, lumaFrame(small));
				} else {
					const file = join(dir, `f${String(frame).padStart(6, '0')}.png`);
					writeFileSync(file, buf);
					res.files.set(frame, file);
				}
			},
			puppeteerInstance: this.o.browser,
			concurrency: this.o.concurrency,
			envVariables: envFor(pass, this.o.run),
			logLevel: 'error',
			timeoutInMilliseconds: 120_000,
			onBrowserLog: (log) => {
				const c = decodeChunk(log.text);
				if (!c) {
					if (log.type === 'error' && res.errors.length < 50) res.errors.push(log.text.slice(0, 500));
					return;
				}
				if (c.run !== this.o.run || c.pass !== pass) return;
				const s = asm.add(c);
				if (s) {
					try {
						const f = JSON.parse(s) as FrameFacts;
						res.facts.set(f.frame, f);
						for (const e of f.errors) if (res.errors.length < 50) res.errors.push(`probe frame ${f.frame}: ${e}`);
					} catch (err) {
						res.errors.push(`probe frame ${c.frame}: unreadable facts (${err instanceof Error ? err.message : String(err)})`);
					}
				}
			},
		});
		const missing = frames.filter((f) => !res.facts.has(f));
		if (missing.length) res.errors.push(`${pass}: the probe reported no facts for ${missing.length} frame(s) (${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ', ...' : ''}); is the composition registered through a bundle with the QA shim?`);
		res.ms = Date.now() - t0;
		return res;
	}
}

export const loadPng = (file: string) => decodePng(new Uint8Array(readFileSync(file)));
export const writeJson = (file: string, data: unknown) => writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
