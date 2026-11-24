/**
 * Quota accounting. YouTube charges every request, failed ones included (at least 1 unit), against two daily buckets
 * that reset at midnight Pacific Time: 10,000 units for most methods and 100 videos.insert calls (contracts.ts).
 * The tracker charges each call before it is sent, refuses a call that would pass the daily limits or this run's
 * cap, and keeps the day's totals in quota.json so separate runs add up. It only sees this machine's calls: other
 * tools using the same Google Cloud project spend the same quota (check the Cloud Console Quotas page).
 */
import {existsSync, readFileSync} from 'node:fs';
import {type ApiMethod, QUOTA} from './contracts.ts';
import {quotaDay} from './time.ts';
import {isRecord, num, type Reason, writeJsonAtomic} from './util.ts';

export type Usage = {default: number; uploads: number};
type DayRecord = Usage & {calls: Record<string, number>};
type QuotaFile = {version: 1; days: Record<string, DayRecord>};

export class QuotaBudgetError extends Error {
	readonly method: ApiMethod;
	constructor(method: ApiMethod, message: string) {
		super(message);
		this.name = 'QuotaBudgetError';
		this.method = method;
	}
}

export type QuotaLimits = {defaultUnits: number; uploadCalls: number};

export type QuotaTracker = {
	/** Today's totals (Pacific day), from quota.json plus this run. */
	today(): Usage;
	/** This run's totals. */
	run(): Usage;
	/** Reasons the given need does not fit today's remaining quota or this run's cap (empty = fits). */
	check(need: Usage): Reason[];
	/** Charges one call; throws QuotaBudgetError (before anything is sent) when it would not fit. */
	spend(method: ApiMethod): void;
};

const KEEP_DAYS = 14;

const load = (path: string | null): QuotaFile => {
	if (!path || !existsSync(path)) return {version: 1, days: {}};
	let data: unknown;
	try {
		data = JSON.parse(readFileSync(path, 'utf8'));
	} catch {
		return {version: 1, days: {}};
	}
	const days: Record<string, DayRecord> = {};
	if (isRecord(data) && isRecord(data.days)) {
		for (const [day, value] of Object.entries(data.days)) {
			if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !isRecord(value)) continue;
			days[day] = {default: num(value.default) ?? 0, uploads: num(value.uploads) ?? 0, calls: isRecord(value.calls) ? (Object.fromEntries(Object.entries(value.calls).filter(([, v]) => typeof v === 'number')) as Record<string, number>) : {}};
		}
	}
	return {version: 1, days};
};

export const createQuotaTracker = (opts: {path: string | null; now: () => number; limits: QuotaLimits; runCap: number}): QuotaTracker => {
	const file = load(opts.path);
	const runUsage: Usage = {default: 0, uploads: 0};
	const empty = (): DayRecord => ({default: 0, uploads: 0, calls: {}});
	const today = (): Usage => {
		const record = file.days[quotaDay(opts.now())] ?? empty();
		return {default: record.default, uploads: record.uploads};
	};
	const save = () => {
		if (!opts.path) return;
		const days = Object.keys(file.days).sort().slice(-KEEP_DAYS);
		writeJsonAtomic(opts.path, {version: 1, note: 'Local count of YouTube Data API quota used by tools/uploader, per Pacific-time day.', days: Object.fromEntries(days.map((d) => [d, file.days[d]]))});
	};
	return {
		today,
		run: () => ({...runUsage}),
		check(need) {
			const used = today();
			const reasons: Reason[] = [];
			if (used.default + need.default > opts.limits.defaultUnits) {
				reasons.push({code: 'quota-insufficient', message: `This upload needs up to ${need.default} quota units, but ${used.default} of today's ${opts.limits.defaultUnits} are used (the day resets at midnight Pacific Time).`});
			}
			if (used.uploads + need.uploads > opts.limits.uploadCalls) {
				reasons.push({code: 'quota-insufficient', message: `Today's ${opts.limits.uploadCalls} videos.insert calls are used up (${used.uploads}); the bucket resets at midnight Pacific Time.`});
			}
			if (runUsage.default + need.default > opts.runCap) {
				reasons.push({code: 'quota-run-cap', message: `This upload needs up to ${need.default} units, over this run's cap of ${opts.runCap} (--max-quota, or maxUnitsPerRun in channels.json).`});
			}
			return reasons;
		},
		spend(method) {
			const {bucket, cost} = QUOTA[method];
			const day = quotaDay(opts.now());
			const record = file.days[day] ?? empty();
			if (bucket === 'default') {
				if (record.default + cost > opts.limits.defaultUnits) throw new QuotaBudgetError(method, `Stopped before ${method} (${cost} units): today's local count is ${record.default} of ${opts.limits.defaultUnits} units. The quota resets at midnight Pacific Time.`);
				if (runUsage.default + cost > opts.runCap) throw new QuotaBudgetError(method, `Stopped before ${method} (${cost} units): this run has used ${runUsage.default} of its ${opts.runCap}-unit cap (--max-quota).`);
			} else if (record.uploads + cost > opts.limits.uploadCalls) {
				throw new QuotaBudgetError(method, `Stopped before ${method}: today's ${opts.limits.uploadCalls} upload calls are used up. The bucket resets at midnight Pacific Time.`);
			}
			record[bucket] += cost;
			record.calls[method] = (record.calls[method] ?? 0) + 1;
			file.days[day] = record;
			runUsage[bucket] += cost;
			save();
		},
	};
};
