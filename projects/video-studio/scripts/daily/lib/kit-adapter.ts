/**
 * Thin adapter to the publish kit (scripts/publish-kit, another workflow's tool), which reads
 * content/<channel>/<slug>/episode.json. The kit models long-form episodes with Shorts cut from them; a daily Short is
 * the whole video, so this writes one Short covering every scene, no chapters (Shorts have none: the kit's chapter
 * check is reported as not applicable), and the publish settings from channel.json. Every text in it comes from the
 * storyboard the gates checked: the title, the Short title and the first narration sentences.
 */
import type {ChannelConfig} from './channel.ts';
import type {Splitter} from './narration.ts';
import {safeSource} from './persons.ts';
import {isRecord, str, unique} from './util.ts';

export type SbScene = {id: string; type: string; narration: string; segment?: string; onScreen?: Record<string, unknown>; badger?: {present?: boolean; reaction?: string}; badgerBeats?: Array<{reaction?: string}>};
export type SbLite = {
	slug: string;
	title: string;
	scenes: SbScene[];
	sources: Array<{id: string; title: string; url: string; status?: string}>;
	shorts: Array<{id: string; sceneIds: string[]; title: string}>;
	thumbnails: Array<{id: string; text: string; expression?: string; badger?: boolean}>;
	analysis: Array<{id?: string; opportunity?: string; kind?: string; basis?: string; detail?: string; method?: string; sourceIds?: string[]; sceneIds?: string[]}>;
	news: {format?: string; developing?: unknown; incidentIds?: string[]};
	offers: string[];
	raw: Record<string, unknown>;
};

/** Read the parts of a storyboard this tool needs, tolerating missing optional fields. Problems are listed, not thrown. */
export const readStoryboard = (raw: unknown): {sb: SbLite | null; problems: string[]} => {
	const problems: string[] = [];
	if (!isRecord(raw)) return {sb: null, problems: ['storyboard.json is not a JSON object']};
	const scenes: SbScene[] = [];
	for (const [i, s] of (Array.isArray(raw.scenes) ? raw.scenes : []).entries()) {
		if (!isRecord(s) || typeof s.id !== 'string' || typeof s.narration !== 'string') {
			problems.push(`scenes[${i}] needs an id and a narration`);
			continue;
		}
		scenes.push({
			id: s.id,
			type: str(s.type) ?? 'talk',
			narration: s.narration,
			segment: str(s.segment),
			onScreen: isRecord(s.onScreen) ? s.onScreen : undefined,
			badger: isRecord(s.badger) ? (s.badger as SbScene['badger']) : undefined,
			badgerBeats: Array.isArray(s.badgerBeats) ? (s.badgerBeats.filter(isRecord) as SbScene['badgerBeats']) : undefined,
		});
	}
	if (!scenes.length) problems.push('the storyboard has no scenes');
	const arr = (v: unknown) => (Array.isArray(v) ? v.filter(isRecord) : []);
	const sb: SbLite = {
		slug: str(raw.slug) ?? '',
		title: str(raw.title) ?? '',
		scenes,
		sources: arr(raw.sources).map((s) => ({id: String(s.id ?? ''), title: String(s.title ?? ''), url: String(s.url ?? ''), status: str(s.status)})),
		shorts: arr(raw.shorts).map((s) => ({id: String(s.id ?? ''), sceneIds: Array.isArray(s.sceneIds) ? s.sceneIds.map(String) : [], title: String(s.title ?? '')})),
		thumbnails: arr(raw.thumbnails).map((t) => ({id: String(t.id ?? ''), text: String(t.text ?? ''), expression: str(t.expression), badger: t.badger === true})),
		analysis: (Array.isArray(raw.analysis) ? raw.analysis : isRecord(raw.analysis) ? [raw.analysis] : []).filter(isRecord) as SbLite['analysis'],
		news: isRecord(raw.news) ? (raw.news as SbLite['news']) : {},
		offers: Array.isArray(raw.offers) ? raw.offers.filter((x): x is string => typeof x === 'string') : [],
		raw,
	};
	return {sb, problems};
};

export const isDeveloping = (sb: SbLite, briefStatus: string | null): boolean => {
	const d = sb.news.developing ?? sb.raw.developing;
	return briefStatus === 'developing' || d === true || (typeof d === 'string' && !!d.trim()) || (isRecord(d) && (d.label === undefined || !!d.label));
};

/** Badger's reactions in a scene: the show's badgerBeats, else the engine's badger.reaction (neutral is no beat). */
export const beatsOf = (sc: SbScene): string[] => {
	const beats = (sc.badgerBeats ?? []).map((b) => String(b.reaction ?? '')).filter(Boolean);
	if (beats.length) return beats;
	return sc.badger?.present && sc.badger.reaction && sc.badger.reaction !== 'neutral' ? [sc.badger.reaction] : [];
};

