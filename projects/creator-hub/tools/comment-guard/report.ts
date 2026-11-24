/**
 * Guard reports: a JSON file (machine-readable; `guard apply --from-report` reads it back) and a Markdown
 * file for the owner. Comment text and names are untrusted, so the Markdown escapes them and links only
 * to IDs that pass a strict pattern.
 *
 * Reports contain commenters' names and text. They are written under out/ (gitignored): keep them private.
 */
import {mkdirSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {type Action, HOLD_AT, type Reason, REVIEW_AT} from './classifier.ts';
import type {ModerationStatus} from './youtube.ts';

export type ReportItem = {
	commentId: string;
	threadId: string;
	parentId: string | null;
	videoId: string | null;
	author: string;
	authorChannelId: string | null;
	authorChannelUrl: string | null;
	publishedAt: string | null;
	text: string;
	score: number;
	action: Action;
	reasons: Reason[];
};

export type AppliedResult = {
	status: ModerationStatus;
	done: string[];
	failed: {id: string; error: string}[];
	notAttempted: {id: string; reason: string}[];
};

export type Report = {
	version: 1;
	tool: 'comment-guard';
	mode: 'scan' | 'apply';
	generatedAt: string;
	source: 'youtube' | 'file';
	channel: {id: string | null; title: string | null};
	thresholds: {hold: number; review: number};
	totals: {scanned: number; threads: number | null; hold: number; review: number; allow: number};
	/** Why the scan stopped early, if it did (quota budget, --max-threads). */
	truncated: string | null;
	quota: {budget: number; used: number; calls: Record<string, number>} | null;
	/** Only 'hold' and 'review' comments, highest score first. */
	items: ReportItem[];
	applied: AppliedResult | null;
};

export const newReport = (fields: Omit<Report, 'version' | 'tool' | 'thresholds' | 'totals' | 'applied'> & {scanned: ReportItem[]; threads: number | null}): Report => {
	const count = (action: Action) => fields.scanned.filter((item) => item.action === action).length;
	return {
		version: 1,
		tool: 'comment-guard',
		mode: fields.mode,
		generatedAt: fields.generatedAt,
		source: fields.source,
		channel: fields.channel,
		thresholds: {hold: HOLD_AT, review: REVIEW_AT},
		totals: {scanned: fields.scanned.length, threads: fields.threads, hold: count('hold'), review: count('review'), allow: count('allow')},
		truncated: fields.truncated,
		quota: fields.quota,
		items: fields.scanned.filter((item) => item.action !== 'allow').sort((a, b) => b.score - a.score),
		applied: null,
	};
};

/* ------------------------------------------------------------------ reading a report back */

const COMMENT_ID = /^[A-Za-z0-9_.-]{6,200}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{6,64}$/;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

/** Reads a report written by this tool, keeping only well-formed items. */
export const readReport = (path: string): Report => {
	const data = JSON.parse(readFileSync(path, 'utf8')) as Partial<Report> | null;
	if (!data || data.version !== 1 || data.tool !== 'comment-guard' || !Array.isArray(data.items) || !data.channel) {
		throw new Error(`${path} is not a comment-guard report.`);
	}
	const items = data.items.filter(
		(item): item is ReportItem =>
			typeof item === 'object' && item !== null && typeof item.commentId === 'string' && COMMENT_ID.test(item.commentId) && (item.action === 'hold' || item.action === 'review'),
	);
	return {...(data as Report), items};
};

/** "latest" means the newest guard-*.json in the report directory. */
export const resolveReport = (value: string, dir: string): string => {
	if (value !== 'latest') return value;
	const files = readdirSync(dir).filter((name) => /^guard-(?:scan|apply)-\d{8}-\d{6}\.json$/.test(name)).sort();
	const newest = files.at(-1);
	if (!newest) throw new Error(`No report found in ${dir}. Run "guard scan" first.`);
	return join(dir, newest);
};

/* ------------------------------------------------------------------ Markdown */

/** Control and bidirectional-override characters could hide or reorder text in a viewer. */
const UNSAFE_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F​-‏‪-‮⁦-⁩﻿]/gu;

