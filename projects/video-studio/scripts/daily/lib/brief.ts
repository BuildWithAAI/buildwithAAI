/**
 * brief.json for one daily episode: the facts the writer may use, each with its source id and the stored excerpt that
 * contains it, plus the status, the evergreen topic, the analysis opportunities and a must-not-say list. Pure.
 *
 * It follows the news gate's curated-brief shape (scripts/news/lib/brief.ts normalizeBrief): unique source ids (a
 * feed with two articles becomes coindesk, coindesk-2), facts {id, text, sourceIds, excerpts[{sourceId, text}],
 * incidentId}, incidents {id, name, status, date} and entities. A fact is kept only when its quote is literally in
 * the stored title or excerpt of its own article.
 */
import type {ChannelConfig} from './channel.ts';
import type {OppResult} from './opportunities.ts';
import type {BriefFact, BriefIncident, BriefSource, CandidateSummary, DailyBrief, MustNotSay, Opportunity, RadarFile, RadarIncident, RadarSource, Selection, SourceKind} from './types.ts';
import {isAiStory} from './types.ts';
import {subjectKnown} from './radar.ts';
import {clip, unique, usdExact} from './util.ts';

export const EXCERPT_MAX = 280;

export const ACCURACY_RULES = [
	'Every fact traces to a stored source excerpt that contains it.',
	'Loss amounts are "reported by X" and never averaged.',
	'Unconfirmed incidents are labelled "developing".',
	'No suspect or individual names, except officials named in law-enforcement or regulator releases.',
	'No exploit how-tos: mechanisms at concept level, with no code, function names or step lists.',
	'No price or investment talk.',
	"Don't redraw or speculate about others' material; attribute every fact.",
	'X/Twitter and Telegram were not read: never reconstruct or quote their content.',
];

const STATE_ACTOR = /\b(north korea(?:n)?|dprk|lazarus|tradertraitor|bluenoroff|apt ?38|kimsuky|andariel|famous chollima|contagious interview|state[- ]sponsored|nation[- ]state)\b/i;
const LEGAL = /\b(indict\w*|charg\w+|lawsuit|sued|plaintiff\w*|prosecutor\w*|forfeit\w*|seiz\w+|arrest\w*|court|freez\w+ order|allege\w*)\b/i;

export const kindOf = (s: RadarSource): SourceKind => {
	if (s.kind === 'structured' || s.listedReport) return 'tracker';
	if (s.kind === 'postmortem') return 'post-mortem';
	if (s.id === 'slowmist-hacked' || s.id === 'defillama-hacks') return 'tracker';
	if (s.kind === 'blog' || (s.tier === 'A' && /-blog$/.test(s.id))) return 'security-firm';
	return 'news';
};

export type SourceIndex = {
	sources: BriefSource[];
	idFor: (feed: string, url: string) => string | undefined;
	byId: Map<string, BriefSource>;
};

