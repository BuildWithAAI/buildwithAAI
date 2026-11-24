/**
 * Text lint for every generated asset (docs/ASSETS.md, "Lint").
 * Errors block the asset:
 *   - income, return or guarantee claims (the same list as creator-hub/tools/newsletter/lint.ts, kept in step);
 *   - "ZOO" in capitals: the host is "Zoo" (owner, 2026-11-24);
 *   - a private individual's name from data/private/names.txt (gitignored; the name is never echoed back);
 *   - placeholders (TODO, REPLACE, lorem ipsum, [PLACEHOLDER]);
 *   - an offer or hub link without its disclosure close before it (checked per asset by checkDisclosedLinks).
 * Warnings: softer money words (fine in an anti-scam context, but a human should look).
 * The transcript is what the approved video says, so a claim word there is a warning (fix it in the video, not here).
 */
import {existsSync, readFileSync} from 'node:fs';

export type LintIssue = {level: 'error' | 'warning'; rule: string; where: string; message: string};

type Rule = {label: string; pattern: RegExp};

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
	// es / pt-br equivalents of the strongest claims (the dubs are reviewed too)
	{label: 'garantizado / garantido', pattern: /\bgarantizad[oa]s?\b|\bgarantid[oa]s?\b|\bganancias? garantizadas?\b|\blucros? garantidos?\b/i},
	{label: 'sin riesgo / sem risco', pattern: /\bsin riesgos?\b|\bsem riscos?\b/i},
	{label: 'hacerse rico / ficar rico', pattern: /\bhacerte rico\b|\bhacerse rico\b|\bhazte (?:rico|millonario)\b|\bvolverte (?:rico|millonario)\b|\bficar rico\b|\bfique rico\b|\bficar milion[aá]rio\b/i},
	{label: 'ingresos pasivos / renda passiva', pattern: /\bingresos? pasivos?\b|\brenda passiva\b/i},
];

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

/** "ZOO" as a standalone word in capitals (ZOORA and Zoo are fine). */
const ZOO_CAPS = /(?<![\p{L}\p{N}])ZOO(?![\p{L}\p{N}])/u;

const rawSnippet = (text: string, index: number, length: number): string => {
	const start = Math.max(0, index - 25);
	return `${start > 0 ? '…' : ''}${text.slice(start, index + length + 25).replace(/\s+/g, ' ').trim()}…`;
};

/** Reads data/private/names.txt: one name per line, "#" comments. Names shorter than 3 characters are ignored. */
export const loadPrivateNames = (path: string | null): string[] => {
	if (!path || !existsSync(path)) return [];
	return readFileSync(path, 'utf8')
		.split(/\r?\n/)
		.map((l) => l.replace(/#.*$/, '').trim())
		.filter((l) => [...l].length >= 3);
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const namePatterns = (names: string[]): RegExp[] =>
	names.map((n) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(n.normalize('NFC')).replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`, 'iu'));

export type LintContext = {names: RegExp[]; transcript?: boolean};

/** Replaces every private name in `text` with "[private name]" (messages, manifests and logs never carry one). */
export const redact = (text: string, names: RegExp[]): string =>
	names.reduce((acc, re) => acc.replace(new RegExp(re.source, `${re.flags.replace('g', '')}g`), '[private name]'), text.normalize('NFC'));

/** Claim, name, ZOO and placeholder checks for one piece of reader-visible text. */
export const lintText = (text: string, where: string, ctx: LintContext): LintIssue[] => {
	const issues: LintIssue[] = [];
	const t = text.normalize('NFC');
	const snippet = (index: number, length: number) => redact(rawSnippet(t, index, length), ctx.names);
	for (const rule of INCOME_CLAIMS) {
		const m = rule.pattern.exec(t);
		if (!m) continue;
		issues.push({
			level: ctx.transcript ? 'warning' : 'error',
			rule: 'income-claim',
			where,
			message: ctx.transcript
				? `the video says "${redact(m[0], ctx.names)}" (${rule.label}): check it is clearly a scam's pitch being described, and fix the video if not`
				: `income or return claim (${rule.label}): "${redact(m[0], ctx.names)}" in "${snippet(m.index, m[0].length)}". Rephrase without it, even when describing a scam.`,
		});
	}
	const zoo = ZOO_CAPS.exec(t);
	if (zoo) issues.push({level: 'error', rule: 'zoo-name', where, message: `"ZOO" in capitals in "${snippet(zoo.index, 3)}": the host's name is "Zoo"`});
	ctx.names.forEach((re, i) => {
		if (re.test(t)) issues.push({level: 'error', rule: 'private-name', where, message: `contains private name #${i + 1} from the private names list (not shown here). Remove it.`});
	});
	for (const rule of PLACEHOLDERS) {
		const m = rule.pattern.exec(t);
		if (m) issues.push({level: 'error', rule: 'placeholder', where, message: `${rule.label} is still in the text: "${redact(m[0], ctx.names)}"`});
	}
	if (!ctx.transcript) {
		for (const rule of SOFT_CLAIMS) {
			const m = rule.pattern.exec(t);
			if (m) issues.push({level: 'warning', rule: 'soft-claim', where, message: `${rule.label}: "${redact(m[0], ctx.names)}". Make sure it is not a return or price claim.`});
		}
	}
	return issues;
};

/**
 * Every occurrence of each link must have its disclosure within `window` characters before it, in the same unit
 * (`text` is one post, one message or one page). Returns one issue per offending link.
 */
export const checkDisclosedLinks = (text: string, links: {url: string; disclosure: string; label: string}[], where: string, window = 600): LintIssue[] => {
	const issues: LintIssue[] = [];
	for (const link of links) {
		let at = text.indexOf(link.url);
		if (at < 0) continue;
		while (at >= 0) {
			const before = text.slice(Math.max(0, at - window), at);
			if (!before.includes(link.disclosure)) {
				issues.push({level: 'error', rule: 'disclosure', where, message: `the ${link.label} link is not preceded by its disclosure ("${link.disclosure}") within ${window} characters`});
				break;
			}
			at = text.indexOf(link.url, at + link.url.length);
		}
	}
	return issues;
};

/** Any /go/<offer> hub link in the text that is not one of the known, disclosed offer links. */
export const unknownHubLinks = (text: string, hubOrigin: string, known: string[], where: string): LintIssue[] => {
	const re = new RegExp(`${escapeRe(hubOrigin)}/go/[a-z0-9-]{2,40}(?:\\?[^\\s"'<>)]*)?`, 'g');
	const issues: LintIssue[] = [];
	for (const m of text.matchAll(re)) {
		const url = m[0].replace(/&amp;/g, '&');
		if (!known.includes(url)) issues.push({level: 'error', rule: 'disclosure', where, message: `hub offer link without a known disclosure: ${url}`});
	}
	return issues;
};
