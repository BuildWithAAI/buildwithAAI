/**
 * Frame selection: parsing explicit lists ("0,15,30-40,100") and the automatic plan (scene boundaries from
 * the scout's cut detection, mid-scene flicker triplets, every Nth frame, the first frame of every DOM issue,
 * and coarse pop candidates), capped at `maxSamples`.
 */

export type Reason = 'every-n' | 'scene-start' | 'scene-end' | 'mid-scene' | 'flicker-triplet' | 'issue' | 'pop-candidate' | 'listed';

/** "0,15,30-40" → sorted unique frames inside [0, duration). Throws on bad syntax or out-of-range frames. */
export const parseFrameList = (spec: string, duration: number): number[] => {
	const out = new Set<number>();
	for (const raw of spec.split(',')) {
		const part = raw.trim();
		if (!part) continue;
		const m = /^(\d+)(?:-(\d+))?$/.exec(part);
		if (!m) throw new Error(`bad frame list item "${part}" (use e.g. 0,15,30-40)`);
		const a = Number(m[1]);
		const b = m[2] === undefined ? a : Number(m[2]);
		if (b < a) throw new Error(`bad frame range "${part}" (end before start)`);
		if (b >= duration) throw new Error(`frame ${b} is out of range (the composition has ${duration} frames: 0-${duration - 1})`);
		for (let f = a; f <= b; f++) out.add(f);
	}
	if (!out.size) throw new Error('the frame list is empty');
	return [...out].sort((x, y) => x - y);
};

/**
 * Scenes as [start, end) from scout boundaries ([s, e]: a hard cut is [t, t]; a transition's in-between frames
 * are s..e-1 and its new scene starts at e).
 */
export const scenesFromBoundaries = (boundaries: Array<[number, number]>, duration: number): Array<[number, number]> => {
	const scenes: Array<[number, number]> = [];
	let start = 0;
	for (const [s, e] of [...boundaries].sort((a, b) => a[0] - b[0])) {
		if (s > start) scenes.push([start, s]);
		start = Math.max(start, e);
	}
	if (start < duration) scenes.push([start, duration]);
	return scenes;
};

export type PlanInput = {
	duration: number;
	fps: number;
	boundaries: Array<[number, number]>;
	issueFrames: number[];
	popCandidates: number[];
	everyN?: number;
	maxSamples?: number;
};

export type Plan = {frames: number[]; reasons: Map<number, Set<Reason>>; everyN: number; scenes: Array<[number, number]>};

/** Default stride: one frame per second, widened so the stride samples stay under a third of the budget. */
export const defaultEveryN = (duration: number, fps: number, maxSamples: number): number => Math.max(Math.round(fps), Math.ceil(duration / Math.max(1, Math.floor(maxSamples / 3))));

export const planSamples = (p: PlanInput): Plan => {
	const max = p.maxSamples ?? 240;
	const reasons = new Map<number, Set<Reason>>();
	const add = (f: number, r: Reason) => {
		if (f < 0 || f >= p.duration) return;
		const s = reasons.get(f);
		if (s) s.add(r);
		else reasons.set(f, new Set([r]));
	};
	const scenes = scenesFromBoundaries(p.boundaries, p.duration);
	const inTransition = new Set<number>();
	for (const [s, e] of p.boundaries) for (let f = s; f < e; f++) inTransition.add(f);
	// priority 1: issues and pop candidates (each needs real pixels), scene edges, mid-scene triplets
	for (const f of p.issueFrames) add(f, 'issue');
	for (const t of p.popCandidates) for (const f of [t - 1, t, t + 1]) add(f, 'pop-candidate');
	for (const [s, e] of scenes) {
		add(s, 'scene-start');
		add(e - 1, 'scene-end');
		if (e - s >= 3) {
			const m = Math.floor((s + e - 1) / 2);
			add(m - 1, 'flicker-triplet');
			add(m, 'mid-scene');
			add(m + 1, 'flicker-triplet');
		}
	}
	// priority 2: the regular stride, as far as the budget allows
	let everyN = p.everyN ?? defaultEveryN(p.duration, p.fps, max);
	const fixed = reasons.size;
	if (!p.everyN && fixed + Math.ceil(p.duration / everyN) > max) everyN = Math.ceil(p.duration / Math.max(1, max - fixed));
	for (let f = 0; f < p.duration; f += everyN) {
		// stride frames that land inside a transition move to the next settled frame
		let g = f;
		while (inTransition.has(g) && g < p.duration - 1) g++;
		add(g, 'every-n');
	}
	let frames = [...reasons.keys()].sort((a, b) => a - b);
	if (frames.length > max) {
		// over budget even without the stride: keep issues, pops and scene edges, thin the rest evenly
		const keep = frames.filter((f) => {
			const r = reasons.get(f) as Set<Reason>;
			return r.has('issue') || r.has('pop-candidate') || r.has('scene-start');
		});
		const rest = frames.filter((f) => !keep.includes(f));
		const room = Math.max(0, max - keep.length);
		const step = rest.length / Math.max(1, room);
		const picked = room ? Array.from({length: Math.min(room, rest.length)}, (_, i) => rest[Math.floor(i * step)]) : [];
		frames = [...new Set([...keep, ...picked])].sort((a, b) => a - b);
		for (const f of [...reasons.keys()]) if (!frames.includes(f)) reasons.delete(f);
	}
	return {frames, reasons, everyN, scenes};
};

/** Scout stride: every frame up to 2 minutes at 30 fps, then widened to stay near 3600 frames. */
export const scoutStep = (duration: number, cap = 3600): number => Math.max(1, Math.ceil(duration / cap));
