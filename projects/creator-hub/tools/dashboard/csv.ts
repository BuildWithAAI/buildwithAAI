/**
 * CSV reading and writing for the dashboard (RFC 4180), plus the value parsers every importer shares:
 * numbers with thousands separators, percentages, durations ("0:45", "1:02:03" or seconds) and dates.
 * Parsers return null for an empty or unreadable cell; callers decide whether that is a problem.
 */

export type CsvRow = {line: number; cells: string[]};
export type CsvTable = {header: string[]; rows: CsvRow[]};

/** Inputs larger than this are refused, so a wrong file cannot exhaust memory. */
export const MAX_CSV_BYTES = 25 * 1024 * 1024;
const MAX_ROWS = 200_000;
const MAX_COLUMNS = 400;

export class CsvError extends Error {}

/**
 * Parses CSV text: quoted fields, doubled quotes, embedded delimiters and line breaks, CRLF/LF/CR
 * endings and a leading byte-order mark. Blank lines are skipped. `line` is the 1-based line where
 * each record starts, for messages.
 */
export const parseCsv = (text: string, delimiter = ','): CsvTable => {
	if (text.length > MAX_CSV_BYTES) throw new CsvError(`file is larger than ${MAX_CSV_BYTES / 1024 / 1024} MB`);
	if (delimiter.length !== 1 || delimiter === '"' || delimiter === '\n' || delimiter === '\r') throw new CsvError('invalid delimiter');
	const records: CsvRow[] = [];
	let cells: string[] = [];
	let cell = '';
	let quoted = false;
	let line = 1;
	let recordLine = 1;
	let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;

	const endRecord = (): void => {
		cells.push(cell);
		cell = '';
		if (!(cells.length === 1 && cells[0] === '')) {
			if (cells.length > MAX_COLUMNS) throw new CsvError(`line ${recordLine}: more than ${MAX_COLUMNS} columns`);
			records.push({line: recordLine, cells});
			if (records.length > MAX_ROWS + 1) throw new CsvError(`more than ${MAX_ROWS} rows`);
		}
		cells = [];
	};

	while (i < text.length) {
		const ch = text[i];
		if (quoted) {
			if (ch === '"') {
				if (text[i + 1] === '"') {
					cell += '"';
					i += 2;
					continue;
				}
				quoted = false;
				i++;
				continue;
			}
			if (ch === '\n' || (ch === '\r' && text[i + 1] !== '\n')) line++;
			cell += ch;
			i++;
			continue;
		}
		if (ch === '"' && cell === '') {
			quoted = true;
			i++;
		} else if (ch === delimiter) {
			cells.push(cell);
			cell = '';
			i++;
		} else if (ch === '\r' || ch === '\n') {
			endRecord();
			i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
			line++;
			recordLine = line;
		} else {
			cell += ch;
			i++;
		}
	}
	if (quoted) throw new CsvError(`line ${recordLine}: a quoted field is not closed`);
	if (cell !== '' || cells.length > 0) endRecord();

	const [head, ...rows] = records;
	return {header: head ? head.cells : [], rows};
};

/**
 * Header text compared loosely: Unicode-normalised, without soft hyphens, zero-width characters or a
 * BOM (YouTube Studio exports have contained soft hyphens), whitespace collapsed, lower case.
 */
