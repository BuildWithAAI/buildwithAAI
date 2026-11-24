/**
 * Text lint for everything the kit publishes, the narration included: income, return and price claims,
 * placeholders, and links. Claims are refused even when quoting a scam: describe the trick without repeating its
 * pitch (the same stance as creator-hub/tools/newsletter/lint.ts). Price predictions, "buy" calls and sign-up
 * bonuses are refused too. This file imports nothing, so other tools can share it.
 */

/** `unlessNegated`: a match right after a negation ("No wallet is 100% safe") is not a claim. */
export type Rule = {label: string; pattern: RegExp; unlessNegated?: boolean};

const MONEY = String.raw`[$£€¥₹]\s?\d[\d,.]*(?:\s?(?:k|m|bn|million|billion)\b)?`; // $500, €1,000, $250k
const UNIT = String.raw`(?:USD[TC]?|ETH|BTC|SOL|BNB|XRP|DOGE|dollars?|pounds?|euros?|bucks|coins?|tokens?)`;
const AMOUNT = String.raw`(?:${MONEY}|\d[\d,.]*\s?(?:k|m|bn)?\s?${UNIT}\b)`; // a money amount, or a number of coins
const EARN = String.raw`(?:earn(?:s|ed|ing)?|make|makes|making|made|profit(?:s|ed)?)`;
const PERIOD = String.raw`(?:(?:a|an|per|every|each)\s+(?:single\s+)?(?:day|week|month|year|hour)|daily|weekly|monthly|yearly|annually|hourly)`;
const PERCENT = String.raw`\d+(?:[.,]\d+)?\s?%`;
const SOON = String.raw`(?:easily|soon|probably|definitely|likely|eventually|quickly|surely|literally|actually|even|still)`;
const MOVE = String.raw`(?:hit|reach|touch|break|top|pass|cross|flip|retest|test|see|climb to|rise to|rally to|pump to|run to|go to|jump to|soar to|shoot to|be worth|trade at|trade above)`;
const RULE = (source: string, flags = 'i'): RegExp => new RegExp(source, flags);

