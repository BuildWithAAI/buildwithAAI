/**
 * The news claim gate's rules, scaled down for short public text: the daily Threat Brief email and the
 * announcer's X and Telegram posts. The full gate is video-studio/scripts/news (rules R1-R10, run on every
 * video); the patterns here mirror its lib/lexicon.ts and lib/names.ts as of 2026-11-24, cut to what short
 * text needs:
 *
 *   names        (R4)  no personal names, handles or the radar's "[named person]" placeholder
 *   howto        (R5)  no exploit how-tos: no code, addresses, function names, payload talk or attack step lists
 *   attribution  (R3)  accusations need a named source; loss figures are "reported by X" and never averaged
 *   speculation  (R6)  no hedges or rumours unless quoted from a named source that says them
 *   price        (R9)  no price, market, investment or income talk and no wallet calls to action
 *   placeholder        no TODO, example.com, "[video link ...]" or Kit template braces
 *
 * Income, return and guarantee claims come from the hub's shared rule set (src/claims.ts), the same one the
 * newsletter and the studio page use. The developing-label rule (R2) is structural, so each tool checks it on
 * its own model (threat-brief/lint.ts, announcer/lint.ts).
 *
 * Everything here is a heuristic built to fail closed on the high-precision patterns (errors) and to warn on
 * the fuzzy ones (an unknown capitalised word may be a surname). The owner's review stays the last step.
 */
import {readFileSync} from 'node:fs';
import {findClaims} from '../../src/claims.ts';

const escapeRe = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export type Rule = 'names' | 'howto' | 'attribution' | 'speculation' | 'price' | 'placeholder' | 'developing' | 'links' | 'structure' | 'html' | 'limits' | 'offers';
export type Level = 'error' | 'warning';
export type Finding = {rule: Rule; code: string; level: Level; where: string; message: string; match: string};

export const RULE_TITLE: Record<Rule, string> = {
	names: 'No personal names, handles or placeholders (news gate R4)',
	howto: 'No exploit how-tos: concept level only (R5)',
	attribution: 'Accusations and loss figures name their source; figures are never averaged (R3)',
	speculation: 'No speculation unless quoted from a named source (R6)',
	price: 'No price, market, investment or income talk (R9)',
	placeholder: 'No placeholders or template braces',
	developing: 'Developing stories are labelled DEVELOPING (R2)',
	links: 'Links are https and tagged for the channel',
	structure: 'Required parts are present',
	html: 'Email-safe HTML',
	limits: 'Platform length limits',
	offers: 'Offer links carry their disclosure',
};

// ---------------------------------------------------------------------------------------------
// Names (R4)

/**
 * Allowed (non-person) names, matched case-insensitively per token; handles and nicknames that are always
 * flagged; and threat-group names, which need a named source wherever they appear (news gate R3).
 */
export type NameAllow = {
	/** One-word names, matched case-insensitively. */
	tokens: ReadonlySet<string>;
	/**
	 * Multi-word names (lower case, tokens joined by one space), allowed only as the whole phrase: "OpenAI Sora" never
	 * makes a lone "Sora" a known word, and "123 Reg" never a lone "Reg".
	 */
	phrases: readonly string[];
	/**
	 * One-word product names that are also personal names (Claude, Sora, Jules, Kiro, Cline...): known in plain text,
	 * but never next to a person cue (a role word, an apposition) and never in a quoted headline.
	 */
	ambiguous: ReadonlySet<string>;
	blocked: readonly string[];
	handles: ReadonlySet<string>;
	groups: readonly string[];
	/**
	 * The names from the allowlist file and the show (makeAllow), as tokens and phrases. Only these may hide a role word
	 * and the word after it, or a name before a legal verb: a name added for one day (extendAllow: an incident's
	 * subject, its "also reported as" names) is the radar's reading of a headline and may itself be "Investor Kiro".
	 */
	trustedTokens: ReadonlySet<string>;
	trustedPhrases: readonly string[];
};

/** The show's own names, which every text may use. */
const SHOW_NAMES = ['Zoo', 'Badger', 'Zoora', 'Zoora AI', 'The Zoo & Badger Show', 'Threat Brief', "Zoo's One Fix", 'One Fix', 'YouTube', 'Shorts', 'Telegram', 'Kit'];
const OWN_HANDLES = ['@zooratechnologies'];
/** Product names that are also given names or surnames (the news gate's "ambiguousNames" adds to these). */
const AMBIGUOUS_NAMES = ['claude', 'sora', 'jules', 'kiro', 'cline', 'gemma', 'veo', 'devin', 'manus', 'reg'];

