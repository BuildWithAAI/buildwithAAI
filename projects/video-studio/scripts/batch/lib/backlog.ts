/**
 * content/<channel>/backlog.json: each channel's evergreen ideas, in the order the planner takes them. Strict
 * validation: the backlog is what a writer session works from, so a vague or malformed idea is refused here rather
 * than discovered mid-week.
 */
import {DUB_LANGS, type Backlog, type ChannelBatchConfig, type DubLang, type FactNeed, type FactStatus, type Idea, type IdeaStatus} from './types.ts';
import {isDate, parseWeek, weekId} from './week.ts';
import {isRecord, readJson, rel, str, UsageError} from './util.ts';

const ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
const FACT_STATUSES: FactStatus[] = ['fact-bank', 'researched', 'research needed'];
const IDEA_STATUSES: IdeaStatus[] = ['idea', 'published', 'dropped'];

export const parseBacklog = (data: unknown, source: string, channel: ChannelBatchConfig, sha: string): Backlog => {
	const problems: string[] = [];
	const bad = (m: string) => problems.push(`${source}: ${m}`);
	if (!isRecord(data) || data.version !== 1) throw new UsageError(`${source}: expected a backlog {"version": 1, "channel": ..., "ideas": [...]}`);
	if (data.channel !== channel.channel) bad(`"channel" must be "${channel.channel}"`);
	const updated = str(data.updated) ?? '';
	if (!isDate(updated)) bad('"updated" must be a date (YYYY-MM-DD)');
	const rules = Array.isArray(data.rules) ? data.rules.filter((r): r is string => typeof r === 'string') : [];
	const ideas: Idea[] = [];
	if (!Array.isArray(data.ideas) || !data.ideas.length || data.ideas.length > 100) bad('"ideas" must hold 1-100 ideas');
	for (const [i, raw] of (Array.isArray(data.ideas) ? data.ideas : []).entries()) {
		const at = `ideas[${i}]`;
		if (!isRecord(raw)) {
			bad(`${at} must be an object`);
			continue;
		}
		const id = str(raw.id) ?? '';
		const where = id ? `idea "${id}"` : at;
		if (!ID.test(id)) bad(`${at}.id must be lowercase letters, digits and dashes (2-64)`);
		const slug = raw.slug === undefined ? id : (str(raw.slug) ?? '');
		if (!ID.test(slug) || slug.startsWith('_')) bad(`${where}: slug must be lowercase letters, digits and dashes`);
		const title = str(raw.title) ?? '';
		if (!title || title.length > 100 || /[<>]/.test(title)) bad(`${where}: title must be 1-100 characters with no < or >`);
		const format = str(raw.format) ?? '';
		if (!channel.formats[format]) bad(`${where}: format "${format}" is not one of ${Object.keys(channel.formats).join(', ')}`);
		const status = (raw.status ?? 'idea') as IdeaStatus;
		if (!IDEA_STATUSES.includes(status)) bad(`${where}: status must be ${IDEA_STATUSES.join(', ')}`);
		const priority = raw.priority;
		if (typeof priority !== 'number' || !Number.isInteger(priority) || priority < 1) bad(`${where}: priority must be a whole number of at least 1`);
		let week: string | null = null;
		if (raw.week !== undefined && raw.week !== null) {
			const w = typeof raw.week === 'string' ? parseWeek(raw.week) : null;
			if (!w) bad(`${where}: week must be null or an ISO week like 2026-W49`);
			else week = weekId(w);
		}
		const angle = str(raw.angle) ?? '';
		if (angle.length < 40) bad(`${where}: angle must say in at least a sentence what the video argues and how it ends`);
		const evergreenTopic = str(raw.evergreenTopic) ?? '';
		if (!/^[a-z0-9][a-z0-9-]{1,47}$/.test(evergreenTopic)) bad(`${where}: evergreenTopic must be a topic id like "drainers"`);
		const relatedTopics = Array.isArray(raw.relatedTopics) ? raw.relatedTopics.filter((t): t is string => typeof t === 'string') : [];
		const factTags = Array.isArray(raw.factTags) ? raw.factTags.filter((t): t is string => typeof t === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(t)) : [];
		if (Array.isArray(raw.factTags) && factTags.length !== raw.factTags.length) bad(`${where}: factTags must be lowercase kebab-case tags`);
		const research = raw.research === undefined || raw.research === null ? null : str(raw.research);
		if (research !== null && !/^content\/[a-z0-9-]+\/[a-z0-9_-]+\/research\.md$/.test(research)) bad(`${where}: research must be null or content/<channel>/<slug>/research.md`);
		const facts: FactNeed[] = [];
		if (!Array.isArray(raw.facts) || !raw.facts.length) bad(`${where}: facts must list the facts the script needs (fact-bank ids or "research needed")`);
		for (const [k, f] of (Array.isArray(raw.facts) ? raw.facts : []).entries()) {
			if (!isRecord(f) || !str(f.need) || !FACT_STATUSES.includes(f.status as FactStatus)) {
				bad(`${where}: facts[${k}] needs {need, factId, status: ${FACT_STATUSES.join(' | ')}}`);
				continue;
			}
			const factId = f.factId === undefined || f.factId === null ? null : str(f.factId);
			if (f.status === 'fact-bank' && !factId) bad(`${where}: facts[${k}] has status "fact-bank" but no factId`);
			if (f.status !== 'fact-bank' && factId) bad(`${where}: facts[${k}] has a factId, so its status must be "fact-bank"`);
			facts.push({need: String(f.need), factId, status: f.status as FactStatus, ...(str(f.lead) ? {lead: String(f.lead)} : {})});
		}
		const risks = Array.isArray(raw.risks) ? raw.risks.filter((r): r is string => typeof r === 'string' && !!r.trim()) : [];
		if (!risks.length) bad(`${where}: risks must list at least one risk note`);
		const langs = isRecord(raw.languages) ? raw.languages : {};
		if (langs.master !== 'en') bad(`${where}: languages.master must be "en" (the master language)`);
		const dubs = Array.isArray(langs.dubs) ? langs.dubs : [];
		const badDubs = dubs.filter((d) => !(DUB_LANGS as readonly unknown[]).includes(d));
		if (badDubs.length) bad(`${where}: languages.dubs may only hold ${DUB_LANGS.join(', ')} (fr has no male Kokoro voice; ja is blocked until a real G2P works)`);
		const shortIdeas = Array.isArray(raw.shortIdeas) ? raw.shortIdeas.filter((s): s is string => typeof s === 'string' && !!s.trim()) : [];
		ideas.push({
			id,
			slug,
			title,
			format,
			status,
			priority: typeof priority === 'number' ? priority : 999,
			week,
			role: str(raw.role),
			angle,
			evergreenTopic,
			relatedTopics,
			factTags,
			research,
			facts,
			risks,
			languages: {master: 'en', dubs: dubs.filter((d): d is DubLang => (DUB_LANGS as readonly unknown[]).includes(d))},
			shortIdeas,
			notes: str(raw.notes),
		});
	}
	const seen = new Set<string>();
	for (const idea of ideas) {
		if (seen.has(idea.id)) bad(`idea id "${idea.id}" is used twice`);
		seen.add(idea.id);
	}
	if (problems.length) throw new UsageError(problems);
	return {version: 1, channel: channel.channel, updated, status: str(data.status) ?? 'proposal', rules, ideas, path: source, sha256: sha};
};

