/**
 * validate: a translated storyboard against its source (pure; the engine check is injected). Errors block the dub.
 *  - language: supported, not French, not the source language (ja warns: its voice is blocked until a real G2P);
 *  - structure: same scenes, types, characters, charts, sources, offers, shorts and thumbnail designs; only text differs;
 *  - per string: claim tags 1:1 per scene; numbers keep their values (Devanagari digits and CJK numerals normalized,
 *    read the way the voice step reads them); glossary terms kept; URLs unchanged; cue words present in the narration;
 *    length ratio vs the source (warn above 1.1x for narration, 1.35x for on-screen width); on-screen budgets per template field (estimated box fit);
 *  - the per-language must-not-say lexicon (income, return and financial-advice framings), private names, wallets;
 *  - the translation record {status, method, reviewed} and the fiction card wording.
 * Added 2026-11-24 (VCD fix): the SPOKEN side of every {display|spoken} pair is checked too (Kokoro says it, and in an
 * audio-track dub it is the only number the viewer gets in their language): its value must match the source pair's
 * spoken value and its own display value; a disclosure must name the same relationship as the source's and must not
 * be negated; a negated fiction card ("no ficticia") fails; an optional back-translation record is scanned with the
 * English must-not-say list; the research.md "## Must not say (<lang>)" section, when given, is scanned on every
 * translated string; known spoken respellings are listed for the native reviewer.
 */
import type {Lang, Storyboard, StoryboardScene} from '../../../src/episode/types.ts';
import {displayText, displayWords, MarkupError, parseMarkup, sourceIds, spokenText} from '../../../src/episode/markup.ts';
import {findCueMs} from '../../../src/episode/cues.ts';
import {incomeHits, saysUnnegated, spansOf} from '../../claims/lib/income.ts';
import {DISCLOSURE, FICTION, type DisclosureKind} from '../../claims/lib/lexicon.ts';
import {scanBacktranslation, type BtRecord} from '../../claims/lib/backtranslation.ts';
import {scanMustNotSay, type MnsList} from '../../claims/lib/mustnotsay.ts';
import {findNames, redactNames, type NameList} from '../../claims/lib/names.ts';
import {clean, langProblem, LANG_NAMES, oneLine, UNSPACED, wordCount} from '../../claims/lib/text.ts';
import {findWallets, KIND_LABEL, redactWallets} from '../../claims/lib/wallets.ts';
import {checkFit, screenLength, specFor, speechLength, FIELD_SPECS, THUMB_MAX_UNSPACED, THUMB_MAX_WORDS, YOUTUBE_TITLE_MAX} from './budgets.ts';
import {termCount, termsIn, urlsIn, type GlossaryTerm} from './glossary.ts';
import {compareQuantities, extractQuantities, formatValue, type Quantity} from './numbers.ts';
import {relDiff, wordQuantities} from './numwords.ts';
import {respellingsFor} from './glossary.ts';
import {buildSheet, MAX_RATIO, SPEECH_MAX_RATIO, textAt, type SheetItem} from './sheet.ts';

export type DubFinding = {level: 'error' | 'warning'; rule: string; where: string; message: string; fix: string; source?: string; target?: string};
export type ReviewRow = {key: string; context: string; source: string; target: string; flags: string[]};
export type DubReport = {
	tool: 'dub/validate';
	version: 1;
	channel: string;
	slug: string;
	sourceLang: Lang;
	lang: Lang;
	sourceFile: string;
	targetFile: string;
	checkedAt: string;
	pass: boolean;
	errors: number;
	warnings: number;
	translation: {status: string; method: string | null; reviewed: boolean; badge: boolean};
	findings: DubFinding[];
	rows: ReviewRow[];
	notes: string[];
};

/** The episode engine's own storyboard validator, injected so this module stays pure (main.ts loads it). */
export type EngineCheck = (sb: Storyboard, short: boolean, shortId?: string) => Array<{level: 'error' | 'warning'; where: string; msg: string}>;

