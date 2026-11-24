/**
 * <SeriesBadge/>: the series tag for thumbnails (1280x720 canvas). Sized from one height so it reads when the
 * thumbnail is shown 168-360 px wide: at 88 px tall on 1280 the label is still ~11 px on a 320 px thumbnail.
 * Place it top-left: YouTube draws the duration stamp bottom-right. Title case only (never "ZOO").
 *
 * tone 'dark': slate plate, off-white label (for light thumbnails); 'light': off-white plate with the house outline
 * (for dark thumbnails such as Zoora AI's black).
 */
import React from 'react';
import {FONTS} from '../../brand/fonts';
import {BRAND} from '../../characters/palette';
import {SERIES, type SeriesId} from '../series';
import {OUTLINE} from '../tokens';
import {Icon} from './icons';
import {BADGE} from '../layout';

export type BadgeTone = 'dark' | 'light';

export {BADGE};

export type SeriesBadgeProps = {series: SeriesId; tone?: BadgeTone; height?: number; x?: number; y?: number};

export const SeriesBadge: React.FC<SeriesBadgeProps> = ({series, tone = 'dark', height = BADGE.height, x = 0, y = 0}) => {
	const s = SERIES[series];
	const dark = tone === 'dark';
	const ink = dark ? BRAND.offWhite : BRAND.nearBlack;
	const iconColor = dark ? BRAND.silver : BRAND.nearBlack;
	const iconSize = height * BADGE.icon;
	const stripe = Math.round(height * BADGE.stripe);
	return (
		<div
			data-badge={series}
			style={{
				position: 'absolute',
				left: x,
				top: y,
				height,
				boxSizing: 'border-box',
				display: 'flex',
				alignItems: 'center',
				gap: height * BADGE.gap,
				paddingLeft: height * BADGE.padX,
				paddingRight: height * BADGE.padX * 1.15,
				borderRadius: height * BADGE.radius,
				backgroundColor: dark ? BRAND.slate : BRAND.offWhite,
				// light tone: the house outline on all sides; dark tone: no outline, a teal stripe on the left edge only
				borderTop: dark ? 'none' : `${OUTLINE}px solid ${BRAND.nearBlack}`,
				borderRight: dark ? 'none' : `${OUTLINE}px solid ${BRAND.nearBlack}`,
				borderBottom: dark ? 'none' : `${OUTLINE}px solid ${BRAND.nearBlack}`,
				borderLeft: dark ? `${stripe}px solid ${BRAND.teal}` : `${OUTLINE}px solid ${BRAND.nearBlack}`,
				whiteSpace: 'nowrap',
			}}
		>
			<svg width={iconSize} height={iconSize} viewBox={`0 0 ${iconSize} ${iconSize}`} style={{flex: 'none', overflow: 'visible'}}>
				<Icon name={s.icon} x={0} y={0} size={iconSize} color={iconColor} accent={s.icon === 'jellyfish' || s.icon === 'pulse' ? BRAND.teal : null} />
			</svg>
			<div style={{fontFamily: FONTS.heading, fontWeight: 900, fontSize: height * BADGE.text, lineHeight: 1, color: ink, paddingBottom: height * 0.03}}>{s.label}</div>
		</div>
	);
};
