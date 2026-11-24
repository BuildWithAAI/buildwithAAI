/**
 * content/zoora-security/corrections.json: every correction the channel has made, and the pinned comment for each.
 * Owner rule: "pin corrections". The pinned comment text always starts "Correction (<YYYY-MM-DD>): ".
 * Dates are the owner's calendar date in America/Chicago (owner time zone, 2026-11-24).
 */
import type {Correction, CorrectionsFile, CorrectionStatus} from './types.ts';

export const OWNER_TZ = 'America/Chicago';
/** YouTube's comment limit is 10,000 characters; a pinned correction should read at a glance. */
export const COMMENT_MAX = 10_000;
export const COMMENT_SOFT_MAX = 500;

export type CorrectionProblem = {level: 'error' | 'warning'; msg: string; id?: string};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP = /^(?:\d{1,2}:)?\d{1,2}:\d{2}$/;
const SLUG = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,80}$/;

export const validIsoDate = (s: string): boolean => {
	if (!ISO_DATE.test(s)) return false;
	const d = new Date(`${s}T12:00:00Z`);
	return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

/** Today's date (YYYY-MM-DD) in the owner's time zone. */
export const todayIn = (tz: string = OWNER_TZ, now: Date = new Date()): string => {
	const parts = new Intl.DateTimeFormat('en-CA', {timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(now);
	const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
	return `${get('year')}-${get('month')}-${get('day')}`;
};

export const emptyCorrections = (): CorrectionsFile => ({version: 1, corrections: []});

export const validateCorrections = (raw: unknown): {file: CorrectionsFile | null; problems: CorrectionProblem[]} => {
	const problems: CorrectionProblem[] = [];
	const e = (msg: string, id?: string) => problems.push({level: 'error', msg, id});
	const w = (msg: string, id?: string) => problems.push({level: 'warning', msg, id});
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		e('corrections.json must be a JSON object {version: 1, corrections: [...]}');
		return {file: null, problems};
	}
	const o = raw as Record<string, unknown>;
	if (o.version !== 1) e(`corrections.json version must be 1 (got ${JSON.stringify(o.version)})`);
	if (!Array.isArray(o.corrections)) {
		e('corrections.json needs a "corrections" array');
		return {file: null, problems};
	}
	const out: Correction[] = [];
	const ids = new Set<string>();
	(o.corrections as unknown[]).forEach((x, i) => {
		const r = (x ?? {}) as Record<string, unknown>;
		const id = typeof r.id === 'string' && r.id.trim() ? r.id.trim() : `#${i}`;
		const at = `correction "${id}"`;
		if (typeof r.id !== 'string' || !r.id.trim()) e(`corrections[${i}] needs an id`);
		if (ids.has(id)) e(`${at}: duplicate id`, id);
		ids.add(id);
		const slug = typeof r.slug === 'string' ? r.slug.trim() : '';
		if (!SLUG.test(slug)) e(`${at}: slug must be the episode slug it corrects`, id);
		const date = typeof r.date === 'string' ? r.date.trim() : '';
		if (!validIsoDate(date)) e(`${at}: date must be YYYY-MM-DD (got ${JSON.stringify(r.date)})`, id);
		const correct = typeof r.correct === 'string' ? r.correct.trim() : '';
		if (correct.length < 10) e(`${at}: "correct" must state the corrected fact (at least 10 characters)`, id);
		const sourceIds = Array.isArray(r.sourceIds) ? r.sourceIds.filter((s): s is string => typeof s === 'string' && !!s.trim()) : [];
		if (!sourceIds.length) e(`${at}: a correction needs sourceIds (the source that supports the corrected fact)`, id);
		const status = (r.status ?? 'pending') as CorrectionStatus;
		if (status !== 'pending' && status !== 'pinned') e(`${at}: status must be "pending" or "pinned"`, id);
		if (status === 'pinned' && (typeof r.pinnedAt !== 'string' || Number.isNaN(Date.parse(r.pinnedAt)))) e(`${at}: a pinned correction needs pinnedAt (ISO date-time)`, id);
		if (r.timestamp !== undefined && (typeof r.timestamp !== 'string' || !TIMESTAMP.test(r.timestamp))) e(`${at}: timestamp must be mm:ss or h:mm:ss`, id);
		if (r.wrong !== undefined && typeof r.wrong !== 'string') e(`${at}: wrong must be a string`, id);
		const sources: NonNullable<Correction['sources']> = [];
		if (r.sources !== undefined) {
			if (!Array.isArray(r.sources)) e(`${at}: sources must be an array of {id, url, title?, publisher?}`, id);
			else
				for (const s of r.sources as unknown[]) {
					const so = (s ?? {}) as Record<string, unknown>;
					if (typeof so.id !== 'string' || typeof so.url !== 'string' || !/^https?:\/\//.test(so.url)) e(`${at}: each inline source needs an id and an http(s) url`, id);
					else sources.push({id: so.id, url: so.url, title: typeof so.title === 'string' ? so.title : undefined, publisher: typeof so.publisher === 'string' ? so.publisher : undefined});
				}
		}
		if (status === 'pending') w(`${at}: not pinned yet; pin the comment below on the video (and its Shorts)`, id);
		out.push({
			id,
			slug,
			date,
			correct,
			sourceIds,
			wrong: typeof r.wrong === 'string' && r.wrong.trim() ? r.wrong.trim() : undefined,
			timestamp: typeof r.timestamp === 'string' ? r.timestamp : undefined,
			incidentId: typeof r.incidentId === 'string' ? r.incidentId : undefined,
			status: status === 'pinned' ? 'pinned' : 'pending',
			pinnedAt: typeof r.pinnedAt === 'string' ? r.pinnedAt : undefined,
			sources: sources.length ? sources : undefined,
			note: typeof r.note === 'string' ? r.note : undefined,
		});
	});
	return {file: problems.some((p) => p.level === 'error') ? null : {version: 1, corrections: out}, problems};
};

export type SourceRef = {id: string; url: string; publisher?: string; title?: string};

const sentence = (s: string): string => {
	const t = s.trim().replace(/\s+/g, ' ');
	return /[.!?]$/.test(t) ? t : `${t}.`;
};

/**
 * The pinned comment: "Correction (2026-11-25): At 01:23 we said X. <corrected fact> Source: Publisher (url)".
 * `includeWrong` is false when the wrong wording itself breaks a rule (a name, an accusation): then it is left out.
 */
export const pinnedCommentText = (c: Correction, sources: SourceRef[], includeWrong = true): string => {
	const parts: string[] = [`Correction (${c.date}):`];
	if (c.wrong && includeWrong) parts.push(sentence(`${c.timestamp ? `At ${c.timestamp} we` : 'We'} said: "${c.wrong.replace(/"/g, "'")}"`));
	else if (c.timestamp) parts.push(sentence(`This corrects what we said at ${c.timestamp}`));
	parts.push(sentence(c.correct));
	const cited = c.sourceIds.map((id) => sources.find((s) => s.id === id) ?? c.sources?.find((s) => s.id === id)).filter((s): s is SourceRef => !!s);
	if (cited.length) parts.push(`Source${cited.length > 1 ? 's' : ''}: ${cited.map((s) => `${s.publisher ?? s.title ?? s.id} (${s.url})`).join('; ')}`);
	return parts.join(' ');
};

export const correctionsFor = (file: CorrectionsFile, slug: string, incidentIds: string[] = []): Correction[] =>
	file.corrections.filter((c) => c.slug === slug || (!!c.incidentId && incidentIds.includes(c.incidentId)));

export type NewCorrection = Omit<Correction, 'status' | 'date'> & {date?: string; status?: CorrectionStatus};

/** Append a correction (validated). Returns the new file contents; the caller writes it atomically. */
export const addCorrection = (file: CorrectionsFile, c: NewCorrection, now: Date = new Date()): {file: CorrectionsFile | null; problems: CorrectionProblem[]} => {
	const next = {version: 1 as const, corrections: [...file.corrections, {...c, date: c.date ?? todayIn(OWNER_TZ, now), status: c.status ?? 'pending'}]};
	return validateCorrections(JSON.parse(JSON.stringify(next)));
};
