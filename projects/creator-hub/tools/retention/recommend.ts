/**
 * Turns SUPPORTED comparisons (see aggregate.ts) into concrete template recommendations, each with the numbers that
 * triggered it. A recommendation describes what happened in past uploads and proposes a change to TEST; it never
 * predicts views or income. The machine-readable `suggestedRule` is a proposal for the storyboard writer: it becomes
 * binding only after the owner approves it.
 */
import type {Comparison} from './aggregate.ts';
import {RULES} from './rules.ts';
import type {Format} from './types.ts';

export type SuggestedRule = {
	kind: 'scene-length-cap' | 'prefer-scene' | 'hook-length-cap' | 'hook-room' | 'prefer-badger-on-screen' | 'review-badger-scenes' | 'review-dub' | 'prefer-dub';
	appliesTo: {format: Format; type?: string; segment?: string; lang?: string};
	maxSec?: number;
	note: string;
};

export type Recommendation = {
	id: string;
	comparisonId: string;
	format: Format;
	title: string;
	action: string;
	evidence: string;
	numbers: {
		estimate: number;
		unit: string;
		ci95: [number, number];
		p: number;
		q: number;
		episodes: number;
		group: number | null;
		rest: number | null;
		standardized: number | null;
		/** The estimate as a share of the comparison group's mean (two-group designs), with its interval. */
		relative: number | null;
		relativeCi95: [number, number] | null;
	};
	suggestedRule: SuggestedRule | null;
	recheck: string;
};

const TYPE_WORSE: Record<string, string> = {
	hook: 'Open on the payoff: cut the opening scene to its first line and move the setup into the next scene.',
	talk: 'Split talk scenes longer than {rest} s, keep to 3 bullets or fewer, and reveal the first bullet within 2 s (onScreen.cues[0]).',
	chart: 'Start the chart move in the first sentence (onScreen.cues[0]) and keep chart scenes near {rest} s.',
	steps: 'Use 3 steps or fewer and reveal step 1 on the first sentence.',
	quote: 'Cut quotes to one sentence, or paraphrase with attribution.',
	cta: 'Move the subscribe ask after the payoff and keep it under 5 s.',
};

const SEGMENT_WORSE: Record<string, string> = {
	ColdOpen: "Open on the incident's most striking confirmed fact in the first sentence; move the context into Headline.",
	Headline: 'State the headline in one sentence and cut straight to how it worked.',
	HowItWorked: 'Show the diagram from the first second and cut the explanation to the 2-3 moves that matter.',
	RektMeter: 'Reveal the Rekt Meter reading first, then explain it.',
	BadgerRedFlag: "State the red flag in Zoo's first sentence so Badger's reaction lands sooner (after that line, never over it).",
	ZooOneFix: 'Say the fix in the first sentence, then the steps.',
	ScamOfTheWeek: 'Open the segment with what the target actually saw (the scam’s hook line).',
	WhatWeKnow: 'Lead with the single confirmed fact that matters most.',
};

const n1 = (x: number): string => (Math.round(x * 10) / 10).toFixed(1);
const n2 = (x: number): string => (Math.round(x * 100) / 100).toFixed(2);
const signed = (x: number, digits = 1): string => `${x >= 0 ? '+' : '-'}${digits === 1 ? n1(Math.abs(x)) : n2(Math.abs(x))}`;
const ci = (c: [number, number], digits = 1): string => `${signed(c[0], digits)} to ${signed(c[1], digits)}`;
/** A share as a signed whole percent: 0.051 -> "+5%". */
const pctSigned = (x: number): string => `${x >= 0 ? '+' : '-'}${Math.round(Math.abs(x) * 100)}%`;
const formatName = (f: Format): string => (f === 'long' ? 'long-form' : 'Shorts');
const at = (sec: number): string => `0:${String(sec).padStart(2, '0')}`;
const halfStep = (x: number): number => Math.max(1, Math.round(x * 2) / 2);

const numbersOf = (c: Comparison): Recommendation['numbers'] => ({
	estimate: c.estimate!,
	unit: c.unit,
	ci95: c.ci95!,
	p: c.p!,
	q: c.q!,
	episodes: c.n.episodes,
	group: c.n.group,
	rest: c.n.rest,
	standardized: c.standardized,
	relative: c.relative,
	relativeCi95: c.relativeCi95,
});

const qText = (c: Comparison): string => `q = ${c.q!.toFixed(3)}`;

