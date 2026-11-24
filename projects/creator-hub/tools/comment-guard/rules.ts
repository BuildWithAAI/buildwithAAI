/**
 * The comment guard's rules. Each rule has an id, a weight, a plain-language explanation and a test that
 * returns the matched evidence (or null). classifier.ts adds up the weights of the rules that fire.
 *
 * Patterns match the normalised views from normalize.ts, so look-alike letters, styled Unicode, spaced
 * letters and non-ASCII digits are already folded. The `latin` view is lower case without accents, so
 * Spanish, Portuguese and French patterns are written without accents too.
 *
 * Weights: 7 or more holds a comment on its own; 4 or more marks it for review. Strong scam scripts
 * (seed-phrase requests, "send 1 get 2", an exact copy of your channel name) hold alone; weak hints
 * (an app name, a title like "Mrs") only count together with other evidence. Negative weights dampen
 * genuine warnings, questions and victims' stories.
 */
import {editDistance, type View} from './normalize.ts';

export type PreparedIdentity = {
	ownChannelIds: Set<string>;
	trustedChannelIds: Set<string>;
	names: {name: string; skeleton: string}[];
};

export type RuleContext = {
	text: View;
	author: View;
	authorSkeleton: string;
	identity: PreparedIdentity;
};

/**
 * 'text' rules read the comment and count half when they only match inside quotation marks; 'author'
 * rules read the author's name and channel; 'dampener' rules lower the score of genuine comments.
 */
export type RuleKind = 'text' | 'author' | 'dampener';

export type Rule = {
	id: string;
	weight: number;
	kind: RuleKind;
	explanation: string;
	test(ctx: RuleContext): string | null;
};

const EVIDENCE_MAX = 80;
const clip = (s: string): string => {
	const t = s.trim().replace(/\s+/g, ' ');
	return t.length > EVIDENCE_MAX ? `${t.slice(0, EVIDENCE_MAX - 1)}…` : t;
};

const first = (re: RegExp, s: string): string | null => {
	const m = re.exec(s);
	return m ? clip(m[0]) : null;
};

const firstOf = (patterns: RegExp[], s: string): string | null => {
	for (const re of patterns) {
		const m = first(re, s);
		if (m) return m;
	}
	return null;
};

const alt = (words: string[]): string => `(?:${words.join('|')})`;

/* ------------------------------------------------------------------ negation and reported speech */

/**
 * A request is not a request when it is negated or reported: "never share your seed phrase",
 * "Zoo will never ask you to message him", "if someone asks you to connect your wallet". The filler
 * words are deliberately few, so "don't hesitate to contact her" still counts as a request.
 */
const NEGATED_BEFORE = new RegExp(
	String.raw`(?:\b(?:never|don'?t|dont|do not|won'?t|wont|will not|shouldn'?t|should not|must not|mustn'?t|can'?t|cannot|not|no one|nobody|noone|avoid|refuse to|stop)\b` +
		String.raw`(?:\s+(?:ever|even|just|you|u|anyone|anybody|people|to|will|would|should|ask|asks|asked|asking|tell|tells|told|telling|request|requests|need|needs|has|have|had|be|been)\b){0,4}\s*$)` +
		String.raw`|(?:\b(?:ask(?:s|ed|ing)?|tell(?:s|ing)?|told|want(?:s|ed|ing)?|say(?:s|ing)?|said|urg(?:e|es|ed|ing)|pressur(?:e|es|ed|ing)|instruct(?:s|ed|ing)?)\s+(?:you\s+|u\s+|me\s+|us\s+|people\s+|anyone\s+|everyone\s+|them\s+|victims\s+|viewers\s+)?to\s*$)`,
);
const NO_ONE_AFTER = /^[^.!?\n]{0,25}?\b(?:with|to)\s+(?:no ?one|nobody)\b/;

const sentenceBefore = (s: string, index: number): string => {
	const head = s.slice(Math.max(0, index - 80), index);
	const cut = Math.max(head.lastIndexOf('\n'), ...[...head.matchAll(/[.!?](?=\s)/g)].map((m) => m.index));
	return head.slice(cut + 1);
};

/** First match of a global regex that is not negated or reported speech. */
const request = (re: RegExp, s: string, checkAfter = false): string | null => {
	for (const m of s.matchAll(re)) {
		if (NEGATED_BEFORE.test(sentenceBefore(s, m.index))) continue;
		if (checkAfter && NO_ONE_AFTER.test(s.slice(m.index + m[0].length))) continue;
		return clip(m[0]);
	}
	return null;
};

/* ------------------------------------------------------------------ messaging apps, phones, links */

const APP_NAMES = [
	String.raw`whats\s?app`, 'whatsap+', 'watsap+', 'whatapp', 'wattsapp', 'wassap', 'telegram+', 'telegrm', 'telgram',
	'telegarm', String.raw`tele\s?gram`, 'viber', 'wechat', 'wickr', 'kik', 'threema', 'zangi', 'botim',
];
const APP_MENTION = new RegExp(
	String.raw`\b${alt(APP_NAMES)}\b|\b(?:on|via|over|in|at|through|thru)\s+signal\b|\bsignal\s+(?:app|messenger|number|id|chat|me)\b`,
);
/** Non-Latin spellings, matched in the `lower` view (Russian, Arabic, Hindi). */
const APP_MENTION_OTHER =
	/(?<![\p{L}\p{N}])(?:ватсап+|вотсап+|вацап|телеграм+|телеге|телега|вайбер|واتساب|واتس اب|واتسب|تلغرام|تليجرام|تيليجرام|تلجرام|व्हाट्सएप|व्हाट्सऐप|वॉट्सऐप|टेलीग्राम|टेलिग्राम)(?![\p{L}\p{N}])/u;
