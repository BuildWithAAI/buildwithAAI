/**
 * Scene times and YouTube chapters.
 * Times come from the voice step's timeline.json when it covers every scene (measured), otherwise from the
 * scenes' `start` / `durationSec` in episode.json (re-run the kit after the voice step so chapters match).
 */
import {LIMITS} from './limits.ts';
import type {EpisodeSceneFile, TimelineInput} from './types.ts';

const TIMESTAMP = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/;

/** "1:05" -> 65, "1:02:03" -> 3723, 12.5 -> 12.5; null when not a valid time. */
export const parseTime = (value: string | number): number | null => {
	if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
	if (/^\d+(?:\.\d+)?$/.test(value.trim())) return Number(value);
	const m = TIMESTAMP.exec(value.trim());
	if (!m) return null;
	const [h, min, s] = [Number(m[1] ?? 0), Number(m[2]), Number(m[3])];
	if (s > 59 || (m[1] !== undefined && min > 59)) return null;
	return h * 3600 + min * 60 + s + (m[4] ? Number(`0.${m[4]}`) : 0);
};

/** YouTube chapter timestamp: "00:00", "12:34", or "1:02:03" past an hour. Seconds are floored. */
export const formatTimestamp = (sec: number): string => {
	const s = Math.floor(sec + 1e-6);
	const h = Math.floor(s / 3600);
	const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
	const ss = String(s % 60).padStart(2, '0');
	return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

export type SceneTime = {id: string; startSec: number; endSec: number};

/** Scene times from episode.json. Each scene needs `start` or a previous scene with `durationSec`. */
export const timesFromEpisode = (scenes: readonly EpisodeSceneFile[]): {times: SceneTime[]; totalSec: number; errors: string[]} => {
	const errors: string[] = [];
	const starts: number[] = [];
	scenes.forEach((scene, i) => {
		const given = scene.start === undefined ? null : parseTime(scene.start);
		if (scene.start !== undefined && given === null) errors.push(`scenes[${i}] "${scene.id}": "start" must be seconds or a time like "1:05"`);
		const prev = i > 0 ? scenes[i - 1] : undefined;
		const fromPrev = prev && prev.durationSec !== undefined ? starts[i - 1] + prev.durationSec : null;
		if (i === 0) {
			if (given !== null && given !== 0) errors.push(`scenes[0] "${scene.id}": the first scene starts the video, so its "start" must be 0`);
			starts.push(0);
		} else if (given !== null) {
			if (fromPrev !== null && Math.abs(fromPrev - given) > 0.5) {
				errors.push(`scenes[${i}] "${scene.id}": "start" ${given} s does not match the previous scene's start + durationSec (${fromPrev} s)`);
			}
			starts.push(given);
		} else if (fromPrev !== null) {
			starts.push(fromPrev);
		} else {
			errors.push(`scenes[${i}] "${scene.id}": needs "start", or "durationSec" on the scene before it`);
			starts.push(starts[i - 1] ?? 0);
		}
		if (i > 0 && starts[i] <= starts[i - 1]) errors.push(`scenes[${i}] "${scene.id}": starts at ${starts[i]} s, not after the previous scene (${starts[i - 1]} s)`);
	});
	const last = scenes[scenes.length - 1];
	if (last && last.durationSec === undefined) errors.push(`scenes[${scenes.length - 1}] "${last.id}": the last scene needs "durationSec" so the video length is known`);
	const totalSec = last ? starts[starts.length - 1] + (last.durationSec ?? 0) : 0;
	const times = scenes.map((scene, i) => ({
		id: scene.id,
		startSec: starts[i],
		endSec: scene.durationSec !== undefined ? starts[i] + scene.durationSec : (starts[i + 1] ?? totalSec),
	}));
	return {times, totalSec, errors};
};

/** Scene times from a timeline.json, or the reason it cannot be used. */
export const timesFromTimeline = (scenes: readonly EpisodeSceneFile[], timeline: TimelineInput): {times: SceneTime[]; totalSec: number} | {reason: string} => {
	if (timeline.mock) return {reason: 'it is a mock timeline (silent preview), not measured audio'};
	const byId = new Map(timeline.scenes.map((s) => [s.id, s]));
	const missing = scenes.filter((s) => !byId.has(s.id)).map((s) => s.id);
	if (missing.length) return {reason: `it has no scene ${missing.map((id) => `"${id}"`).join(', ')}`};
	const times = scenes.map((scene) => {
		const t = byId.get(scene.id) as TimelineInput['scenes'][number];
		return {id: scene.id, startSec: t.startMs / 1000, endSec: (t.startMs + t.durationMs) / 1000};
	});
	for (let i = 1; i < times.length; i++) if (times[i].startSec <= times[i - 1].startSec) return {reason: 'its scene order differs from episode.json'};
	return {times, totalSec: timeline.totalMs / 1000};
};

export type Chapter = {start: string; title: string; startSec: number; lengthSec: number};

/**
 * Chapters start at scenes that have a `chapter` title; scenes without one continue the chapter before them.
 * Returns the chapters only when they meet YouTube's rules (else an empty list) plus every rule they break.
 */
export const buildChapters = (
	scenes: readonly {id: string; chapter: string | null; startSec: number}[],
	totalSec: number,
): {chapters: Chapter[]; problems: string[]} => {
	const marks = scenes.filter((s) => s.chapter !== null).map((s) => ({title: s.chapter as string, startSec: Math.floor(s.startSec + 1e-6), sceneId: s.id}));
	const problems: string[] = [];
	if (marks.length === 0) return {chapters: [], problems: ['no scene has a "chapter" title']};
	if (marks[0].startSec !== 0) problems.push(`the first chapter must start at 00:00, but the first titled scene ("${marks[0].sceneId}") starts at ${formatTimestamp(marks[0].startSec)}: give the first scene a chapter title`);
	if (marks.length < LIMITS.chaptersMin) problems.push(`YouTube needs at least ${LIMITS.chaptersMin} chapters; this episode has ${marks.length}`);
	const chapters = marks.map((m, i) => {
		const end = i + 1 < marks.length ? marks[i + 1].startSec : totalSec;
		return {start: formatTimestamp(m.startSec), title: m.title, startSec: m.startSec, lengthSec: end - m.startSec};
	});
	for (const c of chapters) {
		if (c.lengthSec < LIMITS.chapterMinSec) {
			problems.push(`chapter "${c.title}" (${c.start}) is ${c.lengthSec.toFixed(1)} s; YouTube needs at least ${LIMITS.chapterMinSec} s. Remove its title so it joins the chapter before it`);
		}
	}
	return {chapters: problems.length ? [] : chapters, problems};
};
