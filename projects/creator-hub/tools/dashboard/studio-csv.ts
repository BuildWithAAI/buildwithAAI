/**
 * YouTube Studio export reader: Insights (formerly Analytics) -> Advanced Mode -> Content ->
 * "Export current view" -> CSV. The download is a zip; this reads its "Table data.csv".
 *
 * Header names follow English exports. YouTube has renamed some metrics, so both names are accepted:
 * "Impressions" / "Thumbnail impressions" and "Impressions click-through rate (%)" /
 * "Thumbnail impressions click-through rate (%)". Headers are compared loosely (case, spaces,
 * hyphens and soft hyphens are ignored). The first data row is a "Total" row; it is skipped and used
 * only to check that the rows add up. YouTube Help says downloaded reports are limited to 500 rows.
 */
import {readFileSync, statSync} from 'node:fs';
import {CsvError, isDecimalCommaOnly, MAX_CSV_BYTES, normalizeHeader, parseCount, parseCsv, parseDate, parseDuration, parseNumber, parsePercent} from './csv.ts';
import type {Issue, StudioVideo} from './model.ts';

export const STUDIO_ROW_LIMIT = 500;
/** Revenue per 1,000 views above this is flagged: YouTube revenue per 1,000 views is rarely above a few tens. */
export const PLAUSIBLE_REVENUE_PER_1K = 50;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const TOTAL_LABELS = new Set(['total', 'totals', 'grand total']);

/** Loose header key: normalised, then only letters, digits, "%" and "(" ")" kept. */
const looseKey = (value: string): string => normalizeHeader(value).replace(/[^a-z0-9%()]/g, '');

type Field = Exclude<keyof StudioVideo, 'revenue'>;

const ALIASES: Record<Field, string[]> = {
	videoId: ['Content', 'Video ID', 'Video'],
	title: ['Video title', 'Title'],
	publishedAt: ['Video publish time', 'Video publish date', 'Publish time', 'Published'],
	durationSec: ['Duration', 'Video length', 'Length'],
	contentType: ['Content type', 'Format'],
	views: ['Views'],
	engagedViews: ['Engaged views'],
	watchTimeHours: ['Watch time (hours)'],
	impressions: ['Impressions', 'Thumbnail impressions'],
	ctr: [
		'Impressions click-through rate (%)',
		'Thumbnail impressions click-through rate (%)',
		'Impressions click-through rate',
		'Thumbnail impressions click-through rate',
		'Impressions CTR (%)',
	],
	avgViewDurationSec: ['Average view duration'],
	avgPercentViewed: ['Average percentage viewed (%)', 'Average percentage viewed'],
	subscribersNet: ['Subscribers'],
	subscribersGained: ['Subscribers gained'],
	subscribersLost: ['Subscribers lost'],
};

const LOOKUP = new Map<string, Field>();
for (const [field, aliases] of Object.entries(ALIASES) as [Field, string[]][]) for (const alias of aliases) LOOKUP.set(looseKey(alias), field);

/** "Estimated revenue (USD)" or "Your estimated revenue (EUR)": the currency is part of the header. */
const REVENUE_HEADER = /^(?:your)?estimatedrevenue\(([a-z]{3})\)$/;

const METRICS: Field[] = ['views', 'engagedViews', 'watchTimeHours', 'impressions', 'ctr', 'avgViewDurationSec', 'avgPercentViewed', 'subscribersNet', 'subscribersGained', 'subscribersLost'];

const contentType = (raw: string): 'long' | 'short' | null => {
	const value = normalizeHeader(raw);
	if (/^shorts?$/.test(value)) return 'short';
	if (/^(videos?|live|live streams?|long|long-form)$/.test(value)) return 'long';
	return null;
};

export type StudioReport = {videos: StudioVideo[]; totalViews: number | null; issues: Issue[]};