export type ValidateInput = {
	src: Storyboard;
	tgt: Storyboard;
	lang: Lang;
	names: NameList;
	sourceFile: string;
	targetFile: string;
	extraGlossary?: GlossaryTerm[];
	engine?: EngineCheck | null;
	now?: string;
	/** The back-translation record (scripts/backtranslate) and the research "Must not say" list it is scanned with. */
	backtranslation?: {record: BtRecord; mustNotSay: MnsList} | null;
	/** The research.md "## Must not say (<lang>)" section: banned phrases written in the target language. */
	mustNotSay?: MnsList | null;
};

/** Quantities said by a spoken string: digits (normalized by the voice step) and numbers in words. */
const spokenQuantities = (text: string, lang: Lang): Quantity[] => [...extractQuantities(text, lang), ...wordQuantities(text, lang)];
/** Same number, allowing the rounding a spoken side does ("nearly nineteen million" for 18.67M; 69% for 68.67%). */
const SPOKEN_ROUNDING = 0.06;
const sameSpoken = (a: Quantity, b: Quantity): boolean => a.pct === b.pct && relDiff(a.value, b.value) <= 0.005;
const closeTo = (a: Quantity, b: Quantity): boolean => a.pct === b.pct && relDiff(a.value, b.value) <= SPOKEN_ROUNDING;

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Everything but text, for the structure comparison. */
const skeleton = (sb: Storyboard) => {
	const s = clone(sb) as Storyboard & Record<string, unknown>;
	const out: Record<string, unknown> = {
		version: s.version,
		channel: s.channel,
		slug: s.slug,
		sourceLang: s.sourceLang,
		fiction: s.fiction,
		offers: s.offers ?? [],
		// a source's title is translated (the sources card shows it); id, url, dates, status and quote are not
		sources: (s.sources ?? []).map(({title: _t, ...rest}) => (void _t, rest)),
		shorts: (s.shorts ?? []).map((x) => ({id: x.id, sceneIds: x.sceneIds})),
	};
	out.scenes = s.scenes.map((sc) => {
		const {narration: _n, onScreen, claimWaivers, ...rest} = sc;
		void _n;
		const shape: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(onScreen ?? {})) shape[k] = k === 'pair' ? v : Array.isArray(v) ? `array(${v.length})` : typeof v;
		return {...rest, onScreen: shape, claimWaivers: (claimWaivers ?? []).map((w) => ({rule: w.rule, reason: w.reason}))};
	});
	return out;
};

