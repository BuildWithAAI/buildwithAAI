/**
 * Affiliate payout imports. Every network exports a different CSV, so config/payouts.json maps each
 * programme's columns (see config/payouts.example.json). Payouts are tied to a video through the
 * sub-id the hub appends to the destination URL: "<videoId>.<source>", with "none" for a missing part.
 *
 * Amounts stay in their own currency. They are converted to USD only with a rate from the config's
 * "rates" section; otherwise they are reported separately and never added to USD totals.
 */
import {readFileSync, statSync} from 'node:fs';
import {isOfferId, parseSource, parseVideoId} from '../../src/server/offers.ts';
import type {Source} from '../../src/types.ts';
import {CsvError, DATE_FORMATS, MAX_CSV_BYTES, normalizeHeader, parseCsv, parseDate, parseNumber, type DateFormat} from './csv.ts';
import type {Issue, Money, PayoutRow} from './model.ts';

export type ColumnKey = 'date' | 'offerId' | 'subId' | 'conversions' | 'revenue' | 'currency' | 'status';
const COLUMN_KEYS: readonly ColumnKey[] = ['date', 'offerId', 'subId', 'conversions', 'revenue', 'currency', 'status'];

export type Programme = {
	id: string;
	name: string;
	delimiter: ',' | ';' | '\t';
	decimal: '.' | ',';
	dateFormat: DateFormat;
	columns: Partial<Record<ColumnKey, string>> & {revenue: string};
	/** The CSV's offer or programme names mapped to hub offer ids. */
	offerIds: Record<string, string>;
	/** Offer id for every row, when the file has no offer column. */
	defaultOfferId: string | null;
	/** Currency of every row, when the file has no currency column. */
	currency: string | null;
	/** Only rows with these statuses count (case-insensitive), e.g. ["approved", "paid"]. */
	includeStatuses: string[] | null;
};

export type Rate = {usdPerUnit: number; asOf: string; source: string | null};
export type PayoutConfig = {version: 1; rates: Record<string, Rate>; programmes: Programme[]};

