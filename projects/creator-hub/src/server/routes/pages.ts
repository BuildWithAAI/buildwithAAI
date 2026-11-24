import type {Relationship} from '../../types.ts';
import {insertPageEvent, stmt} from '../db.ts';
import {CSS, CSS_PATH, esc, FAVICON_SVG, offerCards, page} from '../html.ts';
import type {Ctx, Handler, Router} from '../http.ts';
import {availableOffers, disclosureLines, isAvailable, isLive, parseSource, parseVideoId} from '../offers.ts';

/**
 * Route module "pages": GET / (link in bio), /disclosures, /privacy, /healthz, /robots.txt,
 * /favicon.svg and the shared stylesheet. Also exports the 404 page the core uses for unknown paths.
 */
export const register = (router: Router): void => {
	router.get('/', bio);
	router.get('/disclosures', disclosures);
	router.get('/privacy', privacy);
	router.get('/healthz', healthz);
	router.get('/robots.txt', (ctx) => sendText(ctx, 'text/plain; charset=utf-8', ROBOTS, 'public, max-age=86400'));
	router.get('/favicon.svg', (ctx) => sendText(ctx, 'image/svg+xml', FAVICON_SVG, 'public, max-age=86400'));
	router.get(CSS_PATH, (ctx) => sendText(ctx, 'text/css; charset=utf-8', CSS, 'public, max-age=31536000, immutable'));
};

const PRIVACY_UPDATED = '24 November 2026';
const ROBOTS = 'User-agent: *\nDisallow: /go/\nDisallow: /admin\n';

const RELATIONSHIP_PLAIN: Record<Relationship, string> = {
	affiliate: 'Affiliate: we may earn a commission when you buy or sign up through our link.',
	referral: 'Referral: we may earn a reward or a share of fees when you sign up through our link.',
	sponsor: 'Sponsor: this company pays us to feature it.',
	'own-product': 'Our own product: we own it and earn money from it.',
};

const sendText = (ctx: Ctx, type: string, body: string, cacheControl: string): void => {
	ctx.res.statusCode = 200;
	ctx.res.setHeader('Content-Type', type);
	ctx.res.setHeader('Cache-Control', cacheControl);
	ctx.res.setHeader('Content-Length', Buffer.byteLength(body));
	ctx.res.end(body);
};

const contactLine = (ctx: Ctx, lead: string): string =>
	ctx.config.contactEmail
		? `<p>${esc(lead)} <a href="mailto:${esc(ctx.config.contactEmail)}">${esc(ctx.config.contactEmail)}</a>.</p>`
		: '<p class="muted">A contact email address has not been published yet.</p>';

const bio: Handler = (ctx) => {
	const now = Date.now();
	const videoId = parseVideoId(ctx.url.searchParams.get('v'));
	const source = parseSource(ctx.url.searchParams.get('s'));
	insertPageEvent(ctx.db, {ts: now, page: 'bio', source, videoId, country: ctx.country, visitorHash: ctx.visitorHash, isBot: ctx.isBot});
	const {offers: registry, brandName} = ctx.config;
	const shown = availableOffers(registry, ctx.country, now);
	const hidden = registry.offers.filter((o) => isLive(o, now)).length - shown.length;
	const list = shown.length > 0 ? offerCards(shown, videoId, source ?? 'bio') : '<p>There are no partner links right now.</p>';
	ctx.html(
		200,
		page(ctx.config, {
			title: brandName,
			description: `Links from ${brandName}: animated explainers on crypto security, memecoins and AI.`,
			body: `<h1>${esc(brandName)}</h1>
<p class="lede">Animated explainers on crypto security, memecoins and AI.</p>
<div class="notice"><p><strong>Stay safe:</strong> ${esc(brandName)} will never DM you first, ask for your seed phrase or ask you to connect a wallet. Anyone who does is an impersonator.</p></div>
<h2 id="links">Links</h2>
<p class="muted small">Some of these are affiliate or referral links: each one says what we earn, right next to it. <a href="/disclosures">How we make money</a>.</p>
${list}
${hidden > 0 ? '<p class="muted small">Some links are only available in certain countries, so you may see fewer here.</p>' : ''}
<h2>More from ${esc(brandName)}</h2>
<ul class="links">
<li><a href="/studio">Explainer videos for crypto and AI projects: work with our studio</a></li>
<li><a href="/subscribe">Get the newsletter</a></li>
</ul>`,
		}),
	);
};

