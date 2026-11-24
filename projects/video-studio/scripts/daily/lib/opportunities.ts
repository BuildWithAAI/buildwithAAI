/**
 * Analysis opportunities: what this video can add beyond the headline (owner rule: no daily video without real
 * analysis; news gate R7). Each returns the opportunity plus any extra sources and facts the brief needs so every
 * figure in the proposed analysis traces to a stored excerpt. Wording rules: figures are attributed ("as listed by
 * DefiLlama"), never averaged or summed, and nothing speculates.
 */
import type {RadarHistory, TrackerData, TrackerRow} from './history.ts';
import {defillamaKey} from './history.ts';
import type {BriefFact, BriefIncident, BriefSource, Opportunity, RadarIncident} from './types.ts';
import {daysBetween, shortDate, unique, usdExact} from './util.ts';

export type OppResult = {opp: Opportunity; sources: BriefSource[]; facts: BriefFact[]; entities: string[]; incidents: BriefIncident[]};

const ORDINAL = ['', 'largest', 'second-largest', 'third-largest'];

/**
 * A tracker label in running text: lower case, "&" spelled out. The news gate's name check (R4) reads capitalised
 * pairs such as "Frontend & Infrastructure" as a possible personal name, and a category is not a name anyway.
 */
export const label = (s: string): string => s.toLowerCase().replace(/\s*&\s*/g, ' and ');

const ordinal = (n: number): string => {
	const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
	return `${n}${s}`;
};

export const TRACKER_SOURCE_ID = 'defillama-30d';
const MAX_ROWS = 80;

const rowFactText = (r: TrackerRow): string =>
	`DefiLlama lists ${r.name}: ${r.date}, ${r.amountUsd ? `reported loss ${usdExact(r.amountUsd)}` : 'loss not stated'}${r.classification ? `, ${r.classification}${r.technique ? ` / ${r.technique}` : ''}` : ''}.`;

/**
 * Own-data comparison with DefiLlama's list for the 30 days to the run date: the incident's rank by DefiLlama's own
 * figure among the incidents with a stated loss, and how many share its classification.
 */
