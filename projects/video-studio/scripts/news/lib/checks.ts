/**
 * Helpers for the stricter news rules (2026-11-24 review): what a cited source must say before a claim may accuse or
 * name a cause (R3), who a figure on a title, label or thumbnail is attributed to (R3), ordered attack steps in
 * narration, lists and diagrams (R5), price talk without numbers (R9) and the own-data figures of an analysis (R7).
 * Pure.
 */
import {aliasesOf, normName} from './allowlist.ts';
import {findAttributions} from './attribution.ts';
import {publisherFor} from './brief.ts';
import {nameInEvidence, type Ctx, type Evidence, type Unit} from './context.ts';
import {ACTION_VERBS, ACTOR_REF, ATTACK_OBJECT, DEFENSIVE_VERBS, PRICE_SUBJECT_WORDS, PRICE_VERB, SEQUENCE_LINK} from './lexicon.ts';
import {isoDateParts, type DateParts, type Num} from './numbers.ts';
import {COMMON, normalizePunct, stripPossessive, tokenize, unique} from './text.ts';

// ---------------------------------------------------------------------------------------------------------------
// R3: an accusation or a cause must be something the cited source itself says (stem match in its stored text)

const STEAL = /\b(?:steal\w*|stole|stolen|theft|thefts|thie(?:f|ves)|heist\w*)\b/i;
const INCIDENT = /\b(?:hack\w*|exploit\w*|attack\w*|breach\w*|heist\w*)\b/i;
const STAFFISH = /\b(?:insiders?|inside (?:job|help|man|men|source)|employees?|staff\w*|engineers?|developers?|devs?|workers?|contractors?|personnel|team members?|admins?|operators?|someone at|somebody at)\b/i;
const ACCOMPLICEISH = /\b(?:help\w*|aid\w*|assist\w*|collu\w*|conspir\w*|in on (?:it|the)|cahoots|accomplices?|tip\w* off|let\w* (?:\w+ ){0,2}in\b|sold|leak\w*|cooperat\w*|collaborat\w*|inside (?:job|help|man|men))\b/i;

/** Word families a cause term may be supported by (a source saying "exploited" supports "hacked"; "stole" needs theft words). */
const CAUSE_FAMILIES: Array<[RegExp, RegExp]> = [
	[/^(?:stolen|theft|heist)/i, STEAL],
	[/^(?:hack|exploit|attack|breach)/i, INCIDENT],
	[/^drain/i, /\b(?:drain\w*|siphon\w*|loot\w*|steal\w*|stole|stolen|theft|emptied)\b/i],
	[/^compromis/i, /\b(?:compromis\w*|hijack\w*|takeover|breach\w*|leak\w*)\b/i],
	[/^phish/i, /\bphish\w*\b/i],
	[/^social[- ]engineer/i, /\b(?:social[- ]engineer\w*|fake (?:job|interview|recruit\w*|employment)|impersonat\w*|lure\w*|trick\w*)\b/i],
	[/^(?:malicious|malware)/i, /\b(?:malicious|malware|infostealer\w*|trojan\w*|backdoor\w*)\b/i],
	[/^(?:launder|money[- ]launder)/i, /\blaunder\w*\b/i],
	[/^leak/i, /\b(?:leak\w*|expos\w*)\b/i],
	[/^backdoor/i, /\bbackdoor\w*\b/i],
	[/^(?:vulnerab|flaw|bug)/i, /\b(?:vulnerab\w*|flaw\w*|bugs?|weakness\w*|exploit\w*)\b/i],
	[/^(?:prompt[- ]injection|injected)/i, /\binject\w*\b/i],
	[/^jailbr/i, /\bjailbr\w*\b/i],
	[/^deepfake/i, /\bdeepfake\w*\b/i],
	[/^voice[- ]clon/i, /\b(?:voice[- ]?clon\w*|clon\w* (?:a |the |his |her |their )?voice\w*)\b/i],
	[/^impersonat/i, /\b(?:impersonat\w*|pos(?:ed|ing) as|fake)\b/i],
	[/^poison/i, /\bpoison\w*\b/i],
	[/^hijack/i, /\b(?:hijack\w*|takeover|compromis\w*)\b/i],
];

