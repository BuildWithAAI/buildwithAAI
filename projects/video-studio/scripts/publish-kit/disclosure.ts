/**
 * Disclosure wording (FTC 16 CFR 255): what counts as saying a material connection out loud, what an offer
 * registry disclosure must say, and whether a text names an offer.
 */
import {negatedBefore} from './lint.ts';
import type {Relationship, ResolvedOffer} from './types.ts';

/** Spoken phrases that state a paid relationship: "this is an affiliate link", "I may earn a commission", "sponsored by". */
const PAID_PHRASES: readonly RegExp[] = [
	/\b(?:affiliate|referral|sponsored|partner|paid|tracking)\s+(?:links?|codes?|partnerships?|promotions?|relationships?|deals?)\b/gi,
	/\b(?:sponsored|paid for|brought to you)\s+by\b/gi,
	/\bsponsor(?:s|ed|ing)?\s+(?:of\s+)?(?:this|today['’]s)\s+(?:video|episode|show)\b/gi,
	/\b(?:I|we)(?:\s+(?:may|might|could|will|would|do|can|also))?\s+(?:earn|get|receive|make)\s+(?:a\s+|an\s+|some\s+)?(?:small\s+)?(?:commission|share|fees?|cut|money|reward|kickback)\b/gi,
	/\b(?:earns?|gets?|pays?)\s+(?:me|us)\s+(?:a\s+)?(?:small\s+)?(?:commission|share|fee|cut|money)\b/gi,
	/\b(?:I|we)\s*(?:get|got|was|were|am|are|['’]m|['’]re)\s+paid\b/gi,
	/\b(?:this|it)(?:\s+(?:video|episode))?(?:\s+is|['’]s)\s+(?:an?\s+)?(?:ad|advert|advertisement|sponsored|paid promotion)\b/gi,
];

/** Spoken phrases that state ownership: "I built this", "it's my own product". */
const OWN_PHRASES: readonly RegExp[] = [
	/\b(?:I|we)\s+(?:built|made|created|founded|co-founded|run|own|developed)\s+(?:this|it|that|the|a|an|our|my)\b/gi,
	/\b(?:my|our)\s+own\s+(?:product|project|app|tool|course|company|business|bot|service|platform|brand)\b/gi,
	/\b(?:this|it|that)(?:\s+is|['’]s)\s+(?:my|our)\s+(?:own\s+)?(?:product|project|app|tool|course|company|business|bot|service|platform|brand)\b/gi,
	/\bI\s*(?:am|['’]m)\s+(?:the\s+|a\s+)?(?:founder|co-founder|owner|creator|developer)\s+of\b/gi,
];

/** Spoken examples for the check's message, by relationship. */
export const SPOKEN_EXAMPLE: Record<Relationship, string> = {
	affiliate: 'the link in the description is an affiliate link, so I may earn a commission',
	referral: 'this is a referral link, and I earn a fee if you sign up',
	sponsor: 'this video is sponsored by <brand>',
	'own-product': 'I built this: it is my own product',
};

const norm = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * True when the spoken text discloses the offer's relationship: it reads out the registry disclosure, or uses a
 * phrase that states the relationship (ownership for own products). A phrase after a negation in the same clause
 * ("this is not an affiliate link", "no sponsor here") does not count.
 */
export const saysDisclosure = (spoken: string, offer: ResolvedOffer): boolean => {
	const registry = norm(offer.offer.disclosure);
	if (registry && norm(spoken).includes(registry)) return true;
	const phrases = offer.offer.relationship === 'own-product' ? OWN_PHRASES : PAID_PHRASES;
	return phrases.some((re) => [...spoken.matchAll(re)].some((m) => !negatedBefore(spoken, m.index ?? 0)));
};

/** Registry disclosures must name the relationship... */
const PAID_RELATIONSHIP = /\b(?:affiliate|referral|sponsor(?:ed|ship)?|paid|partner(?:ship)?|ad|advert(?:isement)?)\b/i;
const OWNERSHIP = /\b(?:own (?:product|project|app|tool|course|company|business|brand)s?|my own|our own|I own|we own|I built|we built|I made|we made|I created|we created|founder|co-founder|my company|our company)\b/i;
/** ...and that you benefit from it. */
const BENEFIT = /\b(?:earn\w*|commissions?|fees?|paid|pays?|payments?|money|share|rewards?|revenue|compensat\w*|sponsor(?:ed|ship)?|ad|advert(?:isement)?|cut|profit\w*|benefit\w*|sells?|selling)\b/i;

/** Why a registry disclosure does not disclose (empty when it does). */
export const disclosureWordingProblems = (disclosure: string, relationship: Relationship): string[] => {
	const own = relationship === 'own-product';
	const problems: string[] = [];
	if (!(own ? OWNERSHIP : PAID_RELATIONSHIP).test(disclosure)) {
		problems.push(own ? 'must say it is your own product (e.g. "My own product: I built this")' : 'must name the relationship (affiliate, referral, sponsored or paid)');
	}
	if (!BENEFIT.test(disclosure)) problems.push('must say that you benefit (e.g. "I may earn a commission")');
	return problems.length ? [`"disclosure" does not disclose: it ${problems.join(' and ')}`] : [];
};

/** A case-insensitive matcher for a name on word boundaries; spaces, dots, "_" and "-" between its words are optional. */
export const nameMatcher = (name: string): RegExp | null => {
	const words = name.match(/[\p{L}\p{N}]+/gu);
	return words ? new RegExp(`(?<![\\p{L}\\p{N}])${words.join('[\\s._-]*')}(?![\\p{L}\\p{N}])`, 'iu') : null;
};

/** True when the text names the offer ("Demo Exchange", "demo-exchange", "#DemoExchange"). */
export const names = (text: string, name: string): boolean => nameMatcher(name)?.test(text) ?? false;
