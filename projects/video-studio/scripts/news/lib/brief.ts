/**
 * brief.json: the facts the news radar selected for one episode. The radar (scripts/radar, another workflow) writes it;
 * this reader accepts the shape the task defines, each fact {id, text, sourceIds[], excerpts[]}, plus common variants
 * (excerpts as strings or {sourceId, text}; sources as an array or an id map; status words such as "unconfirmed").
 * Anything it cannot read is reported, and an unknown status counts as developing (fail closed).
 */
import type {Brief, BriefEntity, BriefExcerpt, BriefFact, BriefIncident, BriefMustNotSay, BriefOpportunity, BriefSource, SourceKind} from './types.ts';

export type BriefProblem = {level: 'error' | 'warning'; msg: string};

export const EXCERPT_MAX = 280;

/** Publisher names for the radar's hosts (and the reserved example hosts the fixtures use). */
export const HOST_PUBLISHERS: Record<string, string> = {
	'www.coindesk.com': 'CoinDesk',
	'coindesk.com': 'CoinDesk',
	'decrypt.co': 'Decrypt',
	'cointelegraph.com': 'Cointelegraph',
	'www.theblock.co': 'The Block',
	'theblock.co': 'The Block',
	'thedefiant.io': 'The Defiant',
	'www.chainalysis.com': 'Chainalysis',
	'www.web3isgoinggreat.com': 'Web3 Is Going Just Great',
	'web3isgoinggreat.com': 'Web3 Is Going Just Great',
	'rekt.news': 'Rekt',
	'hacked.slowmist.io': 'SlowMist',
	'www.dlnews.com': 'DL News',
	'www.trmlabs.com': 'TRM Labs',
	'www.certik.com': 'CertiK',
	'blockworks.co': 'Blockworks',
	'crypto.news': 'crypto.news',
	'coinedition.com': 'Coin Edition',
	'api.llama.fi': 'DefiLlama',
	'defillama.com': 'DefiLlama',
	'api.mainnet-beta.solana.com': 'Solana RPC',
};

const HOST_KINDS: Record<string, SourceKind> = {
	'www.chainalysis.com': 'security-firm',
	'www.trmlabs.com': 'security-firm',
	'www.certik.com': 'security-firm',
	'hacked.slowmist.io': 'tracker',
	'rekt.news': 'tracker',
	'api.llama.fi': 'tracker',
	'defillama.com': 'tracker',
	'www.web3isgoinggreat.com': 'tracker',
	'api.mainnet-beta.solana.com': 'on-chain',
};

const KINDS: SourceKind[] = ['news', 'security-firm', 'post-mortem', 'project', 'tracker', 'law-enforcement', 'regulator', 'court', 'on-chain', 'other'];
const KIND_ALIASES: Record<string, SourceKind> = {
	outlet: 'news',
	media: 'news',
	press: 'news',
	article: 'news',
	rss: 'news',
	feed: 'news',
	firm: 'security-firm',
	security: 'security-firm',
	'security-firm-alert': 'security-firm',
	alert: 'security-firm',
	postmortem: 'post-mortem',
	'post_mortem': 'post-mortem',
	victim: 'project',
	official: 'project',
	'project-statement': 'project',
	'hack-tracker': 'tracker',
	database: 'tracker',
	police: 'law-enforcement',
	'law_enforcement': 'law-enforcement',
	doj: 'law-enforcement',
	fbi: 'law-enforcement',
	regulatory: 'regulator',
	rpc: 'on-chain',
	onchain: 'on-chain',
	chain: 'on-chain',
};

export const hostOf = (url: string): string => {
	try {
		return new URL(url).host.toLowerCase();
	} catch {
		return '';
	}
};

export const publisherFor = (url: string, given?: unknown): string => {
	if (typeof given === 'string' && given.trim()) return given.trim();
	const host = hostOf(url);
	if (HOST_PUBLISHERS[host]) return HOST_PUBLISHERS[host];
	return host.replace(/^www\./, '');
};

