/**
 * Auto-announcer CLI (run from projects/creator-hub; relative paths resolve from the directory you ran it in).
 *
 *   node tools/announcer/cli.ts post --kit <kit.json> --targets telegram,x [--apply] [options]
 *   node tools/announcer/cli.ts ledger list
 *   node tools/announcer/cli.ts ledger forget "<channel>/<slug>#<target>"
 *   node tools/announcer/cli.ts --input <post-input.json> --out <dir> [--dry-run]     (the daily pipeline's call)
 *
 * DRY RUN by default: it prints exactly what each target would receive (endpoint, request body, text, length, ledger
 * state, approval) and posts nothing. Only --apply posts, and only when every check passes, the owner's approval record
 * covers this episode (approval.ts), the video's YouTube id is known and the ledger has no record of that kit on that
 * target. Exit codes: 0 ok, 1 problems found or a post failed, 2 usage.
 */
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {isAbsolute, relative, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {checkRegistry} from '../../src/server/offers.ts';
import type {OfferRegistry} from '../../src/types.ts';
import {isYoutubeId} from '../newsletter/publish-kit.ts';
import {extendAllow, formatFindings, loadAllowlist, makeAllow, type Finding, type NameAllow} from '../threat-brief/safety.ts';
import {approvalLine, checkApproval, DAILY_APPROVAL_KIND, dailyApprovalPath, type ApprovalCheck} from './approval.ts';
import {clearance, forgetEntry, LedgerError, ledgerKey, newEntry, putEntry, readLedger, withLedgerLock, type LedgerFile, type LedgerLock} from './ledger.ts';
import {lintPost, lintSource} from './lint.ts';
import {checkDailySource, readKitSource, type AnnounceSource} from './source.ts';
import {checkVideo, messageBody, sendMessage, sendVideo, telegramConfigFromEnv, TelegramApiError, TELEGRAM_API, videoFields, type VideoFile} from './telegram.ts';
import {buildTelegramPost, buildXPost, planOffers, TARGETS, type PlannedPost, type Target} from './templates.ts';
import {createPost, X_CREATE_POST_URL, X_ENV, XApiError, xCredentialsFromEnv} from './x-api.ts';

const PROJECT_DIR = fileURLToPath(new URL('../../', import.meta.url));
const DEFAULT_LEDGER = resolve(PROJECT_DIR, 'data/announcer/ledger.json');
const DEFAULT_OFFERS = resolve(PROJECT_DIR, 'config/offers.json');
const DEFAULT_ALLOWLIST = resolve(PROJECT_DIR, '../video-studio/scripts/news/allowlist.json');
/** projects/video-studio: the paths inside approval records are relative to it. */
const DEFAULT_STUDIO_ROOT = resolve(PROJECT_DIR, '../video-studio');

/**
 * The ledger file: --ledger relative to where you ran the command; ANNOUNCER_LEDGER relative to the hub, so the daily's
 * call (run from video-studio) and a manual run (from creator-hub) share one ledger and never post twice.
 */
export const ledgerPath = (flag: unknown, env: Record<string, string | undefined>, cwd: string): string =>
	typeof flag === 'string' ? resolve(cwd, flag) : env.ANNOUNCER_LEDGER?.trim() ? resolve(PROJECT_DIR, env.ANNOUNCER_LEDGER.trim()) : DEFAULT_LEDGER;

/** X's pay-per-use price for "Post: Create (with URL)" (docs.x.com pricing page, localized copies, 2026). */
export const X_COST_NOTE = 'about $0.20 per post with a link on X\'s pay-per-use price list (docs.x.com pricing, 2026); check your Developer Console';

export const USAGE = `Usage:
  node tools/announcer/cli.ts post --kit <kit.json> [--targets telegram,x] [--apply] [options]
  node tools/announcer/cli.ts ledger list [--ledger <file>]
  node tools/announcer/cli.ts ledger forget "<channel>/<slug>#<target>" [--ledger <file>]
  node tools/announcer/cli.ts --input <post-input.json> --out <dir> [--dry-run]   (daily pipeline; posts only with --apply)

post options:
  --kit <file>          the episode's publish kit (kit.json). Required.
  --targets <list>      telegram, x, or both, comma-separated (default: telegram,x)
  --apply               post for real. Without it nothing is posted: the dry run prints exactly what would be.
                        Posting needs the owner's approval record for this episode (--approval).
  --approval <file>     the approval record: the daily's content approval or the uploader's upload approval
                        (default: <studio>/content/<channel>/<slug>/approval.json). A daily record must approve this
                        exact kit.json (sha256), the unchanged storyboard and the recorded video id.
  --studio-root <dir>   projects/video-studio, where the approval's paths point (default: ../video-studio)
  --youtube-id <id>     the video's YouTube id, if kit.json does not have it yet (required to post)
  --video <file.mp4>    Telegram: upload this video (sendVideo, at most 50 MB) with the post as its caption
  --developing          label the posts DEVELOPING (also set by a "developing" line in the kit's disclosures)
  --offers <file>       offer registry (default: config/offers.json). Without one, every offer is left out.
  --hub <origin>        hub origin for relative offer links (default: the kit's links, else PUBLIC_BASE_URL)
  --out <dir>           also write the planned posts (x.txt, telegram.txt, plan.json) to this folder
  --ledger <file>       idempotency ledger (default: data/announcer/ledger.json, gitignored; ANNOUNCER_LEDGER
                        overrides it, relative to projects/creator-hub)
  --allowlist <file>    names that are not people (default: ../video-studio/scripts/news/allowlist.json)

Credentials (environment, never files or flags):
  Telegram: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID ("@channelusername" or the numeric id)
  X (OAuth 1.0a user context): ${X_ENV.join(', ')}`;

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

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

const indent = (text: string): string => text.split('\n').map((l) => `    ${l}`).join('\n');

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

const httpsOrigin = (value: string): string | null => {
	try {
		const url = new URL(value);
		return url.protocol === 'https:' && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password ? url.origin : null;
	} catch {
		return null;
	}
};

type PostJob = {
	source: AnnounceSource;
	label: string;
	targets: Target[];
	apply: boolean;
	video: VideoFile | null;
	registryFile: string | null;
	hubOrigin: string | null;
	outDir: string | null;
	outPrefix: string;
	ledgerFile: string;
	allowlistFile: string | null;
	trailer: string[];
	/** The approval record to check, and what it must approve. */
	approvalFile: string;
	studioRoot: string;
	kitFile: string | null;
};

const loadRegistry = (job: PostJob, deps: CliDeps, notes: string[]): {registry: OfferRegistry | null; error: string | null} => {
	const file = job.registryFile ?? DEFAULT_OFFERS;
	if (!existsSync(file)) {
		if (job.registryFile) return {registry: null, error: `Offer registry not found: ${displayPath(deps.cwd, file)}`};
		if (job.source.offers.length > 0) notes.push(`no offer registry at ${displayPath(deps.cwd, file)}, so every offer is left out (pass --offers <file>)`);
		return {registry: null, error: null};
	}
	try {
		const check = checkRegistry(JSON.parse(readFileSync(file, 'utf8')));
		if (check.errors.length > 0) return {registry: null, error: `The offer registry has problems:\n${check.errors.map((e) => `  ${e}`).join('\n')}`};
		return {registry: check.registry, error: null};
	} catch (err) {
		return {registry: null, error: `cannot read ${file}: ${(err as Error).message}`};
	}
};

const loadAllow = (job: PostJob, deps: CliDeps, notes: string[]): {allow: NameAllow | null; error: string | null} => {
	const file = job.allowlistFile ?? DEFAULT_ALLOWLIST;
	if (!existsSync(file)) {
		if (job.allowlistFile) return {allow: null, error: `Allowlist not found: ${displayPath(deps.cwd, file)}`};
		notes.push(`no names allowlist at ${displayPath(deps.cwd, file)}: expect more name warnings`);
		return {allow: makeAllow([]), error: null};
	}
	const {allow, error} = loadAllowlist(file);
	return {allow, error};
};

const credentialsLine = (target: Target, env: Record<string, string | undefined>): string => {
	if (target === 'x') {
		const {missing} = xCredentialsFromEnv(env);
		return missing.length === 0 ? `credentials: ${X_ENV.join(', ')} are set` : `credentials: missing ${missing.join(', ')}`;
	}
	const {missing, problems} = telegramConfigFromEnv(env);
	return [missing.length === 0 ? 'credentials: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set' : `credentials: missing ${missing.join(', ')}`, ...problems].join('; ');
};

/** The exact request each target would get, as printed by the dry run (the bot token is never shown). */
const requestLines = (post: PlannedPost, job: PostJob, env: Record<string, string | undefined>): string[] => {
	if (post.target === 'x') return [`POST ${X_CREATE_POST_URL}  (OAuth 1.0a user context)`, `body: ${JSON.stringify({text: post.text})}`];
	const chatId = (env.TELEGRAM_CHAT_ID ?? '').trim() || '<TELEGRAM_CHAT_ID>';
	if (post.method === 'sendVideo' && job.video) {
		return [
			`POST ${TELEGRAM_API}/bot<TELEGRAM_BOT_TOKEN>/sendVideo  (multipart/form-data)`,
			`fields: ${JSON.stringify(videoFields(chatId, post.text))}`,
			`video: ${job.video.path} (${(job.video.bytes / 1024 / 1024).toFixed(1)} MB)`,
		];
	}
	return [`POST ${TELEGRAM_API}/bot<TELEGRAM_BOT_TOKEN>/sendMessage`, `body: ${JSON.stringify(messageBody(chatId, post.text, post.watchUrl))}`];
};

type Outcome = {target: Target; status: 'posted' | 'skipped' | 'failed'; line: string};

const postOne = async (post: PlannedPost, job: PostJob, deps: CliDeps, lock: LedgerLock): Promise<Outcome> => {
	const scope = `${job.source.channel}/${job.source.slug}`;
	const key = ledgerKey(scope, post.target);
	lock.assertHeld(); // still this run's lock: no other run can be posting this kit
	const clear = clearance(readLedger(job.ledgerFile), key);
	if (!clear.ok) {
		const posted = clear.entry.state === 'posted';
		return {target: post.target, status: posted ? 'skipped' : 'failed', line: `[${post.target}] not posted: ${clear.reason}`};
	}
	let send: () => Promise<{remoteId: string; url: string | null}>;
	if (post.target === 'x') {
		const {credentials, missing} = xCredentialsFromEnv(deps.env);
		if (!credentials) return {target: 'x', status: 'failed', line: `[x] not posted: missing ${missing.join(', ')}`};
		send = async () => {
			const r = await createPost(post.text, {credentials, fetch: deps.fetch});
			return {remoteId: r.id, url: r.url};
		};
	} else {
		const {config, missing, problems} = telegramConfigFromEnv(deps.env);
		if (!config) return {target: 'telegram', status: 'failed', line: `[telegram] not posted: ${[...missing.map((m) => `missing ${m}`), ...problems].join('; ')}`};
		send = async () => {
			const r = post.method === 'sendVideo' && job.video ? await sendVideo(job.video, post.text, {config, fetch: deps.fetch}) : await sendMessage(post.text, post.watchUrl, {config, fetch: deps.fetch});
			return {remoteId: String(r.messageId), url: r.url};
		};
	}
	const at = deps.now().toISOString();
	const entry = newEntry(scope, post.target, sha256(post.text), at, clear.previous);
	lock.assertHeld();
	putEntry(job.ledgerFile, entry); // write-ahead: a crash from here on leaves "pending", which blocks a second post
	lock.refresh();
	try {
		const r = await send();
		const done = deps.now().toISOString();
		putEntry(job.ledgerFile, {...entry, state: 'posted', postedAt: done, remoteId: r.remoteId, url: r.url, history: [...entry.history, {at: done, event: `posted ${r.remoteId}`}]});
		return {target: post.target, status: 'posted', line: `[${post.target}] posted${r.url ? `: ${r.url}` : ` (id ${r.remoteId})`}`};
	} catch (err) {
		if (!(err instanceof XApiError) && !(err instanceof TelegramApiError)) throw err;
		const state = err.definite ? 'failed' : 'pending';
		putEntry(job.ledgerFile, {...entry, state, error: err.message, history: [...entry.history, {at: deps.now().toISOString(), event: `error: ${err.message}`}]});
		const tail = err.definite ? 'Nothing was posted; you can run again later.' : `It may have been posted: check the channel, then run "ledger forget ${key}" if it was not.`;
		return {target: post.target, status: 'failed', line: `[${post.target}] FAILED: ${err.message} ${tail}`};
	}
};

/** The approval this post needs (apply) or would need (dry run). */
const approvalFor = (job: PostJob, deps: CliDeps): ApprovalCheck =>
	checkApproval(
		job.approvalFile,
		{
			channel: job.source.channel,
			slug: job.source.slug,
			developing: job.source.developing,
			...(job.source.youtubeVideoId ? {youtubeVideoId: job.source.youtubeVideoId} : {}),
			...(job.source.origin === 'daily' ? {title: job.source.title, requireKind: DAILY_APPROVAL_KIND} : {kitFile: job.kitFile}),
		},
		{studioRoot: job.studioRoot, now: deps.now()},
	);

const runPost = async (job: PostJob, deps: CliDeps): Promise<number> => {
	const notes: string[] = [];
	const {allow: baseAllow, error: allowError} = loadAllow(job, deps, notes);
	if (!baseAllow) {
		deps.printError(allowError ?? 'cannot read the names allowlist');
		return 1;
	}
	const {registry, error: registryError} = loadRegistry(job, deps, notes);
	if (registryError) {
		deps.printError(registryError);
		return 1;
	}
	const allow = extendAllow(baseAllow, [job.source.channel]);
	const plan = planOffers(job.source, registry, deps.now(), job.hubOrigin);
	for (const left of plan.leftOut) notes.push(`offer left out: ${left.id}: ${left.reason}`);
	const posts: PlannedPost[] = job.targets.map((t) => (t === 'x' ? buildXPost(job.source, plan) : buildTelegramPost(job.source, plan, {video: job.video !== null, allow})));
	const findings: Finding[] = [...lintSource(job.source, plan), ...posts.flatMap((p) => lintPost(p, job.source, plan, allow, {apply: job.apply}))];

	const approval = approvalFor(job, deps);
	if (job.apply && !approval.ok) {
		findings.push({rule: 'structure', code: 'not-approved', level: 'error', where: 'approval', message: `the owner's approval does not cover this post: ${approval.reasons.join('; ')}`, match: ''});
	}

	let ledger: LedgerFile | null = null;
	try {
		ledger = readLedger(job.ledgerFile);
	} catch (err) {
		if (!(err instanceof LedgerError)) throw err;
		findings.push({rule: 'structure', code: 'ledger', level: 'error', where: 'ledger', message: err.message, match: ''});
	}

	const mode = job.apply ? 'APPLY' : 'DRY RUN';
	const report: string[] = [`Announcer ${mode} for ${job.source.channel}/${job.source.slug}: ${job.label}`];
	report.push(`  video: ${job.source.youtubeVideoId ? `https://youtu.be/${job.source.youtubeVideoId}` : 'no YouTube id yet (pass --youtube-id <id> once the video is public)'}`);
	if (job.source.developing) report.push('  developing story: every post is labelled DEVELOPING');
	report.push(`  ${approval.ok || job.apply ? approvalLine(approval) : `approval: not yet (--apply needs it): ${approval.reasons.join('; ')}`}`);
	report.push(`  offers in the posts: ${plan.included.map((o) => o.id).join(', ') || 'none'}${plan.restricted.length > 0 ? `; region-restricted (hub page only): ${plan.restricted.join(', ')}` : ''}`);
	for (const note of notes) report.push(`  note: ${note}`);
	for (const post of posts) {
		const scope = `${job.source.channel}/${job.source.slug}`;
		const clear = ledger ? clearance(ledger, ledgerKey(scope, post.target)) : null;
		report.push('', `[${post.target}] ${job.apply ? 'will' : 'would'} ${requestLines(post, job, deps.env)[0]}`);
		report.push(`    ${credentialsLine(post.target, deps.env)}`);
		report.push(`    length: ${post.length}/${post.limit} ${post.unit}`);
		if (post.target === 'x') report.push(`    cost: ${X_COST_NOTE}`);
		report.push(`    ledger: ${!clear ? 'unreadable' : clear.ok ? (clear.previous ? `an earlier attempt failed (${clear.previous.error ?? 'no detail'}); may post again` : 'not posted yet') : clear.reason}`);
		for (const n of post.notes) report.push(`    note: ${n}`);
		for (const line of requestLines(post, job, deps.env).slice(1)) report.push(`    ${line}`);
		report.push('    ----- text -----', indent(post.text), '    ----- end -----');
	}
	const errors = findings.filter((f) => f.level === 'error');
	const warnings = findings.filter((f) => f.level === 'warning');
	if (warnings.length > 0) report.push('', ...formatFindings(warnings));

	if (job.outDir) {
		mkdirSync(job.outDir, {recursive: true});
		for (const post of posts) writeFileSync(resolve(job.outDir, `${job.outPrefix}${post.target}.txt`), `${post.text}\n`);
		const planFile = resolve(job.outDir, `${job.outPrefix}plan.json`);
		writeFileSync(
			planFile,
			`${JSON.stringify({version: 1, mode: job.apply ? 'apply' : 'dry-run', scope: `${job.source.channel}/${job.source.slug}`, generatedAt: deps.now().toISOString(), posts, offers: plan, findings}, null, 2)}\n`,
		);
		report.push('', `  wrote ${displayPath(deps.cwd, job.outDir)}/${job.outPrefix}{${posts.map((p) => p.target).join(',')}}.txt and ${job.outPrefix}plan.json`);
	}

	if (errors.length > 0) {
		deps.printError([...report, '', ...formatFindings(errors), `${errors.length} problem(s). Nothing was posted.`].join('\n'));
		return 1;
	}
	if (!job.apply) {
		deps.print([...report, '', 'DRY RUN: nothing was posted. Run again with --apply to post.', ...job.trailer].join('\n'));
		return 0;
	}

	let outcomes: Outcome[];
	try {
		outcomes = await withLedgerLock(job.ledgerFile, async (lock) => {
			const results: Outcome[] = [];
			for (const post of posts) results.push(await postOne(post, job, deps, lock));
			return results;
		});
	} catch (err) {
		if (!(err instanceof LedgerError)) throw err;
		deps.printError([...report, '', `Nothing was posted: ${err.message}`].join('\n'));
		return 1;
	}
	report.push('', ...outcomes.map((o) => o.line));
	const failed = outcomes.filter((o) => o.status === 'failed');
	if (failed.length > 0) {
		deps.printError(report.join('\n'));
		return 1;
	}
	deps.print(report.join('\n'));
	return 0;
};

const parseTargets = (value: string | undefined): Target[] | null => {
	if (value === undefined) return [...TARGETS];
	const list = value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
	if (list.length === 0 || list.some((t) => t !== 'x' && t !== 'telegram')) return null;
	return [...new Set(list)] as Target[];
};

const commonJob = (values: Parsed['values'], deps: CliDeps): {job: Partial<PostJob>; error: string | null} => {
	const targets = parseTargets(typeof values.targets === 'string' ? values.targets : undefined);
	if (!targets) return {job: {}, error: '--targets must be telegram, x or telegram,x.'};
	if (typeof values.hub === 'string' && !httpsOrigin(values.hub)) return {job: {}, error: '--hub must be an https origin, e.g. https://go.zoora.ai'};
	let video: VideoFile | null = null;
	if (typeof values.video === 'string') {
		if (!targets.includes('telegram')) return {job: {}, error: '--video is for the Telegram target.'};
		const checked = checkVideo(resolve(deps.cwd, values.video));
		if (!checked.video) return {job: {}, error: `--video: ${checked.problem}`};
		video = checked.video;
	}
	return {
		job: {
			targets,
			video,
			registryFile: typeof values.offers === 'string' ? resolve(deps.cwd, values.offers) : null,
			hubOrigin: httpsOrigin(typeof values.hub === 'string' ? values.hub : (deps.env.PUBLIC_BASE_URL ?? '')),
			outDir: typeof values.out === 'string' ? resolve(deps.cwd, values.out) : null,
			ledgerFile: ledgerPath(values.ledger, deps.env, deps.cwd),
			allowlistFile: typeof values.allowlist === 'string' ? resolve(deps.cwd, values.allowlist) : null,
			studioRoot: typeof values['studio-root'] === 'string' ? resolve(deps.cwd, values['studio-root']) : DEFAULT_STUDIO_ROOT,
		},
		error: null,
	};
};

const POST_OPTIONS: OptionSpec = {
	kit: {type: 'string'},
	targets: {type: 'string'},
	apply: {type: 'boolean'},
	'youtube-id': {type: 'string'},
	video: {type: 'string'},
	developing: {type: 'boolean'},
	offers: {type: 'string'},
	hub: {type: 'string'},
	out: {type: 'string'},
	ledger: {type: 'string'},
	allowlist: {type: 'string'},
	approval: {type: 'string'},
	'studio-root': {type: 'string'},
};

const postCommand = async (args: string[], deps: CliDeps): Promise<number> => {
	const parsed = parse(args, POST_OPTIONS, deps);
	if (!parsed) return 2;
	const {values} = parsed;
	const usageError = (message: string): number => {
		deps.printError(`${message}\n\n${USAGE}`);
		return 2;
	};
	if (parsed.positionals.length > 0) return usageError(`Unexpected argument: ${parsed.positionals[0]}`);
	if (typeof values.kit !== 'string' || !values.kit) return usageError('post needs --kit <kit.json>.');
	const youtubeId = typeof values['youtube-id'] === 'string' ? values['youtube-id'] : null;
	if (youtubeId !== null && !isYoutubeId(youtubeId)) return usageError('--youtube-id must be an 11-character YouTube video id.');
	const {job, error} = commonJob(values, deps);
	if (error) return usageError(error);
	const kitFile = resolve(deps.cwd, values.kit);
	const {source, errors} = readKitSource(kitFile);
	if (!source) {
		deps.printError(`kit.json has problems:\n${errors.map((e) => `  ${e}`).join('\n')}`);
		return 1;
	}
	if (youtubeId && source.youtubeVideoId && youtubeId !== source.youtubeVideoId) {
		return usageError(`--youtube-id ${youtubeId} does not match the kit's ${source.youtubeVideoId}: announce the video the kit was made for.`);
	}
	const studioRoot = job.studioRoot ?? DEFAULT_STUDIO_ROOT;
	return runPost(
		{
			...(job as PostJob),
			source: {...source, youtubeVideoId: source.youtubeVideoId ?? youtubeId, developing: source.developing || values.developing === true},
			label: source.title,
			apply: values.apply === true,
			outPrefix: '',
			trailer: [],
			kitFile,
			approvalFile: typeof values.approval === 'string' ? resolve(deps.cwd, values.approval) : dailyApprovalPath(studioRoot, source.channel, source.slug),
		},
		deps,
	);
};

/**
 * The daily pipeline's call (video-studio/scripts/daily/lib/postapproval.ts): `--input <json> --out <dir>
 * [--dry-run]`, where the input is the daily's PostInput. It never posts on its own: posting needs --apply (put it
 * in DAILY_ANNOUNCER_CMD), and --dry-run always wins. Files go to <out>/announce-*.txt and announce-plan.json, next
 * to the daily's own drafts.
 */
const dailyCommand = async (args: string[], deps: CliDeps): Promise<number> => {
	const parsed = parse(args, {...POST_OPTIONS, input: {type: 'string'}, 'dry-run': {type: 'boolean'}}, deps);
	if (!parsed) return 2;
	const {values} = parsed;
	if (typeof values.input !== 'string' || typeof values.out !== 'string' || parsed.positionals.length > 0 || typeof values.kit === 'string') {
		deps.printError(`The daily call is: --input <post-input.json> --out <dir> [--dry-run]\n\n${USAGE}`);
		return 2;
	}
	const {job, error} = commonJob(values, deps);
	if (error) {
		deps.printError(`${error}\n\n${USAGE}`);
		return 2;
	}
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(resolve(deps.cwd, values.input), 'utf8'));
	} catch (err) {
		deps.printError(`cannot read ${values.input}: ${(err as Error).message}`);
		return 1;
	}
	const {source, errors} = checkDailySource(raw);
	if (!source) {
		deps.printError(`The daily input has problems:\n${errors.map((e) => `  ${e}`).join('\n')}`);
		return 1;
	}
	const apply = values.apply === true && values['dry-run'] !== true;
	const studioRoot = job.studioRoot ?? DEFAULT_STUDIO_ROOT;
	return runPost(
		{
			...(job as PostJob),
			source: {...source, developing: source.developing || values.developing === true},
			label: source.title,
			apply,
			outPrefix: 'announce-',
			trailer: apply ? [] : ['The daily call never posts by itself: to let it post after APPROVE, add --apply to DAILY_ANNOUNCER_CMD (--dry-run still wins).'],
			kitFile: null,
			approvalFile: typeof values.approval === 'string' ? resolve(deps.cwd, values.approval) : dailyApprovalPath(studioRoot, source.channel, source.slug),
		},
		deps,
	);
};

