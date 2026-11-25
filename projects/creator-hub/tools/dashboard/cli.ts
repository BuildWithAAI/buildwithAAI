/**
 * Revenue dashboard CLI (run from projects/creator-hub; relative paths resolve from where you ran npm).
 *
 *   npm run dashboard -- [options]
 *
 * Writes out/dashboard/metrics.csv, index.html and state.json, and recommendations.md every 10 videos
 * with YouTube data (or with --force). Exit codes: 0 ok, 1 input problems (nothing written), 2 usage.
 */
import {existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {isAbsolute, join, relative, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {checkRegistry, isRestricted} from '../../src/server/offers.ts';
import {readCatalog, readKits} from './catalog.ts';
import {parseDate} from './csv.ts';
import {ALL_TIME, DAY_MS, readHubCsv, readHubDb, type TimeRange} from './hub-clicks.ts';
import {mergeInputs} from './merge.ts';
import {renderMetricsCsv} from './metrics-csv.ts';
import type {ApiVideo, CatalogEntry, HubClicks, Issue, KitInfo, PayoutRow, StudioVideo} from './model.ts';
import {checkPayoutConfig, readPayoutCsv, type PayoutConfig} from './payouts.ts';
import {buildReport, milestoneDue, nextMilestone, parseState, renderRecommendations, type MilestoneState} from './recommend.ts';
import {renderDashboard} from './render-html.ts';
import {readStudioCsv} from './studio-csv.ts';
import {fetchVideoReport, resolveAccessToken, YouTubeApiError} from './youtube-api.ts';

const PROJECT_DIR = fileURLToPath(new URL('../../', import.meta.url));
export const DEFAULT_BRAND = 'Zoora AI';
export const DEFAULT_CHANNEL = 'zoora-ai';
/** Channels with a name of their own, used when neither --brand nor BRAND_NAME is given. Others get DEFAULT_BRAND. */
const CHANNEL_BRANDS: ReadonlyMap<string, string> = new Map([['zoora-security', 'Zoodger News']]);
const API_DEFAULT_FROM = '2020-01-01';

export const USAGE = `Usage: npm run dashboard -- [options]

Inputs (all optional; the dashboard uses whatever it gets):
  --studio <file>            YouTube Studio export "Table data.csv" (repeat for more files)
                             default: every .csv in <data>/youtube/
  --api                      also read the YouTube Analytics API v2 (needs YT_ANALYTICS_* variables)
  --api-revenue              also ask the API for estimated revenue (needs the monetary scope)
  --hub-db <file>            hub database, opened read-only (default: <data>/hub.sqlite if present)
  --hub-csv <file>           an admin export instead: video-clicks.csv or clicks.csv
  --payouts <id>=<file>      payout CSV for programme <id> (repeat)
                             default: <data>/payouts/<id>/*.csv for each programme in the config
  --payouts-config <file>    programme column mappings (default: config/payouts.json)
  --offers <file>            the hub's offer registry, for its region rules (default: config/offers.json)
  --catalog <file>           videos.csv with format, tags and aliases (default: <data>/videos.csv)
  --kits <dir>               publish kits (default: ../video-studio/out/publish/<channel>)
  --from <YYYY-MM-DD>        start date for the API, hub clicks and payouts
  --to <YYYY-MM-DD>          end date (inclusive)

Output:
  --channel <slug>           the channel of this run (default: ${DEFAULT_CHANNEL})
  --brand <name>             brand name on the page (default: BRAND_NAME, else the channel's name:
                             "${CHANNEL_BRANDS.get('zoora-security')}" for zoora-security, "${DEFAULT_BRAND}" for any other channel)
  --out <dir>                output folder (default: out/dashboard)
  --force                    write recommendations.md now instead of at the next 10 videos

<data> is DATA_DIR (default: projects/creator-hub/data).`;

export type CliDeps = {
	env: Record<string, string | undefined>;
	cwd: string;
	fetch: typeof fetch;
	now: () => Date;
	print: (line: string) => void;
	printError: (line: string) => void;
};

/** Relative to cwd when the file is inside it, otherwise absolute. */
const displayPath = (cwd: string, path: string): string => {
	const rel = relative(cwd, path);
	return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : path;
};

const csvFiles = (dir: string): string[] =>
	existsSync(dir)
		? readdirSync(dir, {withFileTypes: true})
				.filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.csv'))
				.map((e) => join(dir, e.name))
				.sort()
		: [];

const formatIssue = (issue: Issue): string => `  ${issue.level}: ${issue.where}: ${issue.message}`;

/** Writes through a temporary file so a crash never leaves half a file. */
const writeAtomic = (file: string, content: string): void => {
	const temp = `${file}.tmp`;
	writeFileSync(temp, content);
	renameSync(temp, file);
};

export const main = async (argv: string[], overrides: Partial<CliDeps> = {}): Promise<number> => {
	const deps: CliDeps = {
		env: process.env,
		cwd: process.env.INIT_CWD ?? process.cwd(), // npm sets INIT_CWD to the directory npm was run from
		fetch: globalThis.fetch,
		now: () => new Date(),
		print: (line) => console.log(line),
		printError: (line) => console.error(line),
		...overrides,
	};
	const usageError = (message: string): number => {
		deps.printError(`${message}\n\n${USAGE}`);
		return 2;
	};
	if (argv[0] === 'help' || argv.includes('--help') || argv.includes('-h')) {
		deps.print(USAGE);
		return 0;
	}
	let values;
	try {
		({values} = parseArgs({
			args: argv,
			strict: true,
			allowPositionals: false,
			options: {
				studio: {type: 'string', multiple: true},
				api: {type: 'boolean'},
				'api-revenue': {type: 'boolean'},
				'hub-db': {type: 'string'},
				'hub-csv': {type: 'string'},
				payouts: {type: 'string', multiple: true},
				'payouts-config': {type: 'string'},
				offers: {type: 'string'},
				catalog: {type: 'string'},
				kits: {type: 'string'},
				from: {type: 'string'},
				to: {type: 'string'},
				channel: {type: 'string'},
				brand: {type: 'string'},
				out: {type: 'string'},
				force: {type: 'boolean'},
			},
		}));
	} catch (err) {
		return usageError((err as Error).message);
	}

	const today = deps.now().toISOString().slice(0, 10);
	const from = values.from === undefined ? null : parseDate(values.from, 'YYYY-MM-DD');
	const to = values.to === undefined ? null : parseDate(values.to, 'YYYY-MM-DD');
	if (values.from !== undefined && (!from || !/^\d{4}-\d{2}-\d{2}$/.test(values.from))) return usageError('--from must be a date like 2026-11-01.');
	if (values.to !== undefined && (!to || !/^\d{4}-\d{2}-\d{2}$/.test(values.to))) return usageError('--to must be a date like 2026-11-30.');
	if (from && to && from > to) return usageError('--from must not be after --to.');
	const channel = values.channel ?? DEFAULT_CHANNEL;
	if (!/^[a-z0-9-]{2,40}$/.test(channel)) return usageError('--channel must be a slug such as zoora-ai (2-40 characters: a-z, 0-9, "-").');
	const brandName = (values.brand ?? deps.env.BRAND_NAME ?? CHANNEL_BRANDS.get(channel) ?? DEFAULT_BRAND).trim();
	if (!brandName || brandName.length > 60) return usageError('--brand must be 1-60 characters.');
	if (values['hub-db'] && values['hub-csv']) return usageError('Use --hub-db or --hub-csv, not both.');
	if (values['api-revenue'] && !values.api) return usageError('--api-revenue needs --api.');

	const at = (path: string): string => resolve(deps.cwd, path);
	const show = (path: string): string => displayPath(deps.cwd, path);
	const dataDir = deps.env.DATA_DIR ? at(deps.env.DATA_DIR) : resolve(PROJECT_DIR, 'data');
	const range: TimeRange = from || to ? {start: from ? Date.parse(`${from}T00:00:00Z`) : 0, end: to ? Date.parse(`${to}T00:00:00Z`) + DAY_MS : ALL_TIME.end} : ALL_TIME;

	const issues: Issue[] = [];
	const inputs: string[] = [];
	/** "/abs/path/file.csv:12" -> "data/file.csv:12"; other labels stay as they are. */
	const where = (label: string): string => {
		const match = /^(.*?)(:\d+)?$/.exec(label);
		return match && isAbsolute(match[1]!) ? show(match[1]!) + (match[2] ?? '') : label;
	};
	const add = (found: Issue[]): void => void issues.push(...found.map((i) => ({...i, where: where(i.where)})));

	// YouTube Studio exports.
	const studioFiles = values.studio ? values.studio.map(at) : csvFiles(join(dataDir, 'youtube'));
	const studio: StudioVideo[][] = [];
	for (const file of studioFiles) {
		const report = readStudioCsv(file);
		add(report.issues);
		studio.push(report.videos);
		inputs.push(`YouTube Studio export ${show(file)}: ${report.videos.length} video(s)`);
	}

	// Videos catalog and publish kits.
	let catalog: CatalogEntry[] | null = null;
	const catalogFile = values.catalog ? at(values.catalog) : join(dataDir, 'videos.csv');
	if (values.catalog || existsSync(catalogFile)) {
		const read = readCatalog(catalogFile);
		add(read.issues);
		catalog = read.entries;
		inputs.push(`videos.csv ${show(catalogFile)}: ${read.entries.length} video(s)`);
	}
	const kitsDir = values.kits ? at(values.kits) : resolve(PROJECT_DIR, '../video-studio/out/publish', channel);
	let kits: KitInfo[] = [];
	if (values.kits && !existsSync(kitsDir)) add([{level: 'error', where: kitsDir, message: 'kits folder not found'}]);
	else if (existsSync(kitsDir)) {
		const read = readKits(kitsDir);
		add(read.issues);
		kits = read.kits;
		if (kits.length > 0) inputs.push(`publish kits in ${show(kitsDir)}: ${kits.length}`);
	}

	// Hub clicks.
	let hub: HubClicks | null = null;
	const hubFile = values['hub-csv'] ? at(values['hub-csv']) : values['hub-db'] ? at(values['hub-db']) : join(dataDir, 'hub.sqlite');
	if (values['hub-csv'] || values['hub-db'] || existsSync(hubFile)) {
		const read = values['hub-csv'] ? readHubCsv(hubFile, range) : await readHubDb(hubFile, range);
		add(read.issues);
		hub = read.hub;
		if (hub) inputs.push(`hub clicks: ${show(hubFile)} (${hub.origin})`);
	}

	// Affiliate payouts.
	let config: PayoutConfig | null = null;
	const configFile = values['payouts-config'] ? at(values['payouts-config']) : resolve(PROJECT_DIR, 'config/payouts.json');
	if (values['payouts-config'] || values.payouts || existsSync(configFile)) {
		try {
			const check = checkPayoutConfig(JSON.parse(readFileSync(configFile, 'utf8')));
			add(check.errors.map((message) => ({level: 'error' as const, where: configFile, message})));
			add(check.warnings.map((message) => ({level: 'warning' as const, where: configFile, message})));
			config = check.config;
		} catch (err) {
			add([{level: 'error', where: configFile, message: `cannot read the payout config: ${(err as Error).message}. Copy config/payouts.example.json to config/payouts.json and edit it.`}]);
		}
	}
	let payouts: PayoutRow[] | null = null;
	if (config) {
		const jobs: {programme: (typeof config.programmes)[number]; file: string}[] = [];
		if (values.payouts) {
			for (const spec of values.payouts) {
				const eq = spec.indexOf('=');
				const programme = config.programmes.find((p) => p.id === spec.slice(0, eq));
				if (eq < 1 || !spec.slice(eq + 1)) return usageError(`--payouts takes <programme-id>=<file>, got "${spec}".`);
				if (!programme) return usageError(`--payouts: no programme "${spec.slice(0, eq)}" in ${show(configFile)}.`);
				jobs.push({programme, file: at(spec.slice(eq + 1))});
			}
		} else {
			for (const programme of config.programmes) for (const file of csvFiles(join(dataDir, 'payouts', programme.id))) jobs.push({programme, file});
		}
		if (jobs.length > 0) {
			payouts = [];
			for (const job of jobs) {
				const read = readPayoutCsv(job.file, job.programme, {from, to});
				add(read.issues);
				payouts.push(...read.rows);
				inputs.push(`payouts ${job.programme.id} ${show(job.file)}: ${read.rows.length} row(s)`);
			}
		}
	}

	// YouTube Analytics API.
	let api: ApiVideo[] | null = null;
	if (values.api) {
		try {
			const token = await resolveAccessToken(deps.env, deps.fetch);
			const startDate = from ?? API_DEFAULT_FROM;
			const endDate = to ?? today;
			api = await fetchVideoReport(deps.fetch, token, {startDate, endDate, includeRevenue: values['api-revenue'] === true});
			inputs.push(`YouTube Analytics API v2, ${startDate} to ${endDate}: ${api.length} video(s)${values['api-revenue'] ? ', with estimated revenue' : ''}`);
		} catch (err) {
			if (!(err instanceof YouTubeApiError)) throw err;
			add([{level: 'error', where: 'YouTube Analytics API', message: err.message}]);
		}
	}

	const errors = issues.filter((i) => i.level === 'error');
	if (errors.length > 0) {
		deps.printError([`The dashboard was not written: ${errors.length} input problem(s).`, ...errors.map(formatIssue)].join('\n'));
		return 1;
	}

	const coveredOffers = new Set(config?.programmes.flatMap((p) => [...Object.values(p.offerIds), ...(p.defaultOfferId ? [p.defaultOfferId] : [])]) ?? []);
	const merged = mergeInputs({channel, studio, api, catalog, kits, hub, payouts, coveredOffers, rates: config?.rates ?? {}});
	add(merged.issues);
	if (config && Object.keys(config.rates).length > 0) {
		inputs.push(`currency rates from the payout config: ${Object.entries(config.rates).map(([code, r]) => `1 ${code} = ${r.usdPerUnit} USD (${r.asOf})`).join(', ')}`);
	}
	if (studioFiles.length === 0 && !values.api) inputs.push('no YouTube data: pass --studio or --api');
	if (range !== ALL_TIME) inputs.push(`date range: ${from ?? 'start'} to ${to ?? 'today'} (Studio exports cover the range chosen in Studio)`);
	if (api && studioFiles.length > 0) inputs.push('views and retention come from the API; impressions and CTR from the Studio export. Export Studio for the same dates.');

	// Region rules: restricted offers never get a "double down" call (they stay on the hub page only).
	let restrictedOffers: Set<string> | null = null;
	const offersFile = values.offers ? at(values.offers) : resolve(PROJECT_DIR, 'config/offers.json');
	if (values.offers || existsSync(offersFile)) {
		try {
			const check = checkRegistry(JSON.parse(readFileSync(offersFile, 'utf8')));
			if (check.errors.length > 0) {
				add([{level: 'warning', where: offersFile, message: `the offer registry has problems (${check.errors[0]}), so region rules are not applied to the offer advice`}]);
			} else {
				restrictedOffers = new Set(check.registry.offers.filter((o) => isRestricted(o)).map((o) => o.id));
				inputs.push(`offer registry: ${show(offersFile)} (${restrictedOffers.size} offer(s) restricted by region)`);
			}
		} catch (err) {
			add([{level: 'warning', where: offersFile, message: `cannot read the offer registry: ${(err as Error).message}`}]);
		}
	}
	const report = buildReport(merged.videos, merged.offers, {channel, hubLoaded: hub !== null, restrictedOffers});
	const outDir = values.out ? at(values.out) : resolve(PROJECT_DIR, 'out/dashboard');
	mkdirSync(outDir, {recursive: true});
	const stateFile = join(outDir, 'state.json');
	let state: MilestoneState = {version: 1, channels: {}};
	try {
		if (existsSync(stateFile)) state = parseState(JSON.parse(readFileSync(stateFile, 'utf8')));
	} catch {
		state = {version: 1, channels: {}};
	}
	const generatedAt = deps.now().toISOString();
	const recFile = join(outDir, 'recommendations.md');
	const last = state.channels[channel] ?? null;
	const due = milestoneDue(report.videosWithData, last?.videoCount ?? null);
	const lines = [`Dashboard for ${channel}: ${report.videosWithData} video(s) with YouTube data, ${merged.videos.length} known.`];
	if (due || values.force) {
		writeAtomic(recFile, renderRecommendations(report, {generatedAt: generatedAt.slice(0, 10), brandName}));
		state.channels[channel] = {videoCount: report.videosWithData, generatedAt};
		lines.push(`  wrote ${show(recFile)}${values.force && !due ? ' (--force)' : ` (milestone: ${report.videosWithData} videos)`}${report.sampleTooSmall ? '. The sample is too small to conclude anything yet.' : ''}`);
	} else {
		lines.push(`  recommendations.md unchanged: next at ${nextMilestone(report.videosWithData)} videos with data (or run with --force)`);
	}
	const recInfo = state.channels[channel] && existsSync(recFile) ? {...state.channels[channel], file: 'recommendations.md'} : null;

	const metricsFile = join(outDir, 'metrics.csv');
	const htmlFile = join(outDir, 'index.html');
	writeAtomic(metricsFile, renderMetricsCsv(merged.videos));
	writeAtomic(
		htmlFile,
		renderDashboard({
			brandName,
			channel,
			generatedAt,
			videos: merged.videos,
			offers: merged.offers,
			unattributed: merged.unattributed,
			report,
			recommendations: recInfo,
			nextMilestone: nextMilestone(report.videosWithData),
			inputs,
			issues: issues.filter((i) => i.level !== 'error'),
			hubLoaded: hub !== null,
			payoutsLoaded: payouts !== null,
		}),
	);
	writeAtomic(stateFile, `${JSON.stringify(state, null, 2)}\n`);
	lines.push(`  wrote ${show(metricsFile)}`, `  wrote ${show(htmlFile)}`);
	for (const line of inputs) lines.push(`  input: ${line}`);
	lines.push(...issues.filter((i) => i.level === 'warning').map(formatIssue));
	const notes = issues.filter((i) => i.level === 'note').length;
	if (notes > 0) lines.push(`  ${notes} note(s) are listed under "Data notes" in index.html.`);
	deps.print(lines.join('\n'));
	return 0;
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	process.exitCode = await main(process.argv.slice(2));
}
