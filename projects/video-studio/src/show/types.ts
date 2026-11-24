/**
 * "The Zoo & Badger Show" (channel 2, working slug "zoora-security"): show contracts, v1 (2026-11-24).
 *
 * A show storyboard IS an episode storyboard (src/episode/types.ts, owned by the episode builder) whose scenes MAY carry
 * the optional additions below. They live here, not in src/episode/types.ts, because that file belongs to another
 * workflow. Every other tool keeps reading the standard fields: the voice step (narration, minDurationSec), the claim
 * gate (narration, onScreen, sources), dubbing and the publish kit. Unknown fields are ignored by all of them.
 *
 * Contract additions (all optional):
 *   StoryboardScene.segment      which show segment renders the scene (default from `type`, see segments.ts)
 *   StoryboardScene.rekt         Rekt Meter data: the reported loss in USD and the id of the source that reports it
 *   StoryboardScene.diagram      HowItWorked: the kind of each diagram node (labels are onScreen.nodes / onScreen.links)
 *   StoryboardScene.badgerBeats  Badger's reactions after Zoo's lines (judge, lookUp, earsBack, slowBlink, happy, shocked)
 *   Source.publisher / .publishedAt   outlet name and publication date for the Sources card (else derived from the URL)
 *   Storyboard.news              the claim gate's NewsMeta (scripts/news/lib/types.ts): news.developing draws the
 *                                persistent DEVELOPING badge on every frame
 *   Storyboard.showUi            localized show labels (segment names, "reported by", ...); English defaults in ui.ts
 */
import type {Lang, Source, Storyboard, StoryboardScene, Timeline} from '../episode/types.ts';

export type {Lang, Source, Storyboard, StoryboardScene, Timeline};

/** The nine show segments, plus `beat` (a silent reaction insert) and `desk` (plain desk talk, the fallback). */
export const SHOW_SEGMENTS = [
	'coldOpen',
	'headline',
	'howItWorked',
	'badgerRedFlag',
	'zooOneFix',
	'scamOfTheWeek',
	'correction',
	'sources',
	'outroEndScreen',
	'beat',
	'desk',
] as const;
export type ShowSegment = (typeof SHOW_SEGMENTS)[number];

/** Badger is nonverbal: every joke he makes is one of these reactions, landing after Zoo's line. */
export const BADGER_REACTIONS = ['judge', 'lookUp', 'earsBack', 'slowBlink', 'happy', 'shocked'] as const;
export type BadgerReaction = (typeof BADGER_REACTIONS)[number];

export type BadgerBeat = {
	reaction: BadgerReaction;
	/**
	 * Which of Zoo's lines it follows: 'end' (the scene's last line; default), a 0-based line index, or a cue word (the
	 * beat follows the line that contains it). Lines are sentences of the scene's timeline words.
	 */
	after?: 'end' | number | string;
	/** Frames the reaction holds before Badger settles back (default per reaction, about 1.5 s). */
	hold?: number;
};

/** Concept-level diagram nodes (HowItWorked). No code, function names or step lists: icons plus short labels. */
export const DIAGRAM_KINDS = [
	'attacker',
	'wallet',
	'contract',
	'bridge',
	'mixer',
	'exchange',
	'key',
	'site',
	'message',
	'approval',
	'agent',
	'plugin',
	'phone',
	'funds',
] as const;
export type DiagramKind = (typeof DIAGRAM_KINDS)[number];

/** One reported loss: the amount in USD and the storyboard source id that reports it. Never an average. */
export type RektReport = {usd: number; source: string};
/** Rekt Meter: the primary report, and optionally a second outlet's different figure (shown beside it, never merged). */
export type RektData = RektReport & {alt?: RektReport};

export type DiagramData = {nodes: DiagramKind[]};

export type ShowScene = StoryboardScene & {
	segment?: ShowSegment;
	rekt?: RektData;
	diagram?: DiagramData;
	badgerBeats?: BadgerBeat[];
};

export type ShowSource = Source & {publisher?: string; publishedAt?: string};

/** Same shape as the claim gate's DevelopingLabel (scripts/news/lib/types.ts). */
export type DevelopingLabel = boolean | string | {label?: string; asOf?: string; note?: string};

export type ShowNewsMeta = {
	format?: 'daily-short' | 'what-we-know' | 'weekly-roundup' | 'explainer' | string;
	developing?: DevelopingLabel;
	incidentIds?: string[];
};

export type ShowUiLabels = {
	developing: string; // persistent badge and the Headline label default
	asOf: string; // "as of" before a date
	reportedBy: string; // Rekt Meter attribution: "reported by The Block"
	alsoReported: string; // a second outlet's different figure
	logScale: string; // the Rekt Meter's scale note (each step is x10)
	rektMeter: string;
	howItWorked: string;
	conceptOnly: string; // diagram footnote: simplified concept, no code
	redFlag: string;
	oneFix: string;
	scamOfTheWeek: string;
	howItWorks: string; // Scam of the Week row label
	tell: string; // Scam of the Week: the warning sign
	fix: string; // Scam of the Week: the fix
	correction: string;
	weSaid: string;
	correct: string;
	sources: string; // Sources card heading
	source: string; // the per-scene source line ("Source")
	accessed: string; // date kind when only the access date is known
	linksBelow: string; // Sources card footer
	explainer: string; // end-screen slot heading
	latest: string; // second end-screen slot heading
	subscribe: string; // subscribe circle label
	linkedBelow: string; // Short outro: the related-video link
};

export type ShowStoryboard = Omit<Storyboard, 'scenes' | 'sources'> & {
	scenes: ShowScene[];
	sources: ShowSource[];
	news?: ShowNewsMeta;
	/** Accepted alias of news.developing (as in the claim gate). */
	developing?: DevelopingLabel;
	showUi?: Partial<ShowUiLabels>;
};

export type Format = 'landscape' | 'vertical';

export type Issue = {level: 'error' | 'warning'; code: string; where: string; msg: string};
