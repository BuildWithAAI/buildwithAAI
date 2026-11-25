/**
 * Branding tokens for both channels. Every colour comes from the binding palette (PROJECT_INSTRUCTIONS "Style and
 * palette"; src/characters/palette.ts) plus ART_GUIDE CV2's backgroundShadow for contact shadows. No gradients, glows,
 * blurs or opacity tints (ART_GUIDE P1, CV1). Teal stays a small decorative accent (CV5).
 */
import {BRAND} from '../characters/palette.ts';

/** ART_GUIDE CV2 addition (also used by the episode theme as C.shadow). Contact shadows only. */
export const BACKGROUND_SHADOW = '#CFD3D8';

/** Zoora AI: the jellyfish brand, silver line art on black. */
export const ZOORA = {
	bg: BRAND.nearBlack,
	line: BRAND.silver,
	text: BRAND.offWhite,
	textMuted: BRAND.silver,
	accent: BRAND.teal,
	/** The light "porthole" the characters stand in (ART_GUIDE CV4b: L* >= 60 behind Zoo's dark clothes). */
	stage: BRAND.background,
	stageShadow: BACKGROUND_SHADOW,
	plate: BRAND.slate,
} as const;

/** The Zoo & Badger Show (the show on Zoodger News, crypto + AI security): the light talk-show set with slate plates. */
export const SHOW = {
	bg: BRAND.background,
	bgShadow: BACKGROUND_SHADOW,
	ink: BRAND.nearBlack,
	plate: BRAND.slate,
	onPlate: BRAND.offWhite,
	onPlateMuted: BRAND.silver,
	card: BRAND.offWhite,
	accent: BRAND.teal,
	line: BRAND.silver,
} as const;

/** House line and radius scale at 1080p (ART_GUIDE SL4, SL12), matching the episode theme. */
export const OUTLINE = 4;
export const RADIUS = {s: 4, m: 8, l: 16} as const;

export type ChannelKey = 'zoora-ai' | 'zoora-security';
export const CHANNEL_KEYS: readonly ChannelKey[] = ['zoora-ai', 'zoora-security'];
/**
 * Channel 2's identity (owner, 2026-11-24): the channel is "Zoodger News"; the show on it stays "The Zoo & Badger Show".
 * One exact spelling for everything that draws the name. A TypeScript constant, not a JSON import, because Node runs
 * the tests directly. content/zoora-security/channel.json stays the source for scripts.
 */
export const CHANNEL_IDENTITY = {
	'zoora-security': {name: 'Zoodger News', handle: '@ZoodgerNews', youtubeChannelId: 'UCOo2HSb3SYyN66YFiiiO1ZA', url: 'https://www.youtube.com/@ZoodgerNews', showName: 'The Zoo & Badger Show'},
} as const;