/** One brief source per article; ids are the feed id with -2, -3... for more articles from the same feed. */
export const indexSources = (inc: RadarIncident): SourceIndex => {
	const ids = new Map<string, string>();
	const used = new Set<string>();
	const sources: BriefSource[] = [];
	for (const s of inc.sources) {
		const key = `${s.id} ${s.url}`;
		if (ids.has(key)) continue;
		let id = s.id;
		for (let n = 2; used.has(id); n++) id = `${s.id}-${n}`;
		used.add(id);
		ids.set(key, id);
		const excerpt = typeof s.excerpt === 'string' && s.excerpt.trim() ? clip(s.excerpt.trim(), EXCERPT_MAX) : undefined;
		// the sentence that qualifies the mechanism ("remains under investigation") is stored on its own by the radar,
		// because it often lies past the first 280 characters: it goes in as a second excerpt, so the writer sees it and
		// the news gate's hedge rules (R6) read it
		const qualifier = typeof s.qualifier === 'string' && s.qualifier.trim() ? clip(s.qualifier.trim(), EXCERPT_MAX) : undefined;
		const extra = qualifier && !(excerpt ?? '').includes(qualifier) ? [qualifier] : [];
		sources.push({
			id,
			feed: s.id,
			url: s.url,
			title: clip(String(s.title ?? '').trim(), EXCERPT_MAX),
			publisher: s.publisher?.trim() || s.id,
			kind: kindOf(s),
			tier: s.tier === 'A' || s.tier === 'B' || s.tier === 'C' ? s.tier : 'C',
			publishedAt: s.publishedUtc ?? null,
			eventDate: s.eventDate ?? null,
			...(excerpt ? {excerpt} : {}),
			...(extra.length ? {excerpts: extra} : {}),
			...(s.hedge ? {hedge: s.hedge} : {}),
			...(s.tracker ? {tracker: true} : {}),
			...(s.unverified ? {unverified: true} : {}),
			...(s.listedReport ? {listedReport: true} : {}),
			...(s.redacted?.names ? {redactedNames: s.redacted.names} : {}),
			...(s.referenceUrl ? {note: `${s.referenceNote ?? 'Cited by the source; not fetched.'} (${s.referenceUrl})`} : {}),
		});
	}
	const byId = new Map(sources.map((s) => [s.id, s]));
	return {sources, idFor: (feed, url) => ids.get(`${feed} ${url}`), byId};
};

/** Radar facts whose quote is in the stored text of their own article, then every stored excerpt as a fact. */
export const buildFacts = (inc: RadarIncident, idx: SourceIndex): {facts: BriefFact[]; dropped: string[]} => {
	const facts: BriefFact[] = [];
	const dropped: string[] = [];
	let n = 0;
	for (const f of inc.facts) {
		const sid = idx.idFor(f.sourceId, f.url);
		const src = sid ? idx.byId.get(sid) : undefined;
		// the stored text the quote must be in: the title, the excerpt, or the mechanism's qualifying sentence
		const stored = !src ? '' : f.field === 'title' ? src.title : f.field === 'qualifier' ? ((src.excerpts ?? []).find((q) => q.includes(f.quote)) ?? '') : src.excerpt ?? '';
		if (!src || !stored || !stored.includes(f.quote)) {
			dropped.push(`"${clip(f.text, 80)}" (${f.sourceId}): its quote is not in the stored ${f.field}`);
			continue;
		}
		const text = /:\s*$/.test(f.text) ? `${f.text.trim()} "${f.quote}"` : f.text.trim();
		facts.push({id: `f${++n}`, text, sourceIds: [src.id], excerpts: [{sourceId: src.id, text: stored}], incidentId: inc.id, quote: f.quote, kind: 'radar-fact'});
	}
	idx.sources.forEach((s, i) => {
		// a listing is another outlet's text the radar never read: a lead, never a fact the script may use
		if (s.listedReport) return;
		if (s.excerpt) facts.push({id: `e${i + 1}`, text: s.excerpt, sourceIds: [s.id], excerpts: [{sourceId: s.id, text: s.excerpt}], incidentId: inc.id, quote: s.excerpt, kind: 'excerpt'});
		// the mechanism's qualifying sentence (see indexSources)
		(s.excerpts ?? []).forEach((q, k) => facts.push({id: `q${i + 1}${k ? `-${k + 1}` : ''}`, text: q, sourceIds: [s.id], excerpts: [{sourceId: s.id, text: q}], incidentId: inc.id, quote: q, kind: 'excerpt'}));
	});
	return {facts, dropped};
};

