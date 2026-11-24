/** The renderer's own refusals: storyboard and timeline validation (good fixture + one broken variant per rule). */
import test from 'node:test';
import assert from 'node:assert/strict';
import {developingOf, neededLabels, validateProps, validateShowStoryboard, validateShowTimeline, ZOO_VOICE} from '../validate.ts';
import {segmentTag} from '../segments.ts';
import type {ShowScene, ShowStoryboard} from '../types.ts';
import {clone, codes, fixture, mock, voiced} from './helpers.ts';

const OPTS = {channel: '_dev', slug: 'zoo-badger-demo', lang: 'en', short: false};
const check = (sb: ShowStoryboard, o: Partial<typeof OPTS & {shortId: string}> = {}) => validateShowStoryboard(sb, {...OPTS, ...o});
const scene = (sb: ShowStoryboard, id: string): ShowScene => sb.scenes.find((s) => s.id === id) as ShowScene;
const broken = (fn: (sb: ShowStoryboard) => void): ShowStoryboard => {
	const sb = clone(fixture());
	fn(sb);
	return sb;
};

test('validate: the dev fixture passes for the episode and its Short', () => {
	const sb = fixture();
	assert.deepEqual(codes(check(sb)), []);
	assert.deepEqual(codes(check(sb, {short: true, shortId: 'short1'})), []);
	assert.deepEqual(codes(validateShowTimeline(mock(sb), sb, 30, {dev: true})), []);
	assert.deepEqual(developingOf(sb), {label: 'DEVELOPING', asOf: '2026-11-24T08:00:00Z'});
});

test('validate: props are limited to the security channel and supported languages', () => {
	assert.deepEqual(codes(validateProps({channel: 'zoora-security', slug: 'a-b', lang: 'en'}, false)), []);
	assert.deepEqual(codes(validateProps({channel: 'zoora-ai', slug: 'a-b', lang: 'en'}, false)), ['props.channel']);
	assert.deepEqual(codes(validateProps({channel: '_dev', slug: 'A B', lang: 'fr'}, true)), ['props.slug', 'props.lang']);
});

test('validate: news, not fiction; cited sources must exist and be verified', () => {
	assert.ok(codes(check(broken((sb) => (sb.fiction = true)))).includes('storyboard.fiction'));
	assert.ok(codes(check(broken((sb) => (scene(sb, 's02').narration += ' Also [src:nope].')))).includes('source.unknown'));
	assert.ok(codes(check(broken((sb) => ((sb.sources.find((s) => s.id === 'src-lab') as {status: string}).status = 'unverified')))).includes('source.unverified'));
	assert.ok(codes(check(broken((sb) => (scene(sb, 's02').narration = 'Broken {markup')))).includes('scene.markup'));
	assert.ok(codes(check(broken((sb) => (sb.scenes[1].id = sb.scenes[0].id)))).includes('scene.duplicate'));
});

test('validate: the Rekt Meter shows exactly the reported figure and names who reported it', () => {
	assert.ok(codes(check(broken((sb) => ((scene(sb, 's02').rekt as {usd: number}).usd = 5_200_000)))).includes('rekt.mismatch'));
	assert.ok(codes(check(broken((sb) => delete scene(sb, 's02').onScreen?.loss))).includes('rekt.display'));
	assert.ok(codes(check(broken((sb) => delete scene(sb, 's02').rekt))).includes('rekt.missing'));
	assert.ok(codes(check(broken((sb) => ((scene(sb, 's02').rekt as {source: string}).source = 'src-ghost')))).includes('source.unknown'));
	assert.ok(codes(check(broken((sb) => (((scene(sb, 's02').rekt as {alt: {source: string}}).alt.source = 'src-wire'))))).includes('rekt.altSameSource'));
	assert.ok(codes(check(broken((sb) => (((scene(sb, 's02').rekt as {alt: {usd: number}}).alt.usd = 9e6))))).includes('rekt.altMismatch'));
	// an unreadable display string is a warning (not machine-checked), not a silent pass
	const unread = check(broken((sb) => ((scene(sb, 's02').onScreen as Record<string, string>).loss = 'a lot of money')));
	assert.ok(codes(unread, 'warning').includes('rekt.unchecked'));
});

test('validate: a story with no reported loss hides the Rekt Meter, never $0 or a guessed figure', () => {
	// no source states a loss (most AI-security stories): no onScreen.loss and no rekt is valid, and shows no meter or tag
	const none = broken((sb) => {
		delete scene(sb, 's02').rekt;
		delete (scene(sb, 's02').onScreen as Record<string, string>).loss;
		delete (scene(sb, 's02').onScreen as Record<string, string>).lossAlt;
	});
	assert.ok(!codes(check(none)).some((c) => c.startsWith('rekt.')), codes(check(none)).join());
	assert.equal(segmentTag('headline', scene(none, 's02')), null);
	assert.equal(segmentTag('headline', scene(fixture(), 's02')), 'rektMeter');
	assert.equal(segmentTag('zooOneFix', scene(none, 's02')), 'oneFix', 'other segments keep their tag');
	const es = clone(none);
	es.lang = 'es';
	for (const k of ['rektMeter', 'reportedBy', 'logScale', 'alsoReported'] as const) assert.ok(!neededLabels(es).includes(k), k);
	// a $0 meter is refused, whatever the display says
	const zero = broken((sb) => {
		(scene(sb, 's02').rekt as {usd: number}).usd = 0;
		delete (scene(sb, 's02').rekt as {alt?: unknown}).alt;
		delete (scene(sb, 's02').onScreen as Record<string, string>).lossAlt;
		(scene(sb, 's02').onScreen as Record<string, string>).loss = '$0';
	});
	assert.ok(codes(check(zero)).includes('rekt.usd'));
});

