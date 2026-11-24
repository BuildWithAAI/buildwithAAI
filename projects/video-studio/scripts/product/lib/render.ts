/**
 * Content (parsed dialect) -> print HTML for the product PDFs. Pure: no file system or browser access; the caller
 * passes in what it needs (spot sizes, TOC page numbers from a first pass, product settings).
 *
 * Two layouts share the components:
 *  - full: cover, front matter, contents, numbered chapters with spot illustrations, appendices, sources, about;
 *  - free: a two-page sheet (header band, checklist groups in two columns, "if something goes wrong", sources).
 */
import {blockTexts, ContentError, walkBlocks, type Block, type Section, type Structured} from './markdown.ts';
import {escapeHtml, inline, parseInline, plainText, renderInline, type InlineContext, type InlineNode} from './inline.ts';
import {chapterIcon, icon, type IconName} from './icons.ts';
import {CitationRegistry, formatDate, type Source, type SourceFile} from './sources.ts';
import {cssString} from './styles.ts';

export type Product = {
	id: string;
	title: string;
	/** Legal name for the copyright line (owner input). */
	copyrightHolder: string;
	/** Public contact for corrections (owner input); null hides the line. */
	contact: string | null;
	/** Where the full edition is sold or delivered (owner input, a hub link); null hides the link. */
	fullEditionUrl: string | null;
	licence: {free: string; full: string};
};

export type Edition = 'free' | 'full';

export type SpotInfo = {id: string; src: string; widthPx: number; heightPx: number; alt: string};

export type RenderOptions = {
	edition: Edition;
	product: Product;
	sources: SourceFile;
	/** Spot illustrations available to the page (exported SVGs). Missing spots are reported, never invented. */
	spots: Record<string, SpotInfo>;
	/** Section id -> page number, from the first print pass. Absent on the first pass ("00" placeholders). */
	tocPages?: Record<string, number>;
	/** Licence and copyright line at the end of the full layout (default true; off for documents that aren't the product). */
	colophon?: boolean;
};

export type Rendered = {
	html: string;
	body: string;
	registry: CitationRegistry;
	/** Named pages with running headers, for the stylesheet. */
	pages: {name: string; label: string}[];
	/** Section ids the contents page links to (their PDF destinations give the page numbers). */
	tocTargets: string[];
	warnings: string[];
	footer: string;
};

type Ctx = {
	opts: RenderOptions;
	inl: InlineContext;
	registry: CitationRegistry;
	warnings: string[];
	section: Section | null;
	structured: Structured;
};

const PRIORITY: Record<string, {cls: string; icon: IconName}> = {
	today: {cls: 'prio-today', icon: 'clock'},
	week: {cls: 'prio-week', icon: 'calendar'},
	habit: {cls: 'prio-habit', icon: 'repeat'},
};

/** Card titles that name a priority get that priority's mark (the how-to-use legend). */
const priorityForTitle = (title: string): string | null => {
	const t = title.toLowerCase().replace(/[^a-z ]/g, '').trim();
	if (t === 'do today') return 'today';
	if (t === 'this week') return 'week';
	if (t === 'habits' || t === 'habit') return 'habit';
	return null;
};

const prioMark = (p: string): string => `<span class="prio-mark" aria-hidden="true">${icon(PRIORITY[p].icon, '10pt', 'currentColor', 2.4)}</span>`;

const md = (s: string, ctx: Ctx): string => inline(s, ctx.inl);

/** Splits "**Title.** rest" into a title (no trailing period) and the rest of the nodes. */
export const splitLeadStrong = (nodes: InlineNode[]): {title: InlineNode[] | null; rest: InlineNode[]} => {
	const [first, ...rest] = nodes;
	if (!first || first.t !== 'strong') return {title: null, rest: nodes};
	const title = [...first.c];
	const last = title[title.length - 1];
	if (last && last.t === 'text') title[title.length - 1] = {t: 'text', v: last.v.replace(/[.:]\s*$/, '')};
	const trimmed = [...rest];
	if (trimmed[0]?.t === 'text') trimmed[0] = {t: 'text', v: (trimmed[0] as {v: string}).v.replace(/^\s+/, '')};
	return {title, rest: trimmed};
};

