/**
 * YouTube uploader: uploads a rendered episode by API only after the owner approved that exact file.
 *
 *   node tools/uploader/cli.ts approve <kit.json> [--render long|short-<n>] [--publish-at "YYYY-MM-DD HH:MM"]
 *       Shows exactly what would be sent and, when the owner types the episode slug, writes the approval record.
 *   node tools/uploader/cli.ts plan <kit.json> --approval <approval.json>
 *       Prints exactly what would be sent. Refuses without a valid approval whose hashes match the files now.
 *   node tools/uploader/cli.ts upload <kit.json> --approval <approval.json> --apply
 *       Uploads as private (publishAt from the approval, if any), then thumbnail, captions, playlist. Resumable.
 *   node tools/uploader/cli.ts auth --channel <slug> --client-secrets <client_secret.json>
 *   node tools/uploader/cli.ts status | categories
 *
 * README.md in this folder explains the setup, the approval record and every request. "help" lists all options.
 */
import {existsSync, readdirSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {createInterface} from 'node:readline/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {createApi} from './api.ts';
import {type ApprovalRecord, createApproval} from './approval.ts';
import {applyUpload, renderReceipt} from './apply.ts';
import {type Endpoints, GOOGLE, OWNER_TIME_ZONE, SCOPES} from './contracts.ts';
import {ApiError, fetchTransport, NetworkError, type Transport} from './http.ts';
import {DEFAULT_CHANNELS_FILE, loadChannels} from './inputs.ts';
import {openLedger} from './ledger.ts';
import {AuthError, authorize, clientFromEnv, createTokenSource, grantedScopes, readClientSecrets, readOAuthFile, revokeToken, scopeProblem, writeOAuthFile, EXPIRY_HELP} from './oauth.ts';
import {renderPlan} from './plan.ts';
import {EarlyRefusal, type Prepared, prepareForApproval, prepareFromApproval} from './prepare.ts';
import {createQuotaTracker, QuotaBudgetError} from './quota.ts';
import {PrivacyGuardError} from './requests.ts';
import {type JobState, loadJob} from './state.ts';
import {formatInZone, parsePublishTime, quotaDay, toUtcIso} from './time.ts';
import {type Reason, Refusal, UsageError, writeJsonAtomic} from './util.ts';

const TOOL_DIR = fileURLToPath(new URL('.', import.meta.url));
const MIB = 1024 * 1024;

export const EXIT = {ok: 0, failed: 1, usage: 2, refused: 3, notApproved: 4} as const;

const HELP = `YouTube uploader (tools/uploader). Nothing is sent without the owner's approval record.

Commands
  approve <kit.json>     Show the full upload plan and record the owner's approval (asks the owner to type the slug).
  plan <kit.json>        Print exactly what would be sent. Needs --approval; refuses unless the approval matches.
  upload <kit.json>      Same as plan (dry run). With --apply: upload as private, then thumbnail, captions, playlist.
  auth --channel <slug>  One-time Google sign-in for a channel; saves tokens to the gitignored state folder.
  status                 Saved authorizations, today's quota, uploads in the ledger, unfinished jobs.
  categories             List YouTube's video categories (1 quota unit) to choose categoryId in channels.json.

approve options
  --render <id>          kit render: long (default) or short-<n>
  --publish-at <time>    Schedule: "YYYY-MM-DD HH:MM" (read in ${OWNER_TIME_ZONE}) or ISO 8601 with an offset.
                         Leave it out to keep the video private until you publish it in Studio.
  --thumbnail <file|none>, --spec <file>, --storyboard <file>, --video <file>
  --valid-days <n>       How long the approval stays valid (default 7, max approvalMaxDays in channels.json).
  --confirm <slug>       Approve without the prompt (the owner typing the slug). Never pass this for the owner.
  --by <label>           Who approved, as a role (default "owner"). --note <text>. --out <file>.

plan / upload options
  --approval <file>      The approval record (required).
  --apply                upload only: actually send. Without it, nothing is sent.
  --video <file>         The rendered file, if it moved (its SHA-256 must still match the approval).
  --json                 plan only: print the plan as JSON.
  --max-quota <units>    Cap on this run's quota units (default maxUnitsPerRun in channels.json).
  --chunk-mb <n>         Upload chunk size in MiB, a multiple of 0.25 (default 32).
  --restart-upload       Start a new session when the saved one expired. Check Studio for the video first.
  --allow-second-upload  Upload a second, different file for the same episode render.
  --processing-polls <n> Shorts with a thumbnail: how often to check processing first (default 20, 1 unit each).
  --processing-interval <s> Seconds between those checks (default 30).

Common options
  --video-studio <dir>   projects/video-studio (default: from the kit's path, else the sibling project).
  --state-dir <dir>      Tokens, ledger, quota and job files (default tools/uploader/.local, or $UPLOADER_STATE_DIR).
  --oauth-file <file>    Default <state-dir>/oauth.json, or $UPLOADER_OAUTH_FILE.
  --channels <file>      Channel settings (default tools/uploader/channels.json).

auth options
  --channel <slug>       Channel slug from channels.json (required).
  --client-secrets <file> The "Desktop app" OAuth client JSON from Google Cloud Console (first time only).
  --revoke               Revoke and forget this channel's saved authorization.

categories options
  --channel <slug>       Which saved authorization to use (needed when more than one is saved).
  --region <code>        Country whose categories to list (default US).

Exit codes: 0 done, 1 failed or paused (run again to resume), 2 bad input, 3 refused, 4 previewed but not approved.
`;

export type Deps = {
	transport: Transport;
	endpoints: Endpoints;
	now: () => number;
	sleep: (ms: number) => Promise<void>;
	random: () => number;
	stdout: (text: string) => void;
	stderr: (text: string) => void;
	/** Asks the owner a question; null when there is no terminal (then "approve" needs --confirm). */
	prompt: ((question: string) => Promise<string>) | null;
	env: Record<string, string | undefined>;
	cwd: string;
	openUrl: (url: string) => void | Promise<void>;
};

const defaultDeps = (): Deps => ({
	transport: fetchTransport,
	endpoints: GOOGLE,
	now: Date.now,
	sleep: (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)),
	random: Math.random,
	stdout: (text) => process.stdout.write(text),
	stderr: (text) => process.stderr.write(text),
	prompt: process.stdin.isTTY
		? async (question) => {
				const rl = createInterface({input: process.stdin, output: process.stdout});
				try {
					return await rl.question(question);
				} finally {
					rl.close();
				}
			}
		: null,
	env: process.env,
	cwd: process.cwd(),
	openUrl: (url) => {
		process.stdout.write(`\nOpen this address in your browser and sign in with the channel's Google account:\n\n${url}\n\nWaiting for Google (5 minutes)...\n`);
	},
});

