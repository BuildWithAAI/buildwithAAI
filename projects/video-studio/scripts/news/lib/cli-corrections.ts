/**
 * Corrections for channel 2 (owner rule: "pin corrections"). Usage: node scripts/news/corrections.ts <command>; --help.
 * Edits content/zoora-security/corrections.json atomically. Dates default to the owner's date in America/Chicago.
 */
import {existsSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {publisherFor} from './brief.ts';
import {standaloneScan} from './context.ts';
import {addCorrection, emptyCorrections, OWNER_TZ, pinnedCommentText, todayIn, validateCorrections, type SourceRef} from './corrections.ts';
import {readJson, writeAtomic} from './io.ts';
import {textProblems} from './rules.ts';
import type {Correction, CorrectionsFile} from './types.ts';

const STUDIO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const HELP = `Corrections for channel 2 (zoora-security): content/zoora-security/corrections.json

Usage
  node scripts/news/corrections.ts list [--slug <slug>]
  node scripts/news/corrections.ts check
  node scripts/news/corrections.ts pinned <id>            print the pinned-comment text ("Correction (<date>): ...")
  node scripts/news/corrections.ts add --slug <slug> --correct "<corrected, attributed fact>" --source <id>
        [--source <id> ...] [--source-url <url> --publisher <name>] [--wrong "<what we said>"]
        [--timestamp mm:ss] [--incident <id>] [--date YYYY-MM-DD] [--id <id>]
  node scripts/news/corrections.ts mark-pinned <id> [--at <ISO date-time>]

Options
  --file <path>          default: content/zoora-security/corrections.json
  --content-root <dir>   default: content/zoora-security (to find an episode's sources)
  --allowlist <path>     default: scripts/news/allowlist.json
  --now <ISO time>       clock for default dates (tests)

The date defaults to today in ${OWNER_TZ}. Exit codes: 0 ok, 1 invalid data, 2 usage error.`;

const usage = (msg: string): never => {
	process.stderr.write(`corrections: ${msg}\nRun with --help for usage.\n`);
	process.exit(2);
};

type Opts = {file: string; contentRoot: string; allowlist: string; now: Date};

const load = (o: Opts): CorrectionsFile => {
	const r = readJson(o.file);
	if (!r.ok) {
		if (r.missing) return emptyCorrections();
		process.stderr.write(`corrections: ${r.error}\n`);
		process.exit(1);
	}
	const v = validateCorrections(r.data);
	for (const p of v.problems.filter((x) => x.level === 'error')) process.stderr.write(`corrections: ${p.msg}\n`);
	if (!v.file) process.exit(1);
	return v.file;
};

/** The episode's brief (for its incident names and publishers), or undefined. Slugs are checked before use. */
const briefOf = (o: Opts, slug: string | undefined): unknown => {
	if (!slug || !/^[A-Za-z0-9_][A-Za-z0-9_-]{0,80}$/.test(slug)) return undefined;
	const r = readJson(join(o.contentRoot, slug, 'brief.json'));
	return r.ok ? r.data : undefined;
};

/** Sources for a correction's pinned comment: inline ones, then the brief's (publisher names), then the storyboard's. */
const sourcesFor = (o: Opts, c: Correction): SourceRef[] => {
	const out: SourceRef[] = [...(c.sources ?? []).map((s) => ({id: s.id, url: s.url, publisher: s.publisher ?? publisherFor(s.url), title: s.title}))];
	const publishers = new Map<string, string>();
	const br = readJson(join(o.contentRoot, c.slug, 'brief.json'));
	if (br.ok) {
		const raw = (br.data as {sources?: unknown}).sources;
		const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.entries(raw).map(([id, v]) => ({id, ...(v as object)})) : [];
		for (const s of list as Array<{id: string; url: string; title?: string; publisher?: string}>)
			if (s?.id && s.url) {
				const publisher = publisherFor(s.url, s.publisher);
				publishers.set(s.id, publisher);
				out.push({id: s.id, url: s.url, publisher, title: s.title});
			}
	}
	const sb = readJson(join(o.contentRoot, c.slug, 'storyboard.json'));
	if (sb.ok)
		for (const s of (sb.data as {sources?: Array<{id: string; url: string; title?: string}>}).sources ?? [])
			out.push({id: s.id, url: s.url, publisher: publishers.get(s.id) ?? publisherFor(s.url), title: s.title});
	return out;
};

export const main = (argv: string[]): number => {
	let args;
	try {
		args = parseArgs({
			args: argv,
			allowPositionals: true,
			options: {
				file: {type: 'string'},
				'content-root': {type: 'string'},
				allowlist: {type: 'string'},
				now: {type: 'string'},
				slug: {type: 'string'},
				correct: {type: 'string'},
				wrong: {type: 'string'},
				source: {type: 'string', multiple: true},
				'source-url': {type: 'string'},
				publisher: {type: 'string'},
				timestamp: {type: 'string'},
				incident: {type: 'string'},
				date: {type: 'string'},
				id: {type: 'string'},
				at: {type: 'string'},
				help: {type: 'boolean', short: 'h'},
			},
		});
	} catch (err) {
		return usage(err instanceof Error ? err.message : String(err));
	}
	const {values: v, positionals} = args;
	if (v.help || !positionals.length) {
		process.stdout.write(`${HELP}\n`);
		return v.help ? 0 : 2;
	}
	const contentRoot = v['content-root'] ? resolve(v['content-root']) : join(STUDIO, 'content', 'zoora-security');
	if (v.now !== undefined && Number.isNaN(Date.parse(v.now))) return usage('--now must be an ISO date-time');
	const o: Opts = {
		file: v.file ? resolve(v.file) : join(contentRoot, 'corrections.json'),
		contentRoot,
		allowlist: v.allowlist ? resolve(v.allowlist) : join(STUDIO, 'scripts', 'news', 'allowlist.json'),
		now: v.now ? new Date(v.now) : new Date(),
	};
	const [cmd, arg] = positionals;
	if (cmd === 'list') {
		const f = load(o);
		const rows = f.corrections.filter((c) => !v.slug || c.slug === v.slug);
		if (!rows.length) process.stdout.write('No corrections.\n');
		for (const c of rows) process.stdout.write(`${c.id}  ${c.date}  ${c.slug}  ${c.status}${c.pinnedAt ? ` (${c.pinnedAt})` : ''}  ${c.correct.slice(0, 70)}\n`);
		return 0;
	}
	if (cmd === 'check') {
		const r = readJson(o.file);
		if (!r.ok && r.missing) {
			process.stdout.write(`No corrections file at ${o.file} (nothing to check).\n`);
			return 0;
		}
		if (!r.ok) {
			process.stderr.write(`corrections: ${r.error}\n`);
			return 1;
		}
		const res = validateCorrections(r.data);
		for (const p of res.problems) process.stdout.write(`${p.level}: ${p.msg}\n`);
		const allow = readJson(o.allowlist).ok ? (readJson(o.allowlist) as {data: unknown}).data : {};
		let bad = 0;
		for (const c of res.file?.corrections ?? [])
			for (const pr of textProblems(standaloneScan(allow, briefOf(o, c.slug)), c.correct)) {
				bad++;
				process.stdout.write(`error: correction "${c.id}": ${pr}\n`);
			}
		const ok = !!res.file && !bad;
		process.stdout.write(ok ? 'corrections.json is valid.\n' : 'corrections.json has errors.\n');
		return ok ? 0 : 1;
	}
	if (cmd === 'pinned') {
		if (!arg) return usage('pinned needs a correction id');
		const f = load(o);
		const c = f.corrections.find((x) => x.id === arg);
		if (!c) return usage(`no correction "${arg}"`);
		process.stdout.write(`${pinnedCommentText(c, sourcesFor(o, c))}\n`);
		return 0;
	}
	if (cmd === 'add') {
		if (!v.slug || !v.correct || !v.source?.length) return usage('add needs --slug, --correct and at least one --source');
		const f = load(o);
		const date = v.date ?? todayIn(OWNER_TZ, o.now);
		const n = f.corrections.filter((c) => c.slug === v.slug && c.date === date).length + 1;
		const id = v.id ?? `${date}-${v.slug}-${n}`;
		const inline = v['source-url'] ? [{id: v.source[0], url: v['source-url'], publisher: v.publisher ?? publisherFor(v['source-url'])}] : undefined;
		const al = readJson(o.allowlist);
		const scan = standaloneScan(al.ok ? al.data : {}, briefOf(o, v.slug));
		const problems = textProblems(scan, v.correct);
		if (problems.length) {
			for (const p of problems) process.stderr.write(`corrections: the corrected text breaks a news rule: ${p}\n`);
			return 1;
		}
		const res = addCorrection(f, {id, slug: v.slug, date, correct: v.correct, sourceIds: v.source, wrong: v.wrong, timestamp: v.timestamp, incidentId: v.incident, sources: inline}, o.now);
		if (!res.file) {
			for (const p of res.problems.filter((x) => x.level === 'error')) process.stderr.write(`corrections: ${p.msg}\n`);
			return 1;
		}
		writeAtomic(o.file, `${JSON.stringify(res.file, null, 2)}\n`);
		const c = res.file.corrections[res.file.corrections.length - 1];
		process.stdout.write(`added ${c.id} to ${o.file}\nPin this comment on the video and its Shorts:\n${pinnedCommentText(c, sourcesFor(o, c))}\n`);
		return 0;
	}
	if (cmd === 'mark-pinned') {
		if (!arg) return usage('mark-pinned needs a correction id');
		const at = v.at ?? o.now.toISOString();
		if (Number.isNaN(Date.parse(at))) return usage('--at must be an ISO date-time');
		const f = load(o);
		const c = f.corrections.find((x) => x.id === arg);
		if (!c) return usage(`no correction "${arg}"`);
		c.status = 'pinned';
		c.pinnedAt = at;
		const res = validateCorrections(JSON.parse(JSON.stringify(f)));
		if (!res.file) return 1;
		writeAtomic(o.file, `${JSON.stringify(res.file, null, 2)}\n`);
		process.stdout.write(`marked ${c.id} pinned at ${at}\n`);
		return 0;
	}
	if (!existsSync(o.file) && cmd !== 'add') process.stderr.write(`(no corrections file at ${o.file})\n`);
	return usage(`unknown command "${cmd}"`);
};

