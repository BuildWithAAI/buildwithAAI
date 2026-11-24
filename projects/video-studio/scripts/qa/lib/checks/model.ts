/**
 * Off-model detection from pixels. Per character instance in a sampled frame:
 *  - S (solo pass): the frame with everything hidden except the characters, so the character is exactly as the
 *    scene composed it (its ancestors' transforms, filters, clips, opacity) but with nothing in front of it;
 *  - R (QaRef pass): the canonical component from src/characters with the same props and local frame, placed
 *    with a pure translate + uniform scale at the same origin and size.
 * Clean scenes give S == R to the pixel (SSIM 1.0000, 0 changed pixels: measured on Preview10s), so any change
 * is a real deviation. Pixels another character covers are excluded from both sides.
 * Heuristics on top, all on S and checked against R and the frozen manifest conventions: Zoo's teal pin
 * (present, side, position), Badger's dark ear cap (side), Badger's spot count, palette conformance; and from
 * P vs S: how much of each face other artwork paints over.
 */
import type {CharacterFact, FrameFacts, Rect} from '../../../../src/qa/protocol.ts';
import {deltaE76, type RGB} from '../color.ts';
import {clampRect, components, dilate, inflate, type Image} from '../image.ts';
import type {Finding} from '../issues.ts';
import {expectedEarCapSide, expectedPin, type Manifest} from '../manifest.ts';
import {ssim} from '../ssim.ts';
import {THRESHOLDS as T} from '../thresholds.ts';
import {charLabel, charName} from './dom.ts';

export type CharRef = {img: Image; facts: CharacterFact | null} | null;

export type ModelStats = {compared: number; skipped: Array<{frame: number; who: string; why: string}>; worstSsim: number; maxChangedFrac: number};

type Crop = {x0: number; y0: number; w: number; h: number};

const VISUAL_DROPPED = new Set(['between', 'children']);

const near = (data: Uint8Array, i: number, c: RGB, tol: number) => Math.abs(data[i] - c[0]) <= tol && Math.abs(data[i + 1] - c[1]) <= tol && Math.abs(data[i + 2] - c[2]) <= tol;

/** Mask (crop-local) of pixels close to colour `c` inside `own`, optionally limited to a sub-rect. */
const colourMask = (img: Image, cr: Crop, own: Uint8Array, c: RGB, tol: number, sub?: Rect): Uint8Array => {
	const m = new Uint8Array(cr.w * cr.h);
	for (let y = 0; y < cr.h; y++)
		for (let x = 0; x < cr.w; x++) {
			const k = y * cr.w + x;
			if (!own[k]) continue;
			const gx = cr.x0 + x;
			const gy = cr.y0 + y;
			if (sub && (gx < sub.x || gx >= sub.x + sub.w || gy < sub.y || gy >= sub.y + sub.h)) continue;
			const i = (gy * img.width + gx) * 4;
			if (img.data[i + 3] >= 250 && near(img.data, i, c, tol)) m[k] = 1;
		}
	return m;
};

const biggest = (mask: Uint8Array, w: number, h: number, minArea: number) => {
	const {comps} = components(mask, w, h, minArea);
	return comps.sort((a, b) => b.area - a.area)[0] ?? null;
};

