/**
 * Diagram primitives for HowItWorked: flat, outlined icons in the house palette, each drawn in a 120 x 120 box and
 * scaled to `size` px with a constant ~4 px outline (ART_GUIDE SL4/SL10). Concept-level pictures only: a wallet, a
 * contract, a bridge, a mixer... never code, addresses, interfaces or logos of real products (CLAUDE.md: no third-party
 * logos). People are never drawn: "attacker" is an unknown address, a dark tile with a question mark, so no suspect is
 * depicted (owner rule: no naming or picturing of suspects).
 * Teal is not used: diagrams carry content, and teal is decoration only (CV5).
 */
import React from 'react';
import type {DiagramKind} from '../types';
import {G} from '../graphics/theme';

const BOX = 120;
type P = {sw: number};

const rr = (x: number, y: number, w: number, h: number, r: number) =>
	`M ${x + r} ${y} H ${x + w - r} A ${r} ${r} 0 0 1 ${x + w} ${y + r} V ${y + h - r} A ${r} ${r} 0 0 1 ${x + w - r} ${y + h} H ${x + r} A ${r} ${r} 0 0 1 ${x} ${y + h - r} V ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} Z`;

/** Fill then outline on top (SL4). */
const O: React.FC<{d: string; fill: string; sw: number}> = ({d, fill, sw}) => (
	<>
		<path d={d} fill={fill} />
		<path d={d} fill="none" stroke={G.ink} strokeWidth={sw} strokeLinejoin="round" strokeLinecap="round" />
	</>
);
const L: React.FC<{d: string; sw: number; w?: number}> = ({d, sw, w = 1}) => <path d={d} fill="none" stroke={G.ink} strokeWidth={sw * w} strokeLinejoin="round" strokeLinecap="round" />;

const Wallet: React.FC<P> = ({sw}) => (
	<>
		<O d={rr(26, 18, 62, 30, 6)} fill={G.card} sw={sw} />
		<O d={rr(12, 32, 96, 70, 14)} fill={G.slate} sw={sw} />
		<O d={rr(62, 50, 52, 34, 10)} fill={G.silver} sw={sw} />
		<circle cx={82} cy={67} r={6} fill={G.slate} stroke={G.ink} strokeWidth={sw * 0.6} />
	</>
);

const Contract: React.FC<P> = ({sw}) => (
	<>
		<O d="M 28 12 H 76 L 94 30 V 108 H 28 Z" fill={G.card} sw={sw} />
		<O d="M 76 12 V 30 H 94 Z" fill={G.shadow} sw={sw} />
		<L d="M 40 44 H 80 M 40 58 H 82 M 40 72 H 66" sw={sw} w={0.6} />
		<circle cx={74} cy={90} r={11} fill={G.slate} stroke={G.ink} strokeWidth={sw} />
	</>
);

const Bridge: React.FC<P> = ({sw}) => (
	<>
		<O d={rr(20, 64, 14, 40, 3)} fill={G.silver} sw={sw} />
		<O d={rr(86, 64, 14, 40, 3)} fill={G.silver} sw={sw} />
		<L d="M 22 64 Q 60 18 98 64" sw={sw} w={1.4} />
		<L d="M 41 50 V 64 M 60 41 V 64 M 79 50 V 64" sw={sw} w={0.6} />
		<O d={rr(6, 60, 108, 12, 4)} fill={G.slate} sw={sw} />
	</>
);

const Mixer: React.FC<P> = ({sw}) => (
	<>
		<O d="M 60 14 A 46 46 0 1 1 59.9 14 Z" fill={G.silver} sw={sw} />
		<L d="M 36 46 A 28 28 0 0 1 84 44" sw={sw} w={1.3} />
		<O d="M 84 30 L 94 50 L 74 52 Z" fill={G.ink} sw={sw * 0.5} />
		<L d="M 84 74 A 28 28 0 0 1 36 76" sw={sw} w={1.3} />
		<O d="M 36 90 L 26 70 L 46 68 Z" fill={G.ink} sw={sw * 0.5} />
	</>
);

