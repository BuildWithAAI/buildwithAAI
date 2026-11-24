/**
 * Branding entry root: every branding still and animation is registered here (never in src/Root.tsx).
 * IDs are stable: render.ts, docs/BRANDING.md and the QA run refer to them.
 */
import React from 'react';
import {Composition, Still} from 'remotion';
import {Probe, PROBE, type ProbeProps} from './dev/Probe';
import {MarkSheet} from './dev/MarkSheet';
import {TextProbe, TEXT_PROBE} from './dev/TextProbe';
import {Avatar, type AvatarProps} from './stills/Avatar';
import {BannerZoora, type BannerZooraProps} from './stills/BannerZoora';
import {BannerShow, type BannerShowProps} from './stills/BannerShow';
import {Watermark, type WatermarkProps} from './stills/Watermark';
import {EndScreen, type EndScreenProps} from './stills/EndScreen';
import {BADGE_CANVAS, END_SCREEN_FPS, END_SCREEN_FRAMES} from './layout';
import {BadgePreview, BadgeStill, type BadgeStillProps} from './stills/Badges';
import {ZooraSting, type ZooraStingProps} from './stings/ZooraSting';
import {ShowSting, type ShowStingProps} from './stings/ShowSting';
import {stingMetadata} from './stings/audio';
import {AVATAR, BANNER, END_SCREEN, STING, WATERMARK} from './spec';
import {ZOORA} from './tokens';

export const BrandingRoot: React.FC = () => (
	<>
		{/* deliverables */}
		<Still id="ZooraBanner" component={BannerZoora} width={BANNER.width} height={BANNER.height} defaultProps={{layer: 'all'} as BannerZooraProps} />
		<Still id="ShowBanner" component={BannerShow} width={BANNER.width} height={BANNER.height} defaultProps={{layer: 'all'} as BannerShowProps} />
		<Still id="BrandAvatar" component={Avatar} width={AVATAR.width} height={AVATAR.height} defaultProps={{subject: 'mark', bg: ZOORA.bg} as AvatarProps} />
		<Still id="BrandWatermark" component={Watermark} width={WATERMARK.width} height={WATERMARK.height} defaultProps={{channel: 'zoora-ai'} as WatermarkProps} />
		<Still id="BrandWatermarkLarge" component={Watermark} width={600} height={600} defaultProps={{channel: 'zoora-ai', size: 600} as WatermarkProps} />
		<Composition
			id="BrandEndScreen"
			component={EndScreen}
			width={END_SCREEN.width}
			height={END_SCREEN.height}
			fps={END_SCREEN_FPS}
			durationInFrames={END_SCREEN_FRAMES}
			defaultProps={{channel: 'zoora-ai'} as EndScreenProps}
		/>
		<Composition
			id="ZooraSting"
			component={ZooraSting}
			width={STING.width}
			height={STING.height}
			fps={STING.fps}
			durationInFrames={STING.defaultSec * STING.fps}
			defaultProps={{} as ZooraStingProps}
			calculateMetadata={stingMetadata}
		/>
		<Composition
			id="ShowSting"
			component={ShowSting}
			width={STING.width}
			height={STING.height}
			fps={STING.fps}
			durationInFrames={STING.defaultSec * STING.fps}
			defaultProps={{} as ShowStingProps}
			calculateMetadata={stingMetadata}
		/>
		<Still id="BrandBadge" component={BadgeStill} width={BADGE_CANVAS.width} height={BADGE_CANVAS.height} defaultProps={{series: 'pov', tone: 'dark'} as BadgeStillProps} />
		{/* dev aids (never deliverables) */}
		<Still id="BrandBadgePreview" component={BadgePreview} width={1320} height={1560} />
		<Still id="BrandProbe" component={Probe} width={PROBE.width} height={PROBE.height} defaultProps={{which: 'both'} as ProbeProps} />
		<Still id="BrandTextProbe" component={TextProbe} width={TEXT_PROBE.width} height={TEXT_PROBE.height} />
		<Still id="BrandMarkSheet" component={MarkSheet} width={1920} height={1080} />
	</>
);
