import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {parseBacklog} from '../lib/backlog.ts';
import {parseConfig} from '../lib/config.ts';
import {assignWeeks, buildItems} from '../lib/schedule.ts';
import type {Backlog, BatchConfig, PlanItem} from '../lib/types.ts';
import {UsageError} from '../lib/util.ts';
import {parseWeek} from '../lib/week.ts';
import {REAL_CONFIG, STUDIO, testBacklog, testIdea} from './helpers.ts';

const W = (id: string) => parseWeek(id) as NonNullable<ReturnType<typeof parseWeek>>;

const realConfig = (patch: (c: Record<string, unknown>) => void = () => {}): BatchConfig => {
	const data = JSON.parse(readFileSync(REAL_CONFIG, 'utf8')) as Record<string, unknown>;
	patch(data);
	return parseConfig(data, 'config.json', STUDIO, REAL_CONFIG, 'sha');
};

const realBacklogs = (config: BatchConfig): Backlog[] =>
	config.channels.map((c) => parseBacklog(JSON.parse(readFileSync(join(STUDIO, c.backlog), 'utf8')), c.backlog, c, 'sha'));

const backlogs = (config: BatchConfig, byChannel: Record<string, Array<Record<string, unknown>>>): Backlog[] =>
	config.channels.map((c) => parseBacklog(testBacklog(c.channel, byChannel[c.channel] ?? []), `content/${c.channel}/backlog.json`, c, 'sha'));

const weekItems = (config: BatchConfig, bl: Backlog[], week: string, exists = (p: string) => existsSync(join(STUDIO, p))): {items: PlanItem[]; warnings: string[]} => {
	const [wa] = assignWeeks(config, bl, W(week), W(week));
	const r = buildItems(config, wa, exists);
	return {items: r.items, warnings: [...wa.warnings, ...r.warnings]};
};

test('2026-W49 from the real backlogs: the pilot Monday, the hedge fund Thursday, a Short every day, two security explainers', () => {
	const config = realConfig();
	const {items, warnings} = weekItems(config, realBacklogs(config), '2026-W49');
	assert.deepEqual(warnings, []);
	assert.deepEqual(
		items.map((i) => [i.id, i.slot.publishAt, i.renderId, i.slug]),
		[
			['ai1', '2026-11-30T17:00:00.000Z', 'long', 'pumpfun-top-caller'],
			['ai1-s1', '2026-11-30T23:00:00.000Z', 'short-1', 'pumpfun-top-caller'],
			['sec1', '2026-12-01T19:00:00.000Z', 'long', 'explainer-wallet-drainers'],
			['ai1-s2', '2026-12-01T23:00:00.000Z', 'short-2', 'pumpfun-top-caller'],
			['ai1-s3', '2026-12-02T23:00:00.000Z', 'short-3', 'pumpfun-top-caller'],
			['ai2', '2026-12-03T17:00:00.000Z', 'long', 'ai-agent-hedge-fund'],
			['ai2-s1', '2026-12-03T23:00:00.000Z', 'short-1', 'ai-agent-hedge-fund'],
			['ai2-s2', '2026-12-04T23:00:00.000Z', 'short-2', 'ai-agent-hedge-fund'],
			['sec2', '2026-12-05T19:00:00.000Z', 'long', 'sotw-fake-support'],
			['ai2-s3', '2026-12-05T23:00:00.000Z', 'short-3', 'ai-agent-hedge-fund'],
			['ai2-s4', '2026-12-06T23:00:00.000Z', 'short-4', 'ai-agent-hedge-fund'],
		],
	);
	const ai1 = items.find((i) => i.id === 'ai1') as PlanItem;
	assert.equal(ai1.title, 'POV: You become a top caller on Pump.fun');
	assert.deepEqual(ai1.shortIds, ['ai1-s1', 'ai1-s2', 'ai1-s3']);
	assert.equal(ai1.slot.local, '2026-11-30 11:00 CST');
	assert.equal(ai1.paths.kit, 'out/publish/zoora-ai/pumpfun-top-caller/kit.json');
	assert.equal(ai1.paths.writer, 'out/batch/2026-W49/ai1/WRITER.md');
	assert.equal(ai1.research.file, 'content/zoora-ai/pumpfun-top-caller/research.md', 'the pilot research exists');
	assert.deepEqual(ai1.languages, {master: 'en', dubs: ['es', 'pt-br']});
	const ai2 = items.find((i) => i.id === 'ai2') as PlanItem;
	assert.equal(ai2.title, 'POV: You created an autonomous AI trading agent hedge fund');
	assert.equal(ai2.shortIds.length, 4);
	const short = items.find((i) => i.id === 'ai2-s4') as PlanItem;
	assert.equal(short.parentId, 'ai2');
	assert.equal(short.paths.render, 'out/publish/zoora-ai/ai-agent-hedge-fund/media/short-4.mp4');
	assert.equal(short.paths.shortText, 'out/publish/zoora-ai/ai-agent-hedge-fund/shorts-4.txt');
	assert.equal(short.paths.writer, 'out/batch/2026-W49/ai2/WRITER.md', 'a Short is written in its episode\'s packet');
	assert.equal(items.filter((i) => i.channel === 'zoora-security').every((i) => i.kind === 'long'), true, 'security gets explainers only; the daily news stays in scripts/daily');
});

