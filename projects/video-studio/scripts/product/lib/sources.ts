/**
 * The bibliography (content/products/<id>/sources.json): loading, validation and citation numbering.
 * Numbers are assigned in order of first citation, per edition, so each PDF's source list is short and ordered.
 */
import {escapeHtml} from './inline.ts';

export type SourceKind = 'government' | 'regulator' | 'standard' | 'security-firm' | 'research' | 'wallet-docs' | 'exchange-docs' | 'news';
export type VerifyMethod = 'read' | 'search-extract';

export type Source = {
	id: string;
	title: string;
	publisher: string;
	/** YYYY, YYYY-MM, YYYY-MM-DD or "n.d." */
	date: string;
	url: string;
	kind: SourceKind;
	method: VerifyMethod;
	supports: string;
};

export type SourceFile = {version: 1; checked: string; methods: Record<VerifyMethod, string>; sources: Source[]};

const KINDS: readonly SourceKind[] = ['government', 'regulator', 'standard', 'security-firm', 'research', 'wallet-docs', 'exchange-docs', 'news'];
const METHODS: readonly VerifyMethod[] = ['read', 'search-extract'];

/** Returns a list of problems (empty when the file is valid). */
export const validateSources = (data: unknown): string[] => {
	const errors: string[] = [];
	const d = data as Partial<SourceFile>;
	if (!d || typeof d !== 'object') return ['sources file is not an object'];
	if (d.version !== 1) errors.push('version must be 1');
	if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.checked))) errors.push('checked must be YYYY-MM-DD');
	if (!Array.isArray(d.sources) || !d.sources.length) return [...errors, 'sources must be a non-empty array'];
	const seen = new Set<string>();
	for (const [k, s] of d.sources.entries()) {
		const at = `sources[${k}]${s && typeof s.id === 'string' ? ` (${s.id})` : ''}`;
		if (!s || typeof s !== 'object') {
			errors.push(`${at}: not an object`);
			continue;
		}
		if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s.id)) errors.push(`${at}: id must be a lowercase slug`);
		if (seen.has(s.id)) errors.push(`${at}: duplicate id`);
		seen.add(s.id);
		for (const f of ['title', 'publisher', 'supports'] as const) if (typeof s[f] !== 'string' || !s[f].trim()) errors.push(`${at}: ${f} is required`);
		if (!/^(\d{4}(-\d{2}(-\d{2})?)?|n\.d\.)$/.test(String(s.date))) errors.push(`${at}: date must be YYYY, YYYY-MM, YYYY-MM-DD or n.d.`);
		let url: URL | null = null;
		try {
			url = new URL(String(s.url));
		} catch {
			errors.push(`${at}: url is not a valid URL`);
		}
		if (url && url.protocol !== 'https:') errors.push(`${at}: url must be https`);
		if (!KINDS.includes(s.kind)) errors.push(`${at}: kind must be one of ${KINDS.join(', ')}`);
		if (!METHODS.includes(s.method)) errors.push(`${at}: method must be one of ${METHODS.join(', ')}`);
	}
	return errors;
};

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2024-12-03" -> "3 December 2024"; "2025-07" -> "July 2025"; "2025" -> "2025"; "n.d." -> "undated". */
export const formatDate = (d: string): string => {
	if (d === 'n.d.') return 'undated';
	const [y, m, day] = d.split('-');
	if (!m) return y;
	const month = MONTHS[Number(m) - 1];
	return day ? `${Number(day)} ${month} ${y}` : `${month} ${y}`;
};

/** Assigns citation numbers in order of first use. */
export class CitationRegistry {
	private order: string[] = [];
	private byId: Map<string, Source>;
	readonly missing = new Set<string>();

	constructor(sources: Source[]) {
		this.byId = new Map(sources.map((s) => [s.id, s]));
	}

	number(id: string): number {
		if (!this.byId.has(id)) this.missing.add(id);
		let n = this.order.indexOf(id);
		if (n < 0) {
			this.order.push(id);
			n = this.order.length - 1;
		}
		return n + 1;
	}

	/** Cited sources in citation order (unknown ids skipped; they are reported through `missing`). */
	cited(): {n: number; source: Source}[] {
		return this.order.flatMap((id, k) => {
			const source = this.byId.get(id);
			return source ? [{n: k + 1, source}] : [];
		});
	}

	/** Superscript marker for a citation group, linking to the source list. */
	marker(ids: string[]): string {
		const nums = [...new Set(ids)].map((id) => ({id, n: this.number(id)})).sort((a, b) => a.n - b.n);
		const links = nums.map(({id, n}) => `<a href="#src-${escapeHtml(id)}">${n}</a>`).join('<span class="cite-sep">,</span>');
		return `<sup class="cite">${links}</sup>`;
	}
}
