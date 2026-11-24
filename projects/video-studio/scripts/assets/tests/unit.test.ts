/** Unit tests: markup adapter, X counting, escaping, lint, offers, chapters/cues, UUIDv5, ID3 writer. */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {displayText as theirDisplay, sourceIds as theirSources} from '../../../src/episode/markup.ts';
import {esc, htmlBalanceProblems, isSafeUrl, jsonLd, xml} from '../lib/html.ts';
import {buildId3v23, parseId3} from '../lib/id3.ts';
import {checkDisclosedLinks, lintText, namePatterns, redact, unknownHubLinks} from '../lib/lint.ts';
import {displayText, MarkupError, sourceIds} from '../lib/markup.ts';
import {hubLink, selectOffers, subscribeLink} from '../lib/offers.ts';
import {podcastGuid, uuidv5} from '../lib/rss.ts';
import {chapters, cues, paragraphs, toSrt, toVtt} from '../lib/transcript.ts';
import type {EpisodeStoryboard, EpisodeTimeline, Offer} from '../lib/types.ts';
import {clock, isoDuration, isoTimestamp, publishTime, rfc822, truncate} from '../lib/util.ts';
import {buildPodcastFeed, cdata, type FeedItem} from '../lib/rss.ts';
import {chaptersFromKit, parseClock} from '../lib/transcript.ts';
import {encodeM4a, ffmetaEscape} from '../lib/audio.ts';
import type {PodcastShow} from '../lib/config.ts';
import {findUrls, xLength} from '../lib/xcount.ts';
import {FIXTURES, HAS_FFMPEG, HAS_PYTHON, xmlError} from './helpers.ts';

const fixtureStoryboard = (lang: 'en' | 'es') =>
	JSON.parse(readFileSync(join(FIXTURES, 'content/zoora-security/fixture-fake-support', lang === 'en' ? 'storyboard.json' : `storyboard.${lang}.json`), 'utf8')) as EpisodeStoryboard;
const fixtureTimeline = (lang: 'en' | 'es') => JSON.parse(readFileSync(join(FIXTURES, 'generated/zoora-security/fixture-fake-support', lang, 'timeline.json'), 'utf8')) as EpisodeTimeline;

test('markup adapter matches src/episode/markup.ts on fixtures and edge cases', () => {
	const cases = [
		...fixtureStoryboard('en').scenes.map((s) => s.narration),
		...fixtureStoryboard('es').scenes.map((s) => s.narration),
		'Price hit {$40,000|forty thousand dollars} today [src:a]. Then it fell [src:a,b], fast.',
		'Claim one [src:x] and claim two [src:y]',
		'{SOL|} and {|uh} spacing  test',
		'नमस्ते [src:hi]। अगला वाक्य',
		'报道称 [src:zh]。下一句',
	];
	// The adapter hugs the Devanagari danda (। ॥) to the word before it, as the episode engine's current markup.ts
	// does. The committed markup.ts may still be the version before that change (it lands with the episode workflow's
	// next commit): then, and only then, the one known difference is a space before a danda. Anything else must match.
	const upstreamHugsDanda = theirDisplay('क [src:x]।') === 'क।';
	for (const c of cases) {
		const ours = displayText(c);
		const theirs = theirDisplay(c);
		if (!upstreamHugsDanda && /[।॥]/.test(c)) assert.equal(ours, theirs.replace(/ ([।॥])/g, '$1'), `${c} (older upstream: only the space before a danda may differ)`);
		else assert.equal(ours, theirs, c);
		assert.deepEqual(sourceIds(c), [...new Set(theirSources(c))], c);
	}
	assert.equal(displayText('नमस्ते [src:hi]। अगला वाक्य'), 'नमस्ते। अगला वाक्य', 'the danda hugs the word before it');
	assert.throws(() => displayText('broken {markup'), MarkupError);
	assert.throws(() => displayText('bad [src:] tag'), MarkupError);
});

