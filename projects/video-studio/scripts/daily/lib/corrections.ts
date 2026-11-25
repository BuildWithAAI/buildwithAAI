/**
 * Correction candidates (owner rule: "label developing stories 'developing' and pin corrections").
 *
 * Every day, each episode the owner approved in the last 30 days is compared with today's radar view of the same
 * incident (same radar id, or the same protocol within 3 days: match.ts). What it compares is the brief the owner
 * approved against the radar now, so a change is found whichever day it happened on:
 *   - status: approved as confirmed, now developing (a source hedges or retracts)       -> correction
 *             approved as developing, now confirmed                                       -> update
 *   - type:   the radar now types the mechanism differently                              -> correction (update if
 *             the episode's brief had no type, "other")
 *   - mechanism: approved with a stated mechanism, now only suspected or unknown        -> correction
 *   - figures: a source the episode cited now states a different figure                 -> correction
 *              any other tier-A/B source states a figure the episode's brief did not have -> update
 * A correction is a blocker in the next approval packet ("PIN A CORRECTION") until corrections.json records it under
 * the candidate's key, which the ready-made `corrections.ts add --id <key>` command does. Updates are warnings.
 *
 * Feed text (publisher names, figures as written) appears in the drafts and commands as data: the command quotes it
 * for the shell, and `corrections.ts add` checks the text against the news rules before it records anything.
 */
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {sameIncident} from './match.ts';
import type {DailyBrief, RadarFile, RadarIncident, RadarSource} from './types.ts';
import {addDays, isRecord, parseDateSlug, readJson, sha256} from './util.ts';

export const CORRECTION_DAYS = 30;

export type CorrectionCandidate = {
	/** Stable across days: the ready-made command records the correction under this id. */
	key: string;
	slug: string;
	incidentId: string;
	/** correction: something the episode said may now be wrong (blocks the next packet). update: worth pinning. */
	severity: 'correction' | 'update';
	change: string;
	radarDate: string;
	sourceId: string;
	sourceUrl: string;
	publisher: string;
	/** A draft of the attributed corrected statement; read the source and edit it before running the command. */
	draft: string;
	command: string;
	recorded: boolean;
	pinned: boolean;
};

/** Single-quoted for a POSIX shell: feed text can hold quotes, $ or backticks, and none of it runs. */
export const shellQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

const typeWords = (t: string): string => t.replace(/-/g, ' ');
const figureWords = (quote: string): string => quote.replace(/^reported loss\s+/i, '').trim();
const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b), 1);

type Episode = {slug: string; date: string; brief: DailyBrief; cited: Set<string>};

/** Approved episodes from `from` to `to`, with their brief and the source ids their storyboard cites. */
export const approvedEpisodes = (contentRoot: string, from: string, to: string, exceptSlug?: string): Episode[] => {
	const out: Episode[] = [];
	if (!existsSync(contentRoot)) return out;
	for (const name of readdirSync(contentRoot).sort()) {
		const ds = parseDateSlug(name);
		if (!ds || name === exceptSlug || ds.date < from || ds.date > to) continue;
		const ap = readJson(join(contentRoot, name, 'approval.json'));
		if (!ap.ok || !isRecord(ap.data) || ap.data.decision !== 'approved') continue;
		const br = readJson<DailyBrief>(join(contentRoot, name, 'brief.json'));
		if (!br.ok || !isRecord(br.data) || br.data.schema !== 'zoora-security/daily-brief@1' || !isRecord(br.data.incident)) continue;
		const cited = new Set<string>();
		const sbPath = join(contentRoot, name, 'storyboard.json');
		if (existsSync(sbPath)) {
			const text = readFileSync(sbPath, 'utf8');
			for (const m of text.matchAll(/\[src:([^\]]+)\]/g)) for (const id of m[1].split(',')) cited.add(id.trim());
			for (const m of text.matchAll(/"source"\s*:\s*"([^"]+)"/g)) cited.add(m[1]);
		}
		out.push({slug: name, date: ds.date, brief: br.data, cited});
	}
	return out;
};

type CorrectionsIndex = Map<string, {status: string}>;

const readCorrections = (path: string): CorrectionsIndex => {
	const r = readJson(path);
	const out: CorrectionsIndex = new Map();
	if (!r.ok || !isRecord(r.data) || !Array.isArray(r.data.corrections)) return out;
	for (const c of r.data.corrections) if (isRecord(c) && typeof c.id === 'string') out.set(c.id, {status: String(c.status ?? 'pending')});
	return out;
};

