/**
 * Fills the media-kit template in docs/SPONSORS.md with live figures and writes it as Markdown, HTML and PDF.
 * Node 22 runs it directly (type stripping):
 *
 *   node scripts/product/media-kit.ts --channel zoora-security [--metrics <metrics.csv>] [--audience <json>]
 *        [--prices <json>] [--as-of YYYY-MM-DD] [--window-days 90] [--contact <email>] [--out <dir>] [--strict] [--no-pdf]
 *
 * Figures come only from the revenue dashboard's metrics.csv (projects/creator-hub/tools/dashboard) and from the
 * owner's audience file (copied from YouTube Studio). A missing figure prints "not yet available"; nothing is
 * estimated. See docs/SPONSORS.md, section 1.
 *
 * Exit codes: 0 written; 1 written, but --strict found missing figures; 2 bad arguments or unreadable input.
 */
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {audienceValues, channelStats, extractTemplate, fillTemplate, parseMetricsCsv, statValues, validateAudience, type AudienceFile, type MetricsRow} from './lib/metrics.ts';
import {parseDocument, structure} from './lib/markdown.ts';
import {renderDocument} from './lib/render.ts';
import {spotInfos} from './lib/spotfiles.ts';
import {buildCss} from './lib/styles.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(HERE, '..', '..');
const HUB = resolve(PROJECT_ROOT, '..', 'creator-hub');

/** Words for each channel's kit (from content/<channel>/channel-copy.md); the display name comes from channel.json. */
export const CHANNEL_TEXT: Record<string, {tagline: string; about: string}> = {
	'zoora-security': {
		tagline: 'Crypto and AI security, explained. What happened, how it worked, and one fix.',
		about:
			'Crypto and AI security news, explained calmly by Zoo and his dog Badger. When a protocol gets drained, a new wallet drainer spreads, or an AI agent gets talked into something it shouldn\'t do, the show covers what happened, how it worked, and one fix viewers can use today. Every fact is attributed, developing stories are labelled, and corrections are pinned.',
	},
	'zoora-ai': {
		tagline: 'Crypto and AI stories, starring you.',
		about:
			'Animated POV stories about crypto, memecoins and AI, told from the viewer\'s point of view. The characters are fictional composites; the patterns come from real, sourced cases. Hosted by Zoo, calm and quietly unimpressed, and his dog Badger.',
	},
};

type Args = {
	channel: string;
	metrics: string;
	audience: string;
	prices: string;
	asOf: string;
	windowDays: number;
	contact: string | null;
	out: string;
	strict: boolean;
	pdf: boolean;
};

class UsageError extends Error {}

const USAGE =
	'usage: node scripts/product/media-kit.ts --channel <zoora-ai|zoora-security> [--metrics <csv>] [--audience <json>] [--prices <json>] [--as-of YYYY-MM-DD] [--window-days N] [--contact <email>] [--out <dir>] [--strict] [--no-pdf]';

const todayUtc = (): string => new Date().toISOString().slice(0, 10);

export const parseArgs = (argv: string[], env: Record<string, string | undefined> = process.env): Args => {
	const raw: Record<string, string> = {};
	const flags = new Set<string>();
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--strict' || a === '--no-pdf') {
			flags.add(a);
			continue;
		}
		if (a === '-h' || a === '--help') throw new UsageError('help');
		const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
		if (!m || !['channel', 'metrics', 'audience', 'prices', 'as-of', 'window-days', 'contact', 'out'].includes(m[1])) throw new UsageError(`unknown option ${a}`);
		const v = m[2] ?? argv[++i];
		if (v === undefined) throw new UsageError(`--${m[1]} needs a value`);
		raw[m[1]] = v;
	}
	const channel = raw.channel;
	if (!channel || !/^[a-z0-9-]+$/.test(channel)) throw new UsageError('--channel is required (zoora-ai or zoora-security)');
	const asOf = raw['as-of'] ?? todayUtc();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || Number.isNaN(Date.parse(`${asOf}T00:00:00Z`))) throw new UsageError('--as-of must be YYYY-MM-DD');
	const windowDays = raw['window-days'] === undefined ? 90 : Number(raw['window-days']);
	if (!Number.isInteger(windowDays) || windowDays < 7 || windowDays > 730) throw new UsageError('--window-days must be an integer 7-730');
	const defaultMetrics = channel === 'zoora-ai' ? join(HUB, 'out', 'dashboard', 'metrics.csv') : join(HUB, 'out', 'dashboard', channel, 'metrics.csv');
	return {
		channel,
		metrics: resolve(raw.metrics ?? defaultMetrics),
		audience: resolve(raw.audience ?? join(HUB, 'data', 'media-kit', `${channel}.audience.json`)),
		prices: resolve(raw.prices ?? join(HUB, 'data', 'media-kit', 'prices.json')),
		asOf,
		windowDays,
		contact: raw.contact ?? env.CONTACT_EMAIL ?? null,
		out: resolve(raw.out ?? join(PROJECT_ROOT, 'out', 'sponsors', channel)),
		strict: flags.has('--strict'),
		pdf: !flags.has('--no-pdf'),
	};
};

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));

