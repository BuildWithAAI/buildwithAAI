/**
 * Text lint for everything the kit publishes: income and return claims, placeholders, and links.
 * Claims are refused even when quoting a scam: describe the trick without repeating its pitch
 * (the same stance as creator-hub/tools/newsletter/lint.ts). Price predictions and "buy" calls are refused too.
 */

export type Rule = {label: string; pattern: RegExp};

/** Income, return, guarantee and price-call wording. Never allowed in titles, descriptions or posts. */
export const INCOME_CLAIMS: readonly Rule[] = [
	{label: 'guaranteed', pattern: /\bguarantee[ds]?\b/i},
	{label: 'risk-free', pattern: /\brisk[\s-]?free\b|\b(?:no|zero)[\s-]risk\b|\bwithout (?:any )?risk\b/i},
	{label: 'get rich', pattern: /\bget(?:ting)?[\s-]rich\b|\brich[\s-]quick\b/i},
	{label: 'passive income', pattern: /\bpassive[\s-]income\b/i},
	{label: 'financial freedom', pattern: /\bfinancial(?:ly)?[\s-]free(?:dom)?\b/i},
	{label: 'double your money', pattern: /\b(?:double|triple) your (?:money|crypto|investment|portfolio|savings)\b/i},
	{label: 'a 100x-style multiplier', pattern: /(?<![\w$.,])\d{2,}\s?x\b(?!\s?\d)|\bx\d{2,}\b/i},
	{label: 'make money fast', pattern: /\bmake (?:money|cash|\$\s?\d[\d,]*k?) (?:fast|quick(?:ly)?|online|overnight|while you sleep)\b/i},
	{label: 'an earnings figure', pattern: /\b(?:earn|make|made|earned)\s+(?:up to\s+)?\$\s?\d/i},
	{label: 'quit your job', pattern: /\bquit your (?:day )?job\b/i},
	{label: 'to the moon', pattern: /\bto the moon\b|\bmoon[\s-]?shot\b/i},
	{label: 'a price target', pattern: /\bprice target\b|\b(?:will|going to|gonna) (?:hit|reach|go to) \$\s?\d/i},
	{label: 'life-changing money', pattern: /\blife[\s-]changing (?:money|wealth|gains|returns|income)\b/i},
	{label: 'a sure thing', pattern: /\bsure[\s-](?:thing|fire|bet|win)\b/i},
	{label: 'a buy call', pattern: /\bbuy (?:now|before it|while it)\b|\bape (?:in|into)\b|\bload up on\b/i},
];

export const PLACEHOLDERS: readonly Rule[] = [
	{label: 'a placeholder word', pattern: /\b(?:TODO|TBD|FIXME|REPLACE(?:_ME)?|PLACEHOLDER)\b/},
	{label: 'lorem ipsum', pattern: /\blorem ipsum\b/i},
	{label: 'a bracketed placeholder', pattern: /\[[A-Z][A-Z0-9 _-]{2,}\]/},
	{label: 'an example.com link', pattern: /\bexample\.(?:com|org|net)\b/i},
];

export type Hit = {label: string; match: string; where: string};

export const findRules = (rules: readonly Rule[], text: string, where: string): Hit[] =>
	rules.flatMap((rule) => {
		const m = rule.pattern.exec(text);
		return m ? [{label: rule.label, match: m[0], where}] : [];
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
