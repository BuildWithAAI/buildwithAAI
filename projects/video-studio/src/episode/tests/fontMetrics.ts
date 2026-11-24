/**
 * Node-only text measurement for the tests: advance widths read from the SAME @fontsource fonts the renders bundle
 * (their WOFF 1.0 twins: zlib-compressed sfnt tables). Kerning is ignored, which errs slightly wide for Latin text,
 * so a fit that passes here has a little margin in the browser. Missing glyphs throw (no silent fallback).
 */
import {readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Measure} from '../text/fit.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

type Tables = Map<string, Buffer>;
const readWoff = (path: string): Tables => {
	const b = readFileSync(path);
	if (b.toString('latin1', 0, 4) !== 'wOFF') throw new Error(`${path}: not a WOFF 1.0 file`);
	const n = b.readUInt16BE(12);
	const t: Tables = new Map();
	for (let i = 0; i < n; i++) {
		const e = 44 + i * 20;
		const tag = b.toString('latin1', e, e + 4);
		const off = b.readUInt32BE(e + 4);
		const comp = b.readUInt32BE(e + 8);
		const orig = b.readUInt32BE(e + 12);
		const data = b.subarray(off, off + comp);
		t.set(tag, comp < orig ? inflateSync(data) : Buffer.from(data));
	}
	return t;
};

/** cmap: format 4 (BMP) and format 12 (full Unicode) subtables. */
const cmapOf = (cmap: Buffer): Map<number, number> => {
	const out = new Map<number, number>();
	const n = cmap.readUInt16BE(2);
	for (let i = 0; i < n; i++) {
		const off = cmap.readUInt32BE(4 + i * 8 + 4);
		const fmt = cmap.readUInt16BE(off);
		if (fmt === 4) {
			const segX2 = cmap.readUInt16BE(off + 6);
			const seg = segX2 / 2;
			const ends = off + 14;
			const starts = ends + segX2 + 2;
			const deltas = starts + segX2;
			const ranges = deltas + segX2;
			for (let s = 0; s < seg; s++) {
				const end = cmap.readUInt16BE(ends + 2 * s);
				const start = cmap.readUInt16BE(starts + 2 * s);
				const delta = cmap.readInt16BE(deltas + 2 * s);
				const ro = cmap.readUInt16BE(ranges + 2 * s);
				for (let c = start; c <= end && c !== 0xffff; c++) {
					let g: number;
					if (ro === 0) g = (c + delta) & 0xffff;
					else {
						const at = ranges + 2 * s + ro + 2 * (c - start);
						g = cmap.readUInt16BE(at);
						if (g) g = (g + delta) & 0xffff;
					}
					if (g && !out.has(c)) out.set(c, g);
				}
			}
		} else if (fmt === 12) {
			const groups = cmap.readUInt32BE(off + 12);
			for (let k = 0; k < groups; k++) {
				const g0 = off + 16 + k * 12;
				const a = cmap.readUInt32BE(g0);
				const z = cmap.readUInt32BE(g0 + 4);
				const gid = cmap.readUInt32BE(g0 + 8);
				for (let c = a; c <= z; c++) if (!out.has(c)) out.set(c, gid + (c - a));
			}
		}
	}
	return out;
};

export type FontTable = {unitsPerEm: number; advance: (cp: number) => number; has: (cp: number) => boolean};

const cache = new Map<string, FontTable>();
export const loadTable = (relPath: string): FontTable => {
	const hit = cache.get(relPath);
	if (hit) return hit;
	const t = readWoff(join(ROOT, relPath));
	const head = t.get('head');
	const hhea = t.get('hhea');
	const hmtx = t.get('hmtx');
	const cmapT = t.get('cmap');
	if (!head || !hhea || !hmtx || !cmapT) throw new Error(`${relPath}: missing head/hhea/hmtx/cmap`);
	const upm = head.readUInt16BE(18);
	const nH = hhea.readUInt16BE(34);
	const cmap = cmapOf(cmapT);
	const adv = (gid: number) => hmtx.readUInt16BE(4 * Math.min(gid, nH - 1));
	const table: FontTable = {
		unitsPerEm: upm,
		has: (cp) => cmap.has(cp),
		advance: (cp) => {
			const g = cmap.get(cp);
			if (g === undefined) throw new Error(`${relPath}: no glyph for U+${cp.toString(16).toUpperCase().padStart(4, '0')} "${String.fromCodePoint(cp)}"`);
			return adv(g);
		},
	};
	cache.set(relPath, table);
	return table;
};

const FS = 'node_modules/@fontsource';
/** The font file the browser uses for a role and weight in a Latin-script language (src/episode/i18n/fonts.ts). */
export const latinFontFile = (role: 'display' | 'heading' | 'body', weight: number): string => {
	if (role === 'display') return `${FS}/anton/files/anton-latin-400-normal.woff`;
	if (role === 'heading') {
		const w = weight >= 900 ? 900 : weight >= 800 ? 800 : 700; // Montserrat 700/800/900 are loaded
		return `${FS}/montserrat/files/montserrat-latin-${w}-normal.woff`;
	}
	const w = [400, 600, 700, 800, 900].reduce((a, b) => (Math.abs(b - weight) < Math.abs(a - weight) ? b : a));
	return `${FS}/inter/files/inter-latin-${w}-normal.woff`;
};

/** A Measure (fit.ts) from real advance widths. */
export const measureFromFont = (relPath: string): Measure => {
	const t = loadTable(relPath);
	return (text: string, size: number) => {
		let w = 0;
		for (const ch of text) w += t.advance(ch.codePointAt(0) as number);
		return (w * size) / t.unitsPerEm;
	};
};