test('X weighted length: URLs 23, CJK and emoji 2, Latin 1', () => {
	assert.equal(xLength('hello'), 5);
	assert.equal(xLength('https://go.zoora.ai/articles/zoora-security/a-very-long-slug-that-goes-on/en/'), 23);
	assert.equal(xLength('see zoora.ai now'), 4 + 23 + 4);
	assert.equal(xLength('你好'), 4);
	assert.equal(xLength('ok 👍'), 3 + 2);
	assert.equal(xLength('👨‍👩‍👧'), 2); // one ZWJ sequence
	assert.equal(xLength('…'), 2); // U+2026 is outside the weight-1 ranges
	assert.equal(xLength('café — “quoted”'), 15); // U+2014 and curly quotes weigh 1
	assert.deepEqual(
		findUrls('Watch: https://www.youtube.com/watch?v=Zb7xq2Ph0aA.').map((u) => u.url),
		['https://www.youtube.com/watch?v=Zb7xq2Ph0aA'],
	);
});

test('time and text helpers', () => {
	assert.equal(clock(0), '00:00');
	assert.equal(clock(61_999), '01:01');
	assert.equal(clock(3_723_000), '1:02:03');
	assert.equal(isoDuration(61_300), 'PT1M1S');
	assert.equal(isoDuration(3_600_000), 'PT1H');
	assert.equal(isoDuration(0), 'PT0S');
	assert.equal(isoTimestamp('2026-11-24'), '2026-11-24T06:00:00Z', 'a date alone is 00:00 in the owner\'s time zone (CST, UTC-6)');
	assert.equal(isoTimestamp('2026-11-24T09:30:00+01:00'), '2026-11-24T08:30:00Z');
	assert.equal(isoTimestamp('next tuesday'), null);
	assert.equal(rfc822('2026-11-24T00:00:00Z'), 'Tue, 24 Nov 2026 00:00:00 +0000');
	assert.equal(truncate('one two three four', 12), 'one two…');
	assert.equal(truncate('short', 12), 'short');
});

test('escaping: HTML, XML and JSON-LD cannot be broken out of', () => {
	const evil = `</script><script>alert(1)</script> & "quotes" 'single' <b>`;
	assert.equal(esc(evil).includes('<'), false);
	assert.equal(esc(evil).includes('"'), false);
	assert.equal(xml('a & b < c \u0001'), 'a &amp; b &lt; c ');
	const ld = jsonLd({name: evil, sep: 'a\u2028b'});
	assert.equal(/<|>|&/.test(ld), false);
	assert.equal(/\u2028/.test(ld), false);
	assert.deepEqual(JSON.parse(ld), {name: evil, sep: 'a\u2028b'});
	assert.equal(isSafeUrl('javascript:alert(1)'), false);
	assert.equal(isSafeUrl('https://user:pw@example.org/'), false);
	assert.equal(isSafeUrl('http://example.org/', {httpsOnly: true}), false);
	assert.equal(isSafeUrl('https://consumer.ftc.gov/'), true);
	assert.deepEqual(htmlBalanceProblems('<p><b>x</b></p><br>'), []);
	assert.equal(htmlBalanceProblems('<p><b>x</p>').length > 0, true);
});

test('lint: income claims, ZOO, private names, placeholders, soft words', () => {
	const names = namePatterns(['Quentin Marlowe-Testperson']);
	const errs = (t: string, transcript = false) => lintText(t, 'x', {names, transcript}).filter((i) => i.level === 'error').map((i) => i.rule);
	assert.deepEqual(errs('Guaranteed returns, 100x!'), ['income-claim', 'income-claim']);
	assert.deepEqual(errs('Ganancias garantizadas y sin riesgo'), ['income-claim', 'income-claim']);
	assert.deepEqual(errs("ZOO'S ONE FIX"), ['zoo-name']);
	assert.deepEqual(errs("Zoo's one fix, from ZOORA"), []);
	assert.deepEqual(errs('Thanks to quentin   marlowe-testperson for the tip'), ['private-name']);
	assert.deepEqual(errs('TODO: write this'), ['placeholder']);
	assert.deepEqual(errs('A 1920x1080 frame and 3000 x 3000 art'), []);
	// in the transcript a claim word is a warning (the approved video says it), names and ZOO stay errors
	assert.deepEqual(errs('they promise guaranteed profit', true), []);
	assert.equal(lintText('they promise guaranteed profit', 't', {names, transcript: true}).some((i) => i.level === 'warning'), true);
	const priv = lintText('Quentin Marlowe-Testperson', 'x', {names})[0];
	assert.equal(priv.message.includes('Quentin'), false, 'the private name is never echoed back');
	const both = lintText('Quentin Marlowe-Testperson promised guaranteed money', 'x', {names});
	assert.equal(both.length >= 2, true);
	assert.equal(both.some((i) => /quentin/i.test(i.message)), false, 'nor quoted inside another finding');
	assert.equal(redact('Ask quentin marlowe-testperson.', names), 'Ask [private name].');
	assert.equal(lintText('Track your profits', 'x', {names}).some((i) => i.rule === 'soft-claim'), true);
});

