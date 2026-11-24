/**
 * Attribution phrases: "according to X", "X said", "X's post-mortem says", "as reported by X", "per X", headline
 * "X: ..." and the anaphoric "It says" / "The firm added". The gate later resolves each name against the cited
 * sources (publisher, or an organisation named in the cited excerpt); an unresolved name does not count.
 */
import {isCapitalized, normalizePunct, stripPossessive, tokenize, type Tok} from './text.ts';

export type Attribution = {
	/** The attributed name as written ("FixtureSwap", "Example Security Lab", "FBI"); empty for a generic referent. */
	name: string;
	/** A generic referent instead of a name: "it", "they", "the company", "the firm", "the report"... */
	generic?: string;
	start: number;
	end: number;
	how: 'according-to' | 'per' | 'by' | 'verb' | 'headline' | 'in-doc';
};

const VERBS = new Set(
	`say says said report reports reported state states stated allege alleges alleged claim claims claimed estimate
estimates estimated believe believes believed confirm confirms confirmed attribute attributes attributed link links
linked blame blames blamed tie ties tied trace traces traced identify identifies identified write writes wrote post
posts posted announce announces announced tell tells told add adds added note notes noted put puts find finds found
describe describes described charge charges charged accuse accuses accused indict indicts indicted disclose discloses
disclosed explain explains explained warn warns warned flag flags flagged detect detects detected observe observes
observed track tracks tracked calculate calculates calculated count counts counted list lists listed show shows showed
publish publishes published alert alerts alerted spot spots spotted assess assesses assessed conclude concludes
concluded suspect suspects suspected acknowledge acknowledges acknowledged admit admits admitted deny denies denied
argue argues argued`.split(/\s+/),
);
/** "<verb> by X": reported by, flagged by, listed by... */
const BY_VERBS = new Set(
	'reported flagged listed tracked identified confirmed alleged described attributed estimated spotted detected first noticed noticed published cited compiled calculated counted traced observed analysed analyzed'.split(' '),
);
const DOC_NOUNS = new Set(
	`post-mortem postmortem report statement filing complaint release press update analysis blog post data investigation
tracker dashboard alert notice indictment order advisory announcement thread review incident findings disclosure letter
website spokesperson spokesman spokeswoman team account page note summary research preliminary initial latest new own
official public formal written follow-up`.split(/\s+/),
);
const SKIP_BEFORE_VERB = new Set(
	`also later then now previously first publicly separately earlier initially originally since has have had already
further again officially independently both has not never still has had`.split(/\s+/),
);
export const GENERIC_REFERENTS = new Set(
	`it they company exchange firm project protocol team platform agency bureau department regulator court lender bridge
developers report post-mortem postmortem statement filing tracker lab researchers analysts investigators police
prosecutors authorities startup issuer wallet provider service network foundation dao`.split(/\s+/),
);
const CONNECT = new Set(['of', 'the', 'and', '&', 'for', 'de']);

const low = (t: Tok | undefined) => (t ? stripPossessive(t.text).toLowerCase() : '');

type Run = {name: string; generic?: string; start: number; end: number};
/** Pronouns: "It says" / "They said" refer back to a source; "we", "he", "she", "you" never attribute to one. */
const pronoun = (r: Run | null): Run | null => {
	if (!r || !r.name) return r;
	const n = r.name.toLowerCase();
	if (n === 'it' || n === 'they') return {name: '', generic: n, start: r.start, end: r.end};
	if (['we', 'he', 'she', 'you', 'i', 'us', 'our', 'this', 'that', 'there', 'here'].includes(n)) return null;
	return r;
};
const capital = (t: Tok | undefined) => !!t && (isCapitalized(t.text) || /^[\p{Ll}\p{N}][\p{L}\p{N}]*\.[\p{L}]+$/u.test(t.text));