const CURRENCY = /^[A-Z]{3}$/;
const PROGRAMME_ID = /^[a-z0-9-]{2,40}$/;
const PROGRAMME_KEYS = ['id', 'name', 'delimiter', 'decimal', 'dateFormat', 'columns', 'offerIds', 'defaultOfferId', 'currency', 'includeStatuses', 'notes'];
const RATE_KEYS = ['usdPerUnit', 'asOf', 'source'];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Validates config/payouts.json. Every problem is reported, not only the first. */
export const checkPayoutConfig = (input: unknown): {config: PayoutConfig | null; errors: string[]; warnings: string[]} => {
	const errors: string[] = [];
	const warnings: string[] = [];
	if (!isRecord(input)) return {config: null, errors: ['the payout config must be a JSON object'], warnings};
	for (const key of Object.keys(input)) if (!['version', 'rates', 'programmes', 'notes'].includes(key)) errors.push(`unknown field "${key}"`);
	if (input.version !== 1) errors.push('"version" must be 1');

	const rates: Record<string, Rate> = {};
	if (input.rates !== undefined) {
		if (!isRecord(input.rates)) errors.push('"rates" must be an object like {"EUR": {"usdPerUnit": 1.08, "asOf": "2026-11-01"}}');
		else
			for (const [code, raw] of Object.entries(input.rates)) {
				const where = `rates.${code}`;
				if (!CURRENCY.test(code) || code === 'USD') {
					errors.push(`${where}: the key must be a 3-letter currency code other than USD`);
					continue;
				}
				if (!isRecord(raw)) {
					errors.push(`${where} must be an object`);
					continue;
				}
				for (const key of Object.keys(raw)) if (!RATE_KEYS.includes(key)) errors.push(`${where}: unknown field "${key}"`);
				const usdPerUnit = raw.usdPerUnit;
				const asOf = typeof raw.asOf === 'string' ? parseDate(raw.asOf, 'YYYY-MM-DD') : null;
				if (typeof usdPerUnit !== 'number' || !Number.isFinite(usdPerUnit) || usdPerUnit <= 0) errors.push(`${where}.usdPerUnit must be a number above 0 (USD for 1 ${code})`);
				if (!asOf) errors.push(`${where}.asOf must be the date of the rate (YYYY-MM-DD)`);
				if (raw.source !== undefined && typeof raw.source !== 'string') errors.push(`${where}.source must be text`);
				if (typeof usdPerUnit === 'number' && usdPerUnit > 0 && asOf)
					rates[code] = {usdPerUnit, asOf, source: typeof raw.source === 'string' ? raw.source : null};
			}
	}

	const programmes: Programme[] = [];
	if (!Array.isArray(input.programmes)) errors.push('"programmes" must be an array');
	else
		input.programmes.forEach((raw, i) => {
			const where = `programmes[${i}]`;
			if (!isRecord(raw)) {
				errors.push(`${where} must be an object`);
				return;
			}
			for (const key of Object.keys(raw)) if (!PROGRAMME_KEYS.includes(key)) errors.push(`${where}: unknown field "${key}"`);
			const id = typeof raw.id === 'string' && PROGRAMME_ID.test(raw.id) ? raw.id : '';
			if (!id) errors.push(`${where}.id must be 2-40 characters: a-z, 0-9 and "-"`);
			else if (programmes.some((p) => p.id === id)) errors.push(`${where}.id "${id}" is used twice`);
			const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : '';
			if (!name) errors.push(`${where}.name must be text`);
			const delimiter = raw.delimiter === undefined ? ',' : raw.delimiter === 'tab' ? '\t' : raw.delimiter;
			if (delimiter !== ',' && delimiter !== ';' && delimiter !== '\t') errors.push(`${where}.delimiter must be ",", ";" or "tab"`);
			const decimal = raw.decimal ?? '.';
			if (decimal !== '.' && decimal !== ',') errors.push(`${where}.decimal must be "." or ","`);
			const dateFormat = raw.dateFormat ?? 'auto';
			if (!DATE_FORMATS.includes(dateFormat as DateFormat)) errors.push(`${where}.dateFormat must be one of ${DATE_FORMATS.join(', ')}`);

			const columns: Partial<Record<ColumnKey, string>> = {};
			if (!isRecord(raw.columns)) errors.push(`${where}.columns must be an object that maps date, offerId, subId, conversions, revenue, currency and status to CSV headers`);
			else
				for (const [key, header] of Object.entries(raw.columns)) {
					if (!COLUMN_KEYS.includes(key as ColumnKey)) errors.push(`${where}.columns: unknown key "${key}" (allowed: ${COLUMN_KEYS.join(', ')})`);
					else if (typeof header !== 'string' || !header.trim()) errors.push(`${where}.columns.${key} must be the CSV header text`);
					else columns[key as ColumnKey] = header.trim();
				}
			if (!columns.revenue) errors.push(`${where}.columns.revenue is required (the commission or payout amount column)`);
			if (!columns.subId) warnings.push(`${where} (${id || '?'}): no subId column, so its payouts cannot be tied to videos`);

			const offerIds: Record<string, string> = {};
			if (raw.offerIds !== undefined) {
				if (!isRecord(raw.offerIds)) errors.push(`${where}.offerIds must map the CSV's offer names to hub offer ids`);
				else
					for (const [from, to] of Object.entries(raw.offerIds)) {
						if (typeof to !== 'string' || !isOfferId(to)) errors.push(`${where}.offerIds["${from}"] must be a hub offer id`);
						else offerIds[from.trim().toLowerCase()] = to;
					}
			}
			const defaultOfferId = raw.defaultOfferId ?? null;
			if (defaultOfferId !== null && (typeof defaultOfferId !== 'string' || !isOfferId(defaultOfferId))) errors.push(`${where}.defaultOfferId must be a hub offer id`);
			const currency = raw.currency ?? null;
			if (currency !== null && (typeof currency !== 'string' || !CURRENCY.test(currency))) errors.push(`${where}.currency must be a 3-letter code such as "USD"`);
			if (!columns.currency && currency === null) errors.push(`${where}: set "currency" or map columns.currency`);
			let includeStatuses: string[] | null = null;
			if (raw.includeStatuses !== undefined) {
				if (!Array.isArray(raw.includeStatuses) || raw.includeStatuses.length === 0 || !raw.includeStatuses.every((s) => typeof s === 'string' && s.trim()))
					errors.push(`${where}.includeStatuses must be a non-empty list of status names`);
				else includeStatuses = raw.includeStatuses.map((s: string) => s.trim().toLowerCase());
				if (!columns.status) errors.push(`${where}: includeStatuses needs columns.status`);
			}
			if (raw.notes !== undefined && typeof raw.notes !== 'string') errors.push(`${where}.notes must be text`);
			programmes.push({
				id,
				name,
				delimiter: delimiter as Programme['delimiter'],
				decimal: decimal as Programme['decimal'],
				dateFormat: dateFormat as DateFormat,
				columns: {...columns, revenue: columns.revenue ?? ''},
				offerIds,
				defaultOfferId: typeof defaultOfferId === 'string' ? defaultOfferId : null,
				currency: typeof currency === 'string' ? currency : null,
				includeStatuses,
			});
		});
	return errors.length > 0 ? {config: null, errors, warnings} : {config: {version: 1, rates, programmes}, errors, warnings};
};

