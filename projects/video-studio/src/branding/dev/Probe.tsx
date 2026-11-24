/** Dev probe: Zoo and Badger on a transparent canvas, for measuring boxes and trying poses (not a deliverable). */
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {Badger, ZooRig} from '../../characters';
import type {BadgerHead, BadgerPose, BadgerView} from '../../characters/types';

export const PROBE = {width: 1600, height: 1200, scale: 1, groundY: 1100, zooX: 400, badgerX: 1100} as const;

export type ProbeProps = {which: 'zoo' | 'badger' | 'both'; badgerPose?: BadgerPose; badgerHead?: BadgerHead; badgerView?: BadgerView};

export const Probe: React.FC<ProbeProps> = ({which, badgerPose = 'stand', badgerHead, badgerView = 'front'}) => (
	<AbsoluteFill>
		<svg width={PROBE.width} height={PROBE.height} viewBox={`0 0 ${PROBE.width} ${PROBE.height}`}>
			{which !== 'badger' ? <ZooRig x={PROBE.zooX} y={PROBE.groundY} scale={PROBE.scale} breathe={false} /> : null}
			{which !== 'zoo' ? (
				<Badger view={badgerView} pose={badgerPose} head={badgerHead} x={PROBE.badgerX} y={PROBE.groundY} scale={PROBE.scale} breathe={false} />
			) : null}
		</svg>
	</AbsoluteFill>
);
