/**
 * The claim gate: one episode storyboard (one language) in, a ClaimReport out. Fails (errors) when:
 *  - a narration sentence looks factual (numbers, %, money, dates, superlatives, "according to", named organisations)
 *    and has no [src:id], or cites an id with no source;
 *  - a source is unverified, not https, or has no accessed date;
 *  - a must-not-say phrase appears: research.md "Must not say" bullets, the global income/return list (per language),
 *    a name from data/private/names.txt, or a wallet-address-like string;
 *  - fiction is true and there is no disclaimer card or scene;
 *  - offers exist and the narration does not SAY the disclosure;
 *  - (translations) a scene's claim tags differ from the source scene's.
 * Added 2026-11-24 (VCD fix): no private-names list is an error unless --no-names skips it on purpose; a translation is
 * also checked against its own "Must not say (<lang>)" section and its back-translation record, and runs the dub
 * validator's record, number and tag checks; negation stops at clause ends; a disclosure or fiction word that is
 * negated does not count; on-screen figures and title/thumbnail claims must be backed by a cited sentence; offers,
 * token promotion, MiCA, ASCI, persona and holdings rules (regional.ts).
 * Reads files through load.ts; everything else is pure.
 */
import {existsSync, readFileSync} from 'node:fs';
import {basename, join, relative} from 'node:path';
import type {Lang, Storyboard, StoryboardScene} from '../../../src/episode/types.ts';
import {displayText, MarkupError, sourceIds, spokenText} from '../../../src/episode/markup.ts';
import {EN_UI} from '../../../src/episode/i18n/ui.ts';
import type {ClaimReport, ClaimRow, Finding, WaiverRow} from './types.ts';
import {factualSignals, signalLabel} from './factual.ts';
import {incomeHits, saysUnnegated, spansOf} from './income.ts';
import {DISCLOSURE, FICTION, MACHINE_LEXICON, PARTIAL_LEXICON, type DisclosureKind} from './lexicon.ts';
import {channelSlugOf, defaultOffersPath, loadOffers, loadStoryboard, readJson, sourceStoryboardFile, STUDIO, storyboardFile, isRecord, type OfferInfo} from './load.ts';
import {parseMustNotSay, scanMustNotSay, type MnsList} from './mustnotsay.ts';
import {findNames, loadNames, redactNames, type NameList} from './names.ts';
import {loadBacktranslation, scanBacktranslation} from './backtranslation.ts';
import {regionalFindings, type RegionalFields} from './regional.ts';
import {extractQuantities, type Quantity} from '../../dub/lib/numbers.ts';
import {relDiff, wordQuantities} from '../../dub/lib/numwords.ts';
import {validateDub} from '../../dub/lib/validate.ts';
import {readdirSync} from 'node:fs';
import {splitSentences} from './narration.ts';
import {checkSources} from './sources.ts';
import {allMatches, clean, oneLine} from './text.ts';
import {findWallets, KIND_LABEL, redactWallets} from './wallets.ts';

export type CheckInput = {
	/** Absolute episode folder (content/<channel>/<slug>). */
	dir: string;
	/** Language to check; default: storyboard.json's own language. */
	lang?: Lang;
	/** YYYY-MM-DD, for accessed-date checks. */
	today: string;
	/**
	 * Private names list. null = skipped on purpose (--no-names: a warning, and the summary line says so). A path whose
	 * file does not exist is an error ("no-names-list"): the check must never be off without anyone noticing.
	 */
	namesPath: string | null;
	/** research.md; default <dir>/research.md. */
	researchPath?: string | null;
	/** Offer registry; default creator-hub/config/offers.json (else offers.example.json). */
	offersPath?: string | null;
	/** ISO timestamp written to the report. */
	now?: string;
};

const LINKS = /(?:https?:\/\/)?(?:t\.me|telegram\.me|telegram\.dog|discord\.gg|discord\.com\/invite|chat\.whatsapp\.com)\/\S+|[?&](?:ref|referral|invite|aff|affiliate|r|code|promo)=[^\s&]+/giu;

/** Loose comparison used for "is the disclosure said": letters and digits only, no case, no accents. */
export const loose = (s: string): string =>
	s
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]/gu, '');

const onScreenEntries = (sc: StoryboardScene): Array<{field: string; text: string}> => {
	const out: Array<{field: string; text: string}> = [];
	for (const [k, v] of Object.entries(sc.onScreen ?? {})) {
		if (typeof v === 'string') out.push({field: `onScreen.${k}`, text: v});
		else if (Array.isArray(v)) v.forEach((x, i) => typeof x === 'string' && out.push({field: `onScreen.${k}[${i}]`, text: x}));
	}
	return out;
};
type RegionalRegistry = Map<string, OfferInfo> | null;

