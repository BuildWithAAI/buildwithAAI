/**
 * Escaping for everything that ends up in the approval page, the Markdown packet and the email draft. Feed-derived
 * text (titles, excerpts, publisher names, URLs) is untrusted: it is always escaped, and a URL becomes a link only
 * when it is plain http(s) with no credentials.
 */

const HTML: Record<string, string> = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;', '{': '&#123;', '}': '&#125;'};

/**
 * Text content and attribute values (double-quoted). Braces are encoded too: Kit runs Liquid over broadcast content,
 * so a headline with "{{ ... }}" or "{% ... %}" pasted into an email would otherwise run as template code.
 */
export const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"'`{}]/g, (c) => HTML[c]);

/** An http(s) URL safe to put in href, or null. */
export const safeUrl = (u: unknown): string | null => {
	if (typeof u !== 'string' || !u.trim() || u.length > 2048) return null;
	let url: URL;
	try {
		url = new URL(u.trim());
	} catch {
		return null;
	}
	if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return null;
	// braces percent-encoded: the same URL, and never a Liquid delimiter in an email
	return url.href.replace(/\{/g, '%7B').replace(/\}/g, '%7D');
};

/** <a> for a safe URL, else the escaped text alone. Always opens outside the packet, never sends a referrer. */
export const link = (href: unknown, text: unknown): string => {
	const u = safeUrl(href);
	return u ? `<a href="${esc(u)}" rel="noopener noreferrer nofollow" target="_blank">${esc(text)}</a>` : esc(text);
};

/** A relative path we generated (short.mp4, thumbs/v0.png): only safe characters, no scheme, no "..". */
export const safeRelative = (p: string): string | null => (/^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(p) && !p.includes('..') && !p.includes('//') ? p : null);

/** Markdown text: no links, images, HTML or emphasis from feed text; one line. */
export const md = (s: unknown): string =>
	String(s ?? '')
		.replace(/\\/g, '\\\\')
		.replace(/([`*_[\]<>#|!~])/g, '\\$1')
		.replace(/\s*\n\s*/g, ' ')
		.trim();

/** Breaks Liquid's delimiters ("{{", "}}", "{%", "%}") with a space: plain-text emails go through Kit's Liquid too. */
export const noLiquid = (s: string): string => s.replace(/\{(?=[{%])/g, '{ ').replace(/([}%])\}/g, '$1 }');

/** Plain text for email or posts: one line, no control characters, no Liquid delimiters. */
export const plain = (s: unknown): string =>
	noLiquid(
		String(s ?? '')
			// eslint-disable-next-line no-control-regex
			.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
			.replace(/\s*\n\s*/g, ' ')
			.trim(),
	);