const OPTIONS = {
	approval: {type: 'string'},
	apply: {type: 'boolean'},
	render: {type: 'string'},
	video: {type: 'string'},
	thumbnail: {type: 'string'},
	spec: {type: 'string'},
	storyboard: {type: 'string'},
	'publish-at': {type: 'string'},
	'valid-days': {type: 'string'},
	confirm: {type: 'string'},
	by: {type: 'string'},
	note: {type: 'string'},
	out: {type: 'string'},
	json: {type: 'boolean'},
	'max-quota': {type: 'string'},
	'chunk-mb': {type: 'string'},
	'restart-upload': {type: 'boolean'},
	'allow-second-upload': {type: 'boolean'},
	'processing-polls': {type: 'string'},
	'processing-interval': {type: 'string'},
	'video-studio': {type: 'string'},
	'state-dir': {type: 'string'},
	'oauth-file': {type: 'string'},
	channels: {type: 'string'},
	channel: {type: 'string'},
	'client-secrets': {type: 'string'},
	revoke: {type: 'boolean'},
	region: {type: 'string'},
	help: {type: 'boolean', short: 'h'},
} as const;

type Values = ReturnType<typeof parseArgs<{options: typeof OPTIONS; allowPositionals: true}>>['values'];

const intOption = (value: string | undefined, name: string, min: number, max: number, fallback: number): number => {
	if (value === undefined) return fallback;
	const n = Number(value);
	if (!Number.isInteger(n) || n < min || n > max) throw new UsageError(`--${name} must be a whole number from ${min} to ${max}.`);
	return n;
};