const DEVELOPING_STATUS = new Set(['developing', 'unconfirmed', 'breaking', 'unverified', 'ongoing', 'preliminary', 'reported', 'early', 'live']);
const CONFIRMED_STATUS = new Set(['confirmed', 'verified', 'resolved', 'final', 'closed', 'official']);

/** true = developing, false = confirmed, undefined = not stated. Unknown words count as developing (fail closed). */
const statusOf = (o: Record<string, unknown>, problems: BriefProblem[], where: string): boolean | undefined => {
	if (o.developing === true || o.confirmed === false) return true;
	if (o.developing === false || o.confirmed === true) return false;
	const st = o.status;
	if (typeof st !== 'string' || !st.trim()) return undefined;
	const s = st.trim().toLowerCase();
	if (DEVELOPING_STATUS.has(s)) return true;
	if (CONFIRMED_STATUS.has(s)) return false;
	problems.push({level: 'warning', msg: `${where}: unknown status "${st}" treated as developing`});
	return true;
};

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter((x): x is string => !!x) : typeof v === 'string' && v.trim() ? [v.trim()] : []);

const RADAR_KINDS: Record<string, SourceKind> = {structured: 'tracker', postmortem: 'post-mortem', blog: 'security-firm', news: 'news'};

const isRadarIncident = (o: Record<string, unknown>): boolean =>
	typeof o.protocol === 'string' && Array.isArray(o.facts) && Array.isArray(o.sources) && (o.facts as unknown[]).every((f) => !!f && typeof f === 'object' && 'sourceId' in (f as object) && !('id' in (f as object)));

/**
 * The radar's own output (scripts/radar, schema "zoora-security/radar@1"): a daily file with top/alsoSeen incidents,
 * or one incident. Each incident has facts [{text, sourceId, url, quote, field}] and sources [{id, url, title, excerpt,
 * publishedUtc, publisher, kind}], where a source id is the radar FEED id (two CoinDesk articles share "coindesk"). This
 * turns one incident into a brief: unique source ids (coindesk, coindesk-2), fact ids f1..fn, and each fact's excerpt =
 * the stored excerpt (or title, for title facts) of its own article.
 */