const sceneRecommendation = (c: Comparison): Recommendation => {
	const worse = c.estimate! > 0;
	const what = c.family === 'segment' ? c.group : c.family === 'badger' ? 'Badger' : `${c.group}`;
	const rest = typeof c.details.restMedianLengthSec === 'number' ? c.details.restMedianLengthSec : null;
	const groupLen = typeof c.details.groupMedianLengthSec === 'number' ? c.details.groupMedianLengthSec : null;
	const subject = c.family === 'badger' ? 'Scenes with Badger on screen' : c.family === 'segment' ? `${what} segments` : `${what[0]!.toUpperCase()}${what.slice(1)} scenes`;
	const inSentence = c.family === 'badger' ? 'scenes with Badger on screen' : c.family === 'segment' ? `${what} segments` : `${what} scenes`;
	const evidence =
		c.family === 'badger'
			? `In ${c.n.episodes} ${formatName(c.format)} episodes, scenes with Badger on screen lost ${n2(Math.abs(c.estimate!))}% ${worse ? 'more' : 'fewer'} of the viewers still watching per 10 s ` +
				`than scenes of the same template and segment without him (95% CI ${ci(c.ci95!, 2)}; ${qText(c)}; ${c.n.group} vs ${c.n.rest} scenes).`
			: `In ${c.n.episodes} ${formatName(c.format)} episodes${c.details.channels ? ` (${c.details.channels})` : ''}, ${inSentence} lost ${n2(Math.abs(c.estimate!))}% ${worse ? 'more' : 'fewer'} ` +
				`of the viewers still watching per 10 s than expected at that moment of their uploads (95% CI ${ci(c.ci95!, 2)}; ${qText(c)}; ${c.n.group} scenes).` +
				(groupLen !== null && rest !== null ? ` Median length ${n1(groupLen)} s vs ${n1(rest)} s for the other scenes.` : '');
	let title: string;
	let action: string;
	let rule: SuggestedRule;
	if (c.family === 'badger') {
		title = worse ? `Review how Badger is used (${formatName(c.format)})` : `Put Badger on screen in more scenes (${formatName(c.format)})`;
		action = worse
			? 'Keep Badger in the episodes (he must appear in every one) but test fewer, shorter reaction beats, each after Zoo finishes his line.'
			: 'Add Badger to scenes that now run without him, especially long talk scenes; keep his reactions after Zoo’s lines.';
		rule = worse
			? {kind: 'review-badger-scenes', appliesTo: {format: c.format}, note: 'test fewer, shorter Badger beats; he still appears in every episode'}
			: {kind: 'prefer-badger-on-screen', appliesTo: {format: c.format}, note: 'set badger.present on more scenes'};
	} else if (worse) {
		title = `${subject} lose viewers faster: shorten or restructure them (${formatName(c.format)})`;
		const template = (c.family === 'segment' ? SEGMENT_WORSE[what] : TYPE_WORSE[what]) ?? `Shorten ${what} scenes toward {rest} s and put the key line first.`;
		action = template.replace('{rest}', rest !== null ? n1(rest) : 'the episode median');
		const cap = groupLen !== null ? halfStep(groupLen * 0.8) : null;
		rule = {
			kind: 'scene-length-cap',
			appliesTo: c.family === 'segment' ? {format: c.format, segment: what} : {format: c.format, type: what},
			...(cap !== null ? {maxSec: cap} : {}),
			note: 'median length minus 20%, as a test; re-check after the next episodes',
		};
	} else {
		title = `${subject} hold viewers better: use them more (${formatName(c.format)})`;
		action = `Use ${c.family === 'segment' ? `the ${what} segment` : `${what} scenes`} more often and earlier in the episode, then check that the gain holds.`;
		rule = {kind: 'prefer-scene', appliesTo: c.family === 'segment' ? {format: c.format, segment: what} : {format: c.format, type: what}, note: 'use more often or earlier, as a test'};
	}
	return {id: `rec:${c.id}`, comparisonId: c.id, format: c.format, title, action, evidence, numbers: numbersOf(c), suggestedRule: rule, recheck: `Re-check after ${RULES.minEpisodes} more episodes.`};
};

