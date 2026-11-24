/**
 * Newsletter lint. Errors block the draft (no files are written and nothing is sent to Kit):
 *   - income, return or guarantee claims (guaranteed, risk-free, get rich, passive income, 100x, ...),
 *     even when quoting a scam: describe the trick without repeating its pitch;
 *   - an offer without a disclosure, a disclosure that does not say what the relationship is, or a
 *     rendered offer link without its disclosure right above it;
 *   - placeholders (TODO, REPLACE, example.com, ...), unsafe HTML, and hub links not tagged s=email&v=<slug>.
 * Warnings (softer money words, long subjects, plain http links) are printed for the owner to judge.
 */
import type {NewsletterDraft} from './draft.ts';
import {escEmail, mdText, mdUrl} from './render.ts';

export type Issue = {level: 'error' | 'warning'; where: string; message: string};

type Rule = {label: string; pattern: RegExp};

/** Never allowed in an email. */
export const INCOME_CLAIMS: readonly Rule[] = [
	{label: 'guaranteed', pattern: /\bguarantee[ds]?\b/i},
	{label: 'risk-free', pattern: /\brisk[\s-]?free\b|\b(?:no|zero)[\s-]risk\b|\bwithout (?:any )?risk\b/i},
	{label: 'get rich', pattern: /\bget(?:ting)?[\s-]rich\b|\brich[\s-]quick\b/i},
	{label: 'passive income', pattern: /\bpassive[\s-]income\b/i},
	{label: 'a 100x-style multiplier', pattern: /(?<![\w$.,])(?:\d{1,3}(?:,\d{3})+|\d{2,})\s?x\b(?!\s?\d)|\bx\d{2,}\b/i},
	{label: 'double your money', pattern: /\b(?:double|triple) your (?:money|crypto|investment|portfolio|savings)\b/i},
	{label: 'financial freedom', pattern: /\bfinancial(?:ly)?[\s-]free(?:dom)?\b/i},
	{label: 'make money fast', pattern: /\bmake (?:money|\$\s?\d[\d,]*k?) (?:fast|quick(?:ly)?|online|overnight|while you sleep)\b/i},
	{label: 'quit your job', pattern: /\bquit your (?:day )?job\b/i},
	{label: 'to the moon', pattern: /\bto the moon\b|\bmoon[\s-]?shot\b/i},
	{label: 'a price target', pattern: /\bprice target\b|\bgoing to \$\s?\d/i},
	{label: 'life-changing money', pattern: /\blife[\s-]changing (?:money|wealth|gains|returns|income)\b/i},
	{label: 'a sure thing', pattern: /\bsure[\s-](?:thing|fire|bet|win)\b/i},
];

/** Printed as warnings: fine in an anti-scam context, but check they are not return or price claims. */
export const SOFT_CLAIMS: readonly Rule[] = [
	{label: 'investment wording', pattern: /\binvest(?:ment|ments|ing|or|ors)?\b/i},
	{label: 'returns or profit wording', pattern: /\b(?:returns|profits?|gains|ROI|yields?|APY)\b/i},
	{label: 'free or easy money', pattern: /\b(?:free|easy|fast) (?:money|cash)\b/i},
	{label: 'urgency', pattern: /\b(?:don['’]t miss|last chance|act now|limited time|before it['’]s too late|FOMO)\b/i},
	{label: 'hype', pattern: /\bnext gem\b|\bmoon(?:ing)?\b|\bpump(?:ing)? soon\b/i},
];

const PLACEHOLDERS: readonly Rule[] = [
	{label: 'a placeholder word', pattern: /\b(?:TODO|TBD|FIXME|REPLACE(?:_ME)?|PLACEHOLDER)\b/},
	{label: 'lorem ipsum', pattern: /\blorem ipsum\b/i},
	{label: 'a bracketed placeholder', pattern: /\[[A-Z][A-Z0-9 _-]{2,}\]/},
];

/** A disclosure has to say what the relationship is. */
const DISCLOSURE_WORDS = /\b(?:affiliate|referral|commission|sponsor(?:ed|ship)?|paid|partner(?:ship)?|own product|our own|I own|we own|I built|we built|earn)\b/i;

const PLACEHOLDER_HOST = /(?:^|\.)(?:example\.(?:com|org|net)|test|example|invalid|localhost|local)$/i;

const snippet = (text: string, index: number): string => {
	const start = Math.max(0, index - 30);
	return `${start > 0 ? '…' : ''}${text.slice(start, index + 40).replace(/\s+/g, ' ').trim()}…`;
};

