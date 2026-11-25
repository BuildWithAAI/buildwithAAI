/**
 * Episode engine contracts, v1 (2026-11-24). Shared by: the voice step (scripts/voice), the claim checker
 * (scripts/claims), dubbing (scripts/dub), scene templates and the Episode/EpisodeShort/Thumbnail
 * compositions (src/episode, src/thumbnails), and the publish kit.
 * Episodes render from their own Remotion entry point: src/episode/index.ts (NOT src/Root.tsx).
 */
import type {Expression, MouthShape, ZooPose, ZooView} from '../characters/types';

/** Languages the pipeline supports. Zoo needs a male Kokoro voice in each one (French has none, so it is excluded). */
export type Lang = 'en' | 'es' | 'pt-br' | 'hi' | 'it' | 'zh' | 'ja';

export type SceneType = 'hook' | 'talk' | 'chart' | 'steps' | 'quote' | 'cta' | 'endscreen';

/** Added 2026-11-25 (episode audio), optional fields only. The four Zoora AI story beds (public/audio/music/bed-story-<mood>-underscore.flac). */
export type StoryBed = 'curious' | 'tension' | 'ominous' | 'resolve';

export type Source = {
	id: string; // referenced from narration as [src:id]
	title: string;
	url: string;
	quote?: string; // the exact supporting sentence from the source
	accessed: string; // ISO date the source was read
	status: 'verified' | 'unverified'; // unverified sources fail the claim gate
};

export type StoryboardScene = {
	id: string; // stable across languages, e.g. "s01"
	type: SceneType;
	/**
	 * Narration. Markup:
	 * - {display|spoken}: show `display` in captions and on screen, but speak `spoken`, e.g. {$40,000|forty thousand dollars}.
	 * - [src:id]: the preceding factual claim is backed by sources[id]. It is removed from captions and speech.
	 */
	narration: string;
	/** Template-specific on-screen text (localized per language): title, bullets[], steps[], quote, attribution, label... */
	onScreen?: Record<string, string | string[]>;
	zoo?: {expression?: Expression; pose?: ZooPose; view?: ZooView; present?: boolean};
	badger?: {present: boolean; reaction?: 'neutral' | 'happy' | 'worried' | 'shocked' | 'judge' | 'lookUp'};
	/** For type 'chart': the synthetic story seed or a data file under public/ (see src/charts). Always labelled illustrative unless real-sourced. */
	chart?: {seed?: number; dataFile?: string; illustrative: boolean; surface?: 'dark' | 'light'};
	minDurationSec?: number; // hold at least this long even if the narration is shorter
	transitionIn?: 'cut' | 'fade' | 'slide' | 'wipe';
	/**
	 * Added 2026-11-24 (episode builder), optional. Show the small sources card for the [src:id] claims of this scene.
	 * Default: true when the narration cites a source and the scene type is not 'quote' (the quote shows its own source).
	 */
	showSources?: boolean;
	/**
	 * Added 2026-11-24 (claim gate, scripts/claims), optional. Text the claim gate flags that the editor judged safe:
	 * `factual` = a sentence that only LOOKS factual (story action, a fictional figure, "first, check..."), `income` = an
	 * income/return word used as a warning or a quoted scam pitch. `match` is copied verbatim from this scene's narration
	 * or onScreen text in THIS file's language (dubbing translates it); `reason` is required. Every waiver is listed in
	 * the claim report for the owner. Waivers never cover "according to"-style attributions, research must-not-say
	 * phrases, private names or wallet addresses.
	 */
	claimWaivers?: Array<{match: string; rule: 'factual' | 'income'; reason: string}>;
	/**
	 * Added 2026-11-25 (episode audio), optional. The music FROM THIS SCENE ON, an act marker: 'curious', 'tension',
	 * 'ominous', 'resolve' or 'none' (no music). Later scenes inherit it until the next scene that sets one; without any,
	 * the whole episode plays 'curious' (or the hook's choice). On the end screen only 'none' is allowed (it plays its own
	 * music). Read from the master storyboard (storyboard.json) for every language.
	 */
	bed?: StoryBed | 'none';
	/**
	 * Added 2026-11-25 (episode audio), optional. This scene's sound effects: `transition` (its entrance: a wipe has a short
	 * whoosh unless false, a slide a soft air sound only when true, cuts and fades never), `items` (list pops in the gaps of
	 * the speech, default true), `accent` (the CTA press click, default true; the chart rug's soft tick, default false).
	 */
	sfx?: {transition?: boolean; items?: boolean; accent?: boolean};
};

/**
 * Added 2026-11-24 (episode builder), optional. Localized UI strings that are not scene copy. English defaults live in
 * src/episode/i18n/ui.ts; a storyboard in any other language must carry the labels it needs (the validator names them),
 * so no English UI text appears in a dubbed render.
 */
export type UiLabels = {
	fictionDisclaimer?: string; // the fiction card (required when Storyboard.fiction is true), e.g. "Fictional story. Composite characters. Not financial advice."
	sources?: string; // heading of the sources card, e.g. "Source"
	illustrative?: string; // chart scenes, shown outside the chart panel: "Illustrative · fictional token"
	subscribe?: string; // CTA button label
	watchNext?: string; // end-screen slot heading
	subscribeSlot?: string; // end-screen subscribe-slot label
};

