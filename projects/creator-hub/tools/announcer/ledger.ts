/**
 * Idempotency ledger: a local JSON file that records every post (and every Kit draft) so the same kit is never
 * posted twice to the same target. The default files live under the hub's data/ folder, which .gitignore keeps
 * out of git: data/announcer/ledger.json and data/threat-brief/ledger.json.
 *
 * Neither Telegram's sendMessage nor X's POST /2/tweets takes an idempotency key, so the ledger is write-ahead:
 *   1. the entry is saved as "pending" BEFORE the request is sent;
 *   2. a confirmed answer (the remote id) turns it into "posted"; only a refusal turns it into "failed" (an HTTP status
 *      from 300 to 499, or the platform's own explicit refusal): nothing was posted, so a later run may try again;
 *   3. everything else leaves it "pending", because the post may exist: no answer, a 5xx, or a 2xx answer that cannot
 *      be confirmed (the body breaks off, is not JSON, or has no id). Every later run refuses that target until the
 *      owner checks the channel and runs `ledger forget <key>`.
 * A lock file next to the ledger stops two runs from posting at the same time (withLedgerLock). An unreadable ledger
 * stops every post (fail closed).
 */
import {randomBytes} from 'node:crypto';
import {closeSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync, writeSync} from 'node:fs';
import {dirname} from 'node:path';

export type LedgerState = 'pending' | 'posted' | 'failed';

export type LedgerEntry = {
	key: string;
	scope: string; // "<channel>/<slug>" or "threat-brief/<date>"
	target: string; // "x", "telegram", "kit-draft"
	state: LedgerState;
	textSha256: string;
	attemptedAt: string;
	postedAt: string | null;
	remoteId: string | null;
	url: string | null;
	error: string | null;
	history: {at: string; event: string}[];
};

export type LedgerFile = {version: 1; entries: Record<string, LedgerEntry>};

export class LedgerError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'LedgerError';
	}
}

const STALE_LOCK_MS = 10 * 60_000;

export const ledgerKey = (scope: string, target: string): string => `${scope}#${target}`;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Reads the ledger. A missing file is an empty ledger; anything unreadable throws (never post blind). */
export const readLedger = (file: string): LedgerFile => {
	let raw: string;
	try {
		raw = readFileSync(file, 'utf8');
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {version: 1, entries: {}};
		throw new LedgerError(`cannot read the ledger ${file}: ${(err as Error).message}`);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		throw new LedgerError(`the ledger ${file} is not valid JSON (${(err as Error).message}). Fix or restore it before posting: it is what stops double posts.`);
	}
	if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.entries)) throw new LedgerError(`the ledger ${file} has an unknown format (expected {"version": 1, "entries": {...}})`);
	const entries: Record<string, LedgerEntry> = {};
	for (const [key, value] of Object.entries(parsed.entries)) {
		if (!isRecord(value) || (value.state !== 'pending' && value.state !== 'posted' && value.state !== 'failed')) {
			throw new LedgerError(`the ledger ${file} has a malformed entry "${key}"`);
		}
		entries[key] = value as LedgerEntry;
	}
	return {version: 1, entries};
};

/** Writes the ledger atomically (temporary file + rename), so a crash never leaves half a file. */
export const writeLedger = (file: string, ledger: LedgerFile): void => {
	mkdirSync(dirname(file), {recursive: true});
	const tmp = `${file}.${process.pid}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(ledger, null, 2)}\n`, {mode: 0o600});
	renameSync(tmp, file);
};

// ---------------------------------------------------------------------------------------------
// The lock

/** A held lock: check it is still yours right before a request, and keep it fresh while a long one runs. */
export type LedgerLock = {
	/** Throws a LedgerError if another run took the lock over (only possible after this run stalled for 10 minutes). */
	assertHeld: () => void;
	/** Marks the lock as alive now. A heartbeat also does it every minute while the run holds it. */
	refresh: () => void;
	readonly token: string;
};

const HEARTBEAT_MS = 60_000;

const readText = (path: string): string | null => {
	try {
		return readFileSync(path, 'utf8');
	} catch {
		return null;
	}
};

/** The random token on the first line of a lock file ("<token> <pid> <time>"), or null. */
export const readLockToken = (lock: string): string | null => readText(lock)?.split(/\s+/)[0] || null;

const busy = (lock: string): LedgerError => new LedgerError(`another announcer run holds ${lock}. Wait for it to finish, or delete the lock if no run is active.`);

/**
 * Removes a stale lock atomically: it is renamed to a name only this call uses, so when two runs see the same stale
 * lock only one rename succeeds. The winner then checks that what it moved is still the stale lock it looked at
 * (`observed`, the file's content when it judged it stale); a run that took the lock over in between left a fresh
 * one, which is put back without overwriting anything. Returns true when the stale lock was removed.
 */
export const takeOverStaleLock = (lock: string, observed: string, now: () => number = Date.now): boolean => {
	const aside = `${lock}.stale-${randomBytes(8).toString('hex')}`;
	try {
		renameSync(lock, aside);
	} catch {
		return false; // another run moved it first
	}
	let fresh = true;
	try {
		fresh = readText(aside) !== observed || now() - statSync(aside).mtimeMs < STALE_LOCK_MS;
	} catch {
		fresh = true;
	}
	if (fresh) {
		try {
			linkSync(aside, lock); // put it back; fails, never overwrites, if the path was taken again
		} catch {
			// the path holds a newer lock now: its holder checks its own token before every post
		}
	}
	rmSync(aside, {force: true});
	return !fresh;
};

