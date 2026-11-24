/**
 * Storyboard loading for the Thumbnail still (browser side, webpack bundle). Same sources as the episode loader:
 *  - content/<channel>/<slug>/storyboard.json (en, the master design) and storyboard.<lang>.json (translations);
 *  - channel "_dev": the thumbnail fixtures in src/thumbnails/dev/fixtures/<slug>/ (temporary, until a real episode
 *    exists).
 * Both require.context calls stay literal so webpack resolves them at bundle time; every render re-bundles, so new
 * storyboards are picked up.
 */
import type {Lang, Storyboard} from '../episode/types';
import {resolveThumb, type ResolvedThumb, type ThumbInput} from './spec';

type WebpackContext = {keys(): string[]; (id: string): unknown};
type WebpackRequire = {context(dir: string, deep: boolean, re: RegExp): WebpackContext};

const CONTENT = (require as unknown as WebpackRequire).context('../../content', true, /^\.\/[^/]+\/[^/]+\/storyboard(\.[a-z]{2}(-[a-z]{2})?)?\.json$/);
const DEV = (require as unknown as WebpackRequire).context('./dev/fixtures', true, /^\.\/[^/]+\/storyboard(\.[a-z]{2}(-[a-z]{2})?)?\.json$/);

export const DEV_CHANNEL = '_dev';

const fileFor = (lang: Lang) => (lang === 'en' ? 'storyboard.json' : `storyboard.${lang}.json`);
export const storyboardPath = (channel: string, slug: string, lang: Lang) =>
	channel === DEV_CHANNEL ? `src/thumbnails/dev/fixtures/${slug}/${fileFor(lang)}` : `content/${channel}/${slug}/${fileFor(lang)}`;

const find = (channel: string, slug: string, lang: Lang): Storyboard | null => {
	const ctx = channel === DEV_CHANNEL ? DEV : CONTENT;
	const key = channel === DEV_CHANNEL ? `./${slug}/${fileFor(lang)}` : `./${channel}/${slug}/${fileFor(lang)}`;
	return ctx.keys().includes(key) ? (ctx(key) as Storyboard) : null;
};

export const loadThumb = (input: ThumbInput): ResolvedThumb => {
	const {channel, slug, lang} = input;
	if (typeof channel !== 'string' || !/^[a-z0-9_][a-z0-9_-]*$/.test(channel)) throw new Error(`Thumbnail: bad channel ${JSON.stringify(channel)}`);
	// the episode engine's slug rule (src/episode/validate.ts SLUG): a leading underscore is allowed (e.g. "_engine-demo")
	if (typeof slug !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9_-]{0,80}$/.test(slug)) throw new Error(`Thumbnail: bad slug ${JSON.stringify(slug)}`);
	const master = find(channel, slug, 'en');
	if (!master) throw new Error(`Thumbnail: no storyboard at ${storyboardPath(channel, slug, 'en')}`);
	const localized = lang === 'en' ? null : find(channel, slug, lang);
	return resolveThumb(input, master, localized);
};
