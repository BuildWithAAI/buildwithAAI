/**
 * Names the radar missed, caught where the daily copies a source onward: a source title or a link's path that spells a
 * person. The writer's storyboard.sources, the video description (kitSources) and the post-approval input (the
 * announcer and the Threat Brief) then show the outlet and its address instead, never the name.
 *
 * The news gate's R4 refuses the same titles and links in storyboard.sources (rules.ts SOURCE_TITLE_REASONS and
 * slugName); these checks use its word lists (scripts/news/lib/names.ts) so the two agree.
 */
import {AFTER_ROLE_OK, FIRST_NAMES, ORG_SUFFIXES, PERSON_CUES} from '../../news/lib/names.ts';
import {COMMON} from '../../news/lib/text.ts';

/** Lower case without diacritics. */
const fold = (s: string): string => s.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase();

/** Words that never name anyone after a role or a given name: verbs, nouns, organisation words, numbers. */
const plain = (w: string): boolean => !w || /^\d/.test(w) || COMMON.has(w) || AFTER_ROLE_OK.has(w) || ORG_SUFFIXES.has(w) || PERSON_CUES.has(w);

/** Verbs that follow a name and an age in a slug ("claude-72-loses-..."). */
const AFTER_AGE = new Set('loses lost says said charged arrested sentenced jailed dies died recounts tells told admits pleads scammed duped tricked'.split(' '));

/**
 * Does a link's path spell a person's name? A role word or a given name followed by a word that is not a verb, noun or
 * organisation word ("/victim-kiro-loses-...", "/crypto-investor-kiro-...", "/researcher-lena-weiss-...",
 * "/ceo-john-smith-..."), a name right before an age and a verb ("/claude-72-loses-..."), or a word the caller knows is
 * a person's (`names`, folded).
 */
export const slugNamesPerson = (url: string, names: ReadonlySet<string> = new Set()): boolean => {
	let path = '';
	try {
		const u = new URL(url);
		path = `${u.pathname} ${u.search}`;
		try {
			path = decodeURIComponent(path);
		} catch {
			// keep the raw path
		}
	} catch {
		return false;
	}
	const words = fold(path).split(/[^a-z0-9]+/).filter(Boolean);
	for (let i = 0; i < words.length; i++) {
		const [a, b, c] = [words[i] ?? '', words[i + 1] ?? '', words[i + 2] ?? ''];
		if (a.length >= 3 && names.has(a)) return true;
		if ((PERSON_CUES.has(a) || FIRST_NAMES.has(a)) && b.length >= 2 && !plain(b)) return true;
		if (/^[a-z]{3,}$/.test(a) && !plain(a) && /^\d{1,2}$/.test(b) && AFTER_AGE.has(c)) return true;
	}
	return false;
};

/**
 * Does a source title name a person? A role word or a given name followed by a capitalised word that is not a verb,
 * noun or organisation word ("Victim Kiro Loses ...", "Researcher Lena Weiss Finds ...", "Hackers Drain Priya
 * Natarajan's Wallet"), a name with an age ("Kiro, 72, Loses"), or the radar's redaction placeholder.
 */
export const titleNamesPerson = (title: string): boolean => {
	if (/(?<![\p{L}\p{N}])\p{Lu}[\p{Ll}'’-]+,\s*(?:aged\s+)?\d{1,2},/u.test(title)) return true;
	const toks = [...title.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)].map((m) => m[0]);
	const name = (raw: string): boolean => /^\p{Lu}/u.test(raw) && !plain(fold(raw).replace(/['’]s$/, ''));
	for (let i = 0; i + 1 < toks.length; i++) {
		const a = fold(toks[i] ?? '').replace(/['’]s$/, '');
		const raw = toks[i + 1] ?? '';
		if (name(raw) && (PERSON_CUES.has(a) || FIRST_NAMES.has(a))) return true;
		// two unknown capitalised words before a person's verb: "Kiro Tanaka Loses ...", "Lena Weiss Arrested ..."
		if (name(toks[i] ?? '') && name(raw) && PERSON_VERB.test(toks[i + 2] ?? '')) return true;
	}
	return false;
};

/** Verbs a person takes right after a name in a headline (as the news gate's rules.ts PERSON_VERB). */
const PERSON_VERB = /^(?:lose|loses|lost|says|said|tells|told|admits|admitted|pleads|pleaded|charged|arrested|sentenced|jailed|indicted|extradited|convicted|detained|recounts|recalls|describes|dies|died|scammed|duped|tricked|defrauded|robbed|falls)$/i;

/** The outlet's address only ("https://www.example.com/"). */
export const urlOrigin = (url: string): string => {
	try {
		const u = new URL(url);
		return `${u.protocol}//${u.host}/`;
	} catch {
		return url;
	}
};

const PLACEHOLDER = /\[\s*named person\s*\]/i;

/**
 * A source as it may be copied onward: its title and link, or the outlet and its address when either names a person.
 * The radar's redaction placeholder in a title means the article's own link may spell the name it removed: the link
 * goes to the outlet's address. `placeholderTitleOk`: the caller words the placeholder itself ("(name withheld)", the
 * description); otherwise such a title is replaced too (the news gate refuses the placeholder in storyboard.sources).
 */
export const safeSource = (s: {title: string; url: string; publisher: string; date?: string | null}, o: {placeholderTitleOk?: boolean} = {}): {title: string; url: string; withheld: boolean} => {
	const placeholder = PLACEHOLDER.test(s.title);
	const badLink = slugNamesPerson(s.url) || placeholder;
	const badTitle = titleNamesPerson(s.title) || (placeholder && !o.placeholderTitleOk);
	if (!badLink && !badTitle) return {title: s.title, url: s.url, withheld: false};
	const day = s.date && /^\d{4}-\d{2}-\d{2}/.test(s.date) ? `, ${s.date.slice(0, 10)}` : '';
	return {title: badTitle ? `${s.publisher} article${day}` : s.title, url: badLink ? urlOrigin(s.url) : s.url, withheld: true};
};
