import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {buildChapters, formatTimestamp, parseTime, timesFromEpisode, timesFromTimeline} from './timing.ts';

describe('parseTime / formatTimestamp', () => {
	it('parses seconds, m:ss and h:mm:ss', () => {
		assert.equal(parseTime(12.5), 12.5);
		assert.equal(parseTime('65'), 65);
		assert.equal(parseTime('1:05'), 65);
		assert.equal(parseTime('1:02:03'), 3723);
		assert.equal(parseTime('1:60'), null);
		assert.equal(parseTime('abc'), null);
		assert.equal(parseTime(-1), null);
	});
	it('formats YouTube chapter timestamps, flooring seconds', () => {
		assert.equal(formatTimestamp(0), '00:00');
		assert.equal(formatTimestamp(65.9), '01:05');
		assert.equal(formatTimestamp(3723), '1:02:03');
	});
});

describe('timesFromEpisode', () => {
	it('chains durations and honours explicit starts', () => {
		const {times, totalSec, errors} = timesFromEpisode([
			{id: 'a', durationSec: 10},
			{id: 'b', durationSec: 20},
			{id: 'c', start: '0:30', durationSec: 5},
		]);
		assert.deepEqual(errors, []);
		assert.deepEqual(
			times.map((t) => [t.startSec, t.endSec]),
			[
				[0, 10],
				[10, 30],
				[30, 35],
			],
		);
		assert.equal(totalSec, 35);
	});
	it('reports a missing time, a mismatched start and a missing final duration', () => {
		const {errors} = timesFromEpisode([{id: 'a'}, {id: 'b', start: 40, durationSec: 5}, {id: 'c', durationSec: 5}, {id: 'd', start: 99}]);
		assert.equal(errors.length, 2, errors.join('\n'));
		assert.match(errors.join('\n'), /"d": "start" 99 s does not match/);
		assert.match(errors.join('\n'), /last scene needs "durationSec"/);
		const second = timesFromEpisode([{id: 'a', durationSec: 5}, {id: 'b'}, {id: 'c', durationSec: 5}]);
		assert.match(second.errors.join('\n'), /"c": needs "start", or "durationSec" on the scene before it/);
		assert.match(timesFromEpisode([{id: 'a', start: 3, durationSec: 5}]).errors.join('\n'), /must be 0/);
	});
});

describe('timesFromTimeline', () => {
	const scenes = [{id: 's1'}, {id: 's2'}];
	it('uses measured times when every scene is present', () => {
		const r = timesFromTimeline(scenes, {totalMs: 25_000, scenes: [{id: 's1', startMs: 0, durationMs: 12_000}, {id: 's2', startMs: 12_000, durationMs: 13_000}]});
		assert.ok('times' in r);
		assert.deepEqual(r.times[1], {id: 's2', startSec: 12, endSec: 25});
		assert.equal(r.totalSec, 25);
	});
	it('refuses mock timelines and missing scenes', () => {
		const mock = timesFromTimeline(scenes, {totalMs: 1, scenes: [], mock: true});
		assert.ok('reason' in mock && /mock/.test(mock.reason));
		const missing = timesFromTimeline(scenes, {totalMs: 1, scenes: [{id: 's1', startMs: 0, durationMs: 1}]});
		assert.ok('reason' in missing && /"s2"/.test(missing.reason));
	});
});

describe('buildChapters (YouTube rules)', () => {
	const scene = (id: string, chapter: string | null, startSec: number) => ({id, chapter, startSec});
	it('builds chapters from titled scenes; untitled scenes continue the previous chapter', () => {
		const {chapters, problems} = buildChapters([scene('a', 'Intro', 0), scene('b', null, 8), scene('c', 'Middle', 20), scene('d', 'End', 45.7)], 60);
		assert.deepEqual(problems, []);
		assert.deepEqual(
			chapters.map((c) => [c.start, c.title, c.lengthSec]),
			[
				['00:00', 'Intro', 20],
				['00:20', 'Middle', 25],
				['00:45', 'End', 15],
			],
		);
	});
	it('returns no chapters and every broken rule otherwise', () => {
		const late = buildChapters([scene('a', null, 0), scene('b', 'One', 5), scene('c', 'Two', 30), scene('d', 'Three', 50)], 70);
		assert.deepEqual(late.chapters, []);
		assert.match(late.problems.join('\n'), /must start at 00:00/);
		const few = buildChapters([scene('a', 'One', 0), scene('b', 'Two', 30)], 60);
		assert.match(few.problems.join('\n'), /at least 3 chapters/);
		const short = buildChapters([scene('a', 'One', 0), scene('b', 'Two', 30), scene('c', 'Three', 35)], 60);
		assert.match(short.problems.join('\n'), /"Two" \(00:30\) is 5\.0 s/);
		assert.match(buildChapters([scene('a', null, 0)], 10).problems.join('\n'), /no scene has a "chapter" title/);
	});
});
