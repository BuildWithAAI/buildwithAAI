/**
 * DOM measurement for the QA probe (browser only). Reads, never writes: text boxes and their clipping,
 * character instances (boxes, screen matrices, heads, hands, pin, spots, props, local frame) and banned
 * render techniques (gradients, blur and glow filters, patterns, blend modes, masks).
 */
import {Internals} from 'remotion';
import type {BannedFact, CharacterFact, CharacterKind, Matrix, Rect, TextFact, TextRole} from '../protocol.ts';
import {componentChain, contextValueSeen, findReader, fiberOf, hasComponentAncestor, localFrameFrom, ownerComponent, serialiseProps} from './fiber.ts';

export type MeasureContext = {
	root: Element;
	ox: number; // root offset (client px)
	oy: number;
	width: number;
	height: number;
	compId: string;
	durationInFrames: number;
	absoluteFrame: number;
	/** Canonical character components: identity is checked against these. */
	canonical: {zoo: unknown; badger: unknown};
};

const r1 = (n: number) => Math.round(n * 10) / 10;
const rectOf = (r: DOMRect | {left: number; top: number; width: number; height: number}, ox: number, oy: number): Rect => ({
	x: r1(r.left - ox),
	y: r1(r.top - oy),
	w: r1(r.width),
	h: r1(r.height),
});
export const union = (rs: Rect[]): Rect => {
	if (!rs.length) return {x: 0, y: 0, w: 0, h: 0};
	let x0 = Infinity;
	let y0 = Infinity;
	let x1 = -Infinity;
	let y1 = -Infinity;
	for (const r of rs) {
		x0 = Math.min(x0, r.x);
		y0 = Math.min(y0, r.y);
		x1 = Math.max(x1, r.x + r.w);
		y1 = Math.max(y1, r.y + r.h);
	}
	return {x: r1(x0), y: r1(y0), w: r1(x1 - x0), h: r1(y1 - y0)};
};
const intersect = (a: Rect, b: Rect): Rect | null => {
	const x0 = Math.max(a.x, b.x);
	const y0 = Math.max(a.y, b.y);
	const x1 = Math.min(a.x + a.w, b.x + b.w);
	const y1 = Math.min(a.y + a.h, b.y + b.h);
	return x1 > x0 && y1 > y0 ? {x: x0, y: y0, w: x1 - x0, h: y1 - y0} : null;
};
const area = (r: Rect | null) => (r ? Math.max(0, r.w) * Math.max(0, r.h) : 0);

const SKIP_TEXT_PARENTS = new Set(['style', 'script', 'title', 'desc', 'defs', 'clippath', 'mask', 'pattern', 'symbol', 'marker', 'lineargradient', 'radialgradient', 'filter', 'metadata', 'noscript', 'template']);

const isSvg = (el: Element): el is SVGElement => el instanceof SVGElement;

/** "div>div:2>svg>g:5>text" — the last `depth` steps with 1-based nth-of-type where ambiguous. */
export const domPath = (el: Element, root: Element, depth = 7): string => {
	const parts: string[] = [];
	let n: Element | null = el;
	while (n && n !== root && parts.length < depth) {
		const tag = n.tagName.toLowerCase();
		const parent: Element | null = n.parentElement;
		let step = tag;
		if (parent) {
			const same = Array.from(parent.children).filter((c) => c.tagName === n!.tagName);
			if (same.length > 1) step += `:${same.indexOf(n) + 1}`;
		}
		parts.unshift(step);
		n = parent;
	}
	return parts.join('>');
};

const parseColor = (s: string | null | undefined): [number, number, number, number] | null => {
	if (!s) return null;
	const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s.trim());
	if (!m) return null;
	let a = 1;
	if (m[4] !== undefined) a = m[4].endsWith('%') ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
	return [Number(m[1]), Number(m[2]), Number(m[3]), a];
};

