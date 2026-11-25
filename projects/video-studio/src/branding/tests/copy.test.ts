/**
 * Channel copy tests: the lint rules on synthetic text, then both real channel-copy.md files against YouTube's limits
 * and the house rules.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {lintChannelCopy, lintText, parseBlocks, parsePlaylists, spoken, storedKeywords, wordCount} from '../copy.ts';
import {SERIES} from '../series.ts';
import {END_LABELS} from '../layout.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (ch: string) => readFileSync(join(ROOT, 'content', ch, 'channel-copy.md'), 'utf8');

test('copy: block parsing, stored keywords and playlists', () => {
	const md = 'x\n```text id=a\nline one\nline two\n```\n\n```text id=b\nz\n```\n';
	assert.deepEqual(parseBlocks(md), {a: 'line one\nline two', b: 'z'});
	assert.throws(() => parseBlocks(md + '```text id=a\nagain\n```\n'), /duplicate/);
	assert.equal(storedKeywords(['crypto security', 'phishing']), '"crypto security" phishing');
	assert.deepEqual(parsePlaylists('A | b | c | d'), [{title: 'A', description: 'b', contents: 'c', order: 'd'}]);
	assert.throws(() => parsePlaylists('A | b | c'), /4 fields/);
	assert.equal(spoken('{POV|P.O.V.}: hi'), 'P.O.V.: hi');
	assert.equal(wordCount("I'm Zoo. This is Badger."), 5);
});

test('copy: the lint catches the old promises, hype, wallet-secret requests and the ZOO casing', () => {
	const rules = (t: string) => lintText(t).map((i) => i.rule).join(' | ');
	assert.match(rules('Watch me build my forex trading robot with live results.'), /forex/);
	assert.match(rules('Guaranteed 10x gains.'), /guarantee/);
	assert.match(rules('ZOO explains it.'), /never "ZOO"/);
	assert.match(rules('Send us your seed phrase to verify.'), /wallet secrets/);
	assert.match(rules('This is a way to get rich.'), /get rich/);
	assert.match(rules('Buy this token today.'), /"buy"/);
	assert.match(rules('Name: [CHANNEL NAME TBD]'), /placeholder/);
	// allowed: negated sentences, the brand name, a warning that mentions seed phrases
	assert.equal(lintText('What this channel is not: financial advice, trading signals, price predictions or a way to get rich.').length, 0);
	assert.equal(lintText("We will never ask for your seed phrase. Nobody legitimate will.").length, 0);
	assert.equal(lintText('Zoora AI is made by Zoora Technologies. ZOORA is fine as a brand.').length, 0);
});

test('copy: the channel name keeps the owner\'s exact spelling ("Zoodger News", handle "@ZoodgerNews")', () => {
	const rules = (t: string) => lintText(t).map((i) => i.rule).join(' | ');
	for (const bad of ['Subscribe to ZOODGER NEWS.', 'Zoodger news covers it.', 'Follow ZoodgerNews.', 'Zoodger  News, daily.', 'Zoodger\nNews', 'Follow @zoodgernews.', 'Follow @Zoodger News.']) {
		assert.match(rules(bad), /spelled "Zoodger News"/, JSON.stringify(bad));
	}
	for (const ok of ['Zoodger News explains it.', 'Follow @ZoodgerNews.', 'https://www.youtube.com/@ZoodgerNews', "Zoodger News's weekly roundup."]) {
		assert.deepEqual(lintText(ok), [], ok);
	}
});

for (const ch of ['zoora-ai', 'zoora-security'] as const) {
	test(`copy (${ch}): within YouTube's limits and clean under the house rules`, () => {
		const r = lintChannelCopy(read(ch));
		assert.deepEqual(r.issues, []);
		assert.ok(r.descriptionChars <= 1000 && r.descriptionChars >= 400, `description ${r.descriptionChars} chars`);
		assert.ok(r.keywordsStoredChars <= 500, `keywords ${r.keywordsStoredChars}`);
		assert.ok(r.playlists.length >= 5);
		assert.equal(r.playlists[0].title, 'Start Here', 'the first playlist on the Home tab is Start Here');
		// 45-60 s trailers: measured Kokoro im_nicola rate is 2.9-3.2 words/s, plus a 4 s sting and Badger's beats
		assert.ok(r.trailerWords >= 100 && r.trailerWords <= 140, `${r.trailerWords} words`);
		const speechSec = r.trailerWords / 3.0;
		assert.ok(speechSec + 4 + 3 >= 45 && speechSec + 4 + 6 <= 60, `about ${Math.round(speechSec + 4 + 4.5)} s`);
	});
}

test('copy (zoora-ai): the new description drops every forex-robot promise from the live one', () => {
	const d = parseBlocks(read('zoora-ai')).description;
	for (const old of ['trading robot', 'Expert Advisor', 'live results', 'performance updates', 'forex']) assert.ok(!d.toLowerCase().includes(old.toLowerCase()), old);
	assert.match(d, /is not financial advice/);
	assert.match(d, /fictional composites/);
});

test('copy (zoora-security): the channel name and handle are recorded; the show name and the rules are stated', () => {
	const md = read('zoora-security');
	const b = parseBlocks(md);
	assert.match(md, /Zoodger News/);
	assert.match(md, /@ZoodgerNews/);
	assert.doesNotMatch(md, /\[(CHANNEL NAME|HANDLE) TBD\]/);
	assert.match(md, /The Zoo & Badger Show/);
	assert.match(b.description, /confirmed facts only/i);
	assert.match(b.description, /never ask for your seed phrase/i);
	assert.match(b.description, /pin the correction/i);
	for (const s of Object.values(SERIES)) assert.ok(!/\bZOO\b/.test(s.label), s.label);
	assert.match(b.playlists, /Zoo's One Fix/);
});

test('copy: end-screen and badge labels are title case (never "ZOO")', () => {
	for (const l of [...Object.values(END_LABELS), ...Object.values(SERIES).map((s) => s.label)]) assert.ok(!/\bZOO\b/.test(l), l);
});
