/**
 * Fixed, reviewed text for the Threat Brief: plain-terms definitions of DefiLlama's incident classes (concept level,
 * no mechanism detail, no accusation) and Zoo's One Fix per explainer topic. The tests run every line here through
 * the same safety rules as the generated text, so an edit that breaks a rule fails the suite.
 *
 * A definition describes a CATEGORY, never a specific incident, and the brief always shows it as the source's own
 * category: "DefiLlama's category “Key Compromise” covers ...". It never says how the incident worked: sources can
 * disagree with a category (for the 2026-11-21 Chainflip incident DefiLlama's category was "Key Compromise" while its
 * own text described an exploited vulnerability in a signing system), so a definition must not add a claim, cause or
 * consequence about the incident it sits next to (no "so no code bug is needed").
 */

/**
 * DefiLlama's 13 `classification` values on /hacks (verified against the live API by the radar, 2026-11-24;
 * video-studio/scripts/radar/README.md), each with the noun phrase that completes "<source>'s category “X” covers ...".
 */
export const CLASS_CONCEPTS: Readonly<Record<string, string>> = {
	'Access Control': 'cases where someone gained permissions they should not have had, such as an admin role or a setting left open.',
	'Protocol Logic': "flaws in how a protocol's own rules were designed or written.",
	'Token & Share Accounting': 'errors in how a protocol counts balances or shares.',
	'Key Compromise': 'cases where someone other than the rightful holder gained control of a key that can approve transactions.',
	'Oracle Manipulation': "cases where a protocol's data feed was pushed to a false value.",
	'Frontend & Infrastructure': 'attacks on the systems around a protocol, such as websites, servers, cloud accounts or the keys kept there, rather than on its smart contracts.',
	'Input Validation': 'code that accepted data it should have rejected.',
	Reentrancy: 'cases where a contract was called back into before it had finished updating its own records.',
	'Social Engineering': 'cases where people were tricked, for example with a fake job offer or a fake support chat.',
	'Bridge & Cross-Chain': 'incidents at the systems that move assets between blockchains.',
	Rugpull: 'cases where the people in control of a project are reported to have removed its funds.',
	Governance: "cases where a protocol's own voting system was used to pass a harmful change.",
	'Market Manipulation': 'trading designed to make a protocol misjudge positions or collateral.',
};

/** Explainer topics the radar assigns (`evergreenTopic`), each with Zoo's One Fix for viewers. */
export const FIXES: Readonly<Record<string, string>> = {
	drainers: 'Before you approve anything in your wallet, read what it is asking to do. If you cannot tell, reject it.',
	'address-poisoning': 'Copy addresses from your own saved contacts, never from your transaction history, and check the whole address before you send.',
	phishing: 'Open crypto sites from your own bookmarks, never from ads, search results or links in messages.',
	'key-management': 'Keep long-term funds on a hardware wallet, and never type its recovery phrase into a website, an app or a chat.',
	'bridge-security': 'Only move what you need across a bridge, and do not leave funds sitting on one.',
	'oracle-manipulation': 'Before you deposit into a protocol, check that it has a public audit and an active bug bounty.',
	'rug-pulls': "If one wallet can change a token's rules or move its funds, treat that token as unsafe.",
	'social-engineering': 'Verify every request to install software, share your screen or sign something through a second channel you already trust.',
	'fake-job-malware': 'No real employer needs you to install software or run code from a stranger to get through an interview. Refuse, and verify the company through its official site.',
	// the AI-security lane (radar evergreen topics "ai-security" and "ai-scams", and two type-only fixes)
	'ai-security': 'Give AI agents, plugins and coding tools only the access they need, install them only from publishers you can verify, and never paste passwords or keys into an AI tool.',
	'ai-scams': 'If a call, video or message asks for money or a code, hang up and call back on a number you already trust, even when the voice or face looks right.',
	'ai-attacks': 'Install security updates promptly and turn on multi-factor authentication for every account that offers it.',
	'ai-washing': "Treat 'AI-powered' as a sales claim until the company shows evidence, and never pay up front for a promised result.",
};

/** The fix when no topic fits. */
export const DEFAULT_FIX = 'Never share a recovery phrase or private key with anyone. No real support team will ever ask for it.';

/** The radar's incident `type` mapped to an explainer topic, for incidents without an `evergreenTopic`. */
export const TYPE_TOPIC: Readonly<Record<string, string>> = {
	drainer: 'drainers',
	phishing: 'phishing',
	'key-compromise': 'key-management',
	'social-engineering': 'social-engineering',
	bridge: 'bridge-security',
	oracle: 'oracle-manipulation',
	rug: 'rug-pulls',
	'prompt-injection': 'ai-security',
	'ai-agent-exploit': 'ai-security',
	'malicious-ai-tool': 'ai-security',
	'model-supply-chain': 'ai-security',
	'ai-data-exposure': 'ai-security',
	'ai-assisted-attack': 'ai-attacks',
	'deepfake-fraud': 'ai-scams',
	'ai-phishing': 'ai-scams',
	'ai-washing': 'ai-washing',
};

/** Plain-language source kinds for link labels. */
export const KIND_LABEL: Readonly<Record<string, string>> = {
	structured: 'incident database',
	postmortem: 'post-mortem',
	research: 'research',
	blog: 'research',
	news: 'article',
};

/** The category part of a DefiLlama label: "Key Compromise / Validator Key Compromised" -> "Key Compromise". */
export const categoryOf = (label: string): string => label.split(' / ')[0]?.trim() ?? '';

/**
 * The definition of a label's category, worded as the source's category and never as how an incident worked:
 * conceptFor("Key Compromise / Validator Key Compromised", "DefiLlama") ->
 * "DefiLlama's category “Key Compromise” covers cases where ...". Null when the category has no reviewed definition.
 */
export const conceptFor = (label: string, by: string): string | null => {
	const category = categoryOf(label);
	const definition = CLASS_CONCEPTS[category];
	const who = by.trim();
	return definition && who ? `${who}'s category “${category}” covers ${definition}` : null;
};

/** Zoo's One Fix for an explainer topic or incident type (falls back to the default fix). */
export const fixFor = (topic: string | null, type: string | null): {text: string; topic: string | null} => {
	const key = topic && FIXES[topic] ? topic : type && TYPE_TOPIC[type] && FIXES[TYPE_TOPIC[type]] ? TYPE_TOPIC[type] : null;
	return key ? {text: FIXES[key] ?? DEFAULT_FIX, topic: key} : {text: DEFAULT_FIX, topic: null};
};