export const loadBacklog = (path: string, root: string, channel: ChannelBatchConfig): Backlog => {
	const read = readJson(path);
	if (!read.ok) throw new UsageError(`Backlog for ${channel.channel}: ${read.error}`);
	return parseBacklog(read.data, rel(root, path), channel, read.sha256);
};

/** Slugs name content/<channel>/<slug>/ and the claim reports (out/claims/<slug>.<lang>.json), so they must be unique across channels. */
export const crossBacklogProblems = (backlogs: Backlog[]): string[] => {
	const owner = new Map<string, string>();
	const problems: string[] = [];
	for (const b of backlogs) {
		for (const idea of b.ideas) {
			const prior = owner.get(idea.slug);
			if (prior) problems.push(`slug "${idea.slug}" is used by ${prior} and ${b.channel}/${idea.id}: claim reports are keyed by slug, so slugs must be unique across channels`);
			else owner.set(idea.slug, `${b.channel}/${idea.id}`);
		}
	}
	return problems;
};

/** Evergreen topics a backlog uses that a known topic list does not have (a warning: the news Shorts link explainers by topic). */
export const unknownTopics = (backlog: Backlog, known: Set<string>): string[] =>
	backlog.ideas.filter((i) => !known.has(i.evergreenTopic)).map((i) => `${backlog.channel}/${i.id}: evergreen topic "${i.evergreenTopic}" is not in the channel's evergreen map`);
