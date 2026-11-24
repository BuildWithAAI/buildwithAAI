/**
 * prepare: run the radar, pick today's story (plus two alternates), and write
 *   content/zoora-security/<date>-<slug>/brief.json   the facts, sources, status, evergreen topic, analysis opportunities
 *   content/zoora-security/<date>-<slug>/WRITER.md    the writer's exact instructions
 *   out/daily/<date>/prepare.json and prepare.md      the decision, every candidate and why
 * Exit 0 = a brief is ready; 3 = no video today (nothing confirmed or no real analysis); 1 = error.
 */
import {existsSync} from 'node:fs';
import {buildBrief} from './brief.ts';
import {ChannelError, loadChannel, type ChannelConfig} from './channel.ts';
import type {Exec} from './exec.ts';
import {loadRadarHistory, loadTrackerRows, previousEpisodes, windowFor} from './history.ts';
import {figuresComparison, fundFlowOpportunity, radarComparison, trackerComparison, type OppResult} from './opportunities.ts';
import {channelPaths, dayPaths, episodePaths} from './paths.ts';
import {allCandidates, radarFilePath, readRadarFile, runRadar, type RadarMode} from './radar.ts';
import {COVERED_DAYS, dateSlugFor, selectCandidates} from './select.ts';
import {indexSources} from './brief.ts';
import type {DailyBrief, RadarIncident, Selection} from './types.ts';
import {addDays, isRecord, readJson, rel, todayIn, writeAtomic, writeJson} from './util.ts';
import {cell, renderWriterMd} from './writer.ts';
import {renderResearchMd} from './research.ts';

export type PrepareOptions = {
	root: string;
	date?: string;
	radar: RadarMode;
	pick?: string;
	format?: 'daily-short' | 'what-we-know';
	force?: boolean;
	exec: Exec;
	now?: () => Date;
	env?: NodeJS.ProcessEnv;
	log?: (line: string) => void;
};

export type PrepareResult = {exitCode: 0 | 1 | 3; date: string | null; dateSlug: string | null; selection: Selection | null; brief: DailyBrief | null; files: string[]; messages: string[]};

/** Opportunities for one candidate. */
export const opportunitiesFor = (inc: RadarIncident, ctx: {tracker: ReturnType<typeof loadTrackerRows>; history: ReturnType<typeof loadRadarHistory>; win: {from: string; to: string}; dateSlug: string}): OppResult[] => {
	const idx = indexSources(inc);
	return [
		trackerComparison(inc, ctx.tracker, ctx.win),
		radarComparison(inc, ctx.history),
		fundFlowOpportunity(inc, ctx.dateSlug),
		figuresComparison(inc, idx.idFor, (id) => idx.byId.get(id)?.publisher ?? id),
	];
};

/** Threat-group words from the news gate's allowlist (attributedGroups), plus state-actor words. */
const groupWordsFrom = (allowlistPath: string): RegExp | undefined => {
	const r = readJson(allowlistPath);
	if (!r.ok || !isRecord(r.data) || !Array.isArray(r.data.attributedGroups)) return undefined;
	const names = (r.data.attributedGroups as unknown[]).filter((x): x is string => typeof x === 'string' && x.length > 2);
	const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(`\\b(north korea(?:n)?|dprk|state[- ]sponsored|nation[- ]state|${names.map(esc).join('|')})\\b`, 'i');
};

