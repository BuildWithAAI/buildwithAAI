/**
 * Synthetic retention data, for tests and the demo report ONLY. Every record it makes is marked `fixture: true`
 * and every video id starts with "SYN", so it can never be mistaken for YouTube data.
 *
 * Model: viewers leave at a hazard rate h(t) per second (a steep early drop that decays, plus a steady rate);
 * scenes can add or remove hazard, the end screen adds a lot, and an episode-wide "quality" factor scales it.
 * Retention R(t) = R0 * exp(-integral of h). Each bucket's value is R averaged over the bucket, with seeded noise
 * on the hazard and on the measurement, so a test can inject a known effect and check the analysis finds it
 * (and finds nothing when nothing was injected).
 */
import {BUCKETS} from './curve.ts';
import {normalDraw, seededRandom} from './stats.ts';
import type {CurvePoint, Format, PullRecord, SceneSnapshot} from './types.ts';

export type SynthScene = {
	id: string;
	type: string;
	segment?: string | null;
	badger?: boolean;
	title?: string;
	durationMs: number;
	/** Extra share of the audience leaving per second during this scene (0.004 = 0.4% per s more). */
	extraHazard?: number;
};

export type SynthUpload = {
	videoId: string;
	channel: string;
	slug: string;
	lang: string;
	format: Format;
	shortId?: string | null;
	scenes: SynthScene[];
	views: number;
	seed: number;
	quality?: number; // multiplies the base hazard (1 = average)
	hookBonus?: number; // hazard removed during the opening scene (a hook that keeps viewers)
	noise?: number; // 1 = default noise, 0 = none
	missingBuckets?: number[]; // 1-based buckets to leave out of the API rows
	multiLanguageAudio?: boolean;
	pulledAt?: string;
	mockTimeline?: boolean;
	durationSecOnYouTube?: number; // to simulate an uploaded cut that differs from the timeline
};

const baseHazard = (format: Format, t: number): number => (format === 'long' ? 0.025 * Math.exp(-t / 6) + 0.0045 : 0.08 * Math.exp(-t / 1.5) + 0.012);

const sceneAt = (scenes: SynthScene[], tMs: number): {scene: SynthScene | undefined; index: number} => {
	let at = 0;
	for (let i = 0; i < scenes.length; i++) {
		if (tMs < at + scenes[i]!.durationMs) return {scene: scenes[i], index: i};
		at += scenes[i]!.durationMs;
	}
	return {scene: scenes[scenes.length - 1], index: scenes.length - 1};
};

export const totalMsOf = (u: Pick<SynthUpload, 'scenes'>): number => u.scenes.reduce((a, s) => a + s.durationMs, 0);

