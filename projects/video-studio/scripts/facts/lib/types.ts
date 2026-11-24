/**
 * Fact bank contracts, v1 (2026-11-24). content/facts/facts.jsonl holds one Fact per line (JSON Lines, sorted by id).
 * A fact is verified once, carries its sources, and is reused in every episode and language: a storyboard cites it as
 * [fact:<id>] and `node scripts/facts/cli.ts to-storyboard` turns that into the claim gate's [src:<id>] + sources[].
 * Runtime: Node >= 22.18 runs these .ts files directly (type stripping), so only erasable TypeScript is used.
 */

/**
 * How the fact was last confirmed against its sources.
 * - direct-read: an excerpt was found on the live page, by `verify` (a direct fetch) or by a person in a browser (`confirm`).
 * - search-extract: the excerpt was seen only in a search engine's extract of the page; nobody opened the page.
 * - unverified: never verified, or a direct read no longer finds any excerpt. to-storyboard refuses it.
 */
export const VERIFICATIONS = ['direct-read', 'search-extract', 'unverified'] as const;
export type Verification = (typeof VERIFICATIONS)[number];

/** primary: the original document (filing, regulator release, paper, the company's own post or data). secondary: a news outlet with editors. tertiary: aggregators, flash news, explainers, vendor blogs, social posts. */
export const TIERS = ['primary', 'secondary', 'tertiary'] as const;
export type Tier = (typeof TIERS)[number];

/** volatile: figures that move (prices, totals to date, live programmes, open court cases). historical: settled past events. */
export const VOLATILITIES = ['volatile', 'historical'] as const;
export type Volatility = (typeof VOLATILITIES)[number];

/** Days a verification stays fresh (owner rule, 2026-11-24): volatile 30, historical 365. */
export const RECHECK_DAYS: Record<Volatility, number> = {volatile: 30, historical: 365};

/** Languages a fact's statement can be translated into (the storyboard languages other than English; fr is excluded). */
export const TRANSLATION_LANGS = ['es', 'pt-br', 'hi', 'it', 'zh', 'ja'] as const;
export type TranslationLang = (typeof TRANSLATION_LANGS)[number];

/** Who read the source: the verify command (direct fetch), a person in a browser (confirm), or a search engine extract. */
export const CHECKERS = ['verify', 'person', 'search'] as const;
export type Checker = (typeof CHECKERS)[number];

/**
 * found: the excerpt is on the page (or in the search extract). missing: the page was read and the excerpt is not on it.
 * unreachable: the page could not be read (blocked, bot challenge, timeout, not HTML). not-allowed: the host is not on
 * the fetch allowlist (content/facts/hosts.json), so nothing was fetched.
 */
export const CHECK_RESULTS = ['found', 'missing', 'unreachable', 'not-allowed'] as const;
export type CheckResult = (typeof CHECK_RESULTS)[number];

export type SourceCheck = {
	at: string; // YYYY-MM-DD (America/Chicago)
	by: Checker;
	result: CheckResult;
	detail?: string; // "HTTP 403 (Cloudflare bot challenge)", "matched in page text", a person's role or initials for confirm
};

export type FactSource = {
	url: string; // https only
	title: string; // the article or document title
	/**
	 * Optional. What the on-screen sources card shows instead of the headline, when the headline overstates the claim
	 * or repeats a must-not-say line ("...Gaslit Into Losing Millions"). Names the publisher; never invents a headline.
	 */
	cardTitle?: string;
	publisher?: string; // "The Block", "Decrypt", "SEC"
	published?: string; // YYYY-MM-DD the page was published, when known
	tier: Tier;
	accessed: string; // YYYY-MM-DD the excerpt was last read (on the page, or in the search extract)
	/**
	 * At most 280 characters, copied from the page, that contain the claim's numbers or entities. An ellipsis (… or ...)
	 * may join two passages of the same page, in page order. Never a paraphrase.
	 */
	excerpt: string;
	/** Every check of this source, oldest first (the last 10 are kept). */
	checks: SourceCheck[];
};

export type Translation = {
	statement: string;
	translation: 'machine' | 'human'; // machine = an agent or MT; human = a person translated it
	reviewed?: boolean; // a native speaker reviewed it (the owner sets this)
};

export type Fact = {
	id: string; // [a-z0-9-], 3-64 chars; cited as [fact:<id>]
	/** One atomic claim in English, attributed when it is someone's estimate ("Bubblemaps estimated..."). */
	statement: string;
	/** Every figure in the statement as written there, qualifier included ("about 850,000", "68.67%", "January 19, 2024"). */
	numbers: string[];
	/** Organisations, products, places and named events in the claim. Never private individuals. "A|B" lists aliases. */
	entities: string[];
	tags: string[]; // topic tags, lower-case kebab: "pump-fun", "ai-agents", "regulation"
	volatility: Volatility;
	verification: Verification;
	verifiedAt: string | null; // YYYY-MM-DD; null when unverified
	recheckAfter: string | null; // YYYY-MM-DD: the last day the fact counts as fresh; null when unverified
	sources: FactSource[];
	languages: Partial<Record<TranslationLang, Translation>>;
	usage: string[]; // "<channel>/<slug>" of every episode that cites the fact (written by to-storyboard)
	notes: string; // how to say it safely, caveats, provenance
};

/** A validation or tool finding. Messages never contain a private name (they say "private name #N"). */
export type Finding = {
	level: 'error' | 'warning';
	rule: string; // stable id: "excerpt-numbers", "number-not-listed", "stale", "private-name"...
	fact?: string; // fact id
	where: string; // "statement", "sources[1].excerpt", "line 12"
	message: string;
};