/** "dQw4w9WgXcQ.yt" -> {videoId, source}; "none" marks a missing part; a bare video id is accepted. */
export const parseSubId = (raw: string): {videoId: string | null; source: Source | null} | null => {
	const value = raw.trim();
	if (!value) return null;
	const dot = value.lastIndexOf('.');
	if (dot === -1) {
		const videoId = parseVideoId(value);
		return videoId && videoId !== 'none' ? {videoId, source: null} : null;
	}
	const videoPart = value.slice(0, dot);
	const sourcePart = value.slice(dot + 1);
	const videoId = videoPart === 'none' ? null : parseVideoId(videoPart);
	const source = sourcePart === 'none' ? null : parseSource(sourcePart);
	if (videoPart !== 'none' && videoId === null) return null;
	if (sourcePart !== 'none' && source === null) return null;
	return {videoId, source};
};

export type DateWindow = {from: string | null; to: string | null}; // inclusive ISO dates

export const parsePayoutCsv = (text: string, file: string, programme: Programme, window: DateWindow = {from: null, to: null}): {rows: PayoutRow[]; issues: Issue[]} => {
	const issues: Issue[] = [];
	let table;
	try {
		table = parseCsv(text, programme.delimiter);
	} catch (err) {
		if (err instanceof CsvError) return {rows: [], issues: [{level: 'error', where: file, message: err.message}]};
		throw err;
	}
	const header = table.header.map(normalizeHeader);
	const index: Partial<Record<ColumnKey, number>> = {};
	const missing: string[] = [];
	for (const key of COLUMN_KEYS) {
		const name = programme.columns[key];
		if (!name) continue;
		const at = header.indexOf(normalizeHeader(name));
		if (at === -1) missing.push(`${key} ("${name}")`);
		else index[key] = at;
	}
	if (missing.length > 0) {
		return {rows: [], issues: [{level: 'error', where: file, message: `columns not found for programme "${programme.id}": ${missing.join(', ')}. Headers in the file: ${table.header.join(', ')}`}]};
	}

	const rows: PayoutRow[] = [];
	const skippedStatus = new Map<string, number>();
	const unmappedOffers = new Set<string>();
	const badSubIds = new Set<string>();
	let outside = 0;
	let undated = 0;
	for (const row of table.rows) {
		const cell = (key: ColumnKey): string => {
			const at = index[key];
			return at === undefined ? '' : (row.cells[at] ?? '').trim();
		};
		const where = `${file}:${row.line}`;
		if (programme.includeStatuses) {
			const status = cell('status').toLowerCase();
			if (!programme.includeStatuses.includes(status)) {
				skippedStatus.set(status || '(empty)', (skippedStatus.get(status || '(empty)') ?? 0) + 1);
				continue;
			}
		}
		const amount = parseNumber(cell('revenue'), programme.decimal);
		if (amount === null) {
			issues.push({level: 'warning', where, message: `amount "${cell('revenue')}" is not a number; row skipped`});
			continue;
		}
		const currency = index.currency !== undefined ? cell('currency').toUpperCase() : (programme.currency ?? '');
		if (!CURRENCY.test(currency)) {
			issues.push({level: 'warning', where, message: `currency "${currency}" is not a 3-letter code; row skipped`});
			continue;
		}
		let date: string | null = null;
		if (index.date !== undefined) {
			date = parseDate(cell('date'), programme.dateFormat);
			if (date === null) issues.push({level: 'warning', where, message: `date "${cell('date')}" does not match ${programme.dateFormat}; kept without a date`});
		}
		if (date === null) undated++;
		else if ((window.from && date < window.from) || (window.to && date > window.to)) {
			outside++;
			continue;
		}
		let conversions: number;
		if (index.conversions !== undefined) {
			const value = parseNumber(cell('conversions'), programme.decimal);
			if (value === null || !Number.isInteger(value)) {
				issues.push({level: 'warning', where, message: `conversions "${cell('conversions')}" is not a whole number; row skipped`});
				continue;
			}
			conversions = value;
		} else {
			conversions = amount < 0 ? -1 : 1; // one transaction per row; a negative amount is a reversal
		}
		let offerId: string | null = programme.defaultOfferId;
		if (index.offerId !== undefined) {
			const name = cell('offerId');
			offerId = programme.offerIds[name.toLowerCase()] ?? (isOfferId(name) ? name : null);
			if (offerId === null && name) unmappedOffers.add(name);
		}
		let videoId: string | null = null;
		let source: Source | null = null;
		if (index.subId !== undefined) {
			const raw = cell('subId');
			const parsed = parseSubId(raw);
			if (parsed) ({videoId, source} = parsed);
			else if (raw) badSubIds.add(raw);
		}
		rows.push({programme: programme.id, file, line: row.line, date, offerId, videoId, source, conversions, amount, currency});
	}
	for (const [status, n] of skippedStatus) issues.push({level: 'note', where: file, message: `${n} row(s) with status "${status}" not counted (includeStatuses: ${programme.includeStatuses?.join(', ')})`});
	if (unmappedOffers.size > 0) issues.push({level: 'warning', where: file, message: `offer names not mapped to a hub offer id (add them to offerIds): ${[...unmappedOffers].slice(0, 10).join(', ')}`});
	if (badSubIds.size > 0) issues.push({level: 'warning', where: file, message: `sub-ids that are not "<videoId>.<source>" (counted as not tied to a video): ${[...badSubIds].slice(0, 10).join(', ')}`});
	if (outside > 0) issues.push({level: 'note', where: file, message: `${outside} row(s) outside --from/--to not counted`});
	if (undated > 0 && (window.from || window.to)) issues.push({level: 'note', where: file, message: `${undated} row(s) without a readable date were counted regardless of --from/--to`});
	return {rows, issues};
};