/** Product of the computed opacity of `el` and its ancestors up to (not including) root. */
const opacityChain = (el: Element, root: Element): number => {
	let o = 1;
	let n: Element | null = el;
	while (n && n !== root) {
		const v = Number(getComputedStyle(n).opacity);
		if (Number.isFinite(v)) o *= v;
		n = n.parentElement;
	}
	return o;
};

/** On-screen scale of an element's local units (1 = untransformed). */
const screenScale = (el: Element): number => {
	if (isSvg(el) && 'getScreenCTM' in el) {
		const m = (el as SVGGraphicsElement).getScreenCTM();
		if (m) return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
	}
	let n: Element | null = el;
	while (n) {
		const h = n as HTMLElement;
		if (h.offsetWidth > 0) return h.getBoundingClientRect().width / h.offsetWidth;
		n = n.parentElement;
	}
	return 1;
};

/** Padding box of an HTML element in frame px. */
const paddingBox = (el: Element, ctx: MeasureContext): Rect => {
	const r = rectOf(el.getBoundingClientRect(), ctx.ox, ctx.oy);
	const cs = getComputedStyle(el);
	const bl = parseFloat(cs.borderLeftWidth) || 0;
	const br = parseFloat(cs.borderRightWidth) || 0;
	const bt = parseFloat(cs.borderTopWidth) || 0;
	const bb = parseFloat(cs.borderBottomWidth) || 0;
	return {x: r.x + bl, y: r.y + bt, w: Math.max(0, r.w - bl - br), h: Math.max(0, r.h - bt - bb)};
};

/** Screen rect of an SVG clipPath applied to `clipped` (userSpaceOnUse; objectBoundingBox approximated). */
const svgClipRect = (clipped: SVGGraphicsElement, clipUrl: string, ctx: MeasureContext): Rect | null => {
	const id = /url\(["']?#([^"')]+)["']?\)/.exec(clipUrl)?.[1];
	if (!id) return null;
	const cp = clipped.ownerDocument.getElementById(id);
	if (!cp || cp.tagName.toLowerCase() !== 'clippath') return null;
	const m = clipped.getScreenCTM();
	if (!m) return null;
	const units = cp.getAttribute('clipPathUnits');
	let bb: {x: number; y: number; width: number; height: number} | null = null;
	for (const c of Array.from(cp.children)) {
		if (!(c instanceof SVGGraphicsElement)) continue;
		try {
			const b = c.getBBox();
			bb = bb
				? {
						x: Math.min(bb.x, b.x),
						y: Math.min(bb.y, b.y),
						width: Math.max(bb.x + bb.width, b.x + b.width) - Math.min(bb.x, b.x),
						height: Math.max(bb.y + bb.height, b.y + b.height) - Math.min(bb.y, b.y),
					}
				: {x: b.x, y: b.y, width: b.width, height: b.height};
		} catch {
			// detached or not rendered
		}
	}
	if (!bb) return null;
	if (units === 'objectBoundingBox') {
		const ob = clipped.getBBox();
		bb = {x: ob.x + bb.x * ob.width, y: ob.y + bb.y * ob.height, width: bb.width * ob.width, height: bb.height * ob.height};
	}
	const pts = [
		[bb.x, bb.y],
		[bb.x + bb.width, bb.y],
		[bb.x, bb.y + bb.height],
		[bb.x + bb.width, bb.y + bb.height],
	].map(([x, y]) => [m.a * x + m.c * y + m.e - ctx.ox, m.b * x + m.d * y + m.f - ctx.oy]);
	const xs = pts.map((p) => p[0]);
	const ys = pts.map((p) => p[1]);
	return {x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys)};
};

/**
 * Bounding box of a CSS clip-path on an HTML element (reference box: border box): inset(), polygon(),
 * circle(), ellipse(), and url() approximated by the border box. Percentages resolve against the untransformed
 * box; the result is scaled with the element's on-screen size (translations and scales; no rotation).
 */
