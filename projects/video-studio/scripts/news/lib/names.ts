/**
 * Names in a text: known names (allowlist + brief), personal-name patterns (rule R4) and the entities a claim names
 * (rule R1 checks they appear in the cited excerpt). Heuristic and deliberately conservative: an unknown two-word
 * capitalised name is treated as a person until the allowlist says otherwise. Pure.
 */
import {findKnown, type AllowEntry, type AllowIndex, type KnownMatch} from './allowlist.ts';
import {COMMON, isAllCaps, isCapitalized, normalizePunct, stripPossessive, tokenize, type Tok} from './text.ts';

// Common given names that are rarely English words or brands (no May, Will, Grant, Chase, Mark, Rose, Jordan...).
const FIRST_NAMES_LIST = `
aaron abdul abigail adam adrian ahmed aidan alan albert alberto alejandro alex alexander alexandra alexis alfred ali
alice alicia alison allan allison alvin amanda amir amit amy ana anatoly anders andre andrea andreas andrei andres andrew
andy angela angelo anita ann anna anne anthony anton antonio arjun arnold arthur arturo ashley ashok barbara barron barry
beatriz ben benjamin bernard beth betty beverly bilal bjorn blake bob bobby boris brandon brendan brenda brian bruce
bruno bryan caitlin cameron carl carla carlos carmen carol caroline carolyn casey catherine cathie cecilia cesar
changpeng charles charlie charlotte cheryl chris christian christina christine christopher cindy claire claudia clayton
cody colin connor craig cristina curtis cynthia dale damian dan dana daniel daniela danielle danny darius darren dave
david davide dean deborah denis dennis derek diana diane diego dimitri dmitry dominic donald donna doug douglas duncan
dylan edgar eduardo edward elena eli elijah elizabeth ellen elon emily emma enrique eric erica erik ethan eugene evan
evelyn fabian farhan fatima federico felipe felix fernando francesca francesco francis francisco frederick gabriel
gabriela gareth gary gavin geoffrey george gerald gerardo gina giorgio giovanni giuseppe glenn gonzalo gordon graham
gregory greg gustavo hakan hamza hannah hans harold harry hassan hayden heather hector heidi helen henry herbert hideo
hiroshi howard hugo hussein ian igor ilya irene isaac isabel isabella ivan jack jacob jacqueline jake james jamie jane
janet janice jared jason javier jean jeff jeffrey jennifer jenny jeremy jerome jerry jesse jessica jihan jill jim jimmy
joan joao joe joel johan johann john johnny jon jonathan jordi jorge jose joseph josh joshua juan judith julia julian
julie julio justin kai kamal karen karl kate katherine kathleen kathryn kathy katie keith kelly ken kenneth kenji kevin
khalid kirk kristen kristin kyle lance laura lauren lawrence leah leo leon leonard leonardo leslie liam linda lisa
lorenzo louis lucas lucia luis luke maggie manuel marc marcel marco marcus margaret maria marie marina mario marisa marta
martin mary mateo matt matteo matthew maurice maxim maxwell megan melania melissa michael michel michelle miguel mikhail
mike milan miles mohamed mohammad mohammed molly monica morris muhammad nadia nancy naomi natalia natalie nathan neil
nicholas nick nicolas nicole nikhil nikolai nina noah norman oleg oliver olivia omar oscar owen pablo pamela patricia
patrick paul paula pavel pedro peter philip philippe pierre pietro priya rachel rafael rahul raj rajesh ralph ramon randy
raphael raul ravi raymond rebecca reza ricardo richard rick ricky rob robert roberto robin rodrigo roger roman ronald ross
roy russell ryan sabrina sahil sam samantha samir samuel sandra sanjay sara sarah satoshi scott sean sebastian sergei
sergey sergio seth shane shannon sharon shawn sheila simon sofia sophia sophie stanislav stefan stefano stephanie stephen
steve steven stuart susan sven tamara tanya tara ted teresa terry thomas tim timothy timmy tobias todd tom tomas tommy
tony tracy travis trevor tyler valentina valerie vanessa vasily veronica vicente victor vikram vincent vitalik vivek
vladimir walter wayne wei wendy wesley william xavier yannick yasmin yuri yusuf zachary zoe
`;
export const FIRST_NAMES = new Set(FIRST_NAMES_LIST.split(/\s+/).filter(Boolean));

