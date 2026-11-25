/**
 * Builds the daily Threat Brief from the news radar: today's top incidents (status, reported losses credited to
 * the source that reported each one, a one-line concept-level "how it worked", sources), corrections from the
 * radar, Zoo's One Fix, the show link and why the reader gets the email.
 *
 * Accuracy rules (owner, 2026-11-24; video-studio/CLAUDE.md "Channel 2"):
 * - Every incident-specific line is built from a radar fact whose quote the radar checked against the stored source
 *   text, and names that source. Loss figures are shown as the source wrote them, each with "reported by <source>",
 *   and are never averaged or combined.
 * - Unconfirmed incidents are labelled DEVELOPING. "Confirmed" is re-checked here against every tier-A and tier-B
 *   title and stored excerpt: a source that hedges ("suspected", "apparent", ...) never counts as reporting it
 *   "without hedging", its hedge is quoted in the status line, and an incident with no unhedged confirmation left is
 *   shown as DEVELOPING whatever the radar said.
 * - Third-party headlines are quoted only when they pass the safety rules (no names, no how-to, no price talk);
 *   otherwise the link is labelled with the publisher and date only.
 * - The only unsourced text is fixed and reviewed (concepts.ts): category definitions, the One Fix and the footer. A
 *   definition is always shown as the source's category ("DefiLlama's category “Key Compromise” covers ..."), never
 *   as how the incident worked.
 */
import {conceptFor, fixFor, KIND_LABEL} from './concepts.ts';
import type {Radar, RadarIncident, RadarSource, Status, Tier} from './radar.ts';
import {extendAllow, hasErrors, isSafeQuote, quoteLine, scanText, type Finding, type NameAllow} from './safety.ts';

export const DEFAULT_BRAND = 'The Zoo & Badger Show';
export const DEFAULT_COUNT = 3;
export const MAX_COUNT = 5;
const MAX_LOSSES = 4;
const MAX_SOURCES = 4;

export type BriefLink = {text: string; url: string};
export type BriefLoss = {amount: string; amountUsd: number; publisher: string; url: string; tier: Tier};
/** One attributed sentence of "how it worked" and the source it links to. */
export type HowPart = {text: string; url: string | null};
/** `concept`: the definition of the classifying source's category, worded as that source's category (concepts.ts). */
export type BriefHow = {kind: 'classification' | 'headline' | 'unknown'; parts: HowPart[]; concept: string | null};

/**
 * A tier-A or tier-B source whose own words hedge: the hedge word and, when it is safe to quote, its phrase. `aboutIncident`
 * is true when the hedged sentence is about the incident itself (how it happened, the keys, the losses); only those
 * are quoted in the status line, but every hedge keeps its source from counting as "without hedging".
 */
export type BriefHedge = {publisher: string; tier: Tier; url: string; word: string; quote: string | null; aboutIncident: boolean};

/** The "how it worked" sentences as one plain line. */
export const howText = (how: BriefHow): string => how.parts.map((p) => p.text).join(' ');

export type BriefIncident = {
	id: string;
	name: string;
	protocol: string;
	status: Status;
	label: 'CONFIRMED' | 'DEVELOPING';
	statusLine: string;
	/** What the radar said; differs from `status` when every confirming source turned out to hedge. */
	radarStatus: Status;
	hedges: BriefHedge[];
	/** The incident date as a database states it ("per DefiLlama"), else the day the first linked source published. */
	date: {day: string; label: string} | null;
	chains: {list: string[]; by: string} | null;
	losses: BriefLoss[];
	lossNote: string | null;
	how: BriefHow;
	sources: BriefLink[];
};

export type ShowInfo = {title: string; url: string | null; developing: boolean; oneFix: string | null; slug: string | null};
export type FixInfo = {text: string; source: 'option' | 'show' | 'table'; topic: string | null};

export type ThreatBrief = {
	date: string;
	dateLabel: string;
	subject: string;
	preview: string;
	brandName: string;
	intro: string;
	incidents: BriefIncident[];
	corrections: string[];
	fix: FixInfo;
	show: ShowInfo | null;
	footer: string[];
	radar: {runDate: string; generatedUtc: string; mode: string; file: string | null};
	generatedAt: string;
};

export type BuildOptions = {
	allow: NameAllow;
	count?: number;
	show?: ShowInfo | null;
	fix?: string | null;
	brandName?: string;
	now: Date;
	radarFile?: string | null;
	/** Corrections already published for today's episode (pinned-comment texts); listed first. */
	showCorrections?: readonly string[];
};

/** The brief, notes for the CLI report, and the name allow set extended with today's names (for the lint). */
export type BuildResult = {brief: ThreatBrief; notes: string[]; allow: NameAllow};

// ---------------------------------------------------------------------------------------------
// Small helpers