export const trackerComparison = (inc: RadarIncident, tracker: TrackerData, win: {from: string; to: string}): OppResult => {
	const base: Opportunity = {
		id: 'tracker-30d',
		kind: 'comparison',
		basis: 'own-data',
		strength: 'strong',
		available: false,
		title: `Rekt Meter: this incident against DefiLlama's list for ${shortDate(win.from)} to ${shortDate(win.to)}`,
		detail: null,
		method: null,
		sourceIds: [],
		factIds: [],
		why: '',
	};
	const empty = (why: string): OppResult => ({opp: {...base, why}, sources: [], facts: [], entities: [], incidents: []});
	if (!tracker.ok) return empty(tracker.reason);
	const key = defillamaKey(inc);
	if (!key) return empty('DefiLlama has no record of this incident in the radar file, so it cannot be ranked in DefiLlama\'s own list.');
	const inWindow = tracker.rows.filter((r) => r.date >= win.from && r.date <= win.to);
	const self = tracker.rows.find((r) => r.key === key);
	if (!self) return empty(`The incident's DefiLlama record (${key.slice('defillama:'.length)}) is not in the cached rows for ${win.from} to ${win.to}.`);
	if (inWindow.length < 5) return empty(`DefiLlama lists only ${inWindow.length} incident(s) from ${win.from} to ${win.to}; too few for a fair comparison.`);
	const inside = self.date >= win.from && self.date <= win.to;
	const pool = inside ? inWindow : [...inWindow, self];
	const withLoss = pool.filter((r) => r.amountUsd);
	const sameClass = self.classification ? pool.filter((r) => r.classification === self.classification) : [];
	const parts: string[] = [];
	const numbers: Record<string, number | string> = {incidentsListed: pool.length, withStatedLoss: withLoss.length};
	const range = `in the ${daysBetween(win.from, win.to) + 1} days from ${shortDate(win.from)} to ${shortDate(win.to)}`;
	// the incident's own name (the protocol), which DefiLlama's row name contains ("Binance" in "Binance CEX")
	const name = self.name.toLowerCase().includes(inc.protocol.toLowerCase()) ? inc.protocol : self.name;
	if (inside) parts.push(`DefiLlama lists ${pool.length} incidents ${range}.`);
	if (self.amountUsd) {
		const rank = 1 + withLoss.filter((r) => (r.amountUsd ?? 0) > (self.amountUsd ?? 0)).length;
		numbers.rankByDefiLlamaFigure = rank;
		if (inside) {
			const where = rank <= 3 ? `is the ${ORDINAL[rank]}` : `ranks ${ordinal(rank)}`;
			parts.push(`As listed by DefiLlama, ${name}'s ${usdExact(self.amountUsd)} loss ${where} of the ${withLoss.length} with a stated loss.`);
		} else {
			const others = withLoss.filter((r) => r !== self);
			const smaller = others.filter((r) => (r.amountUsd ?? 0) < (self.amountUsd ?? 0)).length;
			numbers.statedLossesInWindow = others.length;
			numbers.smallerThanThis = smaller;
			parts.push(
				smaller === others.length
					? `As listed by DefiLlama, ${name}'s ${usdExact(self.amountUsd)} loss (dated ${shortDate(self.date)}) is larger than every one of the ${others.length} stated losses it lists ${range}.`
					: `As listed by DefiLlama, ${name}'s ${usdExact(self.amountUsd)} loss (dated ${shortDate(self.date)}) is larger than ${smaller} of the ${others.length} stated losses it lists ${range}.`,
			);
		}
	} else parts.push(`DefiLlama states no loss figure for ${name}${inside ? '' : ` (dated ${shortDate(self.date)})`}.`);
	if (self.classification) {
		numbers.sameClassification = sameClass.length;
		parts.push(
			sameClass.length > 1
				? `${sameClass.length} of the ${pool.length} share its DefiLlama classification (${label(self.classification)}).`
				: `It is the only one of the ${pool.length} that DefiLlama classifies as ${label(self.classification)}.`,
		);
	}
	// keep the rows the analysis rests on: every row in the window (rank and counts need them all), capped
	const rows = pool.slice(0, MAX_ROWS);
	if (pool.length > MAX_ROWS && !rows.includes(self)) rows[rows.length - 1] = self;
	const source: BriefSource = {
		id: TRACKER_SOURCE_ID,
		feed: 'defillama-hacks',
		url: 'https://api.llama.fi/hacks',
		title: `DefiLlama hacks: incidents dated ${win.from} to ${win.to}`,
		publisher: 'DefiLlama',
		kind: 'tracker',
		tier: 'A',
		publishedAt: tracker.fetchedUtc,
		excerpts: rows.map((r) => r.head),
		note: `Structured rows only (name · date · loss · classification · target · chains), from the radar's cache fetched ${tracker.fetchedUtc}. ${pool.length > MAX_ROWS ? `${pool.length - MAX_ROWS} more rows exist; counts use all ${pool.length}.` : ''}`.trim(),
	};
	const facts: BriefFact[] = rows.map((r, i) => ({id: `t${i + 1}`, text: rowFactText(r), sourceIds: [TRACKER_SOURCE_ID], excerpts: [{sourceId: TRACKER_SOURCE_ID, text: r.head}], incidentId: TRACKER_SOURCE_ID, quote: r.head, kind: 'tracker-row'}));
	const selfFact = facts[rows.indexOf(self)];
	const method = [
		`Read the DefiLlama /hacks rows the radar cached at ${tracker.fetchedUtc} (source "${TRACKER_SOURCE_ID}" in brief.json, facts t1..t${rows.length}).`,
		`Kept the ${inWindow.length} rows dated ${win.from} to ${win.to}${inside ? '' : `, plus this incident's own row (${self.date})`}.`,
		self.amountUsd ? `Ranked the ${withLoss.length} rows with a stated loss by DefiLlama's own figure (one source, no averaging); this incident is number ${numbers.rankByDefiLlamaFigure}.` : 'This incident has no DefiLlama loss figure, so it is not ranked.',
		self.classification ? `Counted rows whose classification is "${self.classification}": ${sameClass.length}.` : '',
	]
		.filter(Boolean)
		.join(' ');
	return {
		opp: {...base, available: true, detail: parts.join(' '), method, sourceIds: [TRACKER_SOURCE_ID], factIds: unique([selfFact?.id ?? '', ...facts.filter((f, i) => rows[i].classification === self.classification).map((f) => f.id)].filter(Boolean)).slice(0, 12), numbers, why: `DefiLlama lists this incident and ${inWindow.length} incident(s) in the window.`},
		sources: [source],
		facts,
		entities: unique(rows.map((r) => r.name)),
		incidents: [{id: TRACKER_SOURCE_ID, name: 'DefiLlama hack list (30 days)', status: 'confirmed', date: win.to, role: 'comparison'}],
	};
};

