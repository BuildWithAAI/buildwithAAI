/**
 * node scripts/backtranslate/cli.ts <prepare|import|compare> <episode> --lang es|pt-br [options]
 * Exit codes: 0 ok (compare: verdict REVIEW or CLEAR) · 1 compare verdict FIX or INCOMPLETE, or import
 * rejected items · 2 bad input (usage, missing files, bad JSON).
 */
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {compareAll} from './compare.ts';
import {GlossaryError, loadGlossary} from './glossary.ts';
import {checkWho, ImportError, importFilled, parseFilled, validateRecord} from './importer.ts';
import {defaultRecordPath, defaultWorkDir, InputError, loadJson, loadStoryboards, resolveTarget, STUDIO, type Target} from './load.ts';
import {buildReport, renderMarkdown, renderSummary} from './report.ts';
import {copySegments, storyboardSegments, type SegmentSet} from './segments.ts';
import {BACK_METHODS, isTargetLang, type BackMethod, type BackTranslation, type TargetLang} from './types.ts';
import {buildWorksheet, renderWorksheetMarkdown} from './worksheet.ts';

export const USAGE = `Back-translation check: Spanish and Brazilian Portuguese scripts, translated back to English and compared.

Usage (run from projects/video-studio/):
  node scripts/backtranslate/cli.ts prepare <episode> --lang es|pt-br [--all]
  node scripts/backtranslate/cli.ts import  <episode> --lang es|pt-br --from <filled worksheet .json|.md>
                                            --by claude-session|human --who <initials or role> (--blind | --saw-source)
  node scripts/backtranslate/cli.ts compare <episode> --lang es|pt-br [--json] [-q]

<episode>: <channel>/<slug> (content/), _dev/<slug> (dev fixtures), a folder with storyboard.json, or a
           channel-copy .md file with "\`\`\`text id=<id>" blocks and their "id=<id>-<lang>" translations.

Options:
  --work-dir <dir>     worksheet and report folder (default: out/backtranslate/<channel>/<slug>/<lang>)
  --record <file>      the back-translation record (default: <episode>/dub/backtranslation.<lang>.json for content/
                       episodes, else <work-dir>/backtranslation.json)
  --glossary <file>    extra glossary terms (repeatable; same format as scripts/backtranslate/glossary.json)
  --all                prepare: put every segment in the worksheet, not only those without a current back-translation
  --date <YYYY-MM-DD>  import: the date recorded (default: today in America/Chicago)
  --json               compare: print the report JSON
  -q, --quiet          compare: print only the verdict line

The back-translation is made by a Claude session or a person, never by a translation API. Work blind: whoever
back-translates must not read the English first (say --saw-source if they did).

Verdicts: FIX (high-risk findings) · REVIEW (medium findings for the native reviewer) · CLEAR · INCOMPLETE (segments
without a back-translation of the current text).
Exit codes: 0 ok (compare: REVIEW or CLEAR), 1 compare FIX or INCOMPLETE / import rejected items, 2 bad input.`;

type Args = {
	cmd?: string;
	target?: string;
	lang?: string;
	workDir?: string;
	record?: string;
	glossary: string[];
	all: boolean;
	from?: string;
	by?: string;
	who?: string;
	blind?: boolean;
	date?: string;
	json: boolean;
	quiet: boolean;
	help: boolean;
};

export const parseArgs = (argv: string[]): Args => {
	const a: Args = {glossary: [], all: false, json: false, quiet: false, help: false};
	for (let i = 0; i < argv.length; i++) {
		const k = argv[i];
		const val = () => {
			const v = argv[++i];
			if (v === undefined || (v.startsWith('--') && v.length > 2)) throw new InputError(`${k} needs a value`);
			return v;
		};
		if (k === '--lang') a.lang = val();
		else if (k === '--work-dir') a.workDir = val();
		else if (k === '--record') a.record = val();
		else if (k === '--glossary') a.glossary.push(val());
		else if (k === '--all') a.all = true;
		else if (k === '--from') a.from = val();
		else if (k === '--by') a.by = val();
		else if (k === '--who') a.who = val();
		else if (k === '--blind') {
			if (a.blind === false) throw new InputError('give either --blind or --saw-source, not both');
			a.blind = true;
		} else if (k === '--saw-source') {
			if (a.blind === true) throw new InputError('give either --blind or --saw-source, not both');
			a.blind = false;
		} else if (k === '--date') a.date = val();
		else if (k === '--json') a.json = true;
		else if (k === '-q' || k === '--quiet') a.quiet = true;
		else if (k === '-h' || k === '--help') a.help = true;
		else if (k.startsWith('-')) throw new InputError(`unknown option ${k}`);
		else if (!a.cmd) a.cmd = k;
		else if (!a.target) a.target = k;
		else throw new InputError(`unexpected argument ${k}`);
	}
	return a;
};

