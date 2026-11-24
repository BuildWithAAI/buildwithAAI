/**
 * Collects the generated articles into one static folder for hosting, with sitemap.xml, feed.xml (Atom) and an
 * index page. Run from projects/video-studio:
 *
 *   node scripts/assets/build-site.ts [--site hub|pages] [--include-drafts] [--out out/assets]
 *
 * Writes out/assets/_site/<site>/articles/... Only articles whose manifest status is "ok" are included ("draft" too
 * with --include-drafts, for a private preview; drafts are noindex). Blocked articles are never included.
 * Hosting options: docs/ASSETS.md, "Hosting the articles". Nothing is uploaded.
 */
import {copyFileSync, existsSync, mkdirSync, readdirSync, rmSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import type {ArticleMeta} from './lib/article.ts';
import {loadChannelConfig} from './lib/config.ts';
import {buildAtomFeed, buildIndexPage, buildSitemap} from './lib/site.ts';
import {isRecord, readJson, writeFile} from './lib/util.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(HERE, '../..');

type Found = {meta: ArticleMeta & {status?: string}; html: string};

export const collectArticles = (outRoot: string, site: string, includeDrafts: boolean): {found: Found[]; skipped: string[]} => {
	const found: Found[] = [];
	const skipped: string[] = [];
	if (!existsSync(outRoot)) return {found, skipped};
	for (const channel of readdirSync(outRoot).filter((d) => !d.startsWith('_')).sort()) {
		const cdir = join(outRoot, channel);
		for (const slug of readdirSync(cdir).sort()) {
			const sdir = join(cdir, slug);
			for (const lang of existsSync(sdir) ? readdirSync(sdir).sort() : []) {
				const metaPath = join(sdir, lang, 'article', 'meta.json');
				const html = join(sdir, lang, 'article', 'index.html');
				if (!existsSync(metaPath) || !existsSync(html)) continue;
				const meta = readJson(metaPath, 'article meta');
				if (!isRecord(meta) || meta.version !== 1) continue;
				const m = meta as unknown as Found['meta'];
				if (m.site !== site) {
					skipped.push(`${channel}/${slug}/${lang}: built for site "${m.site}"`);
					continue;
				}
				if (m.status !== 'ok' && !(includeDrafts && m.status === 'draft')) {
					skipped.push(`${channel}/${slug}/${lang}: status ${m.status ?? 'unknown'}`);
					continue;
				}
				found.push({meta: m, html});
			}
		}
	}
	return {found, skipped};
};

export const main = (argv: string[], print = console.log, printError = console.error): number => {
	let v;
	try {
		v = parseArgs({args: argv, strict: true, options: {site: {type: 'string'}, 'include-drafts': {type: 'boolean'}, out: {type: 'string'}, config: {type: 'string'}, now: {type: 'string'}}}).values;
	} catch (err) {
		printError(`${(err as Error).message}\nUsage: node scripts/assets/build-site.ts [--site hub|pages] [--include-drafts] [--out out/assets]`);
		return 2;
	}
	const outRoot = v.out ? resolve(process.cwd(), v.out) : join(PROJECT, 'out/assets');
	const cfg = loadChannelConfig(v.config ? resolve(process.cwd(), v.config) : join(HERE, 'config/channels.json'), '__site__');
	const siteKey = v.site ?? cfg.defaultSite;
	const site = cfg.sites[siteKey];
	if (!site) {
		printError(`unknown site "${siteKey}"; config has: ${Object.keys(cfg.sites).join(', ')}`);
		return 2;
	}
	const {found, skipped} = collectArticles(outRoot, siteKey, !!v['include-drafts']);
	const root = join(outRoot, '_site', siteKey);
	const articlesDir = join(root, 'articles');
	rmSync(root, {recursive: true, force: true});
	mkdirSync(articlesDir, {recursive: true});
	const base = new URL(`${site.articleBase}/`);
	for (const f of found) {
		const rel = new URL(f.meta.url).pathname.slice(base.pathname.length);
		const dest = join(articlesDir, rel, 'index.html');
		mkdirSync(dirname(dest), {recursive: true});
		copyFileSync(f.html, dest);
	}
	const metas = found.map((f) => f.meta);
	const urls = new Set(metas.filter((m) => m.indexable).map((m) => m.url));
	const warnings: string[] = [];
	for (const m of metas.filter((x) => x.indexable)) {
		for (const alt of m.alternates) if (!urls.has(alt.url)) warnings.push(`${m.url}: hreflang ${alt.hreflang} points to ${alt.url}, which is not in this build`);
	}
	const info = {siteName: site.siteName, articleBase: site.articleBase, brand: cfg.brand, hubOrigin: cfg.hubOrigin, generatedAt: (v.now ? new Date(v.now) : new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z')};
	writeFile(join(articlesDir, 'sitemap.xml'), buildSitemap(metas));
	writeFile(join(articlesDir, 'feed.xml'), buildAtomFeed(metas, info));
	writeFile(join(articlesDir, 'index.html'), buildIndexPage(metas, info));
	print(`Site "${siteKey}" (${site.articleBase}/): ${found.length} article(s), ${metas.filter((m) => m.indexable).length} indexable → ${articlesDir}`);
	for (const s of skipped) print(`  skipped ${s}`);
	for (const w of warnings) print(`  warning: ${w}`);
	print('Nothing was uploaded. See docs/ASSETS.md, "Hosting the articles".');
	return 0;
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	process.exitCode = main(process.argv.slice(2));
}