/** Pixels of the palette check: interior (3x3 uniform, fully opaque) pixels of the character. */
const offPalette = (img: Image, cr: Crop, own: Uint8Array, palette: RGB[], cache: Map<number, boolean>): {interior: number; off: number; offColors: Map<number, number>} => {
	let interior = 0;
	let off = 0;
	const offColors = new Map<number, number>();
	const W = img.width;
	for (let y = 1; y < cr.h - 1; y++)
		for (let x = 1; x < cr.w - 1; x++) {
			if (!own[y * cr.w + x]) continue;
			const gi = ((cr.y0 + y) * W + cr.x0 + x) * 4;
			if (img.data[gi + 3] < 255) continue;
			let uniform = true;
			for (let dy = -1; dy <= 1 && uniform; dy++)
				for (let dx = -1; dx <= 1; dx++) {
					const ni = gi + (dy * W + dx) * 4;
					if (img.data[ni] !== img.data[gi] || img.data[ni + 1] !== img.data[gi + 1] || img.data[ni + 2] !== img.data[gi + 2] || img.data[ni + 3] !== 255) {
						uniform = false;
						break;
					}
				}
			if (!uniform) continue;
			interior++;
			const key = (img.data[gi] << 16) | (img.data[gi + 1] << 8) | img.data[gi + 2];
			let ok = cache.get(key);
			if (ok === undefined) {
				const rgb: RGB = [img.data[gi], img.data[gi + 1], img.data[gi + 2]];
				ok = palette.some((p) => deltaE76(p, rgb) <= T.model.paletteDeltaE);
				cache.set(key, ok);
			}
			if (!ok) {
				off++;
				offColors.set(key, (offColors.get(key) ?? 0) + 1);
			}
		}
	return {interior, off, offColors};
};

const hex = (k: number) => `#${k.toString(16).padStart(6, '0').toUpperCase()}`;

/**
 * @param P scene frame, S solo frame, refs[i] canonical render of P's character i (null when not rendered).
 */
