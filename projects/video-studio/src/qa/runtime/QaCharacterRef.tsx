/**
 * QaRef-<id>: the canonical reference for the off-model check. Frame i draws one character instance (items[i])
 * with the canonical component from src/characters, the same props and the same local frame (via <Freeze>),
 * placed with a pure uniform scale + translation that puts its origin and size where the scene put them.
 * Background transparent: the alpha channel is the character's silhouette.
 *
 * Anything the scene did to the character beyond "move and scale it" (mirror, stretch, skew, rotate, filter,
 * blend, clip, recolour) therefore shows up as a difference between the scene's solo pass and this render.
 */
import React from 'react';
import {AbsoluteFill, Freeze, useCurrentFrame} from 'remotion';
import {Badger} from '../../characters/badger/Badger';
import {ZooRig} from '../../characters/zoo/Zoo';
import type {RefProps} from '../protocol.ts';
import {QaProbe} from './QaProbe';

/** Props the reference always sets itself (placement), never copied from the scene. */
const PLACEMENT = new Set(['x', 'y', 'scale', 'embed', 'showPivots']);

export const QaCharacterRef: React.FC<RefProps> = ({items, width, height}) => {
	const f = useCurrentFrame();
	const it = items[f];
	if (!it) return <QaProbe charactersOnly />;
	const props = Object.fromEntries(Object.entries(it.props).filter(([k]) => !PLACEMENT.has(k)));
	const [a, b, c, d, e, g] = it.matrix;
	return (
		<AbsoluteFill>
			<svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{position: 'absolute', left: 0, top: 0, overflow: 'visible'}}>
				<g transform={`matrix(${a} ${b} ${c} ${d} ${e} ${g})`}>
					<Freeze frame={it.localFrame}>{it.kind === 'zoo' ? <ZooRig {...props} x={0} y={0} scale={1} /> : <Badger {...props} x={0} y={0} scale={1} />}</Freeze>
				</g>
			</svg>
			<QaProbe charactersOnly />
		</AbsoluteFill>
	);
};

/** Loaded lazily by the shim (`lazyComponent`), so only renders that draw a reference load src/characters. */
export default QaCharacterRef;