export const cssClipRect = (el: Element, value: string, ctx: MeasureContext): Rect => {
	const r = el.getBoundingClientRect();
	const h = el as HTMLElement;
	const W = h.offsetWidth || r.width;
	const H = h.offsetHeight || r.height;
	const sx = W ? r.width / W : 1;
	const sy = H ? r.height / H : 1;
	const len = (s: string | undefined, ref: number): number => {
		if (!s) return 0;
		const v = parseFloat(s);
		if (!Number.isFinite(v)) return s.trim() === 'center' ? ref / 2 : s.trim() === 'right' || s.trim() === 'bottom' ? ref : 0;
		return s.trim().endsWith('%') ? (v / 100) * ref : v;
	};
	const local = (x0: number, y0: number, x1: number, y1: number): Rect => ({
		x: r.left - ctx.ox + x0 * sx,
		y: r.top - ctx.oy + y0 * sy,
		w: Math.max(0, (x1 - x0) * sx),
		h: Math.max(0, (y1 - y0) * sy),
	});
	const v = value.trim();
	let m = /^inset\((.*)\)/.exec(v);
	if (m) {
		const parts = m[1].split(/\s+round\s+/)[0].trim().split(/\s+/);
		const [t, rr = t, b = t, l = rr] = parts;
		return local(len(l, W), len(t, H), W - len(rr, W), H - len(b, H));
	}
	m = /^polygon\((.*)\)$/.exec(v);
	if (m) {
		const pts = m[1]
			.replace(/^\s*(nonzero|evenodd)\s*,/, '')
			.split(',')
			.map((p) => p.trim().split(/\s+/));
		const xs = pts.map((p) => len(p[0], W));
		const ys = pts.map((p) => len(p[1], H));
		if (xs.length) return local(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
	}
	m = /^(circle|ellipse)\(([^)]*)\)/.exec(v);
	if (m) {
		const [radii, at] = m[2].split(/\s+at\s+/);
		const rs = (radii ?? '').trim().split(/\s+/).filter(Boolean);
		const [cxs, cys] = (at ?? '50% 50%').trim().split(/\s+/);
		const cx = len(cxs, W);
		const cy = len(cys ?? '50%', H);
		const ref = m[1] === 'circle' ? Math.hypot(W, H) / Math.SQRT2 : 0;
		const rx = rs[0] && !/closest|farthest/.test(rs[0]) ? len(rs[0], m[1] === 'circle' ? ref : W) : Math.max(cx, W - cx);
		const ry = m[1] === 'circle' ? rx : rs[1] && !/closest|farthest/.test(rs[1]) ? len(rs[1], H) : Math.max(cy, H - cy);
		return local(cx - rx, cy - ry, cx + rx, cy + ry);
	}
	return rectOf(r, ctx.ox, ctx.oy);
};

type Clipper = {rect: Rect; by: TextFact['clippedBy'][number]};

/** Every ancestor region that clips `el`'s painting, innermost first. */
const clippersOf = (el: Element, ctx: MeasureContext): Clipper[] => {
	const out: Clipper[] = [];
	let n: Element | null = el.parentElement;
	let child: Element = el;
	while (n && n !== ctx.root) {
		const cs = getComputedStyle(n);
		if (isSvg(n)) {
			if (n.tagName.toLowerCase() === 'svg' && cs.overflow !== 'visible' && cs.overflowX !== 'visible') {
				out.push({rect: rectOf(n.getBoundingClientRect(), ctx.ox, ctx.oy), by: 'svg-viewport'});
			}
			if (cs.clipPath && cs.clipPath !== 'none' && n instanceof SVGGraphicsElement) {
				const r = svgClipRect(n, cs.clipPath, ctx);
				if (r) out.push({rect: r, by: 'clip-path'});
			}
		} else {
			if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') out.push({rect: paddingBox(n, ctx), by: 'overflow'});
			if (cs.clipPath && cs.clipPath !== 'none') out.push({rect: cssClipRect(n, cs.clipPath, ctx), by: 'clip-path'});
		}
		child = n;
		n = n.parentElement;
	}
	void child;
	return out;
};

