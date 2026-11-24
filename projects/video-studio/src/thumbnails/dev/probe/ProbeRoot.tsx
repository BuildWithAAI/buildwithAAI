/**
 * Probe: renders ZOO (front) and BADGER (front, threeQuarter) at scale 1 and logs world-unit boxes of the whole rig and
 * of the head groups (geometry boxes, strokes excluded) to the browser console. Used once to derive the crop constants
 * in src/thumbnails/layout.ts; re-run it after a rig change.
 */
import React, {useLayoutEffect, useRef, useState} from 'react';
import {AbsoluteFill, Still, useDelayRender} from 'remotion';
import {Badger, BRAND, ZooRig} from '../../../characters';
import type {Expression} from '../../../characters/types';

type Box = {x0: number; y0: number; x1: number; y1: number};

const worldBox = (root: SVGGraphicsElement, el: SVGGraphicsElement): Box => {
	const b = el.getBBox();
	const rootCtm = root.getCTM();
	const elCtm = el.getCTM();
	if (!rootCtm || !elCtm) throw new Error('no CTM');
	const m = rootCtm.inverse().multiply(elCtm);
	const pts = [
		[b.x, b.y],
		[b.x + b.width, b.y],
		[b.x, b.y + b.height],
		[b.x + b.width, b.y + b.height],
	].map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
	const r = (n: number) => Math.round(n * 10) / 10;
	return {x0: r(Math.min(...pts.map((p) => p.x))), y0: r(Math.min(...pts.map((p) => p.y))), x1: r(Math.max(...pts.map((p) => p.x))), y1: r(Math.max(...pts.map((p) => p.y)))};
};

const Probe: React.FC<{expression: Expression}> = ({expression}) => {
	const ref = useRef<SVGSVGElement>(null);
	const {delayRender, continueRender} = useDelayRender();
	const [handle] = useState(() => delayRender('probe'));
	useLayoutEffect(() => {
		const svg = ref.current;
		if (!svg) return;
		const out: Record<string, unknown> = {};
		svg.querySelectorAll<SVGGElement>('[data-character]').forEach((root, i) => {
			const key = `${root.getAttribute('data-character')}-${root.getAttribute('data-view')}-${i}`;
			const whole = root.getBBox();
			const head = root.querySelector<SVGGElement>('[data-part="head"], [data-head]');
			out[key] = {
				whole: {x0: Math.round(whole.x), y0: Math.round(whole.y), x1: Math.round(whole.x + whole.width), y1: Math.round(whole.y + whole.height)},
				head: head ? worldBox(root, head) : null,
			};
		});
		console.log('PROBE ' + JSON.stringify(out));
		continueRender(handle);
	}, [continueRender, handle]);
	return (
		<AbsoluteFill style={{backgroundColor: BRAND.background}}>
			<svg ref={ref} width={1920} height={1080} viewBox="0 0 1920 1080">
				<ZooRig x={300} y={1000} scale={1} expression={expression} breathe={false} />
				<Badger x={900} y={1000} scale={1} view="front" breathe={false} expression="neutral" judge={1} />
				<Badger x={1500} y={1000} scale={1} view="threeQuarter" breathe={false} expression="neutral" />
			</svg>
		</AbsoluteFill>
	);
};

export const ProbeRoot: React.FC = () => <Still id="ThumbProbe" component={Probe} width={1920} height={1080} defaultProps={{expression: 'neutral' as Expression}} />;
