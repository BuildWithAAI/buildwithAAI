/**
 * The kit's checks[]: platform limits, chapter rules, disclosures, claim and placeholder lint (posts, metadata and
 * narration), hub-only links, restricted offers, offer status, and the audience and AI settings. Each check
 * reports ok plus a detail line.
 */
import {captionText, CUE_RULES, textBetween, toCues} from './captions.ts';
import {disclosureWordingProblems, names, saysDisclosure, SPOKEN_EXAMPLE} from './disclosure.ts';
import {LIMITS, countHashtags, utf16Units, utf8Bytes, xWeightedLength, youtubeTagsLength} from './limits.ts';
import {checkLinks, findRules, INCOME_CLAIMS, PLACEHOLDERS, type LinkContext} from './lint.ts';
import {PLATFORM_SOURCE} from './offers.ts';
import {bioDisclosure, clipOffers, namedOffers, restrictedLines, topDisclosure, type ClipText, type PostContext} from './posts.ts';
import type {Episode, PublishKit, ResolvedOffer} from './types.ts';
import {clock, joinAnd} from './util.ts';

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

const NARRATION = 'narration (captions.json)';

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
	// every caption that promotes or names an offer carries its disclosure, wherever the name comes from (hook, title, hashtags)
	for (const clip of allClips) {
		for (const o of new Set([...clipOffers(ctx, clip.short), ...namedOffers(offers, clip.text)])) {
			if (!clip.text.includes(o.disclosure)) disc.push(`a caption for Short ${clip.short.n} ${clip.short.offers.includes(o.id) ? 'promotes' : 'names'} "${o.id}" without its disclosure`);
		}
	}
	// the registry loader refuses these too; checked again for callers that build a kit from their own registry
	for (const o of offers) disc.push(...disclosureWordingProblems(o.offer.disclosure, o.offer.relationship).map((p) => `offer "${o.id}": ${p}`));
	const bio = bioDisclosure(offers);
	if (bio && !texts.instagram.includes(bio)) disc.push('instagram.txt does not disclose that the bio links include affiliate or own-product links');
	for (const o of namedOffers(offers, texts.instagram)) if (!texts.instagram.includes(o.disclosure)) disc.push(`instagram.txt names "${o.id}" without its disclosure`);
	checks.push(
		check(
			'disclosures',
			[...new Set(disc)],
			offers.length
				? 'disclosure first in the description, next to every link, in the pinned comment, in every clip that promotes or names an offer, and at the top of the Instagram caption'
				: 'no offers, so no link disclosures are needed',
		),
	);

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
			if (!saysDisclosure(said, o)) {
				const what = o.offer.relationship === 'own-product' ? 'that it is your own product' : `the ${o.offer.relationship} relationship`;
				spoken.push(`scene ${s.id} promotes "${o.id}" but its narration does not say ${what} (a negated mention such as "this is not sponsored" does not count); say e.g. "${SPOKEN_EXAMPLE[o.offer.relationship]}"`);
			}
		}
	}
	checks.push(check('spoken-disclosure', spoken, offers.length ? 'every scene that promotes an offer states the relationship in its narration (from captions.json; negated mentions do not count)' : 'no offers to disclose'));

	// lint: metadata, every post and the narration
	const posts = postTexts(texts);
	const narration: Labelled[] = e.captions ? [[NARRATION, captionText(e.captions)]] : [];
	const lint = [...metadataTexts(e), ...posts, ...narration];
	/** "narration (captions.json), scene s06" when the matched words fall inside one scene. */
	const place = (where: string, match: string): string => {
		const captions = e.captions;
		if (where !== NARRATION || !captions) return where;
		const scene = e.scenes.find((s) => textBetween(captions, s.startSec * 1000, s.endSec * 1000).includes(match));
		return scene ? `${where}, scene ${scene.id}` : where;
	};
	const claims = lint.flatMap(([where, t]) => findRules(INCOME_CLAIMS, t, where)).map((h) => `${place(h.where, h.match)}: ${h.label} ("${h.match}")`);
	checks.push(check('income-claims', claims, `no income, return, price, guarantee, bonus or buy-call wording in ${lint.length} texts${narration.length ? ', the narration included' : ''}`));
	const holders = lint.flatMap(([where, t]) => findRules(PLACEHOLDERS, t, where)).map((h) => `${place(h.where, h.match)}: ${h.label} ("${h.match}")`);
	checks.push(check('placeholders', holders, 'no TODO, REPLACE, lorem ipsum or example.com left in the texts'));

	const linkCtx: LinkContext = {
		hubOrigin: ctx.hub,
		offerIds: offers.map((o) => o.id),
		slug: e.slug,
		sourceUrls: e.sources.map((s) => s.url),
		destinationHosts: input.destinationHosts,
	};
	checks.push(check('links-via-hub', posts.flatMap(([where, t]) => checkLinks(t, where, linkCtx)), 'every offer link goes through the hub; no raw affiliate URLs'));

	// offers: a restricted offer is never named anywhere a viewer in a blocked country sees (posts, titles, Short
	// titles and hooks, chapters, tags, narration), nor promoted in a scene
	const restricted = offers.filter((o) => o.restricted);
	const restrictedProblems = restricted.flatMap((o) => {
		const where = [...new Set(lint.filter(([, t]) => names(t, o.offer.name)).map(([w]) => w))];
		const rules = [...o.offer.blockedCountries, ...(o.offer.allowedCountries ?? []).map((c) => `only ${c}`)].join(', ') || 'unknown countries blocked';
		return [
			...(where.length ? [`restricted offer "${o.id}" (${o.offer.name}) is named in ${joinAnd(where)}; text seen in every country must not name it`] : []),
			...e.scenes
				.filter((s) => s.offers.includes(o.id))
				.map((s) => `scene ${s.id} promotes "${o.id}", which is restricted by region (${rules}); a video is visible in every country, so it must not promote it`),
		];
	});
	checks.push(
		check(
			'restricted-offers',
			restrictedProblems,
			restricted.length
				? `${restricted.map((o) => o.id).join(', ')}: reachable only through the hub's region-filtered page; never named in posts, titles, Short titles, chapters, tags or narration, nor promoted in scenes`
				: 'no region-restricted offers',
		),
	);

	const offerProblems = [
		...input.missingOffers.map((id) => `"${id}" is not in the offer registry, so it has no disclosure and was left out`),
		...offers.filter((o) => !o.live).map((o) => `"${o.id}" is inactive or expired in the registry (the hub would show "offer ended")`),
	];
	if (offerProblems.length && input.registryIsExample) offerProblems.push('creator-hub/config/offers.json does not exist, so the placeholder offers.example.json was used');
	checks.push(check('offers-live', offerProblems, offers.length ? `${offers.length} offer${offers.length === 1 ? '' : 's'} active in the registry` : 'no offers'));

	// settings: both channels are for adults, and a made-for-kids video loses the comments the pinned comment needs
	const kids = e.madeForKids.value
		? [
				'madeForKids is true, but these channels make crypto and AI security videos for adults (docs/PROJECT_INSTRUCTIONS.md): set it to false with the reason, or do not publish the video here',
				`YouTube turns off comments, cards and end screens on made-for-kids videos, so the pinned comment (safety line${offers.length ? ' and offer disclosures' : ''}) cannot be posted`,
				...(offers.length || input.missingOffers.length || e.paidPromotion?.value ? ['the episode has paid promotion, and ticking that box removes a video from YouTube Kids'] : []),
			]
		: [];
	checks.push(check('made-for-kids', kids, `madeForKids ${e.madeForKids.value} (${e.madeForKids.defaulted ? 'studio default' : 'set in episode.json'}): ${e.madeForKids.reason}`));
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
