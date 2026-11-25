/**
 * Frozen identity facts from the character manifest (src/characters/manifest.v1.json): the approved palette,
 * Badger's marking ids per body view and pose, and the screen-side conventions for Zoo's pin and Badger's
 * dark ear cap. These are the record the assets must keep matching, independent of the current code.
 */
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {hexToRgb, type RGB} from './color.ts';
import {loadProvisional, type Provisional} from './provisional.ts';

export type Manifest = {
	version: string;
	palette: Array<{name: string; rgb: RGB}>;
	/** Body marking ids (no H-* head markings) per Badger body view or pose. */
	badgerBody: Record<string, string[]>;
	badgerHeadIds: string[];
	colours: {pin: RGB; spot: RGB; earCap: RGB; line: RGB; tag: RGB};
	/** Drawings the assets render but the owner has not accepted yet (BADGER_PROVISIONAL_POSES, see provisional.ts). */
	provisional: Provisional;
	/**
	 * Markings a head draws more than once on purpose, on its own side rig (manifest markings.badger.redrawn, decision
	 * INT-Q2: a look-up head's neck part above the collar is drawn again in front of the torso). Keyed by head view.
	 */
	badgerRedrawn?: Record<string, {view: string; ids: string[]; draws: number}>;
};

type RawManifest = {
	version: string;
	palette: Record<string, unknown>;
	markings: {badger: Record<string, unknown>};
};

export const loadManifest = (projectRoot: string): Manifest => {
	const raw = JSON.parse(readFileSync(join(projectRoot, 'src', 'characters', 'manifest.v1.json'), 'utf8')) as RawManifest;
	const palette: Manifest['palette'] = [];
	const seen = new Set<string>();
	const add = (name: string, v: unknown) => {
		if (typeof v !== 'string' || !/^#[0-9a-f]{6}$/i.test(v)) return;
		const key = v.toUpperCase();
		if (seen.has(key)) return;
		seen.add(key);
		palette.push({name, rgb: hexToRgb(v)});
	};
	for (const [group, v] of Object.entries(raw.palette)) {
		if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k, c] of Object.entries(v as Record<string, unknown>)) add(`${group}.${k}`, c);
	}
	const badgerBody: Record<string, string[]> = {};
	for (const [k, v] of Object.entries(raw.markings.badger)) {
		if (!Array.isArray(v) || k === 'head' || k === 'frontNeck') continue;
		badgerBody[k] = (v as Array<{id: string}>).map((s) => s.id).filter((id) => !id.startsWith('H-'));
	}
	const headIds = ((raw.markings.badger.head as Array<{id: string}> | undefined) ?? []).map((s) => s.id);
	const badgerRedrawn: NonNullable<Manifest['badgerRedrawn']> = {};
	const redrawn = (raw.markings.badger.redrawn as {heads?: Record<string, {view?: unknown; ids?: unknown; draws?: unknown}>} | undefined)?.heads ?? {};
	for (const [head, r] of Object.entries(redrawn)) {
		if (!r || typeof r.view !== 'string' || !Array.isArray(r.ids)) continue;
		const draws = typeof r.draws === 'number' && r.draws >= 1 ? Math.floor(r.draws) : 2;
		badgerRedrawn[head] = {view: r.view, ids: r.ids.filter((x): x is string => typeof x === 'string'), draws};
	}
	const pal = raw.palette as {zoo: {pin: string}; badger: {spot: string; earCap: string; tag: string}; line: {color: string}};
	return {
		version: raw.version,
		palette,
		badgerBody,
		badgerHeadIds: headIds,
		colours: {pin: hexToRgb(pal.zoo.pin), spot: hexToRgb(pal.badger.spot), earCap: hexToRgb(pal.badger.earCap), line: hexToRgb(pal.line.color), tag: hexToRgb(pal.badger.tag)},
		provisional: loadProvisional(projectRoot),
		badgerRedrawn,
	};
};

/**
 * How many times each body marking may be drawn on a Badger instance: once, except the ids the manifest lists for the
 * instance's head on that head's own rig (decision INT-Q2), which may appear up to `draws` times.
 */
export const allowedMarkingDraws = (m: Manifest, head: string | null, view: string | null): Map<string, number> => {
	const out = new Map<string, number>();
	const r = head ? m.badgerRedrawn?.[head] : undefined;
	if (r && view === r.view) for (const id of r.ids) out.set(id, r.draws);
	return out;
};

/**
 * The frozen body-marking list for a Badger instance: sit and lie use the pose body (the left-facing ones, drawn view
 * 'left', have their own LEFT coat-map lists sitLeft / lieLeft, decision BADGER-D23), everything else the view.
 */
export const expectedBadgerBody = (m: Manifest, view: string | null, pose: string | null): string[] | null => {
	if (pose === 'sit' || pose === 'lie') return m.badgerBody[view === 'left' ? `${pose}Left` : pose] ?? null;
	return view ? (m.badgerBody[view] ?? null) : null;
};

/**
 * Screen side of Badger's dark ear cap where the manifest fixes it: the front head shows the anatomical LEFT
 * ear on the viewer's RIGHT; the back view shows it on the viewer's LEFT (manifest conventions.badger).
 */
export const expectedEarCapSide = (head: string | null, view: string | null): 'left' | 'right' | null => {
	if (view === 'back') return 'left';
	if (head === 'front') return 'right';
	return null;
};

/** Where Zoo's pin must be: visible on the screen-right side (front, 3/4, typing) or hidden (side, back). */
export const expectedPin = (view: string | null, pose: string | null): 'right' | 'hidden' | null => {
	if (pose === 'typing') return 'right';
	if (view === 'front' || view === 'threeQuarter') return 'right';
	if (view === 'side' || view === 'back') return 'hidden';
	return null;
};
