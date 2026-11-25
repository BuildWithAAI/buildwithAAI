/**
 * Lexicons and patterns for the news rules. Each pattern is case-insensitive unless noted. Exceptions (attributed
 * quotes, "never share your seed phrase", "price oracle") are applied in rules.ts, not here.
 * Scope (owner, 2026-11-24): crypto security AND AI security (prompt injection, malicious AI tools and skills,
 * deepfake and voice-clone scams, AI-powered phishing, AI-washing frauds). The same rules apply to both.
 */

/** contextual: only a problem when the same text (or scene) also uses attack vocabulary (OFFENSIVE). */
export type Pattern = {code: string; re: RegExp; label: string; contextual?: boolean};

const p = (code: string, label: string, re: RegExp, contextual = false): Pattern => ({code, label, contextual, re: new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')});

// ---- R3: accusations (always need an attribution) and causes (need one when the sentence is about a specific case)

/**
 * Who could be accused of helping an attack from the inside: staff, employees, engineers, insiders, "someone at
 * <org>". Used with ACCOMPLICE below (rule R3: an insider accusation on any surface needs an attribution and a source
 * whose excerpt says it).
 */
const STAFF =
	String.raw`(?:insiders?|(?:an?|one|some|several|two|three|the|its|their|his|her|our|a\s+few)\s+(?:own\s+)?(?:(?:it|devops|security|ops|operations|support|core|internal|senior|junior|former|ex-|rogue|disgruntled)\s+)?(?:staff(?:ers?)?|employees?|engineers?|developers?|devs?|workers?|contractors?|admins?|administrators?|team\s?members?|insiders?|personnel|operators?|signers?|executives?|managers?)|staff(?:ers)?|employees|engineers|developers|workers|contractors|personnel|team\s?members|members?\s+of\s+(?:the|its|their)\s+(?:staff|team|workforce)|someone|somebody|people\s+(?:at|inside|within|from)|anyone\s+(?:at|inside|within))`;
/** Attackers as the object of help ("helped the hackers", "let the attackers in"). */
const ATTACKER_OBJ = String.raw`(?:the\s+|those\s+|these\s+)?(?:attackers?|hackers?|thie(?:f|ves)|criminals?|exploiters?|scammers?|intruders?|crooks?|culprits?|perpetrators?|lazarus|north\s+korea(?:ns?)?)`;
/** Predicates that make a staff subject an accomplice (or that accuse on their own: colluded, in on it, in cahoots). */
const ACCOMPLICE =
	String.raw`(?:(?:help(?:ed|s|ing)?|aid(?:ed|s|ing)?|assist(?:ed|s|ing)?|enabl(?:ed|es|ing)|tip(?:ped|s|ping)?(?:\s+off)?|gave|give|gives|giving|hand(?:ed|s|ing)?(?:\s+over)?|sold|sell(?:s|ing)?|leak(?:ed|s|ing)?|pass(?:ed|es|ing)?|fed|feed(?:s|ing)?|work(?:ed|s|ing)?\s+with|cooperat(?:ed|es|ing)\s+with|collaborat(?:ed|es|ing)\s+with|sid(?:ed|es|ing)\s+with)(?:\s+(?:[\w'-]+\s+){0,2}?(?:to|for))?\s+${ATTACKER_OBJ}\b|(?:help(?:ed|s|ing)?|let|lets|letting)\s+them\s+(?:get\s+|break\s+|sneak\s+)?(?:in|inside|access)\b|let(?:s|ting)?\s+(?:the\s+)?(?:attackers?|hackers?|thieves|criminals?|intruders?|them|strangers?)\s+in\b|open(?:ed|s)?\s+the\s+(?:door|gate|way)\s+(?:for|to)\b|gave\s+(?:them|the\s+attackers|the\s+hackers)\s+(?:access|the\s+keys)|(?:was|were|is|are|been|being)\s+in\s+on\s+(?:it|this|that|the\s+(?:hack|attack|theft|heist|scheme|plot|exploit))|in\s+cahoots|collu(?:d(?:e|ed|es|ing)|sion)|conspir(?:e|ed|es|ing|acy|ators?)|accomplices?)`;

export const ACCUSATIONS: Pattern[] = [
	p('hacked-by', 'names who did it ("hacked by", "stolen by")', /\b(?:hacked|stolen|drained|exploited|attacked|breached|compromised|taken|phished|scammed|targeted) by\b/i),
	p('stole', 'says someone stole', /\b(?:stole|steals|stealing)\b/i),
	p('insider', 'alleges insider involvement', /\b(?:inside job|insider (?:job|attack|threat|theft|involvement|trading)|an insider|insiders? (?:stole|drained|took|did|were behind|was behind)|rogue (?:employee|developer|dev|insider|staffer|team member)|inside (?:man|men|help|source|accomplice)|help from (?:the )?inside|on the inside)\b/i),
	p('insider-help', 'says staff or insiders helped the attackers (an insider accusation)', new RegExp(String.raw`\b${STAFF}\b[^.!?;]{0,60}?\b${ACCOMPLICE}`, 'i')),
	p('accomplice', 'alleges collusion ("colluded", "in on it", "in cahoots", "accomplice")', new RegExp(String.raw`\b(?:(?:was|were|is|are|been|being)\s+in\s+on\s+(?:it|this|that|the\s+(?:hack|attack|theft|heist|scheme|plot|exploit))|in\s+cahoots|collu(?:d(?:e|ed|es|ing)|sion)|conspir(?:e|ed|es|ing|acy|ators?)|accomplices?)\b`, 'i')),
	p('negligence', 'blames the victim for negligence', /\b(?:asleep at the wheel|negligen(?:t|ce)|careless(?:ly|ness)?|reckless(?:ly|ness)?|incompeten(?:t|ce)|sloppy|lax security|dropped the ball|cut corners|should have known better)\b/i),
	p('rug', 'alleges a rug pull or exit scam', /\b(?:rug[- ]?pull(?:ed|s|ing)?|rugged|exit[- ]scam(?:med|s)?|pulled (?:the )?liquidity|dumped on)\b/i),
	p('fraud', 'alleges fraud', /\b(?:fraud(?:ulent|ster|sters)?|ponzi|pyramid scheme|defraud(?:ed|ing)?|scammed|embezzl\w*|swindl\w*|con artists?)\b/i),
	p('scam-label', 'labels something a scam', /\b(?:is|was|were|are) (?:a |an |just a )?(?:scam|scams|con)\b|\bscam (?:project|token|coin|team|exchange|platform)\b/i),
	p('behind', 'says who was behind it', /\b(?:behind|responsible for|blamed for) (?:the|this|that|these) (?:attack|attacks|hack|hacks|exploit|exploits|theft|heist|breach|drain|scam|campaign)\b|\b(?:orchestrated|perpetrated|masterminded|carried out) (?:the|this|that) (?:attack|hack|exploit|theft|heist|breach|drain|scam|campaign)\b/i),
	p('state-actor', 'attributes it to a state actor', /\b(?:north korean?|dprk|state[- ](?:sponsored|backed)|nation[- ]state|kremlin[- ]linked|iranian[- ]linked)\b/i),
	p('criminal', 'calls someone a criminal', /\b(?:criminal (?:group|gang|ring|syndicate|network|organi[sz]ation)|crime (?:ring|syndicate)|the (?:hacker|attacker|thief|exploiter|scammer|insider|culprit|perpetrator)s? (?:is|was|are|were) (?:a|an|the)\b)/i),
];

export const CAUSES: Pattern[] = [
	p('cause', 'states a cause (hack, exploit, drain, compromise, phishing, malware, injection, deepfake...)', /\b(?:hack(?:ed|s|ing)?|exploit(?:ed|s|ing)?|drain(?:ed|s|ing)?|stolen|theft|heist|breach(?:ed|es)?|compromis(?:e|ed|es|ing)|attack(?:ed|s)?|phish(?:ed|ing)|social[- ]engineer(?:ed|ing)|malicious|malware|launder(?:ed|ing)?|money[- ]launder\w*|leak(?:ed|s)?|backdoor(?:ed|s)?|vulnerab(?:le|ility|ilities)|flaw(?:s|ed)?|bug(?!\s+bount)|prompt[- ]injection|injected|jailbr(?:eak|eaks|oke|oken)|deepfake[sd]?|voice[- ]clon(?:e|ed|es|ing)|impersonat(?:ed|ing|ion)|poison(?:ed|ing)|hijack(?:ed|ing)?)\b/i),
];

/** Words that make a sentence about a specific incident (with no named entity or source tag). */
export const SPECIFIC_REF =
	/\b(?:the|this|that|its|their)\s+(?:hack|attack|exploit|theft|heist|breach|incident|drain|attacker|attackers|hacker|hackers|exploiter|thief|thieves|scammer|scammers|insider|team|developers?|protocol|exchange|bridge|project|platform|company|firm|founders?|deployer|wallet|pool|pools|contract|token|app|model|agent|plugin|skill|extension)\b/i;

/** Money amounts in a sentence with these words are loss amounts: "reported by X", never averaged. */
export const LOSS_WORDS =
	/\b(?:lost|loss(?:es)?|stolen|stole|drain(?:ed|s|ing)?|taken|took|siphon(?:ed)?|exploit(?:ed)?|hack(?:ed)?|theft|heist|missing|extracted|outflows?|wiped out|worth of|seized|frozen|froze|recovered|returned)\b/i;

export const AVERAGING = /\b(?:average|averag(?:ed|ing)|on average|mean|median|midpoint|split the difference|somewhere between|in total|combined|altogether|all told|total of)\b/i;

// ---- R5: no exploit how-tos (concept level only)

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A phrase with every letter in both cases, spaces as \s+ and either apostrophe: case-insensitive words inside a
 * case-sensitive pattern (Node 22 has no (?i:...) groups), so the product names next to them keep their case. */
const ci = (phrase: string): string =>
	phrase
		.split(/\s+/)
		.map((w) => escapeRe(w).replace(/['’]/g, "['’]").replace(/[a-z]/gi, (c) => `[${c.toLowerCase()}${c.toUpperCase()}]`))
		.join(String.raw`\s+`);
/** Reported instructions: what someone (the attack) told an AI to do. */
const INSTRUCT_VERBS = 'told|instructed|asked|ordered|directed|made|commanded|prompted';
/**
 * What the instruction made the AI do. Not the user's own trigger: "asked the assistant to summarise the page" is how
 * a prompt injection starts, and is fine to say.
 */
const AI_ACTIONS = 'open|send|paste|copy|upload|print|run|execute|read|delete|forward|email|e-mail|reveal|ignore|disable|download|install|write|post|leak|exfiltrate|share|transfer|grant|approve|push|publish|output|repeat|dump|encode';
const DETERMINERS = ['the', 'an', 'a', 'its', 'their', "a user's", "the user's", "the victim's", "victims'", "users'"];
const RECIPIENT_DET = `(?:(?:${DETERMINERS.map(ci).join('|')})\\s+)?`;
/** An AI by its generic name, with up to two describing words ("the coding agent", "AI assistants"). */
const AI_GENERIC = String.raw`(?:(?:AI|coding|browser|e-?mail|LLM|autonomous|shopping|support|research|hidden|malicious|enterprise)[-\s]+){0,2}(?:agent|assistant|model|chat\s?bot|AI|bot|copilot|LLM)s?`;
/** AI products an instruction can be addressed to, longest first, in their exact case ("Cursor", never "the cursor"). A bare "Copilot" is AI_GENERIC's. */
const AI_PRODUCT_NAMES = [
	'Microsoft 365 Copilot', 'Amazon Q Developer', 'Gemini Code Assist', 'Microsoft Copilot', 'Security Copilot', 'Perplexity Comet', 'ChatGPT Operator', 'GitHub Copilot',
	'Copilot Studio', 'ChatGPT Atlas', 'Claude Desktop', 'Google Gemini', 'M365 Copilot', 'Copilot Chat', 'Replit Agent', 'OpenAI Codex', 'Google Jules', 'Claude Code',
	'Gemini CLI', 'Antigravity', 'Codex CLI', 'Amazon Q', 'AWS Kiro', 'Roo Code', 'Perplexity', 'Windsurf', 'OpenClaw', 'Operator', 'DeepSeek', 'ChatGPT',
	'Codeium', 'Lovable', 'Mistral', 'Gemini', 'Claude', 'Cursor', 'Replit', 'Devin', 'Codex', 'Comet', 'Jules', 'Manus', 'Aider', 'Llama', 'Alexa', 'Grok', 'Kiro',
	'Cline', 'Qwen', 'Siri',
].map((n) => escapeRe(n).replace(/ /g, String.raw`\s+`));

export const HOWTO: Pattern[] = [
	p('code-span', 'a code span', /`[^`\n]+`/),
	p('hex', 'a hex address, hash, selector or calldata', /\b0x[0-9a-fA-F]{8,}\b/),
	p('long-hex', 'a long hex string (key, hash or calldata)', /\b[0-9a-fA-F]{40,}\b/),
	p('base58', 'a full Solana/Bitcoin-style address or signature', /\b(?=[1-9A-HJ-NP-Za-km-z]*\d)(?=[1-9A-HJ-NP-Za-km-z]*[A-Za-z])[1-9A-HJ-NP-Za-km-z]{32,90}\b/),
	p('function-call', 'a function call or signature', /\b[A-Za-z_][A-Za-z0-9_]*\((?!s\)|es\))[^()\n]{0,80}\)/),
	p('snake-case', 'a code identifier (snake_case)', /\b[a-z][a-z0-9]*_[a-z0-9_]*[a-z0-9]\b/),
	p('evm-code', 'smart-contract code terms', /\b(?:msg\.sender|tx\.origin|delegatecall|selfdestruct|sstore|sload|calldataload|uint(?:8|16|32|64|128|256)|bytes32|address\(this\)|onlyOwner|pragma solidity|abi\.encode\w*|keccak256|ecrecover|create2|storage slot \d+|slot 0)\b/i),
	p('shell', 'a shell command', /\b(?:curl|wget) https?:|\b(?:npm (?:i|install)|pip install|git clone|forge (?:test|script)|cast (?:send|call)|hardhat (?:run|test)|npx [\w@/.-]+|python3? [\w/.-]+\.py|node [\w/.-]+\.js)\b/i),
	p('payload', 'payload, calldata or exploit-code talk', /\b(?:payloads?|call ?data|bytecode|byte code|opcodes?|function selectors?|abi[- ]encoded|shellcode|proof[- ]of[- ]concept|exploit (?:code|script|contract|kit)|attack (?:contract|script)|raw transaction|signature hash)\b/i),
	p('poc', 'proof-of-concept talk', /\bPoCs?\b/),
	p('how-to', '"how to bypass / exploit / ..."', /\bhow (?:to|you can|you could|anyone can|one can|they could) (?:bypass|exploit|hack|drain|steal|attack|phish|launder|mix|rug|scam|crack|break into|get around|evade|trick|clone|deepfake|spoof|jailbreak|inject|impersonate|replicate|reproduce|front-?run|sandwich|manipulate|sneak|pull off|repeat|copy|recreate|do the same|run the same|pull the same)\b/i),
	p('tutorial', 'tutorial or step-by-step framing', /\b(?:step[- ]by[- ]step|walkthrough|walk-through|tutorial|cheat ?sheet)\b/i, true),
	p('here-is-how', '"here\'s how to"', /\bhere(?:'s| is) (?:exactly )?how (?:to|you|anyone|they could)\b/i, true),
	p('same-trick', 'an invitation to repeat the attack ("the same trick on any exchange")', /\b(?:pull off|repeat|copy|replicate|recreate|run|try|use) (?:the |this |that )?same (?:trick|attack|hack|exploit|scam|playbook|technique|method) (?:on|against|at) (?:any|other|another|your)\b/i),
	p('try-it', 'an invitation to reproduce it', /\b(?:try (?:this|it) (?:yourself|at home)|you can (?:do|try|replicate|reproduce) (?:this|it)|(?:replicate|reproduce|recreate) (?:the|this|that) (?:attack|exploit|hack|jailbreak|injection)|copy (?:this|the) (?:prompt|code|script|payload|command))\b/i),
	p('step-marker', 'a numbered step', /\bstep (?:one|two|three|four|five|six|\d+)\b/i, true),
	p('numbered-list', 'a numbered list', /(?:^|\n)\s*\d+[.)]\s/, true),
	p('injection-string', 'a prompt-injection or jailbreak string', /\b(?:ignore (?:all |any )?(?:previous|prior|above|earlier|preceding) (?:instructions|prompts|messages|rules)|disregard (?:all |any )?(?:previous|prior|above) (?:instructions|rules)|(?:jailbreak|injection) (?:prompt|payload|string|template)s?|(?:DAN|do anything now) prompt|system prompt\s*[:=]|developer mode prompt)\b/i),
	p('placeholder-code', "the radar's [code]/[address]/[instruction] placeholder", /\[\s*(?:code|address|instruction)\s*\]/i),
	// the AI lane: what an attack told an AI to do, quoted or paraphrased, is a how-to (a prompt-injection payload or a
	// jailbreak recipe), whoever said it
	p('ai-addressed', 'text addressed to an AI (an injected instruction)', /\b(?:AI|A\.I\.|assistants?|agents?|models?|chat ?bots?|LLMs?|copilots?)\s+(?:reading|processing|summari[sz]ing|parsing|browsing|seeing)\s+(?:this|these)\b/i),
	p('roleplay-instruction', 'a jailbreak instruction ("pretend", "you are now", "no rules")', /\b(?:you are now (?:a|an|in|the|DAN|free|unrestricted|jailbroken|uncensored)|pretend (?:you\b|that you\b|to be\b|it (?:is|was) an? (?:AI|assistant|model|chatbot|bot))|act as (?:an? )?(?:unrestricted|unfiltered|uncensored|jailbroken|evil|DAN)\b|role-?play(?:ing|ed)? as|developer mode|forget (?:everything|all) (?:above|before)|(?:ignore|disregard|override) (?:its|your|their|the|all) (?:rules|guidelines|instructions|safeguards|guardrails)|(?:an? )?(?:AI|assistant|model|chatbot|bot) with(?:out)? (?:no )?(?:rules|restrictions|limits|guardrails|filters)\b)/i),
	p('told-the-agent', 'an instruction the attack gave the AI, repeated', new RegExp(String.raw`\b(?:${INSTRUCT_VERBS})\s+${RECIPIENT_DET}${AI_GENERIC}\s*(?::|["“]|to\s+(?:${AI_ACTIONS})\b)|\b(?:the )?(?:hidden )?(?:text|comment|note|instruction|prompt|message|page) (?:said|read|told|asked)\s*:`, 'i')),
	// the same with the AI named by product ("The README told Copilot to upload the env file"): exact case, so "the
	// cursor" or "an operator" never match
	p('told-the-agent', 'an instruction the attack gave the AI, repeated', new RegExp(String.raw`\b(?:${INSTRUCT_VERBS.split('|').map(ci).join('|')})\s+${RECIPIENT_DET}(?:${AI_PRODUCT_NAMES.join('|')})(?:['’]s)?(?:\s+(?:${['agent', 'assistant', 'extension', 'CLI', 'IDE', 'chatbot', 'bot', 'model'].map(ci).join('|')}))?\s*(?::|["“]|${ci('to')}\s+(?:${AI_ACTIONS.split('|').map(ci).join('|')})\b)`, 'u')),
	p('bypass-setting', 'the setting that got past a safeguard', /\b(?:["“]?don['’]t ask again["”]?|always allow|auto-?approv\w*|auto-?run|yolo mode|skip(?:ped|s|ping)? the (?:confirmation|approval|permission) (?:prompt|step|dialog))\b/i),
];

/**
 * AI stories only (R5): a quote framed as the attack's own text ("the hidden text said “...”", "the README read:
 * ..."). Quoted words in an AI story are an organisation's statement, never the payload.
 */
export const AI_QUOTE_FRAME =
	/\b(?:the|a|an|its|this|that)\s+(?:(?:hidden|malicious|injected|invisible|poisoned|crafted|booby-trapped|white|tiny)\s+){0,2}(?:text|comments?|note|instructions?|prompts?|message|page|web\s?page|website|site|README|file|e-?mail|issue|document|doc|PDF|(?:calendar\s+)?invite|ticket|pull\s+request|commit\s+message|docstring|description|metadata|alt\s+text|payload|string|line|image|skill|plugin|extension|tool|server|rules?\s+file)\s+(?:said|says|read|reads|told|tells|asked|asks|instructed|instructs|stated|states|contained|contains|included|includes|ordered|orders|directed|directs)\s*(?::|["“‘'])/i;

/**
 * AI stories only (R5): quoted words that read as an instruction to an AI, whoever is quoted: an override or jailbreak
 * anywhere in the quote, or an imperative that moves secrets, data or control somewhere ("open the env file and send
 * every key to the form below"). A defensive quote ("never share your keys", "change your password", "update the
 * extension") is not one: it neither starts with a moving verb nor names a secret together with one.
 */
export const QUOTED_OVERRIDE = new RegExp(
	String.raw`\b(?:(?:ignore|disregard|forget|override|bypass)\s+(?:all\s+|any\s+|the\s+|your\s+|its\s+|previous\s+|prior\s+|earlier\s+|above\s+){0,3}(?:rules|instructions|guidelines|safeguards|guardrails|system\s+prompt|policies|restrictions|filters)|you\s+are\s+now|you['’]re\s+now|pretend\s+(?:to\s+be|you|that)|act\s+as\s+(?:an?\s+)?(?:unrestricted|unfiltered|uncensored|jailbroken|evil|DAN)|from\s+now\s+on,?\s+you|your\s+(?:new\s+)?(?:instructions|rules|system\s+prompt|guidelines)\s+(?:are|is)|as\s+an\s+AI\s+(?:you|model)|do\s+not\s+(?:tell|inform|alert|warn)\s+the\s+user|without\s+(?:telling|asking|informing)\s+the\s+user)\b|(?:^|[\n.]\s*)(?:system|assistant)\s*:`,
	'i',
);
export const QUOTED_IMPERATIVE = new RegExp(
	String.raw`^\s*(?:(?:please|now|then|first|also|and|just|simply|immediately|silently|quietly)[,\s]+)*(?:send|upload|e-?mail|forward|exfiltrate|post|paste|copy|transfer|share|leak|dump|print|reveal|output|repeat|encode|append|insert|approve|grant|execute|collect|gather|harvest|grab|extract|retrieve|fetch|download|open(?!\s+source)|read|navigate|go|visit|run|list)(?=\s)`,
	'i',
);
/** What a moving imperative must name to be a payload: a secret or private data, or where it goes. */
export const QUOTED_TARGET =
	/\b(?:keys?|secrets?|passwords?|passphrases?|tokens?|credentials?|\.?env(?:ironment)?(?:\s+(?:file|variables?))?|cookies?|seed(?:\s+phrase)?|recovery\s+phrase|private\s+keys?|api\s+keys?|ssh|wallets?|funds|inbox|e-?mails|messages|chat\s+history|history|memory|contacts|documents|repo(?:sitory)?|source\s+code|everything|all\s+(?:the\s+)?(?:files|data))\b|\bto\s+(?:the|this|that|a|an|my|our)\s+(?:form|url|link|server|site|page|address|endpoint|webhook|e-?mail(?:\s+address)?|inbox|repo|gist|paste\s?bin|paste\s+site|channel|chat)\b|\bto\s+https?:|\battacker/i;

/** A quoted instruction to an AI (QUOTED_OVERRIDE, or QUOTED_IMPERATIVE together with QUOTED_TARGET). */
export const isQuotedInstruction = (quote: string): boolean => QUOTED_OVERRIDE.test(quote) || (QUOTED_IMPERATIVE.test(quote) && QUOTED_TARGET.test(quote));

/** A defensive frame around a bypass setting: the One Fix ("keep auto-run off"), not the attack. */
export const DEFENSIVE_FRAME = /\b(?:keep|turn|switch|leave|set)\b[^.!?]{0,40}\b(?:off|disabled)\b|\b(?:disable|never (?:enable|use|turn on)|don['’]t (?:enable|use|turn on)|avoid|untick|uncheck)\b/i;

/** Characters that render as nothing: format controls (tags, zero-width and bidi controls), variation selectors, fillers. */
export const INVISIBLE_CHARS = /[\p{Cf}\u034F\u115F\u1160\u17B4\u17B5\u180B-\u180F\u3164\uFFA0\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/u;
export const INVISIBLE_ALL = new RegExp(INVISIBLE_CHARS.source, 'gu');

/** Attack verbs: a step list or sequence that uses them reads as instructions. */
export const OFFENSIVE =
	/\b(?:exploit\w*|attack\w*|bypass\w*|inject\w*|manipulat\w*|forg(?:e|ed|ing)|spoof\w*|impersonat\w*|phish\w*|front-?run\w*|re-?enter\w*|reentran\w*|flash[- ]?loan\w*|borrow\w*|craft\w*|deploy\w* (?:a |the )?malicious|call(?:ed|ing|s)? (?:the|a) (?:function|method)|invok\w*|mint(?:ed|ing)? (?:fake|unbacked)|launder\w*|mixer|mix(?:ed|ing) (?:the )?funds|tumbl\w*|obfuscat\w*|evad\w*|cash(?:ed|ing)? out|jailbr\w*|clon(?:e|ed|ing) (?:a |the |their )?voice|drain\w*|steal\w*|stole|sign(?:ed|ing)? (?:a |the )?malicious|swap(?:ped|ping)? (?:the )?stolen|bridg(?:e|ed|ing) (?:the )?stolen)\b/i;

export const SEQUENCE_MARKERS =
	/\b(?:first(?:ly)?|second(?:ly)?|third(?:ly)?|then|next|after that|afterwards|after this|from there|once (?:it|that|this|they|the|inside|in)|with (?:it|that|those|this|them),|finally|lastly|starts? (?:by|with)|begins? (?:by|with)|followed by|step (?:one|two|three|\d+))\b/gi;

/** Who performs an attack step ("the attacker", "they") and who is acted on ("the victim", "the engineer"). */
export const ACTOR_REF = /\b(?:attackers?|hackers?|exploiters?|scammers?|thie(?:f|ves)|they|them|criminals?|intruders?|the (?:victim|engineer|employee|developer|target|user|staffer)s?)\b/i;

/**
 * Verbs that open an attack step when they start an on-screen item or a diagram node ("Send a fake job offer",
 * "Grab the session token", "Victim runs test repo"). Defensive checklists start with DEFENSIVE_VERBS instead.
 */
export const ACTION_VERBS = new Set(
	`send sends sent post posts posted get gets got grab grabs grabbed take takes took steal steals stole run runs ran
make makes made trick tricks tricked lure lures lured phish phishes phished install installs installed deploy deploys
deployed upload uploads uploaded download downloads downloaded call calls called sign signs signed withdraw withdraws
withdrew drain drains drained swap swaps swapped bridge bridges bridged launder launders laundered mix mixes mixed move
moves moved transfer transfers transferred exfiltrate exfiltrates exfiltrated copy copies copied paste pastes pasted
import imports imported click clicks clicked open opens opened inject injects injected mint mints minted borrow borrows
borrowed craft crafts crafted forge forges forged spoof spoofs spoofed hijack hijacks hijacked compromise compromises
compromised access accesses accessed reach reaches reached use uses used obtain obtains obtained harvest harvests
harvested capture captures captured gain gains gained escalate escalates escalated pivot pivots pivoted cash cashes
cashed dump dumps dumped approve approves approved execute executes executed build builds built create creates created
pose poses posed impersonate impersonates impersonated email emails emailed message messages messaged dm dms`.split(/\s+/),
);

/** Verbs that open a defensive checklist item ("Verify the address", "Never run test files"). */
export const DEFENSIVE_VERBS = new Set(
	`verify check confirm double-check enable turn keep never don't dont avoid rotate revoke lock separate split add require
store back update patch review limit monitor report read compare ignore delete remove block refuse decline reject set
treat assume ask hang pause slow wait learn bookmark type simulate audit train teach plan rehearse prefer choose pick
switch stop beware watch spot doubt question`.split(/\s+/),
);

/** Words that put an on-screen list item in an attack's context (what the attacker used, took or targeted). */
export const ATTACK_OBJECT =
	/\b(?:fake|malware|malicious|credentials?|session (?:tokens?|cookies?)|cookies?|signing (?:service|key)s?|private keys?|seed phrases?|withdraw\w*|drain\w*|victims?|exploit\w*|steal\w*|stole\w*|phish\w*|test (?:repo|file|project|task)s?|repos?|payloads?|backdoor\w*|attackers?|hackers?|fresh wallets?|stolen)\b/i;

/** Link words between diagram nodes that make the nodes an ordered sequence of steps. */
export const SEQUENCE_LINK = /^\s*(?:then|next|and then|after that|afterwards|followed by|finally|step \d+|→|->|=>)\s*$/i;

// ---- R1: the role of a money figure (reusing the radar's loss / recovery / freeze / laundering classes)

export type FigureRole = 'loss' | 'recovery' | 'freeze' | 'laundering' | 'returned' | 'other-money';

/** Roles other than a loss, checked first: "seeking to recover $X" is never a loss, even in a hack story. */
export const NON_LOSS_ROLES: Array<[Exclude<FigureRole, 'loss'>, RegExp]> = [
	['recovery', /\b(?:recover\w*|seek\w*|sought|seiz\w*|forfeit\w*|confiscat\w*|claw(?:ed|s|ing)? back|reclaim\w*|repatriat\w*)\b/i],
	['freeze', /\b(?:freez\w*|froze|frozen|blacklist\w*|intercept\w*)\b/i],
	['laundering', /\b(?:launder\w*|mixers?|mix(?:ed|es|ing)|coinjoins?|tumbl\w*|push(?:ed|es|ing)?|moves?|moved|moving|funnel\w*|cash(?:ed|es|ing)? out|handoffs?)\b/i],
	['returned', /\b(?:return\w*|refund\w*|reimburs\w*|compensat\w*|bount(?:y|ies)|repa(?:id|y\w*)|restitution|cover(?:ed|s|ing)? (?:the |all |user |users' )?loss\w*)\b/i],
	['other-money', /\b(?:rais(?:e|ed|es|ing)|funding|valuation|revenue|tvl|market cap\w*|insurance|loans?)\b/i],
];
export const LOSS_ROLE = /\b(?:lost|loss(?:es)?|los(?:e|es|ing)|stole|stolen|steal\w*|theft|thefts|heist|drain\w*|hack\w*|exploit\w*|siphon\w*|taken|took|extract\w*|loot\w*|swiped|robbed|wiped out|missing|outflows?|breach\w*|gone|compromis\w*)\b/i;

export const ROLE_WORDS: Record<FigureRole, string> = {
	loss: 'a loss',
	recovery: 'money being recovered, sought or seized',
	freeze: 'money frozen or intercepted',
	laundering: 'money moved or laundered after the theft',
	returned: 'money returned, refunded or offered as a bounty',
	'other-money': 'another kind of amount (funding, value, price or insurance)',
};

// ---- R6: hedges in the sources ("suspected", "potential") that a claim must keep

/** A hedge in a source's own words: the source does not state the predicate as fact. */
export const SOURCE_HEDGE =
	/\b(?:suspect(?:s|ed|ing)?|suspicious|potential(?:ly)?|apparent(?:ly)?|alleged(?:ly)?|unconfirmed|unverified|unidentified|as-yet|may have|might have|could have|possibl[ey]|likely|probabl[ey]|under investigation|investigating|being investigated|appears? to|seem(?:s|ed)? to|believed to|reportedly|purportedly|suggest(?:s|ed|ing)?|anomal(?:y|ies|ous)|unclear|remains? unknown|is unknown|not (?:yet )?(?:known|confirmed|clear)|false alarm)\b/i;

/** A hedge in our own wording that keeps the source's uncertainty. */
export const CLAIM_HEDGE =
	/\b(?:suspect(?:s|ed|ing)?|suspicious|potential(?:ly)?|apparent(?:ly)?|alleged(?:ly)?|unconfirmed|unverified|unidentified|may|might|could|possibl[ey]|likely|probabl[ey]|under investigation|investigating|being investigated|appears? to|seem(?:s|ed)? to|believed to|reportedly|suggest(?:s|ed|ing)?|unclear|unknown|not (?:yet )?(?:known|confirmed|clear)|developing)\b/i;

// ---- R6: speculation (allowed only as a quote attributed to a source that says it)

export const SPECULATION: Pattern[] = [
	p('hedge', 'a hedge ("probably", "maybe", "apparently")', /\b(?:probably|presumably|possibly|perhaps|maybe|supposedly|apparently|seemingly|conceivably)\b/i),
	p('likely', '"likely" / "unlikely"', /\b(?:likely|unlikely)\b/i),
	p('seems', '"seems" / "appears" / "looks like"', /\b(?:it seems|seems to|seems like|it appears|appears to|looks like (?:an?|the) (?:inside|insider|rug|scam|exit|state|north)|smells like|reeks of)\b/i),
	p('rumor', 'rumour or anonymous sourcing', /\b(?:rumou?r(?:s|ed)?|word is|people are saying|some say|insiders say|sources say|unconfirmed reports?|speculat\w*|conspiracy|conspiracies|theor(?:y|ies|ize|ized|ise|ised))\b/i),
	p('opinion', 'a guess presented as analysis', /\b(?:i think|we think|i believe|we believe|i bet|we bet|my guess|our guess|i suspect|we suspect|i'd bet|we'd bet|chances are|odds are|wouldn'?t be surprised|who knows|must have been|had to be|has to be|no doubt|clearly an? (?:inside|insider|scam|rug|exit)|obviously an? (?:inside|insider|scam|rug|exit)|definitely an?|surely)\b/i),
	p('might-have', '"might / may / could have"', /\b(?:might|may|could) have (?:been|had|known|helped|done|used|stolen|taken|planned)\b/i),
	p('reportedly', '"reportedly" / "allegedly" without a named source', /\b(?:reportedly|allegedly|purportedly)\b/i),
];

// ---- R9: no price talk, financial advice or income claims

export const PRICE: Pattern[] = [
	p('price', 'price talk', /\b(?:price|prices|priced|pricing)\b/i),
	p('price-move', 'a price move', /\b(?:fell|drop(?:ped)?|plunged|crashed|tanked|slumped|sank|dipped|tumbled|surged|soared|jumped|rose|rallied|pumped|spiked|climbed|rebounded|slid|nosedived|cratered)\b[^.!?]{0,40}?\d+(?:\.\d+)?\s?(?:%|percent)|\b\d+(?:\.\d+)?\s?(?:%|percent)\s+(?:drop|fall|gain|rise|jump|slide|plunge|crash|rally|pump|dump|decline|increase|surge)\b/i),
	p('market-talk', 'market talk', /\b(?:market cap(?:itali[sz]ation)?|mcap|all[- ]time highs?|bull(?:ish| run| market)|bear(?:ish| market)|to the moon|mooning|lambo|buy the dip|dip buying|bottom(?:ed)? out|top signal|price targets?|undervalued|overvalued|oversold|overbought|resistance level|support level|breakout|trading at|worth buying|good entry|entry point|chart pattern)\b/i),
	p('ath', 'market talk', /\bATH\b/),
	p('advice', 'buy/sell/hold advice', /\b(?:you should|you'd better|you must|time to|consider|start|stop|go) (?:buy(?:ing)?|sell(?:ing)?|short(?:ing)?|long(?:ing)?|ap(?:e|ing)|invest(?:ing)?|stak(?:e|ing)|hold(?:ing)?|dump(?:ing)?)\b|\b(?:buy|sell|hold|hodl|ape into|load up on|accumulate|short|long) (?:now|today|it now|this now|the dip|more)\b|\b(?:i'm|we're|i am|we are) (?:buying|selling|shorting|longing|holding|accumulating|bullish|bearish)\b/i),
	p('investment', 'investment talk', /\b(?:invest|investing|investment|investments|portfolio|financial advice|investment advice|trading (?:advice|signals?|strategy)|buy signal|sell signal|buying opportunity)\b/i),
	p('income', 'an income or return claim', /\b(?:make money|earn (?:\$|money|up to|passive|\d)|passive income|get rich|guaranteed (?:returns?|profits?|income|yield)|risk[- ]free (?:returns?|profits?|income)|returns? of \d|\d{2,}x\b|free money|double your|you (?:could|can|will|would) (?:have )?(?:made|make|earn|earned|profit|profited|win|won)|profit from)\b/i),
	p('yield-terms', 'return metrics (ROI, APY, APR)', /\b(?:ROI|APY|APR)\b/),
	p('worth-more', 'a value or price move ("worth even more today")', /\bworth (?:even |much |far |a lot |twice as much |)?(?:more|less)\b|\b(?:now|today) worth\b|\bvalue (?:has |have )?(?:risen|fallen|grown|dropped|increased|decreased|soared|surged|tanked|collapsed)\b|\b(?:gain(?:ed|s|ing)?|los(?:t|es|ing)) (?:its |their |much of its |much of their )?value\b/i),
	p('holdings', 'holdings or purchases of crypto ("bought another 457 BTC")', /\b(?:bought|buys|buying|purchas(?:ed|es|ing)|acquir(?:ed|es|ing)|accumulat(?:ed|es|ing)|added|adds|holds|holding|holdings of|owns|treasury of)\s+(?:another\s+|an additional\s+|a further\s+|more\s+|over\s+|about\s+|some\s+|nearly\s+|almost\s+)?\$?\d[\d,.]*\s*(?:k|m|b|thousand|million|billion)?\s*(?:btc|eth|sol|bnb|bitcoins?|ether|tokens?|coins?|usdc|usdt)\b|\b(?:bought|buys|buying|purchas(?:ed|es|ing)|accumulat(?:ed|es|ing)) (?:more |the |some )?(?:bitcoin|btc|ether|eth|solana|sol|bnb|xrp|tokens|coins|stablecoins|crypto)\b/i),
	p('peg', 'peg talk (a stablecoin holding or losing its peg)', /\b(?:held|holds|holding|kept|keeps|keep|lost|loses|losing|broke|breaks|regained|regains|restored) (?:its|their|the|a) (?:dollar )?peg\b|\bde-?peg(?:ged|s|ging)?\b|\bpeg (?:held|broke|holds|broken)\b/i),
	p('advice-hold', 'advice on where to keep savings or coins', /\b(?:keep|move|put|park|hold|convert|switch|swap|store) (?:your |all your |some of your |their )?(?:savings|money|coins|crypto|funds|assets|holdings|tokens|portfolio|cash|stack)\s+(?:in|into|to)\s+(?:usdc|usdt|dai|stablecoins?|bitcoin|btc|eth|ether|ethereum|solana|sol|gold|cash|fiat|dollars)\b/i),
	p('advice-safe', 'advice that funds are safe or need no action (solvency or withdrawal advice)', /\byour (?:coins|funds|money|crypto|assets|deposits|savings|balance|tokens) (?:on|at|with|in) [\w.]+ (?:are|is) (?:safe|fine|secure|protected)\b|\b(?:no need to|don'?t need to|do not need to|nothing to worry|no reason to|safe to) (?:withdraw|sell|buy|move|panic|hold)\b/i),
	p('cta', 'a wallet or promo call to action (cryptophishing risk)', /\b(?:connect (?:your|a) wallet|claim (?:your|the|an?) (?:airdrop|reward|tokens?|prize)|send (?:me|us) (?:your|some|\d)|dm (?:me|us)|enter your (?:seed|private|recovery)|share your (?:seed|private|recovery)|link in (?:bio|description)|join (?:our|my) (?:telegram|discord|whatsapp)|use (?:my|our) (?:code|referral|link|promo code))\b/i),
];

/** Words for a token, coin or market as the subject of a price move ("BNB tanked", "with bitcoin rallying"). */
export const PRICE_SUBJECT_WORDS = new Set(
	`bitcoin btc ether ethereum eth solana sol bnb xrp doge dogecoin usdc usdt dai stablecoin stablecoins token tokens coin
coins crypto cryptocurrency cryptocurrencies altcoin altcoins memecoin memecoins market markets price prices stock stocks
shares hype pepe shib bonk wif trx tron cardano ada avax avalanche polkadot litecoin ltc monero xmr`.split(/\s+/),
);
/** Price-direction verbs (with no number needed). */
export const PRICE_VERB =
	/^(?:tank(?:ed|s|ing)?|rall(?:y|ied|ies|ying)|dump(?:ed|s|ing)?|pump(?:ed|s|ing)?|collaps(?:e|ed|es|ing)|crash(?:ed|es|ing)?|plung(?:e|ed|es|ing)|soar(?:ed|s|ing)?|surg(?:e|ed|es|ing)|tumbl(?:e|ed|es|ing)|slump(?:ed|s|ing)?|crater(?:ed|s|ing)?|nosediv(?:e|ed|es|ing)|moon(?:ed|s|ing)?|spik(?:e|ed|es|ing)|rebound(?:ed|s|ing)?|fell|falls?|falling|drop(?:ped|s|ping)?|rose|rises?|rising|jump(?:ed|s|ing)?|slid|slides?|sliding|sank|sinks?|sinking|dip(?:ped|s|ping)?|climb(?:ed|s|ing)?|gain(?:ed|s|ing)?|sell-?off|selloff)$/i;
/** Pump/dump in a title or thumbnail is market talk whatever the subject. */
export const PUMP_DUMP = /\b(?:dump|dumps|dumped|dumping|pump|pumps|pumped|pumping)\b/i;

/** Allowed phrases removed before the price patterns run. */
export const PRICE_ALLOWED = /\b(?:not|isn'?t|is not|no|never) (?:financial|investment) advice\b|\b(?:price|prices) (?:oracle|oracles|feed|feeds|manipulation|data)\b|\b(?:oracle|manipulat(?:ed|ing|e)(?: the)?) prices?\b|\bpump\.fun\b|\bprice[- ]impact\b|\binvest(?:ed|ing|s)? (?:\w+ ){0,2}(?:in|into) (?:security|audits?|training|monitoring|defen[cs]es?|safety|protection|tooling|bug bounties)\b/gi;

/** "never share your seed phrase" is a safety tip, not a call to action. */
export const NEGATED_CTA = /\b(?:never|don'?t|do not|won'?t|will not|nobody will|no one will|we'll never|we will never|stop) (?:\w+ ){0,3}$/i;

// ---- R10: don't redraw or embed others' material

export const OTHERS_MATERIAL: Pattern[] = [
	p('screenshot', 'a screenshot or a redrawn chart', /\b(?:screenshot(?:s|ted)?|screen ?grabs?|screencaps?|redraw(?:n|ing|s)?|re-drawn|recreat(?:e|ed|ing) (?:their|the|its|this|that) (?:chart|graph|diagram|image|infographic|map|thumbnail))\b/i),
	p('credited-media', 'media credited to someone else', /\b(?:chart|graph|diagram|image|infographic|footage|video|clip|photo|thumbnail|logo|artwork|map)s? (?:from|by|courtesy of|credited to) (?=[A-Z])/),
	p('their-media', "someone else's chart or image shown on screen", /\b[A-Z][\w.&-]*(?:'s|’s) (?:chart|graph|diagram|infographic|map|image|photo|video|footage|thumbnail|screenshot|logo|artwork)s?\b/),
];

/** onScreen keys that would embed someone else's media. */
export const MEDIA_KEYS = /^(?:image|images|img|picture|photo|photos|screenshot|screenshots|embed|embeds|tweet|tweets|post|logo|logos|video|footage|media|gif|thumbnailImage|artwork)$/i;

// ---- R2: the developing label, per language (labels may stay in English)

export const DEVELOPING_WORDS: Record<string, RegExp> = {
	en: /\bdeveloping\b/i,
	es: /\ben desarrollo\b|\bdeveloping\b/i,
	'pt-br': /\bem (?:desenvolvimento|andamento)\b|\bdeveloping\b/i,
	it: /\bin (?:sviluppo|corso|aggiornamento)\b|\bdeveloping\b/i,
	hi: /\bdeveloping\b|जारी/i,
	zh: /进展中|持续更新|发展中|developing/i,
	ja: /進行中|続報|developing/i,
};

export const ruleTitle: Record<string, string> = {
	INPUT: 'Inputs readable and well formed',
	R1: 'Every [src:id] claim matches a brief fact; its numbers, names and quotes are in the cited excerpt',
	R2: 'Developing stories carry a visible DEVELOPING label and say so aloud',
	R3: 'Accusations, causes and loss amounts are attributed to a named source',
	R4: 'No personal names (only allowlisted officials from cited law-enforcement or regulator releases)',
	R5: 'No exploit how-tos: concept level only, no code, function names, payloads or step lists',
	R6: 'No speculation unless quoted from a source that says it',
	R7: 'Real analysis in every video (storyboard.analysis, presented in a scene)',
	R8: 'Corrections are valid, carry a pinned comment, and are never repeated',
	R9: 'No price talk, financial advice or income claims',
	R10: "Don't redraw or embed others' material",
	GEN: 'General claim gate (scripts/claims)',
};