/** The 100 API rows for an upload (with startedWatching, stoppedWatching and totalSegmentImpressions). */
export const synthCurve = (u: SynthUpload): CurvePoint[] => {
	const random = seededRandom(u.seed);
	const noise = u.noise ?? 1;
	const totalMs = totalMsOf(u);
	const steps = 40; // integration steps per bucket
	const level = (hazardScale: number[], withScenes: boolean): {mean: number[]; start: number[]; end: number[]} => {
		let r = 1;
		const mean: number[] = [];
		const start: number[] = [];
		const end: number[] = [];
		for (let k = 0; k < BUCKETS; k++) {
			start.push(r);
			let acc = 0;
			for (let i = 0; i < steps; i++) {
				const tMs = ((k + (i + 0.5) / steps) / BUCKETS) * totalMs;
				const t = tMs / 1000;
				const {scene, index} = sceneAt(u.scenes, tMs);
				let h = baseHazard(u.format, t) * (withScenes ? (u.quality ?? 1) : 1);
				if (withScenes) {
					if (scene?.type === 'endscreen') h += 0.04;
					h += scene?.extraHazard ?? 0;
					if (index === 0) h -= u.hookBonus ?? 0;
				}
				h = Math.max(0, h * hazardScale[k]!);
				r *= Math.exp((-h * totalMs) / 1000 / BUCKETS / steps);
				acc += r;
			}
			mean.push(acc / steps);
			end.push(r);
		}
		return {mean, start, end};
	};
	const scale = Array.from({length: BUCKETS}, () => Math.exp(0.15 * noise * normalDraw(random)));
	const real = level(scale, true);
	const reference = level(new Array(BUCKETS).fill(1), false);
	const rows: CurvePoint[] = [];
	for (let k = 0; k < BUCKETS; k++) {
		if (u.missingBuckets?.includes(k + 1)) continue;
		const p = real.mean[k]!;
		const measured = Math.max(0, p + noise * 0.3 * Math.sqrt(Math.max(p * (1 - p), 0.0001) / u.views) * normalDraw(random));
		const relative = Math.min(0.98, Math.max(0.02, 0.5 + (measured - reference.mean[k]!) * 2.5));
		const stopped = Math.max(0, Math.round(u.views * (real.start[k]! - real.end[k]!))) + (k === BUCKETS - 1 ? Math.round(u.views * real.end[k]!) : 0);
		rows.push({
			ratio: Math.round(((k + 1) / BUCKETS) * 100) / 100,
			watch: Math.round(measured * 10_000) / 10_000,
			relative: Math.round(relative * 1000) / 1000,
			started: k === 0 ? u.views : 0,
			stopped,
			impressions: Math.round(u.views * measured),
		});
	}
	return rows;
};

/** A complete pull record for an upload, as `pull` would store it, marked as a fixture. */
export const synthRecord = (u: SynthUpload): PullRecord => {
	const totalMs = totalMsOf(u);
	let at = 0;
	const scenes: SceneSnapshot[] = u.scenes.map((s, index) => {
		const snap: SceneSnapshot = {
			id: s.id,
			index,
			type: s.type,
			segment: s.segment ?? null,
			segmentSource: s.segment ? 'explicit' : null,
			badger: s.badger ?? false,
			title: s.title ?? null,
			startMs: at,
			durationMs: s.durationMs,
			speechMs: Math.max(0, s.durationMs - 400),
		};
		at += s.durationMs;
		return snap;
	});
	const pulledAt = u.pulledAt ?? '2026-11-24T12:00:00.000Z';
	const youtubeSec = u.durationSecOnYouTube ?? Math.round(totalMs / 1000);
	const deltaMs = youtubeSec * 1000 - totalMs;
	return {
		version: 1,
		kind: 'retention-pull',
		fixture: true,
		videoId: u.videoId,
		account: null,
		channel: u.channel,
		slug: u.slug,
		lang: u.lang,
		format: u.format,
		shortId: u.shortId ?? null,
		multiLanguageAudio: u.multiLanguageAudio ?? false,
		pulledAt,
		window: {startDate: '2026-10-01', endDate: pulledAt.slice(0, 10)},
		audience: 'all',
		metrics: ['audienceWatchRatio', 'relativeRetentionPerformance', 'startedWatching', 'stoppedWatching', 'totalSegmentImpressions'],
		curve: synthCurve(u),
		stats: {views: u.views, engagedViews: u.views, averageViewDurationSec: null, averageViewPercentage: null, contentType: u.format === 'short' ? 'SHORTS' : 'VIDEO_ON_DEMAND'},
		video: {durationSec: youtubeSec, publishedAt: '2026-10-01T15:00:00Z', defaultAudioLanguage: u.lang, fetchedAt: pulledAt},
		join: {
			format: u.format,
			shortId: u.shortId ?? null,
			renderer: u.channel === 'zoora-security' ? 'show' : 'episode',
			totalMs,
			fps: 30,
			scenes,
			timeline: {path: `video-studio/public/generated/${u.channel}/${u.slug}/${u.lang}/timeline.json`, sha256: 'synthetic', mode: 'native', mock: u.mockTimeline ?? false, lang: u.lang},
			storyboard: {path: `video-studio/content/${u.channel}/${u.slug}/storyboard.json`, sha256: 'synthetic'},
			issues: [],
		},
		checks: {
			durationMatch: Math.abs(deltaMs) <= Math.max(1500, totalMs * 0.02),
			durationDeltaMs: deltaMs,
			langMatch: true,
			formatMatch: true,
		},
		warnings: [],
	};
};

