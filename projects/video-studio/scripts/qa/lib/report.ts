/**
 * Report output: out/qa/<comp>/report.md (the owner's 5-minute review: verdict, then the issues worth a look,
 * each with a thumbnail) and report.json (everything, machine-readable), plus issues/<n>-<check>.png.
 */
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {Rect} from '../../../src/qa/protocol.ts';
import {blank, crop, fit, flatten, hstack, inflate, strokeRect, type Image, type RGBA} from './image.ts';
import {AREAS, CHECKS, timecode, type Area, type Finding, type Issue, type Severity} from './issues.ts';
import {encodePng} from './png.ts';

const MAGENTA: RGBA = [255, 0, 200, 255];
const CYAN: RGBA = [0, 200, 255, 255];

export type ThumbSources = {
	scene: (frame: number) => Image | null;
	solo: (frame: number) => Image | null;
	ref: (frame: number, charIndex: number) => Image | null;
};

const scaleRect = (r: Rect, s: number): Rect => ({x: r.x * s, y: r.y * s, w: r.w * s, h: r.h * s});

/** Overview of the frame (issue outlined) next to a zoomed crop. */
const cropThumb = (img: Image, f: Finding): Image => {
	const ow = 360;
	const s = ow / img.width;
	const overview = fit(img, ow, Math.round(img.height * s));
	for (const r of f.related ?? []) strokeRect(overview, scaleRect(r.rect, s), CYAN, 2);
	strokeRect(overview, inflate(scaleRect(f.box, s), 2), MAGENTA, 2);
	const pad = Math.max(24, 0.3 * Math.max(f.box.w, f.box.h));
	const region = inflate(f.box, pad);
	const c = crop(img, region);
	const ox = Math.max(0, Math.floor(region.x));
	const oy = Math.max(0, Math.floor(region.y));
	const zoom = fit(c, 520, 400, 3);
	const zs = zoom.width / c.width;
	for (const r of f.related ?? []) strokeRect(zoom, scaleRect({x: r.rect.x - ox, y: r.rect.y - oy, w: r.rect.w, h: r.rect.h}, zs), CYAN, 2);
	strokeRect(zoom, inflate(scaleRect({x: f.box.x - ox, y: f.box.y - oy, w: f.box.w, h: f.box.h}, zs), 2), MAGENTA, 3);
	return hstack([overview, zoom]);
};

const GREY: readonly [number, number, number] = [128, 128, 128];

/** Scene | in-scene character alone | canonical render | difference (red = changed). */
const compareThumb = (scene: Image, solo: Image, ref: Image, f: Finding): Image => {
	const region = inflate(f.box, 12);
	const p = crop(scene, region);
	const s = flatten(crop(solo, region), GREY);
	const r = flatten(crop(ref, region), GREY);
	const d = blank(s.width, s.height, [0, 0, 0, 255]);
	for (let i = 0; i < s.width * s.height; i++) {
		const o = i * 4;
		const v = Math.max(Math.abs(s.data[o] - r.data[o]), Math.abs(s.data[o + 1] - r.data[o + 1]), Math.abs(s.data[o + 2] - r.data[o + 2]));
		const g = Math.round(0.25 * (0.2126 * s.data[o] + 0.7152 * s.data[o + 1] + 0.0722 * s.data[o + 2]));
		d.data[o] = v > 8 ? Math.min(255, 80 + v * 2) : g;
		d.data[o + 1] = v > 8 ? 30 : g;
		d.data[o + 2] = v > 8 ? 60 : g;
	}
	const h = 300;
	return hstack([fit(p, 400, h, 2), fit(s, 400, h, 2), fit(r, 400, h, 2), fit(d, 400, h, 2)]);
};

const tripletThumb = (imgs: Image[], f: Finding): Image => {
	const region = inflate(f.box, Math.max(32, 0.4 * Math.max(f.box.w, f.box.h)));
	return hstack(imgs.map((img) => fit(crop(img, region), 360, 300, 3)));
};

