/**
 * ffmpeg / ffprobe wrappers for the podcast master and encodes (ffmpeg 6.1 tested; needs libmp3lame, aac, loudnorm,
 * ebur128 and soxr).
 *
 * Loudness target: -16 LUFS integrated, true peak <= -1 dBTP. Apple Podcasts' "Audio requirements" page asks for
 * -16 LKFS +/- 1 dB and a true peak at or below -1 dBFS, measured per ITU-R BS.1770, with the levelling done BEFORE
 * encoding (podcasters.apple.com/support/audio-requirements; read as a search-index extract on 2026-11-24, the page
 * itself is blocked here). Spotify publishes no podcast-episode loudness number we could read; -16 LUFS is also its
 * podcast ad spec (ads.spotify.com). The master aims at -1.5 dBTP so the MP3/AAC encode keeps under -1 dBTP, and every
 * encoded file is decoded and measured again.
 * The narration is mono; the master is dual-mono stereo, so -16 LUFS is what a listener hears on both earbuds.
 */
import {spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

export class AudioError extends Error {}

export const TARGET_I = -16;
export const TARGET_TP = -1.0; // the ceiling checked on every encoded file
const MASTER_TP = -1.5; // what the master aims for, leaving room for codec overshoot

const tail = (s: string, n = 12) => s.trim().split('\n').slice(-n).join('\n');

export const run = (cmd: string, args: string[], what: string): {stdout: string; stderr: string} => {
	const r = spawnSync(cmd, args, {encoding: 'utf8', maxBuffer: 256 * 1024 * 1024});
	if (r.error) throw new AudioError(`${what}: cannot run ${cmd}: ${r.error.message}`);
	if (r.status !== 0) throw new AudioError(`${what} failed (exit ${r.status}):\n${tail(r.stderr)}`);
	return {stdout: r.stdout, stderr: r.stderr};
};

export const hasFfmpeg = (): boolean => {
	for (const bin of ['ffmpeg', 'ffprobe']) {
		const r = spawnSync(bin, ['-version'], {encoding: 'utf8'});
		if (r.error || r.status !== 0) return false;
	}
	return true;
};

export type Probe = {
	durationSec: number;
	streams: {codec_type: string; codec_name: string; sample_rate?: string; channels?: number; width?: number; height?: number; pix_fmt?: string}[];
	chapters: {start_time: string; end_time: string; tags?: {title?: string}}[];
	tags: Record<string, string>;
};

export const probe = (file: string): Probe => {
	const {stdout} = run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '-show_chapters', file], `ffprobe ${file}`);
	const j = JSON.parse(stdout) as {format?: {duration?: string; tags?: Record<string, string>}; streams?: Probe['streams']; chapters?: Probe['chapters']};
	return {durationSec: Number(j.format?.duration ?? NaN), streams: j.streams ?? [], chapters: j.chapters ?? [], tags: j.format?.tags ?? {}};
};

export type Loudness = {integratedLufs: number; truePeakDbtp: number; lra: number};

/** EBU R128 / BS.1770 measurement with ffmpeg's ebur128 filter (true peak by 4x oversampling). */
export const measure = (file: string): Loudness => {
	const {stderr} = run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-'], `loudness of ${file}`);
	const summary = stderr.slice(stderr.lastIndexOf('Summary:'));
	const num = (re: RegExp) => {
		const m = re.exec(summary);
		if (!m) throw new AudioError(`could not read the loudness summary of ${file}`);
		return m[1] === '-inf' ? -Infinity : Number(m[1]);
	};
	return {integratedLufs: num(/I:\s+(-?[\d.]+|-inf) LUFS/), lra: num(/LRA:\s+(-?[\d.]+) LU/), truePeakDbtp: num(/Peak:\s+(-?[\d.]+|-inf) dBFS/)};
};

type LoudnormStats = {input_i: string; input_tp: string; input_lra: string; input_thresh: string; target_offset: string; normalization_type?: string};

