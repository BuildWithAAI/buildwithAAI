/**
 * The scene model: which templates lose viewers faster than expected at their moment.
 *
 * Fitted per channel and format. Unit: one eligible scene (at least 2 whole curve buckets inside it, not the opening
 * scene, not the end screen, known type). Outcome: its loss rate, % of the viewers still watching who leave per
 * 10 s, measured between the first and last whole buckets INSIDE the scene (so a neighbour's steep drop, such as the
 * end screen's, does not leak in through the bucket that straddles the cut).
 *
 *   loss rate = upload level + drop-off at the scene's moment + template + Badger + noise
 *
 *  - upload level: a fixed effect per upload (topic, thumbnail, audience, language version), removed by demeaning;
 *  - drop-off: viewers leave fastest early in a video whatever the content. PRIMARY fit: an early drop-off that
 *    fades, exp(-t/τ), with τ picked from a grid (2-64 s long-form, 1-16 s Shorts) by the smallest residual error.
 *    SENSITIVITY fit: the same plus a slope in log time and a hinge at the median moment, which can bend to follow
 *    the curve but can also soak up a template that always sits at the same moment;
 *  - template: one category per scene, its show segment when it has one, else its template type;
 *  - Badger: on screen or not, identified only by scenes of the same template with and without him.
 *
 * Everything is fitted together (a curve fitted first leaks its misfit into templates with fixed moments, and "this
 * scene vs the rest of its episode" makes every other scene look good when one is bad). Template effects are reported
 * against the MEDIAN template, so one bad segment does not shift the others. Standard errors are clustered by episode
 * (language versions of an episode are not independent); intervals use Student's t on G - 1 degrees of freedom.
 * An effect is flagged `momentConfounded` (and never becomes a recommendation) when either
 *   - the template's ORDER never changes: in every episode it comes before (or after) the same other templates, so
 *     its effect and the effect of that moment of the video are the same thing in the data; or
 *   - the sensitivity fit does not confirm it (its interval includes 0, or the sign flips).
 * The template may simply sit at a hard moment; putting it somewhere else in a few episodes would tell.
 */
import {clusteredOls, coefficientT, median, quantile, type TResult} from './stats.ts';
import type {Format} from './types.ts';

export type SceneRow = {
	upload: string;
	episode: string;
	channel: string;
	sceneId: string;
	t: number; // scene midpoint, seconds
	y: number; // loss rate, % of the viewers still watching per 10 s
	category: string;
	categoryKind: 'type' | 'segment';
	badger: boolean;
	lengthSec: number;
};

export type CategoryEffect = {
	category: string;
	kind: 'type' | 'segment';
	isReference: boolean; // the median template itself (0 by definition)
	result: TResult | null; // primary fit
	sensitivity: TResult | null; // flexible drop-off fit (null when it could not be fitted)
	/** Its order relative to some other template differs between uploads (needed to tell it from its moment). */
	orderVaries: boolean;
	momentConfounded: boolean;
	episodes: number;
	scenes: number;
	medianLengthSec: number | null;
	momentsSec: [number, number]; // earliest and latest midpoint seen
};

export type SceneModelResult = {
	channel: string;
	format: Format;
	reference: string; // the median template(s) the effects are measured against
	categories: CategoryEffect[];
	badger: {result: TResult | null; sensitivity: TResult | null; momentConfounded: boolean; episodes: number; scenes: number; on: number; off: number; categories: number} | null;
	scenes: number;
	uploads: number;
	episodes: number;
	clusters: number;
	tauSec: number; // the drop-off time constant picked for the primary fit
	/** Expected loss rate of the median template, without Badger, at each scene's moment of its upload: `${upload}|${sceneId}`. */
	expected: Map<string, number>;
	notes: string[];
};

export const MODEL_MIN_EPISODES = 5;
export const MODEL_MIN_SCENES = 12;

type Fit = NonNullable<ReturnType<typeof clusteredOls>>;

/** Demeans every column (and y) within each upload: the upload fixed effect. */
const withinUpload = (rows: readonly SceneRow[], X: number[][], y: number[]): {X: number[][]; y: number[]} => {
	const groups = new Map<string, number[]>();
	rows.forEach((r, i) => groups.set(r.upload, [...(groups.get(r.upload) ?? []), i]));
	const Xd = X.map((row) => [...row]);
	const yd = [...y];
	const p = X[0]?.length ?? 0;
	for (const idx of groups.values()) {
		const my = idx.reduce((a, i) => a + y[i]!, 0) / idx.length;
		const mx = Array.from({length: p}, (_, j) => idx.reduce((a, i) => a + X[i]![j]!, 0) / idx.length);
		for (const i of idx) {
			yd[i] = y[i]! - my;
			for (let j = 0; j < p; j++) Xd[i]![j] = X[i]![j]! - mx[j]!;
		}
	}
	return {X: Xd, y: yd};
};

export const TAU_GRID_SEC: Record<Format, number[]> = {long: [2, 4, 8, 16, 32, 64], short: [1, 2, 4, 8, 16]};

