/**
 * Fact validation (pure). Errors make a fact unusable (the CLI refuses to save it, to-storyboard refuses to cite it);
 * warnings are listed for the owner. The core rule: every figure in the statement is listed in numbers[], every listed
 * figure is in at least one source excerpt, and every excerpt contains a figure or an entity of the claim.
 * Private names and wallet addresses use the claim gate's own detectors (copied in lib/detectors.ts, checked against
 * scripts/claims/lib by a parity test), so both gates agree. What a sources card would show (cardTitle, else the
 * headline) must pass the studio's shared income-claim lint (scripts/assets/lib/lint.ts), like every other asset.
 */
import {INCOME_CLAIMS} from '../../assets/lib/lint.ts';
import {findNames, findWallets, KIND_LABEL, type NameList} from './detectors.ts';
import {daysBetween, isIsoDate} from './dates.ts';
import {digitRuns, entityAliases, hasEntity, statementHasNumber, textHasNumber, unlistedFigures} from './numbers.ts';
import {recheckDate} from './stale.ts';
import {clip, excerptFragments} from './text.ts';
import {CHECK_RESULTS, CHECKERS, RECHECK_DAYS, TIERS, TRANSLATION_LANGS, VERIFICATIONS, VOLATILITIES, type Fact, type FactSource, type Finding} from './types.ts';

export const FACT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const TAG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const USAGE = /^[a-z0-9][a-z0-9_-]*\/[a-z0-9_][a-z0-9_.-]*$/;
export const EXCERPT_MAX = 280;
export const STATEMENT_MAX = 600;
const FRAGMENT_MIN = 8;

const FACT_KEYS = ['id', 'statement', 'numbers', 'entities', 'tags', 'volatility', 'verification', 'verifiedAt', 'recheckAfter', 'sources', 'languages', 'usage', 'notes'];
const SOURCE_KEYS = ['url', 'title', 'cardTitle', 'publisher', 'published', 'tier', 'accessed', 'excerpt', 'checks'];
const CHECK_KEYS = ['at', 'by', 'result', 'detail'];
const TRANSLATION_KEYS = ['statement', 'translation', 'reviewed'];

export type ValidateContext = {today: string; names: NameList};

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStringArray = (x: unknown): x is string[] => Array.isArray(x) && x.every((s) => typeof s === 'string');
const chars = (s: string): number => [...s].length;

