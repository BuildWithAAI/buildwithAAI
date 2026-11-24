import assert from 'node:assert/strict';
import {test} from 'node:test';
import {addDays, addWeeks, mondayOf, parseWeek, weekDates, weekId, weekOfDate, weekRange, weeksInYear, weekdayOf} from '../lib/week.ts';
import {dateIn, formatLocal, zonedToUtc} from '../lib/zone.ts';

test('ISO week ids parse, normalise and reject impossible weeks', () => {
	assert.deepEqual(parseWeek('2026-W49'), {year: 2026, week: 49});
	assert.deepEqual(parseWeek('2026w49'), {year: 2026, week: 49});
	assert.deepEqual(parseWeek('2026-W9'), {year: 2026, week: 9});
	assert.equal(weekId({year: 2026, week: 9}), '2026-W09');
	assert.equal(parseWeek('2026-W53') !== null, true, '2026 has 53 ISO weeks (1 January 2026 is a Thursday)');
	assert.equal(parseWeek('2025-W53'), null, '2025 has only 52');
	assert.equal(parseWeek('2026-W00'), null);
	assert.equal(parseWeek('next week'), null);
	assert.equal(weeksInYear(2026), 53);
	assert.equal(weeksInYear(2025), 52);
});

test('the calendar starts on Monday 30 November 2026 (2026-W49)', () => {
	assert.equal(mondayOf({year: 2026, week: 49}), '2026-11-30');
	assert.deepEqual(weekDates({year: 2026, week: 49}), ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05', '2026-12-06']);
	assert.equal(weekdayOf('2026-11-30'), 'Mon');
	assert.deepEqual(weekOfDate('2026-12-06'), {year: 2026, week: 49});
	assert.deepEqual(weekOfDate('2026-12-07'), {year: 2026, week: 50});
});

test('weeks across the year end follow ISO rules', () => {
	assert.deepEqual(weekOfDate('2026-01-01'), {year: 2026, week: 1});
	assert.deepEqual(weekOfDate('2025-12-29'), {year: 2026, week: 1}, 'the Monday of 2026-W01 is in December 2025');
	assert.deepEqual(weekOfDate('2027-01-01'), {year: 2026, week: 53});
	assert.deepEqual(weekOfDate('2027-01-04'), {year: 2027, week: 1});
	assert.deepEqual(addWeeks({year: 2026, week: 52}, 1), {year: 2026, week: 53});
	assert.deepEqual(addWeeks({year: 2026, week: 52}, 2), {year: 2027, week: 1});
	assert.deepEqual(weekRange({year: 2026, week: 49}, {year: 2026, week: 52}).map(weekId), ['2026-W49', '2026-W50', '2026-W51', '2026-W52']);
	assert.equal(addDays('2026-12-31', 1), '2027-01-01');
	assert.equal(addDays('2028-02-28', 1), '2028-02-29');
});

test('slots in America/Chicago become exact UTC instants, CST and CDT', () => {
	const tz = 'America/Chicago';
	const cst = zonedToUtc('2026-11-30', '11:00', tz);
	assert.ok(cst.ok);
	assert.equal(new Date(cst.ms).toISOString(), '2026-11-30T17:00:00.000Z');
	assert.equal(formatLocal(cst.ms, tz), '2026-11-30 11:00 CST');
	const cdt = zonedToUtc('2027-06-01', '11:00', tz);
	assert.ok(cdt.ok);
	assert.equal(new Date(cdt.ms).toISOString(), '2027-06-01T16:00:00.000Z');
	assert.equal(dateIn(Date.parse('2026-12-01T05:30:00Z'), tz), '2026-11-30', 'just before midnight in Chicago');
});

test('a wall time the clocks skip, or pass twice, is refused', () => {
	const tz = 'America/Chicago';
	const gap = zonedToUtc('2027-03-14', '02:30', tz);
	assert.equal(gap.ok, false);
	assert.equal(!gap.ok && gap.reason, 'nonexistent');
	const twice = zonedToUtc('2026-11-01', '01:30', tz);
	assert.equal(twice.ok, false);
	assert.equal(!twice.ok && twice.reason, 'ambiguous');
	assert.equal(zonedToUtc('2026-02-30', '11:00', tz).ok, false);
	assert.equal(zonedToUtc('2026-11-30', '24:00', tz).ok, false);
});
