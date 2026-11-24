/**
 * English stemming for the similarity score (pure): irregular forms first ("sold" -> "sell"), then the Porter (1980)
 * stemmer. Two words "mean the same stem" when stem() returns the same string; synonyms.ts merges whole word families.
 */

/** Irregular verb forms, irregular plurals and a few spelling variants, mapped to the base form. */
const IRREGULAR: Record<string, string> = Object.fromEntries(
	`bought:buy sold:sell said:say says:say paid:pay made:make took:take taken:take gave:give given:give got:get gotten:get
	went:go gone:go goes:go saw:see seen:see ran:run told:tell thought:think found:find lost:lose stole:steal stolen:steal
	wrote:write written:write knew:know known:know came:come became:become began:begin begun:begin brought:bring
	built:build caught:catch chose:choose chosen:choose drew:draw drawn:draw drove:drive driven:drive fell:fall fallen:fall
	felt:feel flew:fly flown:fly forgot:forget forgotten:forget froze:freeze frozen:freeze grew:grow grown:grow held:hold
	hid:hide hidden:hide kept:keep laid:lay led:lead lent:lend meant:mean met:meet rose:rise risen:rise rang:ring sent:send
	shook:shake shaken:shake shot:shoot sang:sing sung:sing sank:sink sunk:sink sat:sit slept:sleep spent:spend spoke:speak
	spoken:speak stood:stand stuck:stick struck:strike swore:swear sworn:swear taught:teach threw:throw thrown:throw
	understood:understand woke:wake woken:wake wore:wear worn:wear won:win withdrew:withdraw withdrawn:withdraw fed:feed
	fought:fight dealt:deal dug:dig ate:eat eaten:eat forgave:forgive forgiven:forgive hung:hang heard:hear lit:light
	mistook:mistake mistaken:mistake rode:ride ridden:ride sought:seek sprang:spring sprung:spring swam:swim swum:swim
	swung:swing tore:tear torn:tear wept:weep did:do done:do does:do has:have had:have was:be were:be been:be is:be are:be
	am:be men:man women:woman children:child mice:mouse feet:foot teeth:tooth geese:goose people:person
	ran:run sped:speed bent:bend bled:bleed bred:breed burnt:burn dreamt:dream leapt:leap learnt:learn spelt:spell spilt:spill
	spoilt:spoil shone:shine shrank:shrink shrunk:shrink slid:slide spun:spin stank:stink stung:sting strove:strive
	striven:strive arose:arise arisen:arise awoke:awake awoken:awake bore:bear borne:bear beat:beat beaten:beat
	bit:bite bitten:bite blew:blow blown:blow broke:break broken:break crept:creep fled:flee flung:fling forbade:forbid
	forbidden:forbid foresaw:foresee foreseen:foresee froze:freeze ground:ground mislaid:mislay misled:mislead
	overtook:overtake overtaken:overtake overcame:overcome paid:pay proved:prove proven:prove rewrote:rewrite
	rewritten:rewrite sewn:sew showed:show shown:show sewed:sew undid:undo undone:undo upheld:uphold wound:wind
	analyses:analysis crises:crisis criteria:criterion data:data phenomena:phenomenon
	colour:color colours:color favourite:favorite behaviour:behavior licence:license defence:defense labelled:labeled
	labelling:labeling cancelled:canceled travelled:traveled`
		.split(/\s+/)
		.filter(Boolean)
		.map((pair) => pair.split(':') as [string, string]),
);

export const lemma = (word: string): string => IRREGULAR[word] ?? word;

// ---------------------------------------------------------------------------------------------------------------------
// Porter stemmer (M.F. Porter, "An algorithm for suffix stripping", 1980), lowercase ASCII words.
// ---------------------------------------------------------------------------------------------------------------------

const isCons = (w: string, i: number): boolean => {
	const c = w[i];
	if (c === 'a' || c === 'e' || c === 'i' || c === 'o' || c === 'u') return false;
	if (c === 'y') return i === 0 ? true : !isCons(w, i - 1);
	return true;
};

/** m in [C](VC)^m[V]. */
const measure = (s: string): number => {
	let m = 0;
	let i = 0;
	const n = s.length;
	while (i < n && isCons(s, i)) i++;
	while (i < n) {
		while (i < n && !isCons(s, i)) i++;
		if (i >= n) break;
		while (i < n && isCons(s, i)) i++;
		m++;
	}
	return m;
};

const hasVowel = (s: string): boolean => {
	for (let i = 0; i < s.length; i++) if (!isCons(s, i)) return true;
	return false;
};

const doubleCons = (s: string): boolean => s.length >= 2 && s[s.length - 1] === s[s.length - 2] && isCons(s, s.length - 1);

