/**
 * Route module "studio": the video-service offer page and its order form.
 *
 *   GET  /studio         offer page (hero, what you get, process, packages, portfolio, FAQ, terms, form)
 *   POST /studio         rate-limit, drop honeypot hits quietly, validate, store, 303 to /studio/thanks
 *   GET  /studio/thanks  confirmation page
 *
 * Config: HubConfig.studio is the parsed config/studio.json (shape: ../studio/config.ts).
 * Env: NOTIFY_WEBHOOK_URL (optional) receives {id, packageId, ts, text} for each new order; never the
 * person's name, email or message. The order is stored and the visitor redirected before that call.
 */
import {randomUUID} from 'node:crypto';
import type {Ctx, Router} from '../http.ts';
import type {OrderRequest, Source} from '../../types.ts';
import {loadStudioConfig, type StudioConfig} from '../studio/config.ts';
import {notifyNewOrder, NOTIFY_TIMEOUT_MS} from '../studio/notify.ts';
import {createRateLimiter, type RateLimiter} from '../studio/rate-limit.ts';
import {findRecentDuplicate, insertOrder, recordStudioView} from '../studio/store.ts';
import {
	blankOrderForm,
	HONEYPOT_FIELD,
	isoDay,
	readOrderForm,
	validateOrderForm,
	type OrderFieldErrors,
	type OrderFormValues,
} from '../studio/validate.ts';
import {
	renderMessagePage,
	renderStudioPage,
	renderThanksPage,
	STUDIO_PATH,
	THANKS_PATH,
	type PageMeta,
} from '../studio/views.ts';

export type StudioDeps = {
	now: () => number;
	env: Record<string, string | undefined>;
	/** Local stand-in until security.ts exports the shared limiter (see ../studio/rate-limit.ts). */
	limiter: RateLimiter;
	fetch: typeof fetch;
	log: (line: string) => void;
	notifyTimeoutMs: number;
};

/** POST attempts per visitor (by visitorHash): generous enough for a few typos, tight for bots. */
export const STUDIO_RATE_LIMIT = {max: 6, windowMs: 15 * 60_000};
/** The same request from the same visitor inside this window is not stored twice (double submit). */
export const DUPLICATE_WINDOW_MS = 10 * 60_000;

const SOURCES: readonly Source[] = ['yt', 'shorts', 'tiktok', 'reels', 'x', 'email', 'bio', 'site', 'other'];
const VIDEO_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

const describe = (error: unknown): string => (error instanceof Error ? `${error.name}: ${error.message}` : String(error));

/** Parses config/studio.json once per config object and logs a bad config once, not per request. */
const studioConfigReader = (log: (line: string) => void) => {
	const parsed = new WeakMap<object, StudioConfig>();
	const rejected = new WeakSet<object>();
	let missingLogged = false;
	return (value: unknown): StudioConfig | null => {
		if (typeof value !== 'object' || value === null) {
			if (!missingLogged) log('[studio] no studio config: copy config/studio.example.json to config/studio.json');
			missingLogged = true;
			return null;
		}
		const cached = parsed.get(value);
		if (cached) return cached;
		if (rejected.has(value)) return null;
		try {
			const config = loadStudioConfig(value);
			parsed.set(value, config);
			return config;
		} catch (error) {
			rejected.add(value);
			log(`[studio] invalid studio config, page disabled: ${describe(error)}`);
			return null;
		}
	};
};

const pageMeta = (ctx: Ctx, now: number): PageMeta => ({
	brandName: ctx.config.brandName,
	contactEmail: ctx.config.contactEmail,
	publicBaseUrl: ctx.config.publicBaseUrl,
	year: isoDay(now).slice(0, 4),
});

const unavailable = (ctx: Ctx, now: number): void =>
	ctx.html(
		503,
		renderMessagePage(pageMeta(ctx, now), 'Studio page unavailable', 'The order form is not available right now. Please try again later.'),
	);

