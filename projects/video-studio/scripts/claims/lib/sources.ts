/**
 * storyboard.sources checks (pure): every source is verified, https, has an accessed date, and carries no private name
 * or wallet address (the repo is public). Cited-but-missing ids are reported where they are cited (check.ts).
 */
import type {Source} from '../../../src/episode/types.ts';
import type {Finding, SourceRow} from './types.ts';
import {findNames, redactNames, type NameList} from './names.ts';
import {findWallets, KIND_LABEL, redactWallets} from './wallets.ts';
import {isRecord} from './load.ts';

const SRC_ID = /^[A-Za-z0-9][A-Za-z0-9_.:\-/]*$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
export const STALE_DAYS = 180;

const validDate = (s: string): boolean => {
	const m = ISO_DATE.exec(s);
	if (!m) return false;
	const d = new Date(`${s}T00:00:00Z`);
	return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const daysBetween = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export const checkSources = (sources: unknown, citedBy: Map<string, string[]>, today: string, names: NameList): {findings: Finding[]; rows: SourceRow[]; ids: Set<string>} => {
	const findings: Finding[] = [];
	const rows: SourceRow[] = [];
	const ids = new Set<string>();
	const safe = (s: string) => redactWallets(redactNames(s, names));
	if (!Array.isArray(sources)) {
		findings.push({level: 'error', rule: 'sources-shape', where: 'sources', message: 'storyboard.sources must be an array', fix: 'Set "sources": [] or list the sources the narration cites.'});
		return {findings, rows, ids};
	}
	sources.forEach((raw, i) => {
		const src = (isRecord(raw) ? raw : {}) as Partial<Source> & Record<string, unknown>;
		const id = typeof src.id === 'string' ? src.id : '';
		const where = `sources[${id || i}]`;
		const cites = citedBy.get(id) ?? [];
		// a source failure names the scenes whose claims it was meant to back
		const citedIn = cites.length ? ` (cited in ${cites.join(', ')})` : ' (not cited)';
		const err = (rule: string, message: string, fix: string) => findings.push({level: 'error', rule, where, scene: cites[0], message: `${message}${citedIn}`, fix});
		const warn = (rule: string, message: string, fix: string) => findings.push({level: 'warning', rule, where, scene: cites[0], message, fix});
		if (!isRecord(raw)) {
			err('source-shape', 'a source must be an object', 'Use {"id", "title", "url", "accessed", "status", "quote"}.');
			return;
		}
		if (!id || !SRC_ID.test(id)) err('source-id', `bad id ${JSON.stringify(src.id)}`, 'Use letters, digits and - _ . : / (it is cited as [src:id]).');
		else if (ids.has(id)) err('source-duplicate', `duplicate source id "${id}"`, 'Give every source its own id.');
		if (id) ids.add(id);
		const title = typeof src.title === 'string' ? src.title.trim() : '';
		const url = typeof src.url === 'string' ? src.url.trim() : '';
		const accessed = typeof src.accessed === 'string' ? src.accessed.trim() : '';
		const status = typeof src.status === 'string' ? src.status : '';
		if (!title) err('source-title', 'the source has no title', 'Add the article or document title.');
		let https = false;
		try {
			https = new URL(url).protocol === 'https:';
		} catch {
			https = false;
		}
		if (!url) err('source-url', 'the source has no url', 'Add the https URL of the page that supports the claim.');
		else if (!https) err('source-not-https', `the url is not https (${safe(url)})`, 'Link the https version of the page; if none exists, find another source.');
		if (!accessed) err('source-no-accessed', 'the source has no accessed date', 'Add "accessed": "YYYY-MM-DD", the day someone read the page.');
		else if (!validDate(accessed)) err('source-no-accessed', `accessed "${accessed}" is not a YYYY-MM-DD date`, 'Write the date as YYYY-MM-DD.');
		else if (accessed > today) err('source-accessed-future', `accessed ${accessed} is after today (${today})`, 'Use the real date the page was read.');
		else if (daysBetween(accessed, today) > STALE_DAYS)
			warn('source-stale', `read ${daysBetween(accessed, today)} days ago (${accessed})`, `Facts about markets, prices and AI products need current sources: re-read the page and update "accessed" (older than ${STALE_DAYS} days).`);
		if (status === 'unverified') err('source-unverified', 'the source is marked unverified', 'Verify the claim against the page (status "verified"), or cut every sentence that cites it.');
		else if (status !== 'verified') err('source-status', `status must be "verified" or "unverified" (got ${JSON.stringify(src.status)})`, 'Set "status": "verified" once the claim was checked against the page.');
		if (!cites.length) warn('source-unused', 'no narration cites this source', 'Cite it with [src:' + (id || 'id') + '] after the claim it backs, or remove it.');
		else if (typeof src.quote !== 'string' || !src.quote.trim()) warn('source-no-quote', 'no quote: the exact supporting sentence is missing', 'Add "quote": the sentence from the page that supports the claim, so a reviewer can check it quickly.');
		for (const [field, value] of [
			['title', title],
			['url', url],
			['quote', typeof src.quote === 'string' ? src.quote : ''],
		] as const) {
			if (!value) continue;
			const hitNames = findNames(value, names);
			if (hitNames.length) err('private-name', `the ${field} contains private name #${hitNames.join(', #')} (from the private names list)`, 'Remove the name; this repo is public.');
			const w = findWallets(value).filter((h) => h.level === 'error');
			if (w.length) err('wallet-address', `the ${field} contains ${KIND_LABEL[w[0].kind]}`, 'Link the investigator\'s article, not an explorer page for a real wallet; never commit real addresses.');
		}
		rows.push({id: id || `#${i}`, title: safe(title), url: safe(url), accessed, status, citedBy: cites});
	});
	return {findings, rows, ids};
};
