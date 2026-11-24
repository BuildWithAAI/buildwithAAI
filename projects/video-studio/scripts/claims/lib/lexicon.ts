/**
 * Lexicons for the claim gate and the dubbing validator, per language. Pure data plus tiny builders.
 *
 *  - FACTUAL: what makes a sentence "look factual" (it then needs a [src:id]): numbers in words, percent and currency
 *    words, dates, superlatives (first / largest / only / most), and attributions ("according to"). Digits, % and
 *    currency symbols are universal (see factual.ts). Attributions can never be waived.
 *  - ORGS: named organisations whose mention makes a sentence factual (regulators, courts, analytics and security
 *    firms, exchanges and platforms, AI companies, newsrooms). Case-sensitive, Latin script (dubbing keeps them as is).
 *  - INCOME: income, return and "financial advice" framings (owner's global must-not-say list), with negation handling.
 *  - DISCLOSURE: spoken disclosure phrases by relationship (affiliate/referral, own product, sponsor).
 *  - FICTION: words that tell the viewer a story is fictional (the disclaimer card must contain one).
 *
 * Non-English entries are machine-made (2026-11-24) and need a native speaker's review like every translation; the
 * Japanese lexicon is partial (Japanese voice is blocked until a real G2P is verified, CLAUDE.md).
 */
import type {Lang} from '../../../src/episode/types.ts';
import {escapeRe, wordRe} from './text.ts';

/**
 * Unspaced scripts (zh, ja) match substrings; spaced scripts use Unicode word boundaries. Sources are NFKC-normalized,
 * like the text they run on (text.ts clean()), so a precomposed Devanagari nukta letter can never miss.
 */
const z = (src: string): RegExp => new RegExp(src.normalize('NFKC'), 'u');
const w = (src: string): RegExp => wordRe(src.normalize('NFKC'));

// ---------------------------------------------------------------------------------------------------------------------
// Factual signals
// ---------------------------------------------------------------------------------------------------------------------

export type FactualLex = {
	/** Contextual superlatives ("the largest", "the first to", "most tokens"); waivable. */
	superlative: RegExp[];
	/** "according to", "reportedly", "a study found": attributions to real evidence; NEVER waivable. */
	attribution: RegExp[];
	/** Numbers and proportions in words ("ten thousand", "half of", "one in a hundred"). */
	scale: RegExp[];
	/** Percent in words. */
	percent: RegExp[];
	/** Currency in words. */
	currency: RegExp[];
	/** Dates (month names; case-sensitive where the word is also a verb). */
	date: RegExp[];
};

/** Number words 1-20, tens and hundreds/thousands, per language: any of them in "N in M" makes a statistic. */
const NUMW = {
	en: `one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|a hundred|hundred|a thousand|thousand|a million|million`,
	es: `un[oa]?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciséis|diecisiete|dieciocho|diecinueve|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|mil|un millón`,
	pt: `um|uma|dois|duas|três|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|catorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|cem|mil|um milhão`,
	it: `uno|una|un|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|undici|dodici|tredici|quattordici|quindici|sedici|diciassette|diciotto|diciannove|venti|trenta|quaranta|cinquanta|sessanta|settanta|ottanta|novanta|cento|mille|un milione`,
};