export const readPayoutCsv = (file: string, programme: Programme, window?: DateWindow): {rows: PayoutRow[]; issues: Issue[]} => {
	try {
		if (statSync(file).size > MAX_CSV_BYTES) return {rows: [], issues: [{level: 'error', where: file, message: 'file is too large'}]};
		return parsePayoutCsv(readFileSync(file, 'utf8'), file, programme, window);
	} catch (err) {
		return {rows: [], issues: [{level: 'error', where: file, message: `cannot read: ${(err as Error).message}`}]};
	}
};

/** Adds an amount to a USD total or, without a rate, to the per-currency list. */
export const addMoney = (target: {usd: number; other: Money[]}, amount: number, currency: string, rates: Record<string, Rate>): void => {
	if (currency === 'USD') {
		target.usd += amount;
		return;
	}
	const rate = rates[currency];
	if (rate) {
		target.usd += amount * rate.usdPerUnit;
		return;
	}
	const existing = target.other.find((m) => m.currency === currency);
	if (existing) existing.amount += amount;
	else target.other.push({currency, amount});
};

/** Rounds to cents so float noise never shows (0.1 + 0.2). */
export const cents = (value: number): number => Math.round(value * 100) / 100;

export const formatMoney = (money: Money[]): string =>
	money
		.filter((m) => cents(m.amount) !== 0)
		.sort((a, b) => a.currency.localeCompare(b.currency))
		.map((m) => `${m.currency} ${cents(m.amount).toFixed(2)}`)
		.join('; ');