/** Same-type incidents in the radar's own daily files for the window. Needs at least 7 daily files to mean anything. */
export const radarComparison = (inc: RadarIncident, hist: RadarHistory, minFiles = 7): OppResult => {
	const base: Opportunity = {
		id: 'radar-30d',
		kind: 'pattern',
		basis: 'own-data',
		strength: 'strong',
		available: false,
		title: `Pattern: ${inc.type} incidents on our radar, ${shortDate(hist.from)} to ${shortDate(hist.to)}`,
		detail: null,
		method: null,
		sourceIds: [],
		factIds: [],
		why: '',
	};
	if (hist.files.length < minFiles)
		return {opp: {...base, why: `The radar has ${hist.files.length} live daily file(s) from ${hist.from} to ${hist.to}; this comparison needs at least ${minFiles} (history builds up with every live run).`}, sources: [], facts: [], entities: [], incidents: []};
	const same = [...hist.incidents.values()].map((x) => x.incident).filter((x) => x.id !== inc.id && x.type === inc.type);
	// each counted incident must be citable: its DefiLlama or SlowMist classification fact, else its best-tier fact
	const sources: BriefSource[] = [];
	const facts: BriefFact[] = [];
	const incidents: BriefIncident[] = [];
	const cited: string[] = [];
	same.slice(0, 8).forEach((x, i) => {
		const fact = x.facts.find((f) => /classifies it as|attack method/.test(f.text)) ?? x.facts[0];
		const src = fact ? x.sources.find((s) => s.id === fact.sourceId && s.url === fact.url) : undefined;
		const stored = src ? (fact.field === 'title' ? src.title : src.excerpt ?? '') : '';
		if (!fact || !src || !stored.includes(fact.quote)) return;
		const id = `hist-${i + 1}`;
		sources.push({id, feed: src.id, url: src.url, title: src.title, publisher: src.publisher ?? src.id, kind: src.kind === 'structured' ? 'tracker' : 'news', tier: src.tier, publishedAt: src.publishedUtc ?? null, excerpt: stored});
		facts.push({id: `h${i + 1}`, text: `${x.protocol} (${x.dateUtc}): ${fact.text}`, sourceIds: [id], excerpts: [{sourceId: id, text: stored}], incidentId: x.id, quote: fact.quote, kind: 'radar-fact'});
		incidents.push({id: x.id, name: x.protocol, status: x.status, date: x.dateUtc, role: 'comparison'});
		cited.push(x.protocol);
	});
	const n = cited.length + 1;
	const label = inc.type.replace(/-/g, ' ');
	const detail =
		n === 1
			? `In ${hist.files.length} daily radar runs from ${shortDate(hist.from)} to ${shortDate(hist.to)}, ${inc.protocol} is the only ${label} incident our radar logged.`
			: `In ${hist.files.length} daily radar runs from ${shortDate(hist.from)} to ${shortDate(hist.to)}, our radar logged ${n} ${label} incidents: ${[inc.protocol, ...cited.slice(0, 3)].join(', ')}${n > 4 ? ' and others' : ''}.`;
	return {
		opp: {
			...base,
			available: true,
			detail,
			method: `Read the radar's live daily files for ${hist.from} to ${hist.to} (${hist.files.length} files), took the union of their shortlisted incidents (top and also-seen) and counted those the radar typed "${inc.type}" (${n}). Each counted incident is cited by its own classification fact (facts h1..h${facts.length}). The radar shortlists about 11 incidents a day, so this counts what the radar surfaced, not every incident.`,
			sourceIds: sources.map((s) => s.id),
			factIds: facts.map((f) => f.id),
			numbers: {incidents: n, radarFiles: hist.files.length},
			why: `${hist.files.length} radar files in the window.`,
		},
		sources,
		facts,
		entities: cited,
		incidents,
	};
};

