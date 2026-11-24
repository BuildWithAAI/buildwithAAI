/**
 * Parser for the product content dialect (content/products/<id>/*.md): a small, strict subset of Markdown plus
 * fenced callouts and page directives. Pure functions; errors carry line numbers so a typo never renders silently.
 *
 *   ---                         front matter (key: value lines) at the very top
 *   @cover  @toc  @sources  @pagebreak            page directives (column 0)
 *   # Title {#id kind=chapter spot=seed-phrases}  headings (levels 1-3) with optional attributes
 *   > lede text                                   quote (the first one after a chapter title is its lede)
 *   - [ ] **Action.** detail [@source-id]         checklist item (indented lines continue it)
 *   - bullet      1. numbered                     lists
 *   | a | b |  then  | --- | --- |                 pipe table (header row + separator required)
 *   :::kind Optional title                        fenced block (redflag, fix, note, steps, cards, ladder,
 *   ...                                           compare, flow, fill, upsell); closed by a line ":::"
 *   :::
 */

export type Attrs = {id?: string; classes: string[]; values: Record<string, string>};

export type Block =
	| {type: 'heading'; level: 1 | 2 | 3; text: string; attrs: Attrs; line: number}
	| {type: 'paragraph'; text: string; line: number}
	| {type: 'checklist'; items: {text: string; checked: boolean; line: number}[]; line: number}
	| {type: 'bullets'; items: {text: string; line: number}[]; line: number}
	| {type: 'numbered'; items: {text: string; line: number}[]; line: number}
	| {type: 'quote'; text: string; line: number}
	| {type: 'table'; header: string[]; rows: string[][]; line: number}
	| {type: 'directive'; name: string; arg: string; line: number}
	| {type: 'fence'; kind: string; title: string; attrs: Attrs; body: Block[]; raw: string[]; line: number};

export type Doc = {meta: Record<string, string>; blocks: Block[]};

export class ContentError extends Error {
	readonly line: number;
	constructor(message: string, line: number) {
		super(`line ${line}: ${message}`);
		this.line = line;
	}
}

export const FENCE_KINDS = ['redflag', 'fix', 'note', 'steps', 'cards', 'ladder', 'compare', 'flow', 'fill', 'upsell'] as const;
export type FenceKind = (typeof FENCE_KINDS)[number];
export const DIRECTIVES = ['cover', 'toc', 'sources', 'pagebreak'] as const;

const ATTR_RE = /\s*\{([^{}]*)\}\s*$/;

/** Parses a trailing `{#id .class key=value key2="quoted value"}` block. */
export const parseAttrs = (src: string, line: number): Attrs => {
	const attrs: Attrs = {classes: [], values: {}};
	const re = /#([A-Za-z0-9_-]+)|\.([A-Za-z0-9_-]+)|([A-Za-z][A-Za-z0-9_-]*)=(?:"([^"]*)"|([^\s"]+))|(\S+)/g;
	for (const m of src.matchAll(re)) {
		if (m[1]) {
			if (attrs.id) throw new ContentError(`two ids in {${src}}`, line);
			attrs.id = m[1];
		} else if (m[2]) attrs.classes.push(m[2]);
		else if (m[3]) attrs.values[m[3]] = m[4] ?? m[5] ?? '';
		else throw new ContentError(`cannot read attribute "${m[6]}" in {${src}}`, line);
	}
	return attrs;
};

/** Splits "Text {attrs}" into text and attributes. */
export const splitAttrs = (src: string, line: number): {text: string; attrs: Attrs} => {
	const m = ATTR_RE.exec(src);
	if (!m) return {text: src.trim(), attrs: {classes: [], values: {}}};
	return {text: src.slice(0, m.index).trim(), attrs: parseAttrs(m[1], line)};
};

const parseFrontMatter = (lines: string[]): {meta: Record<string, string>; start: number} => {
	if (lines[0]?.trim() !== '---') return {meta: {}, start: 0};
	const meta: Record<string, string> = {};
	for (let i = 1; i < lines.length; i++) {
		const l = lines[i];
		if (l.trim() === '---') return {meta, start: i + 1};
		if (!l.trim()) continue;
		const m = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(l);
		if (!m) throw new ContentError(`front matter line is not "key: value": ${l}`, i + 1);
		if (m[1] in meta) throw new ContentError(`duplicate front matter key "${m[1]}"`, i + 1);
		meta[m[1]] = m[2].trim();
	}
	throw new ContentError('front matter is not closed with ---', 1);
};

const splitRow = (row: string): string[] => {
	const t = row.trim();
	const inner = t.replace(/^\|/, '').replace(/\|$/, '');
	// a backslash-escaped pipe stays inside the cell
	return inner.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
};

const isTableSeparator = (row: string): boolean => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(row);

