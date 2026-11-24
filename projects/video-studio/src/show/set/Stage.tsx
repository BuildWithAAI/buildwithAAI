/**
 * <StageLayer/>: the set seen through one camera shot. Back to front: wall panels, ON AIR sign, chairs, Zoo and Badger
 * (the shared rigs, read-only, one scale), the desk, the microphones, then the logo plate (HTML, same transform).
 * The shot maps stage units to px (layout/shots.ts); a push-in scales the whole layer about the shot's anchor with a
 * float transform (ART_GUIDE MO13: no rounding, no will-change).
 */
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {Badger, ZooRig} from '../../characters';
import type {Format} from '../types';
import {STAGE} from '../layout/stage';
import {FRAME, type Shot} from '../layout/shots';
import type {BadgerState, ZooState} from '../perf/state';
import {BadgerChair, Desk, Mic, Nameplate, OnAirSign, WallPanels, ZooChair} from './props';
import {LogoPlate} from './LogoPlate';

export type StageProps = {
	format: Format;
	shot: Shot;
	zoo: ZooState | null;
	badger: BadgerState | null;
	/** Push-in factor at this frame (1 = none). */
	push: number;
	onAir: boolean;
	/** Global frame for Zoo's breathing, so it runs on through cuts. */
	breathFrame: number;
	channelName?: string | null;
};

export const StageLayer: React.FC<StageProps> = ({format, shot, zoo, badger, push, onAir, breathFrame, channelName}) => {
	if (shot.name === 'none') return null;
	const st = STAGE[format];
	const {width, height} = FRAME[format];
	const pa = shot.pushAnchor;
	const outer = `translate(${pa.x} ${pa.y}) scale(${push}) translate(${-pa.x} ${-pa.y})`;
	const inner = `translate(${shot.tx} ${shot.ty}) scale(${shot.S})`;
	const hasZoo = shot.cast.includes('zoo');
	const hasBadger = shot.cast.includes('badger');
	return (
		<AbsoluteFill>
			<svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{position: 'absolute', left: 0, top: 0}}>
				<g transform={outer}>
					<g transform={inner}>
						<WallPanels panels={st.panels} />
						{shot.dressing.onAir ? <OnAirSign x={st.onAir.x} y={st.onAir.y} h={st.onAir.h} on={onAir} /> : null}
						{hasZoo ? <ZooChair st={st} /> : null}
						{hasBadger ? <BadgerChair st={st} /> : null}
					</g>
					{hasZoo && zoo ? (
						<ZooRig
							x={shot.tx}
							y={shot.ty}
							scale={shot.S}
							view="front"
							pose={zoo.pose}
							poseAmount={zoo.poseAmount}
							pointWindup={zoo.pointWindup}
							expression={zoo.expression}
							mouth={zoo.mouth}
							blink={zoo.blink}
							browLift={zoo.browLift}
							lookX={zoo.lookX}
							lookY={zoo.lookY}
							headTilt={zoo.headTilt}
							breathFrame={breathFrame}
						/>
					) : null}
					{hasBadger && badger ? (
						<Badger
							x={shot.tx + st.badger.x * shot.S}
							y={shot.ty + st.badger.y * shot.S}
							scale={shot.S}
							view="front"
							head={badger.head}
							expression={badger.expression}
							blink={badger.blink}
							judge={badger.judge}
							earsBack={badger.earsBack}
							headTilt={badger.headTilt}
							lookX={badger.lookX}
							lookY={badger.lookY}
						/>
					) : null}
					<g transform={inner}>
						<Desk st={st} />
						{hasZoo && st.nameplates ? <Nameplate r={st.nameplates.zoo} name="Zoo" /> : null}
						{hasBadger && st.nameplates ? <Nameplate r={st.nameplates.badger} name="Badger" /> : null}
						{hasZoo ? <Mic m={st.zooMic} /> : null}
						{hasBadger ? <Mic m={st.badgerMic} /> : null}
					</g>
				</g>
			</svg>
			{shot.dressing.logo ? (
				<div
					style={{
						position: 'absolute',
						left: 0,
						top: 0,
						width: 0,
						height: 0,
						transformOrigin: '0 0',
						transform: `translate(${pa.x}px, ${pa.y}px) scale(${push}) translate(${-pa.x}px, ${-pa.y}px) translate(${shot.tx}px, ${shot.ty}px) scale(${shot.S})`,
					}}
				>
					<LogoPlate x={st.logo.x} y={st.logo.y} scale={st.logo.scale} channelName={channelName} />
				</div>
			) : null}
		</AbsoluteFill>
	);
};
