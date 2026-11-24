/**
 * (c) SOCIAL: an X thread (3-6 posts, each <= 280 weighted characters, URLs = 23), a Telegram post (HTML parse
 * mode plus a plain-text copy, <= 4096 characters) and a LinkedIn-style post (<= 3000 characters, the hook inside
 * the first ~210 characters that show before "see more").
 * Any offer link carries its disclosure in the same post, directly above the link. Offer links on social posts go
 * through the hub with s=x (X) or s=other (Telegram, LinkedIn: the hub has no dedicated source values for them).
 */
import {esc} from './html.ts';
import type {Strings} from './i18n.ts';
import {truncate} from './util.ts';
import {X_LIMIT, xLength} from './xcount.ts';

export type SocialOffer = {id: string; name: string; disclosure: string; url: string};

export type SocialInput = {
	title: string;
	summary: string;
	hook: string | null;
	takeaways: string[];
	chapterTitles: string[];
	youtubeUrl: string | null;
	articleUrl: string;
	subscribeUrl: string;
	developing: string | null; // the label to prefix, e.g. "DEVELOPING:"
	fictionNote: string | null;
	hashtags: string[];
	offersX: SocialOffer[]; // at most one is used
	offersOther: SocialOffer[];
	s: Strings;
};

export type Thread = {posts: {text: string; xLength: number}[]};

/** Shortens `text` until xLength(prefix + text + suffix) fits `limit`. */
const fitX = (prefix: string, text: string, suffix: string, limit = X_LIMIT): string => {
	let body = text;
	let max = [...text].length;
	while (xLength(prefix + body + suffix) > limit && max > 10) {
		max -= Math.max(1, Math.ceil((xLength(prefix + body + suffix) - limit) / 2));
		body = truncate(text, max);
	}
	return prefix + body + suffix;
};

const linkLines = (inp: SocialInput, withLabels: boolean): string[] => {
	const lines: string[] = [];
	if (inp.youtubeUrl) lines.push(withLabels ? `${inp.s.fullEpisode} ${inp.youtubeUrl}` : inp.youtubeUrl);
	lines.push(withLabels ? `${inp.s.articleLink} ${inp.articleUrl}` : inp.articleUrl);
	return lines;
};