export const mustNotSayFor = (inc: RadarIncident, idx: SourceIndex, developing: boolean, groupWords: RegExp = STATE_ACTOR): MustNotSay[] => {
	const out: MustNotSay[] = [];
	const redacted = idx.sources.reduce((a, s) => a + (s.redactedNames ?? 0), 0);
	const named = idx.sources.some((s) => /\[named person\]/.test(`${s.title} ${s.excerpt ?? ''}`));
	out.push({
		rule: 'names',
		text: `No individual's name, handle, likeness or hint (suspects, victims, founders, investigators).${redacted || named ? ` The radar redacted ${redacted || 'some'} name(s) as "[named person]"; never fill them in or describe who they are.` : ''} Organisations, protocols and agencies are fine; an official only when a cited law-enforcement or regulator release names them.`,
	});
	const figures = unique(inc.reportedLosses.map((l) => l.amountUsd));
	if (figures.length > 1) {
		const list = inc.reportedLosses
			.map((l) => {
				const sid = idx.idFor(l.by, l.url);
				return `${(sid && idx.byId.get(sid)?.publisher) || l.by} ${l.quote}`;
			})
			.filter((v, i, a) => a.indexOf(v) === i)
			.slice(0, 6);
		out.push({rule: 'figures', text: `Sources state ${figures.length} different loss figures (${list.join('; ')}). Say each with its source; never average, merge or pick a "real" one.`});
	} else out.push({rule: 'figures', text: 'Every loss figure is "reported by" or "according to" its source, word for word or with an honest "about".'});
	for (const s of idx.sources.filter((x) => x.hedge))
		out.push({rule: 'hedge', text: `${s.publisher} hedges ("${s.hedge}") in "${clip(s.title, 90)}": repeat it only attributed and with the hedge, or leave it out. Never state it as fact.`});
	// a mechanism no source states as fact: the radar read the full text (not just the 280-character excerpt)
	if (inc.mechanismStatus === 'suspected' || inc.mechanismStatus === 'unknown') {
		const note = inc.mechanismNote;
		const sid = note ? idx.idFor(note.sourceId, note.url) : undefined;
		const who = (sid && idx.byId.get(sid)?.publisher) || note?.publisher || 'the sources';
		out.push({
			rule: 'hedge',
			text: `The mechanism is ${inc.mechanismStatus === 'suspected' ? 'only suspected' : 'not stated by any source'} (${who}${sid ? `, source ${sid}` : ''}). Never state it as fact, and never put it in a title, label or thumbnail. Say only what that source says, attributed and with its hedge, and label the mechanism developing.`,
		});
	}
	if (inc.userSide)
		out.push({rule: 'user-side', text: `The sources describe a user-side incident (a user's or trader's own key, device, API key or unofficial software), not a breach of ${inc.protocol}'s own systems. Never say ${inc.protocol} was hacked or breached; say whose keys or devices were affected, attributed.`});
	const unverified = idx.sources.filter((x) => x.unverified);
	if (unverified.length)
		out.push({rule: 'unverified', text: `${unique(unverified.map((x) => x.publisher)).join(', ')} cite${unverified.length === 1 ? 's' : ''} only a post on X that nobody here could read: never carry a claim on that entry alone.`});
	const allText = idx.sources.map((s) => `${s.title} ${s.excerpt ?? ''}`).join(' ');
	if (groupWords.test(allText))
		out.push({rule: 'attribution', text: 'A source links this to a state or threat group. Name the group only as "according to <source>" in the same sentence, never in a title, thumbnail or on its own. Do not add attributions the sources do not make.'});
	if (LEGAL.test(allText) || (inc.notes ?? []).some((n) => /legal matter/i.test(n)))
		out.push({rule: 'legal', text: 'Court, prosecution and freezing items are filings and allegations, not findings: "prosecutors say", "the filing says". Never "guilty", "stole" or "criminal" as our words.'});
	out.push({rule: 'how-to', text: 'No code, addresses, transaction hashes, function or contract names, payloads or step-by-step attack sequences, on screen or spoken. One or two concept-level sentences for the mechanism. Defensive checklists are fine.'});
	if (isAiStory(inc))
		out.push({
			rule: 'ai-how-to',
			text: 'AI story: never quote or paraphrase a prompt, an injected instruction, a jailbreak text, a malicious skill or plugin, a model file or a tool call, and never say which wording or setting got past a safeguard. Say what kind of attack it was and what it reached ("hidden instructions on a web page made the coding agent read secrets"), attributed to the vendor, researcher or outlet. Product names (Claude, Copilot, Gemini, ChatGPT...) are fine; researchers are described by role, never named.',
		});
	const listed = unique(idx.sources.filter((s) => s.listedReport).map((s) => s.publisher));
	if (listed.length)
		out.push({rule: 'listed-report', text: `${listed.join(', ')} only lists other outlets' reports (discovery only): its title and excerpt are the original outlet's words, not checked here. Never cite the listing, even next to another source; a claim, a figure, a name or a quote needs a tier-A or tier-B source in this brief that states it.`});
	out.push({rule: 'price', text: 'No prices, token moves, market talk, "buy/sell/hold", returns or income claims. "Price oracle" as a mechanism name is fine.'});
	out.push({rule: 'speculation', text: 'No "probably", "likely", "rumoured", "insiders say", "must have been", or question headlines about causes. Only what the sources confirm.'});
	out.push({rule: 'others-material', text: "No screenshots, redrawn charts, logos or images of other people's posts or dashboards. Describe the finding and attribute it."});
	const unreachable = idx.sources.filter((s) => s.note);
	if (unreachable.length) out.push({rule: 'unreachable', text: 'Some sources cite posts on X or Telegram. Those were not read: never quote, paraphrase or reconstruct them.'});
	const tierC = unique(idx.sources.filter((s) => s.tier === 'C').map((s) => s.publisher));
	if (tierC.length) out.push({rule: 'tier-c', text: `Aggregators (${tierC.join(', ')}) are never the only source of a figure, a name, a quote or the wording, even when co-cited: the tier-A or tier-B source you cite must state it.`});
	if (developing) out.push({rule: 'developing', text: 'Developing story: say "This is a developing story." before the first claim, put DEVELOPING in the first scene\'s title, the video title, the Short title and the thumbnails, and set news.developing.'});
	return out;
};

