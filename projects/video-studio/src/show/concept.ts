/**
 * Concept-level guard for on-screen show text (pure). The claim gate (scripts/news) is the full check for exploit
 * how-tos; this is the renderer's own defence in depth: it refuses to DRAW anything that looks like code, an address,
 * a link or a numbered attack sequence, whatever the storyboard says. Mechanisms stay at concept level
 * ("a leaked key let attackers upgrade the contract"), never function names, payloads or steps.
 */

export type ConceptProblem = {code: string; match: string; msg: string};

const RULES: Array<{code: string; re: RegExp; msg: string}> = [
	{code: 'address', re: /\b0x[0-9a-fA-F]{8,}\b/, msg: 'a hex address or hash'},
	{code: 'base58', re: /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/, msg: 'a long base58 string (an address or signature)'},
	{code: 'url', re: /\bhttps?:\/\/\S+|\bwww\.[a-z0-9-]+\.[a-z]{2,}\S*/i, msg: 'a link'},
	{code: 'call', re: /\b[A-Za-z_][A-Za-z0-9_]*\([^)]*\)/, msg: 'a function call'},
	{code: 'code-verb', re: /\b(?:set|get|transfer|approve|call|exec|execute|init|initialize|withdraw|deposit|mint|burn|swap|claim|update|upgrade|delegate|permit|flash|selfdestruct)[A-Z][A-Za-z0-9]*\b/, msg: 'a code identifier'},
	{code: 'camel', re: /\b[a-z]{2,}(?:[A-Z][a-z0-9]+){2,}\b/, msg: 'a code identifier'},
	{code: 'snake', re: /\b[a-z][a-z0-9]*_[a-z0-9_]+\b/, msg: 'a code identifier'},
	{code: 'code-chars', re: /`|=>|::|\{|\}|;\s*$|\b(?:function|require|assert|revert|msg\.sender|tx\.origin|calldata|bytes32|uint256|abi\.encode)\b/, msg: 'code syntax'},
	{code: 'step', re: /^\s*(?:step\s*\d+\b|\d+\s*[.)]\s+\S)/i, msg: 'a numbered step'},
];

/**
 * Problems in one on-screen string. `steps` also flags a numbered step ("1. ...", "Step 2"): on for diagram labels,
 * where a numbered sequence would turn a concept into instructions; off for defensive lists such as a fix.
 */
export const conceptProblems = (text: string, opts: {steps?: boolean} = {}): ConceptProblem[] => {
	const out: ConceptProblem[] = [];
	for (const r of RULES) {
		if (r.code === 'step' && !opts.steps) continue;
		const m = r.re.exec(text);
		if (m) out.push({code: r.code, match: m[0], msg: r.msg});
	}
	return out;
};