/** The opener: as many whole sentences of the summary as fit, else a shortened first sentence. */
const firstPost = (head: string, summary: string, suffix: string): string => {
	const sentences = summary.match(/[^.!?…。！？]+[.!?…。！？]+["'”’)]*\s*|[^.!?…。！？]+$/gu) ?? [summary];
	let body = '';
	for (const sentence of sentences) {
		const next = `${body}${sentence}`.trim();
		if (xLength(`${head}${next}${suffix}`) > X_LIMIT) break;
		body = next;
	}
	return body ? `${head}${body}${suffix}` : fitX(head, sentences[0].trim(), suffix);
};

export const xThread = (inp: SocialInput): Thread => {
	const posts: string[] = [];
	const prefix = inp.developing ? `${inp.developing} ` : '';
	const head = fitX('', inp.hook ?? inp.title, '', 200); // leaves room for at least one summary sentence
	const fiction = inp.fictionNote ? `\n\n(${inp.fictionNote})` : '';
	posts.push(firstPost(`${prefix}${head}\n\n`, inp.summary, fiction));

	const items = inp.takeaways.length ? inp.takeaways : inp.chapterTitles;
	const lead = inp.takeaways.length ? '' : `${inp.s.whatWeCover}\n`;
	let current = lead;
	const middle: string[] = [];
	for (const raw of items) {
		const line = fitX('- ', truncate(raw, 200), '', X_LIMIT - xLength(lead));
		const candidate = current && current !== lead ? `${current}\n${line}` : `${current}${line}`;
		if (xLength(candidate) <= X_LIMIT) {
			current = candidate;
			continue;
		}
		if (current && current !== lead) middle.push(current);
		current = `${lead}${line}`;
		if (middle.length >= 3) break;
	}
	if (current && current !== lead && middle.length < 3) middle.push(current);
	posts.push(...middle.slice(0, 3));

	const tail: string[] = linkLines(inp, true);
	const offer = inp.offersX[0];
	if (offer) tail.push('', offer.disclosure, `${offer.name}: ${offer.url}`);
	let last = tail.join('\n');
	const tags = inp.hashtags.map((h) => `#${h}`).join(' ');
	if (tags && xLength(`${last}\n\n${tags}`) <= X_LIMIT) last = `${last}\n\n${tags}`;
	posts.push(last);

	// 3 posts minimum: split the opener into title and summary
	if (posts.length < 3) {
		const opener = posts.shift() as string;
		const title = `${prefix}${head}`;
		const rest = opener.slice(title.length).trim();
		posts.unshift(title, rest || inp.summary);
	}
	return {posts: posts.slice(0, 6).map((text) => ({text, xLength: xLength(text)}))};
};

export type Telegram = {html: string; text: string; visibleLength: number};

export const telegramPost = (inp: SocialInput): Telegram => {
	const html: string[] = [];
	const text: string[] = [];
	const both = (h: string, t: string) => {
		html.push(h);
		text.push(t);
	};
	if (inp.developing) both(`<b>${esc(inp.developing)}</b>`, inp.developing);
	both(`<b>${esc(inp.title)}</b>`, inp.title);
	both('', '');
	both(esc(inp.summary), inp.summary);
	if (inp.fictionNote) both(`<i>${esc(inp.fictionNote)}</i>`, inp.fictionNote);
	if (inp.takeaways.length) {
		both('', '');
		for (const t of inp.takeaways) both(`• ${esc(t)}`, `• ${t}`);
	}
	both('', '');
	if (inp.youtubeUrl) both(`${esc(inp.s.fullEpisode)} <a href="${esc(inp.youtubeUrl)}">${esc(inp.youtubeUrl)}</a>`, `${inp.s.fullEpisode} ${inp.youtubeUrl}`);
	both(`${esc(inp.s.articleLink)} <a href="${esc(inp.articleUrl)}">${esc(inp.articleUrl)}</a>`, `${inp.s.articleLink} ${inp.articleUrl}`);
	for (const o of inp.offersOther) {
		both('', '');
		both(esc(o.disclosure), o.disclosure);
		both(`<a href="${esc(o.url)}">${esc(o.name)}</a>`, `${o.name}: ${o.url}`);
	}
	both('', '');
	both(`${esc(inp.s.subscribeLine)} <a href="${esc(inp.subscribeUrl)}">${esc(inp.subscribeUrl)}</a>`, `${inp.s.subscribeLine} ${inp.subscribeUrl}`);
	const plain = text.join('\n');
	return {html: html.join('\n'), text: plain, visibleLength: [...plain].length};
};

export const LINKEDIN_LIMIT = 3000;
export const LINKEDIN_FOLD = 210;

export const linkedinPost = (inp: SocialInput): {text: string; length: number; hookLength: number} => {
	const lines: string[] = [];
	const hook = `${inp.developing ? `${inp.developing} ` : ''}${inp.hook ?? inp.title}`;
	lines.push(hook, '', inp.summary);
	if (inp.fictionNote) lines.push('', inp.fictionNote);
	if (inp.takeaways.length) {
		lines.push('');
		for (const t of inp.takeaways) lines.push(`• ${t}`);
	}
	lines.push('', ...linkLines(inp, true));
	for (const o of inp.offersOther) lines.push('', o.disclosure, `${o.name}: ${o.url}`);
	lines.push('', `${inp.s.subscribeLine} ${inp.subscribeUrl}`);
	if (inp.hashtags.length) lines.push('', inp.hashtags.map((h) => `#${h}`).join(' '));
	const text = lines.join('\n');
	return {text, length: [...text].length, hookLength: [...hook].length};
};