/** Parses block-level content (used for the document body and, recursively, for fence bodies). */
export const parseBlocks = (lines: string[], firstLine: number, allowFences = true): Block[] => {
	const blocks: Block[] = [];
	let i = 0;
	const lineNo = (k: number) => firstLine + k;
	let para: {text: string[]; line: number} | null = null;
	const flushPara = () => {
		if (para) blocks.push({type: 'paragraph', text: para.text.join(' '), line: para.line});
		para = null;
	};
	while (i < lines.length) {
		const raw = lines[i];
		const line = raw.replace(/\s+$/, '');
		const n = lineNo(i);
		if (!line.trim()) {
			flushPara();
			i++;
			continue;
		}
		if (/^:::/.test(line)) {
			flushPara();
			if (!allowFences) throw new ContentError('fenced blocks cannot be nested', n);
			const head = line.slice(3).trim();
			if (!head) throw new ContentError('a fence must start with ":::kind"', n);
			const kind = head.split(/\s+/)[0];
			if (!(FENCE_KINDS as readonly string[]).includes(kind)) throw new ContentError(`unknown fence kind "${kind}" (known: ${FENCE_KINDS.join(', ')})`, n);
			const {text: title, attrs} = splitAttrs(head.slice(kind.length), n);
			const body: string[] = [];
			let j = i + 1;
			while (j < lines.length && lines[j].trim() !== ':::') {
				if (/^:::\S/.test(lines[j].trim())) throw new ContentError('fenced blocks cannot be nested', lineNo(j));
				body.push(lines[j]);
				j++;
			}
			if (j >= lines.length) throw new ContentError(`fence ":::${kind}" is never closed`, n);
			const rawBody = body.map((b) => b.replace(/\s+$/, ''));
			const parsedBody = kind === 'compare' || kind === 'fill' ? [] : parseBlocks(rawBody, n + 1, false);
			blocks.push({type: 'fence', kind, title, attrs, body: parsedBody, raw: rawBody.filter((b) => b.trim()), line: n});
			i = j + 1;
			continue;
		}
		if (/^@[a-z]/.test(line)) {
			flushPara();
			const m = /^@([a-z]+)\s*(.*)$/.exec(line);
			if (!m || !(DIRECTIVES as readonly string[]).includes(m[1])) throw new ContentError(`unknown directive "${line}" (known: ${DIRECTIVES.map((d) => '@' + d).join(', ')})`, n);
			blocks.push({type: 'directive', name: m[1], arg: m[2].trim(), line: n});
			i++;
			continue;
		}
		const h = /^(#{1,3})\s+(.+)$/.exec(line);
		if (h) {
			flushPara();
			const {text, attrs} = splitAttrs(h[2], n);
			if (!text) throw new ContentError('empty heading', n);
			blocks.push({type: 'heading', level: h[1].length as 1 | 2 | 3, text, attrs, line: n});
			i++;
			continue;
		}
		if (/^#{4,}\s/.test(line)) throw new ContentError('only heading levels 1-3 are supported', n);
		if (/^>\s?/.test(line)) {
			flushPara();
			const parts: string[] = [];
			const start = n;
			while (i < lines.length && /^>\s?/.test(lines[i])) {
				parts.push(lines[i].replace(/^>\s?/, '').trim());
				i++;
			}
			blocks.push({type: 'quote', text: parts.filter(Boolean).join(' '), line: start});
			continue;
		}
		if (/^\s*\|/.test(line)) {
			flushPara();
			const start = n;
			const header = splitRow(line);
			if (i + 1 >= lines.length || !isTableSeparator(lines[i + 1])) throw new ContentError('a table needs a separator row (| --- | --- |) after its header', n);
			const sepCells = splitRow(lines[i + 1]).length;
			if (sepCells !== header.length) throw new ContentError(`table separator has ${sepCells} cells, header has ${header.length}`, lineNo(i + 1));
			i += 2;
			const rows: string[][] = [];
			while (i < lines.length && /^\s*\|/.test(lines[i])) {
				const cells = splitRow(lines[i]);
				if (cells.length !== header.length) throw new ContentError(`table row has ${cells.length} cells, header has ${header.length}`, lineNo(i));
				rows.push(cells);
				i++;
			}
			blocks.push({type: 'table', header, rows, line: start});
			continue;
		}
		const check = /^- \[( |x|X)\]\s+(.*)$/.exec(line);
		const bullet = /^- (?!\[[ xX]\]\s)(.*)$/.exec(line);
		const num = /^(\d+)\.\s+(.*)$/.exec(line);
		if (check || bullet || num) {
			flushPara();
			const kind = check ? 'checklist' : bullet ? 'bullets' : 'numbered';
			const start = n;
			const items: {text: string; checked: boolean; line: number}[] = [];
			while (i < lines.length) {
				const l = lines[i].replace(/\s+$/, '');
				const c = /^- \[( |x|X)\]\s+(.*)$/.exec(l);
				const b = /^- (?!\[[ xX]\]\s)(.*)$/.exec(l);
				const nm = /^(\d+)\.\s+(.*)$/.exec(l);
				const same = kind === 'checklist' ? c : kind === 'bullets' ? b : nm;
				if (same) {
					const text = kind === 'checklist' ? (c as RegExpExecArray)[2] : kind === 'bullets' ? (b as RegExpExecArray)[1] : (nm as RegExpExecArray)[2];
					items.push({text: text.trim(), checked: kind === 'checklist' && (c as RegExpExecArray)[1] !== ' ', line: lineNo(i)});
					i++;
					continue;
				}
				if (/^\s{2,}\S/.test(l) && items.length) {
					items[items.length - 1].text += ' ' + l.trim();
					i++;
					continue;
				}
				if (c || b || nm) throw new ContentError('a list must not switch type without a blank line', lineNo(i));
				break;
			}
			if (kind === 'checklist') blocks.push({type: 'checklist', items, line: start});
			else if (kind === 'bullets') blocks.push({type: 'bullets', items: items.map(({text, line: l}) => ({text, line: l})), line: start});
			else blocks.push({type: 'numbered', items: items.map(({text, line: l}) => ({text, line: l})), line: start});
			continue;
		}
		if (para) (para as {text: string[]; line: number}).text.push(line.trim());
		else para = {text: [line.trim()], line: n};
		i++;
	}
	flushPara();
	return blocks;
};

export const parseDocument = (src: string): Doc => {
	if (src.includes('\t')) {
		const at = src.slice(0, src.indexOf('\t')).split('\n').length;
		throw new ContentError('tab character (use spaces)', at);
	}
	const lines = src.replace(/\r\n?/g, '\n').split('\n');
	const {meta, start} = parseFrontMatter(lines);
	return {meta, blocks: parseBlocks(lines.slice(start), start + 1)};
};

// ---------------------------------------------------------------------------------------------- structure

export type SectionKind = 'front' | 'chapter' | 'appendix' | 'back' | 'intro';

export type Section = {
	id: string;
	title: string;
	kind: SectionKind;
	/** "01".."12" for chapters, "A".."Z" for appendices, "" otherwise. */
	number: string;
	spot: string | null;
	lede: string | null;
	blocks: Block[];
	line: number;
	/** All heading attributes (kind, spot, toc summary, continue...). */
	values: Record<string, string>;
};

export type Structured = {meta: Record<string, string>; preamble: Block[]; sections: Section[]};

const SECTION_KINDS: readonly SectionKind[] = ['front', 'chapter', 'appendix', 'back'];

/**
 * Groups a document into sections at each level-1 heading. Blocks before the first heading are the preamble
 * (cover and directives). Chapters are numbered 01.., appendices A.. in order of appearance.
 */
export const structure = (doc: Doc): Structured => {
	const preamble: Block[] = [];
	const sections: Section[] = [];
	let chapter = 0;
	let appendix = 0;
	const ids = new Set<string>();
	for (const b of doc.blocks) {
		if (b.type === 'heading' && b.level === 1) {
			const kind = (b.attrs.values.kind ?? 'chapter') as SectionKind;
			if (!SECTION_KINDS.includes(kind)) throw new ContentError(`unknown section kind "${kind}"`, b.line);
			const id = b.attrs.id;
			if (!id) throw new ContentError(`level-1 heading "${b.text}" needs an id: {#some-id}`, b.line);
			if (ids.has(id)) throw new ContentError(`duplicate section id "${id}"`, b.line);
			ids.add(id);
			const number = kind === 'chapter' ? String(++chapter).padStart(2, '0') : kind === 'appendix' ? String.fromCharCode(65 + appendix++) : '';
			sections.push({id, title: b.text, kind, number, spot: b.attrs.values.spot ?? null, lede: null, blocks: [], line: b.line, values: {...b.attrs.values}});
			continue;
		}
		const cur = sections[sections.length - 1];
		if (!cur) {
			preamble.push(b);
			continue;
		}
		if (b.type === 'quote' && cur.lede === null && cur.blocks.length === 0) {
			cur.lede = b.text;
			continue;
		}
		cur.blocks.push(b);
	}
	return {meta: doc.meta, preamble, sections};
};

/** Every block in a list, depth-first (fence bodies included). */
export const walkBlocks = function* (blocks: Block[]): Generator<Block> {
	for (const b of blocks) {
		yield b;
		if (b.type === 'fence') yield* walkBlocks(b.body);
	}
};

/** All inline text of a block (for lint and citation collection). Fence raw lines count for compare/fill. */
export const blockTexts = (b: Block): {text: string; line: number}[] => {
	switch (b.type) {
		case 'heading':
		case 'paragraph':
		case 'quote':
			return [{text: b.text, line: b.line}];
		case 'checklist':
		case 'bullets':
		case 'numbered':
			return b.items.map((it) => ({text: it.text, line: it.line}));
		case 'table':
			return [...b.header, ...b.rows.flat()].map((t) => ({text: t, line: b.line}));
		case 'fence':
			return [
				...(b.title ? [{text: b.title, line: b.line}] : []),
				...(b.kind === 'compare' || b.kind === 'fill' ? b.raw.map((t, k) => ({text: t, line: b.line + 1 + k})) : []),
			];
		default:
			return [];
	}
};