const BLOCKISH = /^(block|flex|grid|inline-block|inline-flex|inline-grid|table|table-cell|list-item|flow-root)$/;

const roleOf = (el: Element, chain: string[], text: string): TextRole => {
	const marked = el.closest('[data-qa-role],[data-qa-ignore],[data-part="caption"],[data-caption]');
	if (marked) {
		if (marked.hasAttribute('data-qa-ignore')) return 'badge';
		const r = marked.getAttribute('data-qa-role');
		if (r === 'badge') return 'badge';
		if (r === 'caption' || marked.getAttribute('data-part') === 'caption' || marked.hasAttribute('data-caption')) return 'caption';
	}
	if (chain.some((c) => /ReviewBadge|DevBadge|DraftBadge|QaIgnore/.test(c))) return 'badge';
	if (/^(SILENT PREVIEW|MACHINE TRANSLATION)\b/.test(text)) return 'badge';
	let n: Element | null = el;
	while (n && n !== document.body) {
		const cls = typeof n.className === 'string' ? n.className : '';
		if (/caption|subtitle/i.test(cls)) return 'caption';
		n = n.parentElement;
	}
	if (chain.some((c) => /caption|subtitle/i.test(c))) return 'caption';
	return 'text';
};

const isScript = (el: Element): boolean => {
	let n: Element | null = el;
	for (let i = 0; n && i < 3; i++, n = n.parentElement) {
		const tag = n.tagName.toLowerCase();
		if (tag === 'sub' || tag === 'sup') return true;
		const va = getComputedStyle(n).verticalAlign;
		if (va === 'sub' || va === 'super') return true;
		if (tag === 'tspan' && n.parentElement) {
			const a = parseFloat(getComputedStyle(n).fontSize);
			const b = parseFloat(getComputedStyle(n.parentElement).fontSize);
			if (a < b - 0.5) return true;
		}
	}
	return false;
};

let metricsCtx: CanvasRenderingContext2D | null = null;
type Ink = {fa: number; fd: number; aa: number; ad: number};
const inkCache = new Map<string, Ink>();

/** Font and glyph extents of `text` in the element's computed font (canvas TextMetrics, CSS px). */
const inkMetrics = (text: string, cs: CSSStyleDeclaration): Ink | null => {
	if (!metricsCtx) metricsCtx = document.createElement('canvas').getContext('2d');
	if (!metricsCtx) return null;
	const tt = cs.textTransform;
	const shown = tt === 'uppercase' ? text.toUpperCase() : tt === 'lowercase' ? text.toLowerCase() : tt === 'capitalize' ? text.replace(/\b\p{L}/gu, (c) => c.toUpperCase()) : text;
	const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
	const key = `${font}|${shown}`;
	const hit = inkCache.get(key);
	if (hit) return hit;
	metricsCtx.font = font;
	const m = metricsCtx.measureText(shown);
	if (!(m.fontBoundingBoxAscent + m.fontBoundingBoxDescent > 0)) return null;
	const ink = {fa: m.fontBoundingBoxAscent, fd: m.fontBoundingBoxDescent, aa: m.actualBoundingBoxAscent, ad: m.actualBoundingBoxDescent};
	if (inkCache.size > 5000) inkCache.clear();
	inkCache.set(key, ink);
	return ink;
};

/** A line box narrowed vertically to the glyphs' ink (scaled with the box: transforms are respected). */
const inkRect = (r: Rect, ink: Ink | null): Rect => {
	if (!ink) return r;
	const s = r.h / (ink.fa + ink.fd);
	const top = r.y + (ink.fa - ink.aa) * s;
	const bottom = r.y + r.h - (ink.fd - ink.ad) * s;
	return bottom > top ? {x: r.x, y: r1(top), w: r.w, h: r1(bottom - top)} : r;
};

