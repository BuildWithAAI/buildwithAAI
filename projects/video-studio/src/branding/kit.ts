/**
 * Public API of the channel branding kit, for other workflows (thumbnails, the show, episodes). Import from here,
 * never from deep paths, and never import src/branding/index.ts (it is the Remotion entry point and calls
 * registerRoot). Everything is vector React/SVG drawn in code; nothing here fetches at render time.
 *
 *   import {SeriesBadge, ShowLogo, ZooraSting} from '../branding/kit';
 */
export {JellyfishMark, FULL_DRAW, markScaleFor, type JellyfishDraw, type JellyfishMarkProps} from './marks/JellyfishMark';
export {ZooraLockup, ShowLogo, ShowChannelName, type ZooraLockupProps, type ShowLogoProps, type ShowChannelNameProps} from './marks/Lockups';
export {SeriesBadge, type BadgeTone, type SeriesBadgeProps} from './marks/SeriesBadge';
export {Icon, type IconName} from './marks/icons';
export {ZooraSting, type ZooraStingProps} from './stings/ZooraSting';
export {ShowSting, type ShowStingProps} from './stings/ShowSting';
export {StingAudio, stingFramesFor, stingMetadata, type StingAudioProps} from './stings/audio';
export {EndScreen, type EndScreenProps} from './stills/EndScreen';
export {WatermarkArt} from './stills/Watermark';
export {ContactShadow, ShowDesk} from './scene/Stage';
export {SERIES, SERIES_IDS, type Series, type SeriesId} from './series';
export {BACKGROUND_SHADOW, CHANNEL_IDENTITY, CHANNEL_KEYS, OUTLINE, RADIUS, SHOW, ZOORA, type ChannelKey} from './tokens';
export {BADGE, END_LABELS, END_ZONES, SHOW_STING_BEATS, STING_HITS, ZOORA_STING_BEATS} from './layout';
export {AVATAR, BANNER, END_SCREEN, STING, TEXT_LIMITS, THUMBNAIL, WATERMARK} from './spec';