const createLock = (lock: string, token: string, now: () => number): boolean => {
	let fd: number;
	try {
		fd = openSync(lock, 'wx', 0o600);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
		throw new LedgerError(`cannot create the lock ${lock}: ${(err as Error).message}`);
	}
	try {
		writeSync(fd, `${token} ${process.pid} ${new Date(now()).toISOString()}\n`);
	} finally {
		closeSync(fd);
	}
	return true;
};

/** Removes the lock only while it still carries `token` (moved aside first, so the check and the removal are one step). */
const releaseLock = (lock: string, token: string): void => {
	if (readLockToken(lock) !== token) return;
	const aside = `${lock}.release-${token}`;
	try {
		renameSync(lock, aside);
	} catch {
		return;
	}
	if (readLockToken(aside) !== token) {
		try {
			linkSync(aside, lock); // not ours after all: put it back
		} catch {
			// a newer lock exists
		}
	}
	rmSync(aside, {force: true});
};

/**
 * Holds `<ledger>.lock` while `fn` runs. The lock carries a random token; a lock left by a crashed run (no heartbeat
 * for 10 minutes) is taken over atomically (takeOverStaleLock). While `fn` runs a heartbeat refreshes the lock every
 * minute, so a long upload is never mistaken for a crashed run, and the lock is removed at the end only if it still
 * carries this run's token.
 */
export const withLedgerLock = async <T>(file: string, fn: (lock: LedgerLock) => Promise<T>, now: () => number = Date.now): Promise<T> => {
	const lock = `${file}.lock`;
	mkdirSync(dirname(file), {recursive: true});
	const token = randomBytes(16).toString('hex');
	let held = false;
	for (let attempt = 0; attempt < 3 && !held; attempt++) {
		if (createLock(lock, token, now)) {
			held = true;
			break;
		}
		let age: number;
		try {
			age = now() - statSync(lock).mtimeMs;
		} catch {
			continue; // released in between: try again
		}
		if (age < STALE_LOCK_MS) throw busy(lock);
		const observed = readText(lock);
		if (observed === null) continue; // released in between: try again
		if (!takeOverStaleLock(lock, observed, now)) throw busy(lock);
	}
	if (!held) throw new LedgerError(`cannot take the lock ${lock}`);
	const touch = (): void => {
		if (readLockToken(lock) !== token) return;
		const t = new Date(now());
		try {
			utimesSync(lock, t, t);
		} catch {
			// best effort: assertHeld decides
		}
	};
	const handle: LedgerLock = {
		token,
		refresh: touch,
		assertHeld: () => {
			if (readLockToken(lock) !== token) throw new LedgerError(`this run lost the lock ${lock} (another run took it over). Nothing more is posted: check the ledger and the channel.`);
		},
	};
	const heartbeat = setInterval(touch, HEARTBEAT_MS);
	heartbeat.unref();
	try {
		return await fn(handle);
	} finally {
		clearInterval(heartbeat);
		releaseLock(lock, token);
	}
};

/** Updates one entry (read-modify-write; call inside withLedgerLock). */
export const putEntry = (file: string, entry: LedgerEntry): LedgerFile => {
	const ledger = readLedger(file);
	ledger.entries[entry.key] = entry;
	writeLedger(file, ledger);
	return ledger;
};

/** Removes one entry; returns false when it was not there. */
export const forgetEntry = (file: string, key: string): boolean => {
	const ledger = readLedger(file);
	if (!ledger.entries[key]) return false;
	delete ledger.entries[key];
	writeLedger(file, ledger);
	return true;
};

/** What the ledger says about posting this key now. */
export type Clearance = {ok: true; previous: LedgerEntry | null} | {ok: false; reason: string; entry: LedgerEntry};

export const clearance = (ledger: LedgerFile, key: string): Clearance => {
	const entry = ledger.entries[key];
	if (!entry || entry.state === 'failed') return {ok: true, previous: entry ?? null};
	if (entry.state === 'posted') {
		return {ok: false, reason: `already posted ${entry.postedAt ?? entry.attemptedAt}${entry.remoteId ? ` (id ${entry.remoteId})` : ''}${entry.url ? ` ${entry.url}` : ''}`, entry};
	}
	return {
		ok: false,
		reason: `an earlier attempt (${entry.attemptedAt}) got no answer, so it may have been posted. Check the channel; if it is not there, run: ledger forget "${key}"`,
		entry,
	};
};

export const newEntry = (scope: string, target: string, textSha256: string, at: string, previous: LedgerEntry | null): LedgerEntry => ({
	key: ledgerKey(scope, target),
	scope,
	target,
	state: 'pending',
	textSha256,
	attemptedAt: at,
	postedAt: null,
	remoteId: null,
	url: null,
	error: null,
	history: [...(previous?.history ?? []), {at, event: previous ? `retry after: ${previous.error ?? previous.state}` : 'attempt'}],
});
