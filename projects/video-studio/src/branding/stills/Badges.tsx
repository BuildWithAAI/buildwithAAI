/**
 * Badge stills: one transparent PNG per series and tone (trimmed to the badge by render.ts), plus a dev preview
 * that places every badge on mock 1280x720 thumbnails so they can be judged at real list sizes.
 */
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {Badger, ZooRig} from '../../characters';
import {BRAND} from '../../characters/palette';
import {SeriesBadge, type BadgeTone} from '../marks/SeriesBadge';
import {SERIES_IDS, type SeriesId} from '../series';
import {THUMBNAIL} from '../spec';
import {ZOORA} from '../tokens';

export type BadgeStillProps = {series: SeriesId; tone: BadgeTone};

export const BadgeStill: React.FC<BadgeStillProps> = ({series, tone}) => (
	<AbsoluteFill style={{backgroundColor: 'transparent'}}>
		<SeriesBadge series={series} tone={tone} />
	</AbsoluteFill>
);

/** Dev preview: badges in the top-left of mock thumbnails (light set, dark Zoora). */
export const BadgePreview: React.FC = () => (
	<AbsoluteFill style={{backgroundColor: '#7F7F7F'}}>
		{SERIES_IDS.map((id, i) => {
			const dark = id === 'pov';
			const col = i % 2;
			const row = Math.floor(i / 2);
			const W = THUMBNAIL.width / 2;
			const H = THUMBNAIL.height / 2;
			return (
				<div key={id} style={{position: 'absolute', left: col * (W + 20) + 20, top: row * (H + 20) + 20, width: W, height: H, overflow: 'hidden', backgroundColor: dark ? ZOORA.bg : BRAND.background}}>
					<div style={{position: 'absolute', left: 0, top: 0, width: THUMBNAIL.width, height: THUMBNAIL.height, transform: 'scale(0.5)', transformOrigin: '0 0'}}>
						<svg width={THUMBNAIL.width} height={THUMBNAIL.height} style={{position: 'absolute'}}>
							<ZooRig x={820} y={1180} scale={1.1} breathe={false} />
							<Badger view="front" x={1110} y={1060} scale={1.1} breathe={false} />
						</svg>
						<SeriesBadge series={id} tone={dark ? 'light' : 'dark'} x={40} y={40} />
					</div>
				</div>
			);
		})}
	</AbsoluteFill>
);
