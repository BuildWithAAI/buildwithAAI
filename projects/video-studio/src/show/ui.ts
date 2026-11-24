/**
 * Show UI labels (pure). English defaults; any other language must carry every label its render shows in
 * storyboard.showUi, or validation fails (no English UI text in a dubbed render). "ON AIR" is set dressing, not a label.
 */
import type {ShowStoryboard, ShowUiLabels} from './types.ts';

export const EN_SHOW_UI: ShowUiLabels = {
	developing: 'DEVELOPING',
	asOf: 'as of',
	reportedBy: 'reported by',
	alsoReported: 'also reported',
	logScale: 'each step = ×10',
	rektMeter: 'Rekt Meter',
	howItWorked: 'How it worked',
	conceptOnly: 'Simplified concept',
	redFlag: "Badger's Red Flag",
	oneFix: "Zoo's One Fix",
	scamOfTheWeek: 'Scam of the Week',
	howItWorks: 'How it works',
	tell: 'The tell',
	fix: 'The fix',
	correction: 'Correction',
	weSaid: 'We said',
	correct: 'Correct',
	sources: 'Sources',
	source: 'Source',
	accessed: 'accessed',
	linksBelow: 'Links in the description',
	explainer: 'Explainer',
	latest: 'Latest brief',
	subscribe: 'Subscribe',
	linkedBelow: 'Linked below',
};

export type ShowUiKey = keyof ShowUiLabels;

/** The label in the storyboard's language; English falls back to the defaults, other languages must provide it. */
export const showLabel = (sb: Pick<ShowStoryboard, 'lang' | 'showUi'>, key: ShowUiKey): string => {
	const own = sb.showUi?.[key];
	if (typeof own === 'string' && own.trim()) return own;
	if (sb.lang === 'en') return EN_SHOW_UI[key];
	throw new Error(`storyboard.showUi.${key} is required for lang "${sb.lang}" (English UI text must not appear in a dubbed render)`);
};

/** Locale tag for Intl formatting. */
export const localeOf = (lang: string): string => (lang === 'pt-br' ? 'pt-BR' : lang === 'zh' ? 'zh-CN' : lang === 'en' ? 'en-US' : lang);