export const parseStudioCsv = (text: string, file: string): StudioReport => {
	const issues: Issue[] = [];
	const error = (message: string): StudioReport => ({videos: [], totalViews: null, issues: [{level: 'error', where: file, message}]});
	let table;
	try {
		table = parseCsv(text);
	} catch (err) {
		if (err instanceof CsvError) return error(err.message);
		throw err;
	}
	const columns = new Map<Field, number>();
	let revenueColumn: {index: number; currency: string} | null = null;
	for (const [index, header] of table.header.entries()) {
		const key = looseKey(header);
		const field = LOOKUP.get(key);
		if (field && !columns.has(field)) columns.set(field, index);
		const revenue = REVENUE_HEADER.exec(key);
		if (revenue && !revenueColumn) revenueColumn = {index, currency: revenue[1]!.toUpperCase()};
	}
	if (!columns.has('videoId')) {
		return error('no "Content" column. Export the Content tab from Advanced Mode (Export current view -> CSV), with YouTube Studio set to English, and use "Table data.csv" from the zip.');
	}
	if (!METRICS.some((m) => columns.has(m)) && !revenueColumn) {
		return error('no metric columns found (for example "Views"). Is this the "Table data.csv" of a Content export in English?');
	}
	// Studio writes revenue with three decimals, so in a file re-saved in a decimal-comma locale "31,200"
	// (31.20 USD) looks exactly like 31,200 dollars. Refuse such a file instead of guessing.
	const numericColumns = [...METRICS.map((m) => columns.get(m)), revenueColumn?.index].filter((i): i is number => i !== undefined);
	for (const row of table.rows) {
		const index = numericColumns.find((i) => isDecimalCommaOnly(row.cells[i] ?? ''));
		if (index === undefined) continue;
		return error(
			`line ${row.line}: "${row.cells[index]}" in "${table.header[index]}" has a decimal comma, so this file was saved in a decimal-comma locale ` +
				'and a revenue such as "31,200" (31.20) could be read as 31,200. Export again with YouTube Studio set to English, or save the CSV with "." as the decimal separator.',
		);
	}

	const videos: StudioVideo[] = [];
	const seen = new Set<string>();
	let totalViews: number | null = null;
	let skipped = 0;
	for (const row of table.rows) {
		const cell = (field: Field): string => {
			const index = columns.get(field);
			return index === undefined ? '' : (row.cells[index] ?? '').trim();
		};
		const where = `${file}:${row.line}`;
		const id = cell('videoId');
		if (TOTAL_LABELS.has(id.toLowerCase())) {
			totalViews = parseCount(cell('views'));
			continue;
		}
		if (!YOUTUBE_ID.test(id)) {
			skipped++;
			continue;
		}
		if (seen.has(id)) {
			issues.push({level: 'warning', where, message: `video ${id} appears twice; the first row is used`});
			continue;
		}
		seen.add(id);

		const read = <T>(field: Field, parse: (raw: string) => T | null, what: string): T | null => {
			const raw = cell(field);
			if (raw === '') return null;
			const value = parse(raw);
			if (value === null) issues.push({level: 'warning', where, message: `${what} "${raw}" is not readable, left empty`});
			return value;
		};
		const count = (field: Field, what: string): number | null => read(field, parseCount, what);
		const signed = (field: Field, what: string): number | null =>
			read(field, (raw) => {
				const value = parseNumber(raw);
				return value !== null && Number.isInteger(value) ? value : null;
			}, what);

		let revenue: StudioVideo['revenue'] = null;
		if (revenueColumn) {
			const raw = (row.cells[revenueColumn.index] ?? '').trim();
			const amount = raw === '' ? null : parseNumber(raw);
			if (raw !== '' && amount === null) issues.push({level: 'warning', where, message: `estimated revenue "${raw}" is not readable, left empty`});
			if (amount !== null) revenue = {currency: revenueColumn.currency, amount};
		}
		const viewsForCheck = parseCount(cell('views'));
		if (revenue && viewsForCheck && (revenue.amount / viewsForCheck) * 1000 > PLAUSIBLE_REVENUE_PER_1K) {
			const per1k = ((revenue.amount / viewsForCheck) * 1000).toFixed(2);
			issues.push({level: 'warning', where, message: `video ${id} earned ${per1k} ${revenue.currency} per 1,000 views, which is unusually high: check the export's number format`});
		}

		videos.push({
			videoId: id,
			title: cell('title') || null,
			publishedAt: read('publishedAt', (raw) => parseDate(raw), 'publish time'),
			durationSec: read('durationSec', parseDuration, 'duration'),
			contentType: read('contentType', contentType, 'content type'),
			views: count('views', 'views'),
			engagedViews: count('engagedViews', 'engaged views'),
			watchTimeHours: read('watchTimeHours', (raw) => {
				const value = parseNumber(raw);
				return value !== null && value >= 0 ? value : null;
			}, 'watch time'),
			impressions: count('impressions', 'impressions'),
			ctr: read('ctr', (raw) => {
				const value = parsePercent(raw);
				return value !== null && value <= 1 ? value : null;
			}, 'click-through rate'),
			avgViewDurationSec: read('avgViewDurationSec', parseDuration, 'average view duration'),
			avgPercentViewed: read('avgPercentViewed', (raw) => parsePercent(raw), 'average percentage viewed'),
			subscribersNet: signed('subscribersNet', 'subscribers'),
			subscribersGained: count('subscribersGained', 'subscribers gained'),
			subscribersLost: count('subscribersLost', 'subscribers lost'),
			revenue,
		});
	}

	if (skipped > 0) issues.push({level: 'note', where: file, message: `${skipped} row(s) without an 11-character video id were skipped (posts, playlists or blank rows)`});
	if (videos.length === 0) issues.push({level: 'warning', where: file, message: 'no video rows found'});
	if (videos.length >= STUDIO_ROW_LIMIT) {
		issues.push({level: 'warning', where: file, message: `${videos.length} rows: YouTube Help says downloaded reports stop at ${STUDIO_ROW_LIMIT} rows, so videos may be missing. Use a shorter date range or the API (--api).`});
	}
	if (totalViews !== null && columns.has('views')) {
		const sum = videos.reduce((n, v) => n + (v.views ?? 0), 0);
		if (Math.abs(sum - totalViews) > Math.max(1, totalViews * 0.005)) {
			issues.push({level: 'note', where: file, message: `the Total row says ${totalViews} views but the video rows add up to ${sum}; the export may leave out some videos (row limit, deleted videos)`});
		}
	}
	if (!columns.has('impressions') || !columns.has('ctr')) {
		issues.push({level: 'note', where: file, message: 'no impressions or click-through-rate column; add "Thumbnail impressions" and its click-through rate in Advanced Mode before exporting'});
	}
	return {videos, totalViews, issues};
};

export const readStudioCsv = (file: string): StudioReport => {
	try {
		if (statSync(file).size > MAX_CSV_BYTES) return {videos: [], totalViews: null, issues: [{level: 'error', where: file, message: 'file is too large'}]};
		return parseStudioCsv(readFileSync(file, 'utf8'), file);
	} catch (err) {
		return {videos: [], totalViews: null, issues: [{level: 'error', where: file, message: `cannot read: ${(err as Error).message}`}]};
	}
};
