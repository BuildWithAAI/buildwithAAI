/**
 * <QaProbe/>: injected into every composition of a QA bundle (see shim.tsx). It renders nothing. On every frame
 * it holds the render with delayRender until every other delayRender handle has cleared and the fonts are
 * loaded, measures the final DOM (texts, characters, banned techniques), prints the facts to the console in
 * chunks (captured by onBrowserLog in scripts/qa) and lets the screenshot happen. In the textoff and solo
 * passes it also installs the stylesheet that hides text fills or everything but the characters.
 *
 * Inactive (renders null, holds nothing) unless the render passes ZOORA_QA_PASS through envVariables.
 */
import {useLayoutEffect} from 'react';
import {continueRender, delayRender, useCurrentFrame, useVideoConfig} from 'remotion';
import {Badger} from '../../characters/badger/Badger';
import {ZooRig} from '../../characters/zoo/Zoo';
import {encodeChunks, QA_ENV, QA_PASSES, QA_PROTOCOL_VERSION, type FrameFacts, type QaPass} from '../protocol.ts';
import {measureBanned, measureCharacters, measureTexts, type MeasureContext} from './measure.ts';

type QaWindow = Window & {
	remotion_envVariables?: string;
	remotion_delayRenderHandles?: number[];
};

export type QaEnv = {pass: QaPass; run: string} | null;

let cachedEnv: QaEnv | undefined;
/** The pass this page renders, from the env variables Remotion injects (window.remotion_envVariables). */
export const qaEnv = (): QaEnv => {
	if (cachedEnv !== undefined) return cachedEnv;
	cachedEnv = null;
	try {
		const raw = (window as QaWindow).remotion_envVariables;
		const env = raw ? (JSON.parse(raw) as Record<string, string>) : {};
		const pass = env[QA_ENV.pass] as QaPass | undefined;
		if (pass && QA_PASSES.includes(pass)) cachedEnv = {pass, run: env[QA_ENV.run] || 'run'};
	} catch {
		cachedEnv = null;
	}
	return cachedEnv;
};

const STYLE_ID = 'zoora-qa-pass-style';
const PASS_CSS: Partial<Record<QaPass, string>> = {
	// Hide every text paint (fill, stroke, shadow, decoration) without changing layout.
	textoff: `
#remotion-canvas, #remotion-canvas * {
  color: transparent !important; -webkit-text-fill-color: transparent !important;
  -webkit-text-stroke-color: transparent !important; text-shadow: none !important;
  text-decoration-color: transparent !important; caret-color: transparent !important;
}
#remotion-canvas text, #remotion-canvas tspan, #remotion-canvas textPath {
  fill: transparent !important; stroke: transparent !important;
}`,
	// Hide everything except the character subtrees (their ancestors' transforms, filters and clips still apply).
	// Clip paths, masks and paint servers keep their content visible: visibility is inherited from the hidden
	// ancestors, and invisible clip-path children clip everything away (SVG 1.1, 14.3.5).
	// The hide rule must not match them either: its :not() specificity outranks the "visible" rule below.
	solo: `
#remotion-canvas *:not([data-character]):not([data-character] *):not(clipPath):not(clipPath *):not(mask):not(mask *):not(pattern):not(pattern *):not(symbol):not(symbol *):not(marker):not(marker *) { visibility: hidden !important; }
#remotion-canvas [data-character],
#remotion-canvas clipPath, #remotion-canvas clipPath *, #remotion-canvas mask, #remotion-canvas mask *,
#remotion-canvas pattern, #remotion-canvas pattern *, #remotion-canvas symbol, #remotion-canvas symbol *,
#remotion-canvas marker, #remotion-canvas marker * { visibility: visible !important; }
html, body, #remotion-canvas { background: transparent !important; }`,
	ref: `html, body, #remotion-canvas { background: transparent !important; }`,
};

const installStyle = (pass: QaPass) => {
	const css = PASS_CSS[pass];
	if (!css || document.getElementById(STYLE_ID)) return;
	const el = document.createElement('style');
	el.id = STYLE_ID;
	el.textContent = css;
	document.head.appendChild(el);
};

/** Wait for: no other delayRender handle, fonts loaded, then two animation frames of quiet. */
const whenSettled = (own: number, done: (settled: boolean) => void) => {
	const w = window as QaWindow;
	const started = Date.now();
	let quiet = 0;
	const tick = () => {
		const others = (w.remotion_delayRenderHandles ?? []).filter((h) => h !== own).length;
		const fontsOk = !document.fonts || document.fonts.status === 'loaded';
		quiet = others === 0 && fontsOk ? quiet + 1 : 0;
		if (quiet >= 1) return done(true);
		if (Date.now() - started > 20_000) return done(false);
		requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
};

const emit = (env: NonNullable<QaEnv>, facts: FrameFacts) => {
	for (const line of encodeChunks(env.run, env.pass, facts.frame, JSON.stringify(facts))) console.log(line);
};

export const QaProbe: React.FC<{charactersOnly?: boolean}> = ({charactersOnly = false}) => {
	const frame = useCurrentFrame();
	const {id, width, height, durationInFrames} = useVideoConfig();
	const env = qaEnv();
	useLayoutEffect(() => {
		if (!env) return;
		installStyle(env.pass);
		const handle = delayRender(`zoora-qa probe frame ${frame}`, {timeoutInMilliseconds: 60_000});
		let finished = false;
		const finish = () => {
			if (finished) return;
			finished = true;
			continueRender(handle);
		};
		whenSettled(handle, (settled) => {
			if (finished) return;
			const t0 = performance.now();
			const errors: string[] = [];
			const facts: FrameFacts = {
				v: QA_PROTOCOL_VERSION,
				pass: env.pass,
				run: env.run,
				comp: id,
				frame,
				width,
				height,
				settled,
				texts: [],
				chars: [],
				banned: [],
				ms: 0,
				errors,
			};
			const root = document.getElementById('remotion-canvas') ?? document.body;
			const rr = root.getBoundingClientRect();
			const ctx: MeasureContext = {root, ox: rr.left, oy: rr.top, width, height, compId: id, durationInFrames, absoluteFrame: frame, canonical: {zoo: ZooRig, badger: Badger}};
			const measureText = env.pass === 'scout' || env.pass === 'pixels';
			const run = <T,>(name: string, fn: () => T, fallback: T): T => {
				try {
					return fn();
				} catch (err) {
					errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
					return fallback;
				}
			};
			if (measureText && !charactersOnly) facts.texts = run('texts', () => measureTexts(ctx), []);
			if (measureText || env.pass === 'ref') facts.chars = run('characters', () => measureCharacters(ctx), []);
			if (measureText && !charactersOnly) facts.banned = run('banned', () => measureBanned(ctx), []);
			facts.ms = Math.round(performance.now() - t0);
			emit(env, facts);
			finish();
		});
		return finish;
	}, [frame, env, id, width, height, durationInFrames, charactersOnly]);
	return null;
};
