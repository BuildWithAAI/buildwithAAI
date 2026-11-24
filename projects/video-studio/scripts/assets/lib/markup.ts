/**
 * Narration markup adapter (the contract is documented on StoryboardScene.narration in src/episode/types.ts):
 *   {display|spoken}  captions and on-screen text show `display`; the voice says `spoken`.
 *   [src:id] / [src:a,b]  the preceding claim is backed by sources[id]; removed from captions and speech.
 * This mirrors displayText() and sourceIds() of src/episode/markup.ts (owned by the episode builder). It lives here so
 * the asset tools never break when that module changes; tests/markup.test.ts compares the two on every fixture and edge
 * case, so any drift fails the tests.
 */

type Segment = {kind: 'text'; text: string} | {kind: 'spoken'; display: string; spoken: string} | {kind: 'src'; id: string};

export class MarkupError extends Error {}

const SRC_ID = /^[A-Za-z0-9][A-Za-z0-9_.:\-/]*$/;
/** Punctuation that hugs the previous word, so removing "[src:x]" never leaves "claim ." behind. */
const HUG = '.,;:!?…)]}»”"\'%。，、；：！？）」』।॥';

const parse = (narration: string): Segment[] => {
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
			if (close < 0) throw new MarkupError(`unclosed '{' at ${i}`);
			const body = narration.slice(i + 1, close);
			if (body.includes('{')) throw new MarkupError(`nested '{' inside markup at ${i}`);
			const parts = body.split('|');
			if (parts.length !== 2) throw new MarkupError(`markup at ${i} needs exactly one '|' as {display|spoken}`);
			if (!parts[0].trim() && !parts[1].trim()) throw new MarkupError(`empty markup at ${i}`);
			flush();
			out.push({kind: 'spoken', display: parts[0].trim(), spoken: parts[1].trim()});
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

const shown = (s: Segment): string => (s.kind === 'text' ? s.text : s.kind === 'spoken' ? s.display : '');

const stripSources = (segs: Segment[]): Segment[] => {
	const out: Segment[] = [];
	segs.forEach((seg, idx) => {
		if (seg.kind !== 'src') {
			out.push(seg);
			return;
		}
		const next = segs.slice(idx + 1).find((s) => s.kind !== 'src');
		const nextText = next ? shown(next) : '';
		const last = out[out.length - 1];
		if (last && last.kind === 'text' && (!nextText || /^\s/.test(nextText) || HUG.includes(nextText[0]))) {
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

/** Caption / on-screen text: the display sides, without source tags. */
export const displayText = (narration: string): string =>
	stripSources(parse(narration))
		.map(shown)
		.join('')
		.replace(/[ \t]{2,}/g, ' ')
		.trim();

/** Source ids cited in a narration, in order of appearance (duplicates kept once). */
export const sourceIds = (narration: string): string[] => [...new Set(parse(narration).flatMap((s) => (s.kind === 'src' ? [s.id] : [])))];

/** Languages written without spaces between words (their timeline words are joined without spaces). */
export const UNSPACED = new Set(['zh', 'ja']);
