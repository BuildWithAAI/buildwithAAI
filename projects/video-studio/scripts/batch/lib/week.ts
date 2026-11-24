/**
 * ISO 8601 weeks ("2026-W49": Monday 2026-11-30 to Sunday 2026-12-06) and calendar-date arithmetic on plain
 * "YYYY-MM-DD" strings. Dates are civil dates with no time zone; zone.ts turns a date plus a wall-clock time into an
 * instant. Pure, no dependencies.
 */

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export type Weekday = (typeof DAYS)[number];

export type IsoWeek = {year: number; week: number};

const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEK_RE = /^(\d{4})-?W(\d{1,2})$/i;

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** Epoch ms of a civil date at 00:00 UTC, or null for a malformed or impossible date. */
export const dateMs = (date: string): number | null => {
	const m = DATE_RE.exec(date);
	if (!m) return null;
	const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
	const ms = Date.UTC(y, mo - 1, d);
	const check = new Date(ms);
	return check.getUTCFullYear() === y && check.getUTCMonth() === mo - 1 && check.getUTCDate() === d ? ms : null;
};

export const isDate = (date: string): boolean => dateMs(date) !== null;

const dateOfMs = (ms: number): string => {
	const d = new Date(ms);
	return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

const mustDate = (date: string): number => {
	const ms = dateMs(date);
	if (ms === null) throw new Error(`"${date}" is not a date (YYYY-MM-DD)`);
	return ms;
};

export const addDays = (date: string, days: number): string => dateOfMs(mustDate(date) + days * DAY_MS);

/** 0 = Monday ... 6 = Sunday. */
export const weekdayIndex = (date: string): number => (new Date(mustDate(date)).getUTCDay() + 6) % 7;

export const weekdayOf = (date: string): Weekday => DAYS[weekdayIndex(date)];

/** The ISO week a civil date belongs to (the week's Thursday decides the year). */
export const weekOfDate = (date: string): IsoWeek => {
	const thursday = addDays(date, 3 - weekdayIndex(date));
	const year = Number(thursday.slice(0, 4));
	const jan1 = mustDate(`${year}-01-01`);
	const week = Math.floor((mustDate(thursday) - jan1) / DAY_MS / 7) + 1;
	return {year, week};
};

/** 52 or 53: December 28 is always in a year's last ISO week. */
export const weeksInYear = (year: number): number => weekOfDate(`${year}-12-28`).week;

export const weekId = (w: IsoWeek): string => `${w.year}-W${pad(w.week)}`;

/** "2026-W49", "2026w49" or "2026-W9" -> {2026, 49}; null when it is not a real ISO week. */
export const parseWeek = (text: string): IsoWeek | null => {
	const m = WEEK_RE.exec(text.trim());
	if (!m) return null;
	const year = Number(m[1]);
	const week = Number(m[2]);
	if (year < 1970 || year > 9999 || week < 1 || week > weeksInYear(year)) return null;
	return {year, week};
};

/** Monday of an ISO week ("YYYY-MM-DD"). January 4 is always in week 1. */
export const mondayOf = (w: IsoWeek): string => {
	const jan4 = `${w.year}-01-04`;
	const week1Monday = addDays(jan4, -weekdayIndex(jan4));
	return addDays(week1Monday, (w.week - 1) * 7);
};

/** The seven dates of a week, Monday first. */
export const weekDates = (w: IsoWeek): string[] => {
	const monday = mondayOf(w);
	return DAYS.map((_, i) => addDays(monday, i));
};

export const addWeeks = (w: IsoWeek, n: number): IsoWeek => weekOfDate(addDays(mondayOf(w), n * 7));

export const compareWeeks = (a: IsoWeek, b: IsoWeek): number => (a.year === b.year ? a.week - b.week : a.year - b.year);

/** Weeks from `from` to `to`, both included (empty when to < from). */
export const weekRange = (from: IsoWeek, to: IsoWeek): IsoWeek[] => {
	const out: IsoWeek[] = [];
	for (let w = from; compareWeeks(w, to) <= 0; w = addWeeks(w, 1)) out.push(w);
	return out;
};

/** "30 Nov" / "30 Nov 2026" for people. */
export const shortDate = (date: string, withYear = false): string => {
	const ms = mustDate(date);
	const d = new Date(ms);
	const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
	return `${d.getUTCDate()} ${month}${withYear ? ` ${d.getUTCFullYear()}` : ''}`;
};
