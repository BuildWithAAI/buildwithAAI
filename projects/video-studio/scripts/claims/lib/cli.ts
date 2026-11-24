/**
 * node scripts/claims/check.ts content/<channel>/<slug> [--lang <lang>] [options]
 * Exit codes: 0 pass · 1 the gate failed (the report lists every error) · 2 bad input (usage, missing files, bad JSON).
 */
import {existsSync, mkdirSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {join, relative, resolve} from 'node:path';
import {checkEpisode} from './check.ts';
import {DEFAULT_NAMES, InputError, resolveEpisodeDir, STUDIO, todayIso} from './load.ts';
import {renderMarkdown, renderSummary, statusTail} from './report.ts';
import {langProblem} from './text.ts';
import type {Lang} from '../../../src/episode/types.ts';

const USAGE = `Claim gate: every factual sentence cites a verified source; nothing on the must-not-say lists.

Usage: node scripts/claims/check.ts content/<channel>/<slug> [--lang <lang>] [options]
       node scripts/claims/check.ts --all [content]     every storyboard (every language) under content/

  --lang <lang>        en | es | pt-br | hi | it | zh | ja (default: storyboard.json's language). fr is excluded.
  --names <file>       private names list (default: data/private/names.txt; gitignored). A missing list FAILS the gate
  --no-names           skip the private-name check on purpose (CI, which cannot have the list); every line says so
  --research <file>    research.md with the "Must not say" section (default: <episode>/research.md)
  --offers <file>      offer registry (default: ../creator-hub/config/offers.json, else offers.example.json)
  --out-dir <dir>      where the report goes (default: out/claims); writes <slug>.<lang>.md and .json
  --today <date>       YYYY-MM-DD for the accessed-date checks (default: today, America/Chicago)
  --json               print the report JSON instead of the summary
  -q, --quiet          print only the PASS/FAIL line

Exit codes: 0 pass, 1 fail, 2 bad input.`;

type Args = {dir?: string; lang?: string; names?: string | null; research?: string; offers?: string; outDir?: string; today?: string; json: boolean; quiet: boolean; help: boolean; all: boolean};

const parseArgs = (argv: string[]): Args => {
	const a: Args = {json: false, quiet: false, help: false, all: false};
	for (let i = 0; i < argv.length; i++) {
		const k = argv[i];
		const val = () => {
			const v = argv[++i];
			if (v === undefined || v.startsWith('--')) throw new InputError(`${k} needs a value`);
			return v;
		};
		if (k === '--lang') a.lang = val();
		else if (k === '--names') a.names = val();
		else if (k === '--no-names') a.names = null;
		else if (k === '--research') a.research = val();
		else if (k === '--offers') a.offers = val();
		else if (k === '--out-dir') a.outDir = val();
		else if (k === '--today') a.today = val();
		else if (k === '--json') a.json = true;
		else if (k === '-q' || k === '--quiet') a.quiet = true;
		else if (k === '--all') a.all = true;
		else if (k === '-h' || k === '--help') a.help = true;
		else if (k.startsWith('-')) throw new InputError(`unknown option ${k}`);
		else if (!a.dir) a.dir = k;
		else throw new InputError(`unexpected argument ${k}`);
	}
	return a;
};

export const main = (argv: string[]): number => {
	let args: Args;
	try {
		args = parseArgs(argv);
	} catch (e) {
		console.error(`claims: ${(e as Error).message}\n\n${USAGE}`);
		return 2;
	}
	if (args.help) {
		console.log(USAGE);
		return 0;
	}
	if (args.all) return runAll(args);
	if (!args.dir) {
		console.error(`claims: give the episode folder\n\n${USAGE}`);
		return 2;
	}
	try {
		if (args.lang && langProblem(args.lang)) throw new InputError(langProblem(args.lang) as string);
		if (args.today && !/^\d{4}-\d{2}-\d{2}$/.test(args.today)) throw new InputError('--today must be YYYY-MM-DD');
		const dir = resolveEpisodeDir(args.dir);
		const report = checkEpisode({
			dir,
			lang: args.lang as Lang | undefined,
			today: args.today ?? todayIso(),
			namesPath: args.names === null ? null : resolve(args.names ?? DEFAULT_NAMES),
			researchPath: args.research ? resolve(args.research) : undefined,
			offersPath: args.offers ? resolve(args.offers) : undefined,
		});
		const outDir = resolve(args.outDir ?? join(STUDIO, 'out', 'claims'));
		mkdirSync(outDir, {recursive: true});
		const base = join(outDir, `${report.slug}.${report.lang}`);
		writeFileSync(`${base}.md`, renderMarkdown(report));
		writeFileSync(`${base}.json`, `${JSON.stringify(report, null, 2)}\n`);
		const shown = relative(process.cwd(), `${base}.md`) || `${base}.md`;
		if (args.json) console.log(JSON.stringify(report, null, 2));
		else if (args.quiet) console.log(`claims: ${report.channel}/${report.slug} (${report.lang}) ${report.pass ? 'PASS' : 'FAIL'}: ${report.errors} errors, ${report.warnings} warnings · ${statusTail(report)} · ${shown}`);
		else console.log(renderSummary(report, shown));
		return report.pass ? 0 : 1;
	} catch (e) {
		if (e instanceof InputError) {
			console.error(`claims: ${e.message}`);
			return 2;
		}
		throw e;
	}
};

/** Every content/<channel>/<slug>/storyboard*.json, every language: the gate a pipeline or CI runs before voice and render. */
const runAll = (args: Args): number => {
	const root = resolve(args.dir ?? join(STUDIO, 'content'));
	if (!existsSync(root)) {
		console.error(`claims: no content folder at ${root}`);
		return 2;
	}
	const outDir = resolve(args.outDir ?? join(STUDIO, 'out', 'claims'));
	mkdirSync(outDir, {recursive: true});
	let failed = 0;
	let checked = 0;
	let namesOff = 0;
	for (const channel of readdirSync(root).sort()) {
		const cdir = join(root, channel);
		if (!statSync(cdir).isDirectory()) continue;
		for (const slug of readdirSync(cdir).sort()) {
			const dir = join(cdir, slug);
			if (!statSync(dir).isDirectory() || !existsSync(join(dir, 'storyboard.json'))) continue;
			const langs = [undefined, ...readdirSync(dir).flatMap((f) => /^storyboard\.([a-z]{2}(?:-[a-z]{2})?)\.json$/.exec(f)?.[1] ?? [])];
			for (const lang of langs) {
				checked++;
				try {
					if (lang && langProblem(lang)) throw new InputError(`storyboard.${lang}.json: ${langProblem(lang)}`);
					const report = checkEpisode({
						dir,
						lang: lang as Lang | undefined,
						today: args.today ?? todayIso(),
						namesPath: args.names === null ? null : resolve(args.names ?? DEFAULT_NAMES),
						offersPath: args.offers ? resolve(args.offers) : undefined,
					});
					const base = join(outDir, `${report.slug}.${report.lang}`);
					writeFileSync(`${base}.md`, renderMarkdown(report));
					writeFileSync(`${base}.json`, `${JSON.stringify(report, null, 2)}\n`);
					if (!report.pass) failed++;
					if (!report.namesList.path) namesOff++;
					console.log(`claims: ${report.channel}/${report.slug} (${report.lang}) ${report.pass ? 'PASS' : 'FAIL'}: ${report.errors} errors, ${report.warnings} warnings · ${statusTail(report)} · ${relative(process.cwd(), `${base}.md`)}`);
				} catch (e) {
					if (!(e instanceof InputError)) throw e;
					failed++;
					console.log(`claims: ${channel}/${slug}${lang ? ` (${lang})` : ''} FAIL: ${e.message}`);
				}
			}
		}
	}
	console.log(`claims: ${checked} storyboard${checked === 1 ? '' : 's'} checked, ${failed} failed${namesOff ? ` · private names NOT checked in ${namesOff} (${args.names === null ? '--no-names' : 'no data/private/names.txt'})` : ''}`);
	return failed ? 1 : 0;
};
