/**
 * Assembles the publish kit for one episode: kit.json (exactly the PublishKit contract) plus every text file.
 * Pure: takes the validated episode and the offer registry, returns file names and contents.
 */
import {toCues, toSrt, toVtt} from './captions.ts';
import {runChecks, type PostTexts} from './checks.ts';
import {buildChecklist} from './checklist.ts';
import {LIMITS, utf8Bytes, youtubeTagsLength} from './limits.ts';
import {destinationHosts, hubLink, PLATFORM_SOURCE, resolveOffers} from './offers.ts';
import {
	bioCaption,
	clipFile,
	instagramCaption,
	MEASURE,
	NOT_ADVICE,
	pinnedComment,
	shortDescription,
	shortFile,
	topDisclosure,
	xPost,
	youtubeDescription,
	type ClipText,
	type PostContext,
} from './posts.ts';
import {buildRenders, renderPlanScript} from './render-plan.ts';
import {buildChapters} from './timing.ts';
import type {Episode, OfferRegistry, Platform, PublishKit, ResolvedOffer} from './types.ts';

export type BuildOptions = {
	hub: string; // validated hub origin
	registry: OfferRegistry;
	registryPath: string;
	registryIsExample: boolean;
	now: Date;
};

export type BuildResult = {kit: PublishKit; files: Record<string, string>};

/** Why settings.paidPromotion has its value (the text after "paidPromotion=<value>: "). */
const paidReason = (e: Episode, offers: readonly ResolvedOffer[], missing: readonly string[]): string => {
	const parts = [
		...offers.filter((o) => o.offer.relationship !== 'own-product').map((o) => `${o.offer.relationship} offer "${o.id}" (a third party pays a commission, reward or fee)`),
		...offers
			.filter((o) => o.offer.relationship === 'own-product')
			.map((o) => `own product "${o.id}" (YouTube's endorsement rules cover your own brand when the relationship is not obvious, so ticking is the conservative default)`),
		...missing.map((id) => `offer "${id}" (not in the registry yet, so treated as paid until resolved)`),
		...(e.paidPromotion?.value ? [e.paidPromotion.reason] : []),
	];
	return parts.length ? `${parts.join('; ')}.` : 'no offers, sponsors or own products are listed for this episode.';
};

