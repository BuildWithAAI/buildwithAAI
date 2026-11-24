/**
 * Page shell, shared stylesheet and escaping for the hub's own pages.
 * Every dynamic value goes through esc(); markup passed as `body` must already be built with esc().
 */
import {createHash} from 'node:crypto';
import type {Offer, Source} from '../types.ts';
import type {HubConfig} from './http.ts';
import {disclosureLines, hubPath, RELATIONSHIP_LABEL} from './offers.ts';

const ESCAPES: Record<string, string> = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'};

/** Escapes text for HTML element content and quoted attribute values. */
export const esc = (value: unknown): string =>
	(value === null || value === undefined ? '' : String(value)).replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);

/** Brand: near-black #0B0C0F, off-white #F4F6F8, slate #161A21, teal accent #29B8AD. All text pairs pass WCAG AA. */
export const CSS = `:root{--ink:#0B0C0F;--paper:#F4F6F8;--slate:#161A21;--teal:#29B8AD;--bg:var(--paper);--text:var(--ink);--muted:#4A5260;--surface:#FFFFFF;--line:#D9DEE5;--control:#6B7382;--focus:var(--ink);--warn-bg:#FFF4E0;--warn-text:#7A4A00;--ok-bg:#E3F5F3;--ok-text:#0F5C55;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:var(--ink);--text:var(--paper);--muted:#AEB6C2;--surface:var(--slate);--line:#2B313C;--control:#7C8594;--focus:var(--teal);--warn-bg:#2A2112;--warn-text:#FFD9A0;--ok-bg:#10302D;--ok-text:#8FE3DA}}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;min-height:100vh;display:flex;flex-direction:column;background:var(--bg);color:var(--text);font:1rem/1.6 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans",sans-serif;overflow-wrap:anywhere}
.wrap{width:min(100% - 2rem,46rem);margin-inline:auto}
body.wide .wrap{width:min(100% - 2rem,72rem)}
.skip{position:absolute;left:-10000px;top:0;background:var(--teal);color:var(--ink);padding:.5rem 1rem;z-index:10}
.skip:focus{left:1rem;top:1rem}
header.site{background:var(--ink);color:var(--paper);border-bottom:3px solid var(--teal)}
header.site .wrap{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.5rem 1.25rem;padding:.85rem 0}
header.site a{color:var(--paper)}
header.site :focus-visible{outline-color:var(--teal)}
.brand{font-weight:700;letter-spacing:.02em;text-decoration:none;display:inline-flex;align-items:center;gap:.5rem}
.brand::before{content:"";width:.7rem;height:.7rem;border-radius:50%;background:var(--teal)}
nav{display:flex;flex-wrap:wrap;gap:.25rem 1.1rem}
main{flex:1;padding:2rem 0 3rem}
h1{font-size:clamp(1.7rem,5vw,2.3rem);line-height:1.15;letter-spacing:-.01em;margin:0 0 .6rem}
h2{font-size:1.2rem;line-height:1.3;margin:2.25rem 0 .75rem}
h3{font-size:1.05rem;line-height:1.35;margin:0 0 .35rem}
p{margin:.5rem 0 1rem}
a{color:inherit;text-decoration-color:var(--teal);text-decoration-thickness:2px;text-underline-offset:3px}
a:hover{text-decoration-thickness:3px}
:focus-visible{outline:3px solid var(--focus);outline-offset:3px;border-radius:4px}
.lede{color:var(--muted);font-size:1.075rem;margin-top:0}
.muted{color:var(--muted)}
.small{font-size:.9rem}
.notice{background:var(--surface);border:1px solid var(--line);border-left:4px solid var(--teal);border-radius:0 12px 12px 0;padding:.8rem 1rem;margin:1.25rem 0}
.notice p{margin:0}
.warn{background:var(--warn-bg);color:var(--warn-text);border-radius:12px;padding:.8rem 1rem}
.ok{background:var(--ok-bg);color:var(--ok-text);border-radius:12px;padding:.8rem 1rem}
.cards{list-style:none;padding:0;margin:0;display:grid;gap:.85rem}
.card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:1rem 1.1rem}
.card-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:.25rem .75rem}
.tag{display:inline-block;font-size:.75rem;font-weight:650;letter-spacing:.05em;text-transform:uppercase;border:1px solid var(--control);border-radius:999px;padding:.05rem .55rem;color:var(--muted)}
.disclosure{font-size:.92rem;color:var(--muted);margin:.35rem 0 .8rem}
.disclosure span{display:block}
.button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:.6rem 1.1rem;border:0;border-radius:10px;background:var(--teal);color:var(--ink);font:inherit;font-weight:650;text-decoration:none;cursor:pointer}
.button:hover{background:#3FC6BB}
.links{display:grid;gap:.6rem;padding:0;list-style:none}
.links a{font-weight:600}
footer.site{border-top:1px solid var(--line);padding:1.25rem 0 2rem;color:var(--muted);font-size:.9rem}
footer.site p{margin:.5rem 0 0}
.table-wrap{overflow-x:auto;margin:0 0 1rem;border:1px solid var(--line);border-radius:12px;background:var(--surface)}
table{width:100%;border-collapse:collapse;font-size:.92rem;overflow-wrap:normal}
caption{text-align:left;font-weight:650;padding:.65rem .75rem}
th,td{text-align:left;padding:.5rem .75rem;border-top:1px solid var(--line);vertical-align:top}
th{font-weight:650}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
form.inline{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}
.field{display:grid;gap:.3rem;margin:0 0 .9rem}
label{font-weight:600}
input,select,textarea{font:inherit;color:var(--text);background:var(--bg);border:1px solid var(--control);border-radius:8px;padding:.45rem .65rem;min-height:44px;max-width:100%}
textarea{width:100%;min-height:14rem;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.85rem;line-height:1.5}
details summary{cursor:pointer}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
`;

