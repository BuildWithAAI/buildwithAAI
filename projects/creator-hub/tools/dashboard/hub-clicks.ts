/**
 * Link-hub clicks, from the hub's SQLite file (opened read-only) or from its admin CSV exports.
 *
 * Counting rule, identical to /admin and /admin/export/video-clicks.csv: humans only (is_bot = 0),
 * outcome "redirected", and one click per visitor hash, offer and UTC day. The first click of the day
 * keeps its video and source.
 */
import {existsSync, readFileSync, statSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {parseSource, parseVideoId} from '../../src/server/offers.ts';
import {CsvError, MAX_CSV_BYTES, parseCsv, unprotectCell} from './csv.ts';
import type {ClickCount, HubClicks, Issue, OutcomeCount} from './model.ts';

export const DAY_MS = 86_400_000;

/** Unix-ms window, start inclusive and end exclusive. */
export type TimeRange = {start: number; end: number};
export const ALL_TIME: TimeRange = {start: 0, end: Number.MAX_SAFE_INTEGER};

const FIRST_CLICKS = `SELECT offer_id, video_id, source, MIN(ts) AS ts FROM clicks
	WHERE ts >= ? AND ts < ? AND is_bot = 0 AND outcome = 'redirected'
	GROUP BY offer_id, visitor_hash, ts / 86400000`;
const CLICKS_SQL = `SELECT video_id, offer_id, source, COUNT(*) AS n FROM (${FIRST_CLICKS}) GROUP BY video_id, offer_id, source`;
const OUTCOMES_SQL = 'SELECT offer_id, outcome, COUNT(*) AS n FROM clicks WHERE ts >= ? AND ts < ? AND is_bot = 0 GROUP BY offer_id, outcome';

type Result = {hub: HubClicks | null; issues: Issue[]};

/** Clicks with an unreadable ?v= or ?s= are kept, with the value treated as missing (as /go does). */
const clickCount = (videoId: unknown, offerId: string, source: unknown, clicks: number): ClickCount => ({
	videoId: typeof videoId === 'string' ? parseVideoId(videoId) : null,
	offerId,
	source: typeof source === 'string' ? parseSource(source) : null,
	clicks,
});

export const readHubDb = (file: string, range: TimeRange = ALL_TIME): Result => {
	if (!existsSync(file)) return {hub: null, issues: [{level: 'error', where: file, message: 'hub database not found'}]};
	let db: DatabaseSync | null = null;
	try {
		db = new DatabaseSync(file, {readOnly: true});
		const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'clicks'").get();
		if (!table) return {hub: null, issues: [{level: 'error', where: file, message: 'no clicks table: is this the hub database (hub.sqlite)?'}]};
		const clicks = db
			.prepare(CLICKS_SQL)
			.all(range.start, range.end)
			.map((r) => clickCount(r.video_id, String(r.offer_id), r.source, Number(r.n)));
		const outcomes: OutcomeCount[] = db
			.prepare(OUTCOMES_SQL)
			.all(range.start, range.end)
			.map((r) => ({offerId: String(r.offer_id), outcome: String(r.outcome), requests: Number(r.n)}));
		return {hub: {origin: `hub database ${file}`, clicks, outcomes}, issues: []};
	} catch (err) {
		const hint = /unable to open|readonly|locked/i.test((err as Error).message)
			? ' (copy hub.sqlite together with its -wal and -shm files, or stop the server first, or use the admin CSV export)'
			: '';
		return {hub: null, issues: [{level: 'error', where: file, message: `cannot read the hub database: ${(err as Error).message}${hint}`}]};
	} finally {
		db?.close();
	}
};

const AGGREGATE_HEADER = ['video_id', 'offer_id', 'source', 'hub_clicks'];
const RAW_REQUIRED = ['ts', 'offer_id', 'video_id', 'source', 'visitor_hash', 'is_bot', 'outcome'];
const OFFER_ID = /^[a-z0-9-]{2,40}$/;

/**
 * Reads /admin/export/video-clicks.csv (already counted by the hub) or /admin/export/clicks.csv (the
 * raw log, counted here with the same rule). The format is recognised from the header row.
 */
export const parseHubCsv = (text: string, file: string, range: TimeRange = ALL_TIME): Result => {
	const issues: Issue[] = [];
	let table;
	try {
		table = parseCsv(text);
	} catch (err) {
		if (err instanceof CsvError) return {hub: null, issues: [{level: 'error', where: file, message: err.message}]};
		throw err;
	}
	const header = table.header.map((h) => h.trim().toLowerCase());
	const col = (name: string): number => header.indexOf(name);
	const bad: string[] = [];
	const reject = (line: number, why: string): void => {
		bad.push(`line ${line}: ${why}`);
	};

	let hub: HubClicks;
	if (AGGREGATE_HEADER.every((name) => col(name) !== -1) && col('ts') === -1) {
		const clicks: ClickCount[] = [];
		for (const row of table.rows) {
			const cell = (name: string): string => unprotectCell((row.cells[col(name)] ?? '').trim());
			const offerId = cell('offer_id');
			const n = Number(cell('hub_clicks'));
			if (!OFFER_ID.test(offerId)) reject(row.line, 'offer_id is not an offer id');
			else if (!Number.isInteger(n) || n < 0) reject(row.line, 'hub_clicks is not a whole number');
			else clicks.push(clickCount(cell('video_id') || null, offerId, cell('source') || null, n));
		}
		if (range.start > ALL_TIME.start || range.end < ALL_TIME.end) issues.push({level: 'note', where: file, message: 'video-clicks.csv has no dates, so --from/--to do not apply to it; export it with ?days=N instead'});
		hub = {origin: `hub export ${file} (counted by the hub)`, clicks, outcomes: null};
	} else if (RAW_REQUIRED.every((name) => col(name) !== -1)) {
		const first = new Map<string, {ts: number; videoId: string; offerId: string; source: string}>();
		const outcomes = new Map<string, number>();
		for (const row of table.rows) {
			const cell = (name: string): string => unprotectCell((row.cells[col(name)] ?? '').trim());
			const ts = Number(cell('ts'));
			const offerId = cell('offer_id');
			const visitor = cell('visitor_hash');
			const isBot = cell('is_bot');
			const outcome = cell('outcome');
			if (!Number.isSafeInteger(ts) || ts < 0) {
				reject(row.line, 'ts is not a unix time in milliseconds');
				continue;
			}
			if (!OFFER_ID.test(offerId) || !visitor || (isBot !== '0' && isBot !== '1') || !outcome) {
				reject(row.line, 'offer_id, visitor_hash, is_bot or outcome is missing or invalid');
				continue;
			}
			if (ts < range.start || ts >= range.end || isBot === '1') continue;
			const outcomeKey = `${offerId}\u0000${outcome}`;
			outcomes.set(outcomeKey, (outcomes.get(outcomeKey) ?? 0) + 1);
			if (outcome !== 'redirected') continue;
			const key = `${offerId}\u0000${visitor}\u0000${Math.floor(ts / DAY_MS)}`;
			const seen = first.get(key);
			if (!seen || ts < seen.ts) first.set(key, {ts, videoId: cell('video_id'), offerId, source: cell('source')});
		}
		const counts = new Map<string, ClickCount>();
		for (const click of first.values()) {
			const parsed = clickCount(click.videoId || null, click.offerId, click.source || null, 1);
			const key = `${parsed.videoId ?? ''}\u0000${parsed.offerId}\u0000${parsed.source ?? ''}`;
			const existing = counts.get(key);
			if (existing) existing.clicks++;
			else counts.set(key, parsed);
		}
		hub = {
			origin: `hub click log ${file} (counted here: humans, once per visitor, offer and day)`,
			clicks: [...counts.values()],
			outcomes: [...outcomes].map(([key, requests]) => {
				const [offerId, outcome] = key.split('\u0000') as [string, string];
				return {offerId, outcome, requests};
			}),
		};
	} else {
		return {
			hub: null,
			issues: [{level: 'error', where: file, message: 'not a hub export: expected the header of /admin/export/video-clicks.csv or /admin/export/clicks.csv'}],
		};
	}
	if (bad.length > 0) {
		issues.push({level: 'warning', where: file, message: `${bad.length} row(s) skipped: ${bad.slice(0, 5).join('; ')}${bad.length > 5 ? '; ...' : ''}`});
	}
	return {hub, issues};
};

export const readHubCsv = (file: string, range: TimeRange = ALL_TIME): Result => {
	try {
		if (statSync(file).size > MAX_CSV_BYTES) return {hub: null, issues: [{level: 'error', where: file, message: 'file is too large'}]};
		return parseHubCsv(readFileSync(file, 'utf8'), file, range);
	} catch (err) {
		return {hub: null, issues: [{level: 'error', where: file, message: `cannot read: ${(err as Error).message}`}]};
	}
};
