/**
 * Wall-clock times in a named IANA zone (the owner's America/Chicago) and the UTC instants YouTube's publishAt needs.
 * Uses Intl only (Node ships full ICU). A wall time that does not exist (the spring-forward gap) or happens twice
 * (the fall-back hour) is refused: a publish slot must name exactly one instant.
 */

type Parts = {year: number; month: number; day: number; hour: number; minute: number; second: number};

const formatters = new Map<string, Intl.DateTimeFormat>();

const partsIn = (ms: number, timeZone: string): Parts => {
	let f = formatters.get(timeZone);
	if (!f) {
		f = new Intl.DateTimeFormat('en-US', {timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'});
		formatters.set(timeZone, f);
	}
	const parts = f.formatToParts(new Date(ms));
	const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? NaN);
	return {year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second')};
};

/** True when `timeZone` is a zone this runtime knows. */
export const isTimeZone = (timeZone: string): boolean => {
	try {
		new Intl.DateTimeFormat('en-US', {timeZone});
		return true;
	} catch {
		return false;
	}
};

/** Offset of the zone from UTC at an instant, in ms (local minus UTC). */
const offsetAt = (ms: number, timeZone: string): number => {
	const p = partsIn(ms, timeZone);
	return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
};

const pad = (n: number): string => String(n).padStart(2, '0');

export type ZonedResult = {ok: true; ms: number} | {ok: false; reason: 'invalid' | 'nonexistent' | 'ambiguous'; message: string};

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const isWallTime = (time: string): boolean => TIME_RE.test(time);

/** "2026-11-30" + "11:00" in America/Chicago -> the instant (2026-11-30T17:00:00Z). */
export const zonedToUtc = (date: string, time: string, timeZone: string): ZonedResult => {
	const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
	const t = TIME_RE.exec(time);
	if (!d || !t) return {ok: false, reason: 'invalid', message: `"${date} ${time}" is not a date and time (YYYY-MM-DD HH:MM)`};
	const [year, month, day, hour, minute] = [Number(d[1]), Number(d[2]), Number(d[3]), Number(t[1]), Number(t[2])];
	const asUtc = Date.UTC(year, month - 1, day, hour, minute);
	const check = new Date(asUtc);
	if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return {ok: false, reason: 'invalid', message: `${date} is not a real date`};
	// candidates from the offsets around that day; keep those that map back to the same wall time
	const offsets = new Set([offsetAt(asUtc - 86_400_000, timeZone), offsetAt(asUtc, timeZone), offsetAt(asUtc + 86_400_000, timeZone)]);
	const candidates = [...new Set([...offsets].map((o) => asUtc - o).filter((ms) => asUtc - ms === offsetAt(ms, timeZone)))];
	if (candidates.length === 0) return {ok: false, reason: 'nonexistent', message: `${date} ${time} does not exist in ${timeZone} (the clocks skip it)`};
	if (candidates.length > 1) return {ok: false, reason: 'ambiguous', message: `${date} ${time} happens twice in ${timeZone} (the clocks fall back)`};
	return {ok: true, ms: candidates[0]};
};

/** "YYYY-MM-DD" of an instant in the zone. */
export const dateIn = (ms: number, timeZone: string): string => {
	const p = partsIn(ms, timeZone);
	return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
};

/** The zone's short name at an instant ("CST", "CDT"; falls back to the zone id). */
export const zoneAbbr = (ms: number, timeZone: string): string =>
	new Intl.DateTimeFormat('en-US', {timeZone, timeZoneName: 'short'}).formatToParts(new Date(ms)).find((x) => x.type === 'timeZoneName')?.value ?? timeZone;

/** "2026-11-30 11:00 CST": an instant as the owner reads it (the same form the uploader prints). */
export const formatLocal = (ms: number, timeZone: string): string => {
	const p = partsIn(ms, timeZone);
	return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)} ${zoneAbbr(ms, timeZone)}`;
};

/** "17:00 UTC" for the calendar's UTC column. */
export const formatUtcTime = (ms: number): string => {
	const d = new Date(ms);
	return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
};
