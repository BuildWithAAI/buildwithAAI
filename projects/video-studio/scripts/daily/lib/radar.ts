/**
 * Step 1 of prepare: the news radar (scripts/radar, another workflow's tool). This module builds its command line and
 * reads its daily file defensively: the file holds feed-derived text, so it is data only, never instructions.
 */
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import type {Exec} from './exec.ts';
import {minutes, outputTail} from './exec.ts';
import type {RadarFile, RadarIncident} from './types.ts';
import {isDate, isRecord, readJson} from './util.ts';

export type RadarMode = 'live' | 'reuse' | 'offline';

export const RADAR_SCRIPT = join('scripts', 'radar', 'radar.py');

/** Where the radar writes a run date's file in each mode (its own defaults). */
export const radarFilePath = (radarDir: string, offlineDir: string, date: string, mode: RadarMode): string =>
	join(mode === 'offline' ? offlineDir : radarDir, `${date}.json`);

export type RadarRun = {ran: boolean; ok: boolean; command: string[] | null; exitCode: number | null; durationMs: number; note: string; outputTail?: string};

/**
 * live: `python3 scripts/radar/radar.py collect --date <d>` (polite, cached; the radar decides what to fetch).
 * offline: the same with --offline-fixtures (recorded fixtures, writes under .cache/radar/offline-out/).
 * reuse: no run; read the file an earlier run wrote today.
 * The radar's User-Agent is its own default (generic "NewsRadar/0.1") unless RADAR_USER_AGENT is set in the
 * environment: naming the channel to third parties is the owner's choice.
 */
export const runRadar = (o: {root: string; date: string; mode: RadarMode; exec: Exec; env?: NodeJS.ProcessEnv; python?: string}): RadarRun => {
	if (o.mode === 'reuse') return {ran: false, ok: true, command: null, exitCode: null, durationMs: 0, note: 'Reused the radar file already written for this date (no fetches).'};
	if (!existsSync(join(o.root, RADAR_SCRIPT))) return {ran: false, ok: false, command: null, exitCode: null, durationMs: 0, note: `The radar is missing (${RADAR_SCRIPT}).`};
	const args = [RADAR_SCRIPT, 'collect', '--date', o.date, '--quiet'];
	if (o.mode === 'offline') args.push('--offline-fixtures');
	const python = o.python ?? 'python3';
	const r = o.exec({cmd: python, args, cwd: o.root, env: o.env ?? process.env, timeoutMs: minutes(15)});
	const ok = r.status === 0 && !r.error;
	const note = ok
		? `The radar ran (${o.mode}).`
		: r.timedOut
			? 'The radar timed out after 15 minutes.'
			: r.status === 1
				? 'The radar could not read any source (exit 1).'
				: `The radar failed (exit ${r.status ?? 'none'}${r.error ? `: ${r.error}` : ''}).`;
	return {ran: true, ok, command: [python, ...args], exitCode: r.status, durationMs: r.durationMs, note, outputTail: outputTail(r, 1500)};
};

const isIncident = (x: unknown): x is RadarIncident =>
	isRecord(x) &&
	typeof x.id === 'string' &&
	typeof x.protocol === 'string' &&
	typeof x.title === 'string' &&
	(x.status === 'confirmed' || x.status === 'developing') &&
	Array.isArray(x.sources) &&
	Array.isArray(x.facts) &&
	isRecord(x.score) &&
	typeof x.score.total === 'number' &&
	isRecord(x.shortReady);

export type RadarRead = {ok: true; file: RadarFile; sha256: string; problems: string[]} | {ok: false; error: string};