/** The capitalised run starting at token j (skipping "the/a/an"); empty if none. */
const runForward = (toks: Tok[], j: number, src: string): Run | null => {
	let k = j;
	while (k < toks.length && ['the', 'a', 'an'].includes(low(toks[k]))) k++;
	if (k >= toks.length) return null;
	if (!capital(toks[k])) {
		const g = low(toks[k]);
		if (GENERIC_REFERENTS.has(g) || ((g === 'its' || g === 'their') && GENERIC_REFERENTS.has(low(toks[k + 1])))) {
			const end = g === 'its' || g === 'their' ? toks[k + 1].end : toks[k].end;
			return {name: '', generic: g === 'its' || g === 'their' ? low(toks[k + 1]) : g, start: toks[k].start, end};
		}
		return null;
	}
	let e = k;
	while (e + 1 < toks.length) {
		if (/['’]s$/i.test(toks[e].text)) break; // possessive ends the name: "FixtureSwap's review"
		const gap = src.slice(toks[e].end, toks[e + 1].start);
		if (!/^[\s&-]*$/.test(gap)) break;
		if (capital(toks[e + 1])) {
			e++;
			continue;
		}
		if (CONNECT.has(low(toks[e + 1])) && e + 2 < toks.length && capital(toks[e + 2])) {
			e += 2;
			continue;
		}
		break;
	}
	return {name: stripPossessive(src.slice(toks[k].start, toks[e].end)), start: toks[k].start, end: toks[e].end};
};

/** The capitalised run ending at token j (reading backwards); empty if none. */
const runBackward = (toks: Tok[], j: number, src: string): Run | null => {
	if (j < 0) return null;
	if (!capital(toks[j])) {
		const g = low(toks[j]);
		if (GENERIC_REFERENTS.has(g)) return {name: '', generic: g, start: toks[j].start, end: toks[j].end};
		return null;
	}
	let s = j;
	while (s - 1 >= 0) {
		const gap = src.slice(toks[s - 1].end, toks[s].start);
		if (!/^[\s&-]*$/.test(gap)) break;
		if (capital(toks[s - 1]) && !/['’]s$/i.test(toks[s - 1].text)) {
			s--;
			continue;
		}
		if (CONNECT.has(low(toks[s - 1])) && s - 2 >= 0 && capital(toks[s - 2])) {
			s -= 2;
			continue;
		}
		break;
	}
	// drop a sentence-initial article: "The FBI said" -> "FBI"
	while (s < j && ['the', 'a', 'an'].includes(low(toks[s]))) s++;
	return {name: stripPossessive(src.slice(toks[s].start, toks[j].end)), start: toks[s].start, end: toks[j].end};
};

export const findAttributions = (text: string): Attribution[] => {
	const src = normalizePunct(text);
	const toks = tokenize(src);
	const out: Attribution[] = [];
	const push = (raw: Run | null, how: Attribution['how']) => {
		const r = pronoun(raw);
		if (!r) return;
		if (!r.name && !r.generic) return;
		if (out.some((x) => x.start === r.start && x.end === r.end)) return;
		out.push({name: r.name, generic: r.generic, start: r.start, end: r.end, how});
	};
	// headline: "FixtureSwap: ..." / "FBI says ..."
	const head = /^\s*([^:]{2,48}):\s/.exec(src);
	if (head) {
		const r = runForward(tokenize(head[1]), 0, head[1]);
		if (r && r.name && r.end - r.start >= head[1].trim().length - 1) push({...r}, 'headline');
	}
	for (let i = 0; i < toks.length; i++) {
		const w = low(toks[i]);
		if (w === 'according' && low(toks[i + 1]) === 'to') push(runForward(toks, i + 2, src), 'according-to');
		else if (w === 'per' || w === 'citing') push(runForward(toks, i + 1, src), 'per');
		else if (w === 'by' && i > 0 && BY_VERBS.has(low(toks[i - 1]))) push(runForward(toks, i + 1, src), 'by');
		else if (w === 'in' && ['a', 'an', 'its', 'their', 'the'].includes(low(toks[i + 1])) && DOC_NOUNS.has(low(toks[i + 2]))) {
			// "In a statement, FixtureSwap said" (the verb rule catches the rest) / "In its post-mortem, the exchange..."
			const comma = src.indexOf(',', toks[i + 2].end);
			if (comma > 0 && comma - toks[i + 2].end < 60) {
				const after = toks.findIndex((t) => t.start > comma);
				if (after >= 0) push(runForward(toks, after, src), 'in-doc');
			}
		}
		if (VERBS.has(w)) {
			let k = i - 1;
			while (k >= 0 && SKIP_BEFORE_VERB.has(low(toks[k]))) k--;
			while (k >= 0 && DOC_NOUNS.has(low(toks[k])) && !/['’]s$/i.test(toks[k].text)) k--;
			push(runBackward(toks, k, src), 'verb');
		}
	}
	return out.sort((a, b) => a.start - b.start);
};

/** Words that make a short text (title, label) an explicit report rather than a bare assertion. */
export const REPORTED_WORDS = /\b(?:says?|said|reports?|reported|claims?|alleges?|alleged|according|per|confirms?|developing|what we know|unconfirmed)\b/i;
