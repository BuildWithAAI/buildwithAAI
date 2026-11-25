/**
 * The news rules (owner, 2026-11-24, binding): R1-R9 as specified for the claim gate, plus R10 for the owner's
 * "don't redraw others' material". Pure: takes parsed JSON, returns findings. gate.ts does the I/O.
 */
import {hostOf, publisherFor} from './brief.ts';
import {accusationSupport, attackContext, causeSupport, chainedActions, datesIn, diagramSteps, isActionItem, isoDates, priceMoveWithoutNumber, shortAttribution, sourcesFor, spansBetween, supportedBy, unitAfter} from './checks.ts';
import {buildContext, hostIsUnreachable, nameInEvidence, onScreenStrings, resolveAttribution, type Ctx, type Evidence, type Unit} from './context.ts';
import {figureRoles, hedgedSpans, roleNear, type HedgedSpan} from './evidence.ts';
import {COMMENT_MAX, COMMENT_SOFT_MAX, correctionsFor, pinnedCommentText, validateCorrections, type SourceRef} from './corrections.ts';
import {
	ACCUSATIONS,
	ACTOR_REF,
	AI_QUOTE_FRAME,
	AVERAGING,
	CAUSES,
	CLAIM_HEDGE,
	DEFENSIVE_FRAME,
	DEVELOPING_WORDS,
	HOWTO,
	INVISIBLE_ALL,
	INVISIBLE_CHARS,
	LOSS_WORDS,
	MEDIA_KEYS,
	NEGATED_CTA,
	OFFENSIVE,
	OTHERS_MATERIAL,
	PRICE,
	PRICE_ALLOWED,
	PRICE_VERB,
	PUMP_DUMP,
	ROLE_WORDS,
	SEQUENCE_MARKERS,
	SPECIFIC_REF,
	SPECULATION,
	isQuotedInstruction,
	ruleTitle,
	type FigureRole,
	type Pattern,
} from './lexicon.ts';
import {FIRST_NAMES, personFix, personMessage, type NameScan} from './names.ts';
import {describeNum, extractNumbers, knownTickers, matchNum, speechMismatch, type DateParts, type Num} from './numbers.ts';
import {clip, COMMON, contentStems, coverage, findAll, hasPhrase, narrowStems, norm, normalizePunct, unique} from './text.ts';
import type {BriefFact, ClaimRecord, CorrectionsFile, CorrectionStatus, Finding, RuleId, RuleSummary, Severity, Where} from './types.ts';

export const GATE_VERSION = '1.1.0';
export const RULE_ORDER: RuleId[] = ['INPUT', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10', 'GEN'];

export type RulesInput = {
	storyboard: unknown;
	brief: unknown | null;
	corrections: unknown | null;
	allowlist: unknown;
	slug: string;
	/** with a radar daily file as the brief: which incident */
	incidentId?: string;
};

export type RulesOutput = {
	findings: Finding[];
	claims: ClaimRecord[];
	developing: {incidents: string[]; label: string | null; labelVia: string | null; spokenIn: string | null};
	analysis: Array<{id: string; kind: string; basis: string; detail: string; sourceIds: string[]; presentedIn: string[]}>;
	corrections: {applicable: string[]; pinnedComments: Array<{id: string; status: CorrectionStatus; text: string}>};
	citedSourceIds: string[];
};

const ATTACKER_REF = /\b(?:attackers?|hackers?|exploiters?|scammers?|thie(?:f|ves)|they|them|the (?:attacker|hacker|exploiter|scammer|thief|bad actor)s?)\b/i;
const TICKERISH = /^(?:[a-z]{0,4}[A-Z]{2,6}[a-z]?|[A-Z][a-zA-Z]{1,6}SOL)$/;
const CAMEL = /\b[a-z]{3,}(?:[A-Z][a-z0-9]+)+[A-Za-z0-9]*\b/g;
const QUOTE_RE = /"([^"\n]{2,400}?)"/g;

const at = (u: Unit, spoken = false): Where => ({surface: spoken ? `${u.surface} (spoken)` : u.surface, scene: u.scene?.id, text: clip(spoken ? u.spoken : u.display, 220)});

/** The texts of a unit to scan: display, plus the spoken side when it differs. */
const texts = (u: Unit): Array<{t: string; spoken: boolean}> => (u.spoken && u.spoken !== u.display ? [{t: u.display, spoken: false}, {t: u.spoken, spoken: true}] : [{t: u.display, spoken: false}]);

