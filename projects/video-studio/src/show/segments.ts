/**
 * Segment resolution and the onScreen keys each segment reads (pure).
 * A scene's segment is `scene.segment`, or a default from its episode `type`, so any news storyboard renders in the
 * show format: hook -> coldOpen, endscreen -> outroEndScreen, everything else -> desk (Zoo at the desk with the
 * scene's title and bullets). Chart scenes are refused: the security show has no price charts.
 */
import type {SceneType} from '../episode/types.ts';
import type {ShowScene, ShowSegment} from './types.ts';
import {SHOW_SEGMENTS} from './types.ts';

const BY_TYPE: Record<Exclude<SceneType, 'chart'>, ShowSegment> = {
	hook: 'coldOpen',
	talk: 'desk',
	steps: 'desk',
	quote: 'desk',
	cta: 'desk',
	endscreen: 'outroEndScreen',
};

export const isSegment = (s: unknown): s is ShowSegment => typeof s === 'string' && (SHOW_SEGMENTS as readonly string[]).includes(s);

export const segmentOf = (sc: Pick<ShowScene, 'segment' | 'type' | 'id'>): ShowSegment => {
	if (sc.segment !== undefined) {
		if (!isSegment(sc.segment)) throw new Error(`scene ${sc.id}: unknown segment "${String(sc.segment)}" (one of: ${SHOW_SEGMENTS.join(', ')})`);
		return sc.segment;
	}
	if (sc.type === 'chart') throw new Error(`scene ${sc.id}: chart scenes are not part of the security show (no price talk); give it a segment or drop it`);
	const seg = BY_TYPE[sc.type as Exclude<SceneType, 'chart'>];
	if (!seg) throw new Error(`scene ${sc.id}: unknown scene type "${String(sc.type)}"`);
	return seg;
};

export type SegmentSpec = {
	/** onScreen keys that must be non-empty strings. */
	required: string[];
	/** onScreen keys the segment draws when present (strings, or string lists where noted in `lists`). */
	optional: string[];
	lists?: string[];
	/** The segment's tag (its UI label key), shown top-left while it runs. */
	tag: 'rektMeter' | 'howItWorked' | 'redFlag' | 'oneFix' | 'scamOfTheWeek' | 'correction' | 'sources' | null;
	/** Badger's default reaction at the end of the scene when the storyboard names none. */
	defaultReaction: 'judge' | 'lookUp' | 'earsBack' | 'slowBlink' | 'happy' | 'shocked' | null;
};

export const SEGMENT_SPECS: Record<ShowSegment, SegmentSpec> = {
	coldOpen: {required: [], optional: ['kicker'], tag: null, defaultReaction: 'slowBlink'},
	headline: {required: ['title'], optional: ['developing', 'loss', 'lossAlt'], tag: 'rektMeter', defaultReaction: null},
	howItWorked: {required: ['nodes'], optional: ['title', 'links', 'cues'], lists: ['nodes', 'links', 'cues'], tag: 'howItWorked', defaultReaction: null},
	badgerRedFlag: {required: ['flag'], optional: ['title'], tag: 'redFlag', defaultReaction: 'judge'},
	zooOneFix: {required: ['fix'], optional: ['title', 'detail'], tag: 'oneFix', defaultReaction: null},
	scamOfTheWeek: {required: ['title'], optional: ['how', 'tell', 'fix'], tag: 'scamOfTheWeek', defaultReaction: null},
	correction: {required: ['correct', 'date'], optional: ['wrong', 'ref'], tag: 'correction', defaultReaction: null},
	sources: {required: [], optional: ['title'], tag: 'sources', defaultReaction: null},
	outroEndScreen: {required: ['explainer'], optional: ['title'], tag: null, defaultReaction: 'slowBlink'},
	beat: {required: [], optional: [], tag: null, defaultReaction: 'judge'},
	desk: {required: [], optional: ['title', 'bullets', 'steps', 'quote', 'attribution', 'button'], lists: ['bullets', 'steps'], tag: null, defaultReaction: null},
};

/**
 * The tag a scene shows in its header row. A headline without a reported loss (no scene.rekt: most AI-security
 * stories) draws no Rekt Meter, so it shows no "Rekt Meter" tag either: the card is the title alone, never a $0 or an
 * invented figure.
 */
export const segmentTag = (seg: ShowSegment, sc: Pick<ShowScene, 'rekt'>): SegmentSpec['tag'] => (seg === 'headline' && !sc.rekt ? null : SEGMENT_SPECS[seg].tag);

/** Every onScreen string of a scene, with its key ("bullets[1]"), for the text checks. */
export const onScreenStrings = (sc: Pick<ShowScene, 'onScreen'>): Array<{key: string; value: string}> => {
	const out: Array<{key: string; value: string}> = [];
	for (const [k, v] of Object.entries(sc.onScreen ?? {})) {
		if (typeof v === 'string') out.push({key: k, value: v});
		else if (Array.isArray(v)) v.forEach((x, i) => typeof x === 'string' && out.push({key: `${k}[${i}]`, value: x}));
	}
	return out;
};

export const str = (sc: Pick<ShowScene, 'onScreen'>, key: string): string | null => {
	const v = sc.onScreen?.[key];
	return typeof v === 'string' && v.trim() ? v.trim() : null;
};

export const list = (sc: Pick<ShowScene, 'onScreen'>, key: string): string[] => {
	const v = sc.onScreen?.[key];
	if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string').map((x) => x.trim());
	return typeof v === 'string' && v.trim() ? [v.trim()] : [];
};
