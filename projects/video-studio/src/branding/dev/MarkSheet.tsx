/** Dev sheet: the jellyfish mark at several sizes, with and without the accent (not a deliverable). */
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {JellyfishMark} from '../marks/JellyfishMark';
import {ZOORA} from '../tokens';

export const MarkSheet: React.FC = () => (
	<AbsoluteFill style={{backgroundColor: ZOORA.bg}}>
		<svg width={1920} height={1080} viewBox="0 0 1920 1080">
			<JellyfishMark cx={330} cy={400} height={560} color={ZOORA.line} accent={ZOORA.accent} />
			<JellyfishMark cx={900} cy={400} height={560} color={ZOORA.line} />
			{[200, 120, 70, 40, 24].map((h, i) => (
				<JellyfishMark key={h} cx={1300 + [0, 190, 330, 430, 500][i]} cy={300} height={h} color={ZOORA.line} accent={ZOORA.accent} />
			))}
			{[200, 120, 70, 40, 24].map((h, i) => (
				<JellyfishMark key={`p${h}`} cx={1300 + [0, 190, 330, 430, 500][i]} cy={700} height={h} color={ZOORA.line} />
			))}
		</svg>
	</AbsoluteFill>
);
