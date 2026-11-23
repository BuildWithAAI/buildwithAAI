import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';

type Props = {title: string; subtitle: string};

// Minimal SVG-drawn test: animated background, a blinking placeholder host,
// kinetic title, and a frame counter so timing can be checked on stills.
export const TestCard: React.FC<Props> = ({title, subtitle}) => {
	const frame = useCurrentFrame();
	const {fps, durationInFrames, width} = useVideoConfig();

	const pop = spring({frame, fps, config: {damping: 12}});
	const titleY = interpolate(pop, [0, 1], [60, 0]);
	const subOpacity = interpolate(frame, [20, 35], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
	const bob = Math.sin((frame / fps) * Math.PI * 2) * 8;
	const blink = frame % 45 >= 40 ? 0.1 : 1; // eyes close briefly every 1.5 s
	const progress = frame / (durationInFrames - 1);

	return (
		<AbsoluteFill style={{background: 'linear-gradient(135deg, #0b1020 0%, #1b2a6b 100%)', fontFamily: 'sans-serif'}}>
			<svg width="100%" height="100%" viewBox="0 0 1920 1080" style={{position: 'absolute'}}>
				{[...Array(12)].map((_, i) => (
					<circle
						key={i}
						cx={(i * 173 + frame * (2 + (i % 3))) % 1920}
						cy={120 + ((i * 97) % 840)}
						r={6 + (i % 4) * 4}
						fill="#5eead4"
						opacity={0.15}
					/>
				))}
				<g transform={`translate(1450 ${560 + bob})`}>
					<ellipse cx="0" cy="0" rx="190" ry="170" fill="#7c3aed" />
					<ellipse cx="-60" cy="-30" rx="28" ry={34 * blink} fill="#fff" />
					<ellipse cx="60" cy="-30" rx="28" ry={34 * blink} fill="#fff" />
					<circle cx="-55" cy="-25" r={14 * blink} fill="#111" />
					<circle cx="65" cy="-25" r={14 * blink} fill="#111" />
					<path d="M -55 60 Q 0 100 55 60" stroke="#fff" strokeWidth="10" fill="none" strokeLinecap="round" />
				</g>
			</svg>
			<div style={{position: 'absolute', left: 140, top: 380, transform: `translateY(${titleY}px)`, opacity: pop}}>
				<div style={{color: '#fff', fontSize: 130, fontWeight: 900, letterSpacing: -2}}>{title}</div>
				<div style={{color: '#5eead4', fontSize: 56, fontWeight: 700, opacity: subOpacity, marginTop: 10}}>{subtitle}</div>
			</div>
			<div style={{position: 'absolute', left: 0, bottom: 0, height: 14, width: width * progress, background: '#5eead4'}} />
			<div style={{position: 'absolute', right: 40, top: 30, color: '#94a3b8', fontSize: 32, fontFamily: 'monospace'}}>
				f{String(frame).padStart(3, '0')} · {(frame / fps).toFixed(2)}s
			</div>
		</AbsoluteFill>
	);
};