export type Storyboard = {
	version: 1;
	channel: string; // "zoora-ai"
	slug: string;
	lang: Lang; // the language of THIS file; translations are storyboard.<lang>.json
	sourceLang: Lang; // usually "en"
	title: string;
	fiction: boolean; // true: a story with a fictional composite protagonist (the disclaimer card is required)
	scenes: StoryboardScene[];
	sources: Source[];
	offers?: string[]; // creator-hub offer ids (the CTA and disclosures use them)
	/** which scenes are re-composed into each vertical Short; `bed` (added 2026-11-25, optional): one bed for the whole Short */
	shorts?: {id: string; sceneIds: string[]; title: string; bed?: StoryBed | 'none'}[];
	/**
	 * 3 variants; text has 4 words or fewer (zh/ja: 10 characters or fewer). A translation (storyboard.<lang>.json) carries
	 * only {id, text}; expression and badger always come from storyboard.json.
	 * Added 2026-11-24 (thumbnail builder), optional: `badgerReaction` sets Badger's face when badger is true (default:
	 * 'worried' with a worried Zoo, otherwise 'judge'); a newline in `text` is the writer's explicit line break (3 lines max).
	 */
	thumbnails?: {id: string; text: string; expression: Expression; badger: boolean; badgerReaction?: 'neutral' | 'happy' | 'worried' | 'shocked' | 'judge'}[];
	/** Added 2026-11-24 (episode builder), optional. Localized UI labels (see UiLabels). */
	ui?: UiLabels;
	/**
	 * Added 2026-11-24 (episode builder), optional. Translation status of THIS file. A storyboard whose lang differs from
	 * sourceLang counts as 'machine' unless this says 'native-reviewed'; such renders carry an on-screen
	 * "machine translation: needs native review" badge.
	 * `method` and `reviewed` added 2026-11-24 (dubbing, scripts/dub), optional: who translated (an agent or MT =
	 * 'machine', a person = 'human') and whether the owner has confirmed a native review. `node scripts/dub/cli.ts import`
	 * writes {status: 'machine', method, reviewed: false}; only the owner sets reviewed: true together with
	 * status: 'native-reviewed' (reviewer = a role or initials, never a private full name: the repo is public).
	 */
	translation?: {status: 'machine' | 'native-reviewed'; reviewer?: string; date?: string; method?: 'machine' | 'human'; reviewed?: boolean};
	/**
	 * Added 2026-11-25 (episode audio), optional; read from the master storyboard for every language.
	 * `offset`: the 4-bar phrase of the beds' 64 s loop the episode's clock starts on (0-4: 0, 12.8, 25.6, 38.4 or 51.2 s);
	 * default: the planner's choice (a seeded order, the loop's base section first, the first whose estimated worst phrase
	 * clears the gate by 2 LU). `sting: 'after-hook'`: the Zoora AI brand sting after the cold open (off by default; the
	 * scene before it needs room: the planner names the minDurationSec). `stingTagline`: the sting card's tagline in THIS
	 * file's language (read from this file, not the master; required in a non-English render with the sting; English
	 * default "Crypto and AI stories, starring you.").
	 */
	music?: {offset?: 0 | 1 | 2 | 3 | 4; sting?: 'after-hook'; stingTagline?: string};
};

/**
 * Display text, scene-relative ms. `stressMs` (added 2026-11-24, episode builder, optional): scene-relative onset of the
 * word's primary-stress vowel (Kokoro's ˈ marker). The engine puts head accents there; without it, it estimates.
 */
export type TimelineWord = {text: string; startMs: number; endMs: number; stressMs?: number};

export type TimelineScene = {
	id: string;
	audio: string; // path relative to public/, used with staticFile()
	startMs: number; // absolute start in the episode
	durationMs: number; // scene length = audio length + padding (or minDurationSec)
	speechMs: number; // the voiced part
	words: TimelineWord[];
	/** One mouth shape per video frame of this scene (visemes from the TTS phonemes; 'closed' in silence). */
	mouth: MouthShape[];
};

export type Timeline = {
	version: 1;
	slug: string;
	lang: Lang;
	mode: 'native' | 'fit-to-master'; // native: durations follow this language's audio; fit-to-master: matched to the master timeline for multi-language audio tracks
	masterLang?: Lang;
	voice: string; // Kokoro voice id, e.g. "am_michael"
	speed: number;
	model: {file: string; sha256: string};
	sampleRate: number;
	fps: number;
	totalMs: number;
	scenes: TimelineScene[];
	loudness?: {integratedLufs: number; truePeakDb: number};
	warnings: string[];
	/**
	 * Added 2026-11-24 (episode builder), optional. true = made by src/episode/dev/mockTimeline.ts: no audio exists, so the
	 * render is a SILENT preview (badged on screen) and must never be called lip-synced.
	 */
	mock?: boolean;
};
