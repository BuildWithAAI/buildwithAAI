/**
 * ffprobe facts about each output (resolution, duration, frame rate, codecs, size) and the job summaries built from
 * them. Summaries hold measurements and validated ids only: no props, narration, titles or frames.
 */

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
	kind: 'video' | 'still';
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
		lines.push('Encrypted artifacts: download them, then run `scripts/farm/decrypt.sh` with the RENDER_ARTIFACT_KEY (docs/RENDER_FARM.md).', '');
	}
	return lines.join('\n');
};

/** Runtime check of a probe file read back from an artifact. */
export const isProbe = (v: unknown): v is AnyProbe =>
	isObj(v) && (v.type === 'render' || v.type === 'voice') && typeof v.request === 'string' && typeof v.ok === 'boolean' && typeof v.artifact === 'string';
