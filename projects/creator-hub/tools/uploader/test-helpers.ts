/**
 * Test support only: builds a throwaway projects/video-studio layout in a temp folder with the fixture kit, a fake
 * rendered video (deterministic bytes), real PNG thumbnails, the storyboard and episode files, the asset tools' config
 * with owner-approved es and pt-BR disclosures, a channels.json (channel id pinned) and a saved OAuth account, so every
 * test starts from the same known files.
 *
 * The fixture kit has an affiliate offer, so its paid promotion is on, and the uploader never schedules such a video.
 * Tests about scheduling use `paidPromotion: false`: the same kit with the offer, its link and its disclosure taken out.
 */
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {deflateSync} from 'node:zlib';
import {SCOPE_FORCE_SSL, SCOPE_UPLOAD} from './contracts.ts';
import {type ChannelsConfig, parseChannels} from './inputs.ts';
import {type OAuthFile, writeOAuthFile} from './oauth.ts';

const FIXTURES = new URL('./fixtures/', import.meta.url);
export const fixture = (name: string): string => readFileSync(new URL(name, FIXTURES), 'utf8');

const CRC_TABLE = Array.from({length: 256}, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});
const crc32 = (buf: Buffer): number => {
	let c = 0xffffffff;
	for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
};

/** A valid solid-colour RGB PNG. */
export const makePng = (width: number, height: number, rgb: [number, number, number] = [41, 184, 173]): Buffer => {
	const chunk = (type: string, data: Buffer): Buffer => {
		const len = Buffer.alloc(4);
		len.writeUInt32BE(data.length);
		const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
		const crc = Buffer.alloc(4);
		crc.writeUInt32BE(crc32(body));
		return Buffer.concat([len, body, crc]);
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 2; // truecolour
	const row = Buffer.alloc(1 + width * 3);
	for (let x = 0; x < width; x++) row.set(rgb, 1 + x * 3);
	const raw = Buffer.concat(Array.from({length: height}, () => row));
	return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
};

/** Deterministic pseudo-random bytes (a stand-in for a rendered MP4). */
export const fakeVideo = (bytes: number, seed = 7): Buffer => {
	const out = Buffer.alloc(bytes);
	let x = seed >>> 0 || 1;
	for (let i = 0; i < bytes; i++) {
		x ^= x << 13;
		x ^= x >>> 17;
		x ^= x << 5;
		out[i] = x & 0xff;
	}
	return out;
};

export const CHANNEL_ID = 'UCzooraFakeChannel000001';
export const PLAYLIST_ID = 'PLzooraLongForm00000001';
export const SHORTS_PLAYLIST_ID = 'PLzooraShorts000000001';
/** 3 chunks of 256 KiB at the test chunk size, the last one short. */
export const VIDEO_BYTES = 2 * 262_144 + 192_635;
export const CHUNK = 262_144;
/** 2026-11-24 12:00 UTC: tests run on a fixed clock. */
export const NOW = Date.parse('2026-11-24T12:00:00.000Z');

/** Owner-approved translations of the fixture offer's disclosure (the lines fixtures/upload-spec.example.json uses). */
export const APPROVED_DISCLOSURES = {
	'hardware-wallet': {
		es: 'Enlace de afiliado: puedo ganar una comisión si compras. No te cuesta nada extra.',
		'pt-br': 'Link de afiliado: posso ganhar uma comissão se você comprar. Não custa nada a mais para você.',
	},
};

/** The fixture kit without its affiliate offer: no offer link, no affiliate disclosure, paid promotion off. */
export const unpaidKit = (kit: Record<string, unknown>): Record<string, unknown> => {
	const posts = kit.posts as Record<string, {text: string}>;
	const youtube = posts.youtube as {text: string};
	return {
		...kit,
		offers: [],
		disclosures: (kit.disclosures as string[]).filter((d) => !/affiliate/i.test(d)),
		posts: {
			...posts,
			youtube: {
				...youtube,
				text: youtube.text.replace('Contains an affiliate link (disclosure below).\n\n', '').replace(/Hardware wallet: \S+\nAffiliate link: [^\n]*\n\n/, ''),
			},
		},
		settings: {
			...(kit.settings as Record<string, unknown>),
			paidPromotion: false,
			reasons: ((kit.settings as {reasons: string[]}).reasons ?? []).map((r) => (r.startsWith('paidPromotion=') ? 'paidPromotion=false: no offers.' : r)),
		},
		checks: (kit.checks as {id: string; ok: boolean; detail: string}[]).map((c) => (c.id === 'disclosures' ? {...c, detail: 'No offer links.'} : c)),
	};
};

export type Workspace = {
	root: string;
	videoStudio: string;
	kitDir: string;
	kitPath: string;
	videoPath: string;
	shortPath: string;
	thumbPath: string;
	storyboardPath: string;
	channelsPath: string;
	channels: ChannelsConfig;
	stateDir: string;
	oauthPath: string;
	write(rel: string, content: string | Buffer): string;
	editKit(change: (kit: Record<string, unknown>) => void): void;
	cleanup(): void;
};

export type WorkspaceOptions = {
	playlists?: {long: string | null; short: string | null};
	categoryId?: string | null;
	scope?: string;
	withAccount?: boolean;
	/** false: the fixture kit without its affiliate offer (a video the uploader may schedule). Default true. */
	paidPromotion?: boolean;
	/** false: channels.json does not pin youtubeChannelId (upload --apply refuses). Default true. */
	pinned?: boolean;
	/** false: no asset config, so no owner-approved translated disclosures. Default true. */
	approvedDisclosures?: boolean;
};

export const makeWorkspace = (opts: WorkspaceOptions = {}): Workspace => {
	const root = mkdtempSync(join(tmpdir(), 'uploader-test-'));
	const videoStudio = join(root, 'video-studio');
	const kitDir = join(videoStudio, 'out/publish/zoora-ai/uploader-fixture');
	const write = (rel: string, content: string | Buffer): string => {
		const path = join(videoStudio, rel);
		mkdirSync(dirname(path), {recursive: true});
		writeFileSync(path, content);
		return path;
	};
	const kitData = JSON.parse(fixture('kit.json')) as Record<string, unknown>;
	const kitPath = write('out/publish/zoora-ai/uploader-fixture/kit.json', `${JSON.stringify(opts.paidPromotion === false ? unpaidKit(kitData) : kitData, null, 2)}\n`);
	write('out/publish/zoora-ai/uploader-fixture/shorts-1.txt', fixture('shorts-1.txt'));
	const videoPath = write('out/publish/zoora-ai/uploader-fixture/media/long.mp4', fakeVideo(VIDEO_BYTES));
	const shortPath = write('out/publish/zoora-ai/uploader-fixture/media/short-1.mp4', fakeVideo(300_000, 99));
	const thumbPath = write('out/publish/zoora-ai/uploader-fixture/media/thumbnails/en/v0.png', makePng(1280, 720));
	write('out/publish/zoora-ai/uploader-fixture/media/thumbnails/en/v1.png', makePng(1280, 720, [11, 12, 15]));
	const storyboardPath = write('content/zoora-ai/uploader-fixture/storyboard.json', fixture('storyboard.json'));
	write('content/zoora-ai/uploader-fixture/episode.json', fixture('episode.json'));
	if (opts.approvedDisclosures !== false) {
		write('scripts/assets/config/channels.json', JSON.stringify({version: 1, defaults: {offerDisclosures: APPROVED_DISCLOSURES}, channels: {'zoora-ai': {displayName: 'Zoora AI'}}}, null, 2));
	}

	const channelsData = {
		version: 1,
		dailyLimits: {defaultUnits: 10_000, uploadCalls: 100},
		maxUnitsPerRun: 3000,
		minLeadMinutes: 60,
		approvalMaxDays: 30,
		channels: {
			'zoora-ai': {
				youtubeChannelId: opts.pinned === false ? null : CHANNEL_ID,
				categoryId: opts.categoryId === undefined ? '28' : opts.categoryId,
				defaultLanguage: 'en',
				playlists: opts.playlists ?? {long: PLAYLIST_ID, short: SHORTS_PLAYLIST_ID},
			},
		},
	};
	const channelsPath = join(root, 'channels.json');
	writeFileSync(channelsPath, JSON.stringify(channelsData, null, 2));
	const stateDir = join(root, 'state');
	const oauthPath = join(stateDir, 'oauth.json');
	if (opts.withAccount !== false) {
		const file: OAuthFile = {
			version: 1,
			client: {clientId: 'test-client.apps.googleusercontent.com', clientSecret: 'test-secret'},
			accounts: {
				'zoora-ai': {
					channelId: CHANNEL_ID,
					title: 'Zoora AI (test)',
					handle: '@zooratest',
					authorizedAt: '2026-11-23T12:00:00.000Z',
					tokens: {accessToken: 'at-0', expiresAt: NOW + 3_600_000, refreshToken: 'rt-0', scope: opts.scope ?? `${SCOPE_UPLOAD} ${SCOPE_FORCE_SSL}`},
				},
			},
		};
		writeOAuthFile(oauthPath, file);
	}
	return {
		root,
		videoStudio,
		kitDir,
		kitPath,
		videoPath,
		shortPath,
		thumbPath,
		storyboardPath,
		channelsPath,
		channels: parseChannels(channelsData, channelsPath),
		stateDir,
		oauthPath,
		write,
		editKit(change) {
			const kit = JSON.parse(readFileSync(kitPath, 'utf8')) as Record<string, unknown>;
			change(kit);
			writeFileSync(kitPath, JSON.stringify(kit, null, 2));
		},
		cleanup: () => rmSync(root, {recursive: true, force: true}),
	};
};

/** A clock that tests can move forward. */
export const clock = (start = NOW) => {
	let t = start;
	return {now: () => t, advance: (ms: number) => (t += ms), set: (ms: number) => (t = ms)};
};

/** Records sleeps instead of waiting. */
export const recordSleeps = () => {
	const waits: number[] = [];
	return {waits, sleep: async (ms: number) => void waits.push(ms)};
};
