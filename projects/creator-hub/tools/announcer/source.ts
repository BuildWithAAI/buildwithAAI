/**
 * What the announcer announces: one episode, read from its publish kit (kit.json, the PublishKit contract in
 * src/types.ts; the fields are checked by the newsletter's reader) or from the daily pipeline's post-approval input
 * (video-studio/scripts/daily/lib/postapproval.ts, PostInput). Only text that already passed the claim gates is used:
 * the chosen title, the hook from the kit's X post, the summary, sources, offers and disclosures.
 */
import {readFileSync} from 'node:fs';
import {checkPublishKit, isYoutubeId} from '../newsletter/publish-kit.ts';

export type AnnounceSource = {
	origin: 'kit' | 'daily';
	channel: string;
	slug: string;
	title: string;
	/** First line of the kit's X post, else the title. */
	hook: string;
	summary: string;
	developing: boolean;
	youtubeVideoId: string | null;
	sources: {title: string; url: string}[];
	offers: {id: string; hubUrl: string; disclosure: string}[];
	disclosures: string[];
	hashtags: string[];
	checks: {id: string; ok: boolean; detail: string}[];
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');
const DEVELOPING = /\bdeveloping\b/i;

/** The hook: the first line of the kit's X post that is not a link, a hashtag line or a "Full episode" pointer. */
export const hookFrom = (xText: string, fallback: string): string => {
	for (const raw of xText.split('\n')) {
		const line = raw.trim();
		if (!line || /^https?:\/\//.test(line) || /^#/.test(line) || /^(?:full episode|watch|link in bio|more links)\b/i.test(line)) continue;
		return line.replace(/^DEVELOPING:\s*/i, '');
	}
	return fallback.replace(/^DEVELOPING:\s*/i, '');
};

export const hashtagsFrom = (xText: string): string[] => [...new Set(xText.match(/(?<![\w&])#[A-Za-z][A-Za-z0-9_]{1,49}\b/g) ?? [])];

export const checkKitSource = (input: unknown): {source: AnnounceSource | null; errors: string[]} => {
	const {kit, errors} = checkPublishKit(input);
	if (!kit) return {source: null, errors};
	const posts = isRecord(input) && isRecord(input.posts) ? input.posts : {};
	const xText = isRecord(posts.x) && typeof posts.x.text === 'string' ? posts.x.text : '';
	return {
		source: {
			origin: 'kit',
			channel: kit.channel,
			slug: kit.slug,
			title: kit.title,
			hook: hookFrom(xText, kit.title),
			summary: kit.summary,
			developing: DEVELOPING.test(kit.title) || kit.disclosures.some((d) => DEVELOPING.test(d)),
			youtubeVideoId: kit.youtubeVideoId,
			sources: kit.sources,
			offers: kit.offers,
			disclosures: kit.disclosures,
			hashtags: hashtagsFrom(xText),
			checks: kit.checks,
		},
		errors: [],
	};
};

export const readKitSource = (file: string): {source: AnnounceSource | null; errors: string[]} => {
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(file, 'utf8'));
	} catch (err) {
		return {source: null, errors: [`cannot read ${file}: ${(err as Error).message}`]};
	}
	const check = checkKitSource(parsed);
	return {source: check.source, errors: check.errors.map((e) => `${file}: ${e}`)};
};

/** The daily pipeline's PostInput (channel zoora-security; no offers on that channel). */
export const checkDailySource = (input: unknown): {source: AnnounceSource | null; errors: string[]} => {
	if (!isRecord(input)) return {source: null, errors: ['the daily input must be a JSON object']};
	const errors: string[] = [];
	const slug = str(input.slug);
	const title = str(input.title);
	const youtubeId = str(input.youtubeId);
	if (!/^[A-Za-z0-9_-]{1,64}$/.test(slug)) errors.push('"slug" must be 1-64 characters: A-Z, a-z, 0-9, "_" or "-"');
	if (!title) errors.push('"title" must be a non-empty string');
	if (youtubeId && !isYoutubeId(youtubeId)) errors.push('"youtubeId" must be null or an 11-character YouTube id');
	if (typeof input.developing !== 'boolean') errors.push('"developing" must be true or false');
	const sources: AnnounceSource['sources'] = [];
	for (const s of Array.isArray(input.sources) ? input.sources : []) {
		if (!isRecord(s)) continue;
		try {
			const url = new URL(str(s.url));
			if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
			const publisher = str(s.publisher);
			const t = str(s.title);
			// Always "<title> (<publisher>)" from the PostInput's own publisher field, even when the title names it: a
			// radar label such as "SlowMist Hacked: Chainflip (2026-11-21)" ends in a date, which must never be read as
			// the publisher (templates.ts sourceLine).
			const credited = t.toLowerCase().endsWith(`(${publisher.toLowerCase()})`);
			sources.push({title: publisher && t && !credited ? `${t} (${publisher})` : t || publisher, url: url.href});
		} catch {
			// a source without a usable link is not listed
		}
	}
	if (errors.length > 0) return {source: null, errors};
	return {
		source: {
			origin: 'daily',
			channel: 'zoora-security',
			slug,
			title,
			hook: str(input.shortTitle) || title,
			summary: str(input.summary),
			developing: input.developing === true,
			youtubeVideoId: youtubeId || null,
			sources,
			offers: [],
			disclosures: ['News and education only. Not financial advice.'],
			hashtags: [],
			checks: [],
		},
		errors,
	};
};
