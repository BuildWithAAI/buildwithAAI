/**
 * Local storage of pulls and the owner's policy decision. Everything lives under the gitignored data folder
 * (projects/creator-hub/data/retention by default; DATA_DIR moves it, as for the dashboard):
 *
 *   data/retention/videos/<videoId>.json   one pull record per upload (YouTube values + our scene snapshot)
 *   data/retention/oauth.json              OAuth client and tokens (oauth.ts), mode 0600
 *   data/retention/policy.json             the owner's decision on the derived-metrics policy (policy gate)
 *
 * YouTube API Developer Policies III.E.4 (developers.google.com/youtube/terms/developer-policies, updated 2026-11-06):
 *  - b: YouTube Analytics data may be kept as long as needed, but every 30 days the authorization must be re-checked
 *    and the video confirmed to still exist ("refresh" does both);
 *  - c: other Authorized Data (the Data API duration, publish date and audio language in each record) at most 30
 *    days, then refreshed or deleted;
 *  - g: the user must be able to delete stored data ("forget"; it never touches anything on YouTube).
 */
import {existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {writeSecretFile} from './oauth.ts';
import type {PullRecord} from './types.ts';

export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export const retentionDir = (dataDir: string): string => join(dataDir, 'retention');
export const videosDir = (dataDir: string): string => join(retentionDir(dataDir), 'videos');
export const tokenPath = (dataDir: string): string => join(retentionDir(dataDir), 'oauth.json');
export const policyPath = (dataDir: string): string => join(retentionDir(dataDir), 'policy.json');

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Shape check of a stored record: enough to analyse it safely. Returns the problem, or null. */
export const recordProblem = (data: unknown): string | null => {
	if (!isRecord(data)) return 'not an object';
	if (data.version !== 1 || data.kind !== 'retention-pull') return 'not a retention pull (version 1)';
	if (typeof data.videoId !== 'string' || !VIDEO_ID.test(data.videoId)) return 'videoId is not an 11-character YouTube id';
	for (const key of ['channel', 'slug', 'lang', 'pulledAt'] as const) if (typeof data[key] !== 'string' || !data[key]) return `${key} is missing`;
	if (data.format !== 'long' && data.format !== 'short') return 'format must be long or short';
	if (!Array.isArray(data.curve)) return 'curve is missing';
	if (!isRecord(data.join) || !Array.isArray(data.join.scenes) || typeof data.join.totalMs !== 'number' || !(data.join.totalMs > 0)) return 'join snapshot is missing';
	if (!isRecord(data.checks) || !isRecord(data.window)) return 'checks or window missing';
	if (Number.isNaN(Date.parse(String(data.pulledAt)))) return 'pulledAt is not a date';
	return null;
};

export type LoadResult = {records: PullRecord[]; problems: {file: string; problem: string}[]};

export const loadRecords = (dataDir: string): LoadResult => {
	const dir = videosDir(dataDir);
	const out: LoadResult = {records: [], problems: []};
	if (!existsSync(dir)) return out;
	for (const name of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
		const file = join(dir, name);
		let data: unknown;
		try {
			data = JSON.parse(readFileSync(file, 'utf8'));
		} catch (err) {
			out.problems.push({file, problem: `not JSON: ${(err as Error).message}`});
			continue;
		}
		const problem = recordProblem(data);
		if (problem) out.problems.push({file, problem});
		else out.records.push(data as PullRecord);
	}
	return out;
};

/** Writes one record (0600), refusing a location git would track. Atomic within the ignored folder. */
export const saveRecord = (dataDir: string, record: PullRecord): string => {
	const dir = videosDir(dataDir);
	mkdirSync(dir, {recursive: true});
	const file = join(dir, `${record.videoId}.json`);
	const temp = join(dir, `.${record.videoId}.${process.pid}.tmp`);
	writeSecretFile(temp, `${JSON.stringify(record, null, '\t')}\n`);
	renameSync(temp, file);
	return file;
};

/** Deletes stored records (all, or the given ids). Returns the ids removed. Nothing on YouTube is touched. */
export const deleteRecords = (dataDir: string, ids: 'all' | readonly string[]): string[] => {
	const dir = videosDir(dataDir);
	if (!existsSync(dir)) return [];
	const removed: string[] = [];
	for (const name of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
		const id = name.slice(0, -5);
		if (ids === 'all' || ids.includes(id)) {
			rmSync(join(dir, name), {force: true});
			removed.push(id);
		}
	}
	return removed.sort();
};

export const ageDays = (iso: string, now: Date): number => Math.max(0, (now.getTime() - Date.parse(iso)) / 86_400_000);

/* ------------------------------------------------------------------ the owner's policy decision */

/**
 * The two decisions YouTube's policy allows (Developer Policies III.E.4.h and III.L, derived-metrics-policy page, both
 * read 2026-11-24): `accepted`, the developer accepted the derived-metrics amendment (through the audit and quota
 * extension form, use case "Analytics & Reporting"), with the date; or `exempted`, YouTube itself confirmed in writing
 * that this use needs no amendment, quoted in the note. The policy offers no self-exemption, so "I decided it does not
 * apply" (the earlier `not-required`) is no longer a decision this tool accepts.
 */
export type PolicyDecision = {
	version: 1;
	derivedMetrics: 'accepted' | 'exempted';
	date: string; // YYYY-MM-DD of the acceptance, or of YouTube's written answer
	note: string | null;
	recordedAt: string;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const isPolicyDate = (value: string | null | undefined): value is string => typeof value === 'string' && DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
/** A quoted passage of at least 20 characters ("..." or “...”): the words of YouTube's written exemption. */
export const quotesExemption = (note: string | null | undefined): boolean => typeof note === 'string' && /["“][^"”]{20,}["”]/.test(note);

/** Why a decision cannot be used (null = it can). */
export const policyProblem = (decision: {derivedMetrics: unknown; date: unknown; note?: unknown}): string | null => {
	if (decision.derivedMetrics === 'not-required') {
		return 'a "not-required" decision is no longer accepted: YouTube\'s policy has no self-exemption. Accept the amendment (--derived-metrics accepted), or record YouTube\'s written exemption (--derived-metrics exempted --note "<their words, quoted>")';
	}
	if (decision.derivedMetrics !== 'accepted' && decision.derivedMetrics !== 'exempted') return 'the decision must be "accepted" or "exempted"';
	if (!isPolicyDate(typeof decision.date === 'string' ? decision.date : null)) return 'the decision needs its date (YYYY-MM-DD)';
	if (decision.derivedMetrics === 'exempted' && !quotesExemption(typeof decision.note === 'string' ? decision.note : null)) {
		return 'an exemption needs a note that quotes YouTube\'s written answer (at least 20 characters inside quotation marks), with where it came from';
	}
	return null;
};

/** The recorded decision and, when one was found but cannot be used, why. */
export const readPolicyStatus = (dataDir: string, env: Record<string, string | undefined>): {decision: PolicyDecision | null; problem: string | null} => {
	const fromEnv = env.RETENTION_DERIVED_METRICS?.trim();
	if (fromEnv) {
		const candidate = {derivedMetrics: fromEnv, date: env.RETENTION_POLICY_DATE?.trim() ?? '', note: env.RETENTION_POLICY_NOTE?.trim() ?? null};
		const problem = policyProblem(candidate);
		if (problem) return {decision: null, problem: `RETENTION_DERIVED_METRICS: ${problem}`};
		return {decision: {version: 1, derivedMetrics: fromEnv as PolicyDecision['derivedMetrics'], date: candidate.date, note: candidate.note ?? 'from RETENTION_DERIVED_METRICS', recordedAt: 'environment'}, problem: null};
	}
	const path = policyPath(dataDir);
	if (!existsSync(path)) return {decision: null, problem: null};
	const data: unknown = JSON.parse(readFileSync(path, 'utf8'));
	if (!isRecord(data) || data.version !== 1) return {decision: null, problem: `${path} is not a policy decision (version 1)`};
	const problem = policyProblem({derivedMetrics: data.derivedMetrics, date: data.date, note: data.note});
	if (problem) return {decision: null, problem: `the recorded decision (${path}): ${problem}`};
	return {
		decision: {version: 1, derivedMetrics: data.derivedMetrics as PolicyDecision['derivedMetrics'], date: String(data.date), note: typeof data.note === 'string' ? data.note : null, recordedAt: typeof data.recordedAt === 'string' ? data.recordedAt : ''},
		problem: null,
	};
};

export const readPolicy = (dataDir: string, env: Record<string, string | undefined>): PolicyDecision | null => readPolicyStatus(dataDir, env).decision;

export const savePolicy = (dataDir: string, decision: PolicyDecision): string => {
	const path = policyPath(dataDir);
	writeSecretFile(path, `${JSON.stringify(decision, null, '\t')}\n`);
	return path;
};

export const POLICY_GATE = [
	'Policy check: YouTube API Services Developer Policies III.E.4.h say an API client must not "access or use API Data to create new or',
	'derived data or metrics"; the derived-metrics policy permits them only "subject to your acceptance of the amendment to the',
	'Developer Policies". This tool derives metrics (drops per 10 s, comparisons, recommendations) from YouTube Analytics data, so it',
	'only pulls once one of the two decisions the policy allows is recorded:',
	'  1. Read https://developers.google.com/youtube/terms/derived-metrics-policy and the Developer Policies (section III.E.4).',
	'  2. Accept: submit the YouTube API Services audit and quota extension form for your Google Cloud project, choosing',
	'     "Section 5: Use Cases, API Integration, and Feature Implementation", then "Analytics & Reporting" (as that page says), then:',
	'       node tools/retention/cli.ts policy --derived-metrics accepted --date YYYY-MM-DD',
	'  3. Or, only if YouTube answered in writing that this use needs no amendment, quote their words:',
	'       node tools/retention/cli.ts policy --derived-metrics exempted --date YYYY-MM-DD --note \'YouTube API Services, ticket <id>: "<their words>"\'',
	'  There is no self-exemption: deciding yourself that the amendment does not apply is not one of the options.',
	'  The decision stays in the gitignored data folder. Run this tool on your own computer, not in CI (README "Where to run it").',
].join('\n');
