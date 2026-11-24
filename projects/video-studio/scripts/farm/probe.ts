/**
 * ffprobe facts about each output (resolution, duration, frame rate, codecs, size) and the job summaries built from
 * them. Summaries hold measurements and validated ids only: no props, narration, titles or frames.
 */
import {closeSync, fstatSync, openSync, readSync} from 'node:fs';

export type ProbeInfo = {
	width: number | null;
	height: number | null;
	durationSec: number | null; // null for stills
	fps: number | null;
	videoCodec: string | null;
	audioCodec: string | null;
	pixFmt: string | null;
	sampleRate: number | null;
	channels: number | null;
	sizeBytes: number | null;
	format: string | null;
};

export type RenderProbe = {
	type: 'render';
	request: string;
	index: number;
	composition: string;
	kind: 'video' | 'still' | 'audio';
	lang: string;
	output: string;
	artifact: string;
	encrypted: boolean;
	ok: boolean;
	exitCode: number | null;
	renderSeconds: number | null;
	jobSeconds: number | null;
	voiceTracks: number;
	info: ProbeInfo | null;
};

export type VoiceProbe = {
	type: 'voice';
	request: string;
	vindex: number;
	channel: string;
	slug: string;
	lang: string;
	artifact: string;
	encrypted: boolean;
	ok: boolean;
	exitCode: number | null;
	buildSeconds: number | null;
	info: ProbeInfo | null;
};