const TIER_RANK: Record<Tier, number> = {A: 0, B: 1, C: 2};
const TYPE_LABEL: Record<string, string> = {
	exploit: 'exploit',
	phishing: 'phishing',
	drainer: 'wallet drainer',
	rug: 'rug pull',
	'key-compromise': 'key compromise',
	'social-engineering': 'social engineering',
	bridge: 'bridge exploit',
	oracle: 'oracle manipulation',
	governance: 'governance attack',
	other: 'other',
	'prompt-injection': 'prompt injection',
	'ai-agent-exploit': 'AI agent exploit',
	'malicious-ai-tool': 'malicious AI tool',
	'model-supply-chain': 'AI model supply-chain attack',
	'ai-data-exposure': 'data exposure through an AI tool',
	'ai-assisted-attack': 'AI-assisted attack',
	// the radar's labels say "fraud", an accusation the brief only prints with a named source: shown as these instead
	'deepfake-fraud': 'deepfake or voice-clone scam',
	'ai-phishing': 'AI-generated phishing',
	'ai-washing': 'AI-washing case',
};
/** The radar's own type labels in incident titles that read as an unattributed accusation, and the brief's wording. */
const RADAR_TITLE_LABELS: readonly [RegExp, string][] = [
	[/\bdeepfake or voice-clone fraud\b/g, 'deepfake or voice-clone scam'],
	[/\bAI-washing fraud\b/g, 'AI-washing case'],
];

const inLane = (incident: RadarIncident, lane: 'crypto' | 'ai'): boolean => incident.lane === lane || incident.lane === 'both';

/**
 * An incident a reader can be pointed to: at least one tier-A or tier-B source that is not an incident database's
 * listing of another outlet's report. Tier C and listings never carry a story alone (the radar's and the news gate's
 * rule), so only such an incident may take a forced place.
 */
export const standsAlone = (incident: RadarIncident): boolean => incident.sources.some((s) => s.tier !== 'C' && !s.listed);

/**
 * The incidents the brief shows: the radar's order (top, then also seen), but when the radar has incidents in both
 * lanes and the first `count` miss one lane, the last place goes to that lane's best incident that stands alone
 * (standsAlone), so an AI-security story never disappears behind crypto ones (or the other way round), while an
 * incident only an aggregator or a listing reports never displaces a better-sourced one. Each incident keeps its own
 * status.
 */
export const pickIncidents = (pool: readonly RadarIncident[], count: number): RadarIncident[] => {
	const picked = pool.slice(0, count);
	if (count < 2) return picked;
	for (const lane of ['ai', 'crypto'] as const) {
		if (picked.some((i) => inLane(i, lane))) continue;
		const best = pool.find((i) => inLane(i, lane) && standsAlone(i));
		// only one lane can be missing, so the last place never holds the other lane's only incident
		if (best) picked[picked.length - 1] = best;
	}
	return pool.filter((i) => picked.includes(i));
};

/**
 * Which picked incident is not one of the radar's first `count` (the lane-balance swap), and its lane: the preview
 * and intro then say so instead of calling every incident "the top N".
 */
export const laneSwap = (pool: readonly RadarIncident[], picked: readonly RadarIncident[], count: number): {added: RadarIncident; lane: 'ai' | 'crypto'; inTop: number} | null => {
	const added = picked.find((i) => pool.indexOf(i) >= count);
	if (!added) return null;
	const lane = (['ai', 'crypto'] as const).find((l) => inLane(added, l) && !pool.slice(0, count).some((i) => inLane(i, l))) ?? (added.lane === 'crypto' ? 'crypto' : 'ai');
	return {added, lane, inTop: picked.filter((i) => pool.indexOf(i) < count).length};
};

export const joinAnd = (items: readonly string[]): string =>
	items.length <= 2 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

/** "2026-11-24" -> "Nov 24, 2026" (calendar date, no time-zone shift). */
export const dateLabel = (date: string, withYear = true): string =>
	new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {month: 'short', day: 'numeric', ...(withYear ? {year: 'numeric'} : {}), timeZone: 'UTC'});

const MONEY_IN_QUOTE = /(?:US)?\$\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:[kKmMbB]n?|thousand|million|billion|trillion)\b)?/i;
const UNIT: Record<string, number> = {k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9, trillion: 1e12};

/** The money expression as the source wrote it ("$6.4 Billion" -> "$6.4 billion"), or null. */
export const moneyFromQuote = (quote: string): string | null => {
	const m = MONEY_IN_QUOTE.exec(quote);
	return m ? m[0].replace(/^US/, '').replace(/\s+/g, ' ').replace(/\b(Thousand|Million|Billion|Trillion)\b/, (u) => u.toLowerCase()) : null;
};

/** "$6.4 billion" -> 6.4e9, "$12.6M" -> 1.26e7, "$1,040,000" -> 1040000; null if unreadable. */
export const parseMoney = (display: string): number | null => {
	const m = /\$\s?(\d[\d,]*(?:\.\d+)?)\s?([a-z]+)?/i.exec(display);
	if (!m?.[1]) return null;
	const base = Number(m[1].replace(/,/g, ''));
	if (!Number.isFinite(base)) return null;
	const unit = m[2] ? UNIT[m[2].toLowerCase()] : 1;
	return unit === undefined ? null : base * unit;
};

