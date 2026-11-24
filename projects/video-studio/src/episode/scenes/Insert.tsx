/**
 * Badger insert shot: a hard cut to Badger alone for his reaction beat (ART_GUIDE MO15 punch-in, MO17 reaction beat).
 * Used in Shorts, where a shared frame would push his face into the caption band: Badger's head is at half ZOO's
 * height, so at one shared scale the two faces cannot both stay above the captions.
 */
import React from 'react';
import {useCurrentFrame} from 'remotion';
import {CharacterLayer, SceneBg, type SceneCtx} from './parts';
import type {Direction} from './direction';
import {BADGER_INSERT} from '../layout/specs';

export const inInsert = (dir: Direction, frame: number): boolean => !!dir.insert && frame >= dir.insert.from && frame < dir.insert.to;

export const BadgerInsert: React.FC<{ctx: SceneCtx; dir: Direction}> = ({ctx, dir}) => {
	useCurrentFrame();
	return (
		<SceneBg>
			<CharacterLayer format={ctx.format} zoo={null} badger={{place: BADGER_INSERT[ctx.format], schedule: dir.badger}} />
		</SceneBg>
	);
};