/** Every visible text node under the root, with its geometry, clipping, overflow, colour and role. */
export const measureTexts = (ctx: MeasureContext): TextFact[] => {
	const out: TextFact[] = [];
	const frame: Rect = {x: 0, y: 0, w: ctx.width, h: ctx.height};
	const walker = document.createTreeWalker(ctx.root, NodeFilter.SHOW_TEXT);
	const range = document.createRange();
	let idx = 0;
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		const text = (node.nodeValue ?? '').replace(/\s+/g, ' ').trim();
		if (!text) continue;
		const el = node.parentElement;
		if (!el) continue;
		if (el.closest('style,script,title,desc,defs,clipPath,mask,pattern,symbol,marker,linearGradient,radialGradient,filter,metadata,noscript,template')) continue;
		if (SKIP_TEXT_PARENTS.has(el.tagName.toLowerCase())) continue;
		const cs = getComputedStyle(el);
		if (cs.visibility !== 'visible' || cs.display === 'none') continue;
		range.selectNodeContents(node);
		let lines = Array.from(range.getClientRects())
			.filter((r) => r.width > 0.5 && r.height > 0.5)
			.map((r) => rectOf(r, ctx.ox, ctx.oy));
		const svg = isSvg(el);
		if (!lines.length && svg) {
			const r = el.getBoundingClientRect();
			if (r.width > 0.5 && r.height > 0.5) lines = [rectOf(r, ctx.ox, ctx.oy)];
		}
		if (!lines.length) continue;
		const opacity = opacityChain(el, ctx.root);
		if (opacity < 0.02) continue;
		const ink = inkMetrics(text, cs);
		const rects = lines.map((r) => inkRect(r, ink));
		const box = union(rects);
		// clipping: frame + ancestors
		const clippers = clippersOf(el, ctx);
		const total = rects.reduce((a, r) => a + area(r), 0);
		let visible = 0;
		const clippedBy = new Set<TextFact['clippedBy'][number]>();
		for (const r of rects) {
			let v: Rect | null = r;
			const inFrame = intersect(r, frame);
			if (area(inFrame) < area(r) - 0.5) clippedBy.add('frame');
			v = inFrame;
			for (const c of clippers) {
				if (!v) break;
				const next = intersect(v, c.rect);
				if (area(next) < area(v) - 0.5) clippedBy.add(c.by);
				v = next;
			}
			visible += area(v);
		}
		// overflow of the nearest block box (HTML only)
		let overflow: TextFact['overflow'] = null;
		let truncated: TextFact['truncated'] = null;
		if (!svg) {
			let blk: Element | null = el;
			while (blk && blk !== ctx.root && !BLOCKISH.test(getComputedStyle(blk).display)) blk = blk.parentElement;
			if (blk && blk !== ctx.root && (blk as HTMLElement).clientWidth > 0 && (blk as HTMLElement).clientHeight > 0) {
				const pb = paddingBox(blk, ctx);
				const o = {
					left: Math.max(0, pb.x - box.x),
					right: Math.max(0, box.x + box.w - (pb.x + pb.w)),
					top: Math.max(0, pb.y - box.y),
					bottom: Math.max(0, box.y + box.h - (pb.y + pb.h)),
				};
				if (Math.max(o.left, o.right, o.top, o.bottom) > 1.5) overflow = {left: r1(o.left), right: r1(o.right), top: r1(o.top), bottom: r1(o.bottom), box: pb};
				const bcs = getComputedStyle(blk);
				const h = blk as HTMLElement;
				if (bcs.textOverflow === 'ellipsis' && h.scrollWidth > h.clientWidth + 1) truncated = 'ellipsis';
				const clamp = (bcs as unknown as {webkitLineClamp?: string}).webkitLineClamp;
				if (clamp && clamp !== 'none' && h.scrollHeight > h.clientHeight + 1) truncated = 'line-clamp';
			}
		}
		const chain = componentChain(el, 6);
		const role = roleOf(el, chain, text);
		const fill = svg ? cs.fill : cs.color;
		let color = parseColor(fill);
		if (color && svg) color = [color[0], color[1], color[2], color[3] * (Number(cs.fillOpacity) || 1)];
		if (color && !svg) {
			const tf = (cs as unknown as {webkitTextFillColor?: string}).webkitTextFillColor;
			const c2 = parseColor(tf);
			if (c2) color = c2;
		}
		const strokeW = svg ? (cs.stroke && cs.stroke !== 'none' ? parseFloat(cs.strokeWidth) || 0 : 0) : parseFloat((cs as unknown as {webkitTextStrokeWidth?: string}).webkitTextStrokeWidth ?? '0') || 0;
		const outlined = strokeW > 0 || (cs.textShadow !== 'none' && cs.textShadow !== '');
		const fontPx = parseFloat(cs.fontSize) || 0;
		const scale = screenScale(el);
		out.push({
			key: `${domPath(el, ctx.root)}#${idx}`,
			text: text.length > 160 ? `${text.slice(0, 157)}...` : text,
			role,
			kind: svg ? 'svg' : 'html',
			rects,
			box,
			lineBox: union(lines),
			color,
			outlined,
			fontPx: r1(fontPx),
			effPx: r1(fontPx * scale),
			weight: Number(cs.fontWeight) || 400,
			family: cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(),
			opacity: Math.round(opacity * 1000) / 1000,
			visibleFrac: total > 0 ? Math.round((visible / total) * 1000) / 1000 : 0,
			clippedBy: [...clippedBy],
			overflow,
			truncated,
			script: isScript(el),
			components: chain.slice(0, 4),
			path: domPath(el, ctx.root, 5),
		});
		idx++;
	}
	return out;
};