/** The source and sentence behind a suspected or unknown mechanism, with the brief's source id. */
const mechanismNote = (inc: RadarIncident, idx: SourceIndex): {sourceId: string; publisher: string; text: string} | null => {
	const n = inc.mechanismNote;
	if (!n || (inc.mechanismStatus !== 'suspected' && inc.mechanismStatus !== 'unknown')) return null;
	const sid = idx.idFor(n.sourceId, n.url);
	const src = sid ? idx.byId.get(sid) : undefined;
	return src ? {sourceId: src.id, publisher: src.publisher, text: clip(String(n.text ?? ''), EXCERPT_MAX)} : null;
};

export type BriefInput = {
	inc: RadarIncident;
	date: string;
	dateSlug: string;
	now: string;
	channel: ChannelConfig;
	radar: {file: RadarFile; path: string; sha256: string};
	selection: Selection;
	opportunities: OppResult[];
	history: DailyBrief['history'];
	otherProtocols: string[];
	groupWords?: RegExp;
	format?: 'daily-short' | 'what-we-know';
};

export const buildBrief = (b: BriefInput): DailyBrief => {
	const {inc} = b;
	const idx = indexSources(inc);
	const {facts, dropped} = buildFacts(inc, idx);
	const developing = inc.status !== 'confirmed';
	const sources: BriefSource[] = [...idx.sources];
	const incidents: BriefIncident[] = [{id: inc.id, name: inc.protocol, status: inc.status, date: inc.dateUtc, role: 'primary', ...(subjectKnown(inc) ? {} : {nameKnown: false})}];
	const entities = new Set<string>(b.otherProtocols.filter((p) => p && p !== inc.protocol && p !== 'Unknown subject'));
	const opps: Opportunity[] = [];
	for (const r of b.opportunities) {
		for (const s of r.sources) if (!sources.some((x) => x.id === s.id)) sources.push(s);
		for (const f of r.facts) if (!facts.some((x) => x.id === f.id)) facts.push(f);
		for (const i of r.incidents) if (!incidents.some((x) => x.id === i.id)) incidents.push(i);
		for (const e of r.entities) if (e !== inc.protocol) entities.add(e);
		opps.push(r.opp);
	}
	const topic = inc.evergreenTopic;
	const ev = topic ? b.channel.evergreen[topic] : undefined;
	const primary = b.selection.primary as CandidateSummary;
	const notes = [...(inc.notes ?? [])];
	if (dropped.length) notes.push(`Dropped ${dropped.length} radar fact(s) whose quote is not in the stored text: ${dropped.join('; ')}.`);
	if (b.selection.picked && !primary.eligible) notes.push(`Picked by hand although: ${primary.reasons.join('; ')}.`);
	return {
		version: 1,
		schema: 'zoora-security/daily-brief@1',
		channel: 'zoora-security',
		slug: b.dateSlug,
		date: b.date,
		generatedAt: b.now,
		status: developing ? 'developing' : 'confirmed',
		format: b.format ?? (developing ? 'what-we-know' : 'daily-short'),
		incident: {
			id: inc.id,
			title: inc.title,
			protocol: inc.protocol,
			type: inc.type,
			dateUtc: inc.dateUtc,
			chains: inc.chains,
			status: inc.status,
			statusReason: inc.statusReason ?? null,
			typeReason: inc.typeReason ?? null,
			mechanismKnown: inc.mechanismStatus ? inc.mechanismStatus === 'stated' : inc.mechanismKnown === true,
			mechanismStatus: inc.mechanismStatus ?? (inc.mechanismKnown === true ? 'stated' : 'unknown'),
			mechanismNote: mechanismNote(inc, idx),
			userSide: inc.userSide === true,
			dateNote: inc.dateNote ?? null,
			score: inc.score.total,
			scoreReasons: Object.fromEntries(Object.entries(inc.score.factors ?? {}).map(([k, v]) => [k, v.reason])),
			shortReady: inc.shortReady,
			postMortemUrl: inc.postMortemUrl ?? null,
			notes: inc.notes ?? [],
			lane: inc.lane ?? 'crypto',
		},
		evergreenTopic: topic,
		evergreen: topic ? {topic, title: ev?.title ?? topic, url: ev?.url ?? null, status: ev?.status ?? 'not in channel.json'} : null,
		incidents,
		sources,
		facts,
		reportedLosses: inc.reportedLosses.map((l) => {
			const sid = idx.idFor(l.by, l.url) ?? l.by;
			return {sourceId: sid, publisher: idx.byId.get(sid)?.publisher ?? l.by, amountUsd: l.amountUsd, quote: l.quote, tier: l.tier};
		}),
		entities: [...entities].sort().map((name) => ({name, kind: 'protocol' as const})),
		analysisOpportunities: opps,
		mustNotSay: mustNotSayFor(inc, idx, developing, b.groupWords),
		alternates: b.selection.alternates,
		selection: {policy: b.selection.policy, primary, considered: b.selection.considered, ...(b.selection.picked ? {picked: b.selection.picked} : {})},
		radar: {path: b.radar.path, sha256: b.radar.sha256, runDate: b.radar.file.runDate, generatedUtc: b.radar.file.generatedUtc, mode: b.radar.file.mode},
		history: b.history,
		rules: ACCURACY_RULES,
		notes,
	};
};

/** "$6,360,000,000 (DefiLlama)" lines for reports. */
export const lossLines = (brief: DailyBrief): string[] => brief.reportedLosses.map((l) => `${usdExact(l.amountUsd)} reported by ${l.publisher} ("${l.quote}", tier ${l.tier})`);