/** What the cited text must contain for a cause term (CAUSES match) to be supported. */
export const causeSupport = (term: string): RegExp[] => {
	for (const [head, family] of CAUSE_FAMILIES) if (head.test(term)) return [family];
	return [new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/(?:ed|ing|s)$/, '')}\\w*`, 'i')];
};

/** What the cited text must contain for an accusation (ACCUSATIONS code + matched text) to be supported. All must match. */
export const accusationSupport = (code: string, matched: string, unitText: string): RegExp[] => {
	switch (code) {
		case 'stole':
			return [STEAL];
		case 'hacked-by': {
			const verb = matched.replace(/\s+by$/i, '');
			const fam = causeSupport(verb);
			// the agent named after "by" must be in the source too ("hacked by North Korea")
			const i = unitText.toLowerCase().indexOf(matched.toLowerCase());
			const after = i >= 0 ? unitText.slice(i + matched.length).trim().split(/[\s,.;:!?]+/).filter((w) => w.length > 2 && !COMMON.has(w.toLowerCase())).slice(0, 2) : [];
			return [...fam, ...after.map((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/(?:ns|n|s)$/i, '')}`, 'i'))];
		}
		case 'insider':
			return [/\b(?:insiders?|inside (?:job|help|man|men|source))\b/i];
		case 'insider-help':
			return [STAFFISH, ACCOMPLICEISH];
		case 'accomplice':
			return [/\b(?:collu\w*|conspir\w*|in on (?:it|the)|cahoots|accomplices?)\b/i];
		case 'rug':
			return [/\b(?:rug\w*|exit[- ]scam\w*|pulled (?:the )?liquidity)\b/i];
		case 'fraud':
		case 'scam-label':
			return [/\b(?:fraud\w*|scam\w*|ponzi|defraud\w*|embezzl\w*|swindl\w*)\b/i];
		case 'behind':
			return [/\b(?:behind|responsib\w*|blam\w*|attribut\w*|orchestrat\w*|perpetrat\w*|mastermind\w*|carried out|link\w*|tied)\b/i];
		case 'state-actor':
			return [/\b(?:north korea\w*|dprk|state[- ](?:sponsored|backed)|nation[- ]state|lazarus|tradertraitor|bluenoroff|kremlin|iran\w*)\b/i];
		case 'criminal':
			return [/\b(?:crimin\w*|crimes?)\b/i];
		case 'negligence':
			return [/\b(?:negligen\w*|careless\w*|reckless\w*|incompeten\w*|lax\b|sloppy|failed to|asleep)\b/i];
		default:
			return [new RegExp(matched.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')];
	}
};

export const supportedBy = (needs: RegExp[], ev: Evidence): boolean => needs.every((re) => ev.raw.some((t) => re.test(normalizePunct(t))));

// ---------------------------------------------------------------------------------------------------------------
// R3: who a figure on a short surface (title, label, thumbnail) is attributed to

const bare = (x: string) => x.replace(/^the /, '');

/** Does `name` denote the publisher of brief/storyboard source `id`? (DefiLlama, The Block, rekt.news...) */
export const publisherIs = (ctx: Ctx, name: string, id: string): boolean => {
	const bid = ctx.resolveId.get(id) ?? id;
	const pubs = unique([ctx.briefSources.get(bid)?.publisher ?? '', publisherFor(ctx.sbSources.get(id)?.url ?? ctx.briefSources.get(bid)?.url ?? '')].filter(Boolean));
	const forms = unique([...aliasesOf(ctx.idx, name), ...aliasesOf(ctx.idx, `The ${name}`)].map(bare));
	return pubs.some((p) => unique([...aliasesOf(ctx.idx, p), normName(p)].map(bare)).some((f) => forms.includes(f)));
};

const SPEECH_AFTER = /^\s*(?:said|says|told|tells|reported|reports|stated|states|confirmed|confirms|announced|announces|disclosed|discloses|estimated|estimates|wrote|writes|posted|lists|listed|put|puts|added|adds)\b/i;