const matrixOf = (el: Element, ctx: MeasureContext): Matrix | null => {
	if (!(el instanceof SVGGraphicsElement)) return null;
	const m = el.getScreenCTM();
	if (!m) return null;
	const q = (n: number) => Math.round(n * 1e5) / 1e5;
	return [q(m.a), q(m.b), q(m.c), q(m.d), q(m.e - ctx.ox), q(m.f - ctx.oy)];
};

const effectsOf = (el: Element, ctx: MeasureContext): CharacterFact['effects'] => {
	const fx: CharacterFact['effects'] = {filter: [], opacity: 1, blend: [], clip: [], cssTransform: false};
	let n: Element | null = el;
	while (n && n !== ctx.root) {
		const cs = getComputedStyle(n);
		if (cs.filter && cs.filter !== 'none') fx.filter.push(`${n.tagName.toLowerCase()}: ${cs.filter}`);
		const o = Number(cs.opacity);
		if (Number.isFinite(o)) fx.opacity *= o;
		if (cs.mixBlendMode && cs.mixBlendMode !== 'normal') fx.blend.push(`${n.tagName.toLowerCase()}: ${cs.mixBlendMode}`);
		if (cs.clipPath && cs.clipPath !== 'none') fx.clip.push(`${n.tagName.toLowerCase()}: clip-path ${cs.clipPath}`);
		const mask = (cs as unknown as {maskImage?: string; webkitMaskImage?: string}).maskImage ?? (cs as unknown as {webkitMaskImage?: string}).webkitMaskImage;
		if (mask && mask !== 'none') fx.clip.push(`${n.tagName.toLowerCase()}: mask ${mask}`);
		if (cs.mask && cs.mask !== 'none' && isSvg(n)) fx.clip.push(`${n.tagName.toLowerCase()}: mask ${cs.mask}`);
		if (!isSvg(n) && cs.transform && cs.transform !== 'none') fx.cssTransform = true;
		n = n.parentElement;
	}
	fx.opacity = Math.round(fx.opacity * 1000) / 1000;
	return fx;
};