// ------------------------------------------------------------------------------------------ blocks

const renderChecklist = (b: Extract<Block, {type: 'checklist'}>, ctx: Ctx): string =>
	`<ul class="checklist">${b.items
		.map((it) => `<li class="check"><span class="box${it.checked ? ' done' : ''}" aria-hidden="true"></span><div class="check-text">${md(it.text, ctx)}</div></li>`)
		.join('')}</ul>`;

const renderTable = (b: Extract<Block, {type: 'table'}>, ctx: Ctx): string => {
	const blank = b.rows.every((r) => r.every((c) => !c.trim()));
	const head = `<thead><tr>${b.header.map((h) => `<th>${md(h, ctx)}</th>`).join('')}</tr></thead>`;
	const rows = b.rows.map((r) => `<tr>${r.map((c) => `<td>${c.trim() ? md(c, ctx) : '&nbsp;'}</td>`).join('')}</tr>`).join('');
	// short tables stay on one page; long ones may break between rows (the header repeats)
	const keep = b.rows.length <= 12 ? ' keep' : '';
	return `<table class="${blank ? 'blank' : 'data'}${keep}">${head}<tbody>${rows}</tbody></table>`;
};

const listItemsOf = (body: Block[], kind: string, line: number): {text: string; line: number}[] => {
	const lists = body.filter((x) => x.type === 'bullets' || x.type === 'numbered' || x.type === 'checklist');
	if (lists.length !== 1 || body.length !== 1) throw new ContentError(`a :::${kind} block must contain exactly one list`, line);
	return (lists[0] as {items: {text: string; line: number}[]}).items;
};

const renderCards = (b: Extract<Block, {type: 'fence'}>, ctx: Ctx): string => {
	const items = listItemsOf(b.body, 'cards', b.line);
	const cards = items.map((it) => {
		const {title, rest} = splitLeadStrong(parseInline(it.text));
		if (!title) throw new ContentError('each card must start with a **Title.**', it.line);
		const titleText = plainText(title);
		const p = priorityForTitle(titleText);
		const pre = p ? `<span class="${PRIORITY[p].cls}">${prioMark(p)}</span>` : '';
		return `<div class="card"><div class="card-title">${pre}${renderInline(title, ctx.inl)}</div><p>${renderInline(rest, ctx.inl)}</p></div>`;
	});
	const extra = b.attrs.classes.filter((c) => /^[a-z][a-z0-9-]*$/.test(c)).join(' ');
	return `<div class="cards${extra ? ` ${extra}` : ''}" style="--cols:${Math.min(4, items.length)}">${cards.join('')}</div>`;
};

const LADDER_LEVELS: Record<string, {bars: number; label: string}> = {
	best: {bars: 4, label: 'Best'},
	good: {bars: 3, label: 'Good'},
	weak: {bars: 1, label: 'Weak'},
	none: {bars: 0, label: 'None'},
};

const renderLadder = (b: Extract<Block, {type: 'fence'}>, ctx: Ctx): string => {
	const items = listItemsOf(b.body, 'ladder', b.line);
	const rungs = items.map((it) => {
		const m = /^\[(best|good|weak|none)\]\s+(.*)$/.exec(it.text);
		if (!m) throw new ContentError('each ladder item must start with [best], [good], [weak] or [none]', it.line);
		const lv = LADDER_LEVELS[m[1]];
		const bars = Array.from({length: 4}, (_, k) => `<i class="${k < lv.bars ? 'on' : ''}"></i>`).join('');
		return `<div class="rung"><div class="meter"><div class="bars" aria-hidden="true">${bars}</div><div class="level">${lv.label}</div></div><p>${md(m[2], ctx)}</p></div>`;
	});
	const title = b.title ? `<div class="ladder-title">${md(b.title, ctx)}</div>` : '';
	return `<div class="ladder">${title}${rungs.join('')}</div>`;
};

