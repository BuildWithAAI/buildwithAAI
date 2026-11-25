/**
 * AudioDemo (1920x1080, 30 fps, ~33 s): the audio integration in one mix. Theme sting, Zoo's narration
 * (Kokoro im_nicola) over a bed that ducks sample-accurately, a slide and a wipe with whooshes, three
 * bullets with rising pops, the Rekt Meter bumper with the bed resting under it, frame-locked keyboard
 * clicks and a theme button at the end. The picture is deliberately plain: the stage shows what plays,
 * the panel below draws the plan the audio is rendered from (speech, the bed's per-band duck, stingers,
 * SFX) with a playhead.
 *
 * Props: narrationDir (the voice step's output folder under public/), stems (render a subset for
 * measurement: 'voice' | 'bed' | 'stings' | 'sfx'). calculateMetadata loads timeline.json and builds the plan.
 */
import React, {useMemo} from 'react';
import {AbsoluteFill, CalculateMetadataFunction, Html5Audio, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {BRAND} from '../../characters/palette';
import {FONTS} from '../../brand/fonts';
import {MusicBed} from '../components/MusicBed.tsx';
import {Stinger} from '../components/Stinger.tsx';
import {SfxCues} from '../components/Sfx.tsx';
import {MUSIC, SFX} from '../components/library.ts';
import {demoBedPlan, demoPlan, planSfx, type DemoPlan, type DemoTimeline} from './plan.ts';

/** Stems for measurement renders: the narration, the bed, the stingers, the SFX. */
export type Stem = 'voice' | 'bed' | 'stings' | 'sfx';

export type AudioDemoProps = {
	/** the voice step's output folder under public/ (holds timeline.json and scenes/) */
	narrationDir: string;
	/** render only these stems (measurement renders); null = the full mix */
	stems: Stem[] | null;
	/** filled by calculateMetadata */
	plan?: DemoPlan;
};

export const AUDIO_DEMO_DEFAULTS: AudioDemoProps = {narrationDir: 'generated/zoora-security/_audio-demo/en', stems: null};

export const calculateAudioDemo: CalculateMetadataFunction<AudioDemoProps> = async ({props, abortSignal}) => {
	const path = `${props.narrationDir.replace(/\/+$/, '')}/timeline.json`;
	const res = await fetch(staticFile(path), {signal: abortSignal});
	if (!res.ok) {
		throw new Error(`AudioDemo: ${path} not found (HTTP ${res.status}). Synthesize the narration first: .venv-voice/bin/python scripts/voice/build.py src/audio/dev/fixtures/zoora-security/_audio-demo --lang en --voice im_nicola`);
	}
	const tl = (await res.json()) as DemoTimeline;
	const plan = demoPlan(tl, SFX, MUSIC, 30);
	return {durationInFrames: plan.durationInFrames, props: {...props, plan}};
};

const C = {bg: BRAND.background, ink: BRAND.nearBlack, slate: BRAND.slate, silver: BRAND.silver, paper: BRAND.offWhite, accent: BRAND.teal, muted: '#5B6470'};

const PANEL = {x: 96, y: 676, w: 1728, h: 350};
const TRACK = {x: PANEL.x + 196, w: PANEL.w - 196 - 40};
const LANES = [
	{id: 'voice', label: 'VOICE', y: PANEL.y + 64, h: 44},
	{id: 'bed', label: 'BED', y: PANEL.y + 132, h: 84},
	{id: 'music', label: 'STINGS', y: PANEL.y + 238, h: 34},
	{id: 'sfx', label: 'SFX', y: PANEL.y + 292, h: 30},
] as const;

const sectionAt = (p: DemoPlan, f: number) => [...p.sections].reverse().find((s) => f >= s.from) ?? p.sections[0];

/** The plan drawn as a mix timeline: speech, the bed's duck (speech band and lows), stingers, SFX, playhead. */
const MixPanel: React.FC<{plan: DemoPlan}> = ({plan}) => {
	const f = useCurrentFrame();
	const total = plan.durationInFrames;
	const x = (frame: number) => TRACK.x + (frame / total) * TRACK.w;
	const bed = useMemo(() => demoBedPlan(plan), [plan]);
	const lane = LANES[1];
	const curve = (band: number) => {
		const pts: string[] = [];
		for (let i = 0; i <= 600; i++) {
			const frame = (i / 600) * total;
			const g = bed.gain.gain(frame / plan.fps, band);
			// +6 dB (a lift) at the lane's top, -24 dB at its bottom
			const db = g > 0 ? Math.max(-24, Math.min(6, 20 * Math.log10(g))) : -24;
			pts.push(`${x(frame).toFixed(1)},${(lane.y + ((6 - db) / 30) * lane.h).toFixed(1)}`);
		}
		return `M ${pts.join(' L ')}`;
	};
	const stings = [plan.sting, plan.bumper, plan.outro];
	const sfx = planSfx(plan);
	const ticks = Array.from({length: Math.floor(total / plan.fps / 5) + 1}, (_, i) => i * 5);
	return (
		<svg width={1920} height={1080} style={{position: 'absolute', left: 0, top: 0}}>
			<rect x={PANEL.x} y={PANEL.y} width={PANEL.w} height={PANEL.h} rx={16} fill={C.slate} />
			{ticks.map((s) => (
				<g key={s}>
					<rect x={Math.round(x(s * plan.fps)) - 1} y={PANEL.y + 18} width={2} height={14} fill={C.silver} />
					<text x={x(s * plan.fps) + 6} y={PANEL.y + 34} fill={C.silver} fontFamily={FONTS.body} fontWeight={600} fontSize={24}>
						{s}s
					</text>
				</g>
			))}
			{LANES.map((l) => (
				<text key={l.id} x={PANEL.x + 40} y={l.y + l.h / 2 + 9} fill={C.paper} fontFamily={FONTS.body} fontWeight={700} fontSize={24} letterSpacing={1}>
					{l.label}
				</text>
			))}
			{plan.bed.speech.map((s, i) => (
				<rect key={i} x={x(s.start * plan.fps)} y={LANES[0].y} width={Math.max(3, x(s.end * plan.fps) - x(s.start * plan.fps))} height={LANES[0].h} rx={4} fill={C.paper} />
			))}
			<rect x={TRACK.x} y={lane.y + lane.h * (6 / 30)} width={TRACK.w} height={2} fill={C.muted} />
			<rect x={TRACK.x} y={lane.y + lane.h * (18 / 30)} width={TRACK.w} height={2} fill={C.muted} />
			<path d={curve(0)} fill="none" stroke={C.silver} strokeWidth={3} strokeLinejoin="round" />
			<path d={curve(1)} fill="none" stroke={C.paper} strokeWidth={4} strokeLinejoin="round" />
			{stings.map((s) => (
				<rect key={s.cue.id} x={x(s.from)} y={LANES[2].y} width={x(s.from + s.durationInFrames) - x(s.from)} height={LANES[2].h} rx={4} fill={C.silver} />
			))}
			{sfx.map((c, i) => (
				<rect key={i} x={Math.round(x(c.at)) - 1} y={LANES[3].y} width={c.label.startsWith('transition') ? 10 : 3} height={LANES[3].h} fill={c.label.startsWith('transition') ? C.paper : C.silver} />
			))}
			<rect x={x(f) - 2} y={PANEL.y + 50} width={4} height={PANEL.h - 64} fill={C.accent} />
		</svg>
	);
};

const Title: React.FC<{text: string; sub?: string}> = ({text, sub}) => (
	<div style={{position: 'absolute', left: 96, right: 96, top: 170, textAlign: 'center'}}>
		<div style={{fontFamily: FONTS.heading, fontWeight: 900, fontSize: 84, color: C.ink, letterSpacing: 2}}>{text}</div>
		{sub ? <div style={{fontFamily: FONTS.body, fontWeight: 600, fontSize: 30, color: C.muted, marginTop: 12}}>{sub}</div> : null}
	</div>
);

/** Dots that pop when a stinger's hits land (shows the music is on the frame grid). */
const Hits: React.FC<{hits: Array<{frame: number; what: string}>; y: number}> = ({hits, y}) => {
	const f = useCurrentFrame();
	const {fps} = useVideoConfig();
	const w = 1400;
	return (
		<div style={{position: 'absolute', left: (1920 - w) / 2, width: w, top: y, display: 'flex', justifyContent: 'center', gap: 56}}>
			{hits.map((h, i) => {
				const s = spring({frame: f - h.frame, fps, config: {stiffness: 200, damping: 14}});
				const on = f >= h.frame;
				return (
					<div key={i} style={{display: 'flex', flexDirection: 'column', alignItems: 'center', width: 240}}>
						<div style={{width: 64, height: 64, borderRadius: 32, border: `4px solid ${C.ink}`, backgroundColor: on ? C.ink : C.paper, transform: `scale(${on ? 0.7 + 0.3 * s : 0.7})`}} />
						<div style={{fontFamily: FONTS.body, fontWeight: 600, fontSize: 24, color: on ? C.ink : C.muted, marginTop: 12, textAlign: 'center'}}>{h.what.split(/[:(]/)[0].trim()}</div>
					</div>
				);
			})}
		</div>
	);
};

const Line: React.FC<{line: DemoPlan['lines'][number]; fps: number}> = ({line, fps}) => {
	const f = useCurrentFrame();
	const t = ((f - line.from) / fps) * 1000;
	return (
		<div style={{position: 'absolute', left: 160, right: 160, top: 300, textAlign: 'center', fontFamily: FONTS.body, fontWeight: 700, fontSize: 60, lineHeight: 1.35}}>
			{line.words.map((w, i) => {
				const said = t >= w.startMs;
				const now = t >= w.startMs && t < w.endMs + 80;
				return (
					<span key={i} style={{color: said ? C.ink : C.silver, borderBottom: `6px solid ${now ? C.accent : 'transparent'}`, marginRight: 18}}>
						{w.text}
					</span>
				);
			})}
		</div>
	);
};

const Bullets: React.FC<{plan: DemoPlan}> = ({plan}) => {
	const f = useCurrentFrame();
	const {fps} = useVideoConfig();
	return (
		<div style={{position: 'absolute', left: 260, right: 260, top: 300, display: 'flex', flexDirection: 'column', gap: 24}}>
			{plan.bullets.map((b, i) => {
				if (f < b.at) return <div key={i} style={{height: 84}} />;
				const s = spring({frame: f - b.at, fps, config: {stiffness: 200, damping: 14}});
				return (
					<div key={i} style={{height: 84, display: 'flex', alignItems: 'center', gap: 28, padding: '0 32px', backgroundColor: C.paper, border: `3px solid ${C.ink}`, borderRadius: 16, transform: `scale(${0.85 + 0.15 * s})`, transformOrigin: 'left center'}}>
						<div style={{width: 48, height: 48, borderRadius: 24, backgroundColor: C.ink, color: C.paper, fontFamily: FONTS.body, fontWeight: 800, fontSize: 28, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>{i + 1}</div>
						<div style={{fontFamily: FONTS.body, fontWeight: 700, fontSize: 44, color: C.ink}}>{b.text}</div>
					</div>
				);
			})}
		</div>
	);
};

/** A plain gauge that follows the bumper's music: fills to its first hit, falls on the next three. */
const Meter: React.FC<{plan: DemoPlan}> = ({plan}) => {
	const f = useCurrentFrame();
	const h = plan.bumper.hits.map((x) => x.frame);
	const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * t * (t * (6 * t - 15) + 10));
	const fill = ease((f - h[0]) / (h[1] - h[0]));
	const fall = [h[1], h[2], h[3]].reduce((v, hit, i) => v - 0.16 * ease((f - hit) / 4) * (i === 2 ? 1.4 : 1), 0);
	const v = Math.max(0, 0.88 * fill + fall);
	const ang = Math.PI * (1 - v);
	const cx = 960;
	const cy = 560;
	const r = 230;
	return (
		<svg width={1920} height={1080} style={{position: 'absolute', left: 0, top: 0}}>
			<path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke={C.silver} strokeWidth={28} strokeLinecap="round" />
			{v > 0.002 ? <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r * Math.cos(ang)} ${cy - r * Math.sin(ang)}`} fill="none" stroke={C.slate} strokeWidth={28} strokeLinecap="round" /> : null}
			<line x1={cx} y1={cy} x2={cx + (r - 40) * Math.cos(ang)} y2={cy - (r - 40) * Math.sin(ang)} stroke={C.ink} strokeWidth={8} strokeLinecap="round" />
			<circle cx={cx} cy={cy} r={18} fill={C.ink} />
		</svg>
	);
};

const Typing: React.FC<{plan: DemoPlan}> = ({plan}) => {
	const f = useCurrentFrame();
	const typed = plan.typing.cues.filter((c) => c.at <= f);
	const chars = typed.length ? typed[typed.length - 1].char + 1 : 0;
	const text = plan.typing.text.slice(0, chars);
	const entered = text.endsWith('\n');
	const caretOn = Math.floor(f / 15) % 2 === 0 || (typed.length > 0 && f - typed[typed.length - 1].at < 10);
	return (
		<div style={{position: 'absolute', left: 360, right: 360, top: 330, height: 200, backgroundColor: C.slate, borderRadius: 16, padding: '44px 56px', boxSizing: 'border-box'}}>
			<div style={{fontFamily: FONTS.body, fontWeight: 600, fontSize: 56, color: C.paper, whiteSpace: 'pre'}}>
				{'> '}
				{text.replace('\n', '')}
				{!entered && caretOn ? <span style={{display: 'inline-block', width: 28, height: 56, backgroundColor: C.paper, verticalAlign: 'text-bottom', marginLeft: 4}} /> : null}
			</div>
			{entered ? <div style={{fontFamily: FONTS.body, fontWeight: 600, fontSize: 30, color: C.silver, marginTop: 8}}>checked</div> : null}
		</div>
	);
};

/** Stage: the section that is playing; a slide pushes line 1 in, a wipe reveals line 2 (the whooshes land mid-move). */
const Stage: React.FC<{plan: DemoPlan}> = ({plan}) => {
	const f = useCurrentFrame();
	const s = sectionAt(plan, f);
	const tr = plan.transitions.find((t) => f >= t.at && f < t.at + t.frames);
	const p = tr ? (f - tr.at) / tr.frames : 1;
	const smooth = (t: number) => t * t * t * (t * (6 * t - 15) + 10);
	let style: React.CSSProperties = {};
	if (tr && tr.type === 'slide') style = {transform: `translateX(${(1 - smooth(p)) * 1920}px)`};
	if (tr && tr.type === 'wipe') style = {clipPath: `inset(0 ${(1 - smooth(p)) * 1920}px 0 0)`};
	const content = (() => {
		switch (s.id) {
			case 'sting':
				return (
					<>
						<Title text="THEME STING" sub="intro-sting-show: its hits land on frames" />
						<Hits hits={plan.sting.hits.filter((h) => !/motif starts/.test(h.what))} y={470} />
					</>
				);
			case 'line1':
				return (
					<>
						<Title text="ZOO + BED" sub="the bed ducks per sample under every phrase (2 / 12 / 4 dB band split)" />
						<Line line={plan.lines[0]} fps={plan.fps} />
					</>
				);
			case 'bullets':
				return <Bullets plan={plan} />;
			case 'bumper':
				return (
					<>
						<Title text="REKT METER" sub="bumper: the bed rests while it plays" />
						<Meter plan={plan} />
					</>
				);
			case 'line2':
				return (
					<>
						<Title text="ZOO + BED" sub="same duck; the bed fades back in from its rest" />
						<Line line={plan.lines[1]} fps={plan.fps} />
					</>
				);
			case 'typing':
				return (
					<>
						<Title text="TYPING BEAT" sub="one key per character, each on a frame" />
						<Typing plan={plan} />
					</>
				);
			default:
				return (
					<>
						<Title text="THEME BUTTON" sub="theme-5s: the bed fades out under it" />
						<Hits hits={plan.outro.hits} y={470} />
					</>
				);
		}
	})();
	return <AbsoluteFill style={style}>{content}</AbsoluteFill>;
};

const Header: React.FC = () => (
	<div style={{position: 'absolute', left: 96, right: 96, top: 54, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline'}}>
		<div style={{fontFamily: FONTS.heading, fontWeight: 800, fontSize: 40, color: C.slate, letterSpacing: 2}}>AUDIO DEMO</div>
		<div style={{fontFamily: FONTS.body, fontWeight: 600, fontSize: 26, color: C.muted}}>internal mix check · not for publishing</div>
	</div>
);

export const AudioDemo: React.FC<AudioDemoProps> = ({plan, stems}) => {
	if (!plan) throw new Error('AudioDemo: props.plan is missing (calculateMetadata did not run)');
	const want = (s: Stem) => !stems || stems.includes(s);
	return (
		<AbsoluteFill style={{backgroundColor: C.bg}}>
			<Header />
			<Stage plan={plan} />
			<MixPanel plan={plan} />
			{want('stings') ? (
				<>
					<Stinger id={plan.sting.cue.id} at={plan.sting.downbeat} />
					<Stinger id={plan.bumper.cue.id} at={plan.bumper.downbeat} />
					<Stinger id={plan.outro.cue.id} at={plan.outro.downbeat} />
				</>
			) : null}
			{want('bed') ? (
				<Sequence from={plan.bed.from} durationInFrames={plan.bed.durationInFrames} name="bed" layout="none">
					<MusicBed src={plan.bed.id} duck={{speech: plan.bed.speech}} lift={plan.bed.lift} rests={plan.bed.rests} fadeInMs={plan.bed.fadeInMs} fadeOutMs={plan.bed.fadeOutMs} startAtSec={plan.bed.startAtSec} />
				</Sequence>
			) : null}
			{want('voice')
				? plan.lines.map((l) => (
						<Sequence key={l.id} from={l.from} durationInFrames={l.durationInFrames} name={`voice ${l.id}`} layout="none">
							<Html5Audio src={staticFile(l.audio)} />
						</Sequence>
					))
				: null}
			{want('sfx') ? <SfxCues cues={planSfx(plan)} /> : null}
		</AbsoluteFill>
	);
};
