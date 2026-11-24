// chartFormat.ts: the number formatters and linear ticks the chart actually draws (CHART_SPEC 4 L4, L7, L8; R2).
//
// chartGeometry.ts stays byte-identical to the spec's verbatim code, but three of its helpers print wrong or
// ambiguous numbers, so nothing in src/charts calls them for on-screen text:
//   - fmtUsd counts the zeros of the subscript format BEFORE rounding to 2 digits, so a carry prints a value 10x too
//     small (fmtUsd(0.000009966) = '$0.0₅100' = 0.000001). It also picks the K/M/B unit before rounding
//     (fmtUsd(999_600) = '$1000K').
//   - fmtUsd always prints 3 significant digits, so a fine linear step gives duplicate or wrong tick labels
//     (ticks 150,500 / 151,000 / 151,500 print '$151K', '$151K', '$152K').
//   - fmtPct takes its sign and precision from the unrounded value ('+0.0%' with an up glyph; 0.0999 -> '+10.0%').
//   - niceLinearTicks (target 5) gives 2-3 ticks on most linear axes; L7 asks for 4-7.
// The fixes below round first and choose the unit, the zero count and the sign from the rounded value. The spec's
// verbatim code needs the same change (reported to the spec owner); then these can move back into chartGeometry.ts.

export const SUBSCRIPTS = '₀₁₂₃₄₅₆₇₈₉';

const trim = (x: number, sig: number): string => String(Number(x.toPrecision(sig)));

/**
 * USD with at least `minSig` significant digits: 3 by default ($4.23K, $61.7K, $1.2M, $5K, as the spec's fmtUsd), K/M/B
 * units, and subscript zeros below $0.001 ($0.0₅32 = $0.0000032; 2 digits by default there, as the spec prints).
 * Rounds first, then picks the unit and counts the zeros from the ROUNDED value, so the text always reads as the value
 * rounded to that precision. Never exponent notation.
 */
export const fmtUsdSig = (v: number, minSig = 0): string => {
	if (!(Number.isFinite(v) && v > 0)) throw new Error(`fmtUsd: ${v} is not a positive finite number (V2)`);
	if (!(Number.isInteger(minSig) && minSig >= 0 && minSig <= 12)) throw new Error(`fmtUsd: minSig ${minSig} must be an integer in 0..12`);
	const sig = Math.max(3, minSig);
	const r = Number(v.toPrecision(sig));
	if (r >= 1e9) return `$${trim(r / 1e9, sig)}B`;
	if (r >= 1e6) return `$${trim(r / 1e6, sig)}M`;
	if (r >= 1e3) return `$${trim(r / 1e3, sig)}K`;
	if (r >= 0.001) return `$${trim(r, sig)}`;
	const subSig = Math.max(2, minSig);
	const [mant, exp] = v.toExponential(subSig - 1).split('e'); // one rounding gives both the digits and the exponent
	const e = Number(exp);
	if (e >= -3) return `$${trim(Number(v.toPrecision(subSig)), subSig)}`; // the rounding carried up to $0.001
	const zeros = -e - 1; // zeros after "0."
	return `$0.0${String(zeros)
		.split('')
		.map((d) => SUBSCRIPTS[+d])
		.join('')}${mant.replace('.', '')}`;
};

/** The spec's fmtUsd, corrected: 3 significant digits ($4.23K, $61.7K, $1.2M, $5K), subscript zeros below $0.001. */
export const fmtUsd = (v: number): string => fmtUsdSig(v);

/** Decode a fmtUsd string back to a number (tests and the layout's label self-check). NaN if it is not one. */
export const parseUsd = (s: string): number => {
	const sub = /^\$0\.0([₀-₉]+)(\d+)$/.exec(s);
	if (sub) {
		const zeros = Number([...sub[1]].map((ch) => SUBSCRIPTS.indexOf(ch)).join(''));
		return Number(`0.${'0'.repeat(zeros)}${sub[2]}`);
	}
	const m = /^\$(\d+(?:\.\d+)?)([KMB]?)$/.exec(s);
	if (!m) return NaN;
	return Number(m[1]) * {'': 1, K: 1e3, M: 1e6, B: 1e9}[m[2] as '' | 'K' | 'M' | 'B'];
};

/**
 * The minimum significant digits that keep every linear tick label distinct and exact: the digits from each tick's
 * leading place down to the step's leading place (fmtUsdSig adds its own floor: 3, or 2 below $0.001). Log ticks
 * (1-2-5 per decade) need nothing extra: 0.
 */
export const labelSig = (ticks: number[], step: number | null): number => {
	if (step === null || ticks.length === 0) return 0;
	const lead = (x: number) => Math.floor(Math.log10(Math.abs(x)) + 1e-9);
	return Math.min(12, Math.max(0, ...ticks.map((t) => lead(t) - lead(step) + 1)));
};

/**
 * Linear ticks with 4-7 ticks (L7). First choice: the 1-2-5 step whose count inside [min, max] is in 4-7, nearest 5
 * (ties: fewer ticks). About 7% of linear ranges fall between two 1-2-5 steps (3 ticks vs 8-10, measured over 19,800
 * windows of 200 seeds); then the 2.5 x 10^k step is used, which lands in 4-7 for those ranges. Last resort (not seen
 * in the sweep): the fewest ticks above 7, never fewer than 4.
 */
export const linearTicks = (min: number, max: number): {ticks: number[]; step: number} => {
	if (!(max > min)) throw new Error(`linearTicks: empty range ${min}..${max}`);
	const e0 = Math.floor(Math.log10((max - min) / 5));
	const make = (mults: number[]) => {
		const out: Array<{step: number; ticks: number[]}> = [];
		for (let e = e0 - 2; e <= e0 + 2; e++)
			for (const m of mults) {
				const step = Number((m * 10 ** e).toPrecision(12));
				const ticks: number[] = [];
				for (let k = Math.ceil(min / step - 1e-9); k * step <= max + step * 1e-9; k++) ticks.push(Number((k * step).toPrecision(12)));
				out.push({step, ticks});
			}
		return out;
	};
	const inBand = (cs: Array<{step: number; ticks: number[]}>) =>
		cs
			.filter((c) => c.ticks.length >= 4 && c.ticks.length <= 7)
			.sort((a, b) => Math.abs(a.ticks.length - 5) - Math.abs(b.ticks.length - 5) || a.ticks.length - b.ticks.length)[0];
	const best =
		inBand(make([1, 2, 5])) ??
		inBand(make([2.5])) ??
		make([1, 2, 5])
			.filter((c) => c.ticks.length > 7)
			.sort((a, b) => a.ticks.length - b.ticks.length)[0];
	return {ticks: best.ticks, step: best.step};
};

/**
 * A signed percentage for the change callout (L4, CD7): +402%, −84%, +24.3%. Sign, glyph direction and precision all
 * come from the ROUNDED value, so the glyph never disagrees with the number: a move that rounds to 0.0% prints
 * '0.0%' with the neutral glyph, and 0.0999 prints '+10%' (not '+10.0%').
 */
export const fmtPctDisplay = (r: number): {text: string; dir: 'up' | 'down' | 'flat'} => {
	if (!Number.isFinite(r)) throw new Error(`fmtPct: ${r} is not finite`);
	const a = Math.abs(r * 100);
	const one = Number(a.toFixed(1));
	const text = one >= 10 ? a.toFixed(0) : one.toFixed(1);
	if (Number(text) === 0) return {text: '0.0%', dir: 'flat'};
	return r > 0 ? {text: `+${text}%`, dir: 'up'} : {text: `−${text}%`, dir: 'down'};
};
