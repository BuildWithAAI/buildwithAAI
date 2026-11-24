/**
 * The exported spot SVGs on disk (out/product/spots/<id>.svg) as the renderer's SpotInfo map: printed size from
 * the SVG's width/height attributes, a path relative to the HTML file, and the catalog's alt text. Node only.
 */
import {existsSync, readFileSync} from 'node:fs';
import {join, relative} from 'node:path';
import {SPOTS} from '../spots/catalog.ts';
import type {SpotInfo} from './render.ts';

export const spotInfos = (spotsDir: string, htmlDir: string): Record<string, SpotInfo> => {
	const out: Record<string, SpotInfo> = {};
	for (const s of SPOTS) {
		const f = join(spotsDir, `${s.id}.svg`);
		if (!existsSync(f)) continue;
		const head = readFileSync(f, 'utf8').slice(0, 400);
		const w = /\bwidth="([\d.]+)"/.exec(head);
		const h = /\bheight="([\d.]+)"/.exec(head);
		if (!w || !h) continue;
		out[s.id] = {id: s.id, src: relative(htmlDir, f).split('\\').join('/'), widthPx: Number(w[1]), heightPx: Number(h[1]), alt: s.alt};
	}
	return out;
};
