/**
 * to-storyboard (pure): narration cites bank facts as [fact:<id>] (or [fact:a,b]); this turns every tag into the claim
 * gate's own markup, [src:<id>], and puts one sources[] entry per fact (its best citable source, quote = excerpt,
 * status "verified"). The claim gate (scripts/claims) then runs unchanged. It refuses: unknown ids, invalid, unverified
 * or stale facts, tags outside narration or inside {display|spoken} markup, and an existing source id that points
 * elsewhere. Sources it wrote before (same id, one of the fact's URLs) are refreshed, so re-running it re-checks
 * freshness: a fact that went stale since the last run fails the gate here, before voice and render.
 */
import {parseMarkup} from '../../../src/episode/markup.ts';
import type {Source} from '../../../src/episode/types.ts';
import {citableSources, FACT_ID, validateFact, type ValidateContext} from './schema.ts';
import {freshness} from './stale.ts';
import type {Fact, FactSource, Finding} from './types.ts';

export type FactTag = {start: number; end: number; raw: string; ids: string[]; inMarkup: boolean; bad: string[]};

/** Every [fact:...] tag of a narration, with whether it sits inside {display|spoken} markup. */
export const scanFactTags = (narration: string): FactTag[] => {
	const out: FactTag[] = [];
	let inBrace = false;
	for (let i = 0; i < narration.length; i++) {
		const c = narration[i];
		if (c === '{') inBrace = true;
		else if (c === '}') inBrace = false;
		else if (c === '[' && narration.startsWith('[fact:', i)) {
			const close = narration.indexOf(']', i);
			const end = close < 0 ? narration.length : close + 1;
			const raw = narration.slice(i, end);
			const body = close < 0 ? narration.slice(i + 6) : narration.slice(i + 6, close);
			const ids = body.split(',').map((s) => s.trim());
			out.push({start: i, end, raw, ids: ids.filter((id) => FACT_ID.test(id)), inMarkup: inBrace, bad: close < 0 ? [raw] : ids.filter((id) => !FACT_ID.test(id))});
			i = end - 1;
		}
	}
	return out;
};

/** Ids of the [src:...] tags in a narration (outside {...}, like the markup parser). */
export const srcIds = (narration: string): string[] => {
	const out: string[] = [];
	let inBrace = false;
	for (let i = 0; i < narration.length; i++) {
		const c = narration[i];
		if (c === '{') inBrace = true;
		else if (c === '}') inBrace = false;
		else if (!inBrace && c === '[' && narration.startsWith('[src:', i)) {
			const close = narration.indexOf(']', i);
			if (close < 0) break;
			out.push(...narration.slice(i + 5, close).split(',').map((s) => s.trim()).filter(Boolean));
			i = close;
		}
	}
	return out;
};

/** Paths of strings outside scenes[].narration that contain "[fact:" (titles, onScreen text, thumbnails...). */
export const factTagsOutsideNarration = (x: unknown, path = ''): string[] => {
	if (typeof x === 'string') return x.includes('[fact:') && !/^scenes\[\d+\]\.narration$/.test(path) ? [path || '(root)'] : [];
	if (Array.isArray(x)) return x.flatMap((v, i) => factTagsOutsideNarration(v, `${path}[${i}]`));
	if (x && typeof x === 'object') return Object.entries(x).flatMap(([k, v]) => factTagsOutsideNarration(v, path ? `${path}.${k}` : k));
	return [];
};

const RANK = {primary: 0, secondary: 1, tertiary: 2} as const;
const directlyRead = (s: FactSource): boolean => {
	const last = s.checks[s.checks.length - 1];
	return Boolean(last && last.result === 'found' && (last.by === 'verify' || last.by === 'person'));
};

/** The source a storyboard cites for a fact: directly read first, then the stronger tier, then the most recent read. */
export const primarySource = (fact: Fact): FactSource | null => {
	const c = citableSources(fact);
	if (!c.length) return null;
	return [...c].sort((a, b) => Number(directlyRead(b)) - Number(directlyRead(a)) || RANK[a.tier] - RANK[b.tier] || b.accessed.localeCompare(a.accessed))[0];
};

/** The claim gate's Source for a fact. The sources card shows "title · domain", so a source's cardTitle (if any) replaces an unsafe headline. */
export const toStoryboardSource = (fact: Fact, s: FactSource): Source => ({id: fact.id, title: s.cardTitle ?? s.title, url: s.url, quote: s.excerpt, accessed: s.accessed, status: 'verified'});

export type ResolveOptions = ValidateContext & {requireDirect?: boolean};

