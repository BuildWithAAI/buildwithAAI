/**
 * SQLite access (node:sqlite). The schema lives in src/db/schema.sql and is applied on every start
 * (all statements are CREATE ... IF NOT EXISTS). Every query uses prepared statements.
 */
import {mkdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync, type StatementSync} from 'node:sqlite';
import type {ClickEvent, Source} from '../types.ts';

export const DB_FILE = 'hub.sqlite';
const SCHEMA_URL = new URL('../db/schema.sql', import.meta.url);

export const openDb = (dataDir: string): DatabaseSync => {
	mkdirSync(dataDir, {recursive: true});
	const db = new DatabaseSync(join(dataDir, DB_FILE));
	db.exec('PRAGMA busy_timeout = 5000');
	db.exec(readFileSync(SCHEMA_URL, 'utf8'));
	db.exec('PRAGMA synchronous = NORMAL');
	stmt(db, "INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '1')").run();
	return db;
};

const cache = new WeakMap<DatabaseSync, Map<string, StatementSync>>();

/** Prepared statement, cached per database connection. Only pass SQL written in this codebase. */
export const stmt = (db: DatabaseSync, sql: string): StatementSync => {
	let statements = cache.get(db);
	if (!statements) {
		statements = new Map();
		cache.set(db, statements);
	}
	let statement = statements.get(sql);
	if (!statement) {
		statement = db.prepare(sql);
		statements.set(sql, statement);
	}
	return statement;
};

export const insertClick = (db: DatabaseSync, click: ClickEvent): void => {
	stmt(
		db,
		`INSERT INTO clicks (ts, offer_id, video_id, source, country, visitor_hash, is_bot, outcome, referrer_host)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	).run(
		click.ts,
		click.offerId,
		click.videoId,
		click.source,
		click.country,
		click.visitorHash,
		click.isBot ? 1 : 0,
		click.outcome,
		click.referrerHost,
	);
};

export type PageEvent = {
	ts: number;
	page: string;
	source: Source | null;
	videoId: string | null;
	country: string | null;
	visitorHash: string;
	isBot: boolean;
};

export const insertPageEvent = (db: DatabaseSync, event: PageEvent): void => {
	stmt(
		db,
		`INSERT INTO page_events (ts, page, source, video_id, country, visitor_hash, is_bot)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
	).run(event.ts, event.page, event.source, event.videoId, event.country, event.visitorHash, event.isBot ? 1 : 0);
};

/**
 * Deletes clicks, page events and order requests older than `cutoff` (unix ms). Orders marked
 * 'won' became client projects and are kept as business records until the owner deletes them.
 */
export const purgeBefore = (db: DatabaseSync, cutoff: number): {clicks: number; pageEvents: number; orders: number} => ({
	clicks: Number(stmt(db, 'DELETE FROM clicks WHERE ts < ?').run(cutoff).changes),
	pageEvents: Number(stmt(db, 'DELETE FROM page_events WHERE ts < ?').run(cutoff).changes),
	orders: Number(stmt(db, "DELETE FROM orders WHERE ts < ? AND status <> 'won'").run(cutoff).changes),
});
