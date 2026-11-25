/**
 * The gate's working context: the storyboard split into text units (narration sentences, on-screen strings, titles,
 * thumbnails, analysis), the evidence behind every cited source (brief excerpts + titles + dates), the allowlist index
 * with the brief's own names, and attribution resolution. rules.ts runs the rules over it.
 */
import {aliasesOf, buildIndex, normName, validateAllowlist, type AllowIndex, type AllowlistFile, type DynamicName} from './allowlist.ts';
import {findAttributions, type Attribution} from './attribution.ts';
import {factDeveloping, hostOf, normalizeBrief, publisherFor} from './brief.ts';
import {MarkupError, splitNarration, type ClaimSpan, type Pair} from './claims.ts';
import {extractNumbers, isoDateParts, setKnownTickers, type DateParts, type Num} from './numbers.ts';
import {personTokensIn, scanNames, STRONG_PERSON_REASONS, type NameScan} from './names.ts';
import {COMMON, contentStems, coverage, hasPhrase, norm, unique} from './text.ts';
import type {Brief, BriefFact, BriefSource, Finding, NewsAnalysis, NewsStoryboard, Source, StoryboardScene} from './types.ts';

export type UnitKind = 'sentence' | 'short' | 'analysis';

export type Unit = {
	kind: UnitKind;
	surface: string;
	scene?: StoryboardScene;
	sceneIndex?: number;
	sentenceIndex?: number;
	display: string;
	spoken: string;
	srcIds: string[];
	claims: ClaimSpan[];
	pairs: Pair[];
	prev?: Unit;
};

export type Evidence = {
	ids: string[];
	text: string; // normalised excerpts + titles
	excerptText: string; // normalised excerpts only
	/** The stored excerpts and titles as written (for sentence-level checks: figure roles and hedges). */
	raw: string[];
	numbers: Num[];
	dates: DateParts[];
	names: string[]; // publishers, incident names and aliases (normalised)
	facts: BriefFact[];
	sources: BriefSource[];
};

export type NormAnalysis = NewsAnalysis & {index: number; id: string; presentedIn: string[]; numbers: Num[]};

export type Ctx = {
	sb: NewsStoryboard;
	slug: string;
	lang: string;
	brief: Brief;
	allowFile: AllowlistFile;
	idx: AllowIndex;
	units: Unit[];
	scenes: StoryboardScene[];
	sbSources: Map<string, Source>;
	briefSources: Map<string, BriefSource>;
	/** storyboard source id -> brief source id (same id, or matched by URL) */
	resolveId: Map<string, string>;
	sourcePersonTokens: Set<string>;
	/** Person tokens the brief's texts show beyond doubt (a role, an apposition, an age, a speech verb) or name as a person: a link's path that spells one names that person. */
	slugPersonTokens: Set<string>;
	briefText: string;
	analysis: NormAnalysis[];
	findings: Finding[];
	evidence: (ids: string[]) => Evidence;
	scan: (text: string, short?: boolean) => NameScan;
	citedIds: string[]; // every source id cited anywhere in the narration (storyboard ids)
	factsFor: (ids: string[]) => BriefFact[];
	incidentOf: (f: BriefFact) => string | undefined;
	developingFact: (f: BriefFact) => boolean;
};

const EMPTY_ALLOW: AllowlistFile = {
	version: 1,
	show: [],
	publishers: [],
	securityFirms: [],
	organisations: [],
	protocols: [],
	chains: [],
	agencies: [],
	places: [],
	terms: [],
	attributedGroups: [],
	blocked: [],
	aliases: [],
	officials: [],
};
const EMPTY_BRIEF: Brief = {developing: false, incidents: [], facts: [], sources: [], entities: [], opportunities: [], mustNotSay: []};

export type BuildInput = {storyboard: unknown; brief: unknown | null; allowlist: unknown; slug: string; incidentId?: string};

const onScreenStrings = (sc: StoryboardScene): Array<{key: string; value: string}> => {
	const out: Array<{key: string; value: string}> = [];
	for (const [k, v] of Object.entries(sc.onScreen ?? {})) {
		if (typeof v === 'string') out.push({key: k, value: v});
		else if (Array.isArray(v)) v.forEach((x, i) => typeof x === 'string' && out.push({key: `${k}[${i}]`, value: x}));
	}
	return out;
};
export {onScreenStrings};

