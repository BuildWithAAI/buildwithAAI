/** Neck: emerges from behind the jaw and sits in the crewneck of the tee. */
import React from 'react';
import {ZOO_COLORS} from '../../palette';
import {smooth} from '../geometry';
import {Shape} from './Shape';

// Repair round 1: extends down into the lowered crewneck (tee neckline -703.6).
const NECK = smooth([
	[-27.5, -768], [-27.8, -742], [-27.4, -722], [-25, -710, 'c'], [-13, -703.6], [0, -701.6], [13, -703.6], [25, -710, 'c'],
	[27.4, -722], [27.8, -742], [27.5, -768],
]);
/**
 * Shadow cast by the jaw and beard (repair round 2): a crescent ~5 u deep that follows the jaw line (Face.tsx FACE_HALF);
 * round 1's band was 7-12 u deep and read as a collar on the neck. Above the jaw it is hidden by the face.
 */
const NECK_SHADOW = smooth([
	[-32, -770], [-32, -748.5], [-22.6, -742.6], [-15.4, -738], [-7.6, -735.6], [0, -735], [7.6, -735.6], [15.4, -738], [22.6, -742.6],
	[32, -748.5], [32, -770],
]);

export const Neck: React.FC = () => <Shape name="neck" d={NECK} fill={ZOO_COLORS.skin} shadow={{d: NECK_SHADOW, fill: ZOO_COLORS.skinShadow}} />;
