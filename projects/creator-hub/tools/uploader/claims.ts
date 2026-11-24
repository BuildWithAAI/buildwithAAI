/**
 * Income, return and guarantee claims in upload metadata, in English, Spanish and Portuguese.
 *
 * The publish kit lints the English title and description it writes, but nothing else checks the upload spec: its
 * localized titles and descriptions (es, pt-BR, ...) and its tags. The uploader runs these rules on them before an
 * approval can be written, and a hit is a refusal (CLAUDE.md: no income or return claims, in any language).
 *
 * The English rules mirror creator-hub/src/claims.ts (the hub's shared list, which covers the publish kit's
 * INCOME_CLAIMS); the Spanish and Portuguese ones extend video-studio/scripts/assets/lib/lint.ts. The lists are kept
 * in step by hand, as the hub already does with the kit's list: this file must stay importable on its own. Every rule
 * runs on every language (an English money pattern inside Spanish text is still a claim).
 *
 * Like the hub's rules, these match a claim even when it is quoted or denied: a description is read in pieces, so
 * describe a scam's trick without repeating its pitch. The one exception is a safety promise after a denial in the
 * same sentence ("No wallet is 100% safe", "Ninguna billetera es 100% segura").
 */

export type ClaimRule = {label: string; pattern: RegExp; unlessDenied?: boolean};
export type ClaimHit = {label: string; match: string; index: number};

/* ------------------------------------------------------------------ English (creator-hub/src/claims.ts) */

const MONEY = String.raw`(?:[$€£¥₹]\s?\d[\d,.]*\s?(?:k|m|million|thousand)?\b|\d[\d,.]*\s?(?:k\s)?(?:usd|usdt|usdc|dollars?|euros?|pounds?|btc|bitcoin|eth|ether|sol|bnb)\b)`;
const MONTHS = 'january|february|march|april|may|june|july|august|september|october|november|december';

