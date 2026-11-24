/**
 * node scripts/facts/cli.ts <command> [options]   (the entry point is scripts/facts/cli.ts; see docs/FACT_BANK.md)
 * Exit codes: 0 ok · 1 refused or failed (the output says why) · 2 bad input (usage, missing files, bad JSON).
 */
import {existsSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {join, relative, resolve} from 'node:path';
import {createInterface} from 'node:readline/promises';
import {EMPTY_NAMES, loadNames, type NameList} from '../../claims/lib/names.ts';
import {factFromInput, parseFactInput, promptFact, type Ask} from './add.ts';
import {isIsoDate, todayChicago} from './dates.ts';
import {makeFetcher} from './fetch.ts';
import {errorsOf, isFactShaped, validateBank, validateFact} from './schema.ts';
import {searchFacts} from './search.ts';
import {dueFacts, freshness} from './stale.ts';
import {DEFAULT_BANK, DEFAULT_HOSTS, DEFAULT_NAMES, InputError, loadBank, loadHosts, saveBank, STUDIO} from './store.ts';
import {resolveStoryboard, rewriteText} from './storyboard.ts';
import {clip} from './text.ts';
import {TRANSLATION_LANGS, VERIFICATIONS, type Fact, type Finding, type TranslationLang} from './types.ts';
import {confirmFact, verifyFact, type FactResult, type Fetcher} from './verify.ts';

export const USAGE = `Fact bank: verify a fact once, cite it in every episode and language with its source attached.

Usage: node scripts/facts/cli.ts <command> [options]

  add [--json <file|->] [--search-extract] [--replace]
        Add facts. Without --json it asks for each field. New facts are saved as unverified;
        --search-extract imports claims checked against search-engine extracts (recorded as such).
  verify <id...> | --all-due | --all [--any-host] [--hosts <file>] [--dry-run] [--timeout <ms>]
        Re-read each source whose host is on content/facts/hosts.json and look for its excerpt.
        Found: direct-read, fresh for 30 (volatile) or 365 (historical) days. Read but not found:
        unverified. Unreadable: unchanged (never counted as verified). --any-host: any https host
        (for machines with open network, e.g. GitHub Actions).
  confirm <id> --source <n|url> --by <role|initials>
        Record that a person saw the excerpt on the page in a browser (for pages verify cannot read).
  search [words...] [--tag <t>] [--entity <e>] [--status <s>] [--lang <l>] [--limit <n>]
        Find facts; prints the [fact:<id>] tag to paste. --status: direct-read | search-extract |
        unverified | fresh | stale | usable.
  show <id>              Print one fact.
  stale [--within <days>]
        Facts due for a recheck: unverified, stale, and (with --within) those going stale soon.
  to-storyboard <storyboard.json | content/<channel>/<slug>> [--lang <l>] [--write | --out <file> | --check]
        [--require-direct] [--no-usage]
        Resolve [fact:<id>] tags into [src:<id>] + sources[] for the claim gate. Refuses unknown,
        unverified and stale facts. Prints the storyboard unless --write, --out or --check.
  validate               Check every fact in the bank.

Common options: --bank <file> (default content/facts/facts.jsonl) · --today YYYY-MM-DD (default: today in
America/Chicago) · --names <file> | --no-names (private names list, default data/private/names.txt) · --json

Exit codes: 0 ok, 1 refused or failed, 2 bad input.`;

type Args = {cmd: string; pos: string[]; flags: Map<string, string | true>};

const VALUE_FLAGS = new Set(['--json-file', '--bank', '--today', '--names', '--hosts', '--timeout', '--source', '--by', '--tag', '--entity', '--status', '--lang', '--limit', '--within', '--out']);
const BOOL_FLAGS = new Set(['--search-extract', '--replace', '--all-due', '--all', '--any-host', '--dry-run', '--no-names', '--write', '--check', '--require-direct', '--no-usage', '--json', '-h', '--help']);

export const parseArgs = (argv: string[]): Args => {
	const [first = 'help', ...rest] = argv;
	const cmd = first === '-h' || first === '--help' ? 'help' : first;
	const pos: string[] = [];
	const flags = new Map<string, string | true>();
	for (let i = 0; i < rest.length; i++) {
		const k = rest[i];
		if (k === '--json' && cmd === 'add' && rest[i + 1] !== undefined && !rest[i + 1].startsWith('--')) {
			flags.set('--json-file', rest[++i]);
			continue;
		}
		if (k.startsWith('-') && k !== '-') {
			if (VALUE_FLAGS.has(k)) {
				const v = rest[++i];
				if (v === undefined || (v.startsWith('--') && v !== '-')) throw new InputError(`${k} needs a value`);
				if (k === '--tag') flags.set(k, flags.has(k) ? `${flags.get(k)},${v}` : v);
				else flags.set(k, v);
			} else if (BOOL_FLAGS.has(k)) flags.set(k, true);
			else throw new InputError(`unknown option ${k}`);
		} else pos.push(k);
	}
	return {cmd, pos, flags};
};

type Ctx = {args: Args; today: string; names: NameList; bankPath: string; json: boolean; out: (s: string) => void; err: (s: string) => void; fetcher?: Fetcher; ask?: Ask; stdin?: () => string};

const str = (a: Args, k: string): string | undefined => {
	const v = a.flags.get(k);
	return typeof v === 'string' ? v : undefined;
};
const has = (a: Args, k: string): boolean => a.flags.has(k);

const fmtFinding = (f: Finding): string => `  ${f.level === 'error' ? 'ERROR' : 'warn '} ${f.fact ? `${f.fact} · ` : ''}${f.where}: ${f.message} [${f.rule}]`;

const badge = (f: Fact, today: string): string => {
	const fr = freshness(f, today);
	if (fr.state === 'unverified') return 'UNVERIFIED';
	if (fr.state === 'stale') return `STALE since ${fr.recheckAfter}`;
	return `${f.verification}, fresh to ${fr.recheckAfter}`;
};

/** The bank for the read and update commands: unreadable JSON is bad input; a malformed fact is skipped with a warning. */
const loadValidBank = (ctx: Ctx) => {
	const bank = loadBank(ctx.bankPath);
	if (bank.problems.length) throw new InputError(`${ctx.bankPath}: ${bank.problems.map((p) => `line ${p.line}: ${p.message}`).join('; ')}`);
	const bad = bank.raw.filter((f) => !isFactShaped(f));
	if (bad.length) {
		ctx.err(`facts: skipping ${bad.length} malformed fact${bad.length === 1 ? '' : 's'} (run: node scripts/facts/cli.ts validate)`);
		if (ctx.args.cmd === 'verify' || ctx.args.cmd === 'confirm' || ctx.args.cmd === 'add' || ctx.args.cmd === 'to-storyboard')
			throw new InputError('the bank has malformed facts; fix them before changing it (node scripts/facts/cli.ts validate)');
	}
	return {...bank, facts: bank.facts.filter((f) => isFactShaped(f))};
};

const cmdValidate = (ctx: Ctx): number => {
	const bank = loadBank(ctx.bankPath);
	const findings: Finding[] = [...bank.problems.map((p): Finding => ({level: 'error', rule: 'json', where: `line ${p.line}`, message: p.message})), ...validateBank(bank.raw, {today: ctx.today, names: ctx.names})];
	const errors = errorsOf(findings).length;
	if (ctx.json) ctx.out(JSON.stringify({bank: ctx.bankPath, facts: bank.facts.length, errors, warnings: findings.length - errors, findings}, null, 2));
	else {
		for (const f of findings) ctx.out(fmtFinding(f));
		ctx.out(`facts: ${bank.facts.length} in ${relative(process.cwd(), ctx.bankPath) || ctx.bankPath} · ${errors} error${errors === 1 ? '' : 's'}, ${findings.length - errors} warning${findings.length - errors === 1 ? '' : 's'} · ${errors ? 'FAIL' : 'PASS'}`);
	}
	return errors ? 1 : 0;
};

const cmdStale = (ctx: Ctx): number => {
	const bank = loadValidBank(ctx);
	const within = str(ctx.args, '--within');
	const w = within === undefined ? 0 : Number(within);
	if (!Number.isInteger(w) || w < 0) throw new InputError('--within must be a whole number of days');
	const rows = dueFacts(bank.facts, ctx.today, w);
	if (ctx.json) ctx.out(JSON.stringify({today: ctx.today, within: w, due: rows}, null, 2));
	else {
		if (!rows.length) ctx.out(`stale: nothing due on ${ctx.today}${w ? ` or in the next ${w} days` : ''} (${bank.facts.length} facts)`);
		for (const r of rows) {
			const when = r.state === 'unverified' ? 'unverified' : r.state === 'stale' ? `stale ${r.days}d (fresh to ${r.recheckAfter})` : `due in ${r.days}d (${r.recheckAfter})`;
			ctx.out(`  ${r.id.padEnd(44)} ${when.padEnd(34)} ${clip(r.statement, 70)}`);
		}
		if (rows.length) ctx.out(`stale: ${rows.filter((r) => r.state !== 'soon').length} due now${w ? `, ${rows.filter((r) => r.state === 'soon').length} within ${w} days` : ''} · re-check: node scripts/facts/cli.ts verify --all-due`);
	}
	return 0;
};

const cmdSearch = (ctx: Ctx): number => {
	const bank = loadValidBank(ctx);
	const status = str(ctx.args, '--status');
	if (status && ![...VERIFICATIONS, 'fresh', 'stale', 'usable'].includes(status)) throw new InputError(`--status must be one of ${[...VERIFICATIONS, 'fresh', 'stale', 'usable'].join(', ')}`);
	const lang = str(ctx.args, '--lang');
	if (lang && !TRANSLATION_LANGS.includes(lang as TranslationLang)) throw new InputError(`--lang must be one of ${TRANSLATION_LANGS.join(', ')}`);
	const limit = Number(str(ctx.args, '--limit') ?? 20);
	const hits = searchFacts(bank.facts, ctx.args.pos.join(' '), {
		tags: str(ctx.args, '--tag')?.split(',').filter(Boolean),
		entity: str(ctx.args, '--entity'),
		status: status as never,
		lang: lang as TranslationLang | undefined,
		today: ctx.today,
	}).slice(0, Number.isFinite(limit) && limit > 0 ? limit : 20);
	if (ctx.json) ctx.out(JSON.stringify(hits.map((h) => ({id: h.fact.id, tag: `[fact:${h.fact.id}]`, score: h.score, verification: h.fact.verification, freshness: freshness(h.fact, ctx.today), statement: h.fact.statement, sources: h.fact.sources.length, usage: h.fact.usage})), null, 2));
	else {
		for (const h of hits) {
			ctx.out(`[fact:${h.fact.id}]  ${badge(h.fact, ctx.today)} · ${h.fact.sources.length} source${h.fact.sources.length === 1 ? '' : 's'}${h.fact.usage.length ? ` · used in ${h.fact.usage.length}` : ''}`);
			ctx.out(`    ${clip(h.fact.statement, 160)}`);
		}
		ctx.out(`search: ${hits.length} fact${hits.length === 1 ? '' : 's'}`);
	}
	return 0;
};

const cmdShow = (ctx: Ctx): number => {
	const bank = loadValidBank(ctx);
	const id = ctx.args.pos[0];
	if (!id) throw new InputError('show needs a fact id');
	const f = bank.facts.find((x) => x.id === id);
	if (!f) {
		ctx.err(`facts: no fact "${id}"`);
		return 1;
	}
	if (ctx.json) {
		ctx.out(JSON.stringify(f, null, 2));
		return 0;
	}
	ctx.out(`[fact:${f.id}] · ${badge(f, ctx.today)} · ${f.volatility}`);
	ctx.out(f.statement);
	if (f.numbers.length) ctx.out(`numbers: ${f.numbers.join(' · ')}`);
	if (f.entities.length) ctx.out(`entities: ${f.entities.join(' · ')}`);
	if (f.tags.length) ctx.out(`tags: ${f.tags.join(', ')}`);
	f.sources.forEach((s, i) => {
		const last = s.checks[s.checks.length - 1];
		ctx.out(`source ${i + 1} (${s.tier}): ${s.title}${s.publisher ? ` (${s.publisher})` : ''}${s.cardTitle ? `\n    on-screen card: ${s.cardTitle}` : ''}`);
		ctx.out(`    ${s.url}`);
		ctx.out(`    "${s.excerpt}"`);
		ctx.out(`    read ${s.accessed}${last ? ` · last check ${last.at} by ${last.by}: ${last.result}${last.detail ? ` (${last.detail})` : ''}` : ''}`);
	});
	for (const [l, t] of Object.entries(f.languages)) if (t) ctx.out(`${l} (${t.translation}${t.reviewed ? ', reviewed' : ''}): ${t.statement}`);
	if (f.usage.length) ctx.out(`used in: ${f.usage.join(', ')}`);
	if (f.notes) ctx.out(`notes: ${f.notes}`);
	return 0;
};

const readInputFile = (ctx: Ctx, path: string): string => {
	if (path === '-') return ctx.stdin ? ctx.stdin() : readFileSync(0, 'utf8');
	if (!existsSync(path)) throw new InputError(`no file at ${path}`);
	return readFileSync(path, 'utf8');
};

const cmdAdd = async (ctx: Ctx): Promise<number> => {
	const bank = loadValidBank(ctx);
	const file = str(ctx.args, '--json-file');
	let inputs: unknown[];
	if (file) {
		try {
			inputs = parseFactInput(readInputFile(ctx, file));
		} catch (e) {
			if (e instanceof InputError) throw e;
			throw new InputError((e as Error).message);
		}
	} else {
		let ask = ctx.ask;
		let rl: ReturnType<typeof createInterface> | undefined;
		if (!ask) {
			rl = createInterface({input: process.stdin, output: process.stderr});
			ask = (q) => (rl as ReturnType<typeof createInterface>).question(q);
		}
		try {
			inputs = [await promptFact(ask, ctx.today)];
		} finally {
			rl?.close();
		}
	}
	if (!inputs.length) throw new InputError('no facts in the input');
	const opts = {today: ctx.today, searchExtract: has(ctx.args, '--search-extract')};
	const facts: Fact[] = [];
	for (const [i, x] of inputs.entries()) {
		try {
			facts.push(factFromInput(x, opts));
		} catch (e) {
			ctx.err(`facts: input ${i + 1}: ${(e as Error).message}`);
			return 1;
		}
	}
	const replace = has(ctx.args, '--replace');
	const byId = new Map(bank.facts.map((f) => [f.id, f]));
	const findings: Finding[] = [];
	const seen = new Set<string>();
	for (const f of facts) {
		if (seen.has(f.id)) findings.push({level: 'error', rule: 'id-duplicate', fact: f.id, where: 'input', message: `"${f.id}" appears twice in the input`});
		seen.add(f.id);
		const old = byId.get(f.id);
		if (old && !replace) findings.push({level: 'error', rule: 'id-exists', fact: f.id, where: 'input', message: `"${f.id}" is already in the bank (use --replace to overwrite it; its usage list is kept)`});
		if (old && replace) f.usage = old.usage;
		findings.push(...validateFact(f, {today: ctx.today, names: ctx.names}, `input ${f.id || '?'}`));
	}
	const errors = errorsOf(findings);
	for (const fd of findings) ctx.out(fmtFinding(fd));
	if (errors.length) {
		ctx.out(`add: refused, ${errors.length} error${errors.length === 1 ? '' : 's'}; nothing was saved`);
		return 1;
	}
	for (const f of facts) byId.set(f.id, f);
	saveBank(ctx.bankPath, [...byId.values()]);
	for (const f of facts) ctx.out(`add: saved [fact:${f.id}] as ${f.verification}${f.verification === 'unverified' ? ` · next: node scripts/facts/cli.ts verify ${f.id}` : ` (fresh to ${f.recheckAfter})`}`);
	return 0;
};

const printVerify = (ctx: Ctx, r: FactResult) => {
	ctx.out(`${r.id}: ${r.message}`);
	for (const s of r.results) {
		ctx.out(`    [${s.check.result}] ${s.url}${s.check.detail ? ` · ${s.check.detail}` : ''}`);
		for (const c of s.candidates) ctx.out(`        candidate excerpt: "${c}"`);
	}
};

const cmdVerify = async (ctx: Ctx): Promise<number> => {
	const bank = loadValidBank(ctx);
	const a = ctx.args;
	let targets: Fact[];
	if (has(a, '--all')) targets = bank.facts;
	else if (has(a, '--all-due')) {
		const due = new Set(dueFacts(bank.facts, ctx.today).map((r) => r.id));
		targets = bank.facts.filter((f) => due.has(f.id));
	} else {
		if (!a.pos.length) throw new InputError('verify needs fact ids, --all-due or --all');
		targets = a.pos.map((id) => {
			const f = bank.facts.find((x) => x.id === id);
			if (!f) throw new InputError(`no fact "${id}"`);
			return f;
		});
	}
	const anyHost = has(a, '--any-host');
	const allow = anyHost ? ('any' as const) : loadHosts(str(a, '--hosts') ? resolve(str(a, '--hosts') as string) : DEFAULT_HOSTS).allow;
	const timeout = Number(str(a, '--timeout') ?? 20000);
	if (!Number.isFinite(timeout) || timeout < 1000) throw new InputError('--timeout must be at least 1000 ms');
	const fetcher = ctx.fetcher ?? makeFetcher({allow, timeoutMs: timeout});
	const results: FactResult[] = [];
	const byId = new Map(bank.facts.map((f) => [f.id, f]));
	for (const f of targets) {
		const r = await verifyFact(f, fetcher, allow, ctx.today);
		results.push(r);
		byId.set(f.id, r.fact);
		if (!ctx.json) printVerify(ctx, r);
	}
	if (!has(a, '--dry-run') && results.some((r) => JSON.stringify(r.fact) !== JSON.stringify(bank.facts.find((f) => f.id === r.id)))) saveBank(ctx.bankPath, [...byId.values()]);
	const notOk = results.filter((r) => freshness(r.fact, ctx.today).state !== 'fresh');
	const count = (o: string) => results.filter((r) => r.outcome === o).length;
	if (ctx.json) ctx.out(JSON.stringify({today: ctx.today, dryRun: has(a, '--dry-run'), results: results.map((r) => ({id: r.id, before: r.before, after: r.after, outcome: r.outcome, message: r.message, sources: r.results}))}, null, 2));
	else
		ctx.out(
			`verify: ${results.length} fact${results.length === 1 ? '' : 's'} · ${count('upgraded')} upgraded, ${count('refreshed')} renewed, ${count('downgraded')} downgraded, ${count('unchanged')} unchanged${has(a, '--dry-run') ? ' · dry run, nothing saved' : ''}${notOk.length ? ` · ${notOk.length} still not usable: ${notOk.map((r) => r.id).join(', ')}` : ''}`,
		);
	return notOk.length ? 1 : 0;
};

const cmdConfirm = (ctx: Ctx): number => {
	const bank = loadValidBank(ctx);
	const id = ctx.args.pos[0];
	const src = str(ctx.args, '--source');
	const by = str(ctx.args, '--by');
	if (!id || !src || !by) throw new InputError('confirm needs <id> --source <n|url> --by <role|initials>');
	const f = bank.facts.find((x) => x.id === id);
	if (!f) throw new InputError(`no fact "${id}"`);
	const index = /^\d+$/.test(src) ? Number(src) - 1 : f.sources.findIndex((s) => s.url === src);
	let next: Fact;
	try {
		next = confirmFact(f, index, by, ctx.today);
	} catch (e) {
		throw new InputError((e as Error).message);
	}
	const errors = errorsOf(validateFact(next, {today: ctx.today, names: ctx.names}));
	if (errors.length) {
		for (const e of errors) ctx.out(fmtFinding(e));
		ctx.out('confirm: refused; the fact does not validate');
		return 1;
	}
	saveBank(ctx.bankPath, bank.facts.map((x) => (x.id === id ? next : x)));
	ctx.out(`confirm: ${id} is direct-read (source ${index + 1} read by ${by} on ${ctx.today}); fresh to ${next.recheckAfter}`);
	return 0;
};

/** A storyboard file, or an episode folder: storyboard.<lang>.json when --lang is given and it exists, else storyboard.json. */
export const storyboardPath = (arg: string, lang: string | undefined, cwd = process.cwd()): string => {
	for (const p of [resolve(cwd, arg), resolve(STUDIO, arg)]) {
		if (!existsSync(p)) continue;
		if (statSync(p).isFile()) return p;
		if (lang && existsSync(join(p, `storyboard.${lang}.json`))) return join(p, `storyboard.${lang}.json`);
		const base = join(p, 'storyboard.json');
		if (!existsSync(base)) throw new InputError(`no ${lang ? `storyboard.${lang}.json or ` : ''}storyboard.json in ${p}`);
		if (lang) {
			let baseLang: unknown;
			try {
				baseLang = (JSON.parse(readFileSync(base, 'utf8')) as {lang?: unknown}).lang;
			} catch {
				baseLang = undefined;
			}
			if (baseLang !== lang) throw new InputError(`no storyboard.${lang}.json in ${p} (storyboard.json is "${String(baseLang)}")`);
		}
		return base;
	}
	throw new InputError(`no storyboard at "${arg}"`);
};

const cmdToStoryboard = (ctx: Ctx): number => {
	const a = ctx.args;
	if (!a.pos[0]) throw new InputError('to-storyboard needs a storyboard file or an episode folder');
	const lang = str(a, '--lang');
	const path = storyboardPath(a.pos[0], lang);
	const text = readFileSync(path, 'utf8');
	let sb: unknown;
	try {
		sb = JSON.parse(text);
	} catch (e) {
		throw new InputError(`${path} is not valid JSON: ${(e as Error).message}`);
	}
	if (!sb || typeof sb !== 'object' || Array.isArray(sb)) throw new InputError(`${path} is not a storyboard object`);
	const bank = loadValidBank(ctx);
	const result = resolveStoryboard(sb as Record<string, unknown>, bank.facts, {today: ctx.today, names: ctx.names, requireDirect: has(a, '--require-direct')});
	const errors = errorsOf(result.findings);
	const shown = relative(process.cwd(), path) || path;
	if (ctx.json && (has(a, '--check') || has(a, '--write') || has(a, '--out')))
		ctx.out(JSON.stringify({file: path, pass: !errors.length, tags: result.tags, used: result.used, added: result.added, refreshed: result.refreshed, findings: result.findings}, null, 2));
	else for (const f of result.findings) ctx.err(fmtFinding(f));
	if (errors.length) {
		ctx.err(`to-storyboard: ${shown} REFUSED: ${errors.length} error${errors.length === 1 ? '' : 's'}; nothing was written`);
		return 1;
	}
	const outText = rewriteText(text, result, sb as Record<string, unknown>);
	const out = str(a, '--out');
	if (has(a, '--check')) {
		/* report only */
	} else if (has(a, '--write') || out) {
		const target = out ? resolve(out) : path;
		if (result.changed || target !== path) writeFileSync(target, outText);
		if (!has(a, '--no-usage') && result.used.length) {
			const s = sb as {channel?: unknown; slug?: unknown};
			if (typeof s.channel === 'string' && typeof s.slug === 'string') {
				const key = `${s.channel}/${s.slug}`;
				let touched = false;
				const facts = bank.facts.map((f) => {
					if (!result.used.includes(f.id) || f.usage.includes(key)) return f;
					touched = true;
					return {...f, usage: [...f.usage, key].sort()};
				});
				if (touched) saveBank(ctx.bankPath, facts);
			}
		}
	} else ctx.out(outText.replace(/\n$/, ''));
	ctx.err(
		`to-storyboard: ${shown} OK · ${result.tags} [fact:] tag${result.tags === 1 ? '' : 's'} · ${result.used.length} fact${result.used.length === 1 ? '' : 's'} cited (${result.added.length} source${result.added.length === 1 ? '' : 's'} added, ${result.refreshed.length} refreshed)${has(a, '--write') ? ' · written' : out ? ` · written to ${out}` : has(a, '--check') ? ' · check only' : ''} · next: node scripts/claims/check.ts <episode folder>`,
	);
	return 0;
};

export type MainIO = {out?: (s: string) => void; err?: (s: string) => void; fetcher?: Fetcher; ask?: Ask; stdin?: () => string};

export const main = async (argv: string[], io: MainIO = {}): Promise<number> => {
	const out = io.out ?? ((s: string) => console.log(s));
	const err = io.err ?? ((s: string) => console.error(s));
	let args: Args;
	try {
		args = parseArgs(argv);
	} catch (e) {
		err(`facts: ${(e as Error).message}\n\n${USAGE}`);
		return 2;
	}
	if (args.cmd === 'help' || has(args, '--help') || has(args, '-h')) {
		out(USAGE);
		return 0;
	}
	try {
		const today = str(args, '--today') ?? todayChicago();
		if (!isIsoDate(today)) throw new InputError('--today must be a real YYYY-MM-DD date');
		const names = has(args, '--no-names') ? EMPTY_NAMES : loadNames(resolve(str(args, '--names') ?? DEFAULT_NAMES));
		if (str(args, '--names') && !names.path) throw new InputError(`no names list at ${str(args, '--names')}`);
		const ctx: Ctx = {args, today, names, bankPath: resolve(str(args, '--bank') ?? DEFAULT_BANK), json: has(args, '--json'), out, err, fetcher: io.fetcher, ask: io.ask, stdin: io.stdin};
		switch (args.cmd) {
			case 'validate':
				return cmdValidate(ctx);
			case 'stale':
				return cmdStale(ctx);
			case 'search':
				return cmdSearch(ctx);
			case 'show':
				return cmdShow(ctx);
			case 'add':
				return await cmdAdd(ctx);
			case 'verify':
				return await cmdVerify(ctx);
			case 'confirm':
				return cmdConfirm(ctx);
			case 'to-storyboard':
				return cmdToStoryboard(ctx);
			default:
				throw new InputError(`unknown command "${args.cmd}"`);
		}
	} catch (e) {
		if (e instanceof InputError) {
			err(`facts: ${e.message}`);
			return 2;
		}
		throw e;
	}
};

