/**
 * Escaping for the weekly approval page. Every string that reaches the page (storyboard text, source titles and
 * quotes, gate findings, file names) is escaped; a URL becomes a link only when it is plain http(s) without
 * credentials, and a media path only when it is a relative path the batch generated.
 */

const HTML: Record<string, string> = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;'};

/** Text content and double-quoted attribute values. */
export const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"'`]/g, (c) => HTML[c]);

/** An http(s) URL safe for href, or null. */
export const safeUrl = (u: unknown): string | null => {
	if (typeof u !== 'string' || !u.trim() || u.length > 2048) return null;
	let url: URL;
	try {
		url = new URL(u.trim());
	} catch {
		return null;
	}
	if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return null;
	return url.href;
};

/** <a> for a safe URL, else the escaped text alone. Opens outside the page and never sends a referrer. */
export const link = (href: unknown, text: unknown): string => {
	const u = safeUrl(href);
	return u ? `<a href="${esc(u)}" rel="noopener noreferrer nofollow" target="_blank">${esc(text)}</a>` : esc(text);
};

/** A relative media path the batch wrote (no scheme, no "..", no leading slash): safe for src/href, or null. */
export const safeRelative = (p: string): string | null =>
	/^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(p) && !p.split('/').includes('..') && !p.includes('//') ? p : /^(\.\.\/)+[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(p) && !p.replace(/^(\.\.\/)+/, '').split('/').includes('..') ? p : null;
