/**
 * Thumbnail series badges: one per recurring series or status label (pure data). Labels are title case: the host
 * is "Zoo", never "ZOO" (owner rule), so badges never use uppercase styling.
 */
import type {IconName} from './marks/icons.tsx';
import type {ChannelKey} from './tokens.ts';

export type SeriesId = 'pov' | 'rekt-meter' | 'red-flag' | 'one-fix' | 'scam-of-the-week' | 'what-we-know' | 'developing' | 'weekly-roundup';

export type Series = {label: string; icon: IconName; channel: ChannelKey; use: string};

export const SERIES: Record<SeriesId, Series> = {
	pov: {label: 'POV', icon: 'jellyfish', channel: 'zoora-ai', use: 'Every Zoora AI story episode and its Shorts.'},
	'rekt-meter': {label: 'Rekt Meter', icon: 'gauge', channel: 'zoora-security', use: 'Episodes that rate an incident on the Rekt Meter.'},
	'red-flag': {label: "Badger's Red Flag", icon: 'flag', channel: 'zoora-security', use: 'The warning-sign segment.'},
	'one-fix': {label: "Zoo's One Fix", icon: 'wrench', channel: 'zoora-security', use: 'The one practical fix per episode.'},
	'scam-of-the-week': {label: 'Scam of the Week', icon: 'hook', channel: 'zoora-security', use: 'The weekly scam breakdown (viewer tips feed it).'},
	'what-we-know': {label: 'What We Know', icon: 'info', channel: 'zoora-security', use: 'Fast Shorts on a major incident: confirmed facts only.'},
	developing: {label: 'Developing', icon: 'pulse', channel: 'zoora-security', use: 'Any story still developing (channel rule: label it).'},
	'weekly-roundup': {label: 'Weekly Roundup', icon: 'calendar', channel: 'zoora-security', use: 'The weekly long-form round-up.'},
};

export const SERIES_IDS = Object.keys(SERIES) as SeriesId[];