/** Primary: [exp(-t/τ)]. Flexible: [exp(-t/τ), ln(1+t), max(0, ln(1+t) - ln(1+knot))]. */
const timeBasis = (t: number, tau: number, knot: number, flexible: boolean): number[] => {
	const early = Math.exp(-t / tau);
	if (!flexible) return [early];
	const L = Math.log1p(t);
	return [early, L, Math.max(0, L - Math.log1p(knot))];
};

type Layout = {categories: string[]; coded: string[]; dropped: string; badger: boolean; tau: number; knot: number; flexible: boolean};

const fitWith = (rows: readonly SceneRow[], layout: Layout): Fit | null => {
	const X = rows.map((r) => [
		...layout.coded.map((c) => (r.category === c ? 1 : 0)),
		...(layout.badger ? [r.badger ? 1 : 0] : []),
		...timeBasis(r.t, layout.tau, layout.knot, layout.flexible),
	]);
	const d = withinUpload(rows, X, rows.map((r) => r.y));
	if (d.X[0]!.some((_, j) => d.X.every((row) => Math.abs(row[j]!) < 1e-12))) return null; // a column vanished: not identifiable
	return clusteredOls(d.X, d.y, rows.map((r) => r.episode));
};

/** Effect of each template against the median template, with the interval of that contrast. */
const centred = (fit: Fit, layout: Layout): {centre: number; medianCats: string[]; effect: (c: string) => TResult | null; beta: Map<string, number>} => {
	const beta = new Map<string, number>(layout.categories.map((c) => [c, c === layout.dropped ? 0 : fit.beta[layout.coded.indexOf(c)]!]));
	const ordered = [...layout.categories].sort((a, b) => beta.get(a)! - beta.get(b)! || a.localeCompare(b));
	const mid = (ordered.length - 1) / 2;
	const medianCats = ordered.length % 2 ? [ordered[mid]!] : [ordered[Math.floor(mid)]!, ordered[Math.ceil(mid)]!];
	const centre = medianCats.reduce((a, c) => a + beta.get(c)!, 0) / medianCats.length;
	const at = (cat: string) => (cat === layout.dropped ? -1 : layout.coded.indexOf(cat));
	const effect = (category: string): TResult | null => {
		if (medianCats.length === 1 && medianCats[0] === category) return null;
		const c = new Array<number>(fit.vcov.length).fill(0);
		if (at(category) >= 0) c[at(category)]! += 1;
		for (const m of medianCats) if (at(m) >= 0) c[at(m)]! -= 1 / medianCats.length;
		let v = 0;
		for (let i = 0; i < c.length; i++) for (let j = 0; j < c.length; j++) v += c[i]! * fit.vcov[i]![j]! * c[j]!;
		const se = Math.sqrt(Math.max(0, v));
		return se > 0 ? coefficientT(beta.get(category)! - centre, se, fit.df, fit.n) : null;
	};
	return {centre, medianCats, effect, beta};
};

/** The sensitivity fit confirms an effect when its interval also excludes 0 on the same side. */
const confirmed = (primary: TResult | null, check: TResult | null): boolean => {
	if (!primary || !check) return false;
	const side = Math.sign(primary.estimate);
	return side !== 0 && Math.sign(check.estimate) === side && (side > 0 ? check.ci95[0] > 0 : check.ci95[1] < 0);
};

