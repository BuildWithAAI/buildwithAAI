/**
 * The AI-lane review, round 2 (2026-11-25): a crypto pick keeps its name allowlisted even when the radar read the name
 * from a headline's shape (only AI and both-lane names lose that), so its own news gate passes.
 */
import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, it} from 'node:test';
import {runRules} from '../../news/lib/rules.ts';
import {episodePaths} from '../lib/paths.ts';
import {runPrepare} from '../lib/prepare.ts';
import {subjectKnown} from '../lib/radar.ts';
import type {DailyBrief} from '../lib/types.ts';
import {fakeExec, fixtureBridge, fixtureLend, fixturePhish, fixtureSwap, incident, NOW, seedRadarDay, SLUG, STUDIO, tempRoot} from './helpers.ts';

const NEWS_GOOD = join(STUDIO, 'scripts', 'news', 'fixtures', 'zoora-security', 'good-fixtureswap-drain');

describe('a crypto name read from a headline shape stays allowlisted (daily-crypto-namknown-false)', () => {
	const moldy = () => incident({id: '2026-11-24-moldy-roost', protocol: 'Moldy Roost', lane: 'crypto', subjectKnown: false, score: {total: 20}});
	const intel = () => incident({id: '2026-11-24-intelbroker', protocol: 'IntelBroker', lane: 'ai', type: 'ai-data-exposure', subjectKnown: false, score: {total: 19}});
	const both = () => incident({id: '2026-11-24-kiro', protocol: 'Kiro', lane: 'both', type: 'ai-phishing', subjectKnown: false, score: {total: 18}});

	it('subjectKnown: crypto always, AI and both lanes only when the radar knows the name', () => {
		assert.equal(subjectKnown(moldy()), true, 'a crypto name the radar read from a headline shape');
		assert.equal(subjectKnown({...moldy(), lane: undefined}), true, 'no lane is crypto');
		assert.equal(subjectKnown(intel()), false);
		assert.equal(subjectKnown(both()), false);
		assert.equal(subjectKnown({...intel(), subjectKnown: undefined}), false, 'an older file: AI names are unknown');
		assert.equal(subjectKnown({...intel(), subjectKnown: true}), true);
	});

	it('prepare: the crypto pick gets no nameKnown:false, crypto alternates stay entities, AI ones do not', () => {
		const {root, cleanup} = tempRoot();
		try {
			seedRadarDay(root, [{...fixtureSwap(), subjectKnown: false}, fixtureBridge(), fixtureLend(), fixturePhish(), moldy(), intel(), both()]);
			const r = runPrepare({root, radar: 'reuse', exec: fakeExec().exec, now: () => NOW});
			assert.equal(r.exitCode, 0, r.messages.join('\n'));
			const brief = JSON.parse(readFileSync(episodePaths(root, SLUG).brief, 'utf8')) as DailyBrief;
			const primary = brief.incidents.find((i) => i.role === 'primary');
			assert.equal(primary?.name, 'FixtureSwap');
			assert.equal(primary?.nameKnown, undefined, JSON.stringify(primary));
			const entities = brief.entities.map((e) => e.name);
			assert.ok(entities.includes('Moldy Roost'), entities.join(', '));
			assert.ok(!entities.includes('IntelBroker') && !entities.includes('Kiro'), entities.join(', '));

			// the daily's own incident record drives the news gate: the pick's name must pass R4 there. The good fixture's
			// post-mortem publisher is renamed, so the name is known only through the incident (as for a news-only pick).
			const sb = JSON.parse(readFileSync(join(NEWS_GOOD, 'storyboard.json'), 'utf8'));
			const gateBrief = JSON.parse(readFileSync(join(NEWS_GOOD, 'brief.json'), 'utf8'));
			for (const s of gateBrief.sources) if (s.publisher === 'FixtureSwap') s.publisher = 'Example Post';
			gateBrief.incidents[0] = {...gateBrief.incidents[0], ...(primary?.nameKnown === undefined ? {} : {nameKnown: primary.nameKnown})};
			const allow = JSON.parse(readFileSync(join(STUDIO, 'scripts', 'news', 'allowlist.json'), 'utf8'));
			const errors = runRules({storyboard: sb, brief: gateBrief, corrections: null, allowlist: allow, slug: sb.slug}).findings.filter((f) => f.severity === 'error');
			assert.deepEqual(errors.map((f) => `${f.code}: ${f.message}`), []);
		} finally {
			cleanup();
		}
	});

	it('prepare: an AI pick read from a headline shape still gets nameKnown:false', () => {
		const {root, cleanup} = tempRoot();
		try {
			const ai = {...fixtureSwap(), lane: 'ai' as const, type: 'ai-data-exposure', subjectKnown: false};
			seedRadarDay(root, [ai, fixtureBridge(), fixtureLend(), fixturePhish()]);
			const r = runPrepare({root, radar: 'reuse', exec: fakeExec().exec, now: () => NOW, pick: ai.id});
			const brief = r.brief;
			assert.ok(brief, r.messages.join('\n'));
			assert.equal(brief?.incidents.find((i) => i.role === 'primary')?.nameKnown, false);
		} finally {
			cleanup();
		}
	});
});