/** Income, return, guarantee, price-call and incentive wording. Never allowed in titles, descriptions, posts or narration. */
export const INCOME_CLAIMS: readonly Rule[] = [
	{label: 'guaranteed', pattern: /\bguarantee[ds]?\b/i},
	{label: 'risk-free', pattern: /\brisk[\s-]?free\b|\b(?:no|zero)[\s-]risk\b|\bwithout (?:any )?risk\b/i},
	{label: 'get rich', pattern: /\bget(?:ting)?[\s-]rich\b|\brich[\s-]quick\b/i},
	{label: 'passive income', pattern: /\bpassive[\s-]income\b/i},
	{label: 'financial freedom', pattern: /\bfinancial(?:ly)?[\s-]free(?:dom)?\b/i},
	{label: 'double your money', pattern: /\b(?:double|triple) your (?:money|crypto|investment|portfolio|savings)\b/i},
	{label: 'a 100x-style multiplier', pattern: /(?<![\w$.,])(?:\d{1,3}(?:,\d{3})+|\d{2,})\s?x\b(?!\s?\d)|\bx\d{2,}\b/i},
	{label: 'make money fast', pattern: /\bmake (?:money|cash|\$\s?\d[\d,]*k?) (?:fast|quick(?:ly)?|online|overnight|while you sleep)\b/i},
	// "I made $5,000", "Earn £300 a week", "I earned 5 ETH in a week"
	{label: 'an earnings figure', pattern: RULE(String.raw`\b${EARN}\s+(?:up to\s+|over\s+|more than\s+|at least\s+|about\s+|around\s+|nearly\s+)?${AMOUNT}`)},
	// "20% monthly returns", "300% APY", "Get 1% daily"
	{
		label: 'a percentage return',
		pattern: RULE(
			String.raw`\b${PERCENT}\s?(?:(?:daily|weekly|monthly|yearly|annual|guaranteed|fixed|passive|average)\s+)?(?:APY|APR|ROI|returns?|yields?|interest|profits?|gains?)\b|\b(?:${EARN}|get(?:s|ting)?|receive|pays?|paid|paying|returns?|yields?|generates?|gain(?:s|ed)?)\s+(?:up to\s+|over\s+|at least\s+|about\s+)?${PERCENT}\s?${PERIOD}\b`,
		),
	},
	{label: 'a regular-income promise', pattern: /\b(?:profits?|earnings|income|returns|gains|payouts?)\s+(?:every|each|per)\s+(?:single\s+)?(?:day|week|month|hour)\b|\b(?:daily|weekly|monthly)\s+(?:profits?|payouts?|income|returns|earnings)\b/i},
	{label: 'quit your job', pattern: /\bquit your (?:day )?job\b/i},
	{label: 'to the moon', pattern: /\bto the moon\b|\bmoon[\s-]?shot\b/i},
	{label: 'a price target', pattern: /\bprice target\b|\b(?:will|going to|gonna) (?:hit|reach|go to) \$\s?\d/i},
	// "SOL could hit $500", "heading to $1", "BTC to $250k by December"
	{
		label: 'a price prediction',
		pattern: RULE(
			String.raw`\b(?:could|can|might|may|will|would|should|gonna|(?:set|about|poised|expected|predicted|projected|likely|bound|going) to)\s+(?:${SOON}\s+)?${MOVE}\s+(?:over\s+|above\s+|past\s+)?${MONEY}|\b(?:heading|headed|on track|on (?:its|their|the) way|going|gonna go)\s+(?:for|to|towards?)\s+${MONEY}|\bto\s+${MONEY}\s+(?:by|before|in)\s+(?:the\s+)?(?:end\s+of\s+|next\s+|this\s+|early\s+|late\s+|mid[\s-]?)?(?:\d{4}|year|month|week|summer|winter|spring|fall|autumn|christmas|q[1-4]|january|february|march|april|may|june|july|august|september|october|november|december)\b`,
		),
	},
	{label: 'life-changing money', pattern: /\blife[\s-]changing (?:money|wealth|gains|returns|income)\b/i},
	{label: 'a sure thing', pattern: /\bsure[\s-](?:thing|fire|bet|win)\b/i},
	{
		label: 'a no-lose promise',
		pattern: /\b(?:can(?:not|['’]t| not)|could(?:n['’]t| not))\s+(?:possibly\s+|ever\s+|really\s+)?lose(?=\s*(?:[.!?,;:)]|$)|\s+(?:money|a (?:single )?(?:penny|cent|dime|dollar)|anything|here|with (?:this|it)|on (?:this|it)|if you|when you|either way)\b)|\bimpossible to lose\b|\b(?:no way|zero chance) (?:you|to) (?:can |could |will )?lose\b/i,
	},
	// "Turn $100 into $10,000", "turned 1 ETH into 50"
	{label: 'a turn-X-into-Y promise', pattern: RULE(String.raw`\bturn(?:s|ed|ing)?\s+(?:your\s+|my\s+|a\s+|just\s+|only\s+)?${AMOUNT}[^.!?\n]{0,40}?\binto\b`)},
	{
		label: 'a safety promise',
		pattern: /\b100\s?%\s(?:safe|secure|guaranteed|risk[\s-]?free|legit|protected)\b|\bsafe (?:investments?|returns|yields?|profits?|gains|income)\b/i,
		unlessNegated: true,
	},
	{
		label: 'a sign-up or deposit bonus',
		pattern: RULE(
			String.raw`\b(?:sign[\s-]?up|welcome|deposit|referral|joining|new[\s-]user|first[\s-]trade|trading|registration|free|matched?)\s+bonus(?:es)?\b|\bbonus(?:es)?\s+(?:when|if|for)\s+(?:you\s+)?(?:sign|join|deposit|trade|register|refer|invite)|\b(?:get|claim|grab|unlock|receive)\s+(?:a\s+|an\s+|your\s+|the\s+|up\s+to\s+)?(?:${MONEY}\s+)?bonus\b|${MONEY}\s+bonus\b`,
		),
	},
	{label: 'a buy call', pattern: /\bbuy (?:now|before it|while it)\b|\bape (?:in|into)\b|\bload up on\b/i},
];

export const PLACEHOLDERS: readonly Rule[] = [
	{label: 'a placeholder word', pattern: /\b(?:TODO|TBD|FIXME|REPLACE(?:_ME)?|PLACEHOLDER)\b/},
	{label: 'lorem ipsum', pattern: /\blorem ipsum\b/i},
	{label: 'a bracketed placeholder', pattern: /\[[A-Z][A-Z0-9 _-]{2,}\]/},
	{label: 'an example.com link', pattern: /\bexample\.(?:com|org|net)\b/i},
];

export type Hit = {label: string; match: string; where: string};