export type ResolveResult = {
	storyboard: Record<string, unknown>;
	findings: Finding[];
	/** Fact ids the storyboard now cites (tags resolved now or refreshed). */
	used: string[];
	added: string[];
	refreshed: string[];
	tags: number;
	changed: boolean;
};

type SceneLike = {id?: unknown; narration?: unknown};

export const resolveStoryboard = (input: Record<string, unknown>, facts: Fact[], opts: ResolveOptions): ResolveResult => {
	const sb = structuredClone(input);
	const findings: Finding[] = [];
	const err = (rule: string, where: string, message: string, fact?: string) => findings.push({level: 'error', rule, where, message, fact});
	const warn = (rule: string, where: string, message: string, fact?: string) => findings.push({level: 'warning', rule, where, message, fact});
	const bank = new Map(facts.map((f) => [f.id, f]));
	const scenes = (Array.isArray(sb.scenes) ? sb.scenes : []) as SceneLike[];
	const sources = (Array.isArray(sb.sources) ? sb.sources : []) as Array<Record<string, unknown>>;
	if (!Array.isArray(sb.scenes)) err('storyboard-shape', 'scenes', 'the storyboard has no scenes array');
	if (!Array.isArray(sb.sources)) err('storyboard-shape', 'sources', 'the storyboard has no sources array ("sources": [] is fine)');

	for (const p of factTagsOutsideNarration(sb)) err('fact-tag-outside-narration', p, '[fact:] tags work only in scene narration; on-screen text and titles cannot cite');

	const wanted = new Map<string, string[]>(); // fact id -> where it is cited
	let tagCount = 0;
	scenes.forEach((sc, i) => {
		if (typeof sc?.narration !== 'string') return;
		const where = `scenes[${i}]${typeof sc.id === 'string' ? ` (${sc.id})` : ''}.narration`;
		for (const t of scanFactTags(sc.narration)) {
			tagCount++;
			if (t.inMarkup) err('fact-tag-in-markup', where, `${t.raw} sits inside {display|spoken} markup; put it after the closing brace`);
			for (const b of t.bad) err('fact-tag-id', where, `bad fact id in ${JSON.stringify(b)} (ids are a-z, 0-9 and hyphens)`);
			for (const id of t.ids) wanted.set(id, [...(wanted.get(id) ?? []), where]);
		}
		// [src:<fact id>] written by an earlier run: refresh it
		for (const id of srcIds(sc.narration)) if (bank.has(id) && !wanted.has(id)) wanted.set(id, [where]);
	});

	const used: string[] = [];
	const added: string[] = [];
	const refreshed: string[] = [];
	const replacement = new Map<string, Source>();
	for (const [id, where] of wanted) {
		const w = where[0];
		const fact = bank.get(id);
		if (!fact) {
			err('unknown-fact', w, `no fact "${id}" in the bank (search: node scripts/facts/cli.ts search <words>)`, id);
			continue;
		}
		const problems = validateFact(fact, opts).filter((f) => f.level === 'error');
		if (problems.length) {
			err('fact-invalid', w, `fact "${id}" fails validation (${problems.length} error${problems.length === 1 ? '' : 's'}, first: ${problems[0].where}: ${problems[0].message}); fix it with node scripts/facts/cli.ts validate`, id);
			continue;
		}
		const fr = freshness(fact, opts.today);
		if (fr.state === 'unverified') {
			err('fact-unverified', w, `fact "${id}" is unverified; verify it first (node scripts/facts/cli.ts verify ${id})`, id);
			continue;
		}
		if (fr.state === 'stale') {
			err('fact-stale', w, `fact "${id}" went stale after ${fr.recheckAfter} (${fr.overdueDays} day${fr.overdueDays === 1 ? '' : 's'} ago); re-verify it (node scripts/facts/cli.ts verify ${id})`, id);
			continue;
		}
		if (fact.verification === 'search-extract') {
			if (opts.requireDirect) {
				err('fact-search-extract', w, `fact "${id}" rests on search-engine extracts only (--require-direct): verify or confirm it on the page`, id);
				continue;
			}
			warn('fact-search-extract', w, `fact "${id}" rests on search-engine extracts only; nobody has opened the page. Verify or confirm it before publishing.`, id);
		}
		const primary = primarySource(fact);
		if (!primary) {
			err('fact-no-source', w, `fact "${id}" has no citable source (every source failed its last direct read)`, id);
			continue;
		}
		const existing = sources.find((s) => s && s.id === id);
		if (existing && !fact.sources.some((s) => s.url === existing.url)) {
			err('source-id-conflict', `sources[${id}]`, `the storyboard already has a source "${id}" that points elsewhere (${String(existing.url)}); rename that source`, id);
			continue;
		}
		const lang = typeof sb.lang === 'string' ? sb.lang : 'en';
		if (lang !== 'en' && !(fact.languages as Record<string, unknown>)[lang])
			warn('no-translation', w, `fact "${id}" has no ${lang} statement in the bank; check the translated narration against the English claim`, id);
		replacement.set(id, toStoryboardSource(fact, primary));
		used.push(id);
		if (!existing) added.push(id);
		else if (JSON.stringify(existing) !== JSON.stringify(replacement.get(id))) refreshed.push(id);
	}

	const failed = findings.some((f) => f.level === 'error');
	if (!failed) {
		scenes.forEach((sc, i) => {
			if (typeof sc?.narration !== 'string' || !sc.narration.includes('[fact:')) return;
			let n = sc.narration;
			for (const t of scanFactTags(sc.narration).reverse()) n = `${n.slice(0, t.start)}[src:${t.ids.join(',')}]${n.slice(t.end)}`;
			try {
				parseMarkup(n);
			} catch (e) {
				err('markup', `scenes[${i}].narration`, `the narration does not parse after resolving: ${(e as Error).message}`);
			}
			sc.narration = n;
		});
		const next = sources.map((s) => (s && typeof s.id === 'string' && replacement.has(s.id) ? (replacement.get(s.id) as unknown as Record<string, unknown>) : s));
		for (const id of added) next.push(replacement.get(id) as unknown as Record<string, unknown>);
		sb.sources = next;
	}
	const ok = !findings.some((f) => f.level === 'error');
	return {storyboard: ok ? sb : structuredClone(input), findings, used: ok ? used : [], added: ok ? added : [], refreshed: ok ? refreshed : [], tags: tagCount, changed: ok && JSON.stringify(sb) !== JSON.stringify(input)};
};

