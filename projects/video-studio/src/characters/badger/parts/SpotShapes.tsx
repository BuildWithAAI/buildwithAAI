import React from 'react';
import {BADGER_COLORS} from '../../palette';
import type {BadgerSpot} from '../spots';

/** Renders spot records as flat near-black fills. Callers place this INSIDE a part's clip group. */
export const SpotShapes: React.FC<{spots: readonly BadgerSpot[]}> = ({spots}) => (
	<>
		{spots.map((s) => (
			<path key={s.id} d={s.path} fill={BADGER_COLORS.spot} data-spot={s.id} />
		))}
	</>
);
