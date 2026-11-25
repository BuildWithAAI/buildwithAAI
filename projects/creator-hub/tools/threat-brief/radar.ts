/**
 * Reads the news radar's daily file (schema "zoora-security/radar@1", written by
 * video-studio/scripts/radar/radar.py to content/zoora-security/radar/<date>.json). Only the fields the
 * Threat Brief uses are read and checked. A malformed incident is skipped with a warning instead of failing
 * the whole brief; a file that is not a radar file fails.
 */
import {readFileSync} from 'node:fs';

export const RADAR_SCHEMA = 'zoora-security/radar@1';

export type Tier = 'A' | 'B' | 'C';
export type Status = 'confirmed' | 'developing';

export type RadarSource = {
	id: string;
	url: string;
	title: string;
	publishedUtc: string | null;
	tier: Tier;
	publisher: string;
	kind: string;
	/** The radar's hedge word for this source, if its own check found one. */
	hedge: string | null;
	/** The radar's stored excerpt (at most EXCERPT_MAX characters), used to find hedges the radar missed. */
	excerpt: string;
	/**
	 * An incident database's listing of another outlet's report (the AI Incident Database): discovery only. Its date
	 * is when the database added it, its title is the original outlet's, and it never carries a claim or a figure.
	 */
	listed: boolean;
	/** A single researcher's blog: one outlet's vote, never a confirmation on its own (sources.json "confirmsAlone"). */
	confirmsAlone: boolean;
	/** The article's link spells a person's name, so the radar kept only the outlet's address. */
	urlWithheld: boolean;
};

export type RadarLoss = {amountUsd: number; by: string; url: string; quote: string; tier: Tier};
export type RadarFact = {text: string; sourceId: string; url: string; quote: string; field: string};

/** The radar's lanes: crypto security, AI security, or both (older radar files: crypto). */
export type Lane = 'crypto' | 'ai' | 'both';

export type RadarIncident = {
	id: string;
	title: string;
	protocol: string;
	/**
	 * The radar knows the subject (an AI product or company, an allowlisted organisation, a database record) rather
	 * than reading it from a headline's shape. Older radar files: crypto incidents count as known, as before.
	 */
	subjectKnown: boolean;
	lane: Lane;
	chains: string[];
	type: string;
	dateUtc: string;
	reportedLosses: RadarLoss[];
	status: Status;
	statusReason: string;
	sources: RadarSource[];
	evergreenTopic: string | null;
	notes: string[];
	mechanismKnown: boolean;
	facts: RadarFact[];
	score: number | null;
};

export type RadarCorrection = {incidentId: string; protocol: string; previousRadarDate: string; changes: string[]};

export type Radar = {
	runDate: string;
	generatedUtc: string;
	mode: string;
	top: RadarIncident[];
	alsoSeen: RadarIncident[];
	corrections: RadarCorrection[];
	/** Source id -> display name, from the radar's source health table. */
	sourceNames: Record<string, string>;
};

export type RadarRead = {radar: Radar | null; errors: string[]; warnings: string[]};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** The radar stores short excerpts only (at most 280 characters, plus an ellipsis). */
export const EXCERPT_MAX = 300;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
/**
 * Characters that render as nothing: format controls (Unicode tag characters used for "ASCII smuggling", zero-width
 * and bidi controls), variation selectors and invisible fillers. Feed text can hide instructions for an AI in them,
 * so none reaches the email, even from a radar file written before the radar stripped them.
 */
