/**
 * Sentences and claims of a narration, for the approval packet. It uses the news gate's own splitter
 * (scripts/news/lib/claims.ts, which wraps the episode engine's markup parser), so sentence numbers match the gate's
 * claim records exactly. If that module cannot be loaded, a small local parser of the same markup is used instead:
 *   {display|spoken}  shown as `display`
 *   [src:id] / [src:a,b]  the preceding claim is backed by these sources
 */
export type ClaimSpan = {display: string; srcIds: string[]};
export type Sentence = {display: string; srcIds: string[]; claims: ClaimSpan[]};
export type Splitter = (narration: string) => Sentence[];

type Seg = {kind: 'text'; text: string} | {kind: 'spoken'; display: string} | {kind: 'src'; ids: string[]};

const parse = (s: string): Seg[] => {
	const out: Seg[] = [];
	let buf = '';
	const flush = () => {
		if (buf) out.push({kind: 'text', text: buf});
		buf = '';
	};
	for (let i = 0; i < s.length; ) {
		if (s[i] === '{') {
			const close = s.indexOf('}', i + 1);
			if (close < 0) throw new Error(`unclosed '{' at ${i}`);
			const body = s.slice(i + 1, close);
			const bar = body.indexOf('|');
			if (bar < 0) throw new Error(`markup at ${i} needs {display|spoken}`);
			flush();
			out.push({kind: 'spoken', display: body.slice(0, bar).trim()});
			i = close + 1;
		} else if (s.startsWith('[src:', i)) {
			const close = s.indexOf(']', i);
			if (close < 0) throw new Error(`unclosed source tag at ${i}`);
			flush();
			out.push({kind: 'src', ids: s.slice(i + 5, close).split(',').map((x) => x.trim()).filter(Boolean)});
			i = close + 1;
		} else buf += s[i++];
	}
	flush();
	return out;
};

const tidy = (s: string) => s.replace(/\s+([.,;:!?…)\]])/g, '$1').replace(/\s+/g, ' ').trim();

/** The fallback splitter: sentence ends at . ! ? … followed by a space or the end. */
export const localSplit: Splitter = (narration) => {
	const sentences: Sentence[] = [];
	let d = '';
	let claims: ClaimSpan[] = [];
	let lastCut = 0;
	const flush = () => {
		const display = tidy(d);
		if (display || claims.length) {
			const rest = tidy(d.slice(lastCut));
			if (claims.length && rest.replace(/[\s.!?…"'”’)\]]/g, '')) claims[claims.length - 1].display = tidy(`${claims[claims.length - 1].display} ${rest}`);
			sentences.push({display, srcIds: [...new Set(claims.flatMap((c) => c.srcIds))], claims: claims.filter((c) => c.display)});
		}
		d = '';
		claims = [];
		lastCut = 0;
	};
	const segs = parse(narration);
	segs.forEach((seg) => {
		if (seg.kind === 'src') {
			if (!d.trim() && sentences.length) {
				const prev = sentences[sentences.length - 1];
				for (const id of seg.ids) if (!prev.srcIds.includes(id)) prev.srcIds.push(id);
				if (prev.claims.length) prev.claims[prev.claims.length - 1].srcIds.push(...seg.ids.filter((id) => !prev.claims[prev.claims.length - 1].srcIds.includes(id)));
				else prev.claims.push({display: prev.display.replace(/[.!?…]+$/, ''), srcIds: [...seg.ids]});
				return;
			}
			const text = tidy(d.slice(lastCut)).replace(/^[,;:\-–—]\s*/, '');
			if (text) claims.push({display: text, srcIds: [...seg.ids]});
			else if (claims.length) claims[claims.length - 1].srcIds.push(...seg.ids);
			lastCut = d.length;
			return;
		}
		const t = seg.kind === 'text' ? seg.text : seg.display;
		for (let k = 0; k < t.length; k++) {
			d += t[k];
			if (seg.kind === 'text' && /[.!?…]/.test(t[k]) && (k + 1 >= t.length || /\s/.test(t[k + 1]))) flush();
		}
	});
	flush();
	return sentences;
};

let cached: Splitter | null = null;

/** The news gate's splitter when it loads, else the local one. */
export const loadSplitter = async (): Promise<{split: Splitter; source: 'news-gate' | 'local'}> => {
	if (cached) return {split: cached, source: 'news-gate'};
	try {
		const mod = (await import('../../news/lib/claims.ts')) as {splitNarration: (n: string) => Array<{display: string; srcIds: string[]; claims: Array<{display: string; srcIds: string[]}>}>};
		cached = (n: string) => mod.splitNarration(n).map((s) => ({display: s.display, srcIds: s.srcIds, claims: s.claims.map((c) => ({display: c.display, srcIds: c.srcIds}))}));
		return {split: cached, source: 'news-gate'};
	} catch {
		return {split: localSplit, source: 'local'};
	}
};

/** Display text of a narration (markup and source tags removed). */
export const displayOf = (narration: string, split: Splitter): string => {
	try {
		return split(narration)
			.map((s) => s.display)
			.join(' ');
	} catch {
		return narration.replace(/\[src:[^\]]*\]/g, '').replace(/\{([^|}]*)\|[^}]*\}/g, '$1');
	}
};
