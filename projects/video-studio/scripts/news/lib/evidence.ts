/**
 * What a source actually says about a figure or a mechanism, read from its stored title and excerpts:
 *   - figureRoles: the role of a money figure where the source states it (a loss, or money being recovered, frozen,
 *     laundered or returned), so a claim cannot relabel "the DOJ seeks $1.17 billion" as "hackers stole $1.17 billion";
 *   - hedgedSpans: the clauses in which a source hedges ("suspected key theft", "suggesting potential handoffs"), so a
 *     claim cannot drop the hedge and state the source's suspicion as fact.
 * Pure. The role classes follow the radar's loss-versus-recovery rules (scripts/radar/radarlib/classify.py).
 */
import {LOSS_ROLE, NON_LOSS_ROLES, SOURCE_HEDGE, type FigureRole} from './lexicon.ts';
import {extractNumbers, matchNum, type DateParts, type Num} from './numbers.ts';
import {normalizePunct} from './text.ts';

/** Sentences of a stored text: sentence ends, semicolons and the " · " separators of structured tracker rows. */
export const splitSentences = (text: string): string[] =>
	normalizePunct(text)
		.split(/(?<=[.!?…])\s+(?=["(\p{Lu}\p{N}])|\s+·\s+|;\s+/u)
		.map((s) => s.trim())
		.filter(Boolean);

const BEFORE = 60;
const AFTER_NONLOSS = 32;
const AFTER_LOSS = 45;

/**
 * The role of the figure at [start, end) in text: a non-loss role found close by wins ("seeking to recover about $X",
 * "$X freezing order", "push $X through"), else a loss word near it ("lost $X", "$X hack"), else null (neutral, such as
 * "puts it at $X"). The window stops at the sentence boundary.
 */
export const roleNear = (text: string, start: number, end: number): FigureRole | null => {
	const src = normalizePunct(text);
	let before = src.slice(Math.max(0, start - BEFORE), start);
	const cut = Math.max(before.lastIndexOf('. '), before.lastIndexOf('; '), before.lastIndexOf(' · '), before.lastIndexOf('? '), before.lastIndexOf('! '));
	if (cut >= 0) before = before.slice(cut + 2);
	const afterAll = src.slice(end, end + AFTER_LOSS);
	const stop = afterAll.search(/[.;!?]\s|\s·\s/);
	const after = stop >= 0 ? afterAll.slice(0, stop) : afterAll;
	const near = `${before} ${after.slice(0, AFTER_NONLOSS)}`;
	for (const [role, re] of NON_LOSS_ROLES) if (re.test(near)) return role;
	if (LOSS_ROLE.test(`${before} ${after}`)) return 'loss';
	return null;
};

export type RoleHit = {role: FigureRole | null; text: string; raw: string};

/** Every place in `texts` that states figure n (same value and kind), with its role there. */
export const figureRoles = (texts: string[], n: Num, dates: DateParts[] = []): RoleHit[] => {
	const out: RoleHit[] = [];
	for (const t of texts) {
		for (const x of extractNumbers(t, {words: 'display'})) {
			if (x.kind !== 'money' && x.kind !== 'crypto') continue;
			if (!matchNum(n, [x], dates).ok && !matchNum(x, [n], dates).ok) continue;
			out.push({role: roleNear(t, x.start, x.end), text: t, raw: x.raw});
		}
	}
	return out;
};

export type HedgedSpan = {hedge: string; span: string; sentence: string};

/**
 * The hedged clauses of a stored text: the clause that holds a hedge word, from the clause boundary before it to the
 * one after it (", suggesting potential handoffs to China-based money launderers."; "The attacker, through a suspected
 * compromise of the signing key, drained ..." hedges only the compromise, not the drain). A headline such as "Chainflip
 * Suspects Key Theft" is one clause.
 */
export const hedgedSpans = (texts: string[]): HedgedSpan[] => {
	const out: HedgedSpan[] = [];
	for (const t of texts)
		for (const sentence of splitSentences(t)) {
			const re = new RegExp(SOURCE_HEDGE.source, 'gi');
			for (const m of sentence.matchAll(re)) {
				const at = m.index ?? 0;
				const head = sentence.slice(0, at);
				// the clause starts after the last comma, colon, dash, bracket or contrasting conjunction before the hedge
				const conj = [...head.matchAll(/\s(?:but|while|whereas|although|though|yet)\s/gi)].map((x) => (x.index ?? 0) + x[0].length - 1);
				const clauseStart = Math.max(head.lastIndexOf(','), head.lastIndexOf(':'), head.lastIndexOf(' - '), head.lastIndexOf('—'), head.lastIndexOf('('), ...conj);
				// ...and ends at the next one, or where a headline moves on to the stated part ("Suspects Key Theft in $12.6M Hack")
				const tail = sentence.slice(at + m[0].length);
				const stop = tail.search(/[,:;)—]|\s-\s|\s(?:but|while|whereas|although|though|yet)\s|\s(?:in|behind|after|amid|following|over)\s+(?:a\s+|an\s+|the\s+)?(?:\$|US\$|€|£|\d)/i);
				const span = sentence.slice(clauseStart >= 0 ? clauseStart + 1 : 0, stop >= 0 ? at + m[0].length + stop : sentence.length).trim();
				if (!out.some((h) => h.span === span)) out.push({hedge: m[0], span, sentence});
			}
		}
	return out;
};
