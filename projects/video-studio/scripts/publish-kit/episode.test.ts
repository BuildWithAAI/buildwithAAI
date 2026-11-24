import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {DEFAULT_MADE_FOR_KIDS, DEFAULT_SYNTHETIC_MEDIA, loadEpisode, parseChannelInfo, parseEpisode} from './episode.ts';
import {exampleEpisode, exampleJson, PROJECT} from './test-helpers.ts';
import {InputError} from './util.ts';

const problems = (fn: () => unknown): string => {
	try {
		fn();
	} catch (err) {
		assert.ok(err instanceof InputError, String(err));
		return err.message;
	}
	assert.fail('expected an InputError');
};

describe('parseEpisode with the fictional example', () => {
	const e = exampleEpisode();
	it('reads titles, scenes, Shorts and settings', () => {
		assert.equal(e.title, 'POV: You almost sign a wallet drainer');
		assert.equal(e.titleOptions.length, 3);
		assert.equal(e.totalSec, 200);
		assert.equal(e.timing, 'episode');
		assert.deepEqual(
			e.scenes.filter((s) => s.chapter).map((s) => s.startSec),
			[0, 30, 90, 120, 160],
		);
		assert.deepEqual(
			e.shorts.map((s) => [s.n, s.id, s.sceneIds.join('+'), s.startSec, s.endSec, s.offers.join()]),
			[
				[1, 'short1', 's01+s02', 0, 30, ''],
				[2, 'short2', 's05+s06', 90, 160, 'hardware-wallet'],
			],
		);
		assert.deepEqual(e.hashtags.slice(0, 2), ['CryptoSecurity', 'WalletDrainer']);
		assert.equal(e.madeForKids.value, false);
		assert.equal(e.madeForKids.defaulted, false);
		assert.equal(e.render.shortComposition, 'EpisodeShort');
		assert.equal(e.captions?.length, 220);
		assert.equal(e.channelInfo.handle, '@ZooraTechnologies');
	});
});

describe('defaults', () => {
	it('madeForKids and containsSyntheticMedia default to false with the studio reasons', () => {
		const {madeForKids: _m, containsSyntheticMedia: _c, render: _r, title: _ti, ...rest} = exampleJson();
		void [_m, _c, _r, _ti];
		const e = parseEpisode({episode: rest, channel: 'zoora-ai', slug: '_example'});
		assert.deepEqual(e.madeForKids, {...DEFAULT_MADE_FOR_KIDS, defaulted: true});
		assert.deepEqual(e.containsSyntheticMedia, {...DEFAULT_SYNTHETIC_MEDIA, defaulted: true});
		assert.equal(e.title, e.titleOptions[0]);
		assert.deepEqual(e.render, {entry: 'src/episode/index.ts', composition: 'Episode', shortComposition: null, thumbnailComposition: 'Thumbnail', thumbnails: 3});
		assert.equal(e.captions, null);
		assert.deepEqual(e.channelInfo, {displayName: 'zoora-ai', handle: null});
	});
});

describe('validation collects every problem', () => {
	it('reports each broken field at once', () => {
		const msg = problems(() =>
			parseEpisode({
				episode: {
					...exampleJson(),
					channel: 'other',
					titleOptions: ['x'.repeat(101), 'Fine title'],
					title: 'Not an option',
					summary: 'Use <b>bold</b>',
					tags: ['a'.repeat(300), 'b'.repeat(300)],
					hashtags: ['two words'],
					shortCuts: [{from: 's05', to: 's01', title: 'Backwards'}, {from: 's01', to: 's99', title: 'Missing'}],
					scenes: [{id: 's01', chapter: 'Only', durationSec: 10, offers: ['not-listed']}, {id: 's05', durationSec: 10}],
					paidPromotion: {value: false, reason: 'We say there is no promotion here.'},
				},
				channel: 'zoora-ai',
				slug: '_example',
				captions: [{text: 1}],
			}),
		);
		for (const expected of [
			/"channel" must be "zoora-ai"/,
			/titleOptions\[0\] is 101 characters/,
			/"title" must be one of "titleOptions"/,
			/"summary" must not contain "<" or ">"/,
			/"tags" use 601 of YouTube's 500 characters/,
			/hashtags\[0\] "two words" must be one word/,
			/shortCuts\[0\]: "to" \(s01\) comes before "from" \(s05\)/,
			/shortCuts\[1\]\.to "s99" is not a scene id/,
			/scenes\[0\]\.offers: "not-listed" is not in the episode's "offers"/,
			/"paidPromotion" cannot be false while the episode lists offers/,
			/captions\.json: captions\[0\] needs a string "text"/,
		]) {
			assert.match(msg, expected);
		}
	});
	it('needs at least one Short', () => {
		assert.match(problems(() => exampleEpisode({shortCuts: []})), /"shortCuts" must list at least one Short/);
	});
	it('rejects unsafe render settings', () => {
		const msg = problems(() => exampleEpisode({render: {entry: '../../etc/x.ts', composition: 'Bad Id!', thumbnails: 5}}));
		assert.match(msg, /render\.entry is not valid/);
		assert.match(msg, /render\.composition is not valid/);
		assert.match(msg, /render\.thumbnails must be 1, 2 or 3/);
	});
});

describe('timeline', () => {
	const timeline = (mock = false) => {
		const ids = ['s01', 's02', 's03', 's04', 's05', 's06', 's07', 's08'];
		return {totalMs: 210_000, mock, scenes: ids.map((id, i) => ({id, startMs: i * 26_000, durationMs: 26_000}))};
	};
	it('uses measured scene times when the timeline covers every scene', () => {
		const e = exampleEpisode({}, {timeline: timeline()});
		assert.equal(e.timing, 'timeline');
		assert.equal(e.totalSec, 210);
		assert.deepEqual([e.shorts[1].startSec, e.shorts[1].endSec], [104, 156]);
	});
	it('ignores a mock timeline and says why', () => {
		const e = exampleEpisode({}, {timeline: timeline(true)});
		assert.equal(e.timing, 'episode');
		assert.match(e.notes.join('\n'), /mock timeline/);
	});
});

describe('loading from disk', () => {
	it('loads the example episode folder', () => {
		const e = loadEpisode(PROJECT, 'zoora-ai', '_example');
		assert.equal(e.slug, '_example');
		assert.equal(e.channelInfo.displayName, 'Zoora AI');
	});
	it('refuses bad names and missing folders', () => {
		assert.match(problems(() => loadEpisode(PROJECT, 'zoora-ai', '../secrets')), /expected <channel>\/<slug>/);
		assert.match(problems(() => loadEpisode(PROJECT, 'zoora-ai', 'no-such-episode')), /no episode\.json/);
	});
	it('parseChannelInfo keeps only a plausible handle', () => {
		assert.deepEqual(parseChannelInfo({displayName: 'X', handle: 'not a handle'}, 'x'), {displayName: 'X', handle: null});
	});
});
