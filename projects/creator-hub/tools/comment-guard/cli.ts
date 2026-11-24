/**
 * Comment scam guard: finds "WhatsApp me" bots, fake handlers, impersonators and wallet-drainer replies
 * in your channel's comments and holds them for review.
 *
 *   npm run guard                               dry run (= "guard scan"): read comments, write a report, change nothing
 *   npm run guard -- apply --confirm            hold the comments scored "hold" (reversible, never deletes or bans)
 *   npm run guard -- blocked-words              print a blocked-words list and the Studio settings (no API)
 *   npm run guard -- auth                       one-time Google sign-in; saves config/youtube-oauth.json (gitignored)
 *   npm run guard -- release --confirm <id...>  undo holds (set comments back to published)
 *
 * Run "npm run guard -- help" for every option. README.md in this folder explains the setup.
 */
import {readFileSync} from 'node:fs';
import {isAbsolute, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {blockedWordsGuide} from './blocked-words.ts';
import {classifyAll, type CommentInput, type Identity} from './classifier.ts';
import {type AppliedResult, newReport, readReport, type Report, type ReportItem, resolveReport, writeReport} from './report.ts';
import {
	AuthError,
	authorize,
	createClient,
	type Endpoints,
	fetchChannelComments,
	GOOGLE,
	type GuardComment,
	type ModerationStatus,
	type OAuthClient,
	type OAuthFile,
	QuotaBudget,
	QuotaBudgetError,
	readClientSecrets,
	readOAuthFile,
	revokeToken,
	type SavedAccount,
	writeOAuthFile,
	type YouTubeClient,
	YouTubeApiError,
} from './youtube.ts';

const PROJECT_DIR = fileURLToPath(new URL('../../', import.meta.url));
/** Used when no channel is authorised yet (e.g. "scan --input"). The saved account's title and handle are added. */
const DEFAULT_NAMES = ['Zoora AI', 'ZooraTechnologies'];
const DEFAULT_MAX_QUOTA = 1000;
const DEFAULT_MAX_THREADS = 300;
const HOLD_BATCH = 50;
const COMMENT_ID = /^[A-Za-z0-9_.-]{6,200}$/;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const ACCOUNT_KEY = /^[a-z0-9][a-z0-9_-]{0,40}$/;

const HELP = `Comment scam guard

Commands
  scan                     (default) Dry run: read recent comments, score them, write a JSON and a Markdown
                           report of what would be held and why. Changes nothing on YouTube.
  apply --confirm          Hold the comments scored "hold" for review (YouTube Studio > Comments > Held for
                           review). Reversible. Never deletes, rejects or bans. "review" comments are left alone.
  release --confirm <id..> Undo holds: set the given comment ids back to published.
  blocked-words            Print a blocked-words list and the recommended Studio settings. No API needed.
  auth                     One-time Google sign-in for your channel (opens nothing; prints a link).
  auth --revoke            Revoke the saved access at Google and delete it from the file.

Options
  --max-quota <units>      API quota budget for this run (default ${DEFAULT_MAX_QUOTA}; reads cost 1, each hold call 50).
  --max-threads <n>        Newest comment threads to read (default ${DEFAULT_MAX_THREADS}). Replies are always included.
  --from-report <file>     apply/release: use a report you reviewed ("latest" = newest in --out) instead of rescanning.
  --input <file>           scan: score comments from a JSON file instead of the API (array of {id, text, authorName,
                           authorChannelId}). Add --trust <your channel id> so your own replies are not taken for
                           impersonators.
  --account <key>          Which saved channel to use when config/youtube-oauth.json holds more than one.
  --channel-name <name>    Extra name to protect from impersonation (repeatable).
  --trust <channel id>     Channel whose comments are never flagged, e.g. your second channel (repeatable).
  --own-handle <handle>    A handle or link you own, e.g. your Telegram bot (repeatable).
  --client-secrets <file>  auth: the "Desktop app" OAuth client JSON from Google Cloud Console.
  --oauth-file <file>      Credentials file (default config/youtube-oauth.json, or YOUTUBE_OAUTH_FILE). Inside the repository it must be gitignored.
  --out <dir>              Report folder (default out/comment-guard).

Environment
  YOUTUBE_OAUTH_FILE, YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET (auth), and comma-separated
  GUARD_CHANNEL_NAMES, GUARD_TRUSTED_CHANNELS and GUARD_OWN_HANDLES (same as the options above).
`;

export type Deps = {
	env: Record<string, string | undefined>;
	fetch: typeof fetch;
	endpoints: Endpoints;
	stdout: (line: string) => void;
	stderr: (line: string) => void;
	now: () => Date;
	/** Shows the Google consent link. The default prints it; tests follow it. */
	openUrl: (url: string) => void | Promise<void>;
	projectDir: string;
};

class UsageError extends Error {}

const OPTIONS = {
	account: {type: 'string'},
	'oauth-file': {type: 'string'},
	out: {type: 'string'},
	'max-quota': {type: 'string'},
	'max-threads': {type: 'string'},
	input: {type: 'string'},
	'channel-name': {type: 'string', multiple: true},
	trust: {type: 'string', multiple: true},
	'own-handle': {type: 'string', multiple: true},
	confirm: {type: 'boolean'},
	'from-report': {type: 'string'},
	'client-secrets': {type: 'string'},
	revoke: {type: 'boolean'},
	help: {type: 'boolean', short: 'h'},
} as const;

const parse = (argv: string[]) => parseArgs({args: argv, options: OPTIONS, allowPositionals: true, strict: true});
type Values = ReturnType<typeof parse>['values'];

const csv = (value: string | undefined): string[] => (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const wholeNumber = (value: string | undefined, name: string, fallback: number, max: number): number => {
	if (value === undefined) return fallback;
	const n = Number(value);
	if (!Number.isInteger(n) || n < 1 || n > max) throw new UsageError(`--${name} must be a whole number from 1 to ${max}.`);
	return n;
};

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/* ------------------------------------------------------------------ context shared by the commands */

type Context = {
	deps: Deps;
	values: Values;
	oauthPath: string;
	outDir: string;
	file: OAuthFile | null;
};

/** Paths given on the command line are relative to the current folder; defaults live in the project. */
const userPath = (value: string): string => (isAbsolute(value) ? value : resolve(value));

const chooseAccount = (ctx: Context): {key: string; account: SavedAccount; file: OAuthFile} => {
	const {file} = ctx;
	if (!file || !Object.keys(file.accounts).length) {
		throw new UsageError(`No saved YouTube access in ${ctx.oauthPath}. Run "npm run guard -- auth" first (see README.md).`);
	}
	const keys = Object.keys(file.accounts);
	const key = ctx.values.account ?? (keys.length === 1 ? keys[0] : undefined);
	if (!key || !file.accounts[key]) throw new UsageError(`Choose a channel with --account (${keys.join(', ')}).`);
	return {key, account: file.accounts[key], file};
};

const identityFor = (ctx: Context): Identity => {
	const accounts = Object.values(ctx.file?.accounts ?? {});
	const configured = [...accounts.flatMap((a) => [a.title, a.handle ?? '']), ...(ctx.values['channel-name'] ?? []), ...csv(ctx.deps.env.GUARD_CHANNEL_NAMES)];
	const trusted = [...(ctx.values.trust ?? []), ...csv(ctx.deps.env.GUARD_TRUSTED_CHANNELS)];
	for (const id of trusted) if (!CHANNEL_ID.test(id)) throw new UsageError(`"${id}" is not a YouTube channel id (UC followed by 22 characters).`);
	return {
		channelIds: accounts.map((a) => a.channelId),
		names: [...new Set([...DEFAULT_NAMES, ...configured].map((n) => n.trim()).filter(Boolean))],
		trustedChannelIds: trusted,
		ownHandles: [...(ctx.values['own-handle'] ?? []), ...csv(ctx.deps.env.GUARD_OWN_HANDLES)],
	};
};

const clientFor = (ctx: Context, budget: QuotaBudget): {client: YouTubeClient; account: SavedAccount} => {
	const {key, account, file} = chooseAccount(ctx);
	const client = createClient({
		client: file.client,
		tokens: account.tokens,
		budget,
		endpoints: ctx.deps.endpoints,
		fetch: ctx.deps.fetch,
		onTokens: (tokens) => {
			file.accounts[key] = {...file.accounts[key], tokens};
			writeOAuthFile(ctx.oauthPath, file);
		},
	});
	return {client, account};
};

const toItems = (comments: GuardComment[], ctx: Context): ReportItem[] => {
	const inputs: CommentInput[] = comments.map((c) => ({id: c.id, text: c.text, authorName: c.authorName, authorChannelId: c.authorChannelId}));
	const verdicts = classifyAll(inputs, identityFor(ctx));
	return comments.map((c, i) => ({
		commentId: c.id,
		threadId: c.threadId,
		parentId: c.parentId,
		videoId: c.videoId,
		author: c.authorName,
		authorChannelId: c.authorChannelId,
		authorChannelUrl: c.authorChannelUrl,
		publishedAt: c.publishedAt,
		text: c.text,
		...verdicts[i],
	}));
};

const quotaOf = (budget: QuotaBudget): Report['quota'] => ({budget: budget.max, used: budget.used, calls: {...budget.calls}});

/** Reads comments from the API (or --input) and builds a scan report. */
const scanReport = async (ctx: Context, budget: QuotaBudget | null): Promise<Report> => {
	const generatedAt = ctx.deps.now().toISOString();
	if (ctx.values.input) {
		const comments = readInputFile(userPath(ctx.values.input));
		return newReport({mode: 'scan', generatedAt, source: 'file', channel: {id: null, title: null}, truncated: null, quota: null, scanned: toItems(comments, ctx), threads: null});
	}
	if (!budget) throw new Error('A quota budget is required to read from the API.');
	const {client, account} = clientFor(ctx, budget);
	const maxThreads = wholeNumber(ctx.values['max-threads'], 'max-threads', DEFAULT_MAX_THREADS, 100_000);
	const result = await fetchChannelComments(client, budget, account.channelId, maxThreads);
	return newReport({
		mode: 'scan',
		generatedAt,
		source: 'youtube',
		channel: {id: account.channelId, title: account.title},
		truncated: result.truncated,
		quota: quotaOf(budget),
		scanned: toItems(result.comments, ctx),
		threads: result.threads,
	});
};

const readInputFile = (path: string): GuardComment[] => {
	const data: unknown = JSON.parse(readFileSync(path, 'utf8'));
	const list = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray((data as {comments?: unknown}).comments) ? (data as {comments: unknown[]}).comments : null;
	if (!list) throw new UsageError(`${path}: expected a JSON array of comments, or {"comments": [...]}.`);
	const comments: GuardComment[] = [];
	for (const raw of list) {
		if (!raw || typeof raw !== 'object') continue;
		const r = raw as Record<string, unknown>;
		const text = typeof r.text === 'string' ? r.text : null;
		const id = typeof r.id === 'string' ? r.id : null;
		if (!id || text === null) continue;
		const s = (key: string) => (typeof r[key] === 'string' ? (r[key] as string) : null);
		comments.push({
			id,
			threadId: s('threadId') ?? id,
			parentId: s('parentId'),
			videoId: s('videoId'),
			authorName: s('authorName') ?? s('author') ?? '',
			authorChannelId: s('authorChannelId'),
			authorChannelUrl: s('authorChannelUrl'),
			text,
			publishedAt: s('publishedAt'),
			likeCount: 0,
		});
	}
	if (!comments.length) throw new UsageError(`${path}: no comments with an "id" and a "text".`);
	return comments;
};

/* ------------------------------------------------------------------ changing moderation status */

/**
 * Sets the status of the given comments in batches of 50 ids per call (50 quota units each). If a batch
 * fails, for example because one comment was deleted meanwhile, its ids are retried one by one.
 */
export const setStatus = async (client: YouTubeClient, budget: QuotaBudget, ids: string[], status: ModerationStatus): Promise<AppliedResult> => {
	const result: AppliedResult = {status, done: [], failed: [], notAttempted: []};
	let stopped: string | null = null;
	const attempt = async (batch: string[]): Promise<boolean> => {
		if (stopped || !budget.canAfford('comments.setModerationStatus')) {
			stopped ??= `quota budget (--max-quota ${budget.max}) reached`;
			result.notAttempted.push(...batch.map((id) => ({id, reason: stopped ?? ''})));
			return true;
		}
		try {
			await client.setModerationStatus(batch, status);
			result.done.push(...batch);
			return true;
		} catch (err) {
			if (err instanceof YouTubeApiError && err.isQuota) stopped = 'the API project\'s daily quota is used up (it resets at midnight Pacific Time)';
			if (batch.length > 1 && err instanceof YouTubeApiError && err.status < 500 && !err.isQuota) return false;
			result.failed.push(...batch.map((id) => ({id, error: message(err)})));
			return true;
		}
	};
	for (let i = 0; i < ids.length; i += HOLD_BATCH) {
		const batch = ids.slice(i, i + HOLD_BATCH);
		if (!(await attempt(batch))) for (const id of batch) await attempt([id]);
	}
	return result;
};

/* ------------------------------------------------------------------ commands */

const printSummary = (ctx: Context, report: Report, paths: {json: string; markdown: string}): void => {
	const {totals, quota} = report;
	const out = ctx.deps.stdout;
	out(`Scanned ${totals.scanned} comments${totals.threads !== null ? ` in ${totals.threads} threads` : ''}: ${totals.hold} to hold, ${totals.review} for review, ${totals.allow} allowed.`);
	if (report.truncated) out(`Stopped early: ${report.truncated}.`);
	if (quota) out(`Quota used: ${quota.used} of ${quota.budget} units.`);
	out(`Report: ${paths.markdown}`);
	out(`        ${paths.json}`);
};

const scan = async (ctx: Context): Promise<number> => {
	const budget = ctx.values.input ? null : new QuotaBudget(wholeNumber(ctx.values['max-quota'], 'max-quota', DEFAULT_MAX_QUOTA, 1_000_000));
	const report = await scanReport(ctx, budget);
	const paths = writeReport(ctx.outDir, report);
	printSummary(ctx, report, paths);
	ctx.deps.stdout('Dry run: nothing was changed on YouTube.');
	if (report.totals.hold && report.source === 'youtube') {
		ctx.deps.stdout(`To hold the ${report.totals.hold} comment(s) after reading the report: npm run guard -- apply --confirm --from-report latest`);
	}
	return 0;
};

const apply = async (ctx: Context): Promise<number> => {
	if (!ctx.values.confirm) {
		ctx.deps.stderr('"apply" holds comments on YouTube. Run "npm run guard" (dry run) first, read the report, then add --confirm.');
		return 2;
	}
	if (ctx.values.input) throw new UsageError('"apply" works on your channel, not on --input files.');
	const budget = new QuotaBudget(wholeNumber(ctx.values['max-quota'], 'max-quota', DEFAULT_MAX_QUOTA, 1_000_000));
	let report: Report;
	if (ctx.values['from-report']) {
		const path = userPath(resolveReport(ctx.values['from-report'], ctx.outDir, 'scan'));
		report = readReport(path);
		const {account} = chooseAccount(ctx);
		if (report.channel.id !== account.channelId) throw new UsageError(`${path} was made for another channel (${report.channel.id ?? 'a local file'}).`);
	} else {
		report = await scanReport(ctx, budget);
	}
	const {client} = clientFor(ctx, budget);
	const ids = report.items.filter((item) => item.action === 'hold').map((item) => item.commentId);
	const applied = await setStatus(client, budget, ids, 'heldForReview');
	const final: Report = {...report, mode: 'apply', generatedAt: ctx.deps.now().toISOString(), quota: quotaOf(budget), applied};
	const paths = writeReport(ctx.outDir, final);
	printSummary(ctx, final, paths);
	ctx.deps.stdout(`Held for review: ${applied.done.length}. Failed: ${applied.failed.length}. Not attempted: ${applied.notAttempted.length}.`);
	ctx.deps.stdout('Undo any of them in YouTube Studio > Comments > Held for review, or: npm run guard -- release --confirm <comment id>');
	return applied.failed.length || applied.notAttempted.length ? 1 : 0;
};

const release = async (ctx: Context, ids: string[]): Promise<number> => {
	if (!ctx.values.confirm) {
		ctx.deps.stderr('"release" publishes held comments again. Add --confirm.');
		return 2;
	}
	let targets = ids;
	if (ctx.values['from-report']) {
		const report = readReport(userPath(resolveReport(ctx.values['from-report'], ctx.outDir, 'apply')));
		targets = [...targets, ...(report.applied?.status === 'heldForReview' ? report.applied.done : [])];
	}
	const bad = targets.filter((id) => !COMMENT_ID.test(id));
	if (bad.length) throw new UsageError(`Not comment ids: ${bad.join(', ')}`);
	if (!targets.length) throw new UsageError('Give the comment ids to release, or --from-report with an "apply" report.');
	const budget = new QuotaBudget(wholeNumber(ctx.values['max-quota'], 'max-quota', DEFAULT_MAX_QUOTA, 1_000_000));
	const {client} = clientFor(ctx, budget);
	const result = await setStatus(client, budget, [...new Set(targets)], 'published');
	ctx.deps.stdout(`Published again: ${result.done.length}. Failed: ${result.failed.length}. Not attempted: ${result.notAttempted.length}.`);
	for (const f of result.failed) ctx.deps.stdout(`  ${f.id}: ${f.error}`);
	return result.failed.length || result.notAttempted.length ? 1 : 0;
};

const auth = async (ctx: Context): Promise<number> => {
	const {deps, values} = ctx;
	const existing = ctx.file;
	if (values.revoke) {
		const {key, account, file} = chooseAccount(ctx);
		await revokeToken(account.tokens.refreshToken, {endpoints: deps.endpoints, fetch: deps.fetch});
		delete file.accounts[key];
		writeOAuthFile(ctx.oauthPath, file);
		deps.stdout(`Revoked and removed the saved access for "${account.title}" (${account.channelId}).`);
		return 0;
	}
	if (values.account !== undefined && !ACCOUNT_KEY.test(values.account)) throw new UsageError('--account must be lower-case letters, digits, "-" or "_".');
	let client: OAuthClient | null = existing?.client ?? null;
	if (values['client-secrets']) client = readClientSecrets(userPath(values['client-secrets']));
	else if (deps.env.YOUTUBE_CLIENT_ID && deps.env.YOUTUBE_CLIENT_SECRET) client = {clientId: deps.env.YOUTUBE_CLIENT_ID, clientSecret: deps.env.YOUTUBE_CLIENT_SECRET};
	if (!client) {
		throw new UsageError(
			'No OAuth client. In Google Cloud Console, enable "YouTube Data API v3", create an OAuth client of type "Desktop app", ' +
				'download its JSON and run: npm run guard -- auth --client-secrets <file>. See README.md.',
		);
	}
	const tokens = await authorize({client, openUrl: deps.openUrl, endpoints: deps.endpoints, fetch: deps.fetch});
	const channel = await createClient({client, tokens, budget: new QuotaBudget(5), endpoints: deps.endpoints, fetch: deps.fetch}).myChannel();
	const handleKey = (channel.handle ?? '').replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
	const key = values.account ?? (ACCOUNT_KEY.test(handleKey) ? handleKey : 'default');
	const file: OAuthFile = existing ? {...existing, client} : {version: 1, client, accounts: {}};
	const others = Object.keys(file.accounts).filter((k) => k !== key);
	if (existing && existing.client.clientId !== client.clientId && others.length) {
		deps.stderr(`The OAuth client changed, so the saved access for ${others.join(', ')} will stop working: run "guard auth --account <key>" for each.`);
	}
	file.accounts[key] = {channelId: channel.id, title: channel.title, handle: channel.handle, tokens, savedAt: deps.now().toISOString()};
	writeOAuthFile(ctx.oauthPath, file);
	deps.stdout(`Saved access for "${channel.title}" (${channel.id}) as account "${key}" in ${ctx.oauthPath}.`);
	deps.stdout('Keep that file private: it is gitignored and holds a refresh token. Next: npm run guard');
	return 0;
};

/* ------------------------------------------------------------------ entry point */

export const main = async (argv: string[], overrides: Partial<Deps> = {}): Promise<number> => {
	const deps: Deps = {
		env: process.env,
		fetch: globalThis.fetch,
		endpoints: GOOGLE,
		stdout: (line) => process.stdout.write(`${line}\n`),
		stderr: (line) => process.stderr.write(`${line}\n`),
		now: () => new Date(),
		openUrl: (url) => {
			process.stdout.write(`\nOpen this link in a browser on this computer and allow access:\n\n${url}\n\nWaiting for Google...\n`);
		},
		projectDir: PROJECT_DIR,
		...overrides,
	};
	try {
		const {values, positionals} = parse(argv);
		const command = positionals[0] ?? 'scan';
		if (values.help || command === 'help') {
			deps.stdout(HELP);
			return 0;
		}
		if (command === 'blocked-words') {
			deps.stdout(blockedWordsGuide());
			return 0;
		}
		const oauthOption = values['oauth-file'] ?? deps.env.YOUTUBE_OAUTH_FILE;
		const oauthPath = oauthOption ? userPath(oauthOption) : join(deps.projectDir, 'config', 'youtube-oauth.json');
		const outDir = values.out ? userPath(values.out) : join(deps.projectDir, 'out', 'comment-guard');
		const ctx: Context = {deps, values, oauthPath, outDir, file: readOAuthFile(oauthPath)};
		if (command === 'scan') return await scan(ctx);
		if (command === 'apply') return await apply(ctx);
		if (command === 'release') return await release(ctx, positionals.slice(1));
		if (command === 'auth') return await auth(ctx);
		throw new UsageError(`Unknown command "${command}". Run "npm run guard -- help".`);
	} catch (err) {
		if (err instanceof UsageError || err instanceof AuthError || err instanceof QuotaBudgetError) {
			deps.stderr(err.message);
			return 2;
		}
		if (err instanceof YouTubeApiError) {
			deps.stderr(err.isQuota ? `${err.message}\nThe project's daily API quota is used up; it resets at midnight Pacific Time.` : err.message);
			return 1;
		}
		const code = (err as {code?: string}).code;
		deps.stderr(code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' || code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE' ? `${message(err)}\nRun "npm run guard -- help".` : `Error: ${message(err)}`);
		return 1;
	}
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exitCode = await main(process.argv.slice(2));
}