test('four weeks never repeat an idea, and each fills 2 long + 7 Shorts for Zoora AI and 2 security pieces', () => {
	const config = realConfig();
	const bl = realBacklogs(config);
	const weeks = assignWeeks(config, bl, W('2026-W49'), W('2026-W52'));
	assert.deepEqual(weeks.map((w) => w.week), ['2026-W49', '2026-W50', '2026-W51', '2026-W52']);
	const seen = new Set<string>();
	for (const wa of weeks) {
		const {items, warnings} = buildItems(config, wa, () => true);
		assert.deepEqual([...wa.warnings, ...warnings], []);
		assert.equal(items.filter((i) => i.channel === 'zoora-ai' && i.kind === 'long').length, 2);
		assert.equal(items.filter((i) => i.channel === 'zoora-ai' && i.kind === 'short').length, 7);
		assert.equal(items.filter((i) => i.channel === 'zoora-security').length, 2);
		for (const i of items.filter((x) => x.kind === 'long')) {
			assert.ok(!seen.has(`${i.channel}/${i.ideaId}`), `${i.ideaId} is planned twice`);
			seen.add(`${i.channel}/${i.ideaId}`);
		}
	}
	assert.equal(seen.size, 16);
});

test('a slot only takes the formats it lists; a pinned Zoora AI explainer takes a story slot', () => {
	const config = realConfig();
	const bl = backlogs(config, {
		'zoora-ai': [testIdea('pov-a', 'pov-story', 1), testIdea('pov-b', 'pov-story', 2), testIdea('pov-c', 'pov-story', 3), testIdea('expl-a', 'explainer', 9, {week: '2026-W49'})],
		'zoora-security': [testIdea('sotw-first', 'scam-of-the-week', 1), testIdea('expl-sec', 'explainer', 5)],
	});
	const {items} = weekItems(config, bl, '2026-W49', () => false);
	assert.deepEqual(items.filter((i) => i.kind === 'long' && i.channel === 'zoora-ai').map((i) => i.ideaId), ['expl-a', 'pov-a'], 'the pin wins the first slot; the story fills the other');
	assert.deepEqual(items.filter((i) => i.channel === 'zoora-security').map((i) => `${i.slot.day}:${i.ideaId}`), ['Tue:expl-sec', 'Sat:sotw-first'], 'a Scam of the Week never takes the explainer slot');
});

test('a pinned idea takes its week and is skipped by the weeks before it', () => {
	const config = realConfig();
	const bl = backlogs(config, {
		'zoora-ai': [testIdea('p1', 'pov-story', 1), testIdea('p2', 'pov-story', 2, {week: '2026-W50'}), testIdea('p3', 'pov-story', 3), testIdea('p4', 'pov-story', 4)],
		'zoora-security': [testIdea('e1', 'explainer', 1), testIdea('e2', 'explainer', 2), testIdea('s1', 'scam-of-the-week', 1), testIdea('s2', 'scam-of-the-week', 2)],
	});
	const [w49, w50] = assignWeeks(config, bl, W('2026-W49'), W('2026-W50'));
	const ids = (wa: typeof w49, ch: string) => wa.channels.find((c) => c.channel === ch)?.slots.map((x) => x?.id ?? null);
	assert.deepEqual(ids(w49, 'zoora-ai'), ['p1', 'p3']);
	assert.deepEqual(ids(w50, 'zoora-ai'), ['p2', 'p4'], 'the pinned idea takes the first free slot of its week');
	assert.deepEqual(ids(w49, 'zoora-security'), ['e1', 's1']);
	assert.deepEqual(ids(w50, 'zoora-security'), ['e2', 's2']);
});

test('more pinned ideas than slots: the extra one is reported, not dropped silently', () => {
	const config = realConfig();
	const bl = backlogs(config, {
		'zoora-ai': [1, 2, 3].map((n) => testIdea(`p${n}`, 'pov-story', n, {week: '2026-W49'})),
		'zoora-security': [testIdea('e1', 'explainer', 1), testIdea('s1', 'scam-of-the-week', 1)],
	});
	const [wa] = assignWeeks(config, bl, W('2026-W49'), W('2026-W49'));
	assert.equal(wa.warnings.length, 1);
	assert.match(wa.warnings[0], /zoora-ai\/p3 is pinned to 2026-W49, but no free pov-story slot/);
});