/* ------------------------------------------------------------------ the demo set */

const story = (n: number, hookMs: number, chartBonus: number): SynthScene[] => {
	const talk1: SynthScene = {id: 's02', type: 'talk', badger: n % 2 === 0, title: 'How it started', durationMs: 9000 + (n % 4) * 1200};
	const chart: SynthScene = {id: 's03', type: 'chart', badger: true, title: 'Illustrative chart', durationMs: 8000 + (n % 3) * 1500, extraHazard: chartBonus};
	const talk2: SynthScene = {id: 's04', type: 'talk', badger: n % 2 === 1, title: 'The turn', durationMs: 10_000 + (n % 5) * 900};
	const steps: SynthScene = {id: 's05', type: 'steps', badger: false, title: 'Red flags to check', durationMs: 11_000 + (n % 2) * 2000};
	// the order varies between episodes, as it should if templates are to be told apart from their moment
	const middle = n % 3 === 0 ? [chart, talk1, steps, talk2] : n % 3 === 1 ? [talk1, chart, talk2, steps] : [talk1, steps, chart, talk2];
	return [
		{id: 's01', type: 'hook', badger: n % 3 === 0, title: `Synthetic story ${n}: the opening line`, durationMs: hookMs},
		...middle,
		{id: 's06', type: 'cta', badger: true, title: 'Subscribe', durationMs: 4000},
		{id: 's07', type: 'endscreen', badger: true, title: 'Next', durationMs: 20_000},
	];
};

const show = (n: number, redFlagExtra: number): SynthScene[] => {
	const headline: SynthScene = {id: 's02', type: 'talk', segment: 'Headline', badger: false, title: 'Headline', durationMs: 7000 + (n % 4) * 700};
	const how: SynthScene = {id: 's03', type: 'talk', segment: 'HowItWorked', badger: n % 2 === 0, title: 'How it worked', durationMs: 14_000 + (n % 3) * 1500};
	const flag: SynthScene = {id: 's04', type: 'talk', segment: 'BadgerRedFlag', badger: true, title: "Badger's Red Flag", durationMs: 10_000 + (n % 4) * 1000, extraHazard: redFlagExtra};
	const fix: SynthScene = {id: 's05', type: 'steps', segment: 'ZooOneFix', badger: false, title: "Zoo's One Fix", durationMs: 12_000 + (n % 2) * 1500};
	const middle = n % 3 === 0 ? [flag, headline, how, fix] : n % 3 === 1 ? [headline, how, flag, fix] : [headline, flag, fix, how];
	return [
		{id: 's01', type: 'hook', segment: 'ColdOpen', badger: true, title: 'Synthetic incident: cold open', durationMs: 4500 + (n % 3) * 800},
		...middle,
		{id: 's06', type: 'cta', segment: 'Desk', badger: true, title: 'Subscribe', durationMs: 4000},
		{id: 's07', type: 'endscreen', segment: 'OutroEndScreen', badger: true, title: 'Next', durationMs: 20_000},
	];
};

const id11 = (prefix: string, n: number): string => `${prefix}${String(n).padStart(11 - prefix.length, '0')}`;

/**
 * The demo dataset: two synthetic channels, long-form and Shorts, three languages, with three injected effects
 * (openings under 3 s hold better, Badger's Red Flag loses viewers faster, chart scenes hold slightly better) and a
 * few broken uploads that must be excluded. Deterministic.
 */
