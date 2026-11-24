/**
 * Searching the bank (pure). Every word of the query must match somewhere in the fact (id, statement, numbers,
 * entities, tags, notes, translations, source titles and publishers); hits in the id, entities and tags rank higher.
 */
import {freshness} from './stale.ts';
import {fold} from './text.ts';
import type {Fact, TranslationLang, Verification} from './types.ts';

const hostOf = (url: string): string => {
	try {
		return new URL(url).hostname;
	} catch {
		return '';
	}
};

export type SearchFilters = {tags?: string[]; entity?: string; status?: Verification | 'fresh' | 'stale' | 'usable'; lang?: TranslationLang; today: string};
export type SearchHit = {fact: Fact; score: number};

const fields = (f: Fact): Array<[string, number]> => [
	[f.id.replace(/-/g, ' '), 4],
	[f.entities.join(' | '), 4],
	[f.tags.join(' ').replace(/-/g, ' '), 3],
	[f.statement, 2],
	[f.numbers.join(' | '), 2],
	[Object.values(f.languages).map((t) => t?.statement ?? '').join(' | '), 1],
	[f.sources.map((s) => `${s.title} ${s.publisher ?? ''} ${hostOf(s.url)}`).join(' | '), 1],
	[f.notes, 1],
];

export const searchFacts = (facts: Fact[], query: string, filters: SearchFilters): SearchHit[] => {
	const terms = fold(query)
		.split(/\s+/)
		.map((t) => t.replace(/^["']|["']$/g, ''))
		.filter(Boolean);
	const hits: SearchHit[] = [];
	for (const f of facts) {
		if (filters.tags?.length && !filters.tags.every((t) => f.tags.includes(t))) continue;
		if (filters.entity && !f.entities.some((e) => fold(e).includes(fold(filters.entity as string)))) continue;
		if (filters.lang && !f.languages[filters.lang]) continue;
		if (filters.status) {
			const state = freshness(f, filters.today).state;
			const ok =
				filters.status === 'fresh' ? state === 'fresh' : filters.status === 'stale' ? state === 'stale' : filters.status === 'usable' ? state === 'fresh' : f.verification === filters.status;
			if (!ok) continue;
		}
		let score = 0;
		let all = true;
		const fs = fields(f).map(([t, w]): [string, number] => [fold(t), w]);
		for (const term of terms) {
			let best = 0;
			for (const [t, w] of fs) if (t.includes(term)) best = Math.max(best, w * (new RegExp(`(?<![\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u').test(t) ? 2 : 1));
			if (!best) {
				all = false;
				break;
			}
			score += best;
		}
		if (all) hits.push({fact: f, score: terms.length ? score : 1});
	}
	return hits.sort((a, b) => b.score - a.score || a.fact.id.localeCompare(b.fact.id));
};
