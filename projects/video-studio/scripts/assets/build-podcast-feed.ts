/**
 * Self-hosted podcast feed for one show and language. Run from projects/video-studio:
 *
 *   node scripts/assets/build-podcast-feed.ts <channel> [--lang en] [--include-drafts] [--out out/assets]
 *
 * Reads out/assets/<channel>/<slug>/<lang>/podcast/item.json (status "ok"; "draft" too with --include-drafts) and
 * writes out/assets/_site/podcast/<channel>/<lang>/: feed.xml plus each episode's MP3, chapters.json and transcripts
 * under <slug>/, ready to upload to the folder that config podcast.shows.<lang>.mediaBase points at.
 * The feed is written only when the owner inputs it needs are set (feedUrl, mediaBase, imageUrl, ownerEmail).
 * Nothing is uploaded or submitted. Exit codes: 0 written, 1 missing owner inputs or no episodes, 2 usage.
 */
import {copyFileSync, existsSync, mkdirSync, readdirSync, rmSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {loadChannelConfig} from './lib/config.ts';
import {checkItemJson, type ItemJson} from './lib/podcast.ts';
import {buildPodcastFeed, feedProblems, type FeedItem} from './lib/rss.ts';
import {isRecord, readJson, writeFile} from './lib/util.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(HERE, '../..');

export const main = (argv: string[], print = console.log, printError = console.error): number => {
	let parsed;
	try {
		parsed = parseArgs({
			args: argv,
			allowPositionals: true,
			strict: true,
			options: {lang: {type: 'string'}, 'include-drafts': {type: 'boolean'}, out: {type: 'string'}, config: {type: 'string'}, now: {type: 'string'}},
		});
	} catch (err) {
		printError(`${(err as Error).message}\nUsage: node scripts/assets/build-podcast-feed.ts <channel> [--lang en] [--include-drafts]`);
		return 2;
	}
	const {values: v, positionals} = parsed;
	if (positionals.length !== 1) {
		printError('Usage: node scripts/assets/build-podcast-feed.ts <channel> [--lang en] [--include-drafts]');
		return 2;
	}
	const channel = positionals[0];
	const lang = v.lang ?? 'en';
	const outRoot = v.out ? resolve(process.cwd(), v.out) : join(PROJECT, 'out/assets');
	const cfg = loadChannelConfig(v.config ? resolve(process.cwd(), v.config) : join(HERE, 'config/channels.json'), channel);
	const show = cfg.podcast.shows[lang];
	if (!cfg.podcast.enabled || !show) {
		printError(`no podcast show configured for ${channel} [${lang}] (config/channels.json podcast.shows.${lang})`);
		return 1;
	}
	const now = (v.now ? new Date(v.now) : new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z');
	const cdir = join(outRoot, channel);
	const items: {item: ItemJson; dir: string}[] = [];
	const skipped: string[] = [];
	const invalid: string[] = [];
	for (const slug of existsSync(cdir) ? readdirSync(cdir).sort() : []) {
		const langDirs = existsSync(join(cdir, slug)) ? readdirSync(join(cdir, slug)) : [];
		for (const l of langDirs) {
			const file = join(cdir, slug, l, 'podcast', 'item.json');
			if (!existsSync(file)) continue;
			const raw = readJson(file, 'podcast item');
			if (!isRecord(raw) || raw.version !== 1) continue;
			// item.json is read back from disk, so every field is checked before it reaches the feed or a file copy
			const checked = checkItemJson(raw, {channel, slug});
			if (!checked.ok) {
				invalid.push(`${file}: ${checked.problems.join('; ')}`);
				continue;
			}
			const item = checked.item;
			if (item.lang !== lang && l !== lang) continue;
			const okStatus = item.status === 'ok' || (v['include-drafts'] && item.status === 'draft');
			if (!okStatus) {
				skipped.push(`${slug}: status ${item.status}`);
				continue;
			}
			if (!item.pubDate && !v['include-drafts']) {
				skipped.push(`${slug}: no publish date`);
				continue;
			}
			items.push({item, dir: dirname(file)});
		}
	}
	const media = show.mediaBase ? show.mediaBase.replace(/\/+$/, '') : null;
	const feedItems: FeedItem[] = items.map(({item}) => {
		const at = (f: string) => `${media ?? 'https://media.invalid'}/${item.slug}/${f}`;
		return {
			guid: item.guid,
			title: item.title,
			link: item.link,
			descriptionHtml: item.descriptionHtml,
			pubDate: item.pubDate ?? now,
			durationSec: item.durationSec,
			explicit: item.explicit,
			episodeType: item.episodeType,
			season: item.season,
			episode: item.episode,
			enclosure: {url: at(item.files.mp3.path), bytes: item.files.mp3.bytes, type: item.files.mp3.type},
			chaptersUrl: at(item.files.chapters),
			transcripts: [
				{url: at(item.files.vtt), type: 'text/vtt', language: item.lang},
				{url: at(item.files.srt), type: 'application/x-subrip', language: item.lang},
			],
			chapters: item.chapters.map((c) => ({startMs: c.startMs, title: c.title, href: c.href})),
			imageUrl: item.files.cover ? at(item.files.cover) : null,
		};
	});
	if (invalid.length) {
		for (const i of invalid) printError(`  error: invalid podcast item ${i}`);
		printError(`Feed for ${show.title} [${lang}] not written: ${invalid.length} item.json file(s) are invalid. Regenerate them with scripts/assets/make.ts; never edit them by hand.`);
		return 1;
	}
	const problems = feedProblems(show, feedItems);
	for (const s of skipped) print(`  skipped ${s}`);
	for (const p of problems) (p.level === 'error' ? printError : print)(`  ${p.level}: ${p.message}`);
	if (problems.some((p) => p.level === 'error')) {
		printError(`Feed for ${show.title} [${lang}] not written: set the owner inputs above in scripts/assets/config/channels.json.`);
		return 1;
	}
	const root = join(outRoot, '_site', 'podcast', channel, lang);
	rmSync(root, {recursive: true, force: true});
	for (const {item, dir} of items) {
		const dest = join(root, item.slug);
		mkdirSync(dest, {recursive: true});
		for (const f of [item.files.mp3.path, item.files.m4a.path, item.files.chapters, item.files.vtt, item.files.srt, ...(item.files.cover ? [item.files.cover] : [])]) copyFileSync(join(dir, f), join(dest, f));
	}
	writeFile(join(root, 'feed.xml'), buildPodcastFeed(show, lang, feedItems, now));
	print(`Feed for ${show.title} [${lang}]: ${feedItems.length} episode(s) → ${join(root, 'feed.xml')}`);
	print(`Upload ${root}/ to ${show.mediaBase} and serve feed.xml at ${show.feedUrl}. Nothing was uploaded or submitted.`);
	return 0;
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	process.exitCode = main(process.argv.slice(2));
}