const chunkBytesOption = (value: string | undefined): number => {
	if (value === undefined) return 32 * MIB;
	const mib = Number(value);
	const bytes = Math.round(mib * MIB);
	if (!Number.isFinite(mib) || mib <= 0 || mib > 1024 || bytes % 262_144 !== 0) throw new UsageError('--chunk-mb must be a multiple of 0.25 (256 KiB), up to 1024.');
	return bytes;
};

const reasonsText = (title: string, reasons: Reason[]): string => `${title}\n${reasons.map((r) => `- [${r.code}] ${r.message}`).join('\n')}\n`;

type Paths = {stateDir: string; oauthPath: string; channelsPath: string};

const paths = (values: Values, deps: Deps): Paths => {
	const stateDir = values['state-dir'] ? resolve(deps.cwd, values['state-dir']) : deps.env.UPLOADER_STATE_DIR ? resolve(deps.cwd, deps.env.UPLOADER_STATE_DIR) : join(TOOL_DIR, '.local');
	const oauthPath = values['oauth-file'] ? resolve(deps.cwd, values['oauth-file']) : deps.env.UPLOADER_OAUTH_FILE ? resolve(deps.cwd, deps.env.UPLOADER_OAUTH_FILE) : join(stateDir, 'oauth.json');
	const channelsPath = values.channels ? resolve(deps.cwd, values.channels) : DEFAULT_CHANNELS_FILE;
	return {stateDir, oauthPath, channelsPath};
};

const abs = (deps: Deps, value: string | undefined): string | undefined => (value === undefined ? undefined : resolve(deps.cwd, value));

/* ------------------------------------------------------------------ approve */

const approve = async (kitArg: string, values: Values, deps: Deps, p: Paths): Promise<number> => {
	const channels = loadChannels(p.channelsPath);
	let publishAt: string | null = null;
	if (values['publish-at']) {
		const parsed = parsePublishTime(values['publish-at']);
		if (!parsed.ok) throw new UsageError(parsed.message);
		publishAt = toUtcIso(parsed.ms);
	}
	const validDays = intOption(values['valid-days'], 'valid-days', 1, channels.approvalMaxDays, Math.min(7, channels.approvalMaxDays));
	const thumbnail = values.thumbnail === undefined ? undefined : values.thumbnail === 'none' ? null : resolve(deps.cwd, values.thumbnail);
	const prepared = await prepareForApproval({
		kitPath: resolve(deps.cwd, kitArg),
		videoStudioRoot: abs(deps, values['video-studio']) ?? null,
		channels,
		stateDir: p.stateDir,
		nowMs: deps.now(),
		processingPolls: intOption(values['processing-polls'], 'processing-polls', 0, 120, 20),
		allowSecondUpload: values['allow-second-upload'] === true,
		renderId: values.render ?? 'long',
		video: abs(deps, values.video),
		thumbnail,
		spec: abs(deps, values.spec),
		storyboard: abs(deps, values.storyboard),
		publishAt,
	});
	const {plan, inputs} = prepared;
	const out = values.out ? resolve(deps.cwd, values.out) : join(dirname(inputs.kitPath), `approval-${plan.renderId}.json`);
	deps.stdout(
		renderPlan(plan, deps.endpoints, {
			chunkBytes: chunkBytesOption(values['chunk-mb']),
			header: [`PREVIEW, NOT APPROVED: ${plan.channel}/${plan.slug} render "${plan.renderId}"`, `Nothing is sent by this command. Approving writes ${out}.`],
		}),
	);
	if (prepared.refusals.length) {
		deps.stderr(reasonsText('\nCannot be approved: these would stop the upload.', prepared.refusals));
		return EXIT.refused;
	}
	let confirmed = values.confirm === plan.slug;
	if (values.confirm !== undefined && !confirmed) {
		deps.stderr(`--confirm "${values.confirm}" does not match the episode slug "${plan.slug}". Not approved.\n`);
		return EXIT.notApproved;
	}
	if (!confirmed && deps.prompt) {
		const answer = await deps.prompt(`\nApprove uploading exactly this (private${plan.publishAt ? `, scheduled ${formatInZone(Date.parse(plan.publishAt))}` : ''})? Type the episode slug "${plan.slug}" to approve, anything else to cancel: `);
		confirmed = answer.trim() === plan.slug;
	}
	if (!confirmed) {
		deps.stderr(`\nNot approved, nothing written.${deps.prompt ? '' : ` To approve without a terminal, the owner runs this again with --confirm ${plan.slug}.`}\n`);
		return EXIT.notApproved;
	}
	const record: ApprovalRecord = createApproval(plan, {
		nowMs: deps.now(),
		approvedBy: values.by ?? 'owner',
		validDays,
		spec: inputs.spec?.rel ?? null,
		...(values.note ? {note: values.note} : {}),
	});
	writeJsonAtomic(out, record, 0o644);
	deps.stdout(`\nApproved. Approval record: ${out} (valid until ${formatInZone(Date.parse(record.expiresAt))}).\nNext: node tools/uploader/cli.ts upload ${kitArg} --approval ${out} --apply\n`);
	return EXIT.ok;
};

