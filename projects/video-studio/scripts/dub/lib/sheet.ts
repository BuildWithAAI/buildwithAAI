/**
 * The translation sheet (pure): every string a viewer sees or hears, with its context, length budget, glossary terms,
 * numbers and claim tags, and an empty `translation` for the translator (an agent in the workflow, or a person).
 * `prepare` writes it, the translator fills it, `import` builds storyboard.<lang>.json from it.
 */
import type {Lang, SceneType, Storyboard, StoryboardScene} from '../../../src/episode/types.ts';
import {sourceIds, spokenText, displayText, parseMarkup} from '../../../src/episode/markup.ts';
import {EN_UI, type UiKey} from '../../../src/episode/i18n/ui.ts';
import {INCOME} from '../../claims/lib/lexicon.ts';
import {LANG_NAMES, oneLine} from '../../claims/lib/text.ts';
import {buildGlossary, respellingsFor, termsIn, urlsIn, type GlossaryTerm, type Respelling} from './glossary.ts';
import {extractQuantities, formatValue} from './numbers.ts';
import {checkFit, FIELD_SPECS, specFor, YOUTUBE_TITLE_MAX, THUMB_MAX_WORDS, THUMB_MAX_UNSPACED, type FieldSpec} from './budgets.ts';

export const SHEET_KIND = 'zoora-translation-sheet';
export const MAX_RATIO = 1.35;
/**
 * Narration (speech) budget, separate from on-screen widths. Measured 2026-11-24 (engine demo, Kokoro im_nicola, es):
 * speechLength() reads Spanish about 10-25% shorter than the real audio, and an audio-track dub (voice --fit-to) can
 * only speed up to 1.15 with 150 ms of air. Every es line estimated at 1.16x or more overflowed its English scene; every
 * line at 1.12x or less fit. A native re-render (its own timing) may run longer.
 */
export const SPEECH_MAX_RATIO = 1.1;

/** 'source-title' (added 2026-11-24): the sources card shows the title, so it is translated too (the URL never is). */
export type ItemKind = 'title' | 'narration' | 'onScreen' | 'cue' | 'waiver' | 'short-title' | 'thumbnail' | 'ui' | 'source-title';

export type SheetItem = {
	key: string;
	kind: ItemKind;
	scene?: string;
	sceneType?: SceneType;
	field?: string;
	index?: number;
	/** shorts/thumbnails entry id, or the ui key. */
	ref?: string;
	context: string;
	source: string;
	budget: {maxRatio: number; hardMaxChars?: number; maxWords?: number; maxUnits?: number; note: string};
	claimTags?: string[];
	markup?: string[];
	numbers?: string[];
	glossary?: string[];
	urls?: string[];
	translation: string;
	note?: string;
};

export type Sheet = {
	kind: typeof SHEET_KIND;
	version: 1;
	channel: string;
	slug: string;
	sourceLang: Lang;
	targetLang: Lang;
	targetLanguage: string;
	sourceFile: string;
	sourceSha256: string;
	preparedAt: string;
	/** "machine" when an agent or MT translates, "human" when a person does. The result is marked for native review either way. */
	method: 'machine' | 'human';
	translator?: string;
	instructions: string[];
	glossary: GlossaryTerm[];
	mustNotSay: string[];
	/** Copied as is, never translated (ticker pairs). */
	fixed: Array<{key: string; value: string; reason: string}>;
	/** Spoken respellings for this language (glossary.respellingsFor): write {term|spoken} in narration. Added 2026-11-24. */
	spokenRespellings?: Respelling[];
	items: SheetItem[];
};

