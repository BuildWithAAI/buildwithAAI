/**
 * Text helpers for the news claim gate: normalisation, tokens with positions, the common-word list that tells
 * sentence-initial capitals from names, a light stemmer with crypto/AI-security synonyms, and content-word overlap.
 * Pure: no I/O.
 */

/** Unify typographic quotes, dashes and spaces. Keeps the string length (one char in, one char out). */
export const normalizePunct = (s: string): string =>
	s
		.replace(/[‘’‚‛′]/g, "'")
		.replace(/[“”„‟″]/g, '"')
		.replace(/[‐-―−]/g, '-')
		.replace(/[   ]/g, ' ');

export const normSpace = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Lower case, unified punctuation, single spaces: the form used for evidence substring checks. */
export const norm = (s: string): string => normSpace(normalizePunct(s).toLowerCase());

export const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether `needle` occurs in `haystack` as a whole phrase (not inside a longer word). Both are normalised. */
export const hasPhrase = (haystack: string, needle: string): boolean => {
	const n = norm(needle);
	if (!n) return false;
	const re = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRe(n)}(?:$|[^\\p{L}\\p{N}])`, 'u');
	return re.test(norm(haystack));
};

export type Tok = {text: string; start: number; end: number};

// A word: letters/digits, with inner . ' ’ & - _ when a letter or digit follows (U.S, Pump.fun, Bybit's, co-founder,
// ERC-20). Optional leading @ (handles), $ (tickers) or # (numbers).
const TOKEN_RE = /[@$#]?[\p{L}\p{N}](?:[\p{L}\p{N}_]|[.'’&-](?=[\p{L}\p{N}]))*/gu;

export const tokenize = (s: string): Tok[] => {
	const out: Tok[] = [];
	for (const m of s.matchAll(TOKEN_RE)) {
		let text = m[0];
		const start = m.index ?? 0;
		// keep the closing dot of initialisms (U.S. / U.K. / a.m.)
		if (/^(?:\p{L}\.)+\p{L}$/u.test(text) && s[start + text.length] === '.') text += '.';
		out.push({text, start, end: start + text.length});
	}
	return out;
};

export const stripPossessive = (w: string): string => w.replace(/['’]s$/i, '');

export const isCapitalized = (w: string): boolean => /^[@$#]?\p{Lu}/u.test(w);
export const isAllCaps = (w: string): boolean => /\p{Lu}/u.test(w) && !/\p{Ll}/u.test(w.replace(/['’]s$/, ''));

/**
 * Words that may start a sentence (or a headline) with a capital letter without being a name: function words, common
 * verbs and nouns, and the crypto/AI-security vocabulary this show uses. Lower case.
 */
const COMMON_LIST = `
a about above according across actually after afterwards again against ago ahead all almost alone along already also
although always am among an and another any anybody anyone anything anyway anywhere apparently are around as ask asked
at away back bad basically be became because become been before behind being below best better between beyond big
both brief briefly but by can cannot can't could couldn't did didn't do does doesn't doing done don't down during
each early earlier either else elsewhere enough especially even ever every everybody everyone everything exactly
except far few finally first five for four from further furthermore given go goes going gone good got great had
hadn't half has hasn't have haven't having he he's hello her here here's hers herself hey hi high him himself his
honestly how however i i'd i'll i'm i've if in inside instead into is isn't it it's its itself just last late later
latest least less let let's like likely little long look looks lot lots low made main make makes many may maybe me
meanwhile might mine more moreover most mostly much must my myself near nearly need needs neither never new next nine
no nobody none nor not nothing now nowhere obviously of off often oh ok okay old on once one only onto or other others
otherwise our ours ourselves out outside over overall own part per perhaps please plus quick quickly quite rather
really recently right same second see seems seen seven several she she's should shouldn't since six so some somebody
someone something sometimes somewhere soon still such sure ten than thank thanks that that's the their theirs them
themselves then there there's therefore these they they'd they'll they're they've thing things think third this those
though three through thus to today together tomorrow tonight too toward towards true twice two under unless until up
upon us very via was wasn't way we we'd we'll we're we've well were weren't what what's whatever when whenever where
whereas wherever whether which while who who's whoever whole whom whose why will with within without won't would
wouldn't yes yesterday yet you you'd you'll you're you've your yours yourself yourselves
action actions add added address addresses admin advice affected agent agents alert alerts allowed amount amounts
analysis analyst analysts app apps approval approvals approve approved asset assets attack attacked attacker attackers
attacks attempt audit audited auditors authorities back-end backdoor balance ban bank banks big bot bots breach breached
breaking bridge bridged bridges bug bugs build built bulletin call calls campaign case cases cash caught chain chains
change changed changes chat check checked checks claim claimed clone cloned clones code cold company confirmed contract
contracts control copy correction corrections court crime criminal crypto customer customers damage data day days deal
deep deepfake deepfakes defense delay deposit deposits detail details developer developers developing device devices
domain domains drain drained drainer drainers draining drains email emails employee employees end episode estimate
estimated estimates event events exchange exchanges exploit exploited exploits exposure fake fakes file files filing
filings fix fixes flag flagged flags flow flows follow-up fraud frozen fund funds gap guard hack hacked hacker hackers
hacks hardware headline help hidden hit hits hold holders hot incident incidents injection inside insider insiders
investigation investigators issue issues key keys law leak leaked leaks lesson lessons link links list loss losses lost
malicious malware market meanwhile message messages meter method mistake mixer model models money moved network
networks news note notes officials one-time online order outflow outflows owner owners password passwords patch
patched pattern payment people phishing phone platform platforms plugin plugins point police pool pools post posts
private problem project projects prompt prompts protocol protocols prosecutors public question quote rapid reason
recap recover recovered red reminder report reported reports researcher researchers response review rule rules safe
scam scammer scammers scams screen security seed sent server servers service services short shorts sign signed signer
signers signing site sites skill skills software source sources stablecoin stablecoins start statement stats steal
stealing step steps stole stolen story subscribe summary support supply swap swapped system systems takeaway target
team teams tell theft thread threat threats time timeline tip tips token tokens tool tools total tracker trade trading
transaction transactions transfer transfers trick tricked update updates upgrade upgraded user users verify victim
victims video voice wallet wallets warning watch website websites week weekend weekly what's why work worth wrong
monday tuesday wednesday thursday friday saturday sunday
`;
export const COMMON = new Set(COMMON_LIST.split(/\s+/).filter(Boolean));

/** Function words left out of content-word overlap (on top of COMMON's grammar words). */
const STOP_LIST = `
a about above after again against all also am an and any are as at be because been before being below between both
but by can could did do does doing down during each few for from further had has have having he her here hers him his
how i if in into is it its itself just me more most my no nor not now of off on once only or other our ours out over
own same she should so some such than that the their theirs them then there these they this those through to too
under until up very was we were what when where which while who whom why will with would you your yours
according said says say reported reports report stated states told tells added adds noted notes wrote writes posted
per via its it's also later since already still just around about roughly nearly almost approximately some
may might could would should must one two three
`;
const STOP = new Set(STOP_LIST.split(/\s+/).filter(Boolean));

const stemRaw = (word: string): string => {
	let s = stripPossessive(word.toLowerCase());
	if (s.length > 5 && s.endsWith('ies')) return s.slice(0, -3) + 'y';
	if (s.length > 5 && s.endsWith('ing')) s = s.slice(0, -3);
	else if (s.length > 4 && s.endsWith('ed')) s = s.slice(0, -2);
	else if (s.length > 4 && /(?:ss|x|ch|sh)es$/.test(s)) s = s.slice(0, -2);
	else if (s.length > 3 && s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
	if (s.length > 4 && s.endsWith('e')) s = s.slice(0, -1);
	return s;
};

// Synonym groups: paraphrases a script may use for the same fact. Keys are stemmed.
const SYNONYMS: Array<[string, string[]]> = [
	['attacker', ['attacker', 'attackers', 'hacker', 'hackers', 'exploiter', 'exploiters', 'thief', 'thieves', 'perpetrator', 'perpetrators', 'intruder', 'intruders']],
	['steal', ['steal', 'steals', 'stole', 'stolen', 'stealing', 'took', 'taken', 'take', 'takes', 'drain', 'drained', 'drains', 'draining', 'siphon', 'siphoned', 'extract', 'extracted', 'theft', 'heist', 'loot', 'looted']],
	['loss', ['loss', 'losses', 'lost', 'lose', 'loses', 'losing']],
	['compromise', ['compromise', 'compromised', 'breach', 'breached', 'hijack', 'hijacked', 'takeover']],
	['move', ['move', 'moved', 'moving', 'transfer', 'transferred', 'sent', 'send', 'left', 'outflow', 'outflows']],
	['freeze', ['freeze', 'froze', 'frozen', 'halt', 'halted', 'pause', 'paused', 'suspend', 'suspended']],
	['fake', ['fake', 'counterfeit', 'impersonat', 'spoof', 'spoofed', 'lookalike', 'look-alike']],
];
const SYN = new Map<string, string>();
for (const [canon, words] of SYNONYMS) for (const w of words) SYN.set(stemRaw(w), canon);

/** Stem with synonym folding: "drained" and "stole" both become "steal". */
export const stem = (word: string): string => {
	const s = stemRaw(word);
	return SYN.get(s) ?? s;
};

/** Content stems of a text: no stop words, no numbers, no 1-2 letter words. `exclude` holds lower-case words to drop. */
export const contentStems = (text: string, exclude: Set<string> = new Set()): Set<string> => {
	const out = new Set<string>();
	for (const t of tokenize(normalizePunct(text))) {
		const w = stripPossessive(t.text.replace(/^[@$#]/, '')).toLowerCase();
		if (w.length < 3 || STOP.has(w) || exclude.has(w) || /\d/.test(w)) continue;
		for (const part of w.split('-')) if (part.length >= 3 && !STOP.has(part) && !exclude.has(part)) out.add(stem(part));
	}
	return out;
};

/** Share of `a` found in `b` (1 when `a` is empty). */
export const coverage = (a: Set<string>, b: Set<string>): number => {
	if (!a.size) return 1;
	let n = 0;
	for (const x of a) if (b.has(x)) n++;
	return n / a.size;
};

export const clip = (s: string, n = 160): string => {
	const t = normSpace(s);
	return t.length <= n ? t : t.slice(0, n - 1).trimEnd() + '…';
};

export const unique = <T,>(xs: Iterable<T>): T[] => [...new Set(xs)];

/** Find every match of a global regex with its index (typed helper over matchAll). */
export const findAll = (re: RegExp, s: string): Array<{text: string; index: number; groups: Record<string, string | undefined>}> => {
	const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
	const g = new RegExp(re.source, flags);
	return [...s.matchAll(g)].map((m) => ({text: m[0], index: m.index ?? 0, groups: (m.groups ?? {}) as Record<string, string | undefined>}));
};
