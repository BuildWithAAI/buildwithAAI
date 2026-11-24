/**
 * The proof, as code (used by proof/run.ts and the tests):
 *  1. Clean runs: the engine-demo Spanish and Portuguese storyboards (and the show excerpt) go through the normal
 *     path (prepare -> fill the worksheet from the stored literal back-translation -> import -> compare).
 *  2. Injected runs: each deliberate error in injections.ts is applied to a scratch copy of the translation, with the
 *     literal back-translation of the edited text, and compared. It is caught when one of its expected findings
 *     appears on that segment at the expected severity, and no other segment gains a high or medium finding.
 * Writes only under the given output folder; the fixtures are copied, never edited.
 */
import {copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {compareAll} from '../lib/compare.ts';
import {loadGlossary} from '../lib/glossary.ts';
import {importFilled} from '../lib/importer.ts';
import {loadStoryboards, resolveTarget, STUDIO} from '../lib/load.ts';
import {buildReport, renderMarkdown} from '../lib/report.ts';
import {copySegments, storyboardSegments} from '../lib/segments.ts';
import type {BackMethod, Finding, Report, Severity, TargetLang} from '../lib/types.ts';
import {buildWorksheet, renderWorksheetMarkdown} from '../lib/worksheet.ts';
import {INJECTIONS, type Injection} from './injections.ts';

export const PROOF_DIR = dirname(fileURLToPath(import.meta.url));

export type FixtureKey = Injection['fixture'] | 'channel-copy';

/** `dir` is a storyboard folder or a channel-copy .md file; `live` is the current file in content/, checked too. */
export const FIXTURES: Record<FixtureKey, {dir: string; label: string; live?: string}> = {
	'content-demo': {dir: join(PROOF_DIR, 'zoora-ai-engine-demo'), label: 'zoora-ai/_engine-demo (snapshot)', live: join(STUDIO, 'content', 'zoora-ai', '_engine-demo')},
	'engine-demo': {dir: join(STUDIO, 'src', 'episode', 'dev', 'fixtures', 'engine-demo'), label: '_dev/engine-demo'},
	'show-excerpt': {dir: join(PROOF_DIR, 'show-excerpt'), label: 'show excerpt (test data)'},
	'channel-copy': {dir: join(PROOF_DIR, 'channel-copy', 'description.md'), label: 'Zoora AI channel description drafts (snapshot)', live: join(STUDIO, 'content', 'zoora-ai', 'channel-copy.md')},
};

const FIXTURE_FOLDER: Record<FixtureKey, string> = {'content-demo': 'zoora-ai-engine-demo', 'engine-demo': 'engine-demo', 'show-excerpt': 'show-excerpt', 'channel-copy': 'channel-copy'};

export type StoredBack = {lang: TargetLang; method: BackMethod; by: string; blind: boolean; date: string; items: Record<string, {text: string; bt: string}>};

export const storedBack = (fixture: FixtureKey, lang: TargetLang): StoredBack | null => {
	const p = join(PROOF_DIR, FIXTURE_FOLDER[fixture], `backtranslation.${lang}.json`);
	return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as StoredBack) : null;
};

export type EpisodeRun = {report: Report; stale: string[]; imported: number; rejected: Array<{id: string; why: string}>; workDir: string};

const write = (p: string, s: string) => {
	mkdirSync(dirname(p), {recursive: true});
	writeFileSync(p, s);
};