const LANG_STYLE: Record<Lang, string> = {
	en: 'English.',
	es: 'Neutral Latin American Spanish: "tú" and "ustedes" (never "vosotros"), no regional slang. Common crypto terms (wallet, token, memecoin) may stay in English when Spanish speakers use them.',
	'pt-br': 'Brazilian Portuguese: "você", natural spoken style. Common crypto terms (wallet, token, memecoin) may stay in English when Brazilians use them.',
	hi: 'Hindi in Devanagari, conversational (Hindustani) rather than formal Sanskritised Hindi. English crypto words Hindi speakers use (wallet, token, crypto) may stay, in Latin script or Devanagari, consistently.',
	it: 'Italian, natural spoken style ("tu").',
	zh: 'Simplified Chinese (Mainland), natural spoken style, no spaces between Chinese words. In on-screen strings you may mark the only allowed line breaks of a long compound with U+200B (zero-width space).',
	ja: 'Japanese (the Japanese voice is blocked until a real G2P is verified: check scripts/voice before publishing).',
};

const ORDER = ['kicker', 'title', 'subtitle', 'bullets', 'steps', 'quote', 'attribution', 'source', 'label', 'button', 'disclosure', 'lowerThird'];
const CUE_FIELDS = new Set(['cues', 'badgerCue']);
const FIXED_FIELDS: Record<string, string> = {pair: 'ticker pair on the chart: fictional tickers stay as they are'};

const FIELD_CONTEXT: Record<string, string> = {
	'hook.kicker': 'Small label above the hook title (e.g. "POV", "Case file 01").',
	'hook.title': 'The big hook title (display font, upper-cased in Latin scripts). Short and punchy.',
	'hook.subtitle': 'One-line subtitle under the hook title (landscape only).',
	'talk.title': 'Heading above the bullets.',
	'talk.bullets': 'A bullet, revealed when Zoo says its cue word. Short; no full sentences.',
	'steps.title': 'Heading above the numbered steps.',
	'steps.steps': 'A numbered step in the imperative ("Check who bought before the post").',
	'quote.quote': 'The quoted words, shown word by word as Zoo reads them: translate them exactly as you translated the quote in this scene\'s narration.',
	'quote.attribution': 'Who said it (a role, or "fictional composite"). A real quote you translated is no longer their words: add "(translated quote)" in your language, e.g. "(cita traducida)", "(citação traduzida)".',
	'quote.source': 'The source line under the quote.',
	'cta.title': 'Call-to-action title.',
	'cta.button': 'Button label, upper-cased, one line: keep it very short.',
	'cta.disclosure': 'Legal disclosure shown for the whole scene. It must ALSO be said in this scene\'s narration: use the same words in both.',
	'endscreen.title': 'Outro line beside the end-screen slots.',
	'chart.label': 'Chip under the chart.',
	lowerThird: 'Name strap: [name, role]. Names stay as they are; translate the role.',
};
const UI_CONTEXT: Record<UiKey, string> = {
	fictionDisclaimer: 'Fiction card shown at the start of the episode and of every Short. It must say the story is fictional, the characters are composites, and it is not financial advice.',
	sources: 'Heading of the small sources card ("Source").',
	illustrative: 'Chip under synthetic charts: says the chart is illustrative and the token fictional.',
	subscribe: 'Subscribe button label (upper-cased, one line).',
	watchNext: 'Heading over the end-screen video slots ("Watch next").',
	subscribeSlot: 'Label of the end-screen subscribe circle ("Subscribe"). Very short.',
};

const str = (sc: StoryboardScene, k: string): string => (typeof sc.onScreen?.[k] === 'string' ? (sc.onScreen?.[k] as string) : '');

/** UI labels the render of this storyboard needs (mirrors validate.ts in the engine), plus any the source sets. */
export const neededUi = (sb: Storyboard): UiKey[] => {
	const need = new Set<UiKey>();
	if (sb.fiction) need.add('fictionDisclaimer');
	for (const sc of sb.scenes) {
		let ids: string[] = [];
		try {
			ids = sourceIds(sc.narration);
		} catch {
			ids = [];
		}
		if (ids.length && (sc.showSources ?? sc.type !== 'quote')) need.add('sources');
		if (sc.type === 'chart' && sc.chart?.illustrative) need.add('illustrative');
		if (sc.type === 'cta' && !str(sc, 'button').trim()) need.add('subscribe');
		if (sc.type === 'endscreen') {
			need.add('watchNext');
			need.add('subscribeSlot');
		}
	}
	for (const k of Object.keys(sb.ui ?? {}) as UiKey[]) if (k in EN_UI) need.add(k);
	return (Object.keys(EN_UI) as UiKey[]).filter((k) => need.has(k));
};

