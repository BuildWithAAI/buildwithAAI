/**
 * Synonyms for the similarity score (pure data plus builders). A back-translation rarely reuses the source's exact
 * words ("check" comes back as "review", "chart" as "graph"), so word families that mean the same thing in this
 * channel's register are merged before tokens are compared.
 *
 *  - SAME: full credit. Keep these tight: two words go in one group only if swapping them never changes what a viewer
 *    would understand ("buy"/"purchase", yes; "top"/"famous", no: that is exactly the drift a reviewer must see).
 *  - NEAR: partial credit (NEAR_CREDIT). Related but not equal ("coin"/"token", "call"/"signal").
 *  - PHRASES: multi-word expressions rewritten to one word before tokenizing ("keep an eye on" -> "watch").
 * Negations, modals, hedges and numbers are NOT here: they have their own checks and never count as similar.
 */
import {stem} from './stem.ts';

const SAME: string[][] = [
	['check', 'verify', 'review', 'inspect', 'examine', 'checking', 'verification'],
	['buy', 'purchase', 'buyer', 'purchaser'],
	['sell', 'seller'],
	['chart', 'graph'],
	['post', 'publish', 'publication'],
	['fast', 'quick', 'quickly', 'rapid', 'rapidly', 'swift', 'swiftly', 'speed', 'rapidity', 'quickness', 'fastly'],
	['jump', 'leap', 'spike', 'surge', 'soar', 'skyrocket', 'shoot'],
	['floor', 'ground'],
	['disappear', 'vanish', 'gone'],
	['scream', 'shout', 'yell', 'screaming', 'shouting', 'yelling'],
	['quiet', 'quietly', 'silent', 'silently', 'silence'],
	['build', 'create', 'creation'],
	['famous', 'renowned', 'celebrated'],
	['fake', 'false', 'bogus', 'counterfeit', 'phony'],
	['scam', 'fraud', 'swindle'],
	['scammer', 'fraudster', 'swindler', 'conman'],
	['warn', 'warning', 'alert', 'caution'],
	['ask', 'request'],
	['start', 'begin', 'beginning'],
	['end', 'finish'],
	['next', 'following'],
	['watch', 'monitor', 'observe'],
	['happen', 'occur'],
	['everyone', 'everybody'],
	['someone', 'somebody'],
	['anyone', 'anybody'],
	['fictional', 'fictitious', 'fiction', 'invented'],
	['dialogue', 'dialog'],
	['stranger', 'unknown', 'strangers'],
	['avoid', 'avoided', 'avoiding'],
	['wallet', 'billfold'],
	['link', 'url', 'hyperlink'],
	['attacker', 'hacker'],
	['funds', 'money'],
	['support', 'helpdesk'],
	['host', 'presenter'],
	['subscribe', 'subscription'],
	['source', 'sources'],
	['story', 'stories'],
	['big', 'large'],
	['small', 'little'],
	['real', 'genuine', 'actual'],
	['delay', 'timelock'],
	['drain', 'emptied'],
	['explain', 'explained', 'explainer'],
	['launch', 'release'],
	['sudden', 'abrupt', 'suddenly', 'abruptly'],
	['save', 'rescue', 'spare'],
	['show', 'display'],
	['demo', 'demonstration'],
	['move', 'transfer'],
	['across', 'cross'],
	['multisig', 'multisignature', 'multisigs'],
	['analytics', 'analysis', 'analyses', 'analytical'],
	['firm', 'company'],
	['label', 'mark'],
	['investigation', 'probe', 'inquiry'],
];