export const renderThumb = (issue: Issue, src: ThumbSources, file: string): boolean => {
	const f = issue.worst;
	const scene = src.scene(f.frame);
	if (!scene) return false;
	let out: Image | null = null;
	if (f.thumb?.kind === 'compare' && f.charIndex !== undefined) {
		const solo = src.solo(f.frame);
		const ref = src.ref(f.frame, f.charIndex);
		if (solo && ref) out = compareThumb(scene, solo, ref, f);
	}
	if (!out && f.thumb?.kind === 'triplet') {
		const a = src.scene(f.frame - 1);
		const b = src.scene(f.frame + 1);
		if (a && b) out = tripletThumb([a, scene, b], f);
	}
	if (!out) out = cropThumb(scene, f);
	writeFileSync(file, encodePng(out));
	return true;
};

export type ReportMeta = {
	tool: string;
	date: string;
	entry: string;
	comp: string;
	props: unknown;
	width: number;
	height: number;
	fps: number;
	durationInFrames: number;
	format: string;
	scouted: number;
	scoutStep: number;
	sampled: number[];
	sampleReasons: Record<number, string[]>;
	everyN: number;
	scenes: Array<[number, number]>;
	timings: Record<string, number>;
	zones: {safe: Rect; ui: Array<{name: string; rect: Rect}>; adsSafe: Rect | null; sources: string[]};
	thresholds: unknown;
	counts: {texts: number; characters: number; contrastMeasured: number; contrastSkipped: number; modelCompared: number};
	/** Margins on this run: the lowest text contrast and the closest canonical comparisons. */
	calibration: {lowestContrast: number | null; worstCanonicalSsim: number | null; maxCanonicalChangedPercent: number | null};
	skipped: Array<{frame: number; who: string; why: string}>;
	errors: string[];
	ignoredBadges: string[];
	/** Per scouted frame: [frame, mean luma difference vs previous, changed-pixel fraction] (1/8-size frames). */
	scoutMotion: Array<[number, number, number]>;
	/** In-page measurement time of the probe per frame (ms): median and maximum, per pass. */
	probeMs?: Record<string, {median: number; max: number}>;
	/**
	 * The provisional drawings the model-provisional check reports, where the list was read, and the severity it uses in
	 * this composition (an error in a production composition, a warning elsewhere; lib/provisional.ts).
	 */
	provisional?: {source: string; decision: string | null; poses: Array<{view: string; pose: string}>; severity?: 'error' | 'warn'; production?: boolean};
};

const SEV_LABEL: Record<Severity, string> = {error: 'ERROR', warn: 'warn', info: 'info'};
const LEGENDS: Record<string, string> = {
	crop: 'Left: the whole frame; right: close-up. Magenta: the issue; cyan: the face, zone or box it is measured against.',
	compare: 'Panels: the scene; the character alone as the scene composed it; the canonical render (same props, same frame); difference (red = changed).',
	triplet: 'Panels: the frame before, the frame, the frame after.',
};
const mdEscape = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

const fmtMeasured = (m: Finding['measured']) =>
	Object.entries(m)
		.filter(([, v]) => v !== null && v !== '')
		.slice(0, 4)
		.map(([k, v]) => `${k} ${v}`)
		.join(', ');

