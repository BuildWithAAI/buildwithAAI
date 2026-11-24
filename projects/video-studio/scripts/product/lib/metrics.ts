/**
 * Media-kit statistics from the revenue dashboard's metrics.csv (projects/creator-hub/tools/dashboard), plus the
 * placeholder filler for the media-kit template in docs/SPONSORS.md. Pure functions.
 *
 * Rules: a statistic is computed only from rows that have the needed cells (an empty cell means unknown, never
 * zero, exactly as the dashboard writes it); a statistic with no data stays missing and renders as "not yet
 * available", never as an estimate. Revenue columns are never read: a media kit shows audience, not earnings.
 */

export type MetricsRow = {
	videoId: string;
	title: string;
	channel: string;
	publishedAt: string | null;
	format: 'long' | 'short' | null;
	views: number | null;
	impressions: number | null;
	ctr: number | null;
	avgViewDurationSec: number | null;
	avgPercentViewed: number | null;
	subscribersGained: number | null;
	engagedViews: number | null;
	hubClicksYoutube: number | null;
};

/** The dashboard's contract columns this module needs (metrics-csv.ts CONTRACT_COLUMNS / EXTRA_COLUMNS). */
export const REQUIRED_COLUMNS = ['videoId', 'channel', 'publishedAt', 'format', 'views'] as const;

/** RFC 4180 CSV (quoted fields, doubled quotes, CRLF or LF). Returns rows of raw cells. */
export const parseCsvRows = (text: string): string[][] => {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = '';
	let quoted = false;
	let i = 0;
	const s = text.replace(/^﻿/, '');
	while (i < s.length) {
		const c = s[i];
		if (quoted) {
			if (c === '"') {
				if (s[i + 1] === '"') {
					cell += '"';
					i += 2;
					continue;
				}
				quoted = false;
				i++;
				continue;
			}
			cell += c;
			i++;
			continue;
		}
		if (c === '"' && cell === '') {
			quoted = true;
			i++;
			continue;
		}
		if (c === ',') {
			row.push(cell);
			cell = '';
			i++;
			continue;
		}
		if (c === '\r' || c === '\n') {
			row.push(cell);
			rows.push(row);
			row = [];
			cell = '';
			i += c === '\r' && s[i + 1] === '\n' ? 2 : 1;
			continue;
		}
		cell += c;
		i++;
	}
	if (quoted) throw new Error('metrics.csv: unclosed quoted field');
	if (cell !== '' || row.length) {
		row.push(cell);
		rows.push(row);
	}
	return rows.filter((r) => r.length > 1 || r[0] !== '');
};