export const CSS_PATH = '/assets/hub.css';
export const CSS_HREF = `${CSS_PATH}?v=${createHash('sha256').update(CSS).digest('hex').slice(0, 10)}`;

export const FAVICON_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0B0C0F"/>' +
	'<circle cx="16" cy="16" r="7" fill="#29B8AD"/></svg>';

export type PageOptions = {
	title: string; // plain text
	body: string; // HTML built with esc()
	description?: string; // plain text
	noindex?: boolean;
	nav?: 'public' | 'admin';
	wide?: boolean;
};

const PUBLIC_NAV = '<a href="/">Links</a><a href="/studio">Studio</a><a href="/subscribe">Newsletter</a>';
const ADMIN_NAV = '<a href="/admin">Overview</a><a href="/admin/links">Link builder</a><a href="/">Public site</a>';

export const page = (config: HubConfig, options: PageOptions): string => {
	const title = options.title === config.brandName ? config.brandName : `${options.title} · ${config.brandName}`;
	const contact = config.contactEmail
		? `<a href="mailto:${esc(config.contactEmail)}">${esc(config.contactEmail)}</a>`
		: '';
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
${options.description ? `<meta name="description" content="${esc(options.description)}">\n` : ''}${options.noindex ? '<meta name="robots" content="noindex, nofollow">\n' : ''}<meta name="color-scheme" content="light dark">
<meta name="referrer" content="strict-origin-when-cross-origin">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${CSS_HREF}">
</head>
<body${options.wide ? ' class="wide"' : ''}>
<a class="skip" href="#main">Skip to content</a>
<header class="site"><div class="wrap">
<a class="brand" href="/">${esc(config.brandName)}</a>
<nav aria-label="Main">${options.nav === 'admin' ? ADMIN_NAV : PUBLIC_NAV}</nav>
</div></header>
<main id="main"><div class="wrap">
${options.body}
</div></main>
<footer class="site"><div class="wrap">
<nav aria-label="Legal"><a href="/disclosures">Disclosures</a><a href="/privacy">Privacy</a>${contact}</nav>
<p>Educational content, not financial advice. ${esc(config.brandName)} will never DM you first or ask for your seed phrase.</p>
</div></footer>
</body>
</html>
`;
};

/**
 * Offer cards: name, relationship tag, the disclosure directly above the link (tied to it with
 * aria-describedby) and a hub link that carries the video and source attribution.
 */
export const offerCards = (offers: Offer[], videoId: string | null, source: Source | null): string =>
	`<ul class="cards">\n${offers
		.map((offer) => {
			const id = `disclosure-${offer.id}`;
			const lines = disclosureLines(offer).map((line) => `<span>${esc(line)}</span>`).join('');
			return `<li class="card">
<div class="card-head"><h3>${esc(offer.name)}</h3><span class="tag">${esc(RELATIONSHIP_LABEL[offer.relationship])}</span></div>
<p class="disclosure" id="${esc(id)}">${lines}</p>
<a class="button" href="${esc(hubPath(offer.id, videoId, source))}" aria-describedby="${esc(id)}">Visit ${esc(offer.name)}</a>
</li>`;
		})
		.join('\n')}\n</ul>`;

export const errorPage = (config: HubConfig, status: number, title: string, message: string): string =>
	page(config, {
		title,
		noindex: true,
		body: `<h1>${esc(title)}</h1>\n<p>${esc(message)}</p>\n<p><a href="/">Back to all links</a></p>\n<p class="muted small">Error ${esc(status)}</p>`,
	});
