/**
 * Studio writes to the shared SQLite schema (src/db/schema.sql). Every query is a prepared
 * statement with bound parameters; no SQL is ever built from input.
 */
import type {DatabaseSync} from 'node:sqlite';
import type {CountryCode, OrderRequest, Source} from '../../types.ts';

const INSERT_ORDER = `INSERT INTO orders
	(id, ts, name, email, company, project_url, package_id, budget, deadline, message, consent, status, visitor_hash)
	VALUES ($id, $ts, $name, $email, $company, $projectUrl, $packageId, $budget, $deadline, $message, $consent, $status, $visitorHash)`;

const FIND_RECENT_DUPLICATE = `SELECT id FROM orders
	WHERE visitor_hash = $visitorHash AND email = $email AND package_id = $packageId AND message = $message AND ts >= $since
	LIMIT 1`;

const INSERT_PAGE_VIEW = `INSERT INTO page_events (ts, page, source, video_id, country, visitor_hash, is_bot)
	VALUES ($ts, 'studio', $source, $videoId, $country, $visitorHash, $isBot)`;

export const insertOrder = (db: DatabaseSync, order: OrderRequest, visitorHash: string): void => {
	db.prepare(INSERT_ORDER).run({
		id: order.id,
		ts: order.ts,
		name: order.name,
		email: order.email,
		company: order.company,
		projectUrl: order.projectUrl,
		packageId: order.packageId,
		budget: order.budget,
		deadline: order.deadline,
		message: order.message,
		consent: order.consent ? 1 : 0,
		status: order.status,
		visitorHash,
	});
};

/** Id of the same request from the same visitor since `since` (a double-click or a resend), or null. */
export const findRecentDuplicate = (
	db: DatabaseSync,
	order: Pick<OrderRequest, 'email' | 'packageId' | 'message'>,
	visitorHash: string,
	since: number,
): string | null => {
	const row = db.prepare(FIND_RECENT_DUPLICATE).get({
		visitorHash,
		email: order.email,
		packageId: order.packageId,
		message: order.message,
		since,
	});
	return row && typeof row.id === 'string' ? row.id : null;
};

export type StudioView = {
	ts: number;
	source: Source | null;
	videoId: string | null;
	country: CountryCode | null;
	visitorHash: string;
	isBot: boolean;
};

/** One page_events row (page = 'studio') per view of the offer page, for the revenue dashboard. */
export const recordStudioView = (db: DatabaseSync, view: StudioView): void => {
	db.prepare(INSERT_PAGE_VIEW).run({
		ts: view.ts,
		source: view.source,
		videoId: view.videoId,
		country: view.country,
		visitorHash: view.visitorHash,
		isBot: view.isBot ? 1 : 0,
	});
};
