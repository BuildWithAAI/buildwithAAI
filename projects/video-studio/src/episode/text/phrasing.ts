/**
 * Phrase-aware breaking (pure), for caption pages and caption lines. A page or line should not END on a word that
 * leans on the next one (articles, prepositions, conjunctions, possessives, auxiliaries, subject pronouns, and
 * adverbs such as "never" that modify the next word), nor START on one that leans on the previous one (Hindi
 * postpositions). Added 2026-11-24 (review: "Most new memecoins on / Pump.fun never see day / two.").
 * Lists are short on purpose: they only steer the choice between line or page breaks that already fit.
 * Unspaced scripts (zh, ja) and languages without a list get no rule.
 */

const words = (s: string) => new Set(s.split(/\s+/).filter(Boolean));

const LEAN_NEXT: Record<string, Set<string>> = {
	en: words(`a an the of on in at to for from by with into onto about over under after before than as and or but nor if that
		this these those your my our their his her its i you we they he she is are was were be been being will would can could
		should must do does did have has had not never only just still also really even ever always very most more`),
	es: words(`el la los las un una unos unas lo al del de en a con por para sin sobre entre hacia hasta desde tras y e o u ni que
		si su sus tu tus mi mis nuestro nuestra nuestros nuestras se le les me te nos yo tú él ella nosotros ellos ellas es son
		era fue ha han he había no nunca solo sólo aún ya también muy más menos tan`),
	'pt-br': words(`o a os as um uma uns umas ao aos à às do da dos das de em no na nos nas num numa pelo pela pelos pelas por
		para com sem sobre entre até e ou nem que se seu sua seus suas meu minha meus minhas teu tua nosso nossa eu você ele ela
		nós eles elas é são era foi há tem não nunca só ainda já também muito mais menos tão`),
	it: words(`il lo la i gli le un uno una l del dello della dei degli delle di a da in con su per tra fra al allo alla ai agli alle
		dal dalla dai nel nella nei sul sulla e ed o ma che se non mai solo ancora già anche molto più meno suo sua suoi sue mio
		mia io tu lui lei noi loro è sono era ha hanno`),
};

const LEAN_PREV: Record<string, Set<string>> = {
	hi: words('का की के को में से पर ने तक है हैं था थी थे भी ही'),
};

/** Punctuation that closes a phrase: a word that carries it never leans on the next word. */
const CLOSES = /[.,;:!?…)\]}"”’»।॥]$/u;
const bare = (w: string, lang: string) =>
	w
		.toLocaleLowerCase(lang === 'pt-br' ? 'pt-BR' : lang)
		.replace(/^[¿¡"“‘«(\[{]+/u, '')
		.replace(/['’]$/u, '');

/** The word leans on the NEXT one: avoid breaking a page or line right after it. */
export const leansNext = (word: string, lang: string): boolean => {
	const set = LEAN_NEXT[lang];
	if (!set || CLOSES.test(word)) return false;
	return set.has(bare(word, lang));
};

/** The word leans on the PREVIOUS one: avoid starting a page or line with it. */
export const leansPrev = (word: string, lang: string): boolean => {
	const set = LEAN_PREV[lang];
	if (!set) return false;
	return set.has(bare(word, lang).replace(/[.,;:!?…।॥]+$/u, ''));
};

/** Does the word end a clause or sentence (a natural break after it)? */
export const closesPhrase = (word: string): boolean => CLOSES.test(word);
