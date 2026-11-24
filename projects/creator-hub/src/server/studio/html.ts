/**
 * Auto-escaping HTML templates for the studio pages.
 *
 * Every value interpolated into html`...` is escaped unless it is already SafeHtml (built by html``
 * or raw()). Escaping covers & < > " ' so values are safe in text and in QUOTED attribute values.
 * Never interpolate into unquoted attributes, <script> or <style>, and only put URLs that were
 * validated as https into href attributes.
 */

const ESCAPES: Record<string, string> = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'};

export const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);

export class SafeHtml {
	readonly html: string;
	constructor(html: string) {
		this.html = html;
	}
	toString(): string {
		return this.html;
	}
}

/** Trusted markup only (constants written in this codebase). Never pass visitor or config input. */
export const raw = (markup: string): SafeHtml => new SafeHtml(markup);

const renderValue = (value: unknown): string => {
	if (value === null || value === undefined || value === false) return '';
	if (value instanceof SafeHtml) return value.html;
	if (Array.isArray(value)) return value.map(renderValue).join('');
	return escapeHtml(String(value));
};

export const html = (strings: TemplateStringsArray, ...values: unknown[]): SafeHtml => {
	let out = strings[0] ?? '';
	values.forEach((value, i) => {
		out += renderValue(value) + (strings[i + 1] ?? '');
	});
	return new SafeHtml(out);
};