/** Every text of a storyboard, for glossary building. */
export const allTexts = (sb: Storyboard): string[] => {
	const out: string[] = [sb.title];
	for (const sc of sb.scenes) {
		try {
			out.push(displayText(sc.narration), spokenText(sc.narration));
		} catch {
			out.push(sc.narration);
		}
		for (const v of Object.values(sc.onScreen ?? {})) out.push(...(Array.isArray(v) ? v.map(String) : [String(v)]));
	}
	for (const s of sb.shorts ?? []) out.push(s.title);
	for (const t of sb.thumbnails ?? []) out.push(t.text);
	for (const v of Object.values(sb.ui ?? {})) if (typeof v === 'string') out.push(v);
	return out;
};

const budgetOf = (source: string, spec: FieldSpec | null, lang: Lang, vertical: boolean): SheetItem['budget'] => {
	if (!spec) return {maxRatio: MAX_RATIO, note: `Aim for at most ${MAX_RATIO}x the source length.`};
	const fits = checkFit(source, spec, lang, vertical);
	const hard = Math.min(...fits.map((f) => f.maxChars));
	return {maxRatio: MAX_RATIO, hardMaxChars: Number.isFinite(hard) ? hard : undefined, note: `${spec.label}: aim for at most ${MAX_RATIO}x the source; about ${hard} characters is the most the box takes${fits.some((f) => f.format === 'vertical') ? ' (Short layout included)' : ''}.`};
};

const narrationFacts = (narration: string): Pick<SheetItem, 'claimTags' | 'markup'> => {
	const segs = parseMarkup(narration);
	const markup = segs.flatMap((s) => (s.kind === 'spoken' ? [`{${s.display}|${s.spoken}}`] : []));
	return {claimTags: sourceIds(narration).map((id) => `[src:${id}]`), markup};
};

export type BuildOptions = {targetLang: Lang; sourceFile: string; sourceSha256: string; preparedAt: string; method: 'machine' | 'human'; extraGlossary?: GlossaryTerm[]};