export const registerStudio = (router: Router, overrides: Partial<StudioDeps> = {}): void => {
	const deps: StudioDeps = {
		now: Date.now,
		env: process.env,
		limiter: createRateLimiter(STUDIO_RATE_LIMIT),
		fetch: globalThis.fetch,
		log: (line) => console.log(line),
		notifyTimeoutMs: NOTIFY_TIMEOUT_MS,
		...overrides,
	};
	const studioConfig = studioConfigReader(deps.log);

	router.get(STUDIO_PATH, (ctx) => {
		const now = deps.now();
		const config = studioConfig(ctx.config.studio);
		if (!config) return unavailable(ctx, now);
		const requested = ctx.url.searchParams.get('package') ?? '';
		// "Request this package" links reload the page with ?package=; count only arrivals as views.
		if (requested === '') recordView(ctx, now, deps.log);
		ctx.html(
			200,
			renderStudioPage({
				mode: 'full',
				meta: pageMeta(ctx, now),
				config,
				values: blankOrderForm(config, requested),
				errors: {},
				today: isoDay(now),
			}),
		);
	});

	router.post(STUDIO_PATH, async (ctx) => {
		const now = deps.now();
		const config = studioConfig(ctx.config.studio);
		if (!config) return unavailable(ctx, now);
		const form = await ctx.form();
		ctx.res.setHeader('Cache-Control', 'no-store');
		const meta = pageMeta(ctx, now);
		const showForm = (status: number, values: OrderFormValues, errors: OrderFieldErrors, notice?: string): void =>
			ctx.html(status, renderStudioPage({mode: 'form', meta, config, values, errors, notice, today: isoDay(now)}));
		const emailUs = meta.contactEmail ? `, or email us at ${meta.contactEmail}` : '';

		const limit = deps.limiter.take(ctx.visitorHash || 'unknown', now);
		if (!limit.allowed) {
			ctx.res.setHeader('Retry-After', String(Math.ceil(limit.retryAfterMs / 1000)));
			return showForm(429, readOrderForm(form), {}, `Too many attempts from your connection. Please wait a few minutes and send again${emailUs}.`);
		}

		// Bots that fill the hidden field get the normal "thanks" redirect and nothing is stored.
		if ((form.get(HONEYPOT_FIELD) ?? '') !== '') {
			deps.log('[studio] dropped a submission that filled the honeypot field');
			return ctx.redirect(303, THANKS_PATH);
		}

		const result = validateOrderForm(form, config, now);
		if (!result.ok) return showForm(400, result.values, result.errors);

		const order: OrderRequest = {
			...result.order,
			id: randomUUID(),
			ts: now,
			// A self-declared bot user agent is kept for review, not dropped: an order is never thrown away on a guess.
			status: ctx.isBot ? 'spam' : 'new',
		};
		try {
			const duplicateOf = findRecentDuplicate(ctx.db, order, ctx.visitorHash, now - DUPLICATE_WINDOW_MS);
			if (duplicateOf) {
				deps.log(`[studio] repeat of order ${duplicateOf} not stored again`);
				return ctx.redirect(303, THANKS_PATH);
			}
			insertOrder(ctx.db, order, ctx.visitorHash);
		} catch (error) {
			deps.log(`[studio] could not store an order: ${describe(error)}`);
			return showForm(500, result.values, {}, `We could not save your request just now. Please try again in a minute${emailUs}.`);
		}
		deps.log(`[studio] order ${order.id} stored (package ${order.packageId}, status ${order.status})`);
		ctx.redirect(303, THANKS_PATH);

		// After the response: the visitor never waits for the webhook, and a failure cannot lose the stored order.
		if (order.status === 'new') {
			await notifyNewOrder(
				{id: order.id, packageId: order.packageId, ts: order.ts},
				{webhookUrl: deps.env.NOTIFY_WEBHOOK_URL, timeoutMs: deps.notifyTimeoutMs, fetchImpl: deps.fetch, log: deps.log},
			);
		}
	});

	router.get(THANKS_PATH, (ctx) => ctx.html(200, renderThanksPage(pageMeta(ctx, deps.now()))));
};

/** page_events row for the dashboard. A logging failure never breaks the page. */
const recordView = (ctx: Ctx, now: number, log: (line: string) => void): void => {
	const source = ctx.url.searchParams.get('s') ?? '';
	const videoId = ctx.url.searchParams.get('v') ?? '';
	try {
		recordStudioView(ctx.db, {
			ts: now,
			source: (SOURCES as readonly string[]).includes(source) ? (source as Source) : null,
			videoId: VIDEO_ID.test(videoId) ? videoId : null,
			country: ctx.country,
			visitorHash: ctx.visitorHash,
			isBot: ctx.isBot,
		});
	} catch (error) {
		log(`[studio] could not record a page view: ${describe(error)}`);
	}
};

/** RouteModule entry point used by routes/index.ts. */
export const register = (router: Router): void => registerStudio(router);