/** Claim and placeholder checks for one piece of reader-visible text. */
export const checkText = (text: string, where: string): Issue[] => {
	const issues: Issue[] = [];
	for (const rule of INCOME_CLAIMS) {
		const match = rule.pattern.exec(text);
		if (match) {
			issues.push({
				level: 'error',
				where,
				message: `income or return claim (${rule.label}): "${match[0]}" in "${snippet(text, match.index)}". Rephrase without it, even when describing a scam.`,
			});
		}
	}
	for (const rule of PLACEHOLDERS) {
		const match = rule.pattern.exec(text);
		if (match) issues.push({level: 'error', where, message: `${rule.label} is still in the text: "${match[0]}"`});
	}
	for (const rule of SOFT_CLAIMS) {
		const match = rule.pattern.exec(text);
		if (match) issues.push({level: 'warning', where, message: `${rule.label}: "${match[0]}". Make sure it is not a return or price claim.`});
	}
	return issues;
};

const checkLink = (url: string, where: string): Issue[] => {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return [{level: 'error', where, message: `not a valid link: ${url}`}];
	}
	if (PLACEHOLDER_HOST.test(parsed.hostname)) return [{level: 'error', where, message: `links to a placeholder or private host: ${parsed.hostname}`}];
	if (parsed.protocol === 'http:') return [{level: 'warning', where, message: `plain http link (prefer https): ${url}`}];
	if (parsed.protocol !== 'https:') return [{level: 'error', where, message: `only http(s) links are allowed: ${url}`}];
	return [];
};

/** Content checks on the draft model, field by field (so messages can say where to fix things). */
export const lintDraft = (draft: NewsletterDraft): Issue[] => {
	const issues: Issue[] = [];
	const previewIsSummary = draft.summary.startsWith(draft.previewText.replace(/…$/, ''));
	const fields: [string, string][] = [
		['subject', draft.subject],
		...(draft.title === draft.subject ? [] : [['title', draft.title] as [string, string]]),
		...(previewIsSummary ? [] : [['preview text', draft.previewText] as [string, string]]),
		['summary', draft.summary],
		...draft.takeaways.map((t, i): [string, string] => [`chapters (takeaway ${i + 1})`, t.text]),
		...draft.sources.map((s, i): [string, string] => [`sources[${i}].title`, s.title]),
		...draft.episodeDisclosures.map((d, i): [string, string] => [`episode disclosure ${i + 1}`, d]),
		['safety line', draft.safetyLine],
		...draft.footer.map((f, i): [string, string] => [`footer line ${i + 1}`, f]),
	];
	for (const [where, text] of fields) issues.push(...checkText(text, where));
	if (draft.subject.length > 70) issues.push({level: 'warning', where: 'subject', message: `${draft.subject.length} characters: inboxes may cut it off after about 60`});
	if (draft.watchUrl) issues.push(...checkLink(draft.watchUrl, 'watch link'));
	if (draft.disclosuresUrl) issues.push(...checkLink(draft.disclosuresUrl, 'disclosures link'));
	draft.sources.forEach((s, i) => issues.push(...checkLink(s.url, `sources[${i}].url`)));

	for (const offer of draft.offers) {
		const where = `offer "${offer.id}"`;
		issues.push(...checkText(offer.name, `${where} name`));
		const lines = offer.disclosure.map((line) => line.trim()).filter(Boolean);
		if (lines.length === 0) {
			issues.push({level: 'error', where, message: 'has no disclosure. Every affiliate or referral link needs one right next to it.'});
			continue;
		}
		if (!DISCLOSURE_WORDS.test(lines.join(' '))) {
			issues.push({level: 'error', where, message: `the disclosure does not say what the relationship is (affiliate, referral, sponsor, our own product): "${lines.join(' ')}"`});
		}
		lines.forEach((line, i) => issues.push(...checkText(line, `${where} disclosure line ${i + 1}`).filter((issue) => issue.level === 'error')));
		const url = URL.canParse(offer.url) ? new URL(offer.url) : null;
		const tagged = url?.searchParams.get('s') === 'email' && url.searchParams.get('v') === draft.slug && [...url.searchParams.keys()].length === 2;
		if (!url || url.protocol !== 'https:' || url.pathname !== `/go/${offer.id}` || !tagged) {
			issues.push({level: 'error', where, message: `the link must be https://<hub>/go/${offer.id}?v=${draft.slug}&s=email, not ${offer.url}`});
		}
		issues.push(...checkLink(offer.url, where).filter((issue) => issue.level === 'error'));
	}
	return issues;
};