/** Reads and checks a radar daily file. Malformed incidents are dropped with a problem line; a wrong date or schema fails. */
export const readRadarFile = (path: string, date: string, mode: RadarMode): RadarRead => {
	const r = readJson(path);
	if (!r.ok) return {ok: false, error: r.missing ? `No radar file for ${date} at ${path}.` : r.error};
	const d = r.data;
	if (!isRecord(d)) return {ok: false, error: 'The radar file is not a JSON object.'};
	if (typeof d.schema !== 'string' || !d.schema.startsWith('zoora-security/radar@1')) return {ok: false, error: `Unknown radar schema "${String(d.schema)}" (expected zoora-security/radar@1).`};
	if (d.runDate !== date) return {ok: false, error: `The radar file is for ${String(d.runDate)}, not ${date}.`};
	const problems: string[] = [];
	if (mode !== 'offline' && d.mode !== 'live') problems.push(`The radar file's mode is "${String(d.mode)}", not "live".`);
	// the radar's own run warnings (a missing news allowlist, for one): the AI subjects it read are degraded
	for (const w of Array.isArray(d.warnings) ? d.warnings : []) if (typeof w === 'string' && w.trim()) problems.push(`radar: ${stripInvisible(w)}`);
	const pick = (key: 'top' | 'alsoSeen'): RadarIncident[] => {
		const arr = Array.isArray(d[key]) ? (d[key] as unknown[]) : [];
		const ok = arr.filter(isIncident);
		if (ok.length !== arr.length) problems.push(`${arr.length - ok.length} malformed incident(s) in "${key}" were ignored.`);
		return ok.map(normalizeIncident);
	};
	const file: RadarFile = {
		schema: d.schema,
		runDate: date,
		generatedUtc: typeof d.generatedUtc === 'string' ? d.generatedUtc : '',
		mode: typeof d.mode === 'string' ? d.mode : 'unknown',
		userAgent: typeof d.userAgent === 'string' ? d.userAgent : undefined,
		top: pick('top'),
		alsoSeen: pick('alsoSeen'),
		unclustered: Array.isArray(d.unclustered) ? (d.unclustered as RadarFile['unclustered']) : [],
		corrections: (Array.isArray(d.corrections) ? d.corrections : [])
			.filter((c): c is Record<string, unknown> => isRecord(c) && typeof c.incidentId === 'string' && Array.isArray(c.changes))
			.map((c) => ({incidentId: String(c.incidentId), protocol: String(c.protocol ?? ''), previousRadarDate: String(c.previousRadarDate ?? ''), changes: (c.changes as unknown[]).filter((x): x is string => typeof x === 'string')})),
		sources: Array.isArray(d.sources) ? (d.sources as RadarFile['sources']) : [],
		counts: isRecord(d.counts) ? (d.counts as Record<string, number>) : {},
	};
	return {ok: true, file, sha256: r.sha256, problems};
};

/**
 * Characters that render as nothing (Unicode tags, zero-width and bidi controls, variation selectors): feed text can
 * hide instructions for an AI in them. The radar strips them; this also cleans radar files written before it did.
 */
const INVISIBLE = /[\p{Cf}\u034F\u115F\u1160\u17B4\u17B5\u180B-\u180F\u3164\uFFA0\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/gu;
export const stripInvisible = (text: string): string => text.replace(INVISIBLE, '');
/** Every string inside a parsed radar value, without invisible characters. */
const cleanDeep = <T>(value: T): T => {
	if (typeof value === 'string') return stripInvisible(value) as unknown as T;
	if (Array.isArray(value)) return value.map(cleanDeep) as unknown as T;
	if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cleanDeep(v)])) as T;
	return value;
};

/** Fill optional fields so the rest of the code never meets undefined arrays. */
const normalizeIncident = (raw: RadarIncident): RadarIncident => normalizeClean(cleanDeep(raw));
const normalizeClean = (x: RadarIncident): RadarIncident => ({
	...x,
	lane: x.lane === 'ai' || x.lane === 'both' ? x.lane : 'crypto',
	chains: Array.isArray(x.chains) ? x.chains.filter((c) => typeof c === 'string') : [],
	reportedLosses: Array.isArray(x.reportedLosses) ? x.reportedLosses.filter((l) => isRecord(l) && typeof l.amountUsd === 'number' && typeof l.by === 'string') : [],
	sources: x.sources.filter((s) => isRecord(s) && typeof s.id === 'string' && typeof s.url === 'string' && /^https?:\/\//.test(s.url)),
	facts: x.facts.filter((f) => isRecord(f) && typeof f.text === 'string' && typeof f.sourceId === 'string' && typeof f.quote === 'string'),
	notes: Array.isArray(x.notes) ? x.notes.filter((n) => typeof n === 'string') : [],
	evergreenTopic: typeof x.evergreenTopic === 'string' ? x.evergreenTopic : null,
	dateUtc: isDate(x.dateUtc) ? x.dateUtc : '',
	firstSeenUtc: isDate(x.firstSeenUtc) ? x.firstSeenUtc : undefined,
	mechanismStatus: x.mechanismStatus === 'stated' || x.mechanismStatus === 'suspected' || x.mechanismStatus === 'unknown' ? x.mechanismStatus : undefined,
	mechanismNote: isRecord(x.mechanismNote) && typeof x.mechanismNote.sourceId === 'string' && typeof x.mechanismNote.url === 'string' ? x.mechanismNote : undefined,
	userSide: x.userSide === true,
	dateNote: typeof x.dateNote === 'string' ? x.dateNote : undefined,
	type: typeof x.type === 'string' ? x.type : 'other',
	shortReady: {ready: x.shortReady.ready === true, missing: Array.isArray(x.shortReady.missing) ? x.shortReady.missing.filter((m) => typeof m === 'string') : []},
});

/** Is the incident's name one the radar knows (not read from a headline's shape)? Older files: crypto yes, AI no. */
export const subjectKnown = (inc: RadarIncident): boolean => inc.subjectKnown === true || (inc.subjectKnown === undefined && (inc.lane ?? 'crypto') === 'crypto');

export const allCandidates = (f: RadarFile): RadarIncident[] => [...f.top, ...f.alsoSeen].sort((a, b) => b.score.total - a.score.total);