const exactUsd = (amount: number): string => `$${Math.round(amount).toLocaleString('en-US')}`;

const isHttps = (url: string): boolean => url.startsWith('https://');

const shortDay = (iso: string | null): string | null => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : null);

// ---------------------------------------------------------------------------------------------
// Per incident

const publisherOf = (incident: RadarIncident, radar: Radar, sourceId: string, url?: string): string =>
	incident.sources.find((s) => s.id === sourceId && (!url || s.url === url))?.publisher ??
	incident.sources.find((s) => s.id === sourceId)?.publisher ??
	radar.sourceNames[sourceId] ??
	sourceId;

// ---------------------------------------------------------------------------------------------
// Status: re-checked against the hedges in every tier-A and tier-B text

/**
 * Hedge words: the radar's strong hedges (video-studio/scripts/radar/radarlib/safety.py) and a few more. The radar
 * looks for them in a structured source's lead only, so on 2026-11-24 it counted SlowMist as unhedged although its
 * stored text said "through a suspected compromise of the aggregate signing key". Here every tier-A and tier-B title
 * and stored excerpt is read.
 */
const HEDGE =
	/\b(?:suspect(?:ed|s)|apparent(?:ly)?|possibl[ey]|potential(?:ly)?|unconfirmed|unverified|(?:may|might|could) have|investigating|under investigation|appear(?:s|ed)? to|seem(?:s|ed)? to|rumou?r(?:s|ed)?|alleged(?:ly)?|reportedly|believed to|thought to|(?:un)?likely|unclear|anomal(?:y|ies|ous))\b/i;
