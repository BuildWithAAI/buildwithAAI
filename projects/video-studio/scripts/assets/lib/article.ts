/**
 * (a) ARTICLE: one static, self-contained HTML page per episode and language: title, summary, the embedded video,
 * key takeaways, the full transcript (timeline words, one paragraph per scene, a timestamp link per paragraph),
 * sources, offer links with their disclosure directly above each one, a subscribe call to the hub, JSON-LD
 * (Article + VideoObject), OpenGraph, a canonical URL and hreflang alternates. No scripts, no web fonts, no images
 * loaded by the page itself; a meta Content-Security-Policy pins the inline style by hash.
 */
import {createHash} from 'node:crypto';
import {esc, jsonLd, safeUrl} from './html.ts';
import {displayDate, HREFLANG, OG_LOCALE, type Strings} from './i18n.ts';
import type {Chapter, Paragraph} from './transcript.ts';
import type {Lang, Source} from './types.ts';
import {clock, isoDuration, truncate} from './util.ts';

export type ArticleLink = {id: string; name: string; disclosure: string; url: string};

export type Alternate = {lang: Lang; hreflang: string; url: string};

export type ArticleInput = {
	channel: string;
	slug: string;
	lang: Lang;
	siteKey: string;
	siteName: string;
	brand: string;
	showName: string;
	hubOrigin: string;
	url: string; // canonical URL of this page
	indexUrl: string; // the site's article index (<articleBase>/)
	alternates: Alternate[]; // includes this page when indexable; empty when not
	indexable: boolean;
	title: string;
	summary: string;
	takeaways: string[];
	paragraphs: Paragraph[];
	chapters: Chapter[];
	transcriptFromTimeline: boolean;
	sources: Source[];
	offers: ArticleLink[];
	disclosures: string[]; // episode-level disclosure lines (not the per-offer ones)
	fictionNote: string | null;
	developing: {label: string; asOf: string | null} | null;
	corrections: {date: string; text: string}[];
	machineTranslation: boolean;
	youtubeId: string | null;
	publishedAt: string | null; // ISO timestamp
	modifiedAt: string; // ISO timestamp
	durationMs: number | null;
	subscribeUrl: string;
	feedUrl: string | null;
	s: Strings;
};

export type ArticleMeta = {
	version: 1;
	channel: string;
	slug: string;
	lang: Lang;
	hreflang: string;
	site: string;
	url: string;
	title: string;
	summary: string;
	datePublished: string | null;
	dateModified: string;
	indexable: boolean;
	alternates: Alternate[];
	youtubeId: string | null;
	styleSha256: string;
};

const CSS = `:root{--bg:#F4F6F8;--fg:#161A21;--muted:#4A5260;--card:#FFFFFF;--line:#C9CED6;--link:#0E6F68;--accent:#29B8AD;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#0B0C0F;--fg:#F4F6F8;--muted:#C9CED6;--card:#161A21;--line:#3A414D;--link:#29B8AD}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:1.0625rem/1.65 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans",sans-serif}
a{color:var(--link);text-underline-offset:.15em}a:focus-visible,.button:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.skip{position:absolute;left:-999px;top:0}.skip:focus{left:1rem;top:1rem;background:var(--card);padding:.5rem 1rem;z-index:1}
header,main,footer{max-width:44rem;margin:0 auto;padding:0 1.25rem}
header{padding-top:1rem;font-weight:600}header a{color:var(--fg);text-decoration:none}
h1{font-size:clamp(1.75rem,5vw,2.4rem);line-height:1.2;margin:.75rem 0 .5rem}h2{font-size:1.35rem;margin:2.25rem 0 .75rem}h3{font-size:1.05rem;margin:1.5rem 0 .25rem}
.kicker,.meta,.note,.ts,footer{color:var(--muted)}.kicker{margin:1.5rem 0 0;font-weight:600}.meta{margin:0 0 1rem;font-size:.95rem}
.summary{font-size:1.15rem}
.notice{border:1px solid var(--line);border-left:4px solid var(--accent);background:var(--card);padding:.75rem 1rem;margin:1rem 0;border-radius:6px}
.notice p{margin:.25rem 0}
.video{margin:1.25rem 0;position:relative;aspect-ratio:16/9;background:#161A21;border-radius:8px;overflow:hidden}
.video iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.video .pending{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:1rem;text-align:center;color:#F4F6F8}
.offer{border:1px solid var(--line);background:var(--card);border-radius:6px;padding:.75rem 1rem;margin:.75rem 0}
.offer .disclosure{margin:0 0 .35rem}.offer p{margin:0}
.transcript p{margin:0 0 1rem}.ts{font-variant-numeric:tabular-nums;font-size:.9rem;margin-right:.35rem}
sup a{text-decoration:none;font-size:.8rem}
.button{display:inline-block;background:var(--fg);color:var(--bg);padding:.6rem 1.2rem;border-radius:6px;text-decoration:none;font-weight:600}
footer{padding:2rem 1.25rem 3rem;font-size:.9rem;border-top:1px solid var(--line);margin-top:3rem}
@media (prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}`;