const prepareMd = (date: string, sel: Selection, brief: DailyBrief | null, files: string[], radarNote: string): string => {
	const out: string[] = [];
	out.push(`# Daily prepare: ${date}`, '');
	out.push(sel.decision === 'video' && sel.primary ? `**Video today: ${sel.primary.dateSlug}** (${sel.primary.status}). ${sel.decisionReason}` : `**No video today.** ${sel.decisionReason}`, '');
	out.push(`Radar: ${radarNote}`, '');
	if (brief) {
		const strong = brief.analysisOpportunities.filter((o) => o.available && o.strength === 'strong');
		out.push(`Analysis available: ${strong.map((o) => `\`${o.id}\``).join(', ') || 'none'}.`, '');
		if (sel.alternates.length) out.push(`Alternates: ${sel.alternates.map((a) => `\`${a.incidentId}\``).join(', ')}.`, '');
	}
	out.push('| # | Incident | Status | Score | Eligible | Why not |', '| --- | --- | --- | --- | --- | --- |');
	for (const c of sel.considered) out.push(`| ${c.rank} | ${cell(c.title)} | ${c.status} | ${c.score} | ${c.eligible ? 'yes' : 'no'} | ${cell(c.reasons.join('; ') || '-')} |`);
	out.push('');
	if (files.length) out.push('Files:', '', ...files.map((f) => `- ${f}`), '');
	out.push('Policy:', '', ...sel.policy.map((p) => `- ${p}`), '');
	return out.join('\n');
};

export const runPrepare = (o: PrepareOptions): PrepareResult => {
	const log = o.log ?? (() => {});
	const messages: string[] = [];
	const say = (m: string) => {
		messages.push(m);
		log(m);
	};
	const fail = (m: string, date: string | null = null): PrepareResult => {
		say(m);
		return {exitCode: 1, date, dateSlug: null, selection: null, brief: null, files: [], messages};
	};
	const cp = channelPaths(o.root);
	let channel: ChannelConfig;
	try {
		channel = loadChannel(cp.channelJson);
	} catch (err) {
		return fail(err instanceof ChannelError ? err.message : String(err));
	}
	const now = o.now ? o.now() : new Date();
	const date = o.date ?? todayIn(channel.timezone, now);

	// 1. radar
	const radarPath = radarFilePath(cp.radarDir, cp.radarOfflineDir, date, o.radar);
	const run = runRadar({root: o.root, date, mode: o.radar, exec: o.exec, env: o.env});
	let radarNote = run.note;
	if (!run.ok) {
		if (o.radar === 'live' && existsSync(radarPath)) {
			radarNote = `${run.note} Using the radar file written earlier for ${date}.`;
			say(`warning: ${radarNote}`);
		} else return fail(`${run.note}${run.outputTail ? `\n${run.outputTail}` : ''}`, date);
	}
	const read = readRadarFile(radarPath, date, o.radar);
	if (!read.ok) return fail(read.error, date);
	for (const p of read.problems) say(`warning: ${p}`);

	// 2. history and analysis data
	const win = windowFor(date);
	const tracker = loadTrackerRows(cp.defillamaCache, win.from, win.to);
	const history = loadRadarHistory(o.radar === 'offline' ? cp.radarOfflineDir : cp.radarDir, win.from, win.to);
	const previous = previousEpisodes(cp.contentRoot, addDays(date, -COVERED_DAYS), date);
	const candidates = allCandidates(read.file);
	const oppCache = new Map<string, OppResult[]>();
	const oppsOf = (inc: RadarIncident) => {
		let r = oppCache.get(inc.id);
		if (!r) oppCache.set(inc.id, (r = opportunitiesFor(inc, {tracker, history, win, dateSlug: dateSlugFor(date, inc)})));
		return r;
	};

	// 3. selection
	const selection = selectCandidates(candidates, {
		date,
		previous,
		pick: o.pick,
		strongAnalysis: (inc) => {
			const rs = oppsOf(inc).map((x) => x.opp);
			return {available: rs.filter((x) => x.available && x.strength === 'strong').map((x) => x.id), why: rs.filter((x) => x.strength === 'strong' && !x.available).map((x) => `${x.id}: ${x.why}`)};
		},
	});
	const dp = dayPaths(o.root, date);
	if (selection.decision === 'no-video' || !selection.primary) {
		const files = [rel(o.root, dp.prepareJson), rel(o.root, dp.prepareMd)];
		writeJson(dp.prepareJson, {version: 1, date, decision: selection.decision, reason: selection.decisionReason, radar: {path: rel(o.root, radarPath), sha256: read.sha256, note: radarNote}, selection});
		writeAtomic(dp.prepareMd, prepareMd(date, selection, null, files, radarNote));
		say(`No video today: ${selection.decisionReason}`);
		return {exitCode: selection.picked ? 1 : 3, date, dateSlug: null, selection, brief: null, files, messages};
	}

	// 4. the brief
	const primary = selection.primary;
	const inc = candidates.find((c) => c.id === primary.incidentId) as RadarIncident;
	const ep = episodePaths(o.root, primary.dateSlug);
	if (existsSync(ep.storyboard) && !o.force) {
		const prev = readJson(ep.brief);
		const sameIncident = prev.ok && isRecord(prev.data) && isRecord(prev.data.incident) && prev.data.incident.id === inc.id;
		if (sameIncident)
			return fail(`${rel(o.root, ep.storyboard)} already exists for this story; brief.json was left as it is so the storyboard's fact ids stay valid. Pass --force to rebuild the brief from today's radar (then re-check the storyboard).`, date);
	}
	const brief = buildBrief({
		inc,
		date,
		dateSlug: primary.dateSlug,
		now: now.toISOString(),
		channel,
		radar: {file: read.file, path: rel(o.root, radarPath), sha256: read.sha256},
		selection,
		opportunities: oppsOf(inc),
		history: {
			radarFiles: history.files.length,
			radarFrom: win.from,
			radarTo: win.to,
			trackerRows: tracker.ok ? tracker.rows.length : 0,
			trackerFetchedUtc: tracker.ok ? tracker.fetchedUtc : null,
			previousEpisodes: previous.map((p) => ({slug: p.slug, incidentId: p.incidentId, approved: p.approved})),
			notes: [...(tracker.ok ? tracker.notes : [`Tracker comparison unavailable: ${tracker.reason}`])],
		},
		otherProtocols: candidates.map((c) => c.protocol),
		groupWords: groupWordsFrom(cp.newsAllowlist),
		format: o.format,
	});
	writeJson(ep.brief, brief);
	writeAtomic(ep.writer, renderWriterMd(brief, channel));
	writeAtomic(ep.research, renderResearchMd(brief));
	const files = [rel(o.root, ep.brief), rel(o.root, ep.writer), rel(o.root, ep.research), rel(o.root, dp.prepareJson), rel(o.root, dp.prepareMd)];
	writeJson(dp.prepareJson, {
		version: 1,
		date,
		decision: 'video',
		reason: selection.decisionReason,
		dateSlug: primary.dateSlug,
		radar: {path: rel(o.root, radarPath), sha256: read.sha256, note: radarNote},
		brief: rel(o.root, ep.brief),
		writer: rel(o.root, ep.writer),
		selection,
	});
	writeAtomic(dp.prepareMd, prepareMd(date, selection, brief, files, radarNote));
	say(`Brief ready: ${rel(o.root, ep.brief)} (${brief.status}, ${brief.facts.length} facts, ${brief.sources.length} sources).`);
	say(`Writer instructions: ${rel(o.root, ep.writer)}`);
	if (selection.alternates.length) say(`Alternates: ${selection.alternates.map((a) => a.incidentId).join(', ')}`);
	return {exitCode: 0, date, dateSlug: primary.dateSlug, selection, brief, files, messages};
};