/** *o: the stem ends consonant-vowel-consonant, and the last consonant is not w, x or y. */
const cvc = (s: string): boolean => {
	const n = s.length;
	if (n < 3) return false;
	if (!isCons(s, n - 3) || isCons(s, n - 2) || !isCons(s, n - 1)) return false;
	const c = s[n - 1];
	return c !== 'w' && c !== 'x' && c !== 'y';
};

/** Replace `suffix` with `rep` when the remaining stem has measure > `minM`. Returns null when the suffix does not end the word. */
const swap = (w: string, suffix: string, rep: string, cond: (stem: string) => boolean): string | null => {
	if (!w.endsWith(suffix)) return null;
	const stem = w.slice(0, w.length - suffix.length);
	return cond(stem) ? stem + rep : w;
};

const step1a = (w: string): string => {
	if (w.endsWith('sses')) return w.slice(0, -2);
	if (w.endsWith('ies')) return w.slice(0, -2);
	if (w.endsWith('ss')) return w;
	if (w.endsWith('s')) return w.slice(0, -1);
	return w;
};

const step1b = (w: string): string => {
	if (w.endsWith('eed')) {
		const stem = w.slice(0, -3);
		return measure(stem) > 0 ? stem + 'ee' : w;
	}
	let stem: string | null = null;
	if (w.endsWith('ed') && hasVowel(w.slice(0, -2))) stem = w.slice(0, -2);
	else if (w.endsWith('ing') && hasVowel(w.slice(0, -3))) stem = w.slice(0, -3);
	if (stem === null) return w;
	if (stem.endsWith('at') || stem.endsWith('bl') || stem.endsWith('iz')) return stem + 'e';
	if (doubleCons(stem) && !/[lsz]$/.test(stem)) return stem.slice(0, -1);
	if (measure(stem) === 1 && cvc(stem)) return stem + 'e';
	return stem;
};

const step1c = (w: string): string => (w.endsWith('y') && hasVowel(w.slice(0, -1)) ? w.slice(0, -1) + 'i' : w);

const STEP2: Array<[string, string]> = [
	['ational', 'ate'], ['tional', 'tion'], ['enci', 'ence'], ['anci', 'ance'], ['izer', 'ize'], ['bli', 'ble'], ['alli', 'al'],
	['entli', 'ent'], ['eli', 'e'], ['ousli', 'ous'], ['ization', 'ize'], ['ation', 'ate'], ['ator', 'ate'], ['alism', 'al'],
	['iveness', 'ive'], ['fulness', 'ful'], ['ousness', 'ous'], ['aliti', 'al'], ['iviti', 'ive'], ['biliti', 'ble'], ['logi', 'log'],
];
const STEP3: Array<[string, string]> = [['icate', 'ic'], ['ative', ''], ['alize', 'al'], ['iciti', 'ic'], ['ical', 'ic'], ['ful', ''], ['ness', '']];
const STEP4 = ['al', 'ance', 'ence', 'er', 'ic', 'able', 'ible', 'ant', 'ement', 'ment', 'ent', 'ion', 'ou', 'ism', 'ate', 'iti', 'ous', 'ive', 'ize'];

const mapStep = (w: string, table: Array<[string, string]>): string => {
	for (const [suf, rep] of table) {
		const r = swap(w, suf, rep, (stem) => measure(stem) > 0);
		if (r !== null) return r;
	}
	return w;
};

const step4 = (w: string): string => {
	for (const suf of STEP4) {
		if (!w.endsWith(suf)) continue;
		const stem = w.slice(0, -suf.length);
		if (measure(stem) <= 1) return w;
		if (suf === 'ion' && !/[st]$/.test(stem)) return w;
		return stem;
	}
	return w;
};

const step5 = (w: string): string => {
	let s = w;
	if (s.endsWith('e')) {
		const stem = s.slice(0, -1);
		const m = measure(stem);
		if (m > 1 || (m === 1 && !cvc(stem))) s = stem;
	}
	if (measure(s) > 1 && doubleCons(s) && s.endsWith('l')) s = s.slice(0, -1);
	return s;
};

export const porter = (word: string): string => {
	if (word.length <= 2 || !/^[a-z]+$/.test(word)) return word;
	let w = word;
	w = step1a(w);
	w = step1b(w);
	w = step1c(w);
	w = mapStep(w, STEP2);
	w = mapStep(w, STEP3);
	w = step4(w);
	w = step5(w);
	return w;
};

/** Lemma, then Porter. Accented or non-ASCII words (untranslated Spanish left in a back-translation) pass unchanged. */
export const stem = (word: string): string => porter(lemma(word.toLowerCase()));
