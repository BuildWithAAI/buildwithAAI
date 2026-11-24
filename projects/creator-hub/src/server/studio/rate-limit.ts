/**
 * LOCAL STAND-IN rate limiter, used only by routes/studio.ts.
 *
 * The shared limiter is meant to be exported from src/server/security.ts (another builder's file),
 * which did not exist when the studio was written. Once it does, pass it to registerStudio() as
 * `limiter` (or adapt it to the RateLimiter shape below) and delete this file and its test.
 *
 * Fixed window per key, in memory, single process: counts reset on restart. The key map is bounded
 * so a flood of distinct keys cannot grow memory without limit.
 */

export type RateLimitResult = {allowed: boolean; retryAfterMs: number};

export type RateLimiter = {
	/** Counts one attempt for `key` and says whether it is within the limit. */
	take(key: string, now?: number): RateLimitResult;
};

export type RateLimitOptions = {max: number; windowMs: number; maxKeys?: number};

export const createRateLimiter = ({max, windowMs, maxKeys = 10_000}: RateLimitOptions): RateLimiter => {
	const windows = new Map<string, {count: number; resetAt: number}>();

	const makeRoom = (now: number): void => {
		for (const [key, window] of windows) if (window.resetAt <= now) windows.delete(key);
		// Still full: drop the oldest windows (a Map iterates in insertion order).
		for (const key of windows.keys()) {
			if (windows.size < maxKeys) break;
			windows.delete(key);
		}
	};

	return {
		take(key, now = Date.now()) {
			let window = windows.get(key);
			if (!window || window.resetAt <= now) {
				windows.delete(key);
				if (windows.size >= maxKeys) makeRoom(now);
				window = {count: 0, resetAt: now + windowMs};
				windows.set(key, window);
			}
			window.count += 1;
			const allowed = window.count <= max;
			return {allowed, retryAfterMs: allowed ? 0 : window.resetAt - now};
		},
	};
};