/** 1-3 display sentences from the first scenes, 600 characters or fewer: gate-checked text for descriptions and emails. */
export const summaryOf = (sb: SbLite, split: Splitter, max = 3): string => {
	const out: string[] = [];
	for (const sc of sb.scenes.slice(0, 3)) {
		let ss;
		try {
			ss = split(sc.narration);
		} catch {
			continue;
		}
		for (const s of ss) {
			if (out.length >= max) break;
			const t = s.display.trim();
			if (t && (out.join(' ').length + t.length + 1 <= 600)) out.push(/[.!?…"”]$/.test(t) ? t : `${t}.`);
		}
		if (out.length >= max) break;
	}
	return out.join(' ').replace(/[<>]/g, '');
};

const WORDS_PER_SECOND = 2.5;

export const estimateSceneSec = (display: string): number => Math.max(2, Math.round((display.split(/\s+/).filter(Boolean).length / WORDS_PER_SECOND + 0.35) * 10) / 10);

export type KitEpisode = Record<string, unknown>;

/**
 * The description's source list. A DefiLlama record cited by the API URL (api.llama.fi/hacks#<name>@<date>) opens a
 * raw JSON dump of about 1,400 records where a viewer cannot find the figure (and Shorts descriptions do not link
 * anyway), so it is cited in words, by its entry on DefiLlama's public hacks page.
 */
export const kitSources = (sources: SbLite['sources']): Array<{title: string; url: string}> => {
	const out: Array<{title: string; url: string}> = [];
	for (const s of sources) {
		if (!/^https?:\/\//.test(s.url) || !s.title) continue;
		// the radar's redaction placeholder never reaches the description
		let entry = {title: s.title.replace(/[<>]/g, '').replace(/\[\s*named person\s*\]/gi, '(name withheld)'), url: s.url};
		let u: URL | null = null;
		try {
			u = new URL(s.url);
		} catch {
			u = null;
		}
		// a title or link that names a person the radar missed: the outlet and its address only (persons.ts)
		const publisher = /\(([^()]{2,60})\)\s*$/.exec(entry.title)?.[1] ?? u?.hostname ?? 'Source';
		const safe = safeSource({title: s.title, url: s.url, publisher}, {placeholderTitleOk: true});
		if (safe.withheld) {
			entry = {title: safe.title === s.title ? entry.title : safe.title, url: safe.url};
			try {
				u = new URL(safe.url);
			} catch {
				u = null;
			}
		}
		// a link the radar withheld because it spells a person's name is only the outlet's address: say so in words
		if (u && (u.pathname === '/' || u.pathname === '') && !u.search && !u.hash)
			entry = {title: `${entry.title} (${u.hostname} home page: the article's own link names a person)`.slice(0, 200), url: entry.url};
		if (u && u.hostname === 'api.llama.fi' && u.pathname.replace(/\/+$/, '') === '/hacks') {
			let rec = '';
			try {
				rec = decodeURIComponent(u.hash.replace(/^#/, ''));
			} catch {
				rec = '';
			}
			const m = /^(.+)@(\d{4}-\d{2}-\d{2})$/.exec(rec);
			const window = /incidents dated (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})/.exec(s.title);
			const what = m ? `entry ${m[1]}, ${m[2]}` : window ? `incidents dated ${window[1]} to ${window[2]}` : 'list of hacks';
			entry = {title: `DefiLlama hacks list (defillama.com/hacks), ${what}`.replace(/[<>]/g, '').slice(0, 200), url: 'https://defillama.com/hacks'};
		}
		if (!out.some((x) => x.title === entry.title && x.url === entry.url)) out.push(entry);
		if (out.length >= 30) break;
	}
	return out;
};

export const episodeForKit = (o: {sb: SbLite; channel: ChannelConfig; split: Splitter; developing: boolean; incidentType: string | null; evergreenUrl: string | null}): KitEpisode => {
	const {sb, channel} = o;
	const ok = (t: string) => !!t && t.length <= 100 && !/[<>]/.test(t);
	const titleOptions = unique([sb.title, ...sb.shorts.map((s) => s.title)].map((t) => t.trim()).filter(ok)).slice(0, 5);
	const short = sb.shorts[0];
	const order = sb.scenes.map((s) => s.id);
	const inShort = short ? order.filter((id) => short.sceneIds.includes(id)) : order;
	const cta = [channel.ctaDefault, o.evergreenUrl ? `Explainer: ${o.evergreenUrl}` : ''].filter(Boolean).join(' ');
	// the publish kit adds its own "Education only, not financial advice." to the description and kit.disclosures, so
	// a second not-advice line here would print twice
	const disclosures = o.developing ? ['DEVELOPING STORY: details may change. Corrections will be pinned in the comments.'] : [];
	return {
		version: 1,
		channel: 'zoora-security',
		slug: sb.slug,
		lang: 'en',
		titleOptions,
		title: titleOptions[0],
		summary: summaryOf(sb, o.split) || sb.title,
		youtubeVideoId: null,
		scenes: sb.scenes.map((s) => {
			let display = '';
			try {
				display = o.split(s.narration).map((x) => x.display).join(' ');
			} catch {
				display = s.narration;
			}
			return {id: s.id, durationSec: estimateSceneSec(display)};
		}),
		sources: kitSources(sb.sources),
		offers: channel.offers,
		hashtags: channel.hashtags.slice(0, 10),
		tags: unique(['crypto security', 'security news', ...(o.incidentType ? [o.incidentType.replace(/-/g, ' ')] : []), channel.showName.replace(/&/g, 'and')]).filter((t) => !/[,<>]/.test(t)),
		cta: cta.slice(0, 200),
		disclosures,
		madeForKids: channel.madeForKids,
		containsSyntheticMedia: channel.containsSyntheticMedia,
		...(channel.offers.length ? {} : {paidPromotion: {value: false, reason: 'No offers, sponsors or free products in this video.'}}),
		shortCuts: [{id: short?.id && /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(short.id) ? short.id : 'short1', from: inShort[0], to: inShort[inShort.length - 1], title: (short?.title || sb.title).slice(0, 100)}],
		render: {entry: 'src/show/index.ts', composition: 'ShowEpisode', shortComposition: 'ShowShort', thumbnailComposition: 'Thumbnail', thumbnails: 3},
	};
};

/** Kit checks that do not apply to a daily Short (it is the whole video, and Shorts have no chapters). */
export const KIT_NOT_APPLICABLE: Record<string, string> = {
	chapters: 'Shorts have no chapters.',
};
