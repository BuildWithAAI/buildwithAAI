/**
 * Office chair in the character style, seen in 3/4 from the side as in the typing panel of
 * zoo_model_sheet_v1.png. Local origin = floor under the gas column; world units.
 * The seat top is at y = CHAIR.seatTop.
 */
import React from 'react';
import {LINE, PROP_COLORS} from '../../palette';
import type {Placement} from '../../types';
import {line, smooth, type Pt} from '../geometry';
import {Shape, Stroke} from '../parts/Shape';

export const CHAIR = {seatTop: -236, columnX: 0} as const;

const BACKREST: Pt[] = [
	[-138, -486], [-127, -504], [-100, -503], [-76, -486], [-64, -440], [-58, -370], [-56, -306], [-62, -278], [-80, -264], [-108, -268],
	[-122, -292], [-130, -360], [-136, -430],
];
const BACKREST_SHADOW = smooth([[-140, -480], [-120, -490], [-114, -420], [-110, -330], [-100, -262], [-140, -262]]);
const SUPPORT: Pt[] = [[-94, -270], [-84, -248], [-70, -230], [-52, -218], [-48, -228], [-66, -238], [-78, -252], [-86, -272]];
const SEAT: Pt[] = [
	[-100, -236], [80, -236], [92, -228], [90, -212], [76, -204], [-96, -204], [-108, -214], [-108, -228],
];
const SEAT_SHADOW = smooth([[-112, -220], [96, -220], [96, -198], [-112, -198]]);
const MECH = smooth([[-34, -205], [34, -205], [30, -190], [-30, -190]]);
const COLUMN = smooth([[-8, -192, 'c'], [8, -192, 'c'], [8, -58, 'c'], [-8, -58, 'c']]);
/** Base legs (hub -> wheel) and wheels. */
const LEGS: [Pt, Pt][] = [
	[[0, -56], [-134, -36]],
	[[0, -56], [10, -30]],
	[[0, -56], [72, -52]],
];
const WHEELS: Pt[] = [[-134, -16], [10, -14], [72, -32]];

export const Chair: React.FC<Placement> = ({x = 0, y = 0, scale = 1}) => (
	<g data-prop="chair" transform={`translate(${x} ${y}) scale(${scale})`}>
		{LEGS.map(([a, b], i) => (
			<g key={i}>
				<Stroke d={line([a, b])} width={15} color={LINE.color} />
				<Stroke d={line([a, b])} width={9} color={PROP_COLORS.chairBase} />
			</g>
		))}
		{WHEELS.map(([wx, wy], i) => (
			<circle key={i} cx={wx} cy={wy} r={14} fill={PROP_COLORS.chairBase} stroke={LINE.color} strokeWidth={LINE.width} />
		))}
		<Shape name="column" d={COLUMN} fill={PROP_COLORS.chairBase} />
		<Shape name="support" d={smooth(SUPPORT)} fill={PROP_COLORS.chairBase} />
		<Shape name="backrest" d={smooth(BACKREST)} fill={PROP_COLORS.chair} shadow={{d: BACKREST_SHADOW, fill: PROP_COLORS.chairShadow}} />
		<Shape name="mechanism" d={MECH} fill={PROP_COLORS.chairBase} />
		<Shape name="seat" d={smooth(SEAT)} fill={PROP_COLORS.chair} shadow={{d: SEAT_SHADOW, fill: PROP_COLORS.chairShadow}} />
	</g>
);