const str = (sc: StoryboardScene, k: string): string => {
	const v = sc.onScreen?.[k];
	return typeof v === 'string' ? v.trim() : '';
};
/** onScreen fields that hold narration words (reveal cues), not copy. */
const CUE_FIELD = /^onScreen\.(?:cues|badgerCue)(?:\[|$)/;

/** Signals that make an on-screen string or a title a figure claim. */
const FIGURE_KINDS = new Set(['number', 'percent', 'currency', 'scale']);
/** Quantities of a text: written in digits and in words. */
const quantitiesOf = (text: string, lang: Lang): Quantity[] => [...extractQuantities(text, lang), ...wordQuantities(text, lang)];
/** Is every digit figure of `text` (on screen, a title) said in one of `cited` (cited sentences, display and spoken)? */
const figuresBacked = (text: string, cited: string[], lang: Lang): {ok: boolean; missing: string[]} => {
	const figures = extractQuantities(text, lang).filter((q) => !q.month);
	const pool = cited.flatMap((c) => quantitiesOf(c, lang));
	const missing = figures.filter((f) => !pool.some((q) => relDiff(q.value, f.value) <= 0.005 || (q.pct === f.pct && relDiff(q.value, f.value) <= 0.06)));
	return {ok: !missing.length, missing: missing.map((m) => m.raw)};
};
const STOP = new Set(
	`the a an of on in to and or for is are was were be it its this that these those with by at from as why how what who your you my our their they we i
	el la los las un una unos unas de del en y o por para es son que se su sus al lo como qué por qué
	o a os as um uma uns umas de do da dos das em no na nos nas e ou por para é são que se seu sua ao como
	il lo la i gli le un una di del della in e o per è sono che si suo sua al come`.split(/\s+/),
);
const contentWords = (s: string): string[] =>
	clean(s)
		.toLowerCase()
		.split(/[^\p{L}\p{N}.$%]+/u)
		.map((w) => w.replace(/^[.]+|[.]+$/g, ''))
		.filter((w) => w.length >= 2 && !STOP.has(w));
/** Does one cited sentence carry most of the title's content words (the same claim)? */
const sameClaim = (text: string, cited: string[]): boolean => {
	const want = [...new Set(contentWords(text))];
	if (!want.length) return true;
	return cited.some((c) => {
		const have = new Set(contentWords(c));
		return want.filter((w) => have.has(w)).length / want.length >= 0.5;
	});
};

type Waiver = WaiverRow & {where: string};

export const checkEpisode = (input: CheckInput): ClaimReport => {
	const {dir, today} = input;
	const file = storyboardFile(dir, input.lang);
	const sb: Storyboard = loadStoryboard(file.path);
	const lang = file.lang;
	const findings: Finding[] = [];
	const notes: string[] = [];
	const names: NameList = loadNames(input.namesPath);
	if (input.namesPath === null) names.skipped = true;
	const safe = (s: string) => redactWallets(redactNames(s, names));
	const seen = new Set<string>();
	const push = (f: Finding) => {
		const key = `${f.level}|${f.rule}|${f.where}|${f.message}`;
		if (seen.has(key)) return;
		seen.add(key);
		findings.push({...f, text: f.text === undefined ? undefined : oneLine(safe(f.text), 260)});
	};
	const {channel, slug} = channelSlugOf(dir);
	if (sb.channel !== channel || sb.slug !== slug)
		push({level: 'warning', rule: 'folder-mismatch', where: 'storyboard', message: `storyboard says ${sb.channel}/${sb.slug} but the folder is ${channel}/${slug}`, fix: 'Keep channel and slug equal to the content folder (the renderer looks the storyboard up by them).'});
	if (sb.lang !== lang) push({level: 'error', rule: 'lang-mismatch', where: 'storyboard', message: `${basename(file.path)} says lang "${sb.lang}"`, fix: `A ${lang} storyboard lives in storyboard.${lang}.json with "lang": "${lang}".`});
	if (PARTIAL_LEXICON.has(lang)) notes.push(`The ${lang} lexicons are partial: superlatives, attributions and income claims in ${lang} need a native reviewer's read.`);
	else if (MACHINE_LEXICON.has(lang)) notes.push(`The ${lang} lexicons (income and return promises, persona, holdings, disclosures, superlatives) are machine-made: a native speaker reviews them, and this script, before it airs.`);
	if (input.namesPath === null)
		push({level: 'warning', rule: 'names-not-checked', where: 'names', message: 'private names were NOT checked (--no-names)', fix: 'Run without --no-names where data/private/names.txt exists (the owner keeps the real names behind every "[named person]" there).'});
	else if (!names.path)
		push({
			level: 'error',
			rule: 'no-names-list',
			where: relative(STUDIO, input.namesPath) || input.namesPath,
			message: `no private names list at ${relative(STUDIO, input.namesPath) || input.namesPath}: private names cannot be checked`,
			fix: 'Create data/private/names.txt (gitignored) with the real names and handles behind every "[named person]" in the research files, one per line. Only a run that cannot have the list (CI) skips it, explicitly, with --no-names.',
		});
	const isTranslation = sb.lang !== sb.sourceLang;

	// --- research.md: Must not say
	const researchPath = input.researchPath === undefined ? join(dir, 'research.md') : input.researchPath;
	let mns: MnsList = {found: false, heading: null, rules: []};
	let mnsLocal: MnsList = {found: false, heading: null, rules: []};
	if (!researchPath || !existsSync(researchPath)) {
		push({level: 'error', rule: 'no-research', where: 'research.md', message: `no research.md next to the storyboard${researchPath ? ` (${relative(STUDIO, researchPath)})` : ''}`, fix: 'Every episode needs research.md with a "## Must not say" section (bullets; "- (none)" if there is nothing). Run the research step first.'});
	} else {
		const md = readFileSync(researchPath, 'utf8');
		mns = parseMustNotSay(md);
		if (!mns.found) push({level: 'error', rule: 'no-must-not-say', where: 'research.md', message: 'research.md has no "Must not say" section', fix: 'Add a "## Must not say" section with one bullet per banned phrase or topic ("- (none)" if there is nothing).'});
		if (isTranslation) {
			mnsLocal = parseMustNotSay(md, lang);
			push({
				level: 'warning',
				rule: 'must-not-say-language',
				where: 'research.md',
				message: `the research "Must not say" phrases are ${sb.sourceLang}: in this ${lang} script they match only figures, handles and names, so every rule is listed below for a human read${mnsLocal.found ? `; the ${mnsLocal.rules.length} "Must not say (${lang})" rules were matched` : ''}`,
				fix: mnsLocal.found ? `Read the listed rules against the ${lang} script; keep "## Must not say (${lang})" up to date.` : `Add a "## Must not say (${lang})" section to research.md with the banned phrases in ${lang} (and keep the back-translation record current: its English is scanned too).`,
			});
		}
	}

	// --- waivers
	const waivers: Waiver[] = [];
	for (const sc of sb.scenes) {
		const list = (sc as {claimWaivers?: unknown}).claimWaivers;
		if (list === undefined) continue;
		if (!Array.isArray(list)) {
			push({level: 'error', rule: 'bad-waiver', where: `${sc.id} · claimWaivers`, scene: sc.id, message: 'claimWaivers must be an array', fix: 'Use [{"match": "...", "rule": "factual" | "income", "reason": "..."}].'});
			continue;
		}
		list.forEach((w, i) => {
			const where = `${sc.id} · claimWaivers[${i}]`;
			if (!isRecord(w) || typeof w.match !== 'string' || !w.match.trim() || (w.rule !== 'factual' && w.rule !== 'income') || typeof w.reason !== 'string' || w.reason.trim().length < 8) {
				push({level: 'error', rule: 'bad-waiver', where, scene: sc.id, message: 'a waiver needs a non-empty "match", "rule": "factual" or "income", and a "reason" of at least a few words', fix: 'Fix the entry, or remove it and rephrase the sentence instead.'});
				return;
			}
			waivers.push({scene: sc.id, rule: w.rule, match: w.match.trim(), reason: w.reason.trim(), used: false, where});
		});
	}
	const sceneWaivers = (id: string, rule: 'factual' | 'income') => waivers.filter((w) => w.scene === id && w.rule === rule);
	const contains = (hay: string, needle: string) => clean(hay).toLowerCase().includes(clean(needle).toLowerCase());

	// --- narration: sentences, claims, tags
	const citedBy = new Map<string, string[]>();
	const claims: ClaimRow[] = [];
	type Item = {where: string; scene?: string; text: string; show: string};
	const items: Item[] = [];
	const srcIdsDefined = new Set((Array.isArray(sb.sources) ? sb.sources : []).map((s) => (isRecord(s) && typeof s.id === 'string' ? s.id : '')));
	for (const sc of sb.scenes) {
		const at = `${sc.id} · narration`;
		let sentences: ReturnType<typeof splitSentences> | undefined;
		try {
			sentences = splitSentences(sc.narration, lang);
		} catch (e) {
			push({level: 'error', rule: 'bad-markup', where: at, scene: sc.id, text: sc.narration, message: `narration markup: ${e instanceof MarkupError ? e.message : String(e)}`, fix: 'Fix the {display|spoken} or [src:id] markup (the voice step and the renderer reject it too).'});
			continue;
		}
		for (const s of sentences ?? []) {
			for (const id of s.ids) {
				const list = citedBy.get(id) ?? [];
				if (!list.includes(sc.id)) list.push(sc.id);
				citedBy.set(id, list);
				if (!srcIdsDefined.has(id))
					push({level: 'error', rule: 'unknown-source', where: at, scene: sc.id, text: s.raw, message: `[src:${id}] cites a source that is not in storyboard.sources`, fix: `Add a source with "id": "${id}" (verified, https, accessed date) or fix the id.`});
			}
			const signals = factualSignals(s.display, s.spoken, lang);
			if (s.ids.length) claims.push({scene: sc.id, sentence: safe(s.raw), ids: s.ids, signals: signals.map(signalLabel)});
			else if (signals.length) {
				const hard = signals.filter((g) => !g.waivable);
				const w = sceneWaivers(sc.id, 'factual').find((x) => contains(s.display, x.match) || contains(s.raw, x.match));
				if (w && !hard.length) w.used = true;
				else
					push({
						level: 'error',
						rule: 'unsourced-claim',
						where: at,
						scene: sc.id,
						text: s.raw,
						message: `looks factual (${signals.slice(0, 4).map(signalLabel).join(', ')}${signals.length > 4 ? ', ...' : ''}) but cites no source`,
						fix: hard.length
							? `Attributions (${hard.map((g) => `"${g.text}"`).join(', ')}) always need a source: add [src:<id>] right after the claim, with a verified https source in storyboard.sources.`
							: 'Add [src:<id>] right after the claim (a verified https source with an accessed date), or rephrase without the figure. If it is not a factual claim (story action, a fictional figure, "first, check..."), add {"match": "<words from it>", "rule": "factual", "reason": "..."} to this scene\'s claimWaivers.',
					});
			}
			items.push({where: at, scene: sc.id, text: s.display, show: s.raw});
			if (s.spoken && s.spoken !== s.display) items.push({where: at, scene: sc.id, text: s.spoken, show: s.raw});
		}
		// quote scenes: a real quote needs a source; a fictional one says so on screen
		if (sc.type === 'quote' && !sourceIds(sc.narration).length) {
			const labelled = [str(sc, 'attribution'), str(sc, 'source')].some((x) => x && FICTION[lang].test(clean(x)));
			const w = sceneWaivers(sc.id, 'factual').find((x) => contains(str(sc, 'quote'), x.match));
			if (w) w.used = true;
			else if (!labelled)
				push({level: 'error', rule: 'quote-unsourced', where: `${sc.id} · quote`, scene: sc.id, text: str(sc, 'quote'), message: 'a quote scene with no [src:id] in its narration', fix: 'Cite the source of the quote with [src:id] in the narration. If the quote is fictional, say so on screen (attribution "... (fictional composite)").'});
		}
		const cites = sourceIds(sc.narration).length > 0;
		const citedHere = (sentences ?? []).filter((x) => x.ids.length).flatMap((x) => [x.display, x.spoken]);
		for (const e of onScreenEntries(sc)) {
			items.push({where: `${sc.id} · ${e.field}`, scene: sc.id, text: e.text, show: e.text});
			if (CUE_FIELD.test(e.field) || e.field === 'onScreen.pair' || e.field.startsWith('onScreen.lowerThird')) continue;
			if (sc.chart?.illustrative && e.field === 'onScreen.label') continue;
			const sig = factualSignals(e.text, e.text, lang).filter((g) => g.kind !== 'org');
			const figures = sig.filter((g) => FIGURE_KINDS.has(g.kind));
			const waived = sceneWaivers(sc.id, 'factual').find((x) => contains(e.text, x.match));
			if (cites) {
				// a citing scene: every figure on screen is said in one of its cited sentences
				const backed = figuresBacked(e.text, citedHere, lang);
				if (!backed.ok && !waived)
					push({level: 'error', rule: 'onscreen-figure-uncited', where: `${sc.id} · ${e.field}`, scene: sc.id, text: e.text, message: `on-screen figure ${backed.missing.map((m) => `"${m}"`).join(', ')} is not in any cited sentence of this scene`, fix: 'Show only figures the cited narration says (with its [src:id]), or cite the source for this one in the narration.'});
				else if (!backed.ok && waived) waived.used = true;
				continue;
			}
			if (waived) waived.used = true;
			else if (sig.length)
				push({
					level: figures.length ? 'error' : 'warning',
					rule: 'onscreen-unsourced',
					where: `${sc.id} · ${e.field}`,
					scene: sc.id,
					text: e.text,
					message: `on-screen text ${figures.length ? 'shows a figure' : 'looks factual'} (${sig.slice(0, 3).map(signalLabel).join(', ')}) and the scene cites no source`,
					fix: figures.length ? 'Cite the source of the figure in this scene\'s narration ([src:id] after the sentence that says it), or drop the figure. A fictional or illustrative figure needs a factual waiver with its reason.' : 'Back it with a [src:id] in this scene\'s narration, or make sure it is not a factual claim.',
				});
		}
	}
	items.push({where: 'title', text: sb.title, show: sb.title});
	(sb.shorts ?? []).forEach((s) => typeof s?.title === 'string' && items.push({where: `shorts[${s.id}].title`, text: s.title, show: s.title}));
	(sb.thumbnails ?? []).forEach((t) => typeof t?.text === 'string' && items.push({where: `thumbnails[${t.id}].text`, text: t.text, show: t.text}));
	// titles and thumbnails make claims too: a figure or a superlative there must be one a cited sentence makes
	const citedIn = (sceneIds: string[] | null): string[] =>
		sb.scenes
			.filter((sc) => !sceneIds || sceneIds.includes(sc.id))
			.flatMap((sc) => {
				try {
					return splitSentences(sc.narration, lang)
						.filter((x) => x.ids.length)
						.flatMap((x) => [x.display, x.spoken]);
				} catch {
					return [];
				}
			});
	const headline = (where: string, text: string, sceneIds: string[] | null) => {
		const sig = factualSignals(text, text, lang).filter((g) => g.kind !== 'org' && g.kind !== 'date');
		if (!sig.length) return;
		const cited = citedIn(sceneIds);
		const figures = sig.filter((g) => FIGURE_KINDS.has(g.kind));
		const backed = figuresBacked(text, cited, lang);
		const statLike = figures.length && !extractQuantities(text, lang).length; // "Nine in ten", "Nueve de cada diez"
		const ok = figures.length ? backed.ok && (!statLike || sameClaim(text, cited)) : sameClaim(text, cited);
		if (!ok)
			push({
				level: 'error',
				rule: 'title-unsourced',
				where,
				text,
				message: `${where.startsWith('thumbnails') ? 'thumbnail text' : 'a title'} makes a claim (${sig.slice(0, 3).map(signalLabel).join(', ')}) that no cited sentence${sceneIds ? ' of this Short' : ''} makes`,
				fix: 'Titles and thumbnails only repeat a claim the narration states with its [src:id] (same figure, same wording); otherwise drop the figure or superlative.',
			});
	};
	headline('title', sb.title, null);
	(sb.shorts ?? []).forEach((s) => typeof s?.title === 'string' && headline(`shorts[${s.id}].title`, s.title, Array.isArray(s.sceneIds) ? s.sceneIds : null));
	(sb.thumbnails ?? []).forEach((t) => typeof t?.text === 'string' && headline(`thumbnails[${t.id}].text`, t.text.replace(/\n/g, ' '), null));
	// the reviewer field is public (the repo is public): never a private name
	const tr = (sb as {translation?: Record<string, unknown>}).translation;
	if (tr && typeof tr.reviewer === 'string') items.push({where: 'translation.reviewer', text: tr.reviewer, show: tr.reviewer});
	for (const f of existsSync(join(dir, 'dub')) ? readdirSync(join(dir, 'dub')).filter((x) => /^sheet\.[a-z-]+\.json$/.test(x)) : []) {
		let sheet: unknown;
		try {
			sheet = readJson(join(dir, 'dub', f));
		} catch {
			continue;
		}
		if (!isRecord(sheet)) continue;
		for (const k of ['translator', 'reviewer']) if (typeof sheet[k] === 'string') items.push({where: `dub/${f} · ${k}`, text: sheet[k] as string, show: sheet[k] as string});
		if (Array.isArray(sheet.items)) sheet.items.forEach((it) => isRecord(it) && typeof it.note === 'string' && items.push({where: `dub/${f} · ${String(it.key)} note`, text: it.note, show: it.note}));
	}
	for (const [k, v] of Object.entries(sb.ui ?? {})) if (typeof v === 'string') items.push({where: `ui.${k}`, text: v, show: v});

	// --- sources
	const src = checkSources(sb.sources, citedBy, today, names);
	findings.push(...src.findings.map((f) => ({...f, text: f.text === undefined ? undefined : oneLine(safe(f.text))})));

	// --- must-not-say, income, names, wallets, links: every piece of text
	for (const it of items) {
		for (const hit of [...scanMustNotSay(it.text, mns), ...scanMustNotSay(it.text, mnsLocal)])
			push({
				level: hit.pattern.level,
				rule: 'must-not-say',
				where: it.where,
				scene: it.scene,
				text: it.show,
				message: `research.md ${hit.rule.id} bans "${hit.pattern.phrase}"${hit.pattern.level === 'warning' ? ' (short phrase: check the context)' : ''}`,
				fix: `Remove or reword it. research.md line ${hit.rule.line}: ${oneLine(hit.rule.text, 180)}`,
			});
		for (const h of incomeHits(it.text, lang)) {
			if (h.negated) {
				push({level: 'warning', rule: 'income-negated', where: it.where, scene: it.scene, text: it.show, message: `negated: ${h.rule.label} ("${h.text}")`, fix: 'Check the negation really covers this phrase in its clause (a negation never shields a different promise, and "not financial advice" is never a shield).'});
				continue;
			}
			const w = it.scene ? sceneWaivers(it.scene, 'income').find((x) => spansOf(x.match, it.text, lang).some(([a, b]) => a <= h.start && h.end <= b)) : undefined;
			if (w) {
				w.used = true;
				continue;
			}
			push({
				level: h.rule.level,
				rule: h.rule.id === 'persona' ? 'persona' : 'income-claim',
				where: it.where,
				scene: it.scene,
				text: it.show,
				message: `${h.rule.label}, found "${h.text}"`,
				fix:
					h.rule.level === 'error'
						? 'Rephrase without it, even when describing a scam ("promised huge returns", attributed). If it is negated or clearly quoted as a scam pitch, add {"match": "<the words>", "rule": "income", "reason": "..."} to the scene\'s claimWaivers.'
						: 'Make sure it does not imply returns or price moves.',
			});
		}
		const n = findNames(it.text, names);
		if (n.length)
			push({level: 'error', rule: 'private-name', where: it.where, scene: it.scene, text: it.show, message: `contains private name #${n.join(', #')} from the private names list`, fix: 'Remove the name: private people are never named (use a fictional composite or a role, e.g. "one caller").'});
		for (const w of findWallets(it.text))
			push({
				level: w.level,
				rule: 'wallet-address',
				where: it.where,
				scene: it.scene,
				text: it.show,
				message: `contains ${KIND_LABEL[w.kind]}`,
				fix: w.level === 'error' ? 'Remove it: no real wallet or contract addresses in scripts or on screen (the repo is public). Say "a fresh wallet" or show "Wallet A".' : 'Check it is not a real person\'s wallet name.',
			});
		if (allMatches(LINKS, it.text).length)
			push({level: 'error', rule: 'referral-link', where: it.where, scene: it.scene, text: it.show, message: 'contains a Telegram/Discord invite or a referral link', fix: 'No invite or referral links in the video; offers go through the hub link with a disclosure.'});
	}

	const offerIds = Array.isArray(sb.offers) ? sb.offers.filter((x): x is string => typeof x === 'string') : [];

	// --- fiction disclaimer
	if (sb.fiction === true) {
		const label = (typeof sb.ui?.fictionDisclaimer === 'string' ? sb.ui.fictionDisclaimer.trim() : '') || (lang === 'en' ? EN_UI.fictionDisclaimer : '');
		// a negated fiction word ("no ficticia") does not count, and only the card or the OPENING scene does: a
		// "made-up coin" chart line in scene 3 does not tell the viewer the story is fictional
		const cardOk = !!label && saysUnnegated(FICTION[lang], label, lang);
		const opening = sb.scenes[0];
		const sceneOk = !!opening && (() => {
			let shown = '';
			try {
				shown = displayText(opening.narration);
			} catch {
				shown = '';
			}
			return saysUnnegated(FICTION[lang], shown, lang) || onScreenEntries(opening).some((e) => !CUE_FIELD.test(e.field) && saysUnnegated(FICTION[lang], e.text, lang));
		})();
		if (!cardOk && !sceneOk)
			push({
				level: 'error',
				rule: 'no-fiction-disclaimer',
				where: 'ui.fictionDisclaimer',
				text: label || undefined,
				message: label ? `fiction is true but the disclaimer card ("${label}") never says the story is fictional` : `fiction is true but there is no ${lang} disclaimer card (ui.fictionDisclaimer) and no scene says the story is fictional`,
				fix: `Set ui.fictionDisclaimer in ${lang}, e.g. "${lang === 'en' ? EN_UI.fictionDisclaimer : 'Fictional story · composite characters · not financial advice (translated)'}". The engine shows it for the first seconds of the episode and of every Short.`,
			});
		else if (!cardOk)
			push({level: 'warning', rule: 'fiction-card', where: 'ui.fictionDisclaimer', message: 'the opening scene says the story is fictional, but the disclaimer card is missing or does not say so', fix: `Set ui.fictionDisclaimer in ${lang} so the card the engine shows says "fictional".`});
	}

	// --- offers: the disclosure must be SAID (FTC 16 CFR 255: spoken and on screen)
	if (offerIds.length) {
		const offersPath = input.offersPath === undefined ? defaultOffersPath() : input.offersPath;
		const registry = loadOffers(offersPath);
		const kinds = new Set<DisclosureKind | 'any'>();
		for (const id of offerIds) {
			const o = registry?.get(id);
			if (registry && !o) push({level: 'warning', rule: 'unknown-offer', where: 'offers', message: `offer "${id}" is not in the offer registry (${offersPath ? relative(STUDIO, offersPath) : 'none'})`, fix: 'Add it to creator-hub/config/offers.json (with its relationship and disclosure) or fix the id.'});
			const rel = o?.relationship;
			kinds.add(rel === 'affiliate' || rel === 'referral' ? 'affiliate' : rel === 'own-product' ? 'own-product' : rel === 'sponsor' ? 'sponsor' : 'any');
		}
		const spoken = sb.scenes.map((sc) => {
			try {
				return {sc, text: spokenText(sc.narration)};
			} catch {
				return {sc, text: ''};
			}
		});
		let ctaSaid = false;
		for (const {sc, text} of spoken) {
			if (sc.type !== 'cta') continue;
			const d = str(sc, 'disclosure');
			if (!d) continue;
			if (loose(text).includes(loose(d)) && Object.values(DISCLOSURE[lang]).some((re) => saysUnnegated(re, d, lang))) ctaSaid = true;
			else if (loose(text).includes(loose(d)))
				push({level: 'error', rule: 'disclosure-negated', where: `${sc.id} · onScreen.disclosure`, scene: sc.id, text: d, message: 'the on-screen "disclosure" does not disclose a relationship (it is negated, or names none the gate knows)', fix: 'Show and say the relationship plainly ("Affiliate link: I may earn a commission").'});
			else
				push({level: 'error', rule: 'disclosure-not-spoken', where: `${sc.id} · onScreen.disclosure`, scene: sc.id, text: d, message: 'the disclosure is on screen but the narration does not SAY it (display-only markup does not count)', fix: 'Have Zoo say the same words in this scene (spoken and on screen, FTC 16 CFR 255).'});
		}
		const lex = DISCLOSURE[lang];
		// a disclosure that says the opposite ("not sponsored", "no commission") is not a disclosure
		for (const {sc, text} of spoken)
			for (const [kind, re] of Object.entries(lex) as Array<[DisclosureKind, RegExp]>)
				if (re.test(clean(text)) && !saysUnnegated(re, text, lang))
					push({level: 'error', rule: 'disclosure-negated', where: `${sc.id} · narration`, scene: sc.id, text, message: `the ${kind} wording is negated ("not sponsored", "no commission"): it denies the relationship instead of disclosing it`, fix: 'Say the relationship plainly, without a negation ("Affiliate link: I may earn a commission").'});
		for (const k of kinds) {
			const res = k === 'any' ? Object.values(lex) : [lex[k]];
			const said = spoken.some(({text}) => res.some((re) => saysUnnegated(re, text, lang)));
			if (said) continue;
			if (ctaSaid) {
				push({level: 'warning', rule: 'disclosure-wording', where: 'offers', message: `the CTA disclosure is spoken, but it does not name the ${k === 'any' ? '' : `${k} `}relationship in words the gate knows`, fix: k === 'own-product' ? 'Say plainly that it is yours: "I built this; it is my own product".' : k === 'sponsor' ? 'Say "sponsored" or "paid partnership".' : 'Say "affiliate link" / "I may earn a commission".'});
				continue;
			}
			push({
				level: 'error',
				rule: 'no-spoken-disclosure',
				where: 'offers',
				message: `storyboard.offers lists ${offerIds.join(', ')} but no narration SAYS the ${k === 'any' ? '' : `${k} `}disclosure`,
				fix: 'In the CTA scene, have Zoo say it in plain words ("Affiliate link: I may earn a commission" / "I built this; it is my own product" / "This video is sponsored") and show the same words as onScreen.disclosure.',
			});
		}
	}

	// --- offers, token promotion, MiCA, ASCI, holdings (regional.ts)
	{
		const offersPath = input.offersPath === undefined ? defaultOffersPath() : input.offersPath;
		const registry = offerIds.length ? (loadOffers(offersPath) as RegionalRegistry) : null;
		for (const f of regionalFindings({sb: sb as Storyboard & RegionalFields, lang, isTranslation, offerIds, registry})) push(f);
	}

	// --- translations: the claim tags must survive 1:1 per scene
	let translationStatus: {status: string; method: string | null; reviewed: boolean; badge: boolean} | null = null;
	if (sb.lang !== sb.sourceLang) {
		const srcPath = sourceStoryboardFile(dir, sb.sourceLang);
		if (!srcPath) push({level: 'warning', rule: 'no-source-storyboard', where: 'storyboard', message: `no ${sb.sourceLang} source storyboard to compare claim tags with`, fix: 'Keep the source storyboard next to its translations.'});
		else {
			const master = loadStoryboard(srcPath);
			const tagsOf = (sc: StoryboardScene) => {
				try {
					return sourceIds(sc.narration).sort();
				} catch {
					return [];
				}
			};
			for (const ms of master.scenes) {
				const t = sb.scenes.find((x) => x.id === ms.id);
				if (!t) {
					push({level: 'error', rule: 'scenes-differ', where: `${ms.id}`, scene: ms.id, message: `scene ${ms.id} of the ${sb.sourceLang} storyboard is missing`, fix: 'Translations keep every scene, in order (node scripts/dub/cli.ts validate).'});
					continue;
				}
				const a = tagsOf(ms).join(', ');
				const b = tagsOf(t).join(', ');
				if (a !== b) push({level: 'error', rule: 'tags-differ', where: `${ms.id} · narration`, scene: ms.id, text: t.narration, message: `cites [${b || 'nothing'}] but the ${sb.sourceLang} scene cites [${a || 'nothing'}]`, fix: 'Keep every [src:id] of the source scene after the same claim (node scripts/dub/cli.ts validate checks this).'});
			}
			// the disclosure names the same relationship as the master's
			if (offerIds.length) {
				const said = (s: Storyboard, l: Lang) =>
					(Object.entries(DISCLOSURE[l]) as Array<[DisclosureKind, RegExp]>)
						.filter(([, re]) =>
							s.scenes.some((sc) => {
								try {
									return saysUnnegated(re, spokenText(sc.narration), l);
								} catch {
									return false;
								}
							}),
						)
						.map(([k]) => k);
				const want = said(master, master.lang);
				const got = new Set(said(sb, lang));
				const lost = want.filter((k) => !got.has(k));
				if (lost.length)
					push({level: 'error', rule: 'disclosure-relationship', where: 'offers', message: `the ${sb.sourceLang} narration discloses ${want.join(', ')}; this translation does not say ${lost.join(', ')} (or negates it)`, fix: 'Translate the disclosure with the same relationship ("affiliate link, I may earn a commission"), spoken and on screen.'});
			}
			// the dub validator's record, number and tag checks, so the one report batch reads covers them
			const dubReport = validateDub({src: master, tgt: sb, lang, names, sourceFile: relative(STUDIO, srcPath) || srcPath, targetFile: relative(STUDIO, file.path) || file.path, engine: null, now: input.now});
			translationStatus = dubReport.translation;
			const DUB_RULES = new Set(['translation-record', 'numbers', 'spoken-numbers', 'claim-tags', 'disclosure-relationship', 'fiction-card']);
			// labels that carry a claim: the synthetic-data label (CHART_SPEC CD3) and the sources heading; a missing one
			// would show English to the dub's viewer (the fiction card has its own rule above)
			const CLAIM_UI = new Set(['ui.illustrative', 'ui.sources']);
			for (const f of dubReport.findings)
				if ((DUB_RULES.has(f.rule) || (f.rule === 'ui-missing' && CLAIM_UI.has(f.where))) && !(f.rule === 'claim-tags' && findings.some((x) => x.rule === 'tags-differ')))
					push({level: f.level, rule: `dub-${f.rule}`, where: `dub · ${f.where}`, text: f.target, message: f.message, fix: f.fix});
		}
		// the back-translation (English) is scanned with the English must-not-say list and income lexicon
		const bt = loadBacktranslation(dir, lang);
		if (!bt) notes.push(`No back-translation record (dub/backtranslation.${lang}.json): the English "Must not say" phrases were not checked against this script's meaning. Run scripts/backtranslate before the native review.`);
		else {
			const res = scanBacktranslation(bt, sb, mns);
			for (const h of res.hits)
				push({level: 'error', rule: h.kind === 'income' ? 'income-claim' : 'must-not-say', where: `backtranslation · ${h.id}`, text: h.bt, message: `the English back-translation says "${h.phrase}" (${h.detail})`, fix: `The ${lang} text means something banned: reword it, then refresh the back-translation (scripts/backtranslate).`});
			notes.push(`Back-translation record: ${res.checked} current item${res.checked === 1 ? '' : 's'} scanned in English${res.stale.length ? `; ${res.stale.length} stale (made from an older translation): ${res.stale.slice(0, 8).join(', ')}${res.stale.length > 8 ? ', ...' : ''}` : ''}.`);
		}
	}

	// --- unused waivers
	for (const w of waivers)
		if (!w.used) push({level: 'warning', rule: 'unused-waiver', where: w.where, scene: w.scene, text: w.match, message: `this ${w.rule} waiver matches nothing the gate flagged`, fix: 'Remove it, or copy "match" exactly from the sentence it is meant to cover.'});

	if (names.skipped) notes.push('Private names were NOT checked: --no-names.');
	else if (!names.path) notes.push('No private names list (data/private/names.txt is absent): private names were not checked, which fails the gate.');
	if (!mns.rules.length && mns.found) notes.push('research.md "Must not say" has no bullets.');

	const errors = findings.filter((f) => f.level === 'error').length;
	return {
		tool: 'claims/check',
		version: 1,
		channel,
		slug,
		lang,
		file: relative(STUDIO, file.path) || file.path,
		checkedAt: input.now ?? new Date().toISOString(),
		pass: errors === 0,
		errors,
		warnings: findings.length - errors,
		findings,
		claims,
		waivers: waivers.map(({scene, rule, match, reason, used}) => ({scene, rule, match: safe(match), reason: safe(reason), used})),
		sources: src.rows,
		mustNotSay: {
			file: researchPath && existsSync(researchPath) ? relative(STUDIO, researchPath) || researchPath : null,
			found: mns.found,
			rules: mns.rules.length,
			patterns: mns.rules.reduce((a, r) => a + r.patterns.length, 0),
			// in a translation every source-language rule needs a human read: its phrases cannot match this language
			manual: mns.rules.filter((r) => isTranslation || r.coverage !== 'full').map((r) => ({id: r.id, line: r.line, coverage: (isTranslation ? 'manual' : r.coverage) as 'partial' | 'manual', text: oneLine(safe(r.text), 240)})),
			...(isTranslation ? {language: sb.sourceLang, localRules: mnsLocal.rules.length, localPatterns: mnsLocal.rules.reduce((a, r) => a + r.patterns.length, 0)} : {}),
		},
		namesList: {path: names.path ? relative(STUDIO, names.path) || names.path : null, count: names.count, ...(names.skipped ? {skipped: true} : {})},
		...(translationStatus ? {translation: translationStatus} : {}),
		notes,
	};
};
