/**
 * Today's episode for the Threat Brief: from a publish kit (kit.json, read with the newsletter's checked reader) or
 * from the daily pipeline's post-approval input (video-studio/scripts/daily/lib/postapproval.ts, PostInput).
 */
import {isYoutubeId, readPublishKit, type NewsletterKit} from '../newsletter/publish-kit.ts';
import type {ShowInfo} from './brief.ts';

export const watchUrl = (youtubeId: string | null): string | null => (youtubeId && isYoutubeId(youtubeId) ? `https://youtu.be/${youtubeId}` : null);

const DEVELOPING = /\bdeveloping\b/i;

/** "…and end with Zoo's one fix: read every signature request." -> "Read every signature request." */
export const oneFixFromSummary = (summary: string): string | null => {
	const m = /\bZoo['’]s one fix(?: is)?:\s*(.+?)(?:\.\s|\.$|$)/i.exec(summary);
	const text = m?.[1]?.trim();
	if (!text || text.length < 10) return null;
	return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
};

export const showFromKit = (kit: NewsletterKit, youtubeId: string | null): ShowInfo => ({
	title: kit.title,
	url: watchUrl(kit.youtubeVideoId ?? youtubeId),
	developing: DEVELOPING.test(kit.title) || kit.disclosures.some((d) => DEVELOPING.test(d)),
	oneFix: oneFixFromSummary(kit.summary),
	slug: kit.slug,
});

export const readShowKit = (file: string, youtubeId: string | null): {show: ShowInfo | null; errors: string[]} => {
	const {kit, errors} = readPublishKit(file);
	return kit ? {show: showFromKit(kit, youtubeId), errors: []} : {show: null, errors};
};

/** The fields of the daily pipeline's PostInput that the brief uses. */
export type DailyInput = {
	date: string;
	slug: string;
	title: string;
	developing: boolean;
	oneFix: string | null;
	youtubeId: string | null;
	corrections: string[];
	showName: string | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

export const checkDailyInput = (input: unknown): {input: DailyInput | null; errors: string[]} => {
	if (!isRecord(input)) return {input: null, errors: ['the daily input must be a JSON object']};
	const errors: string[] = [];
	const date = str(input.date);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push('"date" must be a YYYY-MM-DD date');
	const title = str(input.title);
	if (!title) errors.push('"title" must be a non-empty string');
	const youtubeId = str(input.youtubeId);
	if (youtubeId && !isYoutubeId(youtubeId)) errors.push('"youtubeId" must be null or an 11-character YouTube id');
	if (typeof input.developing !== 'boolean') errors.push('"developing" must be true or false');
	if (errors.length > 0) return {input: null, errors};
	return {
		input: {
			date,
			slug: str(input.slug),
			title,
			developing: input.developing === true,
			oneFix: str(input.oneFix) || null,
			youtubeId: youtubeId || null,
			corrections: Array.isArray(input.corrections) ? input.corrections.map(str).filter(Boolean) : [],
			showName: str(input.showName) || null,
		},
		errors,
	};
};

export const showFromDaily = (input: DailyInput): ShowInfo => ({
	title: input.title,
	url: watchUrl(input.youtubeId),
	developing: input.developing,
	oneFix: input.oneFix,
	slug: input.slug || null,
});