/** Every character instance ([data-character]) with geometry, identity facts, props and local frame. */
export const measureCharacters = (ctx: MeasureContext): CharacterFact[] => {
	const els = Array.from(ctx.root.querySelectorAll('[data-character]'));
	const out: CharacterFact[] = [];
	els.forEach((el, i) => {
		const kind = el.getAttribute('data-character') as CharacterKind;
		if (kind !== 'zoo' && kind !== 'badger') return;
		const box = rectOf(el.getBoundingClientRect(), ctx.ox, ctx.oy);
		const headEl = kind === 'zoo' ? el.querySelector('[data-part="head"]') : el.querySelector('[data-head]');
		const headBox = headEl ? rectOf(headEl.getBoundingClientRect(), ctx.ox, ctx.oy) : null;
		const hands =
			kind === 'zoo'
				? Array.from(el.querySelectorAll('[data-part="hand"],[data-part="handL"],[data-part="handR"]'))
						.map((h) => rectOf(h.getBoundingClientRect(), ctx.ox, ctx.oy))
						.filter((r) => r.w > 0 && r.h > 0)
				: [];
		const pinEl = kind === 'zoo' ? el.querySelector('[data-part="pin"]') : null;
		const pin = pinEl ? rectOf(pinEl.getBoundingClientRect(), ctx.ox, ctx.oy) : null;
		const spots = kind === 'badger' ? Array.from(el.querySelectorAll('[data-spot]')).map((s) => s.getAttribute('data-spot') ?? '') : [];
		// React: props of the component that rendered the root group, the local frame, canonical identity
		const owner = ownerComponent(el);
		const ser = owner ? serialiseProps(owner.memoizedProps) : {props: null, dropped: []};
		let localFrame = ctx.absoluteFrame;
		let frameSource: CharacterFact['frameSource'] = 'assumed';
		const timelineCtx = (Internals as unknown as {TimelineContext?: unknown}).TimelineContext;
		const sequenceCtx = (Internals as unknown as {SequenceContext?: unknown}).SequenceContext;
		if (owner && timelineCtx) {
			const reader = findReader(owner, timelineCtx);
			if (reader) {
				const t = contextValueSeen(reader, timelineCtx).value as {frame?: Record<string, number>} | null;
				const s = sequenceCtx ? (contextValueSeen(reader, sequenceCtx).value as {cumulatedFrom?: number; relativeFrom?: number; playbackRate?: number} | null) : null;
				const initial = (window as unknown as {remotion_initialFrame?: number}).remotion_initialFrame;
				const lf = localFrameFrom(t, s ?? null, ctx.compId, ctx.durationInFrames, typeof initial === 'number' ? initial : ctx.absoluteFrame);
				if (lf !== null) {
					localFrame = lf;
					frameSource = 'context';
				}
			}
		}
		const canonicalComp = kind === 'zoo' ? ctx.canonical.zoo : ctx.canonical.badger;
		const canonical = fiberOf(el) ? hasComponentAncestor(el, canonicalComp, kind === 'zoo' ? 4 : 2) : null;
		out.push({
			key: `${kind}${i}`,
			kind,
			view: el.getAttribute('data-view'),
			pose: el.getAttribute('data-pose'),
			head: kind === 'badger' ? (el.querySelector('[data-head]')?.getAttribute('data-head') ?? null) : (headEl?.getAttribute('data-view') ?? null),
			ctm: matrixOf(el, ctx),
			box,
			headBox,
			hands,
			pin,
			spots,
			effects: effectsOf(el, ctx),
			props: ser.props,
			droppedProps: ser.dropped,
			localFrame,
			frameSource,
			canonical,
			coveredBy: [],
		});
	});
	// paint order: a later character in document order is painted over an earlier one (same stacking context)
	for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) out[i].coveredBy.push(j);
	return out;
};

const FILTER_PRIMS_BANNED = new Set(['fegaussianblur', 'feturbulence', 'femorphology', 'fedropshadow', 'fedisplacementmap', 'feconvolvematrix', 'fespecularlighting', 'fediffuselighting']);
const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line', 'text', 'tspan', 'textpath', 'use', 'image', 'g', 'svg']);

const refTarget = (url: string, doc: Document): Element | null => {
	const id = /url\(["']?#([^"')]+)["']?\)/.exec(url)?.[1];
	return id ? doc.getElementById(id) : null;
};