const INVISIBLE = /[\p{Cf}\u034F\u115F\u1160\u17B4\u17B5\u180B-\u180F\u3164\uFFA0\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/gu;
export const stripInvisible = (text: string): string => text.replace(INVISIBLE, '');
const str = (value: unknown): string => (typeof value === 'string' ? stripInvisible(value).replace(/\s+/g, ' ').trim() : '');
const strList = (value: unknown): string[] => (Array.isArray(value) ? value.map(str).filter(Boolean) : []);
const tier = (value: unknown): Tier | null => (value === 'A' || value === 'B' || value === 'C' ? value : null);

/** An http(s) URL without credentials, normalised; null otherwise. */
export const webUrl = (value: unknown): string | null => {
	if (typeof value !== 'string') return null;
	try {
		const url = new URL(value);
		return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url.href : null;
	} catch {
		return null;
	}
};

const readSource = (raw: unknown): RadarSource | null => {
	if (!isRecord(raw)) return null;
	const url = webUrl(raw.url);
	const t = tier(raw.tier);
	const id = str(raw.id);
	if (!url || !t || !id) return null;
	return {
		id,
		url,
		title: str(raw.title),
		publishedUtc: str(raw.publishedUtc) || null,
		tier: t,
		publisher: str(raw.publisher) || id,
		kind: str(raw.kind) || 'news',
		hedge: str(raw.hedge) || null,
		excerpt: str(raw.excerpt).slice(0, EXCERPT_MAX),
		listed: raw.listedReport === true,
		confirmsAlone: raw.confirmsAlone !== false,
		urlWithheld: typeof raw.urlWithheld === 'string' && raw.urlWithheld.length > 0,
	};
};

const readIncident = (raw: unknown, where: string, warnings: string[]): RadarIncident | null => {
	if (!isRecord(raw)) {
		warnings.push(`${where}: not an object, skipped`);
		return null;
	}
	const id = str(raw.id);
	const title = str(raw.title);
	const protocol = str(raw.protocol);
	if (!id || !title || !protocol) {
		warnings.push(`${where}: missing id, title or protocol, skipped`);
		return null;
	}
	let status: Status = 'developing';
	if (raw.status === 'confirmed' || raw.status === 'developing') status = raw.status;
	else warnings.push(`${where} (${id}): unknown status ${JSON.stringify(raw.status)}, treated as developing`);
	const sources = (Array.isArray(raw.sources) ? raw.sources : []).map(readSource).filter((s): s is RadarSource => s !== null);
	if (sources.length === 0) {
		warnings.push(`${where} (${id}): no usable source, skipped`);
		return null;
	}
	const reportedLosses: RadarLoss[] = [];
	for (const loss of Array.isArray(raw.reportedLosses) ? raw.reportedLosses : []) {
		if (!isRecord(loss)) continue;
		const amountUsd = typeof loss.amountUsd === 'number' && Number.isFinite(loss.amountUsd) && loss.amountUsd > 0 ? loss.amountUsd : null;
		const url = webUrl(loss.url);
		const t = tier(loss.tier);
		if (amountUsd === null || !url || !t || !str(loss.by) || !str(loss.quote)) {
			warnings.push(`${where} (${id}): a reported loss without amount, source, link or quote was skipped`);
			continue;
		}
		reportedLosses.push({amountUsd, by: str(loss.by), url, quote: str(loss.quote), tier: t});
	}
	const facts: RadarFact[] = [];
	for (const fact of Array.isArray(raw.facts) ? raw.facts : []) {
		if (!isRecord(fact)) continue;
		const url = webUrl(fact.url);
		if (!url || !str(fact.text) || !str(fact.quote) || !str(fact.sourceId)) continue;
		facts.push({text: str(fact.text), sourceId: str(fact.sourceId), url, quote: str(fact.quote), field: str(fact.field)});
	}
	const score = isRecord(raw.score) && typeof raw.score.total === 'number' ? raw.score.total : null;
	const lane: Lane = raw.lane === 'ai' || raw.lane === 'both' ? raw.lane : 'crypto';
	return {
		id,
		title,
		protocol,
		subjectKnown: raw.subjectKnown === true || (raw.subjectKnown === undefined && lane === 'crypto'),
		lane,
		chains: strList(raw.chains),
		type: str(raw.type) || 'other',
		dateUtc: DATE.test(str(raw.dateUtc)) ? str(raw.dateUtc) : '',
		reportedLosses,
		status,
		statusReason: str(raw.statusReason),
		sources,
		evergreenTopic: str(raw.evergreenTopic) || null,
		notes: strList(raw.notes),
		mechanismKnown: raw.mechanismKnown === true,
		facts,
		score,
	};
};

export const checkRadar = (input: unknown): RadarRead => {
	const errors: string[] = [];
	const warnings: string[] = [];
	if (!isRecord(input)) return {radar: null, errors: ['the radar file must be a JSON object'], warnings};
	if (input.schema !== RADAR_SCHEMA) errors.push(`"schema" must be "${RADAR_SCHEMA}" (got ${JSON.stringify(input.schema)})`);
	const runDate = str(input.runDate);
	if (!DATE.test(runDate)) errors.push('"runDate" must be a YYYY-MM-DD date');
	if (!Array.isArray(input.top)) errors.push('"top" must be an array');
	if (errors.length > 0) return {radar: null, errors, warnings};
	const list = (key: 'top' | 'alsoSeen'): RadarIncident[] =>
		(Array.isArray(input[key]) ? (input[key] as unknown[]) : [])
			.map((raw, i) => readIncident(raw, `${key}[${i}]`, warnings))
			.filter((x): x is RadarIncident => x !== null);
	const corrections: RadarCorrection[] = [];
	for (const raw of Array.isArray(input.corrections) ? input.corrections : []) {
		if (!isRecord(raw) || !str(raw.incidentId) || !str(raw.protocol)) continue;
		corrections.push({incidentId: str(raw.incidentId), protocol: str(raw.protocol), previousRadarDate: str(raw.previousRadarDate), changes: strList(raw.changes)});
	}
	const sourceNames: Record<string, string> = {};
	for (const raw of Array.isArray(input.sources) ? input.sources : []) {
		if (isRecord(raw) && str(raw.id) && str(raw.name)) sourceNames[str(raw.id)] = str(raw.name);
	}
	return {
		radar: {runDate, generatedUtc: str(input.generatedUtc), mode: str(input.mode) || 'unknown', top: list('top'), alsoSeen: list('alsoSeen'), corrections, sourceNames},
		errors,
		warnings,
	};
};

export const readRadar = (file: string): RadarRead => {
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(file, 'utf8'));
	} catch (err) {
		return {radar: null, errors: [`cannot read ${file}: ${(err as Error).message}`], warnings: []};
	}
	return checkRadar(parsed);
};
