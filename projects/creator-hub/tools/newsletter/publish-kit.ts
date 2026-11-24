/**
 * Reads a publish kit (kit.json, the PublishKit contract in src/types.ts) for the newsletter and checks
 * the fields the newsletter uses. Every problem is collected, not just the first. Fields the newsletter
 * does not use (posts, captions, renders, settings) are not checked here.
 */
import {readFileSync} from 'node:fs';
import {isOfferId, parseVideoId} from '../../src/server/offers.ts';
import type {PublishKit} from '../../src/types.ts';

/** The part of a PublishKit the newsletter reads. A full PublishKit is assignable to it. */
export type NewsletterKit = Pick<
	PublishKit,
	'version' | 'channel' | 'slug' | 'youtubeVideoId' | 'title' | 'summary' | 'chapters' | 'sources' | 'offers' | 'disclosures' | 'checks'
>;

export type KitCheck = {kit: NewsletterKit | null; errors: string[]};

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const TIMESTAMP = /^(?:(\d{1,2}):)?([0-5]?\d):([0-5]\d)$/;

export const isYoutubeId = (value: string): boolean => YOUTUBE_ID.test(value);

/** "00:45" -> 45, "1:02:03" -> 3723; null when the value is not a chapter timestamp. */
export const parseTimestamp = (value: string): number | null => {
	const match = TIMESTAMP.exec(value);
	return match ? Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

export const checkPublishKit = (input: unknown): KitCheck => {
	if (!isRecord(input)) return {kit: null, errors: ['kit.json must be a JSON object']};
	const errors: string[] = [];
	const fail = (message: string): void => void errors.push(message);

	const text = (value: unknown, where: string, max: number, required = true): string => {
		if (value === undefined && !required) return '';
		if (typeof value !== 'string' || (required && value.trim() === '')) {
			fail(`${where} must be a${required ? ' non-empty' : ''} string`);
			return '';
		}
		if (value.length > max) fail(`${where} must be at most ${max} characters`);
		return value.trim();
	};
	const list = (value: unknown, where: string, max: number): unknown[] => {
		if (!Array.isArray(value)) {
			fail(`${where} must be an array`);
			return [];
		}
		if (value.length > max) fail(`${where} must have at most ${max} items`);
		return value.slice(0, max);
	};
	const object = (value: unknown, where: string): Record<string, unknown> => {
		if (isRecord(value)) return value;
		fail(`${where} must be an object`);
		return {};
	};
	const webUrl = (value: unknown, where: string): string => {
		try {
			const url = typeof value === 'string' ? new URL(value) : null;
			if (url && (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password) return url.href;
		} catch {
			// reported below
		}
		fail(`${where} must be an http(s) URL without credentials`);
		return '';
	};

	if (input.version !== 1) fail('"version" must be 1');
	const channel = text(input.channel, '"channel"', 60);
	const slug = typeof input.slug === 'string' ? (parseVideoId(input.slug) ?? '') : '';
	if (!slug) fail('"slug" must be 1-64 characters: A-Z, a-z, 0-9, "_" or "-"');
	let youtubeVideoId: string | null = null;
	if (typeof input.youtubeVideoId === 'string' && isYoutubeId(input.youtubeVideoId)) youtubeVideoId = input.youtubeVideoId;
	else if (input.youtubeVideoId !== null) fail('"youtubeVideoId" must be null or an 11-character YouTube video id');
	const title = text(input.title, '"title"', 200);
	const summary = text(input.summary, '"summary"', 2000);

	const chapters = list(input.chapters, '"chapters"', 100).map((raw, i) => {
		const item = object(raw, `chapters[${i}]`);
		const start = typeof item.start === 'string' ? item.start.trim() : '';
		if (parseTimestamp(start) === null) fail(`chapters[${i}].start must be a timestamp like "00:00" or "1:02:03"`);
		return {start, title: text(item.title, `chapters[${i}].title`, 200)};
	});
	const sources = list(input.sources, '"sources"', 50).map((raw, i) => {
		const item = object(raw, `sources[${i}]`);
		return {title: text(item.title, `sources[${i}].title`, 300), url: webUrl(item.url, `sources[${i}].url`)};
	});
	const offers = list(input.offers, '"offers"', 20).map((raw, i) => {
		const item = object(raw, `offers[${i}]`);
		const id = typeof item.id === 'string' && isOfferId(item.id) ? item.id : '';
		if (!id) fail(`offers[${i}].id must be an offer id (2-40 characters: a-z, 0-9 and "-")`);
		// A missing disclosure is reported by the draft lint as "offer missing a disclosure".
		return {id, hubUrl: text(item.hubUrl, `offers[${i}].hubUrl`, 500), disclosure: text(item.disclosure, `offers[${i}].disclosure`, 500, false)};
	});
	const disclosures = list(input.disclosures, '"disclosures"', 50).map((raw, i) => text(raw, `disclosures[${i}]`, 500));
	const checks =
		input.checks === undefined
			? []
			: list(input.checks, '"checks"', 200).map((raw, i) => {
					const item = object(raw, `checks[${i}]`);
					if (typeof item.ok !== 'boolean') fail(`checks[${i}].ok must be true or false`);
					return {id: text(item.id, `checks[${i}].id`, 100), ok: item.ok === true, detail: text(item.detail, `checks[${i}].detail`, 1000, false)};
				});

	if (errors.length > 0) return {kit: null, errors};
	return {kit: {version: 1, channel, slug, youtubeVideoId, title, summary, chapters, sources, offers, disclosures, checks}, errors};
};

export const readPublishKit = (file: string): KitCheck => {
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(file, 'utf8'));
	} catch (err) {
		return {kit: null, errors: [`cannot read ${file}: ${(err as Error).message}`]};
	}
	const check = checkPublishKit(parsed);
	return {kit: check.kit, errors: check.errors.map((e) => `${file}: ${e}`)};
};
