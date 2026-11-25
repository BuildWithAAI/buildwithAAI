/**
 * Animation awareness. A text sliding in, a wipe revealing a title or a face entering the frame is clipped,
 * outside the safe area or over something for a few frames by design. The checker compares each element's
 * geometry with the neighbouring scouted frames: when it changes, the element is animating at that frame and
 * geometry findings there are informational; settled frames keep their full severity.
 */
import type {FrameFacts, Rect} from '../../../src/qa/protocol.ts';
import {charKey, textKey} from './checks/dom.ts';
import {unionRect} from './image.ts';
import type {Finding} from './issues.ts';

export type Geo = {box: Rect; vis: number; op: number};
export type GeoMap = Map<number, Map<string, Geo>>;

export const geometryOf = (f: FrameFacts): Map<string, Geo> => {
	const m = new Map<string, Geo>();
	const caps = f.texts.filter((t) => t.role === 'caption');
	for (const t of f.texts) m.set(textKey(t), {box: t.box, vis: t.visibleFrac, op: t.opacity});
	const cb = unionRect(caps.map((t) => t.box));
	if (cb) m.set('captions', {box: cb, vis: Math.min(...caps.map((t) => t.visibleFrac)), op: Math.min(...caps.map((t) => t.opacity))});
	for (const c of f.chars) m.set(charKey(c), {box: c.headBox ?? c.box, vis: 1, op: c.effects.opacity});
	return m;
};

export const buildGeo = (facts: Iterable<FrameFacts>): GeoMap => {
	const g: GeoMap = new Map();
	for (const f of facts) g.set(f.frame, geometryOf(f));
	return g;
};

const same = (a: Geo, b: Geo) =>
	Math.abs(a.box.x - b.box.x) <= 1 && Math.abs(a.box.y - b.box.y) <= 1 && Math.abs(a.box.w - b.box.w) <= 1 && Math.abs(a.box.h - b.box.h) <= 1 && Math.abs(a.vis - b.vis) <= 0.01 && Math.abs(a.op - b.op) <= 0.01;

/**
 * true = identical in every scouted neighbour (t-1, t+1); false = it moved, faded, clipped differently,
 * appeared or disappeared; null = no neighbour was scouted (unknown: treated as settled).
 */
export const settledAt = (geo: GeoMap, key: string, frame: number): boolean | null => {
	const cur = geo.get(frame)?.get(key);
	if (!cur) return null;
	let seen = false;
	for (const n of [frame - 1, frame + 1]) {
		const g = geo.get(n);
		if (!g) continue;
		seen = true;
		const o = g.get(key);
		if (!o || !same(cur, o)) return false;
	}
	return seen ? true : null;
};

const SENSITIVE = new Set(['text-clipped', 'text-offframe', 'text-overflow', 'text-small', 'text-collision', 'safe-area', 'shorts-ui', 'shorts-ads', 'text-face-zone', 'caption-face', 'text-face']);

/** Geometry findings on animating elements become information (faces/captions overlaps become warnings). */
export const demoteTransient = (findings: Finding[], geo: GeoMap): number => {
	let n = 0;
	for (const f of findings) {
		if (!SENSITIVE.has(f.check) || !f.elementKey) continue;
		if (settledAt(geo, f.elementKey, f.frame) !== false && (!f.elementKey2 || settledAt(geo, f.elementKey2, f.frame) !== false)) continue;
		n++;
		if (f.check === 'caption-face' || f.check === 'text-face') {
			if (f.severity === 'error') f.severity = 'warn';
		} else f.severity = 'info';
		if (!f.message.endsWith('(while animating)')) f.message += ' (while animating)';
	}
	return n;
};

/** Inside a scene transition two scenes overlap by design: geometry and coverage findings there are information. */
export const demoteInTransitions = (findings: Finding[], transitions: Set<number>): number => {
	let n = 0;
	for (const f of findings) {
		// a provisional drawing is provisional in a transition too: model-provisional keeps its severity (error or warning)
		if (!transitions.has(f.frame) || f.check === 'one-frame-state' || f.check === 'banned' || f.check === 'text-name' || f.check === 'model-provisional' || f.severity === 'info') continue;
		f.severity = 'info';
		if (!f.message.endsWith('(during a transition)')) f.message += ' (during a transition)';
		n++;
	}
	return n;
};
