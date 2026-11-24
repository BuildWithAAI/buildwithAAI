/**
 * Threat Brief CLI (run from projects/creator-hub; relative paths resolve from the directory you ran it in).
 *
 *   node tools/threat-brief/cli.ts draft --radar <radar.json> [--show <kit.json>] [options]
 *   node tools/threat-brief/cli.ts lint <brief.md|brief.html>
 *   node tools/threat-brief/cli.ts --input <post-input.json> --out <dir> [--dry-run]     (the daily pipeline's call)
 *
 * `draft` builds the radar brief, lints it, and only if the lint passes writes <out>/<date>.md and <date>.html. With
 * --kit-draft it also creates a DRAFT broadcast in Kit; nothing is ever sent or scheduled by this tool.
 * The daily call builds the email from the approved PostInput only (daily.ts), never from the radar, and creates a
 * Kit draft only under the owner's daily content approval for that exact episode.
 * Exit codes: 0 ok, 1 problems found (nothing written, or the Kit draft was not created), 2 usage error.
 */
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {extname, isAbsolute, relative, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {approvalLine, checkApproval, DAILY_APPROVAL_KIND, dailyApprovalPath} from '../announcer/approval.ts';
import {clearance, LedgerError, ledgerKey, newEntry, putEntry, readLedger, withLedgerLock} from '../announcer/ledger.ts';
import {createBroadcastDraft, KitApiError, parseSubscriberFilter, type SubscriberFilter} from '../newsletter/kit-api.ts';
import {isYoutubeId} from '../newsletter/publish-kit.ts';
import {buildBrief, DEFAULT_BRAND, DEFAULT_COUNT, MAX_COUNT, type ShowInfo} from './brief.ts';
import {buildDailyBrief, checkPostInput, lintDailyBrief, lintDailyRendered, renderDailyEmailContent, renderDailyEmailHtml, renderDailyMarkdown} from './daily.ts';
import {lintBrief, lintFile, lintRendered} from './lint.ts';
import {readRadar} from './radar.ts';
import {renderEmailContent, renderEmailHtml, renderMarkdown} from './render.ts';
import {formatFindings, hasErrors, loadAllowlist, makeAllow, type Finding, type NameAllow} from './safety.ts';
import {readShowKit} from './show.ts';

const PROJECT_DIR = fileURLToPath(new URL('../../', import.meta.url));
export const DEFAULT_ALLOWLIST = resolve(PROJECT_DIR, '../video-studio/scripts/news/allowlist.json');
/** projects/video-studio: the paths inside approval records are relative to it. */
export const DEFAULT_STUDIO_ROOT = resolve(PROJECT_DIR, '../video-studio');
const DEFAULT_OUT = resolve(PROJECT_DIR, 'out/threat-brief');
const DEFAULT_LEDGER = resolve(PROJECT_DIR, 'data/threat-brief/ledger.json');

export const USAGE = `Usage:
  node tools/threat-brief/cli.ts draft --radar <radar.json> [--show <kit.json>] [options]
  node tools/threat-brief/cli.ts lint <brief.md|brief.html>
  node tools/threat-brief/cli.ts --input <post-input.json> --out <dir> [--dry-run]   (daily pipeline, after APPROVE)

draft options:
  --radar <file>        the news radar's daily file (content/zoora-security/radar/<date>.json). Required.
  --show <kit.json>     today's episode (publish kit): its title, YouTube link and One Fix go into the brief
  --youtube-id <id>     the video's YouTube id, when kit.json does not have it yet
  --fix <text>          Zoo's One Fix (default: the show's, else the fix for the top incident's topic)
  --count <n>           incidents to include, 1-${MAX_COUNT} (default ${DEFAULT_COUNT})
  --out <dir>           where to write <date>.md and <date>.html (default: out/threat-brief)
  --allowlist <file>    names that are not people (default: ../video-studio/scripts/news/allowlist.json)
  --brand <name>        show name (default: "${DEFAULT_BRAND}")
  --kit-draft           also create a DRAFT broadcast in Kit (needs KIT_API_KEY). It is never sent or scheduled.
                        Choose its recipients with THREAT_BRIEF_KIT_FILTER=tag:<id> (the Threat Brief sign-up
                        tag), or pass --all-subscribers if every subscriber asked for the Threat Brief.
  --all-subscribers     with --kit-draft: no subscriber filter (Kit's default audience: all subscribers)
  --new-draft           with --kit-draft: create another draft although one exists (or may exist) for this date
  --ledger <file>       Kit-draft ledger (default: data/threat-brief/ledger.json, gitignored; THREAT_BRIEF_LEDGER
                        overrides it, relative to projects/creator-hub)

daily options (the email is built only from the approved input; the radar is never read):
  --dry-run             write the files only. Without it a Kit draft is created when KIT_API_KEY is set, and only
                        under the owner's daily content approval for this episode.
  --approval <file>     the approval record (default: <studio>/content/zoora-security/<slug>/approval.json)
  --studio-root <dir>   projects/video-studio, where the approval's paths point (default: ../video-studio)
  --allowlist, --ledger, --all-subscribers   as for draft`;

export type CliDeps = {
	env: Record<string, string | undefined>;
	cwd: string;
	fetch: typeof fetch;
	now: () => Date;
	print: (line: string) => void;
	printError: (line: string) => void;
};

const displayPath = (cwd: string, path: string): string => {
	const rel = relative(cwd, path);
	return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : path;
};

const sha256 = (text: string | Buffer): string => createHash('sha256').update(text).digest('hex');

/**
 * The ledger file: --ledger relative to where you ran the command; THREAT_BRIEF_LEDGER relative to the hub, so a
 * manual run (from creator-hub) and the daily's call (from video-studio) share one ledger and never draft twice.
 */
export const ledgerPath = (flag: unknown, env: Record<string, string | undefined>, cwd: string): string =>
	typeof flag === 'string' ? resolve(cwd, flag) : env.THREAT_BRIEF_LEDGER?.trim() ? resolve(PROJECT_DIR, env.THREAT_BRIEF_LEDGER.trim()) : DEFAULT_LEDGER;

const loadAllow = (file: string | undefined, deps: CliDeps, notes: string[]): NameAllow | null => {
	const path = file ? resolve(deps.cwd, file) : DEFAULT_ALLOWLIST;
	if (!existsSync(path)) {
		if (file) {
			deps.printError(`Allowlist not found: ${displayPath(deps.cwd, path)}`);
			return null;
		}
		notes.push(`no names allowlist at ${displayPath(deps.cwd, path)}: only the radar's own names are known, so expect more name warnings`);
		return makeAllow([]);
	}
	const {allow, error} = loadAllowlist(path);
	if (!allow) deps.printError(error ?? `cannot read ${path}`);
	return allow;
};

// ---------------------------------------------------------------------------------------------
// Kit draft (shared by both commands)

type KitDraftRequest = {date: string; subject: string; preview: string; content: string; description: string; event: string};
type KitTarget = {ledgerFile: string; newDraft: boolean; filter: SubscriberFilter | null; apiKey: string};

/** Checks the key before anything is recorded: a request that is never sent must not leave a "pending" entry. */
const kitKeyProblem = (key: string): string | null =>
	!key ? 'KIT_API_KEY is not set (a v4 key from Kit > Settings > Developer).' : /[\s\0-\x1f]/.test(key) ? 'KIT_API_KEY contains spaces or control characters.' : null;

/**
 * Creates one Kit draft under the ledger (write-ahead). Returns a report line, or throws an Error to print.
 * Only a refusal from Kit (an HTTP 3xx or 4xx answer) is recorded as "failed": no draft exists and a later run may
 * try again. Anything else stays "pending", because a draft may exist: no answer, a 5xx, or a 2xx answer that could
 * not be confirmed (an unreadable body, no broadcast id, or a broadcast Kit reports as scheduled).
 */
const createKitDraft = async (req: KitDraftRequest, target: KitTarget, deps: CliDeps): Promise<string> => {
	const scope = `threat-brief/${req.date}`;
	const key = ledgerKey(scope, 'kit-draft');
	return withLedgerLock(target.ledgerFile, async (lock) => {
		const ledger = readLedger(target.ledgerFile);
		const clear = clearance(ledger, key);
		if (!clear.ok && !target.newDraft) throw new Error(`Kit draft not created: ${clear.reason.replace('already posted', 'a draft was already created')}. Pass --new-draft to create another one.`);
		lock.assertHeld();
		const at = deps.now().toISOString();
		const entry = newEntry(scope, 'kit-draft', sha256(req.content), at, clear.ok ? clear.previous : clear.entry);
		putEntry(target.ledgerFile, entry);
		const recipients = target.filter ? `subscribers with ${target.filter.type} ${target.filter.ids.join(' and ')}` : 'all subscribers';
		try {
			const created = await createBroadcastDraft(
				{subject: req.subject, content: req.content, previewText: req.preview, description: `${req.description} For ${recipients}. Check it and its recipients in Kit, then send it from Kit.`, subscriberFilter: target.filter},
				{apiKey: target.apiKey, fetch: deps.fetch},
			);
			const done = deps.now().toISOString();
			putEntry(target.ledgerFile, {...entry, state: 'posted', postedAt: done, remoteId: String(created.id), history: [...entry.history, {at: done, event: `draft ${created.id} created (${req.event})`}]});
			return `  created Kit broadcast draft ${created.id} for ${recipients}. It has NOT been sent or scheduled: review it and its recipients in Kit.`;
		} catch (err) {
			const status = err instanceof KitApiError ? err.status : null;
			const definite = status !== null && status >= 300 && status < 500;
			const message = err instanceof Error ? err.message : String(err);
			putEntry(target.ledgerFile, {...entry, state: definite ? 'failed' : 'pending', error: message, history: [...entry.history, {at: deps.now().toISOString(), event: `error: ${message}`}]});
			if (definite) throw new Error(`Kit draft not created: ${message}`);
			throw new Error(
				`Kit draft NOT CONFIRMED: ${message} A draft may exist: check your Kit broadcasts. The ledger blocks this date until you do; if there is no draft, run again with --new-draft.`,
			);
		}
	});
};

const recipientsProblem = (filter: SubscriberFilter | null, allSubscribers: boolean): string | null =>
	!filter && !allSubscribers
		? 'Kit draft not created: choose who it is for. Set THREAT_BRIEF_KIT_FILTER=tag:<id> (or segment:<id>) to the tag of the Threat Brief\nsign-up, or pass --all-subscribers if every subscriber on the account asked for the daily Threat Brief.'
		: null;

// ---------------------------------------------------------------------------------------------
// draft: the radar brief

type DraftJob = {
	radarFile: string;
	show: ShowInfo | null;
	fix: string | null;
	count: number;
	outDir: string;
	allowlist: string | undefined;
	brandName: string;
	kitDraft: boolean;
	allSubscribers: boolean;
	newDraft: boolean;
	ledgerFile: string;
};

const runDraft = async (job: DraftJob, deps: CliDeps): Promise<number> => {
	const show = (path: string): string => displayPath(deps.cwd, path);
	const notes: string[] = [];
	const baseAllow = loadAllow(job.allowlist, deps, notes);
	if (!baseAllow) return 1;
	const {radar, errors, warnings} = readRadar(job.radarFile);
	if (!radar) {
		deps.printError(`The radar file has problems:\n${errors.map((e) => `  ${e}`).join('\n')}`);
		return 1;
	}
	notes.push(...warnings);
	const kitApiKey = (deps.env.KIT_API_KEY ?? '').trim();
	const filterText = (deps.env.THREAT_BRIEF_KIT_FILTER ?? '').trim();
	const filter = filterText ? parseSubscriberFilter(filterText) : null;
	if (job.kitDraft && filterText && !filter) {
		deps.printError(`THREAT_BRIEF_KIT_FILTER must look like tag:123, segment:7 or tag:12,34.\n\n${USAGE}`);
		return 2;
	}

	const {brief, notes: buildNotes, allow} = buildBrief(radar, {
		allow: baseAllow,
		count: job.count,
		show: job.show,
		fix: job.fix,
		brandName: job.brandName,
		now: deps.now(),
		radarFile: show(job.radarFile),
	});
	notes.push(...buildNotes);
	const md = renderMarkdown(brief);
	const html = renderEmailHtml(brief);
	const findings: Finding[] = [...lintBrief(brief, allow), ...lintRendered(md, html, brief, {allow})];

	const report = [`Threat Brief ${brief.date}: ${brief.subject}`];
	report.push(`  radar: ${show(job.radarFile)} (${radar.mode}, generated ${radar.generatedUtc || 'unknown'})`);
	report.push(`  incidents: ${brief.incidents.map((i) => `${i.protocol} (${i.label})`).join(', ') || 'none'}`);
	report.push(`  Zoo's One Fix: ${brief.fix.source === 'table' ? `the fix for "${brief.fix.topic ?? 'general'}"` : brief.fix.source === 'show' ? "the show's" : '--fix'}`);
	report.push(`  show: ${brief.show ? `${brief.show.title} (${brief.show.url ?? 'link pending'})` : 'none (no --show)'}`);
	for (const note of notes) report.push(`  note: ${note}`);
	const failures = findings.filter((f) => f.level === 'error');
	report.push(...formatFindings(findings.filter((f) => f.level === 'warning')));
	if (failures.length > 0) {
		deps.printError([...report, ...formatFindings(failures), `The lint found ${failures.length} problem(s). No files were written.`].join('\n'));
		return 1;
	}

	mkdirSync(job.outDir, {recursive: true});
	const mdFile = resolve(job.outDir, `${brief.date}.md`);
	const htmlFile = resolve(job.outDir, `${brief.date}.html`);
	writeFileSync(mdFile, md);
	writeFileSync(htmlFile, html);
	report.push(`  wrote ${show(mdFile)}`, `  wrote ${show(htmlFile)}`);

	if (job.kitDraft) {
		const keyProblem = kitKeyProblem(kitApiKey);
		if (keyProblem) {
			deps.printError([...report, `Kit draft not created: ${keyProblem}`].join('\n'));
			return 1;
		}
		// what goes to Kit must be final: a pending show link or any other placeholder blocks the draft
		const finalErrors = [...lintBrief(brief, allow, {final: true}), ...lintRendered(md, html, brief, {final: true, allow})].filter((f) => f.level === 'error');
		if (finalErrors.length > 0) {
			deps.printError([...report, ...formatFindings(finalErrors), 'Kit draft not created: the brief is not final yet (the files above were written for review).'].join('\n'));
			return 1;
		}
		const who = recipientsProblem(filter, job.allSubscribers);
		if (who) {
			deps.printError([...report, who].join('\n'));
			return 1;
		}
		try {
			report.push(
				await createKitDraft(
					{date: brief.date, subject: brief.subject, preview: brief.preview, content: renderEmailContent(brief), description: `Threat Brief ${brief.date} (radar brief) from creator-hub.`, event: 'radar brief'},
					{ledgerFile: job.ledgerFile, newDraft: job.newDraft, filter, apiKey: kitApiKey},
					deps,
				),
			);
		} catch (err) {
			if (!(err instanceof Error)) throw err;
			deps.printError([...report, err.message].join('\n'));
			return 1;
		}
	} else {
		report.push('Next: open the .html file to check it, then paste it into a Kit broadcast (or run again with --kit-draft).');
	}
	report.push('Nothing was sent. Kit adds the unsubscribe link and your postal address to every email.');
	deps.print(report.join('\n'));
	return 0;
};

type OptionSpec = Record<string, {type: 'string' | 'boolean'}>;
type Parsed = {values: Record<string, string | boolean | undefined>; positionals: string[]};

const parse = (args: string[], options: OptionSpec, deps: CliDeps): Parsed | null => {
	try {
		const {values, positionals} = parseArgs({args, allowPositionals: true, strict: true, options});
		return {values: values as Parsed['values'], positionals};
	} catch (err) {
		deps.printError(`${(err as Error).message}\n\n${USAGE}`);
		return null;
	}
};

const countOf = (value: unknown): number | null => {
	if (value === undefined) return DEFAULT_COUNT;
	const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
	return Number.isInteger(n) && n >= 1 && n <= MAX_COUNT ? n : null;
};

const draftCommand = async (args: string[], deps: CliDeps): Promise<number> => {
	const parsed = parse(
		args,
		{
			radar: {type: 'string'},
			show: {type: 'string'},
			'youtube-id': {type: 'string'},
			fix: {type: 'string'},
			count: {type: 'string'},
			out: {type: 'string'},
			allowlist: {type: 'string'},
			brand: {type: 'string'},
			'kit-draft': {type: 'boolean'},
			'all-subscribers': {type: 'boolean'},
			'new-draft': {type: 'boolean'},
			ledger: {type: 'string'},
		},
		deps,
	);
	if (!parsed) return 2;
	const values = parsed.values;
	const usageError = (message: string): number => {
		deps.printError(`${message}\n\n${USAGE}`);
		return 2;
	};
	if (parsed.positionals.length > 0) return usageError(`Unexpected argument: ${parsed.positionals[0]}`);
	if (typeof values.radar !== 'string' || !values.radar) return usageError('draft needs --radar <radar.json>.');
	const youtubeId = typeof values['youtube-id'] === 'string' ? values['youtube-id'] : null;
	if (youtubeId !== null && !isYoutubeId(youtubeId)) return usageError('--youtube-id must be an 11-character YouTube video id.');
	const count = countOf(values.count);
	if (count === null) return usageError(`--count must be a whole number from 1 to ${MAX_COUNT}.`);
	const brandName = (typeof values.brand === 'string' ? values.brand : DEFAULT_BRAND).trim();
	if (!brandName || brandName.length > 60) return usageError('--brand must be 1-60 characters.');
	if ((values['all-subscribers'] || values['new-draft']) && !values['kit-draft']) return usageError('--all-subscribers and --new-draft only apply with --kit-draft.');
	if (values['all-subscribers'] && (deps.env.THREAT_BRIEF_KIT_FILTER ?? '').trim()) return usageError('Use THREAT_BRIEF_KIT_FILTER or --all-subscribers, not both.');
	const fix = typeof values.fix === 'string' ? values.fix.trim() : null;
	if (fix !== null && (fix.length < 10 || fix.length > 300)) return usageError('--fix must be 10-300 characters.');

	let showInfo: ShowInfo | null = null;
	if (typeof values.show === 'string') {
		const {show, errors} = readShowKit(resolve(deps.cwd, values.show), youtubeId);
		if (!show) {
			deps.printError(`kit.json has problems:\n${errors.map((e) => `  ${e}`).join('\n')}`);
			return 1;
		}
		showInfo = show;
	} else if (youtubeId) return usageError('--youtube-id needs --show <kit.json>.');

	return runDraft(
		{
			radarFile: resolve(deps.cwd, values.radar),
			show: showInfo,
			fix,
			count,
			outDir: typeof values.out === 'string' ? resolve(deps.cwd, values.out) : DEFAULT_OUT,
			allowlist: typeof values.allowlist === 'string' ? values.allowlist : undefined,
			brandName,
			kitDraft: values['kit-draft'] === true,
			allSubscribers: values['all-subscribers'] === true,
			newDraft: values['new-draft'] === true,
			ledgerFile: ledgerPath(values.ledger, deps.env, deps.cwd),
		},
		deps,
	);
};

// ---------------------------------------------------------------------------------------------
// The daily pipeline's call: the approved PostInput, nothing else

/**
 * video-studio/scripts/daily/lib/postapproval.ts calls `--input <json> --out <dir> [--dry-run]` after APPROVE. The
 * email is built only from that approved input (daily.ts). Without --dry-run, and with KIT_API_KEY set, a Kit DRAFT is
 * created, and only when the owner's daily content approval for this episode checks out (same episode, title and
 * developing label, the recorded video, the approved storyboard unchanged). It is never sent.
 */
const dailyCommand = async (args: string[], deps: CliDeps): Promise<number> => {
	const parsed = parse(
		args,
		{
			input: {type: 'string'},
			out: {type: 'string'},
			'dry-run': {type: 'boolean'},
			allowlist: {type: 'string'},
			ledger: {type: 'string'},
			'all-subscribers': {type: 'boolean'},
			approval: {type: 'string'},
			'studio-root': {type: 'string'},
		},
		deps,
	);
	if (!parsed) return 2;
	const values = parsed.values;
	if (typeof values.input !== 'string' || typeof values.out !== 'string' || parsed.positionals.length > 0) {
		deps.printError(`The daily call is: --input <post-input.json> --out <dir> [--dry-run]\n\n${USAGE}`);
		return 2;
	}
	if (values['all-subscribers'] && (deps.env.THREAT_BRIEF_KIT_FILTER ?? '').trim()) {
		deps.printError(`Use THREAT_BRIEF_KIT_FILTER or --all-subscribers, not both.\n\n${USAGE}`);
		return 2;
	}
	const inputFile = resolve(deps.cwd, values.input);
	let rawText: string;
	let raw: unknown;
	try {
		rawText = readFileSync(inputFile, 'utf8');
		raw = JSON.parse(rawText);
	} catch (err) {
		deps.printError(`cannot read ${values.input}: ${(err as Error).message}`);
		return 1;
	}
	const {input, errors, warnings} = checkPostInput(raw);
	if (!input) {
		deps.printError(`The daily input has problems:\n${errors.map((e) => `  ${e}`).join('\n')}`);
		return 1;
	}
	const notes: string[] = [...warnings];
	const baseAllow = loadAllow(typeof values.allowlist === 'string' ? values.allowlist : undefined, deps, notes);
	if (!baseAllow) return 1;
	const kitDraft = values['dry-run'] !== true;
	const kitApiKey = (deps.env.KIT_API_KEY ?? '').trim();
	const filterText = (deps.env.THREAT_BRIEF_KIT_FILTER ?? '').trim();
	const filter = filterText ? parseSubscriberFilter(filterText) : null;
	if (kitDraft && kitApiKey && filterText && !filter) {
		deps.printError(`THREAT_BRIEF_KIT_FILTER must look like tag:123, segment:7 or tag:12,34.\n\n${USAGE}`);
		return 2;
	}

	const {brief, notes: buildNotes, allow} = buildDailyBrief(input, {allow: baseAllow, now: deps.now(), inputFile: displayPath(deps.cwd, inputFile), inputSha256: sha256(rawText)});
	notes.push(...buildNotes);
	const md = renderDailyMarkdown(brief);
	const html = renderDailyEmailHtml(brief);
	const content = renderDailyEmailContent(brief);
	const findings: Finding[] = [...lintDailyBrief(brief, allow), ...lintDailyRendered(md, html, brief, {allow})];

	const studioRoot = typeof values['studio-root'] === 'string' ? resolve(deps.cwd, values['studio-root']) : DEFAULT_STUDIO_ROOT;
	const approvalFile = typeof values.approval === 'string' ? resolve(deps.cwd, values.approval) : dailyApprovalPath(studioRoot, 'zoora-security', input.slug);
	const approval = checkApproval(
		approvalFile,
		{channel: 'zoora-security', slug: input.slug, title: input.title, developing: input.developing, ...(input.youtubeId ? {youtubeVideoId: input.youtubeId} : {}), requireKind: DAILY_APPROVAL_KIND},
		{studioRoot, now: deps.now()},
	);

	const report = [`Threat Brief ${brief.date} (daily, ${input.slug}): ${brief.subject}`];
	report.push(`  built only from the approved input ${displayPath(deps.cwd, inputFile)} (sha256 ${brief.input.sha256.slice(0, 12)}); the radar is not read`);
	report.push(`  what we know: ${brief.facts.length} fact(s); analysis: ${brief.analysis.length}; corrections: ${brief.corrections.length}; also on the radar: ${brief.alsoOnRadar.length}; sources: ${brief.sources.length}`);
	report.push(`  ${approvalLine(approval)}`);
	report.push(`  email content sha256 ${sha256(content).slice(0, 12)} (what a Kit draft would contain)`);
	for (const note of notes) report.push(`  note: ${note}`);
	const failures = findings.filter((f) => f.level === 'error');
	report.push(...formatFindings(findings.filter((f) => f.level === 'warning')));
	if (failures.length > 0) {
		deps.printError([...report, ...formatFindings(failures), `The lint found ${failures.length} problem(s). No files were written and no Kit draft was made.`].join('\n'));
		return 1;
	}
	const outDir = resolve(deps.cwd, values.out);
	mkdirSync(outDir, {recursive: true});
	const mdFile = resolve(outDir, `${brief.date}.md`);
	const htmlFile = resolve(outDir, `${brief.date}.html`);
	writeFileSync(mdFile, md);
	writeFileSync(htmlFile, html);
	report.push(`  wrote ${displayPath(deps.cwd, mdFile)}`, `  wrote ${displayPath(deps.cwd, htmlFile)}`);

	if (!kitDraft) {
		report.push('Dry run: no Kit draft.');
	} else if (!kitApiKey) {
		report.push('Kit draft skipped: KIT_API_KEY is not set.');
	} else {
		const refuse = (lines: string[]): number => {
			deps.printError([...report, ...lines].join('\n'));
			return 1;
		};
		const keyProblem = kitKeyProblem(kitApiKey);
		if (keyProblem) return refuse([`Kit draft not created: ${keyProblem}`]);
		const finalErrors = [...lintDailyBrief(brief, allow, {final: true}), ...lintDailyRendered(md, html, brief, {final: true, allow})].filter((f) => f.level === 'error');
		if (finalErrors.length > 0) return refuse([...formatFindings(finalErrors), 'Kit draft not created: the brief is not final yet (the files above were written for review).']);
		if (!approval.ok) return refuse([`Kit draft not created: the owner's approval does not cover this email: ${approval.reasons.join('; ')}.`]);
		const who = recipientsProblem(filter, values['all-subscribers'] === true);
		if (who) return refuse([who]);
		try {
			report.push(
				await createKitDraft(
					{
						date: brief.date,
						subject: brief.subject,
						preview: brief.preview,
						content,
						description: `Threat Brief ${brief.date} for ${input.slug}, built only from the approved daily input (approval ${approval.versionHash?.slice(0, 12) ?? '?'}).`,
						event: `daily ${input.slug}, approval ${approval.versionHash?.slice(0, 12) ?? '?'}, input ${brief.input.sha256.slice(0, 12)}`,
					},
					{ledgerFile: ledgerPath(values.ledger, deps.env, deps.cwd), newDraft: false, filter, apiKey: kitApiKey},
					deps,
				),
			);
		} catch (err) {
			if (!(err instanceof Error)) throw err;
			return refuse([err.message]);
		}
	}
	report.push('Nothing was sent. Kit adds the unsubscribe link and your postal address to every email.');
	deps.print(report.join('\n'));
	return 0;
};

const lintCommand = (args: string[], deps: CliDeps): number => {
	const parsed = parse(args, {allowlist: {type: 'string'}}, deps);
	if (!parsed) return 2;
	if (parsed.positionals.length !== 1 || !parsed.positionals[0]) {
		deps.printError(`lint takes exactly one .md or .html file.\n\n${USAGE}`);
		return 2;
	}
	const file = resolve(deps.cwd, parsed.positionals[0]);
	const extension = extname(file).toLowerCase();
	const kind = extension === '.html' || extension === '.htm' ? 'html' : extension === '.md' || extension === '.markdown' ? 'markdown' : null;
	if (!kind) {
		deps.printError(`lint takes a .md or .html file.\n\n${USAGE}`);
		return 2;
	}
	const notes: string[] = [];
	const allowlist = parsed.values.allowlist;
	const allow = loadAllow(typeof allowlist === 'string' ? allowlist : undefined, deps, notes);
	if (!allow) return 1;
	let content: string;
	try {
		content = readFileSync(file, 'utf8');
	} catch (err) {
		deps.printError(`cannot read ${parsed.positionals[0]}: ${(err as Error).message}`);
		return 1;
	}
	const findings = lintFile(content, kind, displayPath(deps.cwd, file), allow);
	const lines = [...notes.map((n) => `  note: ${n}`), ...formatFindings(findings), hasErrors(findings) ? `The lint found ${findings.filter((f) => f.level === 'error').length} problem(s).` : 'Lint passed.'];
	if (hasErrors(findings)) deps.printError(lines.join('\n'));
	else deps.print(lines.join('\n'));
	return hasErrors(findings) ? 1 : 0;
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
	const [command, ...rest] = argv;
	try {
		if (command === 'draft') return await draftCommand(rest, deps);
		if (command === 'lint') return lintCommand(rest, deps);
		if (command === 'daily' || (command?.startsWith('--') && argv.includes('--input'))) return await dailyCommand(command === 'daily' ? rest : argv, deps);
	} catch (err) {
		if (!(err instanceof LedgerError)) throw err;
		deps.printError(`Nothing was created: ${err.message}`);
		return 1;
	}
	if (command === 'help' || command === '--help' || command === '-h') {
		deps.print(USAGE);
		return 0;
	}
	deps.printError(`${command ? `Unknown command "${command}".` : 'No command given.'}\n\n${USAGE}`);
	return 2;
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	process.exitCode = await main(process.argv.slice(2));
}