const loudnormJson = (stderr: string): LoudnormStats => {
	const start = stderr.lastIndexOf('{');
	const end = stderr.lastIndexOf('}');
	if (start < 0 || end < start) throw new AudioError('loudnorm printed no statistics');
	return JSON.parse(stderr.slice(start, end + 1)) as LoudnormStats;
};

export type BadgerCue = {clip: string; atMs: number; gainDb: number; label?: string};

export type MasterResult = {
	file: string;
	sampleRate: number;
	channels: 2;
	before: Loudness;
	after: Loudness;
	normalization: string; // linear or dynamic (ffmpeg loudnorm's own report)
	cues: number;
};

/**
 * narration.wav (+ Badger cues) → 44.1 kHz dual-mono stereo master at -16 LUFS / -1.5 dBTP, PCM 16-bit.
 * Two-pass loudnorm in linear mode (a plain gain when the peaks allow it), then a check measurement.
 */
export const buildMaster = (narration: string, cues: BadgerCue[], out: string): MasterResult => {
	const work = mkdtempSync(join(tmpdir(), 'assets-master-'));
	try {
		const pre = join(work, 'pre.wav');
		const inputs = ['-i', narration];
		const chains: string[] = ['[0:a]aformat=sample_fmts=fltp:channel_layouts=mono[n]'];
		cues.forEach((c, i) => {
			inputs.push('-i', c.clip);
			chains.push(`[${i + 1}:a]aformat=sample_fmts=fltp:sample_rates=24000:channel_layouts=mono,volume=${c.gainDb.toFixed(2)}dB,adelay=delays=${Math.round(c.atMs)}:all=1[c${i}]`);
		});
		const mixed = cues.length ? `[n]${cues.map((_, i) => `[c${i}]`).join('')}amix=inputs=${cues.length + 1}:duration=first:normalize=0[m]` : '[n]anull[m]';
		const graph = [...chains, mixed, '[m]aresample=44100:resampler=soxr,pan=stereo|c0=c0|c1=c0[o]'].join(';');
		run('ffmpeg', ['-hide_banner', '-nostats', '-y', ...inputs, '-filter_complex', graph, '-map', '[o]', '-c:a', 'pcm_f32le', pre], 'mixing the podcast master');

		const before = measure(pre);
		if (!Number.isFinite(before.integratedLufs)) throw new AudioError('the narration is silent');
		const target = `I=${TARGET_I}:TP=${MASTER_TP}:LRA=20`;
		const pass1 = loudnormJson(run('ffmpeg', ['-hide_banner', '-nostats', '-i', pre, '-af', `loudnorm=${target}:print_format=json`, '-f', 'null', '-'], 'loudness pass 1').stderr);
		const measured = `measured_I=${pass1.input_i}:measured_TP=${pass1.input_tp}:measured_LRA=${pass1.input_lra}:measured_thresh=${pass1.input_thresh}:offset=${pass1.target_offset}`;
		const pass2 = run(
			'ffmpeg',
			['-hide_banner', '-nostats', '-y', '-i', pre, '-af', `loudnorm=${target}:${measured}:linear=true:print_format=json,aresample=44100:resampler=soxr`, '-ar', '44100', '-ac', '2', '-c:a', 'pcm_s16le', out],
			'loudness pass 2',
		);
		const stats = loudnormJson(pass2.stderr);
		const after = measure(out);
		return {file: out, sampleRate: 44100, channels: 2, before, after, normalization: stats.normalization_type ?? 'unknown', cues: cues.length};
	} finally {
		rmSync(work, {recursive: true, force: true});
	}
};

/** MP3: CBR 128 kbit/s, 44.1 kHz, joint stereo, Xing/LAME header for exact duration; no tags (written by id3.ts). */
export const encodeMp3 = (master: string, out: string): void => {
	run(
		'ffmpeg',
		['-hide_banner', '-nostats', '-y', '-i', master, '-map', '0:a', '-map_metadata', '-1', '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', '-ac', '2', '-id3v2_version', '0', '-write_xing', '1', out],
		'MP3 encode',
	);
};

