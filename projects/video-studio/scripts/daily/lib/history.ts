/**
 * The data behind the "real analysis" every daily video needs (owner rule; news gate R7):
 *   - tracker rows: DefiLlama /hacks records for the last 30 days, read from the radar's polite on-disk cache
 *     (.cache/radar/sources/defillama-hacks.json, format v1). Only the structured head of each stored excerpt is used
 *     (name · date · loss · classification · target · chains): no free text, so no names or mechanics leak in.
 *   - radar history: the radar's own daily files (content/zoora-security/radar/<date>.json) of the last 30 days.
 *   - our previous episodes (content/zoora-security/<date>-<slug>/), so a story is not repeated.
 * Nothing here fetches. Missing or stale data makes an opportunity unavailable, with the reason.
 */
import {existsSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import type {RadarIncident} from './types.ts';
import {addDays, daysBetween, isDate, isRecord, parseDateSlug, readJson, str} from './util.ts';

export const WINDOW_DAYS = 30;

export type TrackerRow = {
	key: string; // "defillama:<name>@<date>"
	name: string;
	date: string;
	amountUsd: number | null;
	classification: string | null;
	technique: string | null;
	targetType: string | null;
	chains: string[];
	url: string;
	head: string; // the structured head of the stored excerpt (a prefix of it), 280 characters or fewer
};

/**
 * `rows` are the rows dated from the loader's `from` to `to` (prepare loads the 30-day window plus the 30 days before
 * it); `earliest` is the oldest event date anywhere in the cache, so a comparison with the 30 days before the window
 * knows whether the cache reaches back that far.
 */
export type TrackerData = {ok: true; rows: TrackerRow[]; fetchedUtc: string; skipped: number; notes: string[]; earliest?: string | null} | {ok: false; reason: string};

const EXPECTED_ORDER = (r: Record<string, unknown>, date: string, name: string) => {
	const classification = str(r.classification) ?? null;
	const technique = str(r.technique) ?? null;
	const target = str(r.targetType) ?? null;
	const chains = Array.isArray(r.chains) ? r.chains.filter((c): c is string => typeof c === 'string' && !!c.trim()) : [];
	const amount = typeof r.amount === 'number' && Number.isFinite(r.amount) && r.amount > 0 ? r.amount : null;
	return {classification, technique, target, chains, amount, name, date};
};

/** The structured head of a radar DefiLlama excerpt, checked segment by segment against the record. Null when it does not line up. */
export const structuredHead = (excerpt: string, rec: ReturnType<typeof EXPECTED_ORDER>, returned: boolean, bridge: boolean): string | null => {
	const segs = excerpt.split(' · ');
	const out: string[] = [];
	let i = 0;
	const take = (ok: boolean) => {
		if (!ok) return false;
		out.push(segs[i]);
		i++;
		return true;
	};
	if (!take(segs[i] === rec.name)) return null;
	if (!take(segs[i] === rec.date)) return null;
	if (!take(rec.amount ? /^reported loss \$[\d,]+(?:\.\d\d)?$/.test(segs[i] ?? '') : segs[i] === 'loss not stated')) return null;
	if (returned && !take(/^returned \$[\d,]+(?:\.\d\d)?$/.test(segs[i] ?? ''))) return null;
	if ((rec.classification || rec.technique) && !take(segs[i] === `${rec.classification ?? 'Unclassified'} / ${rec.technique ?? 'Unknown'}`)) return null;
	if (rec.target && !take(segs[i] === `target: ${rec.target}`)) return null;
	if (rec.chains.length && !take(segs[i] === `chains: ${rec.chains.join(', ')}`)) return null;
	if (bridge && !take(segs[i] === 'bridge hack: yes')) return null;
	const head = out.join(' · ');
	return head.length <= 280 && excerpt.startsWith(head) ? head : null;
};

/** Target types that could describe a private person: never stored in a public brief. */
const PERSONAL_TARGET = /individual|person|user|whale|victim/i;

/**
 * Reads DefiLlama rows dated from `from` to `to` (inclusive) out of the radar cache. The cache must have been fetched
 * within 36 hours before the end of `to`, so a stale cache never passes for "the last 30 days".
 */
export const loadTrackerRows = (cachePath: string, from: string, to: string): TrackerData => {
	const r = readJson(cachePath);
	if (!r.ok) return {ok: false, reason: r.missing ? 'The radar has not cached DefiLlama data on this machine yet (run the radar live first).' : `The DefiLlama cache could not be read: ${r.error}`};
	const d = r.data;
	if (!isRecord(d) || d.v !== 1 || !Array.isArray(d.items) || d.sourceId !== 'defillama-hacks') return {ok: false, reason: 'The radar\'s DefiLlama cache has an unknown format (expected v1); the tracker comparison is skipped until this reader is updated.'};
	const fetchedUtc = str(d.fetchedUtc) ?? '';
	const fetched = Date.parse(fetchedUtc);
	const endOfTo = Date.parse(`${addDays(to, 1)}T00:00:00Z`);
	if (Number.isNaN(fetched) || fetched > endOfTo + 36 * 3_600_000 || endOfTo - fetched > 36 * 3_600_000)
		return {ok: false, reason: `The DefiLlama cache was fetched ${fetchedUtc || 'at an unknown time'}, not within 36 hours of ${to}; run the radar live for ${to} first.`};
	const rows: TrackerRow[] = [];
	let skipped = 0;
	let earliest: string | null = null;
	const notes: string[] = [];
	for (const it of d.items) {
		if (!isRecord(it) || !isRecord(it.record)) {
			skipped++;
			continue;
		}
		const rec = it.record;
		const date = str(it.eventDate) ?? '';
		const name = str(rec.name) ?? '';
		if (isDate(date) && (!earliest || date < earliest)) earliest = date;
		if (!isDate(date) || !name || date < from || date > to) continue;
		const target = str(rec.targetType) ?? null;
		if (target && PERSONAL_TARGET.test(target)) {
			skipped++;
			continue;
		}
		const exp = EXPECTED_ORDER(rec, date, name);
		const head = structuredHead(String(it.excerpt ?? ''), exp, typeof rec.returnedFunds === 'number' && rec.returnedFunds > 0, rec.bridgeHack === true);
		const url = str(it.url) ?? '';
		if (!head || !/^https:\/\/api\.llama\.fi\/hacks#/.test(url)) {
			skipped++;
			continue;
		}
		rows.push({key: `defillama:${name}@${date}`, name, date, amountUsd: exp.amount, classification: exp.classification, technique: exp.technique, targetType: target, chains: exp.chains, url, head});
	}
	if (skipped) notes.push(`${skipped} cached DefiLlama record(s) were left out (unexpected shape or a target type that could be a person).`);
	rows.sort((a, b) => (a.date === b.date ? a.name.localeCompare(b.name) : a.date < b.date ? -1 : 1));
	return {ok: true, rows, fetchedUtc, skipped, notes, earliest};
};

/** The DefiLlama key of an incident, from its radar source URL (https://api.llama.fi/hacks#<name>@<date>). */
export const defillamaKey = (inc: RadarIncident): string | null => {
	const src = inc.sources.find((s) => s.id === 'defillama-hacks' && s.url.includes('#'));
	if (!src) return null;
	try {
		return `defillama:${decodeURIComponent(src.url.slice(src.url.indexOf('#') + 1))}`;
	} catch {
		return null;
	}
};

// ---------------------------------------------------------------------------------------------------------------

export type RadarHistory = {
	files: Array<{date: string; path: string}>;
	incidents: Map<string, {incident: RadarIncident; seenOn: string[]}>;
	from: string;
	to: string;
};

/** Live radar files with a run date from `from` to `to`. Offline (fixture) outputs never count as history. */
export const loadRadarHistory = (radarDir: string, from: string, to: string): RadarHistory => {
	const files: RadarHistory['files'] = [];
	const incidents: RadarHistory['incidents'] = new Map();
	if (existsSync(radarDir))
		for (const name of readdirSync(radarDir).sort()) {
			const m = /^(\d{4}-\d{2}-\d{2})\.json$/.exec(name);
			if (!m || !isDate(m[1]) || m[1] < from || m[1] > to) continue;
			const r = readJson(join(radarDir, name));
			if (!r.ok || !isRecord(r.data) || r.data.mode !== 'live' || r.data.runDate !== m[1]) continue;
			files.push({date: m[1], path: join(radarDir, name)});
			for (const key of ['top', 'alsoSeen'] as const) {
				const arr = Array.isArray(r.data[key]) ? (r.data[key] as unknown[]) : [];
				for (const x of arr) {
					if (!isRecord(x) || typeof x.id !== 'string' || typeof x.type !== 'string' || !Array.isArray(x.sources) || !Array.isArray(x.facts)) continue;
					const inc = x as unknown as RadarIncident;
					const prev = incidents.get(inc.id);
					if (prev) {
						prev.seenOn.push(m[1]);
						prev.incident = inc; // the latest file wins
					} else incidents.set(inc.id, {incident: inc, seenOn: [m[1]]});
				}
			}
		}
	return {files, incidents, from, to};
};

/**
 * One of our own episodes. `protocol` and `incidentDate` come from its brief, so a story is recognised even when the
 * radar's id for it changes between days (see match.ts).
 */
export type PreviousEpisode = {slug: string; date: string; incidentId: string | null; approved: boolean; protocol?: string | null; incidentDate?: string | null};

/** Our own episodes from `from` to `to`, from their brief.json and approval.json. */
export const previousEpisodes = (contentRoot: string, from: string, to: string, exceptSlug?: string): PreviousEpisode[] => {
	const out: PreviousEpisode[] = [];
	if (!existsSync(contentRoot)) return out;
	for (const name of readdirSync(contentRoot).sort()) {
		const ds = parseDateSlug(name);
		if (!ds || name === exceptSlug || ds.date < from || ds.date > to) continue;
		const b = readJson(join(contentRoot, name, 'brief.json'));
		const inc = b.ok && isRecord(b.data) && isRecord(b.data.incident) ? b.data.incident : null;
		const incidentId = inc && typeof inc.id === 'string' ? inc.id : null;
		const protocol = inc && typeof inc.protocol === 'string' && inc.protocol.trim() ? inc.protocol.trim() : null;
		const incidentDate = inc && isDate(inc.dateUtc) ? inc.dateUtc : null;
		out.push({slug: name, date: ds.date, incidentId, approved: existsSync(join(contentRoot, name, 'approval.json')), ...(protocol ? {protocol} : {}), ...(incidentDate ? {incidentDate} : {})});
	}
	return out;
};

export const windowFor = (date: string, days = WINDOW_DAYS) => ({from: addDays(date, -(days - 1)), to: date, days});

export const ageDays = (incidentDate: string, runDate: string): number | null => (isDate(incidentDate) ? daysBetween(incidentDate, runDate) : null);