/** A hedge phrase ends at the end of its clause, at a figure, or at a word that starts a new phrase. */
const PHRASE_BOUNDARY = /[,.;:!?()[\]{}“”"‘’…·|—–]|\s-\s/;
const PHRASE_STOP = new Set(
	'in on at to after before from with by as but and or nor while which that who whom whose when where for into during via amid following than unconfirmed unverified remains remain is was were are has have had says said'.split(' '),
);
const PHRASE_TRAILING = new Set('of the a an its their his her our this these those'.split(' '));
const HEDGE_PHRASE_WORDS = 8;
const MAX_HEDGES_SHOWN = 3;

/** The hedge and what it qualifies, never more than its clause: "suspected compromise of the aggregate signing key". */
export const hedgePhrase = (text: string, index: number, match: string): string => {
	const clause = text.slice(index + match.length).split(PHRASE_BOUNDARY)[0] ?? '';
	const words = [match];
	for (const word of clause.trim().split(/\s+/).filter(Boolean)) {
		if (/[\d$€£@#/\\]/.test(word) || PHRASE_STOP.has(word.toLowerCase())) break;
		words.push(word);
		if (words.length >= HEDGE_PHRASE_WORDS) break;
	}
	while (words.length > 1 && PHRASE_TRAILING.has((words[words.length - 1] ?? '').toLowerCase())) words.pop();
	return words.join(' ');
};

/** Words that show a hedged sentence is about the incident itself, beyond the mechanism words (MECHANISM below). */
const ABOUT_INCIDENT = /\b(?:loss(?:es)?|lost|funds?|unauthori[sz]ed|signing|signers?|validators?|vaults?|withdrawals?|transfers?|incident)\b/i;

/** The sentence (or " · " field of a structured excerpt) around a position. */
const sentenceAround = (text: string, index: number): string => {
	const starts = [text.lastIndexOf('. ', index), text.lastIndexOf(' · ', index)].map((i) => (i < 0 ? 0 : i + 2));
	const ends = [text.indexOf('. ', index), text.indexOf(' · ', index)].filter((i) => i >= 0);
	return text.slice(Math.max(...starts), ends.length > 0 ? Math.min(...ends) : text.length);
};

/** The first hedge in a text: the word, and the phrase quoted when it passes the safety rules (else the word alone). */
export const findHedge = (text: string, publisher: string, allow: NameAllow): {word: string; quote: string; aboutIncident: boolean} | null => {
	const m = HEDGE.exec(text);
	if (!m) return null;
	const phrase = hedgePhrase(text, m.index, m[0]);
	const sentence = sentenceAround(text, m.index);
	return {word: m[0].toLowerCase(), quote: isSafeQuote(phrase, publisher, allow) ? phrase : m[0], aboutIncident: MECHANISM.test(sentence) || ABOUT_INCIDENT.test(sentence)};
};

/** One hedge per publisher, tier A first: the excerpt (sentence case reads best), then the title, then the radar's flag. */
const hedgesOf = (incident: RadarIncident, allow: NameAllow): BriefHedge[] => {
	const out: BriefHedge[] = [];
	const sources = incident.sources.filter((s) => s.tier !== 'C').sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier]);
	for (const s of sources) {
		if (out.some((h) => h.publisher === s.publisher)) continue;
		const found = findHedge(s.excerpt, s.publisher, allow) ?? findHedge(s.title, s.publisher, allow);
		if (found) out.push({publisher: s.publisher, tier: s.tier, url: s.url, ...found});
		// the radar flagged a hedge the stored text no longer shows (the excerpt is cut): count it, and say so
		else if (s.hedge) out.push({publisher: s.publisher, tier: s.tier, url: s.url, word: s.hedge, quote: s.hedge, aboutIncident: true});
	}
	return out;
};

/** "Still hedged in the sources: “suspected key theft”, per The Defiant." (every quote attributed with "per"). */
export const hedgeSentence = (hedges: readonly BriefHedge[]): string => {
	const parts = hedges
		.filter((h) => h.aboutIncident)
		.slice(0, MAX_HEDGES_SHOWN)
		.map((h) => `“${h.quote ?? h.word}”, per ${h.publisher}`);
	return parts.length > 0 ? `Still hedged in the sources: ${parts.join('; ')}.` : '';
};

export const DEVELOPING_LINE = 'Developing: no primary source, and no two independent outlets, report it without hedging yet, so details may change.';

/**
 * The incident's status as the brief shows it. The radar's "confirmed" stands only when a tier-A source, or two
 * tier-B outlets, report it with no hedge anywhere in their stored titles and excerpts; those are the sources named.
 * Otherwise it is shown as developing (never the other way round: a radar "developing" always stays developing).
 */
const statusOf = (incident: RadarIncident, hedges: readonly BriefHedge[]): {status: Status; line: string} => {
	const hedged = new Set(hedges.map((h) => h.publisher));
	const counted = incident.sources.filter((s) => !s.listed && !hedged.has(s.publisher));
	// a single researcher's blog (confirmsAlone false) is one outlet's vote, like a tier-B outlet, never a primary
	const tierA = [...new Set(counted.filter((s) => s.tier === 'A' && s.confirmsAlone).map((s) => s.publisher))];
	const tierB = [...new Set(counted.filter((s) => s.tier === 'B' || (s.tier === 'A' && !s.confirmsAlone)).map((s) => s.publisher))];
	const confirmers = tierA.length > 0 ? tierA : tierB.length >= 2 ? tierB : [];
	const tail = hedgeSentence(hedges);
	if (incident.status === 'confirmed' && confirmers.length > 0) {
		return {status: 'confirmed', line: `Confirmed: ${joinAnd(confirmers)} ${confirmers.length === 1 ? 'reports' : 'report'} it without hedging.${tail ? ` ${tail}` : ''}`};
	}
	return {status: 'developing', line: `${DEVELOPING_LINE}${tail ? ` ${tail}` : ''}`};
};

const lossesOf = (incident: RadarIncident, radar: Radar, notes: string[]): {losses: BriefLoss[]; note: string | null} => {
	const rows = incident.reportedLosses
		.map((l, i) => ({l, i}))
		.sort((a, b) => TIER_RANK[a.l.tier] - TIER_RANK[b.l.tier] || a.i - b.i)
		.map(({l}) => l);
	const losses: BriefLoss[] = [];
	for (const l of rows) {
		if (incident.sources.some((s) => s.listed && s.id === l.by && s.url === l.url)) {
			// a listing repeats another outlet's report, which the radar never read: never a figure it reported
			notes.push(`${incident.id}: a figure from a listed report (${l.by}) was left out: read the original report`);
			continue;
		}
		if (!isHttps(l.url)) {
			notes.push(`${incident.id}: a figure from ${l.by} was left out because its link is not https`);
			continue;
		}
		const quoted = moneyFromQuote(l.quote);
		const value = quoted ? parseMoney(quoted) : null;
		// the shown figure must be the one the radar read: same number within 1%
		if (quoted && value !== null && Math.abs(value - l.amountUsd) > Math.max(0.5, l.amountUsd * 0.01)) {
			notes.push(`${incident.id}: the figure in "${l.quote}" (${l.by}) does not match ${l.amountUsd}; left out`);
			continue;
		}
		const publisher = publisherOf(incident, radar, l.by, l.url);
		if (losses.some((x) => x.publisher === publisher && Math.abs(x.amountUsd - l.amountUsd) < 0.5)) continue;
		losses.push({amount: quoted ?? exactUsd(l.amountUsd), amountUsd: l.amountUsd, publisher, url: l.url, tier: l.tier});
		if (losses.length >= MAX_LOSSES) break;
	}
	const distinct = new Set(losses.map((l) => Math.round(l.amountUsd)));
	return {losses, note: distinct.size > 1 ? 'Sources give different figures: each is listed with its source, and none is averaged.' : null};
};

const CLASSIFIES = /^(.{2,60}?) classifies it as (.+)\.$/;
const METHOD = /^(.{2,60}?) lists the attack method as (.+)\.$/;
const HEADLINE = /^(.{2,60}?) (headline|post-mortem), (\d{4}-\d{2}-\d{2}):$/;
const MECHANISM =
	/\b(?:hack(?:s|ed|ers?)?|exploit(?:s|ed)?|drain(?:s|ed|er|ers)?|phish(?:ing)?|malware|infect\w*|keys?|bridge|compromis\w*|attack(?:s|ed|ers?)?|stolen|theft|thieves|breach(?:ed|es)?|scam\w*|social engineering|fake|poison\w*|oracle|governance|leak(?:s|ed)?|vulnerab\w*|flaw\w*|bug|backdoor\w*|supply[- ]chain|injection|deepfake\w*|impersonat\w*|minted|unbacked|hijack\w*|jailbr\w*|exfiltrat\w*|expos(?:ed|es|ing|ure)|spill\w*|voice[- ]clon\w*|sleeper agents?|malicious)\b/i;

/** Words that show a headline supports the radar's incident type (the heading names that type). */
const TYPE_WORDS: Record<string, RegExp> = {
	'social-engineering': /\b(?:social engineering|fake (?:job|interview|recruiter|employment)|job interview|impersonat\w*|employment)\b/i,
	phishing: /\bphish\w*/i,
	drainer: /\bdrain(?:er|ers)?\b/i,
	'key-compromise': /\bkeys?\b/i,
	bridge: /\bbridge\b/i,
	oracle: /\boracle\b/i,
	rug: /\brug\w*/i,
	governance: /\bgovernance\b/i,
	exploit: /\b(?:exploit\w*|bug|flaw\w*|vulnerab\w*)\b/i,
};

const howItWorked = (incident: RadarIncident, allow: NameAllow): BriefHow => {
	const tierOf = (url: string): Tier => incident.sources.find((s) => s.url === url)?.tier ?? 'C';
	const clean = (text: string): boolean => !hasErrors(scanText(text, {where: 'how', allow}));
	const parts: HowPart[] = [];
	let concept: string | null = null;

	// 1. the structured classifications (DefiLlama class, SlowMist attack method), never from tier C
	const cls = incident.facts.find((f) => CLASSIFIES.exec(f.text)?.[2] === f.quote && tierOf(f.url) !== 'C');
	if (cls) {
		const by = CLASSIFIES.exec(cls.text)?.[1] ?? '';
		const line = `${by} classifies it as “${cls.quote}”.`;
		if (clean(line)) {
			parts.push({text: line, url: cls.url});
			// the source's category, defined; never "how this incident worked" (the sources can disagree with it)
			const def = conceptFor(cls.quote, by);
			concept = def && clean(def) ? def : null;
		}
	}
	const method = incident.facts.find((f) => {
		const m = METHOD.exec(f.text);
		return m?.[2] && f.quote.endsWith(m[2]) && !/^unknown$/i.test(m[2].trim()) && tierOf(f.url) !== 'C';
	});
	if (method) {
		const m = METHOD.exec(method.text);
		const label = m?.[2]?.trim() ?? '';
		const line = `${m?.[1] ?? ''} lists the attack method as “${label}”.`;
		const already = parts.map((p) => p.text).join(' ').toLowerCase();
		if (label && !already.includes(label.toLowerCase()) && clean(line)) parts.push({text: line, url: method.url});
	}

	// 2. a quoted headline: the one that supports the heading's type when the classification does not say it,
	//    or, with no classification at all, the first that names a mechanism (best tier first)
	const typeWords = TYPE_WORDS[incident.type];
	const covered = typeWords ? typeWords.test(parts.map((p) => p.text).join(' ')) : true;
	if (parts.length === 0 || !covered) {
		const headlines = incident.facts
			.map((f, i) => ({f, i, m: HEADLINE.exec(f.text)}))
			.filter((x) => x.m && x.f.field === 'title' && !/\s-\s*rekt\s*$/i.test(x.f.quote))
			.filter((x) => (parts.length > 0 && typeWords ? typeWords.test(x.f.quote) && tierOf(x.f.url) !== 'C' : MECHANISM.test(x.f.quote)))
			.sort((a, b) => TIER_RANK[tierOf(a.f.url)] - TIER_RANK[tierOf(b.f.url)] || a.i - b.i);
		for (const {f, m} of headlines) {
			const who = m?.[1] ?? '';
			const line = `${who} ${m?.[2] === 'post-mortem' ? 'post-mortem' : 'reports'}: “${f.quote}”.`;
			if (isSafeQuote(f.quote, who, allow) && clean(line)) {
				parts.push({text: line, url: f.url});
				break;
			}
		}
	}
	if (parts.length > 0) return {kind: cls || method ? 'classification' : 'headline', parts, concept};
	return {kind: 'unknown', parts: [{text: 'The sources have not described how it happened yet.', url: null}], concept: null};
};

const ROUNDUP = /\/newsletters?\/|\band more\b/i;

const sourcesOf = (incident: RadarIncident, allow: NameAllow): BriefLink[] => {
	// listings are discovery only: their title is another outlet's headline and their link that outlet's article, so
	// crediting either to the database would misattribute it
	const usable = incident.sources.filter((s) => !s.listed && isHttps(s.url) && !ROUNDUP.test(s.url) && !ROUNDUP.test(s.title));
	const byPublisher = new Map<string, RadarSource>();
	const better = (a: RadarSource, b: RadarSource): boolean => {
		if (TIER_RANK[a.tier] !== TIER_RANK[b.tier]) return TIER_RANK[a.tier] < TIER_RANK[b.tier];
		if ((a.kind === 'postmortem') !== (b.kind === 'postmortem')) return a.kind === 'postmortem';
		// primary sources: the first report; news: the latest coverage
		const ta = a.publishedUtc ?? '';
		const tb = b.publishedUtc ?? '';
		return a.tier === 'A' ? ta < tb : ta > tb;
	};
	for (const s of usable) {
		const current = byPublisher.get(s.publisher);
		if (!current || better(s, current)) byPublisher.set(s.publisher, s);
	}
	const order = [...byPublisher.values()].sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier]);
	return order.slice(0, MAX_SOURCES).map((s) => {
		const day = shortDay(s.publishedUtc);
		const plainLabel = `${s.publisher} ${KIND_LABEL[s.kind] ?? 'article'}${day ? `, ${day}` : ''}`;
		// the article's link spells a person's name: only the outlet's address is kept, so the label says so
		if (s.urlWithheld) return {text: `${plainLabel} (the link goes to the outlet: the article's address names a person)`, url: s.url};
		if (s.title && s.title.toLowerCase().startsWith(s.publisher.toLowerCase()) && !hasErrors(scanText(s.title, {where: 'source', allow}))) return {text: s.title, url: s.url};
		return {text: s.title && isSafeQuote(s.title, s.publisher, allow) ? quoteLine(s.publisher, s.title) : plainLabel, url: s.url};
	});
};