/** The [start, end) span of a top-level key's value in a JSON object text, or null. */
export const topLevelValueSpan = (text: string, key: string): {start: number; end: number; keyStart: number} | null => {
	let i = 0;
	const ws = () => {
		while (i < text.length && /\s/.test(text[i])) i++;
	};
	const str = (): string => {
		const s = i;
		i++;
		while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
		i++;
		return JSON.parse(text.slice(s, i)) as string;
	};
	const value = () => {
		ws();
		const c = text[i];
		if (c === '"') {
			str();
			return;
		}
		if (c === '{' || c === '[') {
			let depth = 0;
			while (i < text.length) {
				const d = text[i];
				if (d === '"') {
					str();
					continue;
				}
				if (d === '{' || d === '[') depth++;
				else if (d === '}' || d === ']') {
					depth--;
					if (depth === 0) {
						i++;
						return;
					}
				}
				i++;
			}
			return;
		}
		while (i < text.length && !/[,}\]\s]/.test(text[i])) i++;
	};
	ws();
	if (text[i] !== '{') return null;
	i++;
	for (;;) {
		ws();
		if (text[i] === '}' || i >= text.length) return null;
		const keyStart = i;
		const k = str();
		ws();
		if (text[i] !== ':') return null;
		i++;
		ws();
		const start = i;
		value();
		if (k === key) return {start, end: i, keyStart};
		ws();
		if (text[i] === ',') i++;
	}
};

/**
 * The resolved storyboard as text, keeping the author's formatting: tags are swapped in place and only the sources
 * array is re-serialized. Falls back to a plain 2-space JSON dump if the in-place edit does not reproduce the result.
 */
export const rewriteText = (original: string, result: ResolveResult, input: Record<string, unknown>): string => {
	const dump = `${JSON.stringify(result.storyboard, null, 2)}\n`;
	try {
		let t = original;
		const before = (Array.isArray(input.scenes) ? input.scenes : []) as SceneLike[];
		const tagRaws = new Set<string>();
		for (const sc of before) if (typeof sc?.narration === 'string') for (const tag of scanFactTags(sc.narration)) tagRaws.add(tag.raw);
		for (const raw of tagRaws) t = t.split(raw).join(`[src:${scanFactTags(raw)[0].ids.join(',')}]`);
		const span = topLevelValueSpan(t, 'sources');
		if (!span) return dump;
		const lineStart = t.lastIndexOf('\n', span.keyStart) + 1;
		const indent = /^[ \t]*/.exec(t.slice(lineStart))?.[0] ?? '';
		const unit = /\n([ \t]+)"/.exec(t)?.[1] ?? '  ';
		const arr = JSON.stringify(result.storyboard.sources, null, unit).replace(/\n/g, `\n${indent}`);
		t = t.slice(0, span.start) + arr + t.slice(span.end);
		return JSON.stringify(JSON.parse(t)) === JSON.stringify(result.storyboard) ? t : dump;
	} catch {
		return dump;
	}
};