const EN: FactualLex = {
	superlative: [
		w(`largest|biggest|highest|lowest|fastest|slowest|deadliest|costliest|richest|wealthiest|record[- ](?:high|low|breaking|setting|number|amount|year|month|day|week)|all[- ]time (?:high|low|record)|on record|ever recorded|unprecedented|never before`),
		w(`the (?:most|least)`),
		w(`(?<!(?:at|the) )most (?!likely|recently|importantly|probably|definitely|certainly|surely|often|times)(?:of (?:the|them|these|those|all|their|its|our|your|us)|people|(?:[a-z]+ ){0,2}[a-z]+s(?![a-z]))`),
		w(`first[- ]ever|(?:world|industry|country|nation|market|chain|crypto|internet)(?:'s|s') first|(?:was|were|is|are|became|becomes|become|be|been) (?:the |a )?(?:very )?first(?! (?:to (?:know|hear|see|watch|get|comment|find out)|time|thing|step))|first (?:in history|of its kind|on record)`),
		w(`(?:the|its|their|our|his|her) only (?!(?:thing|things|way|ways|time|times|one|ones|person|people|question|problem|rule|reason|catch|difference)(?![\\p{L}]))[\\p{L}][\\p{L}'-]*`),
		w(`only (?:\\d|one in|one out of|a (?:few|handful|fraction|tiny|small)|about|around|roughly)`),
	],
	attribution: [
		w(`according to|as reported by|reportedly|allegedly|studies (?:show|suggest|found|find)`),
		w(`(?:a|one|the|this|that|new|recent) (?:study|report|survey|analysis|investigation|paper|filing|lawsuit|complaint|indictment) (?:by|from|found|finds|shows|showed|says|said|claims|claimed|alleges|alleged|estimated|estimates)`),
		w(`(?:data|research|analysis|evidence|records) (?:shows?|showed|suggests?|found)`),
		w(`(?:researchers|analysts|investigators|regulators|prosecutors|experts|authorities|officials) (?:say|said|found|estimate|estimated|allege|alleged|claim|claimed|reported|report|believe)`),
	],
	scale: [
		w(`hundreds?|thousands?|millions?|billions?|trillions?|dozens?`),
		w(`half of|a third of|a quarter of|two[- ]thirds|three[- ]quarters|(?:${NUMW.en}|\\d+) (?:in|out of) (?:every )?(?:${NUMW.en}|\\d+)`),
	],
	percent: [w(`per ?cent|percentage points?`)],
	currency: [w(`dollars?|usd|usdc|usdt|euros?|bucks`)],
	date: [
		/(?<![\p{L}])(?:January|February|March|April|June|July|August|September|October|November|December)(?![\p{L}])/u,
		/(?<![\p{L}])May(?= \d)|(?<=(?:[Ii]n|[Ss]ince|[Uu]ntil|[Bb]y|[Ll]ast|[Ee]arly|[Ll]ate|[Mm]id|[Oo]f) )May(?![\p{L}])/u,
		/(?<![\p{L}])(?:Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.? \d/u,
	],
};

const ES: FactualLex = {
	superlative: [
		w(`récord|sin precedentes|nunca antes|por primera vez en la historia`),
		w(`(?:el|la|los|las) (?:más|menos) [\\p{L}]+`),
		w(`(?:el|la|los|las) (?:mayor|mayores|menor|menores)`),
		w(`(?:fue|es|era|fueron|son|ser|sería) (?:el|la|los|las) primer[oa]?s?(?! vez)`),
		w(`primer[oa]? de su tipo|primer[oa]? en la historia`),
		w(`(?:el|la|los|las) únic[oa]s? (?!(?:vez|forma|manera|cosa|modo|razón)(?![\\p{L}]))[\\p{L}]+`),
		w(`(?:solo|sólo|apenas) (?:\\d|un[oa]? de cada|unos pocos|unas pocas|una fracción)`),
		w(`la mayoría de|la mayor parte de`),
	],
	attribution: [
		w(`según|de acuerdo con|supuestamente|presuntamente`),
		w(`(?:un|el|este|ese|un nuevo|el nuevo) (?:estudio|informe|análisis|reporte|investigación|demanda) (?:de|del|encontró|muestra|mostró|dice|afirma|estima|estimó)`),
		w(`(?:los )?(?:datos|estudios|investigadores|analistas|expertos|reguladores|fiscales|autoridades) (?:muestran|mostraron|indican|dicen|estiman|estimaron|encontraron|afirman|alegan)`),
	],
	scale: [
		w(`mil|miles|millón|millones|billón|billones|cientos|centenares|docenas?|decenas`),
		w(`la mitad de|un tercio de|un cuarto de|(?:${NUMW.es}|\\d+) de cada (?:${NUMW.es}|\\d+)`),
	],
	percent: [w(`por ?ciento|puntos porcentuales`)],
	currency: [w(`dólar|dólares|euros?|usd`)],
	date: [w(`enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre`)],
};

const PT: FactualLex = {
	superlative: [
		w(`recorde|sem precedentes|nunca antes|pela primeira vez na história`),
		w(`(?:o|a|os|as) (?:mais|menos) [\\p{L}]+`),
		w(`(?:o|a|os|as) (?:maior|maiores|menor|menores)`),
		w(`(?:foi|é|era|foram|são|ser|seria) (?:o|a|os|as) primeir[oa]s?(?! vez)`),
		w(`primeir[oa] do tipo|primeir[oa] da história`),
		w(`(?:o|a|os|as) únic[oa]s? (?!(?:vez|forma|maneira|coisa|jeito|razão)(?![\\p{L}]))[\\p{L}]+`),
		w(`(?:só|somente|apenas) (?:\\d|um[a]? em cada|alguns|algumas|uma fração)`),
		w(`a maioria (?:de|d[oa]s?)|a maior parte (?:de|d[oa]s?)`),
	],
	attribution: [
		w(`de acordo com|segundo (?:o|a|os|as|um|uma)|conforme (?:o|a|os|as)|supostamente|alegadamente`),
		w(`(?:um|o|uma|a|este|esse|um novo|o novo) (?:estudo|relatório|análise|pesquisa|processo|investigação) (?:de|da|do|encontrou|mostra|mostrou|diz|afirma|estima|estimou)`),
		w(`(?:os )?(?:dados|estudos|pesquisadores|analistas|especialistas|investigadores|reguladores|promotores|autoridades) (?:mostram|mostraram|indicam|dizem|estimam|estimaram|encontraram|afirmam|alegam)`),
	],
	scale: [
		w(`mil|milhares|milhão|milhões|bilhão|bilhões|trilhão|trilhões|centenas|dezenas|dúzias?`),
		w(`metade d[oa]s?|um terço d[oa]s?|(?:${NUMW.pt}|\\d+) (?:em|de) cada (?:${NUMW.pt}|\\d+)`),
	],
	percent: [w(`por ?cento|pontos percentuais`)],
	currency: [w(`dólar|dólares|euros?|reais|usd`)],
	date: [w(`janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro`)],
};

const IT: FactualLex = {
	superlative: [
		w(`record|senza precedenti|mai prima|per la prima volta nella storia`),
		w(`(?:il|lo|la|i|gli|le|l') ?(?:più|meno) [\\p{L}]+`),
		w(`(?:il|la|i|le) (?:maggiore|maggiori|minore|minori)`),
		w(`(?:è|fu|era|sono|furono|essere|sarebbe) (?:stat[oaie] )?(?:il|lo|la|i|gli|le|l') ?prim[oaie](?! volta)`),
		w(`prim[oa] nel suo genere|prim[oa] nella storia`),
		w(`(?:l'|il|lo|la|gli|le) ?unic[oaie] (?!(?:volta|modo|cosa|maniera|ragione)(?![\\p{L}]))[\\p{L}]+`),
		w(`solo (?:\\d|uno su|una su|pochi|poche|una frazione)`),
		w(`la maggior parte (?:di|del|dei|degli|della|delle|dello)|la maggioranza (?:di|del|dei|degli|della|delle|dello)`),
	],
	attribution: [
		w(`secondo (?:il|lo|la|i|gli|le|l'|un|una|uno|quanto)|stando a|presumibilmente|presuntamente|a quanto pare`),
		w(`(?:uno|lo|un|il|questo|un nuovo) (?:studio|rapporto|report|analisi|sondaggio|indagine) (?:di|del|della|ha trovato|mostra|ha mostrato|dice|afferma|stima)`),
		w(`(?:i )?(?:dati|studi|ricercatori|analisti|esperti|investigatori|regolatori|procuratori|autorità) (?:mostrano|indicano|dicono|stimano|hanno trovato|affermano|sostengono)`),
	],
	scale: [
		w(`mila|mille|milione|milioni|miliardo|miliardi|centinaia|decine|dozzin[ae]`),
		w(`la metà (?:di|del|dei|degli|della|delle)|un terzo (?:di|del|dei|degli|della|delle)|un quarto (?:di|del|dei|degli|della|delle)|(?:${NUMW.it}|\\d+) su (?:ogni )?(?:${NUMW.it}|\\d+)`),
	],
	percent: [w(`per ?cento|punti percentuali`)],
	currency: [w(`dollar[oi]|euro|usd`)],
	date: [w(`gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre`)],
};

const HI: FactualLex = {
	superlative: [
		w(`सबसे(?! पहले)|रिकॉर्ड|रिकार्ड|अभूतपूर्व|एकमात्र|ज़्यादातर|ज्यादातर|अधिकांश|अधिकतर`),
		w(`इतिहास में पहली बार|(?:दुनिया|इतिहास) (?:का|की|के) पहल[ाीे]`),
		w(`(?:केवल|सिर्फ़|सिर्फ) (?:\\d|एक|कुछ)`),
	],
	attribution: [w(`के अनुसार|के मुताबिक़|के मुताबिक|कथित तौर पर|रिपोर्ट के|अध्ययन|शोधकर्ताओं|विश्लेषकों|जांचकर्ताओं|जाँचकर्ताओं`)],
	scale: [
		w(`हज़ार|हजार|हज़ारों|हजारों|लाख|लाखों|करोड़|करोड|करोड़ों|अरब|खरब|सैकड़ों|मिलियन|बिलियन|दर्जनों`),
		w(`आधे|आधा|आधी|एक तिहाई|में से (?:एक|\\d+)`),
	],
	percent: [w(`प्रतिशत|फ़ीसदी|फीसदी|फ़ीसद|फीसद`)],
	currency: [w(`डॉलर|रुपये|रुपए|यूरो`)],
	date: [w(`जनवरी|फ़रवरी|फरवरी|मार्च|अप्रैल|मई|जून|जुलाई|अगस्त|सितंबर|सितम्बर|अक्टूबर|अक्तूबर|नवंबर|नवम्बर|दिसंबर|दिसम्बर`)],
};

const ZH: FactualLex = {
	superlative: [z(`最(?!后|近|好|初|终|起码)|首个|首次|首家|首位|首款|唯一|创纪录|纪录|史上|前所未有|大多数|大部分|多数`), z(`第一(?!次|步|件|个问题|时间|天)`)],
	attribution: [z(`根据|据(?:报道|统计|估计|悉|称|了解)|报告(?:显示|称|指出)|研究(?:显示|表明|发现)|数据(?:显示|表明)|分析师|研究人员|调查人员|涉嫌`)],
	scale: [z(`(?<!千)万(?!一)|亿|千万(?!别|不要|不能|要)|百万|数千|数百|成千上万|几十万|数十`), z(`一半|三分之一|四分之一|分之[一二三四五六七八九十]|[十百千]个(?:人)?中(?:有|就有)`)],
	percent: [z(`百分之|个百分点`)],
	currency: [z(`美元|美金|人民币|欧元|港元|日元`)],
	date: [z(`[一二三四五六七八九十]{1,2}月|\\d{1,2}\\s*月|\\d{4}\\s*年|[零〇一二三四五六七八九]{4}年`)],
};

const JA: FactualLex = {
	superlative: [z(`最(?!後|近|初|終)|史上|唯一|記録|初めての|初の|大半|ほとんどの`)],
	attribution: [z(`によると|によれば|報告書|調査では|研究では|専門家は`)],
	scale: [z(`万|億|千|数百|数千|半数`)],
	percent: [z(`パーセント`)],
	currency: [z(`ドル|ユーロ|円`)],
	date: [z(`\\d{1,2}\\s*月|\\d{4}\\s*年`)],
};

export const FACTUAL: Record<Lang, FactualLex> = {en: EN, es: ES, 'pt-br': PT, it: IT, hi: HI, zh: ZH, ja: JA};

/** Languages whose lexicons are partial (the report says so). */
export const PARTIAL_LEXICON: ReadonlySet<Lang> = new Set<Lang>(['ja']);
/** Languages whose lexicons are machine-made (every one but English): the report says a native speaker must review them. */
export const MACHINE_LEXICON: ReadonlySet<Lang> = new Set<Lang>(['es', 'pt-br', 'it', 'hi', 'zh', 'ja']);

// ---------------------------------------------------------------------------------------------------------------------
// Named organisations (case-sensitive, Latin script). A mention makes a sentence factual.
// ---------------------------------------------------------------------------------------------------------------------

export const ORGS: readonly string[] = [
	// regulators, law enforcement, courts, governments
	'SEC', 'CFTC', 'FTC', 'FINRA', 'DOJ', 'FBI', 'IRS', 'OFAC', 'FinCEN', 'Treasury', 'Federal Reserve', 'Europol', 'Interpol', 'FCA',
	'ESMA', 'BaFin', 'CONSOB', 'CNMV', 'CVM', 'SEBI', 'RBI', 'MAS', 'ASIC', 'NYDFS', 'Department of Justice',
	'Securities and Exchange Commission', 'Commodity Futures Trading Commission', 'Federal Trade Commission', 'Supreme Court',
	'Congress', 'Senate', 'European Commission', 'IMF', 'World Bank', 'OECD',
	// on-chain analytics, security and research firms
	'Chainalysis', 'Elliptic', 'TRM Labs', 'CertiK', 'PeckShield', 'SlowMist', 'Immunefi', 'Bubblemaps', 'Arkham', 'Nansen', 'Dune',
	'DefiLlama', 'DeFiLlama', 'CoinGecko', 'CoinMarketCap', 'Messari', 'Kaiko', 'Glassnode', 'Solidus Labs', 'Lookonchain', 'ZachXBT',
	'Rekt News', 'rekt.news', 'Scam Sniffer', 'ScamSniffer', 'Blockaid', 'Hacken', 'Halborn', 'OpenZeppelin', 'Trail of Bits', 'Cyvers',
	'Hexagate', 'Sparsity', 'Bitdefender', 'Kaspersky', 'Mandiant', 'CrowdStrike', 'Check Point', 'Sophos', 'ESET', 'Trend Micro',
	'Palo Alto Networks', 'Unit 42', 'Recorded Future', 'Coinpaprika',
	// exchanges, platforms, wallets, protocols, crypto companies
	'Binance', 'Coinbase', 'Kraken', 'OKX', 'Bybit', 'KuCoin', 'Bitget', 'Gate.io', 'HTX', 'Huobi', 'Crypto.com', 'Robinhood', 'FTX',
	'Bitfinex', 'Upbit', 'Pump.fun', 'PumpSwap', 'Raydium', 'Uniswap', 'Jupiter', 'Jito', 'Phantom', 'MetaMask', 'Ledger', 'Trezor',
	'Tether', 'Circle', 'Solana Foundation', 'Ethereum Foundation', 'Polymarket', 'Hyperliquid', 'Lido', 'Aave', 'MakerDAO', 'Wormhole',
	'LayerZero', 'daos.fun', 'Virtuals', 'ai16z', 'Eliza Labs', 'ElizaOS', 'Truth Terminal', 'Numerai', 'a16z', 'Andreessen Horowitz',
	// AI companies
	'OpenAI', 'Anthropic', 'DeepMind', 'Google', 'Microsoft', 'Nvidia', 'NVIDIA', 'xAI', 'Mistral', 'Hugging Face', 'Perplexity', 'Apple',
	'Amazon', 'Meta',
	// newsrooms and research
	'Reuters', 'Bloomberg', 'The Block', 'CoinDesk', 'Cointelegraph', 'Decrypt', 'DL News', 'The Defiant', 'Blockworks', 'Wired',
	'Wall Street Journal', 'WSJ', 'New York Times', 'Financial Times', 'Forbes', 'CNBC', 'BBC', 'Axios', 'TechCrunch', 'The Verge',
	'CryptoSlate', 'MIT', 'Stanford', 'Harvard', 'NBER', 'arXiv',
];

/** One case-sensitive regex for every org, longest names first, Latin-script boundaries. */
export const ORG_RE: RegExp = new RegExp(
	`(?<![\\p{Script=Latin}\\p{N}_.])(?:${[...ORGS].sort((a, b) => b.length - a.length).map(escapeRe).join('|')})(?![\\p{Script=Latin}\\p{N}_])`,
	'gu',
);

// ---------------------------------------------------------------------------------------------------------------------
// Income, return and "financial advice" framings (owner's global must-not-say list)
// ---------------------------------------------------------------------------------------------------------------------

export type IncomeRule = {
	id: string;
	label: string;
	re: RegExp;
	/** A negation just before (or, in Hindi/Japanese, just after) the phrase makes it safe: "not financial advice". */
	negatable: boolean;
	level: 'error' | 'warning';
	/** Phrases that look like the rule but describe a scam category ("get-rich-quick scheme"). */
	allow?: RegExp;
};

const rule = (id: string, label: string, re: RegExp, negatable = true, level: 'error' | 'warning' = 'error', allow?: RegExp): IncomeRule => ({id, label, re, negatable, level, allow});

/** "10x" and up ("100x", "1000×", "x100"); a value check in income.ts drops 2x-9x. */
const MULT = `(?<![\\p{L}\\p{N}.,])\\d+(?:[.,]\\d+)?\\s?[x×](?![\\p{L}\\p{N}])|(?<![\\p{L}\\p{N}])[x×]\\s?\\d{2,}(?![\\p{L}\\p{N}])`;

/** Zoo presented as a human financial expert (YouTube AI-persona policy; research §4.9). Negations pass ("I'm not a financial adviser"). */
const PERSONA: Record<Lang, RegExp> = {
	en: w(`(?:your|a|an|the|my|as) (?:certified |licensed |professional |personal )?(?:financial|investment|crypto|trading) (?:adviser|advisor|expert|planner|consultant|professional)|(?:i am|i'm|as) (?:a |an |your )?(?:financial|investment) (?:adviser|advisor|expert|planner|professional)`),
	es: w(`(?:tu|su|un|una|el|la|como) (?:asesor|asesora|experto|experta|consultor|consultora|planificador) (?:financier[oa]|de inversiones|en inversiones|en criptomonedas)|asesor(?:a)? financier[oa]|experto financiero`),
	'pt-br': w(`(?:seu|sua|um|uma|o|a|como) (?:consultor|consultora|assessor|assessora|especialista|planejador) (?:financeir[oa]|de investimentos|em investimentos|em cripto)|consultor(?:a)? financeir[oa]|assessor(?:a)? financeir[oa]`),
	it: w(`(?:il tuo|la tua|un|una|come) (?:consulente|esperto|esperta|consulente finanziario) (?:finanziari[oa]|di investimenti|in investimenti)|consulente finanziari[oa]|esperto finanziario`),
	hi: w(`वित्तीय सलाहकार|निवेश सलाहकार|फ़ाइनेंशियल एडवाइज़र|फाइनेंशियल एडवाइजर|वित्तीय विशेषज्ञ`),
	zh: z(`理财顾问|投资顾问|财务顾问|金融顾问|理财专家|投资专家`),
	ja: z(`ファイナンシャルアドバイザー|投資アドバイザー|投資顧問`),
};

export const INCOME: Record<Lang, IncomeRule[]> = {
	en: [
		rule('guaranteed', 'a guarantee ("guaranteed")', w(`guarantee(?:d|s)?`)),
		rule('risk-free', '"risk-free" / "no risk"', w(`risk[- ]?free|riskless|(?:no|zero)[- ]risk(?![- ]?free)|without (?:any )?risk`)),
		rule('get-rich', '"get rich"', w(`gets? rich|getting rich|got rich|make (?:you|them|us|me) rich|become (?:a )?(?:millionaire|rich)|generational wealth`), true, 'error', w(`get[- ]rich[- ]quick (?:schemes?|scams?|pitch(?:es)?|promises?|traps?)`)),
		rule('passive-income', '"passive income"', w(`passive income|(?:income|money) while you sleep`)),
		rule('cant-lose', '"can\'t lose"', w(`can not lose|can not go wrong|no way (?:to|you can) lose|impossible to lose`), false),
		rule('sure-thing', '"a sure thing"', w(`sure (?:thing|bet|win)|guaranteed win(?:ner)?s?|easy win`)),
		rule('multiplier', 'a "100x"-style return multiple', new RegExp(MULT, 'iu')),
		rule('financial-advice', 'a "financial advice" framing', w(`(?:financial|investment|investing|trading) advice`)),
		rule('buy-call', 'a buy call', w(`(?:you should|you need to|you have to|you must|time to|start) (?:buy|ape|invest|load up)|(?:buy|ape in|ape into|load up)(?: on)? (?:now|today|before it|while you can)|do not miss (?:out|this)|get in (?:now|early|before)`)),
		rule('price-prediction', 'a price prediction', w(`price targets?|(?:will|is going to|gonna|could|should) (?:hit|reach|go to|be worth|pump to|moon|explode|10x|100x|1000x)|next (?:100x|1000x|gem)`)),
		rule('easy-money', 'an easy-money promise', w(`easy money|free money|double your (?:money|investment|crypto)|triple your (?:money|investment)|make money fast|earn up to|quick profits?`)),
		rule('hype', 'hype that implies returns', w(`to the moon|moonshot|lambo|financial freedom|quit your (?:day )?job|life[- ]changing (?:money|wealth|gains)|wagmi`), true, 'warning'),
	],
	es: [
		rule('guaranteed', 'una garantía ("garantizado")', w(`garantizad[oa]s?|garantías?|garantias?|te lo garantizo|garantizamos`)),
		rule('risk-free', '"sin riesgo"', w(`sin riesgos?|libre de riesgos?|cero riesgos?|riesgo cero`)),
		rule('get-rich', '"hacerse rico"', w(`hacerte rico|hacerse rico|volverte rico|enriquecerte|hazte rico|hacerte millonario|volverte millonario`), true, 'error', w(`esquemas? para hacerse rico rápido`)),
		rule('passive-income', '"ingresos pasivos"', w(`ingresos? pasivos?|dinero mientras duermes`)),
		rule('cant-lose', '"no puedes perder"', w(`no puedes perder|no se puede perder|imposible perder|apuesta segura|ganancia segura`), false),
		rule('multiplier', 'un múltiplo tipo "100x"', new RegExp(`${MULT}|(?<![\\p{L}\\p{N}.,])\\d+\\s?veces (?:tu|su|el) (?:dinero|inversión)`, 'iu')),
		rule('financial-advice', 'un "consejo financiero"', w(`consejos? financieros?|asesoría financiera|asesoramiento financiero|consejos? de inversión|recomendación de inversión`)),
		rule('buy-call', 'una llamada a comprar', w(`compra ahora|compren ahora|deberías comprar|tienes que comprar|no te lo pierdas|entra ahora`)),
		rule('price-prediction', 'una predicción de precio', w(`precio objetivo|va a (?:subir|llegar|explotar)|llegará a|subirá a`)),
		rule('easy-money', 'una promesa de dinero fácil', w(`dinero fácil|dinero gratis|duplica tu dinero|duplicar tu dinero|ganancias rápidas`)),
		// added 2026-11-24 (VCD fix): the review's Spanish promises that passed
		rule('sure-money', 'dinero o ganancias seguras', w(`dinero seguro|ganancias? (?:segura|seguras|asegurada|aseguradas)|rentabilidad (?:asegurada|segura|garantizada)|beneficios? (?:seguros?|asegurados?)`)),
		rule('multiply-money', 'multiplicar tu dinero', w(`multiplica(?:r|s|rá|n)? (?:tu|su|el|vuestro) (?:dinero|inversión|capital)`)),
		rule('no-way-to-lose', '"no hay forma de perder"', w(`no hay (?:forma|manera|modo) de perder|nadie (?:puede )?pierde|todos ganan`), false),
		rule('earn-up-to', '"ganan hasta"', w(`gan(?:a|an|aron|ó|arás|arán|ar) hasta`)),
		rule('price-prediction-2', 'una predicción de precio', w(`se va a disparar|va a dispararse|se disparará|valdrá|va a valer|subirá|explotará|va a hacer (?:un )?\\d+x`)),
		rule('six-figures', 'cifras de seis o siete dígitos', w(`cifras de (?:seis|siete|\\d) dígitos|(?:seis|siete) cifras`)),
		rule('hype', 'exageración que sugiere ganancias', w(`a la luna|libertad financiera|deja tu trabajo|lambo`), true, 'warning'),
	],
	'pt-br': [
		rule('guaranteed', 'uma garantia ("garantido")', w(`garantid[oa]s?|garantias?|eu garanto|garantimos`)),
		rule('risk-free', '"sem risco"', w(`sem riscos?|livre de riscos?|risco zero|zero risco`)),
		rule('get-rich', '"ficar rico"', w(`ficar rico|fique rico|enriquecer|ficar milionário|fique milionário`), true, 'error', w(`esquemas? (?:de|para) enriquecer rápido`)),
		rule('passive-income', '"renda passiva"', w(`renda passiva|dinheiro enquanto dorme`)),
		rule('cant-lose', '"não tem como perder"', w(`não tem como perder|não dá para perder|não dá pra perder|impossível perder|aposta certa|lucro certo`), false),
		rule('multiplier', 'um múltiplo tipo "100x"', new RegExp(`${MULT}|(?<![\\p{L}\\p{N}.,])\\d+\\s?vezes (?:o seu|seu|o) (?:dinheiro|investimento)`, 'iu')),
		rule('financial-advice', 'um "conselho financeiro"', w(`conselhos? financeiros?|aconselhamento financeiro|recomendação de investimento|consultoria financeira`)),
		rule('buy-call', 'um chamado para comprar', w(`compre agora|comprem agora|você deveria comprar|você tem que comprar|não perca|entre agora`)),
		rule('price-prediction', 'uma previsão de preço', w(`preço-alvo|preço alvo|vai (?:subir|chegar|explodir)|vai valer`)),
		rule('easy-money', 'uma promessa de dinheiro fácil', w(`dinheiro fácil|dinheiro grátis|dobre seu dinheiro|dobrar seu dinheiro|lucro rápido`)),
		// added 2026-11-24 (VCD fix): the review's Portuguese promises that passed
		rule('extra-income', '"renda extra" / dinheiro garantido', w(`renda extra|ganhar dinheiro (?:fácil|garantido|rápido)|dinheiro garantido|lucro (?:garantido|certo|seguro)`)),
		rule('multiply-money', 'multiplicar seu dinheiro', w(`multiplic(?:ar|a|ou|ará|am) (?:o )?(?:seu|teu|o) (?:dinheiro|investimento|capital)`)),
		rule('no-way-to-lose', '"não tem como perder"', w(`não (?:tem|há) (?:jeito|como|forma) de perder|ninguém perde|todo mundo ganha`), false),
		rule('earn-up-to', '"ganham até"', w(`ganh(?:a|am|aram|ou|ará|arão|ar) até`)),
		rule('price-prediction-2', 'uma previsão de preço', w(`vai (?:disparar|bombar|decolar|explodir|valer)|vai fazer (?:um )?\\d+x|vai subir`)),
		rule('six-figures', 'ganhos de seis ou sete dígitos', w(`(?:seis|sete|\\d) dígitos|(?:seis|sete) cifras`)),
		rule('hype', 'exagero que sugere ganhos', w(`para a lua|pra lua|liberdade financeira|largue seu emprego|lambo`), true, 'warning'),
	],
	it: [
		rule('guaranteed', 'una garanzia ("garantito")', w(`garantit[oaie]|garanzi[ae]|te lo garantisco|garantiamo`)),
		rule('risk-free', '"senza rischi"', w(`senza rischi?o?|privo di rischi|rischio zero|zero rischi`)),
		rule('get-rich', '"diventare ricco"', w(`diventare ricc[oh]i?|diventa ricco|arricchirti|arricchirsi|diventare milionario`), true, 'error', w(`schemi? per arricchirsi (?:in fretta|velocemente)`)),
		rule('passive-income', '"reddito passivo"', w(`reddito passivo|rendita passiva|soldi mentre dormi`)),
		rule('cant-lose', '"non puoi perdere"', w(`non puoi perdere|impossibile perdere|scommessa sicura|guadagno sicuro`), false),
		rule('multiplier', 'un multiplo tipo "100x"', new RegExp(`${MULT}|(?<![\\p{L}\\p{N}.,])\\d+\\s?volte (?:i tuoi|il tuo) (?:soldi|investimento)`, 'iu')),
		rule('financial-advice', 'un "consiglio finanziario"', w(`consigli?o? finanziari?o?|consulenza finanziaria|consigli?o? di investimento|raccomandazione di investimento`)),
		rule('buy-call', 'un invito a comprare', w(`compra ora|comprate ora|dovresti comprare|devi comprare|non perdere(?:tel[oa])?|entra ora`)),
		rule('price-prediction', 'una previsione di prezzo', w(`prezzo obiettivo|target di prezzo|(?:salirà|arriverà|esploderà) a`)),
		rule('easy-money', 'una promessa di soldi facili', w(`soldi facili|denaro facile|soldi gratis|raddoppia i tuoi soldi|guadagni rapidi`)),
		rule('hype', 'esagerazione che suggerisce guadagni', w(`sulla luna|alla luna|libertà finanziaria|lascia il tuo lavoro|lambo`), true, 'warning'),
	],
	hi: [
		rule('guaranteed', 'गारंटी ("guaranteed")', w(`गारंटी|गारंटीड|पक्का मुनाफ़ा|पक्का मुनाफा`)),
		rule('risk-free', '"बिना जोखिम"', w(`बिना जोखिम|जोखिम-मुक्त|जोखिम मुक्त|ज़ीरो रिस्क|जीरो रिस्क|रिस्क-फ़्री|रिस्क फ्री`)),
		rule('get-rich', '"अमीर बनें"', w(`अमीर बन(?:ें|ो|ना| जाओगे| जाएंगे| जाएँगे| सकते)|अमीर हो जा(?:ओगे|एंगे|एँगे)|करोड़पति बन|लखपति बन`)),
		rule('passive-income', '"पैसिव इनकम"', w(`पैसिव इनकम|निष्क्रिय आय|सोते हुए कमाई`)),
		rule('cant-lose', '"नुकसान नहीं हो सकता"', w(`नुकसान नहीं हो सकता|घाटा नहीं हो सकता|हार नहीं सकते|पक्की जीत`), false),
		rule('multiplier', '"100x" जैसा रिटर्न', new RegExp(`${MULT}|(?<![\\p{L}\\p{N}.,])\\d+\\s?गुना`, 'iu')),
		rule('financial-advice', '"वित्तीय सलाह"', w(`वित्तीय सलाह|निवेश सलाह|निवेश की सलाह|फ़ाइनेंशियल एडवाइस|फाइनेंशियल एडवाइस`)),
		rule('buy-call', 'खरीदने की अपील', w(`अभी खरीदें|अभी खरीदो|तुरंत खरीदें|ज़रूर खरीदें|जरूर खरीदें|मौका मत चूको|मौका न चूकें`)),
		rule('price-prediction', 'कीमत की भविष्यवाणी', w(`प्राइस टारगेट|कीमत (?:\\S+ )?(?:तक )?पहुंचेगी|कीमत (?:\\S+ )?(?:तक )?पहुँचेगी`)),
		rule('easy-money', 'आसान पैसे का वादा', w(`आसान पैसा|मुफ़्त पैसा|मुफ्त पैसा|पैसा डबल|पैसे दोगुने`)),
		rule('hype', 'मुनाफ़े का इशारा करने वाली अतिशयोक्ति', w(`टू द मून|फ़ाइनेंशियल फ़्रीडम|वित्तीय आज़ादी|नौकरी छोड़ दो`), true, 'warning'),
	],
	zh: [
		rule('guaranteed', '保证收益（"保证"）', z(`保证(?:收益|赚|盈利|回报|利润)|稳赚|保本|包赚|保赚`)),
		rule('risk-free', '"无风险"', z(`无风险|零风险|没有风险|毫无风险`)),
		rule('get-rich', '"发财致富"', z(`发财|致富|暴富|一夜暴富|变成富翁|财富自由`)),
		rule('passive-income', '"被动收入"', z(`被动收入|躺赚|躺着赚钱`)),
		rule('cant-lose', '"稳赚不赔"', z(`稳赚不赔|不会亏|不可能亏|只赚不赔|包赢`), false),
		rule('multiplier', '"百倍币"式回报', new RegExp(`${MULT}|\\d+\\s?倍|[十百千万]倍|翻倍`, 'iu')),
		rule('financial-advice', '"投资建议"', z(`投资建议|理财建议|财务建议|金融建议`)),
		rule('buy-call', '买入号召', z(`现在买入|赶紧买|马上买|立即买入|抄底|上车|别错过|不要错过`)),
		rule('price-prediction', '价格预测', z(`目标价|价格将(?:达到|涨到)|将涨到|会涨到`)),
		rule('easy-money', '轻松赚钱的承诺', z(`轻松赚钱|免费的钱|白送的钱|快速致富`)),
		rule('hype', '暗示收益的炒作', z(`冲上月球|月球|兰博基尼|辞职`), true, 'warning'),
	],
	ja: [
		rule('guaranteed', '保証（"guaranteed"）', z(`保証|確実に儲か|必ず儲か`)),
		rule('risk-free', '"ノーリスク"', z(`ノーリスク|リスクなし|リスクゼロ|無リスク`)),
		rule('get-rich', '"お金持ちになれる"', z(`お金持ちになれる|億り人|一攫千金`)),
		rule('passive-income', '"不労所得"', z(`不労所得|寝ながら稼`)),
		rule('cant-lose', '"負けない"', z(`絶対に負けない|損しない|負けなし`), false),
		rule('multiplier', '"100倍"', new RegExp(`${MULT}|\\d+\\s?倍`, 'iu')),
		rule('financial-advice', '"投資助言"', z(`投資助言|投資アドバイス|金融アドバイス`)),
	],
};

/** Words that negate a phrase that follows them (spaced languages: within 4 words before, same sentence). */
export const NEGATORS: Record<Lang, RegExp> = {
	en: w(`no|not|never|nothing|none|nobody|neither|nor|without|zero|hardly`),
	es: w(`no|nunca|nada|nadie|ni|sin|jamás|tampoco|ningún|ninguna|ninguno`),
	'pt-br': w(`não|nunca|nada|ninguém|nem|sem|jamais|nenhum|nenhuma`),
	it: w(`non|mai|niente|nulla|nessuno|nessuna|né|senza`),
	hi: w(`नहीं|न|मत|बिना|कभी नहीं`),
	zh: z(`不|没|没有|并非|非|不是|不构成|绝不|从不|别|无`),
	ja: z(`ない|ません|ではない|じゃない`),
};
/** Languages whose negation follows the phrase ("वित्तीय सलाह नहीं है"). */
export const NEGATION_AFTER: ReadonlySet<Lang> = new Set<Lang>(['hi', 'ja']);

// ---------------------------------------------------------------------------------------------------------------------
// Spoken disclosures (offers) and fiction disclaimers
// ---------------------------------------------------------------------------------------------------------------------

export type DisclosureKind = 'affiliate' | 'own-product' | 'sponsor';

export const DISCLOSURE: Record<Lang, Record<DisclosureKind, RegExp>> = {
	en: {
		affiliate: w(`affiliate|referral|commission|(?:i|we) (?:may |might |will )?(?:earn|get|receive|make) (?:a )?(?:commission|cut|share|fee|fees|money|paid)|(?:i|we) get paid|paid links?`),
		'own-product': w(`(?:i|we) (?:built|made|created|wrote|designed|sell|own) (?:this|it|that|the|a|my|our)|my own (?:product|project|tool|checklist|course|app|guide)|(?:this|it) is my (?:own )?(?:product|project|tool|checklist|course|app|guide)|our (?:own )?(?:product|project|tool)`),
		sponsor: w(`sponsor(?:ed|ing|s|ship)?|paid (?:partnership|promotion|placement)|(?:they|it) paid (?:me|us)|in (?:paid )?partnership with`),
	},
	es: {
		affiliate: w(`afiliad[oa]s?|enlace de afiliado|referid[oa]s?|comisión|comision|(?:gano|ganamos|recibo|recibimos) (?:una )?(?:comisión|parte)|me pagan|nos pagan`),
		'own-product': w(`(?:lo|la) (?:creé|cree|hice|construí) yo|yo (?:creé|cree|hice|construí)|es mi (?:propio |propia )?(?:producto|proyecto|lista|guía)|mi propi[oa] (?:producto|proyecto|lista|guía)|nuestro (?:propio )?producto`),
		sponsor: w(`patrocinad[oa]s?|patrocinio|colaboración pagada|promoción pagada|publicidad pagada`),
	},
	'pt-br': {
		affiliate: w(`afiliad[oa]s?|link de afiliado|indicação|comissão|comissao|(?:ganho|ganhamos|recebo|recebemos) (?:uma )?(?:comissão|parte)|me pagam|nos pagam`),
		'own-product': w(`eu (?:criei|fiz|construí)|(?:é|e) (?:o |a )?(?:meu|minha) (?:próprio |própria )?(?:produto|projeto|lista|guia)|(?:meu|minha) própri[oa] (?:produto|projeto|lista|guia)|nosso (?:próprio )?produto`),
		sponsor: w(`patrocinad[oa]s?|patrocínio|parceria paga|publicidade paga|publi`),
	},
	it: {
		affiliate: w(`affiliazione|affiliat[oaie]|referral|commissione|(?:guadagno|guadagniamo|ricevo|riceviamo) (?:una )?(?:commissione|parte)|mi pagano|ci pagano`),
		'own-product': w(`l'ho (?:creat[oa]|fatt[oa]|costruit[oa]) io|ho (?:creato|fatto|costruito) (?:io )?(?:questo|questa|il|la|un|una)|(?:è|e) il mio (?:prodotto|progetto)|(?:il mio|la mia) (?:prodotto|progetto|lista|guida)|nostro prodotto`),
		sponsor: w(`sponsorizzat[oaie]|sponsor|collaborazione retribuita|promozione a pagamento|contenuto sponsorizzato`),
	},
	hi: {
		affiliate: w(`एफिलिएट|एफ़िलिएट|रेफरल|रेफ़रल|कमीशन|मुझे पैसे मिलते|हमें पैसे मिलते`),
		'own-product': w(`मैंने (?:इसे |यह |ये )?बनाया|मेरा (?:अपना )?(?:प्रोडक्ट|प्रोजेक्ट|उत्पाद)|मेरी (?:अपनी )?(?:चेकलिस्ट|सूची)|हमारा (?:अपना )?(?:प्रोडक्ट|उत्पाद)`),
		sponsor: w(`प्रायोजित|स्पॉन्सर्ड|स्पॉन्सर|पेड पार्टनरशिप|पेड प्रमोशन|सशुल्क`),
	},
	zh: {
		affiliate: z(`联盟链接|推广链接|返佣|佣金|邀请链接|分成|我会(?:获得|拿到|赚取)`),
		'own-product': z(`我(?:自己)?(?:做|开发|创建|制作|写)的|我的(?:产品|项目|清单)|我们的(?:产品|项目)|自家产品`),
		sponsor: z(`赞助|付费合作|付费推广|广告合作|商业合作`),
	},
	ja: {
		affiliate: z(`アフィリエイト|紹介リンク|手数料|報酬`),
		'own-product': z(`私が作った|自分の(?:製品|プロジェクト)|自作`),
		sponsor: z(`スポンサー|提供|有料プロモーション|PR`),
	},
};

/** Words that say a story is fictional; the fiction disclaimer must contain one. */
export const FICTION: Record<Lang, RegExp> = {
	en: w(`fiction|fictional|fictitious|composite|made[- ]up|not real|dramati[sz]ed|dramati[sz]ation`),
	es: w(`ficción|ficcion|ficticia|ficticio|ficticios|ficticias|compuest[oa]s?|inventad[oa]s?`),
	'pt-br': w(`ficção|ficcao|fictíci[oa]s?|ficticio|compost[oa]s?|inventad[oa]s?`),
	it: w(`finzione|fittizi[oaie]|immaginari[oaie]|inventat[oaie]|di fantasia|compost[oaie]`),
	hi: w(`काल्पनिक|कल्पना|मनगढ़ंत`),
	zh: z(`虚构|杜撰|改编|合成人物|化名`),
	ja: z(`フィクション|架空`),
};

// persona: one rule per language, appended to INCOME so it shares negation and waivers ("I'm not a financial adviser")
for (const lang of Object.keys(INCOME) as Lang[]) INCOME[lang].push(rule('persona', 'Zoo presented as a human financial adviser or expert (YouTube AI-persona policy)', PERSONA[lang]));

// ---------------------------------------------------------------------------------------------------------------------
// Holdings (MiCA Art. 91): an opinion on a named token, or holding one, needs a spoken holdings disclosure
// ---------------------------------------------------------------------------------------------------------------------

/** Saying you hold (or bought) a token. */
export const HOLDING: Partial<Record<Lang, RegExp>> = {
	en: w(`i (?:hold|own|bought|am holding|have been holding|still hold)|i have (?:a bag|some|a position)|my bag|in my (?:wallet|portfolio)|i am (?:long|in)(?: on)?|i aped`),
	es: w(`(?:yo )?(?:tengo|compré|mantengo|tengo una posición en|estoy invertido en)|mi bolsa|en mi (?:cartera|billetera|portafolio)`),
	'pt-br': w(`eu (?:tenho|comprei|mantenho|seguro)|minha bag|na minha (?:carteira|wallet)|estou posicionado`),
	it: w(`(?:io )?(?:possiedo|ho comprato|detengo|ho in portafoglio)|nel mio portafoglio`),
};

/** An opinion on a token's value or direction. */
export const TOKEN_OPINION: Partial<Record<Lang, RegExp>> = {
	en: w(`undervalued|overvalued|underpriced|overpriced|(?:still |too |really )?cheap|a (?:hidden )?gem|is (?:going|about) to (?:pump|run|explode|moon)|will (?:pump|run|explode|moon)|good (?:buy|entry)|bullish on|bearish on`),
	es: w(`infravalorad[oa]|sobrevalorad[oa]|(?:muy |todavía |aún )?barat[oa]|una joya|va a (?:subir|explotar|despegar)|buena (?:compra|entrada)|alcista|bajista`),
	'pt-br': w(`subvalorizad[oa]|sobrevalorizad[oa]|supervalorizad[oa]|(?:muito |ainda )?barat[oa]|uma joia|vai (?:subir|explodir|decolar)|boa (?:compra|entrada)`),
	it: w(`sottovalutat[oa]|sopravvalutat[oa]|(?:ancora |molto )?economic[oa]|una gemma|salirà|esploderà|buon (?:acquisto|ingresso)`),
};

/** A spoken holdings disclosure ("I don't hold any", "disclosure: I hold some"). */
export const HOLDINGS_DISCLOSURE: Partial<Record<Lang, RegExp>> = {
	en: w(`i (?:do not|don't) (?:hold|own)|i hold (?:no|none)|i have no (?:position|holdings)|no position|disclosure: i (?:hold|own)|full disclosure|i own none`),
	es: w(`no tengo (?:ninguna|ningún|posición|esta|este|nada)|no poseo|aviso: tengo|declaro que tengo|sin posición`),
	'pt-br': w(`não tenho (?:nenhuma|nenhum|posição|essa|esse|nada)|não possuo|aviso: tenho|declaro que tenho|sem posição`),
	it: w(`non (?:possiedo|detengo|ho) (?:alcuna|nessuna|questa|questo)|nessuna posizione|dichiaro di possedere`),
};

/** A named token: a $TICKER, a well-known ticker, or a coin name. */
export const NAMED_TOKEN = /(?<![\p{L}\p{N}])\$[A-Z][A-Z0-9]{1,11}(?![\p{L}\p{N}])|(?<![\p{L}\p{N}$])(?:BTC|ETH|SOL|BNB|XRP|DOGE|PEPE|BONK|WIF|PUMP|TRUMP|AI16Z|Bitcoin|Ethereum|Solana|Dogecoin)(?![\p{L}\p{N}])|(?:this|that|the|esta|esa|este|essa|esse|questa|questo) (?:coin|token|moneda|memecoin|moeda|cripto|criptomoneda)/giu;

// ---------------------------------------------------------------------------------------------------------------------
// Regional promotion rules
// ---------------------------------------------------------------------------------------------------------------------

/** ASCI (India) VDA disclaimer, recognised by its key terms in Hindi (no official Hindi text exists: native review). */
export const ASCI_DISCLAIMER_HI: RegExp[] = [w(`अनियमित|अविनियमित|अनियंत्रित|unregulated`), w(`जोखिम|जोखिमपूर्ण|risky|risk`), w(`नियामक|विनियामक|regulatory`)];
/** "Animated character, AI voice" (ASCI virtual-influencer disclosure), in Hindi or English. */
export const AI_PERSONA_DISCLOSURE_HI: RegExp[] = [w(`एनिमेटेड|कार्टून|animated|काल्पनिक पात्र`), w(`एआई|AI|कृत्रिम|आर्टिफ़िशियल|आर्टिफिशियल|synthetic|सिंथेटिक`)];
/** Words ASCI bans in VDA ads (currency, securities, custodian, depositories), Hindi and English forms. */
export const ASCI_BANNED_HI: RegExp = w(`करेंसी|करंसी|मुद्रा|मुद्राएं|मुद्राएँ|सिक्योरिटीज़|सिक्योरिटीज|सिक्योरिटी|प्रतिभूति|प्रतिभूतियां|प्रतिभूतियाँ|कस्टोडियन|अभिरक्षक|डिपॉजिटरी|डिपॉज़िटरी|निक्षेपागार|currency|currencies|securities|custodian|custodians|depository|depositories`);
/** MiCA Art. 7(1)(e) statement, recognised by its key clause (official es/it wording not read here: check EUR-Lex). */
export const MICA_STATEMENT: Partial<Record<Lang, RegExp>> = {
	en: w(`has not been reviewed or approved by any competent authority`),
	es: w(`no ha sido (?:examinada|revisada|aprobada)(?: ni (?:aprobada|examinada|revisada))? por (?:ninguna|una) autoridad competente`),
	it: w(`non è stata (?:esaminata|rivista|approvata)(?: (?:né|o) (?:approvata|esaminata|rivista))? da (?:alcuna|nessuna) autorità competente`),
};