/** App names plus the short forms bots use right before a handle or number ("TG: @x", "WA +1..."). */
const APP_BEFORE_CONTACT = new RegExp(String.raw`\b(?:${alt(APP_NAMES)}|signal|tg|wa|line\s?id)\b`, 'g');
const APP_BEFORE_CONTACT_OTHER = new RegExp(APP_MENTION_OTHER.source, 'gu');
const HANDLE = /@[a-z_][a-z0-9_.]{3,}/;
const HANDLE_ANY = /(?<![\p{L}\p{N}_.])@[\p{L}_][\p{L}\p{N}_.]{3,}/u;

const PHONE_CANDIDATE = /(?:(?<![\p{N}+])\+\s{0,2}|(?<![\p{L}\p{N}]))\(?\d(?:[\s().\-/]{0,3}\d){6,18}(?![\p{L}\p{N}])/gu;
const DATE_LIKE = /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b|\b\d{4}[./-]\d{1,2}[./-]\d{1,2}\b/;
const YEARS_ONLY = /^(?:(?:19|20)\d{2}[\s,.\-/]*)+$/;

export type PhoneMatch = {match: string; lettersAsDigits: boolean; spacedDigits: boolean};

/**
 * Finds a phone number in any formatting: "+1 (213) 555-0147", "+ 1 2 1 3 5 5 5 0 1 4 7", digits from
 * other scripts (already folded to ASCII by the view) and the letter O or l typed for 0 or 1. Decimals,
 * dates, years, timestamps and round amounts such as 1000000000 are not phone numbers.
 */
export const findPhoneNumber = (text: string): PhoneMatch | null => {
	let swapped = text;
	for (let i = 0; i < 3; i++) {
		swapped = swapped
			.replace(/(?<=\d[\s.\-()]{0,2})[oO](?=[\s.\-()]{0,2}[\doO])/g, '0')
			.replace(/(?<=\d[\s.\-()]{0,2})[lI|](?=[\s.\-()]{0,2}\d)/g, '1');
	}
	for (const m of swapped.matchAll(PHONE_CANDIDATE)) {
		const candidate = m[0].trim();
		const digits = candidate.replace(/\D/g, '');
		const plus = candidate.startsWith('+');
		if (digits.length < (plus ? 8 : 10) || digits.length > 15) continue;
		if (/^\d+\.\d+$/.test(candidate) || /0{6,}/.test(digits)) continue;
		if (DATE_LIKE.test(candidate) || YEARS_ONLY.test(candidate)) continue;
		return {
			match: clip(candidate),
			lettersAsDigits: text.slice(m.index, m.index + m[0].length) !== m[0],
			spacedDigits: /(?:\d\s){5,}/.test(candidate),
		};
	}
	return null;
};

/** A dot, or a disguised one: "t . me", "t(.)me", "t[.]me", "t dot me". */
const DOT = String.raw`(?:\s{0,2}[.。｡]\s{0,2}|\s*\(\s*\.\s*\)\s*|\s*\[\s*\.\s*\]\s*|\s*\{\s*\.\s*\}\s*|\s+dot\s+)`;
const domain = (name: string): string => name.split('.').join(DOT);

const MESSAGING_LINK = new RegExp(
	String.raw`\b${alt(['t.me', 'telegram.me', 'telegram.dog', 'wa.me', 'wa.link', 'chat.whatsapp.com', 'api.whatsapp.com', 'signal.me', 'signal.group', 'discord.gg', 'm.me', 'ig.me', 'line.me'].map(domain))}\s*/\s*[\w+]`,
);
const SHORTENERS = [
	'bit.ly', 'tinyurl.com', 'tiny.cc', 'cutt.ly', 'rb.gy', 'is.gd', 'v.gd', 'goo.gl', 'ow.ly', 't.co', 'shorturl.at',
	'rebrand.ly', 'bl.ink', 's.id', 't.ly', 'lnkd.in', 'buff.ly', 'shorte.st', 'adf.ly', 'linktr.ee', 'lnk.bio',
	'tr.ee', 'beacons.ai', 'bio.link', 'qr.ae', 'x.gd', 'surl.li', 'clck.ru', 'u.to', 'shrtco.de', 'tny.im',
];
const SHORT_LINK = new RegExp(String.raw`\b${alt(SHORTENERS.map(domain))}\s*/\s*\w`);
const OBFUSCATED_LINK = new RegExp(
	String.raw`\b[a-z0-9][a-z0-9-]{1,40}(?:\s*\[\s*\.\s*\]\s*|\s*\(\s*\.\s*\)\s*|\s*\{\s*\.\s*\}\s*|\s+dot\s+)(?:com|net|org|io|xyz|app|live|site|online|top|info|pro|finance|exchange|dev|me|co|cc|ly|gg|link|click|vip|shop|club|ai|example)\b`,
);

/* ------------------------------------------------------------------ contact solicitations */

const CONTACT_VERBS = String.raw`(?:text|txt|dm|pm|message|msg|inbox|contact|ping|write(?: to)?|email|mail|whats\s?app|telegram|signal|chat with|talk to|reach(?: out to)?|get in touch with|speak (?:to|with))`;

const CONTACT_ME = new RegExp(
	[
		String.raw`\b${CONTACT_VERBS}\s+me\b`,
		String.raw`\bhit me up\b|\bhmu\b`,
		String.raw`\bcall me\s+(?:on|at|via|now|\+|\d)`,
		String.raw`\badd me (?:on|via|at)\s+(?:${alt(APP_NAMES)}|signal|ig|instagram|snap(?:chat)?|discord)\b`,
		String.raw`\b(?:my|our)\s+(?:${alt(APP_NAMES)}|signal|tg|wa|contact)\s*(?:number|handle|id|username|contact|line)?\s*(?:is\s*)?[:👉=>\-→➡]*\s*(?:@|\+|\d|t\.me)`,
		String.raw`\bjoin (?:my|our) (?:vip |private |premium |exclusive |free |paid )?(?:${alt(APP_NAMES)}|signal|discord|group|channel|community|class|team|chat)\b`,
		String.raw`\b(?:dm|inbox|message|text|contact|pm)\s+(?:for|4)\s+(?:more|info|details|the|signals?|help|recovery|strategy|guidance)\b`,
		// Spanish, Portuguese, French, German, Turkish, Indonesian, romanised Hindi
		String.raw`\b(?:escribeme|escribanme|contactame|contactenme|hablame|agregame|mandame (?:un )?(?:mensaje|whats\s?app|wsp))\b`,
		String.raw`\b(?:me chama|me chame|me manda (?:mensagem|msg)|fala comigo|entre em contato comigo|me adiciona)\b`,
		String.raw`\b(?:contacte[sz]?[- ]moi|ecri(?:s|vez)[- ]moi|ajoute[sz]?[- ]moi)\b`,
		String.raw`\b(?:schreib(?:t|en sie)? mir|kontaktier(?:t|en sie)? mich)\b`,
		String.raw`\bbana (?:yaz|ulas)\b`,
		String.raw`\b(?:hubungi|chat|kontak) (?:saya|aku|kami)\b`,
		String.raw`\b(?:mujhe|muje|mere ko)\s+(?:${alt(APP_NAMES)}|message|msg|call|contact|dm)\s+(?:karo|karein|kare|kijiye)\b`,
	].join('|'),
	'g',
);
const CONTACT_ME_OTHER = /(?<![\p{L}\p{N}])(?:пишите|напишите|пиши|напиши|свяжитесь|звоните)\s+(?:мне|нам)|(?<![\p{L}\p{N}])пишите в (?:телеграм|ватсап|лс)|راسلني|كلمني|تواصل(?:وا)? (?:معي|معنا)/u;

const HANDLER_TARGET = String.raw`(?:him|her|them|this (?:man|woman|lady|guy|expert|hacker|company|team)|the (?:expert|hacker|team|company|agent|manager|admin)|(?:our|the) (?:help ?desk|support|support team|team|admin|manager|agent)|support|mr|mrs|ms|miss|madam|dr|sir|prof|expert|coach|mentor|hacker|agent)`;
const CONTACT_THEM = new RegExp(
	[
		String.raw`\b${CONTACT_VERBS}\s+${HANDLER_TARGET}\b`,
		String.raw`\b(?:consult|hire|connect with|link up with)\s+${HANDLER_TARGET}\b`,
		String.raw`\b(?:she|he|they)(?:'s| is| are)\s+(?:on|available on|reachable on|active on)\s+(?:${alt(APP_NAMES)}|signal|instagram|ig)\b`,
		String.raw`\b(?:her|his|their)\s+(?:${alt(APP_NAMES)}|signal|contact|number|handle|info|details|email|username|tg|wa)\s*(?:is|number|id|handle|info|:|👉|-|→|➡|@|\+|link)`,
		String.raw`\byou can (?:reach|contact|message|text|find|write to|get) (?:him|her|them|the expert|the team)\b`,
		String.raw`\b(?:escribele|escribanle|contactalo|contactala|contactenlo|contactenla|hablale)\b|\bcontacta(?:r|te)? (?:a|al|con)\b`,
		String.raw`\b(?:chama|chame|fale com|fala com) (?:ele|ela)\b|\bentre em contato com (?:ele|ela|o|a)\b|\bcontato (?:dele|dela)\b`,
		String.raw`\bcontacte[zr]?[- ](?:le|la|les)\b|\bcontactez (?:mme|m|mr|madame|monsieur)\b|\becrivez[- ](?:lui|leur)\b`,
		String.raw`\bhubungi (?:dia|beliau|mereka|bu|pak|ibu|bapak)\b`,
		String.raw`\bschreib(?:t|en sie)? (?:ihm|ihr)\b|\bkontaktier(?:t|en sie)? (?:ihn|sie)\b`,
	].join('|'),
	'g',
);

/* ------------------------------------------------------------------ handlers, profits, recovery */

const HONORIFICS = /\b(mr|mrs|ms|miss|madam|madame|mme|sra|sr|sir|dr|prof|expert|coach|mentor|hacker|agent|broker|captain)\.?\s+([\p{L}][\p{L}'-]{2,})/giu;
const STRONG_HONORIFIC = /^(?:mrs|ms|miss|madam|madame|mme|sra|expert|coach|mentor|hacker|agent|broker)$/i;
const NOT_A_NAME = new Set(
	'the and but for who what when where why how this that these those you your his her their our said says is was are were has have had will would can could should with from about into just also very really still here there they them she him it its x'.split(
		' ',
	),
);
const HANDLER_HANDLE = /@(?:mrs?|ms|miss|madam|dr|expert|coach|mentor|hacker|agent|broker)[_.-]?[a-z]{3,}/i;

const handlerTitle = (plain: string): string | null => {
	for (const m of plain.matchAll(HONORIFICS)) {
		const name = m[2];
		if (NOT_A_NAME.has(name.toLowerCase())) continue;
		if (/^\p{Lu}/u.test(name) || STRONG_HONORIFIC.test(m[1])) return clip(m[0]);
	}
	return first(HANDLER_HANDLE, plain);
};

const HANDLER_ROLE = new RegExp(
	[
		String.raw`\b(?:account|investment|portfolio|fund|asset|wealth|trading|trade) managers?\b`,
		String.raw`\b(?:trading|crypto|forex|bitcoin|investment|financial|binary) (?:mentor|coach|expert|advisor|adviser|consultant|guru|specialist|analyst|strategist)s?\b`,
		String.raw`\brecovery (?:expert|specialist|agent|agency|hacker|company|firm|team|service|desk|professional|consultant)s?\b`,
		String.raw`\b(?:fund|funds|asset|crypto|bitcoin|wallet) recovery\b`,
		String.raw`\b(?:ethical|certified|genuine|legit|professional|licensed|trusted|reliable|verified|registered) (?:hacker|broker|trader|account manager|investment manager|advisor|adviser)s?\b`,
		String.raw`\b(?:expert|professional|pro) (?:trader|broker|hacker)s?\b`,
		String.raw`\bbinary options?\b`,
		String.raw`\b(?:she|he|they) (?:manages?|handles?|trades?) (?:my|our|for me)\b|\bmanages? (?:my|your|ur) (?:portfolio|account|investments?|trades|funds)\b|\bmanage (?:your|ur) (?:account|portfolio|investments?|trades|funds)\b`,
		String.raw`\bexpert[oa]? en recuperacion\b|\bgestor[a]? de (?:cuentas?|inversiones?)\b|\bhacker etico\b`,
		String.raw`\bespecialista em recuperacao\b|\brecuperacao de (?:fundos|criptomoedas?)\b|\bgerente de conta\b`,
		String.raw`\bexpert[e]? en recuperation\b|\bgestionnaire de compte\b`,
	].join('|'),
);

const MONEY = String.raw`(?:[$€£₦₹]\s?\d[\d,.]*\s?k?\b|\d[\d,.]*\s?(?:k|usd|usdt|usdc|dollars|eur|euros|pounds|btc|eth|sol|bnb|grand|thousand|million)\b)`;
const PERIOD = String.raw`(?:daily|weekly|monthly|bi-?weekly|every (?:single )?(?:day|week|month)|per (?:day|week|month)|a (?:day|week|month)|each (?:day|week|month))`;

const PROFIT_CLAIM = new RegExp(
	[
		String.raw`\b(?:made|earned|earn|earning|make|making|received|receive|withdrew|withdrawn|withdraw|gained|profited|cashed out|pulled out|turned|grew|generated|pocketed)\b[^.!?\n]{0,30}?${MONEY}`,
		String.raw`${MONEY}\s+(?:profits?|returns?|gains?|roi|payouts?|withdrawal)\b`,
		String.raw`\bprofits? of\s+[$€£]?\d`,
		String.raw`\bmy (?:profits?|returns?|earnings) (?:have been|are|were|is|was) (?:amazing|incredible|huge|great|insane|massive|unbelievable|consistent)\b`,
		String.raw`\bturned my [^.!?\n]{1,30} into\b`,
	].join('|'),
);

const INCOME_CLAIM = new RegExp(
	[
		String.raw`\b(?:earn\w*|mak(?:e|es|ing)|made|receiv\w*|get|gets|getting|got|withdr\w*|profit\w*|pull(?:ing)? out|cash(?:ing)? out)\b[^.!?\n]{0,25}?(?:${MONEY}|\d+(?:\.\d+)?\s?%)[^.!?\n]{0,25}?\b${PERIOD}\b`,
		String.raw`${MONEY}\s+${PERIOD}\s+(?:profits?|income|returns?|payouts?|earnings)\b`,
		String.raw`\b(?:daily|weekly|monthly) (?:profits?|income|returns?|payouts?|earnings) of\b`,
	].join('|'),
);

const RECOVERY_CLAIM = new RegExp(
	[
		String.raw`\b(?:recover(?:ed|ing|s)?|retriev(?:e|ed|ing))\s+(?:(?:all|every|each)\s+)?(?:of\s+)?(?:my|your|our|his|her|their|the|it|them|everything|all)\b`,
		String.raw`\b(?:got|get|gotten) (?:my|all my|our|his|her|their) [^.!?\n]{0,30}\bback\b`,
		String.raw`\b(?:got|get|gotten) (?:everything|it all|all of it|it|them) back\b`,
		String.raw`\bhelp(?:ed|s)? (?:me|you|us|people|victims) (?:to )?(?:recover|get (?:my|your|it|them) back)\b`,
		String.raw`\b(?:i|we) can help you (?:recover|get)\b`,
		String.raw`\b(?:me ayudo a recuperar|recupere mis|recuperar (?:tu|tus|mis) )`,
		String.raw`\b(?:recuperei|recuperou|recuperar (?:meus|seus|o seu))\b`,
		String.raw`\b(?:recupere|recuperer) (?:mes|vos|tes|tous)\b`,
	].join('|'),
);

const LIFE_CHANGE = /\b(?:changed my life|life[- ]changing|financial(?:ly)? free(?:dom)?|quit my (?:job|9 ?to ?5)|paid off (?:my|our)|retired?(?: early)?|bought (?:a|my|our) (?:new )?(?:house|home|car)|best decision|no more debt|debt[- ]free)\b/;

const CREDIT =
	/\b(?:thanks to|thank you|thanks|thanking|all thanks|grateful (?:to|for)|credit (?:goes )?to|shout ?out to|kudos to|god bless|recommend(?:ed|ing)?|introduced (?:me )?to|helped me|help of|with the help|under the guidance|guidance of|until i (?:met|found|came across|contacted)|(?:working|trading|investing|invested|invest) with|with (?:her|his|their) (?:help|strategy|guidance|signals|system|method|assistance)|(?:she|he|they) (?:recovered|helped|got|made|turned|changed)|gracias a|grace a|gracas a|dank)\b/;

const hasHandler = (ctx: RuleContext): boolean =>
	handlerTitle(ctx.text.plain) !== null || HANDLER_ROLE.test(ctx.text.latin) || HANDLE.test(ctx.text.latin);

const GUARANTEED = new RegExp(
	[
		String.raw`\bguarantee(?:d|s)?\s+(?:\w+\s+){0,2}(?:profits?|returns?|income|gains?|payouts?|results|signals|wins?|roi|money|\d+x|x\d+|\d+(?:\.\d+)?\s?%)`,
		String.raw`\b100\s?%\s+(?:guaranteed|sure|safe|risk[- ]free)\b`,
		String.raw`\brisk[- ]free (?:profits?|returns?|investment|trading|income)\b`,
		String.raw`\b\d+(?:\.\d+)?\s?% (?:daily|weekly|monthly|per day|per week|a day|a week|every day|every week|roi)\b`,
		String.raw`\b(?:\d+x|x\d+)\s+(?:in|within)\s+(?:a|one|\d+)\s+(?:day|week|month|hour)s?\b`,
	].join('|'),
);

const LEGIT_CLAIM = new RegExp(
	[
		String.raw`\b100\s?%\s+(?:legit|real|genuine|trusted|reliable)\b`,
		String.raw`\b(?:not|no)\s+(?:a\s+)?scam\b|\bnot fake\b`,
		String.raw`\b(?:she|he|they|this (?:man|woman|lady|guy|company|team))(?:'s| is| are)\s+(?:so |very |really |truly |totally |completely )?(?:legit|legitimate|genuine|trustworthy|reliable|the real deal|honest|the best|the real one)\b`,
		String.raw`\bis the real deal\b`,
		String.raw`\b(?:legit|genuine|real|trusted|reliable) and (?:reliable|trusted|legit|genuine|honest|trustworthy)\b`,
		String.raw`\bonly (?:legit|real|genuine|trusted|reliable) (?:one|person|expert|hacker|broker|trader|account manager|team|company)\b`,
		String.raw`\bgod bless (?:her|him|them|mrs?|ms|madam|expert)\b`,
	].join('|'),
);

/* ------------------------------------------------------------------ giveaways, seed phrases, drainers */

const COIN = String.raw`(?:btc|bitcoin|eth|ether|ethereum|sol|solana|usdt|usdc|bnb|xrp|doge|ada|trx|ton|crypto|coins?|tokens?)`;
const DOUBLING = new RegExp(
	[
		String.raw`\bsend\b[^.!?\n]{0,40}?\b(?:get|receive|recieve|returns?|back)\b[^.!?\n]{0,30}?\b(?:double|2x|x2|twice|2 times|two times|doubled)\b`,
		String.raw`\bsend\s+(?:\d+(?:\.\d+)?|any amount(?: of)?|some|your)\s*${COIN}?\b[^.!?\n]{0,50}?\b(?:get|receive|recieve)\s+(?:\d+(?:\.\d+)?|double|2x|twice)`,
		String.raw`\bdouble (?:your|ur) (?:money|investment|capital|crypto|btc|bitcoin|eth|sol|coins|tokens|holdings|deposit)\b`,
		String.raw`\b(?:2x|x2|double) (?:back|return|your deposit)\b`,
	].join('|'),
	'g',
);

const PRIZE = new RegExp(
	[
		String.raw`\b(?:you(?:'ve| have| are|'re)?|u)\s+(?:been\s+|just\s+)?(?:selected|chosen|shortlisted|picked|won|one of (?:our|the) (?:lucky )?winners?)\b`,
		String.raw`\b(?:i|we) (?:picked|selected|chose) you\b`,
		String.raw`\blucky winners?\b`,
		String.raw`\bcongrat(?:ulation)?s?\b[^.!?\n]{0,40}\b(?:won|winner|winners|selected|chosen|shortlisted|picked|reward|prize|gift)\b`,
		String.raw`\bgiveaway\b[^.!?\n]{0,40}\b(?:is live|winners?|participate|send|claim|address|wallet|eligible)\b`,
		String.raw`\bgiv(?:ing|e) ?away\s+\d`,
		String.raw`\bhas sido (?:seleccionad[oa]|elegid[oa])\b|\b(?:eres|es) (?:el|la|uno de los) ganador`,
		String.raw`\bvoce foi (?:selecionad[oa]|escolhid[oa])\b|\bvous avez (?:ete selectionne|gagne)\b`,
	].join('|'),
);

const CLAIM = new RegExp(
	[
		String.raw`\bclaim\s+(?:your|ur|yours|it|the|my|free|now|this|these|before|reward|prize|gift|airdrop|bonus|tokens?|btc|eth|sol|usdt)\b`,
		String.raw`\bfree\s+(?:btc|bitcoin|eth|ethereum|sol|solana|usdt|crypto|tokens?|coins?|airdrops?|nfts?|money)\b`,
		String.raw`\b(?:receive|get|grab|collect)\s+(?:the|your|free|an?)\s+(?:airdrop|reward|bonus|gift|prize)\b`,
		String.raw`\bfirst\s+\d+\s+(?:people|persons|users|members|subscribers|viewers)\b`,
		String.raw`\bbefore it (?:expires|ends|runs out)\b|\blimited (?:spots|slots)\b`,
		String.raw`\b(?:para reclamar|reclama tu|resgate (?:o seu|seu))\b`,
	].join('|'),
	'g',
);

const SECRET = String.raw`(?:seed\s?(?:phrase|words?)|seed\b|recovery\s?(?:phrase|words?|key|seed)|secret\s?(?:recovery\s)?(?:phrase|words?|key)|mnemonic(?:\s?phrase)?|private\s?keys?|(?:12|24|twelve|twenty[- ]?four)[- ]?words?|passphrase|key\s?phrase|wallet\s?(?:phrase|keys?|seed))`;
const SEED_REQUEST = new RegExp(
	String.raw`\b(?:send|share|give|dm|pm|message|text|provide|submit|drop|tell|show|forward|email|upload|reveal|disclose|hand over|whats\s?app|telegram)\s+(?:(?:it\s+)?(?:to\s+)?(?:me|us|him|her|them|the (?:team|support|agent|admin|bot|form))\s+)?(?:with\s+)?(?:your|ur|the|yo|you'?re)?\s*${SECRET}`,
	'g',
);

const WALLET_CONNECT = new RegExp(
	[
		String.raw`\b(?:validate|sync|synchroni[sz]e|rectify|whitelist|migrate|reactivate|authenticate|verify|import|link)\s+(?:your|ur)\s+(?:\w+\s+)?(?:wallets?|metamask|trust\s?wallet|phantom|ledger|trezor|exodus|keys|seed)\b`,
		String.raw`\bconnect\s+(?:your|ur)\s+(?:\w+\s+)?(?:wallets?|metamask|phantom)\b[^.!?\n]{0,40}?\b(?:to|at|on|via|using|here|below|through|in)\b[^.!?\n]{0,40}?(?:link|site|portal|dapp|page|form|url|claim|receive|get|airdrop|reward|whitelist|presale|mint|\.[a-z]{2,}\b|\[\.\])`,
		String.raw`\bwallet\s?connect\b`,
	].join('|'),
	'g',
);

const DRAINER_JARGON = new RegExp(
	[
		String.raw`\b(?:rectification|validation|synchroni[sz]ation|sync|syncing|migration|whitelist(?:ing)?|claim|presale|mint(?:ing)?|airdrop|recovery)\s+(?:dapp|portal|site|page|node|tool|link|form|bot)\b`,
		String.raw`\bwallet (?:validation|synchroni[sz]ation|rectification|migration|verification) (?:portal|site|page|link|tool|process)?`,
		String.raw`\bdapp\b[^.!?\n]{0,30}\b(?:fix|rectif\w*|validat\w*|sync\w*|resolve)\b|\b(?:fix|rectify|validate|sync|resolve)\b[^.!?\n]{0,30}\bdapp\b`,
	].join('|'),
);

const PROFILE_BAIT = new RegExp(
	[
		String.raw`\b(?:check|click|visit|tap|see|view|open)\s+(?:on\s+)?(?:my|the)\s+(?:profile|bio|name|pfp|avatar)\b`,
		String.raw`\b(?:link|info|details|contact|number|wallet|address|telegram|whatsapp|strategy)\s+(?:is\s+)?(?:in|on)\s+my\s+(?:bio|profile|channel|about|name|page)\b`,
	].join('|'),
);

/* ------------------------------------------------------------------ dampeners */

const WARNING = new RegExp(
	[
		String.raw`\b(?:beware|watch out|be careful|heads up|psa|stay safe|warning|red flag)\b`,
		String.raw`\b(?:don'?t|do not|never)\s+(?:ever\s+)?(?:fall for|trust|send|reply|respond|contact|click|text|message|dm|call|share|engage|answer|believe|give (?:out |away )?(?:your|my|anyone|them|him|her|it|any))\b`,
		String.raw`\bignore (?:the|these|those|this|them|all|every|any)\b`,
		String.raw`\b(?:report(?:ed|ing)?|block(?:ed|ing)?) (?:them|it|these|those|this|the|him|her|that|every|all)\b|\breported\b`,
		String.raw`\b(?:it'?s|is|are|its|that'?s|this is|these are|those are|they'?re|all|was|were)(?:\s+\w+){0,3}\s+(?:scam|scams|scammers?|bots?|fake|fraud|frauds|phishing|impersonators?|drainers?)\b`,
		String.raw`\bscam (?:alert|bots?|replies|comments|accounts?|sites?|links?|calls?|messages?)\b|\bscam bot\b`,
		String.raw`\bfake (?:accounts?|replies|support|profiles?|channels?|sites?|giveaways?|airdrops?|experts?|hackers?|apps?)\b`,
		String.raw`\b(?:impersonat\w*|phishing)\b`,
		String.raw`\b(?:claim(?:s|ing|ed)? to be|pretend(?:s|ing)? to be|posing as)\b`,
	].join('|'),
);

const VICTIM = new RegExp(
	String.raw`\b(?:i|we|me|my (?:dad|mom|mum|father|mother|uncle|aunt|friend|brother|sister|wife|husband|grandma|grandpa|grandmother|grandfather|son|daughter|cousin|parents|partner|colleague|boss|wallet))\b[^.!?\n]{0,40}\b(?:lost|got scammed|was scammed|been scammed|got hacked|was hacked|been hacked|got drained|was drained|been drained|fell for|almost (?:lost|sent|fell|clicked|gave|shared|answered)|nearly (?:lost|sent|fell|clicked|gave|shared))\b|\b(?:perdi|perdí|fui roubad[oa]|me estafaron)\b`,
);

/* ------------------------------------------------------------------ the rule table */

const messagingHandle = (view: View): string | null => {
	const check = (re: RegExp, s: string): string | null => {
		for (const m of s.matchAll(re)) {
			const after = s.slice(m.index + m[0].length, m.index + m[0].length + 40);
			const handle = HANDLE.exec(after) ?? HANDLE_ANY.exec(after) ?? /\bt\s*\.\s*me\b|\bwa\s*\.\s*me\b/.exec(after);
			if (handle) return clip(`${m[0]}${after.slice(0, handle.index + handle[0].length)}`);
			const phone = findPhoneNumber(after);
			if (phone) return clip(`${m[0]} ${phone.match}`);
		}
		return null;
	};
	return check(APP_BEFORE_CONTACT, view.latin) ?? check(APP_BEFORE_CONTACT_OTHER, view.lower);
};

const impersonation = (ctx: RuleContext): {distance: number; name: string} | null => {
	const author = ctx.authorSkeleton;
	if (!author) return null;
	let best: {distance: number; name: string} | null = null;
	for (const {name, skeleton} of ctx.identity.names) {
		const distance = editDistance(author, skeleton, 2);
		if (distance > 2 || (distance > 0 && Math.min(author.length, skeleton.length) < 5)) continue;
		if (!best || distance < best.distance) best = {distance, name};
	}
	return best;
};

export const RULES: Rule[] = [
	{
		id: 'seed-request',
		weight: 7,
		kind: 'text',
		explanation: 'Asks for a seed phrase, recovery phrase or private key. Whoever has these can empty the wallet.',
		test: (ctx) => request(SEED_REQUEST, ctx.text.latin, true),
	},
	{
		id: 'doubling-scheme',
		weight: 7,
		kind: 'text',
		explanation: '"Send X, get 2X back": a giveaway scam that keeps whatever is sent.',
		test: (ctx) => request(DOUBLING, ctx.text.latin),
	},
	{
		id: 'impersonation-exact',
		weight: 7,
		kind: 'author',
		explanation:
			'The author name is your channel name in disguise (look-alike letters, or words like "Official" or "Support" added), but the comment comes from a different channel.',
		test: (ctx) => {
			const match = impersonation(ctx);
			return match?.distance === 0 ? clip(`${ctx.author.plain} ≈ ${match.name}`) : null;
		},
	},
	{
		id: 'impersonation-lookalike',
		weight: 5,
		kind: 'author',
		explanation: 'The author name is within 2 letters of your channel name, but the comment comes from a different channel.',
		test: (ctx) => {
			const match = impersonation(ctx);
			return match && match.distance > 0 ? clip(`${ctx.author.plain} ≈ ${match.name}`) : null;
		},
	},
	{
		id: 'messaging-link',
		weight: 5,
		kind: 'text',
		explanation: 'Contains a direct chat link (t.me, wa.me...) that takes viewers off YouTube into a private chat.',
		test: (ctx) => first(MESSAGING_LINK, ctx.text.latin),
	},
	{
		id: 'prize-bait',
		weight: 5,
		kind: 'text',
		explanation: 'Tells the reader they won or were selected for a prize or giveaway.',
		test: (ctx) => first(PRIZE, ctx.text.latin),
	},
	{
		id: 'wallet-connect',
		weight: 5,
		kind: 'text',
		explanation: 'Asks the reader to connect, "validate" or "sync" a wallet: the usual wallet-drainer script.',
		test: (ctx) => request(WALLET_CONNECT, ctx.text.latin),
	},
	{
		id: 'author-contact',
		weight: 5,
		kind: 'author',
		explanation: 'The author name itself advertises a messaging app, handle or phone number.',
		test: (ctx) => {
			const name = ctx.author;
			if (findPhoneNumber(name.plain)) return clip(name.plain);
			if (APP_MENTION.test(name.latin) || APP_MENTION_OTHER.test(name.lower) || MESSAGING_LINK.test(name.latin)) {
				return clip(name.plain);
			}
			return null;
		},
	},
	{
		id: 'contact-me',
		weight: 4,
		kind: 'text',
		explanation: 'Asks readers to contact the writer privately ("text me", "DM me"): the usual first step of a scam.',
		test: (ctx) => request(CONTACT_ME, ctx.text.latin) ?? first(CONTACT_ME_OTHER, ctx.text.lower),
	},
	{
		id: 'messaging-handle',
		weight: 4,
		kind: 'text',
		explanation: 'Gives a messaging-app username or number to contact.',
		test: (ctx) => messagingHandle(ctx.text),
	},
	{
		id: 'phone-number',
		weight: 4,
		kind: 'text',
		explanation: 'Contains a phone number (any formatting, including spaced-out or non-ASCII digits).',
		test: (ctx) => findPhoneNumber(ctx.text.latin)?.match ?? null,
	},
	{
		id: 'link-shortener',
		weight: 4,
		kind: 'text',
		explanation: 'Contains a shortened link that hides where it leads.',
		test: (ctx) => first(SHORT_LINK, ctx.text.latin),
	},
	{
		id: 'obfuscated-link',
		weight: 4,
		kind: 'text',
		explanation: 'Writes a web address in disguise ("site[.]xyz") to get past YouTube\'s link filter.',
		test: (ctx) => first(OBFUSCATED_LINK, ctx.text.latin),
	},
	{
		id: 'testimonial',
		weight: 4,
		kind: 'text',
		explanation: 'A success story that credits a named handler: the classic "thanks to Mrs X I earned..." script.',
		test: (ctx) => {
			const credit = first(CREDIT, ctx.text.latin);
			if (!credit || !hasHandler(ctx)) return null;
			const outcome =
				PROFIT_CLAIM.test(ctx.text.latin) ||
				INCOME_CLAIM.test(ctx.text.latin) ||
				RECOVERY_CLAIM.test(ctx.text.latin) ||
				LIFE_CHANGE.test(ctx.text.latin);
			return outcome ? credit : null;
		},
	},
	{
		id: 'contact-them',
		weight: 3,
		kind: 'text',
		explanation: 'Sends readers to a third party in private ("contact her on WhatsApp"): typical of "handler" scams.',
		test: (ctx) => request(CONTACT_THEM, ctx.text.latin),
	},
	{
		id: 'handler-role',
		weight: 3,
		kind: 'text',
		explanation: 'Pitches an "account manager", "recovery expert", "certified hacker" or similar. These roles are scam staples.',
		test: (ctx) => first(HANDLER_ROLE, ctx.text.latin),
	},
	{
		id: 'income-claim',
		weight: 3,
		kind: 'text',
		explanation: 'Claims a recurring income ("$3k weekly"), as fake testimonials do.',
		test: (ctx) => first(INCOME_CLAIM, ctx.text.latin),
	},
	{
		id: 'guaranteed-returns',
		weight: 3,
		kind: 'text',
		explanation: 'Promises guaranteed or fixed high returns. Real investments never do.',
		test: (ctx) => first(GUARANTEED, ctx.text.latin),
	},
	{
		id: 'claim-bait',
		weight: 3,
		kind: 'text',
		explanation: 'Pushes the reader to claim free crypto, an airdrop or a reward, often with false urgency.',
		test: (ctx) => request(CLAIM, ctx.text.latin),
	},
	{
		id: 'drainer-jargon',
		weight: 3,
		kind: 'text',
		explanation: 'Uses wallet-drainer jargon ("rectification dapp", "validation portal").',
		test: (ctx) => first(DRAINER_JARGON, ctx.text.latin),
	},
	{
		id: 'profile-bait',
		weight: 3,
		kind: 'text',
		explanation: "Sends readers to the writer's profile or bio, where the scam link usually is.",
		test: (ctx) => first(PROFILE_BAIT, ctx.text.latin),
	},
	{
		id: 'handler-title',
		weight: 2,
		kind: 'text',
		explanation: 'Names a person with a title such as "Mrs", "Expert" or "Hacker". Scam scripts promote a named "handler".',
		test: (ctx) => handlerTitle(ctx.text.plain),
	},
	{
		id: 'recovery-claim',
		weight: 2,
		kind: 'text',
		explanation: 'Claims that lost or stolen funds were (or can be) recovered.',
		test: (ctx) => first(RECOVERY_CLAIM, ctx.text.latin),
	},
	{
		id: 'profit-claim',
		weight: 2,
		kind: 'text',
		explanation: 'States a trading or investment profit.',
		test: (ctx) => first(PROFIT_CLAIM, ctx.text.latin),
	},
	{
		id: 'legitimacy-claim',
		weight: 2,
		kind: 'text',
		explanation: 'Insists someone or something is "legit" or "not a scam".',
		test: (ctx) => first(LEGIT_CLAIM, ctx.text.latin),
	},
	{
		id: 'obfuscation',
		weight: 2,
		kind: 'text',
		explanation: 'Disguises text with look-alike or styled letters, spaced-out letters or unusual digits to slip past filters.',
		test: (ctx) => {
			const kinds: string[] = [...ctx.text.obfuscation];
			const phone = findPhoneNumber(ctx.text.latin);
			if (phone?.lettersAsDigits) kinds.push('letters typed as digits');
			if (phone?.spacedDigits) kinds.push('spaced-out digits');
			return kinds.length ? kinds.join(', ') : null;
		},
	},
	{
		id: 'author-handler-name',
		weight: 2,
		kind: 'author',
		explanation: 'The author name is styled as a "handler" ("@MrsSarahFX", "Expert Brian").',
		test: (ctx) =>
			first(/(?:^|@|\s)(?:mrs?|ms|miss|madam|expert|hacker|coach|mentor|agent|broker)[\s._-]?[a-z]{3,}/i, ctx.author.plain),
	},
	{
		id: 'messaging-app',
		weight: 1,
		kind: 'text',
		explanation: 'Mentions a private messaging app (WhatsApp, Telegram, Signal...). Weak evidence on its own.',
		test: (ctx) => first(APP_MENTION, ctx.text.latin) ?? first(APP_MENTION_OTHER, ctx.text.lower),
	},
	{
		id: 'warning-context',
		weight: -4,
		kind: 'dampener',
		explanation: 'Reads as a warning about scams, so scam phrases it repeats count less (and not at all inside quotation marks).',
		test: (ctx) => first(WARNING, ctx.text.latin),
	},
	{
		id: 'victim-story',
		weight: -2,
		kind: 'dampener',
		explanation: 'Describes the writer, or someone close, losing money or being targeted.',
		test: (ctx) => first(VICTIM, ctx.text.latin),
	},
	{
		id: 'question',
		weight: -1,
		kind: 'dampener',
		explanation: 'Asks a question, as genuine viewers do.',
		test: (ctx) => (/[?؟]/.test(ctx.text.plain) ? '?' : null),
	},
];

/** Batch rule, applied by classifier.ts after every comment has been scored on its own. */
export const BURST_RULE = {
	id: 'copy-paste-burst',
	weight: 5,
	explanation: 'The same text was posted by several different accounts: coordinated bot spam.',
} as const;
