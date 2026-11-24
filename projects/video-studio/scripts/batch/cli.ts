/**
 * Weekly batch production: plan a week, build the one weekly approval page, record the owner's approvals.
 *
 *   node scripts/batch/cli.ts plan --week 2026-W49 [--dry-run]
 *   node scripts/batch/cli.ts review --week 2026-W49 [--copy-media]
 *   node scripts/batch/cli.ts approve --week 2026-W49 --items all|ai1,ai1-s1 [--reply "APPROVE 2026-W49 all"]
 *   node scripts/batch/cli.ts status --week 2026-W49
 *   node scripts/batch/cli.ts calendar --from 2026-W49 --weeks 4 [--out docs/CONTENT_CALENDAR.md | --check]
 *
 * Nothing here uploads, publishes, posts or pushes. docs/WEEKLY_BATCH.md is the runbook.
 */
import {existsSync, readFileSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {createInterface} from 'node:readline/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {runApprove, type Selection} from './lib/approve.ts';
import {renderCalendar} from './lib/calendar.ts';
import {loadConfig} from './lib/config.ts';
import {inspectItem} from './lib/inspect.ts';
import {loadAll} from './lib/load.ts';
import {readPlan, runPlan} from './lib/plan.ts';
import {runReview} from './lib/review.ts';
import {UsageError, writeTextAtomic} from './lib/util.ts';
import {addWeeks, type IsoWeek, parseWeek, weekId, weekOfDate} from './lib/week.ts';
import {dateIn} from './lib/zone.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
/** projects/video-studio */
export const STUDIO = resolve(HERE, '..', '..');
export const DEFAULT_CONFIG = join(HERE, 'config.json');

export const EXIT = {ok: 0, partial: 1, usage: 2, refused: 3, notApproved: 4} as const;

const HELP = `Weekly batch (scripts/batch): one session a week makes the evergreen episodes; one page holds the owner's review.

Commands
  plan --week <w>         The week's items and slots; writes out/batch/<w>/ (plan.json, plan.md, a WRITER.md and a
                          render-farm request draft per episode) and pins the placed ideas to <w> in the backlogs.
                          --dry-run prints the plan and writes nothing; --no-pin writes the files but leaves the
                          backlogs unchanged (a preview).
  review --week <w>       Builds the ONE weekly approval page: out/approval/week-<w>/index.html (+ review.json, the
                          hashes approve checks). --copy-media copies the previews next to the page.
  approve --week <w> --items <ids|all>
                          The OWNER's approval: writes the uploader's approval record (approval-<render>.json next to
                          each publish kit) with publishAt = the item's slot. Never uploads. At a terminal it asks the
                          owner to type the week; otherwise --reply "<the owner's own reply, verbatim>".
  status --week <w>       Where each item stands (the page's checks, printed; nothing written).
  calendar --from <w> --weeks <n>
                          The content calendar (Markdown) from the backlogs and settings. --out <file> writes it;
                          --check exits 1 when <file> differs.

Weeks: an ISO week (2026-W49), "this" or "next" (in the owner's time zone).

Options
  --root <dir>            projects/video-studio (default: this checkout)
  --config <file>         batch settings (default scripts/batch/config.json)
  --hub <dir>             creator-hub (default: "hub" in the settings, ../creator-hub)
  --channels <file>       the uploader's channels.json (default: the uploader's own)
  --state-dir <dir>       the uploader's state folder (default creator-hub/tools/uploader/.local or $UPLOADER_STATE_DIR)
  --fact-bank <file>      the fact bank (default "factBank.path" in the settings)
  --valid-days <n>        approval validity (default approval.validDays in the settings)
  --by <role>             who approved, as a role (default "owner"; never a private name)
  --now <iso>             fixed clock (reproducible output, tests)
  --json                  status: print JSON

Exit codes: 0 done · 1 partly done (some items refused / not ready / calendar stale) · 2 bad input · 3 refused,
nothing written · 4 not approved (no owner confirmation), nothing written.
`;

export type Deps = {now: () => number; log: (line: string) => void; err: (line: string) => void; prompt: ((q: string) => Promise<string>) | null; env: Record<string, string | undefined>};

const defaultDeps = (): Deps => ({
	now: Date.now,
	log: (line) => process.stdout.write(`${line}\n`),
	err: (line) => process.stderr.write(`${line}\n`),
	prompt: process.stdin.isTTY
		? async (q) => {
				const rl = createInterface({input: process.stdin, output: process.stdout});
				try {
					return await rl.question(q);
				} finally {
					rl.close();
				}
			}
		: null,
	env: process.env,
});

const OPTIONS = {
	week: {type: 'string'},
	items: {type: 'string'},
	reply: {type: 'string'},
	'dry-run': {type: 'boolean'},
	'no-pin': {type: 'boolean'},
	'copy-media': {type: 'boolean'},
	root: {type: 'string'},
	config: {type: 'string'},
	hub: {type: 'string'},
	channels: {type: 'string'},
	'state-dir': {type: 'string'},
	'fact-bank': {type: 'string'},
	'valid-days': {type: 'string'},
	by: {type: 'string'},
	now: {type: 'string'},
	from: {type: 'string'},
	weeks: {type: 'string'},
	out: {type: 'string'},
	check: {type: 'boolean'},
	json: {type: 'boolean'},
	help: {type: 'boolean', short: 'h'},
} as const;

const resolveWeek = (text: string | undefined, nowMs: number, timeZone: string, flag = '--week'): IsoWeek => {
	if (!text) throw new UsageError(`${flag} <ISO week> is required, e.g. ${flag} 2026-W49 (or this / next).`);
	const t = text.trim().toLowerCase();
	if (t === 'this' || t === 'next') {
		const w = weekOfDate(dateIn(nowMs, timeZone));
		return t === 'next' ? addWeeks(w, 1) : w;
	}
	const w = parseWeek(text);
	if (!w) throw new UsageError(`${flag} "${text}" is not an ISO week like 2026-W49.`);
	return w;
};

const parseItems = (text: string | undefined): Selection => {
	if (!text || !text.trim()) throw new UsageError('approve needs --items <ids|all>, e.g. --items all or --items ai1,ai1-s1.');
	const words = text.split(/[\s,]+/).map((w) => w.trim().toLowerCase()).filter(Boolean);
	if (words.includes('all')) {
		if (words.length > 1) throw new UsageError('--items is either "all" or a list of item ids, not both.');
		return 'all';
	}
	const bad = words.filter((w) => !/^[a-z]{1,6}\d{1,2}(-s\d{1,2})?$/.test(w));
	if (bad.length) throw new UsageError(`--items: not item ids: ${bad.join(', ')} (ids look like ai1, ai1-s2, sec1).`);
	return [...new Set(words)];
};

const intIn = (text: string | undefined, name: string, min: number, max: number, fallback: number): number => {
	if (text === undefined) return fallback;
	const n = Number(text);
	if (!Number.isInteger(n) || n < min || n > max) throw new UsageError(`--${name} must be a whole number from ${min} to ${max}.`);
	return n;
};

export const main = async (argv: string[], overrides: Partial<Deps> = {}): Promise<number> => {
	const deps: Deps = {...defaultDeps(), ...overrides};
	let values: ReturnType<typeof parseArgs<{options: typeof OPTIONS; allowPositionals: true}>>['values'];
	let positionals: string[];
	try {
		({values, positionals} = parseArgs({args: argv, options: OPTIONS, allowPositionals: true, strict: true}));
	} catch (err) {
		deps.err(`${(err as Error).message}\n\n${HELP}`);
		return EXIT.usage;
	}
	const [command, ...rest] = positionals;
	if (values.help || !command || command === 'help') {
		deps.log(HELP);
		return command || values.help ? EXIT.ok : EXIT.usage;
	}
	try {
		if (rest.length) throw new UsageError(`${command} takes no positional arguments (got ${rest.join(' ')}).`);
		const root = resolve(values.root ?? STUDIO);
		const configPath = resolve(values.config ?? DEFAULT_CONFIG);
		let nowMs = deps.now();
		if (values.now) {
			nowMs = Date.parse(values.now);
			if (!Number.isFinite(nowMs) || !/(Z|[+-]\d{2}:\d{2})$/.test(values.now)) throw new UsageError('--now must be an ISO 8601 time with Z or an offset.');
		}
		const config = loadConfig(configPath, root);
		const hubDir = resolve(root, values.hub ?? config.hub);
		switch (command) {
			case 'plan': {
				const week = resolveWeek(values.week, nowMs, config.timeZone);
				const r = runPlan({root, configPath, week, nowMs, dryRun: values['dry-run'] === true, pin: values['no-pin'] !== true, factBank: values['fact-bank'] ? resolve(values['fact-bank']) : null, log: deps.log});
				if (values['dry-run']) deps.log(`Dry run: nothing written, nothing pinned (${r.plan.items.length} item(s)).`);
				else {
					deps.log(`Wrote ${r.files.length} file(s) under ${relative(root, join(root, 'out', 'batch', r.plan.week))}/.`);
					if (r.pinnedFiles.length) deps.log(`Pinned ${r.plan.pinned.length} idea(s) to ${r.plan.week} in ${r.pinnedFiles.join(', ')} (commit them).`);
					else if (values['no-pin'] && r.plan.pinned.length) deps.log(`--no-pin: ${r.plan.pinned.length} idea(s) were placed but not pinned; the backlogs are unchanged.`);
				}
				return EXIT.ok;
			}
			case 'review': {
				const week = weekId(resolveWeek(values.week, nowMs, config.timeZone));
				const r = await runReview({root, week, hub: relative(root, hubDir) || '.', channelsPath: values.channels ? resolve(values.channels) : null, nowMs, copyMedia: values['copy-media'] === true, log: deps.log});
				return r.model.notReady.length ? EXIT.partial : EXIT.ok;
			}
			case 'approve': {
				const week = weekId(resolveWeek(values.week, nowMs, config.timeZone));
				const r = await runApprove({
					root,
					week,
					items: parseItems(values.items),
					reply: values.reply ?? null,
					prompt: values.reply === undefined ? deps.prompt : null,
					hubDir,
					channelsPath: values.channels ? resolve(values.channels) : null,
					stateDir: values['state-dir'] ? resolve(values['state-dir']) : deps.env.UPLOADER_STATE_DIR ? resolve(deps.env.UPLOADER_STATE_DIR) : null,
					nowMs,
					validDays: intIn(values['valid-days'], 'valid-days', 1, 30, config.approval.validDays),
					by: values.by ?? 'owner',
					log: deps.log,
				});
				return r.exitCode;
			}
			case 'status': {
				const week = weekId(resolveWeek(values.week, nowMs, config.timeZone));
				const {plan} = readPlan(root, week);
				const rows = [];
				for (const item of plan.items) {
					const s = await inspectItem(root, item);
					rows.push({id: item.id, slot: item.slot.local, channel: item.channel, slug: item.slug, renderId: item.renderId, ready: s.ready, blockers: s.blockers, warnings: s.warnings, dubs: s.dubs.map((d) => ({lang: d.lang, ready: d.ready, reviewed: d.reviewed, notes: d.notes}))});
				}
				if (values.json) deps.log(JSON.stringify({week, items: rows}, null, 2));
				else for (const r of rows) deps.log(`${r.ready ? 'READY    ' : 'NOT READY'} ${r.id.padEnd(9)} ${r.slot}  ${r.channel}/${r.slug} ${r.renderId}${r.blockers.length ? `\n          - ${r.blockers.join('\n          - ')}` : ''}`);
				return rows.every((r) => r.ready) ? EXIT.ok : EXIT.partial;
			}
			case 'calendar': {
				const from = resolveWeek(values.from ?? config.startWeek, nowMs, config.timeZone, '--from');
				const weeks = intIn(values.weeks, 'weeks', 1, 26, 4);
				const {backlogs, warnings} = loadAll(root, configPath);
				const command = `node scripts/batch/cli.ts calendar --from ${weekId(from)} --weeks ${weeks} --out docs/CONTENT_CALENDAR.md`;
				const md = renderCalendar({config, backlogs, from, weeks, researchExists: (p) => existsSync(join(root, p)), command});
				for (const w of warnings) deps.err(`warning: ${w}`);
				if (values.check) {
					const target = resolve(values.out ?? join(root, 'docs', 'CONTENT_CALENDAR.md'));
					const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
					if (current === md) {
						deps.log(`${relative(root, target)} is up to date.`);
						return EXIT.ok;
					}
					deps.err(`${relative(root, target)} is stale: run ${command}`);
					return EXIT.partial;
				}
				if (values.out) {
					writeTextAtomic(resolve(values.out), md);
					deps.log(`Wrote ${values.out}.`);
				} else deps.log(md);
				return EXIT.ok;
			}
			default:
				throw new UsageError(`Unknown command "${command}". Run with --help.`);
		}
	} catch (err) {
		if (err instanceof UsageError) {
			deps.err(`Bad input:\n${err.reasons.map((r) => `- ${r}`).join('\n')}`);
			return EXIT.usage;
		}
		deps.err(`Failed: ${(err as Error).stack ?? String(err)}`);
		return EXIT.partial;
	}
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	process.exitCode = await main(process.argv.slice(2));
}