export const buildSheet = (src: Storyboard, o: BuildOptions): Sheet => {
	const lang = o.targetLang;
	const glossary = buildGlossary(allTexts(src), o.extraGlossary ?? []);
	const inShort = new Set((src.shorts ?? []).flatMap((s) => s.sceneIds));
	const items: SheetItem[] = [];
	const fixed: Sheet['fixed'] = [];
	const facts = (text: string, lng: Lang) => {
		const g = termsIn(glossary, text).map((t) => t.term);
		const n = extractQuantities(text, lng).map(formatValue);
		const u = urlsIn(text);
		return {...(g.length ? {glossary: g} : {}), ...(n.length ? {numbers: n} : {}), ...(u.length ? {urls: u} : {})};
	};
	items.push({
		key: 'title',
		kind: 'title',
		context: `Episode title (YouTube title, at most ${YOUTUBE_TITLE_MAX} characters). Keep the hook; no clickbait figures.`,
		source: src.title,
		budget: {maxRatio: MAX_RATIO, hardMaxChars: YOUTUBE_TITLE_MAX, note: `At most ${YOUTUBE_TITLE_MAX} characters.`},
		...facts(src.title, src.lang),
		translation: '',
	});
	for (const sc of src.scenes) {
		const nf = narrationFacts(sc.narration);
		const shown = displayText(sc.narration);
		items.push({
			key: `scenes.${sc.id}.narration`,
			kind: 'narration',
			scene: sc.id,
			sceneType: sc.type,
			field: 'narration',
			context: `Narration of scene ${sc.id} (${sc.type}), spoken by Zoo (Kokoro voice) and shown as captions. Keep every [src:id] tag right after the claim it backs (same tags, same scene). Keep {display|spoken} pairs and translate both sides: display is what viewers read, spoken is what the voice says.`,
			source: sc.narration,
			budget: {maxRatio: SPEECH_MAX_RATIO, note: `Speech length: aim for at most ${SPEECH_MAX_RATIO}x the source. An audio-track dub is fitted to the English timing (speed 0.85-1.15), and Kokoro speaks most languages slower than this estimate shows; only a native re-render with its own timing can run longer.`},
			claimTags: nf.claimTags?.length ? nf.claimTags : undefined,
			markup: nf.markup?.length ? nf.markup : undefined,
			...facts(shown, src.lang),
			translation: '',
		});
		const keys = Object.keys(sc.onScreen ?? {}).sort((a, b) => {
			const ia = ORDER.indexOf(a);
			const ib = ORDER.indexOf(b);
			const ca = CUE_FIELDS.has(a) ? 2 : 0;
			const cb = CUE_FIELDS.has(b) ? 2 : 0;
			return ca - cb || (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
		});
		for (const field of keys) {
			const v = sc.onScreen?.[field];
			const values = Array.isArray(v) ? v.map(String) : typeof v === 'string' ? [v] : [];
			values.forEach((text, i) => {
				const index = Array.isArray(v) ? i : undefined;
				const key = `scenes.${sc.id}.onScreen.${field}${index === undefined ? '' : `.${index}`}`;
				if (FIXED_FIELDS[field]) {
					fixed.push({key, value: text, reason: FIXED_FIELDS[field]});
					return;
				}
				if (CUE_FIELDS.has(field)) {
					const what =
						field === 'badgerCue'
							? 'the word where Badger reacts'
							: sc.type === 'chart'
								? `the word of the ${i === 0 ? 'pump' : 'rug'} beat`
								: `the word that reveals item ${i + 1}${Array.isArray(sc.onScreen?.bullets) || Array.isArray(sc.onScreen?.steps) ? ` ("${(((sc.onScreen?.bullets ?? sc.onScreen?.steps) as string[])[i] ?? '').trim()}")` : ''}`;
					items.push({
						key,
						kind: 'cue',
						scene: sc.id,
						sceneType: sc.type,
						field,
						index,
						context: `Cue: copy, exactly as written in YOUR translated narration of scene ${sc.id}, ${what}. One word (zh/ja: a short run of characters).`,
						source: text,
						budget: {maxRatio: 3, note: 'One word from your narration.'},
						translation: '',
					});
					return;
				}
				const spec = specFor(sc.type, field, index);
				const ctx = FIELD_CONTEXT[`${sc.type}.${field}`] ?? FIELD_CONTEXT[field] ?? `On-screen text "${field}" of a ${sc.type} scene.`;
				items.push({
					key,
					kind: 'onScreen',
					scene: sc.id,
					sceneType: sc.type,
					field,
					index,
					context: `${ctx}${Array.isArray(v) ? ` (item ${i + 1} of ${values.length})` : ''}`,
					source: text,
					budget: budgetOf(text, spec, lang, inShort.has(sc.id)),
					...facts(text, src.lang),
					translation: '',
				});
			});
		}
		(sc.claimWaivers ?? []).forEach((w, i) =>
			items.push({
				key: `scenes.${sc.id}.claimWaivers.${i}.match`,
				kind: 'waiver',
				scene: sc.id,
				sceneType: sc.type,
				field: 'claimWaivers',
				index: i,
				context: `Claim-gate waiver (${w.rule}; reason: ${oneLine(w.reason, 160)}). Copy the matching words EXACTLY from your translated narration or on-screen text of scene ${sc.id}.`,
				source: w.match,
				budget: {maxRatio: 3, note: 'Words copied from your translation of this scene.'},
				translation: '',
			}),
		);
	}
	for (const s of src.shorts ?? [])
		items.push({key: `shorts.${s.id}.title`, kind: 'short-title', ref: s.id, context: `Title of the Short "${s.id}" (at most ${YOUTUBE_TITLE_MAX} characters).`, source: s.title, budget: {maxRatio: MAX_RATIO, hardMaxChars: YOUTUBE_TITLE_MAX, note: `At most ${YOUTUBE_TITLE_MAX} characters.`}, ...facts(s.title, src.lang), translation: ''});
	for (const t of src.thumbnails ?? [])
		items.push({
			key: `thumbnails.${t.id}.text`,
			kind: 'thumbnail',
			ref: t.id,
			context: `Thumbnail headline, variant "${t.id}" (YouTube Test & Compare). ${THUMB_MAX_WORDS} words or fewer (zh/ja: ${THUMB_MAX_UNSPACED} characters); no figures, currency, % or "100x"; a newline is an explicit line break.`,
			source: t.text,
			budget: {maxRatio: MAX_RATIO, maxWords: THUMB_MAX_WORDS, maxUnits: THUMB_MAX_UNSPACED, note: `${THUMB_MAX_WORDS} words or fewer (zh/ja: ${THUMB_MAX_UNSPACED} characters).`},
			translation: '',
		});
	for (const so of src.sources ?? [])
		if (typeof so?.title === 'string' && so.title.trim())
			items.push({
				key: `sources.${so.id}.title`,
				kind: 'source-title',
				ref: so.id,
				context: `Title of source "${so.id}", shown on the sources card ("Source: <title> · ${(() => {
					try {
						return new URL(so.url).hostname.replace(/^www\./, '');
					} catch {
						return 'domain';
					}
				})()}"). Translate the description; keep names and dates; the URL is never changed.`,
				source: so.title,
				budget: {maxRatio: MAX_RATIO, note: `Aim for at most ${MAX_RATIO}x the source length.`},
				...facts(so.title, src.lang),
				translation: '',
			});
	for (const k of neededUi(src)) {
		const source = (typeof src.ui?.[k] === 'string' && src.ui[k]?.trim()) || EN_UI[k];
		const spec = FIELD_SPECS[`ui.${k}`] ?? null;
		items.push({key: `ui.${k}`, kind: 'ui', ref: k, context: UI_CONTEXT[k], source, budget: budgetOf(source, spec, lang, (src.shorts ?? []).length > 0), translation: ''});
	}
	const income = (INCOME[lang] ?? []).filter((r) => r.level === 'error').map((r) => r.label);
	return {
		kind: SHEET_KIND,
		version: 1,
		channel: src.channel,
		slug: src.slug,
		sourceLang: src.lang,
		targetLang: lang,
		targetLanguage: LANG_NAMES[lang],
		sourceFile: o.sourceFile,
		sourceSha256: o.sourceSha256,
		preparedAt: o.preparedAt,
		method: o.method,
		instructions: [
			`Translate every item's "source" into ${LANG_NAMES[lang]} and write it in "translation". Style: ${LANG_STYLE[lang]}`,
			'Audience: adults. Zoo is deadpan, calm and dry; keep the jokes dry and the sentences speakable. Badger never speaks.',
			'Keep every [src:id] tag exactly, after the claim it backs: the same tags in the same scene (the claim gate checks them 1:1).',
			'Keep {display|spoken} pairs: translate both sides. Numbers keep their values; write them the way the voice reads them in this language (es/pt-br/it: 40.000 and 1,5; en/hi/zh: 40,000 and 1.5). When a number could be read two ways, use {display|spoken}.',
			'Never translate the glossary terms (names, platforms, organisations, tickers, URLs): copy them exactly, same case, Latin script.',
			'Stay within each item\'s budget: on-screen text that does not fit fails the render; narration longer than about 1.1x the source will not fit an audio-track dub (the voice step speeds up to 1.15 at most; measured: Spanish lines at 1.16x or more overflowed).',
			'Cue items: copy the exact word from YOUR narration of that scene (it times the reveal). Waiver items: copy the exact words from your translation.',
			'Spoken respellings ("spokenRespellings"): when one of those terms is in your narration, write it as {term|spoken} so the voice says it right; the native reviewer checks each by ear.',
			'A translated quote is no longer the speaker\'s own words: mark its attribution "(translated quote)" in your language. Source titles are translated; their URLs never change.',
			'Audio-track dubs (the voice fitted to the English video) play over the English picture: Zoo\'s mouth and every on-screen text stay English. Keep each sentence about as long as the English sentence (the voice aligns sentence by sentence).',
			'Do not add facts, numbers, names, links, price talk, buy calls, or income or return claims. Do not soften "alleged" or "estimated".',
			'Set "method" to "machine" if you are an AI or a machine-translation system, "human" if you are a person. Either way the result is marked "machine translation: needs native review" until the owner confirms a native speaker reviewed it.',
			'Optional: "note" on any item, for the native reviewer (doubts, alternatives, cultural notes).',
		],
		glossary,
		mustNotSay: income,
		fixed,
		...(respellingsFor(lang).length ? {spokenRespellings: respellingsFor(lang)} : {}),
		items,
	};
};

/** The text at an item's address in a storyboard (undefined when the address does not exist there). */
export const textAt = (sb: Storyboard, it: SheetItem): string | undefined => {
	if (it.kind === 'title') return sb.title;
	if (it.kind === 'short-title') return sb.shorts?.find((s) => s.id === it.ref)?.title;
	if (it.kind === 'thumbnail') return sb.thumbnails?.find((t) => t.id === it.ref)?.text;
	if (it.kind === 'ui') {
		const v = sb.ui?.[it.ref as UiKey];
		return typeof v === 'string' ? v : undefined;
	}
	if (it.kind === 'source-title') return sb.sources?.find((x) => x.id === it.ref)?.title;
	const sc = sb.scenes.find((x) => x.id === it.scene);
	if (!sc) return undefined;
	if (it.kind === 'narration') return sc.narration;
	if (it.kind === 'waiver') return sc.claimWaivers?.[it.index ?? -1]?.match;
	const v = sc.onScreen?.[it.field ?? ''];
	if (it.index === undefined) return typeof v === 'string' ? v : undefined;
	return Array.isArray(v) ? v[it.index] : undefined;
};

/**
 * With no earlier sheet, translations already in storyboard.<lang>.json seed the sheet (same address), each with a note
 * that it must be checked against the current source.
 */
export const seedFromTarget = (sheet: Sheet, target: Storyboard): number => {
	let n = 0;
	for (const it of sheet.items) {
		const t = textAt(target, it);
		if (typeof t === 'string' && t.trim() && !it.translation.trim()) {
			it.translation = t;
			it.note = `seeded from the existing storyboard.${sheet.targetLang}.json: check it still matches the source`;
			n++;
		}
	}
	return n;
};

/** Translations of unchanged strings carry over from an earlier sheet (same key, same source). */
export const carryOver = (next: Sheet, previous: Sheet | null): {carried: number; dropped: number} => {
	if (!previous) return {carried: 0, dropped: 0};
	let carried = 0;
	const old = new Map(previous.items.map((it) => [it.key, it]));
	for (const it of next.items) {
		const p = old.get(it.key);
		if (p && p.source === it.source && typeof p.translation === 'string' && p.translation.trim()) {
			it.translation = p.translation;
			if (p.note) it.note = p.note;
			carried++;
		}
	}
	const dropped = previous.items.filter((p) => typeof p.translation === 'string' && p.translation.trim()).length - carried;
	if (previous.method === 'human' || previous.method === 'machine') next.method = previous.method;
	if (previous.translator) next.translator = previous.translator;
	return {carried, dropped: Math.max(0, dropped)};
};
