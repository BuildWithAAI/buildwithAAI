/** Dev probe: the set through every shot, neutral characters (tuning aid; not part of the show). */
import React, {useEffect, useState} from 'react';
import {AbsoluteFill, useDelayRender} from 'remotion';
import {BRAND} from '../../characters/palette';
import {loadBrandFonts} from '../../brand/fonts';
import {StageLayer} from '../set/Stage';
import {shotFor, type ShotName} from '../layout/shots';
import {BADGER_NEUTRAL, ZOO_NEUTRAL, type BadgerState} from '../perf/state';
import type {Format} from '../types';
import type {BadgerHead, Expression} from '../../characters/types';

export const Probe: React.FC<{format: Format; shot: ShotName; channelName?: string | null; point?: number; head?: BadgerHead; judge?: number; bexpr?: Expression; earsBack?: number}> = ({format, shot, channelName, point, head, judge, bexpr, earsBack}) => {
	const {delayRender, continueRender} = useDelayRender();
	const [h] = useState(() => delayRender('fonts'));
	useEffect(() => {
		loadBrandFonts().then(() => continueRender(h));
	}, [h, continueRender]);
	const zoo = point !== undefined ? {...ZOO_NEUTRAL, pose: 'point' as const, poseAmount: point, lookX: 0.75} : ZOO_NEUTRAL;
	const badger: BadgerState = {...BADGER_NEUTRAL, head: head ?? 'front', judge: judge ?? 0, expression: bexpr ?? 'neutral', earsBack: earsBack ?? 0, lookY: head === 'threeQuarterLeftScreen' ? -0.45 : 0, lookX: head === 'threeQuarterLeftScreen' ? -0.25 : 0};
	return (
		<AbsoluteFill style={{backgroundColor: BRAND.background}}>
			<StageLayer format={format} shot={shotFor(format, shot)} zoo={zoo} badger={badger} push={1} onAir breathFrame={0} channelName={channelName ?? null} />
		</AbsoluteFill>
	);
};