/**
 * One ffmetadata value. ffmpeg ends a line at \n AND at \r, so a carriage return (or a NUL) in a title could start a
 * new key or a whole [CHAPTER] block: both become spaces first; then = ; # \ and \n are escaped.
 */
// eslint-disable-next-line no-control-regex
export const ffmetaEscape = (s: string): string => s.replace(/[\r\0]/g, ' ').replace(/[\\=;#\n]/g, (c) => (c === '\n' ? '\\\n' : `\\${c}`));

export type M4aMeta = {title: string; artist: string; album: string; genre: string; date: string; comment: string; copyright: string};

/** M4A (AAC-LC 128 kbit/s) with iTunes-style tags, a QuickTime chapter track (+ Nero chpl) and optional cover. */
export const encodeM4a = (master: string, out: string, meta: M4aMeta, chapters: {startMs: number; endMs: number; title: string}[], cover: string | null): void => {
	const work = mkdtempSync(join(tmpdir(), 'assets-m4a-'));
	try {
		const ffmeta = join(work, 'meta.txt');
		const lines = [
			';FFMETADATA1',
			`title=${ffmetaEscape(meta.title)}`,
			`artist=${ffmetaEscape(meta.artist)}`,
			`album=${ffmetaEscape(meta.album)}`,
			`genre=${ffmetaEscape(meta.genre)}`,
			`date=${ffmetaEscape(meta.date)}`,
			`comment=${ffmetaEscape(meta.comment)}`,
			`copyright=${ffmetaEscape(meta.copyright)}`,
		];
		for (const ch of chapters) lines.push('[CHAPTER]', 'TIMEBASE=1/1000', `START=${Math.round(ch.startMs)}`, `END=${Math.round(ch.endMs)}`, `title=${ffmetaEscape(ch.title)}`);
		writeFileSync(ffmeta, `${lines.join('\n')}\n`);
		const args = ['-hide_banner', '-nostats', '-y', '-i', master, '-i', ffmeta];
		if (cover) args.push('-i', cover);
		args.push('-map', '0:a', '-map_metadata', '1', '-map_chapters', '1');
		if (cover) args.push('-map', '2:v', '-c:v', 'copy', '-disposition:v:0', 'attached_pic');
		args.push('-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2', '-movflags', '+faststart', '-f', 'ipod', out);
		run('ffmpeg', args, 'M4A encode');
	} finally {
		rmSync(work, {recursive: true, force: true});
	}
};

/** Square JPEG for embedding (APIC / covr) or for the feed (3000 px). */
export const squareJpeg = (src: string, out: string, size: number): void => {
	run('ffmpeg', ['-hide_banner', '-nostats', '-y', '-i', src, '-vf', `scale=${size}:${size}:flags=lanczos,format=yuvj444p`, '-frames:v', '1', '-q:v', '2', out], 'cover conversion');
};

export type ImageCheck = {ok: boolean; width: number; height: number; codec: string; problems: string[]};

/** Apple's show-art rules: square, 1400-3000 px (3000 preferred), JPEG or PNG, RGB (no alpha, no CMYK). */
export const checkCover = (file: string): ImageCheck => {
	if (!existsSync(file)) return {ok: false, width: 0, height: 0, codec: '', problems: [`${file} does not exist`]};
	const p = probe(file);
	const v = p.streams.find((s) => s.codec_type === 'video');
	const width = v?.width ?? 0;
	const height = v?.height ?? 0;
	const codec = v?.codec_name ?? '';
	const problems: string[] = [];
	if (!['mjpeg', 'png'].includes(codec)) problems.push(`must be JPEG or PNG, got ${codec || 'unknown'}`);
	if (width !== height) problems.push(`must be square, got ${width}x${height}`);
	if (width < 1400 || width > 3000) problems.push(`must be 1400-3000 px (3000 preferred), got ${width}`);
	if (v?.pix_fmt && /a$|ya|rgba|argb|cmyk/.test(v.pix_fmt)) problems.push(`must be RGB without alpha, got ${v.pix_fmt}`);
	return {ok: problems.length === 0, width, height, codec, problems};
};