export const modelPixelFindings = (f: FrameFacts, P: Image, S: Image, refs: CharRef[], manifest: Manifest, stats: ModelStats, paletteCache: Map<number, boolean>): Finding[] => {
	const out: Finding[] = [];
	const palette = manifest.palette.map((p) => p.rgb);
	f.chars.forEach((c, i) => {
		const who = charLabel(c, i);
		const ref = refs[i];
		const skip = (why: string) => stats.skipped.push({frame: f.frame, who, why});
		if (c.effects.opacity < T.model.minOpacity) return skip(`fading (opacity ${c.effects.opacity})`);
		if (!ref) return skip(c.props === null ? 'props not readable from React' : c.droppedProps.some((k) => VISUAL_DROPPED.has(k)) ? `props not serialisable (${c.droppedProps.join(', ')})` : 'no reference render');
		const box = clampRect(inflate(c.box, 6), P.width, P.height);
		if (!box) return skip('off-frame');
		const cr: Crop = {x0: box.x0, y0: box.y0, w: box.x1 - box.x0, h: box.y1 - box.y0};
		const n = cr.w * cr.h;
		// pixels other characters cover in either render are excluded from both sides
		const contested = new Uint8Array(n);
		refs.forEach((o, j) => {
			if (j === i) return;
			if (!o) {
				// no reference for that character: exclude its whole box
				const b = clampRect(f.chars[j].box, P.width, P.height);
				if (b) for (let y = Math.max(b.y0, cr.y0); y < Math.min(b.y1, cr.y0 + cr.h); y++) for (let x = Math.max(b.x0, cr.x0); x < Math.min(b.x1, cr.x0 + cr.w); x++) contested[(y - cr.y0) * cr.w + (x - cr.x0)] = 1;
				return;
			}
			for (let y = 0; y < cr.h; y++)
				for (let x = 0; x < cr.w; x++) if (o.img.data[((cr.y0 + y) * o.img.width + cr.x0 + x) * 4 + 3] >= 8) contested[y * cr.w + x] = 1;
		});
		const cont = dilate(contested, cr.w, cr.h, 2);
		const own = new Uint8Array(n);
		let ownCount = 0;
		const sa = new Float32Array(n);
		const ra = new Float32Array(n);
		let changed = 0;
		let alphaOnlyS = 0;
		let alphaOnlyR = 0;
		for (let y = 0; y < cr.h; y++)
			for (let x = 0; x < cr.w; x++) {
				const k = y * cr.w + x;
				const gi = ((cr.y0 + y) * P.width + cr.x0 + x) * 4;
				const as = S.data[gi + 3];
				const ar = ref.img.data[gi + 3];
				// luma over a mid-grey ground (128) so silhouette changes count too
				const lum = (img: Image, a: number) => {
					const al = a / 255;
					return (0.2126 * img.data[gi] + 0.7152 * img.data[gi + 1] + 0.0722 * img.data[gi + 2]) * al + 128 * (1 - al);
				};
				sa[k] = lum(S, as);
				ra[k] = lum(ref.img, ar);
				if (cont[k] || (as < 8 && ar < 8)) continue;
				own[k] = 1;
				ownCount++;
				let dmax = Math.abs(as - ar);
				for (let ch = 0; ch < 3; ch++) dmax = Math.max(dmax, Math.abs((S.data[gi + ch] * as) / 255 - (ref.img.data[gi + ch] * ar) / 255));
				if (dmax > T.model.changedLevel) changed++;
				if (as >= 128 && ar < 128) alphaOnlyS++;
				if (ar >= 128 && as < 128) alphaOnlyR++;
			}
		if (ownCount < 200) return skip('too few unobstructed pixels');
		stats.compared++;
		const res = ssim(sa, ra, cr.w, cr.h, own, 8, 4, 0.5);
		const changedFrac = changed / ownCount;
		stats.worstSsim = Math.min(stats.worstSsim, Number.isFinite(res.mean) ? res.mean : 1);
		stats.maxChangedFrac = Math.max(stats.maxChangedFrac, changedFrac);
		const sev = res.mean < T.model.ssimError || changedFrac > T.model.changedFracError ? 'error' : res.mean < T.model.ssimWarn || changedFrac > T.model.changedFracWarn ? 'warn' : null;
		if (sev) {
			const where = res.count ? {x: cr.x0 + res.minAt.x, y: cr.y0 + res.minAt.y} : null;
			out.push({
				check: 'model-ssim',
				severity: sev,
				frame: f.frame,
				box: c.box,
				subject: who,
				key: `${c.key}|ssim`,
				message: `${who} differs from the canonical ${charName(c)} (${c.view ?? '?'}${c.head && c.kind === 'badger' ? `, head ${c.head}` : ''}${c.props?.expression ? `, ${String(c.props.expression)}` : ''}): SSIM ${res.mean.toFixed(4)}, ${(changedFrac * 100).toFixed(2)}% of pixels changed${alphaOnlyS || alphaOnlyR ? `, silhouette +${alphaOnlyS}/-${alphaOnlyR} px` : ''}`,
				measured: {ssim: Number(res.mean.toFixed(4)), ssimP5: Number(res.p5.toFixed(4)), changedPercent: Number((changedFrac * 100).toFixed(3)), silhouetteAdded: alphaOnlyS, silhouetteLost: alphaOnlyR},
				related: where ? [{rect: {x: where.x, y: where.y, w: 8, h: 8}, label: 'worst window'}] : [],
				score: (1 - res.mean) * 10 + changedFrac * 100,
				thumb: {kind: 'compare', ref: 'solo-vs-ref'},
				charIndex: i,
			});
		}
		// palette: interior pixels of the in-scene character must be approved colours
		const pal = offPalette(S, cr, own, palette, paletteCache);
		if (pal.interior > 200 && pal.off / pal.interior > T.model.paletteFracError) {
			const top = [...pal.offColors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${hex(k)} (${v} px)`);
			out.push({
				check: 'model-palette',
				severity: 'error',
				frame: f.frame,
				box: c.box,
				subject: who,
				key: `${c.key}|palette`,
				message: `${((pal.off / pal.interior) * 100).toFixed(1)}% of ${who}'s flat interior is outside the approved palette (manifest v${manifest.version}): ${top.join(', ')}`,
				measured: {offPercent: Number(((pal.off / pal.interior) * 100).toFixed(2)), interior: pal.interior},
				score: pal.off / pal.interior,
				thumb: {kind: 'compare', ref: 'solo-vs-ref'},
				charIndex: i,
			});
		}
		const m = c.ctm;
		const scale = m ? Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) : 1;
		const originX = m ? m[4] : c.box.x + c.box.w / 2;
		const tol = T.model.blobTolUnits * scale;
		const minBlob = Math.max(4, Math.round(6 * scale * scale));
		if (c.kind === 'zoo') {
			// the teal jellyfish pin (anatomical LEFT chest = screen right in front and 3/4 views)
			const sm = colourMask(S, cr, own, manifest.colours.pin, 24);
			const rm = colourMask(ref.img, cr, own, manifest.colours.pin, 24);
			const sb = biggest(sm, cr.w, cr.h, minBlob);
			const rb = biggest(rm, cr.w, cr.h, minBlob);
			const exp = expectedPin(c.view, c.pose);
			const pinBox = (b: NonNullable<typeof sb>): Rect => ({x: cr.x0 + b.x0, y: cr.y0 + b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0});
			const add = (msg: string, b: Rect, sevScore: number) =>
				out.push({check: 'model-pin', severity: 'error', frame: f.frame, box: b, subject: who, key: `${c.key}|pin|${msg.split(':')[0]}`, message: msg, measured: {view: c.view ?? '?'}, score: sevScore, thumb: {kind: 'compare', ref: 'solo-vs-ref'}, charIndex: i});
			if (rb && !sb) add(`pin missing: the canonical ${c.view} view shows the teal pin, the scene does not`, c.box, 3);
			else if (sb && !rb && exp !== 'right') add(`pin visible where the canonical ${c.view} view hides it`, pinBox(sb), 3);
			else if (sb && rb) {
				const dist = Math.hypot(cr.x0 + sb.cx - (cr.x0 + rb.cx), cr.y0 + sb.cy - (cr.y0 + rb.cy));
				if (dist > tol) add(`pin moved: ${Math.round(dist / scale)} units from its canonical position`, pinBox(sb), 2);
			}
			if (sb && exp === 'right' && cr.x0 + sb.cx < originX) add(`pin on the wrong side: screen-left of Zoo's centre line in the ${c.view} view (manifest: anatomical LEFT chest = screen right)`, pinBox(sb), 4);
			if (sb && exp === 'hidden') add(`pin visible in the ${c.view} view (manifest: hidden)`, pinBox(sb), 3);
		} else if (c.headBox && c.headBox.x >= 0 && c.headBox.y >= 0 && c.headBox.x + c.headBox.w <= P.width && c.headBox.y + c.headBox.h <= P.height) {
			// Badger's dark ear cap: dark (#19191C) pixels in the top 55% of the head box (head fully in frame,
			// or a cropped head would hide the cap and leave a small marking to be mistaken for it)
			const hb = c.headBox;
			const top: Rect = {x: hb.x, y: hb.y, w: hb.w, h: hb.h * 0.55};
			const sm = colourMask(S, cr, own, manifest.colours.earCap, 8, top);
			const rm = colourMask(ref.img, cr, own, manifest.colours.earCap, 8, top);
			// the cap is a whole ear flap: at least 2% of the head box (the small ear spot and cheek spots are far less)
			const capMin = Math.max(minBlob * 4, Math.round(0.02 * hb.w * hb.h));
			const sb = biggest(sm, cr.w, cr.h, capMin);
			const rb = biggest(rm, cr.w, cr.h, capMin);
			const midX = hb.x + hb.w / 2;
			const sideOf = (b: NonNullable<typeof sb>) => (cr.x0 + b.cx >= midX ? 'right' : 'left');
			const exp = expectedEarCapSide(c.head, c.view);
			const add = (msg: string, sc: number) =>
				out.push({check: 'model-earcap', severity: 'error', frame: f.frame, box: hb, subject: who, key: `${c.key}|earcap|${msg.slice(0, 24)}`, message: msg, measured: {head: c.head ?? '?', view: c.view ?? '?'}, score: sc, thumb: {kind: 'compare', ref: 'solo-vs-ref'}, charIndex: i});
			if (rb && !sb) add(`dark ear cap missing (the canonical ${c.head} head shows it on the ${sideOf(rb)})`, 3);
			else if (sb && rb && sideOf(sb) !== sideOf(rb)) add(`dark ear cap on the screen ${sideOf(sb)}; the canonical ${c.head} head has it on the ${sideOf(rb)}`, 4);
			if (sb && exp && sideOf(sb) !== exp) add(`dark ear cap on the screen ${sideOf(sb)}; manifest: ${c.view === 'back' ? 'back view' : 'front head'} shows the anatomical LEFT ear's cap on the screen ${exp}`, 5);
			// spots: dark blobs below the head, counted the same way on both renders
			const body = new Uint8Array(own);
			for (let y = 0; y < cr.h; y++)
				for (let x = 0; x < cr.w; x++) {
					const gx = cr.x0 + x;
					const gy = cr.y0 + y;
					if (gx >= hb.x && gx < hb.x + hb.w && gy >= hb.y && gy < hb.y + hb.h) body[y * cr.w + x] = 0;
				}
			const ss = components(colourMask(S, cr, body, manifest.colours.spot, 8), cr.w, cr.h, minBlob).comps.length;
			const rs = components(colourMask(ref.img, cr, body, manifest.colours.spot, 8), cr.w, cr.h, minBlob).comps.length;
			if (ss !== rs)
				out.push({
					check: 'model-spots',
					severity: 'error',
					frame: f.frame,
					box: c.box,
					subject: who,
					key: `${c.key}|spotblobs`,
					message: `${who} shows ${ss} dark coat spots where the canonical render shows ${rs} (clipped, recoloured or covered markings)`,
					measured: {scene: ss, canonical: rs},
					score: Math.abs(ss - rs),
					thumb: {kind: 'compare', ref: 'solo-vs-ref'},
					charIndex: i,
				});
		}
		// face coverage: other characters in front (from the references) and other artwork (P vs S)
		if (c.headBox) {
			const hc = clampRect(c.headBox, P.width, P.height);
			if (hc) {
				let face = 0;
				let byArt = 0;
				let byChar = 0;
				for (let y = hc.y0; y < hc.y1; y++)
					for (let x = hc.x0; x < hc.x1; x++) {
						const gi = (y * P.width + x) * 4;
						if (ref.img.data[gi + 3] < 250) continue;
						face++;
						const lx = x - cr.x0;
						const ly = y - cr.y0;
						const k = ly * cr.w + lx;
						if (lx >= 0 && ly >= 0 && lx < cr.w && ly < cr.h && contested[k] && c.coveredBy.some((j) => refs[j] && refs[j]!.img.data[gi + 3] >= 128)) {
							byChar++;
							continue;
						}
						if (S.data[gi + 3] >= 250 && Math.max(Math.abs(P.data[gi] - S.data[gi]), Math.abs(P.data[gi + 1] - S.data[gi + 1]), Math.abs(P.data[gi + 2] - S.data[gi + 2])) > 24) byArt++;
					}
				const covered = (byArt + byChar) / Math.max(1, face);
				if (face > 100 && covered > T.faces.occludedFrac)
					out.push({
						check: 'face-occluded',
						severity: 'warn',
						frame: f.frame,
						box: c.headBox,
						subject: who,
						key: `${c.key}|face`,
						message: `${Math.round(covered * 100)}% of ${who}'s face is painted over (${byChar ? `${Math.round((byChar / face) * 100)}% by another character` : ''}${byChar && byArt ? ', ' : ''}${byArt ? `${Math.round((byArt / face) * 100)}% by other artwork` : ''})`,
						measured: {coveredPercent: Math.round(covered * 100), byCharacter: byChar, byArtwork: byArt},
						score: covered,
						charIndex: i,
					});
			}
		}
	});
	return out;
};
