import {createHmac, randomBytes} from 'node:crypto';
import type {ServerResponse} from 'node:http';
import type {DatabaseSync, SQLOutputValue} from 'node:sqlite';
import type {Offer, OrderRequest, Source} from '../../types.ts';
import {checkCredentials, csrfToken, newCsrfNonce, parseBasicAuth, readCookie, validCsrf} from '../auth.ts';
import {stmt} from '../db.ts';
import {HttpError} from '../errors.ts';
import {headerValue} from '../geo.ts';
import {errorPage, esc, page} from '../html.ts';
import type {Ctx, Handler, Router} from '../http.ts';
import {
	disclosureLines,
	expiresAtMs,
	hubPath,
	isLive,
	isRestricted,
	parseSource,
	parseVideoId,
	restrictedOfferLines,
	SOURCES,
	topDisclosure,
} from '../offers.ts';
import {createRateLimiter, rateLimitKey, type RateLimiter} from '../security.ts';

/**
 * Route module "admin": the owner's dashboard behind HTTP Basic auth.
 *   GET  /admin                           clicks by offer, video and source (7/30 days), page views, orders
 *   GET  /admin/links                     link builder: tracked links with their disclosures, offer registry
 *   POST /admin/orders/:id/status         change an order's status (CSRF token + SameSite cookie)
 *   GET  /admin/export/clicks.csv         raw click log      (?days=N limits the range)
 *   GET  /admin/export/video-clicks.csv   de-duplicated human clicks per video, offer and source
 *   GET  /admin/export/orders.csv         order requests
 * Counts are humans only, outcome "redirected", de-duplicated by visitor hash per offer per UTC day
 * (the first click of the day keeps its video and source).
 */
export const register = (router: Router): void => {
	const state = createSignInState();
	const admin = (handler: AdminHandler): Handler => (ctx) => guard(ctx, state, handler);
	router.get('/admin', admin(overview));
	router.get('/admin/links', admin(linkBuilder));
	router.post('/admin/orders/:id/status', admin(updateStatus));
	router.get('/admin/export/clicks.csv', admin(exportClicks));
	router.get('/admin/export/video-clicks.csv', admin(exportVideoClicks));
	router.get('/admin/export/orders.csv', admin(exportOrders));
};

type AdminHandler = (ctx: Ctx, csrf: string) => void | Promise<void>;