export const writeReport = (outDir: string, meta: ReportMeta, issues: Issue[]): {md: string; json: string; verdict: 'PASS' | 'FAIL'} => {
	mkdirSync(outDir, {recursive: true});
	const errors = issues.filter((i) => i.severity === 'error');
	const warns = issues.filter((i) => i.severity === 'warn');
	const infos = issues.filter((i) => i.severity === 'info');
	const verdict = errors.length ? 'FAIL' : 'PASS';
	const tc = (f: number) => timecode(f, meta.fps);
	const span = (i: Issue) => `${i.ranges.length > 60 ? `${i.ranges.slice(0, 57)}...` : i.ranges} (${tc(i.frames[0])}${i.frames.length > 1 ? `-${tc(i.frames[i.frames.length - 1])}` : ''})`;
	const L: string[] = [];
	L.push(`# Visual QA: ${meta.comp}`);
	L.push('');
	L.push(`**${verdict}**: ${errors.length} error${errors.length === 1 ? '' : 's'}, ${warns.length} warning${warns.length === 1 ? '' : 's'}${infos.length ? `, ${infos.length} for information` : ''}.`);
	L.push('');
	L.push(`- Composition: \`${meta.comp}\` from \`${meta.entry}\`, ${meta.width}x${meta.height} (${meta.format}), ${meta.fps} fps, ${meta.durationInFrames} frames (${(meta.durationInFrames / meta.fps).toFixed(1)} s).`);
	L.push(`- Coverage: DOM checks on ${meta.scouted} frame${meta.scouted === 1 ? '' : 's'}${meta.scoutStep > 1 ? ` (every ${meta.scoutStep}th)` : ''}; pixel checks on ${meta.sampled.length} frame${meta.sampled.length === 1 ? '' : 's'} at full size; ${meta.counts.texts} text boxes, ${meta.counts.characters} character instances, ${meta.counts.contrastMeasured} contrast measurements, ${meta.counts.modelCompared} canonical comparisons.`);
	L.push(`- Run: ${meta.date}, ${Object.entries(meta.timings).map(([k, v]) => `${k} ${(v / 1000).toFixed(1)} s`).join(', ')}.`);
	const cal = meta.calibration;
	L.push(`- Margins: lowest text contrast ${cal.lowestContrast === null ? 'n/a' : `${cal.lowestContrast}:1`}; closest canonical match SSIM ${cal.worstCanonicalSsim ?? 'n/a'} with ${cal.maxCanonicalChangedPercent ?? 'n/a'}% changed pixels.`);
	if (meta.errors.length) L.push(`- **Tool problems (${meta.errors.length})**: ${mdEscape(meta.errors.slice(0, 3).join(' / '))}${meta.errors.length > 3 ? ' ...' : ''} (all in report.json).`);
	L.push('');
	const review = [...errors, ...warns];
	if (review.length) {
		L.push('## Review these');
		L.push('');
		L.push('| # | Severity | Check | What | Frames (timecode) | Measured |');
		L.push('| --- | --- | --- | --- | --- | --- |');
		review.forEach((i, k) => L.push(`| ${k + 1} | ${SEV_LABEL[i.severity]} | ${i.title} | ${mdEscape(i.subject)} | ${span(i)} | ${mdEscape(fmtMeasured(i.worst.measured))} |`));
		L.push('');
		review.forEach((i, k) => {
			L.push(`### ${k + 1}. ${SEV_LABEL[i.severity]}: ${i.title}`);
			L.push('');
			L.push(`${mdEscape(i.subject)}: ${mdEscape(i.message)}.`);
			L.push('');
			L.push(`Frames ${span(i)}${i.count > 1 ? `, ${i.count} frames checked` : ''}. Shown: frame ${i.worst.frame}.`);
			if (i.thumb) {
				L.push('');
				L.push(`![${i.title}, frame ${i.worst.frame}](${i.thumb})`);
				const legend = LEGENDS[i.worst.thumb?.kind ?? 'crop'];
				if (legend) {
					L.push('');
					L.push(`*${legend}*`);
				}
			}
			L.push('');
		});
	} else {
		L.push('No errors or warnings. Nothing to review beyond the usual watch-through.');
		L.push('');
	}
	L.push('## Summary by area');
	L.push('');
	L.push('| Area | Status | Errors | Warnings | Checks |');
	L.push('| --- | --- | --- | --- | --- |');
	for (const [a, title] of Object.entries(AREAS) as Array<[Area, string]>) {
		const e = errors.filter((i) => i.area === a).length;
		const w = warns.filter((i) => i.area === a).length;
		const checks = Object.entries(CHECKS)
			.filter(([, d]) => d.area === a)
			.map(([k]) => `\`${k}\``)
			.join(' ');
		L.push(`| ${title} | ${e ? 'FAIL' : w ? 'check' : 'pass'} | ${e} | ${w} | ${checks} |`);
	}
	L.push('');
	if (infos.length || meta.skipped.length || meta.ignoredBadges.length) {
		L.push('## For information (not counted)');
		L.push('');
		const byCheck = new Map<string, Issue[]>();
		for (const i of infos) byCheck.set(i.title, [...(byCheck.get(i.title) ?? []), i]);
		for (const [title, list] of byCheck) {
			const ex = list.slice(0, 3).map((i) => `${mdEscape(i.subject)} (frames ${i.ranges.length > 24 ? `${i.ranges.slice(0, 21)}...` : i.ranges})`);
			L.push(`- ${title}: ${list.length} item${list.length === 1 ? '' : 's'}, e.g. ${ex.join('; ')}${list.length > 3 ? '; all in report.json' : ''}. First: ${mdEscape(list[0].message)}.`);
		}
		if (meta.ignoredBadges.length) L.push(`- Review badges ignored (never published): ${meta.ignoredBadges.map((b) => `"${mdEscape(b)}"`).join(', ')}`);
		if (meta.skipped.length) {
			const byWhy = new Map<string, number[]>();
			for (const s of meta.skipped) {
				const k = `${s.who}: ${s.why}`;
				byWhy.set(k, [...(byWhy.get(k) ?? []), s.frame]);
			}
			for (const [k, fr] of byWhy) L.push(`- Skipped ${mdEscape(k)} (frames ${fr.slice(0, 12).join(', ')}${fr.length > 12 ? ', ...' : ''})`);
		}
		L.push('');
	}
	L.push('## Method');
	L.push('');
	L.push('- Every frame (or every Nth on long videos) is rendered at 1/8 size with an injected probe that measures the live DOM: text boxes, clipping, overflow, character instances and their props, and banned techniques. Sampled frames are rendered at full size four times: as is, without text paint, characters alone, and the canonical character renders. See `scripts/qa/README.md`.');
	L.push(`- Safe zones: ${meta.zones.sources.map(mdEscape).join('; ')}.`);
	L.push(`- Pixel-checked frames: ${meta.sampled.length} (scene starts and ends, mid-scene triplets for flicker, every ${meta.everyN}th frame, the first frame of every DOM finding). Scenes detected: ${meta.scenes.length}.`);
	L.push('');
	const md = L.join('\n');
	const mdFile = join(outDir, 'report.md');
	writeFileSync(mdFile, md);
	const json = {
		...meta,
		verdict,
		counts: {...meta.counts, errors: errors.length, warnings: warns.length, info: infos.length},
		issues: issues.map((i) => ({
			id: i.id,
			check: i.check,
			area: i.area,
			severity: i.severity,
			title: i.title,
			subject: i.subject,
			message: i.message,
			frames: i.frames,
			ranges: i.ranges,
			timecodes: [tc(i.frames[0]), tc(i.frames[i.frames.length - 1])],
			count: i.count,
			worst: {frame: i.worst.frame, box: i.worst.box, measured: i.worst.measured, related: i.worst.related ?? []},
			thumb: i.thumb,
		})),
	};
	const jsonFile = join(outDir, 'report.json');
	writeFileSync(jsonFile, `${JSON.stringify(json, null, 2)}\n`);
	return {md: mdFile, json: jsonFile, verdict};
};

export type ErrorMeta = {tool: string; date: string; entry: string; comp: string; props: unknown};

/**
 * The report for a run that could not finish (the composition failed to load or render, the browser died ...):
 * verdict ERROR with the reason, so a stale report from an earlier run is never mistaken for this one.
 */
export const writeErrorReport = (outDir: string, meta: ErrorMeta, reason: string): {md: string; json: string} => {
	mkdirSync(outDir, {recursive: true});
	const first = reason.split('\n')[0].trim();
	const md = [
		`# Visual QA: ${meta.comp}`,
		'',
		'**ERROR**: the visual check could not run, so nothing was checked. Fix the cause and run it again.',
		'',
		`- Composition: \`${meta.comp}\` from \`${meta.entry}\`.`,
		`- Run: ${meta.date}.`,
		`- Reason: ${mdEscape(first)}`,
		'',
		'The full error is in report.json (`error`).',
		'',
	].join('\n');
	const mdFile = join(outDir, 'report.md');
	writeFileSync(mdFile, md);
	const jsonFile = join(outDir, 'report.json');
	writeFileSync(jsonFile, `${JSON.stringify({...meta, verdict: 'ERROR', error: reason, issues: []}, null, 2)}\n`);
	return {md: mdFile, json: jsonFile};
};