export const validateDub = (input: ValidateInput): DubReport => {
	const {src, tgt, lang, names} = input;
	const findings: DubFinding[] = [];
	const notes: string[] = [];
	const safe = (s: string) => redactWallets(redactNames(s, names));
	const flagsByKey = new Map<string, string[]>();
	const push = (f: DubFinding, key?: string) => {
		findings.push({...f, source: f.source === undefined ? undefined : oneLine(safe(f.source), 240), target: f.target === undefined ? undefined : oneLine(safe(f.target), 240)});
		if (key) flagsByKey.set(key, [...(flagsByKey.get(key) ?? []), `${f.level === 'error' ? 'ERROR' : 'warn'} ${f.rule}`]);
	};

	// --- language
	const lp = langProblem(lang);
	if (lp) push({level: 'error', rule: 'language', where: 'lang', message: lp, fix: 'Dub into en, es, pt-br, hi, it or zh (ja is blocked until its voice is verified).'});
	if (tgt.lang !== lang) push({level: 'error', rule: 'language', where: 'lang', message: `the file says lang "${tgt.lang}", expected "${lang}"`, fix: `Set "lang": "${lang}" (storyboard.${lang}.json).`});
	if (lang === src.lang) push({level: 'error', rule: 'language', where: 'lang', message: `"${lang}" is the source language`, fix: 'Pick a target language other than the source.'});
	if (lang === 'ja') push({level: 'warning', rule: 'language', where: 'lang', message: 'Japanese voice is blocked until a real G2P is verified (CLAUDE.md); the ja lexicons are partial', fix: 'Check scripts/voice before producing a Japanese dub; a native reviewer must read every line.'});
	const tr = tgt.translation;
	const status = tr?.status ?? 'missing';
	const rows: ReviewRow[] = [];
	const finish = (): DubReport => {
		for (const r of rows) r.flags = flagsByKey.get(r.key) ?? [];
		const errors = findings.filter((f) => f.level === 'error').length;
		return {
			tool: 'dub/validate',
			version: 1,
			channel: tgt.channel ?? src.channel,
			slug: tgt.slug ?? src.slug,
			sourceLang: src.lang,
			lang,
			sourceFile: input.sourceFile,
			targetFile: input.targetFile,
			checkedAt: input.now ?? new Date().toISOString(),
			pass: errors === 0,
			errors,
			warnings: findings.length - errors,
			translation: {status, method: tr?.method ?? null, reviewed: tr?.reviewed === true, badge: status !== 'native-reviewed'},
			findings,
			rows,
			notes,
		};
	};
	if (lp) return finish(); // nothing else can be checked in an unsupported language
	if (src.lang !== src.sourceLang) push({level: 'warning', rule: 'source', where: 'source', message: `the source storyboard is itself a translation (${src.lang} from ${src.sourceLang})`, fix: 'Dub from the master storyboard (storyboard.json).'});

	// --- translation record
	if (!tr) push({level: 'error', rule: 'translation-record', where: 'translation', message: 'no "translation" record', fix: 'import writes {"status": "machine", "method": "machine" | "human", "reviewed": false}; re-run it.'});
	else {
		if (tr.status !== 'machine' && tr.status !== 'native-reviewed') push({level: 'error', rule: 'translation-record', where: 'translation.status', message: `status must be "machine" or "native-reviewed" (got ${JSON.stringify(tr.status)})`, fix: 'Use "machine" until the owner confirms a native review.'});
		if (tr.method !== undefined && tr.method !== 'machine' && tr.method !== 'human') push({level: 'error', rule: 'translation-record', where: 'translation.method', message: `method must be "machine" or "human" (got ${JSON.stringify(tr.method)})`, fix: 'Record who translated: "machine" (an agent or MT) or "human".'});
		if (tr.method === undefined) push({level: 'warning', rule: 'translation-record', where: 'translation.method', message: 'method is not recorded', fix: 'Record who translated: "machine" or "human".'});
		// `reviewed` is optional (older files only carry `status`); an explicit value must agree with the status
		if (tr.reviewed !== undefined && tr.reviewed !== (tr.status === 'native-reviewed'))
			push({level: 'error', rule: 'translation-record', where: 'translation', message: `reviewed is ${String(tr.reviewed)} but status is "${tr.status}"`, fix: 'Only the owner marks a translation reviewed: set both "reviewed": true and "status": "native-reviewed" (with reviewer initials or a role and the date), or neither.'});
		if (tr.status === 'native-reviewed' && (!tr.reviewer || !tr.date)) push({level: 'error', rule: 'translation-record', where: 'translation', message: 'a native-reviewed translation needs "reviewer" (initials or a role, never a private full name) and "date"', fix: 'Add them, or set the status back to "machine".'});
	}
	if (status !== 'native-reviewed') notes.push(`Machine translation: renders carry the "MACHINE TRANSLATION · needs native review" badge until a native ${LANG_NAMES[lang] ?? lang} speaker has reviewed every line and the owner sets status "native-reviewed".`);

	// --- structure: only text may differ
	const a = skeleton(src);
	const b = skeleton(tgt);
	for (const k of Object.keys(a)) {
		if (k === 'scenes') continue;
		if (!same(a[k], b[k])) push({level: 'error', rule: 'structure', where: k, message: `${k} differs from the source`, fix: `A translation changes text only; copy "${k}" from the source (import does this).`});
	}
	const sa = a.scenes as Array<Record<string, unknown>>;
	const sb2 = b.scenes as Array<Record<string, unknown>>;
	if (sa.length !== sb2.length || sa.some((x, i) => x.id !== sb2[i]?.id))
		push({level: 'error', rule: 'structure', where: 'scenes', message: `scenes differ: source ${sa.map((x) => x.id).join(', ')} / translation ${sb2.map((x) => x.id).join(', ')}`, fix: 'Keep every scene, with the same ids, in the same order.'});
	else sa.forEach((x, i) => !same(x, sb2[i]) && push({level: 'error', rule: 'structure', where: String(x.id), message: 'non-text fields of this scene differ from the source (type, characters, chart, timing, onScreen keys or list lengths, ticker pair, waiver rules)', fix: 'Change only text; copy everything else from the source.'}));
	const thumbsA = (src.thumbnails ?? []).map((t) => t.id);
	const thumbsB = (tgt.thumbnails ?? []).map((t) => t.id);
	if (!same(thumbsA, thumbsB)) push({level: 'error', rule: 'structure', where: 'thumbnails', message: `thumbnail ids differ (${thumbsA.join(', ')} vs ${thumbsB.join(', ')})`, fix: 'Keep the 3 variants with the same ids (only their text is translated).'});
	for (const t of tgt.thumbnails ?? []) {
		const m = src.thumbnails?.find((x) => x.id === t.id);
		if (m && ((t.expression !== undefined && t.expression !== m.expression) || (t.badger !== undefined && t.badger !== m.badger))) push({level: 'error', rule: 'structure', where: `thumbnails[${t.id}]`, message: 'the thumbnail design differs from the source', fix: 'Only the text is translated; the design always comes from storyboard.json.'});
	}

	// --- strings
	const sheet = buildSheet(src, {targetLang: lang, sourceFile: input.sourceFile, sourceSha256: '', preparedAt: '', method: 'machine', extraGlossary: input.extraGlossary});
	const glossary = sheet.glossary;
	const inShort = new Set((src.shorts ?? []).flatMap((s) => s.sceneIds));
	const tScene = (id?: string) => tgt.scenes.find((s) => s.id === id);
	const shown = (n: string) => {
		try {
			return displayText(n);
		} catch {
			return n;
		}
	};
	const sceneTexts = (sc: StoryboardScene | undefined): string[] => (sc ? [shown(sc.narration), ...Object.values(sc.onScreen ?? {}).flatMap((v) => (Array.isArray(v) ? v.map(String) : [String(v)]))] : []);

	const checkCommon = (it: SheetItem, s: string, t: string, sLang: Lang) => {
		const where = it.key;
		// numbers
		const d = compareQuantities(extractQuantities(s, sLang), extractQuantities(t, lang));
		for (const q of d.missing)
			push({level: 'error', rule: 'numbers', where, source: s, target: t, message: `number ${formatValue(q)} ("${q.raw}") is missing or reads differently`, fix: `Keep the value. In ${lang} the voice reads written numbers as: ${lang === 'es' || lang === 'pt-br' || lang === 'it' ? '"40.000" = forty thousand, "1,5" = one and a half, "1,234" = 1.234' : '"40,000" = forty thousand, "1.5" = one and a half'}; use {display|spoken} when in doubt.`}, it.key);
		for (const q of d.extra) push({level: 'warning', rule: 'numbers', where, source: s, target: t, message: `number ${formatValue(q)} ("${q.raw}") is not in the source`, fix: 'Do not add figures; if it is a date or a spelled-out source number, ignore this.'}, it.key);
		for (const [q, r] of d.unitMismatch) push({level: 'warning', rule: 'numbers', where, source: s, target: t, message: `${formatValue(q)} became ${formatValue(r)} (percent sign or word changed)`, fix: 'Keep percentages as percentages.'}, it.key);
		// glossary
		for (const g of termsIn(glossary, s)) {
			const n = termCount(g, t);
			if (n === 0) push({level: 'error', rule: 'glossary', where, source: s, target: t, message: `"${g.term}" is missing (${g.note})`, fix: `Keep "${g.term}" exactly as written; do not translate or transliterate it.`}, it.key);
			else if (n < termCount(g, s)) push({level: 'warning', rule: 'glossary', where, source: s, target: t, message: `"${g.term}" appears fewer times than in the source`, fix: 'Check nothing was dropped.'}, it.key);
		}
		// URLs
		const su = urlsIn(s);
		const tu = urlsIn(t);
		for (const u of su) if (!t.includes(u)) push({level: 'error', rule: 'url', where, source: s, target: t, message: `URL "${u}" is missing or changed`, fix: 'Copy URLs exactly.'}, it.key);
		for (const u of tu) if (!su.includes(u) && !s.includes(u)) push({level: 'error', rule: 'url', where, source: s, target: t, message: `URL "${u}" is not in the source`, fix: 'Do not add links.'}, it.key);
	};

	for (const it of sheet.items) {
		const t = textAt(tgt, it);
		rows.push({key: it.key, context: it.context, source: safe(it.source), target: safe(t ?? ''), flags: []});
		if (t === undefined || !t.trim()) {
			const ui = it.kind === 'ui';
			push({level: 'error', rule: ui ? 'ui-missing' : 'missing', where: it.key, source: it.source, message: ui ? `UI label "${it.ref}" is missing: the ${lang} render would show English` : 'no translation', fix: ui ? `Add ui.${it.ref} in ${lang}.` : 'Translate it (re-run import with a complete sheet).'}, it.key);
			continue;
		}
		const sc = tScene(it.scene);
		switch (it.kind) {
			case 'narration': {
				let ok = true;
				try {
					parseMarkup(t);
				} catch (e) {
					ok = false;
					push({level: 'error', rule: 'markup', where: it.key, target: t, message: `narration markup: ${e instanceof MarkupError ? e.message : String(e)}`, fix: 'Fix the {display|spoken} or [src:id] markup.'}, it.key);
				}
				if (!ok) break;
				const ta = sourceIds(it.source).sort();
				const tb = sourceIds(t).sort();
				if (!same(ta, tb))
					push({level: 'error', rule: 'claim-tags', where: it.key, source: it.source, target: t, message: `claim tags differ: source [${ta.join(', ') || 'none'}], translation [${tb.join(', ') || 'none'}]`, fix: 'Keep every [src:id] of the source scene, once each, after the claim it backs.'}, it.key);
				checkCommon(it, displayText(it.source), displayText(t), src.lang);
				// the spoken side of {display|spoken}: Kokoro says it, the screen keeps the display
				{
					const pairs = (n: string) => parseMarkup(n).flatMap((x) => (x.kind === 'spoken' ? [x] : []));
					const sp = pairs(it.source).filter((x) => spokenQuantities(x.spoken, src.lang).length);
					const tp = pairs(t).filter((x) => spokenQuantities(x.spoken, lang).length || extractQuantities(x.display, lang).length);
					const srcSaid = sp.flatMap((x) => spokenQuantities(x.spoken, src.lang));
					const tgtSaid = tp.flatMap((x) => spokenQuantities(x.spoken, lang));
					const used = new Set<number>();
					for (const q of srcSaid) {
						const k = tgtSaid.findIndex((x, i) => !used.has(i) && sameSpoken(x, q));
						const near = k >= 0 ? k : tgtSaid.findIndex((x, i) => !used.has(i) && closeTo(x, q));
						if (near >= 0) used.add(near);
						else
							push({level: 'error', rule: 'spoken-numbers', where: it.key, source: it.source, target: t, message: `the source voice says ${formatValue(q)} ("${q.raw}"); the translation's {display|spoken} pairs never say it`, fix: 'Translate the spoken side with the same number (rounding only as the source does: "nearly nineteen million" -> "casi diecinueve millones").'}, it.key);
					}
					for (const x of tp) {
						const shownQ = extractQuantities(x.display, lang);
						const saidQ = spokenQuantities(x.spoken, lang);
						if (!shownQ.length || !saidQ.length) continue;
						for (const d of shownQ)
							if (!saidQ.some((q) => closeTo(q, d)))
								push({level: 'error', rule: 'spoken-numbers', where: it.key, target: t, message: `{${x.display}|${x.spoken}}: the screen shows ${formatValue(d)} but the voice says ${saidQ.map(formatValue).join(', ')}`, fix: 'Make the spoken side say the displayed number (rounded at most a little: "casi diecinueve millones" for 18,67 millones).'}, it.key);
					}
				}
				const numMarkup = (n: string) => parseMarkup(n).filter((x) => x.kind === 'spoken' && /\d/.test(x.display)).length;
				if (numMarkup(it.source) > numMarkup(t))
					push({level: 'warning', rule: 'number-markup', where: it.key, source: it.source, target: t, message: 'the source spells a number out for the voice ({display|spoken}) and the translation does not', fix: 'Keep a {display|spoken} pair for that number, or check the voice reads the digits right in this language.'}, it.key);
				const ls = speechLength(spokenText(it.source));
				const lt = speechLength(spokenText(t));
				if (ls > 0 && lt / ls > SPEECH_MAX_RATIO)
					push({level: 'warning', rule: 'length', where: it.key, source: it.source, target: t, message: `${(lt / ls).toFixed(2)}x the source length (speech, estimated): as an audio track on the same video (voice --fit-to) it will likely overflow the scene`, fix: `Tighten it to ${SPEECH_MAX_RATIO}x or less for an audio-track dub (the voice step speeds up to 1.15 at most, and this estimate reads Kokoro's speech short). A native re-render with its own timing can keep it.`}, it.key);
				if (ls > 20 && lt / ls < 0.5) push({level: 'warning', rule: 'length', where: it.key, source: it.source, target: t, message: `only ${(lt / ls).toFixed(2)}x the source length: check nothing was dropped`, fix: 'Translate the whole narration.'}, it.key);
				if (t.trim() === it.source.trim()) push({level: 'warning', rule: 'untranslated', where: it.key, target: t, message: 'identical to the source', fix: `Translate it into ${LANG_NAMES[lang]}.`}, it.key);
				break;
			}
			case 'cue': {
				const narr = sc ? sc.narration : '';
				let words: string[] = [];
				try {
					words = displayWords(narr, lang);
				} catch {
					words = [];
				}
				const ms = findCueMs(words.map((w, i) => ({text: w, startMs: i, endMs: i})), t, 0, lang);
				if (ms === null) push({level: 'error', rule: 'cue', where: it.key, target: t, message: `cue "${t}" is not a word of the translated narration of ${it.scene}`, fix: 'Copy the exact word from the narration (it times the reveal).'}, it.key);
				break;
			}
			case 'waiver': {
				const hay = sceneTexts(sc).map((x) => clean(x).toLowerCase());
				if (!hay.some((h) => h.includes(clean(t).toLowerCase()))) push({level: 'error', rule: 'waiver', where: it.key, target: t, message: 'the waiver match does not occur in the translated narration or on-screen text of this scene', fix: 'Copy the matching words exactly from your translation of this scene.'}, it.key);
				break;
			}
			case 'thumbnail': {
				checkCommon(it, it.source, t, src.lang);
				const units = UNSPACED.has(lang) ? (clean(t).match(/[A-Za-z0-9]+|[\p{L}\p{N}]/gu) ?? []).length : wordCount(t);
				const max = UNSPACED.has(lang) ? THUMB_MAX_UNSPACED : THUMB_MAX_WORDS;
				if (units > max) push({level: 'error', rule: 'budget', where: it.key, target: t, message: `${units} ${UNSPACED.has(lang) ? 'characters' : 'words'}; thumbnails take ${max} or fewer`, fix: 'Shorten the headline.'}, it.key);
				if (/\d|[%％$€£¥₹]/.test(t) && !/\d|[%％$€£¥₹]/.test(it.source)) push({level: 'error', rule: 'budget', where: it.key, target: t, message: 'figures, currency or % in a thumbnail', fix: 'Thumbnails carry no figures.'}, it.key);
				break;
			}
			default: {
				checkCommon(it, it.source, t, src.lang);
				if ((it.kind === 'title' || it.kind === 'short-title') && [...t].length > YOUTUBE_TITLE_MAX)
					push({level: 'error', rule: 'budget', where: it.key, target: t, message: `${[...t].length} characters; YouTube titles take ${YOUTUBE_TITLE_MAX}`, fix: 'Shorten it.'}, it.key);
				const spec = it.kind === 'ui' ? (FIELD_SPECS[`ui.${it.ref}`] ?? null) : it.kind === 'onScreen' && it.sceneType ? specFor(it.sceneType, it.field ?? '', it.index) : null;
				if (spec) {
					for (const f of checkFit(t, spec, lang, it.kind === 'ui' ? (src.shorts ?? []).length > 0 : inShort.has(it.scene ?? '')))
						if (!f.fits)
							push({level: 'error', rule: 'budget', where: it.key, target: t, message: `too long for the ${spec.label} (${f.format}): about ${f.maxChars} characters fit at the smallest size`, fix: 'Shorten it; the render fails when text does not fit its box.'}, it.key);
				}
				const ratio = screenLength(t) / Math.max(1, screenLength(it.source));
				if (it.kind !== 'ui' && it.kind !== 'title' && screenLength(it.source) > 6 && ratio > MAX_RATIO)
					push({level: 'warning', rule: 'length', where: it.key, source: it.source, target: t, message: `${ratio.toFixed(2)}x the source width`, fix: `Aim for ${MAX_RATIO}x or less: long on-screen text shrinks.`}, it.key);
				const letters = clean(it.source).replace(new RegExp(glossary.map((g) => g.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') || '(?!)', 'g'), '');
				if (t.trim() === it.source.trim() && /\p{Ll}{3,}/u.test(letters)) push({level: 'warning', rule: 'untranslated', where: it.key, target: t, message: 'identical to the source', fix: `Translate it into ${LANG_NAMES[lang]} (names and tickers stay).`}, it.key);
				if (it.kind === 'ui' && it.ref === 'fictionDisclaimer' && !saysUnnegated(FICTION[lang], t, lang))
					push({level: 'error', rule: 'fiction-card', where: it.key, target: t, message: 'the fiction card does not say the story is fictional (or negates it: "no ficticia")', fix: `Use the ${LANG_NAMES[lang]} word for "fictional" (and "composite characters", "not financial advice").`}, it.key);
			}
		}
	}

	// --- safety: per-language income lexicon, names, wallets (every target string)
	const texts: Array<{where: string; scene?: string; text: string}> = [{where: 'title', text: tgt.title}];
	for (const sc of tgt.scenes) {
		texts.push({where: `scenes.${sc.id}.narration`, scene: sc.id, text: shown(sc.narration)});
		try {
			const sp = spokenText(sc.narration);
			if (sp !== shown(sc.narration)) texts.push({where: `scenes.${sc.id}.narration`, scene: sc.id, text: sp});
		} catch {
			// markup errors are reported above
		}
		for (const [k, v] of Object.entries(sc.onScreen ?? {})) (Array.isArray(v) ? v : [v]).forEach((x, i) => texts.push({where: `scenes.${sc.id}.onScreen.${k}${Array.isArray(v) ? `.${i}` : ''}`, scene: sc.id, text: String(x)}));
	}
	for (const s of tgt.shorts ?? []) texts.push({where: `shorts.${s.id}.title`, text: s.title});
	for (const t of tgt.thumbnails ?? []) texts.push({where: `thumbnails.${t.id}.text`, text: t.text});
	for (const [k, v] of Object.entries(tgt.ui ?? {})) if (typeof v === 'string') texts.push({where: `ui.${k}`, text: v});
	const localMns = input.mustNotSay?.found ? input.mustNotSay : null;
	if (!localMns) notes.push(`research.md has no "## Must not say (${lang})" section: banned phrases written in ${LANG_NAMES[lang] ?? lang} were not checked (the claim gate warns about this too).`);
	for (const x of texts) {
		const mnsSeen = new Set<string>();
		for (const h of localMns ? scanMustNotSay(x.text, localMns) : []) {
			const key = `${x.where}|${h.rule.id}|${h.pattern.phrase}`;
			if (mnsSeen.has(key) || findings.some((f) => f.rule === 'must-not-say' && f.where === x.where && f.message.includes(`"${h.pattern.phrase}"`))) continue;
			mnsSeen.add(key);
			push({level: h.pattern.level, rule: 'must-not-say', where: x.where, target: x.text, message: `research.md "Must not say (${lang})" ${h.rule.id} bans "${h.pattern.phrase}"${h.pattern.level === 'warning' ? ' (short phrase: check the context)' : ''}`, fix: `Reword it. research.md line ${h.rule.line}: ${oneLine(h.rule.text, 160)}`}, x.where);
		}
		for (const h of incomeHits(x.text, lang)) {
			if (h.negated) continue;
			const w = (tScene(x.scene)?.claimWaivers ?? []).find((cw) => cw.rule === 'income' && spansOf(cw.match, x.text, lang).some(([p, q]) => p <= h.start && h.end <= q));
			if (w) continue;
			push({level: h.rule.level, rule: 'must-not-say', where: x.where, target: x.text, message: `${lang} lexicon: ${h.rule.label}, found "${h.text}"`, fix: 'Rephrase without income, return or financial-advice framing (the source passed the claim gate; the translation must not add one).'}, x.where);
		}
		const n = findNames(x.text, names);
		if (n.length) push({level: 'error', rule: 'private-name', where: x.where, target: x.text, message: `contains private name #${n.join(', #')}`, fix: 'Remove it.'}, x.where);
		for (const w of findWallets(x.text)) if (w.level === 'error') push({level: 'error', rule: 'wallet-address', where: x.where, target: x.text, message: `contains ${KIND_LABEL[w.kind]}`, fix: 'Remove it.'}, x.where);
	}

	// --- disclosures: the translation says the same relationship as the source, and never negates it
	if ((src.offers ?? []).length) {
		const said = (sb: Storyboard, l: Lang): DisclosureKind[] =>
			(Object.entries(DISCLOSURE[l]) as Array<[DisclosureKind, RegExp]>)
				.filter(([, re]) =>
					sb.scenes.some((sc) => {
						try {
							return saysUnnegated(re, spokenText(sc.narration), l);
						} catch {
							return false;
						}
					}),
				)
				.map(([k]) => k);
		const want = said(src, src.lang);
		const got = new Set(said(tgt, lang));
		const lost = want.filter((k) => !got.has(k));
		if (lost.length)
			push({level: 'error', rule: 'disclosure-relationship', where: 'offers', message: `the source narration discloses ${want.join(', ')}; the translation does not say ${lost.join(', ')} (or negates it: "no está patrocinado", "no recibo ninguna comisión")`, fix: 'Translate the disclosure with the same relationship, spoken and on screen ("Enlace de afiliado: puedo ganar una comisión").'});
	}

	// --- the back-translation (English) against the English must-not-say list and income lexicon
	if (input.backtranslation) {
		const res = scanBacktranslation(input.backtranslation.record, tgt, input.backtranslation.mustNotSay);
		for (const h of res.hits)
			push({level: 'error', rule: 'must-not-say', where: `backtranslation.${h.id}`, target: h.bt, message: `the back-translation says "${h.phrase}" (${h.detail})`, fix: 'The translation means something the research bans: reword it, then refresh the back-translation.'});
		notes.push(`Back-translation: ${res.checked} current item${res.checked === 1 ? '' : 's'} scanned with the English "Must not say" list${res.stale.length ? `; ${res.stale.length} stale (re-run scripts/backtranslate)` : ''}.`);
	} else notes.push('No back-translation record (dub/backtranslation.<lang>.json): the English "Must not say" phrases were not checked against the meaning of this translation.');

	// --- spoken respellings the voice uses for this language: listed for the native reviewer
	const resp = respellingsFor(lang);
	const usedResp = resp.filter((r) => tgt.scenes.some((sc) => sc.narration.includes(r.term)));
	if (usedResp.length) notes.push(`Spoken respellings in this script (the native reviewer checks them by ear): ${usedResp.map((r) => `${r.term} -> "${r.spoken}"`).join('; ')}.`);

	// --- the engine's own validator (UI labels, template rules), when available
	if (input.engine) {
		const runs: Array<[boolean, string | undefined]> = [[false, undefined], ...(tgt.shorts ?? []).map((s) => [true, s.id] as [boolean, string])];
		const seen = new Set<string>();
		for (const [short, id] of runs) {
			for (const issue of input.engine(tgt, short, id)) {
				if (issue.level === 'warning' && short) continue;
				const key = `${issue.level}|${issue.where}|${issue.msg}`;
				if (seen.has(key)) continue; // the same storyboard problem, seen again from a Short
				seen.add(key);
				push({level: issue.level, rule: 'engine', where: `${short ? `short ${id}: ` : ''}${issue.where}`, message: issue.msg, fix: 'The episode engine would reject (or warn about) this at render time.'});
			}
		}
	} else notes.push('The episode engine validator was not available; render-time template checks did not run.');

	return finish();
};
