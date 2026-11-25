/**
 * Explainable, rule-based scam scorer for YouTube comments.
 *
 * Every rule in rules.ts that fires adds its weight to the score, and each one becomes a reason the
 * owner can read in the report. A score of 7 or more is 'hold' (the guard may hold the comment for
 * review), 4 to 6 is 'review' (listed in the report only), anything lower is 'allow'.
 *
 * Context that changes the score:
 * - Comments from your own channels, or from channels you trust, are always allowed.
 * - Scam phrases quoted inside a warning ("ignore anyone who says 'text me on WhatsApp'") do not count;
 *   quoted scam phrases without a warning count half.
 * - The same text posted by several different accounts (a copy-paste burst) adds the burst weight.
 */
import {burstTokens, makeView, nameSkeleton, splitQuotes, stripReplyPrefix} from './normalize.ts';
import {BURST_RULE, type PreparedIdentity, type RuleContext, RULES} from './rules.ts';

export const HOLD_AT = 7;
export const REVIEW_AT = 4;
/** YouTube allows 10,000 characters; scams are short, so only the start of very long comments is read. */
export const MAX_ANALYZED_CHARS = 4000;

export type Action = 'hold' | 'review' | 'allow';

export type Reason = {
	rule: string;
	weight: number;
	explanation: string;
	/** The text that matched, shortened. */
	evidence: string;
};

export type Verdict = {score: number; action: Action; reasons: Reason[]};

export type CommentInput = {
	id: string;
	text: string;
	authorName: string;
	authorChannelId: string | null;
};

/** Who "we" are. Names are protected against impersonation; own and trusted channels are never flagged. */
export type Identity = {
	channelIds: string[];
	names: string[];
	/**
	 * Names protected like `names`, but against look-alikes only one letter away instead of two: their skeleton
	 * sits two letters from ordinary names ("Zoodger News" folds to "zoodger": Rodger, Dodger, Booger). A name
	 * in `names` with the same skeleton (a saved account's title, say) gets the same one-letter limit.
	 */
	closeNames?: string[];
	trustedChannelIds?: string[];
	/** Handles or links the channel itself uses (e.g. its own Telegram bot); they never count as scam contacts. */
	ownHandles?: string[];
};

export type ClassifyOptions = {
	/** Distinct authors posting near-identical text before it counts as a burst (default 3). */
	burstMinAuthors?: number;
	/** Word-set similarity (Jaccard, 0..1) for "near-identical" (default 0.8). */
	burstSimilarity?: number;
};

export const prepareIdentity = (identity: Identity): PreparedIdentity => {
	const close = new Set((identity.closeNames ?? []).map(nameSkeleton));
	return {
		ownChannelIds: new Set(identity.channelIds),
		trustedChannelIds: new Set(identity.trustedChannelIds ?? []),
		names: [...identity.names, ...(identity.closeNames ?? [])]
			.map((name) => ({name, skeleton: nameSkeleton(name)}))
			.filter((entry) => entry.skeleton.length >= 3)
			.map((entry) => ({...entry, maxEdits: close.has(entry.skeleton) ? 1 : 2})),
	};
};

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Only whole handles: "@ZooraExampleBot_help" is somebody else's account, not ours with a suffix. */
const removeOwnHandles = (text: string, handles: string[]): string =>
	handles.reduce(
		(out, handle) => out.replace(new RegExp(`${escapeRegExp(handle.trim())}(?![\\p{L}\\p{N}_])`, 'giu'), ' (our official account) '),
		text,
	);

const actionFor = (score: number): Action => (score >= HOLD_AT ? 'hold' : score >= REVIEW_AT ? 'review' : 'allow');

/**
 * Rules that can fire on the same words: one number after "WhatsApp" is both a messaging contact and a
 * phone number. When one rule's evidence ends with the other's (the contact found IS that number), the
 * words count once, at the higher weight (on a tie, the first rule of the pair). A victim quoting the
 * number that called them is then not held; a separate @handle next to a number still counts on its own.
 */
const SAME_EVIDENCE: readonly (readonly [string, string])[] = [['phone-number', 'messaging-handle']];

const countOverlapsOnce = (reasons: Reason[]): void => {
	for (const [a, b] of SAME_EVIDENCE) {
		const first = reasons.find((r) => r.rule === a && r.weight > 0);
		const second = reasons.find((r) => r.rule === b && r.weight > 0);
		if (!first || !second) continue;
		const x = first.evidence;
		const y = second.evidence;
		if (x.endsWith('…') || y.endsWith('…') || !(x.endsWith(y) || y.endsWith(x))) continue;
		const [strong, weak] = first.weight >= second.weight ? [first, second] : [second, first];
		weak.weight = 0;
		weak.explanation += ` The same words already count under "${strong.rule}", so they count once.`;
	}
};

const byWeight = (a: Reason, b: Reason): number => b.weight - a.weight;

