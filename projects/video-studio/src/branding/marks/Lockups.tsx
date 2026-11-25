/**
 * Logo lockups (HTML text over the bundled OFL fonts, src/brand/fonts.ts; nothing fetched at render time).
 *
 *  - <ZooraLockup/>: the jellyfish mark beside the "Zoora AI" wordmark and an optional tagline (silver on black).
 *  - <ShowLogo/>: "The Zoo & Badger Show" on a slate plate, the ampersand in teal.
 *  - <ShowChannelName/>: the channel's name ("Zoodger News") on one line under that plate, in slate.
 *
 * The host's name is always title case "Zoo", never "ZOO" (owner rule, CLAUDE.md), so nothing here uses
 * text-transform: uppercase. Every size scales from one `scale` number so a lockup keeps its proportions everywhere.
 */
import React from 'react';
import {FONTS} from '../../brand/fonts';
import {JellyfishMark} from './JellyfishMark';
import {BOUNDS} from './jellyfishGeometry';
import {SHOW, ZOORA} from '../tokens';
import {SHOW_LOGO, ZOORA_LOCKUP} from '../layout';

export {SHOW_LOGO, ZOORA_LOCKUP};

export type Anchor = 'left' | 'centre';

export type ZooraLockupProps = {
	/** Anchor point: the lockup's vertical centre at y; x is its left edge ('left') or its centre ('centre'). */
	x: number;
	y: number;
	scale?: number;
	anchor?: Anchor;
	tagline?: readonly string[];
	markColor?: string;
	wordColor?: string;
	tagColor?: string;
	accent?: string | null;
	/** Mark draw progress and wordmark reveal (0..1) for the sting. */
	markDraw?: Parameters<typeof JellyfishMark>[0]['draw'];
	wordReveal?: number;
	tagReveal?: number;
	/** Hide the mark (e.g. when the sting animates its own mark). */
	hideMark?: boolean;
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** Left-to-right wipe: the element is clipped from the right edge (a reveal, not an opacity tint). */
const wipe = (p: number): React.CSSProperties => (p >= 1 ? {} : {clipPath: `inset(-20% ${(1 - clamp01(p)) * 100}% -20% 0)`});

export const ZooraLockup: React.FC<ZooraLockupProps> = ({
	x,
	y,
	scale = 1,
	anchor = 'left',
	tagline = [],
	markColor = ZOORA.line,
	wordColor = ZOORA.text,
	tagColor = ZOORA.textMuted,
	accent = ZOORA.accent,
	markDraw,
	wordReveal = 1,
	tagReveal = 1,
	hideMark = false,
}) => {
	const s = ZOORA_LOCKUP;
	const mh = s.markHeight * scale;
	const mw = (mh * BOUNDS.w) / BOUNDS.h;
	return (
		<div
			data-lockup="zoora"
			style={{
				position: 'absolute',
				left: x,
				top: y,
				transform: `translate(${anchor === 'centre' ? '-50%' : '0'}, -50%)`,
				display: 'flex',
				alignItems: 'center',
				gap: s.gap * scale,
			}}
		>
			<svg width={mw} height={mh} viewBox={`0 0 ${mw} ${mh}`} style={{overflow: 'visible', flex: 'none', visibility: hideMark ? 'hidden' : 'visible'}}>
				<JellyfishMark cx={mw / 2} cy={mh / 2} height={mh} color={markColor} accent={accent} draw={markDraw} />
			</svg>
			<div style={{display: 'flex', flexDirection: 'column', gap: s.tagGap * scale}}>
				<div
					style={{
						fontFamily: FONTS.heading,
						fontWeight: 900,
						fontSize: s.word * scale,
						lineHeight: 0.92,
						letterSpacing: `${s.wordTracking}em`,
						color: wordColor,
						whiteSpace: 'nowrap',
						...wipe(wordReveal),
					}}
				>
					Zoora <span style={{color: markColor}}>AI</span>
				</div>
				{tagline.length ? (
					<div style={{fontFamily: FONTS.body, fontWeight: 600, fontSize: s.tag * scale, lineHeight: s.tagLine, color: tagColor, whiteSpace: 'nowrap', ...wipe(tagReveal)}}>
						{tagline.map((l) => (
							<div key={l}>{l}</div>
						))}
					</div>
				) : null}
			</div>
		</div>
	);
};

export type ShowLogoProps = {
	x: number;
	y: number;
	scale?: number;
	anchor?: Anchor;
	/** Draw the slate plate behind the text (default true). */
	plate?: boolean;
	/** Line reveals (0..1) for the sting: plate, "The", "Zoo & Badger", "Show", ampersand colour-in. */
	reveal?: Partial<{plate: number; the: number; main: number; show: number; amp: number}>;
};

/** "The Zoo & Badger Show": three centred lines on a slate plate. */
export const ShowLogo: React.FC<ShowLogoProps> = ({x, y, scale = 1, anchor = 'centre', plate = true, reveal = {}}) => {
	const s = SHOW_LOGO;
	const r = {plate: 1, the: 1, main: 1, show: 1, amp: 1, ...reveal};
	const small: React.CSSProperties = {
		fontFamily: FONTS.heading,
		fontWeight: 800,
		letterSpacing: `${s.tracking}em`,
		color: SHOW.onPlateMuted,
		lineHeight: 1,
		// tracking adds space after the last letter too; pull it back so the line stays optically centred
		marginRight: `-${s.tracking}em`,
		whiteSpace: 'nowrap',
	};
	return (
		<div
			data-lockup="show"
			style={{
				position: 'absolute',
				left: x,
				top: y,
				transform: `translate(${anchor === 'centre' ? '-50%' : '0'}, -50%)`,
				padding: `${s.padY * scale}px ${s.padX * scale}px`,
				borderRadius: s.radius * scale,
				backgroundColor: plate ? SHOW.plate : 'transparent',
				clipPath: r.plate >= 1 ? undefined : `inset(0 ${(1 - clamp01(r.plate)) * 100}% 0 0 round ${s.radius * scale}px)`,
				display: 'flex',
				flexDirection: 'column',
				alignItems: 'center',
				gap: s.gap * scale,
			}}
		>
			<div style={{...small, fontSize: s.the * scale, ...wipe(r.the)}}>The</div>
			<div style={{fontFamily: FONTS.heading, fontWeight: 900, fontSize: s.main * scale, lineHeight: 1.02, color: SHOW.onPlate, whiteSpace: 'nowrap', ...wipe(r.main)}}>
				Zoo <span style={{color: r.amp >= 0.5 ? SHOW.accent : SHOW.onPlate}}>&amp;</span> Badger
			</div>
			<div style={{...small, fontSize: s.show * scale, ...wipe(r.show)}}>Show</div>
		</div>
	);
};

export type ShowChannelNameProps = {
	/** Centre of the line and the top of its line box (px). */
	x: number;
	top: number;
	/** Font size (px). */
	size: number;
	text: string;
};

/**
 * The channel's name under the show logo (CHANNEL_IDENTITY in tokens.ts): Montserrat 800, 0.08em tracking, slate, one
 * line, never uppercased. One style for every place that draws it: the channel banner and the show set's desk logo.
 */
export const ShowChannelName: React.FC<ShowChannelNameProps> = ({x, top, size, text}) => (
	<div
		data-part="channelName"
		style={{
			position: 'absolute',
			left: x,
			top,
			transform: 'translateX(-50%)',
			fontFamily: FONTS.heading,
			fontWeight: 800,
			fontSize: size,
			letterSpacing: '0.08em',
			color: SHOW.plate,
			whiteSpace: 'nowrap',
		}}
	>
		{text}
	</div>
);