const DAY_MS = 86_400_000;
const ORDER_STATUSES: readonly OrderRequest['status'][] = ['new', 'contacted', 'won', 'lost', 'spam'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------------------------
// Authentication and CSRF

const cookieName = (ctx: Ctx): string => (ctx.config.publicBaseUrl.startsWith('https:') ? '__Host-hub_csrf' : 'hub_csrf');

const sameOrigin = (ctx: Ctx): boolean => {
	const origin = headerValue(ctx.req, 'origin');
	if (origin !== null && origin !== new URL(ctx.config.publicBaseUrl).origin) return false;
	const site = headerValue(ctx.req, 'sec-fetch-site');
	return site === null || site === 'same-origin' || site === 'none';
};

/** Sign-in failures allowed per client: 10, then one more every 90 seconds. */
export const CLIENT_FAILURES = {capacity: 10, refillPerSecond: 10 / (15 * 60)};
/** Sign-in failures allowed from all clients together: 50 an hour. Beyond that admin locks for everyone. */
export const GLOBAL_FAILURES = {capacity: 50, refillPerSecond: 50 / 3600};
/** Password checks (scrypt, 32 MiB each) allowed at the same time; more get 429 before any hashing. */
export const MAX_PASSWORD_CHECKS = 2;
/** How long a verified Authorization header is trusted without running scrypt again. */
const VERIFIED_TTL_MS = 10 * 60_000;
const VERIFIED_MAX = 8;
const ALL = 'all';

type SignInState = {
	failures: RateLimiter;
	globalFailures: RateLimiter;
	inFlight: number;
	lockLogged: boolean;
	/** HMAC(per-process key, Authorization header) -> expiry, for headers whose password check passed. */
	verified: Map<string, number>;
	verifiedKey: Buffer;
};

const createSignInState = (): SignInState => ({
	failures: createRateLimiter(CLIENT_FAILURES),
	globalFailures: createRateLimiter(GLOBAL_FAILURES),
	inFlight: 0,
	lockLogged: false,
	verified: new Map(),
	verifiedKey: randomBytes(32),
});

const tooMany = (ctx: Ctx, retryAfter: number, title: string, message: string): void => {
	ctx.res.setHeader('Retry-After', String(Math.max(1, Math.ceil(retryAfter))));
	ctx.html(429, errorPage(ctx.config, 429, title, message));
};

/**
 * Checks Basic credentials with the brute-force limits applied BEFORE any hashing: the failure tokens are
 * taken first and given back only when the password is right, so concurrent guesses cannot all slip past
 * a check that has not finished yet. A header that passed recently is trusted for 10 minutes, so ordinary
 * admin browsing does not run scrypt on every request. Returns true when the credentials are right, false
 * when they are wrong (the caller answers 401), and 'answered' when a 429 has already been sent.
 */
const verifySignIn = async (ctx: Ctx, state: SignInState, header: string, credentials: {user: string; password: string}): Promise<boolean | 'answered'> => {
	const {adminUser, adminPasswordHash} = ctx.config;
	const now = Date.now();
	const cacheKey = createHmac('sha256', state.verifiedKey).update(`${adminPasswordHash}\n${header}`).digest('hex');
	const until = state.verified.get(cacheKey);
	if (until !== undefined && until > now) return true;
	if (until !== undefined) state.verified.delete(cacheKey);

	if (state.inFlight >= MAX_PASSWORD_CHECKS) {
		tooMany(ctx, 1, 'Sign-in is busy', 'Another sign-in is being checked. Try again in a moment.');
		return 'answered';
	}
	const key = rateLimitKey(ctx);
	if (!state.failures.take(key)) {
		tooMany(ctx, state.failures.retryAfter(key), 'Too many failed sign-ins', 'Wait a few minutes, then try again.');
		return 'answered';
	}
	if (!state.globalFailures.take(ALL)) {
		state.failures.refund(key);
		if (!state.lockLogged) {
			console.warn(`[hub] admin sign-in locked: more than ${GLOBAL_FAILURES.capacity} failed sign-ins within an hour from all clients together`);
			state.lockLogged = true;
		}
		tooMany(ctx, state.globalFailures.retryAfter(ALL), 'Sign-in is locked', 'There were too many failed sign-ins. Try again later.');
		return 'answered';
	}
	state.lockLogged = false; // the lock (if any) is over: log the next one again
	state.inFlight++;
	let ok = false;
	try {
		ok = await checkCredentials(credentials, adminUser, adminPasswordHash);
	} finally {
		state.inFlight--;
	}
	if (!ok) return false;
	state.failures.refund(key);
	state.globalFailures.refund(ALL);
	if (state.verified.size >= VERIFIED_MAX) state.verified.delete(state.verified.keys().next().value ?? '');
	state.verified.set(cacheKey, now + VERIFIED_TTL_MS);
	return true;
};

const guard = async (ctx: Ctx, state: SignInState, handler: AdminHandler): Promise<void> => {
	ctx.res.setHeader('Cache-Control', 'no-store');
	ctx.res.setHeader('X-Robots-Tag', 'noindex, nofollow');
	const {adminUser, adminPasswordHash, hashSecret} = ctx.config;
	if (!adminUser || !adminPasswordHash) {
		ctx.html(503, errorPage(ctx.config, 503, 'Admin is switched off', 'Set ADMIN_USER and ADMIN_PASSWORD_HASH to turn it on.'));
		return;
	}
	const header = headerValue(ctx.req, 'authorization') ?? '';
	const credentials = parseBasicAuth(header || undefined);
	if (credentials) {
		const result = await verifySignIn(ctx, state, header, credentials);
		if (result === 'answered') return;
		if (result) {
			const name = cookieName(ctx);
			let nonce = readCookie(ctx.req.headers.cookie, name);
			if (ctx.req.method === 'POST') {
				const form = await ctx.form();
				if (!sameOrigin(ctx) || !validCsrf(hashSecret, nonce, form.get('csrf'))) {
					ctx.html(403, errorPage(ctx.config, 403, 'Form expired', 'Reload the admin page and try again.'));
					return;
				}
			} else if (!nonce || !/^[0-9a-f]{64}$/.test(nonce)) {
				nonce = newCsrfNonce();
				const secure = name.startsWith('__Host-') ? '; Secure' : '';
				ctx.res.setHeader('Set-Cookie', `${name}=${nonce}; Path=/; HttpOnly; SameSite=Strict${secure}`);
			}
			await handler(ctx, csrfToken(hashSecret, nonce ?? ''));
			return;
		}
	}
	ctx.res.setHeader('WWW-Authenticate', 'Basic realm="Creator hub admin", charset="UTF-8"');
	ctx.html(401, errorPage(ctx.config, 401, 'Sign-in required', 'This page is for the site owner.'));
};

// ---------------------------------------------------------------------------------------------
// Reports

type Row = Record<string, SQLOutputValue>;
type WindowRow = {key: string | null; d7: number; d30: number};

/** First human redirect per offer, visitor and UTC day; video_id and source come from that first click. */
const FIRST_CLICKS = `SELECT offer_id, video_id, source, MIN(ts) AS ts FROM clicks
	WHERE ts >= ? AND is_bot = 0 AND outcome = 'redirected'
	GROUP BY offer_id, visitor_hash, ts / 86400000`;

const CLICK_COUNTS = {
	offer_id: `SELECT offer_id AS k, COUNT(*) AS n FROM (${FIRST_CLICKS}) GROUP BY k ORDER BY n DESC LIMIT 100`,
	video_id: `SELECT video_id AS k, COUNT(*) AS n FROM (${FIRST_CLICKS}) GROUP BY k ORDER BY n DESC LIMIT 100`,
	source: `SELECT source AS k, COUNT(*) AS n FROM (${FIRST_CLICKS}) GROUP BY k ORDER BY n DESC LIMIT 100`,
};

const PAGE_COUNTS = `SELECT page AS k, COUNT(*) AS n FROM (
	SELECT page, MIN(ts) AS ts FROM page_events WHERE ts >= ? AND is_bot = 0 GROUP BY page, visitor_hash, ts / 86400000
) GROUP BY k ORDER BY n DESC LIMIT 100`;

const countMap = (db: DatabaseSync, sql: string, since: number): Map<string | null, number> =>
	new Map(stmt(db, sql).all(since).map((row) => [row.k === null ? null : String(row.k), Number(row.n)]));

const windowCounts = (db: DatabaseSync, sql: string, now: number): WindowRow[] => {
	const last7 = countMap(db, sql, now - 7 * DAY_MS);
	const last30 = countMap(db, sql, now - 30 * DAY_MS);
	return [...new Set([...last30.keys(), ...last7.keys()])]
		.map((key) => ({key, d7: last7.get(key) ?? 0, d30: last30.get(key) ?? 0}))
		.sort((a, b) => b.d30 - a.d30 || b.d7 - a.d7);
};

const countTable = (caption: string, keyLabel: string, rows: WindowRow[], empty = 'No clicks yet.'): string => {
	const body =
		rows.length === 0
			? `<tr><td colspan="3" class="muted">${esc(empty)}</td></tr>`
			: rows
					.map((r) => `<tr><td>${r.key === null ? '<span class="muted">(none)</span>' : esc(r.key)}</td><td class="num">${r.d7}</td><td class="num">${r.d30}</td></tr>`)
					.join('\n');
	return `<div class="table-wrap"><table>
<caption>${esc(caption)}</caption>
<thead><tr><th scope="col">${esc(keyLabel)}</th><th scope="col" class="num">7 days</th><th scope="col" class="num">30 days</th></tr></thead>
<tbody>
${body}
</tbody></table></div>`;
};

const statusForm = (order: Row, csrf: string): string => {
	const id = String(order.id);
	const options = ORDER_STATUSES.map((s) => `<option value="${s}"${s === order.status ? ' selected' : ''}>${s}</option>`).join('');
	return `<form class="inline" method="post" action="/admin/orders/${esc(encodeURIComponent(id))}/status">
<input type="hidden" name="csrf" value="${esc(csrf)}">
<label class="sr-only" for="status-${esc(id)}">Status for the request from ${esc(order.name)}</label>
<select id="status-${esc(id)}" name="status">${options}</select>
<button class="button" type="submit">Save</button>
</form>`;
};

/**
 * mailto: link for an order's address (RFC 6068): the local part and domain are percent-encoded, so an
 * address cannot smuggle in ?cc=, &bcc= or &body= fields when the owner clicks it to reply.
 */
export const mailtoHref = (email: string): string => {
	const at = email.lastIndexOf('@');
	if (at < 1) return `mailto:${encodeURIComponent(email)}`;
	return `mailto:${encodeURIComponent(email.slice(0, at))}@${encodeURIComponent(email.slice(at + 1))}`;
};

const ordersTable = (orders: Row[], csrf: string): string => {
	if (orders.length === 0) return '<p class="muted">No order requests yet.</p>';
	const rows = orders
		.map((o) => {
			const message = String(o.message ?? '');
			const short = message.length > 140 ? `${message.slice(0, 140)}…` : message;
			const details = [
				o.company ? `Company: ${o.company}` : '',
				o.project_url ? `Project: ${o.project_url}` : '',
				o.budget ? `Budget: ${o.budget}` : '',
				o.deadline ? `Deadline: ${o.deadline}` : '',
				`Consent: ${Number(o.consent) === 1 ? 'yes' : 'no'}`,
			].filter(Boolean);
			return `<tr>
<td class="num">${esc(new Date(Number(o.ts)).toISOString().slice(0, 16).replace('T', ' '))}</td>
<td>${esc(o.name)}<br><a href="${esc(mailtoHref(String(o.email ?? '')))}">${esc(o.email)}</a></td>
<td>${esc(o.package_id)}</td>
<td><details><summary>${esc(short)}</summary><p>${esc(message)}</p><p class="muted small">${details.map((d) => esc(d)).join('<br>')}</p></details></td>
<td>${statusForm(o, csrf)}</td>
</tr>`;
		})
		.join('\n');
	return `<div class="table-wrap"><table>
<caption>Newest 200 order requests</caption>
<thead><tr><th scope="col">Received (UTC)</th><th scope="col">From</th><th scope="col">Package</th><th scope="col">Message</th><th scope="col">Status</th></tr></thead>
<tbody>
${rows}
</tbody></table></div>`;
};

const overview: AdminHandler = (ctx, csrf) => {
	const {db} = ctx;
	const now = Date.now();
	const since30 = now - 30 * DAY_MS;
	const outcomes = stmt(db, 'SELECT outcome, COUNT(*) AS n FROM clicks WHERE ts >= ? AND is_bot = 0 GROUP BY outcome ORDER BY n DESC').all(since30);
	const bots = Number(stmt(db, 'SELECT COUNT(*) AS n FROM clicks WHERE ts >= ? AND is_bot = 1').get(since30)?.n ?? 0);
	const blocked = stmt(
		db,
		`SELECT offer_id, country, COUNT(*) AS n FROM clicks
		 WHERE ts >= ? AND is_bot = 0 AND outcome IN ('blocked_region', 'blocked_unknown_region')
		 GROUP BY offer_id, country ORDER BY n DESC LIMIT 20`,
	).all(since30);
	const orders = stmt(
		db,
		`SELECT id, ts, name, email, company, project_url, package_id, budget, deadline, message, consent, status
		 FROM orders ORDER BY ts DESC LIMIT 200`,
	).all();
	const outcomeRows = outcomes.map((r) => `<tr><td>${esc(r.outcome)}</td><td class="num">${Number(r.n)}</td></tr>`).join('\n');
	const blockedRows = blocked
		.map((r) => `<tr><td>${esc(r.offer_id)}</td><td>${r.country === null ? '<span class="muted">unknown</span>' : esc(r.country)}</td><td class="num">${Number(r.n)}</td></tr>`)
		.join('\n');
	const body = `<h1>Admin</h1>
<p class="lede">Human clicks that were sent on to an offer, counted once per visitor, offer and day.</p>
<p><a href="/admin/export/clicks.csv">Export clicks (CSV)</a> · <a href="/admin/export/video-clicks.csv">Export clicks per video (CSV)</a> · <a href="/admin/export/orders.csv">Export orders (CSV)</a> · <a href="/admin/links">Link builder</a></p>
<h2 id="clicks">Clicks</h2>
${countTable('By offer', 'Offer', windowCounts(db, CLICK_COUNTS.offer_id, now))}
${countTable('By video', 'Video', windowCounts(db, CLICK_COUNTS.video_id, now))}
${countTable('By source', 'Source', windowCounts(db, CLICK_COUNTS.source, now))}
<h2 id="outcomes">All outcomes, last 30 days</h2>
<div class="table-wrap"><table>
<caption>Human requests to /go by outcome (not de-duplicated). Bot requests: ${bots}.</caption>
<thead><tr><th scope="col">Outcome</th><th scope="col" class="num">Requests</th></tr></thead>
<tbody>
${outcomeRows || '<tr><td colspan="2" class="muted">No requests yet.</td></tr>'}
</tbody></table></div>
<div class="table-wrap"><table>
<caption>Blocked by region, last 30 days</caption>
<thead><tr><th scope="col">Offer</th><th scope="col">Country</th><th scope="col" class="num">Requests</th></tr></thead>
<tbody>
${blockedRows || '<tr><td colspan="3" class="muted">Nothing blocked.</td></tr>'}
</tbody></table></div>
<h2 id="pages">Page views</h2>
${countTable('Human visitors per page, once per day', 'Page', windowCounts(db, PAGE_COUNTS, now), 'No visits yet.')}
<h2 id="orders">Order requests</h2>
${ordersTable(orders, csrf)}`;
	ctx.html(200, page(ctx.config, {title: 'Admin', nav: 'admin', wide: true, noindex: true, body}));
};

/**
 * Description text for one video, built like the publish kit's: an opening disclosure line, then each offer
 * that may be shown everywhere with its disclosure under its link. A description is visible in every country,
 * so offers restricted by region are never named in it: one line to the hub's region-filtered page stands in
 * for all of them, and they are listed separately for the owner only.
 */
export const descriptionText = (offers: Offer[], publicBaseUrl: string, videoId: string | null, source: Source): string => {
	const open = offers.filter((o) => !isRestricted(o));
	const restricted = offers.filter((o) => isRestricted(o));
	const top = topDisclosure(offers);
	if (!top) return '';
	const blocks = [top, ...open.map((o) => [`${o.name}: ${publicBaseUrl}${hubPath(o.id, videoId, source)}`, ...disclosureLines(o)].join('\n'))];
	if (restricted.length > 0) blocks.push(restrictedOfferLines(publicBaseUrl, videoId, source).join('\n'));
	return blocks.join('\n\n');
};

const linkBuilder: AdminHandler = (ctx) => {
	const now = Date.now();
	const rawVideo = ctx.url.searchParams.get('v') ?? '';
	const videoId = parseVideoId(rawVideo);
	const source = parseSource(ctx.url.searchParams.get('s')) ?? 'yt';
	const {offers} = ctx.config.offers;
	const live = offers.filter((o) => isLive(o, now));
	const text = descriptionText(live, ctx.config.publicBaseUrl, videoId, source);
	const hubOnly = live.filter((o) => isRestricted(o));
	const hubOnlyList = hubOnly
		.map((o) => {
			const rules = [o.blockedCountries.length ? `blocked in ${o.blockedCountries.join(' ')}` : '', o.allowedCountries?.length ? `only ${o.allowedCountries.join(' ')}` : '', 'hidden when the country is unknown'].filter(Boolean);
			return `<li>${esc(o.name)} <span class="muted small">(${esc(rules.join('; '))})</span></li>`;
		})
		.join('\n');
	const sourceOptions = SOURCES.map((s) => `<option value="${s}"${s === source ? ' selected' : ''}>${s}</option>`).join('');
	const registryRows = offers
		.map((o) => {
			const end = expiresAtMs(o);
			const state = !o.active ? 'inactive' : end !== null && now >= end ? 'expired' : 'live';
			const rules = [
				o.blockedCountries.length ? `blocked: ${o.blockedCountries.join(' ')}` : '',
				o.allowedCountries?.length ? `only: ${o.allowedCountries.join(' ')}` : '',
				`unknown country: ${o.unknownCountry}`,
			].filter(Boolean);
			const terms = o.termsUrl ? `<a href="${esc(o.termsUrl)}" rel="noopener noreferrer">terms</a>` : '<span class="muted">none</span>';
			return `<tr><td>${esc(o.id)}</td><td>${esc(o.name)}</td><td>${state}</td><td>${esc(o.relationship)}</td><td>${rules.map((r) => esc(r)).join('<br>')}</td><td>${o.subIdParam ? esc(o.subIdParam) : '<span class="muted">none</span>'}</td><td>${terms}</td></tr>`;
		})
		.join('\n');
	const body = `<h1>Link builder</h1>
<p class="lede">Tracked links for one video, each followed by the disclosure that must sit next to it. Paste the text into the description as it is.</p>
<form method="get" action="/admin/links">
<div class="field"><label for="v">Video ID or episode slug</label><input id="v" name="v" value="${esc(rawVideo)}" maxlength="64" pattern="[A-Za-z0-9_\\-]{1,64}" aria-describedby="v-help"><span id="v-help" class="muted small">Letters, digits, "-" and "_" only, up to 64 characters.</span></div>
<div class="field"><label for="s">Where the links will be posted</label><select id="s" name="s">${sourceOptions}</select></div>
<button class="button" type="submit">Build links</button>
</form>
${rawVideo && !videoId ? '<p class="warn" role="alert">That video ID is not valid, so the links below carry no video.</p>' : ''}
<h2>Description text</h2>
${live.length > 0 ? `<div class="field"><label for="out">Opening disclosure, then links with disclosures (${live.length - hubOnly.length} of ${live.length} live offers named)</label><textarea id="out" readonly>${esc(text)}</textarea></div>` : '<p>No offers are live. Set "active": true in config/offers.json.</p>'}
<p class="muted small">Put the first line at the top of the description. In videos, also say the disclosure out loud and show it on screen.</p>
${
	hubOnly.length > 0
		? `<h3>Hub page only: do not name these in descriptions, posts, emails or videos</h3>
<p class="muted small">They are restricted by region, and text you publish is visible everywhere (in the UK, promoting them can be a criminal offence). The hub shows them only where they are allowed, through the "More partner links" line above.</p>
<ul>
${hubOnlyList}
</ul>`
		: ''
}
<h2>Offer registry</h2>
<div class="table-wrap"><table>
<caption>Re-check each programme's terms before a campaign.</caption>
<thead><tr><th scope="col">ID</th><th scope="col">Name</th><th scope="col">State</th><th scope="col">Relationship</th><th scope="col">Region rules</th><th scope="col">Sub-ID</th><th scope="col">Terms</th></tr></thead>
<tbody>
${registryRows || '<tr><td colspan="7" class="muted">The registry is empty.</td></tr>'}
</tbody></table></div>`;
	ctx.html(200, page(ctx.config, {title: 'Link builder', nav: 'admin', wide: true, noindex: true, body}));
};

const updateStatus: AdminHandler = async (ctx) => {
	const id = ctx.params.id ?? '';
	if (!UUID.test(id)) throw new HttpError(404, 'Order not found.');
	const form = await ctx.form();
	const status = ORDER_STATUSES.find((s) => s === form.get('status'));
	if (!status) throw new HttpError(400, 'Unknown status.');
	const result = stmt(ctx.db, 'UPDATE orders SET status = ? WHERE id = ?').run(status, id);
	if (Number(result.changes) === 0) throw new HttpError(404, 'Order not found.');
	ctx.redirect(303, '/admin#orders');
};

// ---------------------------------------------------------------------------------------------
// CSV exports

/** Quotes text fields; prefixes cells that spreadsheets would run as formulas. */
export const csvCell = (value: SQLOutputValue | boolean | undefined): string => {
	if (value === null || value === undefined) return '';
	if (typeof value === 'number' || typeof value === 'bigint') return String(value);
	const text = String(value);
	const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
	return `"${safe.replace(/"/g, '""')}"`;
};

const csvLine = (values: (SQLOutputValue | boolean | undefined)[]): string => `${values.map(csvCell).join(',')}\r\n`;

const waitForDrain = (res: ServerResponse): Promise<void> =>
	new Promise((resolve) => {
		const done = (): void => {
			res.off('drain', done);
			res.off('close', done);
			resolve();
		};
		res.on('drain', done);
		res.on('close', done);
	});

/** Streams rows from a fresh (uncached) statement, so concurrent exports cannot reset each other. */
const streamCsv = async (ctx: Ctx, name: string, header: string[], sql: string, params: number[], map: (row: Row) => (SQLOutputValue | undefined)[]): Promise<void> => {
	const {res} = ctx;
	res.statusCode = 200;
	res.setHeader('Content-Type', 'text/csv; charset=utf-8');
	res.setHeader('Content-Disposition', `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`);
	let chunk = csvLine(header);
	for (const row of ctx.db.prepare(sql).iterate(...params)) {
		chunk += csvLine(map(row));
		if (chunk.length < 64 * 1024) continue;
		if (!res.write(chunk)) await waitForDrain(res);
		chunk = '';
		if (res.destroyed) return;
	}
	res.end(chunk);
};

const sinceParam = (ctx: Ctx): number => {
	const raw = ctx.url.searchParams.get('days');
	if (raw === null || raw === '') return 0;
	const days = Number(raw);
	if (!Number.isInteger(days) || days < 1 || days > 400) throw new HttpError(400, 'days must be a whole number from 1 to 400.');
	return Date.now() - days * DAY_MS;
};

const iso = (ts: SQLOutputValue): string => new Date(Number(ts)).toISOString();

/** Columns: ts, time_utc, offer_id, video_id, source, country, visitor_hash, is_bot, outcome, referrer_host */
const exportClicks: AdminHandler = (ctx) =>
	streamCsv(
		ctx,
		'clicks',
		['ts', 'time_utc', 'offer_id', 'video_id', 'source', 'country', 'visitor_hash', 'is_bot', 'outcome', 'referrer_host'],
		'SELECT ts, offer_id, video_id, source, country, visitor_hash, is_bot, outcome, referrer_host FROM clicks WHERE ts >= ? ORDER BY ts',
		[sinceParam(ctx)],
		(r) => [r.ts, iso(r.ts), r.offer_id, r.video_id, r.source, r.country, r.visitor_hash, r.is_bot, r.outcome, r.referrer_host],
	);

/** Columns: video_id, offer_id, source, hub_clicks (the dashboard's hubClicks is the sum per video). */
const exportVideoClicks: AdminHandler = (ctx) =>
	streamCsv(
		ctx,
		'video-clicks',
		['video_id', 'offer_id', 'source', 'hub_clicks'],
		`SELECT video_id, offer_id, source, COUNT(*) AS n FROM (${FIRST_CLICKS}) GROUP BY video_id, offer_id, source ORDER BY video_id, offer_id, source`,
		[sinceParam(ctx)],
		(r) => [r.video_id, r.offer_id, r.source, r.n],
	);

/** Columns: id, time_utc, name, email, company, project_url, package_id, budget, deadline, message, consent, status */
const exportOrders: AdminHandler = (ctx) =>
	streamCsv(
		ctx,
		'orders',
		['id', 'time_utc', 'name', 'email', 'company', 'project_url', 'package_id', 'budget', 'deadline', 'message', 'consent', 'status'],
		`SELECT id, ts, name, email, company, project_url, package_id, budget, deadline, message, consent, status
		 FROM orders WHERE ts >= ? ORDER BY ts`,
		[sinceParam(ctx)],
		(r) => [r.id, iso(r.ts), r.name, r.email, r.company, r.project_url, r.package_id, r.budget, r.deadline, r.message, r.consent, r.status],
	);