const keyFor = (slug: string, detail: string): string => `cc-${slug}-${sha256(detail).slice(0, 8)}`;

/** The radar source behind a change: the given url, else a hedging one, else the first tier-A/B non-tracker one. */
const pickSource = (r: RadarIncident, pref: (s: RadarSource) => boolean): RadarSource | undefined =>
	r.sources.find(pref) ?? r.sources.find((s) => (s.tier === 'A' || s.tier === 'B') && !s.tracker) ?? r.sources[0];

/**
 * The radar's incident for an episode's brief: the same id first; else the one lane-compatible name match nearest in
 * date (never the first in rank order: a higher-ranked AI story that shares a word with a crypto episode is another
 * incident). Two equally near matches: none, the cautious direction (never compare two different incidents).
 */
export const radarMatch = (bi: DailyBrief['incident'], radarIncidents: readonly RadarIncident[]): RadarIncident | null => {
	const exact = radarIncidents.find((x) => x.id === bi.id);
	if (exact) return exact;
	const ref = {id: bi.id, protocol: bi.protocol, date: bi.dateUtc || null, lane: bi.lane ?? null, type: bi.type ?? null};
	const dateOf = (x: RadarIncident) => x.dateUtc || x.firstSeenUtc || null;
	const found = radarIncidents.filter((x) => sameIncident(ref, {id: x.id, protocol: x.protocol, date: dateOf(x), lane: x.lane ?? null, type: x.type ?? null}, {unknownDate: 'no-match'}));
	if (found.length <= 1) return found[0] ?? null;
	const gap = (x: RadarIncident) => Math.abs(Date.parse(`${dateOf(x)}T00:00:00Z`) - Date.parse(`${bi.dateUtc}T00:00:00Z`));
	const sorted = [...found].sort((x, y) => gap(x) - gap(y));
	return gap(sorted[0]!) === gap(sorted[1]!) ? null : sorted[0]!;
};