test('validate: diagrams stay concept-level (2-5 nodes, labelled, no code or numbered steps)', () => {
	assert.ok(codes(check(broken((sb) => ((scene(sb, 's03').onScreen as Record<string, string[]>).nodes[1] = 'call upgradeTo(newImpl)')))).some((c) => c.startsWith('concept.')));
	assert.ok(codes(check(broken((sb) => ((scene(sb, 's03').onScreen as Record<string, string[]>).nodes[0] = '1. Steal the deployer key')))).includes('concept.step'));
	assert.ok(codes(check(broken((sb) => ((scene(sb, 's03').diagram as {nodes: string[]}).nodes = ['key'])))).includes('diagram.size'));
	assert.ok(codes(check(broken((sb) => ((scene(sb, 's03').diagram as {nodes: string[]}).nodes[0] = 'laser')))).includes('diagram.kind'));
	assert.ok(codes(check(broken((sb) => ((scene(sb, 's03').onScreen as Record<string, string[]>).links = ['only one'])))).includes('diagram.links'));
	assert.ok(codes(check(broken((sb) => ((scene(sb, 's03').onScreen as Record<string, string[]>).nodes = ['a', 'b'])))).includes('diagram.labels'));
	assert.ok(codes(check(broken((sb) => (scene(sb, 's06').onScreen = {...scene(sb, 's06').onScreen, how: 'funds went to 0xdeadbeef00112233'})))).includes('concept.address'));
});

test('validate: segment copy, beats, outro placement and Badger beats', () => {
	assert.ok(codes(check(broken((sb) => delete scene(sb, 's04').onScreen?.flag))).includes('segment.required'));
	assert.ok(codes(check(broken((sb) => delete scene(sb, 's07').onScreen?.date))).includes('segment.required'));
	assert.ok(codes(check(broken((sb) => sb.scenes.push(clone(sb.scenes[0])) && (sb.scenes[sb.scenes.length - 1].id = 'tail')))).includes('outro.notLast'));
	assert.ok(codes(check(broken((sb) => delete scene(sb, 's01b').minDurationSec))).includes('beat.length'));
	assert.ok(codes(check(broken((sb) => (scene(sb, 's01b').badgerBeats = [{reaction: 'bark' as never}])))).includes('badgerBeats.reaction'));
	assert.ok(codes(check(broken((sb) => (scene(sb, 's01b').badgerBeats = [{reaction: 'judge', after: -2}])))).includes('badgerBeats.after'));
	assert.deepEqual(codes(check(broken((sb) => (scene(sb, 's02').type = 'chart')))), [], 'an explicit segment renders whatever the episode type');
	assert.ok(codes(check(broken((sb) => (delete scene(sb, 's02').segment, (scene(sb, 's02').type = 'chart'))))).includes('scene.segment'));
	assert.ok(codes(check(broken((sb) => (sb.shorts = [{id: 'short1', sceneIds: ['s01', 'zz'], title: 'x'}])), {short: true, shortId: 'short1'})).includes('short.scene'));
	assert.ok(codes(check(fixture(), {short: true, shortId: 'nope'})).includes('short.unknown'));
});

test('validate: a dubbed storyboard must translate every label its render shows', () => {
	const es = broken((sb) => (sb.lang = 'es'));
	const issues = check(es, {lang: 'es'});
	assert.ok(codes(issues).includes('showUi.missing'));
	const need = neededLabels(es);
	for (const k of ['rektMeter', 'reportedBy', 'alsoReported', 'howItWorked', 'conceptOnly', 'redFlag', 'oneFix', 'scamOfTheWeek', 'correction', 'weSaid', 'correct', 'sources', 'explainer', 'source', 'asOf'] as const) assert.ok(need.includes(k), k);
	es.showUi = Object.fromEntries(need.map((k) => [k, `es:${k}`]));
	assert.deepEqual(codes(check(es, {lang: 'es'})), []);
});

test('validate: timelines must match the storyboard and carry Zoo\'s voice (im_nicola)', () => {
	const sb = fixture();
	assert.deepEqual(codes(validateShowTimeline(voiced(sb), sb, 30, {dev: false})), []);
	assert.equal(ZOO_VOICE, 'im_nicola');
	assert.ok(codes(validateShowTimeline(voiced(sb, 'am_michael'), sb, 30, {dev: false})).includes('timeline.voice'));
	assert.ok(codes(validateShowTimeline(voiced(sb, 'am_michael'), sb, 30, {dev: true}), 'warning').includes('timeline.voice'));
	assert.ok(codes(validateShowTimeline(mock(sb), sb, 30, {dev: false})).includes('timeline.mock'));
	const tl = voiced(sb);
	tl.scenes[2].mouth = tl.scenes[2].mouth.slice(1);
	assert.ok(codes(validateShowTimeline(tl, sb, 30, {dev: false})).includes('timeline.mouth'));
	const tl2 = voiced(sb);
	tl2.scenes.pop();
	assert.ok(codes(validateShowTimeline(tl2, sb, 30, {dev: false})).includes('timeline.scenes'));
	const tl3 = voiced(sb);
	tl3.scenes[1].startMs += 100;
	assert.ok(codes(validateShowTimeline(tl3, sb, 30, {dev: false})).includes('timeline.start'));
	assert.ok(codes(validateShowTimeline(voiced(sb), sb, 25, {dev: false})).includes('timeline.fps'));
});
