/**
 * Show segments (The Zoo & Badger Show). The show's contract lives in video-studio src/show/types.ts and
 * src/show/segments.ts (another workflow; read-only here): `StoryboardScene.segment` is one of coldOpen, headline,
 * howItWorked, badgerRedFlag, zooOneFix, scamOfTheWeek, correction, sources, outroEndScreen, beat or desk, and a scene
 * without one renders as hook -> coldOpen, endscreen -> outroEndScreen, anything else -> desk. The Rekt Meter is part
 * of the headline segment.
 *
 * A scene's segment, in this order:
 *   1. `scene.segment` (any string; also `scene.show.segment`)                       -> source "explicit"
 *   2. uploads rendered by the SHOW: the show's own default from the scene type        -> source "default"
 *   3. uploads rendered by the episode engine: the on-screen title of the scene in the SOURCE-language storyboard
 *      (scene ids are stable across languages), when it starts with a recurring segment name such as
 *      "Badger's Red Flag" or "Zoo's One Fix"                                          -> source "inferred"
 *
 * Names are normalised to PascalCase ("badgerRedFlag", "Badger's Red Flag" and "red-flag" all become
 * "BadgerRedFlag"). An explicit name that is not known is kept, normalised, so new segments work without a code change.
 */
import {SCENE_TYPES, type SegmentSource, type StoryboardSceneInput} from './types.ts';

/** Known segments, in running order, for sorting the report. Unknown explicit names sort after these. */
export const KNOWN_SEGMENTS = [
	'ColdOpen',
	'Headline',
	'RektMeter',
	'HowItWorked',
	'BadgerRedFlag',
	'ZooOneFix',
	'ScamOfTheWeek',
	'WhatWeKnow',
	'Correction',
	'Sources',
	'Desk',
	'Beat',
	'OutroEndScreen',
] as const;

/** Which composition rendered the upload: the episode engine (src/episode) or the show (src/show). */
export type Renderer = 'episode' | 'show';

const ALIASES: Record<string, string> = {
	coldopen: 'ColdOpen',
	headline: 'Headline',
	headlines: 'Headline',
	howitworked: 'HowItWorked',
	howitworks: 'HowItWorked',
	rektmeter: 'RektMeter',
	badgerredflag: 'BadgerRedFlag',
	badgersredflag: 'BadgerRedFlag',
	redflag: 'BadgerRedFlag',
	zooonefix: 'ZooOneFix',
	zoosonefix: 'ZooOneFix',
	onefix: 'ZooOneFix',
	scamoftheweek: 'ScamOfTheWeek',
	whatweknow: 'WhatWeKnow',
	correction: 'Correction',
	sources: 'Sources',
	desk: 'Desk',
	beat: 'Beat',
	outroendscreen: 'OutroEndScreen',
};

const key = (name: string): string => name.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]/g, '');

/** Canonical PascalCase name, or null for an empty or non-text name. */
export const canonicalSegment = (name: unknown): string | null => {
	if (typeof name !== 'string') return null;
	const trimmed = name.trim();
	if (!trimmed || trimmed.length > 60) return null;
	const alias = ALIASES[key(trimmed)];
	if (alias) return alias;
	const words = trimmed.replace(/['’]/g, '').split(/[^A-Za-z0-9]+/).filter(Boolean);
	if (!words.length) return null;
	// keep inner capitals of an already PascalCase word ("RektMeter"), capitalise the rest
	return words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join('');
};

const INFER: [RegExp, string][] = [
	[/^badger['’]?s red flag\b/i, 'BadgerRedFlag'],
	[/^zoo['’]?s one fix\b/i, 'ZooOneFix'],
	[/^rekt meter\b/i, 'RektMeter'],
	[/^scam of the week\b/i, 'ScamOfTheWeek'],
	[/^what we know\b/i, 'WhatWeKnow'],
];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const ENGINE_TYPES: ReadonlySet<string> = new Set(SCENE_TYPES);

const explicitOf = (scene: StoryboardSceneInput | undefined): string | null => {
	if (!scene) return null;
	const direct = canonicalSegment(scene.segment);
	if (direct) return direct;
	if (isRecord(scene.show)) {
		const nested = canonicalSegment(scene.show.segment) ?? canonicalSegment(scene.show.id);
		if (nested) return nested;
	}
	if (typeof scene.type === 'string' && !ENGINE_TYPES.has(scene.type)) {
		const fromType = canonicalSegment(scene.type);
		if (fromType && (KNOWN_SEGMENTS as readonly string[]).includes(fromType)) return fromType;
	}
	return null;
};

const titleOf = (scene: StoryboardSceneInput | undefined): string | null => {
	const title = scene?.onScreen?.title;
	return typeof title === 'string' ? title : null;
};

/** The show's default segment for a scene without one (src/show/segments.ts BY_TYPE); charts have none. */
const SHOW_DEFAULT: Record<string, string> = {hook: 'ColdOpen', endscreen: 'OutroEndScreen', talk: 'Desk', steps: 'Desk', quote: 'Desk', cta: 'Desk'};

/**
 * The segment of a scene. `scene` is the scene in the upload's language, `source` the same scene id in the
 * source-language storyboard (titles there are English, so inference works for dubbed uploads too).
 */
export const resolveSegment = (
	scene: StoryboardSceneInput | undefined,
	source: StoryboardSceneInput | undefined,
	renderer: Renderer = 'episode',
): {segment: string | null; source: SegmentSource | null} => {
	const explicit = explicitOf(scene) ?? explicitOf(source);
	if (explicit) return {segment: explicit, source: 'explicit'};
	if (renderer === 'show') {
		const type = scene?.type ?? source?.type;
		const fallback = type ? SHOW_DEFAULT[type] : undefined;
		return fallback ? {segment: fallback, source: 'default'} : {segment: null, source: null};
	}
	for (const title of [titleOf(source), titleOf(scene)]) {
		if (!title) continue;
		for (const [pattern, name] of INFER) if (pattern.test(title.trim())) return {segment: name, source: 'inferred'};
	}
	return {segment: null, source: null};
};

/** Sort key: known segments in running order, then others alphabetically. */
export const segmentOrder = (segment: string): number => {
	const i = (KNOWN_SEGMENTS as readonly string[]).indexOf(segment);
	return i === -1 ? KNOWN_SEGMENTS.length : i;
};