export const todayChicago = (d = new Date()): string => new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit'}).format(d);

const langOf = (a: Args): TargetLang => {
	if (!a.lang) throw new InputError('--lang es|pt-br is required');
	if (/^fr(?:-|$)/i.test(a.lang)) throw new InputError('French is excluded (Kokoro has no male French voice for Zoo)');
	if (!isTargetLang(a.lang)) throw new InputError(`--lang ${a.lang}: the back-translation check covers es and pt-br (the launch languages)`);
	return a.lang;
};

export type Loaded = {target: Target; lang: TargetLang; set: SegmentSet; translationStatus: string; workDir: string; recordPath: string};

export const loadEpisode = async (a: Args, cwd = process.cwd()): Promise<Loaded> => {
	const lang = langOf(a);
	if (!a.target) throw new InputError('give the episode: <channel>/<slug>, _dev/<slug>, a folder, or a channel-copy .md file');
	const target = resolveTarget(a.target, lang, cwd);
	let set: SegmentSet;
	let translationStatus = 'not applicable (channel copy)';
	if (target.kind === 'storyboard') {
		const {source, translation} = loadStoryboards(target, lang);
		set = await storyboardSegments(source, translation, lang);
		const tr = translation.translation as {status?: string; method?: string; reviewed?: boolean; reviewer?: string} | undefined;
		translationStatus = tr ? `status "${tr.status ?? '?'}"${tr.method ? `, method "${tr.method}"` : ''}${tr.reviewed ? `, reviewed by ${tr.reviewer ?? '?'}` : ', not native-reviewed yet'}` : 'no translation record (treated as machine translation)';
	} else set = copySegments(target, lang);
	const workDir = a.workDir ? resolve(cwd, a.workDir) : defaultWorkDir(target, lang);
	const recordPath = a.record ? resolve(cwd, a.record) : defaultRecordPath(target, lang, workDir);
	return {target, lang, set, translationStatus, workDir, recordPath};
};

const readRecord = (path: string, lang: TargetLang): BackTranslation | null => (existsSync(path) ? validateRecord(loadJson(path), path, lang) : null);

const show = (p: string): string => {
	const rel = relative(process.cwd(), p);
	return !rel || rel.startsWith('..') ? p : rel;
};

const writeFile = (path: string, text: string) => {
	mkdirSync(dirname(path), {recursive: true});
	writeFileSync(path, text);
};

export const runPrepare = async (a: Args): Promise<number> => {
	const ep = await loadEpisode(a);
	const record = readRecord(ep.recordPath, ep.lang);
	const now = new Date().toISOString();
	const {worksheet, total, current, missingTranslation} = buildWorksheet({channel: ep.target.channel, slug: ep.target.slug, lang: ep.lang, now}, ep.set.segments, record, a.all);
	const json = join(ep.workDir, 'worksheet.json');
	const md = join(ep.workDir, 'worksheet.md');
	writeFile(json, `${JSON.stringify(worksheet, null, 2)}\n`);
	writeFile(md, renderWorksheetMarkdown(worksheet));
	console.log(`backtranslate prepare: ${ep.target.channel}/${ep.target.slug} (${ep.lang}): ${worksheet.items.length} of ${total} translated segments need a back-translation (${current} already current).`);
	console.log(`  worksheet: ${show(md)} (for a person) and ${show(json)} (for a Claude session). Neither contains the English.`);
	if (missingTranslation.length) console.log(`  not translated in storyboard.${ep.lang}.json (reported by compare): ${missingTranslation.join(', ')}`);
	for (const n of ep.set.notes) console.log(`  note: ${n}`);
	return 0;
};

