/**
 * Beat: the punchline's reaction shot. A silent scene (empty narration + minDurationSec, so the voice step makes it
 * real timeline time and chapters and subtitles stay in sync) that hard-cuts to Badger's close-up for his reaction
 * (badgerBeats[0].reaction, or badger.reaction, default judge). Nothing else on screen: the look is the joke.
 */
import React from 'react';
import {SceneStage, type SceneCtx} from './common';
import {HeaderRow} from './cards';

export const Beat: React.FC<{ctx: SceneCtx}> = ({ctx}) => (
	<>
		<SceneStage ctx={ctx} />
		<HeaderRow ctx={ctx} />
	</>
);