/** The cited sources behind an attribution to `name`: those it publishes, or whose excerpt quotes `name` saying something. */
export const sourcesFor = (ctx: Ctx, name: string, ids: string[]): string[] =>
	ids.filter((id) => {
		if (publisherIs(ctx, name, id)) return true;
		const ev = ctx.evidence([id]);
		if (!nameInEvidence(ctx, name, ev)) return false;
		return ev.raw.some((t) => {
			const src = normalizePunct(t);
			const at = src.toLowerCase().indexOf(name.toLowerCase());
			return at >= 0 && SPEECH_AFTER.test(src.slice(at + name.length).replace(/^['’]s\s+(?:\w+\s+){0,2}?(?=said|says|states|stated)/i, ''));
		});
	});

/**
 * The attribution a short text gives its figures: "per DefiLlama", "DefiLlama: ...", "FixtureSwap reports ...",
 * "according to ...", "(DefiLlama)", "... - DefiLlama". Returns the name and the cited sources it stands for.
 */
export const shortAttribution = (ctx: Ctx, u: Unit, ids: string[]): {name: string; ids: string[]} | null => {
	const names: string[] = [];
	for (const a of findAttributions(u.display)) if (a.name) names.push(a.name);
	const src = normalizePunct(u.display);
	for (const m of src.matchAll(/\(([^()]{2,40})\)/g)) names.push(m[1].trim());
	const dash = /\s[-–—]\s*([\p{L}][\p{L}\p{N} .&'-]{1,40})$/u.exec(src);
	if (dash) names.push(dash[1].trim());
	for (const name of unique(names)) {
		const found = sourcesFor(ctx, name, ids);
		if (found.length) return {name, ids: found};
	}
	return null;
};

// ---------------------------------------------------------------------------------------------------------------
// R5: ordered attack steps in narration, on-screen lists and diagrams

const ACTOR_NOUN = /^(?:attackers?|hackers?|scammers?|exploiters?|thie(?:f|ves)|victims?|engineers?|employees?|developers?|devs?|users?|staff|they|it|criminals?)$/i;
const EXTRA_ACTION = new Set(['had', 'has', 'have', 'made', 'got', 'used', 'went', 'set', 'then']);

const words = (s: string): string[] => (normalizePunct(s).toLowerCase().match(/[\p{L}\p{N}'’-]+/gu) ?? []).map((w) => stripPossessive(w));

/** An on-screen item or diagram node that is an action step: "Send a fake job offer", "Victim runs test repo". */
export const isActionItem = (item: string): boolean => {
	const w = words(item.replace(/^\s*(?:\d+[.)]|step \d+:?|[-*•])\s*/i, ''));
	if (!w.length) return false;
	if (DEFENSIVE_VERBS.has(w[0]) || w[0] === 'never' || w[0] === 'use') return false;
	if (ACTION_VERBS.has(w[0])) return true;
	return w.length >= 2 && ACTOR_NOUN.test(w[0]) && (ACTION_VERBS.has(w[1]) || EXTRA_ACTION.has(w[1]));
};

/** How many attacker actions one sentence chains with commas ("They sent ..., had ..., used ..., and signed ..."). */
export const chainedActions = (sentence: string): number => {
	const s = normalizePunct(sentence).trim();
	const subj = /^(?:(?:first|then|next|finally|and)[, ]+)?(?:the\s+)?(?:attackers?|hackers?|they|scammers?|exploiters?|thie(?:f|ves)|criminals?|intruders?)\s+/i.exec(s);
	if (!subj) return 0;
	const parts = s.slice(subj[0].length).split(/,\s*(?:and\s+|then\s+)?|;\s*|\s+and\s+then\s+/).map((x) => x.trim()).filter(Boolean);
	let n = 0;
	for (const p of parts) {
		const w = words(p);
		if (w.length >= 2 && (ACTION_VERBS.has(w[0]) || EXTRA_ACTION.has(w[0]) || /^[a-z]{3,}ed$/.test(w[0]))) n++;
	}
	return n;
};

/** Diagram nodes linked as a sequence of steps, or nodes that are actor steps. */
export const diagramSteps = (nodes: string[], links: string[]): {steps: boolean; why: string} => {
	const actors = nodes.filter(isActionItem);
	if (nodes.length >= 3 && actors.length >= 2) return {steps: true, why: `${actors.length} of its ${nodes.length} nodes are actions ("${actors[0]}")`};
	const seq = links.filter((l) => SEQUENCE_LINK.test(l)).length;
	if (nodes.length >= 4 && seq >= 2) return {steps: true, why: `${nodes.length} nodes linked by "${links.find((l) => SEQUENCE_LINK.test(l))}" ${seq} times`};
	return {steps: false, why: ''};
};

export const attackContext = (scene: {segment?: unknown; onScreen?: Record<string, unknown>}, sceneText: string, items: string[]): boolean =>
	scene.segment === 'howItWorked' || /how it work/i.test(String(scene.onScreen?.title ?? '')) || ATTACK_OBJECT.test(sceneText) || items.some((i) => ATTACK_OBJECT.test(i)) || ACTOR_REF.test(items.join(' '));

// ---------------------------------------------------------------------------------------------------------------
// R9: price moves without numbers ("BNB tanked", "with bitcoin rallying")

/** Known upper-case tickers: "BNB", "LINK" (upper case only, so "link" the word is not a ticker). */
const UPPER_TICKER = /^\$?[A-Z]{2,6}$/;

export const priceMoveWithoutNumber = (text: string, tickers: Set<string>): string | null => {
	const toks = tokenize(normalizePunct(text));
	for (let i = 0; i < toks.length; i++) {
		const raw = stripPossessive(toks[i].text).replace(/^\$/, '');
		const subject = PRICE_SUBJECT_WORDS.has(raw.toLowerCase()) || (UPPER_TICKER.test(raw) && tickers.has(raw));
		if (!subject) continue;
		for (let j = i + 1; j <= i + 3 && j < toks.length; j++) {
			const v = toks[j].text.toLowerCase();
			if (PRICE_VERB.test(v)) {
				// "coins dropped into a mixer" is a fund flow, not a price move
				const next = toks[j + 1]?.text.toLowerCase() ?? '';
				if (/^(?:into|to|from|off|out|through|onto|across)$/.test(next)) continue;
				return text.slice(toks[i].start, toks[j].end);
			}
		}
	}
	return null;
};

// ---------------------------------------------------------------------------------------------------------------
// R7: own-data figures must be reproducible from the brief

export type Spans = {days: number[]; weeks: number[]; months: number[]};

/** Spans between the dates: days (inclusive and exclusive), whole weeks and months (rounded and rounded up). */
export const spansBetween = (dates: DateParts[], fallbackYear: number): Spans => {
	const ts = unique(
		dates
			.filter((d) => d.month && d.day)
			.map((d) => Date.UTC(d.year ?? fallbackYear, (d.month as number) - 1, d.day as number))
			.filter((x) => Number.isFinite(x)),
	);
	const out: Spans = {days: [], weeks: [], months: []};
	for (const a of ts)
		for (const b of ts) {
			if (b <= a) continue;
			const days = Math.round((b - a) / 86_400_000);
			out.days.push(days, days + 1);
			out.weeks.push(Math.round(days / 7), Math.ceil(days / 7));
			out.months.push(Math.round(days / 30.44), Math.ceil(days / 30.44));
		}
	return out;
};

/** The time unit written right after a number ("30 days", "eight weeks"), if any. */
export const unitAfter = (text: string, end: number): keyof Spans | null => {
	const m = /^\s*(?:straight\s+|consecutive\s+)?(day|days|week|weeks|month|months)\b/i.exec(text.slice(end));
	if (!m) return null;
	const u = m[1].toLowerCase();
	return u.startsWith('day') ? 'days' : u.startsWith('week') ? 'weeks' : 'months';
};

/** Dates written in text ("Oct 26", "2026-10-26"), as DateParts. */
export const datesIn = (nums: Num[]): DateParts[] => nums.filter((n) => n.kind === 'date').map((n) => ({year: n.year, month: n.month, day: n.day}));

export const isoDates = (xs: Array<string | undefined>): DateParts[] => xs.map((x) => isoDateParts(x)).filter((d): d is DateParts => !!d);