const NEGATION = /^(?:not|no|never|nor|neither|none|nothing|nobody|without|zero|cannot)$|n['’]t$/i;
/** A negation stops at clause punctuation or at a "but" that turns the sentence round. */
const CLAUSE_BREAK = /[.!?;:,\n]|\b(?:but|however|although|though|except)\b/gi;

/** True when one of the `words` words before `index`, in the same clause, is a negation ("not", "no", "isn't"...). */
export const negatedBefore = (text: string, index: number, words = 5): boolean => {
	const before = text.slice(Math.max(0, index - 40 * words), index); // a few words back is all that matters
	let from = 0;
	for (const m of before.matchAll(CLAUSE_BREAK)) from = (m.index ?? 0) + m[0].length;
	return before
		.slice(from)
		.split(/\s+/)
		.map((w) => w.replace(/^[^\p{L}]+|[^\p{L}'’]+$/gu, ''))
		.filter(Boolean)
		.slice(-words)
		.some((w) => NEGATION.test(w));
};

/** The first hit of each rule (a rule marked `unlessNegated` skips matches that follow a negation). */
export const findRules = (rules: readonly Rule[], text: string, where: string): Hit[] =>
	rules.flatMap((rule) => {
		const all = new RegExp(rule.pattern.source, rule.pattern.flags.includes('g') ? rule.pattern.flags : `${rule.pattern.flags}g`);
		for (const m of text.matchAll(all)) {
			if (!rule.unlessNegated || !negatedBefore(text, m.index ?? 0)) return [{label: rule.label, match: m[0], where}];
		}
		return [];
	});

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;
const TRAILING = /[.,!?:;)\]}'"”’]+$/;

/** Every http(s) URL in a text, without trailing punctuation. */
export const findUrls = (text: string): string[] => [...text.matchAll(URL_RE)].map((m) => m[0].replace(TRAILING, ''));

const YOUTUBE_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'];

export type LinkContext = {
	hubOrigin: string; // https://go.zoora.ai
	offerIds: readonly string[]; // ids that may appear in /go/<id>
	slug: string;
	sourceUrls: readonly string[]; // the episode's sources (allowed as-is)
	destinationHosts: readonly string[]; // registry destination hosts (never allowed)
};

/**
 * Checks the links in one text: offer links must be hub links (/go/<id>?v=<slug>&s=<source>) or the hub's link
 * page; YouTube and the episode's own sources are allowed; anything else, and any registry destination host
 * (even without a scheme), is a problem.
 */
export const checkLinks = (text: string, where: string, ctx: LinkContext): string[] => {
	const problems: string[] = [];
	const hubHost = new URL(ctx.hubOrigin).hostname.replace(/^www\./, '');
	// source links may point at an offer's site (e.g. its help centre); they carry no referral code
	const withoutSources = ctx.sourceUrls.reduce((t, url) => t.split(url).join(' '), text);
	for (const host of ctx.destinationHosts) {
		if (!host || host === hubHost || YOUTUBE_HOSTS.includes(host)) continue;
		const named = new RegExp(`(?<![a-z0-9.-])${host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9-])`, 'i');
		if (named.test(withoutSources)) problems.push(`${where}: names the raw destination "${host}"; offer links must go through the hub`);
	}
	for (const raw of findUrls(text)) {
		let url: URL;
		try {
			url = new URL(raw);
		} catch {
			problems.push(`${where}: invalid link ${raw}`);
			continue;
		}
		if (url.origin === ctx.hubOrigin) {
			const offer = /^\/go\/([a-z0-9-]{2,40})$/.exec(url.pathname);
			if (offer) {
				if (!ctx.offerIds.includes(offer[1])) problems.push(`${where}: hub link to "${offer[1]}", which is not one of this episode's offers`);
				if (url.searchParams.get('v') !== ctx.slug || !url.searchParams.get('s')) problems.push(`${where}: hub link ${raw} must carry v=${ctx.slug} and an s= source`);
			} else if (url.pathname !== '/') problems.push(`${where}: unexpected hub path ${url.pathname}`);
			continue;
		}
		if (YOUTUBE_HOSTS.includes(url.hostname)) continue;
		if (ctx.sourceUrls.includes(url.href) || ctx.sourceUrls.includes(raw)) continue;
		problems.push(`${where}: ${raw} does not go through the hub (only hub, YouTube and source links are allowed)`);
	}
	return problems;
};
