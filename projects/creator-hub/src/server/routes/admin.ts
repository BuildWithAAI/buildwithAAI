import type {ServerResponse} from 'node:http';
import type {DatabaseSync, SQLOutputValue} from 'node:sqlite';
import type {OrderRequest} from '../../types.ts';
import {checkCredentials, csrfToken, newCsrfNonce, parseBasicAuth, readCookie, validCsrf} from '../auth.ts';
import {stmt} from '../db.ts';
import {HttpError} from '../errors.ts';
import {headerValue} from '../geo.ts';
import {errorPage, esc, page} from '../html.ts';
import type {Ctx, Handler, Router} from '../http.ts';
import {disclosureLines, expiresAtMs, hubPath, isLive, parseSource, parseVideoId, SOURCES} from '../offers.ts';
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
	// Failed sign-ins per client: 10, then one more every 90 seconds. Created per server instance.
	const failures = createRateLimiter({capacity: 10, refillPerSecond: 10 / (15 * 60)});
	const admin = (handler: AdminHandler): Handler => (ctx) => guard(ctx, failures, handler);
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

const guard = async (ctx: Ctx, failures: RateLimiter, handler: AdminHandler): Promise<void> => {
	ctx.res.setHeader('Cache-Control', 'no-store');
	ctx.res.setHeader('X-Robots-Tag', 'noindex, nofollow');
	const {adminUser, adminPasswordHash, hashSecret} = ctx.config;
	if (!adminUser || !adminPasswordHash) {
		ctx.html(503, errorPage(ctx.config, 503, 'Admin is switched off', 'Set ADMIN_USER and ADMIN_PASSWORD_HASH to turn it on.'));
		return;
	}
	const key = rateLimitKey(ctx);
	const credentials = parseBasicAuth(headerValue(ctx.req, 'authorization') ?? undefined);
	if (credentials) {
		if (failures.available(key) < 1) {
			ctx.res.setHeader('Retry-After', String(Math.max(1, failures.retryAfter(key))));
			ctx.html(429, errorPage(ctx.config, 429, 'Too many failed sign-ins', 'Wait a few minutes, then try again.'));
			return;
		}
		if (await checkCredentials(credentials, adminUser, adminPasswordHash)) {
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
		failures.take(key);
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
<td>${esc(o.name)}<br><a href="mailto:${esc(o.email)}">${esc(o.email)}</a></td>
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

const linkBuilder: AdminHandler = (ctx) => {
	const now = Date.now();
	const rawVideo = ctx.url.searchParams.get('v') ?? '';
	const videoId = parseVideoId(rawVideo);
	const source = parseSource(ctx.url.searchParams.get('s')) ?? 'yt';
	const {offers} = ctx.config.offers;
	const live = offers.filter((o) => isLive(o, now));
	const text = live
		.map((o) => [`${o.name}: ${ctx.config.publicBaseUrl}${hubPath(o.id, videoId, source)}`, ...disclosureLines(o)].join('\n'))
		.join('\n\n');
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
<p class="lede">Tracked links for one video, each followed by the disclosure that must sit next to it. Paste them into the description as they are.</p>
<form method="get" action="/admin/links">
<div class="field"><label for="v">Video ID or episode slug</label><input id="v" name="v" value="${esc(rawVideo)}" maxlength="64" pattern="[A-Za-z0-9_\\-]{1,64}" aria-describedby="v-help"><span id="v-help" class="muted small">Letters, digits, "-" and "_" only, up to 64 characters.</span></div>
<div class="field"><label for="s">Where the links will be posted</label><select id="s" name="s">${sourceOptions}</select></div>
<button class="button" type="submit">Build links</button>
</form>
${rawVideo && !videoId ? '<p class="warn" role="alert">That video ID is not valid, so the links below carry no video.</p>' : ''}
<h2>Description text</h2>
${live.length > 0 ? `<div class="field"><label for="out">Links with disclosures (${live.length} live offers)</label><textarea id="out" readonly>${esc(text)}</textarea></div>` : '<p>No offers are live. Set "active": true in config/offers.json.</p>'}
<p class="muted small">Restricted offers are hidden by the hub where they are blocked, but the text you paste is visible everywhere. In videos, also say the disclosure out loud and show it on screen.</p>
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
