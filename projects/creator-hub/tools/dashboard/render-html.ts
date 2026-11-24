/**
 * index.html: a static, self-contained dashboard. No JavaScript at all (the Content-Security-Policy
 * blocks scripts), inline CSS and inline SVG bars, light and dark themes, readable on a phone.
 * Every dynamic value is escaped. Each chart is a list of named rows with the value printed beside its
 * bar, so nothing depends on colour or hover, and each has a table view.
 */
import type {DashboardVideo, Issue, OfferSummary, Unattributed} from './model.ts';
import {cents, formatMoney} from './payouts.ts';
import type {Report} from './recommend.ts';
import {median, per1k} from './stats.ts';

const ESCAPES: Record<string, string> = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'};
export const esc = (value: unknown): string => (value === null || value === undefined ? '' : String(value)).replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);

const int = (value: number | null): string => (value === null ? '–' : Math.round(value).toLocaleString('en-US'));
const usd = (value: number | null): string => (value === null ? '–' : `$${value.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
const pct = (value: number | null, digits = 1): string => (value === null ? '–' : `${(value * 100).toFixed(digits)}%`);
const dec = (value: number | null, digits = 1): string => (value === null ? '–' : value.toLocaleString('en-US', {minimumFractionDigits: digits, maximumFractionDigits: digits}));

/** 1,284 / 12.9K / 4.2M for stat tiles. */
export const compact = (value: number): string => {
	const abs = Math.abs(value);
	if (abs < 10_000) return Math.round(value).toLocaleString('en-US');
	if (abs < 1_000_000) return `${(value / 1000).toFixed(abs < 100_000 ? 1 : 0)}K`;
	return `${(value / 1_000_000).toFixed(1)}M`;
};

/** 192 -> "3:12", 3723 -> "1:02:03". */
export const clock = (seconds: number | null): string => {
	if (seconds === null) return '–';
	const s = Math.round(seconds);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const r = String(s % 60).padStart(2, '0');
	return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
};

// Bars use #008F85 (light) and #20A89E (dark): the brand teal stepped so the mark clears 3:1 on the
// card surface and stays inside the chart lightness band (checked with the dataviz palette validator).
const CSS = `:root{--ink:#0B0C0F;--paper:#F4F6F8;--slate:#161A21;--teal:#29B8AD;--bg:var(--paper);--text:var(--ink);--muted:#4A5260;--surface:#FFFFFF;--line:#D9DEE5;--mark:#008F85;--ref:#4A5260;--warn-bg:#FFF4E0;--warn-text:#7A4A00;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:var(--ink);--text:var(--paper);--muted:#AEB6C2;--surface:var(--slate);--line:#2B313C;--mark:#20A89E;--ref:#AEB6C2;--warn-bg:#2A2112;--warn-text:#FFD9A0}}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:1rem/1.55 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans",sans-serif;overflow-wrap:anywhere}
.wrap{width:min(100% - 2rem,64rem);margin-inline:auto}
.skip{position:absolute;left:-10000px;top:0;background:var(--teal);color:var(--ink);padding:.5rem 1rem;z-index:10}
.skip:focus{left:1rem;top:1rem}
header.site{background:var(--ink);color:var(--paper);border-bottom:3px solid var(--teal)}
header.site .wrap{display:flex;flex-wrap:wrap;justify-content:space-between;gap:.25rem 1rem;padding:.85rem 0}
.brand{font-weight:700;letter-spacing:.02em;display:inline-flex;align-items:center;gap:.5rem}
.brand::before{content:"";width:.7rem;height:.7rem;border-radius:50%;background:var(--teal)}
main{padding:1.75rem 0 3rem}
h1{font-size:clamp(1.6rem,5vw,2.2rem);line-height:1.15;margin:0 0 .4rem}
h2{font-size:1.25rem;line-height:1.3;margin:2.5rem 0 .35rem}
h3{font-size:1rem;margin:1.25rem 0 .5rem}
p{margin:.4rem 0 .9rem}
a{color:inherit;text-decoration-color:var(--teal);text-decoration-thickness:2px;text-underline-offset:3px}
:focus-visible{outline:3px solid var(--teal);outline-offset:3px;border-radius:4px}
.lede,.muted{color:var(--muted)}
.small{font-size:.9rem}
.notice{background:var(--surface);border:1px solid var(--line);border-left:4px solid var(--teal);border-radius:0 12px 12px 0;padding:.75rem 1rem;margin:1rem 0}
.notice p{margin:0}
.warn{background:var(--warn-bg);color:var(--warn-text);border-radius:12px;padding:.75rem 1rem;margin:1rem 0}
.warn p{margin:0}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(9.5rem,1fr));gap:.75rem;margin:1.25rem 0 0;padding:0}
.kpi{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:.75rem 1rem;margin:0}
.kpi dt{color:var(--muted);font-size:.85rem}
.kpi dd{margin:.1rem 0 0;font-size:1.6rem;font-weight:650;line-height:1.2}
.kpi dd small{display:block;font-size:.8rem;font-weight:400;color:var(--muted)}
.card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:1rem 1.1rem;margin:.75rem 0}
.card>h3:first-child{margin-top:0}
.bars{list-style:none;margin:0;padding:0;display:grid;gap:.6rem}
.bar-row{display:grid;grid-template-columns:minmax(0,15rem) minmax(0,1fr) 5.5rem;align-items:center;gap:.15rem .75rem}
.bar-label{font-size:.92rem;line-height:1.3}
.bar-label small{display:block;color:var(--muted);font-size:.8rem}
.bar-track svg{display:block;width:100%;height:16px;overflow:visible}
.bar-value{text-align:right;font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap}
.mark{fill:var(--mark)}
.ref{fill:var(--ref)}
.base{fill:var(--line)}
.bar-row:hover .mark{opacity:.8}
.legend{display:flex;flex-wrap:wrap;gap:.25rem 1rem;color:var(--muted);font-size:.85rem;margin:.25rem 0 .75rem}
.legend svg{vertical-align:middle;margin-right:.35rem}
.tag{display:inline-block;font-size:.72rem;font-weight:650;letter-spacing:.04em;text-transform:uppercase;border:1px solid var(--muted);border-radius:999px;padding:0 .45rem;color:var(--muted);margin-left:.3rem;vertical-align:1px}
.table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:12px;background:var(--surface);margin:.5rem 0 1rem}
table{width:100%;border-collapse:collapse;font-size:.9rem;overflow-wrap:normal}
caption{text-align:left;font-weight:650;padding:.6rem .75rem}
th,td{text-align:left;padding:.45rem .75rem;border-top:1px solid var(--line);vertical-align:top}
thead th{font-weight:650}
tbody th{font-weight:500;min-width:12rem}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
details{margin:.5rem 0}
details summary{cursor:pointer;color:var(--muted);font-size:.9rem;min-height:44px;display:flex;align-items:center}
ul.notes{padding-left:1.2rem;font-size:.9rem}
ul.notes li{margin:.25rem 0}
.lvl{font-weight:650}
footer.site{border-top:1px solid var(--line);padding:1.25rem 0 2rem;color:var(--muted);font-size:.9rem}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
@media (max-width:40rem){.bar-row{grid-template-columns:minmax(0,1fr) auto}.bar-label{grid-column:1/-1}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
@media print{header.site{background:none;color:var(--text)}details{display:block}}
`;

type BarItem = {label: string; sublabel: string; value: number; display: string};
type BarGroup = {heading: string; items: BarItem[]; reference: {value: number; label: string} | null; missing: string[]};

/** One horizontal bar: 4px rounded data end, square at the baseline, 8px thick. */
const bar = (item: BarItem, max: number, reference: number | null, tooltip: string): string => {
	const width = max > 0 ? Math.max(0, Math.min(100, (item.value / max) * 100)) : 0;
	const w = width.toFixed(2);
	const square = width >= 2 ? '<rect class="mark" x="0" y="4" width="4" height="8"/>' : '';
	const ref = reference !== null && max > 0 ? `<rect class="ref" x="${Math.min(100, (reference / max) * 100).toFixed(2)}%" y="0" width="2" height="16"/>` : '';
	return `<svg aria-hidden="true" focusable="false"><title>${esc(tooltip)}</title><rect class="base" x="0" y="0" width="1" height="16"/>${width > 0 ? `<rect class="mark" x="0" y="4" width="${w}%" height="8" rx="4"/>${square}` : ''}${ref}</svg>`;
};

const barGroup = (group: BarGroup): string => {
	if (group.items.length === 0 && group.missing.length === 0) return '';
	const max = Math.max(0, ...group.items.map((i) => i.value), group.reference?.value ?? 0);
	const rows = group.items
		.map((item) => `<li class="bar-row"><span class="bar-label">${esc(item.label)}${item.sublabel ? `<small>${esc(item.sublabel)}</small>` : ''}</span><span class="bar-track">${bar(item, max, group.reference?.value ?? null, `${item.label}: ${item.display}`)}</span><span class="bar-value">${esc(item.display)}</span></li>`)
		.join('\n');
	const legend = group.reference
		? `<p class="legend"><span><svg width="10" height="14" aria-hidden="true" focusable="false"><rect class="ref" x="4" y="0" width="2" height="14"/></svg>${esc(group.reference.label)}</span></p>`
		: '';
	const missing = group.missing.length > 0 ? `<p class="small muted">No data yet: ${esc(group.missing.join(', '))}</p>` : '';
	return `<h3>${esc(group.heading)}</h3>\n${legend}${group.items.length > 0 ? `<ol class="bars">\n${rows}\n</ol>` : ''}\n${missing}`;
};

const table = (caption: string, headers: {label: string; num?: boolean}[], rows: string[][], rowHeader = true): string =>
	`<div class="table-wrap"><table><caption>${esc(caption)}</caption><thead><tr>${headers.map((h) => `<th scope="col"${h.num ? ' class="num"' : ''}>${esc(h.label)}</th>`).join('')}</tr></thead><tbody>${rows
		.map((cells) => `<tr>${cells.map((cell, i) => (i === 0 && rowHeader ? `<th scope="row">${cell}</th>` : `<td${headers[i]?.num ? ' class="num"' : ''}>${cell}</td>`)).join('')}</tr>`)
		.join('')}</tbody></table></div>`;

const FORMATS = [
	{format: 'long', heading: 'Long videos'},
	{format: 'short', heading: 'Shorts'},
] as const;

const videoName = (v: DashboardVideo): string => v.title || v.videoId;

/** A per-1K-views chart, one group per format, sorted high to low, the median video as reference. */
const rateChart = (videos: DashboardVideo[], amount: (v: DashboardVideo) => number | null, display: (value: number) => string, sub: (v: DashboardVideo) => string): string =>
	FORMATS.map(({format, heading}) => {
		const inFormat = videos.filter((v) => v.format === format);
		const rated = inFormat.map((v) => ({v, rate: per1k(amount(v), v.views)}));
		const items = rated
			.filter((r): r is {v: DashboardVideo; rate: number} => r.rate !== null)
			.sort((a, b) => b.rate - a.rate)
			.map(({v, rate}) => ({label: videoName(v), sublabel: sub(v), value: rate, display: display(rate)}));
		const mid = median(items.map((i) => i.value));
		return barGroup({
			heading,
			items,
			reference: mid === null ? null : {value: mid, label: `Median ${format === 'long' ? 'long video' : 'Short'}: ${display(mid)}`},
			missing: rated.filter((r) => r.rate === null).map((r) => videoName(r.v)),
		});
	}).join('\n');

export type PageInput = {
	brandName: string;
	channel: string;
	generatedAt: string; // ISO timestamp
	videos: DashboardVideo[];
	offers: OfferSummary[];
	unattributed: Unattributed;
	report: Report;
	recommendations: {videoCount: number; generatedAt: string; file: string} | null;
	nextMilestone: number;
	inputs: string[]; // one line per input that was loaded
	issues: Issue[];
	hubLoaded: boolean;
	payoutsLoaded: boolean;
};

export const renderDashboard = (input: PageInput): string => {
	const {videos} = input;
	const withViews = videos.filter((v) => v.views !== null && v.views > 0);
	const totalViews = withViews.reduce((n, v) => n + (v.views ?? 0), 0);
	const revenueKnown = videos.filter((v) => v.revenueUsd !== null);
	const totalRevenue = cents(revenueKnown.reduce((n, v) => n + (v.revenueUsd ?? 0), 0));
	const otherRevenue = formatMoney([...videos.flatMap((v) => v.affiliateRevenueOther), ...videos.flatMap((v) => (v.adRevenueOther ? [v.adRevenueOther] : []))]);
	const totalClicks = input.offers.reduce((n, o) => n + o.clicks, 0);
	const totalConversions = input.payoutsLoaded ? input.offers.reduce((n, o) => n + (o.conversions ?? 0), 0) : null;

	const kpi = (label: string, value: string, note = ''): string => `<div class="kpi"><dt>${esc(label)}</dt><dd>${esc(value)}${note ? `<small>${esc(note)}</small>` : ''}</dd></div>`;
	const kpis = [
		kpi('Videos with YouTube data', String(withViews.length), `${videos.length} known in total`),
		kpi('Views', compact(totalViews)),
		kpi('Hub clicks', input.hubLoaded ? compact(totalClicks) : '–', input.hubLoaded ? 'humans, once per visitor, offer and day' : 'no hub data loaded'),
		kpi('Conversions', totalConversions === null ? '–' : compact(totalConversions), totalConversions === null ? 'no payout file loaded' : 'from payout files'),
		kpi('Revenue (USD)', revenueKnown.length > 0 ? usd(totalRevenue) : '–', otherRevenue ? `plus ${otherRevenue} not converted` : 'YouTube estimate + affiliate payouts'),
	].join('');

	const revenueChart = rateChart(withViews, (v) => v.revenueUsd, (x) => usd(x), (v) => `${int(v.views)} views · ${usd(v.revenueUsd)}${v.affiliateRevenueOther.length || v.adRevenueOther ? ' + other currencies' : ''}`);
	const clicksChart = input.hubLoaded
		? rateChart(withViews, (v) => v.hubClicksYoutube, (x) => dec(x), (v) => `${int(v.views)} views · ${int(v.hubClicksYoutube)} clicks from YouTube`)
		: '<p class="muted">No hub data loaded. Pass --hub-db or --hub-csv.</p>';

	// CTR: long videos with 100+ views only (YouTube Help: CTR varies widely under 100 views; the Shorts feed has no thumbnail CTR).
	const ctrVideos = withViews.filter((v) => v.format === 'long' && v.ctr !== null && (v.views ?? 0) >= 100);
	const ctrMedian = median(ctrVideos.map((v) => v.ctr));
	const ctrItems = ctrVideos
		.sort((a, b) => (b.ctr ?? 0) - (a.ctr ?? 0))
		.map((v) => {
			const delta = ctrMedian === null || v.ctr === null ? null : (v.ctr - ctrMedian) * 100;
			const vs = delta === null ? '' : Math.abs(delta) < 0.05 ? 'at the median' : `${Math.abs(delta).toFixed(1)} pts ${delta > 0 ? 'above' : 'below'} the median`;
			return {label: videoName(v), sublabel: `${int(v.impressions)} impressions · ${vs}`, value: v.ctr ?? 0, display: pct(v.ctr)};
		});
	const ctrChart =
		ctrItems.length > 0
			? barGroup({heading: 'Long videos with 100+ views', items: ctrItems, reference: ctrMedian === null ? null : {value: ctrMedian, label: `Channel median: ${pct(ctrMedian)}`}, missing: []})
			: '<p class="muted">No click-through rates yet. They come only from the Studio CSV export (the Analytics API has no thumbnail CTR).</p>';

	// Retention, compared with the median of the same format.
	const retentionRows = FORMATS.flatMap(({format}) => {
		const group = withViews.filter((v) => v.format === format && (v.avgPercentViewed !== null || v.avgViewDurationSec !== null));
		const mid = median(group.map((v) => v.avgPercentViewed));
		return group
			.sort((a, b) => (b.avgPercentViewed ?? -1) - (a.avgPercentViewed ?? -1))
			.map((v) => {
				const delta = mid === null || v.avgPercentViewed === null ? null : (v.avgPercentViewed - mid) * 100;
				return [
					esc(videoName(v)),
					format === 'long' ? 'Long' : 'Short',
					esc(clock(v.avgViewDurationSec)),
					esc(pct(v.avgPercentViewed)),
					delta === null ? '–' : esc(`${delta > 0 ? '+' : delta < 0 ? '−' : ''}${Math.abs(delta).toFixed(1)} pts`),
					esc(int(v.views)),
				];
			});
	});

	const tableOf = (amount: (v: DashboardVideo) => number | null, label: string, show: (x: number | null) => string): string =>
		table(
			`${label}, table view`,
			[{label: 'Video'}, {label: 'Format'}, {label: 'Views', num: true}, {label: 'Amount', num: true}, {label: 'Per 1K views', num: true}],
			withViews.map((v) => [esc(videoName(v)), v.format === 'long' ? 'Long' : 'Short', esc(int(v.views)), esc(show(amount(v))), esc(show(per1k(amount(v), v.views)))]),
		);

	const offerRows = input.offers.map((o) => [
		esc(o.offerId),
		esc(int(o.clicks)),
		esc(o.conversions === null ? '–' : int(o.conversions)),
		esc(o.revenueUsd === null ? '–' : usd(o.revenueUsd)) + (o.revenueOther.length ? `<br><span class="small muted">+ ${esc(formatMoney(o.revenueOther))}</span>` : ''),
		esc(o.revenueUsd !== null && o.clicks > 0 ? usd(o.revenueUsd / o.clicks) : '–'),
		esc(o.requests !== null && o.blocked !== null && o.requests > 0 ? pct(o.blocked / o.requests, 0) : '–'),
	]);

	const unknown = [...input.unattributed.unknownVideoClicks].sort((a, b) => b[1] - a[1]);
	const unattributedLines: string[] = [];
	if (input.unattributed.noVideoClicks > 0) unattributedLines.push(`${int(input.unattributed.noVideoClicks)} hub click(s) came from links without a video id (?v=).`);
	if (unknown.length > 0)
		unattributedLines.push(`${int(unknown.reduce((n, [, c]) => n + c, 0))} hub click(s) carry ids that match no known video: ${unknown.slice(0, 8).map(([id, n]) => `${id} (${n})`).join(', ')}${unknown.length > 8 ? ', ...' : ''}. Add them as aliases in videos.csv.`);
	const np = input.unattributed.noVideoPayouts;
	if (np.conversions !== 0 || np.usd !== 0 || np.other.length > 0) unattributedLines.push(`Payouts without a video sub-id: ${np.conversions} conversion(s), ${usd(cents(np.usd))}${np.other.length ? ` + ${formatMoney(np.other)}` : ''}.`);
	const up = [...input.unattributed.unknownVideoPayouts];
	if (up.length > 0) unattributedLines.push(`Payouts for ids that match no known video: ${up.slice(0, 8).map(([id, m]) => `${id} (${usd(cents(m.usd))}${m.other.length ? ` + ${formatMoney(m.other)}` : ''})`).join(', ')}.`);

	const issueItems = input.issues.map((i) => `<li><span class="lvl">${esc(i.level)}</span>: ${esc(i.where)}: ${esc(i.message)}</li>`);
	const sample = input.report.sampleTooSmall
		? `<div class="warn"><p>With ${esc(input.report.videosWithData)} video(s) the sample is too small to conclude anything: the rules need at least 10 videos with YouTube data.</p></div>`
		: '';
	const recs = input.recommendations
		? `<p>Recommendations were last written at ${esc(input.recommendations.videoCount)} videos (${esc(input.recommendations.generatedAt.slice(0, 10))}): <a href="${esc(input.recommendations.file)}">recommendations.md</a>. The next update comes at ${esc(input.nextMilestone)} videos with data, or run the dashboard with --force.</p>`
		: `<p>Recommendations are written every 10 videos with YouTube data, starting at 10 (now ${esc(withViews.length)}). Run with --force to write them earlier.</p>`;

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex, nofollow">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${esc(input.brandName)} revenue dashboard</title>
<style>${CSS}</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site"><div class="wrap"><span class="brand">${esc(input.brandName)}</span><span>Revenue dashboard</span></div></header>
<main id="main" class="wrap">
<h1>Which videos earn</h1>
<p class="lede">Channel ${esc(input.channel)} · generated ${esc(input.generatedAt.replace('T', ' ').slice(0, 16))} UTC</p>
<div class="notice"><p>Revenue figures are estimates reported by YouTube and the affiliate networks, and they can change. They describe past results only and are not a forecast of future earnings.</p></div>
${withViews.length === 0 ? '<div class="warn"><p>No YouTube data loaded yet. Pass a Studio export with --studio, or use --api.</p></div>' : ''}
<section aria-labelledby="totals"><h2 id="totals" class="sr-only">Totals</h2><dl class="kpis">${kpis}</dl></section>

<section aria-labelledby="recs"><h2 id="recs">What to double down on</h2>${sample}${recs}</section>

<section aria-labelledby="rev"><h2 id="rev">Revenue per 1,000 views</h2>
<p class="small muted">YouTube estimated revenue plus affiliate payouts tied to the video, in USD, per 1,000 YouTube views. Each group has its own scale; the line marks the median video.</p>
<div class="card">${revenueChart || '<p class="muted">No revenue figures yet. Add revenue to the Studio export, use --api --api-revenue, or import payout files.</p>'}</div>
<details><summary>Show as a table</summary>${tableOf((v) => v.revenueUsd, 'Revenue (USD)', usd)}</details>
</section>

<section aria-labelledby="clk"><h2 id="clk">Hub clicks per 1,000 views</h2>
<p class="small muted">Clicks from YouTube links (s=yt or s=shorts, or no source) per 1,000 views. Each group has its own scale; the line marks the median video.</p>
<div class="card">${clicksChart}</div>
${input.hubLoaded ? `<details><summary>Show as a table</summary>${tableOf((v) => v.hubClicksYoutube, 'Hub clicks from YouTube', (x) => dec(x, x !== null && Number.isInteger(x) ? 0 : 2))}</details>` : ''}
</section>

<section aria-labelledby="ctr"><h2 id="ctr">Click-through rate vs the channel median</h2>
<p class="small muted">Thumbnail impressions click-through rate from the Studio export. Shorts are left out: most Shorts views come from the Shorts feed, where Studio shows no thumbnail CTR.</p>
<div class="card">${ctrChart}</div>
${ctrItems.length > 0 ? `<details><summary>Show as a table</summary>${table('Click-through rate, table view', [{label: 'Video'}, {label: 'Impressions', num: true}, {label: 'CTR', num: true}, {label: 'Median', num: true}], ctrVideos.map((v) => [esc(videoName(v)), esc(int(v.impressions)), esc(pct(v.ctr)), esc(pct(ctrMedian))]))}</details>` : ''}
</section>

<section aria-labelledby="ret"><h2 id="ret">Retention</h2>
${retentionRows.length > 0 ? table('Average view duration and percentage viewed, compared with the median of the same format', [{label: 'Video'}, {label: 'Format'}, {label: 'Avg view duration', num: true}, {label: 'Avg % viewed', num: true}, {label: 'vs format median', num: true}, {label: 'Views', num: true}], retentionRows) : '<p class="muted">No retention figures yet.</p>'}
</section>

<section aria-labelledby="off"><h2 id="off">Offers</h2>
${offerRows.length > 0 ? table('Clicks, conversions and revenue per offer', [{label: 'Offer'}, {label: 'Clicks', num: true}, {label: 'Conversions', num: true}, {label: 'Revenue (USD)', num: true}, {label: 'Per click', num: true}, {label: 'Blocked by region', num: true}], offerRows) : '<p class="muted">No offer clicks yet.</p>'}
<p class="small muted">Every affiliate or referral link must stay next to its disclosure. "Blocked by region" is the share of human requests to /go that the hub's region rules stopped.</p>
</section>

<section aria-labelledby="notes"><h2 id="notes">Data notes</h2>
<ul class="notes">${input.inputs.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>
${unattributedLines.length > 0 ? `<h3>Not tied to a video</h3><ul class="notes">${unattributedLines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
${issueItems.length > 0 ? `<details><summary>Warnings and notes from the import (${issueItems.length})</summary><ul class="notes">${issueItems.join('')}</ul></details>` : ''}
</section>
</main>
<footer class="site"><div class="wrap"><p>Files: <a href="metrics.csv">metrics.csv</a> (one row per video)${input.recommendations ? ` · <a href="${esc(input.recommendations.file)}">recommendations.md</a>` : ''}. Impressions and CTR come from the Studio export; the YouTube Analytics API does not provide them.</p></div></footer>
</body>
</html>
`;
};