export const runImport = async (a: Args): Promise<number> => {
	const ep = await loadEpisode(a);
	if (!a.from) throw new InputError('--from <filled worksheet> is required');
	if (!a.by || !BACK_METHODS.includes(a.by as BackMethod)) throw new InputError(`--by must be one of: ${BACK_METHODS.join(', ')} (a translation API is not allowed)`);
	const whoProblem = checkWho(a.who ?? '');
	if (whoProblem) throw new InputError(whoProblem);
	if (a.blind === undefined) throw new InputError('say whether the back-translator read the English first: --blind (did not) or --saw-source (did)');
	if (a.date && !/^\d{4}-\d{2}-\d{2}$/.test(a.date)) throw new InputError('--date must be YYYY-MM-DD');
	const from = resolve(a.from);
	if (!existsSync(from)) throw new InputError(`no file ${a.from}`);
	const {items, meta} = parseFilled(readFileSync(from, 'utf8'), a.from);
	if (meta.lang && meta.lang !== ep.lang) throw new InputError(`${a.from} is a ${meta.lang} worksheet, not ${ep.lang}`);
	if (meta.slug && meta.slug !== ep.target.slug) throw new InputError(`${a.from} is for ${meta.channel ?? '?'}/${meta.slug}, not ${ep.target.channel}/${ep.target.slug}`);
	const existing = readRecord(ep.recordPath, ep.lang);
	const out = importFilled(ep.set.segments, existing, items, {channel: ep.target.channel, slug: ep.target.slug, lang: ep.lang, method: a.by as BackMethod, by: a.who as string, blind: a.blind, date: a.date ?? todayChicago()});
	if (out.imported.length) writeFile(ep.recordPath, `${JSON.stringify(out.record, null, 2)}\n`);
	console.log(`backtranslate import: ${out.imported.length} imported, ${out.unfilled.length} left empty, ${out.rejected.length} rejected · ${show(ep.recordPath)}`);
	for (const r of out.rejected) console.log(`  rejected ${r.id}: ${r.why}`);
	if (out.unfilled.length) console.log(`  empty (not imported): ${out.unfilled.join(', ')}`);
	for (const w of out.warnings) console.log(`  warning: ${w}`);
	const translated = ep.set.segments.filter((s) => s.hash !== null);
	const covered = translated.filter((s) => out.record.segments[s.id]?.hash === s.hash).length;
	console.log(`  coverage: ${covered} of ${translated.length} translated segments have a current back-translation. Next: compare.`);
	return out.rejected.length ? 1 : 0;
};

export const runCompare = async (a: Args): Promise<number> => {
	const ep = await loadEpisode(a);
	const glossary = loadGlossary(a.glossary.map((g) => resolve(g)));
	const record = readRecord(ep.recordPath, ep.lang);
	const {results, notes} = compareAll(ep.set.segments, record, ep.lang, glossary);
	const report = buildReport({
		channel: ep.target.channel,
		slug: ep.target.slug,
		lang: ep.lang,
		generatedAt: new Date().toISOString(),
		results,
		notes: [...ep.set.notes, ...notes],
		translationStatus: ep.translationStatus,
		glossaryFiles: glossary.files.map((f) => relative(STUDIO, f)),
	});
	const md = join(ep.workDir, 'report.md');
	writeFile(md, renderMarkdown(report));
	writeFile(join(ep.workDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
	if (a.json) console.log(JSON.stringify(report, null, 2));
	else if (a.quiet) console.log(renderSummary(report, show(md)).split('\n')[0]);
	else console.log(renderSummary(report, show(md)));
	return report.verdict === 'FIX' || report.verdict === 'INCOMPLETE' ? 1 : 0;
};

export const main = async (argv: string[]): Promise<number> => {
	let args: Args;
	try {
		args = parseArgs(argv);
	} catch (e) {
		console.error(`backtranslate: ${(e as Error).message}\n\n${USAGE}`);
		return 2;
	}
	if (args.help || !args.cmd) {
		console.log(USAGE);
		return args.help ? 0 : 2;
	}
	try {
		if (args.cmd === 'prepare') return await runPrepare(args);
		if (args.cmd === 'import') return await runImport(args);
		if (args.cmd === 'compare') return await runCompare(args);
		throw new InputError(`unknown command "${args.cmd}" (prepare, import or compare)`);
	} catch (e) {
		if (e instanceof InputError || e instanceof ImportError || e instanceof GlossaryError) {
			console.error(`backtranslate: ${e.message}`);
			return 2;
		}
		throw e;
	}
};

export {STUDIO};
