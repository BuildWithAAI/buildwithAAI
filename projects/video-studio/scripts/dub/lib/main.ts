/**
 * node scripts/dub/cli.ts prepare|import|validate content/<channel>/<slug> --lang <lang> [options]
 * Exit codes: 0 ok · 1 refused or validation errors (the output lists them) · 2 bad input (usage, missing files, bad JSON).
 */
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import type {Lang, Storyboard} from '../../../src/episode/types.ts';
import {DEFAULT_NAMES, InputError, isRecord, loadStoryboard, readJson, resolveEpisodeDir, sha256File, STUDIO} from '../../claims/lib/load.ts';
import {loadNames, type NameList} from '../../claims/lib/names.ts';
import {loadBacktranslation} from '../../claims/lib/backtranslation.ts';
import {parseMustNotSay} from '../../claims/lib/mustnotsay.ts';
import {isLang, langProblem, LANG_NAMES} from '../../claims/lib/text.ts';
import {parseMarkup} from '../../../src/episode/markup.ts';
import {applySheet, sheetProblems} from './apply.ts';
import type {GlossaryTerm} from './glossary.ts';
import {renderDubMarkdown, renderDubSummary} from './report.ts';
import {buildSheet, carryOver, seedFromTarget, type Sheet} from './sheet.ts';
import {validateDub, type DubReport, type EngineCheck} from './validate.ts';

const USAGE = `Dubbing tools: translation sheet -> storyboard.<lang>.json -> checks.

Usage:
  node scripts/dub/cli.ts prepare  content/<channel>/<slug> --lang <lang> [--out <sheet>] [--method machine|human] [--fresh]
  node scripts/dub/cli.ts import   content/<channel>/<slug> --lang <lang> [--sheet <sheet>] [--force]
  node scripts/dub/cli.ts validate content/<channel>/<slug> --lang <lang> [--json] [-q]

  --lang <lang>       es | pt-br | hi | it | zh (ja: blocked voice, warns). fr is excluded (no male Kokoro voice).
  --out / --sheet     the sheet (default: <episode>/dub/sheet.<lang>.json)
  --method            who translates: machine (an agent or MT; default) or human. Both are marked for native review.
  --fresh             prepare: do not carry translations over from an existing sheet
  --force             import: overwrite a storyboard.<lang>.json that is marked native-reviewed
  --glossary <file>   extra do-not-translate terms (default: <episode>/dub/glossary.json when present)
  --names <file>      private names list (default: data/private/names.txt when present) · --no-names
  --out-dir <dir>     validation report folder (default: out/dub); writes <slug>.<lang>.md and .json
  --json              validate: print the report JSON

Exit codes: 0 ok, 1 refused or failed checks, 2 bad input.`;

type Args = {cmd?: string; dir?: string; lang?: string; out?: string; sheet?: string; method?: string; fresh: boolean; force: boolean; glossary?: string; names?: string | null; outDir?: string; json: boolean; quiet: boolean; help: boolean};

const parseArgs = (argv: string[]): Args => {
	const a: Args = {fresh: false, force: false, json: false, quiet: false, help: false};
	for (let i = 0; i < argv.length; i++) {
		const k = argv[i];
		const val = () => {
			const v = argv[++i];
			if (v === undefined || v.startsWith('--')) throw new InputError(`${k} needs a value`);
			return v;
		};
		if (k === '--lang') a.lang = val();
		else if (k === '--out') a.out = val();
		else if (k === '--sheet') a.sheet = val();
		else if (k === '--method') a.method = val();
		else if (k === '--fresh') a.fresh = true;
		else if (k === '--force') a.force = true;
		else if (k === '--glossary') a.glossary = val();
		else if (k === '--names') a.names = val();
		else if (k === '--no-names') a.names = null;
		else if (k === '--out-dir') a.outDir = val();
		else if (k === '--json') a.json = true;
		else if (k === '-q' || k === '--quiet') a.quiet = true;
		else if (k === '-h' || k === '--help') a.help = true;
		else if (k.startsWith('-')) throw new InputError(`unknown option ${k}`);
		else if (!a.cmd) a.cmd = k;
		else if (!a.dir) a.dir = k;
		else throw new InputError(`unexpected argument ${k}`);
	}
	return a;
};

const rel = (p: string) => relative(process.cwd(), p) || p;
const studioRel = (p: string) => relative(STUDIO, p) || p;

/** The master storyboard: storyboard.json, which must be in its own source language. */
const loadMaster = (dir: string): {path: string; sb: Storyboard} => {
	const path = join(dir, 'storyboard.json');
	if (!existsSync(path)) throw new InputError(`no storyboard.json in ${dir}`);
	const sb = loadStoryboard(path);
	if (sb.lang !== sb.sourceLang) throw new InputError(`${studioRel(path)} is "${sb.lang}" but its sourceLang is "${sb.sourceLang}": dub from the master storyboard`);
	return {path, sb};
};

