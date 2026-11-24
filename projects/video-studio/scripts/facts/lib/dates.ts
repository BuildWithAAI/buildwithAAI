/** Calendar dates as YYYY-MM-DD strings (pure, UTC arithmetic). "Today" is the owner's day in America/Chicago. */

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export const isIsoDate = (s: unknown): s is string => {
	if (typeof s !== 'string' || !ISO.test(s)) return false;
	const d = new Date(`${s}T00:00:00Z`);
	return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

export const addDays = (iso: string, days: number): string => {
	const d = new Date(`${iso}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
};

/** Whole days from a to b (positive when b is later). */
export const daysBetween = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Today in the owner's time zone (America/Chicago), as YYYY-MM-DD. */
export const todayChicago = (now: Date = new Date()): string =>
	new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit'}).format(now);