/** Techniques ART_GUIDE 4 bans: gradients, patterns, blur/glow/noise filters, shadows, blend modes, masks. */
export const measureBanned = (ctx: MeasureContext): BannedFact[] => {
	const out: BannedFact[] = [];
	const seen = new Set<string>();
	const push = (b: BannedFact) => {
		const k = `${b.kind}|${b.path}|${b.detail}`;
		if (seen.has(k)) return;
		seen.add(k);
		out.push(b);
	};
	const all = ctx.root.querySelectorAll('*');
	for (const el of Array.from(all)) {
		const tag = el.tagName.toLowerCase();
		if (el.closest('defs,clipPath,mask,pattern,symbol,marker,linearGradient,radialGradient,filter')) continue;
		const cs = getComputedStyle(el);
		if (cs.display === 'none' || cs.visibility === 'hidden') continue;
		const r = el.getBoundingClientRect();
		if (r.width <= 0 || r.height <= 0) continue;
		const box = () => rectOf(r, ctx.ox, ctx.oy);
		const path = () => domPath(el, ctx.root, 6);
		if (isSvg(el)) {
			if (!SHAPES.has(tag)) continue;
			for (const prop of ['fill', 'stroke'] as const) {
				const v = cs[prop];
				if (v && v.startsWith('url(')) {
					const t = refTarget(v, el.ownerDocument);
					const tt = t?.tagName.toLowerCase();
					if (tt === 'lineargradient' || tt === 'radialgradient') push({kind: 'svg-gradient', detail: `${prop}: <${tt}>`, box: box(), path: path()});
					else if (tt === 'pattern') push({kind: 'svg-pattern', detail: `${prop}: <pattern>`, box: box(), path: path()});
				}
			}
			if (cs.filter && cs.filter !== 'none') {
				const t = cs.filter.startsWith('url(') ? refTarget(cs.filter, el.ownerDocument) : null;
				const prims = t ? Array.from(t.children).map((c) => c.tagName.toLowerCase()) : [];
				const banned = prims.filter((p) => FILTER_PRIMS_BANNED.has(p));
				push({kind: 'svg-filter', detail: t ? `filter: ${prims.join(', ') || '(empty)'}${banned.length ? ' (banned primitives)' : ''}` : `filter: ${cs.filter}`, box: box(), path: path()});
			}
		} else {
			if (cs.backgroundImage && cs.backgroundImage.includes('gradient(')) push({kind: 'css-gradient', detail: cs.backgroundImage.slice(0, 120), box: box(), path: path()});
			if (cs.boxShadow && cs.boxShadow !== 'none') push({kind: 'box-shadow', detail: cs.boxShadow.slice(0, 120), box: box(), path: path()});
			if (cs.textShadow && cs.textShadow !== 'none') {
				// "rgb(0, 0, 0) 2px 2px 4px": the third length is the blur radius
				const blurred = cs.textShadow.split(/,(?![^(]*\))/).some((s) => {
					const lens = s.match(/-?[\d.]+px/g) ?? [];
					return lens.length >= 3 && parseFloat(lens[2]) > 0;
				});
				if (blurred) push({kind: 'text-shadow-blur', detail: cs.textShadow.slice(0, 120), box: box(), path: path()});
			}
			if (cs.filter && cs.filter !== 'none') push({kind: 'css-filter', detail: cs.filter.slice(0, 120), box: box(), path: path()});
			const bf = (cs as unknown as {backdropFilter?: string}).backdropFilter;
			if (bf && bf !== 'none') push({kind: 'backdrop-filter', detail: bf.slice(0, 120), box: box(), path: path()});
			const mi = (cs as unknown as {maskImage?: string}).maskImage ?? (cs as unknown as {webkitMaskImage?: string}).webkitMaskImage;
			if (mi && mi !== 'none') push({kind: 'mask', detail: mi.slice(0, 120), box: box(), path: path()});
		}
		if (cs.mixBlendMode && cs.mixBlendMode !== 'normal') push({kind: 'blend-mode', detail: cs.mixBlendMode, box: box(), path: path()});
	}
	return out;
};
