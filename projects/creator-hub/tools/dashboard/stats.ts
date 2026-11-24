/** The dashboard's maths, kept small and separate so every formula is tested. */

/** Amount per 1,000 views; null when there are no views or no amount. */
export const per1k = (amount: number | null, views: number | null): number | null =>
	amount === null || views === null || views <= 0 ? null : (amount / views) * 1000;

/** Median of the non-null values (mean of the middle two for an even count); null when there are none. */
export const median = (values: (number | null)[]): number | null => {
	const sorted = values.filter((v): v is number => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
	if (sorted.length === 0) return null;
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/**
 * Pooled rate per 1,000 views over a group: the sum of the amounts divided by the sum of the views
 * of the items that have both. A group of one big and one small video is weighted by views, unlike a
 * mean of per-video rates.
 */
export const pooledPer1k = (items: {amount: number | null; views: number | null}[]): {rate: number | null; views: number; amount: number; n: number} => {
	let views = 0;
	let amount = 0;
	let n = 0;
	for (const item of items) {
		if (item.amount === null || item.views === null || item.views <= 0) continue;
		views += item.views;
		amount += item.amount;
		n++;
	}
	return {rate: views > 0 ? (amount / views) * 1000 : null, views, amount, n};
};

/** value / base, or null when the base is 0 or unknown. */
export const ratio = (value: number | null, base: number | null): number | null =>
	value === null || base === null || base === 0 ? null : value / base;

export const sum = (values: (number | null)[]): number => values.reduce<number>((total, v) => total + (v ?? 0), 0);