export const ENGLISH_CLAIMS: readonly ClaimRule[] = [
	{label: 'guaranteed', pattern: /\bguarantee[ds]?\b/i},
	{label: 'risk-free', pattern: /\brisk[\s-]?free\b|\b(?:no|zero)[\s-]risk\b|\bwithout (?:any )?risk\b/i},
	{label: 'get rich', pattern: /\bget(?:ting)?[\s-]rich\b|\brich[\s-]quick\b/i},
	{label: 'passive income', pattern: /\bpassive[\s-]income\b/i},
	{label: 'a 100x-style multiplier', pattern: /(?<![\w$.,])(?:\d{1,3}(?:,\d{3})+|\d{2,})\s?x\b(?!\s?\d)|\bx\d{2,}\b/i},
	{label: 'a short-term multiplier', pattern: /\b(?:easy|quick|fast|guaranteed|will|could|can|going to|gonna)\s+[2-9]\s?x\b|\b[2-9]\s?x\s+(?:in|within)\s+(?:a|one|\d+|the next)\s*(?:hour|day|week|month)s?\b/i},
	{label: 'double your money', pattern: /\b(?:double|triple) your (?:money|crypto|investment|portfolio|savings)\b/i},
	{label: 'financial freedom', pattern: /\bfinancial(?:ly)?[\s-]free(?:dom)?\b/i},
	{label: 'make money fast', pattern: /\bmake (?:money|cash|\$\s?\d[\d,]*k?) (?:fast|quick(?:ly)?|online|overnight|while you sleep)\b/i},
	{label: 'an earnings figure', pattern: new RegExp(String.raw`\b(?:earn(?:s|ed|ing)?|make|makes|made|making|net(?:s|ted)?|pocket(?:s|ed)?)\s+(?:up to\s+|about\s+|over\s+|around\s+|nearly\s+|almost\s+)?${MONEY}`, 'i')},
	{label: 'turning a sum into more', pattern: new RegExp(String.raw`\b(?:turn(?:s|ed|ing)?|grow(?:s|n|ing)?|grew|flip(?:s|ped|ping)?)\s+(?:my\s+|your\s+|a\s+)?${MONEY}\s+into\b`, 'i')},
	{
		label: 'a percentage return',
		pattern: /\b\d+(?:\.\d+)?\s?%\s*(?:(?:a|per|every|each)\s+)?(?:day|daily|week|weekly|month|monthly|year|yearly|annual(?:ly)?)\s+(?:returns?|yield|interest|profits?|gains?|income|roi|payouts?|rewards?)\b|\b\d+(?:\.\d+)?\s?%\s*(?:apy|apr|roi)\b|(?<!\b(?:i|we)\s+)\b(?:earn(?:s|ing)?|get|gets|make|makes|receive|pays?|paying|yields?|yielding)\s+(?:up to\s+|over\s+|about\s+)?\d+(?:\.\d+)?\s?%(?!\s*(?:off|of|discount|cash\s?back|rebate)\b)|\b(?:returns?|yield|interest|profits?|gains?|roi)\s+of\s+(?:up to\s+|over\s+)?\d+(?:\.\d+)?\s?%/i,
	},
	{label: 'quit your job', pattern: /\bquit your (?:day )?job\b/i},
	{label: 'to the moon', pattern: /\bto the moon\b|\bmoon[\s-]?shot\b/i},
	{
		label: 'a price target',
		pattern: new RegExp(
			String.raw`\bprice target\b|\b(?:will|going to|gonna|could|can|might|may|should|set to|about to)\s+(?:hit|reach|touch|see|go to|top|break|cross|be at)?\s*\$\s?\d|\b(?:heading|headed|on (?:its|the) way)\s+(?:to|for)\s+\$\s?\d|\bto\s+\$\s?\d[\d,.]*\s?k?\s+by\s+(?:the\s+end\s+of\s+)?(?:(?:next|this)\s+)?(?:${MONTHS}|20\d\d|year|month|week|christmas|summer|spring|fall|autumn|winter|q[1-4])\b`,
			'i',
		),
	},
	{label: 'life-changing money', pattern: /\blife[\s-]changing (?:money|wealth|gains|returns|income)\b/i},
	{label: 'a sure thing', pattern: /\bsure[\s-](?:thing|fire|bet|win)\b/i},
	{label: 'a "cannot lose" promise', pattern: /\b(?:can(?:no|['’])t|can not|cannot|won['’]?t|will not) (?:possibly )?lose\b(?!\s+(?:your|the|access|it|them|track|sight)\b)/i},
	{label: 'a safety promise', pattern: /\b100\s?%\s+(?:safe|secure|sure|legit|risk[\s-]?free|protected)\b|\bsafe (?:investments?|returns|yields?|profits?|gains|income)\b/i, unlessDenied: true},
	{label: 'steady profits', pattern: /\bprofits? every (?:single )?(?:day|week|month)\b|\b(?:daily|weekly|monthly) profits?\b/i},
	{label: 'a buy call', pattern: /\bbuy (?:now|before it|while it)\b|\bape (?:in|into)\b|\bload up on\b|\bget in (?:early|now|before)\b/i},
	{
		label: 'a sign-up or deposit bonus',
		pattern: /\b(?:sign[\s-]?up|welcome|deposit|referral|joining|new[\s-]user|first[\s-]trade|trading|registration|free|matched?)\s+bonus(?:es)?\b|\bbonus(?:es)?\s+(?:when|if|for)\s+(?:you\s+)?(?:sign|join|deposit|trade|register|refer|invite)|\b(?:get|claim|grab|unlock|receive)\s+(?:a\s+|an\s+|your\s+|the\s+|up\s+to\s+)?(?:[$€£¥₹]\s?\d[\d,.]*k?\s+)?bonus\b|[$€£¥₹]\s?\d[\d,.]*k?\s+bonus\b/i,
	},
];

/* ------------------------------------------------------------------ Spanish and Portuguese */

/** Whole words in any script: JavaScript's \b does not treat accented letters as word characters. */
const words = (body: string): RegExp => new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${body})(?![\p{L}\p{N}])`, 'iu');
const NUM = String.raw`\d+(?:[.,]\d+)?\s?%`;
const CASH = String.raw`(?:(?:US|R)?\$|€|£)\s?\d[\d.,]*\s?(?:k|mil)?`;
const AMOUNT = String.raw`\d[\d.,]*\s?(?:k|mil)?\s*(?:d[oó]lares|usd[tc]?|euros?|reales|reais|btc|bitcoins?|eth|sol)`;

export const SPANISH_PORTUGUESE_CLAIMS: readonly ClaimRule[] = [
	{
		// not "garantía" alone: "2 años de garantía" is a product warranty
		label: 'garantizado / garantido',
		pattern: words(
			String.raw`garantizad[oa]s?|garantid[oa]s?|te\s+garantiz\p{L}*|lhe\s+garant\p{L}*|garantiz(?:o|amos|a|an)\s+(?:que|ganancias|beneficios|resultados|retornos?)|garant(?:o|imos|e)\s+(?:que|lucros?|ganhos?|resultados|retornos?)|garant[ií]a\s+de\s+(?:ganancias?|beneficios?|retornos?|rentabilidad|lucros?|ganhos?)`,
		),
	},
	{label: 'sin riesgo / sem risco', pattern: words(String.raw`sin\s+riesgos?|cero\s+riesgos?|libre\s+de\s+riesgos?|sem\s+riscos?|risco\s+zero|livre\s+de\s+riscos?`)},
	{
		label: 'hacerse rico / ficar rico',
		pattern: words(String.raw`hacer(?:te|se|nos)?\s+ric[oa]s?|hazte\s+ric[oa]|volver(?:te|se)\s+ric[oa]s?|ficar\s+ric[oa]s?|fique\s+ric[oa]s?|ficar\s+milion[aá]ri[oa]s?|enriquecer(?:te|se)?\s+(?:r[aá]pido|f[aá]cil)|dinero\s+(?:f[aá]cil|r[aá]pido)|dinheiro\s+(?:f[aá]cil|r[aá]pido)`),
	},
	{label: 'ingresos pasivos / renda passiva', pattern: words(String.raw`ingresos?\s+pasivos?|renda\s+passiva|rendimentos?\s+passivos?`)},
	{
		label: 'duplica tu dinero / dobre seu dinheiro',
		pattern: words(String.raw`(?:duplica|duplicar|triplica|triplicar)\s+tu\s+(?:dinero|inversi[oó]n|capital|cripto)|(?:dobre|dobrar|duplique|duplicar|triplique|triplicar)\s+(?:o\s+)?seu\s+(?:dinheiro|investimento|capital|cripto)`),
	},
	{label: 'libertad financiera / liberdade financeira', pattern: words(String.raw`libertad\s+financiera|liberdade\s+financeira`)},
	{
		label: 'an earnings figure (es/pt)',
		// "ganar 500 dólares", "gana $500", "ganancias de 500 USD", "ganhe R$ 500"; not "ganar una comisión"
		pattern: words(String.raw`gan\p{L}*\s+(?:de\s+)?(?:hasta\s+|m[aá]s\s+de\s+)?(?:${CASH}|${AMOUNT})|ganh\p{L}*\s+(?:de\s+)?(?:at[eé]\s+|mais\s+de\s+)?(?:${CASH}|${AMOUNT})`),
	},
	{
		label: 'gana dinero rápido / ganhe dinheiro rápido',
		pattern: words(String.raw`(?:gana|ganar|haz|hacer)\s+dinero\s+(?:r[aá]pido|f[aá]cil|desde\s+casa|sin\s+hacer\s+nada|mientras\s+duermes)|(?:ganhe|ganhar|fa[cç]a|fazer)\s+dinheiro\s+(?:r[aá]pido|f[aá]cil|em\s+casa|sem\s+fazer\s+nada|enquanto\s+dorme)`),
	},
	{
		label: 'a percentage return (es/pt)',
		pattern: words(
			String.raw`${NUM}\s*(?:de\s+)?(?:rentabilidad|rendimientos?|retornos?|ganancias?|inter[eé]s|beneficios?|rentabilidade|lucros?|ganhos?|juros)|${NUM}\s+(?:al|por|ao|a)\s+(?:d[ií]a|semana|mes|m[eê]s|a[nñ]o|ano)|(?:rentabilidad|rendimientos?|retornos?|ganancias?|beneficios?|rentabilidade|lucros?|ganhos?)\s+(?:del?\s+|de\s+)?${NUM}`,
		),
	},
	{label: 'deja tu trabajo / largue seu emprego', pattern: words(String.raw`(?:deja|dejar|renuncia\s+a|renunciar\s+a)\s+tu\s+(?:trabajo|empleo)|(?:largue|largar|deixe|deixar|saia\s+do|sair\s+do)\s+(?:o\s+)?(?:seu\s+)?emprego`)},
	{label: 'hasta la luna / até a lua', pattern: words(String.raw`hasta\s+la\s+luna|rumbo\s+a\s+la\s+luna|at[eé]\s+a\s+lua|rumo\s+[aà]\s+lua|para\s+a\s+lua`)},
	{
		label: 'a price target (es/pt)',
		pattern: words(String.raw`precio\s+objetivo|pre[cç]o[\s-]alvo|(?:llegar[aá]|va\s+a\s+llegar|alcanzar[aá]|vai\s+chegar|chegar[aá]|vai\s+bater|alcan[cç]ar[aá])\s+(?:a\s+|em\s+)?(?:los\s+|os\s+)?(?:US)?\$\s?\d`),
	},
	{label: 'apuesta segura / aposta certa', pattern: words(String.raw`apuesta\s+segura|cosa\s+segura|aposta\s+(?:certa|segura)|coisa\s+certa`)},
	{
		label: 'no puedes perder / não tem como perder',
		pattern: words(String.raw`no\s+(?:puedes|pod[eé]s|podemos|se\s+puede)\s+perder(?!\s+(?:tu|tus|la|el|los|las|acceso|de\s+vista)(?![\p{L}\p{N}]))|(?:n[aã]o\s+(?:tem\s+como|h[aá]\s+como|pode|d[aá]\s+para)|imposs[ií]vel)\s+perder(?!\s+(?:sua|seu|suas|seus|a|o|as|os|acesso|de\s+vista)(?![\p{L}\p{N}]))`),
	},
	{
		label: 'a safety promise (es/pt)',
		pattern: words(String.raw`100\s?%\s+(?:segur[oa]s?|garantizad[oa]s?|garantid[oa]s?|confiables?|confi[aá]ve(?:l|is)|protegid[oa]s?|leg[ií]tim[oa]s?)|inversi[oó]n(?:es)?\s+segura?s?|investimentos?\s+seguros?`),
		unlessDenied: true,
	},
	{label: 'ganancias diarias / lucro todo dia', pattern: words(String.raw`ganancias\s+(?:diarias|semanales|mensuales)|ganancias\s+todos\s+los\s+(?:d[ií]as|meses)|lucros?\s+(?:di[aá]rios?|semanais|mensais)|lucro\s+todo\s+(?:dia|m[eê]s)`)},
	{label: 'compra ya / compre já', pattern: words(String.raw`compra\s+(?:ya|ahora|antes\s+de\s+que)|compre\s+(?:j[aá]|agora|antes\s+que)|entra\s+(?:ya|ahora)\s+antes|entre\s+(?:j[aá]|agora)\s+antes`)},
	{label: 'bono de bienvenida / bônus de cadastro', pattern: words(String.raw`bono\s+de\s+(?:bienvenida|registro|dep[oó]sito)|b[oô]nus\s+de\s+(?:boas[\s-]vindas|cadastro|dep[oó]sito)`)},
];

export const INCOME_CLAIMS: readonly ClaimRule[] = [...ENGLISH_CLAIMS, ...SPANISH_PORTUGUESE_CLAIMS];

/** Languages these rules were written for; text in any other language is checked with them too, but only partly covered. */
export const COVERED_LANGUAGES = ['en', 'es', 'pt'] as const;

/** Words that deny the claim that follows them in the same sentence, in English, Spanish and Portuguese. */
const DENIAL = new RegExp(
	String.raw`(?<![\p{L}\p{N}])(?:no|not|never|don['’]?t|do not|doesn['’]?t|does not|cannot|can['’]?t|won['’]?t|will not|without|nobody|no one|neither|nor|nunca|jam[aá]s|ning[uú]n[oa]?|nadie|sin|n[aã]o|nenhum[a]?|ningu[eé]m|sem|jamais)(?![\p{L}\p{N}])`,
	'iu',
);

const sentenceBefore = (text: string, index: number): string => {
	const start = Math.max(...['.', '!', '?', '\n', '¡', '¿'].map((c) => text.lastIndexOf(c, index - 1))) + 1;
	return text.slice(start, index);
};

/** Every claim in `text`, one per rule (the first match of each). */
export const findClaims = (text: string, rules: readonly ClaimRule[] = INCOME_CLAIMS): ClaimHit[] => {
	const hits: ClaimHit[] = [];
	const normalized = text.normalize('NFC');
	for (const rule of rules) {
		const flags = rule.pattern.flags.includes('g') ? rule.pattern.flags : `${rule.pattern.flags}g`;
		for (const match of normalized.matchAll(new RegExp(rule.pattern.source, flags))) {
			if (rule.unlessDenied && DENIAL.test(sentenceBefore(normalized, match.index))) continue;
			hits.push({label: rule.label, match: match[0], index: match.index});
			break;
		}
	}
	return hits;
};
