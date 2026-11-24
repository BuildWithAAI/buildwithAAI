/**
 * <Diagram/>: the HowItWorked chain, e.g. key -> contract -> new address -> bridge. Each node appears on the word that
 * names it (perf/reveals.ts), the arrow into it draws first, then the icon grows in and its label wipes on. Labels are
 * concept-level text from onScreen.nodes / onScreen.links (validate.ts refuses code, addresses, links and numbered
 * steps). A small "Simplified concept" footnote says what the picture is.
 */
import React from 'react';
import {useCurrentFrame} from 'remotion';
import type {DiagramKind, Lang} from '../types';
import {Arrow, DiagramIcon} from './icons';
import {layoutDiagram, type Box} from './layout';
import {FitText, t} from '../graphics/text';
import {G} from '../graphics/theme';
import {EASE, track} from '../../episode/motion';

export type DiagramProps = {
	kinds: DiagramKind[];
	labels: string[];
	links: string[];
	reveals: number[]; // scene-local frame per node
	box: Box;
	orientation: 'row' | 'column';
	lang: Lang;
};

const GROW = 8;
const DRAW = 10;

export const Diagram: React.FC<DiagramProps> = ({kinds, labels, links, reveals, box, orientation, lang}) => {
	const frame = useCurrentFrame();
	const L = layoutDiagram(kinds.length, box, orientation);
	const row = orientation === 'row';
	return (
		<div data-part="diagram" style={{position: 'absolute', inset: 0}}>
			<svg width="100%" height="100%" style={{position: 'absolute', left: 0, top: 0, overflow: 'visible'}}>
				{L.arrows.map((a, i) => {
					const end = reveals[i + 1] ?? 0;
					const start = Math.max((reveals[i] ?? 0) + 2, end - DRAW);
					const p = track(frame, [[start, 0], [end, 1]], EASE.inOut);
					return <Arrow key={i} x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} p={p} />;
				})}
				{/* slots: where the nodes will land, so the card shows the shape of the story before each part is named */}
				{L.nodes.map((nd, i) =>
					frame < (reveals[i] ?? 0) + GROW ? <rect key={`s${i}`} x={nd.icon.x} y={nd.icon.y} width={nd.icon.w} height={nd.icon.h} rx={nd.icon.w * 0.16} fill={G.shadow} /> : null,
				)}
				{L.nodes.map((nd, i) => {
					const g = track(frame, [[reveals[i] ?? 0, 0], [(reveals[i] ?? 0) + GROW, 1]], EASE.decel);
					if (g <= 0) return null;
					const cx = nd.icon.x + nd.icon.w / 2;
					const cy = nd.icon.y + nd.icon.h / 2;
					return (
						<g key={i} transform={g >= 1 ? undefined : `translate(${cx} ${cy}) scale(${g}) translate(${-cx} ${-cy})`}>
							<DiagramIcon kind={kinds[i]} x={nd.icon.x} y={nd.icon.y} size={nd.icon.w} />
						</g>
					);
				})}
			</svg>
			{L.nodes.map((nd, i) => {
				const p = track(frame, [[(reveals[i] ?? 0) + 3, 0], [(reveals[i] ?? 0) + 3 + GROW, 1]], EASE.decel);
				if (p <= 0 || !labels[i]) return null;
				return (
					<div key={`l${i}`} style={{position: 'absolute', inset: 0, clipPath: p >= 1 ? undefined : `inset(0 ${(1 - p) * 100}% 0 0)`}}>
						<FitText
							text={labels[i]}
							spec={t('heading', 800, row ? 36 : 46, 26, row ? 3 : 2, 1.08, {balance: true})}
							lang={lang}
							box={nd.label}
							color={G.ink}
							align={row ? 'center' : 'left'}
							valign={row ? 'top' : 'center'}
							what={`diagram node ${i + 1}`}
						/>
					</div>
				);
			})}
			{L.arrows.map((a, i) => {
				const text = links[i];
				const end = reveals[i + 1] ?? 0;
				const p = track(frame, [[end - 4, 0], [end + 4, 1]], EASE.decel);
				if (!text || p <= 0 || a.label.h < 28) return null;
				return (
					<div key={`a${i}`} style={{position: 'absolute', inset: 0, clipPath: p >= 1 ? undefined : `inset(0 ${(1 - p) * 100}% 0 0)`}}>
						<FitText
							text={text}
							spec={t('body', 700, row ? 30 : 32, 24, 2, 1.05, {balance: true})}
							lang={lang}
							box={a.label}
							color={G.inkMuted}
							align={row ? 'center' : 'left'}
							valign={row ? 'bottom' : 'center'}
							what={`diagram arrow ${i + 1}`}
						/>
					</div>
				);
			})}
		</div>
	);
};
