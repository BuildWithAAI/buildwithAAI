import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, it} from 'node:test';
import {parseCatalog, parseKit, parseTags, readCatalog, readKits} from './catalog.ts';

describe('videos.csv', () => {
	it('reads the fixture: aliases, formats, tags, channels and dates', () => {
		const {entries, issues} = readCatalog(fileURLToPath(new URL('./fixtures/videos.csv', import.meta.url)));
		assert.deepEqual(issues, []);
		assert.equal(entries.length, 13);
		const first = entries[0];
		assert.deepEqual(first, {videoId: 'fixture0001', aliases: ['top-caller'], title: null, channel: 'zoora-ai', format: 'long', tags: ['memecoins'], publishedAt: '2026-10-06'});
		assert.deepEqual(entries.find((e) => e.videoId === 'fixture0002')?.tags, ['scams', 'wallet security']);
		assert.equal(entries.find((e) => e.videoId === '-fixture011')?.format, 'short');
		assert.equal(entries.at(-1)?.channel, 'zoora-security');
	});

	it('warns about bad ids, formats, tags and dates without stopping', () => {
		const {entries, issues} = parseCatalog('video_id,format,tags,published_at,aliases\nok-slug,shorts,"good tag; <script>",2026-13-01,"bad alias!"\nnot valid!,long,,,\nok-slug,long,,,\n', 'v.csv');
		assert.equal(entries.length, 1);
		assert.equal(entries[0]?.format, 'short', '"shorts" is read as short');
		assert.deepEqual(entries[0]?.tags, ['good tag']);
		assert.equal(entries[0]?.publishedAt, null);
		assert.deepEqual(entries[0]?.aliases, ['bad'], 'aliases are separated by spaces too');
		for (const pattern of [/tag "<script>"/, /published_at "2026-13-01"/, /alias "alias!"/, /video_id "not valid!"/, /listed twice/]) {
			assert.ok(issues.some((i) => pattern.test(i.message)), `expected ${pattern}`);
		}
		assert.equal(parseCatalog('title\nx\n', 'v.csv').issues[0]?.level, 'error');
	});

	it('parseTags splits on ; | and , and lower-cases', () => {
		assert.deepEqual(parseTags(' Scams |AI  agents; scams,'), ['scams', 'ai agents']);
	});
});

describe('publish kits', () => {
	it('reads <dir>/<slug>/kit.json and takes the format from the renders', () => {
		const {kits, issues} = readKits(fileURLToPath(new URL('./fixtures/kits', import.meta.url)));
		assert.deepEqual(issues, []);
		assert.equal(kits.length, 1);
		assert.equal(kits[0]?.slug, 'fake-support-dm');
		assert.equal(kits[0]?.youtubeVideoId, 'fixture0002');
		assert.equal(kits[0]?.format, 'long');
	});

	it('ignores invalid kits with a warning and a missing folder silently', () => {
		const dir = mkdtempSync(join(tmpdir(), 'dashboard-kits-'));
		try {
			mkdirSync(join(dir, 'broken'));
			writeFileSync(join(dir, 'broken', 'kit.json'), '{not json');
			mkdirSync(join(dir, 'wrong'));
			writeFileSync(join(dir, 'wrong', 'kit.json'), JSON.stringify({version: 1, channel: 'zoora-ai', slug: 'wrong', youtubeVideoId: 'short'}));
			const {kits, issues} = readKits(dir);
			assert.equal(kits.length, 0);
			assert.equal(issues.length, 2);
			assert.deepEqual(readKits(join(dir, 'missing')), {kits: [], issues: []});
		} finally {
			rmSync(dir, {recursive: true, force: true});
		}
		assert.equal(parseKit({version: 1, channel: 'c', slug: 's', youtubeVideoId: null, title: 't'}, 'k').kit?.format, null);
	});
});
