/**
 * Graphics tokens for the show (pure). Colours only from the binding palette (ART_GUIDE CV1): the brand tokens, the
 * prop colours and the CV2 backgroundShadow. Cards are off-white with the house 4 px near-black outline; headers sit on
 * slate plates; teal is a small decorative accent only (never data, never a large area, CV5). No gradients, glows,
 * blurs or opacity tints (P1).
 */
import {BRAND, PROP_COLORS} from '../../characters/palette.ts';
import {CHART_LIGHT} from '../../charts/tokens.ts';

/** ART_GUIDE CV2 backgroundShadow (pending owner sign-off into palette.ts; the episode theme uses the same value). */
export const BG_SHADOW = '#CFD3D8';

export const G = {
	bg: BRAND.background,
	ink: BRAND.nearBlack,
	slate: BRAND.slate,
	card: BRAND.offWhite,
	silver: BRAND.silver,
	teal: BRAND.teal,
	shadow: BG_SHADOW,
	inkMuted: CHART_LIGHT.axisText, // secondary text on off-white (a chart token, as in the episode theme)
	onDark: BRAND.offWhite,
	onDarkMuted: BRAND.silver,
	mid: PROP_COLORS.chair, // mid grey: dial ticks, inactive marks
	midShadow: PROP_COLORS.chairShadow,
} as const;

/** House line and corner scale at 1080p (SL4, SL12). */
export const OUTLINE = 4;
export const R = {s: 4, m: 8, l: 16} as const;
