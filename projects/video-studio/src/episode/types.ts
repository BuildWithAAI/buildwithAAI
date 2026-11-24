/**
 * Episode engine contracts, v1 (2026-11-24). Shared by: the voice step (scripts/voice), the claim checker
 * (scripts/claims), dubbing (scripts/dub), scene templates and the Episode/EpisodeShort/Thumbnail
 * compositions (src/episode, src/thumbnails), and the publish kit.
 * Episodes render from their own Remotion entry point: src/episode/index.ts (NOT src/Root.tsx).
 */
import type {Expression, MouthShape, ZooPose, ZooView} from '../characters/types';

/** Languages the pipeline supports. ZOO needs a male Kokoro voice in each one (French has none, so it is excluded). */
export type Lang = 'en' | 'es' | 'pt-br' | 'hi' | 'it' | 'zh' | 'ja';

export type SceneType = 'hook' | 'talk' | 'chart' | 'steps' | 'quote' | 'cta' | 'endscreen';

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
	shorts?: {id: string; sceneIds: string[]; title: string}[]; // which scenes are re-composed into each vertical Short
	thumbnails?: {id: string; text: string; expression: Expression; badger: boolean}[]; // 3 variants; text has 4 words or fewer
};

export type TimelineWord = {text: string; startMs: number; endMs: number}; // display text, scene-relative ms

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
};
