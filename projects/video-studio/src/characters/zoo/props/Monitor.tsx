/**
 * Desktop monitor in the character style, turned slightly as in the typing panel of
 * zoo_model_sheet_v1.png (its left side edge shows). Local origin = centre of the stand's base where
 * it rests on the desk; world units.
 */
import React from 'react';
import {PROP_COLORS} from '../../palette';
import type {Placement} from '../../types';
import {smooth, type Pt} from '../geometry';
import {Shape} from '../parts/Shape';

// Corners measured on the panel (world units, then made relative to the base centre at x=235 on the desk top):
// top-left (102,-611), top-right (336,-611), bottom-right (323,-417), bottom-left (75,-382). The near (left)
// edge is longer: the screen is turned toward ZOO and seen in perspective.
const SIDE: Pt[] = [[-146, -262, 'c'], [-133, -267, 'c'], [-160, -38, 'c'], [-174, -34, 'c']];
const BEZEL: Pt[] = [[-133, -267, 'c'], [101, -267, 'c'], [88, -73, 'c'], [-160, -38, 'c']];
const SCREEN: Pt[] = [[-123, -257.4, 'c'], [90.6, -257.6, 'c'], [79, -82.4, 'c'], [-146.6, -50, 'c']];
const NECK: Pt[] = [[-30, -80, 'c'], [-4, -82, 'c'], [12, -22, 'c'], [-16, -22, 'c']];
const BASE: Pt[] = [[-64, -25], [62, -25], [67, -12], [64, -1.75, 'c'], [-64, -1.75, 'c'], [-68, -12]];

export const Monitor: React.FC<Placement> = ({x = 0, y = 0, scale = 1}) => (
	<g data-prop="monitor" transform={`translate(${x} ${y}) scale(${scale})`}>
		<Shape name="base" d={smooth(BASE)} fill={PROP_COLORS.monitorShadow} />
		<Shape name="neck" d={smooth(NECK)} fill={PROP_COLORS.monitor} shadow={{d: smooth([[-8, -84], [-12, -84], [16, -20], [20, -20]]), fill: PROP_COLORS.monitorShadow}} />
		<Shape name="side" d={smooth(SIDE)} fill={PROP_COLORS.monitorShadow} />
		<Shape name="bezel" d={smooth(BEZEL)} fill={PROP_COLORS.monitor} />
		<Shape name="screen" d={smooth(SCREEN)} fill={PROP_COLORS.monitorShadow} stroke={2} />
	</g>
);
