/**
 * Reported-loss maths for the Rekt Meter (pure).
 *  - parseLossUsd: reads the on-screen display string ("$4.2M", "$12,400,000", "4,2 millones de dólares", "420万美元")
 *    so the validator can check it agrees with scene.rekt.usd. The display string is what the claim gate checks
 *    against the stored source excerpts; rekt.usd only positions the needle.
 *  - The dial is a LOG scale, $100K to $10B, one step per factor of 10, so every loss from a small drain to the
 *    largest recorded thefts sits on the same honest scale. Values outside it pin to the end and say so.
 * Loss figures are always one outlet's report: they are never averaged or combined (owner rule).
 */
import {localeOf} from './ui.ts';

export const METER = {minExp: 5, maxExp: 10} as const; // $100K .. $10B

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export type MeterReading = {fraction: number; belowScale: boolean; aboveScale: boolean};

/** Position of a USD amount on the dial, 0 (left end, $100K) .. 1 (right end, $10B). */
export const meterReading = (usd: number): MeterReading => {
	if (!Number.isFinite(usd) || usd <= 0) throw new Error(`reported loss must be a positive number of USD, got ${usd}`);
	const e = Math.log10(usd);
	return {
		fraction: clamp01((e - METER.minExp) / (METER.maxExp - METER.minExp)),
		belowScale: e < METER.minExp,
		aboveScale: e > METER.maxExp,
	};
};

export type MeterTick = {exp: number; usd: number; fraction: number};

export const meterTicks = (): MeterTick[] => {
	const out: MeterTick[] = [];
	for (let e = METER.minExp; e <= METER.maxExp; e++) out.push({exp: e, usd: 10 ** e, fraction: (e - METER.minExp) / (METER.maxExp - METER.minExp)});
	return out;
};

/** Short tick label in the storyboard language: "$100K", "$1M", "$10B" (Intl compact currency). */
export const tickLabel = (usd: number, lang: string): string => {
	try {
		return new Intl.NumberFormat(localeOf(lang), {style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 0}).format(usd);
	} catch {
		return `$${usd}`;
	}
};

// ---------------------------------------------------------------------------------------------------------------
// Parsing a display string

/** Scale words after the number, longest first so "mil millones" wins over "mil". */
const SCALES: Array<[RegExp, number]> = [
	[/^(?:mil\s+millones|mil\s+milhões|bilhões|bilhão|bilh[oõ]es|billions?|bn|bi\b|b\b|miliardi|miliardo|mld|mrd|milliards?|十亿)/u, 1e9],
	[/^(?:trillions?|tn\b|t\b)/u, 1e12],
	[/^(?:millions?|millones|millón|millon|milhões|milhão|milh[oõ]es|milioni|milione|mln|mio|mn\b|mm\b|mi\b|m\b)/u, 1e6],
	[/^(?:thousands?|mila|mil\b|k\b)/u, 1e3],
	[/^亿|^億/u, 1e8],
	[/^万|^萬/u, 1e4],
	[/^करोड़|^करोड/u, 1e7],
	[/^लाख/u, 1e5],
];

const NUMBER = /(\d{1,3}(?:([.,   ])\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)/u;

/** Turn a written number into a JS number, deciding which separator is decimal (see the module comment). */
export const readNumber = (raw: string): number | null => {
	const s = raw.replace(/[   ]/g, ' ');
	const seps = s.match(/[.,]/g) ?? [];
	let t = s.replace(/ /g, '');
	if (!seps.length) return Number(t);
	const last = seps[seps.length - 1];
	const lastIdx = t.lastIndexOf(last);
	const after = t.length - lastIdx - 1;
	const kinds = new Set(seps);
	if (kinds.size === 2) {
		// "1.234.567,89" or "1,234,567.89": the last separator is the decimal point
		const thousands = last === ',' ? '.' : ',';
		t = t.split(thousands).join('').replace(last, '.');
	} else if (seps.length > 1) {
		// one kind, several times: thousands groups ("12,400,000" / "12.400.000")
		t = t.split(last).join('');
	} else if (after === 3) {
		// a single separator before exactly three digits: a thousands group ("40,000" / "40.000")
		t = t.replace(last, '');
	} else {
		t = t.replace(last, '.');
	}
	const v = Number(t);
	return Number.isFinite(v) ? v : null;
};

/**
 * USD amount of a loss display string, or null when it has no number. Handles $ / US$ / USD / "dollars" in en, es,
 * pt-br, it; 万 / 亿 (zh, ja) and लाख / करोड़ (hi). The currency is not checked: the meter only shows USD reports.
 */
export const parseLossUsd = (display: string): number | null => {
	const text = display.normalize('NFC');
	const m = NUMBER.exec(text);
	if (!m) return null;
	const n = readNumber(m[1]);
	if (n === null) return null;
	const rest = text
		.slice(m.index + m[0].length)
		.trimStart()
		.toLowerCase();
	for (const [re, mult] of SCALES) if (re.test(rest)) return n * mult;
	return n;
};

/** True when the display string and the stored amount agree within display rounding (5%). */
export const lossAgrees = (display: string, usd: number, tolerance = 0.05): boolean | null => {
	const v = parseLossUsd(display);
	if (v === null) return null;
	return Math.abs(v - usd) / usd <= tolerance;
};