const Attacker: React.FC<P> = ({sw}) => (
	<>
		<O d={rr(16, 16, 88, 88, 18)} fill={G.ink} sw={sw} />
		<text x={60} y={64} textAnchor="middle" dominantBaseline="central" fontFamily="Montserrat" fontWeight={900} fontSize={64} fill={G.card}>
			?
		</text>
	</>
);

const Key: React.FC<P> = ({sw}) => (
	<>
		<O d="M 56 52 H 108 V 68 H 100 V 82 H 88 V 68 H 80 V 78 H 70 V 68 H 56 Z" fill={G.slate} sw={sw} />
		<O d="M 38 34 A 26 26 0 1 1 37.9 34 Z" fill={G.silver} sw={sw} />
		<circle cx={38} cy={60} r={9} fill={G.bg} stroke={G.ink} strokeWidth={sw} />
	</>
);

const Site: React.FC<P> = ({sw}) => (
	<>
		<O d={rr(8, 18, 104, 84, 10)} fill={G.card} sw={sw} />
		<path d="M 8 38 V 28 A 10 10 0 0 1 18 18 H 102 A 10 10 0 0 1 112 28 V 38 Z" fill={G.slate} />
		<L d="M 8 38 H 112" sw={sw} />
		<path d={rr(8, 18, 104, 84, 10)} fill="none" stroke={G.ink} strokeWidth={sw} />
		<circle cx={22} cy={28} r={4} fill={G.card} />
		<circle cx={34} cy={28} r={4} fill={G.card} />
		<circle cx={46} cy={28} r={4} fill={G.card} />
		{/* a fishing hook: the fake page is bait */}
		<L d="M 62 48 V 78 A 12 12 0 0 1 38 78 V 72" sw={sw} w={1.2} />
		<L d="M 38 72 L 46 78" sw={sw} w={1.2} />
	</>
);

const Message: React.FC<P> = ({sw}) => (
	<>
		<O d="M 26 18 H 96 A 14 14 0 0 1 110 32 V 72 A 14 14 0 0 1 96 86 H 48 L 28 104 V 86 H 26 A 14 14 0 0 1 12 72 V 32 A 14 14 0 0 1 26 18 Z" fill={G.card} sw={sw} />
		<circle cx={40} cy={52} r={6} fill={G.ink} />
		<circle cx={61} cy={52} r={6} fill={G.ink} />
		<circle cx={82} cy={52} r={6} fill={G.ink} />
	</>
);

const Approval: React.FC<P> = ({sw}) => (
	<>
		<O d={rr(16, 14, 78, 92, 8)} fill={G.card} sw={sw} />
		<L d="M 28 34 H 80 M 28 48 H 72" sw={sw} w={0.6} />
		<L d="M 28 78 C 36 66 42 90 52 76 S 64 70 70 80" sw={sw} w={0.8} />
		<O d="M 88 66 A 22 22 0 1 1 87.9 66 Z" fill={G.slate} sw={sw} />
		<path d="M 78 88 L 86 96 L 100 80" fill="none" stroke={G.card} strokeWidth={sw * 1.2} strokeLinecap="round" strokeLinejoin="round" />
	</>
);

const Agent: React.FC<P> = ({sw}) => (
	<>
		<L d="M 44 16 V 28 M 60 16 V 28 M 76 16 V 28 M 44 92 V 104 M 60 92 V 104 M 76 92 V 104 M 16 44 H 28 M 16 60 H 28 M 16 76 H 28 M 92 44 H 104 M 92 60 H 104 M 92 76 H 104" sw={sw} w={1.1} />
		<O d={rr(26, 26, 68, 68, 12)} fill={G.slate} sw={sw} />
		<O d={rr(42, 42, 36, 36, 6)} fill={G.silver} sw={sw * 0.8} />
	</>
);

const Plugin: React.FC<P> = ({sw}) => (
	<O
		d="M 18 38 H 46 A 13 13 0 1 1 70 38 H 96 V 62 A 13 13 0 1 1 96 86 V 104 H 70 A 13 13 0 1 0 46 104 H 18 V 86 A 13 13 0 1 0 18 62 Z"
		fill={G.silver}
		sw={sw}
	/>
);

