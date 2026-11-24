/**
 * One episode, one language → every asset, plus manifest.json. make.ts is the command-line wrapper; tests call
 * buildLanguage() directly. Each step clears and rewrites only its own folder under
 * out/assets/<channel>/<slug>/<lang>/ (article/, podcast/, social/, newsletter/).
 */
import {existsSync, mkdirSync, readFileSync, rmSync} from 'node:fs';
import {join, relative} from 'node:path';
import {articleUrl, renderArticle, type Alternate, type ArticleInput} from './article.ts';
import {loadChannelConfig, type ChannelConfig} from './config.ts';
import {developingLabel, isReviewed, loadEpisode, type Episode, type Roots} from './episode.ts';
import {esc, htmlBalanceProblems} from './html.ts';
import {displayText, UNSPACED} from './markup.ts';
import {HREFLANG, strings} from './i18n.ts';
import {checkDisclosedLinks, lintText, loadPrivateNames, namePatterns, redact, unknownHubLinks, type LintContext, type LintIssue} from './lint.ts';
import {adapterKit, newsletterAvailable, runNewsletter} from './newsletter.ts';
import {hubLink, loadRegistryIfPresent, selectOffers, subscribeLink, type HubSource, type UsableOffer} from './offers.ts';
import {AudioError, hasFfmpeg} from './audio.ts';
import {makePodcast} from './podcast.ts';
import {linkedinPost, LINKEDIN_FOLD, LINKEDIN_LIMIT, telegramPost, xThread, type SocialInput, type SocialOffer} from './social.ts';
import {chapters as buildChapters, paragraphs as buildParagraphs, type Chapter, type Paragraph} from './transcript.ts';
import type {AssetFile, AssetRecord, AssetStatus, Check, Lang, Manifest} from './types.ts';
import {clock, fileSize, firstSentence, isoTimestamp, readJson, sha256File, truncate, uniqueStrings, writeFile, writeJson} from './util.ts';
import {X_LIMIT} from './xcount.ts';

export const ASSET_IDS = ['article', 'podcast', 'social', 'newsletter'] as const;
export type AssetGroup = (typeof ASSET_IDS)[number];

export type BuildOptions = {
	roots: Roots;
	channel: string;
	slug: string;
	lang: Lang;
	outRoot: string; // out/assets
	configPath: string;
	hubRoot: string; // projects/creator-hub
	site?: string;
	youtubeId?: string | null;
	published?: string | null;
	kitPath?: string | null;
	offersPath?: string | null;
	namesPath?: string | null;
	badgerCuesPath?: string | null;
	coverPath?: string | null;
	podcastMinSec?: number | null;
	only?: AssetGroup[];
	now?: Date;
};

export type BuildResult = {manifest: Manifest; manifestPath: string; dir: string};

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const RANK: Record<AssetStatus, number> = {skipped: 0, ok: 1, draft: 2, pending: 3, blocked: 4, error: 5};
export const worst = (statuses: AssetStatus[]): AssetStatus => statuses.reduce<AssetStatus>((w, s) => (RANK[s] > RANK[w] ? s : w), 'skipped');

const fileRec = (path: string, base: string): AssetFile => ({path: relative(base, path), bytes: fileSize(path) ?? 0, sha256: sha256File(path) ?? ''});

const issueChecks = (issues: LintIssue[]): Check[] => issues.map((i) => ({id: `lint:${i.rule}`, ok: false, level: i.level, detail: `${i.where}: ${i.message}`}));

const normWords = (text: string, unspaced: boolean): string => {
	const t = text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '');
	return unspaced ? t.replace(/\s+/g, '') : t.split(/\s+/).filter(Boolean).join(' ');
};

/** Scenes whose storyboard narration no longer matches the words the voice step timed (the storyboard was edited). */
export const staleScenes = (ep: Episode): string[] => {
	const tl = ep.timeline;
	if (!tl || tl.mock) return [];
	const unspaced = UNSPACED.has(ep.lang);
	return ep.storyboard.scenes
		.filter((sc, i) => normWords(displayText(sc.narration), unspaced) !== normWords(tl.scenes[i].words.map((w) => w.text).join(' '), unspaced))
		.map((sc) => sc.id);
};

