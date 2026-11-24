/**
 * Narration markup, TypeScript port of scripts/voice/voicelib/markup.py (keep the two in step).
 *   {display|spoken}  shown in captions and on screen as `display`, spoken as `spoken`. Either side may be empty.
 *   [src:id]          the preceding claim is backed by sources[id]; removed from captions and speech. [src:a,b] is allowed.
 * Pure (no Remotion, no DOM): the Node tests and the mock timeline use it too.
 */

export class MarkupError extends Error {}

export type Segment = {kind: 'text'; text: string} | {kind: 'spoken'; display: string; spoken: string} | {kind: 'src'; id: string};

const SRC_ID = /^[A-Za-z0-9][A-Za-z0-9_.:\-/]*$/;
/** Punctuation that hugs the previous word, so removing "[src:x]" never leaves "claim ." behind. */
const HUG = '.,;:!?…)]}»”"\'%。，、；：！？）」』।॥';

export const parseMarkup = (narration: string): Segment[] => {
	if (typeof narration !== 'string') throw new MarkupError(`narration must be a string, got ${typeof narration}`);
	const out: Segment[] = [];
	let buf = '';
	const flush = () => {
		if (buf) out.push({kind: 'text', text: buf});
		buf = '';
	};
	let i = 0;
	while (i < narration.length) {
		const ch = narration[i];
		if (ch === '{') {
			const close = narration.indexOf('}', i + 1);
			if (close < 0) throw new MarkupError(`unclosed '{' at ${i}: ${JSON.stringify(narration.slice(i, i + 30))}`);
			const body = narration.slice(i + 1, close);
			if (body.includes('{')) throw new MarkupError(`nested '{' inside markup at ${i}`);
			const parts = body.split('|');
			if (parts.length !== 2) throw new MarkupError(`markup at ${i} needs exactly one '|' as {display|spoken}: ${JSON.stringify(narration.slice(i, close + 1))}`);
			const [display, spoken] = parts;
			if (!display.trim() && !spoken.trim()) throw new MarkupError(`empty markup at ${i}`);
			flush();
			out.push({kind: 'spoken', display: display.trim(), spoken: spoken.trim()});
			i = close + 1;
		} else if (ch === '}') {
			throw new MarkupError(`unmatched '}' at ${i}`);
		} else if (ch === '[' && narration.startsWith('[src:', i)) {
			const m = /^\[src:\s*([^\]]*?)\s*\]/.exec(narration.slice(i));
			if (!m) throw new MarkupError(`unclosed source tag at ${i}`);
			const ids = m[1].split(',').map((s) => s.trim());
			if (!ids.length || ids.some((s) => !SRC_ID.test(s))) throw new MarkupError(`bad source id in ${m[0]} at ${i}`);
			flush();
			for (const id of ids) out.push({kind: 'src', id});
			i += m[0].length;
		} else {
			buf += ch;
			i++;
		}
	}
	flush();
	return out;
};

const shownText = (s: Segment): string => (s.kind === 'text' ? s.text : s.kind === 'spoken' ? s.display : '');

/** Drop source tags and repair the whitespace they leave (mirrors strip_sources in markup.py). */
const stripSources = (segs: Segment[]): Segment[] => {
	const out: Segment[] = [];
	segs.forEach((seg, idx) => {
		if (seg.kind !== 'src') {
			out.push(seg);
			return;
		}
		const nxt = segs.slice(idx + 1).find((s) => s.kind !== 'src');
		const nxtText = nxt ? shownText(nxt) : '';
		const last = out[out.length - 1];
		if (last && last.kind === 'text' && (!nxtText || /^\s/.test(nxtText) || HUG.includes(nxtText[0]))) {
			out[out.length - 1] = {kind: 'text', text: last.text.replace(/\s+$/, '')};
		}
	});
	const merged: Segment[] = [];
	for (const s of out) {
		const last = merged[merged.length - 1];
		if (s.kind === 'text' && last && last.kind === 'text') merged[merged.length - 1] = {kind: 'text', text: last.text + s.text};
		else merged.push(s);
	}
	return merged.filter((s) => !(s.kind === 'text' && s.text === ''));
};

const join = (parts: string[]) => parts.join('').replace(/[ \t]{2,}/g, ' ').trim();

/** Caption / on-screen text: display sides, no source tags. */
export const displayText = (narration: string): string => join(stripSources(parseMarkup(narration)).map(shownText));

/** Spoken text before number normalization (what the voice step feeds its normalizer). */
export const spokenText = (narration: string): string =>
	join(stripSources(parseMarkup(narration)).map((s) => (s.kind === 'text' ? s.text : s.kind === 'spoken' ? s.spoken : '')));

export const sourceIds = (narration: string): string[] => parseMarkup(narration).flatMap((s) => (s.kind === 'src' ? [s.id] : []));

/**
 * Where each source tag sits in the DISPLAY text: the character offset of the end of the claim it backs. The scene maps
 * the offset to a timeline word, so the sources card appears when the claim is spoken.
 */
export const sourceOffsets = (narration: string): Array<{id: string; offset: number}> => {
	const segs = parseMarkup(narration);
	const out: Array<{id: string; offset: number}> = [];
	segs.forEach((s, k) => {
		if (s.kind !== 'src') return;
		// display text of everything before this tag (with the tags before it removed), whitespace-normalised the same way
		const before = join(stripSources(segs.slice(0, k)).map(shownText));
		out.push({id: s.id, offset: before.length});
	});
	return out;
};

/** Languages whose text is written without spaces between words. */
export const UNSPACED = new Set(['zh', 'ja']);

const LATIN_END = /[A-Za-z0-9$%)]$/;
const LATIN_START = /^[A-Za-z0-9$(]/;
/** Join word tokens for display: spaces in spaced languages; none in zh/ja except between two Latin tokens. */
export const joinTokens = (tokens: string[], lang: string): string => {
	if (!UNSPACED.has(lang)) return tokens.join(' ');
	let out = '';
	tokens.forEach((t, i) => {
		out += (i > 0 && LATIN_END.test(tokens[i - 1]) && LATIN_START.test(t) ? ' ' : '') + t;
	});
	return out;
};

/**
 * Display words of a narration: split on whitespace; unspaced languages use Intl.Segmenter words, with punctuation
 * attached to the word before it (a stand-in for the voice step's segmentation, used by the mock timeline only).
 */
export const displayWords = (narration: string, lang: string): string[] => {
	const t = displayText(narration);
	if (!t) return [];
	if (!UNSPACED.has(lang)) return t.split(/\s+/).filter(Boolean);
	const seg = new Intl.Segmenter(lang === 'ja' ? 'ja' : 'zh', {granularity: 'word'});
	const out: string[] = [];
	for (const {segment, isWordLike} of seg.segment(t)) {
		if (/^\s+$/.test(segment)) continue;
		if (!isWordLike && out.length && HUG.includes(segment[0])) out[out.length - 1] += segment;
		else out.push(segment);
	}
	return out;
};