export const correctionCandidates = (o: {contentRoot: string; correctionsPath: string; radar: RadarFile; date: string; exceptSlug?: string; days?: number}): CorrectionCandidate[] => {
	const days = o.days ?? CORRECTION_DAYS;
	const recorded = readCorrections(o.correctionsPath);
	const radarIncidents = [...o.radar.top, ...o.radar.alsoSeen];
	const out: CorrectionCandidate[] = [];
	for (const ep of approvedEpisodes(o.contentRoot, addDays(o.date, -days), o.date, o.exceptSlug)) {
		const bi = ep.brief.incident;
		const r = radarMatch(bi, radarIncidents);
		if (!r) continue;
		const briefSources = ep.brief.sources ?? [];
		const add = (severity: CorrectionCandidate['severity'], detail: string, change: string, src: RadarSource | undefined, draft: string) => {
			if (!src) return;
			const known = briefSources.find((s) => s.url === src.url);
			const key = keyFor(ep.slug, detail);
			if (out.some((c) => c.key === key)) return;
			const publisher = known?.publisher ?? src.publisher ?? src.id;
			const sourceArgs = known ? ['--source', known.id] : ['--source', src.id, '--source-url', src.url, '--publisher', publisher];
			const command = ['node', 'scripts/news/corrections.ts', 'add', '--slug', ep.slug, '--id', key, '--incident', bi.id, ...sourceArgs, '--correct', draft].map((a, i) => (i < 3 ? a : shellQuote(a))).join(' ');
			const rec = recorded.get(key);
			out.push({key, slug: ep.slug, incidentId: bi.id, severity, change, radarDate: o.radar.runDate, sourceId: known?.id ?? src.id, sourceUrl: src.url, publisher, draft, command, recorded: !!rec, pinned: rec?.status === 'pinned'});
		};
		const name = r.protocol;
		// status
		if (bi.status === 'confirmed' && r.status === 'developing') {
			const src = pickSource(r, (s) => !!s.hedge);
			add('correction', 'status:confirmed->developing', `${ep.slug} called ${name} confirmed; the radar of ${o.radar.runDate} lists it as developing (${r.statusReason ?? 'no reason given'}).`, src, `Update: the ${name} incident is a developing story again${src?.hedge ? `: ${src.publisher ?? src.id} now hedges it ("${src.hedge}")` : ''}. Details may change.`);
		} else if (bi.status === 'developing' && r.status === 'confirmed') {
			const src = pickSource(r, (s) => !s.hedge && !s.tracker && (s.tier === 'A' || s.tier === 'B'));
			add('update', 'status:developing->confirmed', `${ep.slug} called ${name} developing; the radar of ${o.radar.runDate} lists it as confirmed (${r.statusReason ?? 'no reason given'}).`, src, `Update: ${src?.publisher ?? 'a source'} now reports the ${name} incident without a hedge, so it is no longer a developing story.`);
		}
		// type (the mechanism the episode described)
		if (bi.type && r.type && bi.type !== r.type && r.type !== 'other') {
			const src = pickSource(r, (s) => s.id === r.mechanismNote?.sourceId && s.url === r.mechanismNote?.url);
			add(bi.type === 'other' ? 'update' : 'correction', `type:${r.type}`, `${ep.slug} typed ${name} as ${typeWords(bi.type)}; the radar now types it as ${typeWords(r.type)}.`, src, `Update: according to ${src?.publisher ?? 'the sources'}, the ${name} incident was ${typeWords(r.type)}.`);
		}
		// a stated mechanism that is now only suspected or unknown
		const was = bi.mechanismStatus ?? (bi.mechanismKnown ? 'stated' : 'unknown');
		if (was === 'stated' && (r.mechanismStatus === 'suspected' || r.mechanismStatus === 'unknown')) {
			const src = pickSource(r, (s) => s.id === r.mechanismNote?.sourceId && s.url === r.mechanismNote?.url);
			add('correction', `mechanism:${r.mechanismStatus}`, `${ep.slug} treated the mechanism as stated; the radar now finds it ${r.mechanismStatus === 'suspected' ? 'only suspected' : 'not stated by any source'}${r.mechanismNote?.publisher ? ` (${r.mechanismNote.publisher})` : ''}.`, src, `Correction: the mechanism of the ${name} incident is not confirmed. ${src?.publisher ?? 'The sources'} describe${src?.publisher ? 's' : ''} it as ${r.mechanismStatus === 'suspected' ? 'suspected' : 'not yet known'}.`);
		}
		// figures
		const briefLosses = ep.brief.reportedLosses ?? [];
		for (const l of r.reportedLosses) {
			if (l.tier === 'C') continue;
			const known = briefSources.find((s) => s.url === l.url);
			const src = r.sources.find((s) => s.url === l.url) ?? ({id: l.by, url: l.url, title: '', tier: (l.tier as RadarSource['tier']) ?? 'B', publisher: l.by} as RadarSource);
			if (known) {
				const had = briefLosses.filter((x) => x.sourceId === known.id).map((x) => x.amountUsd);
				if (!had.length || had.some((a) => near(a, l.amountUsd, 0.005))) continue;
				const cited = ep.cited.has(known.id);
				add(cited ? 'correction' : 'update', `figure:${l.url}:${Math.round(l.amountUsd)}`, `${known.publisher} now states ${figureWords(l.quote)} for ${name}; the episode's brief had ${had.map((a) => `$${Math.round(a).toLocaleString('en-US')}`).join(' and ')} from it${cited ? ', and the episode cites it' : ''}.`, src, `Correction: ${known.publisher} now reports the ${name} loss as ${figureWords(l.quote)}.`);
			} else if (!briefLosses.some((x) => near(x.amountUsd, l.amountUsd, 0.05))) {
				add('update', `figure:${l.url}:${Math.round(l.amountUsd)}`, `${src.publisher ?? l.by} states ${figureWords(l.quote)} for ${name}, a figure the episode's brief did not have.`, src, `Update: ${src.publisher ?? l.by} reports the ${name} loss as ${figureWords(l.quote)}.`);
			}
		}
	}
	return out;
};

/** Packet lines: corrections not yet recorded are blockers; updates and recorded-but-unpinned ones are warnings. */
export const correctionLines = (cands: CorrectionCandidate[]): {blockers: string[]; warnings: string[]} => {
	const blockers: string[] = [];
	const warnings: string[] = [];
	for (const c of cands) {
		if (c.recorded && c.pinned) continue;
		if (c.recorded) warnings.push(`Correction ${c.key} for ${c.slug} is recorded but not pinned yet: pin it on that video (node scripts/news/corrections.ts pinned ${c.key}), then run mark-pinned ${c.key}.`);
		else if (c.severity === 'correction') blockers.push(`PIN A CORRECTION on ${c.slug}: ${c.change} Read the source, edit the draft if needed, run the command under "Corrections to pin", and pin the comment it prints.`);
		else warnings.push(`Update worth pinning on ${c.slug}: ${c.change} (command under "Corrections to pin").`);
	}
	return {blockers, warnings};
};
