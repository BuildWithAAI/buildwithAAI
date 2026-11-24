/**
 * Income, return, price and guarantee claims: one rule set for every creator-hub tool that publishes text
 * (the newsletter lint, the studio config check). It covers the same claims as the publish kit's
 * INCOME_CLAIMS (video-studio/scripts/publish-kit/lint.ts), including the cases a 2026-11-24 review found
 * missing: earnings figures in any currency or coin, percentage returns, "could hit $500", "turn $100 into
 * $10,000", "you can't lose", "100% safe", "profit every day", sign-up bonuses, short-term multipliers and
 * get-in-early calls. The server cannot import the kit's file (the hub's image holds creator-hub only), so
 * the two lists are kept in step by hand.
 *
 * The rules match claims even when they are quoted or denied, because an email or a description is read
 * in pieces: describe a scam's trick without repeating its pitch. Callers that check the owner's own copy
 * about the studio can allow denied claims and questions ("Do you guarantee views? No.") with
 * `allowDenied`.
 */

/** `unlessDenied`: a match after a denial in the same sentence ("No wallet is 100% safe") is not a claim. */
export type ClaimRule = {label: string; pattern: RegExp; unlessDenied?: boolean};

const MONEY = String.raw`(?:[$€£¥₹]\s?\d[\d,.]*\s?(?:k|m|million|thousand)?\b|\d[\d,.]*\s?(?:k\s)?(?:usd|usdt|usdc|dollars?|euros?|pounds?|btc|bitcoin|eth|ether|sol|bnb)\b)`;
const MONTHS = 'january|february|march|april|may|june|july|august|september|october|november|december';