const Phone: React.FC<P> = ({sw}) => (
	<>
		<O d={rr(24, 12, 50, 96, 10)} fill={G.slate} sw={sw} />
		<O d={rr(31, 24, 36, 64, 4)} fill={G.card} sw={sw * 0.6} />
		<L d="M 84 46 A 16 16 0 0 1 84 74 M 94 36 A 30 30 0 0 1 94 84" sw={sw} w={1.1} />
	</>
);

const Exchange: React.FC<P> = ({sw}) => (
	<>
		<O d="M 12 44 L 60 14 L 108 44 Z" fill={G.slate} sw={sw} />
		<O d={rr(24, 50, 12, 42, 2)} fill={G.silver} sw={sw} />
		<O d={rr(54, 50, 12, 42, 2)} fill={G.silver} sw={sw} />
		<O d={rr(84, 50, 12, 42, 2)} fill={G.silver} sw={sw} />
		<O d={rr(12, 94, 96, 14, 3)} fill={G.slate} sw={sw} />
	</>
);

const Funds: React.FC<P> = ({sw}) => (
	<>
		<O d="M 20 86 A 34 12 0 1 0 88 86 A 34 12 0 1 0 20 86 Z" fill={G.silver} sw={sw} />
		<O d="M 20 70 A 34 12 0 1 0 88 70 A 34 12 0 1 0 20 70 Z" fill={G.silver} sw={sw} />
		<O d="M 20 54 A 34 12 0 1 0 88 54 A 34 12 0 1 0 20 54 Z" fill={G.silver} sw={sw} />
		<O d="M 78 58 A 26 26 0 1 1 77.9 58 Z" fill={G.card} sw={sw} />
		<circle cx={78} cy={84} r={15} fill="none" stroke={G.ink} strokeWidth={sw * 0.6} />
	</>
);

const ICONS: Record<DiagramKind, React.FC<P>> = {
	attacker: Attacker,
	wallet: Wallet,
	contract: Contract,
	bridge: Bridge,
	mixer: Mixer,
	exchange: Exchange,
	key: Key,
	site: Site,
	message: Message,
	approval: Approval,
	agent: Agent,
	plugin: Plugin,
	phone: Phone,
	funds: Funds,
};

/** One diagram node icon, `size` px square, at (x, y) = its top-left corner. */
export const DiagramIcon: React.FC<{kind: DiagramKind; x: number; y: number; size: number}> = ({kind, x, y, size}) => {
	const Icon = ICONS[kind];
	const sw = (4 * BOX) / size; // ~4 px at any size
	return (
		<svg x={x} y={y} width={size} height={size} viewBox={`0 0 ${BOX} ${BOX}`} overflow="visible">
			<Icon sw={sw} />
		</svg>
	);
};

/** A drawn arrow from (x1, y1) to (x2, y2): a thick near-black shaft and a solid head; `p` (0..1) draws it on. */
export const Arrow: React.FC<{x1: number; y1: number; x2: number; y2: number; p?: number; width?: number}> = ({x1, y1, x2, y2, p = 1, width = 6}) => {
	if (p <= 0) return null;
	const len = Math.hypot(x2 - x1, y2 - y1);
	const ux = (x2 - x1) / len;
	const uy = (y2 - y1) / len;
	const head = Math.min(26, len * 0.45);
	const tipX = x1 + ux * len * p;
	const tipY = y1 + uy * len * p;
	const bx = tipX - ux * head;
	const by = tipY - uy * head;
	const px = -uy;
	const py = ux;
	return (
		<g data-part="arrow">
			<path d={`M ${x1} ${y1} L ${bx} ${by}`} stroke={G.ink} strokeWidth={width} strokeLinecap="round" />
			<path d={`M ${tipX} ${tipY} L ${bx + px * head * 0.55} ${by + py * head * 0.55} L ${bx - px * head * 0.55} ${by - py * head * 0.55} Z`} fill={G.ink} stroke={G.ink} strokeWidth={2} strokeLinejoin="round" />
		</g>
	);
};