export const demoUploads = (): SynthUpload[] => {
	const out: SynthUpload[] = [];
	const random = seededRandom(20261124);
	for (let n = 1; n <= 14; n++) {
		const hookMs = n % 2 === 0 ? 2000 + Math.round(random() * 800) : 3600 + Math.round(random() * 5000);
		const quality = 0.85 + random() * 0.3;
		const hookBonus = hookMs < 3000 ? 0.02 : 0;
		for (const lang of n <= 7 ? ['en', 'es', 'pt-br'] : ['en']) {
			out.push({
				videoId: id11(`SYNst${lang === 'en' ? 'E' : lang === 'es' ? 'S' : 'P'}`, n),
				channel: 'zoora-ai',
				slug: `synthetic-story-${String(n).padStart(2, '0')}`,
				lang,
				format: 'long',
				scenes: story(n, hookMs, -0.0025),
				views: lang === 'en' ? 1500 + Math.round(random() * 4000) : 300 + Math.round(random() * 900),
				seed: 1000 * n + lang.length,
				quality: quality * (lang === 'en' ? 1 : 1.05),
				hookBonus,
			});
		}
	}
	for (let n = 1; n <= 10; n++) {
		out.push({
			videoId: id11('SYNsh', n),
			channel: 'zoora-security',
			slug: `synthetic-show-${String(n).padStart(2, '0')}`,
			lang: 'en',
			format: 'long',
			scenes: show(n, 0.007),
			views: 900 + Math.round(random() * 3000),
			seed: 5000 + n,
			quality: 0.9 + random() * 0.2,
		});
	}
	for (let n = 1; n <= 8; n++) {
		out.push({
			videoId: id11('SYNsr', n),
			channel: 'zoora-ai',
			slug: `synthetic-story-${String(n).padStart(2, '0')}`,
			lang: 'en',
			format: 'short',
			shortId: 'short1',
			scenes: [
				{id: 's01', type: 'hook', badger: false, title: 'Short hook', durationMs: 1800 + (n % 4) * 700},
				{id: 's03', type: 'chart', badger: true, title: 'Illustrative chart', durationMs: 9000 + (n % 3) * 1500},
				{id: 's05', type: 'steps', badger: false, title: 'Red flags to check', durationMs: 12_000},
			],
			views: 2000 + Math.round(random() * 8000),
			seed: 7000 + n,
			quality: 0.9 + random() * 0.2,
		});
	}
	// broken uploads the report must exclude, with the reason
	out.push({...out[0]!, videoId: 'SYNlowviews', lang: 'it', views: 40, seed: 9001});
	out.push({videoId: 'SYNtiny0001', channel: 'zoora-ai', slug: 'synthetic-tiny', lang: 'en', format: 'short', shortId: 'short1', scenes: [{id: 's01', type: 'hook', durationMs: 1500}, {id: 's02', type: 'talk', durationMs: 2500}], views: 5000, seed: 9002});
	out.push({...out[1]!, videoId: 'SYNwrongcut', lang: 'hi', views: 2000, seed: 9003, durationSecOnYouTube: 30});
	out.push({...out[2]!, videoId: 'SYNholes001', lang: 'zh', views: 2000, seed: 9004, missingBuckets: Array.from({length: 20}, (_, i) => 40 + i)});
	return out;
};

/**
 * The demo set with every effect removed (no template, hook or language effect) and episode quality redrawn from the
 * seed: anything "supported" in it is a false discovery. Used to check the false-discovery control.
 */
export const nullUploads = (seed: number): PullRecord[] => {
	const random = seededRandom(seed * 1013);
	const quality = new Map<string, number>();
	return demoUploads()
		.filter((u) => !['SYNlowviews', 'SYNwrongcut', 'SYNholes001'].includes(u.videoId))
		.map((u) => {
			const key = `${u.slug}|${u.format}`;
			if (!quality.has(key)) quality.set(key, 0.85 + random() * 0.3);
			return synthRecord({...u, seed: u.seed * 31 + seed * 7919, hookBonus: 0, quality: quality.get(key)!, scenes: u.scenes.map((s) => ({...s, extraHazard: 0}))});
		});
};