/** Never allowed in published text. Each phrase in the tests trips exactly one rule. */
export const INCOME_CLAIMS: readonly ClaimRule[] = [
	{label: 'guaranteed', pattern: /\bguarantee[ds]?\b/i},
	{label: 'risk-free', pattern: /\brisk[\s-]?free\b|\b(?:no|zero)[\s-]risk\b|\bwithout (?:any )?risk\b/i},
	{label: 'get rich', pattern: /\bget(?:ting)?[\s-]rich\b|\brich[\s-]quick\b/i},
	{label: 'passive income', pattern: /\bpassive[\s-]income\b/i},
	{label: 'a 100x-style multiplier', pattern: /(?<![\w$.,])(?:\d{1,3}(?:,\d{3})+|\d{2,})\s?x\b(?!\s?\d)|\bx\d{2,}\b/i},
	{label: 'a short-term multiplier', pattern: /\b(?:easy|quick|fast|guaranteed|will|could|can|going to|gonna)\s+[2-9]\s?x\b|\b[2-9]\s?x\s+(?:in|within)\s+(?:a|one|\d+|the next)\s*(?:hour|day|week|month)s?\b/i},
	{label: 'double your money', pattern: /\b(?:double|triple) your (?:money|crypto|investment|portfolio|savings)\b/i},
	{label: 'financial freedom', pattern: /\bfinancial(?:ly)?[\s-]free(?:dom)?\b/i},
	{label: 'make money fast', pattern: /\bmake (?:money|cash|\$\s?\d[\d,]*k?) (?:fast|quick(?:ly)?|online|overnight|while you sleep)\b/i},
	{label: 'an earnings figure', pattern: new RegExp(String.raw`\b(?:earn(?:s|ed|ing)?|make|makes|made|making|net(?:s|ted)?|pocket(?:s|ed)?)\s+(?:up to\s+|about\s+|over\s+|around\s+|nearly\s+|almost\s+)?${MONEY}`, 'i')},
	{label: 'turning a sum into more', pattern: new RegExp(String.raw`\b(?:turn(?:s|ed|ing)?|grow(?:s|n|ing)?|grew|flip(?:s|ped|ping)?)\s+(?:my\s+|your\s+|a\s+)?${MONEY}\s+into\b`, 'i')},
	{
		// "20% monthly returns", "300% APY", "earn 20%", "returns of 5% a week"; not "10% off", "I earn 20% of the fees"
		label: 'a percentage return',
		pattern: /\b\d+(?:\.\d+)?\s?%\s*(?:(?:a|per|every|each)\s+)?(?:day|daily|week|weekly|month|monthly|year|yearly|annual(?:ly)?)\s+(?:returns?|yield|interest|profits?|gains?|income|roi|payouts?|rewards?)\b|\b\d+(?:\.\d+)?\s?%\s*(?:apy|apr|roi)\b|(?<!\b(?:i|we)\s+)\b(?:earn(?:s|ing)?|get|gets|make|makes|receive|pays?|paying|yields?|yielding)\s+(?:up to\s+|over\s+|about\s+)?\d+(?:\.\d+)?\s?%(?!\s*(?:off|of|discount|cash\s?back|rebate)\b)|\b(?:returns?|yield|interest|profits?|gains?|roi)\s+of\s+(?:up to\s+|over\s+)?\d+(?:\.\d+)?\s?%/i,
	},
	{label: 'quit your job', pattern: /\bquit your (?:day )?job\b/i},
	{label: 'to the moon', pattern: /\bto the moon\b|\bmoon[\s-]?shot\b/i},
	{
		label: 'a price target',
		pattern: new RegExp(
			String.raw`\bprice target\b|\b(?:will|going to|gonna|could|can|might|may|should|set to|about to)\s+(?:hit|reach|touch|see|go to|top|break|cross|be at)?\s*\$\s?\d|\b(?:heading|headed|on (?:its|the) way)\s+(?:to|for)\s+\$\s?\d|\bto\s+\$\s?\d[\d,.]*\s?k?\s+by\s+(?:the\s+end\s+of\s+)?(?:(?:next|this)\s+)?(?:${MONTHS}|20\d\d|year|month|week|christmas|summer|spring|fall|autumn|winter|q[1-4])\b`,
			'i',
		),
	},
	{label: 'life-changing money', pattern: /\blife[\s-]changing (?:money|wealth|gains|returns|income)\b/i},
	{label: 'a sure thing', pattern: /\bsure[\s-](?:thing|fire|bet|win)\b/i},
	{label: 'a "cannot lose" promise', pattern: /\b(?:can(?:no|['’])t|can not|cannot|won['’]?t|will not) (?:possibly )?lose\b(?!\s+(?:your|the|access|it|them|track|sight)\b)/i},
	{
		label: 'a safety promise',
		pattern: /\b100\s?%\s+(?:safe|secure|sure|legit|risk[\s-]?free|protected)\b|\bsafe (?:investments?|returns|yields?|profits?|gains|income)\b/i,
		unlessDenied: true,
	},
	{label: 'steady profits', pattern: /\bprofits? every (?:single )?(?:day|week|month)\b|\b(?:daily|weekly|monthly) profits?\b/i},
	{label: 'a buy call', pattern: /\bbuy (?:now|before it|while it)\b|\bape (?:in|into)\b|\bload up on\b|\bget in (?:early|now|before)\b/i},
	{
		label: 'a sign-up or deposit bonus',
		pattern: /\b(?:sign[\s-]?up|welcome|deposit|referral|joining|new[\s-]user|first[\s-]trade|trading|registration|free|matched?)\s+bonus(?:es)?\b|\bbonus(?:es)?\s+(?:when|if|for)\s+(?:you\s+)?(?:sign|join|deposit|trade|register|refer|invite)|\b(?:get|claim|grab|unlock|receive)\s+(?:a\s+|an\s+|your\s+|the\s+|up\s+to\s+)?(?:[$€£¥₹]\s?\d[\d,.]*k?\s+)?bonus\b|[$€£¥₹]\s?\d[\d,.]*k?\s+bonus\b/i,
	},
];

/** Only for the studio's own sales copy: a promise of audience or sales numbers ("get 100k views"). */
export const RESULT_PROMISES: readonly ClaimRule[] = [
	{
		label: 'a promise of results',
		pattern: /\b(?:get|gets|reach|gain|hit|deliver|delivers|bring|brings|drive|drives)\s+(?:you\s+)?(?:up to\s+|over\s+|at least\s+)?\d[\d,.]*\s?k?\+?\s*(?:views|subscribers|subs|followers|holders|sign-?ups|sales|users|customers|leads|buyers)\b/i,
	},
];

export type ClaimHit = {label: string; match: string; index: number};

/** Words that deny the claim that follows them in the same sentence: "we do not guarantee views". */
const DENIAL = /\b(?:no|not|never|don['’]?t|do not|doesn['’]?t|does not|didn['’]?t|did not|cannot|can['’]?t|won['’]?t|will not|without|nobody|no one|neither|nor)\b/i;

const sentenceAround = (text: string, index: number, length: number): {before: string; whole: string} => {
	const start = Math.max(text.lastIndexOf('.', index - 1), text.lastIndexOf('!', index - 1), text.lastIndexOf('?', index - 1), text.lastIndexOf('\n', index - 1)) + 1;
	const ends = ['.', '!', '?', '\n'].map((c) => text.indexOf(c, index + length)).filter((i) => i >= 0);
	const end = ends.length ? Math.min(...ends) + 1 : text.length;
	return {before: text.slice(start, index), whole: text.slice(start, end)};
};

/**
 * Every claim in `text`, one per rule (the first match of each). With `allowDenied`, a claim in a question
 * or after a denial in the same sentence is not counted.
 */
export const findClaims = (text: string, options: {rules?: readonly ClaimRule[]; allowDenied?: boolean} = {}): ClaimHit[] => {
	const hits: ClaimHit[] = [];
	for (const rule of options.rules ?? INCOME_CLAIMS) {
		const flags = rule.pattern.flags.includes('g') ? rule.pattern.flags : `${rule.pattern.flags}g`;
		for (const match of text.matchAll(new RegExp(rule.pattern.source, flags))) {
			if (options.allowDenied || rule.unlessDenied) {
				const sentence = sentenceAround(text, match.index, match[0].length);
				if (DENIAL.test(sentence.before)) continue;
				if (options.allowDenied && sentence.whole.trimEnd().endsWith('?')) continue;
			}
			hits.push({label: rule.label, match: match[0], index: match.index});
			break;
		}
	}
	return hits;
};