const verdict = (reasons: Reason[]): Verdict => {
	const score = Math.max(0, reasons.reduce((sum, reason) => sum + reason.weight, 0));
	return {score, action: actionFor(score), reasons: reasons.sort(byWeight)};
};

const scoreOne = (comment: CommentInput, identity: PreparedIdentity, ownHandles: string[]): Verdict => {
	const channelId = comment.authorChannelId ?? '';
	if (identity.ownChannelIds.has(channelId)) {
		return {score: 0, action: 'allow', reasons: [{rule: 'own-channel', weight: 0, explanation: 'Written by your own channel.', evidence: comment.authorName}]};
	}
	if (identity.trustedChannelIds.has(channelId)) {
		return {score: 0, action: 'allow', reasons: [{rule: 'trusted-author', weight: 0, explanation: 'Written by a channel on your trusted list.', evidence: comment.authorName}]};
	}

	const text = removeOwnHandles(stripReplyPrefix(comment.text.slice(0, MAX_ANALYZED_CHARS)), ownHandles);
	const {unquoted, quotes} = splitQuotes(text);
	const authorName = comment.authorName.slice(0, 200);
	const author = makeView(authorName);
	const authorSkeleton = nameSkeleton(authorName);
	const context = (view: ReturnType<typeof makeView>): RuleContext => ({text: view, author, authorSkeleton, identity});
	const full = context(makeView(text));
	const outside = quotes.length ? context(makeView(unquoted)) : full;
	const warning = RULES.some((rule) => rule.id === 'warning-context' && rule.test(outside) !== null);

	const reasons: Reason[] = [];
	for (const rule of RULES) {
		const evidence = rule.test(rule.kind === 'dampener' ? outside : full);
		if (evidence === null) continue;
		const reason = {rule: rule.id, weight: rule.weight, explanation: rule.explanation, evidence};
		if (rule.kind === 'text' && outside !== full && rule.test(outside) === null) {
			// Matched only inside quotation marks: reported speech, not the writer's own words.
			reason.weight = warning ? 0 : Math.floor(rule.weight / 2);
			reason.explanation += warning
				? ' Only inside quotation marks in a warning, so it does not count.'
				: ' Only inside quotation marks, so it counts half.';
		}
		reasons.push(reason);
	}
	countOverlapsOnce(reasons);
	return verdict(reasons);
};

const jaccard = (a: Set<string>, b: Set<string>): number => {
	let shared = 0;
	for (const word of a) if (b.has(word)) shared++;
	return shared / (a.size + b.size - shared);
};

/**
 * Groups near-identical comments (at least 6 distinct words, so "Great video!" never counts) and
 * returns, for each comment in a group written by `minAuthors` or more different accounts, the
 * number of accounts in its group.
 */
export const findBursts = (comments: CommentInput[], minAuthors = 3, similarity = 0.8): Map<number, number> => {
	const items = comments
		.map((comment, index) => ({index, author: comment.authorChannelId ?? comment.authorName, words: burstTokens(comment.text)}))
		.filter((item) => item.words.size >= 6)
		.sort((a, b) => a.words.size - b.words.size);
	const parent = items.map((_, i) => i);
	const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
	for (let i = 0; i < items.length; i++) {
		for (let j = i + 1; j < items.length; j++) {
			if (items[i].words.size < similarity * items[j].words.size) break; // sizes only grow from here
			if (jaccard(items[i].words, items[j].words) >= similarity) parent[root(j)] = root(i);
		}
	}
	const authorsByGroup = new Map<number, Set<string>>();
	items.forEach((item, i) => {
		const group = root(i);
		authorsByGroup.set(group, (authorsByGroup.get(group) ?? new Set()).add(item.author));
	});
	const bursts = new Map<number, number>();
	items.forEach((item, i) => {
		const authors = authorsByGroup.get(root(i))?.size ?? 0;
		if (authors >= minAuthors) bursts.set(item.index, authors);
	});
	return bursts;
};

/** Scores a batch of comments, including copy-paste bursts across the batch. */
export const classifyAll = (comments: CommentInput[], identity: Identity, options: ClassifyOptions = {}): Verdict[] => {
	const prepared = prepareIdentity(identity);
	const ownHandles = (identity.ownHandles ?? []).filter((handle) => handle.trim().length >= 3);
	const verdicts = comments.map((comment) => scoreOne(comment, prepared, ownHandles));
	const bursts = findBursts(comments, options.burstMinAuthors ?? 3, options.burstSimilarity ?? 0.8);
	for (const [index, authors] of bursts) {
		const current = verdicts[index];
		if (current.reasons.some((reason) => reason.rule === 'own-channel' || reason.rule === 'trusted-author')) continue;
		verdicts[index] = verdict([
			...current.reasons,
			{rule: BURST_RULE.id, weight: BURST_RULE.weight, explanation: BURST_RULE.explanation, evidence: `same text from ${authors} accounts`},
		]);
	}
	return verdicts;
};

/** Scores one comment on its own (no burst detection). */
export const classify = (comment: CommentInput, identity: Identity): Verdict => classifyAll([comment], identity)[0];
