/**
 * The kit's checks[]: platform limits, chapter rules, disclosures, claim and placeholder lint, hub-only links,
 * restricted offers, offer status, and the audience and AI settings. Each check reports ok plus a detail line.
 */
import {CUE_RULES, textBetween, toCues} from './captions.ts';
import {LIMITS, countHashtags, utf16Units, utf8Bytes, xWeightedLength, youtubeTagsLength} from './limits.ts';
import {checkLinks, findRules, INCOME_CLAIMS, PLACEHOLDERS, type LinkContext} from './lint.ts';
import {PLATFORM_SOURCE} from './offers.ts';
import {restrictedLines, topDisclosure, type ClipText, type PostContext} from './posts.ts';
import type {Episode, PublishKit, ResolvedOffer} from './types.ts';
import {clock} from './util.ts';

export type Check = PublishKit['checks'][number];

export type PostTexts = {
	youtube: string;
	pinned: string;
	shorts: ClipText[];
	tiktok: ClipText[];
	reels: ClipText[];
	x: ClipText[];
	instagram: string;
};

export type CheckInput = {
	ctx: PostContext;
	texts: PostTexts;
	missingOffers: string[];
	registryIsExample: boolean;
	chapterProblems: string[];
	destinationHosts: string[];
};

/** Words that make a spoken line a disclosure (FTC: say what the relationship is). */
export const SPOKEN_DISCLOSURE = /\b(?:affiliate|referral|commission|sponsor(?:ed|ship)?|paid (?:promotion|partnership)|partner(?:ship)?|I built|my own (?:product|project|app|tool|company|business)|I own|we own|I hold)\b/i;

const check = (id: string, problems: string[], okDetail: string): Check => ({id, ok: problems.length === 0, detail: problems.length ? problems.join(' | ') : okDetail});

const within = (id: string, items: {label: string; count: number}[], limit: number, unit: string): Check => {
	const over = items.filter((i) => i.count > limit).map((i) => `${i.label} is ${i.count}/${limit} ${unit}`);
	return check(id, over, items.map((i) => `${i.label} ${i.count}/${limit}`).join(', ') + ` ${unit}`);
};

type Labelled = [where: string, text: string];

/** Episode metadata the platforms show (titles, chapters, tags...), for the lint checks. */
const metadataTexts = (e: Episode): Labelled[] => [
	...e.titleOptions.map((t, i): Labelled => [`titleOptions[${i}]`, t]),
	['summary', e.summary],
	['cta', e.cta],
	...e.scenes.filter((s) => s.chapter).map((s): Labelled => [`chapter "${s.id}"`, s.chapter as string]),
	...e.shorts.flatMap((s): Labelled[] => [[`short ${s.n} title`, s.title], [`short ${s.n} hook`, s.hook]]),
	...e.tags.map((t, i): Labelled => [`tags[${i}]`, t]),
];

/** Every post text, labelled by the file it is written to. */
const postTexts = (texts: PostTexts): Labelled[] => [
	['youtube-description.txt', texts.youtube],
	['pinned-comment.txt', texts.pinned],
	...texts.shorts.map((c): Labelled => [`shorts-${c.short.n}.txt`, c.text]),
	...texts.tiktok.map((c): Labelled => [`tiktok.txt clip ${c.short.n}`, c.text]),
	...texts.reels.map((c): Labelled => [`reels.txt clip ${c.short.n}`, c.text]),
	...texts.x.map((c): Labelled => [`x.txt clip ${c.short.n}`, c.text]),
	['instagram.txt', texts.instagram],
];

/** The offer-link block must pair every named link with its disclosure on the next line. */
const linkPairs = (text: string, where: string, offers: readonly ResolvedOffer[], ctx: PostContext): string[] => {
	const lines = text.split('\n');
	const problems: string[] = [];
	for (const o of offers.filter((x) => !x.restricted)) {
		const at = lines.findIndex((l) => l.includes(`/go/${o.id}?`));
		if (at === -1) problems.push(`${where}: no link for offer "${o.id}"`);
		else if (lines[at + 1] !== o.disclosure) problems.push(`${where}: the "${o.id}" link is not followed by its disclosure`);
	}
	if (offers.some((o) => o.restricted)) {
		const [pageLine, discLine] = restrictedLines(ctx, PLATFORM_SOURCE.youtube);
		const at = lines.indexOf(pageLine);
		if (at === -1 || lines[at + 1] !== discLine) problems.push(`${where}: the region-filtered link page line or its disclosure is missing`);
	}
	return problems;
};

