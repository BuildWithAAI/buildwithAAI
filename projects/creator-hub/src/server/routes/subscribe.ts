/**
 * Route module "subscribe": the email-list signup page for the owner's Kit (ConvertKit) list.
 *
 *   GET /subscribe?s=<source>&v=<video>  signup form. The browser posts email_address straight to Kit
 *                                       (config.kitFormAction); Kit runs double opt-in and unsubscribe.
 *   GET /subscribe/thanks                "check your inbox" page. Set it as the Kit form's after-signup
 *                                       redirect: it is same-origin, so the CSP form-action allows it.
 *
 * No email address ever reaches this server: the form's target is Kit and there is no POST route here.
 * Each view is logged to page_events ('subscribe' or 'subscribe-thanks') with the validated ?s= and ?v=
 * from the link, so the dashboard can see which videos and platforms bring sign-up visits.
 */
import {insertPageEvent} from '../db.ts';
import {esc, page} from '../html.ts';
import type {Ctx, Handler, Router} from '../http.ts';
import {parseSource, parseVideoId} from '../offers.ts';

export const SUBSCRIBE_PATH = '/subscribe';
export const SUBSCRIBE_THANKS_PATH = '/subscribe/thanks';

/** Shown right above the button and announced with the email field. Keep it word for word. */
export const CONSENT_TEXT =
	"You'll get new episodes and occasional recommendations. Some links are affiliate links and are always labelled. Unsubscribe any time.";

export const register = (router: Router): void => {
	router.get(SUBSCRIBE_PATH, signup);
	router.get(SUBSCRIBE_THANKS_PATH, thanks);
};

const logView = (ctx: Ctx, pageName: string): void =>
	insertPageEvent(ctx.db, {
		ts: Date.now(),
		page: pageName,
		source: parseSource(ctx.url.searchParams.get('s')),
		videoId: parseVideoId(ctx.url.searchParams.get('v')),
		country: ctx.country,
		visitorHash: ctx.visitorHash,
		isBot: ctx.isBot,
	});

const signup: Handler = (ctx) => {
	logView(ctx, 'subscribe');
	const brand = esc(ctx.config.brandName);
	ctx.html(
		200,
		page(ctx.config, {
			title: 'Newsletter',
			description: `Get new ${ctx.config.brandName} episodes by email: animated explainers on crypto security, memecoins and AI.`,
			body: `<h1>Get new episodes by email</h1>
<p class="lede">Animated explainers on crypto security, memecoins and AI from ${brand}, in your inbox.</p>
<div class="card">
<form method="post" action="${esc(ctx.config.kitFormAction)}" accept-charset="utf-8">
<div class="field">
<label for="email">Email address</label>
<input id="email" name="email_address" type="email" autocomplete="email" inputmode="email" autocapitalize="none" spellcheck="false" enterkeyhint="send" maxlength="254" required aria-describedby="consent">
</div>
<p id="consent">${esc(CONSENT_TEXT)}</p>
<button class="button" type="submit">Subscribe</button>
</form>
</div>
<h2>What happens next</h2>
<ol>
<li>Kit, our email provider, sends you an email with a link to confirm your address. Nothing else arrives until you confirm.</li>
<li>After that, you get new episodes and the occasional recommendation. Any link we earn from says so right next to it.</li>
<li>Every email has an unsubscribe link.</li>
</ol>
<p class="muted small">Your email address goes straight from your browser to Kit (kit.com). This site never receives or stores it. <a href="/privacy">Privacy</a> · <a href="/disclosures">How we make money</a></p>`,
		}),
	);
};

const thanks: Handler = (ctx) => {
	logView(ctx, 'subscribe-thanks');
	ctx.html(
		200,
		page(ctx.config, {
			title: 'Check your inbox',
			noindex: true,
			body: `<h1>Almost done: check your inbox</h1>
<p class="lede">If you just signed up, Kit, our email provider, has sent you an email with a link to confirm your address. Click it to finish.</p>
<p>Can't find it? Check your spam or promotions folder, or <a href="${SUBSCRIBE_PATH}">sign up again</a>.</p>
<div class="notice"><p>The confirmation email only asks you to click one link. It never asks for a password, a wallet connection or your seed phrase.</p></div>
<p><a href="/">See all links</a></p>`,
		}),
	);
};
