/**
 * Scene-level retention feedback. Run from projects/creator-hub:
 *
 *   node tools/retention/cli.ts <command> [options]      (help: node tools/retention/cli.ts help)
 *
 * Exit codes: 0 ok, 1 failed, 2 usage, 3 not authorized, 4 policy decision missing.
 * Nothing here uploads, publishes or changes anything on YouTube: every API call is a read.
 *
 * Meant for the owner's own computer. In CI (CI or GITHUB_ACTIONS set) it prints counts only, never a metric or a
 * finding, because this repository is public and so are its workflow logs (README "Where to run it").
 */
import {existsSync, mkdirSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {isAbsolute, join, relative, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {aggregate} from './aggregate.ts';
import {analyzeRecords} from './analyze.ts';
import {ApiError, createApi, ENDPOINTS, type Endpoints, type TokenSource} from './api.ts';
import {AuthError, authorize, clientSecretsWarning, envTokenSource, fileTokenSource, hasEnvTokens, readClientSecrets, readTokenFile, revokeToken, writeTokenFile, type TokenFile} from './oauth.ts';
import {recommend} from './recommend.ts';
import {buildReportJson, renderReportMarkdown, topDrops} from './report.ts';
import {RULES} from './rules.ts';
import {ageDays, deleteRecords, loadRecords, POLICY_GATE, policyProblem, readPolicy, readPolicyStatus, saveRecord, savePolicy, tokenPath, VIDEO_ID} from './store.ts';
import {demoUploads, synthRecord} from './synth.ts';
import {buildJoin, JoinError} from './timeline.ts';
import {LANGS, type Audience, type JoinSnapshot, type PullChecks, type PullRecord} from './types.ts';

const PROJECT_DIR = fileURLToPath(new URL('../../', import.meta.url));

export const USAGE = `Usage: node tools/retention/cli.ts <command> [options]   (run from projects/creator-hub)

Commands
  auth      Authorize read-only access (yt-analytics.readonly + youtube.readonly); tokens are saved in the gitignored
            data folder. Prints the Google consent URL; open it on this machine (the answer comes back to 127.0.0.1).
              --client-secrets <file>   the "Desktop app" OAuth client JSON from Google Cloud (needed the first time)
              --account <key>           a name for this channel's authorization (default: default)
  pull      Pull one upload's retention curve and join it with our scene timeline.
              --video <id> --slug <channel/slug> --lang <${LANGS.join('|')}> [--short <shortId>]
              --start / --end <YYYY-MM-DD>   data window (default: publish date to today)
              --audience <all|organic|ad-instream|ad-indisplay>   (default: all)
              --timeline <file> --storyboard <file>   use these instead of video-studio's files
              --renderer <episode|show>  which composition made the upload (default: show for zoora-security)
              --video-studio <dir>       default: VIDEO_STUDIO_DIR or ../video-studio
              --mla                      the upload carries extra dubbed audio tracks (its curve blends languages)
              --account <key>
  refresh   Re-pull every stored upload older than ${RULES.staleDays} days (--all: every one); deletes the records of
            videos that no longer exist. YouTube API Developer Policies III.E.4 require this every ${RULES.staleDays} days.
  report    Write out/retention/report.md and report.json from the stored pulls.
              --min-views <n> (default ${RULES.minViews})  --include-stale  --allow-unverified-duration  --out <dir>
  status    List stored pulls (age, sample, problems), saved authorizations and the policy decision.
  forget    Delete stored pulls: --video <id> (repeatable) or --all; add --reports to delete the reports too (--out).
            This deletes only this tool's copies; nothing on YouTube changes.
  revoke    Revoke the saved authorization at Google (--account <key>), delete it and the pulls made with it.
  policy    Record your decision on YouTube's derived-metrics policy (pull, refresh and report need it):
              --derived-metrics accepted --date <YYYY-MM-DD> [--note <text>]   (you accepted the amendment)
              --derived-metrics exempted --date <YYYY-MM-DD> --note '<YouTube's written answer, quoted>'
            There is no self-exemption: "not-required" is refused.
  demo      Write a SYNTHETIC demo report (no YouTube data) to out/retention-demo/ (or --out).

Common: --data <dir> (default: DATA_DIR or projects/creator-hub/data).
Run it on your own computer. In CI (CI or GITHUB_ACTIONS set) it prints counts only: the repository and its logs are public.
Exit codes: 0 ok, 1 failed, 2 usage, 3 not authorized, 4 policy decision missing.`;

/** CI logs of this public repository are public: print counts only there, never a metric or a finding. */
export const countsOnly = (env: Record<string, string | undefined>): boolean => ['CI', 'GITHUB_ACTIONS'].some((k) => (env[k] ?? '').trim() !== '' && env[k]!.trim().toLowerCase() !== 'false' && env[k]!.trim() !== '0');

export type CliDeps = {
	env: Record<string, string | undefined>;
	cwd: string;
	fetch: typeof fetch;
	now: () => Date;
	print: (line: string) => void;
	printError: (line: string) => void;
	endpoints: Endpoints;
	openUrl: (url: string) => void | Promise<void>;
	sleep: (ms: number) => Promise<void>;
};

class UsageError extends Error {}

const AUDIENCES: Record<string, Audience> = {all: 'all', organic: 'ORGANIC', 'ad-instream': 'AD_INSTREAM', 'ad-indisplay': 'AD_INDISPLAY'};
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (value: string): boolean => DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

const writeAtomic = (file: string, content: string): void => {
	const temp = `${file}.${process.pid}.tmp`;
	writeFileSync(temp, content);
	renameSync(temp, file);
};

/** Primary language subtag match: "pt-BR" and "pt-br", "es-419" and "es", "zh-Hans" and "zh". */
export const sameLanguage = (youtube: string, ours: string): boolean => youtube.toLowerCase().split(/[-_]/)[0] === ours.toLowerCase().split(/[-_]/)[0];

export const durationCheck = (join: JoinSnapshot, durationSec: number | null): Pick<PullChecks, 'durationMatch' | 'durationDeltaMs'> => {
	if (durationSec === null) return {durationMatch: null, durationDeltaMs: null};
	const delta = durationSec * 1000 - join.totalMs;
	return {durationMatch: Math.abs(delta) <= Math.max(RULES.durationTolerance.ms, join.totalMs * RULES.durationTolerance.fraction), durationDeltaMs: delta};
};

export const formatCheck = (format: 'long' | 'short', contentType: string | null): boolean | null =>
	contentType === 'SHORTS' ? format === 'short' : contentType === 'VIDEO_ON_DEMAND' || contentType === 'LIVE_STREAM' ? format === 'long' : null;

export const main = async (argv: string[], overrides: Partial<CliDeps> = {}): Promise<number> => {
	const deps: CliDeps = {
		env: process.env,
		cwd: process.env.INIT_CWD ?? process.cwd(),
		fetch: globalThis.fetch,
		now: () => new Date(),
		print: (line) => console.log(line),
		printError: (line) => console.error(line),
		endpoints: ENDPOINTS,
		openUrl: (url) => console.log(`\nOpen this address in a browser on this machine and allow read-only access:\n\n${url}\n`),
		sleep: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
		...overrides,
	};
	const [command, ...rest] = argv;
	if (!command || command === 'help' || command === '--help' || command === '-h') {
		deps.print(USAGE);
		return command ? 0 : 2;
	}
	try {
		const {values} = parseArgs({
			args: rest,
			strict: true,
			allowPositionals: false,
			options: {
				data: {type: 'string'},
				out: {type: 'string'},
				account: {type: 'string'},
				'client-secrets': {type: 'string'},
				video: {type: 'string', multiple: true},
				slug: {type: 'string'},
				lang: {type: 'string'},
				short: {type: 'string'},
				start: {type: 'string'},
				end: {type: 'string'},
				audience: {type: 'string'},
				timeline: {type: 'string'},
				storyboard: {type: 'string'},
				renderer: {type: 'string'},
				'video-studio': {type: 'string'},
				mla: {type: 'boolean'},
				all: {type: 'boolean'},
				reports: {type: 'boolean'},
				'min-views': {type: 'string'},
				'include-stale': {type: 'boolean'},
				'allow-unverified-duration': {type: 'boolean'},
				'derived-metrics': {type: 'string'},
				date: {type: 'string'},
				note: {type: 'string'},
			},
		});
		const fromCwd = (p: string): string => (isAbsolute(p) ? p : resolve(deps.cwd, p));
		const dataDir = values.data ? fromCwd(values.data) : deps.env.DATA_DIR ? fromCwd(deps.env.DATA_DIR) : join(PROJECT_DIR, 'data');
		const show = (p: string): string => {
			const rel = relative(deps.cwd, p);
			return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : p;
		};
		const account = values.account ?? 'default';
		const tokensAt = tokenPath(dataDir);

		const quiet = countsOnly(deps.env);
		const policyOk = (): boolean => {
			const status = readPolicyStatus(dataDir, deps.env);
			if (status.decision) return true;
			if (status.problem) deps.printError(`Not usable: ${status.problem}.\n`);
			deps.printError(POLICY_GATE);
			return false;
		};

		const tokenSource = (): {source: TokenSource; account: string | null} => {
			if (hasEnvTokens(deps.env)) return {source: envTokenSource(deps.env, deps.fetch), account: null};
			if (!existsSync(tokensAt)) throw new AuthError(`No saved authorization (${show(tokensAt)}). Run: node tools/retention/cli.ts auth --client-secrets <client.json>`);
			const {source} = fileTokenSource({path: tokensAt, account, endpoints: deps.endpoints, fetch: deps.fetch, now: () => deps.now().getTime()});
			return {source, account};
		};

		switch (command) {
			case 'auth': {
				const existing = readTokenFile(tokensAt);
				if (values['client-secrets']) {
					const warning = clientSecretsWarning(fromCwd(values['client-secrets']));
					if (warning) deps.printError(warning);
				}
				const client = values['client-secrets'] ? readClientSecrets(fromCwd(values['client-secrets'])) : existing?.client;
				if (!client) throw new UsageError('First authorization: pass --client-secrets <file> (a "Desktop app" OAuth client JSON from Google Cloud Console).');
				const tokens = await authorize({client, openUrl: deps.openUrl, endpoints: deps.endpoints, fetch: deps.fetch, now: () => deps.now().getTime()});
				const api = createApi({endpoints: deps.endpoints, fetch: deps.fetch, token: async () => tokens.accessToken!, sleep: deps.sleep});
				const channel = await api.myChannel();
				const file: TokenFile = existing ?? {version: 1, kind: 'retention-oauth', client, accounts: {}};
				file.client = client;
				file.accounts[account] = {channelId: channel.id, title: channel.title, tokens, savedAt: deps.now().toISOString()};
				writeTokenFile(tokensAt, file);
				deps.print(`Authorized read-only access to "${channel.title}" (${channel.id}) as account "${account}". Saved to ${show(tokensAt)} (gitignored, mode 600).`);
				deps.print('If the Google Cloud consent screen is in "Testing", this authorization expires in 7 days: set it to "In production".');
				return 0;
			}

			case 'policy': {
				const decision = values['derived-metrics'];
				if (decision === undefined) {
					const current = readPolicy(dataDir, deps.env);
					deps.print(current ? `Recorded: derived metrics "${current.derivedMetrics}" on ${current.date}${current.note ? ` (${current.note})` : ''}.` : 'No decision recorded yet.');
					deps.print(`\n${POLICY_GATE}`);
					return 0;
				}
				if (decision !== 'accepted' && decision !== 'exempted') {
					throw new UsageError(
						decision === 'not-required'
							? '"not-required" is not a decision YouTube\'s policy allows: there is no self-exemption from the derived-metrics amendment. Accept it (--derived-metrics accepted), or record YouTube\'s written exemption (--derived-metrics exempted --note with their words in quotation marks).'
							: '--derived-metrics must be accepted or exempted.',
					);
				}
				if (!values.date || !isDate(values.date)) throw new UsageError('--date YYYY-MM-DD is required (the day you accepted, or the date of YouTube\'s written answer).');
				const problem = policyProblem({derivedMetrics: decision, date: values.date, note: values.note ?? null});
				if (problem) throw new UsageError(`Not recorded: ${problem}.`);
				const path = savePolicy(dataDir, {version: 1, derivedMetrics: decision, date: values.date, note: values.note ?? null, recordedAt: deps.now().toISOString()});
				deps.print(`Recorded your decision (derived metrics: ${decision}, ${values.date}) in ${show(path)}.`);
				return 0;
			}

			case 'pull': {
				const videoId = values.video?.[0];
				if (!videoId || !VIDEO_ID.test(videoId) || (values.video?.length ?? 0) > 1) throw new UsageError('--video needs exactly one 11-character YouTube video id (the retention report takes one video per query).');
				const slugMatch = /^(_?[a-z0-9-]+)\/([a-z0-9][a-z0-9-]*)$/.exec(values.slug ?? '');
				if (!slugMatch) throw new UsageError('--slug must be <channel>/<slug>, e.g. zoora-ai/pumpfun-top-caller.');
				const lang = values.lang ?? '';
				if (!(LANGS as readonly string[]).includes(lang)) throw new UsageError(`--lang must be one of ${LANGS.join(', ')}.`);
				const audience = AUDIENCES[values.audience ?? 'all'];
				if (!audience) throw new UsageError('--audience must be all, organic, ad-instream or ad-indisplay.');
				for (const key of ['start', 'end'] as const) if (values[key] !== undefined && !isDate(values[key]!)) throw new UsageError(`--${key} must be a date like 2026-11-01.`);
				if (values.renderer !== undefined && values.renderer !== 'episode' && values.renderer !== 'show') throw new UsageError('--renderer must be episode or show.');
				if (!policyOk()) return 4;
				const snapshot = buildJoin({
					videoStudioDir: values['video-studio'] ? fromCwd(values['video-studio']) : deps.env.VIDEO_STUDIO_DIR ? fromCwd(deps.env.VIDEO_STUDIO_DIR) : join(PROJECT_DIR, '..', 'video-studio'),
					channel: slugMatch[1]!,
					slug: slugMatch[2]!,
					lang,
					shortId: values.short ?? null,
					timelinePath: values.timeline ? fromCwd(values.timeline) : undefined,
					storyboardPath: values.storyboard ? fromCwd(values.storyboard) : undefined,
					renderer: values.renderer as 'episode' | 'show' | undefined,
				});
				const {source, account: used} = tokenSource();
				const record = await pullRecord({
					deps,
					token: source,
					videoId,
					channel: slugMatch[1]!,
					slug: slugMatch[2]!,
					lang,
					join: snapshot,
					audience,
					start: values.start,
					end: values.end,
					multiLanguageAudio: values.mla === true,
					account: used,
				});
				const file = saveRecord(dataDir, record);
				deps.print(quiet ? `Pulled 1 upload (${record.curve.length} of 100 points); saved 1 record. Metrics are not printed in CI.` : summaryOf(record, show(file), deps.now()));
				return 0;
			}

			case 'refresh': {
				if (!policyOk()) return 4;
				const {records, problems} = loadRecords(dataDir);
				for (const p of problems) deps.printError(`skipped ${show(p.file)}: ${p.problem}`);
				const due = records.filter((r) => !r.fixture && (values.all || ageDays(r.pulledAt, deps.now()) > RULES.staleDays));
				if (!due.length) {
					deps.print(`Nothing to refresh: no stored pull is older than ${RULES.staleDays} days.`);
					return 0;
				}
				const {source} = tokenSource();
				let refreshed = 0;
				const gone: string[] = [];
				for (const old of due) {
					const fresh = await pullRecord({
						deps,
						token: source,
						videoId: old.videoId,
						channel: old.channel,
						slug: old.slug,
						lang: old.lang,
						join: old.join,
						audience: old.audience,
						start: old.window.startDate,
						end: undefined,
						multiLanguageAudio: old.multiLanguageAudio,
						account: old.account,
					}).catch((err: unknown) => {
						if (err instanceof VideoGoneError) return null;
						throw err;
					});
					if (!fresh) {
						gone.push(...deleteRecords(dataDir, [old.videoId]));
						continue;
					}
					saveRecord(dataDir, fresh);
					refreshed++;
				}
				deps.print(`Refreshed ${refreshed} stored pull(s).${gone.length ? ` Deleted ${gone.length} whose video no longer exists on the channel: ${gone.join(', ')}.` : ''}`);
				return 0;
			}

			case 'report':
			case 'demo': {
				const demo = command === 'demo';
				const minViews = values['min-views'] === undefined ? RULES.minViews : Number(values['min-views']);
				if (!Number.isInteger(minViews) || minViews < 1) throw new UsageError('--min-views must be a whole number of at least 1.');
				const loaded = demo ? {records: demoUploads().map(synthRecord), problems: []} : loadRecords(dataDir);
				for (const p of loaded.problems) deps.printError(`skipped ${show(p.file)}: ${p.problem}`);
				const real = loaded.records.filter((r) => !r.fixture);
				if (real.length && !policyOk()) return 4;
				if (!loaded.records.length) {
					deps.printError(`No stored pulls in ${show(dataDir)}. Run "pull" first, or "demo" for a synthetic example.`);
					return 1;
				}
				const options = {minViews, includeStale: values['include-stale'] === true, allowUnverifiedDuration: values['allow-unverified-duration'] === true};
				const now = demo ? new Date('2026-11-24T12:00:00Z') : deps.now();
				const {analyses, models} = analyzeRecords(loaded.records, {now, ...options});
				const aggregates = aggregate(analyses, models);
				const recommendations = recommend(aggregates.comparisons);
				const policy = readPolicy(dataDir, deps.env);
				const input = {generatedAt: now, analyses, aggregates, recommendations, options, policy: policy ? {derivedMetrics: policy.derivedMetrics, date: policy.date} : null};
				const outDir = values.out ? fromCwd(values.out) : join(PROJECT_DIR, 'out', demo ? 'retention-demo' : 'retention');
				mkdirSync(outDir, {recursive: true});
				writeAtomic(join(outDir, 'report.md'), renderReportMarkdown(input));
				writeAtomic(join(outDir, 'report.json'), `${JSON.stringify(buildReportJson(input), null, 2)}\n`);
				const usable = analyses.filter((a) => a.usable).length;
				deps.print(`${demo ? 'SYNTHETIC demo: ' : ''}${analyses.length} upload(s), ${usable} usable; ${recommendations.length} recommendation(s).`);
				if (quiet && !demo) deps.print('  Findings are not printed in CI; read report.md on your own computer and never upload it as a plain artifact.');
				else for (const r of recommendations) deps.print(`  - ${r.title}`);
				const stale = analyses.filter((a) => a.exclusions.some((e) => e.code === 'stale'));
				if (stale.length) deps.print(`  ${stale.length} pull(s) are older than ${RULES.staleDays} days and were left out: run "refresh".`);
				deps.print(`  wrote ${show(join(outDir, 'report.md'))} and ${show(join(outDir, 'report.json'))}`);
				return 0;
			}

			case 'status': {
				const {records, problems} = loadRecords(dataDir);
				const now = deps.now();
				deps.print(`Stored pulls in ${show(dataDir)}: ${records.length}${problems.length ? ` (+${problems.length} unreadable)` : ''}`);
				for (const r of quiet ? [] : [...records].sort((a, b) => a.pulledAt.localeCompare(b.pulledAt))) {
					const age = Math.floor(ageDays(r.pulledAt, now));
					const views = r.stats?.views ?? null;
					deps.print(
						`  ${r.videoId}  ${r.channel}/${r.slug} ${r.lang} ${r.format}${r.shortId ? ` ${r.shortId}` : ''}  pulled ${age} day(s) ago${!r.fixture && age > RULES.staleDays ? ' (STALE: run refresh)' : ''}` +
							`  views ${views ?? '?'}  points ${r.curve.length}${r.fixture ? '  [fixture]' : ''}`,
					);
				}
				for (const p of problems) deps.print(`  unreadable: ${show(p.file)}: ${p.problem}`);
				const file = existsSync(tokensAt) ? readTokenFile(tokensAt) : null;
				deps.print(`Authorizations (${show(tokensAt)}): ${file ? Object.entries(file.accounts).map(([k, a]) => `${k} = "${a.title}" (${a.channelId}), saved ${a.savedAt.slice(0, 10)}`).join('; ') || 'none' : 'none'}${hasEnvTokens(deps.env) ? '; YT_ANALYTICS_* variables are set and take precedence' : ''}`);
				const status = readPolicyStatus(dataDir, deps.env);
				deps.print(`Derived-metrics policy decision: ${status.decision ? `${status.decision.derivedMetrics} (${status.decision.date})` : status.problem ? `NOT USABLE: ${status.problem}` : 'not recorded (pull and report will refuse; see "policy")'}`);
				return 0;
			}

			case 'forget': {
				const ids = values.video ?? [];
				if (!values.all && !ids.length) throw new UsageError('forget needs --video <id> (repeatable) or --all.');
				for (const id of ids) if (!VIDEO_ID.test(id)) throw new UsageError(`"${id}" is not an 11-character YouTube video id.`);
				const removed = deleteRecords(dataDir, values.all ? 'all' : ids);
				const reportDir = values.out ? fromCwd(values.out) : join(PROJECT_DIR, 'out', 'retention');
				if (values.reports) for (const name of ['report.md', 'report.json']) rmSync(join(reportDir, name), {force: true});
				deps.print(`Deleted ${removed.length} stored pull(s)${values.reports ? ' and the reports' : ''}. This only deletes this tool's copies; nothing on YouTube changes.`);
				return 0;
			}

			case 'revoke': {
				const file = readTokenFile(tokensAt);
				const saved = file?.accounts[account];
				if (!file || !saved) throw new UsageError(`No saved account "${account}" in ${show(tokensAt)}.`);
				await revokeToken(saved.tokens.refreshToken, {endpoints: deps.endpoints, fetch: deps.fetch});
				delete file.accounts[account];
				writeTokenFile(tokensAt, file);
				const mine = loadRecords(dataDir).records.filter((r) => r.account === account).map((r) => r.videoId);
				const removed = deleteRecords(dataDir, mine);
				deps.print(`Revoked "${account}" at Google and deleted it, with ${removed.length} stored pull(s) made with it (YouTube API Developer Policies III.E.4).`);
				return 0;
			}

			default:
				throw new UsageError(`Unknown command "${command}".`);
		}
	} catch (err) {
		if (err instanceof UsageError) {
			deps.printError(`${err.message}\n\n${USAGE}`);
			return 2;
		}
		const code = (err as {code?: string}).code;
		if (code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' || code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE' || code === 'ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL') {
			deps.printError(`${(err as Error).message}\n\n${USAGE}`);
			return 2;
		}
		if (err instanceof AuthError) {
			deps.printError(err.message);
			return 3;
		}
		if (err instanceof ApiError || err instanceof JoinError || err instanceof VideoGoneError) {
			deps.printError(err.message);
			return 1;
		}
		deps.printError(`Error: ${(err as Error).message}`);
		return 1;
	}
};

class VideoGoneError extends Error {
	constructor(videoId: string) {
		super(`YouTube has no video ${videoId} on the authorised channel (deleted, private to another account, or a typo).`);
		this.name = 'VideoGoneError';
	}
}

type PullInput = {
	deps: CliDeps;
	token: TokenSource;
	videoId: string;
	channel: string;
	slug: string;
	lang: string;
	join: JoinSnapshot;
	audience: Audience;
	start: string | undefined;
	end: string | undefined;
	multiLanguageAudio: boolean;
	account: string | null;
};

/** One upload: Data API metadata, the retention curve and basic stats, plus the checks. */
const pullRecord = async (input: PullInput): Promise<PullRecord> => {
	const {deps} = input;
	const api = createApi({endpoints: deps.endpoints, fetch: deps.fetch, token: input.token, sleep: deps.sleep});
	const warnings: string[] = [];
	const now = deps.now();
	let meta: Awaited<ReturnType<typeof api.video>> = null;
	try {
		meta = await api.video(input.videoId);
		if (!meta) throw new VideoGoneError(input.videoId);
	} catch (err) {
		if (!(err instanceof ApiError) || err.status !== 403) throw err;
		warnings.push('the video duration could not be read (the token lacks youtube.readonly), so the scene positions are unverified');
	}
	const earliest = input.audience === 'all' ? '2008-07-01' : '2013-09-25'; // data availability (dimensions#audienceType)
	const startDate = input.start ?? meta?.publishedAt?.slice(0, 10) ?? earliest;
	const endDate = input.end ?? now.toISOString().slice(0, 10);
	const retention = await api.retention({videoId: input.videoId, startDate, endDate, audience: input.audience});
	if (!retention.curve.length) warnings.push('YouTube returned no retention rows (too few views, or the data is still processing: 48-72 h)');
	let stats: PullRecord['stats'] = null;
	try {
		stats = await api.stats({videoId: input.videoId, startDate, endDate});
	} catch (err) {
		if (!(err instanceof ApiError) || (err.status !== 400 && err.status !== 403)) throw err;
		warnings.push(`views could not be read (${err.reason}); the sample size falls back to startedWatching`);
	}
	if (input.join.issues.length) warnings.push(...input.join.issues.filter((i) => i.code === 'mock-timeline').map((i) => i.detail));
	const checks: PullChecks = {
		...durationCheck(input.join, meta?.durationSec ?? null),
		langMatch: meta?.defaultAudioLanguage ? sameLanguage(meta.defaultAudioLanguage, input.lang) : null,
		formatMatch: formatCheck(input.join.format, stats?.contentType ?? null),
	};
	return {
		version: 1,
		kind: 'retention-pull',
		videoId: input.videoId,
		account: input.account,
		channel: input.channel,
		slug: input.slug,
		lang: input.lang,
		format: input.join.format,
		shortId: input.join.shortId,
		multiLanguageAudio: input.multiLanguageAudio,
		pulledAt: now.toISOString(),
		window: {startDate, endDate},
		audience: input.audience,
		metrics: retention.metrics,
		curve: retention.curve,
		stats,
		video: meta ? {...meta, fetchedAt: now.toISOString()} : null,
		join: input.join,
		checks,
		warnings,
	};
};

const summaryOf = (record: PullRecord, file: string, now: Date): string => {
	const lines = [`Pulled ${record.videoId} (${record.channel}/${record.slug} ${record.lang} ${record.format}${record.shortId ? ` ${record.shortId}` : ''}): ${record.curve.length} of 100 points, metrics ${record.metrics.join(', ')}.`];
	lines.push(`  views ${record.stats?.views ?? '?'}; duration ${record.checks.durationMatch === null ? 'not checked' : record.checks.durationMatch ? 'matches the timeline' : `DIFFERS from the timeline by ${Math.round(Math.abs(record.checks.durationDeltaMs ?? 0))} ms`}; format ${record.checks.formatMatch === false ? 'MISMATCH' : 'ok'}.`);
	for (const w of record.warnings) lines.push(`  warning: ${w}`);
	for (const i of record.join.issues) lines.push(`  timeline: ${i.code}: ${i.detail}`);
	const {analyses} = analyzeRecords([record], {now, allowUnverifiedDuration: true, minViews: 1});
	const v = analyses[0]!;
	if (v.usable) {
		const drops = topDrops(v);
		if (drops.length) lines.push(`  steepest scenes (lost per 10 s, in percentage points of views; our calculation): ${drops.map((s) => `${s.id} ${s.segment ?? s.type} ${s.dropPer10sPp.toFixed(1)} pp`).join(', ')}`);
	}
	lines.push(`  saved ${file}`);
	return lines.join('\n');
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	process.exitCode = await main(process.argv.slice(2));
}
