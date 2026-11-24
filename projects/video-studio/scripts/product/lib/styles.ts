/**
 * Print stylesheet for the product PDFs. Brand tokens only (src/characters/palette.ts BRAND, ART_GUIDE CV2's
 * background shadow, and CHART_SPEC's light-card neutral for secondary text): flat fills, near-black rules, one
 * radius scale (4 / 8 / 16 px, written in pt here), teal as a small accent only. No gradients, shadows, blur or
 * opacity tints (PROJECT_INSTRUCTIONS "Style and palette"; ART_GUIDE P1, CV1, CV5).
 *
 * Fonts are the project's bundled OFL fonts (@fontsource Montserrat and Inter), loaded from node_modules by file
 * URL, so a build never fetches anything. Chromium embeds subsets of them in the PDF.
 */
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';

export const TOKENS = {
	ink: '#0B0C0F',
	slate: '#161A21',
	silver: '#C9CED6',
	offWhite: '#F4F6F8',
	teal: '#29B8AD',
	stage: '#E6E8EB',
	stageShadow: '#CFD3D8',
	/** CHART_SPEC light-card neutral: 6.1:1 on white, used for secondary text and rules' labels. */
	muted: '#5B6470',
	/** CHART_SPEC slate-panel neutral, for secondary text on slate (5.9:1 on #161A21). */
	mutedOnSlate: '#8B949E',
	paper: '#FFFFFF',
} as const;

export type Paper = 'letter' | 'a4';
export const PAPER: Record<Paper, {css: string; widthIn: number; heightIn: number}> = {
	letter: {css: 'letter', widthIn: 8.5, heightIn: 11},
	a4: {css: 'A4', widthIn: 8.27, heightIn: 11.69},
};

type Face = {family: 'Inter' | 'Montserrat'; weight: number; style: 'normal' | 'italic'};
export const FACES: readonly Face[] = [
	{family: 'Inter', weight: 400, style: 'normal'},
	{family: 'Inter', weight: 400, style: 'italic'},
	{family: 'Inter', weight: 600, style: 'normal'},
	{family: 'Inter', weight: 600, style: 'italic'},
	{family: 'Inter', weight: 700, style: 'normal'},
	{family: 'Inter', weight: 800, style: 'normal'},
	{family: 'Montserrat', weight: 700, style: 'normal'},
	{family: 'Montserrat', weight: 800, style: 'normal'},
	{family: 'Montserrat', weight: 900, style: 'normal'},
];

export const fontFile = (projectRoot: string, f: Face): string =>
	join(projectRoot, 'node_modules', '@fontsource', f.family.toLowerCase(), 'files', `${f.family.toLowerCase()}-latin-${f.weight}-${f.style}.woff2`);

const fontFaces = (projectRoot: string): string =>
	FACES.map(
		(f) =>
			`@font-face{font-family:'${f.family}';font-style:${f.style};font-weight:${f.weight};font-display:block;src:url('${pathToFileURL(fontFile(projectRoot, f)).href}') format('woff2');}`,
	).join('\n');

/** A CSS string literal (for margin-box content). */
export const cssString = (s: string): string => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;

export type PageLabel = {name: string; label: string};

export type CssOptions = {
	projectRoot: string;
	paper: Paper;
	/** Footer text on every numbered page (left). */
	footer: string;
	/** Named pages with their running header (chapters). */
	pages: PageLabel[];
};