/** Escapes untrusted text for Markdown and HTML: nothing in a comment can become a link, heading or tag. */
export const mdText = (text: string, max = 600): string => {
	const clean = text.replace(UNSAFE_CHARS, '').replace(/\r\n?/g, '\n').trim();
	const clipped = clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
	return clipped
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/([\\`*_[\]{}#|~!])/g, '\\$1')
		.replace(/^(\s*)([-+=]|\d+[.)])/gm, '$1\\$2');
};

const quote = (text: string): string =>
	mdText(text)
		.split('\n')
		.map((line) => `> ${line}`)
		.join('\n');

const commentLink = (item: ReportItem): string | null =>
	item.videoId && VIDEO_ID.test(item.videoId) && COMMENT_ID.test(item.commentId)
		? `https://www.youtube.com/watch?v=${item.videoId}&lc=${item.commentId}`
		: null;

const channelLink = (channelId: string | null): string | null => (channelId && CHANNEL_ID.test(channelId) ? `https://www.youtube.com/channel/${channelId}` : null);

const renderItem = (item: ReportItem, n: number): string => {
	const link = commentLink(item);
	const title = `### ${n}. ${mdText(item.author || '(no name)', 120)} · score ${item.score}${link ? ` · [open on YouTube](${link})` : ''}`;
	const meta = [`comment id \`${item.commentId}\``, item.parentId ? 'reply' : 'top-level comment', item.publishedAt ? `posted ${item.publishedAt.slice(0, 10)}` : null]
		.filter(Boolean)
		.join(' · ');
	const reasons = item.reasons.map(
		(reason) => `- **${reason.rule}** (${reason.weight > 0 ? '+' : ''}${reason.weight}): ${mdText(reason.explanation, 300)}${reason.evidence ? ` Matched: “${mdText(reason.evidence, 120)}”` : ''}`,
	);
	return [title, meta, '', quote(item.text), '', ...reasons].join('\n');
};

export const renderMarkdown = (report: Report): string => {
	const held = report.items.filter((item) => item.action === 'hold');
	const review = report.items.filter((item) => item.action === 'review');
	const applied = report.applied;
	const channel = report.channel.title ? mdText(report.channel.title, 120) : 'your channel';
	const out: string[] = [`# Comment guard report: ${channel}`, ''];

	if (report.mode === 'scan') {
		out.push(`**Dry run: nothing was changed on YouTube.** Generated ${report.generatedAt} from ${report.source === 'youtube' ? 'the YouTube Data API' : 'a local file'}.`);
	} else if (applied) {
		out.push(
			`**Applied:** ${applied.done.length} comment(s) set to \`${applied.status}\`, ${applied.failed.length} failed, ${applied.notAttempted.length} not attempted. Generated ${report.generatedAt}.`,
		);
	}
	out.push(
		'',
		'| Comments scanned | Threads | To hold | For review | Allowed | Quota used |',
		'| ---: | ---: | ---: | ---: | ---: | ---: |',
		`| ${report.totals.scanned} | ${report.totals.threads ?? '–'} | ${report.totals.hold} | ${report.totals.review} | ${report.totals.allow} | ${report.quota ? `${report.quota.used} of ${report.quota.budget}` : '–'} |`,
		'',
		`Scores: ${report.thresholds.hold} or more = hold, ${report.thresholds.review} to ${report.thresholds.hold - 1} = review (listed only, never changed), lower = allow.`,
	);
	if (report.truncated) out.push('', `Note: the scan stopped early (${mdText(report.truncated)}), so older comments were not checked.`);
	out.push(
		'',
		'Holding is reversible: held comments wait in YouTube Studio > Comments > **Held for review**, where you can approve them. ' +
			'To undo with the guard: `npm run guard -- release --confirm <comment id>`. The guard never deletes comments or bans accounts.',
	);

	if (applied?.failed.length) {
		out.push('', '## Could not be held', '', ...applied.failed.map((f) => `- \`${f.id}\`: ${mdText(f.error, 200)}`));
	}
	if (applied?.notAttempted.length) {
		out.push('', '## Not attempted', '', ...applied.notAttempted.map((f) => `- \`${f.id}\`: ${mdText(f.reason, 200)}`));
	}

	const heading = report.mode === 'apply' ? 'Held for review' : 'Would hold';
	out.push('', `## ${heading} (${held.length})`, '');
	out.push(held.length ? held.map((item, i) => renderItem(item, i + 1)).join('\n\n') : 'None.');
	out.push('', `## For your review (${review.length})`, '', 'Suspicious but not certain. The guard does not touch these; check them in YouTube Studio.', '');
	out.push(review.length ? review.map((item, i) => renderItem(item, i + 1)).join('\n\n') : 'None.');

	const offenders = new Map<string, {name: string; url: string; count: number}>();
	for (const item of held) {
		const url = channelLink(item.authorChannelId);
		if (!url || !item.authorChannelId) continue;
		const entry = offenders.get(item.authorChannelId) ?? {name: item.author, url, count: 0};
		entry.count++;
		offenders.set(item.authorChannelId, entry);
	}
	out.push('', '## Accounts to consider hiding', '');
	if (offenders.size) {
		out.push(
			'Your decision, not automatic: YouTube Studio > Settings > Community (Content controls) > **Hidden users**. Their future comments will not be shown to anyone else.',
			'',
			...[...offenders.values()].map((o) => `- ${mdText(o.name, 120)}: ${o.url} (${o.count} held)`),
		);
	} else {
		out.push('None.');
	}
	out.push('', '---', '', 'This report contains commenters\' names and text. Keep it private (out/ is gitignored).', '');
	return out.join('\n');
};

/** Writes guard-<mode>-<YYYYMMDD-HHMMSS>.json and .md into `dir` and returns their paths. */
export const writeReport = (dir: string, report: Report): {json: string; markdown: string} => {
	mkdirSync(dir, {recursive: true});
	const stamp = report.generatedAt.replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
	const base = join(dir, `guard-${report.mode}-${stamp}`);
	const json = `${base}.json`;
	const markdown = `${base}.md`;
	writeFileSync(json, `${JSON.stringify(report, null, '\t')}\n`, {mode: 0o600});
	writeFileSync(markdown, renderMarkdown(report), {mode: 0o600});
	return {json, markdown};
};
