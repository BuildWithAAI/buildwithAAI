/** Neck: emerges from behind the jaw and sits in the crewneck of the tee. */
import React from 'react';
import {ZOO_COLORS} from '../../palette';
import {smooth} from '../geometry';
import {Shape} from './Shape';

const NECK = smooth([
	[-27.5, -768], [-27.8, -742], [-27.2, -728], [-24, -721.5, 'c'], [-13, -716.2], [0, -714.4], [13, -716.2], [24, -721.5, 'c'],
	[27.2, -728], [27.8, -742], [27.5, -768],
]);
/** Shadow cast by the jaw and beard. */
const NECK_SHADOW = smooth([[-32, -770], [-32, -738], [-16, -734], [0, -732.6], [16, -734], [32, -738], [32, -770]]);

export const Neck: React.FC = () => <Shape name="neck" d={NECK} fill={ZOO_COLORS.skin} shadow={{d: NECK_SHADOW, fill: ZOO_COLORS.skinShadow}} />;
