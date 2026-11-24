import assert from 'node:assert/strict';
import {afterEach, beforeEach, describe, it} from 'node:test';
import {GOOGLE} from './contracts.ts';
import {gatherInputs, parseSpec} from './inputs.ts';
import {approvalCode, buildPlan, renderPlan} from './plan.ts';
import {CHANNEL_ID, fixture, makeWorkspace, PLAYLIST_ID, SHORTS_PLAYLIST_ID, type Workspace} from './test-helpers.ts';
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

	it('counts quota per bucket: 1 upload call, and 1 + 1 + 1 + 50 + 400 + 50 units', async () => {
		const plan = buildPlan(await inputsFor(), {publishAt: null, processingPolls: 20});
		assert.equal(plan.quota.uploadCalls, 1);
		assert.equal(plan.quota.defaultUnits, 503);
		assert.deepEqual(
			plan.quota.lines.map((l) => [l.method, l.units]),
			[
				['channels.list', 1],
				['playlists.list', 1],
				['playlistItems.list', 1],
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
		assert.equal(approvalCode(a), a.digest.sha256.slice(0, 12));
		assert.notEqual(approvalCode(retitled), approvalCode(a));
	});

	it('binds the destination channel: the pinned id is part of the digest, and an unpinned channel is a warning', async () => {
		const pinned = buildPlan(await inputsFor(), {publishAt: null, processingPolls: 20});
		assert.deepEqual(pinned.destination, {youtubeChannelId: CHANNEL_ID});
		const other = {...ws.channels, channels: {...ws.channels.channels, 'zoora-ai': {...ws.channels.channels['zoora-ai']!, youtubeChannelId: 'UCsomeOtherChannel000001'}}};
		const repinned = buildPlan(await gatherInputs({kitPath: ws.kitPath, videoStudioRoot: null, channels: other, renderId: 'long'}), {publishAt: null, processingPolls: 20});
		assert.notEqual(repinned.digest.parts.channel, pinned.digest.parts.channel);
		assert.equal(repinned.digest.parts.insert, pinned.digest.parts.insert);
		const bare = makeWorkspace({pinned: false});
		try {
			const unpinned = buildPlan(await gatherInputs({kitPath: bare.kitPath, videoStudioRoot: null, channels: bare.channels, renderId: 'long'}), {publishAt: null, processingPolls: 20});
			assert.equal(unpinned.destination.youtubeChannelId, null);
			assert.match(unpinned.warnings.join('\n'), /does not pin youtubeChannelId for "zoora-ai": upload --apply refuses/);
			assert.match(renderPlan(unpinned, GOOGLE, {chunkBytes: 262_144, header: []}), /Destination: NOT PINNED/);
		} finally {
			bare.cleanup();
		}
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
		assert.equal(plan.quota.defaultUnits, 1 + 1 + 1 + 50 + 3 * 400 + 50);
		assert.deepEqual(plan.insert.body.snippet.tags, ['crypto security', 'wallet scams']);
		assert.ok(plan.studioSteps.some((s) => /Dubbed audio: .*Studio > Languages/.test(s)));
		// each translation keeps the offer link next to its owner-approved disclosure in that language, so nothing is refused
		assert.match(plan.insert.body.localizations?.es?.description ?? '', /go\.zoora\.ai\/go\/hardware-wallet[^\n]*\nEnlace de afiliado: puedo ganar una comisión/);
		assert.doesNotMatch(plan.warnings.join('\n'), /income-claim rules cover/);
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

	describe('translations in the spec (nobody else checks them)', () => {
		const LINK = 'https://go.zoora.ai/go/hardware-wallet?v=uploader-fixture&s=yt';
		const ES = 'Enlace de afiliado: puedo ganar una comisión si compras. No te cuesta nada extra.';
		const specWith = (localizations: Record<string, {title: string; description: string}>, extra: Record<string, unknown> = {}) => ws.write('spec.json', JSON.stringify({version: 1, localizations, ...extra}));
		const refusal = async (spec: string): Promise<string> => {
			try {
				await inputsFor({spec});
			} catch (error) {
				assert.ok(error instanceof UsageError, String(error));
				return error.reasons.map((r) => r.message).join('\n');
			}
			assert.fail('expected a refusal');
		};

		it('refuses an offer link without its owner-approved disclosure in that language next to it', async () => {
			const dropped = await refusal(specWith({es: {title: 'Hola', description: `Billetera física: ${LINK}\n\nEl soporte real nunca te escribe primero.`}}));
			assert.match(dropped, /localizations\.es: the "hardware-wallet" link is not next to its owner-approved es disclosure \("Enlace de afiliado: puedo ganar/);
			const english = await refusal(specWith({es: {title: 'Hola', description: `Billetera física: ${LINK}\nAffiliate link: I may earn a commission if you buy. It costs you nothing extra.`}}));
			assert.match(english, /not next to its owner-approved es disclosure/, 'the English disclosure is not the Spanish one');
			const far = await refusal(specWith({es: {title: 'Hola', description: `${ES}\n1\n2\n3\n4\nBilletera física: ${LINK}`}}));
			assert.match(far, /within 3 lines of the link/);
			await inputsFor({spec: specWith({es: {title: 'Hola', description: `Billetera física: ${LINK}\n${ES}`}})});
		});

		it('refuses an offer link in a language with no owner-approved translation of its disclosure', async () => {
			const italian = await refusal(specWith({it: {title: 'Ciao', description: `Portafoglio: ${LINK}\nLink di affiliazione: potrei guadagnare una commissione.`}}));
			assert.match(italian, /no owner-approved it translation of it\. Add one under "offerDisclosures" > "hardware-wallet" > "it" in video-studio\/scripts\/assets\/config\/channels\.json/);
			const bare = makeWorkspace({approvedDisclosures: false});
			try {
				const spec = bare.write('spec.json', JSON.stringify({version: 1, localizations: {es: {title: 'Hola', description: `Billetera física: ${LINK}\n${ES}`}}}));
				await assert.rejects(gatherInputs({kitPath: bare.kitPath, videoStudioRoot: null, channels: bare.channels, renderId: 'long', spec}), /no owner-approved es translation of it.*could not be read: the file does not exist/s);
			} finally {
				bare.cleanup();
			}
		});

		it('refuses income claims in a translated title or description, and in the spec tags', async () => {
			const es = await refusal(specWith({es: {title: 'Ganancias garantizadas', description: 'El soporte real nunca te escribe primero.'}}));
			assert.match(es, /localizations\.es\.title: income or return claim \(garantizado \/ garantido\): "garantizadas"/);
			const pt = await refusal(specWith({'pt-br': {title: 'Golpes', description: 'Renda passiva de 10% ao mês, sem risco.'}}));
			assert.match(pt, /localizations\.pt-br\.description: income or return claim \(sin riesgo \/ sem risco\)/);
			assert.match(pt, /\(ingresos pasivos \/ renda passiva\)/);
			assert.match(pt, /\(a percentage return \(es\/pt\)\)/);
			const tags = await refusal(specWith({}, {tags: ['crypto security', 'guaranteed profits']}));
			assert.match(tags, /tags: "guaranteed profits" is an income or return claim \(guaranteed\)/);
		});

		it('warns when a translation is in a language the claim rules do not cover', async () => {
			const inputs = await inputsFor({spec: specWith({it: {title: 'Il supporto vero non scrive mai per primo', description: 'Una storia di fantasia.'}})});
			assert.match(inputs.warnings.join('\n'), /localizations\.it: the income-claim rules cover English, Spanish and Portuguese only/);
		});
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
			`Destination: YouTube channel ${CHANNEL_ID} (pinned in channels.json for "zoora-ai").`,
			'GET https://www.googleapis.com/youtube/v3/channels?part=id%2Csnippet%2CcontentDetails&mine=true',
			`GET https://www.googleapis.com/youtube/v3/playlists?part=snippet&id=${PLAYLIST_ID}`,
			"GET https://www.googleapis.com/youtube/v3/playlistItems?part=snippet%2Cstatus&playlistId=<the channel's uploads playlist, from channels.list>&maxResults=50",
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
			'Quota: 503 units',
			'2026-11-28 09:00 CST',
			`Approval code: ${plan.digest.sha256.slice(0, 12)}`,
		]) {
			assert.ok(text.includes(line), `plan text lacks: ${line}`);
		}
	});
});
