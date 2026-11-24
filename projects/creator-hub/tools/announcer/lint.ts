/**
 * Checks every planned post before it is shown (dry run) or sent (--apply): the Threat Brief's scaled-down news-gate
 * rules (../threat-brief/safety.ts: names, how-to, attribution, speculation, price talk, placeholders), plus what a
 * post needs on its own:
 * - the DEVELOPING label for a developing story;
 * - the platform's length limit;
 * - every hub link tagged for its target (?s=x on X, ?s=other on Telegram) with its disclosure right before it;
 * - no failed blocking check in the publish kit.
 * `apply` is for posts about to be sent: a missing video link is then an error, not a warning.
 */
import {scanText, type Finding, type Level, type NameAllow, type Rule} from '../threat-brief/safety.ts';
import type {AnnounceSource} from './source.ts';
import {HUB_SOURCE, VIDEO_LINK_PENDING, type OfferPlan, type PlannedPost} from './templates.ts';

/** Publish-kit checks that must pass before an episode is announced anywhere. */
export const BLOCKING_CHECKS = ['disclosures', 'income-claims', 'placeholders', 'links-via-hub', 'restricted-offers', 'offers-live'] as const;

const issue = (rule: Rule, code: string, level: Level, where: string, message: string, match = ''): Finding => ({rule, code, level, where, message, match});

export const lintSource = (source: AnnounceSource, plan: OfferPlan): Finding[] => {
	const out: Finding[] = [];
	for (const check of source.checks) {
		if (!check.ok && (BLOCKING_CHECKS as readonly string[]).includes(check.id)) out.push(issue('structure', 'kit-check', 'error', 'kit.json', `the publish kit's "${check.id}" check failed: ${check.detail}. Fix the kit first.`));
	}
	for (const p of plan.problems) out.push(issue('offers', 'offer', 'error', 'kit.json', p));
	return out;
};

export const lintPost = (post: PlannedPost, source: AnnounceSource, plan: OfferPlan, allow: NameAllow, options: {apply: boolean}): Finding[] => {
	const where = post.target === 'x' ? 'X post' : `Telegram ${post.method === 'sendVideo' ? 'caption' : 'message'}`;
	const out: Finding[] = [];
	const pending = post.text.includes(VIDEO_LINK_PENDING);
	const textFindings = scanText(post.text, {where, allow}).filter((f) => !(f.rule === 'placeholder' && pending && f.match.toLowerCase().startsWith('[video link')));
	out.push(...textFindings);
	if (pending) out.push(issue('placeholder', 'video-link-pending', options.apply ? 'error' : 'warning', where, 'no YouTube id yet: pass --youtube-id <id> once the video is public'));
	if (post.length > post.limit) out.push(issue('limits', 'too-long', 'error', where, `${post.length}/${post.limit} ${post.unit}`));
	if (post.text.trim().length === 0) out.push(issue('structure', 'empty', 'error', where, 'the post is empty'));
	if (source.developing && !/^DEVELOPING\b/.test(post.text)) out.push(issue('developing', 'label', 'error', where, 'a developing story must start with "DEVELOPING"'));

	const tag = HUB_SOURCE[post.target];
	for (const m of post.text.matchAll(/https:\/\/[^\s]+\/go\/([a-z0-9-]{2,40})(\?[^\s]*)?/g)) {
		const params = new URLSearchParams(m[2] ?? '');
		if (params.get('s') !== tag) out.push(issue('links', 'hub-source', 'error', where, `hub links in this post must carry ?s=${tag}`, m[0]));
		const offer = plan.included.find((o) => o.id === m[1]);
		const before = post.text.slice(Math.max(0, m.index - 400), m.index);
		if (!offer) out.push(issue('offers', 'unknown-offer', 'error', where, `"${m[1]}" is not an offer this post may include`, m[0]));
		else if (!offer.disclosure.every((line) => before.includes(line))) out.push(issue('offers', 'disclosure', 'error', where, 'the offer disclosure must come right before its link', m[0]));
	}
	return out;
};
