/** Small shared helpers. */
import {existsSync, readFileSync, statSync} from 'node:fs';

/** A problem with the inputs (episode.json, the registry, flags). The CLI prints it and writes nothing. */
export class InputError extends Error {}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const MAX_JSON_BYTES = 5 * 1024 * 1024;

/** Reads and parses a JSON file; null when it does not exist. */
export const readJsonFile = (path: string, what: string): unknown => {
	if (!existsSync(path)) return null;
	if (statSync(path).size > MAX_JSON_BYTES) throw new InputError(`${path}: the ${what} is larger than 5 MB`);
	try {
		return JSON.parse(readFileSync(path, 'utf8'));
	} catch (err) {
		throw new InputError(`${path}: the ${what} is not valid JSON (${(err as Error).message})`);
	}
};

/** "a", "a and b", "a, b and c". */
export const joinAnd = (items: readonly string[]): string =>
	items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

/** Seconds as m:ss for humans (durations in notes and the checklist). */
export const clock = (sec: number): string => {
	const s = Math.round(sec);
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
