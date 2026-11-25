/**
 * Newsletter CLI (run from projects/creator-hub; relative paths resolve from where you ran npm).
 *
 *   npm run newsletter -- draft <kit.json> [options]   build, lint and write out/newsletter/<slug>.md and .html
 *   npm run newsletter -- lint <file.md|file.html>     re-lint a draft after editing it by hand
 *
 * The draft is written only when the lint passes. --kit-draft also creates a DRAFT broadcast in Kit
 * (needs KIT_API_KEY); nothing is ever sent or scheduled. Exit codes: 0 ok, 1 problems found, 2 usage.
 */
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {extname, isAbsolute, relative, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {checkRegistry} from '../../src/server/offers.ts';
import type {OfferRegistry} from '../../src/types.ts';
import {brandFor, buildDraft, DEFAULT_BRAND} from './draft.ts';
import {createBroadcastDraft, KitApiError, parseSubscriberFilter} from './kit-api.ts';
import {lintDraft, lintFile, lintRendered, type Issue} from './lint.ts';
import {isYoutubeId, readPublishKit} from './publish-kit.ts';
import {renderEmailContent, renderEmailHtml, renderMarkdown} from './render.ts';

const PROJECT_DIR = fileURLToPath(new URL('../../', import.meta.url));

export const USAGE = `Usage:
  npm run newsletter -- draft <kit.json> [options]
  npm run newsletter -- lint <draft.md|draft.html>

draft options:
  --offers <file>     offer registry used to check each offer (default: config/offers.json)
  --out <dir>         where to write <slug>.md and <slug>.html (default: out/newsletter)
  --hub <origin>      hub origin for relative offer links, e.g. https://go.zoora.ai (default: PUBLIC_BASE_URL)
  --youtube-id <id>   the video's YouTube id, if kit.json does not have it yet
  --brand <name>      brand name (default: BRAND_NAME, else the kit channel's name: "${brandFor('zoora-security')}" for
                      zoora-security, "${DEFAULT_BRAND}" for any other channel)
  --kit-draft         also create a DRAFT broadcast in Kit (needs KIT_API_KEY). It is never sent. Choose its
                      recipients with KIT_SUBSCRIBER_FILTER=tag:<id> (or segment:<id>), e.g. the tag of the
                      hub's sign-up form, or pass --all-subscribers if every subscriber agreed to these emails.
  --all-subscribers   with --kit-draft: no subscriber filter (Kit's default audience: all subscribers)`;

export type CliDeps = {
	env: Record<string, string | undefined>;
	cwd: string;
	fetch: typeof fetch;
	now: () => Date;
	print: (line: string) => void;
	printError: (line: string) => void;
};

const httpsOrigin = (value: string): string | null => {
	try {
		const url = new URL(value);
		return url.protocol === 'https:' && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password ? url.origin : null;
	} catch {
		return null;
	}
};

const formatIssue = (issue: Issue): string => `  ${issue.level}: ${issue.where}: ${issue.message}`;

/** Relative to cwd when the file is inside it, otherwise absolute. */
const displayPath = (cwd: string, path: string): string => {
	const rel = relative(cwd, path);
	return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : path;
};

const loadRegistry = (file: string, errors: string[]): OfferRegistry | null => {
	try {
		const check = checkRegistry(JSON.parse(readFileSync(file, 'utf8')));
		errors.push(...check.errors.map((e) => `${file}: ${e}`));
		return check.errors.length > 0 ? null : check.registry;
	} catch (err) {
		errors.push(`cannot read ${file}: ${(err as Error).message}`);
		return null;
	}
};

const draftCommand = async (args: string[], deps: CliDeps): Promise<number> => {
	let parsed;
	try {
		parsed = parseArgs({
			args,
			allowPositionals: true,
			strict: true,
			options: {
				offers: {type: 'string'},
				out: {type: 'string'},
				hub: {type: 'string'},
				'youtube-id': {type: 'string'},
				brand: {type: 'string'},
				'kit-draft': {type: 'boolean'},
				'all-subscribers': {type: 'boolean'},
			},
		});
	} catch (err) {
		deps.printError(`${(err as Error).message}\n\n${USAGE}`);
		return 2;
	}
	const {values, positionals} = parsed;
	const usageError = (message: string): number => {
		deps.printError(`${message}\n\n${USAGE}`);
		return 2;
	};
	if (positionals.length !== 1 || !positionals[0]) return usageError('draft takes exactly one kit.json path.');
	const youtubeId = values['youtube-id'] ?? null;
	if (youtubeId !== null && !isYoutubeId(youtubeId)) return usageError('--youtube-id must be an 11-character YouTube video id.');
	if (values.hub !== undefined && !httpsOrigin(values.hub)) return usageError('--hub must be an https origin, e.g. https://go.zoora.ai');
	// A non-https PUBLIC_BASE_URL (local development) is ignored: email links must use https.
	const hubOrigin = httpsOrigin(values.hub ?? deps.env.PUBLIC_BASE_URL ?? '');
	// Without --brand or BRAND_NAME the draft takes the kit channel's own name (brandFor).
	const brandName = (values.brand ?? deps.env.BRAND_NAME)?.trim();
	if (brandName !== undefined && (!brandName || brandName.length > 60)) return usageError('--brand must be 1-60 characters.');
	const filterText = (deps.env.KIT_SUBSCRIBER_FILTER ?? '').trim();
	const subscriberFilter = filterText ? parseSubscriberFilter(filterText) : null;
	if (filterText && !subscriberFilter) return usageError('KIT_SUBSCRIBER_FILTER must look like tag:123, segment:7 or tag:12,34.');
	if (subscriberFilter && values['all-subscribers']) return usageError('Use KIT_SUBSCRIBER_FILTER or --all-subscribers, not both.');
	if (values['all-subscribers'] && !values['kit-draft']) return usageError('--all-subscribers only applies with --kit-draft.');

	const at = (path: string): string => resolve(deps.cwd, path);
	const show = (path: string): string => displayPath(deps.cwd, path);
	const notes: string[] = [];
	const offersFile = values.offers ? at(values.offers) : resolve(PROJECT_DIR, 'config/offers.json');
	let registry: OfferRegistry | null = null;
	if (existsSync(offersFile)) {
		const errors: string[] = [];
		registry = loadRegistry(offersFile, errors);
		if (!registry) {
			deps.printError(`The offer registry has problems:\n${errors.map((e) => `  ${e}`).join('\n')}`);
			return 1;
		}
	} else if (values.offers) {
		deps.printError(`Offer registry not found: ${show(offersFile)}`);
		return 1;
	} else {
		notes.push(`no offer registry at ${show(offersFile)}, so every offer is left out (pass --offers <file>)`);
	}

	const kitFile = at(positionals[0]);
	const {kit, errors} = readPublishKit(kitFile);
	if (!kit) {
		deps.printError(`kit.json has problems:\n${errors.map((e) => `  ${e}`).join('\n')}`);
		return 1;
	}

	const {draft, issues} = buildDraft(kit, {registry, hubOrigin, youtubeId, brandName, now: deps.now()});
	const markdown = renderMarkdown(draft);
	const html = renderEmailHtml(draft);
	const all = [...issues, ...lintDraft(draft), ...lintRendered(draft, markdown, html)];
	const failures = all.filter((i) => i.level === 'error');
	const warnings = all.filter((i) => i.level === 'warning');

	const report = [`Newsletter draft "${draft.slug}": ${draft.subject}`];
	for (const note of notes) report.push(`  note: ${note}`);
	report.push(`  offers in the email: ${draft.offers.map((o) => o.id).join(', ') || 'none'}`);
	for (const out of draft.leftOut) report.push(`  left out: ${out.id}: ${out.reason}`);
	report.push(...warnings.map(formatIssue));
	if (failures.length > 0) {
		deps.printError([...report, ...failures.map(formatIssue), `The lint found ${failures.length} problem(s). No files were written.`].join('\n'));
		return 1;
	}

	const outDir = values.out ? at(values.out) : resolve(PROJECT_DIR, 'out/newsletter');
	mkdirSync(outDir, {recursive: true});
	const mdFile = resolve(outDir, `${draft.slug}.md`);
	const htmlFile = resolve(outDir, `${draft.slug}.html`);
	writeFileSync(mdFile, markdown);
	writeFileSync(htmlFile, html);
	report.push(`  wrote ${show(mdFile)}`, `  wrote ${show(htmlFile)}`);

	if (values['kit-draft']) {
		const apiKey = deps.env.KIT_API_KEY ?? '';
		if (apiKey.trim() && !subscriberFilter && !values['all-subscribers']) {
			// Without a filter Kit addresses every subscriber, including people who signed up for other emails.
			deps.printError(
				[
					...report,
					'Kit draft not created: choose who it is for. Set KIT_SUBSCRIBER_FILTER=tag:<id> (or segment:<id>) to the tag or segment of the',
					"hub's sign-up form, or pass --all-subscribers if every subscriber on the account agreed to episode emails with affiliate links.",
				].join('\n'),
			);
			return 1;
		}
		try {
			const recipients = subscriberFilter ? `subscribers with ${subscriberFilter.type} ${subscriberFilter.ids.join(' and ')}` : 'all subscribers';
			const created = await createBroadcastDraft(
				{
					subject: draft.subject,
					content: renderEmailContent(draft),
					previewText: draft.previewText,
					description: `Episode ${draft.slug}: newsletter draft from creator-hub for ${recipients}. Check the content and the recipients in Kit before sending.`,
					subscriberFilter,
				},
				{apiKey, fetch: deps.fetch},
			);
			report.push(
				`  created Kit broadcast draft ${created.id} for ${recipients}. It has NOT been sent or scheduled: review it and its recipients in Kit.`,
			);
		} catch (err) {
			if (!(err instanceof KitApiError)) throw err;
			deps.printError([...report, `Kit draft not created: ${err.message}`].join('\n'));
			return 1;
		}
	} else {
		report.push('Next: open the .html file to check it, then paste it into a Kit broadcast (or run again with --kit-draft).');
	}
	report.push('Kit adds the unsubscribe link and your postal address to every email.');
	deps.print(report.join('\n'));
	return 0;
};

const lintCommand = (args: string[], deps: CliDeps): number => {
	if (args.length !== 1 || !args[0]) {
		deps.printError(`lint takes exactly one .md or .html file.\n\n${USAGE}`);
		return 2;
	}
	const file = resolve(deps.cwd, args[0]);
	const extension = extname(file).toLowerCase();
	const kind = extension === '.html' || extension === '.htm' ? 'html' : extension === '.md' || extension === '.markdown' ? 'markdown' : null;
	if (!kind) {
		deps.printError(`lint takes a .md or .html file.\n\n${USAGE}`);
		return 2;
	}
	let content: string;
	try {
		content = readFileSync(file, 'utf8');
	} catch (err) {
		deps.printError(`cannot read ${args[0]}: ${(err as Error).message}`);
		return 1;
	}
	const issues = lintFile(content, kind, displayPath(deps.cwd, file));
	const failures = issues.filter((i) => i.level === 'error');
	const lines = [...issues.map(formatIssue), failures.length > 0 ? `The lint found ${failures.length} problem(s).` : 'Lint passed.'];
	if (failures.length > 0) deps.printError(lines.join('\n'));
	else deps.print(lines.join('\n'));
	return failures.length > 0 ? 1 : 0;
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
	if (command === 'draft') return draftCommand(rest, deps);
	if (command === 'lint') return lintCommand(rest, deps);
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