/** Undo the dashboard's spreadsheet guard: a text cell that would start a formula was written with a leading "'". */
export const unguard = (cell: string): string => (/^'[=+\-@\t\r]/.test(cell) ? cell.slice(1) : cell);

const num = (cell: string | undefined): number | null => {
	if (cell === undefined) return null;
	const t = cell.trim();
	if (!t) return null;
	const n = Number(t);
	return Number.isFinite(n) ? n : null;
};

export const parseMetricsCsv = (text: string): MetricsRow[] => {
	const rows = parseCsvRows(text);
	if (!rows.length) throw new Error('metrics.csv is empty');
	const header = rows[0].map((h) => unguard(h).trim());
	const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
	if (missing.length) throw new Error(`metrics.csv lacks column(s): ${missing.join(', ')} (is this the dashboard's metrics.csv?)`);
	const at = (name: string) => header.indexOf(name);
	return rows.slice(1).map((r, k) => {
		const get = (name: string): string | undefined => (at(name) >= 0 ? unguard(r[at(name)] ?? '') : undefined);
		const format = get('format');
		if (format && format !== 'long' && format !== 'short') throw new Error(`metrics.csv row ${k + 2}: format "${format}" is not long or short`);
		const published = get('publishedAt')?.trim() || null;
		return {
			videoId: get('videoId') ?? '',
			title: get('title') ?? '',
			channel: get('channel') ?? '',
			publishedAt: published,
			format: (format || null) as MetricsRow['format'],
			views: num(get('views')),
			impressions: num(get('impressions')),
			ctr: num(get('ctr')),
			avgViewDurationSec: num(get('avgViewDurationSec')),
			avgPercentViewed: num(get('avgPercentViewed')),
			subscribersGained: num(get('subscribersGained')),
			engagedViews: num(get('engagedViews')),
			hubClicksYoutube: num(get('hubClicksYoutube')),
		};
	});
};

export const median = (xs: number[]): number | null => {
	if (!xs.length) return null;
	const s = [...xs].sort((a, b) => a - b);
	const m = s.length >> 1;
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const known = (xs: (number | null)[]): number[] => xs.filter((x): x is number => x !== null);

export type ChannelStats = {
	videos: number;
	longVideos: number;
	shorts: number;
	firstPublished: string | null;
	lastPublished: string | null;
	totalViews: number | null;
	medianViewsLong: number | null;
	medianViewsShort: number | null;
	avgViewDurationLongSec: number | null;
	medianPercentViewedLong: number | null;
	medianCtrLong: number | null;
	subscribersGained: number | null;
	engagedViews: number | null;
	hubClicksPer1kViews: number | null;
	recentVideos: number;
	recentMedianViewsLong: number | null;
	windowDays: number;
	asOf: string;
};

const DAY = 86_400_000;

/**
 * Statistics for one channel. `asOf` (YYYY-MM-DD) anchors the recent window; CTR uses long videos with 100+ views
 * only (the dashboard's rule: YouTube Help says CTR varies widely below 100 views, and Shorts have no CTR).
 */
export const channelStats = (rows: MetricsRow[], channel: string, asOf: string, windowDays = 90): ChannelStats => {
	const mine = rows.filter((r) => r.channel === channel);
	const long = mine.filter((r) => r.format === 'long');
	const short = mine.filter((r) => r.format === 'short');
	const dates = mine.map((r) => r.publishedAt).filter((d): d is string => !!d && /^\d{4}-\d{2}-\d{2}/.test(d)).map((d) => d.slice(0, 10)).sort();
	const views = known(mine.map((r) => r.views));
	const wd = long.filter((r) => r.views !== null && r.avgViewDurationSec !== null && (r.views as number) > 0);
	const wdViews = wd.reduce((a, r) => a + (r.views as number), 0);
	const hub = mine.filter((r) => r.hubClicksYoutube !== null && r.views !== null);
	const hubViews = hub.reduce((a, r) => a + (r.views as number), 0);
	const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
	const recentLong = long.filter((r) => r.publishedAt && asOfMs - Date.parse(`${r.publishedAt.slice(0, 10)}T00:00:00Z`) <= windowDays * DAY && Date.parse(`${r.publishedAt.slice(0, 10)}T00:00:00Z`) <= asOfMs);
	const recentAll = mine.filter((r) => r.publishedAt && asOfMs - Date.parse(`${r.publishedAt.slice(0, 10)}T00:00:00Z`) <= windowDays * DAY && Date.parse(`${r.publishedAt.slice(0, 10)}T00:00:00Z`) <= asOfMs);
	const subs = known(mine.map((r) => r.subscribersGained));
	const engaged = known(mine.map((r) => r.engagedViews));
	return {
		videos: mine.length,
		longVideos: long.length,
		shorts: short.length,
		firstPublished: dates[0] ?? null,
		lastPublished: dates[dates.length - 1] ?? null,
		totalViews: views.length ? views.reduce((a, b) => a + b, 0) : null,
		medianViewsLong: median(known(long.map((r) => r.views))),
		medianViewsShort: median(known(short.map((r) => r.views))),
		avgViewDurationLongSec: wdViews > 0 ? wd.reduce((a, r) => a + (r.avgViewDurationSec as number) * (r.views as number), 0) / wdViews : null,
		medianPercentViewedLong: median(known(long.map((r) => r.avgPercentViewed))),
		medianCtrLong: median(known(long.filter((r) => (r.views ?? 0) >= 100).map((r) => r.ctr))),
		subscribersGained: subs.length ? subs.reduce((a, b) => a + b, 0) : null,
		engagedViews: engaged.length ? engaged.reduce((a, b) => a + b, 0) : null,
		hubClicksPer1kViews: hubViews > 0 ? (hub.reduce((a, r) => a + (r.hubClicksYoutube as number), 0) / hubViews) * 1000 : null,
		recentVideos: recentAll.length,
		recentMedianViewsLong: median(known(recentLong.map((r) => r.views))),
		windowDays,
		asOf,
	};
};

// ------------------------------------------------------------------------------------------ formatting

export const fmtInt = (n: number): string => Math.round(n).toLocaleString('en-US');
export const fmtPct = (fraction: number, digits = 1): string => `${(fraction * 100).toFixed(digits)}%`;
export const fmtDuration = (sec: number): string => {
	const s = Math.round(sec);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const r = s % 60;
	return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const fmtDate = (iso: string): string => {
	const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
	return `${d} ${MONTHS[m - 1]} ${y}`;
};

/** Placeholder values for the template; absent keys are missing. Every value is a display string. */
export const statValues = (s: ChannelStats): Record<string, string> => {
	const v: Record<string, string> = {
		'stats.asOf': fmtDate(s.asOf),
		'stats.windowDays': String(s.windowDays),
		'stats.videos': fmtInt(s.videos),
		'stats.longVideos': fmtInt(s.longVideos),
		'stats.shorts': fmtInt(s.shorts),
		'stats.recentVideos': fmtInt(s.recentVideos),
	};
	if (!s.videos) {
		for (const k of ['stats.videos', 'stats.longVideos', 'stats.shorts', 'stats.recentVideos']) delete v[k];
	}
	if (s.firstPublished && s.lastPublished) v['stats.dataRange'] = `${fmtDate(s.firstPublished)} to ${fmtDate(s.lastPublished)}`;
	if (s.totalViews !== null) v['stats.totalViews'] = fmtInt(s.totalViews);
	if (s.medianViewsLong !== null) v['stats.medianViewsLong'] = fmtInt(s.medianViewsLong);
	if (s.medianViewsShort !== null) v['stats.medianViewsShort'] = fmtInt(s.medianViewsShort);
	if (s.recentMedianViewsLong !== null) v['stats.recentMedianViewsLong'] = fmtInt(s.recentMedianViewsLong);
	if (s.avgViewDurationLongSec !== null) v['stats.avgViewDurationLong'] = fmtDuration(s.avgViewDurationLongSec);
	if (s.medianPercentViewedLong !== null) v['stats.medianPercentViewedLong'] = fmtPct(s.medianPercentViewedLong, 0);
	if (s.medianCtrLong !== null) v['stats.medianCtrLong'] = fmtPct(s.medianCtrLong);
	if (s.subscribersGained !== null) v['stats.subscribersGained'] = fmtInt(s.subscribersGained);
	if (s.engagedViews !== null) v['stats.engagedViews'] = fmtInt(s.engagedViews);
	if (s.hubClicksPer1kViews !== null) v['stats.hubClicksPer1k'] = s.hubClicksPer1kViews.toFixed(1);
	return v;
};

/** Owner-supplied audience facts copied from YouTube Studio (Analytics > Audience). Every field is optional. */
export type AudienceFile = {
	asOf?: string;
	subscribers?: number;
	returningViewersPct?: number;
	topCountries?: {country: string; pct: number}[];
	ageGroups?: {range: string; pct: number}[];
	gender?: {label: string; pct: number}[];
	devices?: {label: string; pct: number}[];
};

export const validateAudience = (a: unknown): string[] => {
	const errors: string[] = [];
	if (!a || typeof a !== 'object') return ['audience file is not an object'];
	const x = a as Record<string, unknown>;
	if (x.asOf !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(x.asOf))) errors.push('asOf must be YYYY-MM-DD');
	if (x.subscribers !== undefined && !(Number.isInteger(x.subscribers) && (x.subscribers as number) >= 0)) errors.push('subscribers must be a whole number');
	if (x.returningViewersPct !== undefined && !(typeof x.returningViewersPct === 'number' && x.returningViewersPct >= 0 && x.returningViewersPct <= 100)) errors.push('returningViewersPct must be 0-100');
	for (const [key, labelKey] of [['topCountries', 'country'], ['ageGroups', 'range'], ['gender', 'label'], ['devices', 'label']] as const) {
		const list = x[key];
		if (list === undefined) continue;
		if (!Array.isArray(list)) {
			errors.push(`${key} must be a list`);
			continue;
		}
		let total = 0;
		for (const [i, item] of list.entries()) {
			const it = item as Record<string, unknown>;
			if (typeof it?.[labelKey] !== 'string' || !(it[labelKey] as string).trim()) errors.push(`${key}[${i}].${labelKey} is required`);
			if (!(typeof it?.pct === 'number' && it.pct >= 0 && it.pct <= 100)) errors.push(`${key}[${i}].pct must be 0-100`);
			else total += it.pct as number;
		}
		if (total > 100.5) errors.push(`${key} adds up to ${total.toFixed(1)}%, more than 100%`);
	}
	return errors;
};

const shareList = (items: {pct: number}[], label: (x: never) => string): string =>
	items.map((i) => `${label(i as never)} ${i.pct.toFixed(i.pct < 10 ? 1 : 0)}%`).join(', ');

export const audienceValues = (a: AudienceFile): Record<string, string> => {
	const v: Record<string, string> = {};
	if (a.asOf) v['audience.asOf'] = fmtDate(a.asOf);
	if (a.subscribers !== undefined) v['audience.subscribers'] = fmtInt(a.subscribers);
	if (a.returningViewersPct !== undefined) v['audience.returningViewers'] = `${a.returningViewersPct.toFixed(0)}%`;
	if (a.topCountries?.length) v['audience.topCountries'] = shareList(a.topCountries, (c: {country: string}) => c.country);
	if (a.ageGroups?.length) v['audience.ageGroups'] = shareList(a.ageGroups, (g: {range: string}) => g.range);
	if (a.gender?.length) v['audience.gender'] = shareList(a.gender, (g: {label: string}) => g.label);
	if (a.devices?.length) v['audience.devices'] = shareList(a.devices, (d: {label: string}) => d.label);
	return v;
};

/** {{key}} or {{key|fallback text}}. */
export const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z][\w.-]*)\s*(?:\|([^{}]*))?\}\}/g;