export const buildContext = (input: BuildInput): Ctx => {
	const findings: Finding[] = [];
	const inputErr = (code: string, message: string, fix: string, surface = 'storyboard') =>
		findings.push({rule: 'INPUT', code: `INPUT.${code}`, severity: 'error', where: {surface}, message, fix});
	const inputWarn = (code: string, message: string, fix: string, surface = 'storyboard') =>
		findings.push({rule: 'INPUT', code: `INPUT.${code}`, severity: 'warning', where: {surface}, message, fix});

	// allowlist
	const al = validateAllowlist(input.allowlist);
	for (const pr of al.problems) inputErr('allowlist', `allowlist.json: ${pr.msg}`, 'Fix scripts/news/allowlist.json (see README "Allowlist").', 'allowlist');
	const allowFile = al.file ?? EMPTY_ALLOW;
	if (allowFile.tickers?.length) setKnownTickers(allowFile.tickers);

	// brief
	let brief = EMPTY_BRIEF;
	if (input.brief === null) inputErr('brief-missing', 'brief.json is missing, so no claim can be traced to a source.', 'Run the news radar for this slug so it writes content/zoora-security/<slug>/brief.json.', 'brief');
	else {
		const nb = normalizeBrief(input.brief, {incidentId: input.incidentId});
		for (const pr of nb.problems)
			(pr.level === 'error' ? inputErr : inputWarn)('brief', `brief.json: ${pr.msg}`, 'Fix the radar output (brief.json): each fact needs {id, text, sourceIds[], excerpts[]}.', 'brief');
		if (nb.brief) brief = nb.brief;
	}

	// storyboard
	const sbRaw = input.storyboard;
	const sb = (sbRaw && typeof sbRaw === 'object' && !Array.isArray(sbRaw) ? sbRaw : {}) as NewsStoryboard;
	if (!sbRaw || typeof sbRaw !== 'object' || Array.isArray(sbRaw)) inputErr('storyboard', 'storyboard.json must be a JSON object.', 'Write a Storyboard (src/episode/types.ts).');
	if (sb.version !== 1) inputErr('version', `storyboard version must be 1 (got ${JSON.stringify(sb.version)}).`, 'Set "version": 1.');
	if (sb.channel !== undefined && sb.channel !== 'zoora-security') inputWarn('channel', `storyboard channel is "${sb.channel}", not "zoora-security".`, 'The news gate is for channel 2 ("zoora-security").');
	if (sb.slug !== undefined && sb.slug !== input.slug) inputWarn('slug', `storyboard slug "${sb.slug}" does not match "${input.slug}".`, 'Keep the folder name and storyboard.slug the same.');
	if (sb.fiction === true) inputErr('fiction', 'storyboard.fiction is true, but news is not fiction.', 'Set "fiction": false. Fictional stories belong on the Zoora AI channel, not the news show.');
	const scenes: StoryboardScene[] = Array.isArray(sb.scenes) ? sb.scenes.filter((s) => s && typeof s === 'object') : [];
	if (!scenes.length) inputErr('scenes', 'storyboard.scenes must be a non-empty array.', 'Add the scenes.');
	const lang = typeof sb.lang === 'string' ? sb.lang : 'en';

	const sbSources = new Map<string, Source>();
	for (const s of Array.isArray(sb.sources) ? sb.sources : []) if (s && typeof s.id === 'string') sbSources.set(s.id, s);
	const briefSources = new Map<string, BriefSource>();
	for (const s of brief.sources) briefSources.set(s.id, s);
	const resolveId = new Map<string, string>();
	const factSourceIds = new Set(brief.facts.flatMap((f) => f.sourceIds));
	for (const [id, s] of sbSources) {
		if (briefSources.has(id) || factSourceIds.has(id)) resolveId.set(id, id);
		else {
			const byUrl = brief.sources.find((b) => b.url && s.url && b.url === s.url);
			if (byUrl) resolveId.set(id, byUrl.id);
		}
	}

	// dynamic names: incident names, publishers, brief entities that are organisations
	const dynamic: DynamicName[] = [];
	const extraAliases: string[][] = [];
	for (const inc of brief.incidents) {
		// a name the radar only read from a headline's shape could be a person or a handle: never allowlisted
		if (inc.nameKnown === false) continue;
		dynamic.push({name: inc.name, category: 'incident'});
		for (const a of inc.aliases) dynamic.push({name: a, category: 'incident'});
		if (inc.aliases.length) extraAliases.push([inc.name, ...inc.aliases]);
	}
	for (const s of brief.sources) if (s.publisher && !/\.[a-z]{2,}$/i.test(s.publisher)) dynamic.push({name: s.publisher, category: 'source'});
	for (const s of sbSources.values()) {
		const pub = publisherFor(s.url ?? '');
		if (pub && !/\.[a-z]{2,}$/i.test(pub)) dynamic.push({name: pub, category: 'source'});
	}
	for (const en of brief.entities) if (en.kind === 'org' || en.kind === 'protocol' || en.kind === 'place') dynamic.push({name: en.name, category: 'entity'});
	const idx = buildIndex(allowFile, dynamic, extraAliases);

	const briefTexts = [
		...brief.facts.flatMap((f) => [f.text, ...f.excerpts.map((e) => e.text)]),
		...brief.sources.flatMap((s) => [s.title, ...s.excerpts]),
	];
	const sourcePersonTokens = new Set<string>();
	for (const t of briefTexts) for (const w of personTokensIn(t, idx)) sourcePersonTokens.add(w);
	for (const en of brief.entities) if (en.kind === 'person') for (const w of norm(en.name).split(' ')) if (w.length > 1 && !COMMON.has(w)) sourcePersonTokens.add(w);
	const slugPersonTokens = new Set<string>();
	for (const t of briefTexts) for (const w of personTokensIn(t, idx, STRONG_PERSON_REASONS)) slugPersonTokens.add(w);
	for (const en of brief.entities) if (en.kind === 'person') for (const w of norm(en.name).split(' ')) if (w.length > 2 && !COMMON.has(w)) slugPersonTokens.add(w);
	const briefText = norm([...briefTexts, ...brief.incidents.map((i) => i.name), ...brief.sources.map((s) => s.publisher)].join(' \n '));

	const lowerWords = new Set<string>();
	const sbTexts = scenes.flatMap((sc) => [typeof sc.narration === 'string' ? sc.narration : '', ...onScreenStrings(sc).map((x) => x.value)]);
	for (const t of [...briefTexts, ...sbTexts]) for (const m of t.matchAll(/(?<![\p{L}\p{N}])\p{Ll}[\p{Ll}'-]{2,}(?![\p{L}\p{N}])/gu)) lowerWords.add(m[0]);
	const scan = (text: string, short = false) => scanNames(text, {idx, short, sourcePersonTokens, briefText, lowerWords});

	// evidence
	const evCache = new Map<string, Evidence>();
	const evidence = (ids: string[]): Evidence => {
		const bids = unique(ids.map((id) => resolveId.get(id) ?? id));
		const key = [...bids].sort().join('|');
		const hit = evCache.get(key);
		if (hit) return hit;
		const excerpts: string[] = [];
		const titles: string[] = [];
		const names: string[] = [];
		const dates: DateParts[] = [];
		const facts = brief.facts.filter((f) => f.sourceIds.some((s) => bids.includes(s)));
		const sources: BriefSource[] = [];
		for (const id of bids) {
			const bs = briefSources.get(id);
			if (bs) {
				sources.push(bs);
				excerpts.push(...bs.excerpts);
				if (bs.title) titles.push(bs.title);
				if (bs.publisher) names.push(...aliasesOf(idx, bs.publisher), normName(bs.publisher));
				const d = isoDateParts(bs.publishedAt);
				if (d) dates.push(d);
			}
			const sbs = [...sbSources.values()].find((s) => (resolveId.get(s.id) ?? s.id) === id);
			if (sbs?.url) {
				const pub = publisherFor(sbs.url);
				names.push(normName(pub), ...aliasesOf(idx, pub));
			}
		}
		for (const f of facts) {
			for (const ex of f.excerpts) if (ex.sourceId === null ? f.sourceIds.some((s) => bids.includes(s)) : bids.includes(ex.sourceId)) excerpts.push(ex.text);
			const incId = f.incidentId ?? (brief.incidents.length === 1 ? brief.incidents[0].id : undefined);
			const inc = brief.incidents.find((i) => i.id === incId);
			if (inc) {
				names.push(normName(inc.name), ...inc.aliases.map(normName));
				const d = isoDateParts(inc.date);
				if (d) dates.push(d);
			}
		}
		const exU = unique(excerpts);
		const ev: Evidence = {
			ids: bids,
			text: norm([...exU, ...titles].join(' \n ')),
			excerptText: norm(exU.join(' \n ')),
			raw: unique([...exU, ...titles]),
			numbers: [...exU, ...titles].flatMap((t) => extractNumbers(t, {words: 'display'})),
			dates,
			names: unique(names.filter(Boolean)),
			facts,
			sources,
		};
		evCache.set(key, ev);
		return ev;
	};
	const factsFor = (ids: string[]) => {
		const bids = ids.map((id) => resolveId.get(id) ?? id);
		return brief.facts.filter((f) => f.sourceIds.some((s) => bids.includes(s)));
	};
	const incidentOf = (f: BriefFact) => f.incidentId ?? (brief.incidents.length === 1 ? brief.incidents[0].id : undefined);
	const developingFact = (f: BriefFact) => {
		if (factDeveloping(brief, f)) return true;
		const inc = brief.incidents.find((i) => i.id === incidentOf(f));
		return !!inc?.developing;
	};

	// units
	const units: Unit[] = [];
	const citedIds: string[] = [];
	scenes.forEach((sc, si) => {
		const where = `scenes[${si}] "${sc.id}"`;
		if (typeof sc.id !== 'string' || !sc.id) inputErr('scene-id', `${where}: scene id must be a non-empty string.`, 'Give every scene a stable id ("s01").');
		if (typeof sc.narration !== 'string') {
			inputErr('narration', `${where}: narration must be a string.`, 'Write the narration text.', 'narration');
			return;
		}
		let sentences;
		try {
			sentences = splitNarration(sc.narration);
		} catch (err) {
			inputErr('markup', `${where}: narration markup: ${err instanceof MarkupError ? err.message : String(err)}`, 'Fix the {display|spoken} and [src:id] markup.', 'narration');
			return;
		}
		let prev: Unit | undefined;
		sentences.forEach((s, k) => {
			for (const id of s.srcIds) if (!citedIds.includes(id)) citedIds.push(id);
			const u: Unit = {kind: 'sentence', surface: 'narration', scene: sc, sceneIndex: si, sentenceIndex: k, display: s.display, spoken: s.spoken, srcIds: s.srcIds, claims: s.claims, pairs: s.pairs, prev};
			units.push(u);
			prev = u;
		});
		for (const {key, value} of onScreenStrings(sc))
			if (value.trim()) units.push({kind: 'short', surface: `onScreen.${key}`, scene: sc, sceneIndex: si, display: value, spoken: value, srcIds: [], claims: [], pairs: []});
	});
	if (typeof sb.title === 'string') units.push({kind: 'short', surface: 'title', display: sb.title, spoken: sb.title, srcIds: [], claims: [], pairs: []});
	for (const sh of Array.isArray(sb.shorts) ? sb.shorts : [])
		if (sh && typeof sh.title === 'string') units.push({kind: 'short', surface: `shorts[${sh.id}].title`, display: sh.title, spoken: sh.title, srcIds: [], claims: [], pairs: []});
	for (const th of Array.isArray(sb.thumbnails) ? sb.thumbnails : [])
		if (th && typeof th.text === 'string') units.push({kind: 'short', surface: `thumbnails[${th.id}].text`, display: th.text, spoken: th.text, srcIds: [], claims: [], pairs: []});

	// analysis
	const rawAnalysis = sb.analysis === undefined ? [] : Array.isArray(sb.analysis) ? sb.analysis : [sb.analysis];
	const analysis: NormAnalysis[] = [];
	rawAnalysis.forEach((a, i) => {
		if (!a || typeof a !== 'object') return;
		const detail = typeof a.detail === 'string' ? a.detail : '';
		const id = typeof a.id === 'string' && a.id ? a.id : `analysis[${i}]`;
		const na: NormAnalysis = {
			...a,
			index: i,
			id,
			detail,
			sourceIds: Array.isArray(a.sourceIds) ? a.sourceIds.filter((x) => typeof x === 'string') : [],
			presentedIn: [],
			numbers: extractNumbers(detail, {words: 'display'}),
		};
		// presented: explicit sceneIds, or a scene whose words cover at least half of the analysis' content words
		const sceneIds = Array.isArray(a.sceneIds) ? a.sceneIds.filter((x) => typeof x === 'string') : [];
		const dStems = contentStems(detail);
		for (const sc of scenes) {
			if (sceneIds.includes(sc.id)) na.presentedIn.push(sc.id);
			else if (!sceneIds.length && dStems.size) {
				const text = units.filter((u) => u.scene === sc).map((u) => u.display).join(' ');
				if (coverage(dStems, contentStems(text)) >= 0.5) na.presentedIn.push(sc.id);
			}
		}
		analysis.push(na);
		if (detail.trim()) units.push({kind: 'analysis', surface: `analysis[${id}].detail`, display: detail, spoken: detail, srcIds: [], claims: [], pairs: []});
	});

	return {
		sb,
		slug: input.slug,
		lang,
		brief,
		allowFile,
		idx,
		units,
		scenes,
		sbSources,
		briefSources,
		resolveId,
		sourcePersonTokens,
		slugPersonTokens,
		briefText,
		analysis,
		findings,
		evidence,
		scan,
		citedIds,
		factsFor,
		incidentOf,
		developingFact,
	};
};

/**
 * A name scanner over the allowlist (no storyboard), e.g. for correction texts. With the episode's brief, its incident
 * names, publishers and organisation entities count as known names too, as they do in the gate.
 */
export const standaloneScan = (allowlistRaw: unknown, briefRaw?: unknown): ((text: string, short?: boolean) => NameScan) => {
	const al = validateAllowlist(allowlistRaw);
	const dynamic: DynamicName[] = [];
	if (briefRaw !== undefined && briefRaw !== null) {
		const b = normalizeBrief(briefRaw).brief;
		if (b) {
			// an incident name the radar only read from a headline's shape is never allowlisted (it could be a person)
			for (const inc of b.incidents) if (inc.nameKnown !== false) for (const n of [inc.name, ...inc.aliases]) dynamic.push({name: n, category: 'incident'});
			for (const s of b.sources) if (s.publisher && !/\.[a-z]{2,}$/i.test(s.publisher)) dynamic.push({name: s.publisher, category: 'source'});
			for (const en of b.entities) if (en.kind === 'org' || en.kind === 'protocol' || en.kind === 'place') dynamic.push({name: en.name, category: 'entity'});
		}
	}
	const idx = buildIndex(al.file ?? EMPTY_ALLOW, dynamic);
	return (text: string, short = false) => scanNames(text, {idx, short});
};

/** Does `name` (an attributed name or an entity) appear in the evidence: a cited publisher, or named in the excerpts? */
export const nameInEvidence = (ctx: Ctx, name: string, ev: Evidence): boolean => {
	const n = normName(name);
	if (!n) return false;
	// "The Defiant" / "Defiant", "The Block" / "Block": compare without a leading article
	const bare = (x: string) => x.replace(/^the /, '');
	const forms = unique([...aliasesOf(ctx.idx, name), ...aliasesOf(ctx.idx, `The ${name}`)].map(bare));
	if (forms.some((f) => ev.names.some((m) => bare(m) === f))) return true;
	if (!n.includes(' ') && COMMON.has(n)) return false; // "Hackers said" is not a source
	return forms.some((f) => hasPhrase(ev.text, f));
};

export type ResolvedAttribution = {name: string; how: string; via: 'name' | 'generic' | 'inherited'};

/**
 * The attribution of a unit that resolves to the cited sources: a named source (publisher, or an organisation named in
 * the cited excerpt), a generic referent ("the firm", "it") that points at one, or an "It says" carried over from the
 * previous sentence. Returns the resolved one (or null) and the names that did not resolve.
 */
export const resolveAttribution = (ctx: Ctx, u: Unit, evIds?: string[]): {resolved: ResolvedAttribution | null; unresolved: string[]; found: Attribution[]} => {
	const ids = evIds ?? (u.srcIds.length ? u.srcIds : u.prev?.srcIds ?? []);
	const ev = ctx.evidence(ids);
	const found = findAttributions(u.display);
	if (u.spoken !== u.display) for (const a of findAttributions(u.spoken)) if (!found.some((f) => f.name === a.name && f.generic === a.generic)) found.push(a);
	const unresolved: string[] = [];
	for (const a of found) {
		if (a.name) {
			if (nameInEvidence(ctx, a.name, ev)) return {resolved: {name: a.name, how: a.how, via: 'name'}, unresolved, found};
			unresolved.push(a.name);
		}
	}
	for (const a of found) {
		if (!a.generic) continue;
		// a generic referent resolves to a named organisation in the same sentence that the evidence names...
		const ents = ctx.scan(u.display).entities.filter((e) => e.kind !== 'unknown' && e.entry?.category !== 'show' && e.entry?.category !== 'term');
		const ent = ents.find((e) => nameInEvidence(ctx, e.text, ev));
		if (ent) return {resolved: {name: ent.text, how: a.how, via: 'generic'}, unresolved, found};
		// ...or to the previous sentence's resolved attribution ("It says ...")
		if (u.prev && u.prev.scene === u.scene) {
			const pr = resolveAttribution(ctx, u.prev, ids.length ? ids : undefined);
			if (pr.resolved) return {resolved: {name: pr.resolved.name, how: a.how, via: 'inherited'}, unresolved, found};
		}
	}
	return {resolved: null, unresolved, found};
};

export const hostIsUnreachable = (url: string): boolean => /(^|\.)(?:x\.com|twitter\.com|t\.me|telegram\.me|telegram\.org|discord\.gg|discord\.com)$/i.test(hostOf(url));