export const briefFromRadar = (raw: Record<string, unknown>, incidentId: string | undefined, problems: BriefProblem[]): Record<string, unknown> | null => {
	let inc: Record<string, unknown> | undefined;
	let others: string[] = [];
	if (typeof raw.schema === 'string' && raw.schema.startsWith('zoora-security/radar') && (Array.isArray(raw.top) || Array.isArray(raw.alsoSeen))) {
		const all = [...((raw.top as unknown[]) ?? []), ...((raw.alsoSeen as unknown[]) ?? [])].filter((x): x is Record<string, unknown> => !!x && typeof x === 'object');
		// the other incidents' protocol names come from the radar's structured sources: organisations, not people
		others = all.map((x) => str(x.protocol)).filter((x): x is string => !!x && x !== 'Unknown subject');
		if (incidentId) inc = all.find((x) => x.id === incidentId);
		else if (all.length === 1) inc = all[0];
		if (!inc) {
			problems.push({level: 'error', msg: incidentId ? `radar file has no incident "${incidentId}" (it has: ${all.map((x) => String(x.id)).join(', ') || 'none'})` : `radar file holds ${all.length} incidents; pass --incident <id> (one of: ${all.map((x) => String(x.id)).join(', ')})`});
			return null;
		}
	} else if (isRadarIncident(raw)) inc = raw;
	else return raw;
	const sources = (Array.isArray(inc.sources) ? inc.sources : []) as Array<Record<string, unknown>>;
	const idFor = new Map<string, string>(); // `${sid} ${url}` -> unique id
	const used = new Set<string>();
	const outSources: Array<Record<string, unknown>> = [];
	for (const s of sources) {
		const sid = str(s.id) ?? 'source';
		const url = str(s.url) ?? '';
		const key = `${sid} ${url}`;
		if (idFor.has(key)) continue;
		let id = sid;
		for (let n = 2; used.has(id); n++) id = `${sid}-${n}`;
		used.add(id);
		idFor.set(key, id);
		const extra = Array.isArray(s.excerpts) ? (s.excerpts as unknown[]).filter((x): x is string => typeof x === 'string') : [];
		outSources.push({id, url, title: s.title, publisher: s.publisher, kind: RADAR_KINDS[String(s.kind)] ?? s.kind, publishedAt: str(s.publishedUtc) ?? str(s.eventDate), excerpt: s.excerpt, excerpts: extra, tier: s.tier, hedge: s.hedge, ...(s.listedReport === true ? {listedReport: true} : {})});
	}
	const facts = ((Array.isArray(inc.facts) ? inc.facts : []) as Array<Record<string, unknown>>).map((f, i) => {
		const id = idFor.get(`${str(f.sourceId) ?? ''} ${str(f.url) ?? ''}`) ?? str(f.sourceId) ?? '';
		const src = outSources.find((x) => x.id === id);
		const stored = f.field === 'title' ? str(src?.title) : str(src?.excerpt);
		return {id: `f${i + 1}`, text: f.text, sourceIds: [id], excerpts: [{sourceId: id, text: stored ?? str(f.quote) ?? ''}], incidentId: inc?.id};
	});
	// the radar stores one short excerpt per article but only turns titles and figures into facts; each stored excerpt is
	// also a fact the radar selected (ids e1..en), so a claim may state what an excerpt says
	outSources.forEach((s, i) => {
		const ex = str(s.excerpt);
		if (ex) facts.push({id: `e${i + 1}`, text: ex, sourceIds: [String(s.id)], excerpts: [{sourceId: String(s.id), text: ex}], incidentId: inc?.id});
	});
	// a structured tracker record starts with the protocol's name ("FixtureLend | 2026-10-02 | ...", "Binance CEX · ..."):
	// tracker databases list protocols and services, so those names are organisations, not people
	for (const s of outSources) {
		if (String(s.kind) !== 'tracker' && String(s.kind) !== 'structured') continue;
		const head = (str(s.excerpt) ?? '').split(/\s+[·|]\s+/)[0]?.trim() ?? '';
		if (head && head.length <= 60 && !/\[named person\]|\d{4}-\d{2}-\d{2}/i.test(head) && head !== inc.protocol) others.push(head);
	}
	problems.push({level: 'warning', msg: `read radar incident "${String(inc.id)}" directly (fact ids f1..f${facts.filter((f) => f.id.startsWith('f')).length}, excerpt facts e1..); a curated brief.json is preferred`});
	return {
		slug: raw.slug,
		generatedAt: raw.generatedUtc ?? raw.generatedAt,
		incidents: [{id: inc.id, name: inc.protocol, status: inc.status, date: inc.dateUtc}],
		sources: outSources,
		facts,
		entities: others.filter((n) => n !== inc?.protocol).map((name) => ({name, kind: 'protocol'})),
	};
};

