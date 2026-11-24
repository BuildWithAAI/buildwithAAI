/**
 * Probe: renders Zoo (front) and BADGER (front, threeQuarter) at scale 1 and measures world-unit boxes (geometry boxes,
 * strokes excluded) of each whole rig, its head group and its face core. The numbers are printed onto the image and to
 * the browser console ("PROBE {...}"). They are the RIG constants of src/thumbnails/layout.ts; re-run after a rig change:
 *   npx remotion still src/thumbnails/dev/probe/index.ts ThumbProbe out/thumbnails/_probe.png --props='{"expression":"shocked"}'
 */
import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
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
	const [report, setReport] = useState<string[] | null>(null);
	useLayoutEffect(() => {
		const svg = ref.current;
		if (!svg) return;
		const out: Record<string, unknown> = {};
		svg.querySelectorAll<SVGGElement>('[data-character]').forEach((root, i) => {
			const key = `${root.getAttribute('data-character')}-${root.getAttribute('data-view')}-${i}`;
			const whole = root.getBBox();
			const head = root.querySelector<SVGGElement>('[data-part="head"], [data-head]');
			// face core: Zoo's brows, eyes, nose, mouth and beard; Badger's skull (the first path of the head, ears excluded)
			const parts = Array.from(root.querySelectorAll<SVGGraphicsElement>('[data-part="brows"], [data-part="eyes"], [data-part="nose"], [data-part="mouth"], [data-part="beard"], [data-head] > path'));
			const boxes = parts.slice(0, root.getAttribute('data-character') === 'badger' ? 1 : parts.length).map((el) => worldBox(root, el));
			const face = boxes.length
				? {x0: Math.min(...boxes.map((b) => b.x0)), y0: Math.min(...boxes.map((b) => b.y0)), x1: Math.max(...boxes.map((b) => b.x1)), y1: Math.max(...boxes.map((b) => b.y1))}
				: null;
			out[key] = {
				whole: {x0: Math.round(whole.x), y0: Math.round(whole.y), x1: Math.round(whole.x + whole.width), y1: Math.round(whole.y + whole.height)},
				head: head ? worldBox(root, head) : null,
				face,
			};
		});
		console.log('PROBE ' + JSON.stringify(out));
		setReport(Object.entries(out).map(([k, v]) => `${k} ${JSON.stringify(v)}`));
	}, []);
	useEffect(() => {
		if (report) continueRender(handle);
	}, [report, continueRender, handle]);
	return (
		<AbsoluteFill style={{backgroundColor: BRAND.background}}>
			<svg ref={ref} width={1920} height={1080} viewBox="0 0 1920 1080">
				<ZooRig x={300} y={1000} scale={1} expression={expression} breathe={false} />
				<Badger x={900} y={1000} scale={1} view="front" breathe={false} expression="neutral" judge={1} />
				<Badger x={1500} y={1000} scale={1} view="threeQuarter" breathe={false} expression="neutral" />
				{(report ?? []).map((line, i) => (
					<text key={i} x={24} y={40 + i * 26} fontFamily="monospace" fontSize={16} fill={BRAND.nearBlack}>
						{line}
					</text>
				))}
			</svg>
		</AbsoluteFill>
	);
};

export const ProbeRoot: React.FC = () => <Still id="ThumbProbe" component={Probe} width={1920} height={1080} defaultProps={{expression: 'neutral' as Expression}} />;
