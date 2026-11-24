import assert from 'node:assert/strict';
import {afterEach, beforeEach, describe, it} from 'node:test';
import {GOOGLE} from './contracts.ts';
import {gatherInputs, parseSpec} from './inputs.ts';
import {buildPlan, renderPlan} from './plan.ts';
import {fixture, makeWorkspace, PLAYLIST_ID, SHORTS_PLAYLIST_ID, type Workspace} from './test-helpers.ts';
import {UsageError} from './util.ts';

const CAPTION = '1\n00:00:00,000 --> 00:00:02,000\nHola.\n';

describe('upload plan', () => {
	let ws: Workspace;
	beforeEach(() => {
		ws = makeWorkspace();
	});
	afterEach(() => ws.cleanup());

	const inputsFor = (extra: Partial<Parameters<typeof gatherInputs>[0]> = {}) =>
		gatherInputs({kitPath: ws.kitPath, videoStudioRoot: null, channels: ws.channels, renderId: 'long', ...extra});

	it('always sends privacyStatus "private", with publishAt and the kit settings stated explicitly', async () => {
		const plan = buildPlan(await inputsFor(), {publishAt: '2026-11-28T15:00:00.000Z', processingPolls: 20});
		assert.deepEqual(plan.insert.body.status, {privacyStatus: 'private', publishAt: '2026-11-28T15:00:00.000Z', selfDeclaredMadeForKids: false, containsSyntheticMedia: false});
		const unscheduled = buildPlan(await inputsFor(), {publishAt: null, processingPolls: 20});
		assert.deepEqual(unscheduled.insert.body.status, {privacyStatus: 'private', selfDeclaredMadeForKids: false, containsSyntheticMedia: false});
		assert.equal(plan.insert.query.part, 'snippet,status');
	});

	it('finds the kit root from the kit path and fills snippet from the kit, episode.json and channels.json', async () => {
		const inputs = await inputsFor();
		assert.equal(inputs.root, ws.videoStudio);
		const plan = buildPlan(inputs, {publishAt: null, processingPolls: 20});
		const snippet = plan.insert.body.snippet;
		assert.equal(snippet.title, 'POV: "Support" DMs you first');
		assert.match(snippet.description, /^Contains an affiliate link/);
		assert.deepEqual(snippet.tags, ['crypto security', 'wallet scams', 'zoora ai']);
		assert.equal(snippet.categoryId, '28');
		assert.equal(snippet.defaultLanguage, 'en');
		assert.equal(snippet.defaultAudioLanguage, 'en');
		assert.equal(plan.video.rel, 'out/publish/zoora-ai/uploader-fixture/media/long.mp4');
		assert.equal(plan.thumbnail?.rel, 'out/publish/zoora-ai/uploader-fixture/media/thumbnails/en/v0.png');
		assert.deepEqual(plan.captions.map((c) => [c.language, c.name, c.source]), [['en', 'Captions', 'kit']]);
		assert.equal(plan.playlistId, PLAYLIST_ID);
		assert.equal(plan.storyboard.version, 1);
	});

	it('never sends paid-promotion fields and lists the Studio step instead', async () => {
		const plan = buildPlan(await inputsFor(), {publishAt: null, processingPolls: 20});
		assert.doesNotMatch(JSON.stringify(plan.insert), /paidProductPlacement/);
		assert.match(plan.studioSteps[0] ?? '', /^Paid promotion: .*tick/);
		assert.ok(plan.studioSteps.some((s) => /stays private/.test(s)));
		const text = renderPlan(plan, GOOGLE, {chunkBytes: 262_144, header: []});
		assert.doesNotMatch(text.split('Not sent:')[0] ?? '', /paidProductPlacement/);
	});

	it('counts quota per bucket: 1 upload call, and 1 + 1 + 50 + 400 + 50 units', async () => {
		const plan = buildPlan(await inputsFor(), {publishAt: null, processingPolls: 20});
		assert.equal(plan.quota.uploadCalls, 1);
		assert.equal(plan.quota.defaultUnits, 502);
		assert.deepEqual(
			plan.quota.lines.map((l) => [l.method, l.units]),
			[
				['channels.list', 1],
				['playlists.list', 1],
				['videos.insert', 1],
				['thumbnails.set', 50],
				['captions.insert', 400],
				['playlistItems.insert', 50],
			],
		);
	});

	it('has a stable digest that changes with what is sent', async () => {
		const a = buildPlan(await inputsFor(), {publishAt: null, processingPolls: 20});
		const b = buildPlan(await inputsFor(), {publishAt: null, processingPolls: 20});
		assert.equal(a.digest.sha256, b.digest.sha256);
		const scheduled = buildPlan(await inputsFor(), {publishAt: '2026-11-28T15:00:00.000Z', processingPolls: 20});
		assert.notEqual(scheduled.digest.parts.insert, a.digest.parts.insert);
		assert.equal(scheduled.digest.parts.video, a.digest.parts.video);
		ws.editKit((kit) => {
			kit.title = 'A different title';
		});
		const retitled = buildPlan(await inputsFor(), {publishAt: null, processingPolls: 20});
		assert.notEqual(retitled.digest.parts.insert, a.digest.parts.insert);
		assert.equal(retitled.digest.parts.thumbnail, a.digest.parts.thumbnail);
	});

	it('plans a Short from shorts-<n>.txt: its own title and description, no captions or 16:9 thumbnail, the Shorts playlist', async () => {
		const plan = buildPlan(await inputsFor({renderId: 'short-1'}), {publishAt: null, processingPolls: 20});
		assert.equal(plan.renderKind, 'short');
		assert.equal(plan.insert.body.snippet.title, 'Real support never DMs you first');
		assert.match(plan.insert.body.snippet.description, /^Real support never DMs you first\.\nFull episode/);
		assert.deepEqual(plan.captions, []);
		assert.equal(plan.thumbnail, null);
		assert.equal(plan.playlistId, SHORTS_PLAYLIST_ID);
		assert.ok(plan.studioSteps.some((s) => /Related video/.test(s)));
		assert.equal(plan.insert.body.status.privacyStatus, 'private');
	});

	it("waits for a Short's processing before its thumbnail and budgets those checks", async () => {
		const plan = buildPlan(await inputsFor({renderId: 'short-1', thumbnail: ws.thumbPath}), {publishAt: null, processingPolls: 12});
		assert.equal(plan.thumbnail?.afterProcessing, true);
		assert.deepEqual(plan.quota.lines.find((l) => l.method === 'videos.list'), {method: 'videos.list', calls: 12, units: 12, note: "at most; waits for a Short's processing before its thumbnail"});
		assert.match(plan.warnings.join('\n'), /Shorts thumbnails should be 9:16/);
	});

	it('adds localizations and extra caption tracks from a spec, keeping the kit captions as the default track', async () => {
		ws.write('out/publish/zoora-ai/uploader-fixture/captions.es.srt', CAPTION);
		ws.write('out/publish/zoora-ai/uploader-fixture/captions.pt-br.srt', CAPTION);
		const spec = ws.write('upload-spec.json', fixture('upload-spec.example.json'));
		const plan = buildPlan(await inputsFor({spec}), {publishAt: null, processingPolls: 20});
		assert.equal(plan.insert.query.part, 'snippet,status,localizations');
		assert.deepEqual(Object.keys(plan.insert.body.localizations ?? {}), ['es', 'pt-BR']);
		assert.deepEqual(plan.captions.map((c) => `${c.language}:${c.name}`), ['en:Captions', 'es:Subtítulos', 'pt-BR:Legendas']);
		assert.equal(plan.quota.defaultUnits, 1 + 1 + 50 + 3 * 400 + 50);
		assert.deepEqual(plan.insert.body.snippet.tags, ['crypto security', 'wallet scams']);
		assert.ok(plan.studioSteps.some((s) => /Dubbed audio: .*Studio > Languages/.test(s)));
		assert.match(plan.warnings.join('\n'), /every affiliate link needs its disclosure/);
	});

	it('refuses spec keys that would change privacy, the schedule or the disclosure settings', () => {
		for (const key of ['privacyStatus', 'publishAt', 'selfDeclaredMadeForKids', 'containsSyntheticMedia', 'paidProductPlacementDetails', 'title']) {
			assert.throws(
				() => parseSpec({version: 1, [key]: 'x'}, 'spec.json'),
				(error: unknown) => error instanceof UsageError && error.reasons.some((r) => r.message.includes(`"${key}" cannot be set here`)),
			);
		}
		assert.throws(() => parseSpec({version: 1, privacy: 'public'}, 'spec.json'), /uploads are always private/);
	});

	it('refuses a translated description that adds a link the kit does not have', async () => {
		const spec = ws.write('spec.json', JSON.stringify({version: 1, localizations: {es: {title: 'Hola', description: 'Compra aquí: https://affiliate.example/raw?ref=me'}}}));
		await assert.rejects(inputsFor({spec}), /localizations\.es: the link https:\/\/affiliate\.example\/raw\?ref=me is not in the kit's description/);
	});

	it('needs a category chosen by the owner', async () => {
		const bare = makeWorkspace({categoryId: null});
		try {
			await assert.rejects(gatherInputs({kitPath: bare.kitPath, videoStudioRoot: null, channels: bare.channels, renderId: 'long'}), /categoryId: none is set for "zoora-ai"/);
		} finally {
			bare.cleanup();
		}
	});

	it('refuses a missing render or thumbnail with what to do', async () => {
		await assert.rejects(inputsFor({video: 'out/nowhere.mp4'}), /The rendered file is missing/);
		await assert.rejects(inputsFor({renderId: 'short-7'}), /no video render "short-7"/);
		await assert.rejects(inputsFor({thumbnail: 'out/missing.png'}), /thumbnail .* is missing/);
		const none = buildPlan(await inputsFor({thumbnail: null}), {publishAt: null, processingPolls: 20});
		assert.equal(none.thumbnail, null);
	});

	it('prints every request with its headers and body', async () => {
		const plan = buildPlan(await inputsFor(), {publishAt: '2026-11-28T15:00:00.000Z', processingPolls: 20});
		const text = renderPlan(plan, GOOGLE, {chunkBytes: 262_144, header: ['HEADER']});
		for (const line of [
			'GET https://www.googleapis.com/youtube/v3/channels?part=id%2Csnippet&mine=true',
			`GET https://www.googleapis.com/youtube/v3/playlists?part=snippet&id=${PLAYLIST_ID}`,
			'POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet%2Cstatus',
			'x-upload-content-length: 716923',
			'x-upload-content-type: video/mp4',
			'"privacyStatus": "private"',
			'"publishAt": "2026-11-28T15:00:00.000Z"',
			'then 3 PUT requests of up to 256 KiB',
			'content-range: bytes 0-262143/716923',
			'POST https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=<new video id>&uploadType=media',
			'POST https://www.googleapis.com/upload/youtube/v3/captions?part=snippet&uploadType=multipart',
			'POST https://www.googleapis.com/youtube/v3/playlistItems?part=snippet',
			'Quota: 502 units',
			'2026-11-28 09:00 CST',
		]) {
			assert.ok(text.includes(line), `plan text lacks: ${line}`);
		}
	});
});
