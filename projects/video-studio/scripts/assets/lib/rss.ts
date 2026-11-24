/**
 * Podcast RSS 2.0 feed for self-hosting, with the iTunes namespace (Apple Podcasts, Spotify, YouTube RSS
 * ingestion read it), the Podcasting 2.0 namespace (podcastindex.org/namespace/1.0: guid, locked, medium,
 * transcript, chapters; read 2026-11-24 from github.com/Podcastindex-org/podcast-namespace) and Podlove Simple
 * Chapters (psc, which Spotify reads for shows hosted elsewhere).
 * Apple's validator requires itunes:image, itunes:category, itunes:explicit (true/false) and language; YouTube's RSS
 * ingestion e-mails a code to the itunes:email address. A feed is only "ready" when the owner has set those values.
 */
import {createHash} from 'node:crypto';
import type {PodcastShow} from './config.ts';
import {safeUrl, xml} from './html.ts';
import {rfc822} from './util.ts';

/** RFC 4122 UUIDv5 (SHA-1, name-based). */
export const uuidv5 = (name: string, namespace: string): string => {
	const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
	if (ns.length !== 16) throw new Error(`bad namespace UUID ${namespace}`);
	const hash = createHash('sha1').update(ns).update(Buffer.from(name, 'utf8')).digest();
	hash[6] = (hash[6] & 0x0f) | 0x50;
	hash[8] = (hash[8] & 0x3f) | 0x80;
	const hex = hash.subarray(0, 16).toString('hex');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};

/** The podcast namespace's UUID, from the podcast:guid spec. */
export const PODCAST_NAMESPACE = 'ead4c236-bf58-58c6-a2c6-a6b28d128cb6';

/** podcast:guid: UUIDv5 of the feed URL without its scheme and trailing slashes (assigned once, then kept forever). */
export const podcastGuid = (feedUrl: string): string => uuidv5(feedUrl.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/\/+$/, ''), PODCAST_NAMESPACE);

export type FeedItem = {
	guid: string;
	title: string;
	link: string;
	descriptionHtml: string;
	pubDate: string; // ISO
	durationSec: number;
	explicit: boolean;
	episodeType: 'full' | 'trailer' | 'bonus';
	season?: number;
	episode?: number;
	enclosure: {url: string; bytes: number; type: string};
	chaptersUrl: string | null;
	transcripts: {url: string; type: string; language?: string}[];
	chapters: {startMs: number; title: string; href?: string}[];
	imageUrl?: string | null;
};

export type FeedProblem = {level: 'error' | 'warning'; message: string};

/** Values the owner must set before the feed can be submitted anywhere. */
export const feedProblems = (show: PodcastShow, items: FeedItem[]): FeedProblem[] => {
	const p: FeedProblem[] = [];
	if (!show.feedUrl) p.push({level: 'error', message: 'feedUrl is not set (the public https URL of feed.xml): set it in config/channels.json'});
	if (!show.mediaBase) p.push({level: 'error', message: 'mediaBase is not set (the public https folder that serves the MP3s): set it in config/channels.json'});
	if (!show.imageUrl) p.push({level: 'error', message: 'imageUrl is not set (3000x3000 JPEG/PNG show art; Apple requires itunes:image)'});
	if (!show.ownerEmail) p.push({level: 'error', message: 'ownerEmail is not set (itunes:email: YouTube and other directories send a verification code there; it is public in the feed)'});
	if (!items.length) p.push({level: 'error', message: 'the feed has no episodes (YouTube and Apple need at least one)'});
	for (const it of items) {
		if (!(it.enclosure.bytes > 0)) p.push({level: 'error', message: `${it.guid}: enclosure has no length`});
		if ([...it.descriptionHtml].length > 4000) p.push({level: 'warning', message: `${it.guid}: description is over 4000 characters (Apple's limit)`});
	}
	return p;
};

const cdata = (html: string) => `<![CDATA[${html.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;

const npt = (ms: number) => {
	const t = Math.max(0, Math.round(ms));
	const h = Math.floor(t / 3_600_000);
	const m = Math.floor((t % 3_600_000) / 60_000);
	const s = Math.floor((t % 60_000) / 1000);
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(t % 1000).padStart(3, '0')}`;
};

