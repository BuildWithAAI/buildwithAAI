/**
 * Inline syntax of the content dialect and its HTML rendering. Pure functions.
 *
 *   **strong**   *emphasis*   `code`   [link text](https://...)   [@source-id]   [@id-one; @id-two]
 *   \*  \[  \`  \\   escape a markup character
 *
 * Typography is applied to text runs only (never inside code or URLs): straight quotes become curly quotes,
 * "..." an ellipsis, a number and its unit ("$68 million", "Chapter 3") never break across lines, and the show's
 * name "Zoo & Badger" stays on one line.
 */

export type InlineNode =
	| {t: 'text'; v: string}
	| {t: 'strong'; c: InlineNode[]}
	| {t: 'em'; c: InlineNode[]}
	| {t: 'code'; v: string}
	| {t: 'link'; href: string; c: InlineNode[]}
	| {t: 'cite'; ids: string[]};

export class InlineError extends Error {}

export const escapeHtml = (s: string): string =>
	s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const CITE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Finds the closing delimiter at or after `from`, skipping escaped characters. */
const findClose = (s: string, delim: string, from: number): number => {
	for (let i = from; i < s.length; i++) {
		if (s[i] === '\\') {
			i++;
			continue;
		}
		if (s.startsWith(delim, i)) return i;
	}
	return -1;
};

export const parseInline = (s: string): InlineNode[] => {
	const out: InlineNode[] = [];
	let buf = '';
	const flush = () => {
		if (buf) out.push({t: 'text', v: buf});
		buf = '';
	};
	let i = 0;
	while (i < s.length) {
		const ch = s[i];
		if (ch === '\\' && i + 1 < s.length && '*[]`\\_'.includes(s[i + 1])) {
			buf += s[i + 1];
			i += 2;
			continue;
		}
		if (ch === '`') {
			const end = s.indexOf('`', i + 1);
			if (end < 0) throw new InlineError(`unclosed \` in "${s}"`);
			flush();
			out.push({t: 'code', v: s.slice(i + 1, end)});
			i = end + 1;
			continue;
		}
		if (s.startsWith('[@', i)) {
			const end = s.indexOf(']', i);
			if (end < 0) throw new InlineError(`unclosed citation in "${s}"`);
			const ids = s
				.slice(i + 1, end)
				.split(/[;,]/)
				.map((x) => x.trim())
				.filter(Boolean)
				.map((x) => {
					if (!x.startsWith('@')) throw new InlineError(`citation "${x}" must start with @ in "${s}"`);
					const id = x.slice(1);
					if (!CITE_ID.test(id)) throw new InlineError(`bad citation id "${id}" in "${s}"`);
					return id;
				});
			if (!ids.length) throw new InlineError(`empty citation in "${s}"`);
			flush();
			out.push({t: 'cite', ids});
			i = end + 1;
			continue;
		}
		if (ch === '[') {
			const close = findClose(s, '](', i + 1);
			if (close > 0) {
				const end = s.indexOf(')', close + 2);
				if (end < 0) throw new InlineError(`unclosed link URL in "${s}"`);
				flush();
				out.push({t: 'link', href: s.slice(close + 2, end).trim(), c: parseInline(s.slice(i + 1, close))});
				i = end + 1;
				continue;
			}
		}
		if (s.startsWith('**', i)) {
			const end = findClose(s, '**', i + 2);
			if (end < 0) throw new InlineError(`unclosed ** in "${s}"`);
			flush();
			out.push({t: 'strong', c: parseInline(s.slice(i + 2, end))});
			i = end + 2;
			continue;
		}
		if (ch === '*' && s[i + 1] && s[i + 1] !== ' ') {
			const end = findClose(s, '*', i + 1);
			if (end < 0) throw new InlineError(`unclosed * in "${s}"`);
			flush();
			out.push({t: 'em', c: parseInline(s.slice(i + 1, end))});
			i = end + 1;
			continue;
		}
		buf += ch;
		i++;
	}
	flush();
	return out;
};

// ------------------------------------------------------------------------------------------- typography

const OPENING_CONTEXT = /[\s([{—–/-]/;

/** Curly quotes and ellipses for one text run; `prev` is the character before the run (or '' at the start). */
export const smartQuotes = (text: string, prev = ''): string => {
	let out = '';
	let before = prev;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (c === '"') out += !before || OPENING_CONTEXT.test(before) ? '“' : '”';
		else if (c === "'") out += !before || OPENING_CONTEXT.test(before) ? '‘' : '’';
		else if (c === '.' && text.startsWith('...', i)) {
			out += '…';
			i += 2;
			before = '…';
			continue;
		} else out += c;
		before = c;
	}
	return out;
};

const NBSP = ' ';

/** Line-break rules applied to escaped text: units stay with their numbers; references stay with their labels. */
export const keepTogether = (escaped: string): string =>
	escaped
		.replace(/(\d)\s+(million|billion|thousand|percent|hours|days|minutes|seconds)\b/g, `$1${NBSP}$2`)
		.replace(/\b(Chapter|Chapters|Appendix|Step|Version|page)\s+(\d+|[A-Z])\b/g, `$1${NBSP}$2`)
		.replace(/Zoo &amp; Badger/g, '<span class="nowrap">Zoo &amp; Badger</span>');

export type InlineContext = {
	/** Renders a citation group (ids in order) to HTML. */
	cite: (ids: string[]) => string;
};

const lastChar = (s: string): string => (s ? s[s.length - 1] : '');

export const renderInline = (nodes: InlineNode[], ctx: InlineContext, prev = ''): string => {
	let html = '';
	let before = prev;
	for (const n of nodes) {
		switch (n.t) {
			case 'text': {
				const typed = smartQuotes(n.v, before);
				html += keepTogether(escapeHtml(typed));
				before = lastChar(typed);
				break;
			}
			case 'strong':
				html += `<strong>${renderInline(n.c, ctx, before)}</strong>`;
				before = lastChar(plainText(n.c));
				break;
			case 'em':
				html += `<em>${renderInline(n.c, ctx, before)}</em>`;
				before = lastChar(plainText(n.c));
				break;
			case 'code':
				html += `<code>${escapeHtml(n.v)}</code>`;
				before = lastChar(n.v);
				break;
			case 'link':
				html += `<a href="${escapeHtml(n.href)}">${renderInline(n.c, ctx, before)}</a>`;
				before = lastChar(plainText(n.c));
				break;
			case 'cite':
				// a citation directly after text: no break between the word and its marker
				html = html.replace(/ $/, NBSP);
				html += ctx.cite(n.ids);
				break;
		}
	}
	return html;
};

/** Text content without markup or citations (for lint, ids and alt text). */
export const plainText = (nodes: InlineNode[]): string =>
	nodes.map((n) => (n.t === 'text' || n.t === 'code' ? n.v : n.t === 'cite' ? '' : plainText(n.c))).join('');

/** Citation ids in order of appearance. */
export const citationsOf = (nodes: InlineNode[]): string[] =>
	nodes.flatMap((n) => (n.t === 'cite' ? n.ids : n.t === 'strong' || n.t === 'em' || n.t === 'link' ? citationsOf(n.c) : []));

/** Link targets in order of appearance. */
export const linksOf = (nodes: InlineNode[]): string[] =>
	nodes.flatMap((n) => (n.t === 'link' ? [n.href, ...linksOf(n.c)] : n.t === 'strong' || n.t === 'em' ? linksOf(n.c) : []));

/** Inline helper: parse and render in one step. */
export const inline = (s: string, ctx: InlineContext): string => renderInline(parseInline(s), ctx);