/* ------------------------------------------------------------------ plan / upload */

const prepareApproved = async (kitArg: string, values: Values, deps: Deps, p: Paths): Promise<Prepared | number> => {
	if (!values.approval) {
		deps.stderr(reasonsText('REFUSED: nothing was sent.', [{code: 'approval-missing', message: 'No --approval <approval.json>. Nothing is sent without the owner\'s approval: run "cli.ts approve <kit.json>" first.'}]));
		return EXIT.refused;
	}
	const channels = loadChannels(p.channelsPath);
	try {
		const prepared = await prepareFromApproval({
			kitPath: resolve(deps.cwd, kitArg),
			approvalPath: resolve(deps.cwd, values.approval),
			videoStudioRoot: abs(deps, values['video-studio']) ?? null,
			channels,
			stateDir: p.stateDir,
			nowMs: deps.now(),
			processingPolls: intOption(values['processing-polls'], 'processing-polls', 0, 120, 20),
			allowSecondUpload: values['allow-second-upload'] === true,
			video: abs(deps, values.video),
		});
		if (prepared.refusals.length) {
			deps.stderr(reasonsText('REFUSED: nothing was sent.', prepared.refusals));
			return EXIT.refused;
		}
		return prepared;
	} catch (error) {
		if (error instanceof EarlyRefusal) {
			deps.stderr(reasonsText('REFUSED: nothing was sent.', error.reasons));
			return EXIT.refused;
		}
		throw error;
	}
};

const planHeader = (prepared: Prepared, title: string): string[] => {
	const a = prepared.approval as ApprovalRecord;
	return [
		`${title}: ${prepared.plan.channel}/${prepared.plan.slug} render "${prepared.plan.renderId}"`,
		`Approved by ${a.approvedBy} at ${formatInZone(Date.parse(a.approvedAt))}; valid until ${formatInZone(Date.parse(a.expiresAt))}. Approval sha256 ${prepared.approvalSha256}.`,
		`Checked now: render sha256 ${prepared.plan.video.sha256.slice(0, 16)}… matches, storyboard v${prepared.plan.storyboard.version} matches, plan digest matches.`,
	];
};

const plan = async (kitArg: string, values: Values, deps: Deps, p: Paths): Promise<number> => {
	const prepared = await prepareApproved(kitArg, values, deps, p);
	if (typeof prepared === 'number') return prepared;
	if (values.json) {
		deps.stdout(`${JSON.stringify({approval: {sha256: prepared.approvalSha256, approvedAt: prepared.approval?.approvedAt, expiresAt: prepared.approval?.expiresAt}, plan: prepared.plan}, null, 2)}\n`);
		return EXIT.ok;
	}
	deps.stdout(renderPlan(prepared.plan, deps.endpoints, {chunkBytes: chunkBytesOption(values['chunk-mb']), header: [...planHeader(prepared, 'APPROVED UPLOAD PLAN'), 'Nothing has been sent. "upload --apply" sends exactly these requests.']}));
	return EXIT.ok;
};