export const runChecks = (input: CheckInput): Check[] => {
	const {ctx, texts} = input;
	const e = ctx.episode;
	const offers = ctx.offers;
	const allClips = [...texts.shorts, ...texts.tiktok, ...texts.reels, ...texts.x];
	const checks: Check[] = [];

	// limits
	const titles = [{label: 'chosen title', count: e.title.length}, ...e.titleOptions.map((t, i) => ({label: `option ${i + 1}`, count: t.length}))];
	checks.push(within('youtube-title', titles, LIMITS.youtubeTitleChars, 'characters'));
	const descProblems = [
		...(utf8Bytes(texts.youtube) > LIMITS.youtubeDescriptionBytes ? [`${utf8Bytes(texts.youtube)}/${LIMITS.youtubeDescriptionBytes} bytes`] : []),
		...(/[<>]/.test(texts.youtube) ? ['contains "<" or ">", which YouTube rejects'] : []),
	];
	checks.push(check('youtube-description', descProblems, `${utf8Bytes(texts.youtube)}/${LIMITS.youtubeDescriptionBytes} bytes, no angle brackets`));
	checks.push(within('youtube-tags', [{label: `${e.tags.length} tags`, count: youtubeTagsLength(e.tags)}], LIMITS.youtubeTagsChars, 'characters (commas and quotes count)'));
	const shortProblems = texts.shorts.flatMap((c) => [
		...(c.short.title.length > LIMITS.youtubeTitleChars ? [`Short ${c.short.n} title is ${c.short.title.length}/${LIMITS.youtubeTitleChars} characters`] : []),
		...(utf8Bytes(c.text) > LIMITS.youtubeDescriptionBytes ? [`Short ${c.short.n} description is ${utf8Bytes(c.text)} bytes`] : []),
		...(/[<>]/.test(c.text + c.short.title) ? [`Short ${c.short.n} contains "<" or ">"`] : []),
	]);
	checks.push(check('shorts-text', shortProblems, texts.shorts.map((c) => `Short ${c.short.n}: title ${c.short.title.length}/${LIMITS.youtubeTitleChars}, description ${utf8Bytes(c.text)} bytes`).join('; ')));
	checks.push(within('tiktok-caption', texts.tiktok.map((c) => ({label: `clip ${c.short.n}`, count: utf16Units(c.text)})), LIMITS.tiktokCaptionUnits, 'UTF-16 units'));
	checks.push(within('reels-caption', texts.reels.map((c) => ({label: `clip ${c.short.n}`, count: utf16Units(c.text)})), LIMITS.instagramCaptionChars, 'characters'));
	checks.push(within('instagram-caption', [{label: 'feed caption', count: utf16Units(texts.instagram)}], LIMITS.instagramCaptionChars, 'characters'));
	checks.push(within('x-post', texts.x.map((c) => ({label: `clip ${c.short.n}`, count: xWeightedLength(c.text)})), LIMITS.xWeighted, 'weighted characters'));
	const tagCounts = [
		{label: 'YouTube description', count: countHashtags(texts.youtube), limit: LIMITS.youtubeHashtagsIgnoredAbove},
		...texts.tiktok.map((c) => ({label: `TikTok clip ${c.short.n}`, count: countHashtags(c.text), limit: LIMITS.tiktokHashtags})),
		...texts.reels.map((c) => ({label: `Reels clip ${c.short.n}`, count: countHashtags(c.text), limit: LIMITS.instagramHashtags})),
		{label: 'Instagram feed', count: countHashtags(texts.instagram), limit: LIMITS.instagramHashtags},
	];
	checks.push(
		check(
			'hashtags',
			tagCounts.filter((t) => t.count > t.limit).map((t) => `${t.label} has ${t.count} hashtags; the limit is ${t.limit}`),
			`YouTube ${tagCounts[0].count} (all ignored above ${LIMITS.youtubeHashtagsIgnoredAbove}); TikTok, Reels and Instagram at most ${LIMITS.instagramHashtags}`,
		),
	);

	// chapters and clip lengths
	checks.push(check('chapters', input.chapterProblems, `${e.scenes.filter((s) => s.chapter).length} chapters from 00:00, each at least ${LIMITS.chapterMinSec} s (times from ${e.timing === 'timeline' ? 'the measured timeline' : 'episode.json'})`));
	const lengths = e.shorts.map((s) => ({n: s.n, sec: s.endSec - s.startSec}));
	checks.push(
		check(
			'short-durations',
			lengths.filter((l) => l.sec > LIMITS.shortsMaxSec).map((l) => `Short ${l.n} is ${clock(l.sec)}; Shorts and Reels allow ${clock(LIMITS.shortsMaxSec)}`),
			lengths.map((l) => `Short ${l.n} ${clock(l.sec)}`).join(', ') + ` (limit ${clock(LIMITS.shortsMaxSec)})`,
		),
	);
	checks.push(
		check(
			'x-video-length',
			lengths.filter((l) => l.sec > LIMITS.xVideoMaxSecFree).map((l) => `Short ${l.n} is ${clock(l.sec)}; X allows ${clock(LIMITS.xVideoMaxSecFree)} without Premium`),
			`every clip is at most ${clock(LIMITS.xVideoMaxSecFree)} (X limit without Premium)`,
		),
	);

	// disclosures
	const disc: string[] = [];
	const top = topDisclosure(offers);
	if (top) {
		if (texts.youtube.split('\n')[0] !== top) disc.push('the YouTube description does not open with the disclosure line');
		if (!texts.pinned.includes(top)) disc.push('the pinned comment has no disclosure line');
		disc.push(...linkPairs(texts.youtube, 'description', offers, ctx), ...linkPairs(texts.pinned, 'pinned comment', offers, ctx));
	}
	for (const clip of allClips) {
		for (const o of offers.filter((x) => clip.short.offers.includes(x.id) && !x.restricted)) {
			if (!clip.text.includes(o.disclosure)) disc.push(`a caption for Short ${clip.short.n} promotes "${o.id}" without its disclosure`);
		}
	}
	checks.push(check('disclosures', [...new Set(disc)], offers.length ? 'disclosure first in the description, next to every link, in the pinned comment and in every clip that promotes an offer' : 'no offers, so no link disclosures are needed'));

	const spoken: string[] = [];
	for (const o of offers.filter((x) => !x.restricted)) {
		// restricted offers must not be promoted in the video at all (see "restricted-offers")
		const scenes = e.scenes.filter((s) => s.offers.includes(o.id));
		if (!scenes.length) {
			spoken.push(`no scene is marked as promoting "${o.id}" (scenes[].offers), so the in-video disclosure cannot be checked; the FTC expects it in the video, not only the description`);
			continue;
		}
		if (!e.captions) {
			spoken.push(`no captions.json: confirm by ear that scenes ${scenes.map((s) => s.id).join(', ')} say the "${o.id}" disclosure out loud`);
			continue;
		}
		for (const s of scenes) {
			const said = textBetween(e.captions, s.startSec * 1000, s.endSec * 1000);
			if (!SPOKEN_DISCLOSURE.test(said)) spoken.push(`scene ${s.id} promotes "${o.id}" but its captions contain no spoken disclosure (say e.g. "this is an affiliate link")`);
		}
	}
	checks.push(check('spoken-disclosure', spoken, offers.length ? 'every scene that promotes an offer says a disclosure (from captions.json)' : 'no offers to disclose'));

	// lint
	const posts = postTexts(texts);
	const lint = [...metadataTexts(e), ...posts];
	const claims = lint.flatMap(([where, t]) => findRules(INCOME_CLAIMS, t, where)).map((h) => `${h.where}: ${h.label} ("${h.match}")`);
	checks.push(check('income-claims', claims, `no income, return, guarantee, price or buy-call wording in ${lint.length} texts`));
	const holders = lint.flatMap(([where, t]) => findRules(PLACEHOLDERS, t, where)).map((h) => `${h.where}: ${h.label} ("${h.match}")`);
	checks.push(check('placeholders', holders, 'no TODO, REPLACE, lorem ipsum or example.com left in the texts'));

	const linkCtx: LinkContext = {
		hubOrigin: ctx.hub,
		offerIds: offers.map((o) => o.id),
		slug: e.slug,
		sourceUrls: e.sources.map((s) => s.url),
		destinationHosts: input.destinationHosts,
	};
	checks.push(check('links-via-hub', posts.flatMap(([where, t]) => checkLinks(t, where, linkCtx)), 'every offer link goes through the hub; no raw affiliate URLs'));

	// offers
	const restricted = offers.filter((o) => o.restricted);
	const restrictedProblems = [
		...restricted.flatMap((o) => posts.filter(([, t]) => t.toLowerCase().includes(o.offer.name.toLowerCase())).map(([where]) => `${where} names restricted offer "${o.id}"`)),
		...restricted.flatMap((o) =>
			e.scenes
				.filter((s) => s.offers.includes(o.id))
				.map((s) => `scene ${s.id} promotes "${o.id}", which is restricted by region (${[...o.offer.blockedCountries, ...(o.offer.allowedCountries ?? []).map((c) => `only ${c}`)].join(', ') || 'unknown countries blocked'}); a video is visible in every country, so it must not promote it`),
		),
	];
	checks.push(check('restricted-offers', restrictedProblems, restricted.length ? `${restricted.map((o) => o.id).join(', ')}: reachable only through the hub's region-filtered page, never named in posts or promoted in scenes` : 'no region-restricted offers'));

	const offerProblems = [
		...input.missingOffers.map((id) => `"${id}" is not in the offer registry, so it has no disclosure and was left out`),
		...offers.filter((o) => !o.live).map((o) => `"${o.id}" is inactive or expired in the registry (the hub would show "offer ended")`),
	];
	if (offerProblems.length && input.registryIsExample) offerProblems.push('creator-hub/config/offers.json does not exist, so the placeholder offers.example.json was used');
	checks.push(check('offers-live', offerProblems, offers.length ? `${offers.length} offer${offers.length === 1 ? '' : 's'} active in the registry` : 'no offers'));

	// settings
	checks.push(check('made-for-kids', [], `madeForKids ${e.madeForKids.value} (${e.madeForKids.defaulted ? 'studio default' : 'set in episode.json'}): ${e.madeForKids.reason}`));
	checks.push(check('synthetic-media', [], `containsSyntheticMedia ${e.containsSyntheticMedia.value} (${e.containsSyntheticMedia.defaulted ? 'studio default' : 'set in episode.json'}): ${e.containsSyntheticMedia.reason}`));

	// captions
	if (e.captions) {
		const cues = toCues(e.captions);
		const bad = cues.flatMap((c, i) => (c.lines.length > CUE_RULES.maxLines || c.lines.some((l) => l.length > CUE_RULES.maxLineChars) ? [`cue ${i + 1}`] : []));
		const last = cues[cues.length - 1];
		const late = last && last.endMs > e.totalSec * 1000 + 1000 ? [`captions run to ${clock(last.endMs / 1000)}, past the video's ${clock(e.totalSec)}`] : [];
		checks.push(check('captions', [...(bad.length ? [`${bad.join(', ')} exceed ${CUE_RULES.maxLines} lines of ${CUE_RULES.maxLineChars} characters`] : []), ...late], `${cues.length} cues, at most ${CUE_RULES.maxLines} lines of ${CUE_RULES.maxLineChars} characters`));
	} else {
		checks.push(check('captions', [], 'no captions.json, so no caption files were written (YouTube can auto-caption)'));
	}
	return checks;
};