/** Every value the template can use, from the inputs that exist. Pure apart from reading the given files. */
export const collectValues = (args: Args, log: (s: string) => void): Record<string, string> => {
	const values: Record<string, string> = {};
	const channelFile = join(PROJECT_ROOT, 'content', args.channel, 'channel.json');
	const ch = existsSync(channelFile) ? (readJson(channelFile) as {displayName?: string}) : {};
	values['kit.channelName'] = ch.displayName ?? args.channel;
	values['kit.dateIso'] = args.asOf;
	values['kit.version'] = args.asOf.replace(/-/g, '.');
	const text = CHANNEL_TEXT[args.channel];
	if (text) {
		values['kit.tagline'] = text.tagline;
		values['kit.about'] = text.about;
	}
	if (args.contact) values['kit.contact'] = args.contact;

	let rows: MetricsRow[] = [];
	if (existsSync(args.metrics)) {
		rows = parseMetricsCsv(readFileSync(args.metrics, 'utf8'));
		const mine = rows.filter((r) => r.channel === args.channel).length;
		log(`metrics: ${relative(process.cwd(), args.metrics)} (${rows.length} rows, ${mine} for ${args.channel})`);
	} else log(`metrics: ${relative(process.cwd(), args.metrics)} not found; every performance figure will read "not yet available"`);
	Object.assign(values, statValues(channelStats(rows, args.channel, args.asOf, args.windowDays)));

	if (existsSync(args.audience)) {
		const a = readJson(args.audience);
		const errors = validateAudience(a);
		if (errors.length) throw new Error(`audience file ${args.audience}: ${errors.join('; ')}`);
		Object.assign(values, audienceValues(a as AudienceFile));
		log(`audience: ${relative(process.cwd(), args.audience)}`);
	} else log(`audience: no file at ${relative(process.cwd(), args.audience)}; audience figures will read "not yet available"`);

	if (existsSync(args.prices)) {
		const p = readJson(args.prices) as Record<string, unknown>;
		for (const [k, v] of Object.entries(p)) {
			if (!/^price\.[a-z0-9-]+$/.test(k) || typeof v !== 'string' || !v.trim()) throw new Error(`prices file ${args.prices}: "${k}" must be "price.<name>": "<text>"`);
			values[k] = v.trim();
		}
	}
	return values;
};

export const main = async (argv: string[]): Promise<number> => {
	let args: Args;
	try {
		args = parseArgs(argv);
	} catch (e) {
		console.error(e instanceof UsageError && e.message !== 'help' ? `${e.message}\n${USAGE}` : USAGE);
		return e instanceof UsageError && e.message === 'help' ? 0 : 2;
	}
	const log = (s: string) => console.log(s);
	let values: Record<string, string>;
	let template: string;
	try {
		template = extractTemplate(readFileSync(join(PROJECT_ROOT, 'docs', 'SPONSORS.md'), 'utf8'));
		values = collectValues(args, log);
	} catch (e) {
		console.error(e instanceof Error ? e.message : String(e));
		return 2;
	}
	const {text, missing} = fillTemplate(template, values);
	mkdirSync(args.out, {recursive: true});
	const mdFile = join(args.out, 'media-kit.md');
	writeFileSync(mdFile, text);
	log(`wrote ${relative(PROJECT_ROOT, mdFile)}`);

	const doc = structure(parseDocument(text));
	const css = (pages: {name: string; label: string}[], footer: string) => buildCss({projectRoot: PROJECT_ROOT, paper: 'letter', footer, pages});
	const spots = spotInfos(join(PROJECT_ROOT, 'out', 'product', 'spots'), args.out);
	const r = renderDocument(
		doc,
		{
			edition: 'full',
			colophon: false,
			product: {id: 'media-kit', title: values['kit.channelName'], copyrightHolder: '', contact: args.contact, fullEditionUrl: null, licence: {free: '', full: ''}},
			sources: {version: 1, checked: args.asOf, methods: {read: '', 'search-extract': ''}, sources: []},
			spots,
		},
		css,
	);
	for (const w of r.warnings) log(`warn: ${w}`);
	const htmlFile = join(args.out, 'media-kit.html');
	writeFileSync(htmlFile, r.html);
	log(`wrote ${relative(PROJECT_ROOT, htmlFile)}`);
	if (args.pdf) {
		const {printPdf} = await import('./lib/pdf.ts');
		const pdfFile = join(args.out, 'media-kit.pdf');
		const res = await printPdf(htmlFile, pdfFile);
		for (const e of res.consoleErrors) log(`browser: ${e}`);
		log(`wrote ${relative(PROJECT_ROOT, pdfFile)}`);
	}
	if (missing.length) {
		log(`missing (shown as "not yet available" or the template's fallback): ${missing.join(', ')}`);
		if (args.strict) return 1;
	}
	return 0;
};

if (import.meta.url === `file://${process.argv[1]}`) {
	main(process.argv.slice(2)).then(
		(code) => process.exit(code),
		(e) => {
			console.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
			process.exit(2);
		},
	);
}