export const buildCss = (o: CssOptions): string => {
	const T = TOKENS;
	const P = PAPER[o.paper];
	const marginBox = `font-family:'Inter';font-weight:600;font-size:7.4pt;color:${T.muted};`;
	const named = o.pages
		.map((p) => `@page ${p.name}{@top-right{content:${cssString(p.label)};${marginBox}vertical-align:bottom;padding-bottom:10pt;}}`)
		.join('\n');
	return `${fontFaces(o.projectRoot)}
:root{--ink:${T.ink};--slate:${T.slate};--silver:${T.silver};--off:${T.offWhite};--teal:${T.teal};--stage:${T.stage};--stage-shadow:${T.stageShadow};--muted:${T.muted};--muted-slate:${T.mutedOnSlate};--paper:${T.paper};}
@page{size:${P.css};margin:0.8in 0.75in 0.75in 0.75in;
 @bottom-left{content:${cssString(o.footer)};${marginBox}vertical-align:top;padding-top:12pt;}
 @bottom-right{content:counter(page);font-family:'Montserrat';font-weight:800;font-size:8pt;color:${T.ink};vertical-align:top;padding-top:11pt;}}
@page cover{margin:0;@bottom-left{content:none;}@bottom-right{content:none;}}
@page bare{@bottom-left{content:none;}@bottom-right{content:none;}}
${named}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
body{margin:0;font-family:'Inter',sans-serif;font-size:9.1pt;line-height:1.42;color:var(--ink);background:var(--paper);font-kerning:normal;font-variant-ligatures:common-ligatures;text-rendering:geometricPrecision;}
p{margin:0 0 6pt;text-wrap:pretty;orphans:3;widows:3;}
strong{font-weight:700;}
em{font-style:italic;}
code{font-family:'Inter',sans-serif;font-weight:600;background:var(--off);border-radius:3pt;padding:0 2pt;}
.nowrap{white-space:nowrap;}
a{color:inherit;text-decoration:underline;text-decoration-color:var(--silver);text-decoration-thickness:0.8pt;text-underline-offset:2pt;}
sup.cite{font-size:0.6em;font-weight:700;color:var(--muted);vertical-align:super;line-height:0;margin-left:0.6pt;white-space:nowrap;}
sup.cite a{color:inherit;text-decoration:none;}
.cite-sep{padding:0 0.5pt;}
.icon{display:inline-block;vertical-align:-0.14em;flex:none;}

/* ------------------------------------------------------------------ cover (full edition) */
.cover{page:cover;position:relative;width:${P.widthIn}in;height:${P.heightIn}in;overflow:hidden;background:var(--stage);break-after:page;}
.cover .slats{position:absolute;left:0;right:0;top:0;height:2.15in;display:flex;justify-content:space-between;padding:0 0.55in;}
.cover .slat{width:0.5in;height:100%;background:var(--off);border-radius:0 0 8pt 8pt;}
.plate{background:var(--slate);color:var(--off);border-radius:8pt;padding:7pt 12pt 8pt;text-align:center;display:inline-block;}
.cover .plate{position:absolute;left:0.75in;top:0.62in;}
.plate .the,.plate .show{font-family:'Montserrat';font-weight:800;font-size:6.6pt;letter-spacing:0.32em;margin-right:-0.32em;color:var(--silver);line-height:1;}
.plate .main{font-family:'Montserrat';font-weight:900;font-size:14pt;line-height:1.05;margin:2.5pt 0;white-space:nowrap;}
.amp{color:var(--teal);}
.cover .title-block{position:absolute;left:0.75in;right:0.75in;top:2.55in;}
.cover .edition{display:inline-flex;align-items:center;gap:6pt;font-family:'Montserrat';font-weight:800;font-size:8.5pt;letter-spacing:0.14em;text-transform:uppercase;color:var(--ink);margin-bottom:12pt;}
.cover .edition .dot{width:7pt;height:7pt;border-radius:50%;background:var(--teal);}
.cover h1{font-family:'Montserrat';font-weight:900;font-size:46pt;line-height:0.98;letter-spacing:-0.015em;margin:0;color:var(--ink);max-width:6.2in;}
.cover .subtitle{font-family:'Inter';font-weight:600;font-size:13.5pt;line-height:1.38;margin:16pt 0 0;max-width:4.4in;color:var(--ink);}
.cover .byline{font-family:'Inter';font-weight:700;font-size:10.5pt;margin-top:12pt;color:var(--muted);}
.cover .floor{position:absolute;left:0;right:0;bottom:0;height:1.45in;background:var(--stage-shadow);}
.cover .art{position:absolute;right:0.7in;bottom:1.18in;}
.cover .art img{display:block;}
.cover .facts{position:absolute;left:0.75in;bottom:0.56in;right:0.75in;display:flex;flex-wrap:wrap;gap:6pt 14pt;font-family:'Inter';font-weight:600;font-size:8pt;color:var(--ink);}
.cover .facts span{display:inline-flex;align-items:center;gap:5pt;flex:none;white-space:nowrap;}

/* ------------------------------------------------------------------ front matter, TOC */
.front{break-before:page;}
.front.first{break-before:auto;}
.page-title{font-family:'Montserrat';font-weight:900;font-size:24pt;line-height:1.08;letter-spacing:-0.01em;margin:0 0 8pt;}
.page-lede{font-weight:600;font-size:11pt;line-height:1.45;margin:0 0 14pt;max-width:5.6in;}
h2{font-family:'Montserrat';font-weight:800;font-size:11pt;line-height:1.25;margin:9pt 0 2pt;break-after:avoid;display:flex;align-items:center;gap:7pt;}
h3{font-family:'Montserrat';font-weight:800;font-size:10.2pt;margin:10pt 0 4pt;break-after:avoid;}
.prio-mark{display:inline-flex;align-items:center;justify-content:center;width:15pt;height:15pt;border-radius:50%;flex:none;}
.prio-today .prio-mark{background:var(--slate);color:var(--off);}
.prio-week .prio-mark{background:var(--stage);color:var(--ink);}
.prio-habit .prio-mark{border:1.2pt solid var(--ink);color:var(--ink);box-sizing:border-box;}
ol.plain,ul.plain{margin:0 0 8pt;padding-left:16pt;}
ol.plain li,ul.plain li{margin:0 0 5pt;padding-left:2pt;}
ol.rules{list-style:none;counter-reset:r;padding:0;margin:0 0 6pt;}
ol.rules li{counter-increment:r;display:grid;grid-template-columns:22pt 1fr;gap:6pt;margin:0 0 8pt;break-inside:avoid;}
ol.rules li::before{content:counter(r);font-family:'Montserrat';font-weight:900;font-size:16pt;line-height:1;color:var(--teal);}
.toc{break-before:page;page:bare;}
.toc .page-title{margin-bottom:6pt;}
.toc-list{border-top:1.5pt solid var(--ink);}
.toc-entry{display:grid;grid-template-columns:27pt 20pt 1fr auto;align-items:center;column-gap:8pt;padding:3.4pt 2pt;border-bottom:0.6pt solid var(--stage-shadow);text-decoration:none;break-inside:avoid;}
.toc-num{font-family:'Montserrat';font-weight:900;font-size:13pt;color:var(--teal);}
.toc-icon{color:var(--ink);}
.toc-title{font-family:'Inter';font-weight:700;font-size:10pt;}
.toc-title small{display:block;font-weight:400;font-size:8pt;color:var(--muted);margin-top:0.5pt;}
.toc-page{font-family:'Montserrat';font-weight:800;font-size:10pt;font-variant-numeric:tabular-nums;min-width:20pt;text-align:right;}
.toc-group{font-family:'Montserrat';font-weight:800;font-size:7.2pt;letter-spacing:0.14em;text-transform:uppercase;color:var(--muted);margin:9pt 0 2pt;}

/* ------------------------------------------------------------------ chapters */
.chapter{break-before:page;}
.chapter-head{display:flex;align-items:flex-end;gap:16pt;margin:0 0 0;padding-bottom:8pt;border-bottom:1.5pt solid var(--ink);}
.chapter-head + h2,.chapter-head + .note,.chapter-head + .compare,.chapter-head + .ladder{margin-top:8pt;}
.chapter-titles{flex:1;min-width:0;}
.kicker{display:flex;align-items:center;gap:7pt;font-family:'Montserrat';font-weight:800;font-size:7.6pt;letter-spacing:0.14em;text-transform:uppercase;color:var(--muted);margin-bottom:4pt;}
.kicker .num{font-family:'Montserrat';font-weight:900;font-size:22pt;letter-spacing:-0.01em;line-height:0.9;color:var(--teal);}
.chapter h1,.appendix h1{font-family:'Montserrat';font-weight:900;font-size:20pt;line-height:1.06;letter-spacing:-0.01em;margin:0 0 5pt;}
.lede{font-weight:600;font-size:9.8pt;line-height:1.45;margin:0;text-wrap:pretty;}
.spot{flex:none;align-self:flex-end;margin-bottom:-9pt;}
.spot img{display:block;}
.chapter > p,.front > p{max-width:100%;}

/* ------------------------------------------------------------------ checklist */
ul.checklist{list-style:none;margin:0 0 4pt;padding:0;}
li.check{display:grid;grid-template-columns:12pt 1fr;column-gap:8pt;padding:3.1pt 0 3.5pt;border-bottom:0.6pt solid var(--stage);break-inside:avoid;}
li.check:last-child{border-bottom:none;}
.box{width:10pt;height:10pt;box-sizing:border-box;border:1.3pt solid var(--ink);border-radius:2.5pt;margin-top:1.4pt;background:var(--paper);}
.box.done{background:var(--ink);}
.check-text{text-wrap:pretty;}

/* ------------------------------------------------------------------ callouts */
.pair{display:grid;grid-template-columns:1fr 1fr;gap:10pt;margin-top:8pt;break-inside:avoid;}
.callout{border-radius:8pt;padding:7pt 10pt 8pt;break-inside:avoid;}
.callout p{margin:0;}
.callout-title{display:flex;align-items:center;gap:6pt;font-family:'Montserrat';font-weight:900;font-size:9.8pt;line-height:1.2;margin-bottom:3pt;}
.redflag{background:var(--slate);color:var(--off);}
.redflag .callout-title .icon{color:var(--silver);}
.redflag sup.cite{color:var(--muted-slate);}
.fix{background:var(--off);border:1.5pt solid var(--ink);}
.note{background:var(--off);border-radius:8pt;padding:8pt 11pt 8pt;margin:8pt 0 8pt;break-inside:avoid;}
.note-title{font-family:'Montserrat';font-weight:800;font-size:9.4pt;margin-bottom:4pt;display:flex;align-items:center;gap:6pt;}
.note p:last-child{margin-bottom:0;}
.steps{background:var(--off);border-radius:8pt;padding:8pt 11pt 4pt;margin:8pt 0;break-inside:avoid;}
.steps .note-title{margin-bottom:6pt;}
.steps ol{list-style:none;counter-reset:s;padding:0;margin:0;}
.steps li{counter-increment:s;display:grid;grid-template-columns:16pt 1fr;column-gap:8pt;margin:0 0 4pt;}
.steps li::before{content:counter(s);display:flex;align-items:center;justify-content:center;width:15pt;height:15pt;border-radius:50%;background:var(--slate);color:var(--off);font-family:'Montserrat';font-weight:900;font-size:8pt;margin-top:0.5pt;}
.upsell{border:1.5pt solid var(--ink);border-radius:8pt;padding:10pt 12pt;break-inside:avoid;}

/* ------------------------------------------------------------------ cards, ladder, compare, flow, fill */
.cards{display:grid;grid-template-columns:repeat(var(--cols,3),1fr);gap:8pt;margin:6pt 0 8pt;break-inside:avoid;}
.card{border:1.2pt solid var(--ink);border-radius:8pt;padding:7pt 9pt 8pt;background:var(--paper);}
.card-title{display:flex;align-items:center;gap:6pt;font-family:'Montserrat';font-weight:900;font-size:10.4pt;margin-bottom:4pt;}
.card p{margin:0;font-size:8.5pt;line-height:1.38;}
.ladder{border:1.2pt solid var(--ink);border-radius:8pt;margin:8pt 0 8pt;break-inside:avoid;overflow:hidden;}
.ladder-title{font-family:'Montserrat';font-weight:800;font-size:9pt;padding:6pt 11pt;background:var(--slate);color:var(--off);}
.rung{display:grid;grid-template-columns:62pt 1fr;column-gap:12pt;align-items:start;padding:5pt 11pt;border-top:0.6pt solid var(--stage-shadow);}
.rung:first-of-type{border-top:none;}
.meter{display:flex;flex-direction:column;gap:3pt;padding-top:2pt;}
.bars{display:flex;gap:2.5pt;}
.bars i{display:block;width:10pt;height:6pt;box-sizing:border-box;border:1pt solid var(--ink);border-radius:1.5pt;}
.bars i.on{background:var(--ink);}
.level{font-family:'Montserrat';font-weight:800;font-size:6.8pt;letter-spacing:0.12em;text-transform:uppercase;color:var(--muted);}
.rung p{margin:0;}
.compare{background:var(--off);border-radius:8pt;padding:8pt 11pt 7pt;margin:8pt 0 8pt;break-inside:avoid;}
.compare .note-title{margin-bottom:7pt;}
.addr-row{display:grid;grid-template-columns:58pt 1fr;align-items:center;margin:0 0 5pt;}
.addr-label{font-family:'Montserrat';font-weight:800;font-size:8.2pt;}
.addr{display:flex;gap:3pt;align-items:center;}
.addr .prefix{font-weight:600;font-size:8.6pt;color:var(--muted);width:12pt;}
.chunk{font-weight:600;font-size:8.6pt;font-variant-numeric:tabular-nums;width:30pt;text-align:center;padding:2pt 0;border-radius:3pt;border:1pt solid var(--stage-shadow);background:var(--paper);}
.chunk.same{background:var(--slate);border-color:var(--slate);color:var(--off);}
.compare .legend{font-size:7.8pt;color:var(--muted);margin-top:4pt;display:flex;align-items:center;gap:6pt;}
.legend .swatch{display:inline-block;width:14pt;height:8pt;border-radius:2pt;background:var(--slate);}
.flow{display:grid;grid-template-columns:repeat(var(--steps,4),1fr);column-gap:14pt;margin:6pt 0 8pt;break-inside:avoid;}
.flow-step{position:relative;border:1.2pt solid var(--ink);border-radius:8pt;padding:7pt 8pt 8pt;}
.flow-step .n{font-family:'Montserrat';font-weight:900;font-size:15pt;line-height:1;color:var(--teal);margin-bottom:4pt;}
.flow-step p{margin:0;font-size:8.3pt;line-height:1.36;}
.flow-step .arrow{position:absolute;right:-13pt;top:50%;margin-top:-6pt;color:var(--ink);}
.flow-title{font-family:'Montserrat';font-weight:800;font-size:9.2pt;margin:8pt 0 0;}
.fill{margin:6pt 0 14pt;}
.fill-line{display:grid;grid-template-columns:auto 1fr;column-gap:10pt;align-items:end;margin:0 0 15pt;}
.fill-line .label{font-weight:700;font-size:9.6pt;}
.fill-line .rule{border-bottom:1pt solid var(--ink);height:14pt;}

/* ------------------------------------------------------------------ tables */
table{width:100%;border-collapse:separate;border-spacing:0;font-size:8.3pt;line-height:1.34;margin:8pt 0 8pt;}
thead{display:table-header-group;}
thead th{background:var(--slate);color:var(--off);font-family:'Montserrat';font-weight:800;font-size:7.8pt;text-align:left;padding:6pt 7pt;vertical-align:bottom;}
thead th:first-child{border-top-left-radius:6pt;}
thead th:last-child{border-top-right-radius:6pt;}
tbody td{padding:4.5pt 7pt;vertical-align:top;border-bottom:0.6pt solid var(--stage-shadow);text-wrap:pretty;}
tbody tr:nth-child(even) td{background:var(--off);}
tbody tr{break-inside:avoid;}
table.keep{break-inside:avoid;}
table.blank tbody td{height:26pt;}
table.blank tbody tr:nth-child(even) td{background:var(--paper);}
td sup.cite{font-size:0.66em;}

/* ------------------------------------------------------------------ appendices and back matter */
.appendix,.back{break-before:page;}
.continue{break-before:auto !important;margin-top:20pt;}
.appendix .kicker .num{font-size:26pt;}
.sources-list{list-style:none;margin:4pt 0 0;padding:0;columns:2;column-gap:18pt;font-size:7.2pt;line-height:1.32;}
.src{display:grid;grid-template-columns:15pt 1fr;break-inside:avoid;margin:0 0 4.6pt;}
.src-n{font-family:'Montserrat';font-weight:900;font-size:7.6pt;color:var(--ink);}
.src-title{font-weight:700;}
.src-url{display:block;color:var(--muted);overflow-wrap:anywhere;text-decoration:none;}
.src-tag{color:var(--muted);font-style:italic;}
.about-grid{display:grid;grid-template-columns:1fr auto;gap:18pt;align-items:end;}
.cutout{border:1.5pt dashed var(--ink);border-radius:16pt;padding:6pt 16pt 4pt;margin-top:12pt;break-inside:avoid;}
.cutout .fill{margin-top:8pt;}
.cut-note{display:flex;align-items:center;gap:6pt;font-size:8pt;color:var(--muted);margin-top:6pt;}
.cards.stats .card{background:var(--off);border:none;}
.cards.stats .card-title{font-size:19pt;line-height:1.05;margin-bottom:3pt;color:var(--ink);}
.cards.stats .card p{font-size:8.4pt;color:var(--muted);font-weight:600;}
.colophon{margin-top:18pt;padding-top:8pt;border-top:0.6pt solid var(--stage-shadow);font-size:7.6pt;color:var(--muted);}

/* ------------------------------------------------------------------ free edition */
.free-head{display:grid;grid-template-columns:1fr auto;gap:12pt;align-items:end;background:var(--stage);border-radius:16pt;padding:14pt 18pt 0 18pt;margin:0 0 10pt;overflow:hidden;}
.free-head .plate{margin-bottom:9pt;padding:5pt 10pt 6pt;}
.free-head .plate .main{font-size:11.5pt;}
.free-head h1{font-family:'Montserrat';font-weight:900;font-size:26pt;line-height:1.02;letter-spacing:-0.01em;margin:0 0 5pt;}
.free-head .subtitle{font-weight:600;font-size:10.2pt;margin:0 0 5pt;}
.free-head .meta{font-size:7.6pt;color:var(--muted);margin:0 0 12pt;font-weight:600;}
.free-head .art{align-self:end;}
.free-head .art img{display:block;}
.free-page.next{break-before:page;}
.free-cols{columns:2;column-gap:14pt;column-fill:balance;}
.group,.free-box{break-inside:avoid;margin:0 0 9pt;display:block;}
.group{border:1.2pt solid var(--ink);border-radius:8pt;padding:7pt 10pt 3pt;}
.group h2{margin:0 0 1pt;font-size:10.4pt;}
.group li.check{padding:3.4pt 0 3.8pt;font-size:8.5pt;line-height:1.37;grid-template-columns:11pt 1fr;column-gap:7pt;}
.group .box{width:9.5pt;height:9.5pt;margin-top:1.1pt;}
.free-box .steps,.free-box .upsell,.free-box .note{margin:0;font-size:8.5pt;}
.free-box .upsell p{margin:0 0 4pt;}
.free-sources{margin-top:4pt;break-inside:avoid;border-top:1.2pt solid var(--ink);padding-top:4pt;}
.free-sources h3{margin:2pt 0 4pt;font-size:9pt;}
.free-sources .sources-list{font-size:6.6pt;line-height:1.32;columns:2;column-gap:14pt;margin:0;}
.free-sources .src{grid-template-columns:11pt 1fr;margin-bottom:2.6pt;}
.free-sources .src a{text-decoration:none;font-weight:700;}
.free-sources .src-n{font-size:6.6pt;}
.src-host{color:var(--muted);}
.src-note{font-size:6.6pt;color:var(--muted);margin:3pt 0 0;}
.free-legal{font-size:6.6pt;color:var(--muted);margin-top:4pt;}
`;
};