export const normalizeBrief = (raw: unknown, opts: {incidentId?: string} = {}): {brief: Brief | null; problems: BriefProblem[]} => {
	const problems: BriefProblem[] = [];
	const e = (msg: string) => problems.push({level: 'error', msg});
	const w = (msg: string) => problems.push({level: 'warning', msg});
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		e('brief.json must be a JSON object');
		return {brief: null, problems};
	}
	const adapted = briefFromRadar(raw as Record<string, unknown>, opts.incidentId, problems);
	if (!adapted) return {brief: null, problems};
	const o = adapted;

	// sources: array or {id: record}
	const sources: BriefSource[] = [];
	const rawSources: Array<[string | undefined, Record<string, unknown>]> = Array.isArray(o.sources)
		? (o.sources as unknown[]).map((x) => [undefined, (x ?? {}) as Record<string, unknown>])
		: o.sources && typeof o.sources === 'object'
			? Object.entries(o.sources as Record<string, unknown>).map(([k, v]) => [k, (v ?? {}) as Record<string, unknown>])
			: [];
	rawSources.forEach(([key, r], i) => {
		const id = str(r.id) ?? key;
		const url = str(r.url) ?? str(r.link) ?? '';
		if (!id) {
			e(`sources[${i}] has no id`);
			return;
		}
		if (!/^https?:\/\//.test(url)) e(`source "${id}" has no http(s) url`);
		const kindRaw = (str(r.kind) ?? str(r.type) ?? str(r.category) ?? '').toLowerCase();
		const kind: SourceKind = (KINDS as string[]).includes(kindRaw) ? (kindRaw as SourceKind) : KIND_ALIASES[kindRaw] ?? HOST_KINDS[hostOf(url)] ?? (kindRaw ? 'other' : 'news');
		const excerpts = [...strList(r.excerpts), ...strList(r.excerpt), ...strList(r.quote), ...strList(r.snippet)].filter((v, k, a) => a.indexOf(v) === k);
		const tierRaw = str(r.tier)?.toUpperCase();
		const tier = tierRaw === 'A' || tierRaw === 'B' || tierRaw === 'C' ? tierRaw : undefined;
		if (tierRaw && !tier) w(`source "${id}" has an unknown tier "${String(r.tier)}"`);
		sources.push({
			id,
			url,
			title: str(r.title) ?? '',
			publisher: publisherFor(url, r.publisher ?? r.outlet ?? r.site ?? r.source),
			kind,
			publishedAt: str(r.publishedAt) ?? str(r.publishedUtc) ?? str(r.published) ?? str(r.date) ?? undefined,
			excerpts,
			...(tier ? {tier} : {}),
			...(str(r.hedge) ? {hedge: str(r.hedge)} : {}),
			...(r.listedReport === true ? {listedReport: true} : {}),
		});
	});
	const srcIds = new Set(sources.map((s) => s.id));
	if (sources.length !== srcIds.size) e('brief.sources has duplicate ids');

	// incidents
	const incidents: BriefIncident[] = [];
	if (o.incidents !== undefined && !Array.isArray(o.incidents)) e('brief.incidents must be an array');
	for (const [i, x] of (Array.isArray(o.incidents) ? (o.incidents as unknown[]) : []).entries()) {
		const r = (x ?? {}) as Record<string, unknown>;
		const id = str(r.id);
		const name = str(r.name) ?? str(r.protocol) ?? str(r.project) ?? str(r.title);
		if (!id) {
			e(`incidents[${i}] has no id`);
			continue;
		}
		const st = statusOf(r, problems, `incident "${id}"`);
		if (st === undefined) w(`incident "${id}" has no status; treated as developing until the radar marks it confirmed`);
		incidents.push({id, name: name ?? id, aliases: strList(r.aliases), developing: st ?? true, date: str(r.date), ...(r.nameKnown === false ? {nameKnown: false} : {})});
	}

	// facts
	const facts: BriefFact[] = [];
	if (!Array.isArray(o.facts)) e('brief.facts must be an array of {id, text, sourceIds[], excerpts[]}');
	const factIds = new Set<string>();
	for (const [i, x] of (Array.isArray(o.facts) ? (o.facts as unknown[]) : []).entries()) {
		const r = (x ?? {}) as Record<string, unknown>;
		const id = str(r.id);
		const text = str(r.text) ?? str(r.claim) ?? str(r.statement);
		const sourceIds = [...strList(r.sourceIds), ...strList(r.sources), ...strList(r.sourceId), ...strList(r.source)].filter((v, k, a) => a.indexOf(v) === k);
		if (!id) {
			e(`facts[${i}] has no id`);
			continue;
		}
		if (factIds.has(id)) e(`duplicate fact id "${id}"`);
		factIds.add(id);
		if (!text) e(`fact "${id}" has no text`);
		if (!sourceIds.length) e(`fact "${id}" has no sourceIds`);
		const excerpts: BriefExcerpt[] = [];
		const rawEx = Array.isArray(r.excerpts) ? (r.excerpts as unknown[]) : r.excerpt !== undefined ? [r.excerpt] : [];
		rawEx.forEach((ex, k) => {
			if (typeof ex === 'string') {
				if (!ex.trim()) return;
				// strings line up with sourceIds when the counts match; otherwise they belong to the fact as a whole
				const sid = rawEx.length === sourceIds.length ? sourceIds[k] : sourceIds.length === 1 ? sourceIds[0] : null;
				excerpts.push({sourceId: sid, text: ex.trim()});
			} else if (ex && typeof ex === 'object') {
				const er = ex as Record<string, unknown>;
				const t = str(er.text) ?? str(er.excerpt) ?? str(er.quote);
				const sid = str(er.sourceId) ?? str(er.source) ?? str(er.id) ?? (sourceIds.length === 1 ? sourceIds[0] : null);
				if (t) excerpts.push({sourceId: sid ?? null, text: t});
			}
		});
		if (!excerpts.length) w(`fact "${id}" has no excerpts; it cannot back a claim`);
		for (const ex of excerpts) if (ex.text.length > EXCERPT_MAX) w(`fact "${id}": an excerpt is ${ex.text.length} characters (policy: at most ${EXCERPT_MAX}; store short excerpts only)`);
		for (const sid of sourceIds) if (sources.length && !srcIds.has(sid)) w(`fact "${id}" cites "${sid}", which is not in brief.sources`);
		const incidentId = str(r.incidentId) ?? str(r.incident);
		const st = statusOf(r, problems, `fact "${id}"`);
		facts.push({id, text: text ?? '', sourceIds, excerpts, incidentId, developing: st ?? false});
	}
	for (const s of sources) for (const ex of s.excerpts) if (ex.length > EXCERPT_MAX) w(`source "${s.id}": an excerpt is ${ex.length} characters (policy: at most ${EXCERPT_MAX})`);

	const entities: BriefEntity[] = [];
	for (const x of Array.isArray(o.entities) ? (o.entities as unknown[]) : []) {
		const r = (x ?? {}) as Record<string, unknown>;
		const name = str(r.name);
		const kind = str(r.kind) ?? str(r.type) ?? 'other';
		if (name) entities.push({name, kind: (['org', 'protocol', 'person', 'official', 'place', 'other'].includes(kind) ? kind : 'other') as BriefEntity['kind']});
	}
	// the daily brief's analysis opportunities: the numbers each one computed (R7 checks own-data figures against them)
	const opportunities: BriefOpportunity[] = [];
	for (const x of Array.isArray(o.analysisOpportunities) ? (o.analysisOpportunities as unknown[]) : []) {
		const r = (x ?? {}) as Record<string, unknown>;
		const id = str(r.id);
		if (!id) continue;
		const nums = r.numbers && typeof r.numbers === 'object' && !Array.isArray(r.numbers) ? Object.values(r.numbers as Record<string, unknown>) : Array.isArray(r.numbers) ? (r.numbers as unknown[]) : [];
		opportunities.push({id, basis: str(r.basis) ?? 'own-data', available: r.available === true, numbers: nums.filter((n): n is number => typeof n === 'number' && Number.isFinite(n)), detail: str(r.detail)});
	}
	const mustNotSay: BriefMustNotSay[] = [];
	for (const x of Array.isArray(o.mustNotSay) ? (o.mustNotSay as unknown[]) : []) {
		const r = (x ?? {}) as Record<string, unknown>;
		if (str(r.rule) && str(r.text)) mustNotSay.push({rule: str(r.rule) as string, text: str(r.text) as string});
	}
	const developing = statusOf(o, problems, 'brief') ?? false;
	// the daily brief's own incident: its lane, or its AI how-to rule, makes this an AI-security story
	const lane = o.incident && typeof o.incident === 'object' ? str((o.incident as Record<string, unknown>).lane) : undefined;
	const aiStory = lane === 'ai' || lane === 'both' || mustNotSay.some((m) => m.rule === 'ai-how-to');
	const brief: Brief = {slug: str(o.slug), generatedAt: str(o.generatedAt), developing, incidents, facts, sources, entities, opportunities, mustNotSay, ...(aiStory ? {aiStory: true} : {})};
	return {brief: problems.some((p) => p.level === 'error') ? null : brief, problems};
};

/** Is a fact (or its incident, or the whole brief) developing? */
export const factDeveloping = (brief: Brief, f: BriefFact): boolean => {
	if (brief.developing || f.developing) return true;
	if (f.incidentId) {
		const inc = brief.incidents.find((i) => i.id === f.incidentId);
		if (inc) return inc.developing;
	}
	return false;
};