const upload = async (kitArg: string, values: Values, deps: Deps, p: Paths): Promise<number> => {
	const prepared = await prepareApproved(kitArg, values, deps, p);
	if (typeof prepared === 'number') return prepared;
	const chunkBytes = chunkBytesOption(values['chunk-mb']);
	if (!values.apply) {
		deps.stdout(renderPlan(prepared.plan, deps.endpoints, {chunkBytes, header: [...planHeader(prepared, 'DRY RUN'), 'Nothing was sent. Add --apply to upload.']}));
		return EXIT.ok;
	}
	const channels = prepared.inputs.config;
	const result = await applyUpload(
		prepared,
		{transport: deps.transport, endpoints: deps.endpoints, stateDir: p.stateDir, oauthPath: p.oauthPath, env: deps.env, now: deps.now, sleep: deps.sleep, random: deps.random, log: (line) => deps.stdout(`${line}\n`)},
		{
			chunkBytes,
			restartUpload: values['restart-upload'] === true,
			allowSecondUpload: values['allow-second-upload'] === true,
			maxUnitsPerRun: intOption(values['max-quota'], 'max-quota', 1, channels.dailyLimits.defaultUnits, channels.maxUnitsPerRun),
			processingPolls: intOption(values['processing-polls'], 'processing-polls', 0, 120, 20),
			processingIntervalMs: intOption(values['processing-interval'], 'processing-interval', 1, 600, 30) * 1000,
		},
	);
	deps.stdout(`\n${renderReceipt(result, prepared.plan)}`);
	return result.complete && !result.alerts.length ? EXIT.ok : EXIT.failed;
};

/* ------------------------------------------------------------------ auth / status / categories */

const auth = async (values: Values, deps: Deps, p: Paths): Promise<number> => {
	const slug = values.channel;
	if (!slug) throw new UsageError('auth needs --channel <slug> (a channel from channels.json).');
	const channels = loadChannels(p.channelsPath);
	const config = channels.channels[slug];
	if (!config) throw new UsageError(`"${slug}" is not in ${p.channelsPath}.`);
	const file = readOAuthFile(p.oauthPath);
	if (values.revoke) {
		const account = file.accounts[slug];
		if (!account) {
			deps.stdout(`No saved authorization for "${slug}".\n`);
			return EXIT.ok;
		}
		await revokeToken(account.tokens.refreshToken, deps.transport, deps.endpoints);
		delete file.accounts[slug];
		writeOAuthFile(p.oauthPath, file);
		deps.stdout(`Revoked and removed the authorization for "${slug}".\n`);
		return EXIT.ok;
	}
	const client = values['client-secrets'] ? readClientSecrets(resolve(deps.cwd, values['client-secrets'])) : (clientFromEnv(deps.env) ?? file.client);
	if (!client) throw new UsageError('First sign-in needs --client-secrets <client_secret.json> (a "Desktop app" OAuth client; README "One-time setup").');
	const tokens = await authorize({client, transport: deps.transport, endpoints: deps.endpoints, openUrl: deps.openUrl, now: deps.now});
	const problem = scopeProblem(tokens.scope);
	if (problem) throw new AuthError(problem);
	const quota = createQuotaTracker({path: join(p.stateDir, 'quota.json'), now: deps.now, limits: channels.dailyLimits, runCap: 10});
	const api = createApi({transport: deps.transport, endpoints: deps.endpoints, tokens: createTokenSource({client, tokens, transport: deps.transport, endpoints: deps.endpoints, now: deps.now, onTokens: () => {}}), quota, sleep: deps.sleep, random: deps.random, now: deps.now, log: () => {}});
	const channel = await api.myChannel();
	if (config.youtubeChannelId && channel.id !== config.youtubeChannelId) {
		deps.stderr(reasonsText('Not saved.', [{code: 'wrong-channel', message: `You signed in as ${channel.title} (${channel.id}), but channels.json pins "${slug}" to ${config.youtubeChannelId}. Run auth again and choose that channel.`}]));
		return EXIT.refused;
	}
	if (values['client-secrets']) file.client = client;
	file.accounts[slug] = {channelId: channel.id, title: channel.title, handle: channel.handle, authorizedAt: toUtcIso(deps.now()), tokens};
	writeOAuthFile(p.oauthPath, file);
	const missingUpload = !grantedScopes(tokens.scope).includes(SCOPES[0]);
	deps.stdout(
		[
			`Saved: "${slug}" uploads to ${channel.title}${channel.handle ? ` (${channel.handle})` : ''}, channel id ${channel.id}.`,
			`Tokens: ${p.oauthPath} (owner-only file in the gitignored state folder).`,
			...(missingUpload ? ['Note: youtube.upload was not granted; youtube.force-ssl covers uploads too, so this still works.'] : []),
			...(config.youtubeChannelId ? [] : [`Tip: pin it in channels.json ("youtubeChannelId": "${channel.id}") so a wrong sign-in can never upload.`]),
			'',
			`Refresh tokens: ${EXPIRY_HELP}`,
			'',
		].join('\n'),
	);
	return EXIT.ok;
};