const tokenize = (name: string): string[] =>
	name
		.toLowerCase()
		.split(/[^a-z0-9'’.&-]+/)
		.map((t) => t.replace(/^[.'’&-]+|[.'’&-]+$/g, '').replace(/['’]s$/, ''))
		.filter((t) => t.length > 0);

/** Adds each name: a one-word name as a token, a multi-word name as a whole phrase only. */
const addNames = (tokens: Set<string>, phrases: Set<string>, names: Iterable<string>): void => {
	for (const name of names) {
		const parts = tokenize(name);
		if (parts.length === 1 && parts[0]) tokens.add(parts[0]);
		else if (parts.length > 1) phrases.add(parts.join(' '));
	}
};

/** Builds an allow set from plain names (organisations, publishers, protocols, chains...). */
export const makeAllow = (names: Iterable<string>, blocked: Iterable<string> = [], groups: Iterable<string> = [], ambiguous: Iterable<string> = []): NameAllow => {
	const tokens = new Set<string>();
	const phrases = new Set<string>();
	addNames(tokens, phrases, [...SHOW_NAMES, ...names]);
	const sorted = [...phrases].sort((a, b) => b.length - a.length);
	return {
		tokens,
		phrases: sorted,
		trustedTokens: new Set(tokens),
		trustedPhrases: sorted,
		ambiguous: new Set([...AMBIGUOUS_NAMES, ...[...ambiguous].map((a) => a.trim().toLowerCase()).filter(Boolean)]),
		blocked: [...blocked].map((b) => b.trim()).filter(Boolean),
		handles: new Set(OWN_HANDLES),
		groups: [...groups].map((g) => g.trim()).filter((g) => g.length >= 3),
	};
};

/**
 * Adds names to an allow set. `trusted`: names from configuration (today's publishers, the show, chains from the
 * databases); an incident's subject or its "also reported as" names, read from headlines, never are (see NameAllow).
 */
export const extendAllow = (allow: NameAllow, names: Iterable<string>, trusted = false): NameAllow => {
	const list = [...names];
	const tokens = new Set(allow.tokens);
	const phrases = new Set(allow.phrases);
	addNames(tokens, phrases, list);
	const extended: NameAllow = {...allow, tokens, phrases: [...phrases].sort((a, b) => b.length - a.length)};
	if (!trusted) return extended;
	const trustedTokens = new Set(allow.trustedTokens);
	const trustedPhrases = new Set(allow.trustedPhrases);
	addNames(trustedTokens, trustedPhrases, list);
	return {...extended, trustedTokens, trustedPhrases: [...trustedPhrases].sort((a, b) => b.length - a.length)};
};

/**
 * The text with every allowed multi-word name blanked (same length, so positions do not move): the person checks
 * then never read a product or organisation phrase as a name, and never read its words outside the phrase as known.
 */
export const blankPhrases = (text: string, allow?: Pick<NameAllow, 'phrases'>): string => {
	if (!allow || allow.phrases.length === 0) return text;
	let out = text;
	for (const phrase of allow.phrases) {
		const words = phrase.split(' ').map(escapeRe);
		const re = new RegExp(`(?<![\\p{L}\\p{N}_])${words.join(`[^\\p{L}\\p{N}]+`)}(?:['’]s)?(?![\\p{L}\\p{N}_])`, 'giu');
		out = out.replace(re, (m) => ' '.repeat(m.length));
	}
	return out;
};

/** A known one-word name that is not also a personal name. */
const knownWord = (allow: NameAllow | undefined, word: string): boolean => !!allow && allow.tokens.has(word) && !allow.ambiguous.has(word);
/** The same, from the allowlist file and the show only (never a name added for the day). */
const trustedWord = (allow: NameAllow | undefined, word: string): boolean => !!allow && allow.trustedTokens.has(word) && !allow.ambiguous.has(word);

/**
 * Reads the news gate's allowlist (video-studio/scripts/news/allowlist.json): every list of names except
 * "blocked" (handles and nicknames that are always flagged) and "officials" (only allowed where a cited
 * law-enforcement or regulator release names them, which short text cannot show, so they stay unknown).
 */
export const loadAllowlist = (file: string): {allow: NameAllow | null; error: string | null} => {
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(file, 'utf8'));
	} catch (err) {
		return {allow: null, error: `cannot read ${file}: ${(err as Error).message}`};
	}
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {allow: null, error: `${file}: must be a JSON object`};
	const names: string[] = [];
	const blocked: string[] = [];
	const groups: string[] = [];
	const ambiguous: string[] = [];
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		if (key === 'officials' || !Array.isArray(value)) continue;
		for (const entry of value) {
			if (typeof entry === 'string') {
				if (key === 'blocked') blocked.push(entry);
				else if (key === 'ambiguousNames') ambiguous.push(entry);
				else names.push(entry);
				if (key === 'attributedGroups') groups.push(entry);
			} else if (key === 'aliases' && Array.isArray(entry)) names.push(...entry.filter((e): e is string => typeof e === 'string'));
		}
	}
	return {allow: makeAllow(names, blocked, groups, ambiguous), error: null};
};

// Given names that are rarely English words or brands (from the news gate's list, lib/names.ts, 2026-11-24).
const FIRST_NAMES = new Set(
	`aaron abdul abigail adam adrian ahmed aidan alan albert alberto alejandro alex alexander alexandra alexis alfred ali
alice alicia alison allan allison alvin amanda amir amit amy ana anatoly anders andre andrea andreas andrei andres andrew
andy angela angelo anita ann anna anne anthony anton antonio arjun arnold arthur arturo ashley ashok barbara barron barry
beatriz ben benjamin bernard beth betty beverly bilal bjorn blake bob bobby boris brandon brendan brenda brian bruce
bruno bryan caitlin cameron carl carla carlos carmen carol caroline carolyn casey catherine cathie cecilia cesar
changpeng charles charlie charlotte cheryl chris christian christina christine christopher cindy claire claudia clayton
cody colin connor craig cristina curtis cynthia dale damian dan dana daniel daniela danielle danny darius darren dave
david davide dean deborah denis dennis derek diana diane diego dimitri dmitry dominic donald donna doug douglas duncan
dylan edgar eduardo edward elena eli elijah elizabeth ellen elon emily emma enrique eric erica erik ethan eugene evan
evelyn fabian farhan fatima federico felipe felix fernando francesca francesco francis francisco frederick gabriel
gabriela gareth gary gavin geoffrey george gerald gerardo gina giorgio giovanni giuseppe glenn gonzalo gordon graham
gregory greg gustavo hakan hamza hannah hans harold harry hassan hayden heather hector heidi helen henry herbert hideo
hiroshi howard hugo hussein ian igor ilya irene isaac isabel isabella ivan jack jacob jacqueline jake james jamie jane
janet janice jared jason javier jean jeff jeffrey jennifer jenny jeremy jerome jerry jesse jessica jihan jill jim jimmy
joan joao joe joel johan johann john johnny jon jonathan jordi jorge jose joseph josh joshua juan judith julia julian
julie julio justin kai kamal karen karl kate katherine kathleen kathryn kathy katie keith kelly ken kenneth kenji kevin
khalid kirk kristen kristin kyle lance laura lauren lawrence leah leo leon leonard leonardo leslie liam linda lisa
lorenzo louis lucas lucia luis luke maggie manuel marc marcel marco marcus margaret maria marie marina mario marisa marta
martin mary mateo matt matteo matthew maurice maxim maxwell megan melania melissa michael michel michelle miguel mikhail
mike milan miles mohamed mohammad mohammed molly monica morris muhammad nadia nancy naomi natalia natalie nathan neil
nicholas nick nicolas nicole nikhil nikolai nina noah norman oleg oliver olivia omar oscar owen pablo pamela patricia
patrick paul paula pavel pedro peter philip philippe pierre pietro priya rachel rafael rahul raj rajesh ralph ramon randy
raphael raul ravi raymond rebecca reza ricardo richard rick ricky rob robert roberto robin rodrigo roger roman ronald ross
roy russell ryan sabrina sahil sam samantha samir samuel sandra sanjay sara sarah satoshi scott sean sebastian sergei
sergey sergio seth shane shannon sharon shawn sheila simon sofia sophia sophie stanislav stefan stefano stephanie stephen
steve steven stuart susan sven tamara tanya tara ted teresa terry thomas tim timothy timmy tobias todd tom tomas tommy
tony tracy travis trevor tyler valentina valerie vanessa vasily veronica vicente victor vikram vincent vitalik vivek
vladimir walter wayne wei wendy wesley william xavier yannick yasmin yuri yusuf zachary zoe`.split(/\s+/),
);

/** A capitalised run ending in one of these is an organisation, not a person ("Victor Protocol"). */
const ORG_SUFFIXES = new Set(
	`capital finance financial network networks protocol labs lab group exchange bridge wallet wallets chain dao foundation
markets market swap pay bank ventures security securities holdings inc ltd llc corp corporation company co partners
research analytics intelligence technologies technology tech systems fund money coin token bureau department agency office
police service services court commission ministry authority council association institute university times news post
journal wire daily media magazine tracker alliance club union trust dex vault vaults lend lending portal studio studios
games gaming arena bot bots drainer drainers ai protocols platform app apps project dapp digital global international
solutions industries`.split(/\s+/),
);

/**
 * Words that follow a role in a headline without being a name ("Founder Says", "CEO Warns", "Victim Loses", "Hacker
 * Group", "Developer Tools"): the verbs and nouns headlines put there, after the news gate's AFTER_ROLE_OK list. Any
 * other capitalised word after a role is read as a name, so an unlisted verb only costs a quote (the source is then
 * shown by its label), never a leak.
 */
const NOT_A_NAME = new Set(
	`says said warns warned denies denied claims claimed admits admitted confirms confirmed responds responded calls called
urges urged steps stepped resigns resigned arrested charged sentenced pleads pleaded faces faced blames blamed vows vowed
plans planned sues sued quits quit leaves left joins joined explains explained reveals revealed apologizes apologized
apologises apologised speaks spoke breaks broke addresses addressed insists insisted
loses lost finds found steals stole stolen sells sold buys bought gets got wins won hacks hacked drains drained leaks
leaked exposes exposed discovers discovered uncovers uncovered reports reported flags flagged spots spotted tricks tricked
dupes duped scams scammed targets targeted hits uses used abuses abused exploits exploited breaches breached compromises
compromised attacks attacked phishes phished impersonates impersonated clones cloned fakes faked returns returned
recovers recovered gives gave pays paid demands demanded threatens threatened extorts extorted ransoms ransomed jailed
convicted extradited detained indicted accused accuses fined banned barred freed released identified unmasked nabbed
caught busted held seized raided questioned investigated probes probed tells told asks asked shares shared posts posted
publishes published launches launched builds built creates created develops developed makes made shows showed shown
demonstrates demonstrated proves proved tests tested bypasses bypassed jailbreaks jailbroke fools fooled convinces
convinced manipulates manipulated injects injected agrees agreed settles settled seeks sought wanted files filed alleges
alleged testifies testified tweets tweeted writes wrote falls fell turns turned helps helped receives received
rules ruled orders ordered approves approved rejects rejected dismisses dismissed blocks blocked halts halted grants
granted allows allowed signs signed backs backed opposes opposed tracks tracked traces traced links linked ties tied
names discloses disclosed notifies notified fixes fixed patches patched pleads guilty
team group community firm firms report reports account accounts laptop laptops machine computer device devices credentials
role interview interviews job jobs offer offers position salary access wallet wallets key keys data tool tools platform
side network interface experience error end base behavior behaviour education protection safety security support
onboarding agreement consent identity address email phone password session flow journey portal forum crew gang collective
campaign kit playbook tactic technique toolkit dashboard desk feed post thread channel blog note alert alerts profile
handle page site mode program programme bounty bounties funds money savings life loan loans news threat threats general
relations infrastructure
order environment environments server servers machines code repo repos repository repositories project projects app apps
behind over after into against under amid via from by as who whose whom that which while when where how why what
is are was were be been has had have will would could can may might must should did does do not no
the a an and of to in on at for with or but`.split(/\s+/),
);

/**
 * Role, title, kinship and occupation words after which a capitalised word reads as a person's name, plus the words
 * that introduce a nickname ("dubbed", "aka"). Matched in any case: a Title Case headline capitalises them ("Victim Kiro
 * Loses ...", "Nurse Kiro Loses ..."). A role word may be followed by punctuation before the name ("Victim, Kiro,
 * Loses", "Victim (Kiro)", "Victim «Kiro»", "Victim: Kiro", "Victim—Kiro—").
 */
const ROLE_WORDS = `CEO CTO COO CFO CISO founder co-founder cofounder chairman chairwoman developer engineer employee hacker attacker
suspect trader influencer researcher investigator sleuth analyst spokesperson spokesman spokeswoman director lawyer attorney
prosecutor judge senator minister president streamer youtuber whale insider defendant plaintiff victim teenager student
programmer dev investor teen man woman boy girl scammer fraudster whistleblower podcaster journalist reporter entrepreneur
billionaire millionaire executive exec owner grandmother grandfather grandma grandpa mother father mom mum dad son daughter
wife husband widow widower retiree pensioner nurse teacher doctor pastor priest gamer cybercriminal criminal elderly
grandson granddaughter grandchild nephew niece uncle aunt cousin brother sister boyfriend girlfriend fiance fiancee fiancé
fiancée parent child patient veteran soldier officer accountant banker farmer worker contractor consultant artist singer
rapper actor actress celebrity athlete holder named dubbed nicknamed alias aka`.split(/\s+/);
const ROLE_SET = new Set(ROLE_WORDS.map((w) => w.toLowerCase()));
/** Each ASCII letter as a class of both cases ("Victim", "VICTIM", "victim"), since Node 22 has no (?i:...) groups. */
const anyCase = (word: string): string => word.replace(/[a-z]/gi, (c) => `[${c.toLowerCase()}${c.toUpperCase()}]`);
const anyOf = (words: readonly string[]): string => [...words].sort((a, b) => b.length - a.length).map((w) => anyCase(escapeRe(w))).join('|');
const NUMBER_WORDS = 'one two three four five six seven eight nine ten eleven twelve'.split(' ');
/** Role phrases: "Mother Of Two Kiro", "72-Year-Old Kiro", "Hacker Known As Sora". */
const ROLE_PHRASES = [
	String.raw`(?:${anyOf(['mother', 'father', 'mom', 'mum', 'dad', 'parent'])})\s+${anyCase('of')}\s+(?:${anyOf(NUMBER_WORDS)}|\d{1,2})`,
	String.raw`\d{1,3}[-\s]${anyCase('year')}(?:${anyCase('s')})?[-\s]${anyCase('old')}`,
	String.raw`${anyCase('known')}\s+${anyCase('as')}`,
];
// Names may start with any capital letter ("José", "Łukasz", "Özgür", "Сергей"): \p{Lu}/\p{L} with the u flag, and a
// letter lookbehind instead of \b (which only knows ASCII letters). The name is read in a lookahead, so the next role
// word can start its own match ("Student Hacker Kiro"); an opening quotation mark, guillemet or bracket may sit between
// ("Hacker ‘Sora’", "Victim «Kiro»", "Victim (Kiro)").
const NAME_TOKEN = `[‘“"'«‹(]?\\p{Lu}[\\p{L}\\p{N}'’-]*`;
/**
 * Between a role and the name: a space, a bracket or a guillemet; in a quoted headline also a comma, a colon or a dash
 * ("Victim, Kiro, Loses", "Victim: Kiro Loses", "Victim—Kiro—Loses"). Body text keeps those out: "the victim, Example
 * Wire reports" names an outlet.
 */
const ROLE_GAP = String.raw`(?:\s*[(«‹]\s*|\s+)`;
const ROLE_GAP_HEADLINE = String.raw`(?:\s*[,:(«‹—–]\s*|\s+[-–—]\s+|\s+)`;
const roleBefore = (gap: string): RegExp =>
	new RegExp(`(?<![\\p{L}\\p{N}_])(?:${[...ROLE_PHRASES, anyOf(ROLE_WORDS)].join('|')})${gap}(?=(${NAME_TOKEN})(?:\\s+(${NAME_TOKEN}))?)`, 'gu');
const ROLE_BEFORE = roleBefore(ROLE_GAP);
const ROLE_BEFORE_HEADLINE = roleBefore(ROLE_GAP_HEADLINE);
/** A token as a lower-case word: no surrounding quotation marks, guillemets or brackets, no possessive. */
const bareWord = (token: string): string => token.replace(/^[‘“"'«‹(]+|[’”"'»›),:]+$/g, '').replace(/['’]s$/, '').toLowerCase();

/** "<Name> said ... he/she": whoever speaks of himself or herself is a person (as the news gate's SPEECH_AFTER). */
const SPEECH_AFTER =
	/^(?:['’]s)?\s+(?:also\s+|later\s+|then\s+|now\s+)?(?:said|says|told|tells|added|adds|wrote|writes|posted|tweeted|explained|explains|noted|notes|warned|warns|claimed|claims|argued|argues|insisted|insists|denied|denies|admitted|admits|stated|states|recalled|recalls|recounted|recounts|described|describes|revealed|reveals|confessed|confesses|complained|complains|remembered|remembers|shared|shares|testified|testifies)\b/iu;
const PRONOUN_LATER = /^[^.!?]*?(?<![\p{L}\p{N}_])(?:he|she|his|her|him|hers|himself|herself)(?![\p{L}\p{N}_])/iu;
/** In a quoted headline "they" counts too ("Kiro says they lost $40,000"): refusing an organisation's quote costs a label. */
const PRONOUN_LATER_HEADLINE = /^[^.!?]*?(?<![\p{L}\p{N}_])(?:he|she|his|her|him|hers|himself|herself|they|them|their|theirs|themselves)(?![\p{L}\p{N}_])/iu;
/** Speakers that are not one person ("Prosecutors said he ...", "Officials say she ..."), and every role's plural. */
const SPEAKER_NOUNS = new Set([
	...`officials official prosecutors authorities investigators researchers regulators analysts experts victims attackers hackers
scammers users customers sources lawyers judges documents filings records witnesses neighbors neighbours relatives family
friends staff employees executives agents officers detectives police court courts reports company firm government
spokesperson representatives people men women children parents families thousands hundreds dozens millions members
residents citizens nationals`.split(/\s+/),
	...ROLE_WORDS.map((w) => `${w.toLowerCase()}s`),
]);
const HONORIFIC = /(?<![\p{L}\p{N}_])(?:Mr|Mrs|Ms|Dr|Sir|Dame|Prof)\.?\s+\p{Lu}[\p{Ll}'’-]+/gu;
const APPOSITION_ROLES = `founder co-founder cofounder ceo cto coo cfo developer engineer employee hacker attacker suspect trader influencer
researcher investigator analyst executive spokesperson director owner insider whale programmer victim defendant lawyer
attorney partner manager head retiree pensioner nurse teacher doctor pastor priest gamer cybercriminal criminal student
teenager teen mother father grandmother grandfather man woman scammer fraudster whistleblower journalist reporter streamer
youtuber holder worker contractor consultant veteran resident native`.split(/\s+/);
const APPOSITION =
	new RegExp(String.raw`(?<![\p{L}\p{N}_])(\p{Lu}[\p{Ll}'’-]+(?:\s+\p{Lu}[\p{Ll}'’-]+)+),\s+(?:the\s+|a\s+|an\s+|its\s+|their\s+)?(?:former\s+|ex-|co-|chief\s+|lead\s+|alleged\s+|pseudonymous\s+|anonymous\s+)?(?:${APPOSITION_ROLES.join('|')})\b`, 'giu');
/** Words that may describe the person in a one-name apposition ("Kiro, a retired teacher", "Sora, the 19-year-old hacker"). */
const APPOSITION_MODIFIERS = `former ex retired elderly young old local self-described self-styled alleged suspected convicted anonymous
pseudonymous single unemployed crypto bitcoin tech security software senior junior lead chief teenage grieving
widowed disabled`.split(/\s+/);
/**
 * One name and a role with an article: "Kiro, a retiree, ...", "Sora, the hacker, ..." (case-sensitive name). The roles
 * an organisation also takes ("Acme, a developer of wallets", "the owner of") are left to the two-name pattern.
 */
const ORG_ROLES = new Set(['developer', 'owner', 'partner', 'manager', 'head']);
const APPOSITION_ONE = new RegExp(
	String.raw`(?<![\p{L}\p{N}_])(\p{Lu}[\p{Ll}'’-]+),\s+(?:${anyOf(['the', 'a', 'an'])})\s+(?:(?:${anyOf(APPOSITION_MODIFIERS)}|\d{1,3}-${anyCase('year')}-${anyCase('old')})\s+){0,2}(?:${anyOf(APPOSITION_ROLES.filter((r) => !ORG_ROLES.has(r)))})(?![\p{L}\p{N}_])`,
	'gu',
);
/** "<Name>, who ...": a relative clause about a person. */
const WHO_AFTER = /(?<![\p{L}\p{N}_])(\p{Lu}[\p{Ll}'’-]+(?:\s+\p{Lu}[\p{Ll}'’-]+)?),\s+who(?![\p{L}\p{N}_])/gu;
const AGE = /(?<![\p{L}\p{N}_])\p{Lu}[\p{Ll}'’-]+(?:,\s*(?:aged\s+)?\d{1,2},|\s*\(\s*(?:aged?\s+)?\d{1,2}\s*\))/gu;
/**
 * Legal verbs that only a person takes: the capitalised word right before one is a name ("Lena Weiss Arrested Over AI
 * Chatbot Breach", "Kiro was jailed"), unless it is a role, a number, a group or a nationality ("Hacker Arrested", "Two
 * Arrested", "Ukrainian Extradited").
 */
const LEGAL_PERSON_VERBS = ['arrested', 'indicted', 'sentenced', 'extradited', 'convicted', 'jailed', 'detained', 'imprisoned', 'pleads', 'pleaded'];
const AUXILIARY = String.raw`(?:${anyCase('has')}\s+${anyCase('been')}|${anyCase('had')}\s+${anyCase('been')}|${anyOf(['was', 'is', 'gets', 'got', 'been', 'being'])})`;
const LEGAL_BEFORE = new RegExp(String.raw`(?<![\p{L}\p{N}_'’])(\p{Lu}[\p{L}'’-]*)\s+(?:${AUXILIARY}\s+)?(?:${anyOf(LEGAL_PERSON_VERBS)})(?![\p{L}\p{N}_])`, 'gu');
/** Nationalities and groups that come before a legal verb without being a name. */
const DEMONYMS = new Set(
	`american americans british briton britons canadian canadians australian australians indian indians nigerian nigerians
korean koreans chinese japanese vietnamese thai filipino filipinos indonesian indonesians malaysian malaysians
singaporean singaporeans turkish turk turks german germans french dutch spanish spaniard spaniards italian italians
brazilian brazilians argentine argentines mexican mexicans colombian colombians israeli israelis iranian iranians
pakistani pakistanis bangladeshi bangladeshis polish pole poles romanian romanians bulgarian bulgarians serbian serbians
lithuanian lithuanians latvian latvians estonian estonians belarusian belarusians ukrainian ukrainians russian russians
kazakh kazakhs georgian georgians armenian armenians moldovan moldovans czech czechs slovak slovaks hungarian hungarians
greek greeks swiss swede swedes swedish norwegian norwegians danish finnish irish scottish welsh emirati emiratis saudi
saudis egyptian egyptians kenyan kenyans ghanaian ghanaians moroccan moroccans taiwanese cambodian cambodians burmese
european europeans asian asians african africans dual duo trio pair gang ring operators operator admins admin affiliates
affiliate insiders member several many others`.split(/\s+/),
);
/** Nouns that come before "loses", "says" or a legal verb in a headline without being a name. */
const GENERIC_NOUNS = new Set(
	`startup startups city town state county hospital school schools church charity nonprofit chatbot chatbots agent agents
assistant assistants model models extension extensions plugin plugins skill skills deepfake deepfakes clone clones voice
voices video videos call calls user customer client clients player players fan fans buyer buyers seller sellers merchant
merchants retailer retailers brand brands store stores shop shops site sites website websites study survey analysis
filing lawsuit suit complaint indictment probe audit review update couple feds`.split(/\s+/),
);
/**
 * A quoted headline (isSafeQuote) also names a person when an unknown capitalised word comes right before a verb only a
 * person takes ("Kiro Tanaka Loses $40,000", "How Kiro Lost ...", "Tanaka Charged ..."), owns a person's things
 * ("Kiro’s Savings Gone"), stands alone in brackets or guillemets ("(Kiro)", "«Kiro»"), is shaped like a handle
 * ("Kiberphant0m", "USDoD"), or is followed by a role between commas ("Kiro, Retired Teacher, Loses"). An organisation
 * the allowlist does not know is refused too: that costs a plain label, never a leak.
 */
const PERSON_VERBS = [
	'lose', 'loses', 'lost', 'says', 'said', 'tells', 'told', 'admits', 'admitted', 'pleads', 'pleaded', 'recounts', 'recounted', 'recalls', 'recalled', 'describes',
	'described', 'explains', 'explained', 'reveals', 'revealed', 'confesses', 'confessed', 'charged', 'sued', 'fined', 'faces', 'faced', 'dies', 'died', 'scammed',
	'duped', 'tricked', 'defrauded', 'robbed', 'swindled', 'conned', 'fooled', ...LEGAL_PERSON_VERBS,
];
const PERSON_VERB_AFTER = new RegExp(String.raw`(?<![\p{L}\p{N}_'’])(\p{Lu}[\p{L}\p{N}'’-]*)\s+(?:${AUXILIARY}\s+)?(?:${anyOf(PERSON_VERBS)})(?![\p{L}\p{N}_])`, 'gu');
const PERSONAL_THINGS = [
	'wallet', 'wallets', 'savings', 'account', 'accounts', 'funds', 'identity', 'voice', 'phone', 'email', 'e-mail', 'life', 'family', 'crypto', 'bitcoin', 'money', 'home',
	'house', 'keys', 'seed', 'password', 'passwords', 'photos', 'likeness', 'face', 'son', 'daughter', 'wife', 'husband', 'mother', 'father', 'grandmother', 'grandfather',
	'parents', 'children', 'kids', 'retirement', 'pension', 'inheritance', 'bank',
];
const POSSESSIVE_THINGS = new RegExp(String.raw`(?<![\p{L}\p{N}_'’])(\p{Lu}[\p{L}\p{N}-]*)['’]s\s+(?:${anyOf(PERSONAL_THINGS)})(?![\p{L}\p{N}_])`, 'gu');
const BRACKETED_WORD = /[«‹(]\s*(\p{Lu}\p{Ll}[\p{L}\p{N}'’-]*)\s*[»›)]/gu;
const BRACKET_LABELS = new Set('updated update video report exclusive opinion analysis podcast interview sponsored correction corrected explainer live watch'.split(' '));
const HANDLE_SHAPE = /(?<![\p{L}\p{N}_])([\p{L}\p{N}_]*\p{L}\d+\p{L}[\p{L}\p{N}_]*|[A-Z]{2,}[a-z]+[A-Z][\p{L}\p{N}]*)(?![\p{L}\p{N}_])/gu;
const APPOSITION_HEADLINE = new RegExp(
	String.raw`(?<![\p{L}\p{N}_])(\p{Lu}[\p{Ll}'’-]+),\s+(?:(?:${anyOf(APPOSITION_MODIFIERS)}|\d{1,3}-${anyCase('year')}-${anyCase('old')})\s+){0,2}(?:${anyOf(APPOSITION_ROLES)})\s*,`,
	'gu',
);
const PLACEHOLDER_NAME = /\[\s*(?:named person|name|redacted|person|individual|non-English text)\s*\]/gi;
/** Chinese, Japanese or Korean script: names in it cannot be checked, so a headline with a run of it is never quoted. */
const CJK_RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]{2,}/u;
const HANDLE = /(?<![\w.@/])@[A-Za-z0-9_]{1,30}\b/g;
const CAPITALISED = /(?<![\p{L}\p{N}_'’#@-])\p{Lu}\p{Ll}[\p{L}\p{N}'’-]*/gu;
/** Lower case without diacritics, for the given-name list: "José" -> "jose", "Łukasz" -> "lukasz". */
const fold = (word: string): string =>
	word
		.replace(/[łŁ]/g, 'l')
		.replace(/[øØ]/g, 'o')
		.replace(/[đĐ]/g, 'd')
		.normalize('NFKD')
		.replace(/\p{M}+/gu, '')
		.toLowerCase();

/** Words that may be capitalised without being names (calendar words and common sentence words). */
const COMMON_CAPS = new Set(
	`january february march april may june july august september october november december jan feb mar apr jun jul aug
sep sept oct nov dec monday tuesday wednesday
thursday friday saturday sunday today tomorrow yesterday i the a an and or but if when while after before because
this that these those it its they their there here what why how who where which every each all some any no not never
our we you your he she his her my me us them status sources source reported reported loss how worked chains when
confirmed developing correction corrections update updates watch today's episode fix one in plain terms terms watch
not financial advice news education security crypto wallet wallets hack hacks hacked exploit exploits phishing scam
scams bridge key keys private recovery phrase seed support real verify before bookmarks never subscribe unsubscribe
also more most new top incident incidents brief daily radar story stories video videos channel show sign signed
signature`.split(/\s+/),
);


/** Short words that headline styles leave in lower case ("Tracing the North Korea Link"). */
const SMALL_WORDS = new Set('a an the of in on at to for and or but nor by via with from as is are was be it its vs per into over after'.split(' '));

/** Headline style: most words after the first start with a capital (ignoring short function words). */
const isTitleCase = (text: string): boolean => {
	const words = (text.match(/[A-Za-z][A-Za-z'’-]+/g) ?? []).filter((w) => !SMALL_WORDS.has(w.toLowerCase()));
	if (words.length < 2) return false;
	const caps = words.slice(1).filter((w) => /^[A-Z]/.test(w)).length;
	return caps / (words.length - 1) >= 0.6;
};

const sentenceStartAt = (text: string, index: number): boolean => {
	const before = text.slice(Math.max(0, index - 4), index);
	return index === 0 || /(?:^|[.!?:;"“‘(\n—–·•]\s*|\s-\s)$/.test(before) || /^\s*(?:[-*•]\s+)?$/.test(text.slice(0, index));
};

// ---------------------------------------------------------------------------------------------
// How-to (R5): mirrors the news gate's HOWTO patterns

type Pattern = {code: string; label: string; re: RegExp; contextual?: boolean};
const p = (code: string, label: string, re: RegExp, contextual = false): Pattern => ({code, label, re: new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`), contextual});

// What an attack told, got or tricked an AI into doing, with the AI named generically or by product (mirrors the news
// gate's lexicon.ts, 2026-11-25 round 3): "to <action>" after the TO verbs, "into <action>ing" after the INTO verbs, a
// bare exfiltration verb after "had/made" ("had Claude Code upload ..."), or "it should <action>"
/** A phrase with every letter in both cases, spaces as \s+ and either apostrophe, for use inside a case-sensitive pattern. */
const ci = (phrase: string): string =>
	phrase
		.split(/\s+/)
		.map((w) => escapeRe(w).replace(/['’]/g, "['’]").replace(/[a-z]/gi, (c) => `[${c.toLowerCase()}${c.toUpperCase()}]`))
		.join(String.raw`\s+`);
const TO_VERBS = `told tells tell telling instructed instructs instructing asked asks asking ordered orders directed directs directing
made makes commanded commands prompted prompts got gets getting caused causes causing convinced convinces convincing persuaded
persuades persuading led leads forced forces forcing tricked tricks tricking coaxed coaxes manipulated manipulates pushed
pushes urged urges nudged nudges steered steers`.split(/\s+/);
const INTO_VERBS = `tricked tricks tricking fooled fools fooling manipulated manipulates manipulating duped dupes coaxed coaxes lured
lures conned deceived deceives convinced convinces persuaded persuades talked talks led leads forced forces pushed pushes
steered steers`.split(/\s+/);
const BARE_VERBS = ['had', 'has', 'made', 'makes'];
/** What the instruction made the AI do; never the user's own trigger ("asked the assistant to summarise the page"). */
const AI_ACTIONS = `open send paste copy upload print run execute read delete forward email e-mail reveal ignore disable download
install write post leak exfiltrate exfil share transfer grant approve push publish output repeat dump encode commit attach
curl wget base64 append zip sync submit transmit harvest grab extract disclose expose steal siphon`.split(/\s+/);
/** A bare action after "had", "made": the exfiltration verbs only ("made the coding agent read secrets" is the concept). */
const BARE_ACTIONS = `send upload paste post email e-mail forward exfiltrate exfil leak share transfer push publish commit attach curl
append encode base64 zip sync submit dump print reveal output copy transmit steal siphon disclose expose`.split(/\s+/);
const ACTIONS_ING = `sending uploading pasting posting emailing e-mailing forwarding exfiltrating leaking sharing transferring pushing
publishing committing attaching curling appending encoding base64-encoding zipping syncing submitting dumping printing
revealing outputting copying transmitting stealing siphoning disclosing exposing running executing opening reading deleting
installing downloading ignoring disabling granting approving repeating writing`.split(/\s+/);
/** A determiner, then at most one owner ("the company's AI assistant", "Windsurf's"). */
const RECIPIENT_DET = String.raw`(?:(?:${['the', 'an', 'a', 'its', 'their', "a user's", "the user's", "the victim's", "victims'", "users'"].map(ci).join('|')})\s+)?(?:[\p{L}-]+['’]s?\s+)?`;
const AI_GENERIC = String.raw`(?:(?:AI|coding|browser|e-?mail|LLM|autonomous|agentic|shopping|support|research|hidden|malicious|enterprise|company|corporate|internal|personal|developer|code|chat|web|desktop|voice)[-\s]+){0,2}(?:agent|assistant|model|chat\s?bot|AI|bot|copilot|LLM)s?`;
/** AI products, longest first, in their exact case or all capitals ("Cursor", "CURSOR", never "the cursor"; "Operator", never "an operator"). */
const AI_PRODUCT_NAMES = [
	'Microsoft 365 Copilot', 'Amazon Q Developer', 'Gemini Code Assist', 'Microsoft Copilot', 'Security Copilot', 'Perplexity Comet', 'ChatGPT Operator', 'GitHub Copilot',
	'Copilot Studio', 'ChatGPT Atlas', 'Claude Desktop', 'Google Gemini', 'M365 Copilot', 'Copilot Chat', 'Replit Agent', 'OpenAI Codex', 'Google Jules', 'Claude Code',
	'Gemini CLI', 'Antigravity', 'Codex CLI', 'Amazon Q', 'AWS Kiro', 'Roo Code', 'Perplexity', 'Windsurf', 'OpenClaw', 'Operator', 'DeepSeek', 'ChatGPT',
	'Codeium', 'Lovable', 'Mistral', 'Gemini', 'Claude', 'Cursor', 'Replit', 'Devin', 'Codex', 'Comet', 'Jules', 'Manus', 'Aider', 'Llama', 'Alexa', 'Grok', 'Kiro',
	'Cline', 'Qwen', 'Siri', 'Copilot', 'Cascade',
]
	.flatMap((n) => [n, n.toUpperCase()])
	.map((n) => escapeRe(n).replace(/ /g, String.raw`\s+`));
/** Words after a product name that still name the AI ("the Copilot coding agent", "GitHub Copilot Chat", "Windsurf's Cascade agent"). */
const AI_TAIL = String.raw`(?:\s+(?:${['agent', 'agents', 'assistant', 'extension', 'CLI', 'IDE', 'chatbot', 'bot', 'model', 'coding', 'chat', 'browser', 'plugin', 'app', 'desktop', 'web', 'mobile'].map(ci).join('|')}|\p{Lu}[\p{L}\d-]*)){0,3}`;
/** An apposition after the AI's name: "GitHub Copilot, the coding agent, ...". */
const AI_APPOSITION = String.raw`(?:\s*,\s*(?:${['the', 'its', 'a', 'an'].map(ci).join('|')})\s+(?:[\p{L}-]+\s+){0,3}?(?:${['agent', 'assistant', 'chatbot', 'bot', 'model', 'extension', 'tool', 'copilot', 'AI', 'LLM'].map(ci).join('|')})s?\s*,)?`;
const SHOULD = String.raw`(?:(?:${ci('that')}\s+)?(?:${['it', 'they'].map(ci).join('|')})\s+(?:${['should', 'must', 'would', 'could', 'needed to', 'needs to', 'need to', 'had to', 'has to', 'have to', 'was to', 'were to'].map(ci).join('|')})\s+|${ci('to')}\s+)`;
/** The three manipulations ("... to <action>", "... into <action>ing", "had/made ... <action>") after a recipient. */
const toldTheAgent = (recipient: string): string => {
	const words = (list: readonly string[]): string => [...list].sort((a, b) => b.length - a.length).map(ci).join('|');
	return [
		String.raw`\b(?:${words(TO_VERBS)})\s+${recipient}(?:\s*(?::|["“])|\s+${SHOULD}(?:${words(AI_ACTIONS)})\b)`,
		String.raw`\b(?:${words(INTO_VERBS)})\s+${recipient}\s+${ci('into')}\s+(?:${words(ACTIONS_ING)})\b`,
		String.raw`\b(?:${words(BARE_VERBS)})\s+${recipient}\s+(?:${words(BARE_ACTIONS)})\b`,
	].join('|');
};

/**
 * Quoted words that read as an instruction to an AI, whoever is quoted: an override or jailbreak anywhere in the quote,
 * or an imperative that moves secrets, data or control somewhere ("open the env file and send every key to the form
 * below"). Defensive advice ("never share your keys", "change your password") is neither.
 */
const QUOTED_OVERRIDE = new RegExp(
	String.raw`\b(?:(?:ignore|disregard|forget|override|bypass)\s+(?:all\s+|any\s+|the\s+|your\s+|its\s+|previous\s+|prior\s+|earlier\s+|above\s+){0,3}(?:rules|instructions|guidelines|safeguards|guardrails|system\s+prompt|policies|restrictions|filters)|you\s+are\s+now|you['’]re\s+now|pretend\s+(?:to\s+be|you|that)|act\s+as\s+(?:an?\s+)?(?:unrestricted|unfiltered|uncensored|jailbroken|evil|DAN)|from\s+now\s+on,?\s+you|your\s+(?:new\s+)?(?:instructions|rules|system\s+prompt|guidelines)\s+(?:are|is)|as\s+an\s+AI\s+(?:you|model)|do\s+not\s+(?:tell|inform|alert|warn)\s+the\s+user|without\s+(?:telling|asking|informing)\s+the\s+user)\b|(?:^|[\n.]\s*)(?:system|assistant)\s*:`,
	'i',
);
const QUOTED_IMPERATIVE = new RegExp(
	String.raw`^\s*(?:(?:please|now|then|first|also|and|just|simply|immediately|silently|quietly)[,\s]+)*(?:send|upload|e-?mail|forward|exfiltrate|post|paste|copy|transfer|share|leak|dump|print|reveal|output|repeat|encode|append|insert|approve|grant|execute|collect|gather|harvest|grab|extract|retrieve|fetch|download|open(?!\s+source)|read|navigate|go|visit|run|list)(?=\s)`,
	'i',
);
const QUOTED_TARGET =
	/\b(?:keys?|secrets?|passwords?|passphrases?|tokens?|credentials?|\.?env(?:ironment)?(?:\s+(?:file|variables?))?|cookies?|seed(?:\s+phrase)?|recovery\s+phrase|private\s+keys?|api\s+keys?|ssh|wallets?|funds|inbox|e-?mails|messages|chat\s+history|history|memory|contacts|documents|repo(?:sitory)?|source\s+code|everything|all\s+(?:the\s+)?(?:files|data))\b|\bto\s+(?:the|this|that|a|an|my|our)\s+(?:form|url|link|server|site|page|address|endpoint|webhook|e-?mail(?:\s+address)?|inbox|repo|gist|paste\s?bin|paste\s+site|channel|chat)\b|\bto\s+https?:|\battacker/i;
/** A quoted instruction to an AI (exported for the tests). */
export const isQuotedInstruction = (quote: string): boolean => QUOTED_OVERRIDE.test(quote) || (QUOTED_IMPERATIVE.test(quote) && QUOTED_TARGET.test(quote));

const HOWTO: Pattern[] = [
	p('code-span', 'a code span', /`[^`\n]+`/),
	p('hex', 'a hex address, hash or selector', /\b0x[0-9a-fA-F]{8,}\b/),
	p('long-hex', 'a long hex string (key or hash)', /\b[0-9a-fA-F]{40,}\b/),
	p('base58', 'a full Solana or Bitcoin-style address', /\b(?=[1-9A-HJ-NP-Za-km-z]*\d)(?=[1-9A-HJ-NP-Za-km-z]*[A-Za-z])[1-9A-HJ-NP-Za-km-z]{32,90}\b/),
	p('function-call', 'a function call or signature', /\b[A-Za-z_][A-Za-z0-9_]*\((?!s\)|es\))[^()\n]{0,80}\)/),
	p('snake-case', 'a code identifier (snake_case)', /\b[a-z][a-z0-9]*_[a-z0-9_]*[a-z0-9]\b/),
	p('evm-code', 'smart-contract code terms', /\b(?:msg\.sender|tx\.origin|delegatecall|selfdestruct|sstore|sload|calldataload|uint(?:8|16|32|64|128|256)|bytes32|onlyOwner|pragma solidity|abi\.encode\w*|keccak256|ecrecover|create2|storage slot \d+)\b/i),
	p('shell', 'a shell command', /\b(?:curl|wget) https?:|\b(?:npm (?:i|install)|pip install|git clone|forge (?:test|script)|cast (?:send|call)|hardhat (?:run|test)|npx [\w@/.-]+|python3? [\w/.-]+\.py|node [\w/.-]+\.js)\b/i),
	p('payload', 'payload, calldata or exploit-code talk', /\b(?:payloads?|call ?data|bytecode|byte code|opcodes?|function selectors?|abi[- ]encoded|shellcode|proof[- ]of[- ]concept|exploit (?:code|script|contract|kit)|attack (?:contract|script)|raw transaction)\b/i),
	p('poc', 'proof-of-concept talk', /\bPoCs?\b/),
	p('how-to', '"how to bypass / exploit / ..."', /\bhow (?:to|you can|you could|anyone can|one can|they could) (?:bypass|exploit|hack|drain|steal|attack|phish|launder|mix|rug|scam|crack|break into|get around|evade|trick|clone|deepfake|spoof|jailbreak|inject|impersonate|replicate|reproduce|front-?run|sandwich|manipulate|sneak)\b/i),
	p('try-it', 'an invitation to reproduce it', /\b(?:try (?:this|it) (?:yourself|at home)|you can (?:do|try|replicate|reproduce) (?:this|it)|(?:replicate|reproduce|recreate) (?:the|this|that) (?:attack|exploit|hack|jailbreak|injection)|copy (?:this|the) (?:prompt|code|script|payload|command))\b/i),
	p('injection-string', 'a prompt-injection or jailbreak string', /\b(?:ignore (?:all |any )?(?:previous|prior|above|earlier|preceding) (?:instructions|prompts|messages|rules)|disregard (?:all |any )?(?:previous|prior|above) (?:instructions|rules)|(?:jailbreak|injection) (?:prompt|payload|string|template)s?|system prompt\s*[:=])/i),
	p('placeholder-code', "the radar's [code], [address] or [instruction] placeholder", /\[\s*(?:code|address|instruction)\s*\]/i),
	// text addressed to an AI, quoted or paraphrased: a prompt-injection payload or a jailbreak recipe (AI lane)
	p('ai-addressed', 'text addressed to an AI (an injected instruction)', /\b(?:AI|assistants?|agents?|models?|chat ?bots?|LLMs?|copilots?)\s+(?:reading|processing|summari[sz]ing|parsing|browsing)\s+(?:this|these)\b/i),
	p('roleplay-instruction', 'a jailbreak instruction ("pretend", "act as", "you are now")', /\b(?:you are now (?:a|an|in|the|DAN|free|unrestricted|jailbroken)|pretend (?:you are|you're|to be|it (?:is|was) an? (?:AI|assistant|model|chatbot))|act as (?:an? )?(?:unrestricted|unfiltered|jailbroken|evil|DAN)\b|developer mode|forget (?:everything|all) (?:above|before)|(?:ignore|disregard) (?:its|your|their|all) (?:rules|guidelines|instructions|safeguards))/i),
	p('told-the-agent', 'an instruction the attack gave the AI, repeated', new RegExp(toldTheAgent(`${RECIPIENT_DET}${AI_GENERIC}${AI_APPOSITION}`), 'iu')),
	// the AI named by product ("The README got Copilot to upload the env file"), in its exact case or capitals
	p('told-the-agent', 'an instruction the attack gave the AI, repeated', new RegExp(toldTheAgent(`${RECIPIENT_DET}(?:${AI_PRODUCT_NAMES.join('|')})(?:['’]s)?${AI_TAIL}${AI_APPOSITION}`), 'u')),
	p('tutorial', 'tutorial or step-by-step framing', /\b(?:step[- ]by[- ]step|walkthrough|walk-through|tutorial|cheat ?sheet)\b/i, true),
	p('here-is-how', '"here\'s how to"', /\bhere'?s (?:exactly )?how (?:to|you|anyone|they could)\b/i, true),
	p('step-marker', 'a numbered step', /\bstep (?:one|two|three|four|five|six|\d+)\b/i, true),
	p('numbered-list', 'a numbered list', /(?:^|\n)\s*\d+[.)]\s/, true),
];

/** Attack verbs: a step list or sequence that uses them reads as instructions. */
const OFFENSIVE =
	/\b(?:exploit\w*|attack\w*|bypass\w*|inject\w*|manipulat\w*|forg(?:e|ed|ing)|spoof\w*|impersonat\w*|phish\w*|front-?run\w*|re-?enter\w*|reentran\w*|flash[- ]?loan\w*|craft\w*|deploy\w* (?:a |the )?malicious|invok\w*|mint(?:ed|ing)? (?:fake|unbacked)|launder\w*|mixer|tumbl\w*|obfuscat\w*|evad\w*|cash(?:ed|ing)? out|jailbr\w*|drain\w*|steal\w*|stole)\b/i;
const SEQUENCE_MARKERS = /\b(?:first(?:ly)?|second(?:ly)?|third(?:ly)?|then|next|after that|afterwards|finally|lastly)\b/gi;

// ---------------------------------------------------------------------------------------------
// Attribution (R3) and speculation (R6)

const ACCUSATIONS: Pattern[] = [
	p('hacked-by', 'names who did it ("hacked by", "stolen by")', /\b(?:hacked|stolen|drained|exploited|attacked|breached|compromised|phished|scammed|targeted) by\b/i),
	p('stole', 'says someone stole', /\b(?:stole|steals|stealing)\b/i),
	p('insider', 'alleges insider involvement', /\b(?:inside job|insider (?:job|attack|threat|theft|involvement|trading)|an insider|rogue (?:employee|developer|dev|insider|staffer))\b/i),
	p('rug', 'alleges a rug pull or exit scam', /\b(?:rug[- ]?pull(?:ed|s|ing)?|rugged|exit[- ]scam(?:med|s)?|pulled (?:the )?liquidity)\b/i),
	p('fraud', 'alleges fraud', /\b(?:fraud(?:ulent|ster|sters)?|ponzi|pyramid scheme|defraud(?:ed|ing)?|scammed|embezzl\w*|swindl\w*)\b/i),
	p('scam-label', 'labels something a scam', /\b(?:is|was|were|are) (?:a |an |just a )?(?:scam|scams)\b|\bscam (?:project|token|coin|team|exchange|platform)\b/i),
	p('behind', 'says who was behind it', /\b(?:behind|responsible for|blamed for) (?:the|this|that|these) (?:attack|attacks|hack|hacks|exploit|theft|heist|breach|drain|scam|campaign)\b/i),
	p('state-actor', 'attributes it to a state actor', /\b(?:north korean?|dprk|lazarus|state[- ](?:sponsored|backed)|nation[- ]state)\b/i),
	p('criminal', 'calls someone a criminal', /\b(?:criminal (?:group|gang|ring|syndicate|network)|crime (?:ring|syndicate))\b/i),
];

/** A named source in the same sentence ("according to X", "X says", "reported by X", "X: “...”"). */
const ATTRIBUTION =
	/\b(?:according to|reported by|as reported by|per|via|says|said|say|reports|reported|writes|wrote|lists|listed|classifies|classified|states|stated|estimates|estimated|puts|finds|found|attributes|attributed|alleges|alleged|claims|claimed|told|tells|headline|post-mortem|postmortem|warns|warned|confirms|confirmed|traces|traced|tracks|tracked|notes|noted|cites|cited)\b|^[A-Z][\w.&'’ -]{1,40}:\s*[“"‘]/i;

const MONEY = /(?:US)?\$\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:[kKmMbB]n?\b|thousand\b|million\b|billion\b|trillion\b|Thousand\b|Million\b|Billion\b))?|\b\d[\d,]*(?:\.\d+)?\s?(?:million|billion|thousand)\s+(?:dollars|usd|usdt|usdc)\b|\b\d[\d,]*(?:\.\d+)?\s?(?:USD|USDT|USDC)\b/g;
const LOSS_WORDS =
	/\b(?:lost|lose|loses|loss(?:es)?|stolen|stole|drain(?:ed|s|ing)?|taken|took|siphon(?:ed)?|exploit(?:ed)?|hack(?:ed)?|theft|heist|missing|extracted|outflows?|wiped out|worth of)\b/i;
/** "Publisher: “quoted headline”": the quoted words belong to the named publisher. */
const QUOTED_ATTRIBUTION = /^[A-Z][\w.&'’ -]{1,40}:\s*[“"‘]/i;
const LOSS_ATTRIBUTION = /\b(?:according to|lists|listed|states|stated|reports|reported|says|said|estimates|estimated|puts|classifies)\b/i;
const AVERAGING = /\b(?:average|averag(?:ed|ing)|on average|mean|median|midpoint|split the difference|somewhere between|in total|combined|altogether|all told|total of)\b/i;

const SPECULATION: Pattern[] = [
	p('hedge', 'a hedge ("probably", "maybe", "apparently")', /\b(?:probably|presumably|possibly|perhaps|maybe|supposedly|apparently|seemingly|conceivably)\b/i),
	p('likely', '"likely" / "unlikely"', /\b(?:likely|unlikely)\b/i),
	p('seems', '"seems" / "appears"', /\b(?:it seems|seems to|seems like|it appears|appears to|smells like|reeks of)\b/i),
	p('rumor', 'rumour or anonymous sourcing', /\b(?:rumou?r(?:s|ed)?|word is|people are saying|some say|insiders say|sources say|unconfirmed reports?|speculat\w*|conspiracy|conspiracies)\b/i),
	p('opinion', 'a guess presented as analysis', /\b(?:i think|we think|i believe|we believe|i bet|we bet|my guess|our guess|i suspect|we suspect|chances are|odds are|wouldn'?t be surprised|who knows|must have been|had to be|no doubt|definitely an?|surely)\b/i),
	p('might-have', '"might / may / could have"', /\b(?:might|may|could) have (?:been|had|known|helped|done|used|stolen|taken|planned)\b/i),
	p('reportedly', '"reportedly" / "allegedly" without a named source', /\b(?:reportedly|allegedly|purportedly)\b/i),
];

// ---------------------------------------------------------------------------------------------
// Price (R9): mirrors the news gate's PRICE patterns; income claims come from src/claims.ts

const PRICE: Pattern[] = [
	p('price', 'price talk', /\b(?:price|prices|priced|pricing)\b/i),
	p('price-move', 'a price move', /\b(?:fell|drop(?:ped)?|plunged|crashed|tanked|slumped|sank|dipped|tumbled|surged|soared|jumped|rose|rallied|pumped|spiked|climbed|rebounded|slid|nosedived|cratered)\b[^.!?]{0,40}?\d+(?:\.\d+)?\s?(?:%|percent)|\b\d+(?:\.\d+)?\s?(?:%|percent)\s+(?:drop|fall|gain|rise|jump|slide|plunge|crash|rally|pump|dump|decline|increase|surge)\b/i),
	p('market-talk', 'market talk', /\b(?:market cap(?:itali[sz]ation)?|mcap|all[- ]time highs?|bull(?:ish| run| market)|bear(?:ish| market)|to the moon|mooning|buy the dip|bottom(?:ed)? out|price targets?|undervalued|overvalued|oversold|overbought|resistance level|support level|breakout|trading at|worth buying|good entry|entry point)\b/i),
	p('ath', 'market talk', /\bATH\b/),
	p('advice', 'buy/sell/hold advice', /\b(?:you should|you'd better|you must|time to|consider|start|stop|go) (?:buy(?:ing)?|sell(?:ing)?|short(?:ing)?|long(?:ing)?|invest(?:ing)?|stak(?:e|ing)|hold(?:ing)?|dump(?:ing)?)\b|\b(?:buy|sell|hold|hodl|ape into|load up on|accumulate) (?:now|today|it now|this now|the dip|more)\b|\b(?:i'm|we're|i am|we are) (?:buying|selling|shorting|longing|holding|accumulating|bullish|bearish)\b/i),
	p('investment', 'investment talk', /\b(?:invest|investing|investment|investments|portfolio|financial advice|investment advice|trading (?:advice|signals?|strategy)|buy signal|sell signal|buying opportunity)\b/i),
	p('yield-terms', 'return metrics (ROI, APY, APR)', /\b(?:ROI|APY|APR)\b/),
	p('cta', 'a wallet or promo call to action', /\b(?:connect (?:your|a) wallet|claim (?:your|the|an?) (?:airdrop|reward|tokens?|prize)|send (?:me|us) (?:your|some|\d)|dm (?:me|us)|enter your (?:seed|private|recovery)|share your (?:seed|private|recovery)|join (?:our|my) (?:telegram|discord|whatsapp)|use (?:my|our) (?:code|referral|promo code))\b/i),
];
/** Removed before the price patterns run (safety lines and security terms, as in the news gate). */
const PRICE_ALLOWED =
	/\b(?:not|isn'?t|is not|no|never) (?:financial|investment) advice\b|\b(?:price|prices) (?:oracle|oracles|feed|feeds|manipulation|data)\b|\b(?:oracle|manipulat(?:ed|ing|e)(?: the)?) prices?\b|\bpump\.fun\b|\bprice[- ]impact\b/gi;
/** "never share your seed phrase" is a safety tip, not a call to action. */
const NEGATED_BEFORE = /\b(?:never|don'?t|do not|won'?t|will not|nobody will|no one will|we'll never|we will never|stop|no real \w+ (?:will )?(?:ever )?)(?:\s+\w+){0,3}\s*$/i;

const PLACEHOLDERS =
	/\bTODO\b|\bTBD\b|\bFIXME\b|\bREPLACE(?:_ME)?\b|lorem ipsum|\bexample\.(?:com|org|net)\b|\[\s*(?:video|show|watch) link[^\]]*\]|\{\{|\}\}|\{%|%\}/gi;

// ---------------------------------------------------------------------------------------------
// Scanning

const URL_RE = /\bhttps?:\/\/[^\s<>"'“”)\]]+/g;
const EMAIL_RE = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g;

/** Replaces URLs and email addresses with neutral tokens so their characters never trip a text rule. */
export const maskLinks = (text: string): string => text.replace(URL_RE, ' LINK ').replace(EMAIL_RE, ' EMAIL ');

/** Splits text into sentences (and lines). */
export const sentences = (text: string): string[] =>
	text
		.split(/\n+/)
		.map((line) => line.replace(/^\s*[-*•]\s+/, '')) // list markers are not part of the sentence
		.flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-Z0-9"“‘(\[$])/))
		.map((s) => s.trim())
		.filter(Boolean);

/** Spans inside quotation marks (“...”, "...", ‘...’). */
const quotedSpans = (text: string): [number, number][] => {
	const spans: [number, number][] = [];
	for (const m of text.matchAll(/“[^”]*”|"[^"]*"|‘[^’]*’/g)) spans.push([m.index, m.index + m[0].length]);
	return spans;
};
const inside = (spans: [number, number][], index: number): boolean => spans.some(([a, b]) => index > a && index < b);

export type ScanContext = {
	where: string;
	allow?: NameAllow;
	/** Skip the unknown-capitalised-word warning (fixed text such as concept lines). */
	trusted?: boolean;
	/** A third-party headline about to be quoted (isSafeQuote): stricter name checks, since a refusal costs only a label. */
	headline?: boolean;
};

const finding = (rule: Rule, code: string, level: Level, where: string, message: string, match: string): Finding => ({rule, code, level, where, message, match: match.trim().slice(0, 120)});

/** Words before a legal or person verb that are not a name: roles, groups, numbers, nationalities, generic nouns. */
const notANameBeforeVerb = (word: string): boolean =>
	ROLE_SET.has(word) ||
	SPEAKER_NOUNS.has(word) ||
	COMMON_CAPS.has(word) ||
	ORG_SUFFIXES.has(word) ||
	NOT_A_NAME.has(word) ||
	DEMONYMS.has(word) ||
	NUMBER_WORDS.includes(word) ||
	GENERIC_NOUNS.has(word) ||
	SMALL_WORDS.has(word);

export const scanNames = (original: string, ctx: ScanContext): Finding[] => {
	const out: Finding[] = [];
	const add = (code: string, level: Level, message: string, match: string): void => void out.push(finding('names', code, level, ctx.where, message, match));
	const text = original;
	// the person checks read the text with allowed multi-word names blanked
	const blank = blankPhrases(original, ctx.allow);
	// the role, apposition and legal-verb checks blank only trusted names (the allowlist file, the show, publishers): a
	// name added for the day ("Investor Kiro", an incident's subject read from a headline) never hides a role and a name
	const strict = ctx.allow ? blankPhrases(original, {phrases: ctx.allow.trustedPhrases}) : original;
	for (const m of text.matchAll(PLACEHOLDER_NAME)) add('placeholder', 'error', "the radar's redaction placeholder: a person was named in the source. Leave this text out", m[0]);
	for (const m of text.matchAll(HANDLE)) {
		if (ctx.allow?.handles.has(m[0].toLowerCase()) ?? OWN_HANDLES.includes(m[0].toLowerCase())) continue;
		add('handle', 'error', 'a social media handle: name no individuals (describe the role instead)', m[0]);
	}
	for (const b of ctx.allow?.blocked ?? []) {
		// short entries ("CZ") must match as written; longer ones in any case
		const re = new RegExp(`(?<![\\w@])@?${escapeRe(b)}(?!\\w)`, b.length > 3 ? 'i' : '');
		if (re.test(text)) add('blocked', 'error', "a handle or nickname on the news gate's blocked list", b);
	}
	for (const m of blank.matchAll(HONORIFIC)) add('title-or-role', 'error', 'a person named by title', m[0]);
	for (const m of strict.matchAll(ctx.headline ? ROLE_BEFORE_HEADLINE : ROLE_BEFORE)) {
		// the role word's next capitalised word, in any case style ("Victim Kiro Loses ...", "researcher Jules finds ...")
		const first = bareWord(m[1] ?? '');
		// "Kiro’s Wallet" is a person's wallet, never an organisation called "Kiro Wallet"
		const second = m[2] && !/['’]s$/.test(m[1] ?? '') ? bareWord(m[2]) : '';
		if (!first || NOT_A_NAME.has(first) || ROLE_SET.has(first)) continue; // a verb or noun, or the next role's own match
		if (ORG_SUFFIXES.has(first) || ORG_SUFFIXES.has(second) || trustedWord(ctx.allow, first)) continue; // an organisation
		add('title-or-role', 'error', 'a person named after their role', `${m[0]}${(m[1] ?? '').replace(/^[‘“"'«‹(]+/, '')}`);
	}
	// "<Name> said he ...": a speaker who refers to himself or herself is a person, even at a sentence start or in a
	// Title Case headline, where the unknown-word check below cannot run; a product name that is also a given name
	// ("Claude said he lost $40,000") is no exception. In a quoted headline "they" counts too.
	const pronoun = ctx.headline ? PRONOUN_LATER_HEADLINE : PRONOUN_LATER;
	for (const m of blank.matchAll(CAPITALISED)) {
		const word = bareWord(m[0]);
		if (COMMON_CAPS.has(word) || ORG_SUFFIXES.has(word) || SPEAKER_NOUNS.has(word) || ROLE_SET.has(word) || knownWord(ctx.allow, word)) continue;
		const after = blank.slice(m.index + m[0].length);
		if (SPEECH_AFTER.test(after) && pronoun.test(after.replace(SPEECH_AFTER, ''))) add('speaker-name', 'error', 'a person named as the speaker ("X said he ...")', m[0]);
	}
	for (const m of strict.matchAll(APPOSITION)) {
		const words = (m[1] ?? '').split(/\s+/);
		if (words.every((w) => trustedWord(ctx.allow, w.toLowerCase()) || ORG_SUFFIXES.has(w.toLowerCase()))) continue;
		add('apposition', 'error', 'a person named with their role ("X, the founder")', m[0]);
	}
	for (const re of ctx.headline ? [APPOSITION_ONE, APPOSITION_HEADLINE, WHO_AFTER] : [APPOSITION_ONE, WHO_AFTER]) {
		for (const m of strict.matchAll(re)) {
			const words = (m[1] ?? '').split(/\s+/).map((w) => w.toLowerCase());
			if (words.every((w) => knownWord(ctx.allow, w) || ORG_SUFFIXES.has(w) || COMMON_CAPS.has(w) || SPEAKER_NOUNS.has(w) || ROLE_SET.has(w))) continue;
			add('apposition', 'error', 'a person named with their role ("X, a retiree", "X, who ...")', m[0]);
		}
	}
	for (const m of blank.matchAll(AGE)) add('age', 'error', 'a person named with their age', m[0]);
	// a name right before a verb only a person takes ("Lena Weiss Arrested ...", "Kiro was jailed")
	for (const m of strict.matchAll(LEGAL_BEFORE)) {
		const word = bareWord(m[1] ?? '');
		if (!word || notANameBeforeVerb(word) || trustedWord(ctx.allow, word)) continue;
		add('legal-name', 'error', 'a person named next to an arrest, charge or sentence: name officials by role, suspects never', m[0]);
	}
	for (const m of blank.matchAll(/(?<![\p{L}\p{N}_])(\p{Lu}\p{Ll}+)\s+(\p{Lu}[\p{Ll}'’-]+)(?![\p{L}\p{N}_])/gu)) {
		const first = fold(m[1] ?? '');
		const second = (m[2] ?? '').toLowerCase().replace(/['’]s$/, '');
		if (!FIRST_NAMES.has(first) || ORG_SUFFIXES.has(second) || NOT_A_NAME.has(second)) continue;
		if (knownWord(ctx.allow, first) && knownWord(ctx.allow, second)) continue;
		add('first-name', 'error', 'looks like a personal name (given name + surname)', m[0]);
	}
	if (ctx.headline) {
		// a quoted headline: refusing an unknown organisation costs a label, never a leak
		for (const m of blank.matchAll(PERSON_VERB_AFTER)) {
			const word = bareWord(m[1] ?? '');
			if (!word || notANameBeforeVerb(word) || knownWord(ctx.allow, word)) continue;
			add('name-verb', 'error', 'an unknown name right before a verb only a person takes ("X Loses", "X Says", "X Charged")', m[0]);
		}
		for (const m of strict.matchAll(POSSESSIVE_THINGS)) {
			const word = bareWord(m[1] ?? '');
			if (!word || notANameBeforeVerb(word) || trustedWord(ctx.allow, word)) continue;
			add('name-possessive', 'error', "a person's savings, wallet or family, by name", m[0]);
		}
		for (const m of blank.matchAll(BRACKETED_WORD)) {
			const word = bareWord(m[1] ?? '');
			if (!word || BRACKET_LABELS.has(word) || COMMON_CAPS.has(word) || knownWord(ctx.allow, word)) continue;
			add('bracketed-name', 'error', 'a name in brackets or guillemets', m[0]);
		}
		for (const m of blank.matchAll(HANDLE_SHAPE)) {
			if (knownWord(ctx.allow, (m[1] ?? '').toLowerCase())) continue;
			add('handle-shape', 'error', 'a word shaped like an online handle', m[0]);
		}
	}
	if (!ctx.trusted) {
		// A line or quoted headline in Title Case cannot tell names from words, so only the high-precision checks
		// above apply to it.
		for (const line of blank.split('\n')) {
			const quotes = quotedSpans(line);
			const titleQuotes = quotes.filter(([a, b]) => isTitleCase(line.slice(a + 1, b - 1)));
			// the words outside quotation marks decide whether the line itself is a headline
			const titleLine = isTitleCase(line.replace(/“[^”]*”|"[^"]*"|‘[^’]*’/g, ' '));
			for (const m of line.matchAll(CAPITALISED)) {
				const word = m[0].replace(/['’]s$/, '');
				const key = word.toLowerCase();
				if (inside(quotes, m.index) ? inside(titleQuotes, m.index) : titleLine) continue;
				if (sentenceStartAt(line, m.index) || COMMON_CAPS.has(key) || ORG_SUFFIXES.has(key)) continue;
				// a known one-word name; one that is also a personal name only outside a quoted headline
				if (ctx.allow?.tokens.has(key) && (!ctx.allow.ambiguous.has(key) || !inside(quotes, m.index))) continue;
				add('unknown-name', 'warning', 'an unknown capitalised word: if it is a person, leave it out', word);
			}
		}
	}
	return out;
};

export const scanHowTo = (text: string, ctx: ScanContext): Finding[] => {
	const out: Finding[] = [];
	const offensive = OFFENSIVE.test(text);
	for (const pat of HOWTO) {
		if (pat.contextual && !offensive) continue;
		for (const m of text.matchAll(pat.re)) out.push(finding('howto', pat.code, 'error', ctx.where, `${pat.label}: describe the mechanism at concept level only`, m[0]));
	}
	for (const s of sentences(text)) {
		const markers = s.match(SEQUENCE_MARKERS) ?? [];
		if (markers.length >= 2 && OFFENSIVE.test(s)) out.push(finding('howto', 'sequence', 'error', ctx.where, 'a sequence of attack steps reads as instructions: give one concept-level sentence', s));
	}
	// quoted words (third-party headlines, a source's statement) that are an instruction to an AI: a payload, whoever wrote
	// it, in any quotation-mark style: “…”, "…", ‘…’, '…' used as quotation marks (never an apostrophe), « » and ‹ ›
	const quotes = [
		...quotedSpans(text).map(([a, b]) => text.slice(a + 1, b - 1)),
		...[...text.matchAll(/(?<![\p{L}\p{N}])'(?=[\p{L}\p{N}])((?:[^'\n]|'(?=\p{L}))+?)(?<=[\p{L}\p{N}.,!?)])'(?![\p{L}\p{N}])/gu)].map((m) => m[1] ?? ''),
		...[...text.matchAll(/«\s*([^»\n]{2,400}?)\s*»|‹\s*([^›\n]{2,400}?)\s*›/gu)].map((m) => m[1] ?? m[2] ?? ''),
	];
	for (const raw of quotes) {
		const quote = raw.trim();
		if (quote.split(/\s+/).length >= 3 && isQuotedInstruction(quote)) out.push(finding('howto', 'ai-quoted-instruction', 'error', ctx.where, 'quotes an instruction to an AI (an injected prompt or a jailbreak): never repeat its words', quote));
	}
	return out;
};

export const scanAttribution = (text: string, ctx: ScanContext): Finding[] => {
	const out: Finding[] = [];
	for (const s of sentences(text)) {
		const attributed = ATTRIBUTION.test(s);
		for (const pat of ACCUSATIONS) {
			const m = s.match(new RegExp(pat.re.source, pat.re.flags.replace('g', '')));
			if (m && !attributed) out.push(finding('attribution', pat.code, 'error', ctx.where, `${pat.label} without a named source: "according to <source>, ..." or leave it out`, m[0]));
		}
		if (!attributed) {
			// one finding per group name, longest first ("Lazarus Group" hides "Lazarus")
			const named: string[] = [];
			for (const group of [...(ctx.allow?.groups ?? [])].sort((a, b) => b.length - a.length)) {
				if (named.some((n) => n.toLowerCase().includes(group.toLowerCase()))) continue;
				if (new RegExp(`(?<!\\w)${escapeRe(group)}(?!\\w)`, 'i').test(s)) named.push(group);
			}
			for (const group of named) out.push(finding('attribution', 'threat-group', 'error', ctx.where, 'a threat group is named without a source: "according to <source>, ..."', group));
		}
		const money = s.match(MONEY) ?? [];
		if (money.length > 0 && LOSS_WORDS.test(s)) {
			// "$X (reported by A) · $Y (reported by B)": one "reported by" per figure; else a single-source sentence
			const reportedBy = (s.match(/\breported by\b/gi) ?? []).length;
			const ok = reportedBy > 0 ? reportedBy >= money.length : LOSS_ATTRIBUTION.test(s) || QUOTED_ATTRIBUTION.test(s);
			if (!ok) out.push(finding('attribution', 'loss-unattributed', 'error', ctx.where, 'every loss figure must say who reported it ("$X, reported by <source>")', money.join(', ')));
		}
		if (money.length > 0 && AVERAGING.test(s)) out.push(finding('attribution', 'averaged', 'error', ctx.where, 'figures are never averaged or combined: list each with its source', s.match(AVERAGING)?.[0] ?? s));
	}
	return out;
};

export const scanSpeculation = (text: string, ctx: ScanContext): Finding[] => {
	const out: Finding[] = [];
	for (const s of sentences(text)) {
		const quotes = quotedSpans(s);
		// attribution must sit outside the quote: keep the quote marks, drop what is inside them
		const attributed = ATTRIBUTION.test(s.replace(/“[^”]*”/g, '“”').replace(/"[^"]*"/g, '""').replace(/‘[^’]*’/g, '‘’'));
		for (const pat of SPECULATION) {
			for (const m of s.matchAll(pat.re)) {
				if (attributed && inside(quotes, m.index)) continue; // a named source's own words, quoted
				out.push(finding('speculation', pat.code, 'error', ctx.where, `${pat.label}: state only what the sources confirm, or quote the source that says it`, m[0]));
			}
		}
	}
	return out;
};

export const scanPrice = (text: string, ctx: ScanContext): Finding[] => {
	const out: Finding[] = [];
	for (const hit of findClaims(text)) out.push(finding('price', 'income', 'error', ctx.where, `${hit.label}: no income, return or price claims, even quoted`, hit.match));
	const cleaned = text.replace(PRICE_ALLOWED, (m) => ' '.repeat(m.length));
	for (const pat of PRICE) {
		for (const m of cleaned.matchAll(pat.re)) {
			if (pat.code === 'cta' && NEGATED_BEFORE.test(cleaned.slice(Math.max(0, m.index - 60), m.index))) continue;
			out.push(finding('price', pat.code, 'error', ctx.where, `${pat.label}: cover the security story, not the market`, m[0]));
		}
	}
	return out;
};

export const scanPlaceholders = (text: string, ctx: ScanContext): Finding[] =>
	[...text.matchAll(PLACEHOLDERS)].map((m) => finding('placeholder', 'placeholder', 'error', ctx.where, 'a placeholder or template brace is left in the text', m[0]));

/** Every text rule on one piece of text (URLs and email addresses are masked first). */
export const scanText = (text: string, ctx: ScanContext): Finding[] => {
	const masked = maskLinks(text);
	return [
		...scanPlaceholders(text, ctx),
		...scanNames(masked, ctx),
		...scanHowTo(masked, ctx),
		...scanAttribution(masked, ctx),
		...scanSpeculation(masked, ctx),
		...scanPrice(masked, ctx),
	];
};

/** How a third-party headline is always shown: attributed and in quotation marks. */
export const quoteLine = (publisher: string, headline: string): string => `${publisher}: “${headline}”`;

/**
 * True when a third-party headline may be quoted as `<publisher>: “<headline>”`: no rule error in that
 * attributed form (quoteLine), and in sentence-case text no unknown capitalised word either (a lone surname the radar's
 * redaction missed). Fails closed.
 */
export const isSafeQuote = (headline: string, publisher: string, allow?: NameAllow): boolean => {
	if (!headline.trim() || /[“”"]/.test(headline)) return false; // nested quotes would hide what is quoted
	if (CJK_RUN.test(headline)) return false; // names in Chinese, Japanese or Korean script cannot be checked
	const ctx: ScanContext = {where: 'quote', allow: allow ? extendAllow(allow, [publisher], true) : makeAllow([publisher]), headline: true};
	const findings = [...scanText(quoteLine(publisher, headline), ctx), ...scanNames(maskLinks(headline), ctx)];
	// a text with no capital letter at all ("victim kiro loses ...") is read again in Title Case, where the role and
	// verb checks can see its names
	if (!/\p{Lu}/u.test(headline)) findings.push(...scanNames(maskLinks(headline).replace(/(?<![\p{L}\p{N}_'’])\p{Ll}/gu, (c) => c.toUpperCase()), ctx));
	return findings.every((f) => f.level !== 'error' && f.code !== 'unknown-name');
};

/** The name checks whose findings hold a person's name in their match. */
const PERSON_CODES = new Set(['title-or-role', 'first-name', 'apposition', 'age', 'speaker-name', 'legal-name', 'name-verb', 'name-possessive', 'bracketed-name', 'handle-shape', 'handle', 'blocked']);
const VERB_WORDS = new Set([...PERSON_VERBS, ...LEGAL_PERSON_VERBS, 'was', 'is', 'has', 'had', 'been', 'gets', 'got', 'being', 'who']);

/**
 * The words a text's person checks flag as a name, lower case without diacritics ("Victim Kiro Loses ..." -> kiro,
 * "Lena Weiss Arrested ..." -> lena, weiss). Read in headline mode, the strictest.
 */
export const personTokens = (text: string, allow?: NameAllow): Set<string> => {
	const out = new Set<string>();
	if (!text.trim()) return out;
	const ctx: ScanContext = {where: 'names', allow, headline: true, trusted: true};
	for (const f of scanNames(maskLinks(text), ctx)) {
		if (!PERSON_CODES.has(f.code)) continue;
		for (const raw of f.match.split(/[^\p{L}\p{N}'’-]+/u)) {
			const word = fold(bareWord(raw.replace(/^@/, '')));
			if (word.length < 3 || /^\d+$/.test(word)) continue;
			if (ROLE_SET.has(word) || NOT_A_NAME.has(word) || COMMON_CAPS.has(word) || ORG_SUFFIXES.has(word) || SMALL_WORDS.has(word) || VERB_WORDS.has(word) || DEMONYMS.has(word)) continue;
			if (APPOSITION_MODIFIERS.includes(word) || knownWord(allow, word)) continue;
			out.add(word);
		}
	}
	return out;
};

/**
 * A subject the radar read from a headline that looks like a person: a role word and the word after it ("Trader Kruw",
 * "Investor Kiro", "Memecoin Whale Kruw"), a given name and another word, or any other person check. Such a name is
 * never added to the day's allow set, and the brief names its incident by type instead.
 */
export const looksPersonal = (name: string, allow?: NameAllow): boolean => {
	const words = name.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) return false;
	// a name the allowlist file itself lists ("Trader Joe", the exchange) is an organisation
	const parts = tokenize(name);
	if (allow && (parts.length === 1 ? trustedWord(allow, parts[0] ?? '') : allow.trustedPhrases.includes(parts.join(' ')))) return false;
	const lower = words.map((w) => fold(bareWord(w)));
	for (let i = 0; i < lower.length - 1; i++) {
		if (ROLE_SET.has(lower[i] ?? '') && !NOT_A_NAME.has(lower[i + 1] ?? '') && !ORG_SUFFIXES.has(lower[i + 1] ?? '') && !ROLE_SET.has(lower[i + 1] ?? '')) return true;
		if (FIRST_NAMES.has(lower[i] ?? '') && !ORG_SUFFIXES.has(lower[i + 1] ?? '') && !NOT_A_NAME.has(lower[i + 1] ?? '')) return true;
	}
	// a single role word, or a role word as the last word ("Kiro Investor"), names no one on its own
	return personTokens(name, allow).size > 0;
};

/**
 * The words of a subject that may be a person ("Trader Kruw" -> Kruw, "Investor Kiro" -> Kiro): role words, common words
 * and organisation words are left out.
 */
export const subjectWords = (name: string): string[] =>
	name
		.split(/[^\p{L}\p{N}'’-]+/u)
		.map((w) => bareWord(w))
		.filter((w) => w.length >= 3 && !ROLE_SET.has(w) && !NOT_A_NAME.has(w) && !COMMON_CAPS.has(w) && !ORG_SUFFIXES.has(w) && !SMALL_WORDS.has(w) && !GENERIC_NOUNS.has(w));

/** The allow set with these words blocked: any text, quote or link that spells one is refused (one incident's subject). */
export const withBlocked = (allow: NameAllow, words: readonly string[]): NameAllow => (words.length ? {...allow, blocked: [...allow.blocked, ...words]} : allow);

/** Slug words that end the check of a role's next word: numbers, function and headline words. */
const plainSlugWord = (word: string, allow?: NameAllow): boolean =>
	/^\d/.test(word) || NOT_A_NAME.has(word) || ROLE_SET.has(word) || ORG_SUFFIXES.has(word) || COMMON_CAPS.has(word) || SMALL_WORDS.has(word) || GENERIC_NOUNS.has(word) || DEMONYMS.has(word) || knownWord(allow, word);

/**
 * Does the link's path spell a person's name? Outlets put the headline in the slug, so a name the radar missed in the
 * title sits in the link next to it ("/victim-kiro-loses-40000-...", "/lena-weiss-arrested-...", "/claude-72-loses-...").
 * Read as slug words: any word the headline's own person checks flag; a role word and the word after it; a given name
 * and the word after it; a word right before an age and a loss or legal verb.
 */
export const slugNamesPerson = (url: string, headline = '', allow?: NameAllow): boolean => {
	let path: string;
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
	if (words.length === 0) return false;
	const flagged = personTokens(headline, allow);
	// blocked handles and nicknames, and a withheld subject's words (withBlocked), in the link too
	for (const b of allow?.blocked ?? []) for (const w of fold(b).split(/[^a-z0-9]+/)) if (w.length >= 3) flagged.add(w);
	for (let i = 0; i < words.length; i++) {
		const w = words[i] ?? '';
		const next = words[i + 1] ?? '';
		if (flagged.has(w)) return true;
		if (!next) continue;
		if ((ROLE_SET.has(w) || FIRST_NAMES.has(w)) && !plainSlugWord(next, allow)) return true;
		if (/^[a-z]{3,}$/.test(w) && !plainSlugWord(w, allow) && /^\d{1,2}$/.test(next) && VERB_WORDS.has(words[i + 2] ?? '')) return true;
	}
	return false;
};

/** The outlet's address only ("https://www.example.com/"), for a link whose path names a person. */
export const urlOrigin = (url: string): string => {
	try {
		const u = new URL(url);
		return `${u.protocol}//${u.host}/`;
	} catch {
		return url;
	}
};

/** The label of a link withheld because its address names a person. */
export const WITHHELD_LINK_NOTE = "the link goes to the outlet: the article's address names a person";

/** Formats findings for a CLI report, errors first. */
export const formatFindings = (findings: readonly Finding[]): string[] =>
	[...findings]
		.sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1))
		.map((f) => `  ${f.level}: ${f.where}: [${f.rule}/${f.code}] ${f.message}${f.match ? ` ("${f.match}")` : ''}`);

export const hasErrors = (findings: readonly Finding[]): boolean => findings.some((f) => f.level === 'error');