const hookRecommendation = (c: Comparison, slope: Comparison | null): Recommendation => {
	const atSec = RULES.hookAtSec[c.format];
	if (c.family === 'hook-short') {
		const better = c.estimate! > 0;
		// Lead with the channel-adjusted effect, and state any relative figure as that same effect over the longer
		// openings' mean: the raw group means mix channels and would roughly double the claim in the demo set.
		const rel =
			c.relative !== null && c.relativeCi95 !== null
				? `; about ${pctSigned(c.relative)} relative to the ${c.details.restMeanPp}% that longer openings kept (95% CI ${pctSigned(c.relativeCi95[0])} to ${pctSigned(c.relativeCi95[1])})`
				: '';
		const evidence =
			`Within each channel, episodes whose opening scene is under ${RULES.shortHookSec} s kept ${n1(Math.abs(c.estimate!))} pp ${better ? 'more' : 'fewer'} of their viewers at ${at(atSec)} than episodes with longer openings ` +
			`(95% CI ${ci(c.ci95!)} pp${rel}; ${qText(c)}; ${c.n.group} vs ${c.n.rest} episodes). ` +
			`The raw averages, which mix the channels, were ${c.details.groupMeanPp}% vs ${c.details.restMeanPp}%.` +
			(slope ? ` Across all opening lengths, each extra second went with ${signed(slope.estimate!, 2)} pp at ${at(atSec)} (95% CI ${ci(slope.ci95!, 2)}).` : '');
		return {
			id: `rec:${c.id}`,
			comparisonId: c.id,
			format: c.format,
			title: better ? `Keep openings under ${RULES.shortHookSec} s (${formatName(c.format)})` : `Give the opening more room than ${RULES.shortHookSec} s (${formatName(c.format)})`,
			action: better
				? `Cut the hook scene to one line of at most ${RULES.shortHookSec} s and move any setup into the next scene.`
				: `Openings under ${RULES.shortHookSec} s held less: let the hook land (title on screen plus Zoo's reaction) before cutting.`,
			evidence,
			numbers: numbersOf(c),
			suggestedRule: better
				? {kind: 'hook-length-cap', appliesTo: {format: c.format, type: 'hook'}, maxSec: RULES.shortHookSec, note: 'opening scene at most this long'}
				: {kind: 'hook-room', appliesTo: {format: c.format, type: 'hook'}, note: `opening scene at least ${RULES.shortHookSec} s`},
			recheck: `Re-check after ${RULES.minEpisodes} more episodes.`,
		};
	}
	const shorter = c.estimate! < 0;
	const medianLen = typeof c.details.medianLengthSec === 'number' ? c.details.medianLengthSec : null;
	return {
		id: `rec:${c.id}`,
		comparisonId: c.id,
		format: c.format,
		title: shorter ? `Shorter openings hold better (${formatName(c.format)})` : `Longer openings did not cost viewers (${formatName(c.format)})`,
		action: shorter
			? `Keep the opening scene at or under the current median (${medianLen !== null ? `${n1(medianLen)} s` : 'the median'}), and shorter where the line allows.`
			: 'Do not cut openings just to be short; spend the time on a clear hook line.',
		evidence:
			`Each extra second of opening scene went with ${signed(c.estimate!, 2)} pp of viewers at ${at(atSec)}, within each channel ` +
			`(95% CI ${ci(c.ci95!, 2)} pp per second; ${qText(c)}; ${c.n.episodes} episodes with openings of ${c.details.minLengthSec}-${c.details.maxLengthSec} s).`,
		numbers: numbersOf(c),
		suggestedRule: shorter && medianLen !== null ? {kind: 'hook-length-cap', appliesTo: {format: c.format, type: 'hook'}, maxSec: halfStep(medianLen), note: 'at most the current median opening length'} : null,
		recheck: `Re-check after ${RULES.minEpisodes} more episodes.`,
	};
};

const languageRecommendation = (c: Comparison): Recommendation => {
	const worse = c.estimate! < 0;
	const what = c.family === 'language-average' ? 'average retention' : `retention at ${at(RULES.hookAtSec[c.format])}`;
	return {
		id: `rec:${c.id}`,
		comparisonId: c.id,
		format: c.format,
		title: worse ? `${c.group} versions hold less than English: review the dub (${formatName(c.format)})` : `${c.group} versions hold at least as well as English (${formatName(c.format)})`,
		action: worse
			? `Review the ${c.group} timing of the first scenes (fit-to-master can slow speech) and the translation of the hook line.`
			: `Keep dubbing into ${c.group}; the dubbed versions are not losing viewers faster.`,
		evidence:
			`Same episodes, ${c.group} minus English: ${signed(c.estimate!)} pp of ${what} (95% CI ${ci(c.ci95!)} pp; ${qText(c)}; ${c.n.episodes} episode pairs). ` +
			'Audiences differ by language, and YouTube may also auto-dub the English upload, so treat this as a prompt to review, not as proof the dub is the cause.',
		numbers: numbersOf(c),
		suggestedRule: worse
			? {kind: 'review-dub', appliesTo: {format: c.format, lang: c.group}, note: 'review pacing of the first scenes and the hook translation'}
			: {kind: 'prefer-dub', appliesTo: {format: c.format, lang: c.group}, note: 'keep dubbing into this language'},
		recheck: `Re-check after ${RULES.minEpisodes} more episode pairs.`,
	};
};

/**
 * Recommendations for every supported comparison, strongest evidence first. When openings under 3 s are supported, the
 * slope of the same format is folded into that recommendation instead of being a second one about the same effect.
 */
export const recommend = (comparisons: readonly Comparison[]): Recommendation[] => {
	const supported = comparisons.filter((c) => c.status === 'supported' && c.estimate !== null && c.ci95 !== null && c.p !== null && c.q !== null);
	const shortHook = new Set(supported.filter((c) => c.family === 'hook-short').map((c) => c.format));
	return supported
		.filter((c) => !(c.family === 'hook-slope' && shortHook.has(c.format)))
		.sort((a, b) => a.q! - b.q! || Math.abs(b.estimate!) / b.practical - Math.abs(a.estimate!) / a.practical)
		.map((c) =>
			c.family === 'type' || c.family === 'segment' || c.family === 'badger'
				? sceneRecommendation(c)
				: c.family === 'hook-short' || c.family === 'hook-slope'
					? hookRecommendation(c, supported.find((x) => x.family === 'hook-slope' && x.format === c.format) ?? null)
					: languageRecommendation(c),
		);
};