const NEAR: string[][] = [
	['coin', 'token', 'currency'],
	['call', 'signal', 'tip'],
	['trade', 'operation', 'transaction', 'deal'],
	['look', 'see', 'check'],
	['price', 'value'],
	['jump', 'rise', 'climb', 'increase', 'high', 'pump', 'pumping'],
	['floor', 'bottom'],
	['scream', 'cry', 'hype'],
	['early', 'soon', 'first'],
	['top', 'best', 'leading', 'biggest', 'greatest'],
	['make', 'build', 'create'],
	['steal', 'drain', 'take'],
	['attack', 'exploit', 'hack', 'breach'],
	['page', 'site', 'website', 'web'],
	['message', 'dm', 'text', 'write'],
	['fix', 'solution', 'tip', 'advice'],
	['red', 'warning', 'alarm'],
	['flag', 'sign', 'signal'],
	['wallet', 'purse', 'portfolio'],
	['game', 'scheme', 'play'],
	['work', 'function', 'operate'],
	['person', 'people', 'folk'],
	['composite', 'combined', 'compound'],
	['character', 'figure', 'persona'],
	['big', 'huge', 'massive', 'enormous'],
	['small', 'tiny'],
	['upgrade', 'update', 'change'],
	['quiet', 'discreet', 'discreetly', 'secret', 'secretly'],
	['move', 'pass', 'send'],
	['newly', 'recently', 'fresh'],
	['brief', 'summary', 'roundup', 'digest'],
	['put', 'keep', 'store', 'place', 'hold'],
	['hype', 'euphoria', 'buzz', 'frenzy', 'mania'],
	['side', 'secondary', 'alternate', 'auxiliary'],
	['sell', 'sale', 'selloff', 'dump'],
	['burst', 'wave', 'flurry', 'rush'],
	['bleed', 'agony', 'decline'],
	['big', 'mass', 'massive'],
	['hold', 'have', 'own', 'control'],
	['number', 'figure', 'amount'],
	['advice', 'consultancy', 'consulting', 'guidance', 'recommendation'],
	['host', 'accompany', 'companion'],
	['gone', 'lost', 'lose'],
];

/** Partial credit for a NEAR match. */
export const NEAR_CREDIT = 0.6;

/** Multi-word expressions -> one token (applied to lowercased English text). */
export const PHRASES: Array<[RegExp, string]> = [
	[/\b(?:keep|keeps|kept|keeping) (?:an |a close )?eye on\b/g, 'watch'],
	[/\b(?:look|looks|looked|looking) (?:out )?for\b/g, 'watch'],
	[/\b(?:take|takes|took|taking) a look at\b/g, 'check'],
	[/\b(?:look|looks|looked|looking) at\b/g, 'look'],
	[/\bmake sure\b/g, 'ensure'],
	[/\bfind out\b/g, 'discover'],
	[/\bgo wrong\b/g, 'fail'],
	[/\bgoes wrong\b/g, 'fail'],
	[/\bwent wrong\b/g, 'fail'],
	[/\bturn out\b/g, 'prove'],
	[/\bpump and dump\b/g, 'pumpdump'],
	[/\brug pull\b/g, 'rugpull'],
	[/\bseed phrase\b/g, 'recovery phrase'],
	[/\bsecret recovery phrase\b/g, 'recovery phrase'],
	[/\bdirect message\b/g, 'dm'],
	[/\bdms?\b/g, 'dm'],
	[/\bartificial intelligence\b/g, 'ai'],
	[/\bno one\b/g, 'nobody'],
	[/\bright away\b/g, 'immediately'],
	[/\bon the spot\b/g, 'immediately'],
	[/\binstantly\b/g, 'immediately'],
	[/\bat once\b/g, 'immediately'],
	[/\bin public\b/g, 'publicly'],
	[/\bover and over\b/g, 'repeatedly'],
	[/\bis worth it\b/g, 'worth'],
	[/\bmade[- ]up\b/g, 'invented'],
	[/\b(?:would|'d) rather\b/g, 'prefer'],
	[/\b(?:run|runs|running|ran|go|goes|going|went) after\b/g, 'chase'],
	[/\bsees? (?=(?:day|the (?:second|next|first) day)\b)/g, 'reach '],
	[/\bpays off\b/g, 'worth'],
];

const sameMap = new Map<string, string>();
for (const group of SAME) {
	const canon = stem(group[0]);
	for (const w of group) {
		const s = stem(w);
		if (!sameMap.has(s)) sameMap.set(s, canon);
	}
}

/** Canonical stem for a stem (after SAME merging). */
export const canonical = (s: string): string => sameMap.get(s) ?? s;

const nearPairs = new Set<string>();
for (const group of NEAR) {
	const stems = [...new Set(group.map((w) => canonical(stem(w))))];
	for (const a of stems) for (const b of stems) if (a !== b) nearPairs.add(`${a}|${b}`);
}

/** true when two canonical stems are NEAR (partial credit). */
export const isNear = (a: string, b: string): boolean => nearPairs.has(`${a}|${b}`);

export const applyPhrases = (lower: string): string => {
	let t = lower;
	for (const [re, rep] of PHRASES) t = t.replace(re, rep);
	return t;
};