test('lint: every offer link needs its disclosure close before it', () => {
	const link = {url: 'https://go.zoora.ai/go/w?v=s&s=x', disclosure: 'Affiliate link: I may earn a commission.', label: 'offer "w"'};
	assert.deepEqual(checkDisclosedLinks(`Affiliate link: I may earn a commission.\nWallet: ${link.url}`, [link], 'p'), []);
	assert.equal(checkDisclosedLinks(`Wallet: ${link.url}\nAffiliate link: I may earn a commission.`, [link], 'p').length, 1);
	const twice = `Affiliate link: I may earn a commission.\n${link.url}\n${'x'.repeat(700)}\n${link.url}`;
	assert.equal(checkDisclosedLinks(twice, [link], 'p').length, 1, 'the second occurrence is too far from the disclosure');
	assert.equal(unknownHubLinks('see https://go.zoora.ai/go/other?v=s&s=x', 'https://go.zoora.ai', [link.url], 'p').length, 1);
});

test('offers: only live, unrestricted, disclosed, non-exchange offers are used', () => {
	const base: Offer = {id: 'w', name: 'W', url: 'https://w.test/', category: 'security', relationship: 'affiliate', disclosure: 'Affiliate link: I may earn a commission.', blockedCountries: [], unknownCountry: 'allow', active: true};
	const registry: Offer[] = [
		base,
		{...base, id: 'ex', category: 'exchange', unknownCountry: 'block', blockedCountries: ['US']},
		{...base, id: 'off', active: false},
		{...base, id: 'old', expires: '2026-01-01'},
		{...base, id: 'region', allowedCountries: ['DE']},
		{...base, id: 'vague', disclosure: 'Check this out.'},
	];
	const sel = selectOffers(['w', 'ex', 'off', 'old', 'region', 'vague', 'missing'], registry, 'r.json', new Date('2026-11-24T00:00:00Z'));
	assert.deepEqual(sel.offers.map((o) => o.id), ['w']);
	assert.deepEqual(sel.leftOut.map((o) => o.id), ['ex', 'off', 'old', 'region', 'vague', 'missing']);
	assert.deepEqual(selectOffers(['w'], null, null, new Date()).offers, []);
	// other languages need an owner-approved translation of the disclosure
	const es = selectOffers(['w'], registry, 'r.json', new Date(), {lang: 'es'});
	assert.deepEqual(es.offers, []);
	assert.match(es.leftOut[0].reason, /no es disclosure/);
	const es2 = selectOffers(['w'], registry, 'r.json', new Date(), {lang: 'es', localized: {w: {es: 'Enlace de afiliado: puedo ganar una comisión.'}}});
	assert.equal(es2.offers[0].disclosure, 'Enlace de afiliado: puedo ganar una comisión.');
	assert.equal(hubLink('https://go.zoora.ai', 'w', 'ep-1', 'site'), 'https://go.zoora.ai/go/w?v=ep-1&s=site');
	assert.equal(subscribeLink('https://go.zoora.ai', 'ep-1', 'site'), 'https://go.zoora.ai/subscribe?s=site&v=ep-1');
});

