import type {ClickOutcome, Offer, Source} from '../../types.ts';
import {countryName} from '../countries.ts';
import {insertClick} from '../db.ts';
import {headerValue} from '../geo.ts';
import {esc, offerCards, page} from '../html.ts';
import type {Ctx, Router} from '../http.ts';
import {
	availableAlternatives,
	destinationUrl,
	findOffer,
	isLive,
	isOfferId,
	parseSource,
	parseVideoId,
	regionDecision,
	type RegionDecision,
} from '../offers.ts';

/**
 * Route module "go": GET /go/:offer?v=<videoId>&s=<source>
 *
 * Every outcome is logged to clicks. Only registry URLs are ever redirect targets (no open redirect),
 * and the destination is never shown on the "ended" or "not available" pages.
 */
export const register = (router: Router): void => {
	router.get('/go/:offer', go);
};

/** Logged as offer_id for requests whose id is not even a valid slug. */
export const INVALID_OFFER_ID = '(invalid)';

const referrerHost = (value: string | null): string | null => {
	if (!value) return null;
	try {
		const host = new URL(value).hostname.toLowerCase();
		return /^[a-z0-9.-]{1,253}$/.test(host) ? host : null;
	} catch {
		return null;
	}
};

const bioLink = (videoId: string | null, source: Source | null): string => {
	const query = new URLSearchParams();
	if (videoId) query.set('v', videoId);
	if (source) query.set('s', source);
	const qs = query.toString();
	return qs ? `/?${qs}` : '/';
};

const alternativesSection = (ctx: Ctx, offer: Offer, videoId: string | null, source: Source | null, now: number): string => {
	const alternatives = availableAlternatives(ctx.config.offers, offer, ctx.country, now);
	if (alternatives.length === 0) return '';
	return `<h2>You could try instead</h2>\n${offerCards(alternatives, videoId, source)}`;
};

const blockedPage = (ctx: Ctx, offer: Offer, decision: RegionDecision, videoId: string | null, source: Source | null, now: number): string => {
	const reason = offer.restrictedReason ?? `${offer.name} is not available in every country, so this link is switched off here.`;
	const region =
		decision === 'blocked_unknown_region' || ctx.country === null
			? 'We could not confirm which country you are in. This link only works where we can confirm it is allowed, so it stays switched off.'
			: `Your region: ${countryName(ctx.country)}.`;
	return page(ctx.config, {
		title: 'Not available in your region',
		noindex: true,
		body: `<h1>Not available in your region</h1>
<p>${esc(reason)}</p>
<p class="muted">${esc(region)}</p>
${alternativesSection(ctx, offer, videoId, source, now)}
<p><a href="${esc(bioLink(videoId, source))}">See the links available to you</a></p>`,
	});
};

const endedPage = (ctx: Ctx, offer: Offer, videoId: string | null, source: Source | null, now: number): string =>
	page(ctx.config, {
		title: 'Offer ended',
		noindex: true,
		body: `<h1>This offer has ended</h1>
<p>The ${esc(offer.name)} link you followed is no longer active, so we no longer send visitors there.</p>
${alternativesSection(ctx, offer, videoId, source, now)}
<p><a href="${esc(bioLink(videoId, source))}">See all current links</a></p>`,
	});

const notFoundPage = (ctx: Ctx, videoId: string | null, source: Source | null): string =>
	page(ctx.config, {
		title: 'Link not found',
		noindex: true,
		body: `<h1>Link not found</h1>
<p>This link does not exist. It may have been mistyped.</p>
<p><a href="${esc(bioLink(videoId, source))}">See all current links</a></p>`,
	});

const go = (ctx: Ctx): void => {
	const id = (ctx.params.offer ?? '').toLowerCase(); // "/go/Wallet" typed on a phone still works
	const videoId = parseVideoId(ctx.url.searchParams.get('v'));
	const source = parseSource(ctx.url.searchParams.get('s'));
	const now = Date.now();
	const offer = isOfferId(id) ? findOffer(ctx.config.offers, id) : undefined;
	const log = (outcome: ClickOutcome): void =>
		insertClick(ctx.db, {
			ts: now,
			offerId: offer?.id ?? (isOfferId(id) ? id : INVALID_OFFER_ID),
			videoId,
			source,
			country: ctx.country,
			visitorHash: ctx.visitorHash,
			isBot: ctx.isBot,
			outcome,
			referrerHost: referrerHost(headerValue(ctx.req, 'referer')),
		});

	ctx.res.setHeader('X-Robots-Tag', 'noindex, nofollow');
	if (!offer) {
		log('not_found');
		ctx.html(404, notFoundPage(ctx, videoId, source));
		return;
	}
	if (!isLive(offer, now)) {
		log('inactive');
		ctx.html(410, endedPage(ctx, offer, videoId, source, now));
		return;
	}
	const decision = regionDecision(offer, ctx.country);
	if (decision !== 'allow') {
		log(decision);
		ctx.html(451, blockedPage(ctx, offer, decision, videoId, source, now));
		return;
	}
	log('redirected');
	ctx.redirect(302, destinationUrl(offer, videoId, source));
};
