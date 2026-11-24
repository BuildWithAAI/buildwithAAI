/**
 * Site-wide generators for the article folder: sitemap.xml (with hreflang alternates), feed.xml (Atom 1.0), a plain
 * index page, and one index page per channel (<articleBase>/<channel>/: the podcast feeds' <link> points there).
 * Inputs are the meta.json files the article step writes. Only indexable articles are listed.
 */
import {createHash} from 'node:crypto';
import {esc, safeUrl, xml} from './html.ts';
import type {ArticleMeta} from './article.ts';

export type SiteInfo = {siteName: string; articleBase: string; brand: string; hubOrigin: string; generatedAt: string};

const byNewest = (a: ArticleMeta, b: ArticleMeta) => (b.datePublished ?? b.dateModified).localeCompare(a.datePublished ?? a.dateModified) || a.url.localeCompare(b.url);

/** The index pages to list in the sitemap: the site's and each channel's that has an indexable article. */
export const indexUrls = (articles: ArticleMeta[], articleBase: string): string[] => {
	const base = articleBase.replace(/\/+$/, '');
	const channels = [...new Set(articles.filter((a) => a.indexable).map((a) => a.channel))].sort();
	return channels.length ? [`${base}/`, ...channels.map((c) => channelIndexUrl(base, c))] : [];
};

export const channelIndexUrl = (articleBase: string, channel: string): string => `${articleBase.replace(/\/+$/, '')}/${channel}/`;

export const buildSitemap = (articles: ArticleMeta[], pages: string[] = []): string => {
	const listed = articles.filter((a) => a.indexable).sort((a, b) => a.url.localeCompare(b.url));
	const indexEntries = pages.map((u) => ['  <url>', `    <loc>${xml(safeUrl(u, {httpsOnly: true}))}</loc>`, '  </url>'].join('\n'));
	const urls = [...indexEntries, ...listed.map((a) => {
		const alts = a.alternates.length > 1 ? a.alternates : [];
		const links = alts.map((alt) => `    <xhtml:link rel="alternate" hreflang="${xml(alt.hreflang)}" href="${xml(safeUrl(alt.url, {httpsOnly: true}))}"/>`);
		if (alts.length) links.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${xml((alts.find((x) => x.lang === 'en') ?? alts[0]).url)}"/>`);
		return ['  <url>', `    <loc>${xml(safeUrl(a.url, {httpsOnly: true}))}</loc>`, `    <lastmod>${xml(a.dateModified)}</lastmod>`, ...links, '  </url>'].join('\n');
	})];
	return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}${urls.length ? '\n' : ''}</urlset>\n`;
};

/** A stable tag: URI for the feed and entry ids (RFC 4151), so ids survive a move to another host. */
const tagUri = (url: string, date: string): string => {
	const u = new URL(url);
	return `tag:${u.hostname},${date.slice(0, 10)}:${u.pathname}`;
};

export const buildAtomFeed = (articles: ArticleMeta[], site: SiteInfo, limit = 50): string => {
	const listed = articles.filter((a) => a.indexable).sort(byNewest).slice(0, limit);
	const feedUrl = `${site.articleBase}/feed.xml`;
	const updated = listed.length ? listed.map((a) => a.dateModified).sort().reverse()[0] : site.generatedAt;
	const entries = listed.map((a) =>
		[
			`  <entry xml:lang="${xml(a.hreflang)}">`,
			`    <id>${xml(tagUri(a.url, a.datePublished ?? a.dateModified))}</id>`,
			`    <title>${xml(a.title)}</title>`,
			`    <link rel="alternate" type="text/html" href="${xml(a.url)}"/>`,
			...(a.datePublished ? [`    <published>${xml(a.datePublished)}</published>`] : []),
			`    <updated>${xml(a.dateModified)}</updated>`,
			`    <summary>${xml(a.summary)}</summary>`,
			'  </entry>',
		].join('\n'),
	);
	const feedId = `tag:${new URL(site.articleBase).hostname},2026-11-24:${new URL(site.articleBase).pathname.replace(/\/?$/, '/')}`;
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<feed xmlns="http://www.w3.org/2005/Atom">',
		`  <id>${xml(feedId)}</id>`,
		`  <title>${xml(site.siteName)}</title>`,
		`  <link rel="self" type="application/atom+xml" href="${xml(feedUrl)}"/>`,
		`  <link rel="alternate" type="text/html" href="${xml(`${site.articleBase}/`)}"/>`,
		`  <updated>${xml(updated)}</updated>`,
		`  <author><name>${xml(site.brand)}</name><uri>${xml(site.hubOrigin)}</uri></author>`,
		...entries,
		'</feed>',
		'',
	].join('\n');
};

const INDEX_CSS = `body{margin:0;font:1.0625rem/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#F4F6F8;color:#161A21}main{max-width:44rem;margin:0 auto;padding:1.5rem 1.25rem}a{color:#0E6F68}li{margin:.5rem 0}.muted{color:#4A5260}@media (prefers-color-scheme:dark){body{background:#0B0C0F;color:#F4F6F8}a{color:#29B8AD}.muted{color:#C9CED6}}`;

/** The site's index page, or with `channel` one channel's (its own canonical URL and title). */
export const buildIndexPage = (articles: ArticleMeta[], site: SiteInfo, channel?: {id: string; name: string}): string => {
	const listed = articles.filter((a) => a.indexable && (!channel || a.channel === channel.id)).sort(byNewest);
	const heading = channel ? `${channel.name}: episodes` : `${site.siteName}: episodes`;
	const canonical = channel ? channelIndexUrl(site.articleBase, channel.id) : `${site.articleBase}/`;
	const style = createHash('sha256').update(INDEX_CSS).digest('base64');
	const items = listed.map(
		(a) => `<li lang="${esc(a.hreflang)}"><a href="${esc(a.url)}">${esc(a.title)}</a><br><span class="muted">${esc((a.datePublished ?? a.dateModified).slice(0, 10))}</span></li>`,
	);
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'sha256-${style}'; base-uri 'none'; form-action 'none'">
<title>${esc(heading)}</title>
<link rel="canonical" href="${esc(canonical)}">
<link rel="alternate" type="application/atom+xml" title="${esc(site.siteName)}" href="${esc(`${site.articleBase}/feed.xml`)}">
<style>${INDEX_CSS}</style>
</head>
<body>
<main>
<h1>${esc(heading)}</h1>
${channel ? `<p class="muted"><a href="${esc(`${site.articleBase}/`)}">${esc(site.siteName)}: all episodes</a></p>` : ''}
${items.length ? `<ul>\n${items.join('\n')}\n</ul>` : '<p class="muted">No published episodes yet.</p>'}
</main>
</body>
</html>
`;
};
