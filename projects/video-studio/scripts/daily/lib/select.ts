/**
 * Picks today's story: the primary candidate plus two alternates (for when the primary fails a gate). Pure: the
 * caller supplies the candidates, our previous episodes and a function that says which strong analyses each
 * candidate has.
 */
import type {PreviousEpisode} from './history.ts';
import type {CandidateSummary, RadarIncident, Selection} from './types.ts';
import {slugify} from './util.ts';

export const COVERED_DAYS = 14;

export const POLICY = [
	"Candidates are the radar's top and also-seen incidents, best score first.",
	"A daily Short needs all of: confirmed status; the radar's short-ready check (2 or more independent sources, a stated mechanism, a strong evergreen fix); no approved episode about the same incident in the last 14 days; and at least one strong analysis available (the 30-day DefiLlama comparison, the 30-day radar pattern, or a Solana fund-flow trace with published addresses).",
	'The primary is the best-scoring eligible incident; the alternates are the next two eligible ones.',
	'If nothing is eligible, there is no video today. Developing stories are listed for the owner but never picked automatically (a "what we know" Short needs his call: prepare --pick <id>).',
	'Only one daily video per day: once a video for the date is approved, prepare picks nothing new unless --pick is given.',
];

export const dateSlugFor = (date: string, inc: RadarIncident): string => {
	const fromId = inc.id.replace(/^\d{4}-\d{2}-\d{2}-/, '');
	return `${date}-${slugify(fromId || inc.protocol, 40)}`;
};

export type SelectContext = {
	date: string;
	previous: PreviousEpisode[];
	strongAnalysis: (inc: RadarIncident) => {available: string[]; why: string[]};
	pick?: string;
};

export const summarize = (inc: RadarIncident, rank: number, ctx: SelectContext): CandidateSummary => {
	const reasons: string[] = [];
	if (inc.status !== 'confirmed') reasons.push('developing: not confirmed by an unhedged tier-A source or two tier-B outlets');
	if (!inc.shortReady.ready) for (const m of inc.shortReady.missing) if (m !== 'not confirmed') reasons.push(`radar short check: ${m}`);
	const covered = ctx.previous.find((p) => p.approved && p.incidentId === inc.id && p.date !== ctx.date);
	if (covered) reasons.push(`already covered: ${covered.slug} was approved within ${COVERED_DAYS} days`);
	const a = ctx.strongAnalysis(inc);
	if (!a.available.length) reasons.push(`no strong analysis available (${a.why.join('; ') || 'none found'})`);
	return {
		rank,
		incidentId: inc.id,
		dateSlug: dateSlugFor(ctx.date, inc),
		title: inc.title,
		protocol: inc.protocol,
		status: inc.status,
		type: inc.type,
		evergreenTopic: inc.evergreenTopic,
		score: inc.score.total,
		shortReady: inc.shortReady.ready,
		missing: inc.shortReady.missing,
		eligible: reasons.length === 0,
		reasons,
		strongAnalysis: a.available,
		chains: inc.chains,
	};
};

/** `candidates` best score first. */
export const selectCandidates = (candidates: RadarIncident[], ctx: SelectContext): Selection => {
	const considered = candidates.map((inc, i) => summarize(inc, i + 1, ctx));
	const approvedToday = ctx.previous.find((p) => p.approved && p.date === ctx.date);
	if (ctx.pick) {
		const picked = considered.find((c) => c.incidentId === ctx.pick);
		if (!picked)
			return {policy: POLICY, primary: null, alternates: [], considered, decision: 'no-video', decisionReason: `--pick ${ctx.pick}: the radar has no such incident today (it has: ${considered.map((c) => c.incidentId).join(', ') || 'none'}).`, picked: ctx.pick};
		const alternates = considered.filter((c) => c.eligible && c !== picked).slice(0, 2);
		return {
			policy: POLICY,
			primary: picked,
			alternates,
			considered,
			decision: 'video',
			decisionReason: picked.eligible ? `Picked by hand (--pick ${ctx.pick}); it meets every rule.` : `Picked by hand (--pick ${ctx.pick}) although: ${picked.reasons.join('; ')}.`,
			picked: ctx.pick,
		};
	}
	if (approvedToday)
		return {policy: POLICY, primary: null, alternates: [], considered, decision: 'no-video', decisionReason: `A video for ${ctx.date} is already approved (${approvedToday.slug}); one daily video per day. Use --pick to prepare another one anyway.`};
	const eligible = considered.filter((c) => c.eligible);
	if (!eligible.length) {
		const confirmed = considered.filter((c) => c.status === 'confirmed');
		const why = !considered.length
			? 'The radar found no candidate incidents today.'
			: !confirmed.length
				? 'Nothing is confirmed today: every candidate is still developing.'
				: 'No confirmed candidate passes every rule (see the reasons per candidate); real analysis or a clean short-ready check is missing.';
		return {policy: POLICY, primary: null, alternates: [], considered, decision: 'no-video', decisionReason: `${why} Publish nothing today.`};
	}
	return {policy: POLICY, primary: eligible[0], alternates: eligible.slice(1, 3), considered, decision: 'video', decisionReason: `Best-scoring eligible incident (score ${eligible[0].score}).`};
};