export const normalizeHeader = (value: string): string =>
	value
		.normalize('NFKC')
		.replace(/[­​-‍⁠﻿]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();

/** Index of the first header matching any alias (normalised), or -1. */
export const findColumn = (header: string[], aliases: readonly string[]): number => {
	const wanted = new Set(aliases.map(normalizeHeader));
	return header.findIndex((h) => wanted.has(normalizeHeader(h)));
};

/** The hub's admin CSV export prefixes cells that start with = + - @ tab or CR with "'"; this undoes it. */
export const unprotectCell = (value: string): string => (/^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value);

// ---------------------------------------------------------------------------------------------
// Values

const EMPTY = new Set(['', '-', '—', '–', 'n/a', 'na', 'null', 'none']);

/**
 * "1,234", "1234.5", "-12.30", "$1,234.50", "12.5 USD" -> number. With decimal "," the European
 * form "1.234,56" is read instead. Negative amounts may also be written the accounting way,
 * "(12.50)", with a trailing minus, "12.50-", or with the Unicode minus sign, "−12.50": payout exports
 * use all three for reversals and chargebacks. Returns null for an empty cell or anything else.
 */
export const parseNumber = (raw: string, decimal: '.' | ',' = '.'): number | null => {
	let text = raw.trim().replace(/\u2212/g, '-').replace(/[   ]/g, '');
	if (EMPTY.has(text.toLowerCase())) return null;
	let negative = false;
	const parenthesised = /^\((.+)\)$/.exec(text);
	if (parenthesised?.[1]) {
		negative = true;
		text = parenthesised[1];
	} else if (/^[^+-].*\d-$/.test(text)) {
		negative = true;
		text = text.slice(0, -1);
	}
	text = text.replace(/^([+-]?)[$€£]/, '$1').replace(/(?<=\d)[A-Z]{3}$/, '');
	const group = decimal === '.' ? ',' : '.';
	const pattern =
		decimal === '.' ? /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/ : /^[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/;
	if (!pattern.test(text)) return null;
	if (negative && /^[+-]/.test(text)) return null; // "(-12.50)" or "-12.50-": not a format anyone writes
	const plain = text.split(group).join('').replace(decimal, '.');
	const value = Number(plain);
	if (!Number.isFinite(value)) return null;
	return negative ? -value : value;
};

/**
 * True when a cell can only be a number with a decimal comma: "41,3", "1074,7", "0,5", "1.234,56". Such
 * cells show that a file was saved in a decimal-comma locale, where "31,200" means 31.2, not 31,200.
 */
export const isDecimalCommaOnly = (raw: string): boolean => {
	const text = raw.trim().replace(/\s*%$/, '');
	return text.includes(',') && parseNumber(text, '.') === null && parseNumber(text, ',') !== null;
};

/** A whole number >= 0 ("1,234"), or null. */
export const parseCount = (raw: string): number | null => {
	const value = parseNumber(raw);
	return value !== null && Number.isInteger(value) && value >= 0 ? value : null;
};

/** "4.8", "4.8%" or "4,8 %" (with decimal ",") -> 0.048. Values from 0 to 1000 percent are accepted. */
export const parsePercent = (raw: string, decimal: '.' | ',' = '.'): number | null => {
	const value = parseNumber(raw.trim().replace(/\s*%$/, ''), decimal);
	// Rounded to 10 decimal places so 7.4% is exactly 0.074, not 0.07400000000000001.
	return value !== null && value >= 0 && value <= 1000 ? Math.round(value * 1e8) / 1e10 : null;
};

/** "45", "45.5", "0:45", "3:12", "0:03:12" or "1:02:03" -> seconds. Minutes and seconds after a colon must be below 60. */
export const parseDuration = (raw: string): number | null => {
	const text = raw.trim();
	if (EMPTY.has(text.toLowerCase())) return null;
	if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
	const match = /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.\d+)?$/.exec(text);
	if (!match) return null;
	const hours = Number(match[1] ?? 0);
	const minutes = Number(match[2]);
	const seconds = Number(match[3]);
	if (minutes >= 60 || seconds >= 60) return null;
	return hours * 3600 + minutes * 60 + seconds;
};

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** "Oct", "Oct.", "October" or "Sept" -> 10 (or 9); null for anything else. */
const monthNumber = (token: string): number | null => {
	const t = token.toLowerCase().replace(/\.$/, '');
	const index = MONTH_NAMES.findIndex((m) => m === t || m.slice(0, 3) === t || (m === 'september' && t === 'sept'));
	return index === -1 ? null : index + 1;
};

const isoDate = (year: number, month: number, day: number): string | null => {
	const date = new Date(Date.UTC(year, month - 1, day));
	if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
	if (year < 2005 || year > 2100) return null;
	return date.toISOString().slice(0, 10);
};

export type DateFormat = 'auto' | 'YYYY-MM-DD' | 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'DD.MM.YYYY';
export const DATE_FORMATS: readonly DateFormat[] = ['auto', 'YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY', 'DD.MM.YYYY'];

/**
 * Returns an ISO date (YYYY-MM-DD) or null. "auto" reads ISO dates and timestamps and English month
 * names ("Oct 20, 2026", "20 October 2026"). Numeric day/month orders are ambiguous, so they are
 * only read when the format is named.
 */
export const parseDate = (raw: string, format: DateFormat = 'auto'): string | null => {
	const text = raw.trim();
	if (!text) return null;
	const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(text);
	if (iso) return isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
	if (format === 'auto' || format === 'YYYY-MM-DD') {
		const monthFirst = /^([A-Za-z]{3,9}\.?) (\d{1,2}),? (\d{4})$/.exec(text);
		const dayFirst = /^(\d{1,2}) ([A-Za-z]{3,9}\.?),? (\d{4})$/.exec(text);
		if (monthFirst) {
			const month = monthNumber(monthFirst[1]!);
			return month ? isoDate(Number(monthFirst[3]), month, Number(monthFirst[2])) : null;
		}
		if (dayFirst) {
			const month = monthNumber(dayFirst[2]!);
			return month ? isoDate(Number(dayFirst[3]), month, Number(dayFirst[1])) : null;
		}
		return null;
	}
	const parts = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:\s.*)?$/.exec(text);
	if (!parts) return null;
	const [a, b, year] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
	if (format === 'MM/DD/YYYY') return text.includes('/') ? isoDate(year, a, b) : null;
	if (format === 'DD/MM/YYYY') return text.includes('/') ? isoDate(year, b, a) : null;
	return text.includes('.') ? isoDate(year, b, a) : null;
};

// ---------------------------------------------------------------------------------------------
// Writing

export type CsvValue = string | number | boolean | null | undefined;

/** Numbers are written as is; text is quoted, and a cell a spreadsheet would run as a formula gets a leading "'". */
export const csvCell = (value: CsvValue): string => {
	if (value === null || value === undefined) return '';
	if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
	return `"${safe.replace(/"/g, '""')}"`;
};

export const toCsv = (header: string[], rows: CsvValue[][]): string =>
	[header.map(csvCell), ...rows.map((row) => row.map(csvCell))].map((cells) => cells.join(',')).join('\r\n') + '\r\n';
