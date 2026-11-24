/**
 * The Threat Brief's lint: the news gate's rules scaled down (safety.ts) plus the brief's structure.
 *
 * - lintBrief: the built brief (structure, labels, attribution of every figure) and the text rules on every field.
 * - lintRendered: the Markdown and HTML that will be written (email-safe HTML, labels present, https links) and the
 *   news gate's text rules over the whole body as a reader sees it, not only field by field.
 * - lintFile: a draft someone edited by hand (`cli.ts lint <file>`), with no model behind it.
 *
 * `final` is for text about to go to Kit: a pending show link is then an error instead of a warning.
 */
import type {ThreatBrief} from './brief.ts';
import {lintBriefText} from './brief.ts';
import {SHOW_LINK_PENDING} from './render.ts';
import {scanText, type Finding, type Level, type NameAllow, type Rule} from './safety.ts';

const issue = (rule: Rule, code: string, level: Level, where: string, message: string, match = ''): Finding => ({rule, code, level, where, message, match});

export const lintBrief = (brief: ThreatBrief, allow: NameAllow, options: {final?: boolean} = {}): Finding[] => {
	const out: Finding[] = [];
	if (brief.incidents.length === 0) out.push(issue('structure', 'no-incidents', 'warning', 'brief', 'the radar has no incident today: consider not sending a brief'));
	for (const inc of brief.incidents) {
		const where = `incident "${inc.name}"`;
		const expected = inc.status === 'confirmed' ? 'CONFIRMED' : 'DEVELOPING';
		if (inc.label !== expected) out.push(issue('developing', 'label', 'error', where, `status ${inc.status} must carry the ${expected} label`));
		if (inc.status === 'developing' && !/^Developing\b/.test(inc.statusLine)) out.push(issue('developing', 'status-line', 'error', where, 'a developing story must say so in its status line'));
		for (const l of inc.losses) {
			if (!l.publisher.trim()) out.push(issue('attribution', 'loss-source', 'error', where, `the figure ${l.amount} has no source`));
			if (!l.url.startsWith('https://')) out.push(issue('links', 'loss-link', 'error', where, `the figure ${l.amount} must link to its source over https`));
		}
		if (inc.sources.length === 0) out.push(issue('attribution', 'no-sources', 'error', where, 'every incident needs at least one linked source'));
		for (const s of inc.sources) if (!s.url.startsWith('https://')) out.push(issue('links', 'source-link', 'error', where, `source link must be https: ${s.url}`));
		for (const part of inc.how.parts) if (part.url && !part.url.startsWith('https://')) out.push(issue('links', 'how-link', 'error', where, 'the "how it worked" source must be https'));
	}
	if (!brief.fix.text.trim()) out.push(issue('structure', 'no-fix', 'error', "Zoo's One Fix", 'the brief needs a One Fix'));
	if (!brief.footer.some((l) => /^You're getting/.test(l))) out.push(issue('structure', 'no-why', 'error', 'footer', 'the footer must say why the reader gets this email'));
	if (brief.show && !brief.show.url) {
		out.push(issue('placeholder', 'show-link-pending', options.final ? 'error' : 'warning', 'show', 'the video has no YouTube id yet: re-run with --youtube-id <id> once it is public'));
	}
	if (brief.show?.url && !/^https:\/\/(?:youtu\.be|www\.youtube\.com)\//.test(brief.show.url)) out.push(issue('links', 'show-link', 'error', 'show', 'the show link must be a YouTube https link'));
	out.push(...lintBriefText(brief, allow));
	return out;
};

// ---------------------------------------------------------------------------------------------
// Rendered output and hand-edited files

const FORBIDDEN_TAG = /<\s*(script|style|link|img|iframe|object|embed|form|input|button|textarea|select|video|audio|svg|canvas|base|frame|frameset|applet)\b/gi;
const EVENT_ATTR = /<[^>]*\son[a-z]+\s*=/gi;
const BAD_URL = /\b(?:href|src)\s*=\s*["']?\s*(?:javascript|data|vbscript|file):/gi;
const HREF = /\bhref\s*=\s*"([^"]*)"/gi;

const decodeEntities = (text: string): string =>
	text
		.replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(Number.parseInt(n, 16)))
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&');

/** Visible text of an email, one block per line (links keep only their text). */
export const htmlToText = (html: string): string =>
	decodeEntities(
		html
			.replace(/<!--[\s\S]*?-->/g, ' ')
			.replace(/<head[\s\S]*?<\/head>/i, ' ')
			.replace(/<(?:br|\/p|\/li|\/tr|\/h[1-6]|\/div|\/td|\/ul|\/table)\b[^>]*>/gi, '\n')
			.replace(/<[^>]+>/g, ''),
	)
		.split('\n')
		.map((l) => l.replace(/[ \t]+/g, ' ').trim())
		.filter(Boolean)
		.join('\n');

/** Plain text of the brief's Markdown: link text kept, URLs, emphasis, escapes and comments removed. */
export const markdownToText = (md: string): string =>
	md
		.replace(/^---\n[\s\S]*?\n---\n/, '')
		.replace(/<!--[\s\S]*?-->/g, ' ')
		.split('\n')
		.map((line) =>
			line
				.replace(/\[((?:\\.|[^\]\\])*)\]\((?:[^()\s]|\([^()]*\))*\)/g, '$1')
				.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|>\s+)/, '')
				.replace(/\*\*|__/g, '')
				.replace(/\\(.)/g, '$1')
				.trim(),
		)
		.filter((l) => l && l !== '---')
		.join('\n');

