/**
 * UI labels (not scene copy): English defaults, overridden by storyboard.ui. A non-English storyboard must carry every
 * label its render shows (validate.ts names the missing ones), so a dubbed render never shows English chrome text.
 */
import type {Storyboard, UiLabels} from '../types.ts';

export type UiKey = keyof UiLabels;

export const EN_UI: Required<UiLabels> = {
	fictionDisclaimer: 'Fictional story · composite characters · not financial advice',
	sources: 'Source',
	illustrative: 'Illustrative · fictional token',
	subscribe: 'Subscribe',
	watchNext: 'Watch next',
	subscribeSlot: 'Subscribe',
};

/** The label for `key` in the storyboard's language, or null when a non-English storyboard does not supply it. */
export const uiLabel = (sb: Pick<Storyboard, 'lang' | 'ui'>, key: UiKey): string | null => {
	const own = sb.ui?.[key];
	if (typeof own === 'string' && own.trim()) return own.trim();
	return sb.lang === 'en' ? EN_UI[key] : null;
};