export const buildKit = (e: Episode, opts: BuildOptions): BuildResult => {
	const generatedAt = opts.now.toISOString();
	const {resolved: offers, missing} = resolveOffers(e.offers, opts.registry, opts.now);
	const {chapters, problems: chapterProblems} = buildChapters(e.scenes, e.totalSec);
	const ctx: PostContext = {episode: e, offers, hub: opts.hub, chapters};

	const clips = (make: (s: Episode['shorts'][number]) => string): ClipText[] => e.shorts.map((short) => ({short, text: make(short)}));
	const texts: PostTexts = {
		youtube: youtubeDescription(ctx),
		pinned: pinnedComment(ctx),
		shorts: clips((s) => shortDescription(ctx, s)),
		tiktok: clips((s) => bioCaption(ctx, s, LIMITS.tiktokHashtags)),
		reels: clips((s) => bioCaption(ctx, s, LIMITS.instagramHashtags)),
		x: clips((s) => xPost(ctx, s)),
		instagram: instagramCaption(ctx),
	};

	const cues = e.captions ? toCues(e.captions) : null;
	const srt = cues ? toSrt(cues) : null;
	const vtt = cues ? toVtt(cues) : null;
	const renders = buildRenders(e);
	const checks = runChecks({ctx, texts, missingOffers: missing, registryIsExample: opts.registryIsExample, chapterProblems, destinationHosts: destinationHosts(opts.registry)});

	// Only self-contained lines that stay true wherever they are reused (the newsletter and the article leave out
	// region-restricted offers): the general line covers the offers shown everywhere. The region-filtered page line
	// and its disclosure stay in the description and pinned comment; restricted disclosures stay in kit.offers.
	const open = offers.filter((o) => !o.restricted);
	const general = topDisclosure(open);
	const disclosures = [...(general ? [general] : []), ...new Set(open.map((o) => o.disclosure)), ...e.disclosures, NOT_ADVICE];

	const promoting = e.shorts.filter((s) => s.offers.length);
	const n = e.shorts.length;
	const clipNote = (file: string): string => `Clip 1 of ${n}; ${file} has one ${file === 'x.txt' ? 'post' : 'caption'} per clip (media/short-<n>.mp4).`;
	const platformNotes: Record<Platform, string[]> = {
		youtube: [
			`Counted in UTF-8 bytes: YouTube's API limit is ${LIMITS.youtubeDescriptionBytes} bytes, and "<" or ">" are not allowed.`,
			`Title: "${e.title}" (${e.title.length}/${LIMITS.youtubeTitleChars} characters); ${e.titleOptions.length} option${e.titleOptions.length === 1 ? '' : 's'} in titleOptions.`,
			...(e.tags.length ? [`Tags for YouTube Studio (${youtubeTagsLength(e.tags)}/${LIMITS.youtubeTagsChars} characters): ${e.tags.join(', ')}`] : []),
			chapters.length ? `${chapters.length} chapters (times from ${e.timing === 'timeline' ? 'the measured timeline' : 'episode.json'}).` : 'No chapters in the description: see the "chapters" check.',
			`Uses the first ${LIMITS.youtubeHashtagsUsed} hashtags (YouTube shows up to 3 above the title).`,
		],
		shorts: [
			`Short 1 of ${n}; each Short has its own shorts-<n>.txt with its title and description.`,
			`Title: "${e.shorts[0]?.title ?? ''}" (${e.shorts[0]?.title.length ?? 0}/${LIMITS.youtubeTitleChars} characters).`,
			'Links in Shorts descriptions are not clickable (YouTube Help 13748639): set each Short\'s Related video to the full episode in YouTube Studio (Help 14075157).',
		],
		tiktok: [
			clipNote('tiktok.txt'),
			`Limit ${LIMITS.tiktokCaptionUnits} UTF-16 units (Content Posting API; the app allows 4,000).`,
			'Captions have no clickable links: "Link in bio" points to the hub, which hides region-restricted offers.',
			"TikTok's Branded Content Policy lists financial services, including trading and cryptocurrency, as prohibited industries: never post a clip that promotes a crypto financial offer as branded content.",
			...(promoting.length ? [`Turn on the content disclosure setting for clip${promoting.length === 1 ? '' : 's'} ${promoting.map((s) => s.n).join(', ')}: "Your brand" for your own products, "Branded content" for affiliate, referral or sponsor offers.`] : []),
		],
		reels: [
			clipNote('reels.txt'),
			`Instagram allows ${LIMITS.instagramCaptionChars} characters and ${LIMITS.instagramHashtags} hashtags per post and Reel (hashtag cap announced December 2025).`,
			'Captions have no clickable links: "Link in bio" points to the hub, which hides region-restricted offers.',
			...(promoting.length
				? [`${promoting.length === 1 ? 'Clip' : 'Clips'} ${promoting.map((s) => s.n).join(', ')} ${promoting.length === 1 ? 'promotes' : 'promote'} an offer: add Instagram's Paid partnership label when a brand gave you something of value for it.`]
				: []),
		],
		x: [
			clipNote('x.txt'),
			`Weighted count: every URL counts ${LIMITS.xUrlWeight}, emoji count 2 (twitter-text v3).`,
			`Videos longer than 2:20 need X Premium.`,
			...(e.youtubeVideoId ? [] : ['The full-episode link points to the channel until you re-run the kit with --youtube-id <id>.']),
		],
		instagram: [
			'Feed post for the episode, for example with a thumbnail image.',
			'Captions have no clickable links: "Link in bio" points to the hub.',
			`At most ${LIMITS.instagramHashtags} hashtags.`,
		],
	};
	const post = (platform: Platform, text: string) => ({text, charCount: MEASURE[platform].count(text), limit: MEASURE[platform].limit, notes: platformNotes[platform]});
	const first = (list: ClipText[]): string => list[0]?.text ?? '';

	const paidPromotion = offers.length > 0 || missing.length > 0 || e.paidPromotion?.value === true;
	const kit: PublishKit = {
		version: 1,
		channel: e.channel,
		slug: e.slug,
		youtubeVideoId: e.youtubeVideoId,
		title: e.title,
		titleOptions: e.titleOptions,
		summary: e.summary,
		chapters: chapters.map((c) => ({start: c.start, title: c.title})),
		sources: e.sources,
		offers: offers.map((o) => ({id: o.id, hubUrl: hubLink(opts.hub, o.id, e.slug, PLATFORM_SOURCE.youtube), disclosure: o.disclosure})),
		disclosures,
		posts: {
			youtube: post('youtube', texts.youtube),
			shorts: post('shorts', first(texts.shorts)),
			tiktok: post('tiktok', first(texts.tiktok)),
			reels: post('reels', first(texts.reels)),
			x: post('x', first(texts.x)),
			instagram: post('instagram', texts.instagram),
		},
		captions: {srt, vtt},
		renders,
		settings: {
			madeForKids: e.madeForKids.value,
			containsSyntheticMedia: e.containsSyntheticMedia.value,
			paidPromotion,
			reasons: [
				`madeForKids=${e.madeForKids.value}${e.madeForKids.defaulted ? ' (studio default)' : ''}: ${e.madeForKids.reason}`,
				`containsSyntheticMedia=${e.containsSyntheticMedia.value}${e.containsSyntheticMedia.defaulted ? ' (studio default)' : ''}: ${e.containsSyntheticMedia.reason}`,
				`paidPromotion=${paidPromotion}: ${paidReason(e, offers, missing)}`,
			],
		},
		checks,
		generatedAt,
	};

	const files: Record<string, string> = {
		'kit.json': `${JSON.stringify(kit, null, 2)}\n`,
		'youtube-description.txt': `${texts.youtube}\n`,
		'pinned-comment.txt': `${texts.pinned}\n`,
		...Object.fromEntries(texts.shorts.map((c) => [`shorts-${c.short.n}.txt`, shortFile(c.short, c.text, n)])),
		'tiktok.txt': clipFile(texts.tiktok, 'tiktok'),
		'reels.txt': clipFile(texts.reels, 'reels'),
		'x.txt': clipFile(texts.x, 'x'),
		'instagram.txt': `${texts.instagram}\n`,
		...(srt ? {'captions.srt': srt} : {}),
		...(vtt ? {'captions.vtt': vtt} : {}),
		'render-plan.sh': renderPlanScript(e, renders, generatedAt),
	};
	files['checklist.md'] = buildChecklist({
		episode: e,
		kit,
		offers,
		missing,
		registryPath: opts.registryPath,
		registryIsExample: opts.registryIsExample,
		hub: opts.hub,
		descriptionBytes: utf8Bytes(texts.youtube),
		fileNames: [...Object.keys(files), 'checklist.md'],
	});
	return {kit, files};
};