const UNSAFE_HTML: readonly {pattern: RegExp; message: string}[] = [
	{pattern: /<script\b/i, message: 'contains a <script> tag'},
	{pattern: /<(?:style|link|iframe|frame|object|embed|form|input|button|base)\b/i, message: 'contains a tag that does not belong in an email (style, link, iframe, object, embed, form, input, button or base)'},
	{pattern: /<[^>]*\son[a-z]+\s*=/i, message: 'contains an inline event handler (on...=)'},
	{pattern: /\b(?:href|src)\s*=\s*["']?\s*(?:javascript|vbscript|data):/i, message: 'contains a javascript:, vbscript: or data: link'},
];

const htmlIssues = (html: string, where: string): Issue[] =>
	UNSAFE_HTML.filter((rule) => rule.pattern.test(html)).map((rule) => ({level: 'error', where, message: rule.message}));

const WINDOW = 1500;

/** Every occurrence of `link` must have every disclosure line within WINDOW characters before it. */
const disclosedBefore = (text: string, link: string, lines: string[]): 'missing' | 'far' | 'ok' => {
	let index = text.indexOf(link);
	if (index === -1) return 'missing';
	while (index !== -1) {
		const before = text.slice(Math.max(0, index - WINDOW), index);
		if (!lines.every((line) => before.includes(line))) return 'far';
		index = text.indexOf(link, index + link.length);
	}
	return 'ok';
};

/** Checks the rendered files: safe HTML, and each offer link with its disclosure right above it. */
export const lintRendered = (draft: NewsletterDraft, markdown: string, html: string): Issue[] => {
	const issues = htmlIssues(html, 'HTML');
	for (const offer of draft.offers) {
		const outputs: [string, string, string, string[]][] = [
			['HTML', html, `href="${escEmail(offer.url)}"`, offer.disclosure.map(escEmail)],
			['Markdown', markdown, `](${mdUrl(offer.url)})`, offer.disclosure.map(mdText)],
		];
		for (const [where, text, link, lines] of outputs) {
			const result = disclosedBefore(text, link, lines);
			if (result === 'missing') issues.push({level: 'error', where, message: `the link for offer "${offer.id}" is missing`});
			if (result === 'far') issues.push({level: 'error', where, message: `a link for offer "${offer.id}" does not have its disclosure right above it`});
		}
	}
	return issues;
};

const ENTITIES: Record<string, string> = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '};

/** Reader-visible text of an HTML email (tags and comments removed, entities decoded). */
export const htmlToText = (html: string): string =>
	html
		.replace(/<!--[\s\S]*?-->/g, ' ')
		.replace(/<[^>]*>/g, ' ')
		.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity: string, name: string) => {
			if (name[0] !== '#') return ENTITIES[name.toLowerCase()] ?? entity;
			const code = name[1]?.toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
			return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
		})
		.replace(/\s+/g, ' ');

const HUB_LINK = /https?:\/\/[^\s"'<>()]+?\/go\/[a-z0-9-]{2,40}(?:\?[^\s"'<>()]*)?/g;

/**
 * Lints a draft file the owner edited by hand (`newsletter lint <file>`): claims and placeholders in
 * the visible text, unsafe HTML, and a disclosure before every hub link.
 */
export const lintFile = (content: string, kind: 'markdown' | 'html', where: string): Issue[] => {
	const issues = kind === 'html' ? htmlIssues(content, where) : [];
	issues.push(...checkText(kind === 'html' ? htmlToText(content) : content, where));
	let previousEnd = 0; // each hub link needs its own disclosure between it and the previous hub link
	for (const match of content.matchAll(HUB_LINK)) {
		const link = match[0].replace(/&amp;/g, '&');
		const before = content.slice(Math.max(previousEnd, match.index - WINDOW), match.index);
		previousEnd = match.index + match[0].length;
		if (!DISCLOSURE_WORDS.test(kind === 'html' ? htmlToText(before) : before)) {
			issues.push({level: 'error', where, message: `${link} has no disclosure (affiliate, referral, sponsor...) right before it`});
		}
		const query = new URL(link).searchParams;
		if (query.get('s') !== 'email' || !query.get('v')) {
			issues.push({level: 'warning', where, message: `${link} is not tagged ?v=<episode>&s=email, so its clicks will not be counted for this email`});
		}
	}
	return issues;
};