export type AnyProbe = RenderProbe | VoiceProbe;

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => {
	const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
	return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (typeof v === 'string' && /^[A-Za-z0-9_.,+-]{1,40}$/.test(v) ? v : null);

/** '30/1' -> 30, '30000/1001' -> 29.97; '0/0' -> null. */
export const parseRate = (rate: unknown): number | null => {
	if (typeof rate !== 'string') return null;
	const m = /^(\d+)\/(\d+)$/.exec(rate);
	if (!m || Number(m[2]) === 0 || Number(m[1]) === 0) return null;
	return Math.round((Number(m[1]) / Number(m[2])) * 1000) / 1000;
};

/** Reads `ffprobe -print_format json -show_format -show_streams` output. Stills report no duration or frame rate. */
export const parseProbe = (json: unknown, kind: 'video' | 'still' | 'audio'): ProbeInfo => {
	const streams = isObj(json) && Array.isArray(json.streams) ? json.streams.filter(isObj) : [];
	const format = isObj(json) && isObj(json.format) ? json.format : {};
	const v = streams.find((s) => s.codec_type === 'video');
	const a = streams.find((s) => s.codec_type === 'audio');
	const still = kind === 'still';
	return {
		width: v ? num(v.width) : null,
		height: v ? num(v.height) : null,
		durationSec: still ? null : num(format.duration) ?? (v ? num(v.duration) : null) ?? (a ? num(a.duration) : null),
		fps: still || !v ? null : parseRate(v.avg_frame_rate) ?? parseRate(v.r_frame_rate),
		videoCodec: v ? str(v.codec_name) : null,
		audioCodec: a ? str(a.codec_name) : null,
		pixFmt: v ? str(v.pix_fmt) : null,
		sampleRate: a ? num(a.sample_rate) : null,
		channels: a ? num(a.channels) : null,
		sizeBytes: num(format.size),
		format: str(format.format_name),
	};
};

const WAV_CODECS: Record<string, string> = {'1/8': 'pcm_u8', '1/16': 'pcm_s16le', '1/24': 'pcm_s24le', '1/32': 'pcm_s32le', '3/32': 'pcm_f32le', '3/64': 'pcm_f64le'};

/**
 * Facts about a RIFF/WAVE file read from its header (the voice jobs have no ffprobe): sample rate, channels, codec and
 * duration (data bytes / byte rate). Null when the file is not a WAV this can read.
 */
export const wavInfo = (path: string): ProbeInfo | null => {
	let fd: number;
	try {
		fd = openSync(path, 'r');
	} catch {
		return null;
	}
	try {
		const size = fstatSync(fd).size;
		const read = (pos: number, len: number): Buffer => {
			const b = Buffer.alloc(len);
			return b.subarray(0, readSync(fd, b, 0, len, pos));
		};
		const head = read(0, 12);
		if (head.length < 12 || head.toString('latin1', 0, 4) !== 'RIFF' || head.toString('latin1', 8, 12) !== 'WAVE') return null;
		let pos = 12;
		let fmt: Buffer | null = null;
		let dataBytes: number | null = null;
		for (let guard = 0; pos + 8 <= size && guard < 64; guard++) {
			const h = read(pos, 8);
			if (h.length < 8) break;
			const id = h.toString('latin1', 0, 4);
			const len = h.readUInt32LE(4);
			if (id === 'fmt ') fmt = read(pos + 8, Math.min(len, 64));
			if (id === 'data') {
				dataBytes = Math.min(len, size - pos - 8);
				break;
			}
			pos += 8 + len + (len % 2);
		}
		if (!fmt || fmt.length < 16 || dataBytes === null) return null;
		let format = fmt.readUInt16LE(0);
		const channels = fmt.readUInt16LE(2);
		const sampleRate = fmt.readUInt32LE(4);
		const byteRate = fmt.readUInt32LE(8);
		const bits = fmt.readUInt16LE(14);
		if (format === 0xfffe && fmt.length >= 26) format = fmt.readUInt16LE(24); // WAVE_FORMAT_EXTENSIBLE: the sub-format
		if (!byteRate || !sampleRate || !channels) return null;
		return {
			width: null,
			height: null,
			durationSec: Math.round((dataBytes / byteRate) * 1000) / 1000,
			fps: null,
			videoCodec: null,
			audioCodec: WAV_CODECS[`${format}/${bits}`] ?? null,
			pixFmt: null,
			sampleRate,
			channels,
			sizeBytes: size,
			format: 'wav',
		};
	} finally {
		closeSync(fd);
	}
};

/** One log line for a measured output: only the facts it has (an audio-only render has no picture size or frame rate). */
export const probeLine = (i: ProbeInfo): string =>
	[
		i.width && i.height ? `${i.width}x${i.height}` : null,
		i.durationSec !== null ? `${i.durationSec} s` : null,
		i.fps !== null ? `${i.fps} fps` : null,
		!i.videoCodec && i.audioCodec ? `${i.audioCodec}${i.sampleRate ? ` ${i.sampleRate} Hz` : ''}${i.channels ? ` ${i.channels} ch` : ''}` : null,
		i.sizeBytes !== null ? `${i.sizeBytes} bytes` : null,
	]
		.filter((x): x is string => x !== null)
		.join(', ') || 'no measurements';

export const fmtSeconds = (sec: number | null): string => {
	if (sec === null) return '-';
	if (sec < 60) return `${sec.toFixed(sec < 10 ? 2 : 1)} s`;
	const h = Math.floor(sec / 3600);
	const m = Math.floor((sec % 3600) / 60);
	const s = sec - h * 3600 - m * 60;
	const ss = s.toFixed(1).padStart(4, '0');
	return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};

export const fmtBytes = (n: number | null): string => {
	if (n === null) return '-';
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
	if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MiB`;
	return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
};

const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
const row = (cells: string[]): string => `| ${cells.map(cell).join(' | ')} |`;

const resolution = (i: ProbeInfo | null): string => (i && i.width && i.height ? `${i.width}x${i.height}` : '-');
const codecs = (i: ProbeInfo | null): string => {
	if (!i) return '-';
	const parts = [i.videoCodec, i.pixFmt, i.audioCodec].filter((x): x is string => !!x);
	return parts.length ? parts.join(' / ') : '-';
};
const status = (p: AnyProbe): string => (p.ok ? 'ok' : `failed${p.exitCode !== null ? ` (exit ${p.exitCode})` : ''}`);

export const RENDER_HEADER = ['Request', 'Job', 'Composition', 'Lang', 'Kind', 'Output', 'Resolution', 'Duration', 'FPS', 'Codecs', 'Size', 'Render time', 'Job time', 'Artifact', 'Status'];
export const VOICE_HEADER = ['Request', 'Voice', 'Channel / slug', 'Lang', 'Duration', 'Sample rate', 'Size', 'Build time', 'Artifact', 'Status'];

export const renderRow = (p: RenderProbe): string =>
	row([
		p.request,
		String(p.index),
		p.composition,
		p.lang,
		p.kind,
		`\`${p.output}\``,
		resolution(p.info),
		p.kind === 'still' ? 'still' : fmtSeconds(p.info ? p.info.durationSec : null),
		p.info && p.info.fps !== null ? String(p.info.fps) : '-',
		codecs(p.info),
		fmtBytes(p.info ? p.info.sizeBytes : null),
		fmtSeconds(p.renderSeconds),
		fmtSeconds(p.jobSeconds),
		`${p.artifact}${p.encrypted ? ' (encrypted)' : ''}`,
		status(p),
	]);