/** Address comparison: rows "Label: 0x<hex>"; chunks of four that match across all rows are highlighted. */
export const compareRows = (raw: string[], line: number): {label: string; prefix: string; chunks: string[]}[] => {
	const rows = raw.map((r, k) => {
		const m = /^([^:]{1,24}):\s*(0x)?([0-9a-fA-F]+)\s*$/.exec(r.trim());
		if (!m) throw new ContentError(`compare rows must look like "Label: 0x1234..." (got "${r}")`, line + 1 + k);
		const hex = m[3];
		if (hex.length % 4 !== 0) throw new ContentError('compare addresses must have a multiple of four hex digits', line + 1 + k);
		return {label: m[1].trim(), prefix: m[2] ?? '', chunks: hex.match(/.{4}/g) as string[]};
	});
	if (rows.length < 2) throw new ContentError('a :::compare block needs at least two rows', line);
	if (new Set(rows.map((r) => r.chunks.length)).size !== 1) throw new ContentError('compare addresses must have the same length', line);
	return rows;
};

const renderCompare = (b: Extract<Block, {type: 'fence'}>, ctx: Ctx): string => {
	const rows = compareRows(b.raw, b.line);
	const same = rows[0].chunks.map((c, k) => rows.every((r) => r.chunks[k].toLowerCase() === c.toLowerCase()));
	const html = rows
		.map(
			(r) =>
				`<div class="addr-row"><span class="addr-label">${escapeHtml(r.label)}</span><span class="addr"><span class="prefix">${escapeHtml(r.prefix)}</span>${r.chunks
					.map((c, k) => `<span class="chunk${same[k] ? ' same' : ''}">${escapeHtml(c)}</span>`)
					.join('')}</span></div>`,
		)
		.join('');
	const title = b.title ? `<div class="note-title">${icon('swap', '11pt')}${md(b.title, ctx)}</div>` : '';
	return `<div class="compare">${title}${html}<div class="legend"><span class="swatch"></span>Identical groups. Everything in between is different.</div></div>`;
};