export const NOT_AVAILABLE = 'not yet available';

/**
 * Fills {{key}} placeholders. A missing key takes its {{key|fallback}} text, or "not yet available"; every missing
 * key is listed either way, so --strict can refuse to publish a kit with gaps.
 */
export const fillTemplate = (template: string, values: Record<string, string>): {text: string; missing: string[]} => {
	const missing = new Set<string>();
	const text = template.replace(PLACEHOLDER_RE, (_, key: string, fallback: string | undefined) => {
		if (key in values) return values[key];
		missing.add(key);
		return fallback !== undefined ? fallback.trim() : NOT_AVAILABLE;
	});
	return {text, missing: [...missing]};
};

/** The media-kit template between the markers in docs/SPONSORS.md. */
export const extractTemplate = (doc: string): string => {
	const start = doc.indexOf('<!-- media-kit:start -->');
	const end = doc.indexOf('<!-- media-kit:end -->');
	if (start < 0 || end < 0 || end < start) throw new Error('docs/SPONSORS.md has no <!-- media-kit:start --> ... <!-- media-kit:end --> block');
	const block = doc.slice(start + '<!-- media-kit:start -->'.length, end);
	// The template sits in a ```text fence so GitHub shows it verbatim; strip the fence.
	return block.replace(/^\s*```[a-z]*\n/, '').replace(/\n```\s*$/, '\n').trim() + '\n';
};