const loadGlossary = (path: string | null): GlossaryTerm[] => {
	if (!path || !existsSync(path)) return [];
	const x = readJson(path);
	if (!Array.isArray(x)) throw new InputError(`${path}: expected a JSON array of terms or {"term", "note"}`);
	return x.flatMap((t): GlossaryTerm[] =>
		typeof t === 'string' && t.trim() ? [{term: t.trim(), kind: 'extra', note: 'episode glossary: never translate'}] : isRecord(t) && typeof t.term === 'string' && t.term.trim() ? [{term: t.term.trim(), kind: 'extra', note: typeof t.note === 'string' ? t.note : 'episode glossary: never translate'}] : [],
	);
};

/** The engine's validateStoryboard, when it loads (it is another workflow's module; a failure only skips that check). */
const loadEngine = async (): Promise<EngineCheck | null> => {
	try {
		const m = (await import('../../../src/episode/validate.ts')) as {validateStoryboard?: (sb: Storyboard, c: {channel: string; slug: string; lang: Lang; short: boolean; shortId?: string}) => Array<{level: 'error' | 'warning'; where: string; msg: string}>};
		if (typeof m.validateStoryboard !== 'function') return null;
		const v = m.validateStoryboard;
		return (sb, short, shortId) => v(sb, {channel: sb.channel, slug: sb.slug, lang: sb.lang, short, shortId});
	} catch {
		return null;
	}
};

const runValidate = async (dir: string, lang: Lang, args: Args, names: NameList, src: {path: string; sb: Storyboard}): Promise<{report: DubReport; reportPath: string}> => {
	const targetPath = join(dir, `storyboard.${lang}.json`);
	if (!existsSync(targetPath)) throw new InputError(`no storyboard.${lang}.json in ${dir}: run prepare, translate the sheet, then import`);
	const tgt = loadStoryboard(targetPath);
	const report = validateDub({
		src: src.sb,
		tgt,
		lang,
		names,
		sourceFile: studioRel(src.path),
		targetFile: studioRel(targetPath),
		extraGlossary: loadGlossary(args.glossary ? resolve(args.glossary) : join(dir, 'dub', 'glossary.json')),
		engine: await loadEngine(),
		backtranslation: (() => {
			const record = loadBacktranslation(dir, lang);
			const research = join(dir, 'research.md');
			return record ? {record, mustNotSay: existsSync(research) ? parseMustNotSay(readFileSync(research, 'utf8')) : {found: false, heading: null, rules: []}} : null;
		})(),
		mustNotSay: (() => {
			const research = join(dir, 'research.md');
			return existsSync(research) ? parseMustNotSay(readFileSync(research, 'utf8'), lang) : null;
		})(),
	});
	const outDir = resolve(args.outDir ?? join(STUDIO, 'out', 'dub'));
	mkdirSync(outDir, {recursive: true});
	const base = join(outDir, `${report.slug}.${lang}`);
	writeFileSync(`${base}.md`, renderDubMarkdown(report));
	writeFileSync(`${base}.json`, `${JSON.stringify(report, null, 2)}\n`);
	return {report, reportPath: `${base}.md`};
};