const ledgerCommand = async (args: string[], deps: CliDeps): Promise<number> => {
	const parsed = parse(args, {ledger: {type: 'string'}}, deps);
	if (!parsed) return 2;
	const file = ledgerPath(parsed.values.ledger, deps.env, deps.cwd);
	const [sub, key, ...extra] = parsed.positionals;
	try {
		if (sub === 'list' && !key) {
			const ledger = readLedger(file);
			const entries = Object.values(ledger.entries).sort((a, b) => a.attemptedAt.localeCompare(b.attemptedAt));
			deps.print(
				[
					`Ledger ${displayPath(deps.cwd, file)}: ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`,
					...entries.map((e) => `  ${e.key}  ${e.state}  ${e.postedAt ?? e.attemptedAt}${e.remoteId ? `  id ${e.remoteId}` : ''}${e.url ? `  ${e.url}` : ''}${e.error ? `  error: ${e.error}` : ''}`),
				].join('\n'),
			);
			return 0;
		}
		if (sub === 'forget' && key && extra.length === 0) {
			const removed = await withLedgerLock(file, async () => forgetEntry(file, key));
			if (!removed) {
				deps.printError(`No ledger entry "${key}". Run "ledger list" to see the keys.`);
				return 1;
			}
			deps.print(`Removed "${key}" from the ledger. The next --apply run may post it again: make sure it is not already on the channel.`);
			return 0;
		}
	} catch (err) {
		if (!(err instanceof LedgerError)) throw err;
		deps.printError(err.message);
		return 1;
	}
	deps.printError(`ledger takes "list" or "forget <key>".\n\n${USAGE}`);
	return 2;
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
	if (command === 'post') return postCommand(rest, deps);
	if (command === 'ledger') return ledgerCommand(rest, deps);
	if (command === 'daily' || (command?.startsWith('--') && argv.includes('--input'))) return dailyCommand(command === 'daily' ? rest : argv, deps);
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