test('transcript: paragraphs per scene, chapters from scene boundaries, caption cues', () => {
	const sb = fixtureStoryboard('en');
	const tl = fixtureTimeline('en');
	const paras = paragraphs(sb, tl);
	assert.equal(paras.length, sb.scenes.length);
	assert.equal(paras[2].text.includes('10 minutes'), true, 'display side of {10|ten}');
	assert.deepEqual(paras[1].sourceIds, ['ftc-crypto-scams']);
	const chs = chapters(sb, tl);
	assert.equal(chs[0].startMs, 0);
	assert.equal(chs[chs.length - 1].endMs, tl.totalMs);
	for (let i = 0; i < chs.length - 1; i++) assert.equal(chs[i].endMs, chs[i + 1].startMs);
	for (const c of chs.slice(0, -1)) assert.equal(c.endMs - c.startMs >= 10_000, true, `${c.title} is at least 10 s`);
	assert.deepEqual(chs.map((c) => c.title), ['Support never DMs you first', "Badger's Red Flag: the countdown", "Zoo's One Fix"]);
	assert.deepEqual(chapters(sb, null), []);
	const noTimeline = paragraphs(sb, null);
	assert.equal(noTimeline[0].startMs, null);
	const list = cues(tl, 'en');
	for (const c of list) {
		assert.equal(c.endMs > c.startMs, true);
		assert.equal([...c.text].length <= 60, true);
	}
	for (let i = 1; i < list.length; i++) assert.equal(list[i].startMs >= list[i - 1].endMs, true);
	assert.match(toVtt(list), /^WEBVTT\n\n1\n00:00:00\.\d{3} --> /);
	assert.match(toSrt(list), /^1\n00:00:00,\d{3} --> /);
});

