/**
 * Fonts per language. The brand fonts (Inter, Montserrat, Anton; src/brand/fonts.ts) have no Devanagari or CJK glyphs,
 * so hi/zh/ja add Noto Sans Devanagari / SC / JP (OFL, bundled from @fontsource, never fetched from Google). The brand
 * family comes first in every stack, so Latin letters and digits keep the brand look and only the script characters
 * fall through to Noto. Anton (display) has no script support either: hi/zh/ja titles use the heading stack at 900.
 * loadLangFonts() resolves when every face is loaded; @remotion/fonts' loadFont blocks the render until then.
 */
import {loadFont} from '@remotion/fonts';
import {FONTS, loadBrandFonts} from '../../brand/fonts';
import type {Lang} from '../types';
import deva400 from '@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-400-normal.woff2';
import deva600 from '@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-600-normal.woff2';
import deva700 from '@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-700-normal.woff2';
import deva800 from '@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-800-normal.woff2';
import deva900 from '@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-900-normal.woff2';
import sc400 from '@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-400-normal.woff2';
import sc700 from '@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-700-normal.woff2';
import sc900 from '@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-900-normal.woff2';
import jp400 from '@fontsource/noto-sans-jp/files/noto-sans-jp-japanese-400-normal.woff2';
import jp700 from '@fontsource/noto-sans-jp/files/noto-sans-jp-japanese-700-normal.woff2';
import jp900 from '@fontsource/noto-sans-jp/files/noto-sans-jp-japanese-900-normal.woff2';

export type FontRole = 'display' | 'heading' | 'body';

type Script = {family: string; faces: Array<{weight: string; url: string}>};
const SCRIPTS: Partial<Record<Lang, Script>> = {
	hi: {
		family: 'Noto Sans Devanagari',
		faces: [
			{weight: '400', url: deva400},
			{weight: '600', url: deva600},
			{weight: '700', url: deva700},
			{weight: '800', url: deva800},
			{weight: '900', url: deva900},
		],
	},
	zh: {
		family: 'Noto Sans SC',
		faces: [
			{weight: '400', url: sc400},
			{weight: '700', url: sc700},
			{weight: '900', url: sc900},
		],
	},
	ja: {
		family: 'Noto Sans JP',
		faces: [
			{weight: '400', url: jp400},
			{weight: '700', url: jp700},
			{weight: '900', url: jp900},
		],
	},
};

/** The script family a language needs beyond the brand fonts, or null (en, es, pt-br, it). */
export const scriptFamily = (lang: Lang): string | null => SCRIPTS[lang]?.family ?? null;

export type FontSpec = {fontFamily: string; fontWeight: number};

/** CSS family stack and weight for a text role in a language. */
export const fontFor = (lang: Lang, role: FontRole, weight: number): FontSpec => {
	const script = scriptFamily(lang);
	if (role === 'display') return script ? {fontFamily: `${FONTS.heading}, "${script}"`, fontWeight: 900} : {fontFamily: FONTS.display, fontWeight: 400};
	const base = role === 'heading' ? FONTS.heading : FONTS.body;
	return {fontFamily: script ? `${base}, "${script}"` : base, fontWeight: weight};
};

/**
 * Line-height factor per script: Devanagari stacks vowel signs above the headline and below the baseline, and CJK
 * glyphs fill the whole em box, so both need more air between lines than Latin at the same nominal line height.
 */
export const lineFactor = (lang: Lang): number => (lang === 'hi' ? 1.16 : lang === 'zh' || lang === 'ja' ? 1.1 : 1);

/** Canvas font shorthand for measuring: "800 48px Montserrat, \"Noto Sans SC\"". */
export const canvasFont = (f: FontSpec, size: number): string => `${f.fontWeight} ${size}px ${f.fontFamily}`;

const loaded = new Map<Lang, Promise<void>>();
/** Load every face the language needs (brand fonts always). Cached per language. */
export const loadLangFonts = (lang: Lang): Promise<void> => {
	let p = loaded.get(lang);
	if (!p) {
		const script = SCRIPTS[lang];
		p = Promise.all([
			loadBrandFonts(),
			...(script ? script.faces.map((f) => loadFont({family: script.family, url: f.url, weight: f.weight, format: 'woff2'})) : []),
		]).then(() => undefined);
		loaded.set(lang, p);
	}
	return p;
};