export const main = async (argv: string[]): Promise<number> => {
	let args: Args;
	try {
		args = parseArgs(argv);
	} catch (e) {
		console.error(`dub: ${(e as Error).message}\n\n${USAGE}`);
		return 2;
	}
	if (args.help) {
		console.log(USAGE);
		return 0;
	}
	if (!args.cmd || !['prepare', 'import', 'validate'].includes(args.cmd) || !args.dir) {
		console.error(`dub: give a command (prepare, import, validate) and the episode folder\n\n${USAGE}`);
		return 2;
	}
	try {
		if (!args.lang) throw new InputError('--lang is required');
		const lp = langProblem(args.lang);
		if (lp) throw new InputError(lp);
		const lang = args.lang as Lang;
		if (!isLang(lang)) throw new InputError(`unsupported language ${args.lang}`);
		const dir = resolveEpisodeDir(args.dir);
		const master = loadMaster(dir);
		if (lang === master.sb.lang) throw new InputError(`"${lang}" is the source language of this episode`);
		const sheetPath = resolve(args.out ?? args.sheet ?? join(dir, 'dub', `sheet.${lang}.json`));
		const names = loadNames(args.names === null ? null : resolve(args.names ?? DEFAULT_NAMES));

		if (args.cmd === 'prepare') {
			if (args.method && args.method !== 'machine' && args.method !== 'human') throw new InputError('--method must be machine or human');
			for (const sc of master.sb.scenes) {
				try {
					parseMarkup(sc.narration);
				} catch (e) {
					console.error(`dub: scene ${sc.id}: narration markup: ${(e as Error).message}. Fix the source first.`);
					return 1;
				}
			}
			const sheet = buildSheet(master.sb, {
				targetLang: lang,
				sourceFile: studioRel(master.path),
				sourceSha256: sha256File(master.path),
				preparedAt: new Date().toISOString(),
				method: (args.method as 'machine' | 'human' | undefined) ?? 'machine',
				extraGlossary: loadGlossary(args.glossary ? resolve(args.glossary) : join(dir, 'dub', 'glossary.json')),
			});
			let carried = {carried: 0, dropped: 0};
			let seeded = 0;
			const targetPath = join(dir, `storyboard.${lang}.json`);
			if (!args.fresh && existsSync(sheetPath)) {
				const prev = readJson(sheetPath);
				if (!sheetProblems(prev).length) carried = carryOver(sheet, prev as Sheet);
			} else if (!args.fresh && existsSync(targetPath)) seeded = seedFromTarget(sheet, loadStoryboard(targetPath));
			if (args.method) sheet.method = args.method as 'machine' | 'human';
			mkdirSync(dirname(sheetPath), {recursive: true});
			writeFileSync(sheetPath, `${JSON.stringify(sheet, null, 2)}\n`);
			const todo = sheet.items.filter((it) => !it.translation.trim()).length;
			console.log(
				[
					`dub prepare: ${sheet.items.length} strings for ${LANG_NAMES[lang]} (${lang}) · ${sheet.glossary.length} glossary terms · ${sheet.fixed.length} fixed`,
					carried.carried || carried.dropped ? `  carried over ${carried.carried} unchanged translation${carried.carried === 1 ? '' : 's'}; ${carried.dropped} dropped (their source changed)` : '',
					seeded ? `  seeded ${seeded} translation${seeded === 1 ? '' : 's'} from the existing storyboard.${lang}.json (each has a note: check it against the source)` : '',
					`  sheet: ${rel(sheetPath)} (${todo} to translate)`,
					`  next: fill every "translation", set "method", then: node scripts/dub/cli.ts import ${rel(dir)} --lang ${lang}`,
					lang === 'ja' ? '  warning: the Japanese voice is blocked until a real G2P is verified (CLAUDE.md)' : '',
				]
					.filter(Boolean)
					.join('\n'),
			);
			return 0;
		}

		if (args.cmd === 'import') {
			if (!existsSync(sheetPath)) throw new InputError(`no sheet at ${rel(sheetPath)}: run prepare first`);
			const raw = readJson(sheetPath);
			const shape = sheetProblems(raw);
			if (shape.length) {
				console.error(`dub import: ${rel(sheetPath)}: ${shape.join('; ')}`);
				return 1;
			}
			const sheet = raw as Sheet;
			const sha = sha256File(master.path);
			if (sheet.sourceSha256 !== sha) {
				console.error(`dub import: refused: storyboard.json changed since the sheet was prepared. Re-run prepare (unchanged translations carry over), translate what is new, then import.`);
				return 1;
			}
			const targetPath = join(dir, `storyboard.${lang}.json`);
			if (existsSync(targetPath) && !args.force) {
				const old = readJson(targetPath);
				if (isRecord(old) && isRecord(old.translation) && old.translation.status === 'native-reviewed') {
					console.error(`dub import: refused: ${rel(targetPath)} is marked native-reviewed; a new import would replace reviewed text. Use --force only if the owner agrees.`);
					return 1;
				}
			}
			const res = applySheet(master.sb, sheet, lang);
			if (!res.storyboard) {
				console.error(`dub import: refused: ${res.problems.length} problem${res.problems.length === 1 ? '' : 's'} in the sheet\n${res.problems.slice(0, 60).map((p) => `  - ${p}`).join('\n')}${res.problems.length > 60 ? `\n  ... ${res.problems.length - 60} more` : ''}`);
				return 1;
			}
			writeFileSync(targetPath, `${JSON.stringify(res.storyboard, null, 2)}\n`);
			console.log(`dub import: wrote ${rel(targetPath)} (translation: machine, method ${sheet.method}, not reviewed)`);
			const {report, reportPath} = await runValidate(dir, lang, args, names, master);
			console.log(renderDubSummary(report, rel(reportPath)));
			if (report.pass) console.log(`  next: node scripts/claims/check.ts ${rel(dir)} --lang ${lang}, then the native review`);
			return report.pass ? 0 : 1;
		}

		const {report, reportPath} = await runValidate(dir, lang, args, names, master);
		if (args.json) console.log(JSON.stringify(report, null, 2));
		else if (args.quiet) console.log(renderDubSummary(report, rel(reportPath)).split('\n')[0]);
		else console.log(renderDubSummary(report, rel(reportPath)));
		return report.pass ? 0 : 1;
	} catch (e) {
		if (e instanceof InputError) {
			console.error(`dub: ${e.message}`);
			return 2;
		}
		throw e;
	}
};