export const STYLE_SHA256 = createHash('sha256').update(CSS).digest('base64');

const youtubeWatch = (id: string, ms = 0) => `https://www.youtube.com/watch?v=${encodeURIComponent(id)}${ms >= 1000 ? `&t=${Math.floor(ms / 1000)}s` : ''}`;
export const youtubeThumb = (id: string, size: 'maxresdefault' | 'hqdefault' = 'maxresdefault') => `https://i.ytimg.com/vi/${encodeURIComponent(id)}/${size}.jpg`;

const p = (text: string, cls?: string) => `<p${cls ? ` class="${cls}"` : ''}>${esc(text)}</p>`;

export const articleJsonLd = (a: ArticleInput): object => {
	const graph: object[] = [];
	const thumbs = a.youtubeId ? [youtubeThumb(a.youtubeId), youtubeThumb(a.youtubeId, 'hqdefault')] : [];
	const article: Record<string, unknown> = {
		'@type': 'Article',
		'@id': `${a.url}#article`,
		headline: truncate(a.title, 110),
		description: a.summary,
		inLanguage: HREFLANG[a.lang],
		mainEntityOfPage: a.url,
		url: a.url,
		dateModified: a.modifiedAt,
		author: {'@type': 'Organization', name: a.brand, url: a.hubOrigin},
		publisher: {'@type': 'Organization', name: a.brand, url: a.hubOrigin},
		isAccessibleForFree: true,
		citation: a.sources.map((s) => ({'@type': 'CreativeWork', name: s.title, url: s.url})),
	};
	if (a.publishedAt) article.datePublished = a.publishedAt;
	if (thumbs.length) article.image = thumbs;
	graph.push(article);
	if (a.youtubeId && a.publishedAt) {
		article.video = {'@id': `${a.url}#video`};
		const video: Record<string, unknown> = {
			'@type': 'VideoObject',
			'@id': `${a.url}#video`,
			name: a.title,
			description: a.summary,
			thumbnailUrl: thumbs,
			uploadDate: a.publishedAt,
			embedUrl: `https://www.youtube.com/embed/${a.youtubeId}`,
			url: youtubeWatch(a.youtubeId),
			inLanguage: HREFLANG[a.lang],
			transcript: a.paragraphs.map((x) => x.text).join('\n\n'),
		};
		if (a.durationMs) video.duration = isoDuration(a.durationMs);
		graph.push(video);
	}
	return {'@context': 'https://schema.org', '@graph': graph};
};

