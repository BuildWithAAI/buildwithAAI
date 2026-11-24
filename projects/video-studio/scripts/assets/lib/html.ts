/**
 * Escaping for HTML, XML and JSON-LD. Every piece of text that reaches a generated page or feed goes through one of
 * these; URLs go through safeUrl() so only absolute http(s) links without credentials are ever written.
 */

const HTML_ESCAPES: Record<string, string> = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'};

/** Text and attribute values in HTML (quotes escaped too, so it is safe in either place). */
export const esc = (value: string): string => value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

/** XML 1.0 text and attribute values. Characters XML 1.0 cannot carry are removed. */
export const xml = (value: string): string =>
	value
		// eslint-disable-next-line no-control-regex
		.replace(/[^\u0009\u000A\u000D -퟿-�\u{10000}-\u{10FFFF}]/gu, '')
		.replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'})[c] as string);

/**
 * JSON for a <script type="application/ld+json"> block. "<", ">" and "&" become \u escapes, so the text can never
 * close the script element or open a comment; U+2028/U+2029 are escaped for older parsers.
 */
export const jsonLd = (value: unknown): string =>
	JSON.stringify(value, null, 1)
		.replace(/</g, '\\u003c')
		.replace(/>/g, '\\u003e')
		.replace(/&/g, '\\u0026')
		.replace(/\u2028/g, '\\u2028')
		.replace(/\u2029/g, '\\u2029');

export class UnsafeUrlError extends Error {}

/** Returns a normalized absolute URL, or throws for anything but http(s) without credentials. */
export const safeUrl = (value: string, opts: {httpsOnly?: boolean} = {}): string => {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new UnsafeUrlError(`not an absolute URL: ${JSON.stringify(value)}`);
	}
	const okProtocol = opts.httpsOnly ? url.protocol === 'https:' : url.protocol === 'https:' || url.protocol === 'http:';
	if (!okProtocol) throw new UnsafeUrlError(`only ${opts.httpsOnly ? 'https' : 'http(s)'} links are allowed: ${JSON.stringify(value)}`);
	if (url.username || url.password) throw new UnsafeUrlError(`links with credentials are not allowed: ${url.host}`);
	return url.href;
};

export const isSafeUrl = (value: string, opts: {httpsOnly?: boolean} = {}): boolean => {
	try {
		safeUrl(value, opts);
		return true;
	} catch {
		return false;
	}
};

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

/**
 * Structural check of generated HTML: every non-void element is closed in order. Our generators only write
 * well-nested markup, so this catches template bugs in tests. Script/style bodies are skipped.
 */
export const htmlBalanceProblems = (html: string): string[] => {
	const problems: string[] = [];
	const stack: string[] = [];
	const body = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '<$1></$1>');
	const re = /<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/?)>/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(body))) {
		const tag = m[1].toLowerCase();
		const closing = m[0].startsWith('</');
		if (VOID.has(tag)) {
			if (closing) problems.push(`closing tag for void element </${tag}>`);
			continue;
		}
		if (m[2] === '/') continue;
		if (!closing) stack.push(tag);
		else if (stack[stack.length - 1] === tag) stack.pop();
		else {
			problems.push(`</${tag}> closes <${stack[stack.length - 1] ?? 'nothing'}>`);
			const at = stack.lastIndexOf(tag);
			if (at >= 0) stack.length = at;
		}
	}
	for (const tag of stack.filter((t) => t !== 'html' && t !== 'body' && t !== 'head')) problems.push(`<${tag}> is never closed`);
	return problems;
};