/** A run ending in one of these is an organisation, not a person ("Acme Security Group", "Example Wire"). */
export const ORG_SUFFIXES = new Set(
	`capital finance financial network networks protocol labs lab group exchange bridge wallet chain dao foundation markets
market swap pay bank ventures security securities holdings inc ltd llc corp corporation company co partners research
analytics intelligence technologies technology tech systems fund money coin token bureau department agency office police
service services court commission ministry authority council association institute university times news post journal
wire daily media magazine tracker alliance club union trust dex vault vaults lend lending portal studio studios games
gaming arena bot bots drainer drainers ai finance protocols platform app apps project dapp network digital global
international solutions industries`.split(/\s+/),
);

/** Place words: a capitalised run that starts or ends with one is a place ("North Carolina"), not a person. */
const PLACE_WORDS = new Set(
	`north south east west central new san los las saint st port fort lake mount island islands republic kingdom state
states city county province district bay valley beach harbor harbour coast korea china russia america york francisco
kong arabia emirates africa europe asia japan iran israel india brazil argentina mexico canada australia singapore dubai
dhabi zealand ireland germany france spain italy turkey ukraine poland netherlands switzerland thailand vietnam
philippines indonesia malaysia nigeria kenya taiwan carolina dakota jersey hampshire virginia angeles vegas`.split(/\s+/),
);

/** Words right before a capitalised word that mark it as a person (roles, titles, kinship). */
const PERSON_CUES = new Set(
	`mr mrs ms miss dr sir dame lord lady prof professor ceo cto coo cfo ciso founder co-founder cofounder chairman
chairwoman chairperson president director developer dev devs engineer employee staffer hacker attacker suspect suspects
scammer fraudster influencer trader whale researcher investigator sleuth analyst journalist reporter programmer insider
victim owner minister secretary attorney prosecutor judge senator sen rep representative governor mayor agent detective
officer spokesperson spokesman spokeswoman executive manager advisor adviser member citizen resident teen teenager man
woman boy girl brother sister father mother son daughter wife husband named dubbed alias aka nicknamed defendant
plaintiff lawyer streamer youtuber podcaster billionaire entrepreneur investor admin administrator moderator user
pseudonymous anonymous commissioner chief inspector sergeant superintendent constable deputy assistant acting
general chair head ambassador congressman congresswoman lawmaker official prosecutors justice magistrate counsel`.split(/\s+/),
);

// "and" is not a connector: it would merge "Example Security Group and North Carolina" into one name
const CONNECTORS = new Set(['of', 'the', 'de', 'da', 'del', 'van', 'von', 'der', 'den', 'bin', 'al', 'la', 'le', 'du', 'dos', 'das', 'di', '&']);
const MONTHS = new Set('january february march april may june july august september october november december jan feb mar apr jun jul aug sep sept oct nov dec'.split(' '));
const DAYS = new Set('monday tuesday wednesday thursday friday saturday sunday'.split(' '));

const APPOSITION =
	/^\s*,\s*(?:the\s+|a\s+|an\s+|its\s+|their\s+|our\s+)?(?:former\s+|ex-|co-|chief\s+|lead\s+|alleged\s+|pseudonymous\s+|anonymous\s+)?(?:founder|co-founder|cofounder|ceo|cto|coo|cfo|developer|dev|engineer|employee|hacker|attacker|suspect|trader|influencer|researcher|investigator|analyst|executive|spokesperson|spokesman|spokeswoman|director|owner|insider|whale|programmer|victim|defendant|lawyer|attorney|partner|manager|head)\b/i;