const disclosures: Handler = (ctx) => {
	const now = Date.now();
	const live = ctx.config.offers.offers.filter((o) => isLive(o, now));
	const items = live
		.map((offer) => {
			const here = isAvailable(offer, ctx.country, now);
			const detail = here
				? `<p class="disclosure">${disclosureLines(offer).map((line) => `<span>${esc(line)}</span>`).join('')}</p>`
				: '<p class="disclosure">Not shown in your region.</p>';
			return `<li class="card"><h3>${esc(offer.name)}</h3>\n<p>${esc(RELATIONSHIP_PLAIN[offer.relationship])}</p>\n${detail}</li>`;
		})
		.join('\n');
	const brand = esc(ctx.config.brandName);
	ctx.html(
		200,
		page(ctx.config, {
			title: 'Disclosures',
			description: `How ${ctx.config.brandName} makes money, in plain language.`,
			body: `<h1>Disclosures</h1>
<p class="lede">How ${brand} makes money, in plain language.</p>
<h2>Affiliate and referral links</h2>
<p>Some links in our videos, video descriptions, posts, emails and on this site are affiliate or referral links. If you buy or sign up through one, we may earn a commission or a share of fees. It costs you nothing extra unless the link says otherwise. We say so right next to every such link, and in videos we say it out loud and show it on screen.</p>
<h2>Current relationships</h2>
${live.length > 0 ? `<ul class="cards">\n${items}\n</ul>` : '<p>We have no active affiliate, referral or sponsor relationships right now.</p>'}
<h2>Sponsorships</h2>
<p>If a company pays us, or gives us anything of value, to feature it, we say so clearly in the video and in its description.</p>
<h2>Our own products</h2>
<p>The <a href="/studio">video studio</a> is our own service. When we mention it, we are promoting our own business.</p>
<h2>Regional restrictions</h2>
<p>Some offers, such as crypto exchanges, are not available in every country, or may not be promoted there. Our link hub hides those offers in those countries, and also whenever it cannot tell which country you are in.</p>
<h2>Not financial advice</h2>
<p>Our videos and links are for education. Nothing here is financial, investment, tax or legal advice. Crypto assets are high risk: prices can fall to zero and scams are common.</p>
${contactLine(ctx, 'Questions about a link? Email')}`,
		}),
	);
};

const privacy: Handler = (ctx) => {
	const base = esc(ctx.config.publicBaseUrl);
	ctx.html(
		200,
		page(ctx.config, {
			title: 'Privacy',
			description: 'What this site records, why, and for how long.',
			body: `<h1>Privacy</h1>
<p class="lede">What this site records, why, and for how long. Last updated ${PRIVACY_UPDATED}.</p>
<h2>Link clicks</h2>
<p>When you open a link that starts with ${base}/go/, we record:</p>
<ul>
<li>the time, and which offer the link is for;</li>
<li>the video and platform the link came from (the <code>v=</code> and <code>s=</code> parts of the link);</li>
<li>your country, when our network provider reports it (never your city or precise location);</li>
<li>the name of the website you came from, such as www.youtube.com, when your browser shares it;</li>
<li>whether the visit looked automated, and what happened: sent on, not available in your region, offer ended, or unknown link;</li>
<li>a visitor code: a one-way hash of your IP address and browser name, mixed with a secret that changes every day. It only lets us count each visitor once per day. We never store your IP address, and codes from different days cannot be matched.</li>
</ul>
<p>Links on /go set no cookies, and this site uses no tracking cookies, analytics scripts or ad pixels. Forms may use a short-lived security cookie to block forged submissions. Once you are sent on, the site you visit has its own privacy policy.</p>
<h2>Page visits</h2>
<p>For pages on this site we record the same kind of information (time, page, platform and video from the link, country, the automated-visit flag and the daily visitor code), so we can see which videos bring visitors.</p>
<h2>Video-service requests</h2>
<p>If you send a request through the <a href="/studio">studio order form</a>, we store what you enter (name, email, company, project link, package, budget, deadline, message and your consent) with the daily visitor code. We use it to reply to you and manage your request, and we do not sell it.</p>
<h2>Email newsletter</h2>
<p>Newsletter sign-ups are handled by Kit (kit.com), our email provider. Your email address goes to Kit, Kit's privacy policy applies, and every email has an unsubscribe link.</p>
<h2>How long we keep it</h2>
<p>Click records, page-visit records and video-service requests are deleted automatically after 13 months. A request that becomes a client project is kept as a business record.</p>
<h2>Who can see it</h2>
<p>Only the site owner, through a password-protected admin page. Our hosting and network providers process IP addresses to deliver the site, under their own policies.</p>
<h2>Your choices</h2>
<p>You can ask for a copy of your video-service request, or ask us to correct or delete it. Click and visit records contain no name, email or IP address, so we cannot look up one person's clicks.</p>
${contactLine(ctx, 'To make a request, email')}`,
		}),
	);
};

const healthz: Handler = (ctx) => {
	stmt(ctx.db, 'SELECT 1').get();
	ctx.json(200, {ok: true});
};

/** 404 page; the core calls it for paths no module registered. */
export const notFound: Handler = (ctx) => {
	ctx.html(
		404,
		page(ctx.config, {
			title: 'Page not found',
			noindex: true,
			body: '<h1>Page not found</h1>\n<p>There is nothing at this address.</p>\n<p><a href="/">See all links</a></p>',
		}),
	);
};