export const fitSceneModel = (input: readonly SceneRow[], channel: string, format: Format): SceneModelResult | null => {
	const counts = new Map<string, number>();
	for (const r of input) counts.set(r.upload, (counts.get(r.upload) ?? 0) + 1);
	const notes: string[] = [];
	// one scene says nothing once its upload's level is removed; nor does a template that never shares an upload with
	// another template (its effect cannot be told apart from those uploads' levels)
	const multi = input.filter((r) => counts.get(r.upload)! >= 2);
	const mixed = new Set<string>();
	const byUploadCats = new Map<string, Set<string>>();
	for (const r of multi) byUploadCats.set(r.upload, (byUploadCats.get(r.upload) ?? new Set()).add(r.category));
	for (const r of multi) if (byUploadCats.get(r.upload)!.size > 1) mixed.add(r.category);
	const alone = [...new Set(multi.map((r) => r.category))].filter((c) => !mixed.has(c)).sort();
	if (alone.length) notes.push(`${alone.join(', ')} never shared an upload with another template, so ${alone.length === 1 ? 'it was' : 'they were'} left out`);
	const rows = multi.filter((r) => mixed.has(r.category));
	const episodes = new Set(rows.map((r) => r.episode));
	if (episodes.size < MODEL_MIN_EPISODES || rows.length < MODEL_MIN_SCENES) return null;

	const categories = [...new Set(rows.map((r) => r.category))].sort();
	const frequency = (c: string) => rows.filter((r) => r.category === c).length;
	const dropped = [...categories].sort((a, b) => frequency(b) - frequency(a) || a.localeCompare(b))[0]!;
	const coded = categories.filter((c) => c !== dropped);
	const knot = quantile(rows.map((r) => r.t), 0.5)!;
	const badgerVaries = categories.some((c) => {
		const inCat = rows.filter((r) => r.category === c);
		return inCat.some((r) => r.badger) && inCat.some((r) => !r.badger);
	});
	const base = {categories, coded, dropped, knot, flexible: false};
	// the drop-off's time constant: the grid value with the smallest residual error (profiled with everything else)
	let best: {fit: Fit; layout: Layout; sse: number} | null = null;
	for (const withBadger of badgerVaries ? [true, false] : [false]) {
		for (const tau of TAU_GRID_SEC[format]) {
			const layout: Layout = {...base, badger: withBadger, tau};
			const fit = fitWith(rows, layout);
			if (fit && (!best || fit.sse < best.sse)) best = {fit, layout, sse: fit.sse};
		}
		if (best) break;
	}
	if (!best) return null;
	const {fit, layout} = best;
	if (badgerVaries && !layout.badger) notes.push('Badger was left out: his presence could not be told apart from the templates');
	const flexLayout: Layout = {...layout, flexible: true};
	const flex = fitWith(rows, flexLayout);
	if (!flex) notes.push('the flexible drop-off check could not be fitted, so no template effect is confirmed against it');

	const primary = centred(fit, layout);
	const check = flex ? centred(flex, flexLayout) : null;

	// order: does each template come both before and after some other template, across uploads?
	const before = new Set<string>();
	const byUploadOrder = new Map<string, SceneRow[]>();
	for (const r of rows) byUploadOrder.set(r.upload, [...(byUploadOrder.get(r.upload) ?? []), r]);
	for (const list of byUploadOrder.values()) {
		const sorted = [...list].sort((a, b) => a.t - b.t);
		for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length; j++) if (sorted[i]!.category !== sorted[j]!.category) before.add(`${sorted[i]!.category}\u0000${sorted[j]!.category}`);
	}
	const orderVaries = (c: string): boolean => categories.some((d) => d !== c && before.has(`${c}\u0000${d}`) && before.has(`${d}\u0000${c}`));
	const effects: CategoryEffect[] = categories.map((category) => {
		const inCat = rows.filter((r) => r.category === category);
		const result = primary.effect(category);
		const sensitivity = check ? check.effect(category) : null;
		const isReference = primary.medianCats.length === 1 && primary.medianCats[0] === category;
		return {
			category,
			kind: inCat[0]!.categoryKind,
			isReference,
			result,
			sensitivity,
			orderVaries: orderVaries(category),
			momentConfounded: !isReference && result !== null && (!orderVaries(category) || !confirmed(result, sensitivity)),
			episodes: new Set(inCat.map((r) => r.episode)).size,
			scenes: inCat.length,
			medianLengthSec: median(inCat.map((r) => r.lengthSec)),
			momentsSec: [Math.min(...inCat.map((r) => r.t)), Math.max(...inCat.map((r) => r.t))],
		};
	});

	let badger: SceneModelResult['badger'] = null;
	if (layout.badger) {
		const col = coded.length;
		const informative = rows.filter((r) => {
			const inCat = rows.filter((x) => x.category === r.category);
			return inCat.some((x) => x.badger) && inCat.some((x) => !x.badger);
		});
		const result = coefficientT(fit.beta[col]!, fit.se[col]!, fit.df, fit.n);
		const sensitivity = flex ? coefficientT(flex.beta[col]!, flex.se[col]!, flex.df, flex.n) : null;
		badger = {
			result,
			sensitivity,
			momentConfounded: !confirmed(result, sensitivity),
			episodes: new Set(informative.map((r) => r.episode)).size,
			scenes: informative.length,
			on: informative.filter((r) => r.badger).length,
			off: informative.filter((r) => !r.badger).length,
			categories: new Set(informative.map((r) => r.category)).size,
		};
	}

	// expected loss rate of the median template, without Badger, at each scene's moment of its upload (primary fit)
	const timeCol = coded.length + (layout.badger ? 1 : 0);
	const timePart = (r: SceneRow) => timeBasis(r.t, layout.tau, knot, false).reduce((a, v, j) => a + v * fit.beta[timeCol + j]!, 0);
	const badgerPart = (r: SceneRow) => (layout.badger && r.badger ? fit.beta[coded.length]! : 0);
	const byUpload = new Map<string, SceneRow[]>();
	for (const r of rows) byUpload.set(r.upload, [...(byUpload.get(r.upload) ?? []), r]);
	const expected = new Map<string, number>();
	for (const [upload, list] of byUpload) {
		const level = list.reduce((a, r) => a + (r.y - timePart(r) - primary.beta.get(r.category)! - badgerPart(r)), 0) / list.length;
		for (const r of list) expected.set(`${upload}|${r.sceneId}`, level + timePart(r) + primary.centre);
	}

	return {
		channel,
		format,
		reference: primary.medianCats.join(' / '),
		categories: effects,
		badger,
		scenes: rows.length,
		uploads: byUpload.size,
		episodes: episodes.size,
		clusters: fit.clusters,
		tauSec: layout.tau,
		expected,
		notes,
	};
};