/** Takeaways: the sidecar's, else the on-screen steps and bullets in scene order, else the chapter titles. */
const deriveTakeaways = (ep: Episode, chapters: Chapter[]): {list: string[]; from: string} => {
	if (ep.sidecar.takeaways?.length) return {list: uniqueStrings(ep.sidecar.takeaways).slice(0, 8), from: 'assets.json'};
	const items: string[] = [];
	for (const scene of ep.storyboard.scenes) {
		for (const key of ['steps', 'bullets']) {
			const v = scene.onScreen?.[key];
			if (Array.isArray(v)) items.push(...v.filter((x): x is string => typeof x === 'string'));
		}
	}
	const list = uniqueStrings(items).slice(0, 6);
	if (list.length) return {list, from: 'on-screen steps and bullets'};
	return {list: chapters.slice(1, -1).map((c) => c.title).slice(0, 6), from: 'chapter titles'};
};

export const buildLanguage = (o: BuildOptions): BuildResult => {
	const now = (o.now ?? new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z');
	const only = new Set<AssetGroup>(o.only?.length ? o.only : ASSET_IDS);
	const ep = loadEpisode(o.roots, o.channel, o.slug, o.lang, {kitPath: o.kitPath ?? null});
	const cfg: ChannelConfig = loadChannelConfig(o.configPath, o.channel);
	const siteKey = o.site ?? cfg.defaultSite;
	const site = cfg.sites[siteKey];
	if (!site) throw new Error(`unknown --site "${siteKey}"; config has: ${Object.keys(cfg.sites).join(', ')}`);
	const sb = ep.storyboard;
	const {s, fallback: stringsFallback} = strings(o.lang);
	const dir = join(o.outRoot, o.channel, o.slug, o.lang);
	mkdirSync(dir, {recursive: true});
	const lintCtx: LintContext = {names: namePatterns(loadPrivateNames(o.namesPath ?? null))};
	const ownerActions: string[] = [];
	const common: Check[] = [];

	// ---- shared facts ---------------------------------------------------------------------------------------
	const ytRaw = o.youtubeId ?? ep.kit?.youtubeVideoId ?? ep.sidecar.youtubeVideoId ?? null;
	if (ytRaw && !YOUTUBE_ID.test(ytRaw)) throw new Error(`YouTube id must be 11 characters (A-Z, a-z, 0-9, "-", "_"), got ${JSON.stringify(ytRaw)}`);
	const youtubeId = ytRaw;
	const publishedRaw = o.published ?? ep.sidecar.publishedAt ?? null;
	const publishedAt = publishedRaw ? isoTimestamp(publishedRaw) : null;
	if (publishedRaw && !publishedAt) throw new Error(`publish date must be YYYY-MM-DD or an ISO timestamp, got ${JSON.stringify(publishedRaw)}`);
	const reviewed = isReviewed(sb);
	const title = (ep.kit?.title ?? sb.title).trim();
	const paragraphs: Paragraph[] = buildParagraphs(sb, ep.timeline);
	const chapters = buildChapters(sb, ep.timeline);
	const transcriptText = paragraphs.map((p) => p.text).join(' ');
	let summary = ep.sidecar.summary?.trim() || ep.kit?.summary?.trim() || '';
	if (!summary) {
		const first = firstSentence(transcriptText);
		const second = firstSentence(transcriptText.slice(first.length).trim());
		summary = truncate([first, second].filter(Boolean).join(' '), 300);
		common.push({id: 'summary', ok: false, level: 'warning', detail: 'no summary in the publish kit or assets.json: used the first two sentences of the transcript'});
	}
	const takeaways = deriveTakeaways(ep, chapters);
	const developing = developingLabel(sb);
	const developingText = developing ? (developing.label ?? s.developingPrefix.replace(/:$/, '')) : null;
	const fictionNote = sb.fiction ? (sb.ui?.fictionDisclaimer?.trim() || (stringsFallback ? null : s.fiction)) : null;
	if (sb.fiction && !fictionNote) common.push({id: 'fiction-note', ok: false, level: 'error', detail: `fiction story without a ${o.lang} fiction disclaimer: add ui.fictionDisclaimer to the storyboard`});
	if (stringsFallback) common.push({id: 'ui-language', ok: false, level: 'warning', detail: `no ${o.lang} interface text in scripts/assets/lib/i18n.ts: headings fall back to English`});
	if (!reviewed) common.push({id: 'translation', ok: false, level: 'warning', detail: 'machine translation (storyboard.translation.status is not "native-reviewed"): pages are noindex and posts stay drafts until a native speaker reviews it'});
	if (!youtubeId) ownerActions.push('Add the YouTube video id (--youtube-id, kit.json or assets.json youtubeVideoId) once the video is uploaded.');
	if (!publishedAt) ownerActions.push('Add the publish date (--published YYYY-MM-DD or assets.json publishedAt).');
	const unverified = sb.sources.filter((x) => x.status !== 'verified');
	if (unverified.length) common.push({id: 'sources-verified', ok: false, level: 'error', detail: `unverified source(s): ${unverified.map((x) => x.id).join(', ')} (the claim gate fails these; verify or remove them)`});
	const pendingCorrections = ep.corrections.filter((c) => c.status === 'pending');
	if (pendingCorrections.length) common.push({id: 'corrections', ok: false, level: 'warning', detail: `${pendingCorrections.length} pending correction(s) for this episode: approve and pin them, then re-run (pinned ones are shown on the article)`});
	if (!ep.timeline) common.push({id: 'timeline', ok: false, level: 'warning', detail: 'no timeline: the transcript comes from the storyboard text and has no timestamps'});
	const stale = staleScenes(ep);
	if (stale.length) {
		common.push({id: 'timeline-stale', ok: false, level: 'warning', detail: `the narration of ${stale.join(', ')} changed after the voice step: re-run scripts/voice/build.py (and the render) so the audio, captions and transcript match`});
	}
	const fresh = !!ep.timeline && stale.length === 0;

	// offers (registry rules, see offers.ts)
	const offerIds = uniqueStrings([...(ep.kit?.offers ?? []).map((x) => x.id), ...(sb.offers ?? [])]);
	const {registry, path: registryPath} = loadRegistryIfPresent(o.offersPath ?? null);
	const selection = selectOffers(offerIds, registry, registryPath, o.now ?? new Date(), {lang: o.lang, localized: cfg.offerDisclosures});
	for (const l of selection.leftOut) common.push({id: `offer:${l.id}`, ok: true, level: 'info', detail: `left out: ${l.reason}`});
	const linkFor = (offers: UsableOffer[], source: HubSource) => offers.map((x) => ({...x, url: hubLink(cfg.hubOrigin, x.id, o.slug, source)}));
	const leftOutDisclosures = new Set((ep.kit?.offers ?? []).filter((x) => selection.leftOut.some((l) => l.id === x.id)).map((x) => x.disclosure.trim()));
	const usedDisclosures = new Set(selection.offers.map((x) => x.disclosure));
	const episodeDisclosures = uniqueStrings((ep.kit?.disclosures ?? []).filter((d) => !leftOutDisclosures.has(d.trim()) && !usedDisclosures.has(d.trim())));

	const url = articleUrl(site.articleBase, o.channel, o.slug, o.lang);
	const indexable = reviewed && !!youtubeId && !!publishedAt;
	const alternates: Alternate[] = indexable
		? ep.languages.filter((l) => l.reviewed).map((l) => ({lang: l.lang, hreflang: HREFLANG[l.lang], url: articleUrl(site.articleBase, o.channel, o.slug, l.lang)}))
		: [];
	const youtubeUrl = youtubeId ? `https://www.youtube.com/watch?v=${youtubeId}` : null;

	const previous = existsSync(join(dir, 'manifest.json')) ? (readJson(join(dir, 'manifest.json'), 'previous manifest') as Manifest) : null;
	const records: AssetRecord[] = [];
	const allIssues: LintIssue[] = [];

	// ---- (a) article ------------------------------------------------------------------------------------------
	if (only.has('article')) {
		const adir = join(dir, 'article');
		rmSync(adir, {recursive: true, force: true});
		const siteOffers = site.offers ? linkFor(selection.offers, 'site') : [];
		const input: ArticleInput = {
			channel: o.channel,
			slug: o.slug,
			lang: o.lang,
			siteKey,
			siteName: site.siteName,
			brand: cfg.brand,
			showName: cfg.displayName,
			hubOrigin: cfg.hubOrigin,
			url,
			indexUrl: `${site.articleBase}/`,
			alternates,
			indexable,
			title,
			summary,
			takeaways: takeaways.list,
			paragraphs,
			chapters,
			transcriptFromTimeline: !!ep.timeline,
			sources: sb.sources,
			offers: siteOffers,
			disclosures: episodeDisclosures,
			fictionNote,
			developing: developing ? {label: developing.label ?? s.developing, asOf: developing.asOf} : null,
			corrections: ep.corrections.filter((c) => c.status === 'pinned').map((c) => ({date: c.date, text: c.correct})),
			machineTranslation: !reviewed,
			youtubeId,
			publishedAt,
			modifiedAt: now,
			durationMs: ep.timeline?.totalMs ?? null,
			subscribeUrl: subscribeLink(cfg.hubOrigin, o.slug, 'site'),
			feedUrl: `${site.articleBase}/feed.xml`,
			s,
		};
		const {html, meta} = renderArticle(input);
		writeFile(join(adir, 'index.html'), html);
		writeJson(join(adir, 'meta.json'), {...meta, status: 'pending-lint'});
		const issues: LintIssue[] = [];
		const texts: [string, string][] = [
			['title', title],
			['summary', summary],
			...takeaways.list.map((t, i): [string, string] => [`takeaway ${i + 1}`, t]),
			...siteOffers.map((x): [string, string] => [`offer ${x.id}`, `${x.name} ${x.disclosure}`]),
			...episodeDisclosures.map((d, i): [string, string] => [`disclosure ${i + 1}`, d]),
			...(fictionNote ? [['fiction note', fictionNote] as [string, string]] : []),
			...input.corrections.map((c, i): [string, string] => [`correction ${i + 1}`, c.text]),
			...sb.sources.map((x, i): [string, string] => [`source ${i + 1} title`, x.title]),
			...chapters.map((c, i): [string, string] => [`chapter ${i + 1}`, c.title]),
		];
		for (const [where, text] of texts) issues.push(...lintText(text, `article: ${where}`, lintCtx));
		for (const p of paragraphs) issues.push(...lintText(p.text, `article: transcript ${p.sceneId}`, {...lintCtx, transcript: true}));
		issues.push(...checkDisclosedLinks(html, siteOffers.map((x) => ({url: esc(x.url), disclosure: esc(x.disclosure), label: `offer "${x.id}"`})), 'article HTML'));
		issues.push(...unknownHubLinks(html, cfg.hubOrigin, siteOffers.map((x) => x.url), 'article HTML'));
		const structure = htmlBalanceProblems(html);
		const checks: Check[] = [
			...common,
			{id: 'html-structure', ok: structure.length === 0, level: structure.length ? 'error' : 'info', detail: structure.length ? structure.slice(0, 5).join('; ') : 'well nested'},
			{id: 'youtube-id', ok: !!youtubeId, level: youtubeId ? 'info' : 'warning', detail: youtubeId ? `embeds ${youtubeId}` : 'no YouTube id: the page shows a placeholder and is noindex'},
			{id: 'publish-date', ok: !!publishedAt, level: publishedAt ? 'info' : 'warning', detail: publishedAt ?? 'no publish date: JSON-LD has no uploadDate and the page is noindex'},
			{id: 'indexable', ok: true, level: 'info', detail: indexable ? `indexable; hreflang: ${alternates.map((a) => a.hreflang).join(', ')}` : 'noindex (draft, unpublished video or unreviewed translation)'},
			{id: 'takeaways', ok: takeaways.list.length > 0, level: takeaways.list.length ? 'info' : 'warning', detail: `${takeaways.list.length} from ${takeaways.from}`},
			{id: 'offers', ok: true, level: 'info', detail: site.offers ? `${siteOffers.length} offer link(s), each with its disclosure directly above` : `site "${siteKey}" carries no offer links`},
			...issueChecks(issues),
		];
		allIssues.push(...issues);
		const blocked = checks.some((c) => !c.ok && c.level === 'error');
		const status: AssetStatus = blocked ? 'blocked' : indexable && fresh && !stringsFallback ? 'ok' : 'draft';
		writeJson(join(adir, 'meta.json'), {...meta, status});
		records.push({
			id: 'article',
			kind: 'article',
			status,
			summary: `${url}${indexable ? '' : ' (noindex)'}`,
			files: [fileRec(join(adir, 'index.html'), dir), fileRec(join(adir, 'meta.json'), dir)],
			checks,
			chars: {html: html.length, transcript: transcriptText.length, words: transcriptText.split(/\s+/).filter(Boolean).length, title: [...title].length, summary: [...summary].length},
		});
	}

	// ---- (c) social -------------------------------------------------------------------------------------------
	if (only.has('social')) {
		const sdir = join(dir, 'social');
		rmSync(sdir, {recursive: true, force: true});
		const social: SocialInput = {
			title,
			summary,
			hook: ep.sidecar.social?.hook?.trim() || null,
			takeaways: takeaways.list,
			chapterTitles: chapters.map((c) => c.title),
			youtubeUrl,
			articleUrl: url,
			subscribeUrl: subscribeLink(cfg.hubOrigin, o.slug, 'other'),
			developing: developing ? `${developingText}:`.replace(/::$/, ':') : null,
			fictionNote,
			hashtags: ep.sidecar.social?.hashtags ?? cfg.hashtags[o.lang] ?? [],
			offersX: linkFor(selection.offers, 'x').slice(0, 1) as SocialOffer[],
			offersOther: linkFor(selection.offers, 'other') as SocialOffer[],
			s,
		};
		const thread = xThread(social);
		const tg = telegramPost(social);
		const li = linkedinPost(social);
		const announcer = existsSync(join(o.hubRoot, 'tools/announcer'));
		writeFile(join(sdir, 'x-thread.txt'), `${thread.posts.map((p, i) => `[${i + 1}/${thread.posts.length}] (${p.xLength}/${X_LIMIT})\n${p.text}`).join('\n\n---\n\n')}\n`);
		writeJson(join(sdir, 'x-thread.json'), {version: 1, platform: 'x', posts: thread.posts.map((p) => ({text: p.text, weightedLength: p.xLength, limit: X_LIMIT}))});
		writeFile(join(sdir, 'telegram.html'), `${tg.html}\n`);
		writeFile(join(sdir, 'telegram.txt'), `${tg.text}\n`);
		writeFile(join(sdir, 'linkedin.txt'), `${li.text}\n`);
		const issues: LintIssue[] = [];
		const xLinks = social.offersX.map((x) => ({url: x.url, disclosure: x.disclosure, label: `offer "${x.id}"`}));
		const otherLinks = social.offersOther.map((x) => ({url: x.url, disclosure: x.disclosure, label: `offer "${x.id}"`}));
		thread.posts.forEach((p, i) => {
			issues.push(...lintText(p.text, `X post ${i + 1}`, lintCtx));
			issues.push(...checkDisclosedLinks(p.text, xLinks, `X post ${i + 1}`, 280));
			issues.push(...unknownHubLinks(p.text, cfg.hubOrigin, xLinks.map((x) => x.url), `X post ${i + 1}`));
		});
		issues.push(...lintText(tg.text, 'Telegram post', lintCtx), ...checkDisclosedLinks(tg.text, otherLinks, 'Telegram post', 400));
		issues.push(...checkDisclosedLinks(tg.html, social.offersOther.map((x) => ({url: esc(x.url), disclosure: esc(x.disclosure), label: `offer "${x.id}"`})), 'Telegram post (HTML)', 600));
		issues.push(...lintText(li.text, 'LinkedIn post', lintCtx), ...checkDisclosedLinks(li.text, otherLinks, 'LinkedIn post', 400));
		const lenChecks: Check[] = [
			{id: 'x-count', ok: thread.posts.length >= 3 && thread.posts.length <= 6, level: thread.posts.length >= 3 && thread.posts.length <= 6 ? 'info' : 'error', detail: `${thread.posts.length} posts (3-6)`},
			...thread.posts.map((p, i): Check => ({id: `x-length-${i + 1}`, ok: p.xLength <= X_LIMIT, level: p.xLength <= X_LIMIT ? 'info' : 'error', detail: `${p.xLength}/${X_LIMIT} weighted characters (URLs count 23)`})),
			{id: 'telegram-length', ok: tg.visibleLength <= 4096, level: tg.visibleLength <= 4096 ? 'info' : 'error', detail: `${tg.visibleLength}/4096 characters${tg.visibleLength > 1024 ? ' (too long for a photo caption: send it as a text message)' : ''}`},
			{id: 'linkedin-length', ok: li.length <= LINKEDIN_LIMIT, level: li.length <= LINKEDIN_LIMIT ? 'info' : 'error', detail: `${li.length}/${LINKEDIN_LIMIT} characters`},
			{id: 'linkedin-hook', ok: li.hookLength <= LINKEDIN_FOLD, level: li.hookLength <= LINKEDIN_FOLD ? 'info' : 'warning', detail: `first line ${li.hookLength} characters (about ${LINKEDIN_FOLD} show before "see more")`},
			{id: 'announcer', ok: !announcer, level: announcer ? 'warning' : 'info', detail: announcer ? 'creator-hub/tools/announcer exists but its input format is not wired here yet: plain text files written' : 'creator-hub/tools/announcer not found: plain text files written'},
			{id: 'youtube-link', ok: !!youtubeUrl, level: youtubeUrl ? 'info' : 'warning', detail: youtubeUrl ? youtubeUrl : 'no YouTube link yet: posts link only the article'},
		];
		const checks = [...common.filter((c) => c.id !== 'timeline'), ...lenChecks, ...issueChecks(issues)];
		allIssues.push(...issues);
		const blocked = checks.some((c) => !c.ok && c.level === 'error');
		const status: AssetStatus = blocked ? 'blocked' : youtubeUrl && reviewed && publishedAt && !stringsFallback ? 'ok' : 'draft';
		const files = ['x-thread.txt', 'x-thread.json', 'telegram.html', 'telegram.txt', 'linkedin.txt'].map((f) => fileRec(join(sdir, f), dir));
		records.push({
			id: 'social',
			kind: 'social',
			status,
			summary: `X thread of ${thread.posts.length}, Telegram ${tg.visibleLength} chars, LinkedIn ${li.length} chars`,
			files,
			checks,
			chars: {...Object.fromEntries(thread.posts.map((p, i) => [`x${i + 1}`, p.xLength])), telegram: tg.visibleLength, linkedin: li.length},
		});
	}

	// ---- (d) newsletter ---------------------------------------------------------------------------------------
	if (only.has('newsletter')) {
		const ndir = join(dir, 'newsletter');
		rmSync(ndir, {recursive: true, force: true});
		if (!cfg.newsletterLangs.includes(o.lang)) {
			records.push({id: 'newsletter', kind: 'newsletter', status: 'skipped', summary: `the email list is ${cfg.newsletterLangs.join(', ')} only`, files: [], checks: []});
		} else if (!newsletterAvailable(o.hubRoot)) {
			records.push({id: 'newsletter', kind: 'newsletter', status: 'skipped', summary: `creator-hub newsletter tool not found at ${o.hubRoot}/tools/newsletter`, files: [], checks: []});
		} else if (!youtubeId) {
			records.push({
				id: 'newsletter',
				kind: 'newsletter',
				status: 'pending',
				summary: 'waiting for the YouTube id: the email links to the video (the newsletter tool requires it)',
				files: [],
				checks: [{id: 'youtube-id', ok: false, level: 'warning', detail: 'no YouTube id yet: re-run with --youtube-id once the video is uploaded'}],
			});
		} else {
			mkdirSync(ndir, {recursive: true});
			let kitPath = ep.kitPath;
			const fromAdapter = !kitPath;
			if (!kitPath) {
				kitPath = join(ndir, 'kit.assets.json');
				writeJson(
					kitPath,
					adapterKit({
						channel: o.channel,
						slug: o.slug,
						youtubeId,
						title,
						summary,
						chapters: chapters.length >= 3 ? chapters.map((c) => ({start: clock(c.startMs), title: c.title})) : [],
						sources: sb.sources.filter((x) => x.status === 'verified').map((x) => ({title: x.title, url: x.url})),
						offers: selection.offers.map((x) => ({id: x.id, hubUrl: hubLink(cfg.hubOrigin, x.id, o.slug, 'yt'), disclosure: x.disclosure})),
						disclosures: uniqueStrings([...selection.offers.map((x) => x.disclosure), ...episodeDisclosures, ...(fictionNote ? [fictionNote] : [])]),
						generatedAt: now,
					}),
				);
			}
			const run = runNewsletter({hubRoot: o.hubRoot, kitPath, outDir: ndir, hubOrigin: cfg.hubOrigin, offersPath: registryPath, youtubeId, brand: cfg.brand});
			writeJson(join(ndir, 'run.json'), {...run, stdout: redact(run.stdout, lintCtx.names), stderr: redact(run.stderr, lintCtx.names), kitPath: relative(dir, kitPath), kitSource: fromAdapter ? 'assets-adapter' : 'publish-kit'});
			const issues: LintIssue[] = [];
			for (const f of run.files.filter((x) => x.endsWith('.md'))) issues.push(...lintText(readFileSync(f, 'utf8'), 'newsletter draft', lintCtx));
			const checks: Check[] = [
				{id: 'newsletter-tool', ok: run.exitCode === 0, level: run.exitCode === 0 ? 'info' : 'error', detail: `${run.command.slice(0, 4).join(' ')} … exit ${run.exitCode}: ${(run.exitCode === 0 ? run.stdout : run.stderr).trim().split('\n').slice(0, 6).join(' | ')}`},
				{id: 'kit-source', ok: !fromAdapter, level: fromAdapter ? 'warning' : 'info', detail: fromAdapter ? 'no publish kit yet: used the adapter kit written by scripts/assets (re-run after scripts/publish-kit)' : `publish kit ${ep.kitPath}`},
				...issueChecks(issues),
			];
			allIssues.push(...issues);
			const blocked = checks.some((c) => !c.ok && c.level === 'error');
			const status: AssetStatus = run.exitCode !== 0 && run.exitCode !== 1 ? 'error' : blocked ? 'blocked' : fromAdapter ? 'draft' : 'ok';
			records.push({
				id: 'newsletter',
				kind: 'newsletter',
				status,
				summary: run.exitCode === 0 ? `draft written (${run.files.length} files); nothing sent` : 'the newsletter lint failed: see run.json',
				files: [...run.files, join(ndir, 'run.json'), ...(fromAdapter ? [kitPath] : [])].map((f) => fileRec(f, dir)),
				checks,
				chars: Object.fromEntries(run.files.map((f) => [f.endsWith('.md') ? 'markdown' : 'html', readFileSync(f, 'utf8').length])),
			});
		}
	}

	// ---- (b) podcast ------------------------------------------------------------------------------------------
	if (only.has('podcast')) {
		const defaultCues = join(o.roots.generated, o.channel, o.slug, o.lang, 'badger-cues.json');
		const cover = o.coverPath ?? (cfg.podcast.coverFile ? join(o.roots.project, cfg.podcast.coverFile) : null);
		let pod: ReturnType<typeof makePodcast>;
		try {
			pod = makePodcast({
				ep,
				cfg,
				outDir: join(dir, 'podcast'),
				title,
				summary,
				chapters,
				takeaways: takeaways.list,
				sources: sb.sources,
				articleUrl: url,
				youtubeUrl,
				publishedAt,
				offers: linkFor(selection.offers, 'other'),
				disclosures: uniqueStrings([...episodeDisclosures, ...(fictionNote ? [fictionNote] : [])]),
				fictionNote,
				developing: developingText,
				subscribeUrl: subscribeLink(cfg.hubOrigin, o.slug, 'other'),
				s,
				lint: lintCtx,
				minSec: o.podcastMinSec ?? cfg.podcastMinSec,
				badgerCuesPath: o.badgerCuesPath ?? (existsSync(defaultCues) ? defaultCues : null),
				coverPath: cover && existsSync(cover) ? cover : null,
				reviewed,
				now,
				ffmpeg: hasFfmpeg(),
			});
		} catch (err) {
			if (!(err instanceof AudioError)) throw err;
			pod = {record: {id: 'podcast', kind: 'podcast', status: 'error', summary: 'ffmpeg failed', files: [], checks: [{id: 'ffmpeg', ok: false, level: 'error', detail: err.message}]}, item: null, issues: []};
		}
		if (pod.record.status !== 'skipped' && pod.record.status !== 'error') {
			pod.record.checks.unshift(...common.filter((c) => ['sources-verified', 'fiction-note', 'timeline-stale'].includes(c.id)));
			if (pod.record.status === 'ok' && !fresh) pod.record.status = 'draft';
			if (pod.record.checks.some((c) => !c.ok && c.level === 'error')) pod.record.status = 'blocked';
		}
		pod.record.checks.push(...issueChecks(pod.issues));
		allIssues.push(...pod.issues);
		if (pod.record.status !== 'skipped' && !(cover && existsSync(cover))) ownerActions.push(`Podcast cover art: render a 3000x3000 still and set podcast.coverFile in scripts/assets/config/channels.json (see docs/ASSETS.md, "Cover art").`);
		records.push(pod.record);
	}

	// ---- manifest ---------------------------------------------------------------------------------------------
	const kept = previous && previous.version === 1 ? previous.assets.filter((r) => !records.some((x) => x.id === r.id)) : [];
	const assets = [...records, ...kept].sort((a, b) => ['article', 'podcast', 'social', 'newsletter'].indexOf(a.id) - ['article', 'podcast', 'social', 'newsletter'].indexOf(b.id));
	if (assets.some((a) => a.status === 'blocked')) ownerActions.unshift('Fix the blocking lint findings listed under each asset, then re-run.');
	// no private name ever reaches the manifest or the console, whatever text a check quotes
	for (const a of records) for (const c of a.checks) c.detail = redact(c.detail, lintCtx.names);
	const inputs: Manifest['inputs'] = {
		storyboard: {path: relative(o.roots.project, ep.storyboardPath), sha256: sha256File(ep.storyboardPath)},
		timeline: {path: relative(o.roots.project, ep.timelinePath), sha256: sha256File(ep.timelinePath)},
		...(ep.narrationPath ? {narration: {path: relative(o.roots.project, ep.narrationPath), sha256: sha256File(ep.narrationPath)}} : {}),
		...(ep.kitPath ? {kit: {path: relative(o.roots.project, ep.kitPath), sha256: sha256File(ep.kitPath)}} : {}),
		...(registryPath ? {offers: {path: relative(o.roots.project, registryPath), sha256: sha256File(registryPath)}} : {}),
		...Object.fromEntries(ep.sidecarPaths.map((p, i) => [`sidecar${i ? i + 1 : ''}`, {path: relative(o.roots.project, p), sha256: sha256File(p)}])),
		config: {path: relative(o.roots.project, o.configPath), sha256: sha256File(o.configPath)},
	};
	const manifest: Manifest = {
		version: 1,
		tool: 'video-studio/scripts/assets',
		channel: o.channel,
		slug: o.slug,
		lang: o.lang,
		generatedAt: now,
		inputs,
		status: worst(assets.map((a) => a.status)),
		assets,
		lint: {errors: allIssues.filter((i) => i.level === 'error').length, warnings: allIssues.filter((i) => i.level === 'warning').length},
		ownerActions: uniqueStrings(ownerActions),
	};
	const manifestPath = join(dir, 'manifest.json');
	writeJson(manifestPath, manifest);
	return {manifest, manifestPath, dir};
};