/** Sources disagree on the loss: list each figure with its source (a supporting comparison, never an average). */
export const figuresComparison = (inc: RadarIncident, sourceIdFor: (feed: string, url: string) => string | undefined, publisherOf: (id: string) => string): OppResult => {
	const base: Opportunity = {id: 'figures', kind: 'comparison', basis: 'source', strength: 'supporting', available: false, title: 'Rekt Meter: what each source reports', detail: null, method: null, sourceIds: [], factIds: [], why: ''};
	// publisher -> its figures (at most 2), each with the source id and the words its excerpt uses
	const seen = new Map<string, Array<{id: string; quote: string; amount: number; tracker: boolean}>>();
	for (const l of inc.reportedLosses.filter((x) => x.tier !== 'C')) {
		const id = sourceIdFor(l.by, l.url);
		if (!id) continue;
		const pub = publisherOf(id);
		const list = seen.get(pub) ?? [];
		if (list.length < 2 && !list.some((v) => v.amount === l.amountUsd)) list.push({id, quote: l.quote.replace(/^reported loss\s+/i, ''), amount: l.amountUsd, tracker: l.by === 'defillama-hacks' || l.by === 'slowmist-hacked'});
		seen.set(pub, list);
	}
	const list = [...seen.entries()];
	if (list.length < 2) return {opp: {...base, why: 'Fewer than two tier-A/B sources state a loss figure.'}, sources: [], facts: [], entities: [], incidents: []};
	const all = list.flatMap(([, v]) => v);
	const distinct = unique(all.map((v) => v.amount)).length;
	const said = list.slice(0, 4).map(([pub, v]) => `${pub} ${v[0].tracker ? 'lists' : 'reports'} ${v.map((x) => x.quote).join(' and ')}`);
	const detail = `${distinct > 1 ? 'The sources do not agree on the loss' : 'The sources agree on the loss'}: ${said.join('; ')}. We quote each figure with its source and never average them.`;
	return {
		opp: {...base, available: true, detail, method: 'Listed the loss figures each tier-A/B source states in its stored excerpt or title (the radar\'s reportedLosses), at most two per publisher.', sourceIds: unique(list.slice(0, 4).flatMap(([, v]) => v.map((x) => x.id))), factIds: [], numbers: {sources: list.length, distinctFigures: distinct}, why: `${list.length} sources state a figure (${distinct} distinct).`},
		sources: [],
		facts: [],
		entities: [],
		incidents: [],
	};
};

/** A Solana fund-flow trace (api.mainnet-beta.solana.com, at most 4 requests a second) needs addresses a tier-A source published. */
export const fundFlowOpportunity = (inc: RadarIncident, dateSlug: string): OppResult => {
	const solana = inc.chains.some((c) => /^solana$/i.test(c.trim()));
	const tierA = inc.sources.filter((s) => s.tier === 'A');
	const base: Opportunity = {id: 'fund-flow', kind: 'fund-flow', basis: 'own-data', strength: 'strong', available: false, title: 'Fund flow on Solana (RPC trace)', detail: null, method: null, sourceIds: [], factIds: [], why: ''};
	if (!solana) return {opp: {...base, why: `Not a Solana incident (chains: ${inc.chains.join(', ') || 'none listed'}); the RPC trace covers Solana only.`}, sources: [], facts: [], entities: [], incidents: []};
	if (!tierA.length) return {opp: {...base, why: 'A Solana incident, but no tier-A source covers it, so no published addresses can be trusted.'}, sources: [], facts: [], entities: [], incidents: []};
	return {
		opp: {
			...base,
			why: `A Solana incident with tier-A coverage (${unique(tierA.map((s) => s.publisher ?? s.id)).join(', ')}), but the radar stores no addresses (it redacts them), so the trace waits for addresses that a tier-A source itself publishes.`,
			instructions: [
				`Open the tier-A source pages listed in this brief (allowed hosts only; never X or Telegram) and copy only addresses that the source itself labels as the exploiter's or as receiving the stolen funds.`,
				`Put them in data/private/daily/${dateSlug}/addresses.json (gitignored) as {"addresses": [{"address": "...", "label": "exploiter", "sourceUrl": "<the tier-A page>"}]}.`,
				'Trace with the Solana tooling in scripts/onchain (rpc.py paces api.mainnet-beta.solana.com, 4 requests a second at most): outgoing SOL and token transfers, at most 2 hops, aggregated per hop.',
				'Present only aggregates (hops, counts, totals per hop, programs reached), attributed as our own trace. Never show or say an address, and never name a holder.',
				'Add it to storyboard.analysis as {"kind": "fund-flow", "basis": "own-data", "method": "..."} and cite the tier-A source that published the addresses.',
			],
		},
		sources: [],
		facts: [],
		entities: [],
		incidents: [],
	};
};