export const renderArticle = (a: ArticleInput): {html: string; meta: ArticleMeta} => {
	const s = a.s;
	const sourceIndex = new Map(a.sources.map((src, i) => [src.id, i + 1]));
	const title = a.title.trim();
	const description = truncate(a.summary, 160);
	const ogImage = a.youtubeId ? youtubeThumb(a.youtubeId) : null;
	const head: string[] = [
		'<meta charset="utf-8">',
		'<meta name="viewport" content="width=device-width, initial-scale=1">',
		`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'sha256-${STYLE_SHA256}'; img-src https://i.ytimg.com; frame-src https://www.youtube-nocookie.com; base-uri 'none'; form-action 'none'">`,
		`<title>${esc(`${title} · ${a.showName}`)}</title>`,
		`<meta name="description" content="${esc(description)}">`,
		`<meta name="robots" content="${a.indexable ? 'index, follow, max-image-preview:large' : 'noindex, follow'}">`,
		'<meta name="referrer" content="strict-origin-when-cross-origin">',
		`<link rel="canonical" href="${esc(safeUrl(a.url, {httpsOnly: true}))}">`,
		...a.alternates.map((alt) => `<link rel="alternate" hreflang="${esc(alt.hreflang)}" href="${esc(safeUrl(alt.url, {httpsOnly: true}))}">`),
		...(a.alternates.length ? [`<link rel="alternate" hreflang="x-default" href="${esc((a.alternates.find((x) => x.lang === 'en') ?? a.alternates[0]).url)}">`] : []),
		...(a.feedUrl ? [`<link rel="alternate" type="application/atom+xml" title="${esc(a.siteName)}" href="${esc(safeUrl(a.feedUrl, {httpsOnly: true}))}">`] : []),
		'<meta property="og:type" content="article">',
		`<meta property="og:site_name" content="${esc(a.siteName)}">`,
		`<meta property="og:title" content="${esc(title)}">`,
		`<meta property="og:description" content="${esc(description)}">`,
		`<meta property="og:url" content="${esc(a.url)}">`,
		`<meta property="og:locale" content="${OG_LOCALE[a.lang]}">`,
		...a.alternates.filter((x) => x.lang !== a.lang).map((x) => `<meta property="og:locale:alternate" content="${OG_LOCALE[x.lang]}">`),
		...(ogImage ? [`<meta property="og:image" content="${esc(ogImage)}">`, `<meta property="og:image:alt" content="${esc(title)}">`] : []),
		...(a.youtubeId ? [`<meta property="og:video" content="${esc(`https://www.youtube.com/embed/${a.youtubeId}`)}">`] : []),
		...(a.publishedAt ? [`<meta property="article:published_time" content="${esc(a.publishedAt)}">`] : []),
		`<meta property="article:modified_time" content="${esc(a.modifiedAt)}">`,
		`<meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}">`,
		`<meta name="twitter:title" content="${esc(title)}">`,
		`<meta name="twitter:description" content="${esc(description)}">`,
		...(ogImage ? [`<meta name="twitter:image" content="${esc(ogImage)}">`] : []),
		`<style>${CSS}</style>`,
		`<script type="application/ld+json">${jsonLd(articleJsonLd(a))}</script>`,
	];

	const body: string[] = [];
	body.push(`<a class="skip" href="#main">${esc(s.skip)}</a>`);
	body.push(`<header><a href="${esc(safeUrl(a.indexUrl, {httpsOnly: true}))}">${esc(a.siteName)}</a></header>`);
	body.push('<main id="main">', '<article>');
	body.push(p(a.showName, 'kicker'), `<h1>${esc(title)}</h1>`);
	const meta: string[] = [];
	if (a.publishedAt) meta.push(`${esc(s.published)} <time datetime="${esc(a.publishedAt)}">${esc(displayDate(a.publishedAt, a.lang))}</time>`);
	if (a.durationMs) meta.push(`${esc(s.videoLength)}: ${esc(s.minutes.replace('{n}', String(Math.max(1, Math.round(a.durationMs / 60_000)))))}`);
	if (meta.length) body.push(`<p class="meta">${meta.join(' · ')}</p>`);

	if (a.developing) {
		const label = a.developing.label ?? s.developing;
		body.push(`<div class="notice" role="note"><p><strong>${esc(label)}</strong>${a.developing.asOf ? ` (${esc(s.asOf)} ${esc(a.developing.asOf)})` : ''}</p>${p(s.developingNote)}</div>`);
	}
	if (a.machineTranslation) body.push(`<div class="notice" role="note">${p(s.machineTranslation)}</div>`);
	if (a.fictionNote) body.push(`<div class="notice" role="note">${p(a.fictionNote)}</div>`);
	body.push(p(a.summary, 'summary'));

	if (a.youtubeId) {
		const embed = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(a.youtubeId)}`;
		body.push(
			`<figure class="video"><iframe src="${esc(embed)}" title="${esc(title)}" loading="lazy" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></figure>`,
			`<p><a href="${esc(youtubeWatch(a.youtubeId))}">${esc(s.watchOnYouTube)}</a></p>`,
		);
	} else {
		body.push(`<figure class="video"><div class="pending">${esc(s.videoPending)}</div></figure>`);
	}

	if (a.takeaways.length) {
		body.push(`<section aria-labelledby="takeaways"><h2 id="takeaways">${esc(s.takeaways)}</h2><ul>`);
		for (const t of a.takeaways) body.push(`<li>${esc(t)}</li>`);
		body.push('</ul></section>');
	}

	if (a.offers.length) {
		body.push(`<section aria-labelledby="links"><h2 id="links">${esc(s.links)}</h2>`);
		for (const o of a.offers) {
			body.push(
				`<div class="offer">${p(o.disclosure, 'disclosure')}<p><a href="${esc(safeUrl(o.url, {httpsOnly: true}))}" rel="sponsored noopener">${esc(o.name)}</a></p></div>`,
			);
		}
		body.push('</section>');
	}

	body.push(`<section class="transcript" aria-labelledby="transcript"><h2 id="transcript">${esc(s.transcript)}</h2>`);
	body.push(p(a.transcriptFromTimeline ? s.transcriptNote : `${s.transcriptNote} ${s.transcriptFromScript}`, 'note'));
	const chapterAt = new Map(a.chapters.map((c) => [c.sceneIds[0], c]));
	for (const para of a.paragraphs) {
		const ch = chapterAt.get(para.sceneId);
		if (ch && a.chapters.length >= 2) body.push(`<h3 id="ch-${esc(para.sceneId)}">${esc(ch.title)}</h3>`);
		const parts: string[] = [];
		if (para.startMs !== null) {
			const label = clock(para.startMs);
			parts.push(
				a.youtubeId
					? `<a class="ts" href="${esc(youtubeWatch(a.youtubeId, para.startMs))}" title="${esc(`${s.watchFrom} ${label}`)}">${esc(label)}</a>`
					: `<span class="ts">${esc(label)}</span>`,
			);
		}
		parts.push(esc(para.text));
		const refs = para.sourceIds.map((id) => sourceIndex.get(id)).filter((n): n is number => n !== undefined);
		if (refs.length) parts.push(refs.map((n) => `<sup><a href="#src-${n}" aria-label="${esc(`${s.sources} ${n}`)}">[${n}]</a></sup>`).join(''));
		body.push(`<p id="p-${esc(para.sceneId)}">${parts.join(' ')}</p>`);
	}
	body.push('</section>');

	if (a.corrections.length) {
		body.push(`<section aria-labelledby="corrections"><h2 id="corrections">${esc(s.corrections)}</h2><ul>`);
		for (const c of a.corrections) body.push(`<li><time datetime="${esc(c.date)}">${esc(c.date)}</time>: ${esc(c.text)}</li>`);
		body.push('</ul></section>');
	}

	if (a.sources.length) {
		body.push(`<section aria-labelledby="sources"><h2 id="sources">${esc(s.sources)}</h2><ol>`);
		a.sources.forEach((src, i) => {
			body.push(`<li id="src-${i + 1}"><a href="${esc(safeUrl(src.url))}" rel="noopener">${esc(src.title)}</a> (${esc(s.accessed)} <time datetime="${esc(src.accessed)}">${esc(src.accessed)}</time>)</li>`);
		});
		body.push('</ol></section>');
	}

	body.push(
		`<section aria-labelledby="subscribe"><h2 id="subscribe">${esc(s.subscribeTitle)}</h2>${p(s.subscribeText)}<p><a class="button" href="${esc(safeUrl(a.subscribeUrl, {httpsOnly: true}))}">${esc(s.subscribeButton)}</a></p></section>`,
	);

	const allDisclosures = [...new Set([...a.offers.map((o) => o.disclosure), ...a.disclosures])];
	if (allDisclosures.length) {
		body.push(`<section aria-labelledby="disclosures"><h2 id="disclosures">${esc(s.disclosures)}</h2>`);
		for (const d of allDisclosures) body.push(p(d));
		body.push('</section>');
	}
	body.push('</article>', '</main>');
	body.push(
		`<footer><p>${esc(s.notAdvice)}</p><p>© ${new Date(a.modifiedAt).getUTCFullYear()} ${esc(a.brand)} · <a href="${esc(`${a.hubOrigin}/disclosures`)}">${esc(s.howWeMakeMoney)}</a> · <a href="${esc(`${a.hubOrigin}/privacy`)}">${esc(s.privacy)}</a></p></footer>`,
	);

	const html = `<!doctype html>\n<html lang="${HREFLANG[a.lang]}">\n<head>\n${head.join('\n')}\n</head>\n<body>\n${body.join('\n')}\n</body>\n</html>\n`;
	const meta: ArticleMeta = {
		version: 1,
		channel: a.channel,
		slug: a.slug,
		lang: a.lang,
		hreflang: HREFLANG[a.lang],
		site: a.siteKey,
		url: a.url,
		title,
		summary: a.summary,
		datePublished: a.publishedAt,
		dateModified: a.modifiedAt,
		indexable: a.indexable,
		alternates: a.alternates,
		youtubeId: a.youtubeId,
		styleSha256: STYLE_SHA256,
	};
	return {html, meta};
};

/** Canonical URL of an episode article: <articleBase>/<channel>/<slug>/<lang>/ */
export const articleUrl = (articleBase: string, channel: string, slug: string, lang: Lang): string => `${articleBase.replace(/\/+$/, '')}/${channel}/${slug}/${lang}/`;
