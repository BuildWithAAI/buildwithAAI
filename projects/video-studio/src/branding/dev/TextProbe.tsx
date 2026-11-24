/** Dev probe: the "Zoora AI" wordmark at 200 px, left edge at x=100, for measuring its ink width (not a deliverable). */
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {FONTS} from '../../brand/fonts';
import {ZOORA_LOCKUP} from '../marks/Lockups';

export const TEXT_PROBE = {width: 1400, height: 400, size: 200, left: 100, top: 100} as const;

export const TextProbe: React.FC = () => (
	<AbsoluteFill>
		<div
			style={{
				position: 'absolute',
				left: TEXT_PROBE.left,
				top: TEXT_PROBE.top,
				fontFamily: FONTS.heading,
				fontWeight: 900,
				fontSize: TEXT_PROBE.size,
				lineHeight: 0.92,
				letterSpacing: `${ZOORA_LOCKUP.wordTracking}em`,
				color: '#FFFFFF',
				whiteSpace: 'nowrap',
			}}
		>
			Zoora AI
		</div>
	</AbsoluteFill>
);
