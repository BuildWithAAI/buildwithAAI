/**
 * scripts/batch/config.json: the weekly slots per channel, the formats and their render entry points, the owner's
 * time zone and the approval validity. Every value is a proposal until the owner approves it; the planner reads
 * nothing else, so changing a slot here moves it in the plan, the review page and the calendar alike.
 */
import {DAYS, isDate, parseWeek, type Weekday} from './week.ts';
import type {BatchConfig, ChannelBatchConfig, FormatSpec, ReservedSlot, SlotSpec} from './types.ts';
import {isRecord, readJson, rel, str, UsageError} from './util.ts';
import {isTimeZone, isWallTime} from './zone.ts';

/** Remotion entry points a batch format may render from (the episode engine and the show). */
export const ENTRIES = ['src/episode/index.ts', 'src/show/index.ts'] as const;

const SLUG = /^[a-z0-9][a-z0-9-]{1,47}$/;
const PREFIX = /^[a-z]{1,6}$/;
const FORMAT_ID = /^[a-z][a-z0-9-]{1,31}$/;
const COMPOSITION = /^[A-Za-z0-9-]{1,64}$/;

const isDay = (v: unknown): v is Weekday => typeof v === 'string' && (DAYS as readonly string[]).includes(v);

export const parseConfig = (data: unknown, source: string, root: string, path: string, sha256: string): BatchConfig => {
	const problems: string[] = [];
	const bad = (m: string) => problems.push(`${source}: ${m}`);
	if (!isRecord(data) || data.version !== 1) throw new UsageError(`${source}: expected {"version": 1, ...} (scripts/batch/config.json)`);
	const timeZone = str(data.timeZone) ?? '';
	if (!isTimeZone(timeZone)) bad(`timeZone "${timeZone}" is not an IANA time zone (the owner's is America/Chicago)`);
	const startWeek = str(data.startWeek) ?? '';
	if (!parseWeek(startWeek)) bad(`startWeek "${startWeek}" is not an ISO week like 2026-W49`);
	const approval = isRecord(data.approval) ? data.approval : {};
	const validDays = approval.validDays ?? 7;
	if (typeof validDays !== 'number' || !Number.isInteger(validDays) || validDays < 1 || validDays > 30) bad('approval.validDays must be a whole number from 1 to 30');
	const factBank = isRecord(data.factBank) ? data.factBank : {};
	if (factBank.path !== undefined && factBank.path !== null && !str(factBank.path)) bad('factBank.path must be a file path or null');
	const hub = str(data.hub) ?? '../creator-hub';
	const dateNotes: Record<string, string> = {};
	if (data.dateNotes !== undefined && !isRecord(data.dateNotes)) bad('dateNotes must be an object of "YYYY-MM-DD": "note"');
	for (const [date, note] of Object.entries(isRecord(data.dateNotes) ? data.dateNotes : {})) {
		if (!isDate(date) || typeof note !== 'string' || !note.trim()) bad(`dateNotes["${date}"] must map a date to a short note`);
		else dateNotes[date] = note;
	}

	const channels: ChannelBatchConfig[] = [];
	if (!Array.isArray(data.channels) || !data.channels.length) bad('"channels" must be a non-empty list');
	for (const [i, raw] of (Array.isArray(data.channels) ? data.channels : []).entries()) {
		const at = `channels[${i}]`;
		if (!isRecord(raw)) {
			bad(`${at} must be an object`);
			continue;
		}
		const channel = str(raw.channel) ?? '';
		if (!SLUG.test(channel)) bad(`${at}.channel must be a channel slug like "zoora-ai"`);
		const prefix = str(raw.prefix) ?? '';
		if (!PREFIX.test(prefix)) bad(`${at}.prefix must be 1-6 lowercase letters (item ids are <prefix><n>)`);
		const backlog = str(raw.backlog) ?? '';
		if (!/^content\/[a-z0-9-]+\/backlog\.json$/.test(backlog)) bad(`${at}.backlog must be content/<channel>/backlog.json`);
		const formats: Record<string, FormatSpec> = {};
		const rawFormats = isRecord(raw.formats) ? raw.formats : {};
		if (!Object.keys(rawFormats).length) bad(`${at}.formats must list at least one format`);
		for (const [id, f] of Object.entries(rawFormats)) {
			if (!FORMAT_ID.test(id) || !isRecord(f)) {
				bad(`${at}.formats.${id} must be an object under a lowercase id`);
				continue;
			}
			const entry = str(f.entry) ?? '';
			if (!(ENTRIES as readonly string[]).includes(entry)) bad(`${at}.formats.${id}.entry must be one of ${ENTRIES.join(', ')}`);
			const composition = str(f.composition) ?? '';
			if (!COMPOSITION.test(composition)) bad(`${at}.formats.${id}.composition must be a composition id`);
			const shortComposition = f.shortComposition === null || f.shortComposition === undefined ? null : str(f.shortComposition);
			if (shortComposition !== null && !COMPOSITION.test(shortComposition)) bad(`${at}.formats.${id}.shortComposition must be a composition id or null`);
			if (typeof f.fiction !== 'boolean') bad(`${at}.formats.${id}.fiction must be true or false`);
			formats[id] = {
				label: str(f.label) ?? id,
				length: str(f.length) ?? 'TBD',
				entry,
				composition,
				shortComposition,
				fiction: f.fiction === true,
				notes: Array.isArray(f.notes) ? f.notes.filter((n): n is string => typeof n === 'string') : [],
			};
		}
		const long: SlotSpec[] = [];
		if (!Array.isArray(raw.long) || !raw.long.length) bad(`${at}.long must list at least one weekly long-form slot`);
		for (const [k, s] of (Array.isArray(raw.long) ? raw.long : []).entries()) {
			if (!isRecord(s) || !isDay(s.day) || typeof s.time !== 'string' || !isWallTime(s.time) || !Array.isArray(s.formats) || !s.formats.length) {
				bad(`${at}.long[${k}] needs {day: Mon..Sun, time: "HH:MM", formats: [...]}`);
				continue;
			}
			const unknown = s.formats.filter((x) => typeof x !== 'string' || !formats[x]);
			if (unknown.length) bad(`${at}.long[${k}].formats names unknown formats: ${unknown.map(String).join(', ')}`);
			long.push({day: s.day, time: s.time, formats: s.formats.filter((x): x is string => typeof x === 'string')});
		}
		let shorts: ChannelBatchConfig['shorts'] = null;
		if (raw.shorts !== null && raw.shorts !== undefined) {
			const s = raw.shorts;
			if (!isRecord(s) || !Array.isArray(s.days) || !s.days.every(isDay) || typeof s.time !== 'string' || !isWallTime(s.time)) {
				bad(`${at}.shorts must be null or {days: [Mon..Sun], time: "HH:MM", length}`);
			} else {
				shorts = {days: DAYS.filter((d) => (s.days as string[]).includes(d)), time: s.time, length: str(s.length) ?? '45-60 s'};
				const noShorts = Object.entries(formats).filter(([, f]) => !f.shortComposition).map(([id]) => id);
				const slotFormats = long.flatMap((l) => l.formats);
				if (noShorts.some((id) => slotFormats.includes(id))) bad(`${at}: Shorts are cut from every long-form slot, so its formats need a shortComposition (${noShorts.join(', ')} has none)`);
			}
		}
		const reserved: ReservedSlot[] = [];
		if (raw.reserved !== undefined && !Array.isArray(raw.reserved)) bad(`${at}.reserved must be a list of {label, day, time, note}`);
		for (const [k, r] of (Array.isArray(raw.reserved) ? raw.reserved : []).entries()) {
			const label = isRecord(r) ? str(r.label) : null;
			const day = isRecord(r) ? r.day : undefined;
			const time = isRecord(r) ? r.time : undefined;
			if (!isRecord(r) || !label || !(day === null || isDay(day)) || !(time === null || (typeof time === 'string' && isWallTime(time)))) {
				bad(`${at}.reserved[${k}] needs {label, day: Mon..Sun or null (not chosen), time: "HH:MM" or null, note}`);
				continue;
			}
			reserved.push({label, day: day as ReservedSlot['day'], time: time as string | null, note: str(r.note) ?? ''});
		}
		channels.push({channel, name: str(raw.name) ?? channel, prefix, backlog, long, shorts, formats, ...(reserved.length ? {reserved} : {})});
	}
	const dup = <T>(xs: T[]) => xs.filter((x, i) => xs.indexOf(x) !== i);
	for (const d of dup(channels.map((c) => c.channel))) bad(`channel "${d}" is listed twice`);
	for (const d of dup(channels.map((c) => c.prefix))) bad(`prefix "${d}" is used by two channels`);
	if (problems.length) throw new UsageError(problems);
	return {
		version: 1,
		status: str(data.status) ?? 'proposal',
		timeZone,
		startWeek: startWeek.toUpperCase().replace(/^(\d{4})-?W/, '$1-W'),
		channels,
		approval: {validDays: validDays as number},
		factBank: {path: typeof factBank.path === 'string' ? factBank.path : null},
		dateNotes,
		hub,
		path: rel(root, path),
		sha256,
	};
};

export const loadConfig = (path: string, root: string): BatchConfig => {
	const read = readJson(path);
	if (!read.ok) throw new UsageError(`Batch settings: ${read.error}`);
	return parseConfig(read.data, path, root, path, read.sha256);
};

export const channelConfig = (config: BatchConfig, channel: string): ChannelBatchConfig => {
	const c = config.channels.find((x) => x.channel === channel);
	if (!c) throw new UsageError(`channel "${channel}" is not in the batch settings`);
	return c;
};