const chainsOf = (incident: RadarIncident): BriefIncident['chains'] => {
	const fact = incident.facts.find((f) => /^(.{2,60}?) lists the chains as (.+)\.$/.test(f.text) && f.quote.startsWith('chains: '));
	if (!fact) return null;
	const by = /^(.{2,60}?) lists the chains as/.exec(fact.text)?.[1] ?? '';
	const list = fact.quote.slice('chains: '.length).split(/,\s*/).filter(Boolean);
	return by && list.length > 0 ? {list, by} : null;
};

const dateOf = (incident: RadarIncident): BriefIncident['date'] => {
	const tierOf = (url: string): Tier => incident.sources.find((s) => s.url === url)?.tier ?? 'C';
	for (const f of incident.facts) {
		const m = /^(.{2,60}?) dates it (\d{4}-\d{2}-\d{2})\.$/.exec(f.text);
		if (m?.[1] && m[2] && f.quote === m[2] && tierOf(f.url) !== 'C') return {day: m[2], label: `When (per ${m[1]})`};
	}
	// never a listing's date (when a database added another outlet's report) or a tier-C aggregator's timestamp
	const days = incident.sources
		.filter((s) => s.url.startsWith('https://') && s.publishedUtc && !s.listed && s.tier !== 'C')
		.map((s) => shortDay(s.publishedUtc))
		.filter((d): d is string => d !== null)
		.sort();
	return days[0] ? {day: days[0], label: 'First reported'} : null;
};

