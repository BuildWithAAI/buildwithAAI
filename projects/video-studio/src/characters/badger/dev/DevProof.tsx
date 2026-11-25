import React from 'react';
import {AbsoluteFill, Composition, useCurrentFrame} from 'remotion';
import {BRAND} from '../../palette';
import {Badger} from '../Badger';
import {badgerTrack, PUSH, pushScale} from '../../../compositions/characters/Preview10s';
import {BADGER_X, FRAME, GROUND_Y, PAIR_LINE_SCALE, PAIR_SCALE} from '../../../compositions/characters/stage';

/**
 * Dev-only (round 5): Badger alone, exactly as Preview10s draws him (same track, placement, line scale and push-in), on the
 * flat background with no Zoo, ground line or contact shadow, so seal checks and head-swap measurements of the proof frames
 * see only Badger. Render frames with `npx remotion render src/characters/badger/dev/index.ts BadgerProof <dir> --sequence`.
 */
const BadgerProof: React.FC = () => {
	const frame = useCurrentFrame();
	const b = badgerTrack(frame);
	const k = pushScale(frame);
	const {x: ax, y: ay} = PUSH.anchor;
	return (
		<AbsoluteFill style={{backgroundColor: BRAND.background}}>
			<svg width={FRAME.width} height={FRAME.height} viewBox={`0 0 ${FRAME.width} ${FRAME.height}`}>
				<g transform={`translate(${ax} ${ay}) scale(${k}) translate(${-ax} ${-ay})`}>
					<Badger
						x={BADGER_X}
						y={GROUND_Y}
						scale={PAIR_SCALE}
						lineScale={PAIR_LINE_SCALE}
						view="left"
						pose={b.pose}
						head={b.head}
						expression="neutral"
						blink={b.blink}
						judge={b.judge}
						earsBack={b.earsBack}
						headTilt={b.headTilt}
						neckTurn={b.neckTurn}
						lookX={b.lookX}
						lookY={b.lookY}
					/>
				</g>
			</svg>
		</AbsoluteFill>
	);
};

export const ProofCompositions: React.FC = () => (
	<Composition id="BadgerProof" component={BadgerProof} durationInFrames={300} fps={FRAME.fps} width={FRAME.width} height={FRAME.height} />
);
