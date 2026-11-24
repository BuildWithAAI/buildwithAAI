/**
 * Time helpers: YouTube's quota day (midnight Pacific Time), the owner's time zone (America/Chicago) for publish
 * times, and strict ISO 8601 parsing. Uses Intl only (Node ships full ICU), no dependencies.
 */
import {OWNER_TIME_ZONE, QUOTA_TIME_ZONE} from './contracts.ts';

type WallParts = {year: number; month: number; day: number; hour: number; minute: number; second: number};

const partsIn = (ms: number, timeZone: string): WallParts => {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hourCycle: 'h23',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	}).formatToParts(new Date(ms));
	const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? NaN);
	return {year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second')};
};

/** Offset of `timeZone` from UTC at instant `ms`, in milliseconds (local minus UTC). */
const offsetAt = (ms: number, timeZone: string): number => {
	const p = partsIn(ms, timeZone);
	return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
};

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** "YYYY-MM-DD" of the instant in `timeZone`. */
export const dayIn = (ms: number, timeZone: string): string => {
	const p = partsIn(ms, timeZone);
	return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
};

/** The quota day an API call is charged to (quotas reset at midnight Pacific Time). */
export const quotaDay = (ms: number): string => dayIn(ms, QUOTA_TIME_ZONE);

/** "2026-11-28 09:00 CST": a time as the owner reads it. */
export const formatInZone = (ms: number, timeZone = OWNER_TIME_ZONE): string => {
	const p = partsIn(ms, timeZone);
	const zone = new Intl.DateTimeFormat('en-US', {timeZone, timeZoneName: 'short'}).formatToParts(new Date(ms)).find((x) => x.type === 'timeZoneName')?.value ?? timeZone;
	return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)} ${zone}`;
};

/** Normalized UTC form YouTube accepts for status.publishAt, e.g. "2026-11-28T15:00:00.000Z". */
export const toUtcIso = (ms: number): string => new Date(ms).toISOString();

const ISO_WITH_ZONE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/;
const WALL_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Parses an ISO 8601 timestamp that carries Z or an offset. Returns epoch ms, or null. */
export const parseIsoWithZone = (text: string): number | null => {
	const m = ISO_WITH_ZONE.exec(text.trim());
	if (!m) return null;
	const ms = Date.parse(text.trim());
	if (!Number.isFinite(ms)) return null;
	// Date.parse rolls over impossible dates (Feb 30); check the fields survive the round trip in the given offset
	const offset = m[8] === 'Z' ? 0 : (m[8].startsWith('-') ? -1 : 1) * (Number(m[8].slice(1, 3)) * 60 + Number(m[8].slice(4, 6))) * 60_000;
	const local = new Date(ms + offset);
	if (local.getUTCFullYear() !== Number(m[1]) || local.getUTCMonth() + 1 !== Number(m[2]) || local.getUTCDate() !== Number(m[3]) || local.getUTCHours() !== Number(m[4]) || local.getUTCMinutes() !== Number(m[5])) {
		return null;
	}
	return ms;
};

export type ZonedResult = {ok: true; ms: number} | {ok: false; reason: 'invalid' | 'nonexistent' | 'ambiguous'; detail: string};

/**
 * A wall-clock time in a named zone as an instant. Refuses times that do not exist (the spring-forward gap) or happen
 * twice (the fall-back hour): those need an explicit offset.
 */
export const zonedWallTimeToMs = (wall: WallParts, timeZone: string): ZonedResult => {
	const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
	const check = new Date(asUtc);
	if (check.getUTCMonth() + 1 !== wall.month || check.getUTCDate() !== wall.day || wall.hour > 23 || wall.minute > 59 || wall.second > 59) {
		return {ok: false, reason: 'invalid', detail: 'not a real calendar date and time'};
	}
	const offsets = new Set([offsetAt(asUtc - 86_400_000, timeZone), offsetAt(asUtc, timeZone), offsetAt(asUtc + 86_400_000, timeZone)]);
	const candidates = [...new Set([...offsets].map((o) => asUtc - o).filter((ms) => asUtc - ms === offsetAt(ms, timeZone)))];
	if (candidates.length === 0) return {ok: false, reason: 'nonexistent', detail: `this time does not exist in ${timeZone} (the clocks skip it)`};
	if (candidates.length > 1) return {ok: false, reason: 'ambiguous', detail: `this time happens twice in ${timeZone} (the clocks fall back)`};
	return {ok: true, ms: candidates[0]};
};

/**
 * A publish time from the owner: ISO 8601 with Z or an offset, or "YYYY-MM-DD HH:MM" read in America/Chicago (the
 * owner's zone). Returns epoch ms, or a message saying what to type instead.
 */
export const parsePublishTime = (text: string, timeZone = OWNER_TIME_ZONE): {ok: true; ms: number} | {ok: false; message: string} => {
	const trimmed = text.trim();
	if (ISO_WITH_ZONE.test(trimmed)) {
		const ms = parseIsoWithZone(trimmed);
		return ms === null ? {ok: false, message: `"${text}" is not a real date and time.`} : {ok: true, ms};
	}
	const m = WALL_TIME.exec(trimmed);
	if (!m) return {ok: false, message: `"${text}" is not a time. Use "YYYY-MM-DD HH:MM" (read in ${timeZone}) or ISO 8601 with an offset, e.g. 2026-11-28T09:00:00-06:00.`};
	const result = zonedWallTimeToMs({year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), hour: Number(m[4]), minute: Number(m[5]), second: Number(m[6] ?? 0)}, timeZone);
	return result.ok ? {ok: true, ms: result.ms} : {ok: false, message: `"${text}": ${result.detail}. Give the time with an explicit UTC offset instead.`};
};
