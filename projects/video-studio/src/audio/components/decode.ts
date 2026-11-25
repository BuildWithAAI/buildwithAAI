/**
 * Browser-side loading of a bed for the sample-accurate render path: fetch, decode (WAV in our own
 * reader, FLAC with the browser's decoder, checked against its STREAMINFO), optionally split into the
 * duck's bands. One promise per source and settings per render tab (module cache): every frame of the
 * tab reuses it.
 */
import {flacInfo, isFlac} from '../core/flac.ts';
import {parseWav} from '../core/wav.ts';
import {splitBands} from '../core/bands.ts';
import {validateLoop, type LoopPoints, type PcmSource} from '../core/pcm.ts';

export type LoadOptions = {
	/** split into [low, mid, high] at these crossovers (Hz); omit for one broadband band */
	crossovers?: readonly number[];
	loop: LoopPoints | null;
	/** expected sample rate; the composition's */
	sampleRate: number;
};

const cache = new Map<string, Promise<PcmSource>>();

const decodeFlac = async (buf: ArrayBuffer, sampleRate: number): Promise<Float32Array[]> => {
	const info = flacInfo(buf);
	if (info.sampleRate !== sampleRate) throw new Error(`FLAC is ${info.sampleRate} Hz; the composition renders at ${sampleRate} Hz`);
	const Ctx = (globalThis as unknown as {OfflineAudioContext?: typeof OfflineAudioContext}).OfflineAudioContext;
	if (!Ctx) throw new Error('this browser has no OfflineAudioContext to decode FLAC');
	const ctx = new Ctx(info.channels, 1, sampleRate);
	const audio = await ctx.decodeAudioData(buf.slice(0));
	if (audio.sampleRate !== info.sampleRate || audio.length !== info.totalSamples || audio.numberOfChannels !== info.channels) {
		throw new Error(`the browser decoded ${audio.numberOfChannels} ch x ${audio.length} samples at ${audio.sampleRate} Hz; the file holds ${info.channels} x ${info.totalSamples} at ${info.sampleRate}`);
	}
	return Array.from({length: audio.numberOfChannels}, (_, c) => audio.getChannelData(c).slice());
};

const load = async (url: string, opts: LoadOptions): Promise<PcmSource> => {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`could not fetch ${url}: HTTP ${res.status}`);
	const buf = await res.arrayBuffer();
	let channels: Float32Array[];
	if (isFlac(buf)) channels = await decodeFlac(buf, opts.sampleRate);
	else {
		const wav = parseWav(buf);
		if (wav.sampleRate !== opts.sampleRate) throw new Error(`${url} is ${wav.sampleRate} Hz; the composition renders at ${opts.sampleRate} Hz`);
		channels = wav.channels;
	}
	if (channels.length > 2) throw new Error(`${url} has ${channels.length} channels; beds are mono or stereo`);
	const length = channels[0].length;
	validateLoop(opts.loop, length);
	const bands = opts.crossovers && opts.crossovers.length ? splitBands(channels, opts.sampleRate, {circular: opts.loop !== null, crossovers: opts.crossovers}) : [channels];
	return {sampleRate: opts.sampleRate, length, bands, loop: opts.loop};
};

export const loadPcmSource = (url: string, opts: LoadOptions): Promise<PcmSource> => {
	const key = JSON.stringify([url, opts.crossovers ?? null, opts.loop, opts.sampleRate]);
	let p = cache.get(key);
	if (!p) {
		p = load(url, opts);
		cache.set(key, p);
		p.catch(() => cache.delete(key));
	}
	return p;
};
