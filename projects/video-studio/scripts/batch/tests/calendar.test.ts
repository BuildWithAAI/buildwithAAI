import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {factsLabel, renderCalendar} from '../lib/calendar.ts';
import {loadAll} from '../lib/load.ts';
import {parseWeek} from '../lib/week.ts';
import {REAL_CONFIG, STUDIO, testIdea} from './helpers.ts';

const COMMAND = 'node scripts/batch/cli.ts calendar --from 2026-W49 --weeks 4 --out docs/CONTENT_CALENDAR.md';
const render = () => {
	const {config, backlogs} = loadAll(STUDIO, REAL_CONFIG);
	return renderCalendar({config, backlogs, from: parseWeek('2026-W49') as NonNullable<ReturnType<typeof parseWeek>>, weeks: 4, researchExists: (p) => existsSync(join(STUDIO, p)), command: COMMAND});
};

test('docs/CONTENT_CALENDAR.md is exactly what the planner makes from the committed backlogs and settings', () => {
	const committed = readFileSync(join(STUDIO, 'docs', 'CONTENT_CALENDAR.md'), 'utf8');
	assert.equal(committed, render(), `stale: run ${COMMAND}`);
});

test('the calendar covers 4 weeks from 2026-11-30 for both channels, marked as a proposal', () => {
	const md = render();
	assert.match(md, /^# Content calendar: 4 weeks from 30 Nov 2026 \(proposal\)/);
	assert.match(md, /\*\*Proposal, pending the owner's approval\.\*\* Nothing in this calendar is approved, scheduled or uploaded\./);
	for (const w of ['2026-W49', '2026-W50', '2026-W51', '2026-W52']) assert.match(md, new RegExp(`\\(\`${w}\`\\)`));
	assert.match(md, /\| Mon 30 Nov \| 11:00 \| 17:00 \| Zoora AI \| `ai1` \| POV story \| POV: You become a top caller on Pump\.fun \|/);
	assert.match(md, /\| Thu 3 Dec \| 11:00 \| 17:00 \| Zoora AI \| `ai2` \| POV story \| POV: You created an autonomous AI trading agent hedge fund \|/);
	assert.match(md, /\| Tue 1 Dec \| 13:00 \| 19:00 \| Zoodger News \| `sec1` \| Explainer \| How wallet drainers work, and how to spot one \|/);
	assert.equal((md.match(/\*\*Shorts map:\*\* `ai1` → `ai1-s1` \(Mon\), `ai1-s2` \(Tue\), `ai1-s3` \(Wed\) · `ai2` → `ai2-s1` \(Thu\), `ai2-s2` \(Fri\), `ai2-s3` \(Sat\), `ai2-s4` \(Sun\)/g) ?? []).length, 4);
	assert.equal((md.match(/\| en, es, pt-br \|/g) ?? []).length, 44, '11 items a week, every one with Spanish and Portuguese dubs');
	assert.match(md, /Thu 24 Dec is Christmas Eve; Fri 25 Dec is Christmas Day\. Keep, move or skip those slots\./);
	assert.match(md, /daily Threat Brief.*not in this calendar/);
	assert.match(md, /## Not scheduled in these 4 weeks \(backlog order\)/);
	assert.match(md, /## Decisions this calendar needs from the owner/);
	assert.doesNotMatch(md, /\bZOO\b/);
});

test('every week keeps a reserved row for the news round-up, and the pilot\'s format conflict goes to the owner', () => {
	const md = render();
	assert.equal((md.match(/\| Day TBD \(owner\) \| TBD \| TBD \| Zoodger News \| reserved \| Weekly round-up \(news, made in-week\) \| Made in-week, not by the batch \|/g) ?? []).length, 4, 'one reserved round-up row per week');
	assert.match(md, /- The day and time of the Zoodger News weekly round-up: every week above keeps a reserved row for it\./);
	assert.match(md, /\*\*Pilot:\*\* `ai1` is the pilot\. CLAUDE\.md \(Status, Phase 2\) defines the pilot as a 60–90 s video with 1 Short/);
	assert.equal((md.match(/\*\*Pilot:\*\*/g) ?? []).length, 1, 'only the idea whose role is the pilot');
	assert.match(md, /- The pilot's format \(`pumpfun-top-caller`\): CLAUDE\.md's Phase 2 is a 60–90 s pilot with 1 Short/);
	// scheduled Short titles say no more than their cited facts (2026-11-24 review)
	assert.doesNotMatch(md, /Four of six/);
	assert.match(md, /`ai2-s1` \| Short 1 of `ai2` \| The AI that finished last lost more than half \|/);
});

test('the facts label says where each idea stands', () => {
	const idea = (facts: Array<{status: string; factId?: string}>) =>
		testIdea('x', 'pov-story', 1, {facts: facts.map((f, i) => ({need: `n${i}`, factId: f.factId ?? null, status: f.status}))}) as unknown as Parameters<typeof factsLabel>[0];
	assert.equal(factsLabel(idea([{status: 'fact-bank', factId: 'a'}, {status: 'fact-bank', factId: 'b'}]), false), 'all in the fact bank');
	assert.equal(factsLabel(idea([{status: 'researched'}, {status: 'research needed'}]), true), 'research file; 1 still to research');
	assert.equal(factsLabel(idea([{status: 'fact-bank', factId: 'a'}, {status: 'researched'}, {status: 'research needed'}]), true), 'research file; 1 of 3 in the fact bank; 1 still to research');
	assert.equal(factsLabel(idea([{status: 'researched'}]), true), 'research file; move its facts into the bank');
	assert.equal(factsLabel(idea([{status: 'researched'}, {status: 'research needed'}]), false), 'research first; 1 with checked leads; 1 to find');
	assert.equal(factsLabel(idea([{status: 'fact-bank', factId: 'a'}, {status: 'research needed'}]), false), 'research first; 1 of 2 in the fact bank; 1 to find');
	assert.equal(factsLabel(idea([{status: 'research needed'}, {status: 'research needed'}]), false), 'research first: 2 facts to find');
});