/**
 * How the brief names an incident: the radar's title without "(developing)" and with the brief's type wording. An
 * AI-lane incident whose subject the radar only read from a headline's shape (subjectKnown false) is named by its type
 * and its first outlet instead: that word could be a person or a handle, so it never reaches the email or the
 * subject line.
 */
const incidentName = (incident: RadarIncident): string => {
	if (!incident.subjectKnown && incident.lane !== 'crypto') {
		const outlet = incident.sources.find((s) => !s.listed)?.publisher ?? incident.sources[0]?.publisher ?? 'the radar';
		return `${TYPE_LABEL[incident.type] ?? 'AI-security incident'}, reported by ${outlet}`;
	}
	let name = incident.title.replace(/\s*\(developing\)\s*$/i, '').trim();
	for (const [re, label] of RADAR_TITLE_LABELS) name = name.replace(re, label);
	return name;
};
const shortName = (incident: RadarIncident): string =>
	!incident.subjectKnown && incident.lane !== 'crypto' ? (TYPE_LABEL[incident.type] ?? 'AI-security incident') : incident.protocol;

// ---------------------------------------------------------------------------------------------
// Corrections from the radar ("Changed since the <date> radar")

const parseChange = (change: string, nameOf: (id: string) => string): string | null => {
	const money = (list: string): string => list.split(/,\s(?=\d)/).map((n) => `$${n}`).join(' and ');
	let m = /^status (\w+) -> (\w+)$/.exec(change);
	if (m) return `status changed from ${m[1]} to ${m[2]}`;
	m = /^type ([\w-]+) -> ([\w-]+)$/.exec(change);
	if (m?.[1] && m[2]) return `type changed from ${TYPE_LABEL[m[1]] ?? m[1]} to ${TYPE_LABEL[m[2]] ?? m[2]}`;
	m = /^(\S+) now states ([\d,]+(?:, [\d,]+)*) USD \(previously ([\d,]+(?:, [\d,]+)*) USD\)$/.exec(change);
	if (m?.[1] && m[2] && m[3]) return `${nameOf(m[1])} now states ${money(m[2])} (previously ${money(m[3])})`;
	m = /^new figure from (\S+): ([\d,]+(?:, [\d,]+)*) USD$/.exec(change);
	if (m?.[1] && m[2]) return `${nameOf(m[1])} now states ${money(m[2])}`;
	return null;
};

