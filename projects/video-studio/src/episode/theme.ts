/**
 * Episode UI tokens. Colours come only from the brand palette and the chart tokens (ART_GUIDE CV1); no gradients,
 * glows, blurs or opacity tints anywhere (P1). Text sits on solid plates so it reads on any background.
 */
import {BRAND} from '../characters/palette.ts';
import {CHART_DARK, CHART_LIGHT} from '../charts/tokens.ts';

export const C = {
	bg: BRAND.background, // default flat scene background #E6E8EB
	ink: BRAND.nearBlack, // text on light, outlines
	slate: BRAND.slate, // dark plates
	card: BRAND.offWhite, // light cards (never #FFFFFF for large areas, CV6)
	silver: BRAND.silver, // ground line, slot guides
	teal: BRAND.teal, // the single decorative accent: small marks only (CV5)
	shadow: '#CFD3D8', // ART_GUIDE CV2 backgroundShadow: contact shadows only (pending owner sign-off into palette.ts)
	inkMuted: CHART_LIGHT.axisText, // secondary text on light plates (#4A525E)
	onDark: BRAND.offWhite, // text on slate
	onDarkMuted: CHART_DARK.axisText, // secondary text on slate (#9AA3AD)
} as const;

/** House line and corner scale at 1080p (SL4, SL12). */
export const OUTLINE = 4;
export const R = {s: 4, m: 8, l: 16} as const;
