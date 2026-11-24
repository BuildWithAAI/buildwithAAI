/**
 * One episode → 6+ assets. Run from projects/video-studio:
 *
 *   node scripts/assets/make.ts <channel>/<slug> [--lang en,es,pt-br] [options]
 *
 * Writes out/assets/<channel>/<slug>/<lang>/: article/, podcast/, social/, newsletter/ and manifest.json.
 * Nothing is published or sent. Exit codes: 0 every asset ok/draft/skipped/pending, 1 an asset is blocked or failed,
 * 2 usage or input error. docs/ASSETS.md has the full reference.
 */
import {existsSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {ASSET_IDS, buildLanguage, worst, type AssetGroup} from './lib/build.ts';
import {defaultRoots, episodeLanguages, LANGS, parseEpisodeRef} from './lib/episode.ts';
import type {AssetStatus, Lang} from './lib/types.ts';
import {InputError} from './lib/util.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROJECT = resolve(HERE, '../..');

export const USAGE = `Usage: node scripts/assets/make.ts <channel>/<slug> [options]

  --lang <list>            languages, e.g. en,es,pt-br (default: every language with a storyboard)
  --only <list>            subset of: ${ASSET_IDS.join(',')} (default: all)
  --site <name>            article site from config/channels.json: hub (go.zoora.ai/articles) or pages (zoora.ai/articles)
  --youtube-id <id>        the uploaded video's id (else kit.json or assets.json)
  --published <date>       publish date, YYYY-MM-DD or ISO timestamp (else assets.json publishedAt)
  --kit <file>             publish kit (default: out/publish/<channel>/<slug>/kit.json); one language only
  --offers <file>          offer registry (default: ../creator-hub/config/offers.json when it exists)
  --names <file>           private names list for the lint (default: data/private/names.txt when it exists)
  --badger-cues <file>     Badger sound cues (default: public/generated/<channel>/<slug>/<lang>/badger-cues.json)
  --cover <file>           podcast show art, square JPEG/PNG 1400-3000 px (default: config podcast.coverFile)
  --podcast-min-sec <n>    shortest episode that becomes a podcast episode (default: config, 180)
  --out <dir>              output root (default: out/assets)
  --config <file>          channel config (default: scripts/assets/config/channels.json)
  --content-root <dir>, --generated-root <dir>, --publish-root <dir>, --hub-root <dir>   input locations
  --now <iso>              fixed build time (reproducible output)`;

type Print = (line: string) => void;

export const main = (argv: string[], print: Print = console.log, printError: Print = console.error): number => {
	let parsed;
	try {
		parsed = parseArgs({
			args: argv,
			allowPositionals: true,
			strict: true,
			options: {
				lang: {type: 'string'},
				only: {type: 'string'},
				site: {type: 'string'},
				'youtube-id': {type: 'string'},
				published: {type: 'string'},
				kit: {type: 'string'},
				offers: {type: 'string'},
				names: {type: 'string'},
				'badger-cues': {type: 'string'},
				cover: {type: 'string'},
				'podcast-min-sec': {type: 'string'},
				out: {type: 'string'},
				config: {type: 'string'},
				'content-root': {type: 'string'},
				'generated-root': {type: 'string'},
				'publish-root': {type: 'string'},
				'hub-root': {type: 'string'},
				now: {type: 'string'},
				help: {type: 'boolean', short: 'h'},
			},
		});
	} catch (err) {
		printError(`${(err as Error).message}\n\n${USAGE}`);
		return 2;
	}
	const {values: v, positionals} = parsed;
	if (v.help) {
		print(USAGE);
		return 0;
	}
	try {
		if (positionals.length !== 1) throw new InputError('give exactly one <channel>/<slug>');
		const {channel, slug} = parseEpisodeRef(positionals[0]);
		const at = (p: string) => resolve(process.cwd(), p);
		const roots = defaultRoots(PROJECT);
		if (v['content-root']) roots.content = at(v['content-root']);
		if (v['generated-root']) roots.generated = at(v['generated-root']);
		if (v['publish-root']) roots.publish = at(v['publish-root']);
		const langs: Lang[] = v.lang ? (v.lang.split(',').map((x) => x.trim().toLowerCase()) as Lang[]) : episodeLanguages(roots, channel, slug);
		const badLang = langs.find((l) => !LANGS.includes(l));
		if (badLang) throw new InputError(`unknown language "${badLang}"; supported: ${LANGS.join(', ')}`);
		if (!langs.length) throw new InputError(`no storyboard found for ${channel}/${slug}`);
		if (v.kit && langs.length !== 1) throw new InputError('--kit works with exactly one --lang');
		const only = v.only ? (v.only.split(',').map((x) => x.trim()) as AssetGroup[]) : undefined;
		const badOnly = only?.find((x) => !ASSET_IDS.includes(x));
		if (badOnly) throw new InputError(`--only: unknown asset "${badOnly}"; use ${ASSET_IDS.join(', ')}`);
		const minSec = v['podcast-min-sec'] !== undefined ? Number(v['podcast-min-sec']) : null;
		if (minSec !== null && !(minSec >= 0)) throw new InputError('--podcast-min-sec must be a number >= 0');
		const now = v.now ? new Date(v.now) : undefined;
		if (now && Number.isNaN(now.getTime())) throw new InputError('--now must be an ISO timestamp');
		const defaultOffers = resolve(PROJECT, '../creator-hub/config/offers.json');
		const defaultNames = resolve(PROJECT, 'data/private/names.txt');

		const statuses: AssetStatus[] = [];
		for (const lang of langs) {
			const r = buildLanguage({
				roots,
				channel,
				slug,
				lang,
				outRoot: v.out ? at(v.out) : join(PROJECT, 'out/assets'),
				configPath: v.config ? at(v.config) : join(HERE, 'config/channels.json'),
				hubRoot: v['hub-root'] ? at(v['hub-root']) : resolve(PROJECT, '../creator-hub'),
				site: v.site,
				youtubeId: v['youtube-id'] ?? null,
				published: v.published ?? null,
				kitPath: v.kit ? at(v.kit) : null,
				offersPath: v.offers ? at(v.offers) : existsSync(defaultOffers) ? defaultOffers : null,
				namesPath: v.names ? at(v.names) : existsSync(defaultNames) ? defaultNames : null,
				badgerCuesPath: v['badger-cues'] ? at(v['badger-cues']) : null,
				coverPath: v.cover ? at(v.cover) : null,
				podcastMinSec: minSec,
				only,
				now,
			});
			const m = r.manifest;
			statuses.push(m.status);
			print(`${channel}/${slug} [${lang}] → ${m.status.toUpperCase()}  (${r.dir})`);
			for (const a of m.assets) {
				print(`  ${a.id.padEnd(10)} ${a.status.padEnd(8)} ${a.summary}`);
				for (const c of a.checks.filter((x) => !x.ok && x.level !== 'info')) print(`    ${c.level}: ${c.id}: ${c.detail}`);
			}
			for (const action of m.ownerActions) print(`  owner: ${action}`);
		}
		const overall = worst(statuses);
		print(overall === 'blocked' || overall === 'error' ? 'Some assets are blocked: fix the errors above and re-run. Nothing was published.' : 'Done. Nothing was published or sent: review the files, then publish by hand.');
		return overall === 'blocked' || overall === 'error' ? 1 : 0;
	} catch (err) {
		if (err instanceof InputError || (err instanceof Error && /must be|unknown --site|no storyboard/.test(err.message))) {
			printError(`error: ${err.message}`);
			return 2;
		}
		throw err;
	}
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	process.exitCode = main(process.argv.slice(2));
}
