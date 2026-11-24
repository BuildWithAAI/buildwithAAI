/**
 * Findings (one observation at one frame) and issues (findings of the same defect grouped across frames).
 */
import {createHash} from 'node:crypto';
import type {Rect} from '../../../src/qa/protocol.ts';

export type Severity = 'error' | 'warn' | 'info';

/** Checks, grouped by the six QA areas of the report. */
export const CHECKS = {
	// 1. text overflow and clipping
	'text-clipped': {area: 'text', title: 'Text clipped by its container'},
	'text-offframe': {area: 'text', title: 'Text cut by the frame edge'},
	'text-overflow': {area: 'text', title: 'Text spills out of its box'},
	'text-truncated': {area: 'text', title: 'Text shortened with an ellipsis or line clamp'},
	'text-small': {area: 'text', title: 'Text smaller than 24 px on screen'},
	// 2. safe zones
	'safe-area': {area: 'safe', title: 'Outside the safe area'},
	'shorts-ui': {area: 'safe', title: 'Under the Shorts player UI'},
	'shorts-ads': {area: 'safe', title: "Outside Google's vertical-ads safe zone"},
	// 3. captions and faces
	'caption-face': {area: 'faces', title: 'Caption over a face'},
	'text-face': {area: 'faces', title: 'Text over a face'},
	'text-face-zone': {area: 'faces', title: "Text inside a face's clear zone"},
	'face-occluded': {area: 'faces', title: 'Face covered by other artwork'},
	// 4. contrast
	contrast: {area: 'contrast', title: 'Text contrast below the minimum'},
	// 5. off-model
	'model-transform': {area: 'model', title: 'Character mirrored, stretched, skewed or rotated'},
	'model-effect': {area: 'model', title: 'Filter or blend mode on a character'},
	'model-component': {area: 'model', title: 'Character not drawn by the canonical asset'},
	'model-view': {area: 'model', title: 'Requested view not rendered'},
	'model-ssim': {area: 'model', title: 'Character differs from its canonical render'},
	'model-palette': {area: 'model', title: 'Character colours outside the approved palette'},
	'model-pin': {area: 'model', title: "Zoo's pin missing, moved or on the wrong side"},
	'model-earcap': {area: 'model', title: "Badger's dark ear cap on the wrong side"},
	'model-spots': {area: 'model', title: "Badger's markings differ from the frozen set"},
	// 6. banding, blotches and flicker
	banned: {area: 'banding', title: 'Banned render technique (gradient, blur, glow, pattern, blend)'},
	gradient: {area: 'banding', title: 'Smooth gradient (banding risk after YouTube compression)'},
	texture: {area: 'banding', title: 'Noise, grain or halftone texture (blotch risk)'},
	flicker: {area: 'banding', title: 'One-frame flicker'},
	flash: {area: 'banding', title: 'One-frame brightness flash'},
	'one-frame-state': {area: 'banding', title: 'Element shown or changed for a single frame'},
} as const;
export type CheckId = keyof typeof CHECKS;

export const AREAS = {
	text: '1. Text overflow and clipping',
	safe: '2. Safe zones',
	faces: '3. Captions and faces',
	contrast: '4. Text contrast',
	model: '5. Off-model characters',
	banding: '6. Banding, blotches and flicker',
} as const;
export type Area = keyof typeof AREAS;

export type Thumb = {kind: 'crop'} | {kind: 'compare'; ref: 'solo-vs-ref'} | {kind: 'triplet'};

export type Finding = {
	check: CheckId;
	severity: Severity;
	frame: number;
	/** Where, in frame px. */
	box: Rect;
	/** What it is about (the text, "zoo", "badger", ...). */
	subject: string;
	/** Findings with the same check and key merge into one issue. */
	key: string;
	message: string;
	measured: Record<string, number | string | boolean | null>;
	/** Extra boxes to outline in the thumbnail (face box, zone, ...). */
	related?: Array<{rect: Rect; label: string}>;
	thumb?: Thumb;
	/** Higher = worse; picks the representative frame of an issue. */
	score: number;
	/** The character index in that frame's facts, for compare thumbnails. */
	charIndex?: number;
	/** The DOM element the finding is about (text "path|text", "char:<key>"), for the animation filter. */
	elementKey?: string;
};

export type Issue = {
	id: string;
	check: CheckId;
	area: Area;
	severity: Severity;
	title: string;
	subject: string;
	message: string;
	frames: number[];
	ranges: string;
	count: number;
	worst: Finding;
	thumb: string | null;
};

const SEV_RANK: Record<Severity, number> = {error: 3, warn: 2, info: 1};

/** "3-7, 12, 40-41" from sorted unique frames. */
export const frameRanges = (frames: number[]): string => {
	const fs = [...new Set(frames)].sort((a, b) => a - b);
	const out: string[] = [];
	for (let i = 0; i < fs.length; ) {
		let j = i;
		while (j + 1 < fs.length && fs[j + 1] === fs[j] + 1) j++;
		out.push(i === j ? `${fs[i]}` : `${fs[i]}-${fs[j]}`);
		i = j + 1;
	}
	return out.join(', ');
};

export const timecode = (frame: number, fps: number): string => {
	const s = frame / fps;
	const m = Math.floor(s / 60);
	const sec = Math.floor(s % 60);
	const ff = Math.round(frame - Math.floor(s) * fps);
	return `${m}:${String(sec).padStart(2, '0')}.${String(ff).padStart(2, '0')}`;
};

/** Merge findings by (check, key). The issue takes the highest severity and the worst finding's details. */
export const groupFindings = (findings: Finding[]): Issue[] => {
	const groups = new Map<string, Finding[]>();
	for (const f of findings) {
		const k = `${f.check}|${f.key}`;
		const g = groups.get(k);
		if (g) g.push(f);
		else groups.set(k, [f]);
	}
	const issues: Issue[] = [];
	for (const [k, g] of groups) {
		const severity = g.reduce<Severity>((s, f) => (SEV_RANK[f.severity] > SEV_RANK[s] ? f.severity : s), 'info');
		const worst = g.filter((f) => f.severity === severity).reduce((a, b) => (b.score > a.score ? b : a));
		const frames = [...new Set(g.map((f) => f.frame))].sort((a, b) => a - b);
		const def = CHECKS[worst.check];
		issues.push({
			id: createHash('sha1').update(k).digest('hex').slice(0, 10),
			check: worst.check,
			area: def.area,
			severity,
			title: def.title,
			subject: worst.subject,
			message: worst.message,
			frames,
			ranges: frameRanges(frames),
			count: frames.length,
			worst,
			thumb: null,
		});
	}
	const areaOrder = Object.keys(AREAS);
	return issues.sort(
		(a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity] || areaOrder.indexOf(a.area) - areaOrder.indexOf(b.area) || b.count - a.count || a.frames[0] - b.frames[0],
	);
};