// ---------------------------------------------------------------------------------------------
// The brief

const footerLines = (brandName: string): string[] => [
	`You're getting the Threat Brief because you subscribed to it from ${brandName}. Every email has an unsubscribe link at the bottom.`,
	`${brandName} never DMs you first and never asks for a recovery phrase, a private key or a wallet connection. Anyone who does is an impersonator.`,
	'News and education only. Not financial advice. Every figure links to the source that reported it.',
];

export const buildBrief = (radar: Radar, options: BuildOptions): BuildResult => {
	const notes: string[] = [];
	const brandName = (options.brandName ?? DEFAULT_BRAND).trim() || DEFAULT_BRAND;
	const count = Math.min(MAX_COUNT, Math.max(1, Math.floor(options.count ?? DEFAULT_COUNT)));

	// names the brief may use: everything the radar reports on today, except a subject read only from a headline's
	// shape (it could be a person or a handle) and incidents only an incident database lists (leads, never stories)
	const pool: RadarIncident[] = [];
	for (const incident of [...radar.top, ...radar.alsoSeen]) {
		if (pool.some((x) => x.id === incident.id)) continue;
		if (incident.sources.every((s) => s.listed)) {
			notes.push(`${incident.id}: only an incident database lists it (discovery only), so the brief leaves it out`);
			continue;
		}
		pool.push(incident);
	}
	const known = pool.filter((i) => i.subjectKnown || i.lane === 'crypto');
	const alsoKnownAs = known.flatMap((i) => i.notes.flatMap((n) => /^Also reported as: (.+)\.$/.exec(n)?.[1]?.split(/,\s*/) ?? []));
	const allow = extendAllow(options.allow, [
		...known.flatMap((i) => [i.protocol, incidentName(i)]),
		...pool.flatMap((i) => [...i.chains, ...i.sources.map((s) => s.publisher)]),
		...alsoKnownAs,
		...Object.values(radar.sourceNames),
		brandName,
	]);

	const picked = pickIncidents(pool, count);
	const swap = laneSwap(pool, picked, count);
	const laneLabel = swap?.lane === 'ai' ? 'AI-security' : 'crypto-security';
	if (swap) notes.push(`${swap.added.id}: #${pool.indexOf(swap.added) + 1} on the radar, shown as the radar's top ${laneLabel} incident in place of #${count}`);
	const incidents: BriefIncident[] = picked.map((incident) => {
		const {losses, note} = lossesOf(incident, radar, notes);
		const how = howItWorked(incident, allow);
		const sources = sourcesOf(incident, allow);
		if (sources.length === 0) notes.push(`${incident.id}: no https source could be linked`);
		const hedges = hedgesOf(incident, allow);
		const status = statusOf(incident, hedges);
		if (status.status !== incident.status) {
			notes.push(`${incident.id}: the radar marks it confirmed, but every tier-A and tier-B source hedges (${hedges.map((h) => `${h.publisher}: "${h.word}"`).join(', ')}), so the brief labels it DEVELOPING`);
		}
		for (const h of hedges.filter((x) => !x.aboutIncident)) {
			notes.push(`${incident.id}: ${h.publisher} hedges something other than the incident itself ("${h.quote ?? h.word}"): not quoted, but ${h.publisher} does not count as reporting it without hedging`);
		}
		return {
			id: incident.id,
			name: incidentName(incident),
			protocol: shortName(incident),
			status: status.status,
			radarStatus: incident.status,
			hedges,
			label: status.status === 'confirmed' ? 'CONFIRMED' : 'DEVELOPING',
			statusLine: status.line,
			date: dateOf(incident),
			chains: chainsOf(incident),
			losses,
			lossNote: note,
			how,
			sources,
		};
	});
	if (incidents.length === 0) notes.push('the radar lists no incident today');
	if (incidents.length < count) notes.push(`the radar has ${incidents.length} incident(s), fewer than the ${count} asked for`);

	const nameOf = (id: string): string => pool.flatMap((i) => i.sources).find((s) => s.id === id)?.publisher ?? radar.sourceNames[id] ?? id;
	const corrections: string[] = [...(options.showCorrections ?? []).map((c) => c.replace(/\s+/g, ' ').trim()).filter(Boolean)];
	for (const c of radar.corrections) {
		const parsed = c.changes.map((ch) => parseChange(ch, nameOf));
		const unreadable = c.changes.filter((_, i) => parsed[i] === null);
		if (unreadable.length > 0) notes.push(`${c.incidentId}: correction text not understood, left out: ${unreadable.join('; ')}`);
		const ok = parsed.filter((x): x is string => x !== null);
		if (ok.length > 0) corrections.push(`${c.protocol}: ${ok.join('; ')} (since the ${c.previousRadarDate ? dateLabel(c.previousRadarDate) : 'previous'} radar).`);
	}

	// Zoo's One Fix: the owner's text, else the show's, else the table for the top incident's topic
	const top = pool[0];
	const tableFix = fixFor(top?.evergreenTopic ?? null, top?.type ?? null);
	let fix: FixInfo = {text: tableFix.text, source: 'table', topic: tableFix.topic};
	const showFix = options.show?.oneFix?.trim() || null;
	if (options.fix?.trim()) {
		fix = {text: options.fix.trim(), source: 'option', topic: null};
	} else if (showFix) {
		const problems = scanText(showFix, {where: "the show's One Fix", allow});
		if (hasErrors(problems)) notes.push(`the show's One Fix breaks a safety rule, so the brief uses the fix for "${tableFix.topic ?? 'general'}" instead`);
		else fix = {text: showFix, source: 'show', topic: null};
	}

	const shortNames = incidents.map((i) => i.protocol);
	const developingCount = incidents.filter((i) => i.status === 'developing').length;
	let subject = `Threat Brief, ${dateLabel(radar.runDate, false)}: ${shortNames.join(', ') || 'no new incidents'}`;
	if (subject.length > 90) subject = `Threat Brief, ${dateLabel(radar.runDate, false)}: ${incidents.length} incidents`;
	if (developingCount > 0) subject += ` (${developingCount} developing)`;
	// after a lane swap the last incident is the radar's best of the other lane, not one of its top N: say so
	const topWords = (n: number): string => (n === 1 ? 'The top incident' : `The top ${n} incidents`);
	const preview =
		incidents.length === 0
			? "No new incidents on our radar today, and Zoo's One Fix."
			: swap
				? `${topWords(swap.inTop)} on our radar plus the top ${laneLabel} story, who reported what, and Zoo's One Fix.`
				: `The top ${incidents.length} security incidents on our radar, who reported what, and Zoo's One Fix.`;
	const intro =
		incidents.length === 0
			? `Our news radar found no new incident for ${dateLabel(radar.runDate)}.`
			: `${swap ? `${topWords(swap.inTop)} on our news radar for ${dateLabel(radar.runDate)}, plus the radar's top ${laneLabel} incident.` : `The top ${incidents.length} incidents on our news radar for ${dateLabel(radar.runDate)}.`} Every figure is credited to the source that reported it. When sources disagree, we list each one and never average them.`;

	const brief: ThreatBrief = {
		date: radar.runDate,
		dateLabel: dateLabel(radar.runDate),
		subject,
		preview,
		brandName,
		intro,
		incidents,
		corrections,
		fix,
		show: options.show ?? null,
		footer: footerLines(brandName),
		radar: {runDate: radar.runDate, generatedUtc: radar.generatedUtc, mode: radar.mode, file: options.radarFile ?? null},
		generatedAt: options.now.toISOString(),
	};
	return {brief, notes, allow};
};

