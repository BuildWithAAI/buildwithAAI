import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {LANGUAGE_TAGS} from './contracts.ts';
import {backoffMs, parseRetryAfter} from './http.ts';
import {parseShortFile, srtProblems, urlsIn} from './inputs.ts';
import {assertPrivate, insertCaption, PrivacyGuardError, startUpload, uploadStatus} from './requests.ts';
import {nextByteFromRange} from './resumable.ts';
import {fixture, makePng} from './test-helpers.ts';
import {formatInZone, parseIsoWithZone, parsePublishTime, quotaDay, toUtcIso} from './time.ts';
import {bcp47, canonicalJson, redactSessionUri, sniffImage, UsageError, youtubeTagsLength} from './util.ts';
import {GOOGLE} from './contracts.ts';

describe('util', () => {
	it('reads PNG and JPEG sizes from the bytes, not the name', () => {
		assert.deepEqual(sniffImage(makePng(1280, 720)), {mimeType: 'image/png', width: 1280, height: 720});
		// minimal JPEG: SOI, an APP0 segment, then SOF0 with height 720 and width 1280
		const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0xd0, 0x05, 0x00, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
		assert.deepEqual(sniffImage(jpeg), {mimeType: 'image/jpeg', width: 1280, height: 720});
		assert.equal(sniffImage(Buffer.from('GIF89a................')), null);
	});

	it('hashes JSON the same whatever the key order', () => {
		assert.equal(canonicalJson({b: 1, a: {d: [1, {y: 2, x: 1}], c: undefined}}), canonicalJson({a: {d: [1, {x: 1, y: 2}]}, b: 1}));
	});

	it("maps the pipeline's language codes to YouTube's BCP-47 tags", () => {
		assert.equal(bcp47('pt-br', LANGUAGE_TAGS), 'pt-BR');
		assert.equal(bcp47('zh', LANGUAGE_TAGS), 'zh-Hans');
		assert.equal(bcp47('es-419', LANGUAGE_TAGS), 'es-419');
		assert.equal(bcp47('zh-hant-tw', LANGUAGE_TAGS), 'zh-Hant-TW');
		assert.equal(bcp47('english', LANGUAGE_TAGS), null);
	});

	it("counts tags the way YouTube does (quotes around tags with spaces, commas between)", () => {
		assert.equal(youtubeTagsLength(['Foo-Baz']), 7);
		assert.equal(youtubeTagsLength(['Foo Baz']), 9);
		assert.equal(youtubeTagsLength(['a', 'b c']), 1 + 5 + 1);
	});

	it("hides the session URI's upload id", () => {
		assert.equal(redactSessionUri('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=ABCDEFGHIJ&part=snippet'), 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=ABCD…&part=snippet');
	});

	it('parses the publish kit shorts-<n>.txt and rejects other text', () => {
		assert.deepEqual(parseShortFile(fixture('shorts-1.txt'), 'shorts-1.txt'), {
			title: 'Real support never DMs you first',
			description: 'Real support never DMs you first.\nFull episode: tap the related video link under the channel name.\nMore links: go.zoora.ai\n#crypto #scams #security',
		});
		assert.throws(() => parseShortFile('just text', 'x.txt'), UsageError);
	});

	it('checks SRT files are UTF-8 with timed cues', () => {
		assert.deepEqual(srtProblems(Buffer.from('1\n00:00:00,000 --> 00:00:01,000\nHi\n'), 'a.srt'), []);
		assert.match(srtProblems(Buffer.from([0xff, 0xfe, 0x00]), 'b.srt')[0] ?? '', /not UTF-8/);
		assert.match(srtProblems(Buffer.from('no cues here'), 'c.srt')[0] ?? '', /no timed cues/);
	});

	it('finds links in descriptions without trailing punctuation', () => {
		assert.deepEqual(urlsIn('See https://go.zoora.ai/go/x?v=a&s=yt. And (https://example.com/a).'), ['https://go.zoora.ai/go/x?v=a&s=yt', 'https://example.com/a']);
	});
});

describe('time', () => {
	it('reads publish times without an offset in the owner zone (America/Chicago)', () => {
		const winter = parsePublishTime('2026-11-28 09:00');
		assert.ok(winter.ok);
		assert.equal(toUtcIso(winter.ms), '2026-11-28T15:00:00.000Z');
		assert.equal(formatInZone(winter.ms), '2026-11-28 09:00 CST');
		const summer = parsePublishTime('2026-07-04 09:00');
		assert.ok(summer.ok);
		assert.equal(toUtcIso(summer.ms), '2026-07-04T14:00:00.000Z');
	});

	it('takes explicit offsets as given and refuses impossible or ambiguous times', () => {
		const explicit = parsePublishTime('2026-11-28T09:00:00-06:00');
		assert.ok(explicit.ok);
		assert.equal(toUtcIso(explicit.ms), '2026-11-28T15:00:00.000Z');
		assert.equal(parseIsoWithZone('2026-02-30T10:00:00Z'), null);
		const fallBack = parsePublishTime('2026-11-01 01:30');
		assert.ok(!fallBack.ok && /happens twice/.test(fallBack.message));
		const springForward = parsePublishTime('2026-03-08 02:30');
		assert.ok(!springForward.ok && /does not exist/.test(springForward.message));
		assert.ok(!parsePublishTime('next friday').ok);
	});

	it('charges quota to the Pacific-time day (it resets at midnight PT)', () => {
		assert.equal(quotaDay(Date.parse('2026-11-25T07:59:00Z')), '2026-11-24');
		assert.equal(quotaDay(Date.parse('2026-11-25T08:00:00Z')), '2026-11-25');
	});
});

describe('resumable protocol details', () => {
	it('reads the confirmed range (308 Resume Incomplete)', () => {
		assert.equal(nextByteFromRange('bytes=0-999999'), 1_000_000);
		assert.equal(nextByteFromRange(null), 0);
		assert.throws(() => nextByteFromRange('bytes=5-9'), /unexpected Range/);
	});

	it('asks for the upload status with an empty PUT and Content-Range "bytes */total"', () => {
		const req = uploadStatus('https://x/upload?upload_id=1', 500);
		assert.equal(req.method, 'PUT');
		assert.equal(req.headers['content-range'], 'bytes */500');
		assert.equal((req.body as Buffer).length, 0);
	});

	it('honours Retry-After and caps the full-jitter backoff', () => {
		assert.equal(parseRetryAfter('7', 0), 7000);
		assert.equal(parseRetryAfter('Tue, 24 Nov 2026 12:00:30 GMT', Date.parse('2026-11-24T12:00:00Z')), 30_000);
		assert.equal(backoffMs(3, () => 0.5, null), 4000);
		assert.equal(backoffMs(20, () => 0.999, null), 120_000);
		assert.equal(backoffMs(1, () => 0.5, 7000), 7000);
	});

	it('builds multipart caption uploads with JSON metadata then the SRT bytes', () => {
		const req = insertCaption(GOOGLE, {videoId: 'abc', language: 'es', name: 'Subtítulos'}, Buffer.from('1\n00:00:00,000 --> 00:00:01,000\nHola\n'), 'b0undary');
		assert.equal(req.headers['content-type'], 'multipart/related; boundary=b0undary');
		const text = (req.body as Buffer).toString('utf8');
		assert.match(text, /^--b0undary\r\nContent-Type: application\/json; charset=UTF-8\r\n\r\n\{"snippet":\{"videoId":"abc","language":"es","name":"Subtítulos","isDraft":false\}\}\r\n--b0undary\r\nContent-Type: application\/octet-stream\r\n\r\n1\n/);
		assert.ok(text.endsWith('\r\n--b0undary--\r\n'));
	});
});

describe('privacy guard', () => {
	it('refuses any videos.insert whose body is not explicitly private', () => {
		const ok = startUpload(GOOGLE, {part: 'snippet,status'}, JSON.stringify({snippet: {title: 't'}, status: {privacyStatus: 'private'}}), 10, 'video/mp4');
		assert.doesNotThrow(() => assertPrivate(ok));
		for (const status of [undefined, {}, {privacyStatus: 'public'}, {privacyStatus: 'unlisted'}]) {
			const bad = startUpload(GOOGLE, {part: 'snippet,status'}, JSON.stringify({snippet: {title: 't'}, ...(status ? {status} : {})}), 10, 'video/mp4');
			assert.throws(() => assertPrivate(bad), PrivacyGuardError);
		}
	});
});
