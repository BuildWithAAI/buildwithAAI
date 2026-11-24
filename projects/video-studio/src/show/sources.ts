/**
 * Source attribution helpers (pure). Every fact on screen is attributed to the outlet that reported it, so the show
 * needs each source's outlet name and date:
 *  - publisher: Source.publisher when given, else the outlet name for the radar's hosts (the same names the claim gate
 *    uses, scripts/news/lib/brief.ts HOST_PUBLISHERS; a test keeps the two tables in step), else the bare host.
 *  - date: Source.publishedAt when given ("published"), else Source.accessed ("accessed").
 */
import type {ShowScene, ShowSource, ShowStoryboard} from './types.ts';
import {sourceIds} from '../episode/markup.ts';
import {localeOf} from './ui.ts';

export const HOST_PUBLISHERS: Record<string, string> = {
	'www.coindesk.com': 'CoinDesk',
	'coindesk.com': 'CoinDesk',
	'decrypt.co': 'Decrypt',
	'cointelegraph.com': 'Cointelegraph',
	'www.theblock.co': 'The Block',
	'theblock.co': 'The Block',
	'thedefiant.io': 'The Defiant',
	'www.chainalysis.com': 'Chainalysis',
	'www.web3isgoinggreat.com': 'Web3 Is Going Just Great',
	'web3isgoinggreat.com': 'Web3 Is Going Just Great',
	'rekt.news': 'Rekt',
	'hacked.slowmist.io': 'SlowMist',
	'www.dlnews.com': 'DL News',
	'www.trmlabs.com': 'TRM Labs',
	'www.certik.com': 'CertiK',
	'blockworks.co': 'Blockworks',
	'crypto.news': 'crypto.news',
	'coinedition.com': 'Coin Edition',
	'api.llama.fi': 'DefiLlama',
	'defillama.com': 'DefiLlama',
	'api.mainnet-beta.solana.com': 'Solana RPC',
};

export const hostOf = (url: string): string => {
	const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#:]+)/i.exec(url.trim());
	return m ? m[1].toLowerCase() : '';
};

export const publisherOf = (s: Pick<ShowSource, 'url' | 'publisher'>): string => {
	if (typeof s.publisher === 'string' && s.publisher.trim()) return s.publisher.trim();
	const host = hostOf(s.url);
	return HOST_PUBLISHERS[host] ?? host.replace(/^www\./, '');
};

/** [src:id] tags of a narration; malformed markup yields none here (the validator reports it as its own error). */
const narrationSourceIds = (narration: unknown): string[] => {
	if (typeof narration !== 'string') return [];
	try {
		return sourceIds(narration);
	} catch {
		return [];
	}
};

/** Source ids a scene relies on: its narration's [src:id] tags, then the Rekt Meter's reports, in order, unique. */
export const sceneSourceIds = (sc: ShowScene): string[] => {
	const ids = [...narrationSourceIds(sc.narration), ...(sc.rekt ? [sc.rekt.source] : []), ...(sc.rekt?.alt ? [sc.rekt.alt.source] : [])];
	return [...new Set(ids)];
};

/** Every source the storyboard cites, in order of first citation. */
export const citedSourceIds = (sb: Pick<ShowStoryboard, 'scenes'>): string[] => [...new Set(sb.scenes.flatMap(sceneSourceIds))];

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/** Parse an ISO date or date-time; a bare date is taken as UTC midnight. Null when it is not ISO 8601. */
export const parseIso = (s: string): Date | null => {
	const m = ISO_DATE.exec(s.trim());
	if (!m) return null;
	const d = new Date(m[4] ? s.trim().replace(' ', 'T') + (m[7] ? '' : 'Z') : `${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
	return Number.isNaN(d.getTime()) ? null : d;
};

/** "Nov 24, 2026" (en), "24 nov 2026" (es)...: UTC, so the date never shifts with the render machine's zone. */
export const formatDate = (iso: string, lang: string): string => {
	const d = parseIso(iso);
	if (!d) return iso;
	return new Intl.DateTimeFormat(localeOf(lang), {year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC'}).format(d);
};

/** "Nov 24, 08:00 UTC": for DEVELOPING "as of" times. A bare date prints as a date. */
export const formatAsOf = (iso: string, lang: string): string => {
	const d = parseIso(iso);
	if (!d) return iso;
	if (!/[T ]\d{2}:\d{2}/.test(iso)) return formatDate(iso, lang);
	const day = new Intl.DateTimeFormat(localeOf(lang), {month: 'short', day: 'numeric', timeZone: 'UTC'}).format(d);
	const time = new Intl.DateTimeFormat(localeOf(lang), {hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC'}).format(d);
	return `${day}, ${time} UTC`;
};

export type SourceRow = {id: string; publisher: string; title: string; date: string; dateKind: 'published' | 'accessed'};

export const sourceRow = (s: ShowSource, lang: string): SourceRow => {
	const published = typeof s.publishedAt === 'string' && parseIso(s.publishedAt) ? s.publishedAt : null;
	return {
		id: s.id,
		publisher: publisherOf(s),
		title: s.title,
		date: formatDate(published ?? s.accessed, lang),
		dateKind: published ? 'published' : 'accessed',
	};
};

/** The outlets behind a scene (unique publisher names, in citation order) for the per-scene source line. */
export const scenePublishers = (sb: Pick<ShowStoryboard, 'sources'>, sc: ShowScene): string[] => {
	const byId = new Map(sb.sources.map((s) => [s.id, s]));
	const names = sceneSourceIds(sc)
		.map((id) => byId.get(id))
		.filter((s): s is ShowSource => !!s)
		.map(publisherOf);
	return [...new Set(names)];
};
