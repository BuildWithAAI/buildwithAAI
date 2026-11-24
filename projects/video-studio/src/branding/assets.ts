/**
 * The branding kit's render manifest (pure data): every deliverable and QA layer, the composition that makes it,
 * its props and where it goes. render.ts renders this list; qa/run.ts checks it; docs/BRANDING.md tells the owner
 * where each file goes in YouTube Studio. Paths are relative to projects/video-studio/.
 *
 * Committed: small final PNGs under public/brand/ (needed at runtime by other workflows and by the owner).
 * Not committed: videos, masters, alternates and QA layers under out/brand/ (gitignored).
 */
import {SERIES, SERIES_IDS} from './series.ts';
import type {ChannelKey} from './tokens.ts';

export type AssetKind = 'still' | 'video';
export type AssetRole = 'banner' | 'avatar' | 'watermark' | 'endscreen' | 'badge' | 'sting' | 'alternate' | 'qa';

export type Asset = {
	id: string;
	role: AssetRole;
	channel: ChannelKey | null;
	composition: string;
	props: Record<string, unknown>;
	out: string;
	kind: AssetKind;
	/** Still frame for compositions that animate (end screen). */
	frame?: number;
	/** Trim fully transparent margins after rendering (badges). */
	trim?: boolean;
	/** Render the video with an empty AAC track (stings, end screens) so it concatenates cleanly. */
	silentAudio?: boolean;
};

const PUB = 'public/brand';
const OUT = 'out/brand';

const channelAssets = (ch: ChannelKey): Asset[] => {
	const zoora = ch === 'zoora-ai';
	return [
		{id: `${ch}/banner`, role: 'banner', channel: ch, composition: zoora ? 'ZooraBanner' : 'ShowBanner', props: {layer: 'all'}, out: `${PUB}/${ch}/banner-2560x1440.png`, kind: 'still'},
		{
			id: `${ch}/avatar`,
			role: 'avatar',
			channel: ch,
			composition: 'BrandAvatar',
			props: zoora ? {subject: 'mark', bg: '#0B0C0F'} : {subject: 'badger', bg: '#C9CED6'},
			out: `${PUB}/${ch}/avatar-800.png`,
			kind: 'still',
		},
		{id: `${ch}/watermark`, role: 'watermark', channel: ch, composition: 'BrandWatermark', props: {channel: ch}, out: `${PUB}/${ch}/watermark-150.png`, kind: 'still'},
		{id: `${ch}/endscreen-frame`, role: 'endscreen', channel: ch, composition: 'BrandEndScreen', props: {channel: ch}, out: `${PUB}/${ch}/endscreen-1920x1080.png`, kind: 'still', frame: 45},
		{id: `${ch}/endscreen-video`, role: 'endscreen', channel: ch, composition: 'BrandEndScreen', props: {channel: ch}, out: `${OUT}/${ch}/endscreen-20s.mp4`, kind: 'video', silentAudio: true},
		{id: `${ch}/sting`, role: 'sting', channel: ch, composition: zoora ? 'ZooraSting' : 'ShowSting', props: {}, out: `${OUT}/${ch}/sting-4s.mp4`, kind: 'video', silentAudio: true},
		...SERIES_IDS.filter((s) => SERIES[s].channel === ch).flatMap((s): Asset[] =>
			(['dark', 'light'] as const).map((tone) => ({
				id: `${ch}/badge/${s}-${tone}`,
				role: 'badge',
				channel: ch,
				composition: 'BrandBadge',
				props: {series: s, tone},
				out: `${PUB}/${ch}/badges/${s}-${tone}.png`,
				kind: 'still',
				trim: true,
			})),
		),
	];
};

/** Alternates for the owner to compare (not uploaded by default) and large masters. */
const ALTERNATES: Asset[] = [
	{id: 'alt/security-avatar-teal', role: 'alternate', channel: 'zoora-security', composition: 'BrandAvatar', props: {subject: 'badger', bg: '#29B8AD'}, out: `${OUT}/alt/zoora-security-avatar-teal-800.png`, kind: 'still'},
	{id: 'alt/security-avatar-zoo', role: 'alternate', channel: 'zoora-security', composition: 'BrandAvatar', props: {subject: 'zoo', bg: '#C9CED6'}, out: `${OUT}/alt/zoora-security-avatar-zoo-800.png`, kind: 'still'},
	{id: 'alt/zoora-watermark-600', role: 'alternate', channel: 'zoora-ai', composition: 'BrandWatermarkLarge', props: {channel: 'zoora-ai', size: 600}, out: `${OUT}/alt/zoora-ai-watermark-600.png`, kind: 'still'},
	{id: 'alt/security-watermark-600', role: 'alternate', channel: 'zoora-security', composition: 'BrandWatermarkLarge', props: {channel: 'zoora-security', size: 600}, out: `${OUT}/alt/zoora-security-watermark-600.png`, kind: 'still'},
];

/** Layers the QA run needs: key content only, on transparency, plus the probes that re-measure the rigs and fonts. */
const QA_LAYERS: Asset[] = [
	{id: 'qa/zoora-banner-key', role: 'qa', channel: 'zoora-ai', composition: 'ZooraBanner', props: {layer: 'key'}, out: `${OUT}/qa/zoora-ai-banner-key.png`, kind: 'still'},
	{id: 'qa/security-banner-key', role: 'qa', channel: 'zoora-security', composition: 'ShowBanner', props: {layer: 'key'}, out: `${OUT}/qa/zoora-security-banner-key.png`, kind: 'still'},
	{id: 'qa/zoora-avatar-key', role: 'qa', channel: 'zoora-ai', composition: 'BrandAvatar', props: {subject: 'mark', bg: '#0B0C0F', layer: 'key'}, out: `${OUT}/qa/zoora-ai-avatar-key.png`, kind: 'still'},
	{id: 'qa/security-avatar-key', role: 'qa', channel: 'zoora-security', composition: 'BrandAvatar', props: {subject: 'badger', bg: '#C9CED6', layer: 'key'}, out: `${OUT}/qa/zoora-security-avatar-key.png`, kind: 'still'},
	{id: 'qa/probe-zoo', role: 'qa', channel: null, composition: 'BrandProbe', props: {which: 'zoo'}, out: `${OUT}/qa/probe-zoo.png`, kind: 'still'},
	{id: 'qa/probe-badger', role: 'qa', channel: null, composition: 'BrandProbe', props: {which: 'badger'}, out: `${OUT}/qa/probe-badger.png`, kind: 'still'},
	{id: 'qa/probe-badger-sit', role: 'qa', channel: null, composition: 'BrandProbe', props: {which: 'badger', badgerPose: 'sit', badgerHead: 'front'}, out: `${OUT}/qa/probe-badger-sit.png`, kind: 'still'},
	{id: 'qa/text-probe', role: 'qa', channel: null, composition: 'BrandTextProbe', props: {}, out: `${OUT}/qa/text-probe.png`, kind: 'still'},
];

export const ASSETS: readonly Asset[] = [...channelAssets('zoora-ai'), ...channelAssets('zoora-security'), ...ALTERNATES, ...QA_LAYERS];

export const assetById = (id: string): Asset => {
	const a = ASSETS.find((x) => x.id === id);
	if (!a) throw new Error(`unknown branding asset ${id}`);
	return a;
};