const insideQuotes = (t: string, i: number): boolean => ((normalizePunct(t).slice(0, i).match(/"/g) ?? []).length % 2) === 1;

const matches = (pats: Pattern[], t: string) => pats.flatMap((p) => findAll(p.re, t).map((m) => ({p, m})));

export const runRules = (input: RulesInput): RulesOutput => {
	const ctx = buildContext({storyboard: input.storyboard, brief: input.brief, allowlist: input.allowlist, slug: input.slug, incidentId: input.incidentId});
	const findings: Finding[] = [...ctx.findings];
	const seen = new Set<string>();
	const add = (rule: RuleId, code: string, severity: Severity, where: Where, message: string, fix: string, evidence?: string) => {
		const key = `${rule}|${code}|${where.scene ?? ''}|${where.surface.replace(/ \(spoken\)$/, '')}|${message}`;
		if (seen.has(key)) return;
		seen.add(key);
		findings.push({rule, code: `${rule}.${code}`, severity, where, message, fix, ...(evidence ? {evidence: clip(evidence, 300)} : {})});
	};

	const claims = ruleR1(ctx, add);
	const developing = ruleR2(ctx, add, claims);
	ruleR3(ctx, add);
	ruleR4(ctx, add);
	ruleR5(ctx, add);
	ruleR6(ctx, add);
	const analysis = ruleR7(ctx, add);
	const corrections = ruleR8(ctx, add, input.corrections);
	ruleR9(ctx, add);
	ruleR10(ctx, add);

	return {findings, claims, developing, analysis, corrections, citedSourceIds: ctx.citedIds};
};

type Add = (rule: RuleId, code: string, severity: Severity, where: Where, message: string, fix: string, evidence?: string) => void;

const ownDataNumbers = (ctx: Ctx, sceneId?: string): Num[] =>
	ctx.analysis.filter((a) => a.basis === 'own-data' && (!sceneId || a.presentedIn.includes(sceneId))).flatMap((a) => a.numbers);

const metaDatesFor = (ctx: Ctx, ids: string[]): DateParts[] => {
	const ev = ctx.evidence(ids);
	return ev.dates;
};

/** "the largest", "a record", "the biggest theft in history": a comparison the narration may only make with a source. */
const SUPERLATIVE = /\b(?:biggest|largest|worst|costliest|record(?:-breaking)?|in (?:crypto |crypto's )?history|of all time|all-time|ever recorded|most (?:expensive|costly|damaging))\b/i;

/** The claim says a figure is one thing (a loss) and the source says another (money being recovered, frozen, moved). */
const roleMismatch = (claimText: string, n: Num, ev: Evidence): {claim: FigureRole; source: FigureRole; text: string} | null => {
	const claim = roleNear(claimText, n.start, n.end);
	if (!claim) return null;
	const hits = figureRoles(ev.raw, n, ev.dates);
	if (!hits.length || hits.some((h) => h.role === null || h.role === claim)) return null;
	const hit = hits.find((h) => h.role) as {role: FigureRole; text: string};
	return {claim, source: hit.role, text: hit.text};
};

/**
 * The hedged clause of the sources that a claim restates, if any ("Chainflip Suspects Key Theft"). Compared on narrow
 * stems (only the theft family folded), without the publishers' names, so "the vault was drained" does not restate
 * "suspected key theft" and "according to CoinDesk" adds nothing.
 */
const hedgedMatch = (claim: string, spans: HedgedSpan[], exclude: Set<string>): HedgedSpan | null => {
	if (!spans.length) return null;
	const stems = narrowStems(claim.replace(new RegExp(CLAIM_HEDGE.source, 'gi'), ' '), exclude);
	if (stems.size < 2) return null;
	let best: HedgedSpan | null = null;
	let bestCov = 0;
	for (const h of spans) {
		const cov = coverage(stems, narrowStems(h.span, exclude));
		if (cov > bestCov) {
			best = h;
			bestCov = cov;
		}
	}
	return bestCov >= 0.5 ? best : null;
};

/** The words of every source's publisher name ("coindesk", "defiant"): attribution words, not content. */
const publisherWords = (ctx: Ctx): Set<string> =>
	new Set([...ctx.brief.sources.map((x) => x.publisher), ...[...ctx.sbSources.values()].map((x) => publisherFor(x.url ?? ''))].flatMap((p) => norm(p).split(/[^\p{L}\p{N}]+/u)).filter((w) => w.length >= 3 && w !== 'news'));

/** Publisher words plus the words of the incident's own names and the brief's organisations: a title that shares only
 * the subject's name with a hedged clause ("FixtureSwap drained" vs "FixtureSwap probe points to suspected key theft")
 * does not restate the hedge. */
const nameWords = (ctx: Ctx): Set<string> => {
	const out = publisherWords(ctx);
	const names = [
		...ctx.brief.incidents.flatMap((i) => [i.name, ...i.aliases]),
		...ctx.brief.entities.filter((e) => e.kind === 'org' || e.kind === 'protocol').map((e) => e.name),
	];
	for (const n of names) for (const w of norm(n).split(/[^\p{L}\p{N}]+/u)) if (w.length >= 3) out.add(w);
	return out;
};

const tierOf = (ctx: Ctx, id: string) => ctx.briefSources.get(ctx.resolveId.get(id) ?? id)?.tier;
const allTierC = (ctx: Ctx, ids: string[]): boolean => ids.length > 0 && ids.every((id) => tierOf(ctx, id) === 'C');
/** An incident database's listing of another outlet's report: discovery only, never evidence. */
const isListed = (ctx: Ctx, id: string): boolean => ctx.briefSources.get(ctx.resolveId.get(id) ?? id)?.listedReport === true;
/**
 * The cited ids a claim may rest on: tier-A and tier-B sources that are not listings. A tier-C or listed excerpt
 * co-cited with them never supplies the claim's figures, names, quotes or wording. When no such id is cited, all of
 * them (so the tier-c-only error still fires).
 */
const carrying = (ctx: Ctx, ids: string[]): string[] => {
	const strong = ids.filter((id) => tierOf(ctx, id) !== 'C' && !isListed(ctx, id));
	return strong.length ? strong : ids;
};

// =====================================================================================================================
// R1: every [src:id] claim matches a brief fact; its numbers, names and quotes appear in the cited excerpt
// =====================================================================================================================
const ruleR1 = (ctx: Ctx, add: Add): ClaimRecord[] => {
	const pubWords = publisherWords(ctx);
	const records: ClaimRecord[] = [];
	const verified: Num[] = [];
	const usedFacts = new Set<BriefFact>();

	// sources: in storyboard.sources, verified, reachable, and selected by the radar
	for (const id of ctx.citedIds) {
		const s = ctx.sbSources.get(id);
		const w: Where = {surface: 'storyboard.sources', text: id};
		if (!s) {
			add('R1', 'unknown-source', 'error', w, `[src:${id}] is cited but not listed in storyboard.sources.`, 'Add the source to storyboard.sources (copy it from brief.json) or fix the id.');
			continue;
		}
		if (s.status !== 'verified') add('R1', 'unverified-source', 'error', w, `Source "${id}" has status "${s.status}".`, 'Only verified sources may back a claim. Re-check it, or drop the claims that rest on it.');
		if (hostIsUnreachable(s.url ?? '')) add('R1', 'unreachable-source', 'error', w, `Source "${id}" is on ${hostOf(s.url)}, which this pipeline cannot fetch, so its content cannot be verified.`, 'Cite a reachable outlet or security firm that reports the same fact. Never reconstruct X/Telegram posts.');
		const bid = ctx.resolveId.get(id);
		if (!bid) add('R1', 'not-in-brief', 'error', w, `Source "${id}" is not in brief.json: the radar did not select it, so no stored excerpt backs it.`, 'Use a source from the brief, or re-run the radar so it stores this source with its excerpt.');
		else if (bid !== id) add('R1', 'source-id-mismatch', 'warning', w, `Source "${id}" matches brief source "${bid}" by URL only.`, 'Use the brief\'s source id so the report and the approval page line up.');
		else {
			const bs = ctx.briefSources.get(bid);
			if (bs?.url && s.url && bs.url !== s.url) add('R1', 'source-url-mismatch', 'error', w, `Source "${id}" points to ${s.url}, but the brief stored ${bs.url}.`, 'Use the URL the radar stored; the excerpt belongs to that page.');
		}
	}

	for (const u of ctx.units) {
		if (u.kind !== 'sentence') continue;
		const sceneId = u.scene?.id;
		const own = ownDataNumbers(ctx, sceneId);
		// claims
		u.claims.forEach((c) => {
			const ids = c.srcIds;
			// figures, names, quotes and wording come from the tier-A/B sources cited; hedges from every cited source
			const carry = carrying(ctx, ids);
			const facts = ctx.factsFor(carry);
			const rec: ClaimRecord = {scene: sceneId ?? '', sentence: u.sentenceIndex ?? 0, text: c.display, sourceIds: ids, factId: null, numbers: [], entities: [], attribution: null, developing: false, ok: true};
			records.push(rec);
			const w: Where = {surface: 'narration', scene: sceneId, text: clip(c.display, 220)};
			if (!ids.some((id) => ctx.sbSources.has(id))) {
				rec.ok = false;
				return; // reported once under unknown-source
			}
			const listed = ids.filter((id) => isListed(ctx, id));
			if (listed.length) {
				rec.ok = false;
				add('R1', 'listed-report', 'error', w, `[src:${listed.join(',')}] is an incident database's listing of another outlet's report: discovery only, never evidence, even next to another source.`, 'Cite the original report the listing links to once the radar has read it (a tier-A or tier-B source), or cut the claim.');
			}
			if (!facts.length) {
				rec.ok = false;
				add('R1', 'no-brief-fact', 'error', w, `No brief fact cites [src:${carry.join(',')}], so this claim matches no selected fact.`, 'Back the claim with a source the radar selected for a fact (see brief.json), or cut the claim.');
				return;
			}
			const ev = ctx.evidence(carry);
			const evAll = ctx.evidence(ids);
			// a claim or a figure never rests on aggregators alone (tier C never counts on its own)
			if (allTierC(ctx, ids)) {
				rec.ok = false;
				add('R1', 'tier-c-only', 'error', w, `Every source behind this claim is a tier-C aggregator (${ids.join(', ')}); aggregators never carry a claim or a figure alone.`, 'Cite a tier-A or tier-B source whose own excerpt states it (a tracker, security firm, post-mortem or established outlet), or cut the claim. Adding a source that does not state it changes nothing: a tier-C excerpt is never the only source of a figure, a name, a quote or the wording.', ev.excerptText);
			}
			// a loss or an accusation keeps the source's qualifier ("about $1.17 billion" is not "$1.17 billion")
			const serious = LOSS_WORDS.test(c.display) || matches(ACCUSATIONS, c.display).length > 0;
			// numbers
			for (const n of extractNumbers(c.display, {words: 'display'})) {
				rec.numbers.push(describeNum(n));
				const m = matchNum(n, ev.numbers, ev.dates);
				if (m.ok) {
					verified.push(n);
					if (m.how === 'rounded') add('R1', 'rounded-number', 'info', w, `"${n.raw}" rounds "${m.closest?.raw}" from the excerpt.`, 'Fine with the qualifier; prefer the exact figure on screen.');
					if (m.droppedQualifier) {
						if (serious) rec.ok = false;
						add('R1', 'dropped-qualifier', serious ? 'error' : 'warning', w, `The source says "${m.closest?.raw}" with a qualifier ("about", "more than"...), but the claim states "${n.raw}" flatly${serious ? ' in a sentence about a loss or an accusation' : ''}.`, 'Keep the source\'s qualifier ("about", "more than").');
					}
					// what the source says the figure is: a loss, or money being recovered, frozen, moved or returned
					const rm = n.kind === 'money' || n.kind === 'crypto' ? roleMismatch(c.display, n, ev) : null;
					if (rm) {
						rec.ok = false;
						add('R1', 'figure-role', 'error', w, `"${n.raw}" is ${ROLE_WORDS[rm.claim]} in the claim, but the cited source gives it as ${ROLE_WORDS[rm.source]}.`, 'Say what the source says about the figure ("the DOJ is seeking to recover about $1.17 billion"), or cite a source that reports it as a loss.', rm.text);
					}
					continue;
				}
				if (own.some((o) => matchNum(n, [o]).ok)) {
					verified.push(n);
					continue;
				}
				rec.ok = false;
				if (carry.length < ids.length && matchNum(n, evAll.numbers, evAll.dates).ok) {
					add('R1', 'tier-c-only', 'error', w, `"${n.raw}" appears only in a tier-C or listed source's excerpt among [src:${ids.join(',')}]; such a source never carries a figure, even next to another source.`, 'Use a figure the tier-A or tier-B source itself states, or cut it.', evAll.excerptText);
					continue;
				}
				const averaged = AVERAGING.test(u.display);
				add(
					'R1',
					'number-not-in-excerpt',
					'error',
					w,
					`"${n.raw}" is not in the stored excerpt of [src:${ids.join(',')}]${m.closest ? ` (closest there: "${m.closest.raw}")` : ''}.`,
					averaged
						? 'Loss amounts are reported, never averaged or combined: give each source\'s own figure ("reported by X"), or move a computed figure into an own-data analysis.'
						: 'Use the figure exactly as the excerpt gives it (a qualifier like "about" allows rounding), or cite the source that states this figure.',
					ev.excerptText,
				);
			}
			// names
			for (const e of ctx.scan(c.display).entities) {
				const cat = e.entry?.category;
				if (cat === 'show' || (cat === 'term' && !TICKERISH.test(e.entry?.name ?? ''))) continue;
				if (e.sentenceStart && (e.kind === 'unknown' || COMMON.has(e.text.toLowerCase()))) continue;
				rec.entities.push(e.text);
				if (nameInEvidence(ctx, e.text, ev)) continue;
				rec.ok = false;
				add('R1', 'name-not-in-excerpt', 'error', w, `"${e.text}" is not named in the stored excerpt of [src:${ids.join(',')}].`, 'Name only what the cited excerpt names, or cite the source that names it.', ev.excerptText);
			}
			// the claim matches a fact
			const exclude = new Set<string>(rec.entities.flatMap((x) => x.toLowerCase().replace(/['\u2019]s\b/g, '').split(/\s+/)));
			const cStems = contentStems(c.display, exclude);
			// the best fact: shared wording, plus the claim's own names and figures in that fact (two tracker rows can share
			// wording; the one naming the claim's protocol and figure is the fact it states)
			const claimNums = extractNumbers(c.display, {words: 'display'});
			const scored = facts.map((f) => {
				const fText = [f.text, ...f.excerpts.map((x) => x.text)].join(' ');
				const cov = coverage(cStems, contentStems(fText));
				const fNums = extractNumbers(fText, {words: 'display'});
				const ents = rec.entities.length ? rec.entities.filter((e) => hasPhrase(fText, e.replace(/['\u2019]s$/, ''))).length / rec.entities.length : 0;
				const nums = claimNums.length ? claimNums.filter((n) => matchNum(n, fNums, metaDatesFor(ctx, f.sourceIds)).ok).length / claimNums.length : 0;
				return {f, cov, score: cov + 0.5 * ents + 0.5 * nums};
			});
			let best: {f: BriefFact | null; cov: number; score: number} = {f: null, cov: -1, score: -1};
			for (const x of scored) if (x.score > best.score) best = x;
			if (best.f) {
				rec.factId = best.f.id;
				usedFacts.add(best.f);
				rec.developing = scored.filter((x) => x.score >= best.score - 1e-9).some((x) => ctx.developingFact(x.f));
			}
			// the wording must match at least one fact citing these sources (whichever fact scored best overall)
			const closest = scored.reduce<{f: BriefFact | null; cov: number}>((a, x) => (x.cov > a.cov ? {f: x.f, cov: x.cov} : a), {f: null, cov: -1});
			if (cStems.size && closest.cov < 0.34) {
				rec.ok = false;
				add('R1', 'claim-not-in-fact', 'error', w, `The claim does not match any brief fact citing [src:${ids.join(',')}] (best match ${Math.round(closest.cov * 100)}%: "${clip(closest.f?.text ?? '', 120)}").`, 'Say what the fact says (same subject and action), or cut the claim. The gate only passes facts the radar selected.');
			}
			const att = resolveAttribution(ctx, u);
			rec.attribution = att.resolved?.name ?? null;
			// a hedge in the source ("suspected key theft", "potential handoffs") stays a hedge in the claim, and a
			// hedged mechanism is developing even when the incident is confirmed (R2)
			const hedge = hedgedMatch(c.display, hedgedSpans(evAll.raw), pubWords);
			if (hedge) {
				rec.developing = true;
				if (!CLAIM_HEDGE.test(c.display)) {
					rec.ok = false;
					add('R6', 'dropped-hedge', 'error', w, `The cited source hedges this ("${hedge.hedge}": "${clip(hedge.span, 140)}"), but the claim states it as fact.`, 'Keep the source\'s hedge and the attribution ("According to X, a key theft is suspected"), or leave it out. A hedged mechanism is developing: label it DEVELOPING.', hedge.sentence);
				} else if (!att.resolved) add('R6', 'hedge-unattributed', 'error', w, `A hedged claim ("${hedge.hedge}") with no attribution.`, 'Say who suspects it: "according to <source>".');
			}
		});
		// numbers and superlatives in sentences with no source tag
		if (!u.srcIds.length) {
			for (const n of extractNumbers(u.display, {words: 'none'})) {
				if (own.some((o) => matchNum(n, [o]).ok)) continue;
				add('R1', 'unsourced-number', 'error', at(u), `"${n.raw}" is stated without a source tag.`, 'Add [src:id] after the claim (a source whose excerpt has the number), or present it as part of an own-data analysis linked to this scene.');
			}
			const sup = SUPERLATIVE.exec(u.display);
			if (sup && !ctx.analysis.some((a) => a.basis === 'own-data' && !!sceneId && a.presentedIn.includes(sceneId) && hasPhrase(a.detail, sup[0])))
				add('R1', 'unsourced-superlative', 'error', at(u), `"${sup[0]}" is a comparison stated without a source tag.`, 'Attribute it to a source whose excerpt makes the comparison ([src:id] and "according to X"), or make it part of an own-data analysis presented in this scene.');
		}
		// what is shown vs what is spoken
		if (ctx.lang === 'en')
			for (const p of u.pairs) {
				const mm = speechMismatch(p.display, p.spoken);
				if (mm.shownNotSaid.length || mm.saidNotShown.length)
					add(
						'R1',
						'spoken-mismatch',
						'error',
						at(u),
						`{${p.display}|${p.spoken}}: the screen says ${mm.shownNotSaid.map((x) => `"${x.raw}"`).join(', ') || 'no number'} but the voice says ${mm.saidNotShown.map((x) => `"${x.raw}"`).join(', ') || 'no number'}.`,
						'Make the spoken side say exactly the number shown.',
					);
			}
	}

	// quotes: every quoted span (3+ words) must be in the excerpts of the sources the scene cites
	ctx.scenes.forEach((sc) => {
		const su = ctx.units.filter((u) => u.scene === sc);
		const ids = unique([...su.flatMap((u) => u.srcIds), ...(typeof sc.onScreen?.source === 'string' && ctx.sbSources.has(sc.onScreen.source) ? [sc.onScreen.source] : [])]);
		// a quote must be in a tier-A/B source's own excerpt, never only in a listing's or an aggregator's
		const ev = ctx.evidence(carrying(ctx, ids));
		if (typeof sc.onScreen?.source === 'string' && isListed(ctx, sc.onScreen.source))
			add('R1', 'listed-report', 'error', {surface: 'onScreen.source', scene: sc.id, text: sc.onScreen.source}, `onScreen.source "${sc.onScreen.source}" is an incident database's listing: discovery only, never a source to show.`, 'Show the original report the listing links to once the radar has read it, or a tier-A/B source.');
		const check = (q: string, u: Unit) => {
			const qt = q.trim().replace(/[.,!?;:]+$/, '');
			if (qt.split(/\s+/).length < 3) return;
			if (!ids.length) add('R1', 'quote-without-source', 'error', at(u), `The quote "${clip(qt, 80)}" has no source in this scene.`, 'Cite the source the quote comes from with [src:id].');
			else if (!hasPhrase(ev.excerptText, qt)) add('R1', 'quote-not-in-excerpt', 'error', at(u), `The quote "${clip(qt, 80)}" is not word for word in the stored excerpts of [src:${ids.join(',')}].`, 'Quote the excerpt exactly, or paraphrase with attribution and no quotation marks.', ev.excerptText);
		};
		for (const u of su) {
			if (u.surface === 'onScreen.attribution' || u.surface === 'onScreen.source') continue;
			const isQuoteField = u.surface === 'onScreen.quote';
			if (isQuoteField) check(u.display.replace(/^["\s]+|["\s]+$/g, ''), u);
			else for (const m of findAll(QUOTE_RE, normalizePunct(u.display))) check(m.text.slice(1, -1), u);
		}
		if (sc.type === 'quote' && typeof sc.onScreen?.attribution === 'string' && sc.onScreen.attribution.trim()) {
			const attr = sc.onScreen.attribution;
			const ok = nameInEvidence(ctx, attr, ev) || ctx.scan(attr).entities.some((e) => e.kind !== 'unknown' && nameInEvidence(ctx, e.text, ev));
			if (!ok) add('R1', 'quote-attribution', 'error', {surface: 'onScreen.attribution', scene: sc.id, text: attr}, `The quote is attributed to "${attr}", which the cited source neither is nor names.`, 'Attribute the quote to the organisation the excerpt quotes.');
		}
	});

	// numbers on screen, in titles and thumbnails must come from a verified claim, the scene's sources or own data
	for (const u of ctx.units) {
		if (u.kind !== 'short') continue;
		const sceneIds = u.scene ? unique(ctx.units.filter((x) => x.scene === u.scene).flatMap((x) => x.srcIds)) : ctx.citedIds;
		const ev = ctx.evidence(carrying(ctx, sceneIds));
		const allowed = [...verified, ...ev.numbers, ...ownDataNumbers(ctx, u.scene?.id)];
		for (const n of extractNumbers(u.display, {words: 'display'})) {
			if (matchNum(n, allowed, ev.dates).ok) continue;
			add('R1', 'unsourced-number', 'error', at(u), `"${n.raw}" on screen is not a verified figure from the narration or this scene's sources.`, 'Show only figures the narration states with a source (or own-data analysis figures).');
		}
	}

	// the Rekt Meter: the renderer prints "reported by <publisher of rekt.source>" next to onScreen.loss, so the figure,
	// rekt.usd and the source must agree
	for (const sc of ctx.scenes) {
		const rekt = (sc as unknown as {rekt?: Record<string, unknown>}).rekt;
		if (!rekt || typeof rekt !== 'object') continue;
		const alt = rekt.alt && typeof rekt.alt === 'object' ? (rekt.alt as Record<string, unknown>) : null;
		for (const [r, key] of [[rekt, 'loss'], ...(alt ? [[alt, 'lossAlt']] : [])] as Array<[Record<string, unknown>, string]>) {
			const where: Where = {surface: key === 'loss' ? 'rekt' : 'rekt.alt', scene: sc.id, text: `${String(sc.onScreen?.[key] ?? '')} (${String(r.source ?? '?')})`};
			const usd = typeof r.usd === 'number' && Number.isFinite(r.usd) && r.usd > 0 ? r.usd : null;
			const sid = typeof r.source === 'string' ? r.source : '';
			if (!usd) {
				add('R1', 'rekt-figure', 'error', where, 'The Rekt Meter has no reported figure (rekt.usd).', 'Set rekt.usd to the figure the source reports, in US dollars.');
				continue;
			}
			if (!sid || (!ctx.sbSources.has(sid) && !ctx.briefSources.has(sid))) {
				add('R1', 'rekt-source', 'error', where, `The Rekt Meter's source "${sid}" is not in storyboard.sources or the brief.`, 'Name the brief source that reports the figure (rekt.source).');
				continue;
			}
			const ev = ctx.evidence([sid]);
			const usdNum: Num = {kind: 'money', value: usd, raw: `$${usd.toLocaleString('en-US')}`, start: 0, end: 0, unit: 'USD'};
			if (!matchNum(usdNum, ev.numbers, ev.dates).ok)
				add('R1', 'rekt-figure-not-in-source', 'error', where, `rekt${key === 'loss' ? '' : '.alt'}.usd = ${usdNum.raw}, which "${sid}" does not report.`, 'Use the figure exactly as that source reports it (the meter says "reported by" that outlet).', ev.excerptText);
			if (allTierC(ctx, [sid])) add('R1', 'tier-c-only', 'error', where, `The Rekt Meter's figure rests on a tier-C aggregator ("${sid}") alone.`, 'Use a tier-A or tier-B source\'s figure on the meter.');
			if (isListed(ctx, sid)) add('R1', 'listed-report', 'error', where, `The Rekt Meter's source "${sid}" is an incident database's listing: discovery only, never a figure.`, 'Use the figure a tier-A or tier-B source states.');
			const shown = typeof sc.onScreen?.[key] === 'string' ? extractNumbers(String(sc.onScreen[key]), {words: 'display'}).filter((n) => n.kind === 'money') : [];
			if (!shown.length) add('R1', 'rekt-display', 'error', where, `onScreen.${key} shows no dollar figure next to the meter.`, `Put the figure as "${sid}" writes it in onScreen.${key}.`);
			else if (Math.abs(shown[0].value - usd) / usd > 0.005) add('R1', 'rekt-display', 'error', where, `onScreen.${key} says "${shown[0].raw}" but rekt.usd is ${usdNum.raw}.`, 'The meter label and rekt.usd must be the same reported figure.');
		}
	}

	// the radar's own fact text must agree with its excerpt (catches a rounded or invented figure in the brief)
	for (const f of usedFacts) {
		const fx = f.excerpts.flatMap((e) => extractNumbers(e.text, {words: 'display'}));
		const dates = metaDatesFor(ctx, f.sourceIds);
		for (const n of extractNumbers(f.text, {words: 'display'}))
			if (!matchNum(n, fx, dates).ok)
				add('R1', 'fact-number-not-in-excerpt', 'error', {surface: 'brief', text: `${f.id}: ${clip(f.text, 160)}`}, `Brief fact "${f.id}" states "${n.raw}", but none of its excerpts does.`, 'Fix the radar\'s fact text (or its excerpt) before using this fact.');
	}
	return records;
};

// =====================================================================================================================
// R2: developing stories carry a visible DEVELOPING label and say so
// =====================================================================================================================
const VISIBLE_KEYS = /^(?:title|bullets|steps|quote|label|badge|kicker|developing)(?:\[\d+\])?$/;
const DRAWN_KEYS = /^(?:title|bullets|steps|quote)(?:\[\d+\])?$/; // drawn by the episode templates as of 2026-11-24

const ruleR2 = (ctx: Ctx, add: Add, claims: ClaimRecord[]): RulesOutput['developing'] => {
	const word = DEVELOPING_WORDS[ctx.lang] ?? DEVELOPING_WORDS.en;
	const devScenes = new Set(claims.filter((c) => c.developing).map((c) => c.scene));
	const devFacts = ctx.brief.facts.filter((f) => claims.some((c) => c.factId === f.id && c.developing));
	const incidents = unique(devFacts.map((f) => ctx.incidentOf(f) ?? f.id));
	for (const id of ctx.sb.news?.incidentIds ?? []) {
		const inc = ctx.brief.incidents.find((i) => i.id === id);
		if (inc?.developing && !incidents.includes(id)) incidents.push(id);
	}
	const out: RulesOutput['developing'] = {incidents, label: null, labelVia: null, spokenIn: null};
	if (!incidents.length) return out;
	const firstDev = ctx.scenes.findIndex((sc) => devScenes.has(sc.id));
	const lastAllowed = firstDev < 0 ? ctx.scenes.length - 1 : firstDev;

	// the label: a storyboard field, or a scene's on-screen text at or before the first developing claim
	const field = ctx.sb.news?.developing ?? ctx.sb.developing;
	let fieldLabel: string | null = null;
	if (field === true) fieldLabel = 'DEVELOPING';
	else if (typeof field === 'string') fieldLabel = field;
	else if (field && typeof field === 'object') fieldLabel = typeof field.label === 'string' ? field.label : 'DEVELOPING';
	if (fieldLabel !== null && !word.test(fieldLabel)) {
		add('R2', 'label-text', 'error', {surface: 'news.developing', text: fieldLabel}, `The developing label reads "${fieldLabel}", which does not say DEVELOPING.`, 'Use the label text "DEVELOPING" (or the language\'s word for it).');
		fieldLabel = null;
	}
	const sceneLabelIn = (sceneIdx: number[]): {scene: string; key: string} | null => {
		for (const i of sceneIdx) {
			const sc = ctx.scenes[i];
			for (const {key, value} of onScreenStrings(sc)) if (VISIBLE_KEYS.test(key) && word.test(value)) return {scene: sc.id, key};
		}
		return null;
	};
	const upTo = (n: number) => Array.from({length: n + 1}, (_, i) => i);
	const sceneLabel = sceneLabelIn(upTo(lastAllowed));
	if (fieldLabel) {
		out.label = fieldLabel;
		out.labelVia = 'news.developing';
	}
	if (sceneLabel) {
		out.label = out.label ?? 'DEVELOPING';
		out.labelVia = out.labelVia ? `${out.labelVia} + ${sceneLabel.scene} onScreen.${sceneLabel.key}` : `${sceneLabel.scene} onScreen.${sceneLabel.key}`;
		if (!DRAWN_KEYS.test(sceneLabel.key))
			add('R2', 'label-key-not-drawn', 'warning', {surface: `onScreen.${sceneLabel.key}`, scene: sceneLabel.scene}, `DEVELOPING is in onScreen.${sceneLabel.key}, which the episode templates do not draw yet.`, 'Also put DEVELOPING in the scene title (or a bullet) so it is visible today.');
	}
	if (!fieldLabel && !sceneLabel)
		add('R2', 'no-visible-label', 'error', {surface: 'storyboard', scene: ctx.scenes[lastAllowed]?.id}, `Incident ${incidents.join(', ')} is developing, but nothing on screen says DEVELOPING at or before the first claim about it.`, 'Set news.developing: {"label": "DEVELOPING"} and put "DEVELOPING" in the first scene\'s title.');
	else if (fieldLabel && !sceneLabel)
		add('R2', 'field-not-drawn', 'warning', {surface: 'news.developing'}, 'The DEVELOPING label is only in news.developing, which the episode renderer does not draw yet (2026-11-24).', 'Also put "DEVELOPING" in the first scene\'s onScreen.title until the renderer draws news.developing.');

	// the narration says so, at or before the first developing claim
	const saysIn = (sceneIdx: number[], stopScene?: string): string | null => {
		for (const i of sceneIdx) {
			const sc = ctx.scenes[i];
			for (const u of ctx.units.filter((x) => x.scene === sc && x.kind === 'sentence')) {
				if (word.test(u.spoken)) return sc.id;
				if (sc.id === stopScene && u.claims.some((c) => claims.some((r) => r.scene === sc.id && r.text === c.display && r.developing))) return null;
			}
		}
		return null;
	};
	const spoken = saysIn(upTo(lastAllowed), ctx.scenes[lastAllowed]?.id);
	out.spokenIn = spoken;
	if (!spoken)
		add('R2', 'not-spoken', 'error', {surface: 'narration', scene: ctx.scenes[lastAllowed]?.id}, 'The narration never says the story is developing before the first claim about it.', 'Add a line such as "This is a developing story." before the first developing claim.');

	// the publish surfaces travel without the video: the title, every Short title and every thumbnail say developing
	if (typeof ctx.sb.title === 'string' && !word.test(ctx.sb.title))
		add('R2', 'title-no-label', 'error', {surface: 'title', text: ctx.sb.title}, 'The story is developing, but the video title does not say so.', 'Add "(developing)" to storyboard.title.');
	for (const sh of Array.isArray(ctx.sb.shorts) ? ctx.sb.shorts : [])
		if (sh && typeof sh.title === 'string' && !word.test(sh.title))
			add('R2', 'short-title-no-label', 'error', {surface: `shorts[${sh.id}].title`, text: sh.title}, `The story is developing, but Short "${sh.id}"'s title does not say so.`, 'Add "(developing)" to the Short title.');
	for (const th of Array.isArray(ctx.sb.thumbnails) ? ctx.sb.thumbnails : [])
		if (th && typeof th.text === 'string' && !word.test(th.text))
			add('R2', 'thumbnail-no-label', 'error', {surface: `thumbnails[${th.id}].text`, text: th.text}, `The story is developing, but thumbnail "${th.id}" does not say so (any variant may be the one viewers see).`, 'Start every thumbnail text with "DEVELOPING:".');

	// every Short that carries a developing claim is a standalone video: label and line again
	for (const sh of Array.isArray(ctx.sb.shorts) ? ctx.sb.shorts : []) {
		const idxs = (sh.sceneIds ?? []).map((id) => ctx.scenes.findIndex((s) => s.id === id)).filter((i) => i >= 0);
		const firstDevPos = idxs.findIndex((i) => devScenes.has(ctx.scenes[i].id));
		if (firstDevPos < 0) continue;
		const prefix = idxs.slice(0, firstDevPos + 1);
		const w: Where = {surface: `shorts[${sh.id}]`, text: sh.title};
		if (!fieldLabel && !sceneLabelIn(prefix)) add('R2', 'short-no-label', 'error', w, `Short "${sh.id}" carries a developing claim but shows no DEVELOPING label before it.`, 'Include a scene with "DEVELOPING" on screen before the claim, or set news.developing.');
		if (!saysIn(prefix, ctx.scenes[idxs[firstDevPos]].id)) add('R2', 'short-not-spoken', 'error', w, `Short "${sh.id}" never says the story is developing before its first developing claim.`, 'Start the Short with the scene that says "This is a developing story."');
	}
	return out;
};

// =====================================================================================================================
// R3: accusations, causes and loss amounts are attributed to a named source
// =====================================================================================================================
const ruleR3 = (ctx: Ctx, add: Add) => {
	const devAny = ctx.brief.facts.some((f) => ctx.developingFact(f));
	const citedEv = ctx.evidence(ctx.citedIds);
	type Accu = {code: string; text: string};
	const accusationsIn = (u: Unit): Accu[] => {
		const out: Accu[] = [];
		for (const {t} of texts(u)) for (const {p, m} of matches(ACCUSATIONS, t)) if (!out.some((x) => x.code === p.code && x.text === m.text.toLowerCase())) out.push({code: p.code, text: m.text.toLowerCase()});
		return out;
	};
	const causesIn = (u: Unit): string[] => unique(texts(u).flatMap(({t}) => matches(CAUSES, t).map(({m}) => m.text.toLowerCase())));
	/** The accusations and causes the evidence does not support (the source never says them, in any word of the family). */
	const unsupported = (u: Unit, accus: Accu[], causes: string[], groups: string[], ev: Evidence): string[] => {
		const out: string[] = [];
		for (const a of accus) if (!supportedBy(accusationSupport(a.code, a.text, u.display), ev)) out.push(a.text);
		for (const c of causes) if (!supportedBy(causeSupport(c), ev)) out.push(c);
		for (const g of groups) if (!nameInEvidence(ctx, g, ev)) out.push(g);
		return unique(out);
	};

	for (const u of ctx.units) {
		const scan = ctx.scan(u.display, u.kind === 'short');
		const groups = scan.known.filter((k) => k.entry.category === 'group').map((k) => k.text);
		const accusList = accusationsIn(u);
		const accus = unique(accusList.map((a) => a.text));
		if (u.kind === 'short') {
			shortFigures(ctx, u, add);
			const causes = causesIn(u);
			if (!accus.length && !groups.length && !causes.length) continue;
			// an on-screen line inherits the attribution its scene says aloud ("According to X, ..." with the bullet on screen)
			// (accusations need their own attribution; only cause wording may lean on the scene's spoken attribution)
			const att = resolveAttribution(ctx, u, ctx.citedIds);
			const sceneSaid = !!u.scene && ctx.units.some((x) => x.scene === u.scene && x.kind === 'sentence' && x.srcIds.length > 0 && !!resolveAttribution(ctx, x).resolved);
			if ((accus.length || groups.length) && !att.resolved)
				add('R3', 'short-unattributed', 'error', at(u), `${u.surface} makes an accusation (${[...accus, ...groups].join(', ')}) without naming who says so.`, 'Titles, labels and thumbnails make no accusations. Use "<Source>: …" or "<Source> says …", or drop it.');
			else if (causes.length && devAny && !att.resolved && !sceneSaid && !/\b(?:says?|said|reports?|reported|claims?|alleges?|according|confirms?|developing|what we know|unconfirmed)\b/i.test(u.display))
				add('R3', 'short-developing-cause', 'error', at(u), `${u.surface} states a cause (${causes.join(', ')}) of a developing story as settled fact.`, 'Say who reports it ("FixtureSwap reports …") or mark it developing.');
			// what a title or a label accuses or names as the cause, a cited source must say
			const ids = att.resolved ? sourcesFor(ctx, att.resolved.name, ctx.citedIds) : [];
			const missing = unsupported(u, accusList, causes, groups, ids.length ? ctx.evidence(ids) : citedEv);
			if (missing.length)
				add('R3', 'not-in-sources', 'error', at(u), `${u.surface} says ${missing.map((x) => `"${x}"`).join(', ')}, but no cited source says that (in any form of the word).`, 'Use the words the sources use ("exploit", "hack"...) or drop it. A title or label never adds a cause or an accusation the sources do not make.', citedEv.excerptText);
			continue;
		}
		const specific =
			u.srcIds.length > 0 || SPECIFIC_REF.test(u.display) || scan.entities.some((e) => e.entry?.category !== 'show' && e.entry?.category !== 'term' && !(e.kind === 'unknown' && e.sentenceStart));
		const causes = u.kind === 'analysis' || !specific ? [] : causesIn(u);
		const loss = u.kind === 'sentence' && LOSS_WORDS.test(u.display) && extractNumbers(u.display, {words: 'display'}).some((n) => n.kind === 'money' || n.kind === 'crypto');
		if (!accus.length && !groups.length && !causes.length && !loss) continue;
		const terms = unique([...accus, ...groups, ...causes]);
		const what = [terms.length ? terms.map((x) => `"${x}"`).join(', ') : '', loss ? 'a loss amount' : ''].filter(Boolean).join(' and ');
		if (u.kind === 'sentence' && !u.srcIds.length) {
			add('R3', 'unsourced', 'error', at(u), `States ${what} with no source tag.`, 'Back it with [src:id] and say who reports it ("according to <source>"), or remove it.');
			continue;
		}
		if (u.kind === 'analysis') {
			if (accus.length || groups.length) add('R3', 'analysis-accusation', 'error', at(u), `The analysis makes an accusation (${terms.join(', ')}).`, 'Analysis describes patterns and flows; leave accusations to attributed narration.');
			continue;
		}
		const att = resolveAttribution(ctx, u);
		if (!att.resolved) {
			if (att.unresolved.length)
				add('R3', 'attribution-unsupported', 'error', at(u), `States ${what}, attributed to "${att.unresolved[0]}", but the cited source neither is nor names "${att.unresolved[0]}".`, 'Attribute to the cited source\'s publisher or to an organisation its excerpt names.');
			else if (loss && !terms.length)
				add('R3', 'loss-unattributed', 'error', at(u), 'States a loss amount without saying who reported it.', 'Loss amounts are always "reported by X": e.g. "FixtureSwap says attackers took $4.2M".');
			else add('R3', 'unattributed', 'error', at(u), `States ${what} without saying who says so.`, 'Say who: "according to <source>", "<source> says …", or remove it.');
			continue;
		}
		// an attribution is not enough: the cited source must itself say the accusation or the cause
		const missing = unsupported(u, accusList, causes, groups, ctx.evidence(u.srcIds));
		if (missing.length)
			add('R3', 'not-in-source', 'error', at(u), `Says ${missing.map((x) => `"${x}"`).join(', ')}, attributed to ${att.resolved.name}, but the cited source's stored text never says that (in any form of the word).`, 'Use the source\'s own words for what happened, or cut it. Attributing a word to a source that does not use it puts our words in its mouth.', ctx.evidence(u.srcIds).excerptText);
	}
	// facts in scenes that hide the sources card need a spoken attribution
	ctx.scenes.forEach((sc) => {
		if (sc.showSources !== false) return;
		for (const u of ctx.units.filter((x) => x.scene === sc && x.kind === 'sentence' && x.claims.length))
			if (!resolveAttribution(ctx, u).resolved)
				add('R3', 'sources-hidden', 'error', at(u), 'This scene hides the sources card (showSources: false) and the claim does not say who reported it.', 'Show the sources card, or say the source aloud ("according to …").');
	});
};

/** On-screen keys the show draws with "reported by <rekt.source publisher>" next to them (the Rekt Meter). */
const REKT_KEYS = /^(?:loss|lossAlt)$/;

/**
 * A money figure on a title, Short title, thumbnail, kicker, label or bullet: it carries its own attribution
 * ("$6.36B per DefiLlama", "DefiLlama: $6.36B", "FixtureSwap reports $4.2M drain") and that source states the figure
 * in the same role. Loss amounts are always "reported by X", on every surface.
 */
const shortFigures = (ctx: Ctx, u: Unit, add: Add) => {
	const figs = extractNumbers(u.display, {words: 'display'}).filter((n) => n.kind === 'money' || n.kind === 'crypto');
	if (!figs.length) return;
	const key = u.surface.replace(/^onScreen\./, '').replace(/\[\d+\]$/, '');
	if (u.scene && REKT_KEYS.test(key) && (u.scene as unknown as {rekt?: unknown}).rekt) return; // checked with the meter (R1)
	const att = shortAttribution(ctx, u, ctx.citedIds);
	if (!att) {
		add('R3', 'figure-unattributed', 'error', at(u), `${u.surface} shows ${figs.map((n) => `"${n.raw}"`).join(', ')} without saying who reports it.`, 'Give it a short attribution ("$6.36B per DefiLlama", "DefiLlama: $6.36B") or drop the figure. Loss amounts are always "reported by X", on every surface.');
		return;
	}
	const ev = ctx.evidence(att.ids);
	for (const n of figs) {
		if (!matchNum(n, ev.numbers, ev.dates).ok) {
			add('R3', 'figure-not-from-attributed', 'error', at(u), `${u.surface} attributes "${n.raw}" to ${att.name}, whose stored text does not state that figure.`, `Use the figure ${att.name} reports, word for word or with "about".`, ev.excerptText);
			continue;
		}
		const rm = roleMismatch(u.display, n, ev);
		if (rm) add('R1', 'figure-role', 'error', at(u), `"${n.raw}" is ${ROLE_WORDS[rm.claim]} on screen, but ${att.name} gives it as ${ROLE_WORDS[rm.source]}.`, 'Describe the figure as the source does, or drop it.', rm.text);
	}
	if (allTierC(ctx, att.ids)) add('R1', 'tier-c-only', 'error', at(u), `${u.surface} attributes its figure to a tier-C aggregator (${att.name}) alone.`, 'Use a tier-A or tier-B source\'s figure.');
};

// =====================================================================================================================
// R4: no personal names, except allowlisted officials named in a cited law-enforcement or regulator release
// =====================================================================================================================
const ruleR4 = (ctx: Ctx, add: Add) => {
	const officialOk = (name: string, sourceUrl: string): boolean =>
		ctx.citedIds.some((id) => {
			const bs = ctx.briefSources.get(ctx.resolveId.get(id) ?? id);
			if (!bs || (bs.kind !== 'law-enforcement' && bs.kind !== 'regulator')) return false;
			return bs.url === sourceUrl || hasPhrase(ctx.evidence([id]).excerptText, name);
		});
	for (const u of ctx.units) {
		const shown = new Set<string>();
		for (const {t, spoken} of texts(u)) {
			const scan = ctx.scan(t, u.kind === 'short');
			for (const p of scan.persons) {
				if (spoken && shown.has(`${p.reason}|${p.text}`)) continue;
				shown.add(`${p.reason}|${p.text}`);
				add('R4', p.reason, p.severity, at(u, spoken), personMessage(p) + '.', personFix(p));
			}
			for (const k of scan.known)
				if (k.entry.category === 'official' && k.entry.official && !officialOk(k.entry.official.name, k.entry.official.sourceUrl))
					add('R4', 'official-unsupported', 'error', at(u, spoken), `"${k.text}" is an allowlisted official, but no cited law-enforcement or regulator source names them.`, `Cite the release (${k.entry.official.sourceUrl}) with [src:id] as a law-enforcement or regulator source, or use the title only ("the ${k.entry.official.role}").`);
			const cjk = CJK_RUN.exec(t);
			if (cjk && !shown.has(`cjk|${cjk[0]}`)) {
				shown.add(`cjk|${cjk[0]}`);
				add('R4', 'cjk-text', 'error', at(u, spoken), `Contains Chinese, Japanese or Korean script ("${cjk[0]}"): the gate cannot read names in it, and court and police reports name people that way.`, 'Leave it out; an English video never needs it.');
			}
		}
	}
	// the storyboard's source list ends up in the video description: its titles and links must name no one either
	for (const s of Array.isArray(ctx.sb.sources) ? ctx.sb.sources : []) {
		if (!s || typeof s !== 'object') continue;
		const title = typeof s.title === 'string' ? s.title : '';
		const where: Where = {surface: 'storyboard.sources', text: `${String(s.id ?? '')}: ${clip(title, 120)}`};
		const scan = ctx.scan(title);
		for (const p of scan.persons)
			if (p.reason === 'placeholder' || p.reason === 'handle' || p.reason === 'blocked')
				add('R4', `source-${p.reason}`, 'error', where, `A source title in storyboard.sources ${personMessage(p).replace(/^"[^"]*" /, `contains "${p.text}" `)}.`, 'Use the outlet and a neutral description, or the brief\'s withheld form of the source.');
		if (CJK_RUN.test(title)) add('R4', 'cjk-text', 'error', where, 'A source title contains Chinese, Japanese or Korean script.', 'Use the outlet and a neutral description instead.');
		const slug = typeof s.url === 'string' ? slugName(s.url, ctx) : null;
		if (slug) add('R4', 'url-name', 'error', {surface: 'storyboard.sources', text: String(s.url)}, `The link's address spells what looks like a person's name ("${slug}").`, 'Use the brief\'s withheld form of this source (the outlet\'s address), as the radar writes it when a link names a person.');
	}
};

/** Chinese, Japanese or Korean script (2+ characters in a row). */
const CJK_RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]{2,}/u;

/**
 * A given name followed by another word in a link's path ("...-crypto-trader-john-doe-says-..."), unless the pair is an
 * allowlisted name: outlets put the people they write about in their slugs.
 */
const slugName = (url: string, ctx: Ctx): string | null => {
	let path = '';
	try {
		const u = new URL(url);
		path = decodeURIComponent(`${u.pathname} ${u.search}`);
	} catch {
		return null;
	}
	const words = path
		.normalize('NFKD')
		.replace(/\p{M}+/gu, '')
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean);
	for (let i = 0; i + 1 < words.length; i++) {
		const [a, b] = [words[i], words[i + 1]];
		if (!FIRST_NAMES.has(a) || b.length < 2 || /^\d/.test(b) || COMMON.has(b)) continue;
		const pair = `${a} ${b}`;
		if ((ctx.idx.byFirst.get(a) ?? []).some((en) => en.category !== 'blocked' && en.tokens.join(' ').startsWith(pair))) continue;
		return pair;
	}
	return null;
};

// =====================================================================================================================
// R5: no exploit how-tos
// =====================================================================================================================
const ruleR5 = (ctx: Ctx, add: Add) => {
	const sceneText = new Map<string, string>();
	for (const sc of ctx.scenes) sceneText.set(sc.id, ctx.units.filter((u) => u.scene === sc).map((u) => `${u.display} ${u.spoken}`).join(' '));
	for (const u of ctx.units) {
		const known = new Set(ctx.scan(u.display).known.map((k) => k.text.toLowerCase()));
		for (const {t, spoken} of texts(u)) {
			const offensive = OFFENSIVE.test(t) || (u.scene ? OFFENSIVE.test(sceneText.get(u.scene.id) ?? '') : false);
			for (const {p, m} of matches(HOWTO, t)) {
				if (p.contextual && !offensive) continue;
				// "keep auto-run and auto-approve modes off" is the defence, not the bypass
				if (p.code === 'bypass-setting' && DEFENSIVE_FRAME.test(t.slice(Math.max(0, m.index - 60), m.index + m.text.length + 60))) continue;
				add('R5', p.code, 'error', at(u, spoken), `Contains ${p.label}: "${clip(m.text, 60)}".`, 'Describe the mechanism at concept level ("a compromised key let attackers upgrade the contract"): no code, function names, addresses, payloads or steps.');
			}
			for (const m of findAll(CAMEL, t)) {
				if (known.has(m.text.toLowerCase())) continue;
				add('R5', 'camel-case', 'error', at(u, spoken), `Contains a code identifier: "${m.text}".`, 'Name the concept, not the function ("an upgrade function" at most).');
			}
		}
	}
	if (ctx.brief.aiStory) aiQuotes(ctx, add);
	// characters that render as nothing (Unicode tags, bidi controls, zero-width characters) hide text from the owner's
	// review: in a storyboard they can only be an injected instruction or a copy of one
	const hidden = new Set<string>();
	const walk = (value: unknown, path: string): void => {
		if (typeof value === 'string') {
			const m = INVISIBLE_CHARS.exec(value);
			if (m && !hidden.has(path)) {
				hidden.add(path);
				add('R5', 'hidden-characters', 'error', {surface: path, text: clip(value.replace(INVISIBLE_ALL, '⟨hidden⟩'), 120)}, `Contains a character that renders as nothing (U+${(m[0].codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}).`, 'Delete every hidden character; retype the text if it was pasted from a source.');
			}
		} else if (Array.isArray(value)) value.forEach((x, i) => walk(x, `${path}[${i}]`));
		else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k);
	};
	walk(ctx.sb, '');
	for (const sc of ctx.scenes) {
		// an ordered sequence of 3 or more actions by the attacker (or done to the victim), whatever the verbs:
		// "First, they sent ... Then ... Next ... Finally ...", "The attacker starts by ... After that ... Once ..."
		const sents = ctx.units.filter((x) => x.scene === sc && x.kind === 'sentence');
		let markers = 0;
		for (const u of sents) if (OFFENSIVE.test(u.display) || ATTACKER_REF.test(u.display) || ACTOR_REF.test(u.display)) markers += (u.display.match(SEQUENCE_MARKERS) ?? []).length;
		if (markers >= 3) add('R5', 'step-sequence', 'error', {surface: 'narration', scene: sc.id}, `The scene walks through the attack in ${markers} sequenced steps.`, 'Summarise how it worked in one or two concept-level sentences instead of a sequence.');
		// one sentence chaining the attacker's actions ("They sent ..., had ..., used ..., and signed ...")
		for (const u of sents) {
			const n = chainedActions(u.display);
			if (n >= 3) add('R5', 'step-sequence', 'error', at(u), `The sentence chains ${n} of the attacker's actions in order: a step list.`, 'Say what happened at concept level in one short sentence (what was compromised and what it let the attacker do), not the steps.');
		}
		// lists on screen: attack actions, numbered or not, are a step list whatever the verbs
		const sceneText = sents.map((u) => u.display).join(' ');
		for (const key of ['steps', 'bullets', 'nodes']) {
			const list = sc.onScreen?.[key];
			if (!Array.isArray(list)) continue;
			const items = list.filter((x): x is string => typeof x === 'string');
			const offensive = items.filter((x) => OFFENSIVE.test(x));
			const actions = items.filter(isActionItem);
			const ctxAttack = attackContext(sc, sceneText, items);
			if (offensive.length >= 2 || (actions.length >= 3 && ctxAttack))
				add('R5', 'step-list', 'error', {surface: `onScreen.${key}`, scene: sc.id, text: clip((offensive.length >= 2 ? offensive : actions).join(' / '), 200)}, `onScreen.${key} lists ${Math.max(offensive.length, actions.length)} attack steps.`, 'On-screen lists hold takeaways or defences, never the attack sequence. Keep "how it worked" to at most 3 concept nodes with no actor verbs ("A fake job interview" → "The signing service").');
		}
		// a diagram whose nodes are actions, or a chain of 4+ nodes linked by "then"/"next"
		const nodes = Array.isArray(sc.onScreen?.nodes) ? (sc.onScreen.nodes as unknown[]).filter((x): x is string => typeof x === 'string') : [];
		const links = Array.isArray(sc.onScreen?.links) ? (sc.onScreen.links as unknown[]).filter((x): x is string => typeof x === 'string') : [];
		const d = diagramSteps(nodes, links);
		if (d.steps) add('R5', 'diagram-steps', 'error', {surface: 'onScreen.nodes', scene: sc.id, text: clip(nodes.join(' → '), 200)}, `The diagram is a step list: ${d.why}.`, 'Use at most 3 concept nodes (noun phrases, no actor verbs) with plain links ("led to"), not the attack sequence.');
	}
};

/** Quoted spans of 3 or more words in a unit (the whole field for onScreen.quote), as written. */
const quotesIn = (u: Unit, t: string): string[] => {
	const n = normalizePunct(t);
	const raw = u.surface === 'onScreen.quote' ? [n.replace(/^["\s]+|["\s]+$/g, '')] : findAll(QUOTE_RE, n).map((m) => m.text.slice(1, -1));
	return raw.map((q) => q.trim()).filter((q) => q.split(/\s+/).length >= 3);
};
/** A setting's label or the One Fix's own wording in quotes ("turn on “ask before running commands”"): not a statement. */
const DEFENSIVE_QUOTE_CONTEXT = /\b(?:one fix|turn(?:ed)? (?:on|off)|switch(?:ed)? (?:on|off)|enable|tick|untick|uncheck|select|choose|setting|settings|option|toggle|checkbox|box|button|menu|labelled|labeled|called)\b/i;
/** Title Case words: a named technique or campaign ("the “Man in the Prompt” attack"), not a statement. */
const titleCased = (q: string): boolean => {
	const words = q.split(/\s+/).filter((w) => /^[\p{L}]/u.test(w) && !/^(?:a|an|the|of|in|on|at|to|for|and|or|by|with|from|via)$/i.test(w));
	return words.length > 0 && words.every((w) => /^\p{Lu}/u.test(w));
};

/**
 * AI stories: quoted words are an organisation's own statement, never the attack's text. A quote that reads as an
 * instruction to an AI is refused whoever said it; a quote framed as the attack's text ("the hidden text said “...”")
 * is refused; and a narration quote needs an organisation that says it in the same sentence (resolveAttribution).
 * Setting labels in the One Fix and named techniques in Title Case are not statements and pass.
 */
const aiQuotes = (ctx: Ctx, add: Add): void => {
	for (const u of ctx.units) {
		for (const {t, spoken} of texts(u)) {
			for (const q of quotesIn(u, t))
				if (isQuotedInstruction(q))
					add('R5', 'ai-quoted-instruction', 'error', at(u, spoken), `Quotes an instruction to an AI: "${clip(q, 80)}".`, 'Never quote or paraphrase the injected instruction, prompt or jailbreak. Say what kind of attack it was and what it reached, attributed ("hidden instructions on a web page made the coding agent read secrets, according to <vendor>").');
			const frame = AI_QUOTE_FRAME.exec(normalizePunct(t));
			if (frame) add('R5', 'ai-quote-frame', 'error', at(u, spoken), `Repeats the attack's own text ("${clip(frame[0], 60)}").`, "Quote only an organisation's statement (the vendor, the researchers' firm, the outlet). Describe the hidden text at concept level, without its words.");
		}
		if (u.kind !== 'sentence') continue;
		const statements = quotesIn(u, u.display).filter((q) => !titleCased(q));
		if (!statements.length || DEFENSIVE_QUOTE_CONTEXT.test(u.display)) continue;
		if (!resolveAttribution(ctx, u).resolved)
			add('R5', 'ai-quote-unattributed', 'error', at(u), `In an AI story a quote is an organisation's own statement, but "${clip(statements[0], 60)}" has no organisation that says it in this sentence.`, 'Name who says it in the same sentence ("<vendor> said “...”", "according to <outlet>, “...”"), or paraphrase without quotation marks.');
	}
};

// =====================================================================================================================
// R6: no speculation unless the cited source says it (an attributed quote)
// =====================================================================================================================
const ruleR6 = (ctx: Ctx, add: Add) => {
	for (const u of ctx.units) {
		for (const {t, spoken} of texts(u)) {
			for (const {p, m} of matches(SPECULATION, t)) {
				if (u.kind === 'sentence' && u.srcIds.length) {
					const att = resolveAttribution(ctx, u);
					if (att.resolved) {
						if (p.code === 'reportedly') continue;
						if (hasPhrase(ctx.evidence(u.srcIds).excerptText, m.text)) continue;
					}
				}
				add(
					'R6',
					p.code,
					'error',
					at(u, spoken),
					`Speculation: ${p.label} ("${m.text}")${u.kind === 'sentence' && u.srcIds.length ? ', and the cited source does not say it' : ''}.`,
					p.code === 'reportedly' ? 'Name who reports or alleges it ("the DOJ alleges …").' : 'State only what the sources confirm. A hedge is allowed only when you attribute it and the cited excerpt says it.',
				);
			}
			if (u.kind === 'short' && /\?\s*$/.test(t) && (matches(ACCUSATIONS, t).length || matches(CAUSES, t).length))
				add('R6', 'question-headline', 'error', at(u, spoken), 'A question headline about a cause or culprit implies an accusation.', 'State what is confirmed instead ("FixtureSwap reports $4.2M drain").');
		}
	}
	// titles, thumbnails and labels never carry what a source only suspects ("Chainflip key stolen" when the source says
	// "Chainflip Suspects Key Theft"): there is no room for the hedge and the attribution
	// every source in the brief, cited or not: a title speaks about the incident as a whole
	const pubWords = nameWords(ctx);
	const spans = hedgedSpans(ctx.evidence(unique([...ctx.citedIds, ...ctx.brief.sources.map((x) => x.id)])).raw);
	if (spans.length)
		for (const u of ctx.units) {
			if (u.kind !== 'short' || (!matches(CAUSES, u.display).length && !matches(ACCUSATIONS, u.display).length)) continue;
			const h = hedgedMatch(u.display, spans, pubWords);
			if (h) add('R6', 'hedged-in-title', 'error', at(u), `${u.surface} states what a cited source only hedges ("${h.hedge}": "${clip(h.span, 120)}").`, 'Keep suspected mechanisms out of titles, labels and thumbnails; say them in the narration with the hedge and the attribution, labelled developing.', h.sentence);
		}
};

// =====================================================================================================================
// R7: real analysis in every video
// =====================================================================================================================
const KINDS = ['fund-flow', 'pattern', 'comparison', 'stat'];
const BASES = ['own-data', 'source'];

const ruleR7 = (ctx: Ctx, add: Add): RulesOutput['analysis'] => {
	const A = ctx.analysis;
	const w: Where = {surface: 'analysis'};
	if (!A.length) {
		add('R7', 'no-analysis', 'error', w, 'The storyboard has no analysis element, so the video adds no real analysis (owner rule: no daily video without it).', 'Add storyboard.analysis: [{"kind": "fund-flow"|"pattern"|"comparison"|"stat", "basis": "own-data"|"source", "detail": "…", "sourceIds": ["…"], "sceneIds": ["s04"]}] and present it in a scene.');
		return [];
	}
	for (const a of A) {
		const aw: Where = {surface: `analysis[${a.id}]`, text: clip(a.detail, 200)};
		if (!KINDS.includes(a.kind)) add('R7', 'kind', 'error', aw, `analysis.kind "${String(a.kind)}" is not one of ${KINDS.join(', ')}.`, `Use one of ${KINDS.join(', ')}.`);
		if (!BASES.includes(a.basis)) add('R7', 'basis', 'error', aw, `analysis.basis "${String(a.basis)}" is not "own-data" or "source".`, 'Say whether we computed it (own-data) or a source states it (source).');
		const stems = contentStems(a.detail);
		if (a.detail.trim().length < 40 || stems.size < 6) add('R7', 'thin', 'error', aw, 'The analysis detail is too thin to count as analysis.', 'Write one or two sentences that say what the comparison, pattern, flow or statistic shows.');
		if (!a.sourceIds.length) add('R7', 'no-sources', 'error', aw, 'The analysis cites no sources.', 'List the source ids the analysis rests on (the data for own-data).');
		for (const sid of a.sourceIds) if (!ctx.sbSources.has(sid) && !ctx.briefSources.has(sid)) add('R7', 'unknown-source', 'error', aw, `analysis cites "${sid}", which is in neither storyboard.sources nor the brief.`, 'Use a source id from the brief.');
		for (const f of ctx.brief.facts) {
			const fs = contentStems(f.text);
			if (stems.size && fs.size && coverage(stems, fs) >= 0.85 && coverage(fs, stems) >= 0.85) {
				add('R7', 'restates-fact', 'error', aw, `The analysis only restates brief fact "${f.id}".`, 'Add something the headline does not: a comparison with past incidents, a pattern, a fund flow or a statistic.');
				break;
			}
		}
		if ((a.kind === 'pattern' || a.kind === 'comparison') && a.basis === 'source' && unique(a.sourceIds).length < 2)
			add('R7', 'needs-two-points', 'error', aw, `A ${a.kind} needs at least two data points, but it cites one source.`, 'Cite the sources for both sides of the comparison, or compute it from our own data (basis "own-data").');
		if (a.basis === 'own-data') {
			const method = typeof a.method === 'string' ? a.method.trim() : '';
			if (method.length < 10) add('R7', 'no-method', 'error', aw, 'Own-data analysis without a method, so nobody can check its figures.', 'Add "method": the data it reads (the brief source ids or fact ids), the filter and the count, so the owner can reproduce it in the review.');
			else if (!/\d/.test(method) || !(a.sourceIds.some((sid) => method.includes(sid)) || /\b(?:brief|rows?|records?|facts?|radar|t\d+|h\d+)\b/i.test(method)))
				add('R7', 'method-not-reproducible', 'error', aw, 'The method does not say which stored data it counted, or gives no count.', 'Name the data (the source id or fact ids in brief.json), the filter, and the counts it produced.');
			// every figure we computed must be reproducible from the brief: a number the daily brief's analysis computed,
			// a figure in the analysis' own stored rows, a count of those rows, or a span between their dates
			const ev = ctx.evidence(a.sourceIds);
			const oppNums = ctx.brief.opportunities.flatMap((o) => o.numbers);
			const rows = unique(a.sourceIds.flatMap((sid) => ctx.briefSources.get(ctx.resolveId.get(sid) ?? sid)?.excerpts ?? [])).length;
			const dates = [...ev.dates, ...datesIn(extractNumbers(a.detail, {words: 'display'})), ...datesIn(extractNumbers(method, {words: 'display'})), ...isoDates((ev.raw.join(' ').match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? []))];
			const year = ev.dates.find((d) => d.year)?.year ?? new Date().getUTCFullYear();
			const spans = spansBetween(dates, year);
			for (const n of a.numbers) {
				if (n.kind === 'date' || n.kind === 'time' || n.kind === 'year') continue;
				if (matchNum(n, ev.numbers, ev.dates).ok) continue;
				const v = n.value;
				const unit = unitAfter(a.detail, n.end);
				if (n.kind === 'plain' && (oppNums.some((x) => Math.abs(x - v) < 1e-9) || (!unit && v === rows) || (unit && spans[unit].includes(v)))) continue;
				if (n.kind === 'percent' && oppNums.some((x) => Math.abs(x - v) < 0.051)) continue;
				add('R7', 'own-data-unverified', 'error', aw, `"${n.raw}" cannot be reproduced from the brief: it is not a figure the daily brief computed${ctx.brief.opportunities.length ? ` (${unique(oppNums).join(', ') || 'none'})` : ''}, nor in the analysis' stored rows.`, 'Use the counts the brief computed (brief.json analysisOpportunities numbers) or recount from the stored rows and fix the figure; never estimate.', ev.excerptText);
			}
		}
		if (a.basis === 'source') {
			const ev = ctx.evidence(a.sourceIds);
			for (const n of a.numbers) if (!matchNum(n, ev.numbers, ev.dates).ok) add('R7', 'number-not-in-source', 'error', aw, `"${n.raw}" is not in the excerpts of the analysis' sources.`, 'For basis "source", every figure must be in the cited excerpts; computed figures are "own-data".');
		}
		for (const sid of Array.isArray(a.sceneIds) ? a.sceneIds : []) if (!ctx.scenes.some((s) => s.id === sid)) add('R7', 'unknown-scene', 'error', aw, `analysis.sceneIds names "${sid}", which is not a scene.`, 'Use the id of the scene that presents the analysis.');
		if (!a.presentedIn.length) add('R7', 'not-presented', 'error', aw, 'No scene presents this analysis, so viewers never see it.', 'Present it in a scene (narration and/or on-screen) and list that scene in analysis.sceneIds.');
	}
	if (ctx.sb.news?.format === 'weekly-roundup' && !A.some((a) => a.kind === 'fund-flow'))
		add('R7', 'roundup-needs-fund-flow', 'error', w, 'A weekly round-up needs a fund-flow analysis (owner cadence).', 'Add an analysis with kind "fund-flow".');
	for (const sh of Array.isArray(ctx.sb.shorts) ? ctx.sb.shorts : [])
		if (!(sh.sceneIds ?? []).some((id) => A.some((a) => a.presentedIn.includes(id))))
			add('R7', 'short-without-analysis', 'error', {surface: `shorts[${sh.id}]`, text: sh.title}, `Short "${sh.id}" contains no scene that presents an analysis; each published video must add real analysis.`, 'Include the analysis scene in the Short.');
	return A.map((a) => ({id: a.id, kind: String(a.kind), basis: String(a.basis), detail: a.detail, sourceIds: a.sourceIds, presentedIn: a.presentedIn}));
};

// =====================================================================================================================
// R8: corrections
// =====================================================================================================================
/** Problems a standalone text has under the strict text rules (names, how-to, speculation, price talk). Used for corrections. */
export const textProblems = (scan: (t: string) => NameScan, text: string): string[] => {
	const out: string[] = [];
	for (const p of scan(text).persons) if (p.severity === 'error') out.push(personMessage(p));
	for (const {p, m} of matches(HOWTO, text)) if (!p.contextual) out.push(`${p.label}: "${m.text}"`);
	for (const {p, m} of matches(SPECULATION, text)) out.push(`${p.label}: "${m.text}"`);
	const cleaned = text.replace(PRICE_ALLOWED, (x) => ' '.repeat(x.length));
	for (const {p, m} of matches(PRICE, cleaned)) out.push(`${p.label}: "${m.text}"`);
	return out;
};

const ruleR8 = (ctx: Ctx, add: Add, raw: unknown | null): RulesOutput['corrections'] => {
	const out: RulesOutput['corrections'] = {applicable: [], pinnedComments: []};
	let file: CorrectionsFile = {version: 1, corrections: []};
	if (raw !== null) {
		const v = validateCorrections(raw);
		const errs = v.problems.filter((p) => p.level === 'error');
		for (const p of errs) add('R8', 'corrections-file', 'error', {surface: 'corrections', text: p.id}, `corrections.json: ${p.msg}`, 'Fix content/zoora-security/corrections.json (see README "Corrections").');
		if (v.file) file = v.file;
		else if (!errs.length) return out;
	}
	const incidentIds = unique(ctx.brief.facts.map((f) => ctx.incidentOf(f)).filter((x): x is string => !!x));
	const applicable = correctionsFor(file, ctx.slug, incidentIds);
	// the brief's publisher names ("Example Wire") beat a bare host name; storyboard ids map onto brief sources
	const refs: SourceRef[] = [
		...[...ctx.sbSources.values()].map((s) => {
			const b = ctx.briefSources.get(ctx.resolveId.get(s.id) ?? s.id);
			return {id: s.id, url: s.url, publisher: b?.publisher ?? publisherFor(s.url ?? ''), title: s.title};
		}),
		...ctx.brief.sources.map((s) => ({id: s.id, url: s.url, publisher: s.publisher, title: s.title})),
	];
	const narration = ctx.units.filter((u) => u.kind === 'sentence');
	for (const c of applicable) {
		out.applicable.push(c.id);
		const cw: Where = {surface: `corrections[${c.id}]`, text: clip(c.correct, 200)};
		const missing = c.sourceIds.filter((id) => !refs.some((r) => r.id === id) && !c.sources?.some((s) => s.id === id));
		if (missing.length) add('R8', 'correction-source', 'error', cw, `Correction "${c.id}" cites ${missing.join(', ')}, which is not in this episode's sources or inline sources.`, 'Add the source to the correction\'s "sources" (id, url, publisher).');
		const problems = textProblems(ctx.scan, c.correct);
		for (const pr of problems) add('R8', 'correction-text', 'error', cw, `The corrected text breaks a news rule: ${pr}.`, 'Corrections follow the same rules: attributed, no names, no speculation, no price talk.');
		const wrongOk = !!c.wrong && textProblems(ctx.scan, c.wrong).length === 0;
		const text = pinnedCommentText(c, refs, wrongOk);
		if (text.length > COMMENT_MAX) add('R8', 'comment-too-long', 'error', cw, `The pinned comment is ${text.length} characters (YouTube allows ${COMMENT_MAX}).`, 'Shorten "correct".');
		else if (text.length > COMMENT_SOFT_MAX) add('R8', 'comment-long', 'warning', cw, `The pinned comment is ${text.length} characters; keep corrections short enough to read at a glance.`, `Aim for under ${COMMENT_SOFT_MAX} characters.`);
		out.pinnedComments.push({id: c.id, status: c.status, text});
		if (c.slug === ctx.slug && c.status === 'pending') add('R8', 'pin-pending', 'warning', cw, `Correction "${c.id}" is not pinned yet.`, `Pin this comment on the video and its Shorts, then set status "pinned" and pinnedAt: ${text}`);
		if (c.slug !== ctx.slug && !narration.some((u) => /\bcorrect(?:ion|ed)\b/i.test(u.spoken)))
			add('R8', 'mention-correction', 'warning', cw, `This episode covers incident "${c.incidentId}", which has a correction from ${c.date} (episode ${c.slug}).`, 'Consider an on-air line about the correction, and do not repeat the corrected claim.');
		if (c.wrong) {
			const wStems = contentStems(c.wrong);
			const wNums = extractNumbers(c.wrong, {words: 'display'});
			for (const u of narration) {
				const uNums = extractNumbers(u.display, {words: 'display'});
				const numsOk = wNums.length ? wNums.every((n) => uNums.some((x) => matchNum(n, [x]).ok)) : true;
				if (wStems.size >= 2 && coverage(wStems, contentStems(u.display)) >= 0.8 && numsOk)
					add('R8', 'repeats-corrected-claim', 'error', at(u), `Repeats the claim corrected on ${c.date} ("${clip(c.wrong, 100)}").`, `Use the corrected fact instead: ${c.correct}`);
			}
		}
	}
	return out;
};

// =====================================================================================================================
// R9: no price talk, financial advice or income claims
// =====================================================================================================================
const ruleR9 = (ctx: Ctx, add: Add) => {
	const tickers = knownTickers();
	for (const u of ctx.units) {
		for (const {t, spoken} of texts(u)) {
			const cleaned = t.replace(PRICE_ALLOWED, (x) => ' '.repeat(x.length));
			// price moves with no number ("BNB tanked", "with bitcoin rallying"), spelled-out percentages ("fell five
			// percent"), and pump/dump in titles and thumbnails
			const move = priceMoveWithoutNumber(cleaned, tickers);
			if (move) add('R9', 'price-direction', 'error', at(u, spoken), `Contains a price move: "${clip(move, 60)}".`, 'The news show covers security, not markets: no token or market moves, even without a number.');
			const words = cleaned.toLowerCase().match(/[a-z]+/g) ?? [];
			if (extractNumbers(cleaned, {words: 'display'}).some((n) => n.kind === 'percent') && words.some((w) => PRICE_VERB.test(w)))
				add('R9', 'price-move', 'error', at(u, spoken), 'Contains a price move given as a percentage.', 'No price or market moves on the news show.');
			if (u.kind === 'short') {
				const pd = PUMP_DUMP.exec(cleaned);
				if (pd) add('R9', 'pump-dump', 'error', at(u, spoken), `A title, label or thumbnail says "${pd[0]}": market talk.`, 'Titles and thumbnails cover the security story, never token moves.');
			}
			for (const {p, m} of matches(PRICE, cleaned)) {
				if (p.code === 'cta') {
					if (NEGATED_CTA.test(cleaned.slice(Math.max(0, m.index - 40), m.index))) continue;
					if (insideQuotes(t, m.index)) continue;
				}
				add('R9', p.code, 'error', at(u, spoken), `Contains ${p.label}: "${clip(m.text, 60)}".`, 'The news show covers security, not markets: no prices, price moves, advice, returns or calls to action. "Not financial advice" is fine.');
			}
		}
	}
	for (const sc of ctx.scenes)
		if (sc.type === 'chart' || sc.chart)
			add('R9', 'price-chart', 'error', {surface: 'scene', scene: sc.id}, 'A chart scene: the chart template draws price or market-cap candles, which is price talk on the news channel.', 'Show fund flows or incident stats as a talk scene (title + bullets) instead.');
};

// =====================================================================================================================
// R10: don't redraw or embed others' material
// =====================================================================================================================
const SHOW_POSSESSIVE = /^(?:zoo|badger|zoora)(?:'s|’s)\b/i;
const ruleR10 = (ctx: Ctx, add: Add) => {
	for (const u of ctx.units)
		for (const {t, spoken} of texts(u))
			for (const {p, m} of matches(OTHERS_MATERIAL, t)) {
				if (p.code === 'their-media' && SHOW_POSSESSIVE.test(m.text)) continue;
				add('R10', p.code, 'error', at(u, spoken), `Uses others' material: ${p.label} ("${clip(m.text, 60)}").`, "Don't show, redraw or recreate another outlet's charts, images or posts. Describe the finding and attribute it.");
			}
	for (const sc of ctx.scenes)
		for (const key of Object.keys(sc.onScreen ?? {}))
			if (MEDIA_KEYS.test(key)) add('R10', 'media-key', 'error', {surface: `onScreen.${key}`, scene: sc.id}, `onScreen.${key} would embed outside media.`, 'All art is drawn in code; describe the material and attribute it instead.');
};

// =====================================================================================================================

export const summarize = (findings: Finding[]): RuleSummary[] =>
	RULE_ORDER.map((rule) => {
		const fs = findings.filter((f) => f.rule === rule);
		const errors = fs.filter((f) => f.severity === 'error').length;
		const warnings = fs.filter((f) => f.severity === 'warning').length;
		return {rule, title: ruleTitle[rule], status: errors ? 'fail' : warnings ? 'warn' : 'pass', errors, warnings};
	});

export const sortFindings = (fs: Finding[]): Finding[] => {
	const sev: Record<Severity, number> = {error: 0, warning: 1, info: 2};
	return [...fs].sort((a, b) => sev[a.severity] - sev[b.severity] || RULE_ORDER.indexOf(a.rule) - RULE_ORDER.indexOf(b.rule));
};