test('published and dropped ideas are not planned again unless pinned', () => {
	const config = realConfig();
	const bl = backlogs(config, {
		'zoora-ai': [testIdea('old', 'pov-story', 1, {status: 'published'}), testIdea('gone', 'pov-story', 2, {status: 'dropped', week: '2026-W49'}), testIdea('kept', 'pov-story', 3, {status: 'published', week: '2026-W49'}), testIdea('new', 'pov-story', 4)],
		'zoora-security': [testIdea('e1', 'explainer', 1), testIdea('s1', 'scam-of-the-week', 1)],
	});
	const [wa] = assignWeeks(config, bl, W('2026-W49'), W('2026-W49'));
	assert.deepEqual(wa.channels.find((c) => c.channel === 'zoora-ai')?.slots.map((x) => x?.id), ['kept', 'new']);
});

test('an empty backlog leaves slots empty with a warning, and their Shorts are not planned', () => {
	const config = realConfig();
	const bl = backlogs(config, {'zoora-ai': [testIdea('only', 'pov-story', 1)], 'zoora-security': [testIdea('e1', 'explainer', 1)]});
	const {items, warnings} = weekItems(config, bl, '2026-W49', () => false);
	assert.deepEqual(items.filter((i) => i.channel === 'zoora-ai').map((i) => i.id), ['ai1', 'ai1-s1', 'ai1-s2', 'ai1-s3', 'ai1-s4', 'ai1-s5', 'ai1-s6', 'ai1-s7'], 'every Short is cut from the only episode');
	assert.ok(warnings.some((w) => /zoora-ai Thu 11:00: no pov-story or explainer idea is left/.test(w)));
	assert.ok(warnings.some((w) => /zoora-security Sat 13:00: no scam-of-the-week idea is left/.test(w)));
	assert.equal(items.find((i) => i.id === 'ai1')?.research.ready, false, 'no research file');
});

test('a Short slot before the first episode of the week is reported and skipped', () => {
	const config = realConfig((c) => {
		const ch = (c.channels as Array<Record<string, unknown>>)[0];
		ch.long = [{day: 'Wed', time: '11:00', formats: ['pov-story']}];
	});
	const bl = backlogs(config, {'zoora-ai': [testIdea('p1', 'pov-story', 1)], 'zoora-security': [testIdea('e1', 'explainer', 1), testIdea('s1', 'scam-of-the-week', 1)]});
	const {items, warnings} = weekItems(config, bl, '2026-W49', () => false);
	assert.deepEqual(items.filter((i) => i.kind === 'short').map((i) => `${i.id}@${i.slot.day}`), ['ai1-s1@Wed', 'ai1-s2@Thu', 'ai1-s3@Fri', 'ai1-s4@Sat', 'ai1-s5@Sun']);
	assert.equal(warnings.filter((w) => /no Zoora AI episode is published before it/.test(w)).length, 2, 'Monday and Tuesday');
});

test('planning is deterministic and refuses weeks before the start week', () => {
	const config = realConfig();
	const bl = realBacklogs(config);
	assert.deepEqual(weekItems(config, bl, '2026-W51'), weekItems(config, bl, '2026-W51'));
	assert.throws(() => assignWeeks(config, bl, W('2026-W48'), W('2026-W49')), (e: unknown) => e instanceof UsageError && /before the batch start week/.test(e.message));
	assert.throws(() => assignWeeks(config, bl, W('2026-W50'), W('2026-W49')), UsageError);
});

test('a slot in the spring-forward gap is reported, not converted to a wrong time', () => {
	const config = realConfig((c) => {
		c.startWeek = '2027-W10';
		const ch = (c.channels as Array<Record<string, unknown>>)[1];
		ch.long = [{day: 'Sun', time: '02:30', formats: ['explainer']}, {day: 'Sat', time: '13:00', formats: ['scam-of-the-week']}];
	});
	const bl = backlogs(config, {'zoora-ai': [testIdea('p1', 'pov-story', 1), testIdea('p2', 'pov-story', 2)], 'zoora-security': [testIdea('e1', 'explainer', 1), testIdea('s1', 'scam-of-the-week', 1)]});
	const {items, warnings} = weekItems(config, bl, '2027-W10', () => false);
	assert.ok(warnings.some((w) => /2027-03-14 02:30: .*does not exist in America\/Chicago/.test(w)), warnings.join('\n'));
	assert.equal(items.some((i) => i.ideaId === 'e1'), false);
});