export const buildPodcastFeed = (show: PodcastShow, lang: string, items: FeedItem[], now: string): string => {
	const feedUrl = show.feedUrl ? safeUrl(show.feedUrl, {httpsOnly: true}) : null;
	const guid = show.guid ?? (feedUrl ? podcastGuid(feedUrl) : null);
	const sorted = [...items].sort((a, b) => b.pubDate.localeCompare(a.pubDate));
	const ch: string[] = [
		`    <title>${xml(show.title)}</title>`,
		`    <link>${xml(safeUrl(show.link, {httpsOnly: true}))}</link>`,
		`    <language>${xml(lang)}</language>`,
		`    <description>${xml(show.description)}</description>`,
		...(show.copyright ? [`    <copyright>${xml(show.copyright)}</copyright>`] : []),
		`    <lastBuildDate>${rfc822(now)}</lastBuildDate>`,
		'    <generator>video-studio/scripts/assets</generator>',
		...(feedUrl ? [`    <atom:link href="${xml(feedUrl)}" rel="self" type="application/rss+xml"/>`] : []),
		`    <itunes:author>${xml(show.author)}</itunes:author>`,
		`    <itunes:owner><itunes:name>${xml(show.ownerName)}</itunes:name>${show.ownerEmail ? `<itunes:email>${xml(show.ownerEmail)}</itunes:email>` : ''}</itunes:owner>`,
		...(show.imageUrl ? [`    <itunes:image href="${xml(safeUrl(show.imageUrl, {httpsOnly: true}))}"/>`, `    <image><url>${xml(show.imageUrl)}</url><title>${xml(show.title)}</title><link>${xml(show.link)}</link></image>`] : []),
		...show.categories.map((c) => (c.length === 2 ? `    <itunes:category text="${xml(c[0])}"><itunes:category text="${xml(c[1])}"/></itunes:category>` : `    <itunes:category text="${xml(c[0])}"/>`)),
		`    <itunes:explicit>${show.explicit ? 'true' : 'false'}</itunes:explicit>`,
		`    <itunes:type>${show.type}</itunes:type>`,
		...(guid ? [`    <podcast:guid>${guid}</podcast:guid>`] : []),
		`    <podcast:locked${show.ownerEmail ? ` owner="${xml(show.ownerEmail)}"` : ''}>${show.locked ? 'yes' : 'no'}</podcast:locked>`,
		'    <podcast:medium>podcast</podcast:medium>',
	];
	const its = sorted.map((it) => {
		const lines = [
			'    <item>',
			`      <title>${xml(it.title)}</title>`,
			`      <itunes:title>${xml(it.title)}</itunes:title>`,
			`      <link>${xml(safeUrl(it.link, {httpsOnly: true}))}</link>`,
			`      <guid isPermaLink="false">${xml(it.guid)}</guid>`,
			`      <pubDate>${rfc822(it.pubDate)}</pubDate>`,
			`      <description>${cdata(it.descriptionHtml)}</description>`,
			`      <enclosure url="${xml(safeUrl(it.enclosure.url, {httpsOnly: true}))}" length="${it.enclosure.bytes}" type="${xml(it.enclosure.type)}"/>`,
			`      <itunes:duration>${Math.round(it.durationSec)}</itunes:duration>`,
			`      <itunes:explicit>${it.explicit ? 'true' : 'false'}</itunes:explicit>`,
			`      <itunes:episodeType>${it.episodeType}</itunes:episodeType>`,
			...(it.season !== undefined ? [`      <itunes:season>${it.season}</itunes:season>`] : []),
			...(it.episode !== undefined ? [`      <itunes:episode>${it.episode}</itunes:episode>`] : []),
			...(it.imageUrl ? [`      <itunes:image href="${xml(safeUrl(it.imageUrl, {httpsOnly: true}))}"/>`] : []),
			...it.transcripts.map((t) => `      <podcast:transcript url="${xml(safeUrl(t.url, {httpsOnly: true}))}" type="${xml(t.type)}"${t.language ? ` language="${xml(t.language)}"` : ''}${t.type === 'text/vtt' || t.type === 'application/x-subrip' ? ' rel="captions"' : ''}/>`),
			...(it.chaptersUrl ? [`      <podcast:chapters url="${xml(safeUrl(it.chaptersUrl, {httpsOnly: true}))}" type="application/json+chapters"/>`] : []),
		];
		if (it.chapters.length) {
			lines.push('      <psc:chapters version="1.2">');
			for (const c of it.chapters) lines.push(`        <psc:chapter start="${npt(c.startMs)}" title="${xml(c.title)}"${c.href ? ` href="${xml(safeUrl(c.href, {httpsOnly: true}))}"` : ''}/>`);
			lines.push('      </psc:chapters>');
		}
		lines.push('    </item>');
		return lines.join('\n');
	});
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:podcast="https://podcastindex.org/namespace/1.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:psc="http://podlove.org/simple-chapters">',
		'  <channel>',
		...ch,
		...its,
		'  </channel>',
		'</rss>',
		'',
	].join('\n');
};