/** prepare -> fill from the stored back-translation (plus overrides) -> import -> compare, all on disk under workDir. */
export const runEpisode = async (dir: string, lang: TargetLang, stored: StoredBack, workDir: string, overrides: Record<string, string> = {}): Promise<EpisodeRun> => {
	const target = resolveTarget(dir, lang);
	let translation: Record<string, unknown> = {};
	let set;
	if (target.kind === 'storyboard') {
		const sb = loadStoryboards(target, lang);
		translation = sb.translation;
		set = await storyboardSegments(sb.source, sb.translation, lang);
	} else set = copySegments(target, lang);
	const prep = buildWorksheet({channel: target.channel, slug: target.slug, lang, now: '2026-11-24T00:00:00.000Z'}, set.segments, null, true);
	write(join(workDir, 'worksheet.json'), `${JSON.stringify(prep.worksheet, null, 2)}\n`);
	write(join(workDir, 'worksheet.md'), renderWorksheetMarkdown(prep.worksheet));
	const stale: string[] = [];
	for (const it of prep.worksheet.items) {
		if (overrides[it.id] !== undefined) it.bt = overrides[it.id];
		else if (stored.items[it.id]?.text === it.text) it.bt = stored.items[it.id].bt;
		else stale.push(it.id);
	}
	write(join(workDir, 'filled.json'), `${JSON.stringify(prep.worksheet, null, 2)}\n`);
	const imp = importFilled(set.segments, null, prep.worksheet.items, {channel: target.channel, slug: target.slug, lang, method: stored.method, by: stored.by, blind: stored.blind, date: stored.date});
	write(join(workDir, 'backtranslation.json'), `${JSON.stringify(imp.record, null, 2)}\n`);
	const glossary = loadGlossary();
	const {results, notes} = compareAll(set.segments, imp.record, lang, glossary);
	const tr = translation.translation as {status?: string} | undefined;
	const report = buildReport({
		channel: target.channel,
		slug: target.slug,
		lang,
		generatedAt: '2026-11-24T00:00:00.000Z',
		results,
		notes: [...set.notes, ...notes],
		translationStatus: target.kind === 'copy' ? 'channel copy (drafts, no translation record)' : tr?.status ? `status "${tr.status}"` : 'no translation record',
		glossaryFiles: ['scripts/backtranslate/glossary.json'],
	});
	write(join(workDir, 'report.md'), renderMarkdown(report));
	write(join(workDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
	return {report, stale, imported: imp.imported.length, rejected: imp.rejected, workDir};
};

type Raw = Record<string, unknown>;

/** Edit one segment's raw string in a storyboard object (title, narration, onScreen field or list item, Short title, thumbnail, UI label). */
export const editSegment = (sb: Raw, id: string, fn: (s: string) => string): void => {
	const scenes = (sb.scenes ?? []) as Raw[];
	const sceneOf = (sid: string): Raw => {
		const s = scenes.find((x) => x.id === sid);
		if (!s) throw new Error(`no scene ${sid}`);
		return s;
	};
	let m: RegExpExecArray | null;
	if (id === 'title') sb.title = fn(String(sb.title));
	else if ((m = /^(.+)\.narration$/.exec(id))) {
		const s = sceneOf(m[1]);
		s.narration = fn(String(s.narration));
	} else if ((m = /^(.+)\.onScreen\.(\w+)(?:\.(\d+))?$/.exec(id))) {
		const on = sceneOf(m[1]).onScreen as Raw;
		if (m[3] === undefined) on[m[2]] = fn(String(on[m[2]]));
		else (on[m[2]] as string[])[Number(m[3])] = fn((on[m[2]] as string[])[Number(m[3])]);
	} else if ((m = /^ui\.(\w+)$/.exec(id))) (sb.ui as Raw)[m[1]] = fn(String((sb.ui as Raw)[m[1]]));
	else throw new Error(`editSegment: unsupported id ${id}`);
};

const RANK: Record<Severity, number> = {high: 0, medium: 1, low: 2, info: 3};

export type InjectionResult = {
	injection: Injection;
	caught: boolean;
	matched: Finding[];
	allOnSegment: Finding[];
	crossTalk: string[];
	verdict: Report['verdict'];
	workDir: string;
};

const serious = (r: Report): Set<string> => new Set(r.segments.flatMap((s) => s.findings.filter((f) => f.severity === 'high' || f.severity === 'medium').map((f) => `${s.id}|${f.code}`)));

export const runInjection = async (inj: Injection, out: string, clean: Report): Promise<InjectionResult> => {
	const fx = FIXTURES[inj.fixture];
	const stored = storedBack(inj.fixture, inj.lang);
	if (!stored) throw new Error(`no stored back-translation for ${inj.fixture} ${inj.lang}`);
	const scratch = join(out, 'injected', inj.key);
	mkdirSync(scratch, {recursive: true});
	copyFileSync(join(fx.dir, 'storyboard.json'), join(scratch, 'storyboard.json'));
	const tr = JSON.parse(readFileSync(join(fx.dir, `storyboard.${inj.lang}.json`), 'utf8')) as Raw;
	editSegment(tr, inj.segment, (s) => {
		if (!s.includes(inj.find)) throw new Error(`${inj.key}: "${inj.find}" is not in ${inj.segment} (the fixture changed?)`);
		return s.replace(inj.find, inj.replace);
	});
	writeFileSync(join(scratch, `storyboard.${inj.lang}.json`), `${JSON.stringify(tr, null, 2)}\n`);
	const run = await runEpisode(scratch, inj.lang, stored, join(scratch, 'work'), {[inj.segment]: inj.back});
	const seg = run.report.segments.find((s) => s.id === inj.segment);
	const allOnSegment = seg?.findings ?? [];
	const matched = allOnSegment.filter((f) => inj.expect.includes(f.code) && RANK[f.severity] <= RANK[inj.minSeverity]);
	const before = serious(clean);
	const crossTalk = [...serious(run.report)].filter((k) => !before.has(k) && !k.startsWith(`${inj.segment}|`));
	return {injection: inj, caught: matched.length > 0, matched, allOnSegment, crossTalk, verdict: run.report.verdict, workDir: run.workDir};
};

export type ProofResult = {
	clean: Array<{fixture: FixtureKey; lang: TargetLang; run: EpisodeRun; live?: boolean}>;
	injected: InjectionResult[];
};

export const runProof = async (out: string, only?: (inj: Injection) => boolean): Promise<ProofResult> => {
	const clean: ProofResult['clean'] = [];
	const cleanByKey = new Map<string, Report>();
	const pairs: Array<[FixtureKey, TargetLang]> = [
		['content-demo', 'es'],
		['content-demo', 'pt-br'],
		['engine-demo', 'es'],
		['engine-demo', 'pt-br'],
		['show-excerpt', 'es'],
		['channel-copy', 'es'],
		['channel-copy', 'pt-br'],
	];
	for (const [fixture, lang] of pairs) {
		const stored = storedBack(fixture, lang);
		if (!stored) continue;
		const run = await runEpisode(FIXTURES[fixture].dir, lang, stored, join(out, 'clean', `${fixture}.${lang}`));
		clean.push({fixture, lang, run});
		cleanByKey.set(`${fixture}|${lang}`, run.report);
		// the live episode, when it exists: segments changed since the snapshot show up as stale (not checked)
		const live = FIXTURES[fixture].live;
		if (live && (live.endsWith('.md') ? existsSync(live) : existsSync(join(live, `storyboard.${lang}.json`)))) {
			const liveRun = await runEpisode(live, lang, stored, join(out, 'clean', `${fixture}.${lang}.live`));
			clean.push({fixture, lang, run: liveRun, live: true});
		}
	}
	const injected: InjectionResult[] = [];
	for (const inj of INJECTIONS.filter((i) => (only ? only(i) : true))) {
		const base = cleanByKey.get(`${inj.fixture}|${inj.lang}`);
		if (!base) throw new Error(`no clean run for ${inj.fixture} ${inj.lang}`);
		injected.push(await runInjection(inj, out, base));
	}
	return {clean, injected};
};