const arrow = `<svg class="arrow" width="11" height="12" viewBox="0 0 11 12" aria-hidden="true"><path d="M2 1.5 8.5 6 2 10.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const renderFlow = (b: Extract<Block, {type: 'fence'}>, ctx: Ctx): string => {
	const items = listItemsOf(b.body, 'flow', b.line);
	const steps = items.map((it, k) => {
		const {title, rest} = splitLeadStrong(parseInline(it.text));
		if (!title) throw new ContentError('each flow step must start with a **Title.**', it.line);
		return `<div class="flow-step"><div class="n">${k + 1}</div><p><strong>${renderInline(title, ctx.inl)}.</strong> ${renderInline(rest, ctx.inl)}</p>${k < items.length - 1 ? arrow : ''}</div>`;
	});
	const title = b.title ? `<div class="flow-title">${md(b.title, ctx)}</div>` : '';
	return `${title}<div class="flow" style="--steps:${items.length}">${steps.join('')}</div>`;
};

const renderFill = (b: Extract<Block, {type: 'fence'}>, ctx: Ctx): string => {
	const lines = b.raw.map((r, k) => {
		const label = r.trim().replace(/:\s*$/, '');
		if (!label) throw new ContentError('empty fill line', b.line + 1 + k);
		return `<div class="fill-line"><span class="label">${md(label, ctx)}</span><span class="rule"></span></div>`;
	});
	return `<div class="fill">${lines.join('')}</div>`;
};

const renderCallout = (b: Extract<Block, {type: 'fence'}>, ctx: Ctx): string => {
	const body = renderBlocks(b.body, ctx);
	if (b.kind === 'redflag') return `<aside class="callout redflag"><div class="callout-title">${icon('flag', '13pt', 'currentColor', 2.2)}${b.title ? md(b.title, ctx) : "Badger's Red Flag"}</div>${body}</aside>`;
	if (b.kind === 'fix') return `<aside class="callout fix"><div class="callout-title">${icon('wrench', '13pt', 'currentColor', 2.2)}${b.title ? md(b.title, ctx) : "Zoo's One Fix"}</div>${body}</aside>`;
	if (b.kind === 'steps') {
		const items = listItemsOf(b.body, 'steps', b.line);
		const title = b.title ? `<div class="note-title">${icon('list', '11pt')}${md(b.title, ctx)}</div>` : '';
		return `<div class="steps">${title}<ol>${items.map((it) => `<li><span>${md(it.text, ctx)}</span></li>`).join('')}</ol></div>`;
	}
	if (b.kind === 'upsell') {
		const url = ctx.opts.product.fullEditionUrl;
		const link = url ? `<p style="margin-top:6pt"><strong>Get it:</strong> <a href="${escapeHtml(url)}">${escapeHtml(url.replace(/^https:\/\//, ''))}</a></p>` : '';
		return `<div class="upsell"><div class="note-title">${icon('book', '11pt')}${md(b.title || 'The full edition', ctx)}</div>${body}${link}</div>`;
	}
	const title = b.title ? `<div class="note-title">${icon('info', '11pt')}${md(b.title, ctx)}</div>` : '';
	return `<div class="note">${title}${body}</div>`;
};

const renderFence = (b: Extract<Block, {type: 'fence'}>, ctx: Ctx): string => {
	switch (b.kind) {
		case 'cards':
			return renderCards(b, ctx);
		case 'ladder':
			return renderLadder(b, ctx);
		case 'compare':
			return renderCompare(b, ctx);
		case 'flow':
			return renderFlow(b, ctx);
		case 'fill':
			return renderFill(b, ctx);
		default:
			return renderCallout(b, ctx);
	}
};

const renderBlock = (b: Block, ctx: Ctx): string => {
	switch (b.type) {
		case 'heading': {
			if (b.level === 1) throw new ContentError('unexpected level-1 heading inside a section', b.line);
			const p = b.attrs.values.priority;
			if (p) {
				if (!PRIORITY[p]) throw new ContentError(`unknown priority "${p}" (today, week, habit)`, b.line);
				return `<h2 class="${PRIORITY[p].cls}">${prioMark(p)}<span>${md(b.text, ctx)}</span></h2>`;
			}
			const id = b.attrs.id ? ` id="${escapeHtml(b.attrs.id)}"` : '';
			return b.level === 2 ? `<h2${id}>${md(b.text, ctx)}</h2>` : `<h3${id}>${md(b.text, ctx)}</h3>`;
		}
		case 'paragraph':
			return `<p>${md(b.text, ctx)}</p>`;
		case 'quote':
			return `<p class="lede">${md(b.text, ctx)}</p>`;
		case 'checklist':
			return renderChecklist(b, ctx);
		case 'bullets':
			return `<ul class="plain">${b.items.map((it) => `<li>${md(it.text, ctx)}</li>`).join('')}</ul>`;
		case 'numbered': {
			const cls = ctx.section?.kind === 'front' ? 'rules' : 'plain';
			return `<ol class="${cls}">${b.items.map((it) => `<li><span>${md(it.text, ctx)}</span></li>`).join('')}</ol>`;
		}
		case 'table':
			return renderTable(b, ctx);
		case 'fence':
			return renderFence(b, ctx);
		case 'directive':
			if (b.name === 'toc') return renderToc(ctx);
			if (b.name === 'sources') return SOURCES_PLACEHOLDER;
			if (b.name === 'pagebreak') return '<div style="break-after:page"></div>';
			throw new ContentError(`@${b.name} is only allowed before the first section`, b.line);
	}
};

/** Renders blocks; a red-flag box directly followed by a one-fix box becomes a side-by-side pair. */
export const renderBlocks = (blocks: Block[], ctx: Ctx): string => {
	let html = '';
	for (let i = 0; i < blocks.length; i++) {
		const b = blocks[i];
		const next = blocks[i + 1];
		if (b.type === 'fence' && b.kind === 'redflag' && next?.type === 'fence' && next.kind === 'fix') {
			html += `<div class="pair">${renderFence(b, ctx)}${renderFence(next, ctx)}</div>`;
			i++;
			continue;
		}
		html += renderBlock(b, ctx);
	}
	return html;
};

// ------------------------------------------------------------------------------------------ pages

const spotImg = (id: string | null, ctx: Ctx, cls = 'spot'): string => {
	if (!id) return '';
	const s = ctx.opts.spots[id];
	if (!s) {
		ctx.warnings.push(`spot "${id}" is not rendered yet (run without --skip-spots)`);
		return '';
	}
	return `<div class="${cls}"><img src="${escapeHtml(s.src)}" width="${s.widthPx}" height="${s.heightPx}" alt="${escapeHtml(s.alt)}"></div>`;
};

const meta = (ctx: Ctx, key: string, fallback = ''): string => ctx.structured.meta[key] ?? fallback;

const monthYear = (iso: string): string => formatDate(iso.slice(0, 7));

const plate = (): string =>
	`<div class="plate" aria-label="The Zoo &amp; Badger Show"><div class="the">The</div><div class="main">Zoo <span class="amp">&amp;</span> Badger</div><div class="show">Show</div></div>`;

const renderCover = (ctx: Ctx): string => {
	const slats = Array.from({length: 9}, () => '<span class="slat"></span>').join('');
	const checked = formatDate(ctx.opts.sources.checked);
	// a statement about the product (front matter), never a default: only content can make it
	const independence = meta(ctx, 'independence');
	return `<section class="cover" aria-label="Cover">
<div class="slats" aria-hidden="true">${slats}</div>
${plate()}
<div class="title-block">
<div class="edition"><span class="dot"></span>${escapeHtml(meta(ctx, 'editionLabel', 'Full edition'))}</div>
<h1>${md(meta(ctx, 'title'), ctx)}</h1>
<p class="subtitle">${md(meta(ctx, 'subtitle'), ctx)}</p>
<p class="byline">${md(meta(ctx, 'byline'), ctx)}</p>
</div>
<div class="floor" aria-hidden="true"></div>
${spotImg('cover-pair', ctx, 'art')}
<div class="facts"><span>${icon('calendar', '10pt')}Version ${escapeHtml(meta(ctx, 'version'))} · ${escapeHtml(monthYear(meta(ctx, 'date')))}</span><span>${icon('book', '10pt')}Every fact sourced, checked ${escapeHtml(checked)}</span>${independence ? `<span>${icon('shield', '10pt')}${escapeHtml(independence)}</span>` : ''}</div>
</section>`;
};

const sectionLabel = (s: Section): string => {
	if (s.kind === 'chapter') return `${s.number} · ${s.title}`;
	if (s.kind === 'appendix') return `Appendix ${s.number} · ${s.title}`;
	return s.title;
};

/** Named page of a section: a section marked continue=true shares the previous section's page (no forced break). */
const pageNameIn = (sections: Section[], s: Section): string => {
	let k = sections.indexOf(s);
	while (k > 0 && sections[k].values.continue === 'true') k--;
	return `p-${sections[Math.max(0, k)].id}`;
};

const renderSection = (s: Section, ctx: Ctx, first: boolean): string => {
	ctx.section = s;
	// Render in reading order (title, lede, then body) so citation numbers rise down the page.
	const title = md(s.title, ctx);
	const ledeHtml = s.lede ? md(s.lede, ctx) : null;
	const body = renderBlocks(s.blocks, ctx);
	const pageStyle = ` style="page:${pageNameIn(ctx.structured.sections, s)}"`;
	const cont = s.values.continue === 'true' ? ' continue' : '';
	if (s.kind === 'chapter' || s.kind === 'appendix') {
		const kicker =
			s.kind === 'chapter'
				? `<div class="kicker"><span class="num">${s.number}</span>${icon(chapterIcon(s.id), '12pt', 'currentColor', 2.2)}<span>Chapter</span></div>`
				: `<div class="kicker"><span class="num">${s.number}</span><span>Appendix</span></div>`;
		const lede = ledeHtml === null ? '' : `<p class="lede">${ledeHtml}</p>`;
		const framed =
			s.values.frame === 'cut'
				? `<div class="cutout">${body}</div><p class="cut-note">${icon('scissors', '10pt')}Cut along the dashed line. Keep one copy at home and give one to someone you trust.</p>`
				: body;
		return `<section class="${s.kind}${cont}" id="${escapeHtml(s.id)}"${pageStyle}>
<header class="chapter-head"><div class="chapter-titles">${kicker}<h1>${title}</h1>${lede}</div>${spotImg(s.spot, ctx)}</header>
${framed}
</section>`;
	}
	const lede = ledeHtml === null ? '' : `<p class="page-lede">${ledeHtml}</p>`;
	if (s.spot && (s.kind === 'back' || s.kind === 'front')) {
		return `<section class="${s.kind}${cont}" id="${escapeHtml(s.id)}"${pageStyle}><div class="about-grid"><div><h1 class="page-title">${title}</h1>${lede}</div>${spotImg(s.spot, ctx)}</div>${body}</section>`;
	}
	const cls = (s.kind === 'front' ? `front${first ? ' first' : ''}` : 'back') + cont;
	return `<section class="${cls}" id="${escapeHtml(s.id)}"${pageStyle}><h1 class="page-title">${title}</h1>${lede}${body}</section>`;
};

const tocSections = (ctx: Ctx): Section[] => {
	const all = ctx.structured.sections;
	const host = all.find((s) => s.blocks.some((b) => b.type === 'directive' && b.name === 'toc'));
	return all.filter((s) => s !== host);
};

const firstSentence = (s: string | null): string => {
	if (!s) return '';
	const plain = plainText(parseInline(s)).replace(/\s+/g, ' ').trim();
	const m = /^(.+?[.!?])(\s|$)/.exec(plain);
	return m ? m[1] : plain;
};

const renderToc = (ctx: Ctx): string => {
	const entries = tocSections(ctx);
	const pages = ctx.opts.tocPages ?? {};
	const groups: {label: string; items: Section[]}[] = [
		{label: 'Start here', items: entries.filter((s) => s.kind === 'front')},
		{label: 'Chapters', items: entries.filter((s) => s.kind === 'chapter')},
		{label: 'Templates to print', items: entries.filter((s) => s.kind === 'appendix')},
		{label: 'Reference', items: entries.filter((s) => s.kind === 'back')},
	].filter((g) => g.items.length);
	const row = (s: Section) => {
		const n = pages[s.id];
		const num = s.kind === 'chapter' || s.kind === 'appendix' ? s.number : '';
		const ic = s.kind === 'chapter' ? icon(chapterIcon(s.id), '12pt', 'currentColor', 2.2) : s.kind === 'appendix' ? icon('card', '12pt', 'currentColor', 2.2) : icon('info', '12pt', 'currentColor', 2.2);
		const summary = s.values.toc ?? (s.kind === 'chapter' ? firstSentence(s.lede) : '');
		const sub = summary ? `<small>${md(summary, ctx)}</small>` : '';
		return `<a class="toc-entry" href="#${escapeHtml(s.id)}"><span class="toc-num">${num}</span><span class="toc-icon">${ic}</span><span class="toc-title">${md(s.title, ctx)}${sub}</span><span class="toc-page">${n === undefined ? '00' : n}</span></a>`;
	};
	return `<section class="toc" id="contents"><h1 class="page-title">Contents</h1>${groups
		.map((g) => `<div class="toc-group">${escapeHtml(g.label)}</div><div class="toc-list">${g.items.map(row).join('')}</div>`)
		.join('')}</section>`;
};

const displayUrl = (u: string): string => u.replace(/^https:\/\/(www\.)?/, '').replace(/\/$/, '');

const hostOf = (u: string): string => {
	try {
		return new URL(u).host.replace(/^www\./, '');
	} catch {
		return u;
	}
};

const renderSourcesList = (ctx: Ctx): string => {
	const cited = ctx.registry.cited();
	const checked = formatDate(ctx.opts.sources.checked);
	if (ctx.opts.edition === 'free') {
		const items = cited.map(
			({n, source: s}) =>
				`<li class="src" id="src-${escapeHtml(s.id)}"><span class="src-n">${n}</span><span>${escapeHtml(s.publisher)}: <a href="${escapeHtml(s.url)}">${escapeHtml(s.title)}</a> (${escapeHtml(formatDate(s.date))}). <span class="src-host">${escapeHtml(hostOf(s.url))}</span></span></li>`,
		);
		return `<ol class="sources-list">${items.join('')}</ol><p class="src-note">All sources checked ${escapeHtml(checked)}. Every title is a link.</p>`;
	}
	const items = cited.map(({n, source: s}) => {
		const tag = s.method === 'search-extract' ? ' <span class="src-tag">(search extract)</span>' : '';
		return `<li class="src" id="src-${escapeHtml(s.id)}"><span class="src-n">${n}</span><span><span class="src-title">${escapeHtml(s.title)}.</span> ${escapeHtml(s.publisher)}, ${escapeHtml(formatDate(s.date))}.${tag} <a class="src-url" href="${escapeHtml(s.url)}">${escapeHtml(displayUrl(s.url))}</a></span></li>`;
	});
	void checked;
	return `<ol class="sources-list">${items.join('')}</ol>`;
};

/**
 * The source list must be rendered after every citation has been numbered, so sources are rendered in a final
 * pass: the body is built with a placeholder, then the list replaces it.
 */
const SOURCES_PLACEHOLDER = '<!--@@SOURCES@@-->';

// ------------------------------------------------------------------------------------------ editions

/** Licence, copyright, version and contact, closing the last page of the full edition. */
const colophon = (ctx: Ctx): string => {
	const p = ctx.opts.product;
	const contact = p.contact ? ` Corrections and questions: <a href="mailto:${escapeHtml(p.contact)}">${escapeHtml(p.contact)}</a>.` : '';
	return `<p class="colophon">${escapeHtml(meta(ctx, 'title'))}, ${escapeHtml(meta(ctx, 'editionLabel', 'Full edition'))}, version ${escapeHtml(meta(ctx, 'version'))} (${escapeHtml(formatDate(meta(ctx, 'date')))}). © ${escapeHtml(meta(ctx, 'date').slice(0, 4))} ${escapeHtml(p.copyrightHolder)}. ${escapeHtml(p.licence.full)}${contact}</p>`;
};

const renderFull = (ctx: Ctx): {body: string; pages: {name: string; label: string}[]; tocTargets: string[]} => {
	const pre = ctx.structured.preamble;
	for (const b of pre) {
		if (!(b.type === 'directive' && b.name === 'cover')) throw new ContentError('only @cover may appear before the first section', b.line);
	}
	const parts: string[] = [];
	if (pre.some((b) => b.type === 'directive' && b.name === 'cover')) parts.push(renderCover(ctx));
	ctx.structured.sections.forEach((s, k) => parts.push(renderSection(s, ctx, k === 0)));
	if (parts.length && ctx.opts.colophon !== false) parts[parts.length - 1] = parts[parts.length - 1].replace(/<\/section>\s*$/, `${colophon(ctx)}</section>`);
	const pages = ctx.structured.sections.filter((s) => s.values.continue !== 'true').map((s) => ({name: pageNameIn(ctx.structured.sections, s), label: sectionLabel(s)}));
	return {body: parts.join('\n'), pages, tocTargets: tocSections(ctx).map((s) => s.id)};
};

const renderFree = (ctx: Ctx): string => {
	if (ctx.structured.sections.length) throw new ContentError('the free edition is one sheet: use level-2 headings only', ctx.structured.sections[0].line);
	const blocks = ctx.structured.preamble;
	// @pagebreak splits the sheet into pages; each page flows its groups and boxes in two balanced columns
	const pages: string[][] = [[]];
	let header = '';
	let sources = false;
	for (let i = 0; i < blocks.length; i++) {
		const b = blocks[i];
		const page = pages[pages.length - 1];
		if (b.type === 'directive' && b.name === 'cover') {
			const checked = formatDate(ctx.opts.sources.checked);
			header = `<header class="free-head"><div>${plate()}<h1>${md(meta(ctx, 'title'), ctx)}</h1><p class="subtitle">${md(meta(ctx, 'subtitle'), ctx)}</p><p class="meta">${escapeHtml(meta(ctx, 'editionLabel', 'Free edition'))} · Version ${escapeHtml(meta(ctx, 'version'))} · Every fact sourced, checked ${escapeHtml(checked)}</p></div>${spotImg('free-pair', ctx, 'art')}</header>`;
			continue;
		}
		if (b.type === 'directive' && b.name === 'pagebreak') {
			pages.push([]);
			continue;
		}
		if (b.type === 'heading' && b.level === 2) {
			const list = blocks[i + 1];
			if (!list || list.type !== 'checklist') throw new ContentError('each free-edition group heading must be followed by a checklist', b.line);
			page.push(`<section class="group"${b.attrs.id ? ` id="${escapeHtml(b.attrs.id)}"` : ''}><h2>${md(b.text, ctx)}</h2>${renderChecklist(list, ctx)}</section>`);
			i++;
			continue;
		}
		if (b.type === 'fence') {
			page.push(`<div class="free-box">${renderFence(b, ctx)}</div>`);
			continue;
		}
		if (b.type === 'directive' && b.name === 'sources') {
			sources = true;
			continue;
		}
		throw new ContentError(`unexpected ${b.type} in the free edition`, b.line);
	}
	const independence = meta(ctx, 'independence');
	const legal = `<p class="free-legal">General security education, not financial, legal or tax advice.${independence ? ` ${escapeHtml(independence)}.` : ''} ${escapeHtml(ctx.opts.product.licence.free)} © ${escapeHtml(meta(ctx, 'date').slice(0, 4))} ${escapeHtml(ctx.opts.product.copyrightHolder)}.</p>`;
	const src = sources ? `<section class="free-sources"><h3>Sources</h3>${SOURCES_PLACEHOLDER}</section>` : '';
	const body = pages
		.filter((p) => p.length)
		.map((p, k) => `<div class="free-page${k ? ' next' : ''}"><div class="free-cols">${p.join('')}</div></div>`)
		.join('');
	return `${header}${body}${src}${legal}`;
};

export const renderDocument = (structured: Structured, opts: RenderOptions, css: (pages: {name: string; label: string}[], footer: string) => string): Rendered => {
	const registry = new CitationRegistry(opts.sources.sources as Source[]);
	const warnings: string[] = [];
	const ctx: Ctx = {opts, registry, warnings, section: null, structured, inl: {cite: (ids) => registry.marker(ids)}};
	const edition = opts.edition;
	const title = structured.meta.title ?? opts.product.title;
	const footer = `${title} · ${structured.meta.editionLabel ?? (edition === 'full' ? 'Full edition' : 'Free edition')}`;
	let body: string;
	let pages: {name: string; label: string}[] = [];
	let tocTargets: string[] = [];
	if (edition === 'full') {
		const r = renderFull(ctx);
		body = r.body;
		pages = r.pages;
		tocTargets = r.tocTargets;
	} else {
		body = renderFree(ctx);
	}
	// every citation is numbered now, so the source list can be written
	body = body.replace(SOURCES_PLACEHOLDER, () => renderSourcesList(ctx));
	const missing = [...registry.missing];
	if (missing.length) throw new Error(`unknown source id(s): ${missing.join(', ')}`);
	const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}${edition === 'free' ? ' (Free edition)' : ''}</title>
<meta name="author" content="Zoo &amp; Badger"><meta name="description" content="${escapeHtml(structured.meta.subtitle ?? '')}">
<style>${css(pages, footer)}</style></head>
<body class="edition-${edition}">
${body}
</body></html>`;
	return {html, body, registry, pages, tocTargets, warnings, footer};
};

/** Every citation id used anywhere in the structured document (reading order, duplicates kept). */
export const citationIds = (structured: Structured): string[] => {
	const ids: string[] = [];
	const visit = (text: string) => {
		for (const n of parseInline(text)) collect(n);
	};
	const collect = (n: InlineNode): void => {
		if (n.t === 'cite') ids.push(...n.ids);
		else if (n.t === 'strong' || n.t === 'em' || n.t === 'link') n.c.forEach(collect);
	};
	const all: Block[] = [...structured.preamble, ...structured.sections.flatMap((s) => [...(s.lede ? [{type: 'quote', text: s.lede, line: s.line} as Block] : []), ...s.blocks])];
	for (const b of walkBlocks(all)) for (const t of blockTexts(b)) visit(t.text);
	return ids;
};

export {cssString};