test('podcast:guid is UUIDv5 of the scheme-less feed URL (spec test vectors)', () => {
	assert.equal(podcastGuid('https://mp3s.nashownotes.com/pc20rss.xml'), '917393e3-1b1e-5cef-ace4-edaa54e1f810');
	assert.equal(podcastGuid('https://podnews.net/rss/'), '9b024349-ccf0-5f69-a609-6b82873eab3c');
	// RFC 4122 appendix-style check: DNS namespace, "www.example.com"
	assert.equal(uuidv5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8'), '2ed6657d-e927-568b-95e1-2665a8aea6a2');
});

test('ID3v2.3 writer: frames, CTOC/CHAP chapters and UTF-16 round-trip', () => {
	const tag = buildId3v23({
		title: 'Zoo & Badger: ¿Qué pasó? 你好',
		artist: 'Zoora AI',
		album: 'The Zoo & Badger Show',
		genre: 'Podcast',
		year: '2026',
		language: 'eng',
		comment: {lang: 'eng', text: 'Summary'},
		lengthMs: 61300,
		url: {description: 'Episode page', url: 'https://go.zoora.ai/articles/x/'},
		chapters: [
			{id: 'chp0', startMs: 0, endMs: 22900, title: 'Intro'},
			{id: 'chp1', startMs: 22900, endMs: 61300, title: 'Señal de alarma', url: 'https://go.zoora.ai/articles/x/#ch-s03'},
		],
		tocTitle: 'Chapters',
	});
	assert.equal(String.fromCharCode(...tag.subarray(0, 3)), 'ID3');
	assert.equal(tag[3], 3);
	for (const b of tag.subarray(6, 10)) assert.equal(b < 0x80, true, 'synchsafe size');
	const parsed = parseId3(tag);
	assert.ok(parsed);
	assert.equal(parsed.frames.find((f) => f.id === 'TIT2')?.text, 'Zoo & Badger: ¿Qué pasó? 你好');
	assert.equal(parsed.frames.find((f) => f.id === 'TLEN')?.text, '61300');
	assert.deepEqual(parsed.toc, {flags: 3, children: ['chp0', 'chp1']});
	assert.deepEqual(parsed.chapters, [
		{id: 'chp0', startMs: 0, endMs: 22900, title: 'Intro'},
		{id: 'chp1', startMs: 22900, endMs: 61300, title: 'Señal de alarma', url: 'https://go.zoora.ai/articles/x/#ch-s03'},
	]);
	assert.throws(() => buildId3v23({title: 'x', artist: 'y', album: 'z', chapters: [{id: 'a', startMs: 5, endMs: 5, title: 't'}]}));
});

test('ffprobe reads the chapters written by the ID3 writer', {skip: !HAS_FFMPEG && 'ffmpeg not installed'}, () => {
	const dir = mkdtempSync(join(tmpdir(), 'assets-id3-'));
	const raw = join(dir, 'raw.mp3');
	const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=44100:duration=3', '-c:a', 'libmp3lame', '-b:a', '64k', '-id3v2_version', '0', raw]);
	assert.equal(r.status, 0);
	const tag = buildId3v23({title: 'T', artist: 'A', album: 'B', chapters: [{id: 'c0', startMs: 0, endMs: 1500, title: 'Uno'}, {id: 'c1', startMs: 1500, endMs: 3000, title: 'Dós'}]});
	const file = join(dir, 'tagged.mp3');
	writeFileSync(file, Buffer.concat([tag, readFileSync(raw)]));
	const probe = spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_chapters', '-show_format', file], {encoding: 'utf8'});
	const j = JSON.parse(probe.stdout) as {chapters: {start_time: string; end_time: string; tags: {title: string}}[]; format: {tags: {title: string}}};
	assert.deepEqual(j.chapters.map((c) => [Number(c.start_time), Number(c.end_time), c.tags.title]), [[0, 1.5, 'Uno'], [1.5, 3, 'Dós']]);
	assert.equal(j.format.tags.title, 'T');
});

test('publish times: a date alone is that day in America/Chicago (CST or CDT); a timestamp is kept', () => {
	assert.deepEqual(publishTime('2026-11-30'), {timestamp: '2026-11-30T06:00:00Z', date: '2026-11-30', dateOnly: true});
	assert.deepEqual(publishTime('2026-07-01'), {timestamp: '2026-07-01T05:00:00Z', date: '2026-07-01', dateOnly: true}, 'daylight time: UTC-5');
	assert.deepEqual(publishTime('2026-11-30T17:00:00Z'), {timestamp: '2026-11-30T17:00:00Z', date: '2026-11-30', dateOnly: false});
	assert.equal(publishTime('2026-02-30'), null);
	assert.equal(publishTime('soon'), null);
});

const SHOW: PodcastShow = {title: 'Show', description: 'd', author: 'a', ownerName: 'o', ownerEmail: 'owner@example.com', feedUrl: 'https://p.example/feed.xml', mediaBase: 'https://p.example/m', imageUrl: 'https://p.example/i.png', link: 'https://p.example/', categories: [['Technology']], explicit: false, type: 'episodic', copyright: null, guid: null, locked: true} as unknown as PodcastShow;
const ITEM: FeedItem = {guid: 'g1', title: 'T', link: 'https://p.example/a', descriptionHtml: '<p>x</p>', pubDate: '2026-11-24T12:00:00Z', durationSec: 61, explicit: false, episodeType: 'full', enclosure: {url: 'https://p.example/m/e.mp3', bytes: 100, type: 'audio/mpeg'}, chaptersUrl: null, transcripts: [], chapters: []};

test('podcast feed: characters XML 1.0 forbids never reach a CDATA section, whatever the show notes hold', {skip: !HAS_PYTHON && 'python3 not installed'}, () => {
	for (const bad of ['\u000B', '\u000C', '\u0001', '\uFFFE', '\uD800', ']]>']) {
		const xmlText = buildPodcastFeed(SHOW, 'en', [{...ITEM, descriptionHtml: `<p>before${bad}after</p>`}, {...ITEM, guid: 'g2'}], '2026-11-24T12:00:00Z');
		assert.equal(xmlError(xmlText), null, JSON.stringify(bad));
	}
	assert.equal(cdata('a\u000Bb]]>c'), '<![CDATA[ab]]]]><![CDATA[>c]]>');
});

test('podcast feed: only positive whole season and episode numbers and numeric lengths are written', {skip: !HAS_PYTHON && 'python3 not installed'}, () => {
	const payload = '1</itunes:season></item><itunes:new-feed-url>https://attacker.example/feed.xml</itunes:new-feed-url><item><itunes:season>1';
	const forged = {...ITEM, season: payload, episode: 1.5, durationSec: '9</itunes:duration><x>', episodeType: 'full</itunes:episodeType><x>', enclosure: {...ITEM.enclosure, bytes: '1" injected="1'}} as unknown as FeedItem;
	const xmlText = buildPodcastFeed(SHOW, 'en', [forged], '2026-11-24T12:00:00Z');
	assert.equal(xmlError(xmlText), null);
	assert.equal(xmlText.includes('itunes:season'), false);
	assert.equal(xmlText.includes('itunes:episode>'), false);
	assert.equal(xmlText.includes('new-feed-url'), false);
	assert.match(xmlText, /<itunes:duration>0<\/itunes:duration>/);
	assert.match(xmlText, /<itunes:episodeType>full<\/itunes:episodeType>/);
	assert.match(xmlText, /length="0"/);
	const ok = buildPodcastFeed(SHOW, 'en', [{...ITEM, season: 2, episode: 7}], '2026-11-24T12:00:00Z');
	assert.match(ok, /<itunes:season>2<\/itunes:season>\n {6}<itunes:episode>7<\/itunes:episode>/);
});

test('ffmetadata: a carriage return or NUL in a title can neither add a key nor a chapter', {skip: !HAS_FFMPEG && 'ffmpeg not installed', timeout: 60_000}, () => {
	assert.equal(ffmetaEscape('Episode\rartist=INJECTED'), 'Episode artist\\=INJECTED');
	assert.equal(ffmetaEscape('a\u0000b;c#d\\e\nf'), 'a b\\;c\\#d\\\\e\\\nf');
	const dir = mkdtempSync(join(tmpdir(), 'assets-ffmeta-'));
	const master = join(dir, 'm.wav');
	const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', '4', master]);
	assert.equal(r.status, 0, String(r.stderr));
	const out = join(dir, 'e.m4a');
	const meta = {title: 'Episode\rartist=INJECTED', artist: 'Zoora AI', album: 'Show', genre: 'Technology', date: '2026', comment: 'c\u0000[CHAPTER]', copyright: 'x'};
	encodeM4a(master, out, meta, [
		{startMs: 0, endMs: 2000, title: 'One\r[CHAPTER]\rTIMEBASE=1/1000\rSTART=2500\rEND=3000\rtitle=FORGED'},
		{startMs: 2000, endMs: 4000, title: 'Two'},
	], null);
	const p = spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_chapters', out], {encoding: 'utf8'});
	const j = JSON.parse(p.stdout) as {format: {tags: Record<string, string>}; chapters: Array<{tags: {title: string}}>};
	assert.equal(j.format.tags.artist, 'Zoora AI', 'no injected artist');
	assert.equal(j.format.tags.title, 'Episode artist=INJECTED', 'the whole value stays one title');
	assert.deepEqual(j.chapters.map((c) => c.tags.title), ['One [CHAPTER] TIMEBASE=1/1000 START=2500 END=3000 title=FORGED', 'Two'], 'exactly the two chapters');
});

test('chapters from the publish kit: its boundaries on this timeline; a dub keeps them with its own titles', () => {
	const sb = fixtureStoryboard('en');
	const tl = fixtureTimeline('en');
	const kit = [
		{start: '00:00', title: 'Support never DMs you first'},
		{start: '00:09', title: 'How the fake support trick works'},
		{start: '00:22', title: "Badger's Red Flag"},
		{start: '00:35', title: "Zoo's One Fix"},
	];
	const ch = chaptersFromKit(kit, sb, tl);
	assert.ok(ch);
	assert.deepEqual(ch.map((c) => [c.startMs, c.title, c.sceneIds]), [
		[0, 'Support never DMs you first', ['s01']],
		[9000, 'How the fake support trick works', ['s02']],
		[22000, "Badger's Red Flag", ['s03']],
		[35000, "Zoo's One Fix", ['s04', 's05', 's06']],
	]);
	assert.equal(ch[3].endMs, tl.totalMs);
	const es = chaptersFromKit(kit, fixtureStoryboard('es'), fixtureTimeline('es'), {localTitles: true});
	assert.ok(es && es[0].title !== kit[0].title, 'a dub keeps the boundaries but titles chapters in its own language');
	assert.equal(chaptersFromKit([{start: '00:05', title: 'x'}], sb, tl), null, 'must start at 00:00');
	assert.equal(chaptersFromKit([{start: '00:00', title: 'a'}, {start: '00:00', title: 'b'}], sb, tl), null, 'must rise');
	assert.equal(chaptersFromKit([{start: '00:00', title: 'a'}, {start: '59:00', title: 'b'}], sb, tl), null, 'must end before the narration does');
	assert.equal(parseClock('1:02:03'), 3_723_000);
	assert.equal(parseClock('00:61'), null);
});

test('the es/pt-br income rules catch the imperative forms too ("hazte rico", "fique rico")', () => {
	for (const t of ['Hazte rico con memecoins', 'Fique rico com memecoins', 'Ganancias garantizadas', 'Sem risco']) assert.ok(lintText(t, 't', {names: []}).some((i) => i.rule === 'income-claim'), t);
	assert.deepEqual(lintText('Cómo funciona la estafa del soporte falso', 't', {names: []}).filter((i) => i.level === 'error'), []);
});
