/**
 * Face boxes and caption placement (pure). Captions must stay away from faces (PROJECT_INSTRUCTIONS): the caption
 * placer tries the format's caption positions in order and takes the first one clear of every face in the shot.
 * Face boxes are conservative world-unit boxes (head with hair or ears, a little margin), measured on the rigs'
 * renders at known placements; they scale with the placement like the characters do.
 */
import type {SceneType, StoryboardScene} from '../types.ts';
import {BADGER_INSERT, CAPTIONS, FRAME, LAYOUTS, SAFE, type BadgerPlace, type Box, type Format, type ZooPlace} from './specs.ts';

/** World-unit face boxes relative to the ground point (x right, y down). */
const ZOO_FACE = {front: {x0: -84, x1: 84, y0: -906, y1: -732}, threeQuarter: {x0: -92, x1: 104, y0: -906, y1: -728}} as const;
const BADGER_FACE_LEFT = {x0: -285, x1: -60, y0: -525, y1: -300}; // side views facing screen left (front, 3/4 and up heads)
const BADGER_FACE_SIT = {x0: -75, x1: 125, y0: -445, y1: -285}; // sit pose (faces screen right)

const scaleBox = (b: {x0: number; x1: number; y0: number; y1: number}, x: number, y: number, s: number): Box => ({x: x + b.x0 * s, y: y + b.y0 * s, w: (b.x1 - b.x0) * s, h: (b.y1 - b.y0) * s});

export const zooFace = (p: ZooPlace): Box => scaleBox(p.view === 'threeQuarter' ? ZOO_FACE.threeQuarter : ZOO_FACE.front, p.x, p.y, p.scale);
export const badgerFace = (p: BadgerPlace): Box => {
	if (p.pose === 'sit') return scaleBox(BADGER_FACE_SIT, p.x, p.y, p.scale);
	const b = p.view === 'right' ? {x0: -BADGER_FACE_LEFT.x1, x1: -BADGER_FACE_LEFT.x0, y0: BADGER_FACE_LEFT.y0, y1: BADGER_FACE_LEFT.y1} : BADGER_FACE_LEFT;
	return scaleBox(b, p.x, p.y, p.scale);
};

/** Every face that can appear in a scene of this type and format (main shot and, for Shorts, Badger's insert). */
export const sceneFaces = (sc: Pick<StoryboardScene, 'type' | 'zoo' | 'badger'>, format: Format): Box[] => {
	const out: Box[] = [];
	const badger = !!sc.badger?.present;
	const zooOn = sc.zoo?.present !== false;
	const t: SceneType = sc.type;
	if (t === 'chart') {
		const L = LAYOUTS.chart[format];
		const pair = badger && L.pair ? L.pair : null;
		const zp = pair ? pair.zoo : L.solo.zoo;
		if (zooOn) out.push(zooFace(zp), zooFace({...zp, view: 'front'})); // he turns to camera
		if (pair) out.push(badgerFace(pair.badger));
		else if (badger) out.push(badgerFace(BADGER_INSERT[format]));
		return out;
	}
	const L = (LAYOUTS as unknown as Record<string, Record<Format, {zoo: ZooPlace; badger: BadgerPlace}>>)[t][format];
	if (zooOn) out.push(zooFace(L.zoo));
	if (badger) out.push(badgerFace(format === 'vertical' ? BADGER_INSERT.vertical : L.badger));
	return out;
};

const hit = (a: Box, b: Box, m: number) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;

/** Candidate caption positions for a plate of w x h, in order of preference. */
export const captionCandidates = (format: Format, w: number, h: number): Array<{x: number; y: number}> => {
	const spec = CAPTIONS[format];
	const cx = spec.box.x + spec.box.w / 2;
	if (format === 'vertical') {
		const yMid = Math.round(spec.box.y + (spec.box.h - h) / 2);
		const xC = Math.round(cx - w / 2);
		return [
			{x: xC, y: yMid},
			{x: xC, y: spec.box.y},
			{x: xC, y: spec.box.y + spec.box.h - h},
		];
	}
	const safe = SAFE.landscape;
	const yB = spec.box.y + spec.box.h - h;
	return [
		{x: Math.round(cx - w / 2), y: yB},
		{x: safe.left, y: yB},
		{x: safe.right - w, y: yB},
		{x: Math.round(FRAME.landscape.width / 2 - w / 2), y: safe.top},
	];
};

/** The first candidate clear of every face (24 px margin); the first candidate if none is clear. */
export const placeCaption = (format: Format, w: number, h: number, faces: Box[], margin = 24): {x: number; y: number; clear: boolean} => {
	const cands = captionCandidates(format, w, h);
	for (const c of cands) if (!faces.some((f) => hit({x: c.x, y: c.y, w, h}, f, margin))) return {...c, clear: true};
	return {...cands[0], clear: false};
};