/**
 * The safety rules on every text field of a brief. Fixed text from concepts.ts (definitions, table fixes) and the
 * footer is checked too, but as trusted text (no unknown-word warnings).
 */
export const lintBriefText = (brief: ThreatBrief, allow: NameAllow): Finding[] => {
	const out: Finding[] = [];
	const scan = (text: string, where: string, trusted = false): void => void out.push(...scanText(text, {where, allow, trusted}));
	scan(brief.subject, 'subject');
	scan(brief.preview, 'preview', true);
	scan(brief.intro, 'intro', true);
	brief.corrections.forEach((c, i) => scan(c, `corrections[${i}]`));
	for (const inc of brief.incidents) {
		const where = `incident "${inc.name}"`;
		scan(inc.name, `${where} heading`);
		scan(inc.statusLine, `${where} status`); // quotes the sources' hedges: checked like any third-party text
		if (inc.losses.length > 0) scan(lossLine(inc), `${where} reported loss`);
		scan(howText(inc.how), `${where} how it worked`);
		if (inc.how.concept) scan(inc.how.concept, `${where} concept`, true);
		inc.sources.forEach((s, i) => scan(s.text, `${where} sources[${i}]`));
	}
	scan(brief.fix.text, "Zoo's One Fix", brief.fix.source === 'table');
	if (brief.show) scan(brief.show.title, 'show title');
	brief.footer.forEach((line, i) => scan(line, `footer[${i}]`, true));
	return out;
};

/** "Reported loss: $X (reported by A) · $Y (reported by B)." as plain text. */
export const lossLine = (inc: BriefIncident): string =>
	`Reported loss: ${inc.losses.map((l) => `${l.amount} (reported by ${l.publisher})`).join(' · ')}.`;