const status = (deps: Deps, p: Paths): number => {
	const lines: string[] = [];
	const file = readOAuthFile(p.oauthPath);
	lines.push(`Authorizations (${p.oauthPath}):`);
	const accounts = Object.entries(file.accounts);
	if (!accounts.length) lines.push('  none: run "cli.ts auth --channel <slug> --client-secrets <file>"');
	for (const [slug, account] of accounts) {
		const age = Math.floor((deps.now() - Date.parse(account.authorizedAt)) / 86_400_000);
		const scope = scopeProblem(account.tokens.scope) ? 'MISSING youtube.force-ssl' : 'scopes ok';
		lines.push(`  ${slug}: ${account.title} (${account.channelId}), signed in ${age} day(s) ago, ${scope}.${age >= 6 ? ' If your OAuth app is in "Testing", this sign-in expires 7 days after consent: run auth again, or see README to stop the expiry.' : ''}`);
	}
	const channels = existsSync(p.channelsPath) ? loadChannels(p.channelsPath) : null;
	const quota = createQuotaTracker({path: join(p.stateDir, 'quota.json'), now: deps.now, limits: channels?.dailyLimits ?? {defaultUnits: 10_000, uploadCalls: 100}, runCap: 1});
	const today = quota.today();
	lines.push('', `Quota today (${quotaDay(deps.now())}, Pacific time; local count): ${today.default} units of ${channels?.dailyLimits.defaultUnits ?? 10_000}, ${today.uploads} upload calls of ${channels?.dailyLimits.uploadCalls ?? 100}.`);
	const ledgerPath = join(p.stateDir, 'ledger.json');
	const entries = existsSync(ledgerPath) ? openLedger(ledgerPath).entries() : [];
	lines.push('', `Ledger (${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}):`);
	for (const e of entries.slice(-15)) lines.push(`  ${e.status.padEnd(9)} ${e.channel}/${e.slug} ${e.renderId} ${e.videoId ? `https://youtu.be/${e.videoId}` : '(no video yet)'} ${e.updatedAt}`);
	const jobsDir = join(p.stateDir, 'jobs');
	const unfinished: JobState[] = existsSync(jobsDir)
		? readdirSync(jobsDir)
				.filter((f) => f.endsWith('.json'))
				.map((f) => loadJob(join(jobsDir, f)))
				.filter((j): j is JobState => j !== null && !j.completedAt)
		: [];
	lines.push('', `Unfinished jobs: ${unfinished.length ? '' : 'none'}`);
	for (const j of unfinished) lines.push(`  ${j.channel}/${j.slug} ${j.renderId}: upload ${j.insert.status} (${j.insert.confirmedBytes} bytes confirmed), thumbnail ${j.thumbnail.status}, playlist ${j.playlist.status}. Run the same upload command again to resume.`);
	deps.stdout(`${lines.join('\n')}\n`);
	return EXIT.ok;
};

const categories = async (values: Values, deps: Deps, p: Paths): Promise<number> => {
	const file = readOAuthFile(p.oauthPath);
	const slugs = Object.keys(file.accounts);
	const slug = values.channel ?? (slugs.length === 1 ? slugs[0] : undefined);
	if (!slug || !file.accounts[slug]) throw new UsageError(`categories needs a saved authorization${slugs.length > 1 ? `: pass --channel (${slugs.join(', ')})` : ': run "cli.ts auth --channel <slug>" first'}.`);
	const client = clientFromEnv(deps.env) ?? file.client;
	if (!client) throw new UsageError('No OAuth client saved: run auth with --client-secrets.');
	const account = file.accounts[slug];
	const channels = existsSync(p.channelsPath) ? loadChannels(p.channelsPath) : null;
	const quota = createQuotaTracker({path: join(p.stateDir, 'quota.json'), now: deps.now, limits: channels?.dailyLimits ?? {defaultUnits: 10_000, uploadCalls: 100}, runCap: 5});
	const tokens = createTokenSource({client, tokens: account.tokens, transport: deps.transport, endpoints: deps.endpoints, now: deps.now, onTokens: (fresh) => {
		account.tokens = fresh;
		writeOAuthFile(p.oauthPath, file);
	}});
	const api = createApi({transport: deps.transport, endpoints: deps.endpoints, tokens, quota, sleep: deps.sleep, random: deps.random, now: deps.now, log: () => {}});
	const region = (values.region ?? 'US').toUpperCase();
	const list = await api.categories(region);
	deps.stdout(`YouTube video categories for ${region} you can assign (set one as categoryId in channels.json):\n${list.filter((c) => c.assignable).map((c) => `  ${c.id.padStart(3)}  ${c.title}`).join('\n')}\n`);
	return EXIT.ok;
};

/* ------------------------------------------------------------------ main */

export const main = async (argv: string[], overrides: Partial<Deps> = {}): Promise<number> => {
	const deps: Deps = {...defaultDeps(), ...overrides};
	let parsed: {values: Values; positionals: string[]};
	try {
		parsed = parseArgs({args: argv, options: OPTIONS, allowPositionals: true, strict: true});
	} catch (error) {
		deps.stderr(`${(error as Error).message}\n\n${HELP}`);
		return EXIT.usage;
	}
	const {values, positionals} = parsed;
	const [command, ...rest] = positionals;
	if (values.help || !command || command === 'help') {
		deps.stdout(HELP);
		return command || values.help ? EXIT.ok : EXIT.usage;
	}
	const p = paths(values, deps);
	try {
		const needsKit = ['approve', 'plan', 'upload'].includes(command);
		if (needsKit && rest.length !== 1) throw new UsageError(`${command} needs exactly one kit.json path.`);
		if (!needsKit && rest.length) throw new UsageError(`${command} takes no file arguments.`);
		switch (command) {
			case 'approve':
				return await approve(rest[0], values, deps, p);
			case 'plan':
				return await plan(rest[0], values, deps, p);
			case 'upload':
				return await upload(rest[0], values, deps, p);
			case 'auth':
				return await auth(values, deps, p);
			case 'status':
				return status(deps, p);
			case 'categories':
				return await categories(values, deps, p);
			default:
				throw new UsageError(`Unknown command "${command}".`);
		}
	} catch (error) {
		if (error instanceof UsageError) {
			deps.stderr(reasonsText('Bad input:', error.reasons));
			return EXIT.usage;
		}
		if (error instanceof Refusal) {
			deps.stderr(reasonsText('REFUSED: nothing more was sent.', error.reasons));
			return EXIT.refused;
		}
		if (error instanceof PrivacyGuardError) {
			deps.stderr(`REFUSED by the privacy guard: ${error.message}\n`);
			return EXIT.refused;
		}
		const resume = command === 'upload' ? '\nThe job state is saved: run the same command again to resume.' : '';
		if (error instanceof QuotaBudgetError) deps.stderr(`Stopped: ${error.message}${resume}\n`);
		else if (error instanceof ApiError && error.isQuota) deps.stderr(`Stopped: YouTube says the quota is used up (${error.reason}). It resets at midnight Pacific Time.${resume}\n`);
		else if (error instanceof AuthError) deps.stderr(`Authorization problem: ${error.message}\n`);
		else if (error instanceof ApiError || error instanceof NetworkError) deps.stderr(`Failed: ${error.message}${resume}\n`);
		else deps.stderr(`Failed: ${(error as Error).stack ?? String(error)}${resume}\n`);
		return EXIT.failed;
	}
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exitCode = await main(process.argv.slice(2));
}
