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
	return {
		tokens,
		phrases: [...phrases].sort((a, b) => b.length - a.length),
		ambiguous: new Set([...AMBIGUOUS_NAMES, ...[...ambiguous].map((a) => a.trim().toLowerCase()).filter(Boolean)]),
		blocked: [...blocked].map((b) => b.trim()).filter(Boolean),
		handles: new Set(OWN_HANDLES),
		groups: [...groups].map((g) => g.trim()).filter((g) => g.length >= 3),
	};
};

/** Adds names (an incident's protocol, today's publishers) to an allow set. */
export const extendAllow = (allow: NameAllow, names: Iterable<string>): NameAllow => {
	const tokens = new Set(allow.tokens);
	const phrases = new Set(allow.phrases);
	addNames(tokens, phrases, names);
	return {...allow, tokens, phrases: [...phrases].sort((a, b) => b.length - a.length)};
};

/**
 * The text with every allowed multi-word name blanked (same length, so positions do not move): the person checks
 * then never read a product or organisation phrase as a name, and never read its words outside the phrase as known.
 */
export const blankPhrases = (text: string, allow?: NameAllow): string => {
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
handle page site mode program programme bounty bounties funds money savings life loans news threat threats general
order environment environments server servers machines code repo repos repository repositories project projects app apps
behind over after into against under amid via from by as who whose whom that which while when where how why what
is are was were be been has had have will would could can may might must should did does do not no
the a an and of to in on at for with or but`.split(/\s+/),
);

/**
 * Role, title and kinship words after which a capitalised word reads as a person's name, plus the words that introduce
 * a nickname ("dubbed", "aka"). Matched in any case: a Title Case headline capitalises them ("Victim Kiro Loses ...").
 */
const ROLE_WORDS = `CEO CTO COO CFO CISO founder co-founder cofounder chairman chairwoman developer engineer employee hacker attacker
suspect trader influencer researcher investigator sleuth analyst spokesperson spokesman spokeswoman director lawyer attorney
prosecutor judge senator minister president streamer youtuber whale insider defendant plaintiff victim teenager student
programmer dev investor teen man woman boy girl scammer fraudster whistleblower podcaster journalist reporter entrepreneur
billionaire millionaire executive exec owner grandmother grandfather grandma grandpa mother father mom dad son daughter
wife husband widow widower retiree pensioner named dubbed nicknamed alias aka`.split(/\s+/);
const ROLE_SET = new Set(ROLE_WORDS.map((w) => w.toLowerCase()));
/** Each ASCII letter as a class of both cases ("Victim", "VICTIM", "victim"), since Node 22 has no (?i:...) groups. */
const anyCase = (word: string): string => word.replace(/[a-z]/gi, (c) => `[${c.toLowerCase()}${c.toUpperCase()}]`);
// Names may start with any capital letter ("José", "Łukasz", "Özgür", "Сергей"): \p{Lu}/\p{L} with the u flag, and a
// letter lookbehind instead of \b (which only knows ASCII letters). The name is read in a lookahead, so the next role
// word can start its own match ("Student Hacker Kiro"); an opening quotation mark may sit between ("Hacker ‘Sora’").
const NAME_TOKEN = `[‘“"']?\\p{Lu}[\\p{L}\\p{N}'’-]*`;
const ROLE_BEFORE = new RegExp(
	`(?<![\\p{L}\\p{N}_])(?:${[...ROLE_WORDS].sort((a, b) => b.length - a.length).map(anyCase).join('|')})\\s+(?=(${NAME_TOKEN})(?:\\s+(${NAME_TOKEN}))?)`,
	'gu',
);
/** A token as a lower-case word: no surrounding quotation marks, no possessive. */
const bareWord = (token: string): string => token.replace(/^[‘“"']+|[’”"']+$/g, '').replace(/['’]s$/, '').toLowerCase();

/** "<Name> said ... he/she": whoever speaks of himself or herself is a person (as the news gate's SPEECH_AFTER). */
const SPEECH_AFTER =
	/^(?:['’]s)?\s+(?:also\s+|later\s+|then\s+|now\s+)?(?:said|says|told|tells|added|adds|wrote|writes|posted|tweeted|explained|explains|noted|notes|warned|warns|claimed|claims|argued|argues|insisted|insists|denied|denies|admitted|admits|stated|states|recalled|recalls|testified|testifies)\b/iu;
const PRONOUN_LATER = /^[^.!?]*?(?<![\p{L}\p{N}_])(?:he|she|his|her|him|hers|himself|herself)(?![\p{L}\p{N}_])/iu;
/** Speakers that are not one person ("Prosecutors said he ...", "Officials say she ..."). */
const SPEAKER_NOUNS = new Set(
	`officials official prosecutors authorities investigators researchers regulators analysts experts victims attackers hackers
scammers users customers sources lawyers judges documents filings records witnesses neighbors neighbours relatives family
friends staff employees executives agents officers detectives police court courts reports company firm government
spokesperson representatives`.split(/\s+/),
);
const HONORIFIC = /(?<![\p{L}\p{N}_])(?:Mr|Mrs|Ms|Dr|Sir|Dame|Prof)\.?\s+\p{Lu}[\p{Ll}'’-]+/gu;
const APPOSITION =
	/(?<![\p{L}\p{N}_])(\p{Lu}[\p{Ll}'’-]+(?:\s+\p{Lu}[\p{Ll}'’-]+)+),\s+(?:the\s+|a\s+|an\s+|its\s+|their\s+)?(?:former\s+|ex-|co-|chief\s+|lead\s+|alleged\s+|pseudonymous\s+|anonymous\s+)?(?:founder|co-founder|cofounder|ceo|cto|coo|cfo|developer|engineer|employee|hacker|attacker|suspect|trader|influencer|researcher|investigator|analyst|executive|spokesperson|director|owner|insider|whale|programmer|victim|defendant|lawyer|attorney|partner|manager|head)\b/giu;
const AGE = /(?<![\p{L}\p{N}_])\p{Lu}[\p{Ll}'’-]+,\s*(?:aged\s+)?\d{1,2},/gu;
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

const escapeRe = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

// What an attack told an AI to do, with the AI named generically or by product (the news gate's lexicon.ts, 2026-11-25)
/** A phrase with every letter in both cases, spaces as \s+ and either apostrophe, for use inside a case-sensitive pattern. */
const ci = (phrase: string): string =>
	phrase
		.split(/\s+/)
		.map((w) => escapeRe(w).replace(/['’]/g, "['’]").replace(/[a-z]/gi, (c) => `[${c.toLowerCase()}${c.toUpperCase()}]`))
		.join(String.raw`\s+`);
const INSTRUCT_VERBS = 'told|instructed|asked|ordered|directed|made|commanded|prompted';
/** What the instruction made the AI do; never the user's own trigger ("asked the assistant to summarise the page"). */
const AI_ACTIONS = 'open|send|paste|copy|upload|print|run|execute|read|delete|forward|email|e-mail|reveal|ignore|disable|download|install|write|post|leak|exfiltrate|share|transfer|grant|approve|push|publish|output|repeat|dump|encode';
const RECIPIENT_DET = `(?:(?:${['the', 'an', 'a', 'its', 'their', "a user's", "the user's", "the victim's", "victims'", "users'"].map(ci).join('|')})\\s+)?`;
const AI_GENERIC = String.raw`(?:(?:AI|coding|browser|e-?mail|LLM|autonomous|shopping|support|research|hidden|malicious|enterprise)[-\s]+){0,2}(?:agent|assistant|model|chat\s?bot|AI|bot|copilot|LLM)s?`;
/** AI products, longest first, in their exact case ("Cursor", never "the cursor"; "Operator", never "an operator"). A bare "Copilot" is AI_GENERIC's. */
const AI_PRODUCT_NAMES = [
	'Microsoft 365 Copilot', 'Amazon Q Developer', 'Gemini Code Assist', 'Microsoft Copilot', 'Security Copilot', 'Perplexity Comet', 'ChatGPT Operator', 'GitHub Copilot',
	'Copilot Studio', 'ChatGPT Atlas', 'Claude Desktop', 'Google Gemini', 'M365 Copilot', 'Copilot Chat', 'Replit Agent', 'OpenAI Codex', 'Google Jules', 'Claude Code',
	'Gemini CLI', 'Antigravity', 'Codex CLI', 'Amazon Q', 'AWS Kiro', 'Roo Code', 'Perplexity', 'Windsurf', 'OpenClaw', 'Operator', 'DeepSeek', 'ChatGPT',
	'Codeium', 'Lovable', 'Mistral', 'Gemini', 'Claude', 'Cursor', 'Replit', 'Devin', 'Codex', 'Comet', 'Jules', 'Manus', 'Aider', 'Llama', 'Alexa', 'Grok', 'Kiro',
	'Cline', 'Qwen', 'Siri',
].map((n) => escapeRe(n).replace(/ /g, String.raw`\s+`));

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
	p('told-the-agent', 'an instruction the attack gave the AI, repeated', new RegExp(String.raw`\b(?:${INSTRUCT_VERBS})\s+${RECIPIENT_DET}${AI_GENERIC}\s*(?::|["“]|to\s+(?:${AI_ACTIONS})\b)`, 'i')),
	// the AI named by product ("The README told Copilot to upload the env file"), in its exact case
	p('told-the-agent', 'an instruction the attack gave the AI, repeated', new RegExp(String.raw`\b(?:${INSTRUCT_VERBS.split('|').map(ci).join('|')})\s+${RECIPIENT_DET}(?:${AI_PRODUCT_NAMES.join('|')})(?:['’]s)?(?:\s+(?:${['agent', 'assistant', 'extension', 'CLI', 'IDE', 'chatbot', 'bot', 'model'].map(ci).join('|')}))?\s*(?::|["“]|${ci('to')}\s+(?:${AI_ACTIONS.split('|').map(ci).join('|')})\b)`, 'u')),
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
};

const finding = (rule: Rule, code: string, level: Level, where: string, message: string, match: string): Finding => ({rule, code, level, where, message, match: match.trim().slice(0, 120)});

export const scanNames = (original: string, ctx: ScanContext): Finding[] => {
	const out: Finding[] = [];
	const add = (code: string, level: Level, message: string, match: string): void => void out.push(finding('names', code, level, ctx.where, message, match));
	const text = original;
	// the person checks read the text with allowed multi-word names blanked
	const blank = blankPhrases(original, ctx.allow);
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
	for (const m of blank.matchAll(ROLE_BEFORE)) {
		// the role word's next capitalised word, in any case style ("Victim Kiro Loses ...", "researcher Jules finds ...")
		const first = bareWord(m[1] ?? '');
		// "Kiro’s Wallet" is a person's wallet, never an organisation called "Kiro Wallet"
		const second = m[2] && !/['’]s$/.test(m[1] ?? '') ? bareWord(m[2]) : '';
		if (!first || NOT_A_NAME.has(first) || ROLE_SET.has(first)) continue; // a verb or noun, or the next role's own match
		if (ORG_SUFFIXES.has(first) || ORG_SUFFIXES.has(second) || knownWord(ctx.allow, first)) continue; // an organisation
		add('title-or-role', 'error', 'a person named after their role', `${m[0]}${(m[1] ?? '').replace(/^[‘“"']+/, '')}`);
	}
	// "<Name> said he ...": a speaker who refers to himself or herself is a person, even at a sentence start or in a
	// Title Case headline, where the unknown-word check below cannot run; a product name that is also a given name
	// ("Claude said he lost $40,000") is no exception
	for (const m of blank.matchAll(CAPITALISED)) {
		const word = bareWord(m[0]);
		if (COMMON_CAPS.has(word) || ORG_SUFFIXES.has(word) || SPEAKER_NOUNS.has(word) || ROLE_SET.has(word) || knownWord(ctx.allow, word)) continue;
		const after = blank.slice(m.index + m[0].length);
		if (SPEECH_AFTER.test(after) && PRONOUN_LATER.test(after.replace(SPEECH_AFTER, ''))) add('speaker-name', 'error', 'a person named as the speaker ("X said he ...")', m[0]);
	}
	for (const m of blank.matchAll(APPOSITION)) {
		const words = (m[1] ?? '').split(/\s+/);
		if (words.every((w) => knownWord(ctx.allow, w.toLowerCase()) || ORG_SUFFIXES.has(w.toLowerCase()))) continue;
		add('apposition', 'error', 'a person named with their role ("X, the founder")', m[0]);
	}
	for (const m of blank.matchAll(AGE)) add('age', 'error', 'a person named with their age', m[0]);
	for (const m of blank.matchAll(/(?<![\p{L}\p{N}_])(\p{Lu}\p{Ll}+)\s+(\p{Lu}[\p{Ll}'’-]+)(?![\p{L}\p{N}_])/gu)) {
		const first = fold(m[1] ?? '');
		const second = (m[2] ?? '').toLowerCase().replace(/['’]s$/, '');
		if (!FIRST_NAMES.has(first) || ORG_SUFFIXES.has(second) || NOT_A_NAME.has(second)) continue;
		if (knownWord(ctx.allow, first) && knownWord(ctx.allow, second)) continue;
		add('first-name', 'error', 'looks like a personal name (given name + surname)', m[0]);
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
	// quoted words (third-party headlines, a source's statement) that are an instruction to an AI: a payload, whoever wrote it
	for (const [a, b] of quotedSpans(text)) {
		const quote = text.slice(a + 1, b - 1).trim();
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
	const ctx: ScanContext = {where: 'quote', allow: allow ? extendAllow(allow, [publisher]) : makeAllow([publisher])};
	const findings = [...scanText(quoteLine(publisher, headline), ctx), ...scanNames(maskLinks(headline), ctx)];
	return findings.every((f) => f.level !== 'error' && f.code !== 'unknown-name');
};

/** Formats findings for a CLI report, errors first. */
export const formatFindings = (findings: readonly Finding[]): string[] =>
	[...findings]
		.sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1))
		.map((f) => `  ${f.level}: ${f.where}: [${f.rule}/${f.code}] ${f.message}${f.match ? ` ("${f.match}")` : ''}`);

export const hasErrors = (findings: readonly Finding[]): boolean => findings.some((f) => f.level === 'error');
