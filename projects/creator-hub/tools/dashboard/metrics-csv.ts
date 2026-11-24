/**
 * metrics.csv: one row per video. The first 15 columns are VideoMetrics (src/types.ts) in contract
 * order; the rest are the dashboard's own columns. Empty cell = unknown. ctr and avgPercentViewed
 * are fractions (0.052 = 5.2%). Text cells are formula-safe for spreadsheets.
 */
import type {VideoMetrics} from '../../src/types.ts';
import {toCsv, type CsvValue} from './csv.ts';
import type {DashboardVideo} from './model.ts';
import {formatMoney} from './payouts.ts';
import {per1k} from './stats.ts';

export const CONTRACT_COLUMNS: (keyof VideoMetrics)[] = [
	'videoId', 'title', 'channel', 'publishedAt', 'format', 'views', 'impressions', 'ctr', 'avgViewDurationSec', 'avgPercentViewed',
	'subscribersGained', 'adRevenueUsd', 'hubClicks', 'conversions', 'affiliateRevenueUsd',
];

export const EXTRA_COLUMNS = [
	'tags', 'formatSource', 'engagedViews', 'subscribersNet', 'hubClicksYoutube', 'revenueUsd', 'revenuePer1kViews', 'hubClicksPer1kViews',
	'affiliateRevenueOther', 'adRevenueOther', 'inputs',
] as const;

const round = (value: number | null, places: number): number | null => (value === null ? null : Math.round(value * 10 ** places) / 10 ** places);

export const metricsRow = (v: DashboardVideo): CsvValue[] => [
	...CONTRACT_COLUMNS.map((key) => v[key] as CsvValue),
	v.tags.join('; '),
	v.formatSource,
	v.engagedViews,
	v.subscribersNet,
	v.hubClicksYoutube,
	v.revenueUsd,
	round(per1k(v.revenueUsd, v.views), 4),
	round(per1k(v.hubClicksYoutube, v.views), 4),
	formatMoney(v.affiliateRevenueOther),
	v.adRevenueOther ? formatMoney([v.adRevenueOther]) : '',
	v.inputs.join('; '),
];

export const renderMetricsCsv = (videos: DashboardVideo[]): string => toCsv([...CONTRACT_COLUMNS, ...EXTRA_COLUMNS], videos.map(metricsRow));