export const voiceRow = (p: VoiceProbe): string =>
	row([
		p.request,
		String(p.vindex),
		`${p.channel}/${p.slug}`,
		p.lang,
		fmtSeconds(p.info ? p.info.durationSec : null),
		p.info && p.info.sampleRate ? `${p.info.sampleRate} Hz` : '-',
		fmtBytes(p.info ? p.info.sizeBytes : null),
		fmtSeconds(p.buildSeconds),
		`${p.artifact}${p.encrypted ? ' (encrypted)' : ''}`,
		status(p),
	]);

const table = (header: string[], rows: string[]): string => [row(header), row(header.map(() => '---')), ...rows].join('\n');

/** Markdown for one job's summary. */
export const jobSummary = (p: AnyProbe): string =>
	p.type === 'render' ? `### Render\n\n${table(RENDER_HEADER, [renderRow(p)])}\n` : `### Voice\n\n${table(VOICE_HEADER, [voiceRow(p)])}\n`;

const byOrder = (a: AnyProbe, b: AnyProbe): number => {
	if (a.request !== b.request) return a.request < b.request ? -1 : 1;
	const ai = a.type === 'render' ? a.index : a.vindex;
	const bi = b.type === 'render' ? b.index : b.vindex;
	return ai - bi;
};

/** Markdown for the whole run: every voice track and every output. */
export const runSummary = (probes: AnyProbe[], expectedRenders: number): string => {
	const renders = probes.filter((p): p is RenderProbe => p.type === 'render').sort(byOrder);
	const voices = probes.filter((p): p is VoiceProbe => p.type === 'voice').sort(byOrder);
	const okRenders = renders.filter((p) => p.ok);
	const bytes = okRenders.reduce((s, p) => s + (p.info?.sizeBytes ?? 0), 0);
	const renderSec = renders.reduce((s, p) => s + (p.renderSeconds ?? 0), 0);
	const lines = [
		'## Render farm',
		'',
		`${okRenders.length} of ${expectedRenders} outputs rendered, ${fmtBytes(bytes)} in total, ${fmtSeconds(renderSec)} of render time across parallel jobs.` +
			(renders.length < expectedRenders ? ` ${expectedRenders - renders.length} job(s) reported nothing (cancelled, or failed before the render step).` : ''),
		'',
	];
	if (voices.length) lines.push('### Voice tracks', '', table(VOICE_HEADER, voices.map(voiceRow)), '');
	if (renders.length) lines.push('### Outputs', '', table(RENDER_HEADER, renders.map(renderRow)), '');
	if (renders.some((p) => p.encrypted) || voices.some((p) => p.encrypted)) {
		lines.push('Encrypted artifacts: download them, then run `scripts/farm/decrypt.sh --key <the owner\'s private key>` (docs/RENDER_FARM.md). No CI step can decrypt them.', '');
	}
	return lines.join('\n');
};

/** Runtime check of a probe file read back from an artifact. */
export const isProbe = (v: unknown): v is AnyProbe =>
	isObj(v) && (v.type === 'render' || v.type === 'voice') && typeof v.request === 'string' && typeof v.ok === 'boolean' && typeof v.artifact === 'string';