const AGE_AFTER = /^\s*,\s*(?:aged\s+)?\d{1,2}\s*,/i;
/** "<Name> said/says/told ...": whoever speaks is a person unless allowlisted (an organisation is in the allowlist). */
const SPEECH_AFTER = /^(?:['’]s)?\s+(?:also\s+|later\s+|then\s+|now\s+)?(?:said|says|told|tells|added|adds|wrote|writes|posted|tweeted|explained|explains|noted|notes|warned|warns|claimed|claims|argued|argues|insisted|insists|denied|denies|admitted|admits|stated|states|believes|thinks|recalled|recalls|testified)\b/i;
/** Roles after which the next word is the person's name or handle, even in lower case ("investigator zachxbt"). */
const HANDLE_CUES = new Set(
	`investigator investigators researcher researchers analyst analysts sleuth sleuths influencer influencers youtuber streamer
podcaster journalist reporter founder co-founder cofounder ceo cto coo cfo trader whale`.split(/\s+/),
);
/** Roles whose name follows only as an apposition between commas ("the engineer, teng, opened ..."). */
const APPOSITION_CUES = new Set('engineer developer dev employee staffer recruiter user hacker attacker suspect victim worker contractor admin'.split(' '));
/** Words that commonly follow those roles and are not names. */
const AFTER_ROLE_OK = new Set(
	`team group community firm firms report reports account accounts laptop laptops machine computer device devices credentials
role interview interviews job jobs offer offers position salary access wallet wallets key keys data tool tools platform
side network who that which whose and or but with at in on of for from to by as was were is are has had have will would
could can may might did does do said says told found traced flagged posted wrote noted linked estimated reported believes
thinks first also later then now group's firm's interface experience error side end base behavior behaviour education
protection safety security support onboarding agreement consent identity address email phone password session flow
journey portal forum crew gang collective campaign kit playbook tactic technique toolkit dashboard desk feed post
thread channel blog note alert profile handle page site say warn note find show argue believe think suspect agree explain
confirm estimate`.split(/\s+/),
);

export type PersonReason =
	| 'two-word-name'
	| 'handle'
	| 'title-or-role'
	| 'apposition'
	| 'age'
	| 'first-name'
	| 'source-person'
	| 'blocked'
	| 'placeholder'
	| 'unknown-name'
	| 'unknown-name-in-sources'
	| 'unknown-word-headline'
	| 'identifying-detail'
	| 'speaker-name'
	| 'role-handle'
	| 'lowercase-name';

export type PersonHit = {text: string; start: number; end: number; reason: PersonReason; severity: 'error' | 'warning'};
export type EntityRef = {text: string; start: number; end: number; kind: 'known' | 'org' | 'acronym' | 'unknown'; entry?: AllowEntry; sentenceStart: boolean};

export type NameScan = {known: KnownMatch[]; persons: PersonHit[]; entities: EntityRef[]};

export type NameContext = {
	idx: AllowIndex;
	/** Title, label or thumbnail text (often Title Case or ALL CAPS): unknown words there are errors. */
	short?: boolean;
	/** Lower-case tokens of person-like names found in the brief's excerpts (cross-check for a lone surname). */
	sourcePersonTokens?: Set<string>;
	/** Normalised brief text, to tell an unknown organisation named by a source from a name nobody sourced. */
	briefText?: string;
	/** Words seen in lower case in the sources or the storyboard: capitalised only at a sentence start, so not names. */
	lowerWords?: Set<string>;
};

const lw = (t: string) => stripPossessive(t).toLowerCase().replace(/\.$/, '');

const sentenceStarts = (toks: Tok[], src: string): boolean[] =>
	toks.map((t, i) => {
		if (i === 0) return true;
		const gap = src.slice(toks[i - 1].end, t.start);
		return /[.!?:;…"“(\n—]|\s-\s/.test(gap) && !/^\.\d/.test(gap);
	});

const nameLike = (t: string): boolean => {
	const s = stripPossessive(t);
	if (/\d/.test(s) || s.startsWith('$') || s.startsWith('#')) return false;
	if (s.replace(/[^\p{L}]/gu, '').length < 2) return false; // single letters and initials
	if (s.includes('.') && !/^(?:\p{L}\.)+$/u.test(s)) return false; // domains (rekt.news) are not person names
	return isCapitalized(s);
};

/**
 * Scan one text. `short` texts (titles, thumbnails, labels) are often in Title Case or ALL CAPS, so their common words
 * are skipped and any remaining unknown word is an error.
 */
export const scanNames = (text: string, ctx: NameContext): NameScan => {
	const src = normalizePunct(text);
	const toks = tokenize(src);
	const starts = sentenceStarts(toks, src);
	const known = findKnown(toks, ctx.idx, src);
	const persons: PersonHit[] = [];
	const entities: EntityRef[] = [];
	const used = new Array<boolean>(toks.length).fill(false);
	for (const k of known) {
		for (let i = k.startTok; i < k.endTok; i++) used[i] = true;
		if (k.entry.category === 'blocked') persons.push({text: k.text, start: k.start, end: k.end, reason: 'blocked', severity: 'error'});
		else entities.push({text: k.text, start: k.start, end: k.end, kind: 'known', entry: k.entry, sentenceStart: starts[k.startTok]});
	}
	for (const m of src.matchAll(/\[\s*named person\s*\]/gi))
		persons.push({text: m[0], start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, reason: 'placeholder', severity: 'error'});
	for (const m of src.matchAll(/\b\d{1,2}-year-old\b/gi))
		persons.push({text: m[0], start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, reason: 'identifying-detail', severity: 'error'});

	// lower-case names and handles: "investigator zachxbt", "the engineer, richard teng, opened ...", "richard teng"
	for (let k = 0; k + 1 < toks.length; k++) {
		const cue = lw(toks[k].text);
		const next = toks[k + 1];
		const nw = lw(next.text);
		const gap = src.slice(toks[k].end, next.start);
		if (used[k + 1] || isCapitalized(next.text) || COMMON.has(nw) || AFTER_ROLE_OK.has(nw) || /^\d/.test(nw)) continue;
		const cued = (HANDLE_CUES.has(cue) && /^\s*,?\s*$/.test(gap)) || (APPOSITION_CUES.has(cue) && /^\s*,\s*$/.test(gap) && /^\s*,/.test(src.slice(next.end, next.end + 40).replace(/^\s+[\p{Ll}][\p{L}'-]*/u, '')));
		if (cued && !/(?:ed|ing|ly|s)$/.test(nw) && nw.length >= 3) {
			const two = toks[k + 2] && !isCapitalized(toks[k + 2].text) && /^\s+$/.test(src.slice(next.end, toks[k + 2].start)) && !COMMON.has(lw(toks[k + 2].text)) && !AFTER_ROLE_OK.has(lw(toks[k + 2].text)) && !/(?:ed|ing|ly)$/.test(lw(toks[k + 2].text)) ? toks[k + 2] : null;
			const end = two ? two.end : next.end;
			persons.push({text: src.slice(next.start, end), start: next.start, end, reason: 'role-handle', severity: 'error'});
			continue;
		}
		if (FIRST_NAMES.has(nw) && toks[k + 2]) {
			const third = toks[k + 2];
			const tw = lw(third.text);
			if (!isCapitalized(third.text) && /^\s+$/.test(src.slice(next.end, third.start)) && !COMMON.has(tw) && !AFTER_ROLE_OK.has(tw) && !/(?:ed|ing|ly)$/.test(tw) && tw.length >= 2)
				persons.push({text: src.slice(next.start, third.end), start: next.start, end: third.end, reason: 'lowercase-name', severity: 'error'});
		}
	}
	if (toks[0] && !isCapitalized(toks[0].text) && FIRST_NAMES.has(lw(toks[0].text)) && toks[1] && !isCapitalized(toks[1].text) && !COMMON.has(lw(toks[1].text)) && !AFTER_ROLE_OK.has(lw(toks[1].text)))
		persons.push({text: src.slice(toks[0].start, toks[1].end), start: toks[0].start, end: toks[1].end, reason: 'lowercase-name', severity: 'error'});

	const headline = isHeadlineCase(toks, !!ctx.short);
	let i = 0;
	while (i < toks.length) {
		const t = toks[i];
		if (used[i]) {
			i++;
			continue;
		}
		if (t.text.startsWith('@') && t.text.length > 2) {
			persons.push({text: t.text, start: t.start, end: t.end, reason: 'handle', severity: 'error'});
			i++;
			continue;
		}
		if (!nameLike(t.text)) {
			i++;
			continue;
		}
		// a run of capitalised tokens, connectors allowed between them
		let j = i + 1;
		while (j < toks.length && !used[j]) {
			const gap = src.slice(toks[j - 1].end, toks[j].start);
			if (!/^[\s-]*$/.test(gap)) break;
			if (nameLike(toks[j].text)) {
				j++;
				continue;
			}
			if (CONNECTORS.has(toks[j].text.toLowerCase()) && j + 1 < toks.length && !used[j + 1] && nameLike(toks[j + 1].text) && /^\s+$/.test(src.slice(toks[j].end, toks[j + 1].start))) {
				j += 2;
				continue;
			}
			break;
		}
		analyseRun(toks.slice(i, j), i, starts, src, ctx, headline, persons, entities);
		i = j;
	}
	return {known, persons, entities: entities.sort((a, b) => a.start - b.start)};
};

/** Title Case or ALL CAPS: at least 80% of the words capitalised (short labels may have 1-2 words). */
const isHeadlineCase = (toks: Tok[], short: boolean): boolean => {
	const words = toks.filter((t) => /\p{L}/u.test(t.text));
	if (!words.length || (!short && words.length < 3)) return false;
	const caps = words.filter((t) => isCapitalized(t.text) || isAllCaps(t.text)).length;
	return caps / words.length >= 0.8;
};

const analyseRun = (
	runIn: Tok[],
	offsetIn: number,
	starts: boolean[],
	src: string,
	ctx: NameContext,
	headline: boolean,
	persons: PersonHit[],
	entities: EntityRef[],
) => {
	let run = runIn;
	let offset = offsetIn;
	// a leading title or role is a cue, not part of the name: "Commissioner Avery Example" -> "Avery Example"
	let lead = 0;
	while (lead < run.length - 1 && PERSON_CUES.has(lw(run[lead].text))) lead++;
	if (lead === run.length - 1 && PERSON_CUES.has(lw(run[lead].text))) return;
	if (lead) {
		run = run.slice(lead);
		offset += lead;
	}
	const words = run.map((t) => lw(t.text));
	const span = (a: number, b: number) => ({text: src.slice(run[a].start, run[b].end), start: run[a].start, end: run[b].end});
	// an organisation: "Acme Security Group", "Example Wire"
	if (run.length >= 2 && ORG_SUFFIXES.has(words[words.length - 1])) {
		entities.push({...span(0, run.length - 1), kind: 'org', sentenceStart: starts[offset]});
		return;
	}
	// split the run at words that are not names: a capitalised common word at a sentence start, or any common word in a
	// headline; months and weekdays always
	const parts: Array<{a: number; b: number}> = [];
	let a = -1;
	for (let k = 0; k < run.length; k++) {
		const w = words[k];
		const drop = MONTHS.has(w) || DAYS.has(w) || (CONNECTORS.has(w) && !isCapitalized(run[k].text)) || (COMMON.has(w) && (starts[offset + k] || headline));
		if (drop) {
			if (a >= 0) parts.push({a, b: k - 1});
			a = -1;
		} else if (a < 0) a = k;
	}
	if (a >= 0) parts.push({a, b: run.length - 1});
	for (const p of parts) {
		// trim connectors at the edges
		let s = p.a;
		let e = p.b;
		while (s <= e && CONNECTORS.has(words[s])) s++;
		while (e >= s && CONNECTORS.has(words[e])) e--;
		if (s > e) continue;
		const sub = words.slice(s, e + 1);
		const hit = span(s, e);
		const atStart = starts[offset + s];
		if (sub.length >= 2) {
			if (ORG_SUFFIXES.has(sub[sub.length - 1])) {
				entities.push({...hit, kind: 'org', sentenceStart: atStart});
				continue;
			}
			if (PLACE_WORDS.has(sub[0]) || PLACE_WORDS.has(sub[sub.length - 1])) {
				entities.push({...hit, kind: 'org', sentenceStart: atStart});
				continue;
			}
			if (sub.every((w, k) => isAllCaps(stripPossessive(run[s + k].text)) && w.length <= 6) && !headline) {
				for (let k = s; k <= e; k++) entities.push({...span(k, k), kind: 'acronym', sentenceStart: starts[offset + k]});
				continue;
			}
			persons.push({...hit, reason: 'two-word-name', severity: 'error'});
			continue;
		}
		// one word
		const w = sub[0];
		const raw = stripPossessive(run[s].text);
		const before = src.slice(Math.max(0, hit.start - 40), hit.start);
		const prevWords = (before.match(/[\p{L}-]+\.?/gu) ?? []).slice(-2).map((x) => x.toLowerCase().replace(/\.$/, ''));
		const after = src.slice(hit.end);
		if (prevWords.some((x) => PERSON_CUES.has(x))) {
			persons.push({...hit, reason: 'title-or-role', severity: 'error'});
			continue;
		}
		if (APPOSITION.test(after)) {
			persons.push({...hit, reason: 'apposition', severity: 'error'});
			continue;
		}
		if (AGE_AFTER.test(after)) {
			persons.push({...hit, reason: 'age', severity: 'error'});
			continue;
		}
		if (FIRST_NAMES.has(w)) {
			persons.push({...hit, reason: 'first-name', severity: 'error'});
			continue;
		}
		if (ctx.sourcePersonTokens?.has(w)) {
			persons.push({...hit, reason: 'source-person', severity: 'error'});
			continue;
		}
		if (isAllCaps(raw) && raw.length <= 6 && !headline) {
			entities.push({...hit, kind: 'acronym', sentenceStart: atStart});
			continue;
		}
		// "China-based", "Lazarus-linked": a known place or organisation with a hyphenated suffix
		const baseWord = raw.replace(/-(?:based|linked|backed|led|owned|tied|affiliated|related|sponsored|funded|run|style|era|born|made)$/i, '').toLowerCase();
		if (baseWord !== raw.toLowerCase() && (ctx.idx.byFirst.get(baseWord) ?? []).some((en) => en.tokens.length === 1 && en.category !== 'blocked')) continue;
		// "<Name> said ...": a speaker that is not an allowlisted organisation is a person, at a sentence start too
		if (SPEECH_AFTER.test(after) && !COMMON.has(w)) {
			entities.push({...hit, kind: 'unknown', sentenceStart: atStart});
			persons.push({...hit, reason: 'speaker-name', severity: 'error'});
			continue;
		}
		if (COMMON.has(w)) continue;
		if ((atStart || headline) && ctx.lowerWords?.has(w)) continue;
		const inBrief = !!ctx.briefText && new RegExp(`(?:^|[^\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^\\p{L}\\p{N}])`, 'u').test(ctx.briefText);
		entities.push({...hit, kind: 'unknown', sentenceStart: atStart});
		// fail closed: only allowlisted organisations pass. A word the sources use is still unknown to us (a surname the
		// radar missed, a pseudonym such as an operator's handle); only a sentence-initial word the sources never
		// capitalise stays a warning, because it may just be an ordinary word starting the sentence.
		if (headline) persons.push({...hit, reason: 'unknown-word-headline', severity: 'error'});
		else if (atStart) persons.push({...hit, reason: inBrief ? 'unknown-name-in-sources' : 'unknown-name', severity: inBrief ? 'error' : 'warning'});
		else persons.push({...hit, reason: inBrief ? 'unknown-name-in-sources' : 'unknown-name', severity: 'error'});
	}
};

/** Lower-case tokens of person-like names in a text (two-word names and role-cued names), for the surname cross-check. */
export const personTokensIn = (text: string, idx: AllowIndex): Set<string> => {
	const out = new Set<string>();
	const scan = scanNames(text, {idx});
	for (const p of scan.persons)
		if (p.reason === 'two-word-name' || p.reason === 'title-or-role' || p.reason === 'apposition' || p.reason === 'age' || p.reason === 'speaker-name')
			for (const t of tokenize(p.text)) {
				const w = lw(t.text);
				if (!CONNECTORS.has(w) && !COMMON.has(w) && !PERSON_CUES.has(w) && w.length > 1) out.add(w);
			}
	return out;
};

export const personMessage = (p: PersonHit): string => {
	switch (p.reason) {
		case 'two-word-name':
			return `"${p.text}" looks like a personal name`;
		case 'handle':
			return `"${p.text}" is a social handle (a personal identifier)`;
		case 'title-or-role':
			return `"${p.text}" follows a title or role word, so it reads as a person's name`;
		case 'apposition':
			return `"${p.text}" is described by a role ("…, the founder"), so it reads as a person's name`;
		case 'age':
			return `"${p.text}" is given with an age, so it reads as a person's name`;
		case 'first-name':
			return `"${p.text}" is a common given name`;
		case 'source-person':
			return `"${p.text}" is part of a personal name that appears in the sources`;
		case 'blocked':
			return `"${p.text}" is an individual's handle or nickname (allowlist "blocked")`;
		case 'placeholder':
			return `"${p.text}" is the radar's redaction placeholder; it would be read aloud`;
		case 'identifying-detail':
			return `"${p.text}" is an identifying detail about an individual`;
		case 'unknown-word-headline':
			return `"${p.text}" in a title, label or thumbnail is not a known organisation, protocol, place or term`;
		case 'unknown-name-in-sources':
			return `"${p.text}" is not on the allowlist (it does appear in the sources)`;
		case 'unknown-name':
			return `"${p.text}" is not a known organisation, protocol, place or term, and no source names it`;
		case 'speaker-name':
			return `"${p.text}" is quoted as speaking ("said", "says", "told") and is not an allowlisted organisation, so it reads as a person`;
		case 'role-handle':
			return `"${p.text}" follows a role ("investigator", "engineer"), so it reads as a person's name or handle (lower case included)`;
		case 'lowercase-name':
			return `"${p.text}" reads as a personal name written in lower case`;
	}
};

export const personFix = (p: PersonHit): string => {
	switch (p.reason) {
		case 'placeholder':
			return 'Describe the role instead ("the exchange\'s CEO", "a developer") or drop the mention.';
		case 'identifying-detail':
			return 'Drop ages and other personal details; describe roles only.';
		case 'blocked':
		case 'handle':
			return 'Do not name individuals or their handles. Describe the role ("an on-chain investigator") and attribute to an organisation.';
		case 'unknown-name-in-sources':
		case 'unknown-name':
		case 'unknown-word-headline':
		case 'speaker-name':
			return 'If it is an organisation, protocol, place or term, add it to scripts/news/allowlist.json. If it is a person, remove it and describe the role.';
		default:
			return 'Replace the name with the role ("the exchange\'s CEO", "a developer"). Only officials named in a cited law-enforcement or regulator release may be named, and only once they are in allowlist.json "officials".';
	}
};