const frontMatter = (md: string): Record<string, string> => {
	const m = /^---\n([\s\S]*?)\n---\n/.exec(md);
	const out: Record<string, string> = {};
	for (const line of m?.[1]?.split('\n') ?? []) {
		const kv = /^([a-z]+):\s*(.*)$/.exec(line);
		if (!kv?.[1]) continue;
		try {
			const v: unknown = JSON.parse(kv[2] ?? '');
			if (typeof v === 'string') out[kv[1]] = v;
		} catch {
			out[kv[1]] = kv[2] ?? '';
		}
	}
	return out;
};

export const htmlSafety = (html: string, where: string): Finding[] => {
	const out: Finding[] = [];
	for (const m of html.matchAll(FORBIDDEN_TAG)) out.push(issue('html', 'forbidden-tag', 'error', where, `<${m[1]}> is not email-safe (no scripts, styles, images, embeds or forms)`, m[0]));
	for (const m of html.matchAll(EVENT_ATTR)) out.push(issue('html', 'event-attribute', 'error', where, 'event handler attributes are not allowed', m[0].slice(0, 60)));
	for (const m of html.matchAll(BAD_URL)) out.push(issue('html', 'bad-url', 'error', where, 'only https links are allowed', m[0]));
	for (const m of html.matchAll(HREF)) {
		if (!/^https:\/\/[^\s"<>]+$/.test(decodeEntities(m[1] ?? ''))) out.push(issue('links', 'not-https', 'error', where, 'every link must be https', m[1] ?? ''));
		else if (/[?&]utm_[a-z]+=/i.test(m[1] ?? '')) out.push(issue('links', 'tracking', 'warning', where, 'tracking parameters in a link', m[1] ?? ''));
	}
	return out;
};

export const markdownLinks = (md: string, where: string): Finding[] => {
	const out: Finding[] = [];
	for (const m of md.matchAll(/\]\(((?:[^()\s]|\([^()]*\))*)\)/g)) {
		if (!/^https:\/\//.test(m[1] ?? '')) out.push(issue('links', 'not-https', 'error', where, 'every link must be https', m[1] ?? ''));
	}
	return out;
};

/** Structure checks shared by rendered output and hand-edited files. */
const structure = (text: string, where: string, incidentLabels: string[], final: boolean): Finding[] => {
	const out: Finding[] = [];
	if (!/Zoo['’]s One Fix/.test(text)) out.push(issue('structure', 'no-fix', 'error', where, "the brief needs a \"Zoo's One Fix\" section"));
	if (!/You['’]re getting/.test(text)) out.push(issue('structure', 'no-why', 'error', where, 'the footer must say why the reader gets this email ("You\'re getting ...")'));
	if (text.includes(SHOW_LINK_PENDING) && !final) out.push(issue('placeholder', 'show-link-pending', 'warning', where, 'the show link is still pending'));
	const hows = (text.match(/How it worked:/g) ?? []).length;
	if (incidentLabels.length < hows) out.push(issue('developing', 'label-missing', 'error', where, 'every incident needs a CONFIRMED or DEVELOPING label'));
	return out;
};

const textRules = (text: string, where: string, allow: NameAllow | undefined, final: boolean): Finding[] =>
	scanText(text, {where, allow}).filter((f) => final || !(f.rule === 'placeholder' && f.match.toLowerCase().startsWith('[show link')));

/**
 * The text rules over a whole rendered body. Every field was already checked on its own (with warnings); this pass
 * reads the body as the subscriber sees it, so a rule that only fires on the joined text still blocks. Errors only:
 * the field checks already reported the warnings.
 */
export const bodyRules = (text: string, where: string, allow: NameAllow | undefined, final: boolean): Finding[] =>
	textRules(text, where, allow, final).filter((f) => f.level === 'error');

/** Checks the Markdown and HTML about to be written for a built brief. */
export const lintRendered = (md: string, html: string, brief: ThreatBrief, options: {final?: boolean; allow?: NameAllow} = {}): Finding[] => {
	const final = options.final === true;
	const out: Finding[] = [...htmlSafety(html, 'email HTML'), ...markdownLinks(md, 'Markdown')];
	out.push(...bodyRules(markdownToText(md), 'Markdown body', options.allow, final), ...bodyRules(htmlToText(html), 'email body', options.allow, final));
	const mdLabels = [...md.matchAll(/^### (CONFIRMED|DEVELOPING) · /gm)].map((m) => m[1] ?? '');
	const htmlLabels = [...html.matchAll(/>(CONFIRMED|DEVELOPING)<\/span>/g)].map((m) => m[1] ?? '');
	const expected = brief.incidents.map((i) => i.label);
	if (mdLabels.join() !== expected.join()) out.push(issue('developing', 'label-mismatch', 'error', 'Markdown', `incident labels ${mdLabels.join(', ') || 'none'} do not match ${expected.join(', ')}`));
	if (htmlLabels.join() !== expected.join()) out.push(issue('developing', 'label-mismatch', 'error', 'email HTML', `incident labels ${htmlLabels.join(', ') || 'none'} do not match ${expected.join(', ')}`));
	out.push(...structure(markdownToText(md), 'Markdown', mdLabels, final), ...structure(htmlToText(html), 'email HTML', htmlLabels, final));
	if (final && (md.includes(SHOW_LINK_PENDING) || html.includes(SHOW_LINK_PENDING))) out.push(issue('placeholder', 'show-link-pending', 'error', 'brief', 'the show link is still pending'));
	return out;
};

/** Lints a Threat Brief file edited by hand (.md or .html). Pending links are errors: the file is about to be sent. */
export const lintFile = (content: string, kind: 'markdown' | 'html', where: string, allow?: NameAllow): Finding[] => {
	const out: Finding[] = [];
	if (kind === 'html') {
		const text = htmlToText(content);
		const labels = [...content.matchAll(/>(CONFIRMED|DEVELOPING)<\/span>/g)].map((m) => m[1] ?? '');
		out.push(...htmlSafety(content, where), ...structure(text, where, labels, true), ...textRules(text, where, allow, true));
		return out;
	}
	const fm = frontMatter(content);
	if (!fm.subject?.trim()) out.push(issue('structure', 'no-subject', 'error', where, 'the front matter needs a subject'));
	for (const [key, value] of Object.entries(fm)) if (key === 'subject' || key === 'preview') out.push(...textRules(value, `${where} ${key}`, allow, true));
	for (const line of content.split('\n')) {
		if (/^### /.test(line) && !/^### (?:CONFIRMED|DEVELOPING) · \S/.test(line)) out.push(issue('developing', 'label-missing', 'error', where, 'every incident heading starts with "CONFIRMED · " or "DEVELOPING · "', line));
	}
	const labels = [...content.matchAll(/^### (CONFIRMED|DEVELOPING) · /gm)].map((m) => m[1] ?? '');
	const text = markdownToText(content);
	out.push(...markdownLinks(content, where), ...structure(text, where, labels, true), ...textRules(text, where, allow, true));
	if (/<\s*(?:script|style|iframe|img)\b/i.test(content.replace(/<!--[\s\S]*?-->/g, ''))) out.push(issue('html', 'raw-html', 'error', where, 'raw HTML in the Markdown'));
	return out;
};