/** Validate one fact. `raw` may be anything (a parsed JSON line). */
export const validateFact = (raw: unknown, ctx: ValidateContext, where = ''): Finding[] => {
	const out: Finding[] = [];
	const at = (w: string) => (where ? `${where} · ${w}` : w);
	if (!isRecord(raw)) return [{level: 'error', rule: 'shape', where: at('fact'), message: 'a fact must be a JSON object'}];
	const id = typeof raw.id === 'string' ? raw.id : undefined;
	const err = (rule: string, w: string, message: string) => out.push({level: 'error', rule, fact: id, where: at(w), message});
	const warn = (rule: string, w: string, message: string) => out.push({level: 'warning', rule, fact: id, where: at(w), message});

	for (const k of Object.keys(raw)) if (!FACT_KEYS.includes(k)) err('shape', k, `unknown field "${k}" (allowed: ${FACT_KEYS.join(', ')})`);
	for (const k of FACT_KEYS) if (!(k in raw)) err('shape', k, `missing field "${k}"`);

	if (!id || !FACT_ID.test(id) || id.length < 3 || id.length > 64) err('id', 'id', `id must be 3-64 characters of a-z, 0-9 and single hyphens (got ${JSON.stringify(raw.id)})`);

	const statement = typeof raw.statement === 'string' ? raw.statement : '';
	if (!statement.trim()) err('statement', 'statement', 'the statement is empty');
	else {
		if (statement !== statement.trim()) err('statement', 'statement', 'the statement has leading or trailing spaces');
		if (/[\r\n]/.test(statement)) err('statement', 'statement', 'the statement must be one line');
		if (/\[(?:src|fact):|\{[^{}]*\|[^{}]*\}/.test(statement)) err('statement', 'statement', 'the statement contains narration markup ([src:], [fact:], {display|spoken}); write plain text');
		if (chars(statement) > STATEMENT_MAX) err('statement', 'statement', `the statement has ${chars(statement)} characters (max ${STATEMENT_MAX}); split it into atomic facts`);
		else if (chars(statement) > 320) warn('statement-long', 'statement', `the statement has ${chars(statement)} characters; atomic facts are easier to reuse`);
	}

	const numbers = isStringArray(raw.numbers) ? raw.numbers : [];
	if (!isStringArray(raw.numbers)) err('shape', 'numbers', 'numbers must be an array of strings');
	const entities = isStringArray(raw.entities) ? raw.entities : [];
	if (!isStringArray(raw.entities)) err('shape', 'entities', 'entities must be an array of strings');
	numbers.forEach((n, i) => {
		if (!n.trim()) err('numbers', `numbers[${i}]`, 'empty entry');
		else if (statement && !statementHasNumber(statement, n)) err('number-not-in-statement', `numbers[${i}]`, `"${n}" is not written in the statement`);
	});
	if (new Set(numbers).size !== numbers.length) err('numbers', 'numbers', 'duplicate entries');
	entities.forEach((e, i) => {
		if (!e.trim() || !entityAliases(e).length) err('entities', `entities[${i}]`, 'empty entry');
		else if (statement && !hasEntity(statement, e)) warn('entity-not-in-statement', `entities[${i}]`, `"${e}" is not named in the statement`);
	});
	if (!numbers.length && !entities.length) err('needs-numbers-or-entities', 'numbers', 'a fact needs at least one figure or entity, so the excerpts can be checked against it');
	if (statement) {
		for (const a of unlistedFigures(statement, numbers, entities))
			err('number-unlisted', 'statement', `the figure "${a.raw}" is in the statement but not in numbers[] (add it there, or list the name it belongs to, e.g. "GPT-5", in entities[])`);
	}

	if (raw.tags !== undefined && !isStringArray(raw.tags)) err('shape', 'tags', 'tags must be an array of strings');
	else if (isStringArray(raw.tags)) {
		if (!raw.tags.length) warn('tags', 'tags', 'no topic tags (search and the weekly planner use them)');
		raw.tags.forEach((t, i) => {
			if (!TAG.test(t)) err('tags', `tags[${i}]`, `tag "${t}" must be lower-case kebab-case`);
		});
	}

	const volatility = raw.volatility;
	if (!VOLATILITIES.includes(volatility as never)) err('volatility', 'volatility', `volatility must be ${VOLATILITIES.join(' or ')}`);

	const verification = raw.verification;
	const verifiedAt = raw.verifiedAt;
	const recheckAfter = raw.recheckAfter;
	if (!VERIFICATIONS.includes(verification as never)) err('verification', 'verification', `verification must be one of ${VERIFICATIONS.join(', ')}`);
	if (verification === 'unverified') {
		if (verifiedAt !== null || recheckAfter !== null) err('verification-dates', 'verifiedAt', 'an unverified fact has verifiedAt: null and recheckAfter: null');
	} else if (VERIFICATIONS.includes(verification as never)) {
		if (!isIsoDate(verifiedAt)) err('verification-dates', 'verifiedAt', 'verifiedAt must be a YYYY-MM-DD date');
		else if (verifiedAt > ctx.today) err('verification-dates', 'verifiedAt', `verifiedAt ${verifiedAt} is after today (${ctx.today})`);
		if (!isIsoDate(recheckAfter)) err('verification-dates', 'recheckAfter', 'recheckAfter must be a YYYY-MM-DD date');
		if (isIsoDate(verifiedAt) && isIsoDate(recheckAfter) && VOLATILITIES.includes(volatility as never)) {
			const max = recheckDate(verifiedAt, volatility as Fact['volatility']);
			if (recheckAfter <= verifiedAt) err('verification-dates', 'recheckAfter', 'recheckAfter must be after verifiedAt');
			else if (recheckAfter > max)
				err('recheck-too-late', 'recheckAfter', `recheckAfter ${recheckAfter} is beyond the ${volatility} limit (${RECHECK_DAYS[volatility as Fact['volatility']]} days after ${verifiedAt} = ${max})`);
		}
	}

	const sources = Array.isArray(raw.sources) ? raw.sources : [];
	if (!Array.isArray(raw.sources)) err('shape', 'sources', 'sources must be an array');
	else if (!sources.length) err('sources-empty', 'sources', 'a fact needs at least one source');
	const urls = new Set<string>();
	const excerpts: string[] = [];
	sources.forEach((s, i) => {
		const w = (k: string) => `sources[${i}]${k ? `.${k}` : ''}`;
		if (!isRecord(s)) {
			err('shape', w(''), 'a source must be an object');
			return;
		}
		for (const k of Object.keys(s)) if (!SOURCE_KEYS.includes(k)) err('shape', w(k), `unknown source field "${k}" (allowed: ${SOURCE_KEYS.join(', ')})`);
		const url = typeof s.url === 'string' ? s.url : '';
		let parsed: URL | null = null;
		try {
			parsed = new URL(url);
		} catch {
			parsed = null;
		}
		if (!parsed || parsed.protocol !== 'https:') err('source-url', w('url'), `the url must be an https URL (got ${JSON.stringify(clip(url, 80))})`);
		else if (url !== url.trim()) err('source-url', w('url'), 'the url has spaces around it');
		if (url) {
			if (urls.has(url)) err('source-duplicate', w('url'), 'this url is listed twice; join both passages in one excerpt with "…"');
			urls.add(url);
		}
		if (typeof s.title !== 'string' || !s.title.trim()) err('source-title', w('title'), 'the source needs its title');
		if (s.publisher !== undefined && (typeof s.publisher !== 'string' || !s.publisher.trim())) err('shape', w('publisher'), 'publisher must be a non-empty string when present');
		if (s.cardTitle !== undefined) {
			if (typeof s.cardTitle !== 'string' || !s.cardTitle.trim() || chars(s.cardTitle) > 90) err('source-card-title', w('cardTitle'), 'cardTitle must be a non-empty string of at most 90 characters');
			else if (typeof s.publisher !== 'string' || !s.cardTitle.toLowerCase().includes(s.publisher.toLowerCase()))
				err('source-card-title', w('cardTitle'), 'cardTitle must name the publisher (set "publisher" and use it in the card title), so it is never mistaken for the headline');
		}
		// the sources card shows cardTitle, else the headline: either way it is on screen, so it passes the income lint
		const shownKey = typeof s.cardTitle === 'string' && s.cardTitle.trim() ? 'cardTitle' : 'title';
		const shown = typeof s[shownKey] === 'string' ? (s[shownKey] as string) : '';
		const claim = INCOME_CLAIMS.find((r) => r.pattern.test(shown));
		if (claim)
			err(
				'source-card-claim',
				w(shownKey),
				shownKey === 'cardTitle'
					? `the cardTitle makes an income or return claim (${claim.label}); the sources card shows it on screen: reword it`
					: `the headline makes an income or return claim (${claim.label}) and the sources card would show it on screen: add a cardTitle that names the publisher (for example "${typeof s.publisher === 'string' && s.publisher.trim() ? s.publisher : 'Publisher'} on <the topic>")`,
			);
		if (s.published !== undefined && !isIsoDate(s.published)) err('source-published', w('published'), 'published must be a YYYY-MM-DD date');
		if (!TIERS.includes(s.tier as never)) err('source-tier', w('tier'), `tier must be one of ${TIERS.join(', ')}`);
		if (!isIsoDate(s.accessed)) err('source-accessed', w('accessed'), 'accessed must be a YYYY-MM-DD date');
		else {
			if (s.accessed > ctx.today) err('source-accessed', w('accessed'), `accessed ${s.accessed} is after today (${ctx.today})`);
			if (isIsoDate(s.published) && s.accessed < s.published) err('source-accessed', w('accessed'), `accessed ${s.accessed} is before the page was published (${s.published})`);
		}
		const excerpt = typeof s.excerpt === 'string' ? s.excerpt : '';
		if (!excerpt.trim()) err('excerpt-empty', w('excerpt'), 'the excerpt is empty: copy the sentence that supports the claim from the page');
		else {
			if (chars(excerpt) > EXCERPT_MAX) err('excerpt-too-long', w('excerpt'), `the excerpt has ${chars(excerpt)} characters (max ${EXCERPT_MAX})`);
			const frags = excerptFragments(excerpt);
			if (frags.some((f) => chars(f) < FRAGMENT_MIN) || frags.join('').length < 20)
				err('excerpt-fragment', w('excerpt'), `each passage of the excerpt needs ${FRAGMENT_MIN}+ characters (20+ in all) so it identifies one place on the page`);
			const hasNum = numbers.some((n) => textHasNumber(excerpt, n, statement));
			const hasEnt = entities.some((e) => hasEntity(excerpt, e));
			if (!hasNum && !hasEnt) err('excerpt-relevance', w('excerpt'), 'the excerpt contains none of the claim\'s numbers or entities');
			excerpts.push(excerpt);
		}
		const checks = s.checks;
		if (!Array.isArray(checks)) err('shape', w('checks'), 'checks must be an array (it may be empty)');
		else {
			if (checks.length > 10) warn('checks', w('checks'), 'more than 10 checks; the tools keep the last 10');
			checks.forEach((c, j) => {
				const cw = w(`checks[${j}]`);
				if (!isRecord(c)) {
					err('shape', cw, 'a check must be an object');
					return;
				}
				for (const k of Object.keys(c)) if (!CHECK_KEYS.includes(k)) err('shape', cw, `unknown check field "${k}"`);
				if (!isIsoDate(c.at)) err('checks', cw, 'at must be a YYYY-MM-DD date');
				else if (c.at > ctx.today) err('checks', cw, `check date ${c.at} is after today`);
				if (!CHECKERS.includes(c.by as never)) err('checks', cw, `by must be one of ${CHECKERS.join(', ')}`);
				if (!CHECK_RESULTS.includes(c.result as never)) err('checks', cw, `result must be one of ${CHECK_RESULTS.join(', ')}`);
				if (c.detail !== undefined && typeof c.detail !== 'string') err('checks', cw, 'detail must be a string');
			});
			const last = checks[checks.length - 1];
			if (isRecord(last) && last.result === 'missing') warn('last-check-missing', w('checks'), `the last direct read (${String(last.at)}) did not find this excerpt on the page; fix the excerpt or remove the source`);
		}
	});
	numbers.forEach((n, i) => {
		if (n.trim() && excerpts.length && !excerpts.some((e) => textHasNumber(e, n, statement)))
			err('number-unsourced', `numbers[${i}]`, `no source excerpt contains "${n}"`);
	});
	entities.forEach((e, i) => {
		if (e.trim() && excerpts.length && !excerpts.some((x) => hasEntity(x, e))) warn('entity-unsourced', `entities[${i}]`, `no source excerpt names "${entityAliases(e)[0]}"`);
	});

	// the verification must be backed by a recorded check on the verifiedAt day
	if (Array.isArray(raw.sources) && isIsoDate(verifiedAt) && (verification === 'direct-read' || verification === 'search-extract')) {
		const direct = verification === 'direct-read';
		const backed = sources.some(
			(s) => isRecord(s) && Array.isArray(s.checks) && s.checks.some((c) => isRecord(c) && c.result === 'found' && c.at === verifiedAt && (direct ? c.by === 'verify' || c.by === 'person' : c.by === 'search')),
		);
		if (!backed)
			err(
				'verification-evidence',
				'verification',
				direct
					? `direct-read needs a source with a "found" check by verify or a person dated ${verifiedAt}`
					: `search-extract needs a source with a "found" check by search dated ${verifiedAt}`,
			);
	}

	if (!isRecord(raw.languages)) err('shape', 'languages', 'languages must be an object ({} when there are no translations)');
	else
		for (const [lang, t] of Object.entries(raw.languages)) {
			const lw = `languages.${lang}`;
			if (!TRANSLATION_LANGS.includes(lang as never)) {
				err('language', lw, `"${lang}" is not a translation language (${TRANSLATION_LANGS.join(', ')}; English is the statement itself; fr is excluded)`);
				continue;
			}
			if (!isRecord(t)) {
				err('shape', lw, 'a translation must be {statement, translation: "machine" | "human", reviewed?}');
				continue;
			}
			for (const k of Object.keys(t)) if (!TRANSLATION_KEYS.includes(k)) err('shape', lw, `unknown translation field "${k}"`);
			if (typeof t.statement !== 'string' || !t.statement.trim()) err('translation', `${lw}.statement`, 'the translated statement is empty');
			if (t.translation !== 'machine' && t.translation !== 'human') err('translation', `${lw}.translation`, 'translation must be "machine" or "human"');
			if (t.reviewed !== undefined && typeof t.reviewed !== 'boolean') err('translation', `${lw}.reviewed`, 'reviewed must be true or false');
			if (typeof t.statement === 'string' && statement) {
				const want = digitRuns(statement).sort().join(' ');
				const got = digitRuns(t.statement).sort().join(' ');
				if (want !== got) warn('translation-numbers', lw, `the digits differ from the English statement (${want || 'none'} vs ${got || 'none'}); check every figure survived the translation`);
			}
		}

	if (!isStringArray(raw.usage)) err('shape', 'usage', 'usage must be an array of "<channel>/<slug>" strings');
	else {
		raw.usage.forEach((u, i) => {
			if (!USAGE.test(u)) err('usage', `usage[${i}]`, `"${u}" is not "<channel>/<slug>"`);
		});
		if (new Set(raw.usage).size !== raw.usage.length) err('usage', 'usage', 'duplicate entries');
	}
	if (typeof raw.notes !== 'string') err('shape', 'notes', 'notes must be a string ("" when there is nothing to note)');

	// privacy: the repo is public
	const texts: Array<[string, string, 'error' | 'warning']> = [
		['statement', statement, 'error'],
		['notes', typeof raw.notes === 'string' ? raw.notes : '', 'error'],
		...entities.map((e, i): [string, string, 'error'] => [`entities[${i}]`, e, 'error']),
		...sources.flatMap((s, i): Array<[string, string, 'error']> =>
			isRecord(s)
				? [
						[`sources[${i}].url`, String(s.url ?? ''), 'error'],
						[`sources[${i}].title`, String(s.title ?? ''), 'error'],
						[`sources[${i}].cardTitle`, String(s.cardTitle ?? ''), 'error'],
						[`sources[${i}].excerpt`, String(s.excerpt ?? ''), 'error'],
						...(Array.isArray(s.checks) ? s.checks.map((c, j): [string, string, 'error'] => [`sources[${i}].checks[${j}].detail`, isRecord(c) ? String(c.detail ?? '') : '', 'error']) : []),
					]
				: [],
		),
		...(isRecord(raw.languages) ? Object.entries(raw.languages).map(([l, t]): [string, string, 'error'] => [`languages.${l}`, isRecord(t) ? String(t.statement ?? '') : '', 'error']) : []),
	];
	for (const [w, text, level] of texts) {
		if (!text) continue;
		const hits = findNames(text, ctx.names);
		if (hits.length) out.push({level, rule: 'private-name', fact: id, where: at(w), message: `contains private name #${hits.join(', #')} (from the private names list); the repo is public`});
		const wallets = findWallets(text).filter((h) => h.level === 'error');
		if (wallets.length) out.push({level: 'error', rule: 'wallet-address', fact: id, where: at(w), message: `contains ${KIND_LABEL[wallets[0].kind]}; never commit real addresses`});
		if (/\[named person\]/i.test(text) && !w.startsWith('notes'))
			out.push({level: 'error', rule: 'redaction-placeholder', fact: id, where: at(w), message: 'contains "[named person]": write the claim without the person instead'});
	}
	return out;
};

/** Validate a whole bank: every fact, plus duplicate ids. */
export const validateBank = (facts: unknown[], ctx: ValidateContext, where: (i: number) => string = (i) => `line ${i + 1}`): Finding[] => {
	const out: Finding[] = [];
	const seen = new Map<string, number>();
	facts.forEach((f, i) => {
		out.push(...validateFact(f, ctx, where(i)));
		const id = isRecord(f) && typeof f.id === 'string' ? f.id : null;
		if (id) {
			if (seen.has(id)) out.push({level: 'error', rule: 'id-duplicate', fact: id, where: where(i), message: `id "${id}" is also used on ${where(seen.get(id) as number)}`});
			else seen.set(id, i);
		}
	});
	return out;
};

export const errorsOf = (fs: Finding[]): Finding[] => fs.filter((f) => f.level === 'error');

/** Enough shape for the commands to read a fact without crashing (full rules: validateFact). */
export const isFactShaped = (x: unknown): x is Fact =>
	isRecord(x) &&
	typeof x.id === 'string' &&
	typeof x.statement === 'string' &&
	isStringArray(x.numbers) &&
	isStringArray(x.entities) &&
	isStringArray(x.tags) &&
	isStringArray(x.usage) &&
	isRecord(x.languages) &&
	Array.isArray(x.sources) &&
	x.sources.every((s) => isRecord(s) && typeof s.url === 'string' && typeof s.title === 'string' && typeof s.excerpt === 'string' && typeof s.accessed === 'string' && Array.isArray(s.checks));

/** The fact's sources that may be cited: never one whose last direct read was "missing". */
export const citableSources = (fact: Fact): FactSource[] => fact.sources.filter((s) => s.checks[s.checks.length - 1]?.result !== 'missing');

/** Days since a date (for display). */
export const ageDays = (iso: string, today: string): number => daysBetween(iso, today);
